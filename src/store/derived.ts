/**
 * Derived, memoised views of the store (profile, insights, collaboration score, projections…).
 * Everything here is recomputed from the raw history, so it can never drift out of sync.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  computeCollabScore,
  currentProfile,
  dimensionHistory,
  goalProbability,
  modelFor,
  profileInsights,
  project,
  type CoachContext,
  type GoalStatus,
  type Projection,
  type DimensionId,
} from '@/engine';
import { useStore } from './index';

const DAY = 86_400_000;

/** Current time, refreshed every minute (drift and "days ago" stay live). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useProfile() {
  const twin = useStore((s) => s.twin);
  const now = useNow();
  return useMemo(() => currentProfile(twin, now), [twin, now]);
}

export function useInsights() {
  const twin = useStore((s) => s.twin);
  const sessions = useStore((s) => s.sessions);
  const now = useNow();
  return useMemo(() => profileInsights(twin, sessions, now), [twin, sessions, now]);
}

export function useCollab() {
  const events = useStore((s) => s.events);
  const weights = useStore((s) => s.acsWeights);
  return useMemo(() => computeCollabScore(events, weights), [events, weights]);
}

export function useProjections(horizonDays = 28) {
  const twin = useStore((s) => s.twin);
  const now = useNow();
  return useMemo(() => {
    const out: Record<DimensionId, Projection | null> = {};
    for (const id of Object.keys(twin.dims)) {
      const r = project(dimensionHistory(twin, id), modelFor(id), now, horizonDays);
      out[id] = r.ok ? r.projection : null;
    }
    return out;
  }, [twin, now, horizonDays]);
}

export function useGoalStatuses(): GoalStatus[] {
  const goals = useStore((s) => s.goals);
  const twin = useStore((s) => s.twin);
  const sessions = useStore((s) => s.sessions);
  const now = useNow();
  return useMemo(() => {
    const profile = currentProfile(twin, now);
    return goals.map((goal) => {
      if (goal.kind === 'habit') {
        const days = new Set(sessions.filter((s) => s.endedAt > now - 7 * DAY).map((s) => new Date(s.endedAt).toDateString())).size;
        return { goal, current: days, probability: null };
      }
      const p = profile.find((x) => x.id === goal.dimension);
      const current = p && !p.unmeasured ? p.summary.score : null;
      const probability = goal.dimension ? goalProbability(dimensionHistory(twin, goal.dimension), modelFor(goal.dimension), goal.target, goal.deadline, now) : null;
      return { goal, current, probability };
    });
  }, [goals, twin, sessions, now]);
}

export function useCoachContext(): CoachContext {
  const profile = useProfile();
  const insights = useInsights();
  const collab = useCollab();
  const projections = useProjections();
  const goals = useGoalStatuses();
  const plans = useStore((s) => s.plans);
  const sessions = useStore((s) => s.sessions);
  const twin = useStore((s) => s.twin);
  const settings = useStore((s) => s.settings);
  const nickname = useStore((s) => s.profile.nickname);
  const llm = useStore((s) => s.consent.llm);
  const now = useNow();
  return useMemo(
    () => ({
      now,
      name: nickname || undefined,
      profile,
      insights,
      plan: plans.at(-1) ?? null,
      goals,
      collab,
      projections,
      recentSessions: sessions.slice(-5),
      llmEnabled: llm,
      twin,
      sessions,
      prefs: { dailyMinutes: settings.dailyMinutes, challenge: settings.challenge, focus: settings.focus },
      projectAt: (dim: DimensionId, days: number) => {
        const r = project(dimensionHistory(twin, dim), modelFor(dim), now, days);
        return r.ok ? r.projection : null;
      },
    }),
    [now, nickname, profile, insights, plans, goals, collab, projections, sessions, llm, twin, settings.dailyMinutes, settings.challenge, settings.focus],
  );
}
