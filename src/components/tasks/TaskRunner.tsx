/**
 * Generic trial loop shared by every task: level selection (engine), stimulus generation,
 * timing, scoring, feedback, interruption detection, pause/quit and live strain easing.
 */
import { clsx } from 'clsx';
import { Bot, Check, Pause, Play, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ANTICIPATION_MS, createRng, isRapid, liveRapidGuessing, liveStrain, median, type AdaptiveSession, type AnyTaskSpec, type BehaviourLog, type RushAnswer, type Trial } from '@/engine';
import { speak } from '@/lib/voice';
import { Button, ProgressBar } from '../ui';
import { TASK_MODULES } from './index';
import type { RespondArgs } from './types';

export interface RunResult {
  trials: Trial[];
  behaviour: BehaviourLog;
  startedAt: number;
  endedAt: number;
}

interface Props {
  task: AnyTaskSpec;
  /** Null in practice mode. */
  adaptive: AdaptiveSession | null;
  practiceTrials?: number;
  deadlineFactor: number;
  colourIndependent: boolean;
  voice?: boolean;
  onComplete(result: RunResult): void;
  onQuit(result: RunResult): void;
}

type Phase = 'fixation' | 'stimulus' | 'feedback';

const freshBehaviour = (): BehaviourLog => ({
  focusLosses: 0,
  hiddenMs: 0,
  longPauses: 0,
  hintsUsed: 0,
  corrections: 0,
  anticipations: 0,
  quitEarly: false,
  input: 'mouse',
});

