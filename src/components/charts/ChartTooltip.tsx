import { useCallback, useState, type ReactNode } from 'react';

export interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

/** Lightweight tooltip for custom SVG charts: follows pointer and keyboard focus. */
export function useChartTip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const show = useCallback((e: { clientX: number; clientY: number } | DOMRect, content: ReactNode) => {
    const x = 'clientX' in e ? e.clientX : e.left + e.width / 2;
    const y = 'clientY' in e ? e.clientY : e.top;
    setTip({ x, y, content });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const node = tip ? (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 max-w-[260px] -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-xl border border-line bg-card px-3 py-2 text-[12.5px] shadow-lg"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.content}
    </div>
  ) : null;
  return { show, hide, node };
}

/** Value-first tooltip row with a short line key. */
export function TipRow({ color, label, value }: { color?: string; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      {color && <span className="h-[2px] w-3 rounded" style={{ background: color }} />}
      <span className="font-semibold text-ink">{value}</span>
      <span className="text-ink-2">{label}</span>
    </div>
  );
}
