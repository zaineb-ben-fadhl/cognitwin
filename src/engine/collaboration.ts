/**
 * AI Collaboration Score (ACS, 0–100) — how effectively the user works WITH the AI.
 *
 * ACS = Σ_k W_k · S_k  over k ∈ {clarification, verification, iteration, autonomy, responsible}
 *
 * Each sub-score S_k is the posterior mean of a Beta-Bernoulli model over observed
 * "opportunities" i, each with an outcome x_i ∈ [0,1] and an evidence weight w_i:
 *
 *   S_k = 100 · (α + Σ w_i x_i) / (α + β + Σ w_i),   α = β = 2  (neutral prior = 50)
 *
 * The prior keeps a new user at a neutral 50 with a wide interval instead of jumping to
 * extremes after one click. Uncertainty is propagated: Var(ACS) = Σ W_k² Var(S_k).
 * Default weights follow the challenge proposal (20/25/20/20/15) and are user-configurable,
 * because they are a design proposal, not a validated standard.
 */
import { Z80, clamp } from './stats';

export type CollabDimension = 'clarification' | 'verification' | 'iteration' | 'autonomy' | 'responsible';

export const COLLAB_DIMENSIONS: CollabDimension[] = ['clarification', 'verification', 'iteration', 'autonomy', 'responsible'];

export const DEFAULT_ACS_WEIGHTS: Record<CollabDimension, number> = {
  clarification: 0.2,
  verification: 0.25,
  iteration: 0.2,
  autonomy: 0.2,
  responsible: 0.15,
};

export const COLLAB_LABEL: Record<CollabDimension, string> = {
  clarification: 'Clarification',
  verification: 'Critical verification',
  iteration: 'Iteration',
  autonomy: 'Autonomy',
  responsible: 'Responsible use',
};

export const COLLAB_DESCRIPTION: Record<CollabDimension, string> = {
  clarification: 'Asking precise questions and asking "why" — especially when the AI is unsure.',
  verification: 'Checking AI claims against the evidence instead of accepting them blindly.',
  iteration: 'Refining requests and adapting AI suggestions rather than taking or leaving them wholesale.',
  autonomy: 'Staying in the driver’s seat: own goals, accurate self-predictions, limited hint reliance.',
  responsible: 'Informed consent, privacy care, respecting the non-clinical scope, honest effort.',
};

export type AIEventType =
  | 'coach_message'
  | 'why_opened'
  | 'chat_question'
  | 'followup'
  | 'claim_rated'
  | 'verify_challenge'
  | 'recommendation_response'
  | 'plan_edited'
  | 'retry_after_feedback'
  | 'session_completed'
  | 'goal_self_set'
  | 'goal_from_ai'
  | 'self_prediction'
  | 'override_with_reason'
  | 'clinical_query'
  | 'pii_shared'
  | 'break_suggested'
  | 'privacy_reviewed'
  | 'consent_informed'
  | 'random_responding'
  | 'pushback'
  | 'rush_check_answered'
  | 'strategy_reflection';

export interface AIEvent {
  id: string;
  type: AIEventType;
  at: number;
  data?: Record<string, number | string | boolean>;
}

export interface Opportunity {
  dim: CollabDimension;
  x: number;
  w: number;
  label: string;
  at: number;
}

const conf = (e: AIEvent) => String(e.data?.confidence ?? 'moderate');

