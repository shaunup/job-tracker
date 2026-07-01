// ---------------------------------------------------------------------------
// gmail.js — Google OAuth 2.0 flow + Gmail message sync.
// ---------------------------------------------------------------------------
import { google } from 'googleapis';
import { getSetting, setSetting, deleteSetting, upsertEmail } from './db.js';
import { classifyEmail } from './classifier.js';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
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
export async function syncGmail({ onEmail } = {}) {
  if (!isConfigured()) throw new Error('Google OAuth is not configured.');
  if (!(await isAuthenticated())) throw new Error('Not connected to Gmail.');

  const client = await oauthClient();
  const gmail = google.gmail({ version: 'v1', auth: client });

  const lookbackDays = Number(process.env.SYNC_LOOKBACK_DAYS || 365);
  const query = `${SEARCH_QUERY} newer_than:${lookbackDays}d`;

  let pageToken;
  let fetched = 0;
  let jobRelated = 0;
  const seen = new Set();
  const maxMessages = 500; // safety cap per run

  do {
    const list = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 100,
      pageToken,
    });
    const messages = list.data.messages || [];
    pageToken = list.data.nextPageToken;

    for (const { id } of messages) {
      if (seen.has(id) || fetched >= maxMessages) continue;
      seen.add(id);

      const full = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'full',
      });
      const msg = full.data;
      const headers = msg.payload?.headers || [];
      const from = parseFrom(header(headers, 'From'));
      const subject = header(headers, 'Subject');
      const dateHeader = header(headers, 'Date');
      const receivedAt = msg.internalDate
        ? Number(msg.internalDate)
        : dateHeader
        ? Date.parse(dateHeader)
        : Date.now();

      const emailInput = {
        subject,
        snippet: msg.snippet || '',
        body: extractBody(msg.payload),
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
        snippet: msg.snippet || '',
        body: emailInput.body.slice(0, 20000),
        received_at: receivedAt,
        company: c.company,
        position: c.position,
        status: c.status,
        confidence: c.confidence,
        is_job_related: c.isJobRelated ? 1 : 0,
        created_at: Date.now(),
      });

      fetched += 1;
      if (c.isJobRelated) jobRelated += 1;
      if (onEmail) onEmail();
    }
  } while (pageToken && fetched < maxMessages);

  await setSetting('last_sync', Date.now());
  return { fetched, jobRelated };
}
