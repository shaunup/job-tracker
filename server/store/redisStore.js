// ---------------------------------------------------------------------------
// redisStore.js — durable, serverless-friendly storage backed by Upstash Redis
// (a.k.a. Vercel KV). Uses the HTTP/REST client so it works inside Vercel
// functions with no persistent TCP connections.
//
// Data model (Redis hashes, so concurrent function invocations don't clobber
// each other by rewriting one big document):
//   jt:emails   field = message id   value = JSON email
//   jt:jobs     field = job key      value = JSON job
//   jt:settings field = setting key  value = JSON value (OAuth tokens, etc.)
// ---------------------------------------------------------------------------
import { Redis } from '@upstash/redis';

const E = 'jt:emails';
const J = 'jt:jobs';
const S = 'jt:settings';

export function createRedisStore({ url, token }) {
  // automaticDeserialization:false → values are stored/returned as raw strings
  // and we control JSON (de)serialization ourselves.
  const redis = new Redis({ url, token, automaticDeserialization: false });

  const parse = (v) => {
    if (v == null) return null;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  };
  const values = (hash) => (hash ? Object.values(hash).map(parse) : []);
  const isJob = (e) => e && (e.is_job_related === 1 || e.is_job_related === true);

  return {
    name: 'upstash-redis (Vercel KV)',

    async getSetting(key, fallback = null) {
      const v = await redis.hget(S, key);
      return v == null ? fallback : parse(v);
    },
    async setSetting(key, value) {
      await redis.hset(S, { [key]: JSON.stringify(value) });
    },
    async deleteSetting(key) {
      await redis.hdel(S, key);
    },

    async upsertEmail(email) {
      const existingRaw = await redis.hget(E, email.id);
      const merged = existingRaw ? { ...parse(existingRaw), ...email } : email;
      await redis.hset(E, { [email.id]: JSON.stringify(merged) });
    },
    async getEmailIds() {
      return (await redis.hkeys(E)) || [];
    },
    async getJobEmails() {
      const all = values(await redis.hgetall(E));
      return all.filter(isJob).sort((a, b) => a.received_at - b.received_at);
    },
    async getEmailsByKey(jobKey) {
      const all = values(await redis.hgetall(E));
      return all
        .filter((e) => isJob(e) && e.company === jobKey)
        .sort((a, b) => a.received_at - b.received_at);
    },

    async clearJobs() {
      await redis.del(J);
    },
    async upsertJob(job) {
      await redis.hset(J, { [job.job_key]: JSON.stringify(job) });
    },
    async getJobs() {
      return values(await redis.hgetall(J)).sort((a, b) => b.last_update - a.last_update);
    },

    async wipeAll() {
      // Preserve settings (OAuth tokens) so the user stays connected.
      await Promise.all([redis.del(E), redis.del(J)]);
    },
    async stats() {
      const [emails, jobs] = await Promise.all([redis.hgetall(E), redis.hlen(J)]);
      const list = values(emails);
      return {
        emails: list.length,
        jobEmails: list.filter(isJob).length,
        jobs: jobs || 0,
      };
    },
  };
}
