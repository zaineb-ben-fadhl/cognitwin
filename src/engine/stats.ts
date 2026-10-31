/** Descriptive statistics helpers. All functions ignore non-finite values. */

const finite = (xs: readonly (number | null | undefined)[]) =>
  xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));

export function mean(xs: readonly (number | null | undefined)[]): number | null {
  const v = finite(xs);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

export function median(xs: readonly (number | null | undefined)[]): number | null {
  return quantile(xs, 0.5);
}

export function quantile(xs: readonly (number | null | undefined)[], q: number): number | null {
  const v = finite(xs).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function sd(xs: readonly (number | null | undefined)[]): number | null {
  const v = finite(xs);
  if (v.length < 2) return null;
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

/** Coefficient of variation (sd / mean). */
export function cv(xs: readonly (number | null | undefined)[]): number | null {
  const m = mean(xs);
  const s = sd(xs);
  return m && s !== null ? s / m : null;
}

/** Ordinary least squares slope of y on x. */
export function slope(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  return sxx === 0 ? null : sxy / sxx;
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export const round = (x: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** z-value of the central 80 % interval. */
export const Z80 = 1.2815515655446004;
/** z-value of the central 50 % interval. */
export const Z50 = 0.6744897501960817;
