// ---------------------------------------------------------------------------
// db.js — SQLite persistence layer (better-sqlite3, synchronous & fast).
// ---------------------------------------------------------------------------
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'jobtracker.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS emails (
    id            TEXT PRIMARY KEY,
    thread_id     TEXT,
    from_name     TEXT,
    from_email    TEXT,
    subject       TEXT,
    snippet       TEXT,
    body          TEXT,
    received_at   INTEGER,
    company       TEXT,
    position      TEXT,
    status        TEXT,
    confidence    REAL,
    is_job_related INTEGER DEFAULT 0,
    created_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    job_key       TEXT UNIQUE,
    company       TEXT,
    position      TEXT,
    status        TEXT,
    first_seen    INTEGER,
    last_update   INTEGER,
    last_email_id TEXT,
    email_count   INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_emails_company ON emails(company);
  CREATE INDEX IF NOT EXISTS idx_emails_received ON emails(received_at);
`);

// --- settings helpers ------------------------------------------------------
const _getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const _setSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
const _delSetting = db.prepare('DELETE FROM settings WHERE key = ?');

export function getSetting(key, fallback = null) {
  const row = _getSetting.get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function setSetting(key, value) {
  _setSetting.run(key, JSON.stringify(value));
}

export function deleteSetting(key) {
  _delSetting.run(key);
}

// --- email helpers ---------------------------------------------------------
const _upsertEmail = db.prepare(`
  INSERT INTO emails (id, thread_id, from_name, from_email, subject, snippet, body,
                      received_at, company, position, status, confidence, is_job_related, created_at)
  VALUES (@id, @thread_id, @from_name, @from_email, @subject, @snippet, @body,
          @received_at, @company, @position, @status, @confidence, @is_job_related, @created_at)
  ON CONFLICT(id) DO UPDATE SET
    company = excluded.company,
    position = excluded.position,
    status = excluded.status,
    confidence = excluded.confidence,
    is_job_related = excluded.is_job_related
`);

export function upsertEmail(email) {
  _upsertEmail.run(email);
}

export function emailExists(id) {
  return !!db.prepare('SELECT 1 FROM emails WHERE id = ?').get(id);
}

export function getJobEmails() {
  return db
    .prepare('SELECT * FROM emails WHERE is_job_related = 1 ORDER BY received_at ASC')
    .all();
}

export function getEmailsForJob(company, position) {
  return db
    .prepare(
      'SELECT * FROM emails WHERE is_job_related = 1 AND company = ? AND position = ? ORDER BY received_at ASC'
    )
    .all(company, position);
}

// --- jobs helpers ----------------------------------------------------------
export function clearJobs() {
  db.prepare('DELETE FROM jobs').run();
}

const _upsertJob = db.prepare(`
  INSERT INTO jobs (job_key, company, position, status, first_seen, last_update, last_email_id, email_count)
  VALUES (@job_key, @company, @position, @status, @first_seen, @last_update, @last_email_id, @email_count)
  ON CONFLICT(job_key) DO UPDATE SET
    company = excluded.company,
    position = excluded.position,
    status = excluded.status,
    first_seen = excluded.first_seen,
    last_update = excluded.last_update,
    last_email_id = excluded.last_email_id,
    email_count = excluded.email_count
`);

export function upsertJob(job) {
  _upsertJob.run(job);
}

export function getJobs() {
  return db.prepare('SELECT * FROM jobs ORDER BY last_update DESC').all();
}

export function getJobByKey(jobKey) {
  return db.prepare('SELECT * FROM jobs WHERE job_key = ?').get(jobKey);
}

export function getEmailsByKey(jobKey) {
  return db
    .prepare(
      'SELECT * FROM emails WHERE is_job_related = 1 AND company = ? ORDER BY received_at ASC'
    )
    .all(jobKey);
}

export function wipeAll() {
  db.exec('DELETE FROM emails; DELETE FROM jobs;');
}

export function stats() {
  return {
    emails: db.prepare('SELECT COUNT(*) c FROM emails').get().c,
    jobEmails: db.prepare('SELECT COUNT(*) c FROM emails WHERE is_job_related = 1').get().c,
    jobs: db.prepare('SELECT COUNT(*) c FROM jobs').get().c,
  };
}

export default db;
