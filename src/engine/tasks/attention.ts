import { slope } from '../stats';
import type { TaskSpec } from './types';

export type SearchShape = 'circle' | 'square' | 'triangle' | 'diamond';
/** Abstract tones; the UI maps them to a colour-blind-safe palette or to fill patterns. */
export type Tone = 'A' | 'B' | 'C';

export interface SearchItem {
  shape: SearchShape;
  tone: Tone;
  /** Cell position in the grid. */
  col: number;
  row: number;
  /** Small positional jitter in [-0.18, 0.18] of a cell, so the grid does not look mechanical. */
  dx: number;
  dy: number;
}

export interface SearchStim {
  items: SearchItem[];
  targetIndex: number;
  target: { shape: SearchShape; tone: Tone };
  cols: number;
  rows: number;
  setSize: number;
  /** 'feature' = target differs on one feature (pop-out); 'conjunction' = shares one feature with each distractor type. */
  mode: 'feature' | 'conjunction';
}

const SET_SIZES = [6, 9, 12, 16, 20, 25, 30, 36, 42, 49];
const SHAPES: SearchShape[] = ['circle', 'square', 'triangle', 'diamond'];
const TONES: Tone[] = ['A', 'B', 'C'];

export const attentionTask: TaskSpec<SearchStim> = {
  id: 'target-hunt',
  dimension: 'attention',
  name: 'Target Hunt',
  tagline: 'Find the odd one out — fast.',
  instructions: [
    'A target is shown at the top: one shape in one colour.',
    'Find that exact shape-and-colour among the others and click / tap it.',
    'Some items share the shape, others share the colour — only one matches both.',
    'Be quick but accurate: each grid has a time window.',
  ],
  controls: 'Click or tap the target.',
  levels: 10,
  discrimination: 1.5,
  guessing: 0,
  assessment: { minTrials: 10, maxTrials: 18, targetSd: 0.42 },
  trainingTrials: 16,
  practiceTrials: 2,
  deadlineMs: (level) => Math.round((1500 + 60 * SET_SIZES[level - 1]) * (1 - 0.04 * (level - 1))),
  levelDescription: (level) =>
    `${SET_SIZES[level - 1]} items, ${level <= 2 ? 'target pops out by colour' : level <= 6 ? 'target shares features with distractors' : 'three colours and similar shapes'}`,
  generate(level, rng) {
    const setSize = SET_SIZES[level - 1];
    const cols = Math.ceil(Math.sqrt(setSize * 1.3));
    const rows = Math.ceil(setSize / cols);
    const mode: SearchStim['mode'] = level <= 2 ? 'feature' : 'conjunction';
    const [tShape, otherShape, thirdShape] = rng.shuffle(SHAPES);
    const [tTone, otherTone, thirdTone] = rng.shuffle(TONES);
    const target = { shape: tShape, tone: tTone };

    const distractorKinds: Array<{ shape: SearchShape; tone: Tone }> =
      mode === 'feature'
        ? [{ shape: tShape, tone: otherTone }]
        : level <= 6
          ? [
              { shape: tShape, tone: otherTone },
              { shape: otherShape, tone: tTone },
            ]
          : [
              { shape: tShape, tone: otherTone },
              { shape: otherShape, tone: tTone },
              { shape: tShape, tone: thirdTone },
              { shape: thirdShape, tone: tTone },
            ];

    const cells = rng.shuffle(Array.from({ length: cols * rows }, (_, i) => i)).slice(0, setSize);
    const targetIndex = rng.int(0, setSize - 1);
    const items: SearchItem[] = cells.map((cell, i) => {
      const kind = i === targetIndex ? target : distractorKinds[i % distractorKinds.length];
      return {
        ...kind,
        col: cell % cols,
        row: Math.floor(cell / cols),
        dx: (rng.next() - 0.5) * 0.36,
        dy: (rng.next() - 0.5) * 0.36,
      };
    });
    return { items, targetIndex, target, cols, rows, setSize, mode };
  },
  metrics(trials) {
    const ok = trials.filter((t) => t.correct && t.rtMs !== null && typeof t.meta?.setSize === 'number');
    const s = slope(
      ok.map((t) => t.meta!.setSize as number),
      ok.map((t) => t.rtMs as number),
    );
    const misclicks = trials.filter((t) => t.errorType === 'commission').length;
    return [
      {
        key: 'searchSlope',
        label: 'Search cost per item',
        value: s !== null && ok.length >= 6 ? s : null,
        unit: 'ms/item',
        better: 'lower',
        digits: 1,
        help: 'Extra time needed for each additional item on screen (slope of RT on set size). Lower = more efficient scanning.',
      },
      {
        key: 'misclicks',
        label: 'Distractor clicks',
        value: misclicks,
        better: 'lower',
      },
    ];
  },
  sim: {
    baseRtMs: 900,
    rtPerLevelMs: 140,
    describe: (stim) => ({ condition: stim.mode, meta: { setSize: stim.setSize } }),
    errorFor: (_stim, rng) => (rng.chance(0.6) ? 'omission' : 'commission'),
  },
};

/** Exposed for tests. */
export const ATTENTION_SET_SIZES = SET_SIZES;
