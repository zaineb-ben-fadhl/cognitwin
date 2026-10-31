import { clsx } from 'clsx';
import { Lightbulb } from 'lucide-react';
import { useId, useState } from 'react';
import { cellDiff, type AttrKey, type MatrixCell, type MatrixStim } from '@/engine/tasks/reasoning';
import { Button } from '../ui';
import { Shape, StripeDefs } from './shapes';
import type { TaskModule, TaskViewProps } from './types';
import { useDeadline, useKeys } from './useDeadline';

type Resp = { index: number };

const SIZE: Record<MatrixCell['size'], number> = { S: 0.55, M: 0.78, L: 1 };
const RULE_HINT: Record<string, (a: string) => string> = {
  row: (a) => `Look at the ${a} from left to right — it changes the same way in every row.`,
  col: (a) => `Look at the ${a} from top to bottom — it changes the same way in every column.`,
  latin: (a) => `Each row contains each ${a} exactly once.`,
  latin2: (a) => `Each row contains each ${a} exactly once (in a different arrangement).`,
};
const ATTR_WORD: Record<AttrKey, string> = { shape: 'shape', count: 'number of shapes', fill: 'fill style', size: 'size' };

export function MatrixCellView({ cell, stripeId, box = 60 }: { cell: MatrixCell; stripeId: string; box?: number }) {
  const r = (box / 7.2) * SIZE[cell.size];
  const positions =
    cell.count === 1 ? [[0.5, 0.5]] : cell.count === 2 ? [[0.3, 0.5], [0.7, 0.5]] : [[0.5, 0.28], [0.27, 0.7], [0.73, 0.7]];
  const fill = cell.fill === 'solid' ? 'var(--ink)' : cell.fill === 'outline' ? 'var(--card)' : `url(#${stripeId})`;
  return (
    <svg viewBox={`0 0 ${box} ${box}`} className="h-full w-full" aria-hidden>
      {positions.map(([x, y], i) => (
        <Shape key={i} shape={cell.shape} cx={x * box} cy={y * box} r={r} fill={fill} stroke="var(--ink)" strokeWidth={1.6} />
      ))}
    </svg>
  );
}

function View({ stim, deadlineMs, practice, onRespond }: TaskViewProps<MatrixStim, Resp>) {
  const stripeId = useId().replace(/:/g, '');
  const [hint, setHint] = useState<string | null>(null);
  const timer = useDeadline(deadlineMs, () => onRespond({ response: null, rtMs: null, hintUsed: !!hint }));
  const choose = (index: number) => {
    const rt = timer.stop();
    if (rt !== null) onRespond({ response: { index }, rtMs: rt, hintUsed: !!hint });
  };
  useKeys((k) => {
    const n = Number(k);
    if (n >= 1 && n <= stim.options.length) choose(n - 1);
  });
  const showHint = () => {
    const varying = (Object.keys(stim.rules) as AttrKey[]).filter((k) => stim.rules[k] !== 'constant');
    const k = varying[0];
    if (k) setHint(RULE_HINT[stim.rules[k]](ATTR_WORD[k]));
  };
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <svg width={0} height={0} className="absolute">
        <StripeDefs id={stripeId} color="var(--ink)" />
      </svg>
      <div className="grid w-full max-w-[300px] grid-cols-3 gap-1.5 rounded-2xl border border-line bg-card p-2">
        {stim.cells.map((cell, i) => (
          <div key={i} className={clsx('aspect-square rounded-lg', i === 8 ? 'flex items-center justify-center border-2 border-dashed border-axis text-2xl font-semibold text-muted' : 'bg-card-2')}>
            {i === 8 ? '?' : <MatrixCellView cell={cell} stripeId={stripeId} />}
          </div>
        ))}
      </div>
      <div className={clsx('grid w-full max-w-[460px] gap-2', stim.options.length <= 4 ? 'grid-cols-4' : stim.options.length <= 6 ? 'grid-cols-3 sm:grid-cols-6' : 'grid-cols-4 sm:grid-cols-8')}>
        {stim.options.map((o, i) => (
          <button
            key={i}
            type="button"
            onClick={() => choose(i)}
            className="relative aspect-square rounded-xl border border-line bg-card-2 p-1 transition-colors hover:border-brand focus-visible:border-brand"
            aria-label={`Option ${i + 1}`}
          >
            <span className="absolute left-1.5 top-1 text-[10px] text-muted">{i + 1}</span>
            <MatrixCellView cell={o} stripeId={stripeId} />
          </button>
        ))}
      </div>
      <div className="min-h-[36px] text-center">
        {hint ? (
          <p className="max-w-md text-[13px] text-ink-2">
            <Lightbulb size={14} className="mr-1 inline" />
            {hint}
          </p>
        ) : (
          !practice && (
            <Button size="sm" variant="ghost" onClick={showHint}>
              <Lightbulb size={14} /> Hint (this trial counts less)
            </Button>
          )
        )}
      </div>
    </div>
  );
}

export const patternLogicModule: TaskModule<MatrixStim, Resp> = {
  View,
  evaluate(stim, response) {
    if (!response) return { correct: false, errorType: 'omission' };
    const correct = response.index === stim.answerIndex;
    if (correct) return { correct };
    const diff = cellDiff(stim.options[response.index], stim.options[stim.answerIndex]);
    return { correct, errorType: 'wrong_choice', meta: diff.length ? { missedAttr: diff[0] } : undefined };
  },
  explainError: (stim, response) => {
    if (!response) return 'Time ran out — check one attribute at a time.';
    const diff = cellDiff(stim.options[response.index], stim.options[stim.answerIndex]);
    return diff.length ? `Close — the ${ATTR_WORD[diff[0]]} did not follow the rule.` : 'Not quite.';
  },
};
