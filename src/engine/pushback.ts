/**
 * Pushback: the user disagrees with the AI's reading of a session ("I was distracted").
 *
 * The coach does not defend the profile. It treats the user's context as new evidence:
 * the contested session keeps its data but counts half as much, and its posterior gets extra
 * variance, so the twin becomes *less certain* about that dimension and schedules a re-check.
 * Pushing back with a concrete reason is rewarded in the AI Collaboration Score (critical
 * verification + iteration), with diminishing credit for repeated disputes so it cannot be
 * farmed. Disputes are reversible.
 */
import { computeCollabScore, type AIEvent, type CollabDimension, type CollabScore } from './collaboration';
import { getDimension } from './dimensions';
import { localDate } from './planner';
import { scoreSummary } from './irt';
import { replaySessions } from './session';
import { currentProfile, modelFor } from './twin';
import type { DimensionId, DisputeReason, ScoreSummary, SessionDispute, SessionRecord, TwinState } from './types';

const DAY = 86_400_000;
export const DISPUTE_WEIGHT_FACTOR = 0.5;
export const DISPUTE_VARIANCE = 0.12;
/** Only recent sessions can be disputed from chat (older ones from the session log). */
export const DISPUTE_WINDOW_DAYS = 7;

export const DISPUTE_LABEL: Record<DisputeReason, string> = {
  distraction: 'environmental distraction',
  noise: 'noise around you',
  interruption: 'an interruption',
  device: 'a device or connection problem',
  fatigue: 'tiredness',
  unwell: 'not feeling well',
  rushing: 'rushing through it',
  other: 'circumstances the data cannot see',
};

const DISAGREE_RE =
  /\b(i (strongly )?disagree|disagree|i don'?t (agree|think so|buy (it|that))|not (true|right|fair|accurate|correct|representative)|that'?s (wrong|not (right|true|fair|me))|you'?re wrong|you are wrong|wrong (about|conclusion)|(does|did)n'?t (reflect|represent|show) (me|my)|not my (real|true|actual|normal) (level|score|ability|performance)|unfair|incorrect|inaccurate|mistaken|i object)\b/i;

