/**
 * Adaptive learning plan — transparent multi-criteria utility.
 *
 * Each dimension gets a utility = Σ weight × feature (all features normalised to 0–1). The
 * top dimensions fill today's time budget. Every item carries its reasons (feature value,
 * weight, contribution and a sentence), so the plan is explainable line by line, and every
 * new plan is diffed against the previous one so the user sees *why* it evolved.
 */
import { STRETCH_FORMAT_TARGET, type ChallengePreference } from './adaptive';
import { getDimension, taskForDimension } from './dimensions';
import { TRAINING_FORMATS, detectPlateau, nextFormat, nextStrategy, type PlateauStatus } from './formats';
import { levelForSuccess } from './irt';
import { TIER_LABEL, detectAsymmetry, tierFor, tierTarget, type Asymmetry } from './tiers';
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
  plateau: 0.1,
  asymmetry: 0.1,
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
  /** Profile-level analysis, computed once per plan (derived on demand when absent). */
  asymmetry?: Asymmetry | null;
}

function asymmetryOf(ctx: Context): Asymmetry | null {
  if (ctx.asymmetry === undefined) ctx.asymmetry = detectAsymmetry(currentProfile(ctx.twin, ctx.now));
  return ctx.asymmetry;
}

export function scoreDimension(p: DimensionProfile, ctx: Context): { utility: number; reasons: PlanReason[]; mode: SessionMode; plateau: PlateauStatus | null } {
  const today = localDate(ctx.now);
  const dimSessions = ctx.sessions.filter((s) => s.dimension === p.id);
  const todayCount = dimSessions.filter((s) => localDate(s.endedAt) === today).length;
  const width = p.summary.hi - p.summary.lo;
  const goal = ctx.goals.find((g) => !g.archived && !g.achievedAt && g.kind === 'score' && g.dimension === p.id && g.deadline > ctx.now);

  const history = dimensionHistory(ctx.twin, p.id);
  const recent = history.slice(-4);
  const momentumPts = recent.length >= 2 ? recent.at(-1)!.score - recent[0].score : 0;
  const plateau = p.unmeasured ? null : detectPlateau(ctx.twin, ctx.sessions, p.id);
  const asym = asymmetryOf(ctx);
  const asymRole = asym?.strong === p.id ? 'strong' : asym?.weak === p.id ? 'weak' : null;

  const f = {
    gap: p.unmeasured ? 0.5 : clamp(1 - p.summary.score / 100, 0, 1),
    uncertainty: clamp((width - 10) / 40, 0, 1),
    goal: goal ? clamp(0.6 + (goal.target - p.summary.score) / 50, 0.6, 1) : 0,
    spacing: p.daysSinceUpdate === null ? 1 : clamp(p.daysSinceUpdate / 4, 0, 1),
    momentum: clamp(momentumPts / 10, 0, 1),
    variety: todayCount === 0 ? 1 : 0,
    preference: ctx.prefs.focus.includes(p.id) ? 1 : 0,
    plateau: plateau ? 1 : 0,
    asymmetry: asymRole ? 1 : 0,
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
    plateau: plateau
      ? `Plateau: ${short} has stayed within ${Math.round(plateau.range)} pts over ${plateau.sessions} sessions (trend ${plateau.slope >= 0 ? '+' : ''}${plateau.slope.toFixed(1)} pts/session) — changing the format`
      : '',
    asymmetry:
      asymRole === 'strong'
        ? `Your strongest area (${asym!.strongScore} %) — advanced work so it keeps stretching instead of coasting`
        : asymRole === 'weak'
          ? `Your lowest area (${asym!.weakScore} %) — foundational steps first, at its own level`
          : '',
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
  return { utility, reasons, mode, plateau };
}

export function generateDailyPlan(
  twin: TwinState,
  sessions: readonly SessionRecord[],
  goals: readonly Goal[],
  prefs: PlannerPrefs,
  now: number,
  previous?: DailyPlan,
): DailyPlan {
  const profile = currentProfile(twin, now);
  const ctx: Context = { now, sessions, goals, prefs, twin, asymmetry: detectAsymmetry(profile) };
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

  // Asymmetric mind: the plan must cover both ends of the split, each at its own difficulty.
  const asym = ctx.asymmetry ?? null;
  if (asym) {
    for (const dim of [asym.strong, asym.weak]) {
      if (items.some((i) => i.dimension === dim)) continue;
      const p = profile.find((x) => x.id === dim)!;
      const item = createPlanItem(p, ctx);
      const keep = asym.strong === dim ? asym.weak : asym.strong;
      if (items.length >= 4) {
        // Replace the lowest-utility item that is not the other end of the split.
        let idx = -1;
        for (let k = items.length - 1; k >= 0; k--) {
          if (items[k].dimension !== keep) {
            idx = k;
            break;
          }
        }
        if (idx < 0) continue;
        minutes -= items[idx].minutes;
        items.splice(idx, 1);
      }
      items.push(item);
      minutes += item.minutes;
    }
  }

  const names = items.map((i) => getDimension(i.dimension).short);
  const assess = items.filter((i) => i.mode === 'assessment').length;
  const formatted = items.filter((i) => i.format && i.format !== 'standard' && i.reasons.some((r) => r.factor === 'plateau'));
  const split = asym ? items.filter((i) => i.dimension === asym.strong || i.dimension === asym.weak) : [];
  const rationale =
    `${items.length} activit${items.length === 1 ? 'y' : 'ies'}, about ${Math.round(minutes)} min: ${names.join(', ')}. ` +
    `Top priority: ${names[0]} — ${lowerFirst(items[0].reasons[0]?.text ?? 'highest utility')}.` +
    (assess ? ` Includes ${assess} short check-in${assess > 1 ? 's' : ''} to sharpen uncertain parts of your profile.` : '') +
    (formatted.length
      ? ` New format${formatted.length > 1 ? 's' : ''} to break a plateau: ${formatted.map((i) => `${getDimension(i.dimension).short} → ${TRAINING_FORMATS[i.format!].name}`).join(', ')}.`
      : '') +
    (split.length
      ? ` Asymmetric profile, so difficulty is set per area, never averaged: ${split
          .map((i) => `${getDimension(i.dimension).short} ${i.mode === 'training' ? `${TIER_LABEL[i.tier ?? 'core'].toLowerCase()} (level ${i.level})` : 'check-in'}`)
          .join(' + ')}.`
      : '');

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
  const { mode, utility, reasons, plateau } = scoreDimension(p, ctx);
  const task = taskForDimension(p.id);
  // Difficulty comes from THIS dimension's estimate and tier — never from a profile average.
  const tier = tierFor(p);
  const item: PlanItem = {
    id: uid('pi_'), dimension: p.id, taskId: task.id, mode,
    level: 0,
    minutes: estimateMinutes(task, mode), utility: Math.round(utility * 1000) / 1000, reasons,
    tier,
  };
  if (mode === 'training') {
    const targetSuccess = tierTarget(ctx.prefs.challenge, tier);
    item.targetSuccess = targetSuccess;
    const asym = asymmetryOf(ctx);
    if (plateau) {
      item.format = nextFormat(ctx.sessions, p.id);
      item.formatNote = `${TRAINING_FORMATS[item.format].name}: ${lowerFirst(TRAINING_FORMATS[item.format].description)} Chosen because the estimate has been flat for ${plateau.sessions} sessions.`;
      if (item.format === 'strategy') item.strategyKey = nextStrategy(ctx.sessions, p.id);
    } else if (asym?.strong === p.id && tier === 'advanced') {
      item.format = 'stretch';
      item.formatNote = `${TRAINING_FORMATS.stretch.name}: your strongest area trains past the comfort zone (about ${Math.round(STRETCH_FORMAT_TARGET * 100)} % success).`;
    }
    const target = item.format === 'stretch' ? Math.min(targetSuccess, STRETCH_FORMAT_TARGET) : targetSuccess;
    item.level = levelForSuccess(p.belief, target, task);
  }
  return item;
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
    else if (item.mode === 'training' && (before.format ?? 'standard') !== (item.format ?? 'standard'))
      changes.push(
        item.format && item.format !== 'standard'
          ? `${name} switched to the ${TRAINING_FORMATS[item.format].name} format — ${item.reasons.some((r) => r.factor === 'plateau') ? 'its estimate has plateaued' : 'it is your strongest area'}.`
          : `${name} is back to the standard format.`,
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
