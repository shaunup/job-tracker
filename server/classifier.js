// ---------------------------------------------------------------------------
// classifier.js
//
// Heuristic engine that decides, for a single email, whether it is related to
// a job application and, if so, which stage of the pipeline it represents:
//
//   applied  ->  assessment  ->  interview  ->  offer
//                                          \->  rejected  (terminal)
//
// Everything is keyword / pattern based so it works fully offline without any
// paid ML API. Each status has a set of weighted signals; the status with the
// highest score above a threshold wins.
// ---------------------------------------------------------------------------

export const STATUSES = ['applied', 'assessment', 'interview', 'offer', 'rejected'];

// Ordering used to describe how "far along" a pipeline stage is. `rejected`
// sits highest so that a rejection is never hidden behind an earlier stage
// when two emails share the exact same timestamp.
export const STATUS_RANK = {
  applied: 1,
  assessment: 2,
  interview: 3,
  offer: 4,
  rejected: 5,
};

// Weighted phrases per status. Longer / more specific phrases carry more weight.
const SIGNALS = {
  rejected: [
    [/\bunfortunately\b/i, 3],
    [/\bwe (?:have )?(?:decided|regret)\b/i, 3],
    [/not (?:be )?(?:moving|proceeding|progressing) forward/i, 5],
    [/will not be (?:moving|proceeding|progressing)/i, 5],
    [/decided (?:not to|to not) (?:move|proceed|continue)/i, 5],
    [/other (?:candidates|applicants)/i, 4],
    [/pursue other candidates/i, 5],
    [/not (?:to )?(?:be )?selected/i, 4],
    [/we(?:'| a)re unable to (?:offer|move)/i, 5],
    [/position has been filled/i, 5],
    [/no longer under consideration/i, 5],
    [/regret to inform/i, 5],
    [/were not successful/i, 5],
    [/wish you (?:the best|success|luck)/i, 2],
    [/keep your (?:resume|application|details) on file/i, 3],
  ],
  offer: [
    [/pleased to (?:extend|offer)/i, 6],
    [/(?:job|employment|formal) offer/i, 6],
    [/offer letter/i, 6],
    [/we(?:'| a)re (?:excited|thrilled|delighted) to offer/i, 6],
    [/extend(?:ing)? (?:you )?an offer/i, 6],
    [/congratulations[^.!]{0,40}offer/i, 5],
    [/your (?:starting )?(?:salary|compensation|start date)/i, 3],
    [/welcome (?:to the|aboard)/i, 3],
  ],
  interview: [
    [/\binterview\b/i, 4],
    [/(?:phone|video|technical|onsite|on-site|final) (?:screen|interview|round)/i, 5],
    [/schedule (?:a|your|the)? ?(?:call|chat|interview|conversation|meeting)/i, 4],
    [/(?:would|we'?d) (?:love|like) to (?:speak|chat|meet|talk)/i, 4],
    [/(?:hiring|recruiting) (?:manager|team) would like/i, 4],
    [/set up (?:a|some) time/i, 3],
    [/availability (?:for|to)/i, 2],
    [/next (?:round|step|stage)/i, 3],
    [/calendly\.com/i, 3],
    [/book (?:a|your) (?:slot|time)/i, 3],
  ],
  assessment: [
    [/\bassessment\b/i, 4],
    [/(?:coding|technical|online|take[- ]?home) (?:challenge|test|assessment|assignment|exercise|task)/i, 5],
    [/\b(?:hackerrank|codility|codesignal|testgorilla|coderbyte|leetcode|karat|woven)\b/i, 5],
    [/complete (?:the|a|your|an) (?:assessment|test|challenge|assignment|questionnaire)/i, 4],
    [/skills? (?:test|assessment|challenge)/i, 4],
    [/aptitude test/i, 4],
    [/(?:psychometric|personality) (?:test|assessment)/i, 4],
  ],
  applied: [
    [/thank you for (?:your )?(?:applying|application|your interest)/i, 5],
    [/we(?:'| ha)ve received your application/i, 6],
    [/your application (?:has been|was) (?:received|submitted)/i, 6],
    [/application (?:received|submitted|confirmation)/i, 5],
    [/successfully applied/i, 5],
    [/thanks for applying/i, 5],
    [/we are reviewing your application/i, 4],
    [/application for the .* (?:position|role)/i, 3],
    [/we (?:will|'ll) (?:review|be in touch)/i, 2],
  ],
};

// Domains / phrases that strongly indicate a recruiting-related email even
// when the body is generic. Helps us keep noise out of the dashboard.
const JOB_CONTEXT = [
  /\b(?:job|position|role|opening|vacancy|opportunity)\b/i,
  /\b(?:application|applied|applicant|candidate|recruit(?:er|ing|ment)|talent|hiring)\b/i,
  /\b(?:career|careers)\b/i,
];

const ATS_DOMAINS = [
  'greenhouse.io', 'lever.co', 'workday.com', 'myworkday.com', 'ashbyhq.com',
  'smartrecruiters.com', 'icims.com', 'jobvite.com', 'workable.com',
  'bamboohr.com', 'taleo.net', 'successfactors.com', 'linkedin.com',
  'indeed.com', 'ziprecruiter.com', 'hire.lever.co', 'recruitee.com',
  'breezy.hr', 'teamtailor.com', 'gem.com', 'rippling.com',
];

function stripHtml(text = '') {
  return text
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score every status against the given text and return a sorted list.
 */
function scoreStatuses(text) {
  const scores = {};
  for (const status of STATUSES) {
    let score = 0;
    for (const [pattern, weight] of SIGNALS[status]) {
      if (pattern.test(text)) score += weight;
    }
    scores[status] = score;
  }
  return scores;
}

/**
 * Decide whether an email looks like it belongs to a job pipeline at all.
 */
function looksJobRelated({ text, fromEmail = '', statusScore }) {
  if (statusScore > 0) return true;
  const domain = (fromEmail.split('@')[1] || '').toLowerCase();
  if (ATS_DOMAINS.some((d) => domain.endsWith(d))) return true;
  const contextHits = JOB_CONTEXT.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
  return contextHits >= 2;
}

/**
 * Best-effort company extraction. Prefers a clean sender display name, then
 * falls back to the sending domain.
 */
export function extractCompany({ fromName = '', fromEmail = '', subject = '' }) {
  const cleanName = fromName
    .replace(/["']/g, '')
    .replace(/\bvia\b.*$/i, '')
    .replace(/\b(?:careers?|jobs?|recruiting|recruitment|talent|hr|hiring|team|no-?reply|noreply|notifications?|do-?not-?reply)\b/gi, '')
    .replace(/[|,-].*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleanName && cleanName.length > 1 && !/^\W+$/.test(cleanName)) {
    return titleCase(cleanName);
  }

  const domain = (fromEmail.split('@')[1] || '').toLowerCase();
  if (domain) {
    const genericMailers = [
      'greenhouse.io', 'lever.co', 'myworkday.com', 'workday.com', 'ashbyhq.com',
      'smartrecruiters.com', 'gmail.com', 'notifications', 'bamboohr.com',
      'hire.lever.co', 'us.greenhouse-mail.io', 'greenhouse-mail.io',
    ];
    const base = domain.split('.').slice(0, -1).join('.');
    const first = domain.split('.')[0];
    if (!genericMailers.some((g) => domain.includes(g))) {
      return titleCase(first.replace(/[-_]/g, ' '));
    }
    // ATS mailers sometimes embed the company as a subdomain label.
    const label = domain.split('.')[0];
    if (label && !['mail', 'email', 'no-reply', 'noreply', 'jobs', 'careers'].includes(label)) {
      return titleCase(label.replace(/[-_]/g, ' '));
    }
    return titleCase(base.replace(/[-_.]/g, ' '));
  }
  return 'Unknown';
}

// Words that never form part of a real job title — used to trim captured text.
const TITLE_STOPWORDS = new Set([
  'the', 'for', 'a', 'an', 'your', 'our', 'to', 'at', 'of', 'and', 'with',
  'position', 'role', 'opening', 'opportunity', 'application', 'apply',
  'applying', 'received', 'submitted', 'confirmation', 're', 'fwd',
]);

/**
 * Best-effort role/title extraction. Deliberately conservative: it only returns
 * a position when the subject contains a recognised role keyword (Engineer,
 * Designer, ...). This avoids polluting the dashboard with fragments like
 * "To Figma" or "Received".
 */
export function extractPosition({ subject = '', body = '', snippet = '' }) {
  // Prefer the subject line; fall back to the first bit of the body.
  const source = `${subject || ''}. ${stripHtml(body || snippet || '').slice(0, 300)}`;
  const cleaned = source.replace(/\s+/g, ' ').trim();
  const m = cleaned.match(
    /((?:[A-Za-z0-9/&+.-]+\s+){0,3}(?:Software|Backend|Frontend|Front-end|Full[- ]?Stack|Data|Machine Learning|ML|Product|Project|Program|Sr\.?|Jr\.?|Senior|Junior|Staff|Lead|Principal|Associate)?\s*(?:Engineer|Developer|Designer|Manager|Analyst|Scientist|Intern(?:ship)?|Architect|Consultant|Specialist|Administrator|Programmer|Director|Coordinator|Researcher|Strategist|Recruiter|Accountant))/i
  );
  if (!m) return '';

  let words = m[1].trim().split(/\s+/);
  // Drop leading stopwords ("your", "for the", "application", ...).
  while (words.length > 1 && TITLE_STOPWORDS.has(words[0].toLowerCase())) {
    words.shift();
  }
  const title = words.join(' ').replace(/[\s—–-]+$/, '').trim();
  if (title.length < 3) return '';
  return titleCase(title);
}

function titleCase(str) {
  return str
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length <= 3 && /^[a-z]+$/.test(w) && ['and', 'the', 'for', 'of'].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
    .trim();
}

/**
 * Main entry point: classify one email.
 *
 * @returns {{ isJobRelated: boolean, status: string|null, confidence: number,
 *             company: string, position: string, scores: object }}
 */
export function classifyEmail(email) {
  const subject = email.subject || '';
  const bodyText = stripHtml(email.body || email.snippet || '');
  const text = `${subject}\n${subject}\n${bodyText}`; // weight the subject twice

  const scores = scoreStatuses(text);
  const best = STATUSES.reduce(
    (acc, s) => (scores[s] > acc.score ? { status: s, score: scores[s] } : acc),
    { status: null, score: 0 }
  );

  const isJobRelated = looksJobRelated({
    text,
    fromEmail: email.fromEmail || '',
    statusScore: best.score,
  });

  // If it is clearly a recruiting email but no stage keyword fired, default to
  // "applied" — most first-contact recruiting mail is an application receipt.
  let status = best.status;
  if (isJobRelated && !status) status = 'applied';

  const confidence = Math.min(1, best.score / 6);

  return {
    isJobRelated,
    status: isJobRelated ? status : null,
    confidence: Number(confidence.toFixed(2)),
    company: extractCompany(email),
    position: extractPosition(email),
    scores,
  };
}