const CONTEXT_RE: Array<[DisputeReason, RegExp]> = [
  ['noise', /\b(nois[ey]\w*|loud|music|construction|neighbou?rs?|barking|shouting)\b/i],
  ['interruption', /\b(interrupt\w*|phone (rang|call)|(got|had|took) a (phone )?call|someone (came|walked|knocked|called|talked)|notifications?|doorbell)\b/i],
  ['distraction', /\b(distract\w*|environment\w*|surroundings|couldn'?t (focus|concentrate)|(was|wasn'?t|were|not) (really )?focus(ed)?|kids?|children|crowded|busy (room|place|office)|caf[eé]|on the (bus|train|metro))\b/i],
  ['device', /\b(lag\w*|bad (internet|connection|wifi|wi-fi|mouse|keyboard|screen)|touch ?pad|trackpad|mouse (broke|died|was)|slow (laptop|computer|pc|phone)|battery|glitch\w*)\b/i],
  ['fatigue', /\b(tired|exhausted|sleepy|no sleep|didn'?t sleep|late at night|fatigued?)\b/i],
  ['unwell', /\b(sick|ill|headache|migraine|unwell|fever|had a cold)\b/i],
  ['rushing', /\b(rush(ed|ing)?|hurr(y|ied)|clicked randomly|just clicking|random(ly)? (click|press)\w*|button mash\w*|testing the app|wasn'?t (even )?trying)\b/i],
];

const PERFORMANCE_RE = /\b(poor|bad|badly|low|lower|drop\w*|fell|worse|performance|perform\w*|scor\w*|results?|session|test|check-?in|exercise|assessment|estimate|profile|did)\b/i;
const CAUSAL_RE = /\b(because|due to|cause[ds]?|since|blame|that'?s why|reason|was|were)\b/i;

export interface PushbackSignal {
  pushback: boolean;
  disagreement: boolean;
  /** Reason, when the message is a pushback. */
  reason: DisputeReason | null;
  /** Context mentioned, even if the message alone is not a pushback (used for follow-ups). */
  context: DisputeReason | null;
}

export function detectPushback(text: string): PushbackSignal {
  const disagreement = DISAGREE_RE.test(text);
  const reason = CONTEXT_RE.find(([, re]) => re.test(text))?.[0] ?? null;
  const pushback = disagreement || (reason !== null && PERFORMANCE_RE.test(text) && CAUSAL_RE.test(text));
  return { pushback, disagreement, reason: pushback ? reason : null, context: reason };
}

/** The session a chat pushback most plausibly refers to. */
export function pickDisputedSession(sessions: readonly SessionRecord[], now: number, dimension?: DimensionId): SessionRecord | undefined {
  const recent = [...sessions].filter((s) => s.endedAt > now - DISPUTE_WINDOW_DAYS * DAY).sort((a, b) => b.endedAt - a.endedAt);
  if (dimension) return recent.find((s) => s.dimension === dimension);
  const lastDay = recent.length ? localDate(recent[0].endedAt) : null;
  // Prefer the most recent session whose estimate went down, within the latest practice day.
  return recent.find((s) => localDate(s.endedAt) === lastDay && s.scoreAfter.score < s.scoreBefore.score - 1) ?? recent[0];
}

export function makeDispute(reason: DisputeReason, at: number, source: SessionDispute['source'], note?: string): SessionDispute {
  return { at, reason, weightFactor: DISPUTE_WEIGHT_FACTOR, varianceAdded: DISPUTE_VARIANCE, source, ...(note ? { note: note.slice(0, 200) } : {}) };
}

export interface DisputeOutcome {
  session: SessionRecord;
  dimension: DimensionId;
  reason: DisputeReason;
  before: ScoreSummary;
  after: ScoreSummary;
  weightBefore: number;
  weightAfter: number;
  acsBefore: CollabScore;
  acsAfter: CollabScore;
  /** Disputes logged in the last 7 days before this one (diminishing credit). */
  recentDisputes: number;
  /** Logged interactions behind the score (explains why one challenge moves a long history little). */
  interactions: number;
  alreadyDisputed: boolean;
}

export interface DisputeResult {
  twin: TwinState;
  sessions: SessionRecord[];
  event: AIEvent;
  outcome: DisputeOutcome;
}

/** Pure: apply a dispute, rebuild the twin and compute the before/after numbers the coach will cite. */
export function applyDispute(
  state: { twin: TwinState; sessions: readonly SessionRecord[]; events: readonly AIEvent[]; weights?: Record<CollabDimension, number> },
  sessionId: string,
  dispute: SessionDispute,
  eventId: string,
): DisputeResult | null {
  const target = state.sessions.find((s) => s.id === sessionId);
  if (!target) return null;
  const now = dispute.at;
  const dim = target.dimension;
  const before = currentProfile(state.twin, now).find((p) => p.id === dim)!.summary;
  const acsBefore = computeCollabScore(state.events, state.weights);
  const recentDisputes = state.events.filter((e) => e.type === 'pushback' && e.at > now - 7 * DAY && e.data?.reason !== 'none').length;
  const alreadyDisputed = !!target.dispute;
  const updated = alreadyDisputed ? state.sessions : state.sessions.map((s) => (s.id === sessionId ? { ...s, dispute } : s));
  const rebuilt = alreadyDisputed ? { twin: state.twin, sessions: [...state.sessions] } : replaySessions(updated, state.twin.createdAt);
  const event: AIEvent = {
    id: eventId,
    type: 'pushback',
    at: now,
    data: { reason: dispute.reason, sessionId, nth: recentDisputes, repeat: alreadyDisputed, source: dispute.source },
  };
  const acsAfter = computeCollabScore([...state.events, event], state.weights);
  const after = currentProfile(rebuilt.twin, now).find((p) => p.id === dim)!.summary;
  const session = rebuilt.sessions.find((s) => s.id === sessionId)!;
  return {
    twin: { ...rebuilt.twin, dims: { ...state.twin.dims, ...rebuilt.twin.dims } },
    sessions: rebuilt.sessions,
    event,
    outcome: {
      session,
      dimension: dim,
      reason: dispute.reason,
      before,
      after,
      weightBefore: target.quality.weight * (target.dispute?.weightFactor ?? 1),
      weightAfter: session.quality.weight * (session.dispute?.weightFactor ?? 1),
      acsBefore,
      acsAfter,
      recentDisputes,
      alreadyDisputed,
      interactions: state.events.length + 1,
    },
  };
}

/** Undo a dispute (the event stays: the user did push back). */
export function removeDispute(state: { twin: TwinState; sessions: readonly SessionRecord[] }, sessionId: string): { twin: TwinState; sessions: SessionRecord[] } {
  const updated = state.sessions.map((s) => {
    if (s.id !== sessionId || !s.dispute) return s;
    const { dispute: _removed, ...rest } = s;
    void _removed;
    return rest as SessionRecord;
  });
  return replaySessions(updated, state.twin.createdAt);
}

const fmtDay = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
const pct = (w: number) => `${Math.round(w * 100)} %`;
const r0 = (x: number) => Math.round(x);
const r1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

/** Score summary of a session's stored posterior (helper for the UI). */
export const sessionScore = (s: SessionRecord) => scoreSummary(s.after, modelFor(s.dimension));

export function describeOutcome(o: DisputeOutcome): { text: string; numbers: Record<string, number> } {
  const d = getDimension(o.dimension);
  const sub = (c: CollabScore, k: CollabDimension) => r1(c.subs.find((s) => s.dim === k)!.score);
  const what = `${d.task.name} ${o.session.mode === 'assessment' ? 'check-in' : 'session'} of ${fmtDay(o.session.endedAt)}`;
  if (o.alreadyDisputed) {
    return {
      text: `You already disputed your ${what}, so it already counts ${pct(o.weightAfter)} and its uncertainty is already widened: ${d.short} reads ${r0(o.after.score)} % (80 % interval ${r0(o.after.lo)}–${r0(o.after.hi)}). The best way to settle it now is a calm re-check.`,
      numbers: {},
    };
  }
  const text =
    `I've marked your ${what} as disputed (${DISPUTE_LABEL[o.reason]}). Instead of defending the old estimate, I cut that session's weight from ${pct(o.weightBefore)} to ${pct(o.weightAfter)} and widened its uncertainty: ` +
    `${d.short} now reads ${r0(o.after.score)} % with an 80 % interval of ${r0(o.after.lo)}–${r0(o.after.hi)} (it was ${r0(o.before.score)} %, ${r0(o.before.lo)}–${r0(o.before.hi)}). ` +
    `Your AI Collaboration Score went from ${r1(o.acsBefore.total)} to ${r1(o.acsAfter.total)} (critical verification ${sub(o.acsBefore, 'verification')} → ${sub(o.acsAfter, 'verification')}, iteration ${sub(o.acsBefore, 'iteration')} → ${sub(o.acsAfter, 'iteration')}).` +
    (o.interactions > 60 && o.acsAfter.total - o.acsBefore.total < 2
      ? ` It moves a little because it is one reasoned challenge among ${o.interactions} logged interactions — by design, no single click can swing it.`
      : '') +
    (o.recentDisputes >= 2 ? ` You've disputed ${o.recentDisputes} other sessions this week, so this one earns less credit — a calm re-check settles things better than more disputes.` : '');
  return { text, numbers: {} };
}
