import { conditionRt } from '../metrics';
import type { TaskSpec } from './types';

/** Language-free glyph identifiers, rendered as SVG in the UI. */
export const GLYPHS = ['circle', 'square', 'triangle', 'tri-down', 'diamond', 'star', 'cross', 'hexagon', 'half', 'ring'] as const;
export type Glyph = (typeof GLYPHS)[number];

export interface MatchStim {
  left: Glyph[];
  right: Glyph[];
  same: boolean;
  /** How the 'different' pair was built: one symbol replaced, or two neighbours swapped (harder). */
  change: 'none' | 'replace' | 'swap';
}

const lengthFor = (level: number) => 2 + Math.floor((level - 1) / 2);

export const speedTask: TaskSpec<MatchStim> = {
  id: 'symbol-sprint',
  dimension: 'speed',
  name: 'Symbol Sprint',
  tagline: 'Same or different? Decide in a flash.',
  instructions: [
    'Two rows of symbols appear side by side.',
    'Decide as quickly as you can whether they are exactly the SAME or DIFFERENT.',
    'Keyboard: F = same, J = different. Or tap the buttons.',
    'The rows get longer and the window gets shorter as you improve.',
  ],
  controls: 'F / ← = Same · J / → = Different',
  levels: 10,
  discrimination: 1.5,
  guessing: 0.2,
  assessment: { minTrials: 14, maxTrials: 24, targetSd: 0.42 },
  trainingTrials: 24,
  practiceTrials: 3,
  deadlineMs: (level) => Math.round((700 + 280 * lengthFor(level)) * (level % 2 === 1 ? 1 : 0.82)),
  levelDescription: (level) =>
    `${lengthFor(level)} symbols per row${level % 2 === 0 ? ', shorter window, swapped symbols' : ''}`,
  generate(level, rng) {
    const len = lengthFor(level);
    const left = Array.from({ length: len }, () => rng.pick(GLYPHS));
    const same = rng.chance(0.5);
    if (same) return { left, right: left.slice(), same, change: 'none' };
    const right = left.slice();
    const swap = level % 2 === 0 && len >= 2 && rng.chance(0.6);
    if (swap) {
      // Swap two neighbours that differ, otherwise fall back to a replacement.
      const candidates = right.map((_, i) => i).filter((i) => i < len - 1 && right[i] !== right[i + 1]);
      if (candidates.length) {
        const i = rng.pick(candidates);
        [right[i], right[i + 1]] = [right[i + 1], right[i]];
        return { left, right, same: false, change: 'swap' };
      }
    }
    const i = rng.int(0, len - 1);
    right[i] = rng.pick(GLYPHS.filter((g) => g !== left[i]));
    return { left, right, same: false, change: 'replace' };
  },
  metrics(trials) {
    const minutes = trials.reduce((s, t) => s + (t.rtMs ?? t.deadlineMs), 0) / 60000;
    const correct = trials.filter((t) => t.correct).length;
    return [
      {
        key: 'throughput',
        label: 'Correct decisions per minute',
        value: minutes > 0 ? correct / minutes : null,
        unit: '/min',
        better: 'higher',
        digits: 1,
      },
      {
        key: 'sameRt',
        label: 'Median RT on "same" pairs',
        value: conditionRt(trials, 'same'),
        unit: 'ms',
        better: 'lower',
      },
      {
        key: 'diffRt',
        label: 'Median RT on "different" pairs',
        value: conditionRt(trials, 'different'),
        unit: 'ms',
        better: 'lower',
      },
    ];
  },
  sim: {
    baseRtMs: 650,
    rtPerLevelMs: 110,
    conditionRtMs: { same: 80, different: 0 },
    describe: (stim) => ({
      condition: stim.same ? 'same' : 'different',
      meta: { length: stim.left.length, change: stim.change },
    }),
    errorFor: (_stim, rng) => (rng.chance(0.35) ? 'omission' : 'wrong_choice'),
  },
};
