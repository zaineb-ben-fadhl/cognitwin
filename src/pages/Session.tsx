import { ArrowRight, Camera, CameraOff, Info, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CoachCard } from '@/components/coach/CoachCard';
import { DifficultyPath } from '@/components/charts/DifficultyPath';
import { DimLabel, dimColor } from '@/components/dim';
import { TaskRunner, type RunResult } from '@/components/tasks/TaskRunner';
import { Badge, Button, Card, CardHeader, ConfidenceBadge, InfoTip, IntervalBar, Segmented, Toggle } from '@/components/ui';
import {
  AFFECT_LABEL,
  AdaptiveSession,
  findDimension,
  findTask,
  finalizeSession,
  levelForSuccess,
  sessionInsights,
  sessionPrior,
  TARGET_SUCCESS,
  uid,
  type CameraCues,
  type CoachMessage,
  type SelfReport,
  type SessionMode,
  type SessionRecord,
} from '@/engine';
import { CameraCueTracker } from '@/lib/camera';
import { sessionCoach } from '@/lib/coachClient';
import { fmtMetric } from '@/lib/format';
import { useStore } from '@/store';
import { useCoachContext } from '@/store/derived';

type Stage = 'intro' | 'practice' | 'run' | 'results';

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

  const [stage, setStage] = useState<Stage>('intro');
  const [prediction, setPrediction] = useState<number>(50);
  const [predict, setPredict] = useState(settings.askSelfPrediction);
  const [checkIn, setCheckIn] = useState<SelfReport>({});
  const [practice, setPractice] = useState(firstTime);
  const [cameraOn, setCameraOn] = useState(consent.camera);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [record, setRecord] = useState<SessionRecord | null>(null);
  const [coach, setCoach] = useState<CoachMessage | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const tracker = useRef<CameraCueTracker | null>(null);
  const priorRef = useRef(dim ? sessionPrior(twin, dim.id, Date.now()) : { mean: 0, sd: 1.2 });

  const adaptive = useMemo(
    () => (dim && stage === 'run' ? new AdaptiveSession(dim.task, { mode, prior: priorRef.current, challenge: settings.challenge }) : null),
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
  const startLevel = mode === 'training' ? levelForSuccess(priorRef.current, TARGET_SUCCESS[settings.challenge], task) : null;
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
                  : `Starts at level ${startLevel} (${task.levelDescription(startLevel!)}) and keeps you near ${Math.round(TARGET_SUCCESS[settings.challenge] * 100)} % success.`}
              </p>
            </div>
          </div>
        </Card>

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
  const s = record!;
  const delta = s.scoreAfter.score - s.scoreBefore.score;
  const nextTask = queue[0];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-ink-2">
            <DimLabel id={dim.id} /> {task.name} · {s.trials.length} trials
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{mode === 'assessment' ? 'Check-in complete' : 'Session complete'}</h1>
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
          right={<ConfidenceBadge confidence={s.scoreAfter.confidence} />}
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
          {s.scoreAfter.hi - s.scoreAfter.lo < s.scoreBefore.hi - s.scoreBefore.lo ? 'narrowed — the twin knows you better now.' : 'stayed similar.'}
          {s.selfPrediction !== undefined && ` You predicted ${s.selfPrediction} %.`}
        </p>
      </Card>

      {coach ? <CoachCard m={coach} rate /> : <Card className="text-sm text-ink-2">The coach is reviewing your session…</Card>}

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
