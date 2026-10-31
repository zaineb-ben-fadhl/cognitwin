/**
 * Adaptive learning plan — transparent multi-criteria utility.
 *
 * Each dimension gets a utility = Σ weight × feature (all features normalised to 0–1). The
 * top dimensions fill today's time budget. Every item carries its reasons (feature value,
 * weight, contribution and a sentence), so the plan is explainable line by line, and every
 * new plan is diffed against the previous one so the user sees *why* it evolved.
 */
import { TARGET_SUCCESS, type ChallengePreference } from './adaptive';
import { getDimension, taskForDimension } from './dimensions';
import { levelForSuccess } from './irt';
import { uid } from './rng';
import { clamp } from './stats';
import { currentProfile, dimensionHistory, type DimensionProfile } from './twin';
import type { DailyPlan, DimensionId, Goal, PlanItem, PlanReason, SessionMode, SessionRecord, TwinState } from './types';
import type { AnyTaskSpec } from './tasks/types';

const DAY = 86_400_000;

export const PLAN_WEIGHTS: Record<Exclude<PlanReason['factor'], 'fatigue'>, number> = {
  gap: 0.25,
  uncertainty: 0.2,
  goal: 0.25,
  spacing: 0.15,
  momentum: 0.05,
  variety: 0.05,
  preference: 0.05,
};
/** Penalty subtracted when a dimension was already practised twice today. */
export const FATIGUE_PENALTY = 0.3;
/** Above this normalised uncertainty, the next session on the dimension is an assessment. */
export const ASSESS_UNCERTAINTY = 0.6;

export interface PlannerPrefs {
  dailyMinutes: number;
  challenge: ChallengePreference;
  /** Dimensions the user asked to emphasise. */
  focus: DimensionId[];
}

export const DEFAULT_PREFS: PlannerPrefs = { dailyMinutes: 10, challenge: 'balanced', focus: [] };

export function localDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function estimateMinutes(task: AnyTaskSpec, mode: SessionMode): number {
  const trials = mode === 'assessment' ? Math.round((task.assessment.minTrials + task.assessment.maxTrials) / 2) : task.trainingTrials;
  const perTrialMs = task.sim.baseRtMs + task.sim.rtPerLevelMs * 4 + 1100 + (task.dimension === 'memory' ? 5000 : 0);
  return Math.max(1, Math.round(((trials * perTrialMs) / 60000) * 2) / 2 + 0.5);
}

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

interface Context {
  now: number;
  sessions: readonly SessionRecord[];
  goals: readonly Goal[];
  prefs: PlannerPrefs;
  twin: TwinState;
}

export function scoreDimension(p: DimensionProfile, ctx: Context): { utility: number; reasons: PlanReason[]; mode: SessionMode } {
  const today = localDate(ctx.now);
  const dimSessions = ctx.sessions.filter((s) => s.dimension === p.id);
  const todayCount = dimSessions.filter((s) => localDate(s.endedAt) === today).length;
  const width = p.summary.hi - p.summary.lo;
  const goal = ctx.goals.find((g) => !g.archived && !g.achievedAt && g.kind === 'score' && g.dimension === p.id && g.deadline > ctx.now);

  const history = dimensionHistory(ctx.twin, p.id);
  const recent = history.slice(-4);
  const momentumPts = recent.length >= 2 ? recent.at(-1)!.score - recent[0].score : 0;

  const f = {
    gap: p.unmeasured ? 0.5 : clamp(1 - p.summary.score / 100, 0, 1),
    uncertainty: clamp((width - 10) / 40, 0, 1),
    goal: goal ? clamp(0.6 + (goal.target - p.summary.score) / 50, 0.6, 1) : 0,
    spacing: p.daysSinceUpdate === null ? 1 : clamp(p.daysSinceUpdate / 4, 0, 1),
    momentum: clamp(momentumPts / 10, 0, 1),
    variety: todayCount === 0 ? 1 : 0,
    preference: ctx.prefs.focus.includes(p.id) ? 1 : 0,
  };
  const short = getDimension(p.id).short;
  const text: Record<keyof typeof f, string> = {
    gap: p.unmeasured ? `${short} has not been measured yet` : `${short} at ${Math.round(p.summary.score)} % — room to grow`,
    uncertainty: `Profile still uncertain (±${Math.round(width / 2)} pts) — more data will sharpen it`,
    goal: goal ? `Linked to your goal: ${goal.target} % by ${fmtDate(goal.deadline)}` : '',
    spacing:
      p.daysSinceUpdate === null
        ? 'Never practised — a first session adds the most information'
        : `Last practised ${Math.round(p.daysSinceUpdate)} day${Math.round(p.daysSinceUpdate) === 1 ? '' : 's'} ago — spacing helps skills settle`,
    momentum: `Improving lately (+${Math.round(momentumPts)} pts) — keep the momentum`,
    variety: 'Not practised yet today',
    preference: 'You asked to focus on this area',
  };
  const reasons: PlanReason[] = (Object.keys(f) as Array<keyof typeof f>)
    .map((k) => ({ factor: k, value: f[k], weight: PLAN_WEIGHTS[k], contribution: f[k] * PLAN_WEIGHTS[k], text: text[k] }))
    .filter((r) => r.contribution > 0.005);
  let utility = reasons.reduce((s, r) => s + r.contribution, 0);
  if (todayCount >= 2) {
    utility -= FATIGUE_PENALTY;
    reasons.push({
      factor: 'fatigue',
      value: 1,
      weight: -FATIGUE_PENALTY,
      contribution: -FATIGUE_PENALTY,
      text: `Already practised ${todayCount}× today — rotating to protect focus`,
    });
  }
  reasons.sort((a, b) => b.contribution - a.contribution);
  const mode: SessionMode = p.unmeasured || f.uncertainty > ASSESS_UNCERTAINTY ? 'assessment' : 'training';
  return { utility, reasons, mode };
}