export function TaskRunner({ task, adaptive, practiceTrials = 0, deadlineFactor, colourIndependent, voice, onComplete, onQuit }: Props) {
  const module = TASK_MODULES[task.id];
  const practice = adaptive === null;
  const rng = useRef(createRng(Date.now()));
  const startedAt = useRef(Date.now());
  const t0 = useRef(performance.now());
  const behaviour = useRef<BehaviourLog>(freshBehaviour());
  const inputs = useRef(new Set<string>());
  const trials = useRef<Trial[]>([]);
  const prevStim = useRef<unknown>(undefined);
  const interrupted = useRef(false);
  const consecutiveOmissions = useRef(0);
  const transition = useRef<number | undefined>(undefined);
  const answered = useRef(false);
  const ended = useRef(false);

  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('fixation');
  const [current, setCurrent] = useState<{ level: number; stim: unknown; deadlineMs: number } | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text?: string } | null>(null);
  const [paused, setPaused] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  /** Live coach check-in after a burst of implausibly fast, mostly wrong answers. */
  const [rushPrompt, setRushPrompt] = useState<string | null>(null);
  const lastRushAt = useRef<number | null>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const total = practice ? practiceTrials : adaptive!.budget;

  const result = useCallback((): RunResult => {
    const b = { ...behaviour.current };
    b.input = inputs.current.size > 1 ? 'mixed' : ((inputs.current.values().next().value as BehaviourLog['input']) ?? 'mouse');
    b.anticipations = trials.current.filter((t) => t.rtMs !== null && t.rtMs < ANTICIPATION_MS).length;
    return { trials: trials.current.slice(), behaviour: b, startedAt: startedAt.current, endedAt: Date.now() };
  }, []);

  const next = useCallback(() => {
    window.clearTimeout(transition.current);
    if (pausedRef.current || ended.current) return;
    const n = trials.current.length;
    if (practice ? n >= practiceTrials : adaptive!.isComplete) {
      ended.current = true;
      onComplete(result());
      return;
    }
    const level = practice ? Math.min(2, 1 + Math.floor(n / 2)) : adaptive!.nextLevel();
    const stim = task.generate(level, rng.current, n, prevStim.current);
    prevStim.current = stim;
    interrupted.current = false;
    answered.current = false;
    setCurrent({ level, stim, deadlineMs: Math.round(task.deadlineMs(level) * deadlineFactor) });
    setFeedback(null);
    setPhase('fixation');
    transition.current = window.setTimeout(() => setPhase('stimulus'), 450);
    if (adaptive?.lastAdjustment) setToast(adaptive.lastAdjustment);
  }, [adaptive, deadlineFactor, onComplete, practice, practiceTrials, result, task]);

  // Start.
  useEffect(() => {
    ended.current = false;
    next();
    return () => { window.clearTimeout(transition.current); ended.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Interruption & input tracking (non-biometric behaviour).
  useEffect(() => {
    let awaySince: number | null = null;
    const away = () => {
      if (awaySince !== null) return;
      awaySince = performance.now();
      behaviour.current.focusLosses++;
      interrupted.current = true;
    };
    const back = () => {
      if (awaySince === null || document.hidden) return;
      behaviour.current.hiddenMs += performance.now() - awaySince;
      awaySince = null;
    };
    const vis = () => (document.hidden ? away() : back());
    const onPointer = (e: PointerEvent) => inputs.current.add(e.pointerType === 'touch' ? 'touch' : 'mouse');
    const onKey = () => inputs.current.add('keyboard');
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('blur', away);
    window.addEventListener('focus', back);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('blur', away);
      window.removeEventListener('focus', back);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const onRespond = useCallback(
    ({ response, rtMs, corrections, hintUsed }: RespondArgs<unknown>) => {
      if (!current || phase !== 'stimulus' || answered.current || pausedRef.current || ended.current) return;
      answered.current = true;
      const ev = module.evaluate(current.stim, response, rtMs);
      const { condition, meta } = task.sim.describe(current.stim);
      const success = ev.correct && (rtMs === null ? response === null : rtMs <= current.deadlineMs);
      if (corrections) behaviour.current.corrections += corrections;
      if (hintUsed) behaviour.current.hintsUsed++;
      const slow = rtMs !== null && rtMs > 0.8 * current.deadlineMs && current.deadlineMs > 15_000;
      consecutiveOmissions.current = response === null && condition !== 'nogo' ? consecutiveOmissions.current + 1 : 0;
      if (slow || consecutiveOmissions.current === 3) behaviour.current.longPauses++;

      const weight = interrupted.current ? 0.3 : hintUsed ? 0.6 : 1;
      const trial: Trial = {
        index: trials.current.length,
        level: current.level,
        correct: ev.correct,
        success,
        rtMs,
        deadlineMs: current.deadlineMs,
        condition,
        errorType: ev.errorType,
        weight,
        meta: { ...(meta ?? {}), ...(ev.meta ?? {}), ...(hintUsed ? { hint: true } : {}) },
        t: Math.round(performance.now() - t0.current),
      };
      trials.current.push(trial);

      if (adaptive) {
        adaptive.record(trial);
        if (adaptive.mode === 'training') {
          if (liveStrain(adaptive.trials) && adaptive.targetBoost === 0) {
            adaptive.targetBoost = 0.08;
            setToast('That was a tough run — easing the difficulty a little.');
            if (voice) speak("Let's ease off a little.");
          } else if (adaptive.targetBoost > 0 && adaptive.trials.slice(-4).every((t) => t.success)) {
            adaptive.targetBoost = 0;
          }
          const streak = adaptive.trials.slice(-5);
          if (voice && streak.length === 5 && streak.every((t) => t.success) && trials.current.length % 5 === 0) speak('Great streak.');
        }
      }

      // Button-masher guard: ask, don't judge. At most twice per session, eight trials apart.
      if (!practice && (lastRushAt.current === null || trials.current.length - lastRushAt.current >= 8) && (behaviour.current.rushChecks?.length ?? 0) < 2 && liveRapidGuessing(task, trials.current)) {
        lastRushAt.current = trials.current.length;
        const recent = trials.current.slice(-6).filter((t) => t.rtMs !== null);
        const med = median(recent.map((t) => t.rtMs)) ?? 0;
        const wrong = recent.filter((t) => !t.correct).length;
        const fast = recent.filter((t) => isRapid(task, t)).length;
        setRushPrompt(
          `Your last ${recent.length} answers came in at a median ${Math.round(med)} ms${fast ? ` (${fast} faster than the screen can be read)` : ''} and ${wrong} ${wrong === 1 ? 'was' : 'were'} wrong. ` +
            'I won’t count rushed answers as a drop in ability — but are you distracted, or rushing?',
        );
        setPaused(true);
        if (voice) speak('Quick check: are you distracted, or rushing?');
      }

      const showCorrectness = practice || adaptive?.mode === 'training';
      setFeedback({ ok: success, text: showCorrectness && !success ? module.explainError?.(current.stim, response) : undefined });
      setPhase('feedback');
      setIndex((i) => i + 1);
      const wait = practice && !success ? 1700 : showCorrectness && !success ? 900 : 380;
      window.clearTimeout(transition.current);
      transition.current = window.setTimeout(next, wait);
    },
    [adaptive, current, module, next, phase, practice, task, voice],
  );

  // Resume after pause.
  useEffect(() => {
    if (paused) {
      window.clearTimeout(transition.current);
      interrupted.current = true;
      return;
    }
    if (!paused && phase === 'feedback' && current) {
      window.clearTimeout(transition.current);
      transition.current = window.setTimeout(next, 200);
    } else if (!paused && phase === 'fixation' && current) {
      window.clearTimeout(transition.current);
      transition.current = window.setTimeout(() => setPhase('stimulus'), 450);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  const answerRush = (answer: RushAnswer) => {
    behaviour.current.rushChecks = [...(behaviour.current.rushChecks ?? []), { at: Date.now(), answer }];
    setRushPrompt(null);
    if (answer === 'stop') {
      if (ended.current) return;
      ended.current = true;
      window.clearTimeout(transition.current);
      const r = result();
      r.behaviour.quitEarly = true;
      onQuit(r);
      return;
    }
    // "Distracted" keeps the session paused until the user is ready.
    if (answer !== 'distracted') setPaused(false);
  };

  const View = module.View;
  const showCorrectness = practice || adaptive?.mode === 'training';

  return (
    <div className="flex min-h-[460px] w-full flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <ProgressBar value={index / Math.max(1, total)} label="Session progress" />
        </div>
        <span className="text-[12px] tabular text-ink-2">
          {practice ? `Practice ${Math.min(index + 1, total)}/${total}` : `${index}/${adaptive!.mode === 'assessment' ? `≤${total}` : total}`}
        </span>
        {!practice && (
          <>
            <span className="hidden text-[12px] text-ink-2 sm:inline">Level {current?.level ?? '–'}</span>
            <Button size="sm" variant="ghost" aria-label={paused ? 'Resume' : 'Pause'} onClick={() => setPaused((p) => !p)}>
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-label="Stop session"
          onClick={() => {
            if (ended.current) return;
            ended.current = true;
            window.clearTimeout(transition.current);
            const r = result();
            r.behaviour.quitEarly = true;
            onQuit(r);
          }}
        >
          <X size={14} />
        </Button>
      </div>

      <div className="relative flex flex-1 items-center justify-center rounded-2xl border border-line bg-page/60 px-3 py-6 sm:px-6">
        {paused && rushPrompt ? (
          <div className="flex max-w-md flex-col items-center gap-3 text-center" role="alertdialog" aria-label="Coach check-in">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <Bot size={20} />
            </span>
            <div className="text-sm font-semibold">Quick check from your coach</div>
            <p className="text-[13.5px] text-ink-2">{rushPrompt}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" size="sm" onClick={() => answerRush('rushing')}>
                I was rushing — I’ll slow down
              </Button>
              <Button size="sm" onClick={() => answerRush('distracted')}>
                I’m distracted — pause
              </Button>
              <Button size="sm" variant="ghost" onClick={() => answerRush('continue')}>
                Keep going
              </Button>
              <Button size="sm" variant="ghost" onClick={() => answerRush('stop')}>
                Stop here
              </Button>
            </div>
            <p className="text-[11.5px] text-muted">Answers this fast can’t be based on what was on screen, so they are left out of your estimate whatever you choose.</p>
          </div>
        ) : paused ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="text-sm font-semibold">Paused</div>
            <p className="max-w-xs text-[13px] text-ink-2">Completed results are kept. The current item restarts on resume and counts less because it was interrupted.</p>
            <Button variant="primary" onClick={() => setPaused(false)}>
              <Play size={14} /> Resume
            </Button>
          </div>
        ) : phase === 'fixation' || !current ? (
          <div className="text-3xl font-light text-muted" aria-hidden>
            +
          </div>
        ) : phase === 'stimulus' ? (
          <View key={index} stim={current.stim} level={current.level} deadlineMs={current.deadlineMs} colourIndependent={colourIndependent} practice={practice} onRespond={onRespond} />
        ) : (
          <div className="flex flex-col items-center gap-2" aria-live="polite">
            {showCorrectness ? (
              <span className={clsx('flex h-12 w-12 items-center justify-center rounded-full', feedback?.ok ? 'bg-good/15 text-good-text' : 'bg-serious/15 text-ink')}>
                {feedback?.ok ? <Check size={24} /> : <X size={24} />}
              </span>
            ) : (
              <span className="h-3 w-3 rounded-full bg-axis" aria-label="Response recorded" />
            )}
            {feedback?.text && <p className="max-w-sm text-center text-[13px] text-ink-2">{feedback.text}</p>}
          </div>
        )}
        {toast && <div className="animate-fade-in absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-line bg-card px-3 py-1.5 text-[12px] text-ink-2 shadow">{toast}</div>}
      </div>
      <p className="text-center text-[12px] text-muted">{task.controls}</p>
    </div>
  );
}
