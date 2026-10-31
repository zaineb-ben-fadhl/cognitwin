/**
 * Device & motor calibration ("Reaction Tap"). A 10-tap simple-reaction baseline scales every
 * response window, so slower devices, touch screens or a slower motor pace are not mistaken
 * for slower thinking. Not a score, never shown as one.
 */
import { useEffect, useRef, useState } from 'react';
import { median, clamp } from '@/engine';
import type { Calibration as Cal } from '@/store';
import { Button } from './ui';

const TRIALS = 10;
const REFERENCE_MS = 300;

export function factorFromSrt(srtMs: number) {
  return Math.round(clamp(srtMs / REFERENCE_MS, 1, 1.6) * 100) / 100;
}

export function Calibration({ onDone, onSkip }: { onDone: (c: Cal) => void; onSkip?: () => void }) {
  const [state, setState] = useState<'idle' | 'wait' | 'go' | 'early' | 'done'>('idle');
  const [rts, setRts] = useState<number[]>([]);
  const goAt = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const input = useRef<Cal['input']>('mouse');

  const arm = () => {
    setState('wait');
    timer.current = window.setTimeout(() => {
      goAt.current = performance.now();
      setState('go');
    }, 900 + Math.random() * 1400);
  };

  const press = (kind: Cal['input']) => {
    input.current = kind;
    if (state === 'idle' || state === 'early') return arm();
    if (state === 'wait') {
      clearTimeout(timer.current);
      setState('early');
      return;
    }
    if (state === 'go') {
      const rt = performance.now() - goAt.current;
      const next = [...rts, rt];
      setRts(next);
      if (next.length >= TRIALS) {
        setState('done');
        // First tap is a warm-up; the median is robust to a stray slow tap.
        const srt = median(next.slice(1)) ?? REFERENCE_MS;
        onDone({ srtMs: Math.round(srt), factor: factorFromSrt(srt), input: input.current, at: Date.now() });
      } else arm();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        press('keyboard');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  const label =
    state === 'idle' ? 'Tap here (or press Space) to start' : state === 'wait' ? 'Wait for green…' : state === 'go' ? 'Tap now!' : state === 'early' ? 'A bit early — tap to try again' : 'Calibrated';

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault();
          press(e.pointerType === 'touch' ? 'touch' : 'mouse');
        }}
        className="flex h-44 w-44 items-center justify-center rounded-full border-4 text-center text-sm font-medium transition-colors"
        style={{
          background: state === 'go' ? 'var(--good)' : 'var(--card-2)',
          borderColor: state === 'go' ? 'var(--good)' : 'var(--line)',
          color: state === 'go' ? '#fff' : 'var(--ink)',
        }}
      >
        <span className="px-4">{label}</span>
      </button>
      <div className="text-[12px] text-ink-2 tabular">
        {rts.length}/{TRIALS} taps
      </div>
      {onSkip && state !== 'done' && (
        <Button size="sm" variant="ghost" onClick={onSkip}>
          Skip (use a generous default)
        </Button>
      )}
    </div>
  );
}
