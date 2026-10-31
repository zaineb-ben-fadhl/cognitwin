import { clsx } from 'clsx';
import { CircleHelp, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { Confidence } from '@/engine';

export function Card({ className, children, as: Tag = 'section', ...rest }: { className?: string; children: ReactNode; as?: 'section' | 'div' | 'article' } & Record<string, unknown>) {
  return (
    <Tag className={clsx('rounded-2xl border border-line bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]', className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, subtitle, icon, right }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <div className="mt-0.5 text-ink-2">{icon}</div>}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-tight text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({ variant = 'secondary', size = 'md', className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'h-8 px-3 text-[13px]',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-6 text-[15px]',
        variant === 'primary' && 'bg-brand text-brand-ink hover:opacity-90',
        variant === 'secondary' && 'border border-line bg-card text-ink hover:bg-card-2',
        variant === 'ghost' && 'text-ink-2 hover:bg-card-2 hover:text-ink',
        variant === 'danger' && 'border border-critical/40 bg-card text-critical-text hover:bg-critical/10',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'brand' | 'good' | 'warn' | 'critical'; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium',
        tone === 'neutral' && 'bg-card-2 text-ink-2',
        tone === 'brand' && 'bg-brand-soft text-brand',
        tone === 'good' && 'bg-good/12 text-good-text',
        tone === 'warn' && 'bg-warning/20 text-ink',
        tone === 'critical' && 'bg-critical/12 text-critical-text',
        className,
      )}
    >
      {children}
    </span>
  );
}

const CONF_TEXT: Record<Confidence, string> = {
  high: 'High confidence',
  moderate: 'Moderate confidence',
  low: 'Low confidence',
};

/** Confidence is shown with a bar glyph + word, never colour alone. */
export function ConfidenceBadge({ confidence, compact }: { confidence: Confidence; compact?: boolean }) {
  const bars = confidence === 'high' ? 3 : confidence === 'moderate' ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-ink-2" title={`${CONF_TEXT[confidence]} — based on the width of the 80 % interval`}>
      <span className="inline-flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3].map((b) => (
          <span key={b} className={clsx('w-[3px] rounded-sm', b <= bars ? 'bg-ink-2' : 'bg-axis')} style={{ height: 4 + b * 3 }} />
        ))}
      </span>
      {compact ? confidence : CONF_TEXT[confidence]}
    </span>
  );
}

/** Score with its 80 % interval on a 0–100 track. */
export function IntervalBar({ score, lo, hi, color, height = 8, muted }: { score: number; lo: number; hi: number; color: string; height?: number; muted?: boolean }) {
  return (
    <div className="relative w-full rounded-full bg-card-2" style={{ height }} role="img" aria-label={`Estimate ${Math.round(score)} percent, 80 percent interval ${Math.round(lo)} to ${Math.round(hi)}`}>
      <div className="absolute inset-y-0 rounded-full" style={{ left: `${lo}%`, width: `${Math.max(1, hi - lo)}%`, background: color, opacity: muted ? 0.12 : 0.22 }} />
      <div
        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card"
        style={{ left: `${score}%`, width: height + 6, height: height + 6, background: muted ? 'var(--axis)' : color }}
      />
    </div>
  );
}

export function ProgressBar({ value, color = 'var(--brand)', label }: { value: number; color?: string; label?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-card-2" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: color }} />
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={clsx('flex items-start justify-between gap-4 py-2.5', disabled && 'opacity-60')}>
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <div className="text-sm font-medium text-ink">{label}</div>
        {description && <div className="mt-0.5 text-[13px] leading-snug text-ink-2">{description}</div>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-axis')}
      >
        <span className={clsx('absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </button>
    </div>
  );
}

export function Segmented<T extends string | number>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode }>; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex flex-wrap rounded-xl border border-line bg-card-2 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx('rounded-[10px] px-3 py-1.5 text-[13px] font-medium transition-colors', value === o.value ? 'bg-card text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className={clsx('animate-fade-in max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-card p-5 outline-none sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="mb-3 flex items-start justify-between gap-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-2 hover:bg-card-2" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button type="button" aria-label="More information" className="text-muted hover:text-ink-2" onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)}>
        <CircleHelp size={14} />
      </button>
      {open && (
        <span role="tooltip" className="absolute left-1/2 top-5 z-30 w-64 -translate-x-1/2 rounded-xl border border-line bg-card p-3 text-[12.5px] font-normal leading-snug text-ink-2 shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <div className="text-sm font-semibold">{title}</div>
      {children && <div className="max-w-sm text-[13px] text-ink-2">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-[12px] text-ink-2">{label}</div>
      <div className="mt-0.5 text-xl font-semibold">{value}</div>
      {sub && <div className="text-[12px] text-ink-2">{sub}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-ink-2">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}
