import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { Direction, FlankerStim } from '@/engine/tasks/inhibition';
import { Button } from '../ui';
import type { TaskModule, TaskViewProps } from './types';
import { useDeadline, useKeys } from './useDeadline';

type Resp = { dir: Direction };

function Arrow({ dir, x }: { dir: Direction; x: number }) {
  const s = dir === 'left' ? -1 : 1;
  return <path d={`M${x - 14 * s},20 L${x + 10 * s},20 M${x + 2 * s},11 L${x + 12 * s},20 L${x + 2 * s},29`} stroke="var(--ink)" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
}

function Stop({ x }: { x: number }) {
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    return `${x + 15 * Math.cos(a)},${20 + 15 * Math.sin(a)}`;
  }).join(' ');
  return (
    <g>
      <polygon points={pts} fill="var(--critical)" />
      <text x={x} y={23.5} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="#fff">
        STOP
      </text>
    </g>
  );
}

function View({ stim, deadlineMs, onRespond }: TaskViewProps<FlankerStim, Resp>) {
  // No-go trials end at the deadline without a response — that is the correct outcome.
  const timer = useDeadline(deadlineMs, () => onRespond({ response: null, rtMs: null }));
  const answer = (dir: Direction) => {
    const rt = timer.stop();
    if (rt !== null) onRespond({ response: { dir }, rtMs: rt });
  };
  useKeys((k) => {
    if (k === 'ArrowLeft' || k === 'f' || k === 'F') answer('left');
    if (k === 'ArrowRight' || k === 'j' || k === 'J') answer('right');
  });
  const xs = [30, 70, 110, 150, 190];
  return (
    <div className="flex w-full flex-col items-center gap-8">
      <svg viewBox="0 0 220 40" className="w-full max-w-[420px]" aria-label="five symbols; respond to the middle one">
        {xs.map((x, i) =>
          i === 2 ? (
            stim.center === 'stop' ? <Stop key={i} x={x} /> : <Arrow key={i} dir={stim.center} x={x} />
          ) : stim.flank === 'none' ? (
            <path key={i} d={`M${x - 12},20 L${x + 12},20`} stroke="var(--ink)" strokeWidth={4} strokeLinecap="round" />
          ) : (
            <Arrow key={i} dir={stim.flank} x={x} />
          ),
        )}
      </svg>
      <div className="grid w-full max-w-sm grid-cols-2 gap-3">
        <Button size="lg" aria-label="Left" onClick={(e) => { if (e.detail === 0) answer('left'); }} onPointerDown={(e) => (e.preventDefault(), answer('left'))}>
          <ArrowLeft size={20} />
        </Button>
        <Button size="lg" aria-label="Right" onClick={(e) => { if (e.detail === 0) answer('right'); }} onPointerDown={(e) => (e.preventDefault(), answer('right'))}>
          <ArrowRight size={20} />
        </Button>
      </div>
    </div>
  );
}

export const arrowFocusModule: TaskModule<FlankerStim, Resp> = {
  View,
  evaluate(stim, response) {
    if (stim.center === 'stop') return response ? { correct: false, errorType: 'commission' } : { correct: true };
    if (!response) return { correct: false, errorType: 'omission' };
    const correct = response.dir === stim.center;
    return { correct, errorType: correct ? undefined : 'wrong_choice' };
  },
  explainError: (stim, response) =>
    stim.center === 'stop' ? 'STOP in the middle means: no key.' : !response ? 'A little too slow.' : 'The outer arrows pulled you — anchor on the middle.',
};
