/**
 * Insight engine — deterministic detectors that turn data into evidence-backed findings.
 * The coach (template or LLM) only *narrates* these insights; it never invents findings.
 * Every insight carries its evidence (with the raw numbers) and a confidence level.
 */
import { AFFECT_LABEL } from './affect';
import { getDimension } from './dimensions';
import { TRAINING_FORMATS, detectPlateau, nextFormat } from './formats';
import { isMashedSession } from './quality';
import { detectAsymmetry } from './tiers';
import { metric } from './metrics';
import { median } from './stats';
import { currentProfile, dimensionHistory, modelFor, snapshotAt } from './twin';
import { pSuccess, scoreSummary } from './irt';
import type { Confidence, Evidence, Insight, SessionRecord, TwinState } from './types';

const DAY = 86_400_000;
const r0 = (x: number) => Math.round(x);

let counter = 0;
const ev = (label: string, value: string, numbers: number[] = []): Evidence => ({ id: `e${++counter}`, label, value, numbers });

const short = (dim: string) => getDimension(dim).short;

// ---------------------------------------------------------------------------------------------
// Session-level insights (shown on the results screen)
// ---------------------------------------------------------------------------------------------

export function sessionInsights(session: SessionRecord, previous?: SessionRecord): Insight[] {
  const out: Insight[] = [];
  const dim = session.dimension;
  const name = short(dim);
  const delta = session.scoreAfter.score - session.scoreBefore.score;
  const mashed = isMashedSession(session.quality);
  const n = session.trials.length;
  // A noisy session cannot support a confident statement, whatever the interval says.
  const capped = (c: Confidence): Confidence =>
    session.quality.reliability === 'poor' ? 'low' : session.quality.reliability === 'fair' && c === 'high' ? 'moderate' : c;

  out.push({
    id: `${session.id}-delta`,
    kind: mashed ? 'stable' : delta >= 2 ? 'improvement' : delta <= -2 ? 'decline' : 'stable',
    dimension: dim,
    title: mashed
      ? `${name} estimate kept, with a wider range`
      : delta >= 2
        ? `${name} estimate rose ${r0(delta)} pts`
        : delta <= -2
          ? `${name} estimate dipped ${r0(-delta)} pts`
          : `${name} estimate held steady`,
    evidence: [
      ev('Before', `${r0(session.scoreBefore.score)} % (${r0(session.scoreBefore.lo)}–${r0(session.scoreBefore.hi)})`, [
        r0(session.scoreBefore.score),
        r0(session.scoreBefore.lo),
        r0(session.scoreBefore.hi),
      ]),
      ev('After', `${r0(session.scoreAfter.score)} % (${r0(session.scoreAfter.lo)}–${r0(session.scoreAfter.hi)})`, [
        r0(session.scoreAfter.score),
        r0(session.scoreAfter.lo),
        r0(session.scoreAfter.hi),
      ]),
      ev('Trials', `${n}`, [n]),
      ev('Session weight', `${Math.round(session.quality.weight * 100)} %`, [Math.round(session.quality.weight * 100)]),
    ],
    confidence: capped(session.scoreAfter.confidence),
    priority: 80,
    tone: delta >= 2 ? 'celebrate' : 'inform',
  });

  // Speed–accuracy trade-off: errors that are clearly faster than correct responses.
  const speeded = dim !== 'reasoning' && dim !== 'memory';
  if (speeded && n >= 10) {
    const medCorrect = median(session.trials.filter((t) => t.correct && t.rtMs !== null).map((t) => t.rtMs));
    const fastErrors = session.trials.filter((t) => !t.correct && t.rtMs !== null && medCorrect && t.rtMs < 0.8 * medCorrect).length;
    const errors = session.trials.filter((t) => !t.correct).length;
    if (medCorrect && fastErrors >= 3 && fastErrors / Math.max(1, errors) >= 0.6) {
      out.push({
        id: `${session.id}-sat`,
        kind: 'speed_accuracy',
        dimension: dim,
        title: 'Fast errors: a touch more care pays off',
        evidence: [
          ev('Errors faster than your usual pace', `${fastErrors} of ${errors}`, [fastErrors, errors]),
          ev('Your median correct response', `${r0(medCorrect)} ms`, [r0(medCorrect)]),
        ],
        confidence: fastErrors >= 5 ? 'high' : 'moderate',
        priority: 72,
        tone: 'advise',
        suggestion: dim === 'inhibition' ? 'pause' : dim === 'flexibility' ? 'cue' : 'rhythm',
      });
    }
  }

  // Within-session fatigue.
  if (n >= 12) {
    const third = Math.floor(n / 3);
    const rate = (ts: typeof session.trials) => (100 * ts.filter((t) => t.success).length) / ts.length;
    const first = rate(session.trials.slice(0, third));
    const last = rate(session.trials.slice(-third));
    if (first - last >= 25) {
      out.push({
        id: `${session.id}-fatigue`,
        kind: 'fatigue',
        dimension: dim,
        title: 'Performance faded towards the end',
        evidence: [ev('Success, first third', `${r0(first)} %`, [r0(first)]), ev('Success, last third', `${r0(last)} %`, [r0(last)])],
        confidence: first - last >= 40 ? 'high' : 'moderate',
        priority: 70,
        tone: 'advise',
      });
    }
  }

  const rtCv = metric(session.metrics, 'rtCv');
  if (speeded && rtCv !== null && rtCv > 0.42) {
    out.push({
      id: `${session.id}-cv`,
      kind: 'consistency',
      dimension: dim,
      title: 'Uneven rhythm',
      evidence: [ev('Response-time variability (CV)', rtCv.toFixed(2), [Number(rtCv.toFixed(2))])],
      confidence: 'moderate',
      priority: 55,
      tone: 'advise',
      suggestion: dim === 'speed' ? 'rhythm' : dim === 'attention' ? 'scan' : 'center',
    });
  }

  const compare = (key: string, kind: Insight['kind'], label: string, suggestion: string, goodTitle: string, workTitle: string, noneTitle: string) => {
    const now = metric(session.metrics, key);
    if (now === null) return;
    const before = previous ? metric(previous.metrics, key) : null;
    // A negative cost is measurement noise around zero, not a real advantage: say so plainly.
    const fmt = (v: number) => (v <= 0 ? 'none measurable' : `${r0(v)} ms`);
    const evidence = [ev(label, fmt(now), now > 0 ? [r0(now)] : [])];
    if (before !== null) evidence.push(ev('Last time', fmt(before), before > 0 ? [r0(before)] : []));
    const improved = (before !== null && now < before - 15) || now <= 0;
    out.push({
      id: `${session.id}-${key}`,
      kind,
      dimension: dim,
      title: now <= 0 ? noneTitle : improved ? goodTitle : workTitle,
      evidence,
      confidence: n >= 20 ? 'moderate' : 'low',
      priority: improved ? 65 : 58,
      tone: improved ? 'celebrate' : 'advise',
      suggestion,
    });
  };
  if (dim === 'inhibition')
    compare('interferenceCost', 'interference', 'Distraction cost', 'center', 'Conflicting arrows cost you less time', 'Conflicting arrows still slow you down', 'Conflicting arrows did not slow you down');
  if (dim === 'flexibility')
    compare('switchCost', 'switch_cost', 'Switch cost', 'prepare', 'Switching rules got cheaper', 'Rule switches still cost extra time', 'Rule switches did not slow you down');

  if (dim === 'attention') {
    const slopeMs = metric(session.metrics, 'searchSlope');
    if (slopeMs !== null) {
      out.push({
        id: `${session.id}-search`,
        kind: 'search_efficiency',
        dimension: dim,
        title: slopeMs < 25 ? 'Efficient scanning' : 'Scanning cost grows with clutter',
        evidence: [ev('Extra time per item', `${slopeMs.toFixed(1)} ms`, [Number(slopeMs.toFixed(1))])],
        confidence: 'low',
        priority: 50,
        tone: slopeMs < 25 ? 'celebrate' : 'advise',
        suggestion: 'scan',
      });
    }
  }

  if (dim === 'memory') {
    const share = metric(session.metrics, 'orderErrorShare');
    const errors = session.trials.filter((t) => !t.correct).length;
    if (share !== null && share >= 50 && errors >= 2) {
      out.push({
        id: `${session.id}-order`,
        kind: 'sequence_order',
        dimension: dim,
        title: 'You remember the tiles, the order slips',
        evidence: [ev('Errors that were order swaps', `${r0(share)} %`, [r0(share)]), ev('Missed sequences', `${errors}`, [errors])],
        confidence: errors >= 4 ? 'moderate' : 'low',
        priority: 66,
        tone: 'advise',
        suggestion: 'chunk',
      });
    }
  }

  if (dim === 'reasoning') {
    const missed = session.trials.filter((t) => typeof t.meta?.missedAttr === 'string').map((t) => String(t.meta!.missedAttr));
    if (missed.length >= 2) {
      const counts = missed.reduce<Record<string, number>>((m, a) => ({ ...m, [a]: (m[a] ?? 0) + 1 }), {});
      const [attr, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      out.push({
        id: `${session.id}-rule`,
        kind: 'reasoning_rule',
        dimension: dim,
        title: `The ${attr} rule was the trickiest`,
        evidence: [ev(`Answers that broke the ${attr} rule`, `${count} of ${missed.length}`, [count, missed.length])],
        confidence: count >= 3 ? 'moderate' : 'low',
        priority: 62,
        tone: 'advise',
        suggestion: 'one-attribute',
      });
    }
  }

  const warn = session.quality.flags.filter((f) => f.severity === 'warn');
  if (isMashedSession(session.quality)) {
    const a = session.quality.anomaly;
    const width = r0((session.scoreAfter.hi - session.scoreAfter.lo) / 2);
    out.push({
      id: `${session.id}-rushing`,
      kind: 'data_quality',
      dimension: dim,
      title: 'Answers came in faster than the screen can be read',
      evidence: [
        ...(a
          ? [
              ev('Implausibly fast answers', `${a.rapid} of ${a.responded} (median ${a.medianRapidRtMs} ms, plausible minimum ≈ ${a.thresholdMs} ms)`, [a.rapid, a.responded, a.medianRapidRtMs, a.thresholdMs]),
              ev('Correct among them', `${r0(a.rapidAccuracy * 100)} %`, [r0(a.rapidAccuracy * 100)]),
              ev('Response-time effort', `${r0(a.effort * 100)} %`, [r0(a.effort * 100)]),
            ]
          : session.quality.flags.filter((f) => f.kind === 'random_responding').map((f) => ev('Random pressing', f.detail, []))),
        ev('Session weight', `${Math.round(session.quality.weight * 100)} %`, [Math.round(session.quality.weight * 100)]),
        ev('Uncertainty after the session', `±${width} pts`, [width]),
      ],
      confidence: 'high',
      priority: 95,
      tone: 'inform',
    });
  } else if (warn.length) {
    out.push({
      id: `${session.id}-quality`,
      kind: 'data_quality',
      dimension: dim,
      title: 'This session counted less',
      evidence: warn.map((f) => ev(f.kind.replace(/_/g, ' '), f.detail, [])).concat(ev('Session weight', `${Math.round(session.quality.weight * 100)} %`, [Math.round(session.quality.weight * 100)])),
      confidence: 'high',
      priority: 90,
      tone: 'inform',
    });
  }

  if (session.affect.state !== 'neutral') {
    const s = session.affect.state;
    out.push({
      id: `${session.id}-affect`,
      kind: 'affect',
      dimension: dim,
      title: AFFECT_LABEL[s],
      evidence: session.affect.evidence.filter((e) => e.toward === s).map((e) => ev(e.signal, e.value, [])),
      confidence: session.affect.confidence >= 0.6 ? 'moderate' : 'low',
      priority: s === 'fatigued' || s === 'strained' ? 85 : 60,
      tone: s === 'flow' ? 'celebrate' : 'encourage',
    });
  }

  if (session.selfPrediction !== undefined) {
    const diff = session.selfPrediction - session.scoreAfter.score;
    if (Math.abs(diff) >= 12) {
      out.push({
        id: `${session.id}-calib`,
        kind: 'calibration',
        dimension: dim,
        title: diff > 0 ? 'You expected a bit more' : 'You did better than you expected',
        evidence: [
          ev('Your prediction', `${r0(session.selfPrediction)} %`, [r0(session.selfPrediction)]),
          ev('Estimate after the session', `${r0(session.scoreAfter.score)} %`, [r0(session.scoreAfter.score)]),
        ],
        confidence: 'moderate',
        priority: 45,
        tone: diff > 0 ? 'inform' : 'celebrate',
      });
    }
  }
  // A rushed session says nothing reliable about strain, fatigue or rhythm: keep the message focused.
  if (mashed) return out.filter((i) => i.kind === 'data_quality' || i.id.endsWith('-delta')).sort((a, b) => b.priority - a.priority);
  return out.sort((a, b) => b.priority - a.priority);
}

/** The coach's contextual question after a rushed / random session (answered on the results page). */
export function rushQuestion(session: SessionRecord): string | null {
  if (!isMashedSession(session.quality)) return null;
  const a = session.quality.anomaly;
  const width = r0((session.scoreAfter.hi - session.scoreAfter.lo) / 2);
  const fast = a
    ? `${a.rapid} of your ${a.responded} answers came in at a median ${a.medianRapidRtMs} ms — faster than anyone can read the screen — and only ${r0(a.rapidAccuracy * 100)} % of those were right.`
    : 'Your answers were very fast and close to coin-flipping.';
  return (
    `${fast} I did not record that as a drop in ability: those answers were left out, the session counts ${Math.round(session.quality.weight * 100)} %, ` +
    `and the estimate is now marked as highly uncertain (±${width} pts). Were you distracted, or rushing?`
  );
}

// ---------------------------------------------------------------------------------------------
// Profile-level insights (dashboard + coach)
// ---------------------------------------------------------------------------------------------

export function profileInsights(twin: TwinState, sessions: readonly SessionRecord[], now: number): Insight[] {
  const out: Insight[] = [];
  const profile = currentProfile(twin, now);
  const measured = profile.filter((p) => !p.unmeasured);

  // Trend vs ~2 weeks ago.
  for (const p of measured) {
    const history = dimensionHistory(twin, p.id);
    if (history.length < 2) continue;
    const ref = snapshotAt(twin, now - 14 * DAY)?.dims[p.id] ?? history[0];
    if (!ref || ref.score === p.summary.score) continue;
    const refBelief = { mean: ref.mean, sd: ref.sd };
    const z = (p.belief.mean - refBelief.mean) / Math.sqrt(p.belief.sd ** 2 + refBelief.sd ** 2);
    const refScore = scoreSummary(refBelief, modelFor(p.id)).score;
    const delta = p.summary.score - refScore;
    if (Math.abs(z) < 0.5) continue;
    const confidence: Confidence = Math.abs(z) > 1.64 ? 'high' : Math.abs(z) > 1.28 ? 'moderate' : 'low';
    const up = delta > 0;
    out.push({
      id: `trend-${p.id}`,
      kind: up ? 'improvement' : 'decline',
      dimension: p.id,
      title: `${short(p.id)} ${up ? 'is growing' : 'dipped'}`,
      evidence: [
        ev('Then', `${r0(refScore)} %`, [r0(refScore)]),
        ev('Now', `${r0(p.summary.score)} % (${r0(p.summary.lo)}–${r0(p.summary.hi)})`, [r0(p.summary.score), r0(p.summary.lo), r0(p.summary.hi)]),
        ev('Change', `${up ? '+' : ''}${r0(delta)} pts`, [r0(Math.abs(delta))]),
        ev('Signal-to-noise (z)', z.toFixed(1), [Number(z.toFixed(1))]),
      ],
      confidence,
      priority: up ? 80 : 74,
      tone: up ? 'celebrate' : 'encourage',
    });
  }

  // Plateau: flat trend and small spread over the last sessions (see formats.ts).
  for (const p of measured) {
    const plateau = detectPlateau(twin, sessions, p.id);
    if (!plateau) continue;
    const format = nextFormat(sessions, p.id);
    out.push({
      id: `plateau-${p.id}`,
      kind: 'plateau',
      dimension: p.id,
      title: `${short(p.id)} has levelled off`,
      evidence: [
        ev(`Progress curve · ${short(p.id)}: range over the last ${plateau.sessions} sessions`, `${plateau.range.toFixed(1)} pts`, [plateau.range]),
        ev('Trend', `${plateau.slope >= 0 ? '+' : ''}${plateau.slope.toFixed(1)} pts per session`, [Math.abs(plateau.slope)]),
        ev('Average estimate in that window', `${r0(plateau.meanScore)} %`, [r0(plateau.meanScore)]),
        ev('Next format', TRAINING_FORMATS[format].name),
      ],
      confidence: 'moderate',
      priority: 68,
      tone: 'advise',
      suggestion: getDimension(p.id).strategies[1]?.key,
    });
  }

  // Asymmetric mind: far-apart areas with non-overlapping intervals.
  const asym = detectAsymmetry(profile);
  if (asym) {
    out.push({
      id: `asymmetry-${asym.strong}-${asym.weak}`,
      kind: 'asymmetry',
      dimension: asym.weak,
      title: `Asymmetric profile: ${short(asym.strong)} far ahead of ${short(asym.weak)}`,
      evidence: [
        ev(`Radar · ${short(asym.strong)}`, `${asym.strongScore} % (${asym.strongInterval[0]}–${asym.strongInterval[1]})`, [asym.strongScore, ...asym.strongInterval]),
        ev(`Radar · ${short(asym.weak)}`, `${asym.weakScore} % (${asym.weakInterval[0]}–${asym.weakInterval[1]})`, [asym.weakScore, ...asym.weakInterval]),
        ev('Gap', `${asym.gap} pts, intervals do not overlap`, [asym.gap]),
      ],
      confidence: 'high',
      priority: 76,
      tone: 'inform',
    });
  }

  const confident = measured.filter((p) => p.summary.confidence !== 'low').sort((a, b) => b.summary.score - a.summary.score);
  if (confident.length >= 2) {
    const top = confident[0];
    out.push({
      id: `strength-${top.id}`,
      kind: 'strength',
      dimension: top.id,
      title: `Current strength: ${short(top.id)}`,
      evidence: [ev(`${short(top.id)} score`, `${r0(top.summary.score)} % (${r0(top.summary.lo)}–${r0(top.summary.hi)})`, [r0(top.summary.score), r0(top.summary.lo), r0(top.summary.hi)])],
      confidence: top.summary.confidence,
      priority: 50,
      tone: 'celebrate',
    });
  }

  const unsure = profile.filter((p) => p.unmeasured || p.summary.confidence === 'low');
  if (unsure.length) {
    out.push({
      id: 'needs-data',
      kind: 'needs_data',
      title: `${unsure.length} area${unsure.length > 1 ? 's' : ''} still uncertain`,
      evidence: unsure.map((p) =>
        ev(short(p.id), p.unmeasured ? 'not measured yet' : `±${r0((p.summary.hi - p.summary.lo) / 2)} pts`, p.unmeasured ? [] : [r0((p.summary.hi - p.summary.lo) / 2)]),
      ),
      confidence: 'high',
      priority: 60,
      tone: 'inform',
    });
  }

  // Practice streak (consecutive days up to today or yesterday).
  const days = new Set(sessions.map((s) => new Date(s.endedAt).toDateString()));
  let streak = 0;
  for (let d = 0; d < 365; d++) {
    const key = new Date(now - d * DAY).toDateString();
    if (days.has(key)) streak++;
    else if (d > 0) break;
  }
  const week = sessions.filter((s) => s.endedAt > now - 7 * DAY);
  const weekDays = new Set(week.map((s) => new Date(s.endedAt).toDateString())).size;
  if (sessions.length) {
    out.push({
      id: 'streak',
      kind: 'streak',
      title: streak >= 3 ? `${streak}-day practice streak` : `${weekDays} practice day${weekDays === 1 ? '' : 's'} this week`,
      evidence: [ev('Current streak', `${streak} days`, [streak]), ev('Days practised in the last 7', `${weekDays}`, [weekDays]), ev('Sessions in the last 7 days', `${week.length}`, [week.length])],
      confidence: 'high',
      priority: 45,
      tone: streak >= 3 ? 'celebrate' : 'encourage',
    });
  }

  // Time of day: training sessions only, compare morning vs later bands.
  const train = sessions.filter((s) => s.mode === 'training' && s.trials.length);
  const band = (s: SessionRecord) => {
    const h = new Date(s.startedAt).getHours();
    return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  };
  const stats = new Map<string, { k: number; n: number; sessions: number }>();
  for (const s of train) {
    const b = band(s);
    const st = stats.get(b) ?? { k: 0, n: 0, sessions: 0 };
    // Success relative to expectation removes the effect of level choice.
    const model = modelFor(s.dimension);
    const expected = s.trials.reduce((acc, t) => acc + pSuccess(s.before.mean, t.level, model), 0);
    st.k += s.trials.filter((t) => t.success).length - expected;
    st.n += s.trials.length;
    st.sessions++;
    stats.set(b, st);
  }
  const bands = [...stats.entries()].filter(([, v]) => v.sessions >= 3).map(([b, v]) => ({ b, gain: (100 * v.k) / v.n, n: v.n }));
  if (bands.length >= 2) {
    bands.sort((a, b) => b.gain - a.gain);
    const best = bands[0];
    const worst = bands.at(-1)!;
    const diff = best.gain - worst.gain;
    const se = 100 * Math.sqrt(0.25 / best.n + 0.25 / worst.n);
    if (diff / se > 1.28) {
      out.push({
        id: 'time-of-day',
        kind: 'time_of_day',
        title: `You tend to do better in the ${best.b}`,
        evidence: [
          ev(`${best.b} vs expectation`, `${best.gain >= 0 ? '+' : ''}${best.gain.toFixed(1)} pts`, [Number(Math.abs(best.gain).toFixed(1))]),
          ev(`${worst.b} vs expectation`, `${worst.gain >= 0 ? '+' : ''}${worst.gain.toFixed(1)} pts`, [Number(Math.abs(worst.gain).toFixed(1))]),
          ev('Trials compared', `${best.n} vs ${worst.n}`, [best.n, worst.n]),
        ],
        confidence: diff / se > 1.96 ? 'moderate' : 'low',
        priority: 40,
        tone: 'inform',
      });
    }
  }

  // Self-prediction calibration over the last 5 predictions.
  const preds = sessions.filter((s) => s.selfPrediction !== undefined).slice(-5);
  if (preds.length >= 3) {
    const bias = preds.reduce((s, x) => s + (x.selfPrediction! - x.scoreAfter.score), 0) / preds.length;
    out.push({
      id: 'calibration',
      kind: 'calibration',
      title: Math.abs(bias) < 8 ? 'You read your own performance well' : bias > 0 ? 'You tend to expect a bit more than you score' : 'You tend to underestimate yourself',
      evidence: [ev('Average prediction gap (last 5)', `${bias >= 0 ? '+' : ''}${r0(bias)} pts`, [r0(Math.abs(bias))])],
      confidence: preds.length >= 5 ? 'moderate' : 'low',
      priority: 35,
      tone: Math.abs(bias) < 8 ? 'celebrate' : 'inform',
    });
  }

  return out.sort((a, b) => b.priority - a.priority);
}

/** Days since the twin was last updated on any dimension. */
export function daysSinceActivity(twin: TwinState, now: number): number | null {
  const last = Math.max(...Object.values(twin.dims).map((d) => d.lastUpdated ?? 0));
  return last ? (now - last) / DAY : null;
}

