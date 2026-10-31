/**
 * "Verify the coach" — an openly announced AI-literacy exercise. The coach makes three
 * statements about the user's own profile; exactly one is deliberately wrong and the user is
 * told so up front. Finding it with the dashboard trains (and measures) critical verification
 * without ever deceiving anyone outside the clearly labelled game.
 */
import { getDimension } from '../dimensions';
import type { Rng } from '../rng';
import { clamp } from '../stats';
import type { DimensionProfile } from '../twin';
import type { Confidence } from '../types';

export interface VerifyStatement {
  text: string;
  isTrue: boolean;
  /** Where the user can check it. */
  checkIn: string;
  /** Explanation revealed afterwards. */
  explanation: string;
}

export interface VerifyChallenge {
  id: string;
  createdAt: number;
  statements: VerifyStatement[];
}

const r0 = (x: number) => Math.round(x);
const OTHER_CONF: Record<Confidence, Confidence> = { low: 'high', moderate: 'low', high: 'low' };

type Gen = (fake: boolean) => VerifyStatement | null;

export function createVerifyChallenge(profile: DimensionProfile[], rng: Rng, now: number): VerifyChallenge | null {
  const measured = profile.filter((p) => !p.unmeasured);
  if (measured.length < 3) return null;
  const sorted = [...measured].sort((a, b) => b.summary.score - a.summary.score);
  const pick = () => rng.pick(measured);

  const gens: Gen[] = [
    (fake) => {
      const p = pick();
      const d = getDimension(p.id);
      const real = r0(p.summary.score);
      const shown = fake ? clamp(real + (rng.chance(0.5) ? 1 : -1) * rng.int(18, 26), 3, 97) : real;
      const finalShown = fake && Math.abs(shown - real) < 15 ? clamp(real + (real > 50 ? -20 : 20), 3, 97) : shown;
      return {
        text: `Your ${d.short} estimate is about ${finalShown} %.`,
        isTrue: !fake,
        checkIn: `Dashboard → ${d.short} card`,
        explanation: `${d.short} is actually ${real} %.`,
      };
    },
    (fake) => {
      const top = sorted[0];
      const claimed = fake ? sorted[Math.max(1, sorted.length - 1 - rng.int(0, 1))] : top;
      return {
        text: `Your strongest area right now is ${getDimension(claimed.id).short}.`,
        isTrue: !fake,
        checkIn: 'Dashboard → radar chart',
        explanation: `Your highest estimate is ${getDimension(top.id).short} (${r0(top.summary.score)} %).`,
      };
    },
    (fake) => {
      const p = pick();
      const d = getDimension(p.id);
      const c = fake ? OTHER_CONF[p.summary.confidence] : p.summary.confidence;
      return {
        text: `The ${d.short} estimate currently has ${c} confidence.`,
        isTrue: !fake,
        checkIn: `Dashboard → ${d.short} card (confidence badge)`,
        explanation: `${d.short} has ${p.summary.confidence} confidence (interval ${r0(p.summary.lo)}–${r0(p.summary.hi)}).`,
      };
    },
    (fake) => {
      const p = pick();
      const d = getDimension(p.id);
      const n = p.state.nSessions;
      const shown = fake ? n + rng.int(3, 6) : n;
      return {
        text: `You have completed ${shown} session${shown === 1 ? '' : 's'} of ${d.task.name}.`,
        isTrue: !fake,
        checkIn: 'Brain Twin → session timeline',
        explanation: `You have completed ${n} ${d.task.name} session${n === 1 ? '' : 's'}.`,
      };
    },
    (fake) => {
      const p = measured.find((x) => x.state.bestLevel > 0);
      if (!p) return null;
      const d = getDimension(p.id);
      const L = p.state.bestLevel;
      const shown = fake ? clamp(L + (L >= 8 ? -rng.int(2, 3) : rng.int(2, 3)), 1, 10) : L;
      return {
        text: `Your highest level passed in ${d.task.name} is level ${shown}.`,
        isTrue: !fake,
        checkIn: `Brain Twin → ${d.short} sessions`,
        explanation: `Your best level in ${d.task.name} is ${L}.`,
      };
    },
  ];

  const chosen = rng.shuffle(gens);
  const fakeSlot = rng.int(0, 2);
  const statements: VerifyStatement[] = [];
  for (const g of chosen) {
    if (statements.length === 3) break;
    const s = g(statements.length === fakeSlot);
    if (s) statements.push(s);
  }
  if (statements.length < 3 || statements.filter((s) => !s.isTrue).length !== 1) return null;
  return { id: `vc_${now.toString(36)}`, createdAt: now, statements };
}
