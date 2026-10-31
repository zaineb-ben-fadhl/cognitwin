import { Brain, Crosshair, Hand, Layers, Puzzle, Shuffle, Zap, type LucideIcon } from 'lucide-react';
import { findDimension, type DimensionId } from '@/engine';

const ICONS: Record<string, LucideIcon> = { Crosshair, Layers, Zap, Hand, Shuffle, Puzzle };

/** Dimension identity colour (validated categorical slot); unknown dimensions use the brand colour. */
export const dimColor = (id: DimensionId) => (['attention', 'memory', 'speed', 'inhibition', 'flexibility', 'reasoning'].includes(id) ? `var(--dim-${id})` : 'var(--brand)');

export function DimIcon({ id, size = 16 }: { id: DimensionId; size?: number }) {
  const Icon = ICONS[findDimension(id)?.icon ?? ''] ?? Brain;
  return <Icon size={size} aria-hidden />;
}

/** Colour swatch + icon + name: identity never relies on colour alone. */
export function DimLabel({ id, short = true, className = '' }: { id: DimensionId; short?: boolean; className?: string }) {
  const d = findDimension(id);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-md" style={{ background: dimColor(id), color: id === 'inhibition' ? '#0b0b0b' : '#ffffff' }}>
        <DimIcon id={id} size={12} />
      </span>
      <span className="font-medium">{d ? (short ? d.short : d.name) : id}</span>
    </span>
  );
}
