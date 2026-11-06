/**
 * "Why did you assign me this exercise?" — data-driven justifications.
 *
 * Every plan decision is traced back to the Brain Twin charts the user can open: the session
 * log, the progress curve, the weekly-change heatmap, the radar (score and interval), the
 * practice calendar and goals. Each justification carries the exact numbers shown on that
 * chart and a link to it, so the coach's answer is checkable instead of a black box.
 */
import { getDimension } from './dimensions';
import { TRAINING_FORMATS, detectPlateau } from './formats';
import { weeklyChangeMatrix } from './heatmaps';
import { metric } from './metrics';
import { localDate, scoreDimension, type PlannerPrefs } from './planner';
import { mean } from './stats';
import { TIER_LABEL, detectAsymmetry, tierFor } from './tiers';
import { currentProfile, dimensionHistory, type DimensionProfile } from './twin';
import type { DailyPlan, DimensionId, Evidence, Goal, PlanItem, PlanReason, SessionRecord, TwinState } from './types';

const DAY = 86_400_000;
const r0 = (x: number) => Math.round(x);
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export type ChartRef = 'session_log' | 'progress_curve' | 'weekly_heatmap' | 'radar' | 'calendar' | 'goal';

export const CHART_LABEL: Record<ChartRef, string> = {
  session_log: 'Session log',
  progress_curve: 'Progress curve',
  weekly_heatmap: 'Weekly heatmap',
  radar: 'Radar',
  calendar: 'Practice calendar',
  goal: 'Goals',
};

export interface Justification {
  chart: ChartRef;
  /** Sentence fragment, e.g. "in yesterday's Arrow Focus session your median response time rose 12 %…". */
  text: string;
  evidence: Evidence;
  /** Where the user can check it. */
  route: string;
  /** Rough salience, used to order facts. */
  strength: number;
}

export interface ExplainInput {
  twin: TwinState;
  sessions: readonly SessionRecord[];
  goals: readonly Goal[];
  prefs: PlannerPrefs;
  now: number;
}

let counter = 0;
const ev = (label: string, value: string, numbers: number[] = []): Evidence => ({ id: `x${++counter}`, label, value, numbers });

function dayPhrase(ts: number, now: number): string {
  if (localDate(ts) === localDate(now)) return "today's";
  if (localDate(ts) === localDate(now - DAY)) return "yesterday's";
  return `the ${fmtDate(ts)}`;
}

