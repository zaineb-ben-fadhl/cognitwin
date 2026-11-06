import { ArrowRight, Bot, Camera, CameraOff, Info, Lightbulb, MessageSquareWarning, ShieldCheck, Shuffle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CoachCard } from '@/components/coach/CoachCard';
import { DifficultyPath } from '@/components/charts/DifficultyPath';
import { DimLabel, dimColor } from '@/components/dim';
import { TaskRunner, type RunResult } from '@/components/tasks/TaskRunner';
import { Badge, Button, Card, CardHeader, ConfidenceBadge, InfoTip, IntervalBar, Modal, Segmented, Toggle } from '@/components/ui';
import {
  AFFECT_LABEL,
  AdaptiveSession,
  DISPUTE_LABEL,
  STRETCH_FORMAT_TARGET,
  TARGET_SUCCESS,
  TIER_LABEL,
  TRAINING_FORMATS,
  currentProfile,
  findDimension,
  findTask,
  finalizeSession,
  isMashedSession,
  levelForSuccess,
  nextStrategy,
  pushbackReply,
  rushQuestion,
  sessionFeedback,
  sessionInsights,
  sessionPrior,
  tierFor,
  tierTarget,
  uid,
  type CameraCues,
  type CoachMessage,
  type DisputeReason,
  type SelfReport,
  type SessionContext,
  type SessionMode,
  type SessionRecord,
  type TrainingFormat,
} from '@/engine';
import { CameraCueTracker } from '@/lib/camera';
import { sessionCoach } from '@/lib/coachClient';
import { fmtMetric } from '@/lib/format';
import { useStore } from '@/store';
import { useCoachContext } from '@/store/derived';

type Stage = 'intro' | 'practice' | 'run' | 'results';

const FORMATS: TrainingFormat[] = ['standard', 'stretch', 'interleaved', 'strategy'];

const RUSH_REPLY: Record<SessionContext, string> = {
  rushing: 'Thanks for being honest. Nothing is lost: those answers are already out of your estimate. When you have three calm minutes, a short re-check will tighten it again.',
  distracted: 'That happens. This session counts only a fraction and its uncertainty is widened, so your profile is protected. Try again somewhere quieter — it will sharpen things quickly.',
  testing: 'Fair enough — poking at the system is a good instinct. The session was caught as rushed and barely moved your estimate.',
  genuine: 'Thanks. I would still like a second look: answers that fast cannot be based on what was on screen. A calm re-check will tell us more than this one did.',
};

