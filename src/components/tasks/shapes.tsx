/** Language-free SVG shapes shared by all tasks. */
import type { SVGProps } from 'react';

export type ShapeName = 'circle' | 'square' | 'triangle' | 'tri-down' | 'diamond' | 'star' | 'cross' | 'hexagon' | 'half' | 'ring';

const poly = (cx: number, cy: number, r: number, n: number, rot = -Math.PI / 2) =>
  Array.from({ length: n }, (_, i) => {
    const a = rot + (2 * Math.PI * i) / n;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(' ');

const star = (cx: number, cy: number, r: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (Math.PI * i) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    return `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
  }).join(' ');

export function Shape({ shape, cx, cy, r, ...rest }: { shape: ShapeName; cx: number; cy: number; r: number } & SVGProps<SVGElement>) {
  const p = rest as SVGProps<SVGPolygonElement>;
  switch (shape) {
    case 'circle':
      return <circle cx={cx} cy={cy} r={r * 0.92} {...(rest as SVGProps<SVGCircleElement>)} />;
    case 'ring':
      return (
        <g>
          <circle cx={cx} cy={cy} r={r * 0.9} {...(rest as SVGProps<SVGCircleElement>)} />
          <circle cx={cx} cy={cy} r={r * 0.42} fill="var(--card)" stroke={(rest.stroke as string) ?? 'none'} strokeWidth={rest.strokeWidth} />
        </g>
      );
    case 'square':
      return <rect x={cx - r * 0.82} y={cy - r * 0.82} width={r * 1.64} height={r * 1.64} rx={r * 0.12} {...(rest as SVGProps<SVGRectElement>)} />;
    case 'triangle':
      return <polygon points={poly(cx, cy + r * 0.15, r * 1.05, 3)} {...p} />;
    case 'tri-down':
      return <polygon points={poly(cx, cy - r * 0.15, r * 1.05, 3, Math.PI / 2)} {...p} />;
    case 'diamond':
      return <polygon points={poly(cx, cy, r, 4)} {...p} />;
    case 'hexagon':
      return <polygon points={poly(cx, cy, r * 0.95, 6, 0)} {...p} />;
    case 'star':
      return <polygon points={star(cx, cy + r * 0.05, r * 1.05)} {...p} />;
    case 'cross':
      return (
        <polygon
          points={[
            [-0.3, -0.9], [0.3, -0.9], [0.3, -0.3], [0.9, -0.3], [0.9, 0.3], [0.3, 0.3], [0.3, 0.9], [-0.3, 0.9], [-0.3, 0.3], [-0.9, 0.3], [-0.9, -0.3], [-0.3, -0.3],
          ]
            .map(([x, y]) => `${cx + x * r},${cy + y * r}`)
            .join(' ')}
          {...p}
        />
      );
    case 'half':
      return <path d={`M${cx - r * 0.9},${cy} A${r * 0.9},${r * 0.9} 0 0 1 ${cx + r * 0.9},${cy} Z`} transform={`translate(0 ${r * 0.25})`} {...(rest as SVGProps<SVGPathElement>)} />;
  }
}

/** Diagonal-stripe pattern used for "striped" fills (and the colour-independent mode). */
export function StripeDefs({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <pattern id={id} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="var(--card)" />
        <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="3" />
      </pattern>
    </defs>
  );
}
