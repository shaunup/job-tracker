// ---------------------------------------------------------------------------
// db.js — selects a storage backend and re-exports its async API.
//
//   • If Upstash Redis / Vercel KV credentials are present, use durable Redis
//     storage (required for real persistence on Vercel's serverless runtime).
//   • Otherwise fall back to a JSON file (great for local dev and any host with
//     a persistent, writable disk).
//
// Supported env var pairs (either works):
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   (Upstash integration)
//   KV_REST_API_URL        / KV_REST_API_TOKEN          (Vercel KV integration)
// ---------------------------------------------------------------------------
import { createJsonStore } from './store/jsonStore.js';

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

let store;
if (url && token) {
  const { createRedisStore } = await import('./store/redisStore.js');
  store = createRedisStore({ url, token });
  console.log('[db] storage: Upstash Redis (Vercel KV) — durable');
} else {
  store = createJsonStore();
  console.log(`[db] storage: ${store.name}`);
  if (process.env.VERCEL) {
    console.warn(
      '[db] WARNING: no Vercel KV / Upstash Redis configured. On Vercel the ' +
        'filesystem is ephemeral, so data and your Gmail connection will reset ' +
        'on cold starts. Add the Upstash integration (see README) for persistence.'
    );
  }
}

export const storageName = store.name;

export const getSetting = (...a) => store.getSetting(...a);
export const setSetting = (...a) => store.setSetting(...a);
export const deleteSetting = (...a) => store.deleteSetting(...a);
export const upsertEmail = (...a) => store.upsertEmail(...a);
export const getEmailIds = (...a) => store.getEmailIds(...a);
export const getJobEmails = (...a) => store.getJobEmails(...a);
export const getEmailsByKey = (...a) => store.getEmailsByKey(...a);
export const clearJobs = (...a) => store.clearJobs(...a);
export const upsertJob = (...a) => store.upsertJob(...a);
export const getJobs = (...a) => store.getJobs(...a);
export const wipeAll = (...a) => store.wipeAll(...a);
export const stats = (...a) => store.stats(...a);

export default store;
