import { Play } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DimLabel } from '@/components/dim';
import { Badge, Button, Card, CardHeader, ConfidenceBadge, PageHeader } from '@/components/ui';
import { DIMENSIONS, estimateMinutes } from '@/engine';
import { fmtAgo } from '@/lib/format';
import { useNow, useProfile } from '@/store/derived';

export default function AssessPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const profile = useProfile();
  const now = useNow();
  const baseline = params.get('baseline') === '1';
  const order = DIMENSIONS.map((d) => d.task.id);
  const pending = DIMENSIONS.filter((d) => profile.find((p) => p.id === d.id)?.unmeasured).map((d) => d.task.id);
  const sequence = pending.length ? pending : order;
  const total = DIMENSIONS.reduce((m, d) => m + estimateMinutes(d.task, 'assessment'), 0);

  const startSequence = () => navigate(`/session/${sequence[0]}?mode=assessment&queue=${sequence.slice(1).join(',')}`);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Check-ins"
        subtitle="Short adaptive assessments. Each one stops as soon as the estimate is precise enough, so they rarely take more than 2–3 minutes."
      />
      <Card className={baseline ? 'border-brand' : ''}>
        <CardHeader
          title={pending.length === DIMENSIONS.length ? 'Baseline: all six activities' : pending.length ? `Finish your baseline (${pending.length} left)` : 'Full re-check'}
          subtitle={`About ${Math.round(total)} minutes in one go — or one at a time below. You can pause between activities.`}
          right={
            <Button variant="primary" onClick={startSequence}>
              <Play size={15} /> Start
            </Button>
          }
        />
        <ol className="grid gap-2 sm:grid-cols-3">
          {sequence.map((id, i) => {
            const d = DIMENSIONS.find((x) => x.task.id === id)!;
            return (
              <li key={id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[13px]">
                <span className="text-muted tabular">{i + 1}</span>
                <DimLabel id={d.id} />
                <span className="ml-auto text-ink-2">{d.task.name}</span>
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {DIMENSIONS.map((d) => {
          const p = profile.find((x) => x.id === d.id)!;
          return (
            <Card key={d.id} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <DimLabel id={d.id} short={false} />
                {p.unmeasured ? <Badge tone="brand">not measured</Badge> : <ConfidenceBadge confidence={p.summary.confidence} compact />}
              </div>
              <p className="text-[13px] text-ink-2">{d.definition}</p>
              <div className="mt-auto flex items-center justify-between pt-2 text-[12.5px] text-ink-2">
                <span>
                  {d.task.name} · ~{estimateMinutes(d.task, 'assessment')} min{!p.unmeasured && ` · last ${fmtAgo(p.state.lastUpdated, now)}`}
                </span>
                <Button size="sm" onClick={() => navigate(`/session/${d.task.id}?mode=assessment`)}>
                  Check-in
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
      <p className="text-[12.5px] text-muted">
        Why adaptive? Each trial is picked where it tells us most about you (maximum Fisher information). In simulation this cuts estimation error by about 30 % compared with
        random difficulty for the same number of trials — see Methods → Validation.
      </p>
    </div>
  );
}
