// ---------------------------------------------------------------------------
// db.js — dependency-free JSON persistence layer.
//
// Deliberately avoids native modules (previously better-sqlite3) so the app
// builds and runs everywhere, including serverless platforms like Vercel where
// native binaries and writable project directories are unavailable.
//
// Storage location:
//   - Local / persistent hosts: <repo>/data/jobtracker.json
//   - Serverless (VERCEL) or read-only FS: /tmp/jobtracker/jobtracker.json
//     (note: /tmp is per-instance and ephemeral — see README for durable setups)
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const preferred = path.join(__dirname, '..', 'data');
  if (process.env.VERCEL || process.env.AWS_REGION) return '/tmp/jobtracker';
  try {
    fs.mkdirSync(preferred, { recursive: true });
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch {
    return '/tmp/jobtracker';
  }
}

const dataDir = resolveDataDir();
fs.mkdirSync(dataDir, { recursive: true });
const dataFile = path.join(dataDir, 'jobtracker.json');

const empty = () => ({ emails: {}, jobs: {}, settings: {} });

let store;
function load() {
  try {
    store = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    store.emails ||= {};
    store.jobs ||= {};
    store.settings ||= {};
  } catch {
    store = empty();
  }
}
load();

let saveQueued = false;
function persist() {
  // Coalesce rapid writes (e.g. during a sync) into a single flush.
  if (saveQueued) return;
  saveQueued = true;
  queueMicrotask(() => {
    saveQueued = false;
    try {
      fs.writeFileSync(dataFile, JSON.stringify(store));
    } catch (e) {
      console.warn('[db] failed to persist:', e.message);
    }
  });
}

// --- settings --------------------------------------------------------------
export function getSetting(key, fallback = null) {
  return key in store.settings ? store.settings[key] : fallback;
}
export function setSetting(key, value) {
  store.settings[key] = value;
  persist();
}
export function deleteSetting(key) {
  delete store.settings[key];
  persist();
}

// --- emails ----------------------------------------------------------------
export function upsertEmail(email) {
  const existing = store.emails[email.id];
  store.emails[email.id] = existing ? { ...existing, ...email } : { ...email };
  persist();
}
export function emailExists(id) {
  return id in store.emails;
}
export function getJobEmails() {
  return Object.values(store.emails)
    .filter((e) => e.is_job_related === 1 || e.is_job_related === true)
    .sort((a, b) => a.received_at - b.received_at);
}
export function getEmailsByKey(jobKey) {
  return Object.values(store.emails)
    .filter(
      (e) =>
        (e.is_job_related === 1 || e.is_job_related === true) && e.company === jobKey
    )
    .sort((a, b) => a.received_at - b.received_at);
}

// --- jobs ------------------------------------------------------------------
export function clearJobs() {
  store.jobs = {};
  persist();
}
export function upsertJob(job) {
  store.jobs[job.job_key] = { ...job };
  persist();
}
export function getJobs() {
  return Object.values(store.jobs).sort((a, b) => b.last_update - a.last_update);
}
export function getJobByKey(jobKey) {
  return store.jobs[jobKey] || null;
}

// --- maintenance -----------------------------------------------------------
export function wipeAll() {
  // Preserve settings (OAuth tokens) so the user stays connected.
  store.emails = {};
  store.jobs = {};
  persist();
}
export function stats() {
  const emails = Object.values(store.emails);
  return {
    emails: emails.length,
    jobEmails: emails.filter((e) => e.is_job_related === 1 || e.is_job_related === true).length,
    jobs: Object.keys(store.jobs).length,
  };
}

export default { load, dataFile };
