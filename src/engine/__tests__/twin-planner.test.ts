import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS,
  DIMENSION_IDS,
  POPULATION_PRIOR,
  applySession,
  beliefAt,
  buildDemoHistory,
  createRng,
  createTwin,
  currentProfile,
  dimensionHistory,
  estimateMinutes,
  finalizeSession,
  generateDailyPlan,
  goalProbability,
  modelFor,
  project,
  replaySessions,
  sessionPrior,
  simulateRun,
  snapshotAt,
  taskForDimension,
  type SimUser,
} from '../index';

const DAY = 86_400_000;
const NOW = new Date('2026-10-25T10:00:00').getTime();
const user: SimUser = { theta: { memory: 0.5 }, growth: {}, rtScale: 1, lapseRate: 0, interruptRate: 0 };

function oneSession(twin = createTwin(NOW - 10 * DAY), at = NOW - 5 * DAY) {
  const task = taskForDimension('memory');
  const prior = sessionPrior(twin, 'memory', at);
  const res = simulateRun(task, user, { mode: 'assessment', prior, ability: 0.5, rng: createRng(1), startedAt: at });
  const record = finalizeSession({ id: 's1', taskId: task.id, mode: 'assessment', startedAt: at, endedAt: res.endedAt, trials: res.trials, behaviour: res.behaviour, prior, deadlineFactor: 1 });
  return { twin: applySession(twin, record), record };
}

describe('Brain Twin', () => {
  it('starts every dimension at the population prior, unmeasured', () => {
    const twin = createTwin(NOW);
    expect(Object.keys(twin.dims).sort()).toEqual([...DIMENSION_IDS].sort());
    for (const p of currentProfile(twin, NOW)) {
      expect(p.unmeasured).toBe(true);
      expect(p.belief).toEqual(POPULATION_PRIOR);
    }
  });

  it('appends a full snapshot per session and keeps history replayable', () => {
    const { twin, record } = oneSession();
    expect(twin.snapshots).toHaveLength(1);
    expect(Object.keys(twin.snapshots[0].dims)).toHaveLength(DIMENSION_IDS.length);
    expect(twin.dims.memory.nSessions).toBe(1);
    expect(dimensionHistory(twin, 'memory')).toHaveLength(1);
    expect(snapshotAt(twin, record.endedAt - 1)).toBeNull();
    expect(snapshotAt(twin, record.endedAt + 1)?.sessionId).toBe('s1');
  });

  it('uncertainty grows with inactivity, capped at the prior', () => {
    const { twin } = oneSession();
    const st = twin.dims.memory;
    const soon = beliefAt(st, st.lastUpdated! + DAY);
    const later = beliefAt(st, st.lastUpdated! + 60 * DAY);
    const never = beliefAt(st, st.lastUpdated! + 5000 * DAY);
    expect(later.sd).toBeGreaterThan(soon.sd);
    expect(never.sd).toBeLessThanOrEqual(POPULATION_PRIOR.sd + 1e-9);
  });

  it('replaying sessions reproduces the twin', () => {
    const demo = buildDemoHistory(NOW, 3);
    const { twin } = replaySessions(demo.sessions, demo.twin.createdAt);
    for (const id of DIMENSION_IDS) {
      expect(twin.dims[id].mean).toBeCloseTo(demo.twin.dims[id].mean, 6);
      expect(twin.dims[id].nSessions).toBe(demo.twin.dims[id].nSessions);
    }
  });
});

describe('planner', () => {
  it('starts with check-ins for unmeasured dimensions and respects the time budget', () => {
    const twin = createTwin(NOW);
    const plan = generateDailyPlan(twin, [], [], DEFAULT_PREFS, NOW);
    expect(plan.items.length).toBeGreaterThan(0);
    expect(plan.items.every((i) => i.mode === 'assessment')).toBe(true);
    const total = plan.items.reduce((s, i) => s + i.minutes, 0);
    expect(total).toBeLessThanOrEqual(DEFAULT_PREFS.dailyMinutes + 1.5 + Math.max(...plan.items.map((i) => i.minutes)));
  });

  it('explains every item: contributions add up to the utility', () => {
    const demo = buildDemoHistory(NOW, 5);
    const plan = generateDailyPlan(demo.twin, demo.sessions, demo.goals, demo.prefs, NOW);
    for (const item of plan.items) {
      const sum = item.reasons.reduce((s, r) => s + r.contribution, 0);
      expect(sum).toBeCloseTo(item.utility, 2);
      expect(item.reasons.length).toBeGreaterThan(0);
    }
    expect(plan.rationale.length).toBeGreaterThan(20);
  });

  it('boosts a dimension linked to an active goal', () => {
    const demo = buildDemoHistory(NOW, 5);
    const goals = [{ id: 'g', kind: 'score' as const, dimension: 'reasoning', target: 95, deadline: NOW + 20 * DAY, createdAt: NOW, selfSet: true }];
    const plan = generateDailyPlan(demo.twin, demo.sessions, goals, { ...demo.prefs, dailyMinutes: 20 }, NOW);
    const item = plan.items.find((i) => i.dimension === 'reasoning');
    expect(item?.reasons.some((r) => r.factor === 'goal')).toBe(true);
  });

  it('estimates realistic durations', () => {
    for (const id of DIMENSION_IDS) {
      const m = estimateMinutes(taskForDimension(id), 'training');
      expect(m).toBeGreaterThanOrEqual(1);
      expect(m).toBeLessThanOrEqual(6);
    }
  });
});

describe('projections', () => {
  it('refuses to project without enough history', () => {
    const { twin } = oneSession();
    const r = project(dimensionHistory(twin, 'memory'), modelFor('memory'), NOW);
    expect(r.ok).toBe(false);
  });

  it('bands widen with the horizon and goal probability decreases with the target', () => {
    const demo = buildDemoHistory(NOW, 9);
    const h = dimensionHistory(demo.twin, 'memory');
    const r = project(h, modelFor('memory'), NOW, 28);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const first = r.projection.points[0];
    const last = r.projection.points.at(-1)!;
    expect(last.hi80 - last.lo80).toBeGreaterThan(first.hi80 - first.lo80);
    for (const p of r.projection.points) {
      expect(p.lo80).toBeLessThanOrEqual(p.lo50);
      expect(p.hi80).toBeGreaterThanOrEqual(p.hi50);
    }
    const easy = goalProbability(h, modelFor('memory'), 20, NOW + 14 * DAY, NOW)!;
    const hard = goalProbability(h, modelFor('memory'), 95, NOW + 14 * DAY, NOW)!;
    expect(easy).toBeGreaterThan(hard);
    expect(easy).toBeLessThanOrEqual(1);
    expect(hard).toBeGreaterThanOrEqual(0);
  });
});
