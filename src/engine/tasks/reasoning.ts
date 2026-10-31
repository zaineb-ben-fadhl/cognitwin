import { median } from '../stats';
import type { Rng } from '../rng';
import type { TaskSpec } from './types';

export type MatrixShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'hexagon' | 'star';
export type Fill = 'solid' | 'outline' | 'striped';
export type Size = 'S' | 'M' | 'L';
export type AttrKey = 'shape' | 'count' | 'fill' | 'size';
export type RuleKind = 'constant' | 'row' | 'col' | 'latin' | 'latin2';

export interface MatrixCell {
  shape: MatrixShape;
  count: 1 | 2 | 3;
  fill: Fill;
  size: Size;
}

export interface MatrixStim {
  /** Nine cells row by row; index 8 is the hidden answer. */
  cells: MatrixCell[];
  options: MatrixCell[];
  answerIndex: number;
  rules: Record<AttrKey, RuleKind>;
}

const ALL_SHAPES: MatrixShape[] = ['circle', 'square', 'triangle', 'diamond', 'hexagon', 'star'];
const DOMAIN: { [K in AttrKey]: MatrixCell[K][] } = {
  shape: ALL_SHAPES,
  count: [1, 2, 3],
  fill: ['solid', 'outline', 'striped'],
  size: ['S', 'M', 'L'],
};
const ATTRS: AttrKey[] = ['shape', 'count', 'fill', 'size'];

/** Rules used by the varying attributes at each level (the rest stay constant). */
const LEVEL_RULES: RuleKind[][] = [
  ['row'],
  ['latin'],
  ['row', 'col'],
  ['row', 'latin'],
  ['latin', 'latin2'],
  ['row', 'col', 'latin'],
  ['row', 'latin', 'latin2'],
  ['row', 'col', 'latin', 'latin2'],
  ['row', 'latin', 'latin2', 'latin'],
  ['latin', 'latin2', 'latin', 'latin2'],
];

const optionCount = (level: number) => (level <= 3 ? 4 : level <= 7 ? 6 : 8);

function valueIndex(rule: RuleKind, r: number, c: number, k: number): number {
  switch (rule) {
    case 'constant':
      return k;
    case 'row':
      return c;
    case 'col':
      return r;
    case 'latin':
      return (r + c) % 3;
    case 'latin2':
      return (c - r + 3) % 3;
  }
}

export const sameCell = (a: MatrixCell, b: MatrixCell) => ATTRS.every((k) => a[k] === b[k]);

export const cellDiff = (a: MatrixCell, b: MatrixCell): AttrKey[] => ATTRS.filter((k) => a[k] !== b[k]);

function buildDistractors(answer: MatrixCell, varying: AttrKey[], need: number, rng: Rng): MatrixCell[] {
  const out: MatrixCell[] = [];
  const push = (cell: MatrixCell) => {
    if (!sameCell(cell, answer) && !out.some((o) => sameCell(o, cell))) out.push(cell);
  };
  // 1) single-attribute changes on the attributes that carry a rule (most plausible lures)
  const single = (attrs: AttrKey[]) =>
    rng.shuffle(
      attrs.flatMap((k) =>
        (DOMAIN[k] as MatrixCell[AttrKey][]).filter((v) => v !== answer[k]).map((v) => ({ ...answer, [k]: v }) as MatrixCell),
      ),
    );
  for (const c of single(varying)) {
    if (out.length >= need) break;
    push(c);
  }
  // 2) single changes on constant attributes, then 3) double changes
  const constant = ATTRS.filter((k) => !varying.includes(k));
  for (const c of single(constant)) {
    if (out.length >= need) break;
    push(c);
  }
  let guard = 0;
  while (out.length < need && guard++ < 200) {
    const [k1, k2] = rng.shuffle(ATTRS);
    push({
      ...answer,
      [k1]: rng.pick(DOMAIN[k1] as MatrixCell[AttrKey][]),
      [k2]: rng.pick(DOMAIN[k2] as MatrixCell[AttrKey][]),
    } as MatrixCell);
  }
  return out;
}

