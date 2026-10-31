/**
 * Progress curve of one dimension: history (estimate + 80 % band) and, optionally, the
 * projection fan (50 % and 80 % bands, dashed median — dashed = projection, never data).
 */
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { HistoryPoint, Projection } from '@/engine';
import { fmtDate } from '@/lib/format';

interface Props {
  history: HistoryPoint[];
  projection?: Projection | null;
  color: string;
  goal?: number;
  height?: number;
  compact?: boolean;
}

interface Row {
  at: number;
  score?: number;
  band?: [number, number];
  mid?: number;
  p80?: [number, number];
  p50?: [number, number];
}

export function ProgressChart({ history, projection, color, goal, height = 220, compact }: Props) {
  const rows: Row[] = history.map((h) => ({ at: h.at, score: h.score, band: [h.lo, h.hi] }));
  if (projection) {
    const last = history.at(-1);
    // Connect the fan to the last observed point.
    if (last) rows.push({ at: last.at + 1, mid: last.score, p80: [last.lo, last.hi], p50: [last.lo, last.hi] });
    for (const p of projection.points.slice(1)) rows.push({ at: p.at, mid: p.mid, p80: [p.lo80, p.hi80], p50: [p.lo50, p.hi50] });
  }
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: compact ? -12 : -4 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="at" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(t) => fmtDate(t)} tickLine={false} minTickGap={36} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickLine={false} axisLine={false} width={44} className="tabular" />
          {goal !== undefined && <ReferenceLine y={goal} stroke="var(--ink-2)" strokeWidth={1} label={{ value: `goal ${goal} %`, position: 'insideTopLeft', fill: 'var(--ink-2)', fontSize: 11 }} />}
          <Area dataKey="band" stroke="none" fill={color} fillOpacity={0.14} isAnimationActive={false} connectNulls={false} />
          <Area dataKey="p80" stroke="none" fill={color} fillOpacity={0.08} isAnimationActive={false} />
          <Area dataKey="p50" stroke="none" fill={color} fillOpacity={0.14} isAnimationActive={false} />
          <Line dataKey="score" stroke={color} strokeWidth={2} dot={{ r: 3, fill: color, stroke: 'var(--card)', strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={false} connectNulls />
          <Line dataKey="mid" stroke={color} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls />
          <Tooltip
            cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload as Row;
              return (
                <div className="rounded-xl border border-line bg-card px-3 py-2 text-[12.5px] shadow-lg">
                  <div className="mb-0.5 text-ink-2">{fmtDate(r.at, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                  {r.score !== undefined && (
                    <div>
                      <span className="font-semibold">{Math.round(r.score)} %</span>{' '}
                      <span className="text-ink-2">estimate · 80 % interval {Math.round(r.band![0])}–{Math.round(r.band![1])}</span>
                    </div>
                  )}
                  {r.mid !== undefined && r.score === undefined && (
                    <div>
                      <span className="font-semibold">~{Math.round(r.mid)} %</span>{' '}
                      <span className="text-ink-2">projection · 80 % band {Math.round(r.p80![0])}–{Math.round(r.p80![1])}</span>
                    </div>
                  )}
                </div>
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
