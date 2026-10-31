import { useEffect, useRef } from 'react';

/**
 * Measures response time from stimulus onset and fires `onTimeout` at the deadline.
 * Returns a `respond` helper that reports the RT once and cancels the timer.
 */
export function useDeadline(deadlineMs: number, onTimeout: () => void, active = true) {
  const onset = useRef<number>(performance.now());
  const done = useRef(false);
  const timeoutRef = useRef(onTimeout);
  timeoutRef.current = onTimeout;

  useEffect(() => {
    if (!active) return;
    onset.current = performance.now();
    done.current = false;
    const id = window.setTimeout(() => {
      if (!done.current) {
        done.current = true;
        timeoutRef.current();
      }
    }, deadlineMs);
    return () => window.clearTimeout(id);
  }, [deadlineMs, active]);

  return {
    /** Returns RT in ms, or null if the trial already ended. */
    stop(): number | null {
      if (!active || done.current) return null;
      done.current = true;
      return Math.round(performance.now() - onset.current);
    },
    elapsed: () => performance.now() - onset.current,
  };
}

/** Keyboard shortcut hook active while a trial is on screen. */
export function useKeys(handler: (key: string, e: KeyboardEvent) => void, active = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      ref.current(e.key, e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}