/** All chart-backed facts about one dimension, strongest first. */
export function dimensionFacts(dim: DimensionId, input: ExplainInput, profile: DimensionProfile[] = currentProfile(input.twin, input.now)): Justification[] {
  const d = getDimension(dim);
  const facts: Justification[] = [];
  const twinRoute = `/twin?dim=${dim}`;
  const p = profile.find((x) => x.id === dim);
  const dimSessions = input.sessions.filter((s) => s.dimension === dim).sort((a, b) => a.endedAt - b.endedAt);
  const last = dimSessions.at(-1);

  // 1. Session log: how the last session compares with the previous ones.
  if (last && last.trials.length) {
    const prev = dimSessions.slice(-4, -1).filter((s) => s.trials.length);
    const when = dayPhrase(last.endedAt, input.now);
    const sessionName = `${when} ${d.task.name} session`;
    const rtNow = metric(last.metrics, 'medianRt');
    const rtPrev = mean(prev.map((s) => metric(s.metrics, 'medianRt')));
    if (rtNow !== null && rtPrev !== null && rtPrev > 0) {
      const pct = (100 * (rtNow - rtPrev)) / rtPrev;
      if (Math.abs(pct) >= 5) {
        facts.push({
          chart: 'session_log',
          text: `in ${sessionName} your median response time ${pct > 0 ? 'rose' : 'fell'} ${r0(Math.abs(pct))} % (${r0(rtPrev)} → ${r0(rtNow)} ms) compared with your previous ${prev.length} session${prev.length > 1 ? 's' : ''}`,
          evidence: ev(`Session log · ${d.short} median response time`, `${r0(rtPrev)} → ${r0(rtNow)} ms (${pct > 0 ? '+' : '−'}${r0(Math.abs(pct))} %) vs previous ${prev.length}`, [r0(rtPrev), r0(rtNow), r0(Math.abs(pct)), prev.length]),
          route: `${twinRoute}#session-log`,
          strength: 0.6 + Math.min(0.4, Math.abs(pct) / 40),
        });
      }
    }
    const okNow = metric(last.metrics, 'successRate');
    const okPrev = mean(prev.map((s) => metric(s.metrics, 'successRate')));
    if (okNow !== null && okPrev !== null && Math.abs(okNow - okPrev) >= 8) {
      facts.push({
        chart: 'session_log',
        text: `on-time success in ${sessionName} ${okNow < okPrev ? 'fell' : 'rose'} from ${r0(okPrev)} % to ${r0(okNow)} %`,
        evidence: ev(`Session log · ${d.short} on-time success`, `${r0(okPrev)} → ${r0(okNow)} %`, [r0(okPrev), r0(okNow)]),
        route: `${twinRoute}#session-log`,
        strength: 0.55 + Math.min(0.35, Math.abs(okNow - okPrev) / 60),
      });
    }
    if (last.dispute || last.quality.reliability === 'poor') {
      facts.push({
        chart: 'session_log',
        text: last.dispute
          ? `you disputed ${sessionName}, so its weight was halved and its uncertainty widened — a calm session will settle it`
          : `${sessionName} was flagged as unreliable (weight ${Math.round(last.quality.weight * 100)} %), so a clean session is needed`,
        evidence: ev(`Session log · ${d.short} last session`, last.dispute ? 'disputed by you' : `weight ${Math.round(last.quality.weight * 100)} %`, last.dispute ? [] : [Math.round(last.quality.weight * 100)]),
        route: `${twinRoute}#session-log`,
        strength: 0.8,
      });
    }
  }

  // 2. Progress curve: recent trend, or a plateau.
  const history = dimensionHistory(input.twin, dim);
  const plateau = detectPlateau(input.twin, input.sessions, dim);
  if (plateau) {
    facts.push({
      chart: 'progress_curve',
      text: `your ${d.short} progress curve has been flat for ${plateau.sessions} sessions (range ${plateau.range.toFixed(1)} pts, trend ${plateau.slope >= 0 ? '+' : ''}${plateau.slope.toFixed(1)} pts per session), so the format was changed`,
      evidence: ev(`Progress curve · ${d.short} last ${plateau.sessions} sessions`, `range ${plateau.range.toFixed(1)} pts, trend ${plateau.slope >= 0 ? '+' : ''}${plateau.slope.toFixed(1)} pts/session`, [plateau.sessions, plateau.range, Math.abs(plateau.slope)]),
      route: twinRoute,
      strength: 0.85,
    });
  } else if (history.length >= 2) {
    const k = Math.min(4, history.length);
    const from = history[history.length - k].score;
    const to = history.at(-1)!.score;
    const delta = to - from;
    if (Math.abs(delta) >= 2) {
      facts.push({
        chart: 'progress_curve',
        text: `your ${d.short} progress curve went from ${r0(from)} % to ${r0(to)} % over the last ${k} sessions`,
        evidence: ev(`Progress curve · ${d.short} last ${k} sessions`, `${r0(from)} → ${r0(to)} %`, [r0(from), r0(to), k]),
        route: twinRoute,
        strength: 0.45 + Math.min(0.4, Math.abs(delta) / 25),
      });
    }
  }

  // 3. Weekly heatmap: this week's cell, ranked against the other areas.
  const weekly = weeklyChangeMatrix(input.sessions, input.twin, input.now, 2);
  const row = weekly.ids.indexOf(dim);
  const cell = weekly.cells[row]?.at(-1);
  if (cell && cell.value !== null && Math.abs(cell.value) >= 1) {
    const column = weekly.cells.map((c) => c.at(-1)?.value).filter((v): v is number => v !== null && v !== undefined);
    const rank = cell.value === Math.min(...column) && column.length > 1 ? ', the lowest cell in this week’s column' : cell.value === Math.max(...column) && column.length > 1 ? ', the highest cell in this week’s column' : '';
    facts.push({
      chart: 'weekly_heatmap',
      text: `the weekly heatmap shows ${d.short} at ${cell.label} this week${rank}`,
      evidence: ev(`Weekly heatmap · ${d.short}, week of ${fmtDate(weekly.starts.at(-1)!)}`, cell.label, [Number(Math.abs(cell.value).toFixed(1))]),
      route: `/twin?dim=${dim}#weekly-heatmap`,
      strength: 0.45 + Math.min(0.35, Math.abs(cell.value) / 15),
    });
  }

  // 4. Radar: level and interval width, ranked.
  if (p && !p.unmeasured) {
    const measured = profile.filter((x) => !x.unmeasured);
    const width = (x: DimensionProfile) => x.summary.hi - x.summary.lo;
    const half = r0(width(p) / 2);
    const lowest = measured.length > 1 && p.summary.score === Math.min(...measured.map((x) => x.summary.score));
    const highest = measured.length > 1 && p.summary.score === Math.max(...measured.map((x) => x.summary.score));
    const widest = measured.length > 1 && width(p) === Math.max(...measured.map(width));
    const asym = detectAsymmetry(profile);
    const tier = tierFor(p);
    facts.push({
      chart: 'radar',
      text:
        `on the radar ${d.short} sits at ${r0(p.summary.score)} % (80 % interval ${r0(p.summary.lo)}–${r0(p.summary.hi)})` +
        (lowest ? ', your lowest area' : highest ? ', your highest area' : '') +
        (widest ? ', with the widest uncertainty ring' : '') +
        (asym && (asym.strong === dim || asym.weak === dim) ? ` — so it trains at ${TIER_LABEL[tier].toLowerCase()} difficulty, set from its own estimate` : ''),
      evidence: ev(`Radar · ${d.short}`, `${r0(p.summary.score)} % (80 % interval ${r0(p.summary.lo)}–${r0(p.summary.hi)}, ±${half})`, [r0(p.summary.score), 80, r0(p.summary.lo), r0(p.summary.hi), half]),
      route: '/',
      strength: 0.35 + (lowest || widest ? 0.2 : 0) + (asym && (asym.strong === dim || asym.weak === dim) ? 0.3 : 0),
    });
  }

  // 5. Practice calendar: spacing.
  if (p?.daysSinceUpdate !== null && p?.daysSinceUpdate !== undefined && p.daysSinceUpdate >= 1.5) {
    const days = r0(p.daysSinceUpdate);
    facts.push({
      chart: 'calendar',
      text: `the practice calendar shows no ${d.short} session for ${days} days, and spacing helps skills settle`,
      evidence: ev(`Practice calendar · last ${d.short} session`, `${days} days ago`, [days]),
      route: '/twin#calendar',
      strength: 0.3 + Math.min(0.3, days / 15),
    });
  }

  // 6. Goal.
  const goal = input.goals.find((g) => !g.archived && !g.achievedAt && g.kind === 'score' && g.dimension === dim && g.deadline > input.now);
  if (goal && p && !p.unmeasured) {
    facts.push({
      chart: 'goal',
      text: `it serves your goal of ${goal.target} % by ${fmtDate(goal.deadline)} (now ${r0(p.summary.score)} %)`,
      evidence: ev(`Goals · ${d.short}`, `${goal.target} % by ${fmtDate(goal.deadline)}; now ${r0(p.summary.score)} %`, [goal.target, r0(p.summary.score)]),
      route: '/goals',
      strength: 0.5,
    });
  }
  return facts.sort((a, b) => b.strength - a.strength);
}

