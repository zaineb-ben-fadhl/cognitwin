/**
 * Per-dimension difficulty (Layer C, generalisation).
 *
 * Difficulty is never derived from an average over the profile. Each dimension gets its own
 * tier from its own estimate, and each tier shifts that dimension's target success rate:
 * foundational work starts easy and safe, advanced work is pushed past the comfort zone.
 * An "asymmetric mind" (one area far above another, with non-overlapping intervals) is
 * detected explicitly so the plan can include both ends of the split.
 */
import { TARGET_SUCCESS, type ChallengePreference } from './adaptive';
import { getDimension } from './dimensions';
import { clamp } from './stats';
import type { DimensionProfile } from './twin';
import type { DifficultyTier, DimensionId } from './types';

/** Score thresholds (expected mastery, %) of the tiers. */
export const TIER_LIMITS = { foundational: 30, advanced: 75 } as const;
/** Shift of the target success rate per tier. */
export const TIER_SHIFT: Record<DifficultyTier, number> = { foundational: 0.06, core: 0, advanced: -0.08 };
/** Minimum gap (points) between strongest and weakest area to call a profile asymmetric. */
export const ASYMMETRY_GAP = 40;

export const TIER_LABEL: Record<DifficultyTier, string> = {
  foundational: 'Foundational',
  core: 'Core',
  advanced: 'Advanced',
};

export function tierFor(p: DimensionProfile): DifficultyTier {
  if (p.unmeasured) return 'core';
  if (p.summary.score <= TIER_LIMITS.foundational) return 'foundational';
  if (p.summary.score >= TIER_LIMITS.advanced) return 'advanced';
  return 'core';
}

/** Target success rate for one dimension: the user's preference shifted by that dimension's tier. */
export function tierTarget(pref: ChallengePreference, tier: DifficultyTier): number {
  return Math.round(clamp(TARGET_SUCCESS[pref] + TIER_SHIFT[tier], 0.62, 0.92) * 100) / 100;
}

export interface Asymmetry {
  strong: DimensionId;
  weak: DimensionId;
  strongScore: number;
  weakScore: number;
  strongInterval: [number, number];
  weakInterval: [number, number];
  gap: number;
}

/** Strongest vs weakest measured area, when far apart AND their 80 % intervals do not overlap. */
export function detectAsymmetry(profile: readonly DimensionProfile[]): Asymmetry | null {
  const measured = profile.filter((p) => !p.unmeasured).sort((a, b) => b.summary.score - a.summary.score);
  if (measured.length < 2) return null;
  const strong = measured[0];
  const weak = measured.at(-1)!;
  const gap = strong.summary.score - weak.summary.score;
  if (gap < ASYMMETRY_GAP || strong.summary.lo <= weak.summary.hi) return null;
  return {
    strong: strong.id,
    weak: weak.id,
    strongScore: Math.round(strong.summary.score),
    weakScore: Math.round(weak.summary.score),
    strongInterval: [Math.round(strong.summary.lo), Math.round(strong.summary.hi)],
    weakInterval: [Math.round(weak.summary.lo), Math.round(weak.summary.hi)],
    gap: Math.round(gap),
  };
}

export function asymmetrySentence(a: Asymmetry): string {
  return `${getDimension(a.strong).short} ${a.strongScore} % (${a.strongInterval[0]}–${a.strongInterval[1]}) vs ${getDimension(a.weak).short} ${a.weakScore} % (${a.weakInterval[0]}–${a.weakInterval[1]})`;
}
