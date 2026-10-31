import { Link } from 'react-router-dom';
import { dimensionHistory, getDimension, type DimensionProfile } from '@/engine';
import { fmtAgo } from '@/lib/format';
import { useStore } from '@/store';
import { Sparkline } from './charts/Sparkline';
import { DimLabel, dimColor } from './dim';
import { ConfidenceBadge, IntervalBar } from './ui';

export function DimensionCard({ p, now }: { p: DimensionProfile; now: number }) {
  const twin = useStore((s) => s.twin);
  const history = dimensionHistory(twin, p.id).slice(-12).map((h) => h.score);
  const d = getDimension(p.id);
  const color = dimColor(p.id);
  return (
    <Link to={`/twin?dim=${p.id}`} className="block rounded-2xl border border-line bg-card p-4 transition-colors hover:border-axis">
      <div className="flex items-start justify-between gap-2">
        <DimLabel id={p.id} />
        <Sparkline values={history} color={color} />
      </div>
      {p.unmeasured ? (
        <div className="mt-3">
          <div className="text-2xl font-semibold text-muted">—</div>
          <div className="text-[12.5px] text-ink-2">Not measured yet · {d.task.name}</div>
        </div>
      ) : (
        <div className="mt-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold">{Math.round(p.summary.score)} %</span>
            <span className="text-[12px] text-ink-2">
              {Math.round(p.summary.lo)}–{Math.round(p.summary.hi)}
            </span>
          </div>
          <div className="mt-2">
            <IntervalBar score={p.summary.score} lo={p.summary.lo} hi={p.summary.hi} color={color} />
          </div>
          <div className="mt-2.5 flex items-center justify-between text-[12px] text-ink-2">
            <ConfidenceBadge confidence={p.summary.confidence} compact />
            <span>
              {p.state.nSessions} session{p.state.nSessions === 1 ? '' : 's'} · {fmtAgo(p.state.lastUpdated, now)}
            </span>
          </div>
        </div>
      )}
    </Link>
  );
}
