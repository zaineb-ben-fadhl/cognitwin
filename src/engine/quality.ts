/**
 * Data-quality checks. A score is only as good as the session that produced it, so every
 * session gets a reliability label and a weight that tempers its influence on the Brain Twin.
 */
import type { AnyTaskSpec } from './tasks/types';
import type { BehaviourLog, QualityFlag, QualityReport, Trial } from './types';
import { median } from './stats';

export const ANTICIPATION_MS = 150;

export function assessQuality(task: AnyTaskSpec, trials: readonly Trial[], behaviour: BehaviourLog): QualityReport {
  const flags: QualityFlag[] = [];
  let weight = 1;
  let floor = 0.4;
  const n = trials.length;

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
      // Random pressing carries almost no information about ability.
      weight -= 0.7;
      floor = 0.2;
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
  return { flags, weight, reliability: weight >= 0.9 ? 'good' : weight >= 0.7 ? 'fair' : 'poor' };
}
