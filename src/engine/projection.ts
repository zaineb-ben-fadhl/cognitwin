/**
 * Predictive cognitive growth — always with uncertainty, never as certainty.
 *
 * Model: θ(t) = α + β · log(1 + t / τ), a saturating practice curve (τ = 7 days), fitted by
 * Bayesian linear regression on the twin's history. History points are autocorrelated
 * (each posterior builds on the previous one), so observation variances are inflated.
 * The predictive variance adds an "unknown change" term that grows with the horizon, so
 * bands always fan out. Returns null (with a reason) when there is not enough history.
 */
import { mastery, thetaForMastery, type MeasurementModel } from './irt';
import type { HistoryPoint } from './twin';
import { Z50, Z80, normCdf } from './stats';

const DAY = 86_400_000;
const TAU_DAYS = 7;
const MODEL_SD = 0.22;
const AUTOCORR_INFLATION = 2.5;
const DRIFT_PER_DAY = 0.004;
const PRIOR_BETA = { mean: 0.15, sd: 0.4 };
const PRIOR_ALPHA_SD = 1.0;

export interface ProjectionPoint {
  at: number;
  /** Score scale (0–100). */
  mid: number;
  lo80: number;
  hi80: number;
  lo50: number;
  hi50: number;
}

export interface Projection {
  points: ProjectionPoint[];
  /** Expected change in score over the next 7 days (points). */
  weeklyChange: number;
  /** Predictive θ distribution at the horizon. */
  horizon: { mean: number; sd: number; at: number };
  basedOn: number;
  fit: { alpha: number; beta: number; betaSd: number };
}

export type ProjectionResult = { ok: true; projection: Projection } | { ok: false; reason: string };

const feature = (tDays: number) => Math.log(1 + Math.max(0, tDays) / TAU_DAYS);

export function fitGrowth(history: readonly HistoryPoint[]) {
  const t0 = history[0].at;
  const ys = history.map((h) => h.mean);
  const meanY = ys.reduce((s, y) => s + y, 0) / ys.length;
  // Prior precision (diagonal) and prior mean.
  let a11 = 1 / PRIOR_ALPHA_SD ** 2;
  let a12 = 0;
  let a22 = 1 / PRIOR_BETA.sd ** 2;
  let b1 = meanY / PRIOR_ALPHA_SD ** 2;
  let b2 = PRIOR_BETA.mean / PRIOR_BETA.sd ** 2;
  for (const h of history) {
    const x = feature((h.at - t0) / DAY);
    const w = 1 / (AUTOCORR_INFLATION * (h.sd ** 2 + MODEL_SD ** 2));
    a11 += w;
    a12 += w * x;
    a22 += w * x * x;
    b1 += w * h.mean;
    b2 += w * x * h.mean;
  }
  const det = a11 * a22 - a12 * a12;
  const cov = { s11: a22 / det, s12: -a12 / det, s22: a11 / det };
  const alpha = cov.s11 * b1 + cov.s12 * b2;
  const beta = cov.s12 * b1 + cov.s22 * b2;
  return { t0, alpha, beta, cov };
}

export function project(
  history: readonly HistoryPoint[],
  model: MeasurementModel,
  now: number,
  horizonDays = 28,
): ProjectionResult {
  if (!Number.isFinite(now) || !Number.isFinite(horizonDays) || horizonDays < 0 || horizonDays > 3650)
    return { ok: false, reason: 'Projection horizon must be between 0 and 3650 days.' };
  if (history.length < 3) return { ok: false, reason: `Needs at least 3 sessions (has ${history.length}).` };
  const spanDays = (history.at(-1)!.at - history[0].at) / DAY;
  if (spanDays < 2) return { ok: false, reason: 'Needs sessions spread over at least 2 days.' };

  const { t0, alpha, beta, cov } = fitGrowth(history);
  const last = history.at(-1)!;
  const predict = (at: number) => {
    const x = feature((at - t0) / DAY);
    const mean = alpha + beta * x;
    const varParam = cov.s11 + 2 * x * cov.s12 + x * x * cov.s22;
    const ahead = Math.max(0, (at - last.at) / DAY);
    const sd = Math.sqrt(varParam + MODEL_SD ** 2 + DRIFT_PER_DAY * ahead);
    return { mean, sd };
  };

  const points: ProjectionPoint[] = [];
  const start = Math.max(now, last.at);
  for (let d = 0; d <= horizonDays; d += 2) {
    const at = start + d * DAY;
    const { mean, sd } = predict(at);
    points.push({
      at,
      mid: mastery(mean, model),
      lo80: mastery(mean - Z80 * sd, model),
      hi80: mastery(mean + Z80 * sd, model),
      lo50: mastery(mean - Z50 * sd, model),
      hi50: mastery(mean + Z50 * sd, model),
    });
  }
  const h = predict(start + horizonDays * DAY);
  const weekly = mastery(predict(start + 7 * DAY).mean, model) - mastery(predict(start).mean, model);
  return {
    ok: true,
    projection: {
      points,
      weeklyChange: weekly,
      horizon: { ...h, at: start + horizonDays * DAY },
      basedOn: history.length,
      fit: { alpha, beta, betaSd: Math.sqrt(cov.s22) },
    },
  };
}

/** Model-based probability that the score is ≥ target at `deadline`, assuming practice continues. */
export function goalProbability(
  history: readonly HistoryPoint[],
  model: MeasurementModel,
  target: number,
  deadline: number,
  now: number,
): number | null {
  if (deadline <= now) return null;
  const days = Math.ceil((deadline - now) / DAY);
  const res = project(history, model, now, days);
  if (!res.ok) return null;
  const { mean, sd } = res.projection.horizon;
  return 1 - normCdf((thetaForMastery(target, model) - mean) / sd);
}
