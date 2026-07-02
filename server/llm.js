// ---------------------------------------------------------------------------
// llm.js — optional AI classifier.
//
// When an OpenAI-compatible API key is configured, emails are classified by a
// language model (which reads subject + sender + body) instead of the keyword
// heuristic. Works with OpenAI or any OpenAI-compatible endpoint via
// OPENAI_BASE_URL. Falls back silently to the heuristic on any error.
//
// Env:
//   OPENAI_API_KEY   (required to enable)
//   OPENAI_MODEL     (default: gpt-4o-mini)
//   OPENAI_BASE_URL  (default: https://api.openai.com/v1)
// ---------------------------------------------------------------------------
import { STATUSES } from './classifier.js';

export function isLlmEnabled() {
  return !!process.env.OPENAI_API_KEY;
}

export function llmModel() {
  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
}

const SYSTEM_PROMPT = `You classify a user's job-application emails.

For EACH email decide:
- job_related: true only if the email is about a job the user applied to (application receipts, recruiter outreach about a specific role, assessments, interview scheduling, offers, rejections). Newsletters, job-board digests/alerts, marketing, and unrelated mail are false.
- status: the pipeline stage this specific email represents. One of:
    "applied"     – application received/confirmed, "thanks for applying".
    "assessment"  – online test, coding challenge, take-home, questionnaire.
    "interview"   – interview invite/scheduling, phone screen, availability request.
    "offer"       – a job offer is extended.
    "rejected"    – not moving forward, position filled, unsuccessful.
  Use null when job_related is false.
- company: the hiring company's name (not the ATS/mail vendor like Greenhouse, Lever, Workday). "" if unknown.
- position: the role/title if stated, else "".

Return STRICT JSON: {"results":[{"id":"<id>","job_related":<bool>,"status":<string|null>,"company":<string>,"position":<string>}]} with one entry per input email, same ids.`;

async function callOpenAI(messages) {
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: llmModel(),
        temperature: 0,
        response_format: { type: 'json_object' },
        messages,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

function normalizeStatus(s) {
  if (!s) return null;
  const v = String(s).toLowerCase().trim();
  return STATUSES.includes(v) ? v : null;
}

/**
 * Classify a batch of emails with the LLM.
 * @param {Array<{id,subject,fromName,fromEmail,body,snippet}>} emails
 * @returns {Promise<Map<string, {isJobRelated,status,company,position,confidence}>>}
 */
export async function classifyBatchLlm(emails) {
  if (!emails.length) return new Map();

  const compact = emails.map((e) => ({
    id: e.id,
    from: `${e.fromName || ''} <${e.fromEmail || ''}>`.trim(),
    subject: (e.subject || '').slice(0, 300),
    body: String(e.body || e.snippet || '').replace(/\s+/g, ' ').slice(0, 1500),
  }));

  const content = await callOpenAI([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify({ emails: compact }) },
  ]);

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('LLM returned non-JSON output');
  }

  const map = new Map();
  for (const r of parsed.results || []) {
    const jobRelated = !!r.job_related;
    let status = normalizeStatus(r.status);
    if (jobRelated && !status) status = 'applied';
    map.set(String(r.id), {
      isJobRelated: jobRelated,
      status: jobRelated ? status : null,
      company: (r.company || '').trim() || 'Unknown',
      position: (r.position || '').trim(),
      confidence: 0.9,
    });
  }
  return map;
}
