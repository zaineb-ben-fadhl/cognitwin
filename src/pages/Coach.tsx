import { clsx } from 'clsx';
import { Bot, Mic, MicOff, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CoachCard } from '@/components/coach/CoachCard';
import { Badge, Button, Card, CardHeader, PageHeader } from '@/components/ui';
import {
  DIMENSIONS,
  createRng,
  createVerifyChallenge,
  detectIntent,
  isClarifying,
  redactPII,
  specificity,
  uid,
  type CoachMessage,
} from '@/engine';
import { askCoach, checkHealth } from '@/lib/coachClient';
import { canListen, listenOnce } from '@/lib/voice';
import { useStore } from '@/store';
import { useCoachContext, useNow, useProfile } from '@/store/derived';

const STARTERS = ['How am I doing?', "What's my plan today?", 'Why is my profile uncertain?', 'Give me a memory tip', 'Will my flexibility improve?', 'Explain my collaboration score'];
const DIM_WORDS = DIMENSIONS.flatMap((d) => [d.short.toLowerCase(), ...d.synonyms]);

function VerifyChallengeCard() {
  const profile = useProfile();
  const now = useNow();
  const verify = useStore((s) => s.verify);
  const setVerify = useStore((s) => s.setVerify);
  const [picked, setPicked] = useState<number | null>(null);
  const c = verify.current;
  const found = verify.history.filter((h) => h.found).length;

  return (
    <Card>
      <CardHeader
        title="Verify the coach"
        icon={<ShieldCheck size={16} />}
        subtitle="An AI-literacy game. The coach makes three statements about your data — exactly one is deliberately wrong. Check your dashboard and find it."
      />
      {!c ? (
        <div className="space-y-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              const ch = createVerifyChallenge(profile, createRng(Date.now()), now);
              setPicked(null);
              if (ch) setVerify(ch);
            }}
            disabled={profile.filter((p) => !p.unmeasured).length < 3}
          >
            New challenge
          </Button>
          {profile.filter((p) => !p.unmeasured).length < 3 && <p className="text-[12.5px] text-ink-2">Available once three dimensions are measured.</p>}
          {verify.history.length > 0 && (
            <p className="text-[12.5px] text-ink-2">
              Found {found} of {verify.history.length} so far. Counts toward critical verification.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {c.statements.map((s, i) => {
            const reveal = picked !== null;
            return (
              <button
                key={i}
                type="button"
                disabled={reveal}
                onClick={() => {
                  setPicked(i);
                  setVerify(c, { found: !s.isTrue });
                }}
                className={clsx(
                  'w-full rounded-xl border p-3 text-left text-[13px] transition-colors',
                  reveal ? (s.isTrue ? 'border-line' : 'border-serious bg-serious/10') : 'border-line hover:border-brand',
                  picked === i && 'ring-2 ring-brand',
                )}
              >
                <div className="font-medium">“{s.text}”</div>
                <div className="mt-0.5 text-[12px] text-ink-2">{reveal ? `${s.isTrue ? 'True' : 'The wrong one'} — ${s.explanation}` : `Check: ${s.checkIn}`}</div>
              </button>
            );
          })}
          {picked !== null && (
            <div className="flex items-center justify-between pt-1 text-[12.5px]">
              <span className={c.statements[picked].isTrue ? 'text-ink-2' : 'font-medium text-good-text'}>
                {c.statements[picked].isTrue ? 'Not this one — the highlighted statement was the wrong one.' : 'Well spotted: you checked the evidence instead of trusting the AI.'}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setVerify(null)}>
                Done
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default function CoachPage() {
  const ctx = useCoachContext();
  const chat = useStore((s) => s.chat);
  const addChat = useStore((s) => s.addChat);
  const clearChat = useStore((s) => s.clearChat);
  const logEvent = useStore((s) => s.logEvent);
  const consent = useStore((s) => s.consent);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<{ llm: boolean; model: string | null } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!consent.voiceIn) stopRef.current();
    return () => stopRef.current();
  }, [consent.voiceIn]);

  // The server is only contacted when the user opted into the AI narrative.
  useEffect(() => {
    if (consent.llm) void checkHealth(true).then(setHealth);
    else setHealth({ llm: false, model: null });
  }, [consent.llm]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat.length, busy]);

  const send = async (raw: string) => {
    const message = raw.trim().slice(0, 1000);
    if (!message || busy) return;
    setText('');
    setNotice(null);
    const { text: clean, found } = redactPII(message);
    if (found.length) {
      logEvent('pii_shared', { kinds: found.join(',') });
      setNotice(`For your privacy I removed a ${found.join(' and ')} from your message. There's no need to share personal identifiers with the coach.`);
    }
    const { intent, dimension } = detectIntent(clean);
    const lastUser = [...chat].reverse().find((m) => m.role === 'user');
    const isFollowup = !!lastUser && Date.now() - lastUser.at < 4 * 60_000 && (lastUser.intent === intent || /^(and|what about|why|how come|so|but|ok)/i.test(clean) || (!!dimension && lastUser.text.toLowerCase().includes(dimension)));
    logEvent('chat_question', { clarifying: isClarifying(clean), specificity: specificity(clean, DIM_WORDS) });
    if (isFollowup) logEvent('followup');
    if (intent === 'clinical') {
      const insisted = !!lastUser && lastUser.intent === 'clinical';
      logEvent('clinical_query', { acceptedRedirect: !insisted });
    }
    const user: CoachMessage = { id: uid('um_'), role: 'user', text: clean, at: Date.now(), evidence: [], insightIds: [], confidence: 'high', source: 'user', intent };
    addChat(user);
    setBusy(true);
    try {
      const reply = await askCoach(clean, ctx, [...chat, user], () => useStore.getState().consent.llm && useStore.getState().chat.some((m) => m.id === user.id));
      // A pending reply must not recreate a conversation erased while it was in flight.
      const current = useStore.getState();
      if (!current.chat.some((m) => m.id === user.id)) return;
      if (reply.source === 'llm' && !current.consent.llm) return;
      addChat({ ...reply, at: Date.now() });
      logEvent('coach_message', { confidence: reply.confidence });
    } finally {
      setBusy(false);
    }
  };

  const mic = () => {
    if (listening) {
      stopRef.current();
      return;
    }
    stopRef.current = listenOnce(
      (t) => void send(t),
      (on, err) => {
        setListening(on);
        if (err) setNotice(err);
      },
    );
  };

  const welcome: CoachMessage = {
    id: 'welcome',
    role: 'coach',
    text: `Hi${ctx.name ? ` ${ctx.name}` : ''}! I can explain your profile and how certain it is, walk you through today's plan, suggest strategies, and help with goals. Everything I say comes with its evidence — tap “Why?” to check me.`,
    at: 0,
    evidence: [],
    insightIds: [],
    confidence: 'high',
    source: 'template',
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Coach"
        subtitle="Explainable, non-clinical coaching. Facts come from your data via a deterministic engine; language is generated on top and checked by a safety layer."
        right={
          <Badge tone={health?.llm && consent.llm ? 'brand' : 'neutral'}>
            {health === null ? 'checking…' : health.llm && consent.llm ? `AI narrative on · ${health.model}` : consent.llm ? 'Rule-based (AI server offline)' : 'Rule-based coach (offline)'}
          </Badge>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="flex min-h-[560px] flex-col p-0">
          <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            <CoachCard m={welcome} compact />
            {chat.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-md bg-brand px-3.5 py-2 text-[14px] text-brand-ink">{m.text}</div>
                </div>
              ) : (
                <div key={m.id}>
                  <CoachCard m={m} compact rate={m.source !== 'safe-reply'} />
                  {m.suggestions && m.suggestions.length > 0 && m.id === chat.at(-1)?.id && (
                    <div className="mt-2 flex flex-wrap gap-1.5 pl-11">
                      {m.suggestions.map((s) => (
                        <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-2 hover:border-brand hover:text-ink">
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}
            {busy && (
              <div className="flex items-center gap-2 pl-1 text-[13px] text-ink-2">
                <Bot size={16} /> thinking…
              </div>
            )}
            <div ref={endRef} />
          </div>
          {!chat.length && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {STARTERS.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-2 hover:border-brand hover:text-ink">
                  {s}
                </button>
              ))}
            </div>
          )}
          {notice && <div className="mx-4 mb-2 rounded-xl bg-warning/15 px-3 py-2 text-[12.5px]">{notice}</div>}
          <form
            className="flex items-end gap-2 border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
              }}
              rows={1}
              maxLength={1000}
              placeholder="Ask about your profile, plan, progress…"
              aria-label="Message to the coach"
              className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-line bg-card px-3 py-2 text-[14px] outline-none focus:border-brand"
            />
            {consent.voiceIn && canListen() && (
              <Button variant={listening ? 'primary' : 'secondary'} aria-label={listening ? 'Stop listening' : 'Speak'} onClick={mic} className={listening ? 'animate-pulse-ring' : ''}>
                {listening ? <MicOff size={16} /> : <Mic size={16} />}
              </Button>
            )}
            <Button type="submit" variant="primary" aria-label="Send" disabled={busy || !text.trim()}>
              <Send size={16} />
            </Button>
          </form>
        </Card>

        <div className="space-y-6">
          <VerifyChallengeCard />
          <Card>
            <CardHeader title="How this coach works" />
            <ol className="list-decimal space-y-1.5 pl-4 text-[13px] text-ink-2">
              <li>A deterministic engine turns your sessions into insights, each with evidence and a confidence level.</li>
              <li>The coach phrases them by rules, or with an optional AI model receiving aggregates and filtered conversation text. Avoid sharing personal details.</li>
              <li>A safety layer checks language, cited numbers and confidence. It cannot prove every claim is correct: check the evidence. Failed checks use the rule-based answer.</li>
              <li>Questions about health conditions get a fixed, reviewed reply pointing to qualified professionals.</li>
            </ol>
            {chat.length > 0 && (
              <Button size="sm" variant="ghost" className="mt-3" onClick={clearChat}>
                <Trash2 size={14} /> Clear conversation
              </Button>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
