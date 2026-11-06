/**
 * Data-quality checks. A score is only as good as the session that produced it, so every
 * session gets a reliability label and a weight that tempers its influence on the Brain Twin.
 *
 * Rapid guessing ("button mashing") is handled with the effort-moderated approach from
 * psychometrics (Wise & DeMars, 2006): responses faster than the plausible minimum for their
 * level AND no better than guessing carry no information about ability, so they are removed
 * from the likelihood instead of being read as a collapse in skill. The session is then
 * flagged as highly uncertain: its posterior gets extra variance, so the twin becomes less
 * sure of itself rather than confidently wrong.
 */
import type { AnyTaskSpec } from './tasks/types';
import type { BehaviourLog, QualityFlag, QualityReport, RapidGuessAnomaly, Trial } from './types';
import { median } from './stats';

export const ANTICIPATION_MS = 150;

/**
 * Normative-threshold rule (Wise & Ma, 2012): a response faster than this share of the typical
 * response time at its level cannot reflect processing of the stimulus.
 */
export const RAPID_FRACTION = 0.3;
/** Rapid responses this accurate (or better) are genuine fast responding, not guessing. */
export const RAPID_ACCURACY_CEILING = 0.6;
/** Minimum share / count of rapid responses before a session is flagged. */
export const RAPID_MIN_SHARE = 0.3;
export const RAPID_MIN_COUNT = 4;

/** Plausible minimum response time (ms) for one level of a task. */
export function rapidThresholdMs(task: AnyTaskSpec, level: number): number {
  return Math.max(ANTICIPATION_MS, Math.round(RAPID_FRACTION * (task.sim.baseRtMs + task.sim.rtPerLevelMs * (level - 1))));
}

export function isRapid(task: AnyTaskSpec, t: Trial): boolean {
  return t.rtMs !== null && t.rtMs < rapidThresholdMs(task, t.level);
}

export interface RapidStats {
  responded: number;
  rapid: number;
  rapidShare: number;
  rapidAccuracy: number | null;
  medianRapidRtMs: number | null;
  thresholdMs: number | null;
}

export function rapidStats(task: AnyTaskSpec, trials: readonly Trial[]): RapidStats {
  const responded = trials.filter((t) => t.rtMs !== null);
  const rapid = responded.filter((t) => isRapid(task, t));
  return {
    responded: responded.length,
    rapid: rapid.length,
    rapidShare: responded.length ? rapid.length / responded.length : 0,
    rapidAccuracy: rapid.length ? rapid.filter((t) => t.correct).length / rapid.length : null,
    medianRapidRtMs: median(rapid.map((t) => t.rtMs)),
    thresholdMs: median(rapid.map((t) => rapidThresholdMs(task, t.level))),
  };
}

/** Session-level rule: many implausibly fast answers that are no better than guessing. */
export function detectRapidGuessing(task: AnyTaskSpec, trials: readonly Trial[]): RapidGuessAnomaly | null {
  const s = rapidStats(task, trials);
  if (s.rapid < RAPID_MIN_COUNT || s.rapidShare < RAPID_MIN_SHARE || (s.rapidAccuracy ?? 1) > RAPID_ACCURACY_CEILING) return null;
  return {
    kind: 'rapid_guessing',
    responded: s.responded,
    rapid: s.rapid,
    rapidShare: Math.round(s.rapidShare * 100) / 100,
    rapidAccuracy: Math.round((s.rapidAccuracy ?? 0) * 100) / 100,
    medianRapidRtMs: Math.round(s.medianRapidRtMs ?? 0),
    thresholdMs: Math.round(s.thresholdMs ?? ANTICIPATION_MS),
    effort: Math.round((1 - s.rapidShare) * 100) / 100,
  };
}

/**
 * Live version used by the task runner: among the last six answers, at least four were
 * implausibly fast and most of those were wrong. Triggers the coach's "are you rushing?" check.
 */
export function liveRapidGuessing(task: AnyTaskSpec, trials: readonly Trial[]): boolean {
  const recent = trials.slice(-6).filter((t) => t.rtMs !== null);
  if (recent.length >= 5) {
    const rapid = recent.filter((t) => isRapid(task, t));
    if (rapid.length >= 4 && rapid.filter((t) => t.correct).length / rapid.length <= 0.5) return true;
  }
  // Two-choice tasks: a coin-flip hit rate at a pace well under the typical response time.
  if (task.guessing >= 0.2) {
    const last = trials.slice(-8).filter((t) => t.rtMs !== null);
    if (last.length < 8) return false;
    const typical = median(last.map((t) => task.sim.baseRtMs + task.sim.rtPerLevelMs * (t.level - 1))) ?? task.sim.baseRtMs;
    const med = median(last.map((t) => t.rtMs)) ?? Infinity;
    return med < 0.75 * typical && last.filter((t) => t.correct).length / last.length <= 0.55;
  }
  return false;
}