/** Map one logged event to zero or more scored opportunities. Documented in docs/COLLABORATION_SCORE.md. */
export function opportunitiesFor(e: AIEvent): Opportunity[] {
  const d = e.data ?? {};
  const o = (dim: CollabDimension, x: number, w: number, label: string): Opportunity => ({ dim, x: clamp(x, 0, 1), w, label, at: e.at });
  switch (e.type) {
    case 'why_opened':
      return [o('clarification', 1, 0.7, 'Opened the "why" behind a recommendation'), o('verification', 1, 0.4, 'Looked at the evidence')];
    case 'chat_question': {
      const clarifying = d.clarifying === true;
      const spec = Number(d.specificity ?? 0.5);
      return [o('clarification', 0.4 + 0.3 * (clarifying ? 1 : 0) + 0.3 * spec, 1, clarifying ? 'Asked a clarifying question' : 'Asked the coach a question')];
    }
    case 'followup':
      return [o('iteration', 1, 0.8, 'Followed up to refine an answer')];
    case 'claim_rated': {
      const justified = d.justified === true;
      return [o('verification', justified ? 1 : 0.3, 1, justified ? 'Judged an AI claim correctly' : 'Misjudged an AI claim')];
    }
    case 'verify_challenge':
      return [o('verification', d.found === true ? 1 : 0, 1.5, d.found === true ? 'Spotted the flawed AI statement' : 'Missed the flawed AI statement')];
    case 'recommendation_response': {
      const r = String(d.response);
      const viewed = d.evidenceViewed === true;
      const out: Opportunity[] = [];
      if (r === 'modified') out.push(o('iteration', 1, 1, 'Adapted an AI suggestion'));
      if (r === 'rejected') out.push(o('autonomy', d.reason ? 1 : 0.6, 0.8, d.reason ? 'Declined a suggestion with a reason' : 'Declined a suggestion'));
      if (r === 'rejected' && !viewed && !d.reason) out.push(o('verification', 0.3, 0.5, 'Dismissed a suggestion without looking at why'));
      // Weak evidence: taking AI output as-is is fine, but iteration means refining it sometimes.
      if (r === 'accepted') out.push(o('iteration', 0.45, 0.25, 'Took a suggestion as-is'));
      if (r === 'accepted' && conf(e) === 'low' && !viewed) {
        out.push(o('verification', 0, 1, 'Accepted a low-confidence suggestion without checking'));
        out.push(o('clarification', 0, 0.6, 'Did not ask why on an uncertain suggestion'));
      } else if (viewed) out.push(o('verification', 1, 0.7, 'Checked the evidence before deciding'));
      else if (r === 'accepted') out.push(o('verification', 0.6, 0.3, 'Accepted a well-supported suggestion'));
      return out;
    }
    case 'plan_edited':
      return [o('iteration', 1, 1, 'Edited the AI-generated plan')];
    case 'retry_after_feedback':
      return [o('iteration', 1, 0.8, 'Retried after coaching feedback')];
    case 'session_completed': {
      const hints = Number(d.hints ?? 0);
      // A careless session earns no autonomy credit: independence only counts with genuine effort.
      if (d.reliability === 'poor') return [o('responsible', 0.2, 0.5, 'Session too noisy to count fully')];
      const out: Opportunity[] = [];
      // Hint reliance only counts where hints exist (Pattern Logic).
      if (d.hintsAvailable === true) out.push(o('autonomy', 1 - Math.min(1, hints / 3), 0.4, hints ? `Used ${hints} hint${hints > 1 ? 's' : ''}` : 'Solved without hints'));
      if (d.reliability === 'good') out.push(o('responsible', 1, 0.1, 'Honest, focused effort'));
      return out;
    }
    case 'goal_self_set':
      return [o('autonomy', 1, 1, 'Set an own goal')];
    case 'goal_from_ai':
      return [o('autonomy', 0.5, 0.5, 'Adopted a goal suggested by the AI')];
    case 'self_prediction': {
      const err = Math.abs(Number(d.predicted) - Number(d.actual));
      return [o('autonomy', 1 - err / 40, 1, `Self-prediction off by ${Math.round(err)} pts`)];
    }
    case 'override_with_reason':
      return [o('autonomy', 1, 1, 'Overrode the plan with a reason')];
    case 'clinical_query':
      return [o('responsible', d.acceptedRedirect === false ? 0.2 : 0.8, 1, d.acceptedRedirect === false ? 'Insisted on a clinical judgement' : 'Accepted the non-clinical scope')];
    case 'pii_shared':
      return [o('responsible', 0, 1, 'Shared personal identifiers in chat')];
    case 'break_suggested':
      return [o('responsible', d.taken === true ? 1 : 0.4, 0.7, d.taken === true ? 'Took a suggested break' : 'Skipped a suggested break')];
    case 'privacy_reviewed':
      return [o('responsible', 1, 0.5, 'Reviewed privacy settings')];
    case 'consent_informed':
      return [o('responsible', 1, 1, 'Read the consent details')];
    case 'random_responding':
      return [o('responsible', 0, 1, 'Random pressing detected')];
    case 'pushback': {
      // Disagreeing with the AI is rewarded, not punished — but repeated disputes earn less.
      const decay = 1 / (1 + 0.5 * Math.max(0, Number(d.nth ?? 0)));
      if (d.repeat === true) return [o('verification', 0.6, 0.2, 'Re-raised a disputed session')];
      if (!d.reason || d.reason === 'none') return [o('verification', 0.7, 0.6 * decay, 'Questioned an AI conclusion')];
      return [
        // As strong as finding the flaw in "Verify the coach": an explicit, reasoned challenge.
        o('verification', 1, 2 * decay, 'Challenged an AI conclusion with a concrete reason'),
        o('iteration', 1, 1.5 * decay, 'Gave context so the AI could revise the profile'),
      ];
    }
    case 'rush_check_answered':
      // Honest self-report after a rushed session is responsible use; "that's my real level" is neutral.
      return [o('responsible', d.answer === 'genuine' ? 0.5 : 1, 0.5, d.answer === 'genuine' ? 'Answered the rushing check-in' : 'Honestly explained a rushed session')];
    case 'strategy_reflection':
      return [o('iteration', 1, 0.6, 'Reflected on a new strategy'), o('autonomy', 1, 0.3, 'Judged own strategy use')];
    case 'coach_message':
      // Weak "missed opportunity" evidence: an AI recommendation the user never questioned.
      // Cancelled out as soon as the user opens the why, asks or follows up.
      return d.engaged === true ? [] : [o('clarification', 0.4, 0.15, 'Read a recommendation without follow-up')];
  }
}

export interface SubScore {
  dim: CollabDimension;
  score: number;
  sd: number;
  evidence: number;
  opportunities: Opportunity[];
}

