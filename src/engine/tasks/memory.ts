import type { TaskSpec } from './types';

export interface SequenceStim {
  gridSize: 3 | 4;
  /** Cell indices in presentation order. */
  sequence: number[];
  /** ms each cell stays lit. */
  flashMs: number;
  /** ms between two flashes. */
  gapMs: number;
}

/** Number of cells to remember at each level (forward spatial span). */
const SPANS = [2, 3, 4, 5, 6, 6, 7, 8, 8, 9];

export const memoryTask: TaskSpec<SequenceStim> = {
  id: 'sequence-recall',
  dimension: 'memory',
  name: 'Sequence Recall',
  tagline: 'Hold a path in mind and replay it.',
  instructions: [
    'Tiles on the board light up one after another.',
    'Watch the whole sequence — do not click yet.',
    'Then click / tap the tiles in the same order.',
    'Use "Undo" if you misclick. The sequence gets longer as you succeed.',
  ],
  controls: 'Click or tap tiles in order. Backspace = undo.',
  levels: 10,
  discrimination: 1.7,
  guessing: 0,
  assessment: { minTrials: 8, maxTrials: 14, targetSd: 0.42 },
  trainingTrials: 10,
  practiceTrials: 1,
  // Generous window: this task measures holding information, not speed.
  deadlineMs: (level) => 4000 + 1800 * SPANS[level - 1],
  levelDescription: (level) =>
    `${SPANS[level - 1]} tiles on a ${level <= 3 ? '3×3' : '4×4'} board${level >= 6 ? ', faster flashes' : ''}`,
  generate(level, rng) {
    const gridSize: 3 | 4 = level <= 3 ? 3 : 4;
    const cells = gridSize * gridSize;
    const span = SPANS[level - 1];
    const sequence: number[] = [];
    while (sequence.length < span) {
      const c = rng.int(0, cells - 1);
      if (!sequence.includes(c)) sequence.push(c);
    }
    // Levels 6, 8 and 10 shorten the flash: same span, less encoding time.
    const fast = level === 6 || level === 8 || level === 10;
    return { gridSize, sequence, flashMs: fast ? 480 : 650, gapMs: fast ? 180 : 250 };
  },
  metrics(trials) {
    const errors = trials.filter((t) => !t.correct);
    const orderErrors = errors.filter((t) => t.errorType === 'order').length;
    const spans = trials.filter((t) => t.correct).map((t) => Number(t.meta?.span ?? 0));
    const partial = trials.map((t) => Number(t.meta?.positionsCorrect ?? 0) / Math.max(1, Number(t.meta?.span ?? 1)));
    return [
      {
        key: 'span',
        label: 'Longest sequence recalled',
        value: spans.length ? Math.max(...spans) : null,
        unit: 'tiles',
        better: 'higher',
      },
      {
        key: 'positionAccuracy',
        label: 'Positions recalled correctly',
        value: partial.length ? (100 * partial.reduce((s, x) => s + x, 0)) / partial.length : null,
        unit: '%',
        better: 'higher',
        help: 'Partial credit: share of sequence positions you got right, even on missed trials.',
      },
      {
        key: 'orderErrorShare',
        label: 'Errors that were order swaps',
        value: errors.length ? (100 * orderErrors) / errors.length : null,
        unit: '%',
        better: 'neutral',
        help: 'High values mean you remembered WHICH tiles but mixed up WHEN — a chunking strategy helps.',
      },
    ];
  },
  sim: {
    baseRtMs: 2600,
    rtPerLevelMs: 900,
    describe: (stim) => ({ condition: `span-${stim.sequence.length}`, meta: { span: stim.sequence.length } }),
    errorFor: (_stim, rng) => (rng.chance(0.45) ? 'order' : 'item'),
  },
};

export const MEMORY_SPANS = SPANS;
