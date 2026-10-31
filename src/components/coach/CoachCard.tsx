import { clsx } from 'clsx';
import { Bot, ChevronDown, Coffee, ShieldCheck, ThumbsDown, ThumbsUp, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CoachMessage } from '@/engine';
import { canSpeak, speak, stopSpeaking } from '@/lib/voice';
import { useStore } from '@/store';
import { Badge, Button, ConfidenceBadge, Modal } from '../ui';
import { useCoachAction } from './useCoachAction';

export function SourceBadge({ m }: { m: CoachMessage }) {
  if (m.source === 'llm') return <Badge tone="brand">AI narrative · {m.model ?? 'LLM'}</Badge>;
  if (m.source === 'safe-reply') return <Badge tone="neutral">Reviewed safety reply</Badge>;
  return <Badge tone="neutral">Rule-based coach</Badge>;
}

/** The "Why?" panel: evidence behind the message + what the safety layer checked. */
export function WhyPanel({ m }: { m: CoachMessage }) {
  return (
    <div className="animate-fade-in mt-3 space-y-3 rounded-xl border border-line bg-card-2/60 p-3 text-[13px]">
      {m.evidence.length ? (
        <div>
          <div className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-2">Evidence used</div>
          <ul className="space-y-1">
            {m.evidence.map((e) => (
              <li key={e.id} className="flex justify-between gap-3">
                <span className="text-ink-2">{e.label}</span>
                <span className="text-right font-medium tabular">{e.value}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="text-ink-2">This message is general guidance; it does not rely on your personal data.</div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
        <ConfidenceBadge confidence={m.confidence} />
        <SourceBadge m={m} />
      </div>
      {m.safety && (
        <div className="border-t border-line pt-2">
          <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-2">
            <ShieldCheck size={13} /> Safety checks
          </div>
          <ul className="space-y-0.5 text-ink-2">
            {m.safety.checks.map((c) => (
              <li key={c}>✓ {c}</li>
            ))}
          </ul>
          {m.safety.intercepted.length > 0 && (
            <p className="mt-1 text-ink-2">A first AI draft was corrected: {m.safety.intercepted.join('; ')}.</p>
          )}
          {m.safety.fallbackUsed && <p className="mt-1 text-ink-2">{m.safety.fallbackReason ?? 'The AI narrative was unavailable or rejected, so the rule-based coach answered.'}</p>}
        </div>
      )}
    </div>
  );
}

function BreakTimer({ minutes, onClose }: { minutes: number; onClose: () => void }) {
  const [left, setLeft] = useState(minutes * 60);
  useEffect(() => {
    const id = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <Modal open onClose={onClose} title="Short break">
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <Coffee size={28} className="text-ink-2" />
        <div className="text-4xl font-semibold tabular">
          {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
        </div>
        <p className="max-w-xs text-[13px] text-ink-2">Look into the distance, stretch, drink some water. Practice works best when you’re fresh.</p>
        <Button onClick={onClose}>{left ? 'End break early' : 'Done'}</Button>
      </div>
    </Modal>
  );
}

interface Props {
  m: CoachMessage;
  compact?: boolean;
  /** Ask the user whether the message was accurate (critical verification signal). */
  rate?: boolean;
  className?: string;
}

export function CoachCard({ m, compact, rate, className }: Props) {
  const [why, setWhy] = useState(false);
  const [viewed, setViewed] = useState(false);
  const [rated, setRated] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const voiceOk = useStore((s) => s.consent.voiceOut) && canSpeak();
  const autoSpeak = useStore((s) => s.settings.speakCoach);
  const logEvent = useStore((s) => s.logEvent);
  const { run, dismiss, breakMinutes, closeBreak } = useCoachAction();

  useEffect(() => {
    if (voiceOk && autoSpeak && !compact) {
      speak(m.text, { onEnd: () => setSpeaking(false) });
      setSpeaking(true);
    }
    return () => stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id, voiceOk, autoSpeak, compact]);

  const toggleWhy = () => {
    if (!why && !viewed) {
      logEvent('why_opened', { confidence: m.confidence });
      setViewed(true);
    }
    setWhy((w) => !w);
  };

  const onRate = (verdict: 'agree' | 'disagree' | 'unsure') => {
    // "Calibrated trust": agreeing with well-supported messages, doubting weakly supported ones.
    const justified = (verdict === 'agree' && m.confidence !== 'low') || (verdict !== 'agree' && m.confidence === 'low');
    logEvent('claim_rated', { verdict, justified, confidence: m.confidence });
    setRated(verdict);
  };

  return (
    <div className={clsx('rounded-2xl border border-line bg-card p-4', className)}>
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Bot size={17} />
        </div>
        <div className="min-w-0 flex-1">
          {m.headline && <div className="mb-0.5 text-[15px] font-semibold">{m.headline}</div>}
          <p className={clsx('leading-relaxed text-ink', compact ? 'text-[13.5px]' : 'text-[14.5px]')}>{m.text}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={toggleWhy} aria-expanded={why}>
              Why? <ChevronDown size={14} className={clsx('transition-transform', why && 'rotate-180')} />
            </Button>
            {voiceOk && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={speaking ? 'Stop reading aloud' : 'Read aloud'}
                onClick={() => {
                  if (speaking) {
                    stopSpeaking();
                    setSpeaking(false);
                  } else {
                    speak(m.text, { onEnd: () => setSpeaking(false) });
                    setSpeaking(true);
                  }
                }}
              >
                {speaking ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </Button>
            )}
            {m.action && (
              <Button size="sm" variant="primary" onClick={() => run(m.action!, m, viewed)}>
                {m.action.label}
              </Button>
            )}
            {m.action && m.action.kind !== 'open' && (
              <Button size="sm" variant="ghost" onClick={() => dismiss(m, viewed)}>
                Not now
              </Button>
            )}
            <span className="ml-auto">
              <ConfidenceBadge confidence={m.confidence} compact />
            </span>
          </div>
          {why && <WhyPanel m={m} />}
          {rate && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[12.5px] text-ink-2">
              {rated ? (
                <span>Thanks — your judgement helps calibrate trust in the coach.</span>
              ) : (
                <>
                  <span>Does this match what you see in your data?</span>
                  <Button size="sm" variant="ghost" onClick={() => onRate('agree')}>
                    <ThumbsUp size={13} /> Yes
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onRate('disagree')}>
                    <ThumbsDown size={13} /> Not quite
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onRate('unsure')}>
                    Unsure
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {breakMinutes !== null && <BreakTimer minutes={breakMinutes} onClose={closeBreak} />}
    </div>
  );
}
