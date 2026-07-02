// ---------------------------------------------------------------------------
// llm.js — optional AI classifier.
//
// When an API key is configured, emails are classified by a language model
// (which reads subject + sender + body) instead of the keyword heuristic.
// Falls back silently to the heuristic on any error.
//
// Providers (auto-detected, in priority order):
//   Google Gemini — set GEMINI_API_KEY (recommended; has a free tier).
//                   Defaults to model `gemini-2.0-flash` via Gemini's
//                   OpenAI-compatible endpoint.
//   OpenAI /
//   compatible     — set OPENAI_API_KEY (+ optional OPENAI_BASE_URL/OPENAI_MODEL).
//
// Overrides: OPENAI_MODEL / GEMINI_MODEL, OPENAI_BASE_URL.
// ---------------------------------------------------------------------------
import { STATUSES } from './classifier.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';

/**
 * Resolve which model provider to use from the environment.
 * @returns {{key:string, baseUrl:string, model:string, name:string}|null}
 */
export function resolveProvider() {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    return {
      key: geminiKey,
      baseUrl: (process.env.OPENAI_BASE_URL || GEMINI_BASE).replace(/\/$/, ''),
      model: process.env.GEMINI_MODEL || process.env.OPENAI_MODEL || 'gemini-2.0-flash',
      name: 'gemini',
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      key: process.env.OPENAI_API_KEY,
      baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      name: 'openai',
    };
  }
  return null;
}

export function isLlmEnabled() {
  return !!resolveProvider();
}

export function llmModel() {
  return resolveProvider()?.model || '';
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

async function callModel(messages) {
  const provider = resolveProvider();
  if (!provider) throw new Error('No AI provider configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.key}`,
      },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${provider.name} ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

// Parse model output into an object, tolerating markdown code fences or leading
// prose that some models add around JSON.
function parseJsonLoose(content) {
  const cleaned = String(content)
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('LLM returned non-JSON output');
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

  const content = await callModel([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify({ emails: compact }) },
  ]);

  const parsed = parseJsonLoose(content);

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
