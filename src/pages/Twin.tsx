import { History, Table2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { RadarEntry } from '@/components/charts/ProfileRadar';
import { CalendarHeatmap, DimensionMatrix, type MatrixCell } from '@/components/charts/Heatmaps';
import { ProgressChart } from '@/components/charts/ProgressChart';
import { DimLabel, dimColor } from '@/components/dim';
import { ProfileView, toRadar } from '@/components/ProfileView';
import { Badge, Button, Card, CardHeader, EmptyState, Modal, PageHeader, Toggle } from '@/components/ui';
import { AFFECT_LABEL, DIMENSIONS, dimensionHistory, getDimension, modelFor, pSuccess, snapshotAt, type DimensionId, type SessionRecord, type TwinSnapshot } from '@/engine';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useStore } from '@/store';
import { useGoalStatuses, useNow, useProfile, useProjections } from '@/store/derived';

const DAY = 86_400_000;

function snapshotEntries(snap: TwinSnapshot | null, ids: DimensionId[]): RadarEntry[] {
  return ids.map((id) => {
    const e = snap?.dims[id];
    const measured = !!snap && snap.dims[id] && (snap.dims[id].sd < 1.19 || snap.changed === id);
    return e && measured ? { id, score: e.score, lo: e.lo, hi: e.hi } : { id, score: 0, lo: 0, hi: 0, unmeasured: true };
  });
}

function weeklyChange(sessions: SessionRecord[], twin: ReturnType<typeof useStore.getState>['twin'], now: number, weeks = 8) {
  const ids = DIMENSIONS.map((d) => d.id);
  const columns: string[] = [];
  const cells: MatrixCell[][] = ids.map(() => []);
  for (let w = weeks - 1; w >= 0; w--) {
    const end = now - w * 7 * DAY;
    const start = end - 7 * DAY;
    columns.push(fmtDate(start));
    ids.forEach((id, ri) => {
      const inWeek = sessions.filter((s) => s.dimension === id && s.endedAt > start && s.endedAt <= end);
      if (!inWeek.length) return cells[ri].push({ value: null, label: 'no session' });
      // The first-ever measurement is a baseline, not a change from the (arbitrary) starting prior.
      const measuredBefore = sessions.some((s) => s.dimension === id && s.endedAt <= start);
      if (!measuredBefore && inWeek.length === 1) return cells[ri].push({ value: null, label: 'baseline measurement', detail: `${Math.round(inWeek[0].scoreAfter.score)} %` });
      const before = measuredBefore ? (snapshotAt(twin, start)?.dims[id]?.score ?? inWeek[0].scoreBefore.score) : inWeek[0].scoreAfter.score;
      const after = snapshotAt(twin, end)?.dims[id]?.score ?? inWeek.at(-1)!.scoreAfter.score;
      const d = after - before;
      cells[ri].push({ value: d, label: `${d >= 0 ? '+' : ''}${d.toFixed(1)} pts`, detail: `${inWeek.length} session${inWeek.length > 1 ? 's' : ''}` });
    });
  }
  return { ids, columns, cells };
}

function timeOfDay(sessions: SessionRecord[]) {
  const ids = DIMENSIONS.map((d) => d.id);
  const bands = ['Morning', 'Afternoon', 'Evening'];
  const band = (s: SessionRecord) => {
    const h = new Date(s.startedAt).getHours();
    return h < 12 ? 0 : h < 18 ? 1 : 2;
  };
  const cells: MatrixCell[][] = ids.map((id) =>
    bands.map((_, b) => {
      const ss = sessions.filter((s) => s.dimension === id && s.trials.length && band(s) === b);
      if (ss.length < 2) return { value: null, label: 'too few sessions' };
      let k = 0;
      let e = 0;
      let n = 0;
      for (const s of ss) {
        for (const t of s.trials) {
          k += t.success ? 1 : 0;
          e += pSuccess(s.before.mean, t.level, modelFor(id));
          n++;
        }
      }
      const v = (100 * (k - e)) / n;
      return { value: v, label: `${v >= 0 ? '+' : ''}${v.toFixed(1)} pts vs expected`, detail: `${ss.length} sessions, ${n} trials` };
    }),
  );
  return { ids, bands, cells };
}