export const reasoningTask: TaskSpec<MatrixStim> = {
  id: 'pattern-logic',
  dimension: 'reasoning',
  name: 'Pattern Logic',
  tagline: 'Discover the hidden rules of the grid.',
  instructions: [
    'A 3×3 grid follows hidden rules across its rows and columns.',
    'Rules can involve the shape, how many there are, the fill style, or the size.',
    'Pick the option that completes the bottom-right cell.',
    'Take your time — accuracy matters more than speed here.',
  ],
  controls: 'Click / tap an option, or press its number key.',
  levels: 10,
  discrimination: 1.4,
  guessing: 0.15,
  assessment: { minTrials: 7, maxTrials: 12, targetSd: 0.48 },
  trainingTrials: 8,
  practiceTrials: 1,
  deadlineMs: (level) => 30000 + 4000 * level,
  levelDescription: (level) =>
    `${LEVEL_RULES[level - 1].length} rule${LEVEL_RULES[level - 1].length > 1 ? 's' : ''} at once, ${optionCount(level)} options`,
  generate(level, rng) {
    const ruleList = LEVEL_RULES[level - 1];
    const varying = rng.shuffle(ATTRS).slice(0, ruleList.length);
    const rules = Object.fromEntries(ATTRS.map((k) => [k, 'constant'])) as Record<AttrKey, RuleKind>;
    varying.forEach((k, i) => (rules[k] = ruleList[i]));

    // Three values per attribute for this puzzle; count and size keep their natural order.
    const values: { [K in AttrKey]: MatrixCell[K][] } = {
      shape: rng.shuffle(ALL_SHAPES).slice(0, 3),
      count: [1, 2, 3],
      fill: rng.shuffle(DOMAIN.fill),
      size: ['S', 'M', 'L'],
    };
    const constIdx = Object.fromEntries(ATTRS.map((k) => [k, rng.int(0, 2)])) as Record<AttrKey, number>;

    const cells: MatrixCell[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const cell = {} as MatrixCell;
        for (const k of ATTRS) {
          (cell as unknown as Record<AttrKey, unknown>)[k] = values[k][valueIndex(rules[k], r, c, constIdx[k])];
        }
        cells.push(cell);
      }
    }
    const answer = cells[8];
    const distractors = buildDistractors(answer, varying, optionCount(level) - 1, rng);
    const options = rng.shuffle([answer, ...distractors]);
    return { cells, options, answerIndex: options.findIndex((o) => sameCell(o, answer)), rules };
  },
  metrics(trials) {
    const hard = trials.filter((t) => t.level >= 5);
    const missed = trials.filter((t) => !t.correct && typeof t.meta?.missedAttr === 'string').map((t) => String(t.meta!.missedAttr));
    return [
      {
        key: 'solveTime',
        label: 'Median solving time',
        value: (() => {
          const m = median(trials.filter((t) => t.correct).map((t) => t.rtMs));
          return m === null ? null : m / 1000;
        })(),
        unit: 's',
        better: 'neutral',
        digits: 1,
        help: 'Time is reported but not rewarded: careful reasoning is fine.',
      },
      {
        key: 'multiRuleAccuracy',
        label: 'Accuracy on multi-rule grids',
        value: hard.length ? (100 * hard.filter((t) => t.correct).length) / hard.length : null,
        unit: '%',
        better: 'higher',
      },
      {
        key: 'rulesMissed',
        label: 'Rule slips',
        value: missed.length,
        better: 'lower',
        help: 'Number of answers that broke exactly one of the grid rules.',
      },
    ];
  },
  sim: {
    baseRtMs: 9000,
    rtPerLevelMs: 2600,
    describe: (stim) => ({ condition: `${Object.values(stim.rules).filter((r) => r !== 'constant').length}-rules` }),
    errorFor: () => 'wrong_choice',
  },
};

export const REASONING_LEVEL_RULES = LEVEL_RULES;
