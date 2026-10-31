/** Trial-by-trial difficulty path: column height = level, filled = success, outline = miss. */
import type { Trial } from '@/engine';
import { TipRow, useChartTip } from './ChartTooltip';

export function DifficultyPath({ trials, color, levels = 10 }: { trials: Trial[]; color: string; levels?: number }) {
  const { show, hide, node } = useChartTip();
  const w = 560;
  const h = 150;
  const padL = 26;
  const padB = 18;
  const slot = (w - padL) / Math.max(1, trials.length);
  const bw = Math.min(18, slot - 3);
  const y = (lvl: number) => h - padB - ((h - padB - 6) * lvl) / levels;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Difficulty level of each trial and whether it succeeded">
        {[2, 4, 6, 8, 10].map((l) => (
          <g key={l}>
            <line x1={padL} x2={w} y1={y(l)} y2={y(l)} stroke="var(--grid)" strokeWidth={1} />
            <text x={padL - 6} y={y(l) + 3} textAnchor="end" fontSize={9} fill="var(--muted)" className="tabular">
              {l}
            </text>
          </g>
        ))}
        <line x1={padL} x2={w} y1={h - padB} y2={h - padB} stroke="var(--axis)" strokeWidth={1} />
        {trials.map((t, i) => {
          const x = padL + i * slot + (slot - bw) / 2;
          const top = y(t.level);
          const tip = (
            <div className="space-y-0.5">
              <div className="font-semibold">Trial {i + 1}</div>
              <TipRow label="level" value={t.level} />
              <TipRow label="outcome" value={t.success ? 'success' : t.correct ? 'correct but late' : t.errorType?.replace('_', ' ') ?? 'miss'} />
              {t.rtMs !== null && <TipRow label="response time" value={`${t.rtMs} ms`} />}
              {t.condition && <TipRow label="condition" value={t.condition} />}
              {(t.weight ?? 1) < 1 && <TipRow label="weight (interruption / hint)" value={t.weight} />}
            </div>
          );
          // 4px rounded data-end, square at the baseline.
          const r = Math.min(4, bw / 2);
          const bottom = h - padB;
          const d = `M${x},${bottom} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + bw - r},${top} Q${x + bw},${top} ${x + bw},${top + r} L${x + bw},${bottom} Z`;
          return (
            <g key={i} onPointerMove={(e) => show(e, tip)} onPointerLeave={hide}>
              <rect x={padL + i * slot} y={0} width={slot} height={h - padB} fill="transparent" />
              <path d={d} fill={t.success ? color : 'var(--card)'} stroke={t.success ? 'none' : 'var(--axis)'} strokeWidth={1.5} opacity={(t.weight ?? 1) < 1 ? 0.5 : 1} />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-[11.5px] text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-2.5 rounded-t-sm" style={{ background: color }} /> success
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-2.5 rounded-t-sm border border-axis bg-card" /> miss
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-2.5 rounded-t-sm opacity-50" style={{ background: color }} /> counted less
        </span>
        <span className="ml-auto text-muted">height = difficulty level (1–10)</span>
      </div>
      {node}
    </div>
  );
}
