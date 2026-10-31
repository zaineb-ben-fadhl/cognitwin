import { conditionAccuracy, conditionRt } from '../metrics';
import type { TaskSpec } from './types';

export type SwitchRule = 'shape' | 'tone';
export type SwitchShape = 'circle' | 'square';
export type SwitchTone = 'A' | 'B';

export interface SwitchStim {
  rule: SwitchRule;
  shape: SwitchShape;
  tone: SwitchTone;
  isSwitch: boolean;
  /** Both rules lead to the same key (no conflict). */
  congruent: boolean;
  /** Time the rule cue is visible before the shape appears. */
  cueLeadMs: number;
}

/** Response mapping shared by the UI and the scorer: left = circle / tone A, right = square / tone B. */
export const switchAnswer = (stim: Pick<SwitchStim, 'rule' | 'shape' | 'tone'>): 'left' | 'right' =>
  stim.rule === 'shape' ? (stim.shape === 'circle' ? 'left' : 'right') : stim.tone === 'A' ? 'left' : 'right';

const params = (level: number) => ({
  pSwitch: 0.2 + 0.035 * (level - 1),
  pIncongruent: 0.5 + 0.035 * (level - 1),
  cueLeadMs: Math.max(60, 600 - 60 * (level - 1)),
});

export const flexibilityTask: TaskSpec<SwitchStim> = {
  id: 'rule-switch',
  dimension: 'flexibility',
  name: 'Rule Switch',
  tagline: 'Sort by shape… or by colour. The rule keeps changing.',
  instructions: [
    'A banner tells you the current rule: SHAPE or COLOUR.',
    'SHAPE rule: circle → left, square → right.',
    'COLOUR rule: the left colour → left, the right colour → right.',
    'Watch the banner: the rule can switch at any moment.',
  ],
  controls: '← / F = left · → / J = right',
  levels: 10,
  discrimination: 1.4,
  guessing: 0.2,
  assessment: { minTrials: 16, maxTrials: 28, targetSd: 0.42 },
  trainingTrials: 28,
  practiceTrials: 4,
  deadlineMs: (level) => 2400 - 130 * (level - 1),
  levelDescription: (level) => {
    const p = params(level);
    return `${Math.round(p.pSwitch * 100)}% rule switches, cue ${p.cueLeadMs} ms ahead`;
  },
  generate(level, rng, index, prev) {
    const p = params(level);
    const isSwitch = index > 0 && prev !== undefined && rng.chance(p.pSwitch);
    const rule: SwitchRule = prev ? (isSwitch ? (prev.rule === 'shape' ? 'tone' : 'shape') : prev.rule) : rng.pick(['shape', 'tone'] as const);
    const incongruent = rng.chance(p.pIncongruent);
    const shape: SwitchShape = rng.pick(['circle', 'square'] as const);
    // Congruent: circle↔A, square↔B. Incongruent: the opposite pairing.
    const tone: SwitchTone = (shape === 'circle') !== incongruent ? 'A' : 'B';
    return { rule, shape, tone, isSwitch, congruent: !incongruent, cueLeadMs: p.cueLeadMs };
  },
  metrics(trials) {
    const sw = conditionRt(trials, 'switch');
    const rep = conditionRt(trials, 'repeat');
    const swAcc = conditionAccuracy(trials, 'switch');
    const repAcc = conditionAccuracy(trials, 'repeat');
    const persev = trials.filter((t) => t.errorType === 'perseveration').length;
    const errors = trials.filter((t) => !t.correct).length;
    return [
      {
        key: 'switchCost',
        label: 'Switch cost',
        value: sw !== null && rep !== null ? sw - rep : null,
        unit: 'ms',
        better: 'lower',
        help: 'Extra time needed right after the rule changes (switch − repeat median RT).',
      },
      {
        key: 'switchAccuracyCost',
        label: 'Accuracy drop on switches',
        value: swAcc !== null && repAcc !== null ? repAcc - swAcc : null,
        unit: 'pts',
        better: 'lower',
      },
      {
        key: 'perseverationShare',
        label: 'Errors from the old rule',
        value: errors ? (100 * persev) / errors : null,
        unit: '%',
        better: 'lower',
        help: 'Share of errors where you applied the previous rule — a sign the switch was not fully made yet.',
      },
    ];
  },
  sim: {
    baseRtMs: 680,
    rtPerLevelMs: 12,
    conditionRtMs: { repeat: 0, switch: 170 },
    conditionLogit: { repeat: 0.3, switch: -0.6 },
    describe: (stim) => ({
      condition: stim.isSwitch ? 'switch' : 'repeat',
      meta: { rule: stim.rule, congruent: stim.congruent },
    }),
    errorFor: (stim, rng) =>
      stim.isSwitch && !stim.congruent && rng.chance(0.6) ? 'perseveration' : rng.chance(0.25) ? 'omission' : 'wrong_choice',
  },
};
