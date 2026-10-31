const DAY = 86_400_000;

export const r0 = (x: number) => Math.round(x);

export function fmtDate(ts: number, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return new Date(ts).toLocaleDateString('en-GB', opts);
}

export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtAgo(ts: number | null, now = Date.now()): string {
  if (ts === null) return 'never';
  const d = (now - ts) / DAY;
  if (d < 1 / 24) return 'just now';
  if (d < 1) return `${Math.round(d * 24)} h ago`;
  if (d < 2) return 'yesterday';
  if (d < 30) return `${Math.round(d)} days ago`;
  return fmtDate(ts);
}

export function fmtMetric(value: number | null, unit?: string, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const v = value.toFixed(digits);
  if (!unit) return v;
  if (unit === '%') return `${v} %`;
  return `${v} ${unit}`;
}

export function fmtMinutes(min: number): string {
  return min < 1 ? '<1 min' : `${Math.round(min)} min`;
}

export function downloadJson(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