export function generateDailyPlan(
  twin: TwinState,
  sessions: readonly SessionRecord[],
  goals: readonly Goal[],
  prefs: PlannerPrefs,
  now: number,
  previous?: DailyPlan,
): DailyPlan {
  const ctx: Context = { now, sessions, goals, prefs, twin };
  const profile = currentProfile(twin, now);
  const scored = profile
    .map((p) => ({ p, ...scoreDimension(p, ctx) }))
    .sort((a, b) => b.utility - a.utility);

  const items: PlanItem[] = [];
  let minutes = 0;
  for (const s of scored) {
    if (items.length && minutes >= prefs.dailyMinutes) break;
    if (items.length >= 4) break;
    const item = createPlanItem(s.p, ctx);
    const m = item.minutes;
    if (items.length && minutes + m > prefs.dailyMinutes + 1.5) continue;
    items.push(item);
    minutes += m;
  }

  const names = items.map((i) => getDimension(i.dimension).short);
  const assess = items.filter((i) => i.mode === 'assessment').length;
  const rationale =
    `${items.length} activit${items.length === 1 ? 'y' : 'ies'}, about ${Math.round(minutes)} min: ${names.join(', ')}. ` +
    `Top priority: ${names[0]} — ${lowerFirst(items[0].reasons[0]?.text ?? 'highest utility')}.` +
    (assess ? ` Includes ${assess} short check-in${assess > 1 ? 's' : ''} to sharpen uncertain parts of your profile.` : '');

  return {
    id: uid('plan_'),
    date: localDate(now),
    generatedAt: now,
    items,
    rationale,
    changes: previous ? diffPlans(previous, items) : [],
  };
}

/** Build any requested activity, including dimensions outside the daily top four. */
export function createPlanItem(p: DimensionProfile, ctx: Context): PlanItem {
  const { mode, utility, reasons } = scoreDimension(p, ctx);
  const task = taskForDimension(p.id);
  return {
    id: uid('pi_'), dimension: p.id, taskId: task.id, mode,
    level: mode === 'assessment' ? 0 : levelForSuccess(p.belief, TARGET_SUCCESS[ctx.prefs.challenge], task),
    minutes: estimateMinutes(task, mode), utility: Math.round(utility * 1000) / 1000, reasons,
  };
}

export function diffPlans(previous: DailyPlan, next: PlanItem[]): string[] {
  const changes: string[] = [];
  const prevDims = new Map(previous.items.map((i) => [i.dimension, i]));
  const nextDims = new Map(next.map((i) => [i.dimension, i]));
  for (const item of next) {
    const before = prevDims.get(item.dimension);
    const name = getDimension(item.dimension).short;
    if (!before) changes.push(`Added ${name}: ${item.reasons[0]?.text ?? 'highest priority now'}.`);
    else if (before.mode !== item.mode)
      changes.push(
        item.mode === 'training'
          ? `${name} switched from check-in to training — the profile is now confident enough to train at the right level.`
          : `${name} switched to a check-in — its estimate became uncertain again.`,
      );
    else if (item.mode === 'training' && before.level !== item.level && before.level > 0)
      changes.push(`${name} level ${before.level} → ${item.level} to keep you near your target success rate.`);
  }
  for (const item of previous.items) {
    if (!nextDims.has(item.dimension)) {
      changes.push(`${getDimension(item.dimension).short} left the plan${item.done ? ' (done today)' : ''}.`);
    }
  }
  return changes;
}

/** Goals: measurable progress and a weekly milestone path. */
export interface Milestone {
  weekStart: number;
  target: number;
  actual: number | null;
}

export function milestones(goal: Goal, startScore: number, history: { at: number; score: number }[]): Milestone[] {
  if (goal.kind !== 'score') return [];
  const weeks = Math.max(1, Math.ceil((goal.deadline - goal.createdAt) / (7 * DAY)));
  const out: Milestone[] = [];
  for (let w = 1; w <= weeks; w++) {
    const weekStart = goal.createdAt + (w - 1) * 7 * DAY;
    const weekEnd = weekStart + 7 * DAY;
    const inWeek = history.filter((h) => h.at >= weekStart && h.at < weekEnd);
    out.push({
      weekStart,
      target: startScore + ((goal.target - startScore) * w) / weeks,
      actual: inWeek.length ? inWeek.at(-1)!.score : null,
    });
  }
  return out;
}
