import type { MatchStim } from '@/engine/tasks/speed';
import { Button } from '../ui';
import { Shape } from './shapes';
import type { TaskModule, TaskViewProps } from './types';
import { useDeadline, useKeys } from './useDeadline';

type Resp = { same: boolean };

function Row({ glyphs }: { glyphs: MatchStim['left'] }) {
  const w = glyphs.length * 30 + 10;
  return (
    <svg viewBox={`0 0 ${w} 40`} className="h-12 w-auto max-w-full" aria-hidden>
      {glyphs.map((g, i) => (
        <Shape key={i} shape={g} cx={20 + i * 30} cy={20} r={11} fill="var(--ink)" stroke="none" />
      ))}
    </svg>
  );
}

function View({ stim, deadlineMs, onRespond }: TaskViewProps<MatchStim, Resp>) {
  const timer = useDeadline(deadlineMs, () => onRespond({ response: null, rtMs: null }));
  const answer = (same: boolean) => {
    const rt = timer.stop();
    if (rt !== null) onRespond({ response: { same }, rtMs: rt });
  };
  useKeys((k) => {
    if (k === 'f' || k === 'F' || k === 'ArrowLeft') answer(true);
    if (k === 'j' || k === 'J' || k === 'ArrowRight') answer(false);
  });
  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div className="flex w-full flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-6">
        <div className="rounded-2xl border border-line bg-card px-4 py-3">
          <Row glyphs={stim.left} />
        </div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted">vs</div>
        <div className="rounded-2xl border border-line bg-card px-4 py-3">
          <Row glyphs={stim.right} />
        </div>
      </div>
      <div className="grid w-full max-w-sm grid-cols-2 gap-3">
        <Button size="lg" onClick={(e) => { if (e.detail === 0) answer(true); }} onPointerDown={(e) => (e.preventDefault(), answer(true))}>
          Same <kbd className="ml-1 rounded border border-line px-1 text-[11px] text-ink-2">F</kbd>
        </Button>
        <Button size="lg" onClick={(e) => { if (e.detail === 0) answer(false); }} onPointerDown={(e) => (e.preventDefault(), answer(false))}>
          Different <kbd className="ml-1 rounded border border-line px-1 text-[11px] text-ink-2">J</kbd>
        </Button>
      </div>
    </div>
  );
}

export const symbolSprintModule: TaskModule<MatchStim, Resp> = {
  View,
  evaluate(stim, response) {
    if (!response) return { correct: false, errorType: 'omission' };
    const correct = response.same === stim.same;
    return { correct, errorType: correct ? undefined : 'wrong_choice' };
  },
  explainError: (stim, response) =>
    !response ? 'Too slow this time — trust your first look.' : stim.change === 'swap' ? 'Two neighbours were swapped — compare position by position.' : stim.same ? 'They were identical.' : 'One symbol was different.',
};
