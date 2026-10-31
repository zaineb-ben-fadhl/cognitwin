/**
 * Emotion-aware, but honest about it.
 *
 * We estimate a coarse *working state* (flow, strained, fatigued, disengaged, neutral) — not
 * emotions — by fusing three sources: interaction behaviour (always available, non-biometric),
 * optional self-report, and optional on-device camera cues. Facial movements are not reliable
 * readouts of emotion (Barrett et al., 2019), so camera cues carry the lowest weight and are
 * never allowed to decide on their own. The estimate only changes the coach's tone, break
 * suggestions and training difficulty — never a score.
 */
import type { AffectEstimate, AffectEvidence, AffectState, BehaviourLog, CameraCues, SelfReport, Trial } from './types';
import { cv, median, slope } from './stats';

const SOURCE_WEIGHT = { behaviour: 1, 'self-report': 0.8, camera: 0.4 } as const;
/** A state needs at least this much non-camera support to be reported. */
const MIN_NON_CAMERA_SUPPORT = 0.3;

export function maxFailureStreak(trials: readonly Trial[]): number {
  let best = 0;
  let cur = 0;
  for (const t of trials) {
    cur = t.success ? 0 : cur + 1;
    best = Math.max(best, cur);
  }
  return best;
}

export function estimateAffect(
  trials: readonly Trial[],
  behaviour: BehaviourLog,
  self?: SelfReport,
  camera?: CameraCues,
): AffectEstimate {
  const evidence: AffectEvidence[] = [];
  const support: Record<AffectState, { total: number; nonCamera: number }> = {
    flow: { total: 0, nonCamera: 0 },
    strained: { total: 0, nonCamera: 0 },
    fatigued: { total: 0, nonCamera: 0 },
    disengaged: { total: 0, nonCamera: 0 },
    neutral: { total: 0, nonCamera: 0 },
  };
  const add = (source: AffectEvidence['source'], toward: AffectState, strength: number, signal: string, value: string) => {
    const s = SOURCE_WEIGHT[source] * strength;
    support[toward].total += s;
    if (source !== 'camera') support[toward].nonCamera += s;
    evidence.push({ source, signal, value, toward });
  };

  // --- behaviour -------------------------------------------------------------
  const n = trials.length;
  if (n >= 6) {
    const third = Math.max(2, Math.floor(n / 3));
    const rate = (ts: readonly Trial[]) => ts.filter((t) => t.success).length / ts.length;
    const first = rate(trials.slice(0, third));
    const last = rate(trials.slice(-third));
    const rts = trials.map((t) => t.rtMs);
    const med = median(rts) ?? 1;
    const rtSlope = slope(
      trials.filter((t) => t.rtMs !== null).map((t) => t.index),
      trials.filter((t) => t.rtMs !== null).map((t) => (t.rtMs as number) / med),
    );
    const variability = cv(trials.filter((t) => t.correct).map((t) => t.rtMs));
    const streak = maxFailureStreak(trials);
    const overall = rate(trials);
    const anticip = trials.filter((t) => t.rtMs !== null && t.rtMs < 150).length / n;

    if (streak >= 4) add('behaviour', 'strained', 0.6, 'Misses in a row', `${streak}`);
    if (anticip > 0.1) add('behaviour', 'strained', 0.4, 'Very fast presses', `${Math.round(anticip * 100)} %`);
    if (first - last > 0.25 && (rtSlope ?? 0) > 0.008)
      add('behaviour', 'fatigued', 0.7, 'Success dropped while responses slowed', `${Math.round(first * 100)} % → ${Math.round(last * 100)} %`);
    else if (first - last > 0.3) add('behaviour', 'fatigued', 0.45, 'Success dropped in the last third', `${Math.round(first * 100)} % → ${Math.round(last * 100)} %`);
    if (behaviour.focusLosses >= 2) add('behaviour', 'disengaged', 0.6, 'Left the window', `${behaviour.focusLosses}×`);
    if (behaviour.longPauses >= 2) add('behaviour', 'disengaged', 0.4, 'Long pauses', `${behaviour.longPauses}`);
    if (variability !== null && variability > 0.5) add('behaviour', 'disengaged', 0.3, 'Irregular rhythm', `CV ${variability.toFixed(2)}`);
    if (overall >= 0.65 && overall <= 0.92 && (variability ?? 1) < 0.3 && streak <= 2)
      add('behaviour', 'flow', 0.6, 'Steady rhythm at a good challenge', `${Math.round(overall * 100)} % success`);
  }

  // --- self-report -----------------------------------------------------------
  if (self?.mood !== undefined && self.mood <= 2) add('self-report', 'strained', 0.7, 'Mood check-in', `${self.mood}/5`);
  if (self?.energy !== undefined && self.energy <= 2) add('self-report', 'fatigued', 0.8, 'Energy check-in', `${self.energy}/5`);
  if ((self?.mood ?? 0) >= 4 && (self?.energy ?? 0) >= 4) add('self-report', 'flow', 0.5, 'Mood & energy check-in', `${self!.mood}/5 · ${self!.energy}/5`);

  // --- camera (optional, on-device, aggregated) -------------------------------
  if (camera && camera.samples >= 10) {
    if (camera.browTension > 0.35) add('camera', 'strained', 0.6, 'Brow tension (camera)', `${Math.round(camera.browTension * 100)} %`);
    if (camera.eyeClosure > 0.15) add('camera', 'fatigued', 0.6, 'Eyes often closed (camera)', `${Math.round(camera.eyeClosure * 100)} %`);
    if (camera.gazeAway > 0.25) add('camera', 'disengaged', 0.6, 'Looking away (camera)', `${Math.round(camera.gazeAway * 100)} %`);
    if (camera.smile > 0.3) add('camera', 'flow', 0.3, 'Relaxed expression (camera)', `${Math.round(camera.smile * 100)} %`);
  }

  const ranked = (Object.keys(support) as AffectState[])
    .filter((s) => s !== 'neutral')
    .sort((a, b) => support[b].total - support[a].total);
  const top = ranked[0];
  const totalSupport = ranked.reduce((s, k) => s + support[k].total, 0);
  const sources = [...new Set(evidence.map((e) => e.source))];

  // Rule: no decision on face data alone — checked first so the UI can say the cap was applied.
  const cameraLed = support[top].total > support[top].nonCamera;
  if (cameraLed && support[top].nonCamera < MIN_NON_CAMERA_SUPPORT) {
    return { state: 'neutral', confidence: 0.4, evidence, sources, cameraCapped: true };
  }
  if (support[top].total < 0.35) return { state: 'neutral', confidence: 0.5, evidence, sources };
  const confidence = Math.min(0.9, support[top].total / (totalSupport + 0.6));
  return { state: top, confidence: Math.round(confidence * 100) / 100, evidence, sources };
}

/** In-session signal used by the training controller to ease off before frustration builds. */
export function liveStrain(trials: readonly Trial[]): boolean {
  const recent = trials.slice(-6);
  if (recent.length < 4) return false;
  const rate = recent.filter((t) => t.success).length / recent.length;
  let streak = 0;
  for (let i = trials.length - 1; i >= 0 && !trials[i].success; i--) streak++;
  return streak >= 3 || rate <= 0.34;
}

export const AFFECT_LABEL: Record<AffectState, string> = {
  flow: 'In the zone',
  strained: 'Under strain',
  fatigued: 'Getting tired',
  disengaged: 'Distracted',
  neutral: 'Steady',
};
