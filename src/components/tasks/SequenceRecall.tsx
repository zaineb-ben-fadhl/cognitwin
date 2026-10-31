import { clsx } from 'clsx';
import { Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SequenceStim } from '@/engine/tasks/memory';
import { Button } from '../ui';
import type { TaskModule, TaskViewProps } from './types';
import { useDeadline, useKeys } from './useDeadline';

type Resp = { cells: number[] };

function View({ stim, deadlineMs, onRespond }: TaskViewProps<SequenceStim, Resp>) {
  const [phase, setPhase] = useState<'show' | 'recall'>('show');
  const [lit, setLit] = useState<number | null>(null);
  const [clicks, setClicks] = useState<number[]>([]);
  const [flash, setFlash] = useState<number | null>(null);
  const corrections = useRef(0);
  const submitted = useRef(false);
  const responseCells = useRef<number[]>([]);
  const feedbackTimers = useRef<number[]>([]);
  const n = stim.gridSize * stim.gridSize;
  useEffect(() => () => feedbackTimers.current.forEach(clearTimeout), []);

  useEffect(() => {
    const timers: number[] = [];
    let t = 500;
    stim.sequence.forEach((cell) => {
      timers.push(window.setTimeout(() => setLit(cell), t));
      t += stim.flashMs;
      timers.push(window.setTimeout(() => setLit(null), t));
      t += stim.gapMs;
    });
    timers.push(window.setTimeout(() => setPhase('recall'), t + 150));
    return () => timers.forEach(clearTimeout);
  }, [stim]);

  const timer = useDeadline(deadlineMs, () => onRespond({ response: clicks.length ? { cells: clicks } : null, rtMs: null, corrections: corrections.current }), phase === 'recall');

  const press = (cell: number) => {
    if (phase !== 'recall' || submitted.current) return;
    setFlash(cell);
    feedbackTimers.current.push(window.setTimeout(() => setFlash((f) => (f === cell ? null : f)), 180));
    const next = [...responseCells.current, cell];
    responseCells.current = next;
    setClicks(next);
    if (next.length === stim.sequence.length) {
      const rt = timer.stop();
      submitted.current = true;
      if (rt !== null) feedbackTimers.current.push(window.setTimeout(() => onRespond({ response: { cells: next }, rtMs: rt, corrections: corrections.current }), 200));
    }
  };
  const undo = () => {
    if (!responseCells.current.length || submitted.current) return;
    corrections.current++;
    responseCells.current = responseCells.current.slice(0, -1);
    setClicks(responseCells.current);
  };
  useKeys((k, e) => { if (k === 'Backspace') { e.preventDefault(); undo(); } }, phase === 'recall');

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div className="h-6 text-sm text-ink-2" aria-live="polite">
        {phase === 'show' ? 'Watch the sequence…' : `Your turn: ${clicks.length} / ${stim.sequence.length}`}
      </div>
      <div className="grid w-full max-w-[340px] gap-2" style={{ gridTemplateColumns: `repeat(${stim.gridSize}, minmax(0, 1fr))` }}>
        {Array.from({ length: n }, (_, i) => {
          const order = clicks.indexOf(i);
          return (
            <button
              key={i}
              type="button"
              disabled={phase !== 'recall'}
              onPointerDown={(e) => {
                e.preventDefault();
                press(i);
              }}
              onClick={(e) => { if (e.detail === 0) press(i); }}
              aria-label={`Tile ${i + 1}`}
              className={clsx(
                'relative aspect-square rounded-xl border transition-colors duration-100',
                lit === i ? 'border-transparent bg-[var(--dim-memory)]' : flash === i ? 'border-transparent bg-[color-mix(in_oklab,var(--dim-memory)_45%,var(--card))]' : 'border-line bg-card-2',
                phase === 'recall' && 'cursor-pointer hover:border-axis',
              )}
            >
              {order >= 0 && <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-ink-2">{clicks.lastIndexOf(i) + 1}</span>}
            </button>
          );
        })}
      </div>
      <Button size="sm" variant="ghost" onClick={undo} disabled={phase !== 'recall' || !clicks.length}>
        <Undo2 size={14} /> Undo
      </Button>
    </div>
  );
}

export const sequenceRecallModule: TaskModule<SequenceStim, Resp> = {
  View,
  evaluate(stim, response) {
    const span = stim.sequence.length;
    if (!response) return { correct: false, errorType: 'omission', meta: { span, positionsCorrect: 0 } };
    const positionsCorrect = stim.sequence.filter((c, i) => response.cells[i] === c).length;
    const correct = positionsCorrect === span && response.cells.length === span;
    if (correct) return { correct, meta: { span, positionsCorrect } };
    const sameSet = response.cells.length === span && [...response.cells].sort().join() === [...stim.sequence].sort().join();
    return { correct, errorType: sameSet ? 'order' : 'item', meta: { span, positionsCorrect } };
  },
  explainError: (stim, response) =>
    response && [...response.cells].sort().join() === [...stim.sequence].sort().join()
      ? 'Right tiles, different order — try grouping them in pairs.'
      : 'One tile slipped — try seeing the path as a shape.',
};
