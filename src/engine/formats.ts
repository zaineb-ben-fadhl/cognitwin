/**
 * Plateau detection and practice formats (Layer C).
 *
 * A plateau is NOT "the data is noisy": it is a flat trend with a small spread over the last
 * sessions — the estimate has stopped moving. Feeding the same exercise in the same way would
 * keep it there, so the planner rotates the *format* of practice (and the strategy to try)
 * until the trend moves again. Formats change how levels are chosen, never how success is
 * scored, so the measurement model stays valid in every format.
 */
import { getDimension } from './dimensions';
import { slope as olsSlope } from './stats';
import { dimensionHistory } from './twin';
import type { DimensionId, SessionRecord, TrainingFormat, TwinState } from './types';

export interface FormatDoc {
  name: string;
  description: string;
  /** Why this can unlock progress, with its source. */
  science: string;
}

export const TRAINING_FORMATS: Record<TrainingFormat, FormatDoc> = {
  standard: {
    name: 'Standard',
    description: 'Difficulty tracks your target success rate trial by trial.',
    science: 'Desirable difficulty around 80 % success (Wilson et al., 2019).',
  },
  stretch: {
    name: 'Stretch',
    description: 'Aims for about 68 % success instead of 80 % — just beyond the comfort zone.',
    science: 'Challenge-point framework: learning stalls when practice gets too comfortable (Guadagnoli & Lee, 2004).',
  },
  interleaved: {
    name: 'Mixed levels',
    description: 'Difficulty jumps up and down around your level instead of creeping one step at a time.',
    science: 'Contextual interference / variable practice improves retention and transfer (Shea & Morgan, 1979).',
  },
  strategy: {
    name: 'Strategy focus',
    description: 'Usual difficulty, but you deliberately try one new strategy — and tell the coach whether it helped.',
    science: 'Explicit strategy use and reflection (metacognitive training).',
  },
};

/** Order in which plateau-breaking formats are tried. */
export const FORMAT_ROTATION: TrainingFormat[] = ['stretch', 'interleaved', 'strategy'];

export const PLATEAU_WINDOW = 5;
/** |trend| below this (score points per session) counts as flat. */
export const PLATEAU_MAX_SLOPE = 1;
/** Spread (max − min) of the window below this counts as stable. */
export const PLATEAU_MAX_RANGE = 8;
/** Above this score the exercise's ceiling, not a plateau, is the limit. */
export const PLATEAU_CEILING = 92;
/** Below this score the task is too hard even at level 1: foundational work, not a format change. */
export const PLATEAU_FLOOR = 8;

export interface PlateauStatus {
  dimension: DimensionId;
  /** Sessions in the analysed window. */
  sessions: number;
  /** OLS trend of the estimate, score points per session. */
  slope: number;
  range: number;
  meanScore: number;
  firstAt: number;
  lastAt: number;
  /** Formats used in the window (standard included). */
  formatsTried: TrainingFormat[];
}

export function detectPlateau(twin: TwinState, sessions: readonly SessionRecord[], dim: DimensionId): PlateauStatus | null {
  const history = dimensionHistory(twin, dim);
  if (history.length < PLATEAU_WINDOW) return null;
  const win = history.slice(-PLATEAU_WINDOW);
  const scores = win.map((h) => h.score);
  const range = Math.max(...scores) - Math.min(...scores);
  const trend = olsSlope(scores.map((_, i) => i), scores) ?? 0;
  const meanScore = scores.reduce((s, x) => s + x, 0) / scores.length;
  if (Math.abs(trend) > PLATEAU_MAX_SLOPE || range > PLATEAU_MAX_RANGE || meanScore >= PLATEAU_CEILING || meanScore <= PLATEAU_FLOOR) return null;
  const ids = new Set(win.map((h) => h.sessionId));
  const formatsTried = [...new Set(sessions.filter((s) => ids.has(s.id)).map((s) => s.format ?? 'standard'))];
  return {
    dimension: dim,
    sessions: win.length,
    slope: Math.round(trend * 100) / 100,
    range: Math.round(range * 10) / 10,
    meanScore: Math.round(meanScore * 10) / 10,
    firstAt: win[0].at,
    lastAt: win.at(-1)!.at,
    formatsTried,
  };
}

/** Next format to try: rotate after the last non-standard format used on this dimension. */
export function nextFormat(sessions: readonly SessionRecord[], dim: DimensionId): TrainingFormat {
  const last = [...sessions].reverse().find((s) => s.dimension === dim && s.mode === 'training' && s.format && s.format !== 'standard');
  if (!last?.format) return FORMAT_ROTATION[0];
  const i = FORMAT_ROTATION.indexOf(last.format);
  return FORMAT_ROTATION[(i + 1) % FORMAT_ROTATION.length];
}

/** Strategy to try next on a dimension: the one after the last strategy suggested. */
export function nextStrategy(sessions: readonly SessionRecord[], dim: DimensionId): string | undefined {
  const strategies = getDimension(dim).strategies;
  if (!strategies.length) return undefined;
  const last = [...sessions].reverse().find((s) => s.dimension === dim && s.strategyKey)?.strategyKey;
  const i = strategies.findIndex((s) => s.key === last);
  return strategies[(i + 1) % strategies.length].key;
}

export const formatName = (f: TrainingFormat | undefined) => TRAINING_FORMATS[f ?? 'standard'].name;
