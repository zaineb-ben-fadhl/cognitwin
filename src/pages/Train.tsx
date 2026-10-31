import { Check, Footprints } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DimLabel } from '@/components/dim';
import { PlanList } from '@/components/PlanList';
import { Button, Card, CardHeader, EmptyState, PageHeader, Segmented } from '@/components/ui';
import { DIMENSIONS, TARGET_SUCCESS, levelForSuccess, localDate, sessionPrior, type ChallengePreference } from '@/engine';
import { useStore } from '@/store';
import { useNow, useProfile } from '@/store/derived';

export default function TrainPage() {
  const navigate = useNavigate();
  const now = useNow();
  const profile = useProfile();
  const twin = useStore((s) => s.twin);
  const plan = useStore((s) => s.plans.at(-1) ?? null);
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const ensurePlan = useStore((s) => s.ensureTodayPlan);
  const missions = useStore((s) => s.missions);
  const logMission = useStore((s) => s.logMission);
  const [reflection, setReflection] = useState<Record<string, string>>({});

  const missionDims = plan?.items.map((i) => i.dimension) ?? DIMENSIONS.slice(0, 2).map((d) => d.id);
  const doneToday = new Set(missions.filter((m) => localDate(m.doneAt) === localDate(now)).map((m) => m.text));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Train"
        subtitle="Every exercise adapts trial by trial to keep you in the zone where practice pays off most."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              ariaLabel="Challenge level"
              value={settings.challenge}
              onChange={(v: ChallengePreference) => {
                update({ challenge: v });
                ensurePlan(true);
              }}
              options={[
                { value: 'gentle', label: 'Gentle' },
                { value: 'balanced', label: 'Balanced' },
                { value: 'stretch', label: 'Stretch' },
              ]}
            />
            <Segmented
              ariaLabel="Daily minutes"
              value={settings.dailyMinutes}
              onChange={(v: number) => {
                update({ dailyMinutes: v });
                ensurePlan(true);
              }}
              options={[5, 10, 15, 20].map((m) => ({ value: m, label: `${m} min` }))}
            />
          </div>
        }
      />
      <p className="-mt-3 text-[12.5px] text-ink-2">
        Target success: gentle {Math.round(TARGET_SUCCESS.gentle * 100)} %, balanced {Math.round(TARGET_SUCCESS.balanced * 100)} %, stretch {Math.round(TARGET_SUCCESS.stretch * 100)} % —
        hard enough to learn, easy enough to stay motivated.
      </p>

      <Card>
        <CardHeader title="Today’s adaptive plan" subtitle="Ranked by a transparent utility: room to grow, uncertainty, your goals, spacing and variety." />
        {plan && plan.items.length ? <PlanList plan={plan} /> : <EmptyState title="No plan yet">Complete the baseline to unlock a personal plan.</EmptyState>}
      </Card>

      <Card>
        <CardHeader title="Free practice" subtitle="Pick any activity. Training starts at the level where you are expected to succeed about as often as your challenge setting." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DIMENSIONS.map((d) => {
            const p = profile.find((x) => x.id === d.id)!;
            const level = levelForSuccess(sessionPrior(twin, d.id, now), TARGET_SUCCESS[settings.challenge], d.task);
            return (
              <div key={d.id} className="flex flex-col gap-2 rounded-xl border border-line p-3">
                <div className="flex items-center justify-between">
                  <DimLabel id={d.id} />
                  <span className="text-[12px] text-ink-2">{p.unmeasured ? 'not measured' : `level ${level}`}</span>
                </div>
                <div className="text-sm font-medium">{d.task.name}</div>
                <p className="flex-1 text-[12.5px] text-ink-2">{d.task.tagline}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" disabled={p.unmeasured} onClick={() => navigate(`/session/${d.task.id}?mode=training`)} title={p.unmeasured ? 'Do a check-in first' : undefined}>
                    Train
                  </Button>
                  <Button size="sm" onClick={() => navigate(`/session/${d.task.id}?mode=assessment`)}>
                    Check-in
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Everyday missions"
          icon={<Footprints size={16} />}
          subtitle="Exercise gains are task-specific unless you use the skill in real life. These missions bridge the gap — the coach never claims more transfer than the evidence supports."
        />
        <div className="grid gap-3 md:grid-cols-2">
          {[...new Set(missionDims)].flatMap((id) =>
            DIMENSIONS.find((d) => d.id === id)!.missions.slice(0, 1).map((text) => {
              const done = doneToday.has(text);
              return (
                <div key={text} className="rounded-xl border border-line p-3">
                  <DimLabel id={id} />
                  <p className="mt-1.5 text-[13.5px]">{text}</p>
                  {done ? (
                    <div className="mt-2 flex items-center gap-1.5 text-[12.5px] text-good-text">
                      <Check size={14} /> Done today
                    </div>
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <input
                        value={reflection[text] ?? ''}
                        onChange={(e) => setReflection((r) => ({ ...r, [text]: e.target.value }))}
                        placeholder="How did it go? (optional)"
                        maxLength={200}
                        className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12.5px]"
                      />
                      <Button size="sm" onClick={() => logMission({ dimension: id, text, reflection: reflection[text] })}>
                        Mark done
                      </Button>
                    </div>
                  )}
                </div>
              );
            }),
          )}
        </div>
        {missions.length > 0 && <p className="mt-3 text-[12px] text-ink-2">{missions.length} mission{missions.length > 1 ? 's' : ''} completed so far.</p>}
      </Card>
    </div>
  );
}
