/**
 * Radar of the percentage profile with its uncertainty: the shaded ring between the lower and
 * upper 80 % bounds IS the uncertainty — wide ring = we know less. Optional ghost outline for
 * an earlier snapshot (Brain Twin replay / "4 weeks ago").
 */
import { getDimension, type DimensionId } from '@/engine';
import { dimColor } from '../dim';
import { TipRow, useChartTip } from './ChartTooltip';

export interface RadarEntry {
  id: DimensionId;
  score: number;
  lo: number;
  hi: number;
  unmeasured?: boolean;
}

interface Props {
  entries: RadarEntry[];
  compare?: RadarEntry[];
  compareLabel?: string;
  /** Legend label of the main series. */
  label?: string;
  size?: number;
  /** Asymmetric profile: mark the strongest and weakest axes and the split between them. */
  split?: { strong: DimensionId; weak: DimensionId };
}

export function ProfileRadar({ entries, compare, compareLabel = 'Earlier', label = 'Now', size = 340, split }: Props) {
  const { show, hide, node } = useChartTip();
  const n = entries.length;
  const pad = 62;
  const c = size / 2;
  const R = c - pad;
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const pt = (i: number, v: number) => {
    const r = (R * Math.max(0, Math.min(100, v))) / 100;
    return [c + r * Math.cos(angle(i)), c + r * Math.sin(angle(i))] as const;
  };
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, v).join(',')).join(' ');
  const ringPath = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${pt(i, v).join(',')}`).join(' ') + 'Z';
  // Even-odd band between hi (outer) and lo (inner) polygons.
  const band = ringPath(entries.map((e) => e.hi)) + ' ' + ringPath(entries.map((e) => e.lo));
  const scores = entries.map((e) => e.score);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto block w-full max-w-[420px]" role="img" aria-label="Radar chart of the cognitive profile with 80 percent intervals">
        {[25, 50, 75, 100].map((g) => (
          <polygon key={g} points={poly(entries.map(() => g))} fill="none" stroke="var(--grid)" strokeWidth={1} />
        ))}
        {entries.map((_, i) => {
          const [x, y] = pt(i, 100);
          return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="var(--grid)" strokeWidth={1} />;
        })}
        {/* Ring values sit between the first two axes so they never collide with a data point. */}
        {[50, 100].map((g) => {
          const a = -Math.PI / 2 + Math.PI / n;
          const r = (R * g) / 100;
          return (
            <text key={g} x={c + r * Math.cos(a) + 2} y={c + r * Math.sin(a) - 2} fontSize={9} fill="var(--muted)">
              {g}
            </text>
          );
        })}

        <path d={band} fill="var(--brand)" fillOpacity={0.14} fillRule="evenodd" />
        {compare && <polygon points={poly(compare.map((e) => e.score))} fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeLinejoin="round" />}
        <polygon points={poly(scores)} fill="var(--brand)" fillOpacity={0.06} stroke="var(--brand)" strokeWidth={2} strokeLinejoin="round" />
        {split &&
          (() => {
            const si = entries.findIndex((e) => e.id === split.strong);
            const wi = entries.findIndex((e) => e.id === split.weak);
            if (si < 0 || wi < 0) return null;
            const [x1, y1] = pt(si, entries[si].score);
            const [x2, y2] = pt(wi, entries[wi].score);
            return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink-2)" strokeWidth={1.25} strokeDasharray="4 3" aria-hidden />;
          })()}

        {entries.map((e, i) => {
          const [x, y] = pt(i, e.score);
          const [lx, ly] = pt(i, 128);
          const d = getDimension(e.id);
          const anchor = Math.abs(Math.cos(angle(i))) < 0.2 ? 'middle' : Math.cos(angle(i)) > 0 ? 'start' : 'end';
          const tip = (
            <div className="space-y-0.5">
              <div className="font-semibold">{d.name}</div>
              {e.unmeasured ? (
                <div className="text-ink-2">Not measured yet</div>
              ) : (
                <>
                  <TipRow color="var(--brand)" label="estimate" value={`${Math.round(e.score)} %`} />
                  <TipRow label="80 % interval" value={`${Math.round(e.lo)}–${Math.round(e.hi)}`} />
                  {compare && <TipRow color="var(--muted)" label={compareLabel.toLowerCase()} value={`${Math.round(compare[i].score)} %`} />}
                </>
              )}
            </div>
          );
          return (
            <g key={e.id}>
              <circle
                cx={x}
                cy={y}
                r={14}
                fill="transparent"
                tabIndex={0}
                aria-label={`${d.name}: ${e.unmeasured ? 'not measured' : `${Math.round(e.score)} percent`}`}
                onPointerMove={(ev) => show(ev, tip)}
                onPointerLeave={hide}
                onFocus={(ev) => show((ev.target as Element).getBoundingClientRect(), tip)}
                onBlur={hide}
                style={{ outline: 'none', cursor: 'default' }}
              />
              <circle cx={x} cy={y} r={5} fill={e.unmeasured ? 'var(--card)' : dimColor(e.id)} stroke={e.unmeasured ? 'var(--axis)' : 'var(--card)'} strokeWidth={2} pointerEvents="none" />
              <text x={lx} y={ly - 5} textAnchor={anchor} fontSize={11.5} fontWeight={600} fill="var(--ink)">
                {split?.strong === e.id ? '▲ ' : split?.weak === e.id ? '▼ ' : ''}
                {d.short}
              </text>
              <text x={lx} y={ly + 9} textAnchor={anchor} fontSize={11} fill="var(--ink-2)">
                {e.unmeasured ? '—' : `${Math.round(e.score)} % ±${Math.round((e.hi - e.lo) / 2)}`}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[2px] w-4 rounded bg-brand" /> {label}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-brand/20" /> 80 % interval
        </span>
        {compare && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[2px] w-4 rounded bg-muted" /> {compareLabel}
          </span>
        )}
        {split && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 border-t border-dashed border-ink-2" /> ▲ strongest / ▼ lowest — split
          </span>
        )}
      </div>
      {node}
    </div>
  );
}