/** The coach's contextual question after a rushed / random-pressing session. */
function RushCheckCard({ session }: { session: SessionRecord }) {
  const setSessionContext = useStore((st) => st.setSessionContext);
  const live = session.behaviour.rushChecks?.at(-1)?.answer;
  const [answer, setAnswer] = useState<SessionContext | null>(session.context ?? null);
  const question = rushQuestion(session);
  if (!question) return null;
  const options: Array<[SessionContext, string]> = [
    ['rushing', 'I was rushing'],
    ['distracted', 'I was distracted'],
    ['testing', 'I was testing the app'],
    ['genuine', 'That was my real level'],
  ];
  return (
    <Card className="border-warning/60">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Bot size={17} />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-[15px] font-semibold">Data flagged as highly uncertain</div>
          <p className="text-[14px] leading-relaxed">{question}</p>
          {live && live !== 'continue' && !answer && <p className="text-[12.5px] text-ink-2">During the session you answered “{live === 'rushing' ? 'I was rushing' : live === 'distracted' ? 'I’m distracted' : 'stop here'}”.</p>}
          {answer ? (
            <p className="rounded-xl bg-card-2/60 p-3 text-[13.5px]">{RUSH_REPLY[answer]}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {options.map(([k, label]) => (
                <Button
                  key={k}
                  size="sm"
                  variant={k === 'rushing' ? 'primary' : 'secondary'}
                  onClick={() => {
                    setAnswer(k);
                    setSessionContext(session.id, k);
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

const DISPUTE_OPTIONS: DisputeReason[] = ['distraction', 'noise', 'interruption', 'device', 'fatigue', 'unwell', 'other'];

/** "This doesn't reflect me": the user contests a session, the twin re-weights it. */
function DisputeDialog({ session, onClose, onDone }: { session: SessionRecord; onClose: () => void; onDone: (m: CoachMessage) => void }) {
  const disputeSession = useStore((st) => st.disputeSession);
  const [reason, setReason] = useState<DisputeReason>('distraction');
  const [note, setNote] = useState('');
  return (
    <Modal open onClose={onClose} title="Disagree with this result?">
      <div className="space-y-4 text-sm">
        <p className="text-ink-2">
          Tell the coach what got in the way. The session keeps its data but counts half as much, and the estimate becomes more uncertain — so a calm re-check can settle it. You can undo this later in
          the Brain Twin session log.
        </p>
        <div className="flex flex-wrap gap-2">
          {DISPUTE_OPTIONS.map((r) => (
            <Button key={r} size="sm" variant={reason === r ? 'primary' : 'secondary'} onClick={() => setReason(r)}>
              {DISPUTE_LABEL[r].charAt(0).toUpperCase() + DISPUTE_LABEL[r].slice(1)}
            </Button>
          ))}
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} rows={2} placeholder="Optional: what happened?" className="w-full rounded-xl border border-line bg-card px-3 py-2" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              const outcome = disputeSession(session.id, reason, { note: note.trim() || undefined, source: 'button' });
              onDone(pushbackReply(outcome, reason));
            }}
          >
            Mark as disputed
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Scale({ label, value, onChange }: { label: string; value?: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[13px] text-ink-2">{label}</span>
      <Segmented ariaLabel={label} value={value ?? 0} onChange={onChange} options={[1, 2, 3, 4, 5].map((v) => ({ value: v, label: v === 1 ? '1 low' : v === 5 ? '5 high' : String(v) }))} />
    </div>
  );
}

export default function SessionPage() {
  const { taskId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const dim = findDimension(findTask(taskId)?.dimension ?? '');
  const twin = useStore((s) => s.twin);
  const sessions = useStore((s) => s.sessions);
  const settings = useStore((s) => s.settings);
  const consent = useStore((s) => s.consent);
  const calibration = useStore((s) => s.calibration);
  const recordSession = useStore((s) => s.recordSession);
  const logEvent = useStore((s) => s.logEvent);
  const ctx = useCoachContext();

  const state = dim ? twin.dims[dim.id] : undefined;
  const requested = ['assessment', 'training'].includes(params.get('mode') ?? '') ? params.get('mode') as SessionMode : null;
  const mode: SessionMode = requested ?? (!state || state.lastUpdated === null ? 'assessment' : 'training');
  const planItemId = params.get('plan') ?? undefined;
  const queue = (params.get('queue') ?? '').split(',').filter(Boolean);
  const firstTime = !sessions.some((s) => s.taskId === taskId);
  const reviewId = params.get('review');
  const reviewed = reviewId ? sessions.find((s) => s.id === reviewId && s.taskId === taskId) : undefined;
  const planItem = useStore((st) => (planItemId ? st.plans.flatMap((p) => p.items).find((i) => i.id === planItemId) : undefined));
  // Per-dimension difficulty: tier from THIS dimension's estimate, format from the plan (plateau breaker).
  const dimProfile = dim ? currentProfile(twin, Date.now()).find((p) => p.id === dim.id) : undefined;
  const tier = planItem?.tier ?? (dimProfile ? tierFor(dimProfile) : 'core');
  const urlFormat = params.get('format') as TrainingFormat | null;
  const format: TrainingFormat = mode === 'training' ? (urlFormat && FORMATS.includes(urlFormat) ? urlFormat : (planItem?.format ?? 'standard')) : 'standard';
  const baseTarget = mode === 'training' ? (planItem?.targetSuccess ?? tierTarget(settings.challenge, tier)) : undefined;
  const target = baseTarget === undefined ? undefined : format === 'stretch' ? Math.min(baseTarget, STRETCH_FORMAT_TARGET) : baseTarget;
  const strategyKey = format === 'strategy' && dim ? (planItem?.strategyKey ?? nextStrategy(sessions, dim.id)) : undefined;
  const strategy = strategyKey && dim ? dim.strategies.find((x) => x.key === strategyKey) : undefined;

  const [stage, setStage] = useState<Stage>(reviewed ? 'results' : 'intro');
  const [prediction, setPrediction] = useState<number>(50);
  const [predict, setPredict] = useState(settings.askSelfPrediction);
  const [checkIn, setCheckIn] = useState<SelfReport>({});
  const [practice, setPractice] = useState(firstTime || tier === 'foundational');
  const [cameraOn, setCameraOn] = useState(consent.camera);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [record, setRecord] = useState<SessionRecord | null>(reviewed ?? null);
  const [coach, setCoach] = useState<CoachMessage | null>(() => {
    if (!reviewed) return null;
    const previous = [...sessions].filter((x) => x.dimension === reviewed.dimension && x.endedAt < reviewed.endedAt).at(-1);
    return sessionFeedback(reviewed, sessionInsights(reviewed, previous));
  });
  const [disputing, setDisputing] = useState(false);
  const [disputeReply, setDisputeReply] = useState<CoachMessage | null>(null);
  const [reflected, setReflected] = useState<string | null>(null);
  // Keep the results in sync with the store (a dispute rebuilds the session's posterior).
  const live = record ? sessions.find((x) => x.id === record.id) : undefined;
  const videoRef = useRef<HTMLVideoElement>(null);
  const tracker = useRef<CameraCueTracker | null>(null);
  const priorRef = useRef(dim ? sessionPrior(twin, dim.id, Date.now()) : { mean: 0, sd: 1.2 });

  const adaptive = useMemo(
    () => (dim && stage === 'run' ? new AdaptiveSession(dim.task, { mode, prior: priorRef.current, challenge: settings.challenge, format, targetSuccess: target }) : null),
    // A new adaptive session only when the run starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stage === 'run'],
  );

  // Camera lifecycle: on-device, only during practice/run, only with consent.
  const cameraActive = cameraOn && consent.camera && (stage === 'run' || stage === 'practice');
  useEffect(() => {
    if (!cameraActive || !videoRef.current) return;
    let cancelled = false;
    const fail = (e: unknown) => {
      if (cancelled) return;
      setCameraError(e instanceof Error && e.name === 'NotAllowedError' ? 'Camera permission denied — continuing in non-biometric mode.' : 'Camera unavailable — continuing in non-biometric mode.');
      if (tracker.current === t) tracker.current = null;
      t.stop();
    };
    const t = new CameraCueTracker(fail);
    setCameraError(null);
    tracker.current = t;
    void t.start(videoRef.current).catch(fail);
    return () => {
      cancelled = true;
      t.stop();
      if (tracker.current === t) tracker.current = null;
    };
  }, [cameraActive]);
  useEffect(() => {
    if (stage === 'run') tracker.current?.reset();
  }, [stage]);

  if (!dim) {
    return (
      <Card>
        <p>Unknown activity.</p>
        <Link to="/train" className="text-brand">
          Back to training
        </Link>
      </Card>
    );
  }

  const task = dim.task;
  const color = dimColor(dim.id);
  const startLevel = mode === 'training' ? levelForSuccess(priorRef.current, target ?? TARGET_SUCCESS[settings.challenge], task) : null;
  const factor = calibration?.factor ?? 1.15;

  const finish = async (res: RunResult, quit: boolean) => {
    let camera: CameraCues | undefined;
    if (tracker.current) {
      camera = tracker.current.cues();
      tracker.current.stop();
      tracker.current = null;
    }
    if (quit && res.trials.length < 3) {
      navigate(-1);
      return;
    }
    const session = finalizeSession({
      id: uid('s_'),
      taskId: task.id,
      mode,
      startedAt: res.startedAt,
      endedAt: res.endedAt,
      trials: res.trials,
      behaviour: res.behaviour,
      prior: priorRef.current,
      selfPrediction: predict ? prediction : undefined,
      selfReportBefore: checkIn.mood || checkIn.energy ? checkIn : undefined,
      camera: camera && camera.samples > 0 ? camera : undefined,
      deadlineFactor: factor,
      planItemId,
      format,
      targetSuccess: target,
      strategyKey,
    });
    const previous = [...sessions].reverse().find((s) => s.dimension === dim.id);
    const insights = sessionInsights(session, previous);
    recordSession(session);
    setRecord(session);
    setStage('results');
    logEvent('coach_message', { confidence: session.scoreAfter.confidence });
    const message = await sessionCoach(session, insights, ctx, () => useStore.getState().consent.llm && useStore.getState().sessions.some((s) => s.id === session.id));
    setCoach(message);
  };

  // ---------------------------------------------------------------- intro
  if (stage === 'intro') {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2 text-[13px] text-ink-2">
          <DimLabel id={dim.id} short={false} />
          <Badge tone={mode === 'assessment' ? 'brand' : 'neutral'}>{mode === 'assessment' ? 'Check-in (adaptive)' : 'Training'}</Badge>
          {queue.length > 0 && <Badge>Baseline · {6 - queue.length} of 6</Badge>}
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{task.name}</h1>
          <p className="mt-1 text-ink-2">{task.tagline}</p>
        </div>
        <Card>
          <ol className="list-decimal space-y-1.5 pl-5 text-[14px]">
            {task.instructions.map((s: string) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <div className="mt-4 grid gap-3 border-t border-line pt-4 text-[13px] text-ink-2 sm:grid-cols-2">
            <div>
              <div className="font-medium text-ink">What this trains</div>
              <p className="mt-0.5">{dim.definition}</p>
            </div>
            <div>
              <div className="font-medium text-ink">How it adapts</div>
              <p className="mt-0.5">
                {mode === 'assessment'
                  ? 'Each trial is chosen to be as informative as possible; it stops as soon as the estimate is precise enough (no fixed length).'
                  : `Starts at level ${startLevel} (${task.levelDescription(startLevel!)}) and keeps you near ${Math.round((target ?? TARGET_SUCCESS[settings.challenge]) * 100)} % success.`}
              </p>
            </div>
          </div>
        </Card>

        {mode === 'training' && (format !== 'standard' || tier !== 'core') && (
          <Card className="border-brand/50">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">{format === 'strategy' ? <Lightbulb size={16} /> : <Shuffle size={16} />}</span>
              <div className="min-w-0 flex-1 space-y-1.5 text-[13.5px]">
                <div className="flex flex-wrap items-center gap-2">
                  {format !== 'standard' && <Badge tone="brand">{TRAINING_FORMATS[format].name} format</Badge>}
                  {tier !== 'core' && <Badge tone={tier === 'advanced' ? 'good' : 'warn'}>{TIER_LABEL[tier]} difficulty</Badge>}
                  {target !== undefined && <span className="text-[12px] text-ink-2">target ≈ {Math.round(target * 100)} % success</span>}
                </div>
                {format !== 'standard' && (
                  <p>
                    {TRAINING_FORMATS[format].description} <span className="text-ink-2">Why: {TRAINING_FORMATS[format].science}</span>
                  </p>
                )}
                {planItem?.formatNote && <p className="text-ink-2">{planItem.formatNote}</p>}
                {tier !== 'core' && (
                  <p className="text-ink-2">
                    {tier === 'advanced'
                      ? `${dim.short} is one of your strongest areas, so it trains above your usual comfort zone — difficulty is set from this area alone, not from your average.`
                      : `${dim.short} starts with foundational steps at its own level — difficulty is set from this area alone, not from your average. A practice round is switched on.`}
                  </p>
                )}
                {strategy && (
                  <div className="rounded-xl bg-card-2/60 p-3">
                    <div className="font-semibold">Strategy to try: {strategy.title}</div>
                    <p className="mt-0.5">{strategy.detail}</p>
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}

        <Card>
          <CardHeader title="Before you start" subtitle="Both are optional — they power the self-awareness and working-state features." />
          <Toggle checked={predict} onChange={setPredict} label="Predict your result" description="Guess the score you’ll have after this session. Comparing guesses with results trains self-awareness." />
          {predict && (
            <div className="flex items-center gap-3 pb-2">
              <input type="range" min={0} max={100} value={prediction} onChange={(e) => setPrediction(Number(e.target.value))} className="flex-1 accent-[var(--brand)]" aria-label="Predicted score" />
              <span className="w-12 text-right font-semibold tabular">{prediction} %</span>
            </div>
          )}
          {settings.askCheckIn && (
            <div className="space-y-2 border-t border-line pt-3">
              <Scale label="Mood right now" value={checkIn.mood} onChange={(v) => setCheckIn((c) => ({ ...c, mood: v }))} />
              <Scale label="Energy right now" value={checkIn.energy} onChange={(v) => setCheckIn((c) => ({ ...c, energy: v }))} />
            </div>
          )}
          <div className="border-t border-line pt-1">
            <Toggle checked={practice} onChange={setPractice} label="Practice round first" description={`${task.practiceTrials} unscored trial${task.practiceTrials > 1 ? 's' : ''} with feedback.`} />
            {consent.camera && (
              <Toggle
                checked={cameraOn}
                onChange={setCameraOn}
                label={
                  <span className="inline-flex items-center gap-1.5">
                    {cameraOn ? <Camera size={14} /> : <CameraOff size={14} />} Camera cues for this session
                  </span>
                }
                description="On-device only; four averages are kept, no images. Off = non-biometric mode."
              />
            )}
          </div>
        </Card>
        <div className="flex justify-between">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              priorRef.current = sessionPrior(useStore.getState().twin, dim.id, Date.now());
              setStage(practice ? 'practice' : 'run');
            }}
          >
            {practice ? 'Start practice' : 'Start'} <ArrowRight size={16} />
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- practice / run
  if (stage === 'practice' || stage === 'run') {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <DimLabel id={dim.id} />
            <span className="text-[13px] text-ink-2">{task.name}</span>
            {stage === 'practice' && <Badge tone="brand">Practice — not scored</Badge>}
          </div>
          {cameraOn && consent.camera && (
            <div className="flex items-center gap-2 text-[11.5px] text-ink-2">
              <video ref={videoRef} muted playsInline className="h-9 w-12 rounded-md bg-card-2 object-cover" aria-label="Camera preview (on-device)" />
              <span className="hidden sm:inline">{cameraError ?? 'Camera cues on-device'}</span>
            </div>
          )}
        </div>
        {stage === 'practice' ? (
          <TaskRunner
            key="practice"
            task={task}
            adaptive={null}
            practiceTrials={task.practiceTrials}
            deadlineFactor={factor * 1.3}
            colourIndependent={settings.colourIndependent}
            onComplete={() => setStage('run')}
            onQuit={() => setStage('run')}
          />
        ) : (
          <TaskRunner
            key="run"
            task={task}
            adaptive={adaptive}
            deadlineFactor={factor}
            colourIndependent={settings.colourIndependent}
            voice={consent.voiceOut && settings.speakCoach}
            onComplete={(r) => void finish(r, false)}
            onQuit={(r) => void finish(r, true)}
          />
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------- results
  const s = live ?? record!;
  const delta = s.scoreAfter.score - s.scoreBefore.score;
  const mashed = isMashedSession(s.quality);
  const strategyUsed = s.strategyKey ? dim.strategies.find((x) => x.key === s.strategyKey) : undefined;
  const nextTask = queue[0];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-ink-2">
            <DimLabel id={dim.id} /> {task.name} · {s.trials.length} trials
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{reviewed ? (s.mode === 'assessment' ? 'Check-in review' : 'Session review') : s.mode === 'assessment' ? 'Check-in complete' : 'Session complete'}</h1>
        </div>
        <div className="flex gap-2">
          {nextTask ? (
            <Button variant="primary" onClick={() => navigate(`/session/${nextTask}?mode=assessment&queue=${queue.slice(1).join(',')}`)}>
              Next: {findTask(nextTask)?.name ?? 'next activity'} <ArrowRight size={15} />
            </Button>
          ) : (
            <>
              <Button onClick={() => navigate(`/session/${task.id}?mode=training`)}>Train again</Button>
              <Button variant="primary" onClick={() => navigate('/')}>
                Back to Today
              </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader
          title={`${dim.name} estimate`}
          subtitle="Before and after this session, with 80 % intervals"
          right={
            <div className="flex items-center gap-2">
              {s.dispute && <Badge tone="warn">disputed</Badge>}
              {mashed && <Badge tone="critical">highly uncertain</Badge>}
              <ConfidenceBadge confidence={s.scoreAfter.confidence} />
            </div>
          }
        />
        <div className="space-y-4">
          {[
            { label: 'Before', sc: s.scoreBefore, muted: true },
            { label: 'After', sc: s.scoreAfter, muted: false },
          ].map(({ label, sc, muted }) => (
            <div key={label} className="grid grid-cols-[56px_1fr_120px] items-center gap-3">
              <span className="text-[13px] text-ink-2">{label}</span>
              <IntervalBar score={sc.score} lo={sc.lo} hi={sc.hi} color={color} muted={muted} />
              <span className="text-right text-[13px] tabular">
                <strong className="text-[15px]">{Math.round(sc.score)} %</strong> <span className="text-ink-2">({Math.round(sc.lo)}–{Math.round(sc.hi)})</span>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[13px] text-ink-2">
          {Math.abs(delta) < 2 ? 'The estimate held steady' : `The estimate moved ${delta > 0 ? 'up' : 'down'} by ${Math.abs(Math.round(delta))} points`} and the interval{' '}
          {s.scoreAfter.hi - s.scoreAfter.lo < s.scoreBefore.hi - s.scoreBefore.lo - 0.5
            ? 'narrowed — the twin knows you better now.'
            : s.scoreAfter.hi - s.scoreAfter.lo > s.scoreBefore.hi - s.scoreBefore.lo + 0.5
              ? 'widened — this session made the twin less sure, by design, because its data is in doubt.'
              : 'stayed similar.'}
          {s.selfPrediction !== undefined && ` You predicted ${s.selfPrediction} %.`}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[12.5px] text-ink-2">
          {s.dispute ? (
            <span>You disputed this session ({DISPUTE_LABEL[s.dispute.reason]}): it counts {Math.round(s.dispute.weightFactor * 100)} % of its usual weight and its uncertainty is widened.</span>
          ) : (
            <>
              <span>Doesn’t reflect you?</span>
              <Button size="sm" variant="ghost" onClick={() => setDisputing(true)}>
                <MessageSquareWarning size={14} /> Disagree with this result
              </Button>
            </>
          )}
        </div>
      </Card>

      {mashed && <RushCheckCard session={s} />}
      {disputeReply && <CoachCard m={disputeReply} />}

      {strategyUsed && (
        <Card>
          <CardHeader title={`Did “${strategyUsed.title}” help?`} icon={<Lightbulb size={16} />} subtitle="Your judgement decides whether the coach keeps suggesting it." />
          {reflected ? (
            <p className="text-[13px] text-ink-2">Noted — {reflected === 'yes' ? 'keep using it; the next plateau-breaker will build on it.' : reflected === 'no' ? 'the next strategy-focus session will suggest a different one.' : 'no problem; it will come back another time.'}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {[
                ['yes', 'Yes, it helped'],
                ['no', 'Not really'],
                ['skipped', 'I didn’t try it'],
              ].map(([k, label]) => (
                <Button
                  key={k}
                  size="sm"
                  onClick={() => {
                    setReflected(k);
                    logEvent('strategy_reflection', { answer: k, strategy: strategyUsed.key });
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
          )}
        </Card>
      )}

      {coach ? <CoachCard m={coach} rate /> : <Card className="text-sm text-ink-2">The coach is reviewing your session…</Card>}
      {disputing && (
        <DisputeDialog
          session={s}
          onClose={() => setDisputing(false)}
          onDone={(m) => {
            setDisputing(false);
            setDisputeReply(m);
          }}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Difficulty path" subtitle="How the activity adapted, trial by trial" />
          <DifficultyPath trials={s.trials} color={color} />
        </Card>
        <Card>
          <CardHeader title="Measures" subtitle="Score, response time, errors and behaviour" />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {s.metrics
              .filter((m) => m.value !== null)
              .map((m) => (
                <div key={m.key}>
                  <dt className="flex items-center gap-1 text-[12px] text-ink-2">
                    {m.label} {m.help && <InfoTip text={m.help} />}
                  </dt>
                  <dd className="text-[15px] font-semibold tabular">{fmtMetric(m.value, m.unit, m.digits ?? 0)}</dd>
                </div>
              ))}
          </dl>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Data quality" icon={<ShieldCheck size={16} />} right={<Badge tone={s.quality.reliability === 'good' ? 'good' : s.quality.reliability === 'fair' ? 'warn' : 'critical'}>{s.quality.reliability}</Badge>} />
          <p className="text-[13px] text-ink-2">This session counted with weight {Math.round(s.quality.weight * 100)} % in your Brain Twin.</p>
          {s.quality.flags.length ? (
            <ul className="mt-2 space-y-1 text-[13px]">
              {s.quality.flags.map((f) => (
                <li key={f.kind} className="flex gap-2">
                  <Info size={14} className="mt-0.5 shrink-0 text-ink-2" /> {f.detail}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-ink-2">No interruptions, implausibly fast presses or random patterns detected.</p>
          )}
        </Card>
        <Card>
          <CardHeader title="Working state" subtitle="Used only to adapt the coach’s tone and breaks — never your score" right={<Badge>{AFFECT_LABEL[s.affect.state]}</Badge>} />
          {s.affect.evidence.length ? (
            <ul className="space-y-1 text-[13px]">
              {s.affect.evidence.map((e, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="text-ink-2">
                    {e.signal} <span className="text-muted">({e.source})</span>
                  </span>
                  <span className="tabular">{e.value}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-2">No strong signals either way.</p>
          )}
          {s.affect.cameraCapped && <p className="mt-2 text-[12.5px] text-ink-2">Camera cues alone were not enough to conclude anything — by design, they never decide on their own.</p>}
          <p className="mt-2 text-[12px] text-muted">Sources: {s.affect.sources.length ? s.affect.sources.join(', ') : 'none'} · confidence {Math.round(s.affect.confidence * 100)} %</p>
        </Card>
      </div>
    </div>
  );
}