/** Which chart backs which planner factor. */
const FACTOR_CHART: Partial<Record<PlanReason['factor'], ChartRef>> = {
  gap: 'radar',
  uncertainty: 'radar',
  asymmetry: 'radar',
  goal: 'goal',
  spacing: 'calendar',
  momentum: 'progress_curve',
  plateau: 'progress_curve',
};

export const FACTOR_NAME: Record<PlanReason['factor'], string> = {
  gap: 'room to grow',
  uncertainty: 'uncertainty',
  goal: 'your goal',
  spacing: 'spacing',
  momentum: 'momentum',
  variety: 'variety',
  preference: 'your focus',
  fatigue: 'rotation',
  plateau: 'plateau',
  asymmetry: 'asymmetric profile',
};

export interface ChoiceExplanation {
  dimension: DimensionId;
  item: PlanItem | null;
  inPlan: boolean;
  facts: Justification[];
  reasons: PlanReason[];
  utility: number;
  /** 1 = highest utility today. */
  rank: number;
  of: number;
  runnerUp?: { dimension: DimensionId; utility: number };
  /** Lowest utility among the plan's items (for "why not X?"). */
  cutoff?: number;
}

/** Explain why a dimension is (or is not) in today's plan, with chart-backed facts. */
export function explainChoice(dim: DimensionId, plan: DailyPlan | null, input: ExplainInput): ChoiceExplanation {
  const profile = currentProfile(input.twin, input.now);
  const ctx = { now: input.now, sessions: input.sessions, goals: input.goals, prefs: input.prefs, twin: input.twin };
  const scored = profile.map((p) => ({ id: p.id, ...scoreDimension(p, ctx) })).sort((a, b) => b.utility - a.utility);
  const mine = scored.find((s) => s.id === dim)!;
  const item = plan?.items.find((i) => i.dimension === dim) ?? null;
  const reasons = item?.reasons ?? mine.reasons;
  const all = dimensionFacts(dim, input, profile);
  // Facts that back the item's top reasons first, then the strongest remaining ones.
  const wanted = reasons.map((r) => FACTOR_CHART[r.factor]).filter((c): c is ChartRef => !!c);
  const ordered = [...all.filter((f) => f.chart === 'session_log'), ...wanted.flatMap((c) => all.filter((f) => f.chart === c)), ...all];
  const facts = [...new Set(ordered)].slice(0, 4);
  const others = scored.filter((s) => s.id !== dim);
  const included = plan?.items.map((i) => i.utility) ?? [];
  return {
    dimension: dim,
    item,
    inPlan: !!item,
    facts,
    reasons,
    utility: Math.round((item?.utility ?? mine.utility) * 100) / 100,
    rank: scored.findIndex((s) => s.id === dim) + 1,
    of: scored.length,
    runnerUp: others[0] ? { dimension: others[0].id, utility: Math.round(others[0].utility * 100) / 100 } : undefined,
    cutoff: included.length ? Math.round(Math.min(...included) * 100) / 100 : undefined,
  };
}

export function formatPhrase(item: PlanItem): string {
  if (item.mode === 'assessment') return 'a short check-in';
  const tier = item.tier && item.tier !== 'core' ? `${TIER_LABEL[item.tier].toLowerCase()} ` : '';
  const format = item.format && item.format !== 'standard' ? `, ${TRAINING_FORMATS[item.format].name} format` : '';
  return `${tier}training from level ${item.level}${format}`;
}
