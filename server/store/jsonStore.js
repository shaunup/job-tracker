// ---------------------------------------------------------------------------
// jsonStore.js — file-backed store used for local development and any host
// with a writable, persistent filesystem. All methods are async so this and
// the Redis store are interchangeable.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.env.VERCEL || process.env.AWS_REGION) return '/tmp/jobtracker';
  const preferred = path.join(__dirname, '..', '..', 'data');
  try {
    fs.mkdirSync(preferred, { recursive: true });
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch {
    return '/tmp/jobtracker';
  }
}

export function createJsonStore() {
  const dataDir = resolveDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const dataFile = path.join(dataDir, 'jobtracker.json');

  let store;
  try {
    store = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    store.emails ||= {};
    store.jobs ||= {};
    store.settings ||= {};
  } catch {
    store = { emails: {}, jobs: {}, settings: {} };
  }

  let saveQueued = false;
  const persist = () => {
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
  };

  const isJob = (e) => e.is_job_related === 1 || e.is_job_related === true;

  return {
    name: `json (${dataFile})`,

    async getSetting(key, fallback = null) {
      return key in store.settings ? store.settings[key] : fallback;
    },
    async setSetting(key, value) {
      store.settings[key] = value;
      persist();
    },
    async deleteSetting(key) {
      delete store.settings[key];
      persist();
    },

    async upsertEmail(email) {
      const existing = store.emails[email.id];
      store.emails[email.id] = existing ? { ...existing, ...email } : { ...email };
      persist();
    },
    async getJobEmails() {
      return Object.values(store.emails)
        .filter(isJob)
        .sort((a, b) => a.received_at - b.received_at);
    },
    async getEmailsByKey(jobKey) {
      return Object.values(store.emails)
        .filter((e) => isJob(e) && e.company === jobKey)
        .sort((a, b) => a.received_at - b.received_at);
    },

    async clearJobs() {
      store.jobs = {};
      persist();
    },
    async upsertJob(job) {
      store.jobs[job.job_key] = { ...job };
      persist();
    },
    async getJobs() {
      return Object.values(store.jobs).sort((a, b) => b.last_update - a.last_update);
    },

    async wipeAll() {
      store.emails = {};
      store.jobs = {};
      persist();
    },
    async stats() {
      const emails = Object.values(store.emails);
      return {
        emails: emails.length,
        jobEmails: emails.filter(isJob).length,
        jobs: Object.keys(store.jobs).length,
      };
    },
  };
}
