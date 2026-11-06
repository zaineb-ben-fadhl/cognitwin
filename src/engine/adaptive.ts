/**
 * Within-session adaptation.
 *
 * Assessment mode = computerised adaptive testing: after two gentle warm-up trials, each trial
 * is drawn at the level that is most informative about the current belief, and the session
 * stops as soon as the posterior is precise enough (or the maximum is reached).
 *
 * Training mode = desirable difficulty: each trial is drawn at the level where the expected
 * success rate is closest to the user's chosen target (≈ 80 %, cf. Wilson et al. 2019),
 * with a frustration guard after consecutive failures.
 */
import { levelForSuccess, mostInformativeLevel, updateBelief, type Observation } from './irt';
import type { AnyTaskSpec } from './tasks/types';
import type { Gaussian, SessionMode, TrainingFormat, Trial } from './types';
import { clamp } from './stats';

export type ChallengePreference = 'gentle' | 'balanced' | 'stretch';

export const TARGET_SUCCESS: Record<ChallengePreference, number> = {
  gentle: 0.88,
  balanced: 0.8,
  stretch: 0.7,
};

/** Target success of the "stretch" plateau-breaking format (challenge-point framework). */
export const STRETCH_FORMAT_TARGET = 0.68;
/** Level offsets of the "mixed levels" format: difficulty jumps around the target level. */
export const INTERLEAVE_OFFSETS = [0, 2, -1, 1, -2, 1, 0, -1] as const;

export interface AdaptiveOptions {
  mode: SessionMode;
  prior: Gaussian;
  challenge?: ChallengePreference;
  /** Fixed trial budget override (e.g. a short demo). */
  trialBudget?: number;
  /** Training format (plateau breaker). Assessment ignores it. */
  format?: TrainingFormat;
  /** Per-dimension target success rate (asymmetric profiles); overrides the challenge preference. */
  targetSuccess?: number;
}

export function toObservations(trials: readonly Trial[], sessionWeight = 1): Observation[] {
  return trials.map((t) => ({ level: t.level, success: t.success, weight: (t.weight ?? 1) * sessionWeight }));
}

/** Longest run of consecutive failures at the end of the trial list. */
export function trailingFailures(trials: readonly Trial[]): number {
  let n = 0;
  for (let i = trials.length - 1; i >= 0 && !trials[i].success; i--) n++;
  return n;
}

export class AdaptiveSession {
  readonly trials: Trial[] = [];
  belief: Gaussian;
  /** Set when the frustration guard eased the difficulty, so the UI / coach can explain it. */
  lastAdjustment: string | null = null;
  /**
   * Temporary increase of the training target success rate, set by the emotion-aware layer
   * when strain builds up (training only — assessment difficulty is never affected).
   */
  targetBoost = 0;

  constructor(
    readonly task: AnyTaskSpec,
    readonly options: AdaptiveOptions,
  ) {
    this.belief = options.prior;
  }

  get mode(): SessionMode {
    return this.options.mode;
  }

  get targetSuccess(): number {
    let base = this.options.targetSuccess ?? TARGET_SUCCESS[this.options.challenge ?? 'balanced'];
    if (this.options.format === 'stretch') base = Math.min(base, STRETCH_FORMAT_TARGET);
    return Math.min(0.95, base + this.targetBoost);
  }

  get budget(): number {
    if (this.options.trialBudget) return this.options.trialBudget;
    return this.mode === 'assessment' ? this.task.assessment.maxTrials : this.task.trainingTrials;
  }

  get isComplete(): boolean {
    const n = this.trials.length;
    if (n >= this.budget) return true;
    if (this.mode === 'assessment' && !this.options.trialBudget) {
      return n >= this.task.assessment.minTrials && this.belief.sd <= this.task.assessment.targetSd;
    }
    return false;
  }

  /** 0–1, for progress bars. Assessment can finish early, so this is an upper-bound estimate. */
  get progress(): number {
    return clamp(this.trials.length / this.budget, 0, 1);
  }

  nextLevel(): number {
    const levels = this.task.levels;
    const last = this.trials.at(-1)?.level;
    this.lastAdjustment = null;

    let level: number;
    if (this.mode === 'assessment') {
      level = this.trials.length < 2 ? levelForSuccess(this.belief, 0.75, this.task) : mostInformativeLevel(this.belief, this.task);
      // Smoothness constraint: never jump more than two levels between trials.
      if (last !== undefined) level = clamp(level, last - 2, last + 2);
    } else {
      level = levelForSuccess(this.belief, this.targetSuccess, this.task);
      if (this.options.format === 'interleaved') {
        // Variable practice: jump around the target level instead of creeping up one step at a time.
        level += INTERLEAVE_OFFSETS[this.trials.length % INTERLEAVE_OFFSETS.length];
        if (last !== undefined) level = clamp(level, last - 3, last + 3);
      } else if (last !== undefined) level = clamp(level, last - 2, last + 1);
    }

    const fails = trailingFailures(this.trials);
    if (fails >= 2 && last !== undefined && level >= last) {
      level = last - 1;
      this.lastAdjustment = `Eased to level ${clamp(level, 1, levels)} after ${fails} misses in a row.`;
    }
    return clamp(Math.round(level), 1, levels);
  }

  record(trial: Trial): void {
    this.trials.push(trial);
    this.belief = updateBelief(this.options.prior, toObservations(this.trials), this.task);
  }
}
