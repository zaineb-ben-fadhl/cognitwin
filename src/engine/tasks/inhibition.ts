import { conditionAccuracy, conditionRt } from '../metrics';
import type { TaskSpec } from './types';

export type Direction = 'left' | 'right';

export interface FlankerStim {
  /** Direction of the central arrow, or 'stop' for a no-go trial. */
  center: Direction | 'stop';
  /** Direction of the four flanking arrows; 'none' = neutral dashes. */
  flank: Direction | 'none';
  condition: 'congruent' | 'incongruent' | 'neutral' | 'nogo';
}

const params = (level: number) => ({
  pIncongruent: 0.25 + 0.05 * (level - 1),
  pNeutral: level <= 3 ? 0.25 : 0.1,
  pNogo: level < 4 ? 0 : 0.08 + 0.02 * (level - 4),
});

export const inhibitionTask: TaskSpec<FlankerStim> = {
  id: 'arrow-focus',
  dimension: 'inhibition',
  name: 'Arrow Focus',
  tagline: 'Follow the middle arrow, ignore the crowd.',
  instructions: [
    'Five symbols appear in a row. Only the MIDDLE one matters.',
    'Press ← if the middle arrow points left, → if it points right (or tap the buttons).',
    'The outer arrows may point the other way — do not let them pull you.',
    'From level 4: if the middle symbol is a STOP sign, do not press anything.',
  ],
  controls: '← / → arrow keys (or F / J). Do nothing on STOP.',
  levels: 10,
  discrimination: 1.4,
  guessing: 0.2,
  assessment: { minTrials: 16, maxTrials: 28, targetSd: 0.42 },
  trainingTrials: 30,
  practiceTrials: 3,
  deadlineMs: (level) => 1300 - 60 * (level - 1),
  levelDescription: (level) => {
    const p = params(level);
    return `${Math.round(p.pIncongruent * 100)}% conflicting arrows${p.pNogo ? `, ${Math.round(p.pNogo * 100)}% STOP trials` : ''}`;
  },
  generate(level, rng) {
    const p = params(level);
    const dir: Direction = rng.chance(0.5) ? 'left' : 'right';
    const other: Direction = dir === 'left' ? 'right' : 'left';
    const r = rng.next();
    if (r < p.pNogo) return { center: 'stop', flank: rng.chance(0.5) ? dir : other, condition: 'nogo' };
    if (r < p.pNogo + p.pIncongruent) return { center: dir, flank: other, condition: 'incongruent' };
    if (r < p.pNogo + p.pIncongruent + p.pNeutral) return { center: dir, flank: 'none', condition: 'neutral' };
    return { center: dir, flank: dir, condition: 'congruent' };
  },
  metrics(trials) {
    const inc = conditionRt(trials, 'incongruent');
    const con = conditionRt(trials, 'congruent');
    const nogo = trials.filter((t) => t.condition === 'nogo');
    return [
      {
        key: 'interferenceCost',
        label: 'Distraction cost',
        value: inc !== null && con !== null ? inc - con : null,
        unit: 'ms',
        better: 'lower',
        help: 'How much slower you are when the outer arrows disagree with the middle one (incongruent − congruent median RT).',
      },
      {
        key: 'incongruentAccuracy',
        label: 'Accuracy on conflicting arrows',
        value: conditionAccuracy(trials, 'incongruent'),
        unit: '%',
        better: 'higher',
      },
      {
        key: 'stopAccuracy',
        label: 'STOP signals respected',
        value: nogo.length ? (100 * nogo.filter((t) => t.correct).length) / nogo.length : null,
        unit: '%',
        better: 'higher',
      },
    ];
  },
  sim: {
    baseRtMs: 470,
    rtPerLevelMs: 8,
    conditionRtMs: { congruent: 0, neutral: 10, incongruent: 65, nogo: 0 },
    conditionLogit: { congruent: 0.5, neutral: 0.3, incongruent: -0.4, nogo: -0.2 },
    describe: (stim) => ({ condition: stim.condition }),
    errorFor: (stim, rng) => (stim.condition === 'nogo' ? 'commission' : rng.chance(0.3) ? 'omission' : 'wrong_choice'),
  },
};