export default function TwinPage() {
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const twin = useStore((s) => s.twin);
  const sessions = useStore((s) => s.sessions);
  const deleteSession = useStore((s) => s.deleteSession);
  const profile = useProfile();
  const projections = useProjections();
  const goals = useGoalStatuses();
  const [showProjection, setShowProjection] = useState(true);
  const [replay, setReplay] = useState(twin.snapshots.length - 1);
  const [confirm, setConfirm] = useState<SessionRecord | null>(null);
  const [tableDim, setTableDim] = useState<DimensionId | null>(null);
  const [logRows, setLogRows] = useState(12);
  const focus = params.get('dim');
  const ids = DIMENSIONS.map((d) => d.id);

  const snap = twin.snapshots[Math.min(replay, twin.snapshots.length - 1)] ?? null;
  const snapSession = snap ? sessions.find((s) => s.id === snap.sessionId) : undefined;
  const minutesByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) {
      const k = new Date(s.endedAt).toDateString();
      m.set(k, (m.get(k) ?? 0) + (s.endedAt - s.startedAt) / 60000);
    }
    return m;
  }, [sessions]);
  const weekly = useMemo(() => weeklyChange(sessions, twin, now), [sessions, twin, now]);
  const tod = useMemo(() => timeOfDay(sessions), [sessions]);
  const maxWeekly = Math.max(5, ...weekly.cells.flat().map((c) => Math.abs(c.value ?? 0)));
  const maxTod = Math.max(5, ...tod.cells.flat().map((c) => Math.abs(c.value ?? 0)));

  if (!sessions.length) {
    return (
      <div>
        <PageHeader title="Brain Twin" />
        <Card>
          <EmptyState icon={<History size={28} />} title="Your twin has no history yet">
            Complete a check-in and every session will be stored here as a snapshot you can replay.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const ordered = focus ? [focus, ...ids.filter((i) => i !== focus)] : ids;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Brain Twin"
        subtitle="A living, historised model of your profile. Every session adds a snapshot; uncertainty grows again when a skill is not practised."
      />

      <Card>
        <CardHeader title="Replay your twin" icon={<History size={16} />} subtitle="Drag through time: the radar shows the twin as it was after each session, compared with today (grey)." />
        <div className="grid items-center gap-6 lg:grid-cols-[1fr_280px]">
          <ProfileView entries={snapshotEntries(snap, ids)} compare={toRadar(profile)} compareLabel="Today" label="Selected snapshot" />
          <div className="space-y-3">
            <input
              type="range"
              min={0}
              max={twin.snapshots.length - 1}
              value={Math.min(replay, twin.snapshots.length - 1)}
              onChange={(e) => setReplay(Number(e.target.value))}
              className="w-full accent-[var(--brand)]"
              aria-label="Snapshot"
            />
            <div className="text-[13px]">
              <div className="font-semibold">
                Snapshot {Math.min(replay, twin.snapshots.length - 1) + 1} of {twin.snapshots.length}
              </div>
              <div className="text-ink-2">{snap && fmtDateTime(snap.at)}</div>
            </div>
            {snapSession && (
              <div className="rounded-xl border border-line p-3 text-[13px]">
                <DimLabel id={snapSession.dimension} />
                <div className="mt-1 text-ink-2">
                  {snapSession.mode === 'assessment' ? 'Check-in' : 'Training'} · {snapSession.trials.length || '—'} trials
                </div>
                <div className="mt-1">
                  {Math.round(snapSession.scoreBefore.score)} → <strong>{Math.round(snapSession.scoreAfter.score)} %</strong>
                  <span className="text-ink-2"> (±{Math.round((snapSession.scoreAfter.hi - snapSession.scoreAfter.lo) / 2)})</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Progress curves</h2>
          <div className="w-72">
            <Toggle checked={showProjection} onChange={setShowProjection} label="Show cautious projections" description="Dashed line and fan: 50 % and 80 % bands, 4 weeks ahead." />
          </div>
        </div>
        {showProjection && (
          <p className="mb-3 rounded-xl bg-card-2/60 px-3 py-2 text-[12.5px] text-ink-2">
            Projections fit your own learning curve and assume practice continues at the current pace. They are possibilities with honest error bands — never promises. In
            simulation, the 80 % band contained the true future level about 89 % of the time.
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {ordered.map((id) => {
            const history = dimensionHistory(twin, id);
            const goal = goals.find((g) => g.goal.kind === 'score' && g.goal.dimension === id && !g.goal.archived && !g.goal.achievedAt)?.goal.target;
            const proj = projections[id];
            return (
              <Card key={id} className={focus === id ? 'border-brand' : ''}>
                <CardHeader
                  title={<DimLabel id={id} short={false} />}
                  subtitle={`${history.length} session${history.length === 1 ? '' : 's'}${proj && showProjection ? ` · projected ${proj.weeklyChange >= 0 ? '+' : ''}${proj.weeklyChange.toFixed(1)} pts / week` : ''}`}
                  right={
                    <Button size="sm" variant="ghost" aria-label="Show as table" onClick={() => setTableDim(id)}>
                      <Table2 size={14} />
                    </Button>
                  }
                />
                {history.length ? (
                  <ProgressChart history={history} projection={showProjection ? proj : null} color={dimColor(id)} goal={goal} height={200} compact />
                ) : (
                  <EmptyState title="Not measured yet" />
                )}
                {showProjection && history.length > 0 && !proj && <p className="mt-1 text-[12px] text-muted">Projection needs at least 3 sessions over 2+ days.</p>}
              </Card>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Practice calendar" subtitle="Minutes per day, last 12 weeks" />
          <CalendarHeatmap minutesByDay={minutesByDay} now={now} />
        </Card>
        <Card>
          <CardHeader title="Best time of day" subtitle="Success compared with what the model expected (removes the effect of difficulty)" />
          <DimensionMatrix rows={tod.ids} columns={tod.bands} cells={tod.cells} unit="points vs expected" maxAbs={maxTod} legendLow="below expected" legendHigh="above expected" />
        </Card>
      </div>
      <Card>
        <CardHeader title="Weekly change heatmap" subtitle="How much each estimate moved per week (blue = up, orange = down, grey = flat)" />
        <DimensionMatrix rows={weekly.ids} columns={weekly.columns} cells={weekly.cells} unit="score points per week" maxAbs={maxWeekly} legendLow="down" legendHigh="up" />
      </Card>

      <Card>
        <CardHeader title="Session log" subtitle="Full history. Deleting a session rebuilds the twin from the remaining ones." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-ink-2">
                <th className="py-2 font-medium">When</th>
                <th className="py-2 font-medium">Dimension</th>
                <th className="py-2 font-medium">Type</th>
                <th className="py-2 text-right font-medium">Trials</th>
                <th className="py-2 text-right font-medium">Estimate</th>
                <th className="py-2 font-medium">Quality</th>
                <th className="py-2 font-medium">State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...sessions]
                .reverse()
                .slice(0, logRows)
                .map((s) => {
                  const d = s.scoreAfter.score - s.scoreBefore.score;
                  return (
                    <tr key={s.id} className="border-b border-line/60">
                      <td className="py-2 whitespace-nowrap text-ink-2">{fmtDateTime(s.startedAt)}</td>
                      <td className="py-2">
                        <DimLabel id={s.dimension} />
                      </td>
                      <td className="py-2 text-ink-2">{s.mode === 'assessment' ? 'Check-in' : 'Training'}</td>
                      <td className="py-2 text-right tabular">{s.trials.length || '—'}</td>
                      <td className="py-2 text-right tabular">
                        {Math.round(s.scoreAfter.score)} % <span className="text-ink-2">({d >= 0 ? '+' : ''}{d.toFixed(1)})</span>
                      </td>
                      <td className="py-2">
                        <Badge tone={s.quality.reliability === 'good' ? 'good' : s.quality.reliability === 'fair' ? 'warn' : 'critical'}>{s.quality.reliability}</Badge>
                      </td>
                      <td className="py-2 text-ink-2">{AFFECT_LABEL[s.affect.state]}</td>
                      <td className="py-2 text-right">
                        <Button size="sm" variant="ghost" aria-label="Delete session" onClick={() => setConfirm(s)}>
                          <Trash2 size={14} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {sessions.length > logRows && (
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" variant="ghost" onClick={() => setLogRows((n) => n + 24)}>
              Show more
            </Button>
            <span className="text-[12px] text-muted">
              Showing {logRows} of {sessions.length}. The full history is in the JSON export.
            </span>
          </div>
        )}
      </Card>

      {confirm && (
        <Modal open onClose={() => setConfirm(null)} title="Delete this session?">
          <p className="text-sm text-ink-2">
            The {getDimension(confirm.dimension).short} session of {fmtDateTime(confirm.startedAt)} will be removed and your Brain Twin will be rebuilt from the remaining sessions.
            This cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                deleteSession(confirm.id);
                setConfirm(null);
                setReplay(Number.MAX_SAFE_INTEGER);
              }}
            >
              Delete
            </Button>
          </div>
        </Modal>
      )}
      {tableDim && (
        <Modal open wide onClose={() => setTableDim(null)} title={`${getDimension(tableDim).name} — history`}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-ink-2">
                <th className="py-1.5 font-medium">Date</th>
                <th className="py-1.5 text-right font-medium">Estimate</th>
                <th className="py-1.5 text-right font-medium">80 % interval</th>
              </tr>
            </thead>
            <tbody>
              {dimensionHistory(twin, tableDim).map((h) => (
                <tr key={h.at} className="border-b border-line/60">
                  <td className="py-1.5 text-ink-2">{fmtDateTime(h.at)}</td>
                  <td className="py-1.5 text-right tabular">{Math.round(h.score)} %</td>
                  <td className="py-1.5 text-right tabular text-ink-2">
                    {Math.round(h.lo)}–{Math.round(h.hi)}
                  </td>
                </tr>
              ))}
              {projections[tableDim]?.points
                .filter((_, i) => i % 3 === 2)
                .map((p) => (
                  <tr key={p.at} className="border-b border-line/60 text-ink-2">
                    <td className="py-1.5 italic">{fmtDate(p.at)} (projection)</td>
                    <td className="py-1.5 text-right tabular italic">~{Math.round(p.mid)} %</td>
                    <td className="py-1.5 text-right tabular italic">
                      {Math.round(p.lo80)}–{Math.round(p.hi80)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Modal>
      )}
      {focus && (
        <button type="button" className="text-[12.5px] text-brand" onClick={() => setParams({})}>
          Clear focus
        </button>
      )}
    </div>
  );
}
