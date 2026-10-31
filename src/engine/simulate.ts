/**
 * Synthetic users. The simulator drives the *real* adaptive engine with a known ground truth,
 * which lets us (1) validate parameter recovery and interval coverage, and (2) generate the
 * labelled demo persona. Responses follow the same item-response model the engine assumes,
 * plus log-normal response times, condition effects, lapses and optional interruptions.
 */
import { AdaptiveSession, type ChallengePreference } from './adaptive';
import { pSuccess } from './irt';
import type { Rng } from './rng';
import type { AnyTaskSpec } from './tasks/types';
import type { BehaviourLog, DimensionId, Gaussian, SessionMode, Trial } from './types';

export interface SimUser {
  /** True ability per dimension at the start (logits). */
  theta: Record<DimensionId, number>;
  /** Asymptotic practice gain per dimension (logits). */
  growth: Record<DimensionId, number>;
  /** Multiplier on response times (1 = typical). */
  rtScale: number;
  /** Probability of an attention lapse on any trial. */
  lapseRate: number;
  /** Probability of leaving the window during a session. */
  interruptRate: number;
  /** Presses at random, very fast (data-quality tests). */
  randomResponder?: boolean;
}

/** Ground-truth ability after `sessionsDone` sessions on that dimension. */
export function trueAbility(user: SimUser, dim: DimensionId, sessionsDone: number): number {
  return (user.theta[dim] ?? 0) + (user.growth[dim] ?? 0) * (1 - Math.exp(-sessionsDone / 10));
}

export interface SimRunOptions {
  mode: SessionMode;
  prior: Gaussian;
  ability: number;
  rng: Rng;
  startedAt: number;
  deadlineFactor?: number;
  challenge?: ChallengePreference;
  /** Time-of-day / state effect on ability for this run (logits). */
  stateShift?: number;
  trialBudget?: number;
}

export interface SimRunResult {
  trials: Trial[];
  behaviour: BehaviourLog;
  endedAt: number;
  session: AdaptiveSession;
}

export function simulateRun(task: AnyTaskSpec, user: SimUser, opts: SimRunOptions): SimRunResult {
  const { rng } = opts;
  const session = new AdaptiveSession(task, {
    mode: opts.mode,
    prior: opts.prior,
    challenge: opts.challenge,
    trialBudget: opts.trialBudget,
  });
  const factor = opts.deadlineFactor ?? 1;
  const ability = opts.ability + (opts.stateShift ?? 0);
  const behaviour: BehaviourLog = {
    focusLosses: 0,
    hiddenMs: 0,
    longPauses: 0,
    hintsUsed: 0,
    corrections: 0,
    anticipations: 0,
    quitEarly: false,
    input: 'simulated',
  };
  let t = 0;
  let prev: unknown;
  let interruptedNext = false;
  while (!session.isComplete) {
    const index = session.trials.length;
    const level = session.nextLevel();
    const stim = task.generate(level, rng, index, prev);
    prev = stim;
    const { condition, meta } = task.sim.describe(stim);
    const deadlineMs = Math.round(task.deadlineMs(level) * factor);
    const logitShift = (condition && task.sim.conditionLogit?.[condition]) || 0;
    // Shift ability by a condition effect expressed on the logit scale.
    const p = pSuccess(ability + logitShift / task.discrimination, level, task);
    const lapse = rng.chance(user.lapseRate);
    let success = !lapse && rng.chance(p);
    if (user.randomResponder) success = rng.chance(task.guessing || 0.05);

    const medianRt =
      (task.sim.baseRtMs + task.sim.rtPerLevelMs * (level - 1) + ((condition && task.sim.conditionRtMs?.[condition]) || 0)) *
      user.rtScale *
      Math.exp(-0.12 * ability);
    let rt: number | null = Math.max(160, medianRt * Math.exp(rng.normal(0, 0.22)));
    if (user.randomResponder) rt = 120 + rng.next() * 260;

    let correct = success;
    let errorType: Trial['errorType'];
    const isNogo = condition === 'nogo';
    if (isNogo) {
      rt = success ? null : Math.min(rt, deadlineMs * 0.9);
      if (!success) errorType = 'commission';
    } else if (success) {
      rt = Math.min(rt, deadlineMs * 0.97);
    } else {
      errorType = task.sim.errorFor(stim, rng);
      if (errorType === 'omission') {
        rt = null;
      } else if (rng.chance(0.25) && task.guessing > 0) {
        // Correct but too slow.
        correct = true;
        errorType = 'slow';
        rt = deadlineMs * (1.05 + rng.next() * 0.3);
      }
      if (rt !== null && errorType !== 'slow') rt = Math.min(rt, deadlineMs * 0.98);
    }
    if (rt !== null && rt < 150) behaviour.anticipations++;

    const trialMeta: Record<string, number | string | boolean> = { ...(meta ?? {}) };
    if (task.dimension === 'memory') {
      const span = Number(meta?.span ?? 2);
      trialMeta.positionsCorrect = success ? span : rng.int(0, Math.max(0, span - 1));
    }
    if (task.dimension === 'reasoning' && !success) trialMeta.missedAttr = rng.pick(['shape', 'count', 'fill', 'size']);

    session.record({
      index,
      level,
      correct,
      success,
      rtMs: rt === null ? null : Math.round(rt),
      deadlineMs,
      condition,
      errorType,
      weight: interruptedNext ? 0.3 : 1,
      meta: trialMeta,
      t: Math.round(t),
    });
    interruptedNext = false;
    t += (rt ?? deadlineMs) + 900;
    if (rng.chance(user.interruptRate / 10)) {
      behaviour.focusLosses++;
      const away = 2000 + rng.next() * 9000;
      behaviour.hiddenMs += away;
      t += away;
      interruptedNext = true;
    }
  }
  return { trials: session.trials, behaviour, endedAt: opts.startedAt + Math.round(t), session };
}
