/**
 * Heatmaps. Sequential (one hue, light→dark) for magnitude; diverging (blue ↔ orange with a
 * neutral grey midpoint) for change. Every cell has a hover/focus tooltip and a legend.
 */
import { getDimension, type DimensionId } from '@/engine';
import { fmtDate } from '@/lib/format';
import { DimLabel } from '../dim';
import { TipRow, useChartTip } from './ChartTooltip';

const DAY = 86_400_000;

const seq = (t: number) => (t <= 0 ? 'var(--seq-0)' : `color-mix(in oklab, var(--seq-4) ${Math.round(15 + 85 * Math.min(1, t))}%, var(--seq-0))`);

export function diverging(v: number, maxAbs: number): string {
  if (!Number.isFinite(v)) return 'var(--card-2)';
  const t = Math.min(1, Math.abs(v) / Math.max(1e-6, maxAbs));
  const pole = v >= 0 ? 'var(--diverge-up)' : 'var(--diverge-down)';
  return `color-mix(in oklab, ${pole} ${Math.round(t * 85)}%, var(--diverge-mid))`;
}

/** Practice calendar: minutes per day for the last `weeks` weeks (GitHub-style). */
export function CalendarHeatmap({ minutesByDay, weeks = 12, now }: { minutesByDay: Map<string, number>; weeks?: number; now: number }) {
  const { show, hide, node } = useChartTip();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  // Start on a Monday.
  const start = new Date(today.getTime() - (weeks * 7 - 1) * DAY);
  while (start.getDay() !== 1) start.setTime(start.getTime() - DAY);
  const days: Date[] = [];
  for (let t = start.getTime(); t <= today.getTime(); t += DAY) days.push(new Date(t));
  const cols = Math.ceil(days.length / 7);
  const max = Math.max(10, ...minutesByDay.values());
  const cell = 14;
  const gap = 3;
  return (
    <div className="overflow-x-auto">
      <svg width={cols * (cell + gap) + 24} height={7 * (cell + gap) + 18} role="img" aria-label="Practice calendar heatmap">
        {['Mon', 'Wed', 'Fri'].map((d, i) => (
          <text key={d} x={0} y={18 + (i * 2) * (cell + gap) + cell - 3} fontSize={9} fill="var(--muted)">
            {d}
          </text>
        ))}
        {days.map((d, i) => {
          const col = Math.floor(i / 7);
          const row = i % 7;
          const key = d.toDateString();
          const m = minutesByDay.get(key) ?? 0;
          const tip = <TipRow label={fmtDate(d.getTime(), { weekday: 'short', day: 'numeric', month: 'short' })} value={m ? `${Math.round(m)} min` : 'no practice'} />;
          return (
            <rect
              key={key}
              x={24 + col * (cell + gap)}
              y={14 + row * (cell + gap)}
              width={cell}
              height={cell}
              rx={3}
              fill={seq(m / max)}
              tabIndex={0}
              aria-label={`${d.toDateString()}: ${Math.round(m)} minutes`}
              onPointerMove={(e) => show(e, tip)}
              onPointerLeave={hide}
              onFocus={(e) => show((e.target as Element).getBoundingClientRect(), tip)}
              onBlur={hide}
            />
          );
        })}
        {Array.from({ length: cols }, (_, c) => {
          const d = days[c * 7];
          return d && d.getDate() <= 7 ? (
            <text key={c} x={24 + c * (cell + gap)} y={9} fontSize={9} fill="var(--muted)">
              {fmtDate(d.getTime(), { month: 'short' })}
            </text>
          ) : null;
        })}
      </svg>
      <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-ink-2">
        less
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <span key={t} className="h-3 w-3 rounded-[3px]" style={{ background: seq(t) }} />
        ))}
        more minutes
      </div>
      {node}
    </div>
  );
}

export interface MatrixCell {
  value: number | null;
  label: string;
  detail?: string;
}

/** Dimension × column matrix with a diverging scale (used for weekly change and time-of-day). */
export function DimensionMatrix({
  rows,
  columns,
  cells,
  unit,
  maxAbs,
  legendLow,
  legendHigh,
}: {
  rows: DimensionId[];
  columns: string[];
  cells: MatrixCell[][];
  unit: string;
  maxAbs: number;
  legendLow: string;
  legendHigh: string;
}) {
  const { show, hide, node } = useChartTip();
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate" style={{ borderSpacing: 3 }}>
          <thead>
            <tr>
              <th className="w-28" />
              {columns.map((c) => (
                <th key={c} className="px-1 text-center text-[11px] font-normal text-muted">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r}>
                <th className="whitespace-nowrap pr-2 text-left text-[12px] font-normal">
                  <DimLabel id={r} />
                </th>
                {cells[ri].map((cell, ci) => {
                  const tip = (
                    <div>
                      <div className="font-semibold">
                        {getDimension(r).short} · {columns[ci]}
                      </div>
                      <div className="text-ink-2">{cell.value === null ? 'no data' : cell.label}</div>
                      {cell.detail && <div className="text-ink-2">{cell.detail}</div>}
                    </div>
                  );
                  return (
                    <td
                      key={ci}
                      tabIndex={0}
                      className="h-8 min-w-[34px] rounded-md text-center text-[11px] tabular outline-none focus:ring-2 focus:ring-brand"
                      style={{ background: cell.value === null ? 'var(--card-2)' : diverging(cell.value, maxAbs) }}
                      aria-label={`${getDimension(r).short}, ${columns[ci]}: ${cell.value === null ? 'no data' : cell.label}`}
                      onPointerMove={(e) => show(e, tip)}
                      onPointerLeave={hide}
                      onFocus={(e) => show((e.target as Element).getBoundingClientRect(), tip)}
                      onBlur={hide}
                    >
                      {cell.value === null ? <span className="text-muted">·</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-2">
        {legendLow}
        {[-1, -0.5, 0, 0.5, 1].map((t) => (
          <span key={t} className="h-3 w-5 rounded-[3px]" style={{ background: diverging(t * maxAbs, maxAbs) }} />
        ))}
        {legendHigh}
        <span className="ml-2 text-muted">({unit}; grey dot = no data)</span>
      </div>
      {node}
    </div>
  );
}
