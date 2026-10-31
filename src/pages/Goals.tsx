import { Archive, Flag, Plus } from 'lucide-react';
import { useState } from 'react';
import { ProgressChart } from '@/components/charts/ProgressChart';
import { DimLabel, dimColor } from '@/components/dim';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, ProgressBar, Segmented } from '@/components/ui';
import { DIMENSIONS, dimensionHistory, getDimension, milestones, type DimensionId, type GoalKind } from '@/engine';
import { fmtDate } from '@/lib/format';
import { useStore } from '@/store';
import { useGoalStatuses, useNow, useProfile, useProjections } from '@/store/derived';

const DAY = 86_400_000;

function goalStatus(p: number | null, achieved?: number) {
  if (achieved) return { label: 'Reached', tone: 'good' as const };
  if (p === null) return { label: 'Too early to tell', tone: 'neutral' as const };
  if (p >= 0.6) return { label: 'On track', tone: 'good' as const };
  if (p >= 0.3) return { label: 'Within reach', tone: 'warn' as const };
  return { label: 'Stretch', tone: 'critical' as const };
}

const toInput = (ts: number) => new Date(ts - new Date(ts).getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function GoalForm({ onDone }: { onDone: () => void }) {
  const profile = useProfile();
  const addGoal = useStore((s) => s.addGoal);
  const [kind, setKind] = useState<GoalKind>('score');
  const [dim, setDim] = useState<DimensionId>(DIMENSIONS[0].id);
  const current = profile.find((p) => p.id === dim);
  const base = current && !current.unmeasured ? Math.round(current.summary.score) : 50;
  const [target, setTarget] = useState(Math.min(95, base + 8));
  const [days, setDays] = useState(4);
  const [deadline, setDeadline] = useState(toInput(Date.now() + 21 * DAY));
  const [note, setNote] = useState('');
  const gap = target - base;
  const minDate = toInput(Date.now() + 3 * DAY);
  const maxDate = toInput(Date.now() + 365 * DAY);
  const deadlineAt = new Date(`${deadline}T23:59:00`).getTime();
  const validDeadline = Number.isFinite(deadlineAt) && deadline >= minDate && deadline <= maxDate;
  const weeks = Math.max(1, (deadlineAt - Date.now()) / (7 * DAY));
  const ambitious = kind === 'score' && gap / weeks > 6;

  return (
    <div className="space-y-4 text-sm">
      <Segmented
        ariaLabel="Goal type"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'score', label: 'Raise a skill' },
          { value: 'habit', label: 'Practice habit' },
        ]}
      />
      {kind === 'score' ? (
        <>
          <label className="block">
            <span className="text-ink-2">Dimension</span>
            <select
              value={dim}
              onChange={(e) => {
                setDim(e.target.value);
                const p = profile.find((x) => x.id === e.target.value);
                setTarget(Math.min(95, (p && !p.unmeasured ? Math.round(p.summary.score) : 50) + 8));
              }}
              className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2"
            >
              {DIMENSIONS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-ink-2">
              Target: <strong className="text-ink">{target} %</strong> (now {current?.unmeasured ? 'not measured' : `${base} %`})
            </span>
            <input type="range" min={Math.max(5, base - 5)} max={98} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="mt-2 w-full accent-[var(--brand)]" />
          </label>
        </>
      ) : (
        <label className="block">
          <span className="text-ink-2">
            Practise on <strong className="text-ink">{days}</strong> days a week
          </span>
          <input type="range" min={2} max={7} value={days} onChange={(e) => setDays(Number(e.target.value))} className="mt-2 w-full accent-[var(--brand)]" />
        </label>
      )}
      <label className="block">
        <span className="text-ink-2">By</span>
        <input type="date" value={deadline} min={minDate} max={maxDate} aria-invalid={!validDeadline} onChange={(e) => setDeadline(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2" />
      </label>
      {!validDeadline && <p role="alert" className="text-serious">Choose a date between 3 days and one year from today.</p>}
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="Why does this matter to you? (optional)" className="w-full rounded-xl border border-line bg-card px-3 py-2" />
      {ambitious && <p className="rounded-xl bg-warning/15 px-3 py-2 text-[12.5px]">That is more than 6 points a week — ambitious. Consider a later date so the goal stays motivating.</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!validDeadline}
          onClick={() => {
            if (!validDeadline) return;
            addGoal({ kind, dimension: kind === 'score' ? dim : undefined, target: kind === 'score' ? target : days, deadline: deadlineAt, selfSet: true, note: note.trim() || undefined });
            onDone();
          }}
        >
          Save goal
        </Button>
      </div>
    </div>
  );
}

export default function GoalsPage() {
  const now = useNow();
  const statuses = useGoalStatuses();
  const twin = useStore((s) => s.twin);
  const archiveGoal = useStore((s) => s.archiveGoal);
  const projections = useProjections();
  const [creating, setCreating] = useState(false);
  const active = statuses.filter((g) => !g.goal.archived);
  const archived = statuses.filter((g) => g.goal.archived);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Goals & learning path"
        subtitle="Goals you set yourself are the strongest. Each goal gets a weekly path and a model-based chance of success — an estimate, never a promise."
        right={
          !creating && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> New goal
            </Button>
          )
        }
      />
      {creating && (
        <Card>
          <CardHeader title="New goal" icon={<Flag size={16} />} />
          <GoalForm onDone={() => setCreating(false)} />
        </Card>
      )}

      {!active.length && !creating && (
        <Card>
          <EmptyState icon={<Flag size={28} />} title="No active goals" action={<Button onClick={() => setCreating(true)}>Set your first goal</Button>}>
            A concrete target with a date turns practice into a measurable learning path.
          </EmptyState>
        </Card>
      )}

      {active.map(({ goal, current, probability }) => {
        const st = goalStatus(probability, goal.achievedAt);
        if (goal.kind === 'habit') {
          return (
            <Card key={goal.id}>
              <CardHeader
                title={`Practise ${goal.target} days a week`}
                subtitle={`Until ${fmtDate(goal.deadline)}${goal.note ? ` · ${goal.note}` : ''}`}
                right={
                  <div className="flex items-center gap-2">
                    <Badge tone={(current ?? 0) >= goal.target ? 'good' : 'neutral'}>
                      {current ?? 0}/{goal.target} this week
                    </Badge>
                    <Button size="sm" variant="ghost" aria-label="Archive goal" onClick={() => archiveGoal(goal.id)}>
                      <Archive size={14} />
                    </Button>
                  </div>
                }
              />
              <ProgressBar value={(current ?? 0) / goal.target} label="Days practised in the last 7 days" />
            </Card>
          );
        }
        const id = goal.dimension!;
        const history = dimensionHistory(twin, id);
        const start = history.filter((h) => h.at <= goal.createdAt).at(-1)?.score ?? history[0]?.score ?? 50;
        const path = milestones(goal, start, history);
        return (
          <Card key={goal.id}>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <DimLabel id={id} /> to {goal.target} % by {fmtDate(goal.deadline)}
                </span>
              }
              subtitle={`${goal.selfSet ? 'Your goal' : 'Suggested by the coach, accepted by you'}${goal.note ? ` · ${goal.note}` : ''}`}
              right={
                <div className="flex items-center gap-2">
                  <Badge tone={st.tone}>{st.label}</Badge>
                  <Button size="sm" variant="ghost" aria-label="Archive goal" onClick={() => archiveGoal(goal.id)}>
                    <Archive size={14} />
                  </Button>
                </div>
              }
            />
            <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
              <div>
                {history.length ? (
                  <ProgressChart history={history.filter((h) => h.at >= goal.createdAt - 14 * DAY)} projection={projections[id]} color={dimColor(id)} goal={goal.target} height={220} />
                ) : (
                  <EmptyState title="Not measured yet">Do a {getDimension(id).short} check-in to start tracking.</EmptyState>
                )}
              </div>
              <div className="space-y-3 text-[13px]">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-ink-2">Start</div>
                    <div className="text-lg font-semibold">{Math.round(start)} %</div>
                  </div>
                  <div>
                    <div className="text-ink-2">Now</div>
                    <div className="text-lg font-semibold">{current === null ? '—' : `${Math.round(current)} %`}</div>
                  </div>
                  <div>
                    <div className="text-ink-2">Chance*</div>
                    <div className="text-lg font-semibold">{probability === null ? '—' : `${Math.round(probability * 100)} %`}</div>
                  </div>
                </div>
                <ProgressBar value={current === null ? 0 : Math.max(0, (current - start) / Math.max(1, goal.target - start))} label="Progress toward goal" />
                <div>
                  <div className="mb-1 font-medium">Weekly path</div>
                  <table className="w-full text-[12.5px]">
                    <tbody>
                      {path.map((m, i) => (
                        <tr key={m.weekStart} className="border-b border-line/60">
                          <td className="py-1 text-ink-2">Week {i + 1}</td>
                          <td className="py-1 text-right tabular">target {Math.round(m.target)} %</td>
                          <td className="py-1 text-right tabular">{m.actual === null ? (m.weekStart > now ? '' : '—') : `${Math.round(m.actual)} %`}</td>
                          <td className="w-5 py-1 text-right">{m.actual !== null && (m.actual >= m.target - 1 ? '✓' : '·')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11.5px] text-muted">
                  *Model-based estimate from your own learning curve, assuming practice continues. It carries real uncertainty and is not a prediction of certainty.
                </p>
              </div>
            </div>
          </Card>
        );
      })}

      {archived.length > 0 && (
        <Card>
          <CardHeader title="Archived goals" />
          <ul className="space-y-1 text-[13px] text-ink-2">
            {archived.map(({ goal }) => (
              <li key={goal.id}>
                {goal.kind === 'score' ? `${getDimension(goal.dimension!).short} to ${goal.target} %` : `${goal.target} days/week`} · until {fmtDate(goal.deadline)}
                {goal.achievedAt ? ' · reached ✓' : ''}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
