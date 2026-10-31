/** Tiny trend line (de-emphasised) with the current point in the dimension colour. */
export function Sparkline({ values, color, width = 96, height = 28 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden />;
  const min = Math.min(...values) - 2;
  const max = Math.max(...values) + 2;
  const x = (i: number) => 3 + (i * (width - 6)) / (values.length - 1);
  const y = (v: number) => height - 3 - ((v - min) / Math.max(1, max - min)) * (height - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={d} fill="none" stroke="var(--axis)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r={3} fill={color} stroke="var(--card)" strokeWidth={1.5} />
    </svg>
  );
}
