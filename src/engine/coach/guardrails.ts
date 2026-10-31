/**
 * Safety guardrails applied to EVERY coach message (template or LLM) before it is shown.
 *
 *  1. Non-clinical language   — a lexicon of diagnostic / medical terms is blocked.
 *  2. Grounding               — every number in an LLM message must exist in the evidence.
 *  3. No false certainty      — projections can never be phrased as guarantees.
 *  4. Input hygiene           — personal identifiers are redacted before any LLM call;
 *                               clinical questions and distress are routed to fixed, safe replies.
 */

/** Clinical / diagnostic vocabulary the coach must never use. Matched as whole words, case-insensitive. */
export const CLINICAL_TERMS = [
  'diagnos(?:e|es|ed|is|tic|ing)',
  'disorders?',
  'diseases?',
  'dementia',
  "alzheimer(?:'s)?",
  'adhd',
  'autis(?:m|tic)',
  'dyslexi(?:a|c)',
  'dyscalculia',
  'impair(?:ed|ment|ments)',
  'deficits?',
  'deficien(?:t|cy|cies)',
  'patholog(?:y|ical)',
  'symptoms?',
  'syndromes?',
  'patients?',
  'therap(?:y|ies|eutic|ist)',
  'treatments?',
  'clinical(?:ly)?',
  'cognitive decline',
  'mci',
  'neurodegenerat(?:ive|ion)',
  'brain damage',
  'abnormal(?:ity|ities)?',
  'iq',
  'intelligence quotient',
  'depress(?:ion|ed)',
  'anxiety disorder',
  'mental illness',
  'psychiatric',
  'neurological',
  'medications?',
  'prescriptions?',
  'lesions?',
  'atrophy',
  'retard(?:ed|ation)',
  'below normal',
  'screening',
];

const CLINICAL_RE = new RegExp(`\\b(${CLINICAL_TERMS.join('|')})\\b`, 'gi');

/** Phrases that state certainty about the future — forbidden for projections. */
const CERTAINTY_RE =
  /\b(will (definitely|certainly|surely|undoubtedly)|definitely will|guarantee(d|s)?|100 ?% (sure|certain)|without (a )?doubt|is certain to|are certain to|you will reach)\b/gi;

export interface GuardrailResult {
  ok: boolean;
  violations: Array<{ rule: 'clinical' | 'grounding' | 'certainty' | 'length'; detail: string }>;
  checks: string[];
}

export function findClinicalTerms(text: string): string[] {
  return [...new Set([...text.matchAll(CLINICAL_RE)].map((m) => m[0].toLowerCase()))];
}

/** Numbers mentioned in text (ignores digits inside ISO-like dates). */
export function extractNumbers(text: string): number[] {
  return [...text.replace(/\d{4}-\d{2}-\d{2}/g, '').matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w])/g)].map((m) => Number(m[1]));
}

export function checkMessage(text: string, opts: { allowedNumbers?: readonly number[]; maxChars?: number } = {}): GuardrailResult {
  const violations: GuardrailResult['violations'] = [];
  const checks: string[] = [];

  const clinical = findClinicalTerms(text);
  if (clinical.length) violations.push({ rule: 'clinical', detail: `Clinical terms: ${clinical.join(', ')}` });
  checks.push('Non-clinical language');

  const certainty = [...text.matchAll(CERTAINTY_RE)].map((m) => m[0]);
  if (certainty.length) violations.push({ rule: 'certainty', detail: `Certainty language: ${certainty.join(', ')}` });
  checks.push('No guarantees about the future');

  if (opts.allowedNumbers) {
    const allowed = opts.allowedNumbers;
    const bad = extractNumbers(text).filter((n) => !allowed.some((a) => Math.abs(a - n) < 0.005 || Math.round(a) === n));
    if (bad.length) violations.push({ rule: 'grounding', detail: `Numbers not found in the evidence: ${[...new Set(bad)].join(', ')}` });
    checks.push('Numbers checked against evidence');
  }

  if (opts.maxChars && text.length > opts.maxChars) {
    violations.push({ rule: 'length', detail: `Message too long (${text.length} > ${opts.maxChars} chars)` });
  }
  return { ok: violations.length === 0, violations, checks };
}

// --- Input-side protections ------------------------------------------------------------------

const PII_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'email', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { kind: 'card number', re: /\b(?:\d[ -]?){13,16}\b/g },
  { kind: 'phone number', re: /(?:\+|00)\d{1,3}[ .-]?\d{2,3}[ .-]?\d{3}[ .-]?\d{3,4}\b|\b\d{2}[ .-]\d{3}[ .-]\d{3}\b/g },
  { kind: 'ID number', re: /\b\d{8}\b/g },
];

export function redactPII(text: string): { text: string; found: string[] } {
  const found: string[] = [];
  let out = text;
  for (const { kind, re } of PII_PATTERNS) {
    out = out.replace(re, () => {
      found.push(kind);
      return `[${kind} removed]`;
    });
  }
  return { text: out, found: [...new Set(found)] };
}

const CLINICAL_QUERY_RE =
  /\b(do i have|have i got|am i|could i have|might i have|test me for|check (me )?for|signs? of|symptoms? of)\b[^.?!]*\b(autis\w*|dyslexi\w*|depress\w*|anxiety|disorder|disease|brain damage|cognitive decline|mci)\b|\b(diagnos\w+|medication|therapy|psychiatrist|neurologist|alzheimer\w*|dementia|adhd)\b/i;

export function isClinicalQuery(text: string): boolean {
  return CLINICAL_QUERY_RE.test(text);
}

const DISTRESS_RE = /\b(kill myself|suicid\w*|end my life|want to die|self[- ]?harm|hurt myself|no reason to live)\b/i;

export function isDistress(text: string): boolean {
  return DISTRESS_RE.test(text);
}

/** Fixed, reviewed replies. They bypass generation entirely. */
export const SAFE_REPLIES = {
  clinical:
    "That's an important question, and it deserves a proper answer from a qualified professional — not from an app. " +
    'CogniTwin is a non-clinical training companion: its scores describe how you did on specific exercises, relative to the exercises themselves, ' +
    "and can't say anything about health conditions. If something about your thinking or memory worries you, a doctor or other qualified professional is the right person to talk to. " +
    'I can still help you understand your profile or plan your practice.',
  distress:
    "I'm really sorry you're going through this. You deserve support from a person right now. " +
    'Please reach out to someone you trust, or contact your local emergency services (in Tunisia you can call 190 for SAMU or 197 for police; elsewhere, your local emergency number). ' +
    "I'm a training companion and not able to help with this the way a person can — but you don't have to handle it alone.",
};
