import { useId } from 'react';
import type { SearchStim, Tone } from '@/engine/tasks/attention';
import { Shape, StripeDefs } from './shapes';
import type { TaskModule, TaskViewProps } from './types';
import { useDeadline } from './useDeadline';

type Resp = { index: number };

const TONE_VAR: Record<Tone, string> = { A: 'var(--tone-a)', B: 'var(--tone-b)', C: 'var(--tone-c)' };

/** Fill style for a tone; in colour-independent mode tones become solid / outline / striped. */
function toneStyle(tone: Tone, ci: boolean, stripeId: string) {
  if (!ci) return { fill: TONE_VAR[tone], stroke: 'none', strokeWidth: 0 };
  if (tone === 'A') return { fill: 'var(--ink)', stroke: 'var(--ink)', strokeWidth: 2 };
  if (tone === 'B') return { fill: 'var(--card)', stroke: 'var(--ink)', strokeWidth: 3 };
  return { fill: `url(#${stripeId})`, stroke: 'var(--ink)', strokeWidth: 2 };
}

function View({ stim, deadlineMs, colourIndependent, onRespond }: TaskViewProps<SearchStim, Resp>) {
  const stripeId = useId().replace(/:/g, '');
  const timer = useDeadline(deadlineMs, () => onRespond({ response: null, rtMs: null }));
  const click = (index: number) => {
    const rt = timer.stop();
    if (rt !== null) onRespond({ response: { index }, rtMs: rt });
  };
  const target = toneStyle(stim.target.tone, colourIndependent, stripeId);
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="flex items-center gap-2 rounded-xl border border-line bg-card-2 px-3 py-1.5 text-sm">
        <span className="text-ink-2">Find</span>
        <svg width={28} height={28} viewBox="0 0 28 28" aria-label="target shape">
          <StripeDefs id={`${stripeId}`} color="var(--ink)" />
          <Shape shape={stim.target.shape} cx={14} cy={14} r={10} {...target} />
        </svg>
      </div>
      <div
        className="relative w-full max-w-[520px] select-none rounded-2xl border border-line bg-card"
        style={{ aspectRatio: `${stim.cols} / ${stim.rows}` }}
      >
        <svg viewBox={`-3 -3 ${stim.cols * 10 + 6} ${stim.rows * 10 + 6}`} className="absolute inset-0 h-full w-full">
          <StripeDefs id={stripeId} color="var(--ink)" />
          {stim.items.map((it, i) => {
            const st = toneStyle(it.tone, colourIndependent, stripeId);
            const cx = (it.col + 0.5 + it.dx) * 10;
            const cy = (it.row + 0.5 + it.dy) * 10;
            return (
              <g key={i} role="button" tabIndex={0} aria-label={`Item ${i + 1}: ${it.shape}, ${colourIndependent ? { A: 'solid', B: 'outline', C: 'striped' }[it.tone] : it.tone}`} onPointerDown={() => click(i)} onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(i); }
              }} style={{ cursor: 'pointer' }}>
                <circle cx={cx} cy={cy} r={4.8} fill="transparent" />
                <Shape shape={it.shape} cx={cx} cy={cy} r={3.1} {...st} strokeWidth={(st.strokeWidth as number) / 6} />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export const targetHuntModule: TaskModule<SearchStim, Resp> = {
  View,
  evaluate(stim, response) {
    if (!response) return { correct: false, errorType: 'omission', meta: { setSize: stim.setSize } };
    const correct = response.index === stim.targetIndex;
    return { correct, errorType: correct ? undefined : 'commission', meta: { setSize: stim.setSize } };
  },
  explainError: (_stim, response) => (response ? 'That one shared only one feature with the target.' : 'Time ran out — scan row by row.'),
};
