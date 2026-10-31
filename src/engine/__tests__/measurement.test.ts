import { describe, expect, it } from 'vitest';
import {
  AdaptiveSession,
  DIMENSIONS,
  POPULATION_PRIOR,
  createRng,
  mastery,
  pSuccess,
  scoreSummary,
  simulateRun,
  thetaForMastery,
  updateBelief,
  type SimUser,
} from '../index';

const model = { levels: 10, discrimination: 1.5, guessing: 0.2 };

describe('item-response model', () => {
  it('success probability decreases with level and increases with ability', () => {
    for (let l = 1; l < 10; l++) expect(pSuccess(0, l, model)).toBeGreaterThan(pSuccess(0, l + 1, model));
    expect(pSuccess(1, 5, model)).toBeGreaterThan(pSuccess(0, 5, model));
    expect(pSuccess(-10, 5, model)).toBeCloseTo(0.2, 2); // lower asymptote = guessing
  });

  it('mastery is monotonic, bounded and invertible', () => {
    let prev = -1;
    for (let th = -4; th <= 4; th += 0.25) {
      const m = mastery(th, model);
      expect(m).toBeGreaterThan(prev);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(100);
      prev = m;
    }
    for (const target of [20, 50, 73]) expect(mastery(thetaForMastery(target, model), model)).toBeCloseTo(target, 1);
  });

  it('posterior moves towards the evidence and narrows', () => {
    const up = updateBelief(POPULATION_PRIOR, Array.from({ length: 12 }, () => ({ level: 7, success: true })), model);
    const down = updateBelief(POPULATION_PRIOR, Array.from({ length: 12 }, () => ({ level: 3, success: false })), model);
    expect(up.mean).toBeGreaterThan(0.5);
    expect(down.mean).toBeLessThan(-0.5);
    expect(up.sd).toBeLessThan(POPULATION_PRIOR.sd);
  });

  it('down-weighted trials move the belief less', () => {
    const full = updateBelief(POPULATION_PRIOR, [{ level: 9, success: true }], model);
    const half = updateBelief(POPULATION_PRIOR, [{ level: 9, success: true, weight: 0.3 }], model);
    expect(full.mean).toBeGreaterThan(half.mean);
  });

  it('score summary interval contains the point estimate and tightens with precision', () => {
    const wide = scoreSummary({ mean: 0, sd: 1.2 }, model);
    const narrow = scoreSummary({ mean: 0, sd: 0.25 }, model);
    for (const s of [wide, narrow]) {
      expect(s.lo).toBeLessThanOrEqual(s.score);
      expect(s.hi).toBeGreaterThanOrEqual(s.score);
    }
    expect(narrow.hi - narrow.lo).toBeLessThan(wide.hi - wide.lo);
    expect(wide.confidence).toBe('low');
    expect(narrow.confidence).toBe('high');
  });
});

describe('adaptive sessions', () => {
  const user: SimUser = { theta: {}, growth: {}, rtScale: 1, lapseRate: 0, interruptRate: 0 };

  it('assessment stops between min and max trials for every task', () => {
    for (const d of DIMENSIONS) {
      const res = simulateRun(d.task, user, { mode: 'assessment', prior: POPULATION_PRIOR, ability: 0.4, rng: createRng(3), startedAt: 0 });
      expect(res.trials.length).toBeGreaterThanOrEqual(d.task.assessment.minTrials);
      expect(res.trials.length).toBeLessThanOrEqual(d.task.assessment.maxTrials);
    }
  });

  it('training keeps the observed success rate near the target', () => {
    const task = DIMENSIONS.find((d) => d.id === 'inhibition')!.task;
    let k = 0;
    let n = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const res = simulateRun(task, user, { mode: 'training', prior: { mean: 0.8, sd: 0.3 }, ability: 0.8, rng: createRng(seed), startedAt: 0 });
      k += res.trials.filter((t) => t.success).length;
      n += res.trials.length;
    }
    expect(k / n).toBeGreaterThan(0.68);
    expect(k / n).toBeLessThan(0.9);
  });

  it('never jumps more than two levels and eases off after consecutive misses', () => {
    const task = DIMENSIONS[0].task;
    const s = new AdaptiveSession(task, { mode: 'training', prior: { mean: 0, sd: 0.4 } });
    let level = s.nextLevel();
    for (let i = 0; i < 3; i++) {
      s.record({ index: i, level, correct: false, success: false, rtMs: 900, deadlineMs: 2000, t: i * 1000 });
      const next = s.nextLevel();
      expect(Math.abs(next - level)).toBeLessThanOrEqual(2);
      if (i >= 1) expect(next).toBeLessThan(level + 0.5);
      level = next;
    }
  });
});

describe('parameter recovery (simulation)', () => {
  it('recovers known abilities with calibrated 80 % intervals', () => {
    const task = DIMENSIONS.find((d) => d.id === 'speed')!.task;
    const rng = createRng(11);
    const truth: number[] = [];
    const est: number[] = [];
    let covered = 0;
    const N = 80;
    for (let i = 0; i < N; i++) {
      const theta = rng.normal(0, 1);
      const user: SimUser = { theta: {}, growth: {}, rtScale: 1, lapseRate: 0, interruptRate: 0 };
      // Three sessions: a twin that has been used for a few days.
      let prior = POPULATION_PRIOR;
      for (let k = 0; k < 3; k++) {
        const res = simulateRun(task, user, { mode: 'assessment', prior, ability: theta, rng, startedAt: 0 });
        prior = res.session.belief;
      }
      truth.push(theta);
      est.push(prior.mean);
      if (Math.abs(prior.mean - theta) <= 1.2816 * prior.sd) covered++;
    }
    const mt = truth.reduce((s, x) => s + x, 0) / N;
    const me = est.reduce((s, x) => s + x, 0) / N;
    const cov = truth.reduce((s, x, i) => s + (x - mt) * (est[i] - me), 0);
    const r = cov / Math.sqrt(truth.reduce((s, x) => s + (x - mt) ** 2, 0) * est.reduce((s, x) => s + (x - me) ** 2, 0));
    expect(r).toBeGreaterThan(0.85);
    expect(covered / N).toBeGreaterThan(0.68);
    expect(covered / N).toBeLessThan(0.95);
  });
});
