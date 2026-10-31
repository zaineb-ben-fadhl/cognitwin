/**
 * Builds the compact, de-identified context sent to the optional LLM narrative layer.
 * Data minimisation: aggregated estimates and insights only — no raw trials, no name,
 * no camera data, no timestamps finer than a date.
 */
import { COLLAB_LABEL } from '../collaboration';
import { getDimension } from '../dimensions';
import { extractNumbers } from './guardrails';
import type { CoachContext } from './chat';
import { withoutCamera } from '../privacy';

const r0 = (x: number) => Math.round(x);
const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);

export interface LLMContext {
  today: string;
  profile: Array<{ dimension: string; measured: boolean; score?: number; interval80?: [number, number]; confidence?: string; sessions: number; daysSincePractice?: number }>;
  insights: Array<{ id: string; kind: string; dimension?: string; title: string; confidence: string; evidence: Array<{ id: string; label: string; value: string }> }>;
  plan: Array<{ dimension: string; activity: string; mode: string; level: number; minutes: number; why: string[] }>;
  goals: Array<{ kind: string; dimension?: string; target: number; deadline: string; current: number | null; probabilityPct: number | null }>;
  projections: Array<{ dimension: string; in4Weeks: number; interval80: [number, number]; basedOnSessions: number }>;
  collaboration: { total: number; interval80: [number, number]; parts: Record<string, number> };
  lastSession?: { dimension: string; mode: string; before: number; after: number; workingState: string };
  strategies: Array<{ dimension: string; title: string; detail: string }>;
}

export function buildLLMContext(ctx: CoachContext): { context: LLMContext; allowedNumbers: number[] } {
  const last = ctx.recentSessions.at(-1);
  const focusDims = new Set([...(ctx.plan?.items.map((i) => i.dimension) ?? []), ...ctx.insights.slice(0, 4).flatMap((i) => (i.dimension ? [i.dimension] : []))]);
  const context: LLMContext = {
    today: day(ctx.now),
    profile: ctx.profile.map((p) => ({
      dimension: getDimension(p.id).name,
      measured: !p.unmeasured,
      ...(p.unmeasured
        ? {}
        : {
            score: r0(p.summary.score),
            interval80: [r0(p.summary.lo), r0(p.summary.hi)] as [number, number],
            confidence: p.summary.confidence,
            daysSincePractice: p.daysSinceUpdate === null ? undefined : r0(p.daysSinceUpdate),
          }),
      sessions: p.state.nSessions,
    })),
    insights: ctx.insights.filter((i) => i.kind !== 'affect').slice(0, 8).map((i) => ({
      id: i.id,
      kind: i.kind,
      dimension: i.dimension ? getDimension(i.dimension).name : undefined,
      title: i.title,
      confidence: i.confidence,
      evidence: i.evidence.map((e) => ({ id: e.id, label: e.label, value: e.value })),
    })),
    plan: (ctx.plan?.items ?? []).map((i) => ({
      dimension: getDimension(i.dimension).name,
      activity: getDimension(i.dimension).task.name,
      mode: i.mode,
      level: i.level,
      minutes: i.minutes,
      why: i.reasons.slice(0, 3).map((r) => r.text),
    })),
    goals: ctx.goals
      .filter((g) => !g.goal.archived)
      .map((g) => ({
        kind: g.goal.kind,
        dimension: g.goal.dimension ? getDimension(g.goal.dimension).name : undefined,
        target: g.goal.target,
        deadline: day(g.goal.deadline),
        current: g.current === null ? null : r0(g.current),
        probabilityPct: g.probability === null ? null : r0(g.probability * 100),
      })),
    projections: Object.entries(ctx.projections)
      .filter(([, p]) => p)
      .map(([dim, p]) => {
        const end = p!.points.at(-1)!;
        return { dimension: getDimension(dim).name, in4Weeks: r0(end.mid), interval80: [r0(end.lo80), r0(end.hi80)] as [number, number], basedOnSessions: p!.basedOn };
      }),
    collaboration: {
      total: r0(ctx.collab.total),
      interval80: [r0(ctx.collab.lo), r0(ctx.collab.hi)],
      parts: Object.fromEntries(ctx.collab.subs.map((s) => [COLLAB_LABEL[s.dim], r0(s.score)])),
    },
    lastSession: last
      ? {
          dimension: getDimension(last.dimension).name,
          mode: last.mode,
          before: r0(last.scoreBefore.score),
          after: r0(last.scoreAfter.score),
          workingState: withoutCamera(last).affect.state,
        }
      : undefined,
    strategies: [...focusDims].flatMap((d) =>
      getDimension(d)
        .strategies.slice(0, 3)
        .map((s) => ({ dimension: getDimension(d).name, title: s.title, detail: s.detail })),
    ),
  };
  const allowedNumbers = [...new Set(extractNumbers(JSON.stringify(context)))];
  return { context, allowedNumbers };
}
