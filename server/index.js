// ---------------------------------------------------------------------------
// index.js — Express server: REST API + serves the built dashboard.
// ---------------------------------------------------------------------------
import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  getJobs,
  getEmailsByKey,
  getSetting,
  stats,
  wipeAll,
  storageName,
} from './db.js';
import { rebuildJobs } from './jobs.js';
import { loadDemoData } from './demoData.js';
import {
  isConfigured,
  isAuthenticated,
  getAuthUrl,
  handleCallback,
  getProfile,
  disconnect,
  syncGmail,
} from './gmail.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(cookieParser());

// --- status ----------------------------------------------------------------
app.get('/api/status', async (req, res) => {
  try {
    const [connected, profile, lastSync, s] = await Promise.all([
      isAuthenticated(),
      getProfile(),
      getSetting('last_sync'),
      stats(),
    ]);
    res.json({
      googleConfigured: isConfigured(),
      connected,
      profile,
      lastSync,
      stats: s,
      storage: storageName,
      syncing: syncState.running,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- auth -------------------------------------------------------------------
app.get('/api/auth/google', async (req, res) => {
  if (!isConfigured()) {
    return res.status(400).json({ error: 'Google OAuth is not configured on the server.' });
  }
  res.redirect(await getAuthUrl());
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/?auth=error');
  if (!code) return res.redirect('/?auth=missing_code');
  try {
    await handleCallback(String(code));
    // Kick off an initial sync in the background.
    runSync().catch(() => {});
    res.redirect('/?auth=success');
  } catch (e) {
    console.error('OAuth callback failed:', e.message);
    res.redirect('/?auth=error');
  }
});

app.post('/api/auth/disconnect', async (req, res) => {
  await disconnect();
  res.json({ ok: true });
});

// --- jobs & emails ----------------------------------------------------------
app.get('/api/jobs', async (req, res) => {
  const jobs = await getJobs();
  const byStatus = jobs.reduce((acc, j) => {
    acc[j.status] = (acc[j.status] || 0) + 1;
    return acc;
  }, {});
  res.json({
    jobs,
    counts: {
      total: jobs.length,
      applied: byStatus.applied || 0,
      assessment: byStatus.assessment || 0,
      interview: byStatus.interview || 0,
      offer: byStatus.offer || 0,
      rejected: byStatus.rejected || 0,
    },
  });
});

app.get('/api/jobs/:key/emails', async (req, res) => {
  const emails = (await getEmailsByKey(req.params.key)).map((e) => ({
    id: e.id,
    subject: e.subject,
    from_name: e.from_name,
    from_email: e.from_email,
    snippet: e.snippet,
    received_at: e.received_at,
    status: e.status,
    confidence: e.confidence,
  }));
  res.json({ emails });
});

// --- sync -------------------------------------------------------------------
const syncState = { running: false, lastResult: null, lastError: null };

async function runSync() {
  if (syncState.running) return syncState.lastResult;
  syncState.running = true;
  syncState.lastError = null;
  try {
    const result = await syncGmail();
    await rebuildJobs();
    syncState.lastResult = result;
    return result;
  } catch (e) {
    syncState.lastError = e.message;
    throw e;
  } finally {
    syncState.running = false;
  }
}

app.post('/api/sync', async (req, res) => {
  if (!(await isAuthenticated())) {
    return res.status(400).json({ error: 'Not connected to Gmail. Connect your account first.' });
  }
  try {
    const result = await runSync();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET endpoint for scheduled syncs (e.g. Vercel Cron, which issues GET
// requests). No-ops quietly when Gmail isn't connected.
app.get('/api/cron/sync', async (req, res) => {
  if (!(await isAuthenticated())) return res.json({ ok: true, skipped: 'not connected' });
  try {
    const result = await runSync();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- demo & reset -----------------------------------------------------------
app.post('/api/demo', async (req, res) => {
  await loadDemoData();
  const jobs = await rebuildJobs();
  res.json({ ok: true, jobs: jobs.length });
});

app.post('/api/reset', async (req, res) => {
  await wipeAll();
  res.json({ ok: true });
});

// --- static client ----------------------------------------------------------
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res
      .status(200)
      .send(
        '<h1>Job Tracker API</h1><p>The client has not been built yet. Run <code>npm run build</code>, or start the dev client with <code>npm run client</code>.</p>'
      );
  });
}

// --- automatic polling ------------------------------------------------------
// On serverless platforms (e.g. Vercel) a long-lived timer can't run — a
// scheduled request to /api/cron/sync is used instead (see vercel.json). On
// persistent hosts we poll in-process.
const isServerless = !!process.env.VERCEL;
const intervalMinutes = Number(process.env.SYNC_INTERVAL_MINUTES || 10);

if (!isServerless && intervalMinutes > 0) {
  setInterval(async () => {
    if (syncState.running) return;
    if (await isAuthenticated()) {
      runSync()
        .then((r) => r && console.log(`[auto-sync] fetched ${r.fetched}, job-related ${r.jobRelated}`))
        .catch((e) => console.warn('[auto-sync] failed:', e.message));
    }
  }, intervalMinutes * 60 * 1000);
}

// Only start an HTTP listener when running as a standalone server. Under
// serverless the platform imports the exported `app` as a request handler.
if (!isServerless) {
  app.listen(PORT, () => {
    console.log(`\n  Job Tracker running at http://localhost:${PORT}`);
    console.log(`  Gmail OAuth configured: ${isConfigured() ? 'yes' : 'no (see README / .env)'}`);
    if (intervalMinutes > 0) console.log(`  Auto-sync every ${intervalMinutes} min when connected.\n`);
  });
}

export default app;
