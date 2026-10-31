import { Flame, Flag, Handshake, Play, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CoachCard } from '@/components/coach/CoachCard';
import { DimensionCard } from '@/components/DimensionCard';
import { DimLabel } from '@/components/dim';
import { PlanList } from '@/components/PlanList';
import { ProfileView, toRadar } from '@/components/ProfileView';
import { Button, Card, CardHeader, EmptyState, IntervalBar, PageHeader, ProgressBar, Segmented } from '@/components/ui';
import type { RadarEntry } from '@/components/charts/ProfileRadar';
import { dailyBriefing, daysSinceActivity, localDate, snapshotAt } from '@/engine';
import { useCollab, useGoalStatuses, useInsights, useNow, useProfile } from '@/store/derived';
import { useStore } from '@/store';
import { fmtDate } from '@/lib/format';

const DAY = 86_400_000;

export default function TodayPage() {
  const navigate = useNavigate();
  const now = useNow();
  const profile = useProfile();
  const insights = useInsights();
  const collab = useCollab();
  const goals = useGoalStatuses();
  const twin = useStore((s) => s.twin);
  const sessions = useStore((s) => s.sessions);
  const plan = useStore((s) => s.plans.at(-1) ?? null);
  const nickname = useStore((s) => s.profile.nickname);
  const dailyMinutes = useStore((s) => s.settings.dailyMinutes);
  const loadDemo = useStore((s) => s.loadDemo);
  const [compareDays, setCompareDays] = useState<0 | 7 | 28>(0);

  const briefing = useMemo(
    () => dailyBriefing(insights, plan?.date === localDate(now) ? plan.rationale : null, { name: nickname || undefined, daysAway: daysSinceActivity(twin, now), now }),
    // Recompute when the insight set or plan changes, not every minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [insights.map((i) => i.id).join(), plan?.id, nickname],
  );

  const compare: RadarEntry[] | undefined = useMemo(() => {
    if (!compareDays) return undefined;
    const snap = snapshotAt(twin, now - compareDays * DAY);
    if (!snap) return undefined;
    return profile.map((p) => {
      const e = snap.dims[p.id];
      return e ? { id: p.id, score: e.score, lo: e.lo, hi: e.hi } : { id: p.id, score: 0, lo: 0, hi: 0, unmeasured: true };
    });
  }, [compareDays, twin, now, profile]);

  const minutesToday = sessions.filter((s) => localDate(s.endedAt) === localDate(now)).reduce((m, s) => m + (s.endedAt - s.startedAt) / 60000, 0);
  const days = new Set(sessions.map((s) => new Date(s.endedAt).toDateString()));
  let streak = 0;
  for (let d = 0; d < 365; d++) {
    if (days.has(new Date(now - d * DAY).toDateString())) streak++;
    else if (d > 0) break;
  }
  const fresh = sessions.length === 0;
  const activeGoals = goals.filter((g) => !g.goal.archived);

  return (
    <div className="space-y-6">
      <PageHeader title="Today" subtitle={fmtDate(now, { weekday: 'long', day: 'numeric', month: 'long' })} />

      {fresh ? (
        <Card className="bg-[linear-gradient(135deg,var(--brand-soft),transparent)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Let’s build your Brain Twin</h2>
              <p className="mt-1 max-w-xl text-[14px] text-ink-2">
                Six short adaptive activities (~12 minutes) give a first, deliberately cautious profile. Every later session sharpens it.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="lg" onClick={() => navigate('/assess?baseline=1')}>
                <Play size={16} /> Start baseline
              </Button>
              <Button size="lg" onClick={loadDemo}>
                <Sparkles size={16} /> Demo twin
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <CoachCard m={briefing} rate />
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Your profile"
            subtitle="Estimate with its 80 % interval — the shaded ring is the uncertainty."
            right={
              <Segmented
                ariaLabel="Compare with"
                value={compareDays}
                onChange={setCompareDays}
                options={[
                  { value: 0, label: 'Now' },
                  { value: 7, label: 'vs 1 wk' },
                  { value: 28, label: 'vs 4 wks' },
                ]}
              />
            }
          />
          <ProfileView entries={toRadar(profile)} compare={compare} compareLabel={compareDays ? `${compareDays === 7 ? '1 week' : '4 weeks'} ago` : undefined} profile={profile} />
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Today’s plan"
            subtitle={`${Math.round(minutesToday)} of ${dailyMinutes} min practised today`}
            right={
              <Link to="/train" className="text-[13px] font-medium text-brand">
                Details
              </Link>
            }
          />
          <div className="mb-3">
            <ProgressBar value={minutesToday / dailyMinutes} label="Minutes practised today" />
          </div>
          {plan && plan.items.length ? <PlanList plan={plan} showChanges={false} /> : <EmptyState title="No plan yet">Complete a first check-in to get a personal plan.</EmptyState>}
        </Card>
      </div>

      <section aria-label="Dimensions">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {profile.map((p) => (
            <DimensionCard key={p.id} p={p} now={now} />
          ))}
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader title="Goals" icon={<Flag size={16} />} right={<Link to="/goals" className="text-[13px] font-medium text-brand">Manage</Link>} />
          {activeGoals.length ? (
            <ul className="space-y-3">
              {activeGoals.slice(0, 3).map(({ goal, current, probability }) => (
                <li key={goal.id} className="text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    {goal.kind === 'score' ? <DimLabel id={goal.dimension!} /> : <span className="font-medium">Practice habit</span>}
                    <span className="text-ink-2">
                      {goal.achievedAt ? 'reached ✓' : goal.kind === 'score' ? `${current === null ? '—' : Math.round(current)} → ${goal.target} %` : `${current}/${goal.target} days`}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <ProgressBar value={goal.kind === 'score' ? (current ?? 0) / goal.target : (current ?? 0) / goal.target} />
                  </div>
                  {probability !== null && !goal.achievedAt && <div className="mt-1 text-[12px] text-ink-2">≈ {Math.round(probability * 100)} % chance by {fmtDate(goal.deadline)} (model estimate)</div>}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No goals yet" action={<Link to="/goals" className="text-[13px] font-medium text-brand">Set a goal</Link>} />
          )}
        </Card>
        <Card>
          <CardHeader title="AI collaboration" icon={<Handshake size={16} />} right={<Link to="/collab" className="text-[13px] font-medium text-brand">Breakdown</Link>} />
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold">{Math.round(collab.total)}</span>
            <span className="text-sm text-ink-2">/ 100</span>
          </div>
          <div className="mt-3">
            <IntervalBar score={collab.total} lo={collab.lo} hi={collab.hi} color="var(--brand)" />
          </div>
          <p className="mt-2 text-[12.5px] text-ink-2">
            80 % interval {Math.round(collab.lo)}–{Math.round(collab.hi)}. How you work with the coach: asking why, checking claims, adapting suggestions.
          </p>
        </Card>
        <Card>
          <CardHeader title="Consistency" icon={<Flame size={16} />} />
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold">{streak}</span>
            <span className="text-sm text-ink-2">day streak</span>
          </div>
          <p className="mt-2 text-[12.5px] text-ink-2">
            {sessions.length} sessions in total. Short, regular sessions beat occasional long ones — spacing helps skills settle.
          </p>
          <Link to="/twin" className="mt-3 inline-block text-[13px] font-medium text-brand">
            Open the Brain Twin →
          </Link>
        </Card>
      </div>
    </div>
  );
}
