import { clsx } from 'clsx';
import { Palette, Shapes } from 'lucide-react';
import { useEffect, useState } from 'react';
import { switchAnswer, type SwitchStim } from '@/engine/tasks/flexibility';
import { Button } from '../ui';
import type { TaskModule, TaskViewProps } from './types';
import { useDeadline, useKeys } from './useDeadline';

type Resp = { side: 'left' | 'right' };

const toneFill = (tone: 'A' | 'B', ci: boolean) => (ci ? (tone === 'A' ? 'var(--ink)' : 'var(--card)') : tone === 'A' ? 'var(--tone-a)' : 'var(--tone-b)');
const toneStroke = (ci: boolean) => (ci ? 'var(--ink)' : 'none');

function Glyph({ shape, tone, ci, size = 80 }: { shape: 'circle' | 'square'; tone: 'A' | 'B'; ci: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      {shape === 'circle' ? (
        <circle cx={20} cy={20} r={15} fill={toneFill(tone, ci)} stroke={toneStroke(ci)} strokeWidth={3} />
      ) : (
        <rect x={6} y={6} width={28} height={28} rx={3} fill={toneFill(tone, ci)} stroke={toneStroke(ci)} strokeWidth={3} />
      )}
    </svg>
  );
}

function View({ stim, deadlineMs, colourIndependent: ci, onRespond }: TaskViewProps<SwitchStim, Resp>) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(false);
    const id = window.setTimeout(() => setShown(true), stim.cueLeadMs);
    return () => clearTimeout(id);
  }, [stim]);
  const timer = useDeadline(deadlineMs, () => onRespond({ response: null, rtMs: null }), shown);
  const answer = (side: 'left' | 'right') => {
    if (!shown) return;
    const rt = timer.stop();
    if (rt !== null) onRespond({ response: { side }, rtMs: rt });
  };
  useKeys((k) => {
    if (k === 'ArrowLeft' || k === 'f' || k === 'F') answer('left');
    if (k === 'ArrowRight' || k === 'j' || k === 'J') answer('right');
  });
  const ruleWord = stim.rule === 'shape' ? 'SHAPE' : ci ? 'FILL' : 'COLOUR';
  return (
    <div className="flex w-full flex-col items-center gap-5">
      <div
        className={clsx(
          'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold tracking-wider',
          stim.rule === 'shape' ? 'bg-ink text-card' : 'border-2 border-ink text-ink',
        )}
        aria-live="assertive"
      >
        {stim.rule === 'shape' ? <Shapes size={16} /> : <Palette size={16} />} {ruleWord}
      </div>
      <div className="flex h-24 items-center justify-center">{shown && <Glyph shape={stim.shape} tone={stim.tone} ci={ci} />}</div>
      <div className="grid w-full max-w-sm grid-cols-2 gap-3">
        {(['left', 'right'] as const).map((side) => (
          <Button key={side} size="lg" className="h-16 flex-col gap-0.5" onClick={(e) => { if (e.detail === 0) answer(side); }} onPointerDown={(e) => (e.preventDefault(), answer(side))}>
            <span className="flex items-center gap-2">
              <svg width={18} height={18} viewBox="0 0 40 40" aria-hidden>
                {side === 'left' ? <circle cx={20} cy={20} r={15} fill="none" stroke="var(--ink)" strokeWidth={4} /> : <rect x={6} y={6} width={28} height={28} fill="none" stroke="var(--ink)" strokeWidth={4} />}
              </svg>
              <span className="text-ink-2">|</span>
              <span className="inline-block h-4 w-4 rounded-sm border border-ink" style={{ background: toneFill(side === 'left' ? 'A' : 'B', ci) }} />
            </span>
            <span className="text-[11px] text-ink-2">
              {side === 'left' ? 'circle' : 'square'} · {ci ? (side === 'left' ? 'solid' : 'outline') : side === 'left' ? 'blue' : 'orange'}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}

export const ruleSwitchModule: TaskModule<SwitchStim, Resp> = {
  View,
  evaluate(stim, response) {
    if (!response) return { correct: false, errorType: 'omission' };
    const correct = response.side === switchAnswer(stim);
    if (correct) return { correct };
    const otherRule = switchAnswer({ ...stim, rule: stim.rule === 'shape' ? 'tone' : 'shape' });
    const persev = stim.isSwitch && !stim.congruent && response.side === otherRule;
    return { correct, errorType: persev ? 'perseveration' : 'wrong_choice' };
  },
  explainError: (stim, response) => (!response ? 'Too slow — read the banner, then go.' : stim.isSwitch ? 'The rule had just changed — check the banner first.' : `Rule was ${stim.rule === 'shape' ? 'SHAPE' : 'COLOUR'}.`),
};
