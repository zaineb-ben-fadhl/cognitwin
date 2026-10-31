/**
 * Measurement model: a Bayesian item-response model over a ladder of difficulty levels.
 *
 *   P(success | θ, level) = c + (1 − c) · σ(a · (θ − b_level))
 *
 * θ (theta) is the latent ability of the user on one dimension, in logits.
 * b_level spreads the task's difficulty ladder evenly over [−2.25, +2.25] logits.
 * a (discrimination) and c (lower asymptote ≈ chance success) are set per task.
 *
 * The posterior over θ is computed exactly on a grid and summarised back to a Gaussian
 * (assumed-density filtering), which is what the Brain Twin stores between sessions.
 */
import type { Confidence, Gaussian, ScoreSummary } from './types';
import { Z80, clamp } from './stats';

export interface MeasurementModel {
  levels: number;
  discrimination: number;
  guessing: number;
}

export interface Observation {
  level: number;
  success: boolean;
  /** Likelihood tempering weight in [0, 1]. */
  weight?: number;
}

const GRID_MIN = -4.5;
const GRID_MAX = 4.5;
const GRID_STEP = 0.05;
export const THETA_GRID: readonly number[] = Array.from(
  { length: Math.round((GRID_MAX - GRID_MIN) / GRID_STEP) + 1 },
  (_, i) => GRID_MIN + i * GRID_STEP,
);

/** Population prior for a dimension that has never been observed. */
export const POPULATION_PRIOR: Gaussian = { mean: 0, sd: 1.2 };

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function levelDifficulty(level: number, levels: number): number {
  if (levels <= 1) return 0;
  return -2.25 + (4.5 * (clamp(level, 1, levels) - 1)) / (levels - 1);
}

export function pSuccess(theta: number, level: number, m: MeasurementModel): number {
  const b = levelDifficulty(level, m.levels);
  return m.guessing + (1 - m.guessing) * sigmoid(m.discrimination * (theta - b));
}

/** Fisher information of one item at θ (3PL form). */
export function itemInformation(theta: number, level: number, m: MeasurementModel): number {
  const p = pSuccess(theta, level, m);
  const c = m.guessing;
  return (m.discrimination ** 2 * ((p - c) ** 2 / (1 - c) ** 2) * (1 - p)) / p;
}

/** Information averaged over the current Gaussian belief (9-point quadrature, ±2 sd). */
export function expectedInformation(belief: Gaussian, level: number, m: MeasurementModel): number {
  let total = 0;
  let wsum = 0;
  for (let k = -4; k <= 4; k++) {
    const z = k / 2;
    const w = Math.exp(-(z * z) / 2);
    total += w * itemInformation(belief.mean + z * belief.sd, level, m);
    wsum += w;
  }
  return total / wsum;
}

/** Normalised posterior weights on THETA_GRID. */
export function posteriorDensity(prior: Gaussian, obs: readonly Observation[], m: MeasurementModel): number[] {
  const logw = THETA_GRID.map((th) => -0.5 * ((th - prior.mean) / prior.sd) ** 2);
  for (const o of obs) {
    const w = o.weight ?? 1;
    if (w <= 0) continue;
    for (let i = 0; i < THETA_GRID.length; i++) {
      const p = clamp(pSuccess(THETA_GRID[i], o.level, m), 1e-6, 1 - 1e-6);
      logw[i] += w * (o.success ? Math.log(p) : Math.log(1 - p));
    }
  }
  const max = Math.max(...logw);
  const dens = logw.map((l) => Math.exp(l - max));
  const total = dens.reduce((s, x) => s + x, 0);
  return dens.map((d) => d / total);
}

export function summariseDensity(dens: readonly number[]): Gaussian {
  let mu = 0;
  for (let i = 0; i < dens.length; i++) mu += dens[i] * THETA_GRID[i];
  let v = 0;
  for (let i = 0; i < dens.length; i++) v += dens[i] * (THETA_GRID[i] - mu) ** 2;
  return { mean: mu, sd: Math.max(Math.sqrt(v), 0.05) };
}

export function updateBelief(prior: Gaussian, obs: readonly Observation[], m: MeasurementModel): Gaussian {
  if (!obs.length) return prior;
  return summariseDensity(posteriorDensity(prior, obs, m));
}

/**
 * Expected mastery of the difficulty ladder (0–100): the share of the task's levels the user
 * would be expected to succeed at, ignoring lucky guesses. It is criterion-referenced
 * (relative to the task), deliberately NOT a percentile against other people.
 */
export function mastery(theta: number, m: MeasurementModel): number {
  let s = 0;
  for (let l = 1; l <= m.levels; l++) s += sigmoid(m.discrimination * (theta - levelDifficulty(l, m.levels)));
  return (100 * s) / m.levels;
}

/** Inverse of `mastery` (bisection). */
export function thetaForMastery(score: number, m: MeasurementModel): number {
  let lo = -8;
  let hi = 8;
  const target = clamp(score, 0.5, 99.5);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (mastery(mid, m) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function confidenceFromWidth(width: number): Confidence {
  if (width <= 16) return 'high';
  if (width <= 30) return 'moderate';
  return 'low';
}

/**
 * Percentage profile with an 80 % credible interval. Because mastery is monotonic in θ,
 * quantiles of the score are exactly the mastery of the θ quantiles.
 */
export function scoreSummary(belief: Gaussian, m: MeasurementModel): ScoreSummary {
  const score = mastery(belief.mean, m);
  const lo = mastery(belief.mean - Z80 * belief.sd, m);
  const hi = mastery(belief.mean + Z80 * belief.sd, m);
  return { score, lo, hi, confidence: confidenceFromWidth(hi - lo) };
}

/** Level whose success probability (at the belief mean) is closest to `target`. */
export function levelForSuccess(belief: Gaussian, target: number, m: MeasurementModel): number {
  let best = 1;
  let bestGap = Infinity;
  for (let l = 1; l <= m.levels; l++) {
    const gap = Math.abs(pSuccess(belief.mean, l, m) - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = l;
    }
  }
  return best;
}

/** Most informative level for the current belief (computerised adaptive testing). */
export function mostInformativeLevel(belief: Gaussian, m: MeasurementModel): number {
  let best = 1;
  let bestInfo = -Infinity;
  for (let l = 1; l <= m.levels; l++) {
    const info = expectedInformation(belief, l, m);
    if (info > bestInfo) {
      bestInfo = info;
      best = l;
    }
  }
  return best;
}
