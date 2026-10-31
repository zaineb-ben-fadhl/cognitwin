import { cv, mean, median } from './stats';
import type { MetricValue, Trial } from './types';

const pct = (num: number, den: number) => (den ? (100 * num) / den : null);

/** Metrics shared by every task: score, response time, error rate and consistency. */
export function commonMetrics(trials: readonly Trial[]): MetricValue[] {
  const n = trials.length;
  const correctRts = trials.filter((t) => t.correct && t.rtMs !== null).map((t) => t.rtMs);
  const passed = trials.filter((t) => t.success).map((t) => t.level);
  return [
    {
      key: 'accuracy',
      label: 'Accuracy',
      value: pct(trials.filter((t) => t.correct).length, n),
      unit: '%',
      better: 'higher',
      help: 'Share of responses that were correct, regardless of speed.',
    },
    {
      key: 'successRate',
      label: 'On-time success',
      value: pct(trials.filter((t) => t.success).length, n),
      unit: '%',
      better: 'higher',
      help: 'Correct AND within the response window. This is what the profile model uses.',
    },
    {
      key: 'errorRate',
      label: 'Error rate',
      value: pct(trials.filter((t) => !t.correct).length, n),
      unit: '%',
      better: 'lower',
    },
    {
      key: 'medianRt',
      label: 'Median response time',
      value: median(correctRts),
      unit: 'ms',
      better: 'lower',
      help: 'Median over correct responses — robust to a few slow outliers.',
    },
    {
      key: 'rtCv',
      label: 'Response-time variability',
      value: correctRts.length >= 4 ? cv(correctRts) : null,
      better: 'lower',
      digits: 2,
      help: 'Coefficient of variation (sd / mean). Lower means a steadier rhythm.',
    },
    {
      key: 'maxLevel',
      label: 'Highest level passed',
      value: passed.length ? Math.max(...passed) : null,
      better: 'higher',
    },
    {
      key: 'meanLevel',
      label: 'Average level',
      value: mean(trials.map((t) => t.level)),
      better: 'higher',
      digits: 1,
    },
  ];
}

/** Fewer correct trials than this in a condition make its median too noisy to report. */
export const MIN_CONDITION_TRIALS = 4;

/** Median RT of correct trials in one condition (null when there are too few to be meaningful). */
export function conditionRt(trials: readonly Trial[], condition: string): number | null {
  const rts = trials.filter((t) => t.condition === condition && t.correct && t.rtMs !== null).map((t) => t.rtMs);
  return rts.length >= MIN_CONDITION_TRIALS ? median(rts) : null;
}

export function conditionAccuracy(trials: readonly Trial[], condition: string): number | null {
  const subset = trials.filter((t) => t.condition === condition);
  return pct(subset.filter((t) => t.correct).length, subset.length);
}

export function metric(list: readonly MetricValue[], key: string): number | null {
  return list.find((m) => m.key === key)?.value ?? null;
}
