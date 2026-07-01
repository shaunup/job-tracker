// ---------------------------------------------------------------------------
// jobs.js — aggregate classified emails into "jobs".
//
// A job is a unique (company, position) pair. Its current status is taken from
// the most recent status-bearing email; ties are broken by pipeline rank so a
// rejection/offer is never hidden behind an earlier stage.
// ---------------------------------------------------------------------------
import { getJobEmails, clearJobs, upsertJob } from './db.js';
import { STATUS_RANK } from './classifier.js';

// Jobs are keyed by company. Grouping purely on company keeps the board clean:
// email-by-email position extraction is unreliable, so splitting on it tends to
// create duplicate cards for the same application. The position is still shown
// as an attribute (taken from whichever email revealed it).
function jobKey(company) {
  return `${company || 'Unknown'}`;
}

/**
 * Rebuild the jobs table from all job-related emails currently stored.
 * Returns the freshly computed job list.
 */
export async function rebuildJobs() {
  const emails = await getJobEmails();
  const groups = new Map();

  for (const e of emails) {
    const key = jobKey(e.company);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  await clearJobs();
  const results = [];

  for (const [key, group] of groups) {
    group.sort((a, b) => a.received_at - b.received_at);

    let current = null;
    for (const e of group) {
      if (!e.status) continue;
      if (
        !current ||
        e.received_at > current.received_at ||
        (e.received_at === current.received_at &&
          STATUS_RANK[e.status] > STATUS_RANK[current.status])
      ) {
        current = e;
      }
    }

    const first = group[0];
    const last = group[group.length - 1];
    const position = group.find((e) => e.position)?.position || '';

    const job = {
      job_key: key,
      company: first.company || 'Unknown',
      position,
      status: current ? current.status : 'applied',
      first_seen: first.received_at,
      last_update: last.received_at,
      last_email_id: (current || last).id,
      email_count: group.length,
    };
    await upsertJob(job);
    results.push(job);
  }

  results.sort((a, b) => b.last_update - a.last_update);
  return results;
}