/** True when the session's data was judged to be rapid guessing or random pressing. */
export function isMashedSession(q: QualityReport): boolean {
  return q.flags.some((f) => f.kind === 'rapid_guessing' || f.kind === 'random_responding');
}

/** Extra posterior variance for a rapid-guessing session: grows with the share of guesses. */
export function rapidUncertainty(anomaly: RapidGuessAnomaly): number {
  return Math.round((0.1 + 0.3 * anomaly.rapidShare) * 1000) / 1000;
}

export function assessQuality(task: AnyTaskSpec, trials: readonly Trial[], behaviour: BehaviourLog): QualityReport {
  const flags: QualityFlag[] = [];
  let weight = 1;
  let floor = 0.4;
  let uncertaintyInflation = 0;
  const n = trials.length;
  const anomaly = n >= 6 ? detectRapidGuessing(task, trials) : null;

  if (behaviour.focusLosses >= 2 || behaviour.hiddenMs >= 10_000) {
    flags.push({
      kind: 'interruptions',
      severity: 'warn',
      detail: `The window lost focus ${behaviour.focusLosses}× (${Math.round(behaviour.hiddenMs / 1000)} s away). Trials right after each return count less.`,
    });
    weight -= 0.2;
  } else if (behaviour.focusLosses === 1) {
    flags.push({ kind: 'interruptions', severity: 'info', detail: 'One short interruption was detected; the next trial counted less.' });
  }

  if (anomaly) {
    const said = behaviour.rushChecks?.find((c) => c.answer === 'rushing' || c.answer === 'distracted')?.answer;
    flags.push({
      kind: 'rapid_guessing',
      severity: 'warn',
      detail:
        `${anomaly.rapid} of ${anomaly.responded} answers came faster than the plausible minimum (≈ ${anomaly.thresholdMs} ms, median ${anomaly.medianRapidRtMs} ms) ` +
        `and only ${Math.round(anomaly.rapidAccuracy * 100)} % of them were right — that looks like rushing, not ability. ` +
        `They were left out of the estimate and this session is marked as highly uncertain${said ? ` (you said you were ${said})` : ''}.`,
    });
    // The remaining answers came from the same disengaged state: they keep only the floor weight,
    // so they can contribute but never drive the estimate.
    weight = 0.2;
    floor = 0.2;
    uncertaintyInflation = rapidUncertainty(anomaly);
  } else {
    const anticipations = trials.filter((t) => t.rtMs !== null && t.rtMs < ANTICIPATION_MS).length;
    if (n >= 6 && anticipations / n > 0.1) {
      flags.push({
        kind: 'anticipations',
        severity: 'warn',
        detail: `${anticipations} responses were faster than ${ANTICIPATION_MS} ms — too fast to be based on what was on screen.`,
      });
      weight -= 0.2;
    }

    // Two-choice tasks: accuracy indistinguishable from coin-flipping, combined with very fast responses.
    if (task.guessing >= 0.2 && n >= 12) {
      const acc = trials.filter((t) => t.correct).length / n;
      const z = (acc - 0.5) / Math.sqrt(0.25 / n);
      const med = median(trials.map((t) => t.rtMs));
      if (z < 1 && med !== null && med < 450) {
        flags.push({
          kind: 'random_responding',
          severity: 'warn',
          detail: `Accuracy (${Math.round(acc * 100)} %) was close to chance with very fast responses, which looks like random pressing.`,
        });
        // Random pressing carries almost no information about ability, and the guesses cannot be
        // told apart trial by trial on a two-choice task: the whole session keeps a token weight.
        weight = 0.1;
        floor = 0.1;
        uncertaintyInflation = 0.2;
      }
    }
  }

  const minUseful = Math.ceil(task.assessment.minTrials / 2);
  if (n < minUseful) {
    flags.push({ kind: 'too_few_trials', severity: 'warn', detail: `Only ${n} trials — the profile moved very little.` });
    weight -= 0.1;
  }
  if (behaviour.longPauses >= 2) {
    flags.push({ kind: 'long_pauses', severity: 'info', detail: `${behaviour.longPauses} long pauses were detected.` });
  }
  if (behaviour.quitEarly) {
    flags.push({ kind: 'quit_early', severity: 'info', detail: 'The session was stopped early; completed trials still count.' });
  }

  weight = Math.max(floor, Math.round(weight * 100) / 100);
  const report: QualityReport = { flags, weight, reliability: weight >= 0.9 ? 'good' : weight >= 0.7 ? 'fair' : 'poor' };
  if (uncertaintyInflation > 0) report.uncertaintyInflation = uncertaintyInflation;
  if (anomaly) report.anomaly = anomaly;
  return report;
}
