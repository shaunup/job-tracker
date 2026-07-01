// ---------------------------------------------------------------------------
// gmail.js — Google OAuth 2.0 flow + Gmail message sync.
// ---------------------------------------------------------------------------
import { google } from 'googleapis';
import { getSetting, setSetting, deleteSetting, upsertEmail, getEmailIds } from './db.js';
import { classifyEmail } from './classifier.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];
const TOKEN_KEY = 'google_tokens';
const PROFILE_KEY = 'google_profile';

export function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

async function oauthClient() {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/api/auth/google/callback'
  );

  const tokens = await getSetting(TOKEN_KEY);
  if (tokens) client.setCredentials(tokens);

  // Persist refreshed tokens automatically (fire-and-forget).
  client.on('tokens', (t) => {
    (async () => {
      const existing = (await getSetting(TOKEN_KEY)) || {};
      await setSetting(TOKEN_KEY, { ...existing, ...t });
    })().catch((e) => console.warn('[gmail] token persist failed:', e.message));
  });

  return client;
}

export async function getAuthUrl() {
  const client = await oauthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

export async function handleCallback(code) {
  const client = await oauthClient();
  const { tokens } = await client.getToken(code);
  await setSetting(TOKEN_KEY, tokens);
  client.setCredentials(tokens);

  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();
    await setSetting(PROFILE_KEY, { email: data.email, name: data.name, picture: data.picture });
  } catch {
    /* profile is best-effort */
  }
}

export async function isAuthenticated() {
  return !!(await getSetting(TOKEN_KEY));
}

export function getProfile() {
  return getSetting(PROFILE_KEY);
}

export async function disconnect() {
  await deleteSetting(TOKEN_KEY);
  await deleteSetting(PROFILE_KEY);
}

// --- message parsing -------------------------------------------------------
function header(headers, name) {
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function parseFrom(fromRaw) {
  const m = fromRaw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: '', email: (fromRaw || '').trim().toLowerCase() };
}

function decodeBody(part) {
  if (!part) return '';
  if (part.body && part.body.data) {
    return Buffer.from(part.body.data, 'base64').toString('utf8');
  }
  return '';
}

function extractBody(payload) {
  if (!payload) return '';
  let plain = '';
  let html = '';

  const walk = (part) => {
    if (!part) return;
    const mime = part.mimeType || '';
    if (mime === 'text/plain') plain += decodeBody(part);
    else if (mime === 'text/html') html += decodeBody(part);
    if (part.parts) part.parts.forEach(walk);
  };
  walk(payload);

  return plain || html || decodeBody(payload);
}

// --- sync ------------------------------------------------------------------
const SEARCH_QUERY =
  '(application OR applied OR applying OR interview OR assessment OR "coding challenge" OR ' +
  'offer OR recruiter OR recruiting OR "your application" OR "thank you for applying" OR ' +
  'candidate OR "position" OR "job") -in:sent -category:promotions';

/**
 * Fetch job-related messages from Gmail, classify them, and persist. Returns a
 * summary of the sync run.
 */
async function runWithConcurrency(items, limit, worker, shouldStop) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      if (shouldStop && shouldStop()) return;
      const current = items[idx++];
      await worker(current);
    }
  });
  await Promise.all(runners);
}

export async function syncGmail() {
  if (!isConfigured()) throw new Error('Google OAuth is not configured.');
  if (!(await isAuthenticated())) throw new Error('Not connected to Gmail.');

  const client = await oauthClient();
  const gmail = google.gmail({ version: 'v1', auth: client });

  const lookbackDays = Number(process.env.SYNC_LOOKBACK_DAYS || 365);
  const query = `${SEARCH_QUERY} newer_than:${lookbackDays}d`;

  // Serverless functions have a hard time limit, so bound the work: gather a
  // page of candidate ids, skip anything we already stored, then fetch the rest
  // concurrently until we run low on time. Unfinished work is picked up by the
  // next sync (manual, cron, or the in-browser timer).
  const timeBudgetMs = Number(process.env.SYNC_TIME_BUDGET_MS || 40000);
  const maxCandidates = Number(process.env.SYNC_MAX_CANDIDATES || 800);
  const concurrency = Number(process.env.SYNC_CONCURRENCY || 12);
  const startedAt = Date.now();
  const overBudget = () => Date.now() - startedAt > timeBudgetMs;

  // 1) Collect candidate message ids.
  const candidateIds = [];
  let pageToken;
  do {
    const list = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 100,
      pageToken,
    });
    for (const m of list.data.messages || []) candidateIds.push(m.id);
    pageToken = list.data.nextPageToken;
  } while (pageToken && candidateIds.length < maxCandidates && !overBudget());

  // 2) Skip messages already stored so repeat syncs are fast/incremental.
  const existing = new Set(await getEmailIds());
  const toFetch = candidateIds.filter((id) => !existing.has(id));

  // 3) Fetch + classify + persist concurrently, within the time budget.
  let fetched = 0;
  let jobRelated = 0;
  let processed = 0;

  await runWithConcurrency(
    toFetch,
    concurrency,
    async (id) => {
      let msg;
      try {
        const full = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });
        msg = full.data;
      } catch (e) {
        console.warn('[sync] failed to fetch message', id, e.message);
        processed += 1;
        return;
      }

      const headers = msg.payload?.headers || [];
      const from = parseFrom(header(headers, 'From'));
      const subject = header(headers, 'Subject');
      const dateHeader = header(headers, 'Date');
      const receivedAt = msg.internalDate
        ? Number(msg.internalDate)
        : dateHeader
        ? Date.parse(dateHeader)
        : Date.now();

      const snippet = msg.snippet || '';
      const emailInput = {
        subject,
        snippet,
        body: snippet,
        fromName: from.name,
        fromEmail: from.email,
      };
      const c = classifyEmail(emailInput);

      await upsertEmail({
        id: msg.id,
        thread_id: msg.threadId,
        from_name: from.name,
        from_email: from.email,
        subject,
        snippet,
        body: snippet.slice(0, 2000),
        received_at: receivedAt,
        company: c.company,
        position: c.position,
        status: c.status,
        confidence: c.confidence,
        is_job_related: c.isJobRelated ? 1 : 0,
        created_at: Date.now(),
      });

      fetched += 1;
      processed += 1;
      if (c.isJobRelated) jobRelated += 1;
    },
    overBudget
  );

  await setSetting('last_sync', Date.now());
  const remaining = toFetch.length - processed;
  return { fetched, jobRelated, remaining, done: remaining <= 0 };
}