export interface CollabScore {
  total: number;
  lo: number;
  hi: number;
  sd: number;
  weights: Record<CollabDimension, number>;
  subs: SubScore[];
  /** Total evidence weight observed. */
  evidence: number;
  confidence: 'low' | 'moderate' | 'high';
}

const PRIOR_A = 2;
const PRIOR_B = 2;

export function normaliseWeights(w: Record<CollabDimension, number>): Record<CollabDimension, number> {
  const total = COLLAB_DIMENSIONS.reduce((s, k) => s + Math.max(0, w[k] ?? 0), 0);
  if (total <= 0) return { ...DEFAULT_ACS_WEIGHTS };
  return Object.fromEntries(COLLAB_DIMENSIONS.map((k) => [k, Math.max(0, w[k] ?? 0) / total])) as Record<CollabDimension, number>;
}

export function computeCollabScore(
  events: readonly AIEvent[],
  weights: Record<CollabDimension, number> = DEFAULT_ACS_WEIGHTS,
  until = Infinity,
): CollabScore {
  const W = normaliseWeights(weights);
  const opps = events.filter((e) => e.at <= until).flatMap(opportunitiesFor);
  const subs: SubScore[] = COLLAB_DIMENSIONS.map((dim) => {
    const mine = opps.filter((o) => o.dim === dim);
    const a = PRIOR_A + mine.reduce((s, o) => s + o.w * o.x, 0);
    const b = PRIOR_B + mine.reduce((s, o) => s + o.w * (1 - o.x), 0);
    const variance = (a * b) / ((a + b) ** 2 * (a + b + 1));
    return {
      dim,
      score: (100 * a) / (a + b),
      sd: 100 * Math.sqrt(variance),
      evidence: mine.reduce((s, o) => s + o.w, 0),
      opportunities: mine,
    };
  });
  const total = subs.reduce((s, x) => s + W[x.dim] * x.score, 0);
  const sd = Math.sqrt(subs.reduce((s, x) => s + W[x.dim] ** 2 * x.sd ** 2, 0));
  const evidence = subs.reduce((s, x) => s + x.evidence, 0);
  return {
    total,
    sd,
    lo: clamp(total - Z80 * sd, 0, 100),
    hi: clamp(total + Z80 * sd, 0, 100),
    weights: W,
    subs,
    evidence,
    confidence: sd <= 6 ? 'high' : sd <= 10 ? 'moderate' : 'low',
  };
}

/** How much the total moves under alternative, equally plausible weightings. */
export function weightSensitivity(events: readonly AIEvent[]): { label: string; total: number }[] {
  const equal = Object.fromEntries(COLLAB_DIMENSIONS.map((k) => [k, 0.2])) as Record<CollabDimension, number>;
  const out = [
    { label: 'Proposed weights (20/25/20/20/15)', total: computeCollabScore(events, DEFAULT_ACS_WEIGHTS).total },
    { label: 'Equal weights', total: computeCollabScore(events, equal).total },
  ];
  for (const k of COLLAB_DIMENSIONS) {
    const w = { ...DEFAULT_ACS_WEIGHTS, [k]: DEFAULT_ACS_WEIGHTS[k] + 0.1 };
    out.push({ label: `+10 pts on ${COLLAB_LABEL[k]}`, total: computeCollabScore(events, w).total });
  }
  return out;
}

/** Daily ACS trajectory (end-of-day values). */
export function collabHistory(events: readonly AIEvent[], weights = DEFAULT_ACS_WEIGHTS): { at: number; total: number; lo: number; hi: number }[] {
  if (!events.length) return [];
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const days = new Map<string, number>();
  for (const e of sorted) {
    const d = new Date(e.at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    days.set(key, new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).getTime());
  }
  return [...days.values()].map((end) => {
    const s = computeCollabScore(sorted, weights, end);
    return { at: end, total: s.total, lo: s.lo, hi: s.hi };
  });
}

// --- Light-weight text features for chat messages (no external NLP, fully explainable) -------

const CLARIFY_PATTERNS = [/\bwhy\b/i, /\bhow (do|does|did|is|are|come|can)\b/i, /\bwhat (does|do|is) .*mean/i, /\bexplain\b/i, /\bclarif/i, /\bevidence\b/i, /\bsure\b/i, /\bhow confident\b/i, /\bbased on\b/i, /\bsource\b/i];

export function isClarifying(text: string): boolean {
  return CLARIFY_PATTERNS.some((p) => p.test(text));
}

/** 0–1: mentions a concrete dimension/metric/time-frame and is not trivially short. */
export function specificity(text: string, dimensionWords: string[]): number {
  const t = text.toLowerCase();
  let s = 0;
  if (t.split(/\s+/).length >= 6) s += 0.35;
  if (dimensionWords.some((w) => t.includes(w))) s += 0.35;
  if (/\b(\d+|week|today|yesterday|month|session|level|score|goal|%)\b/.test(t)) s += 0.3;
  return clamp(s, 0, 1);
}
