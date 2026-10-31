/**
 * Deterministic natural-language generation. Works fully offline and is the fallback for the
 * LLM layer. Style rules (see docs/COACH.md):
 *  - lead with the finding, then the evidence, then one concrete next step;
 *  - hedge in proportion to confidence; never state certainty about the future;
 *  - praise the process (effort, strategy, consistency), never fixed traits;
 *  - no clinical vocabulary (enforced by guardrails + tests).
 */
import { AFFECT_LABEL } from '../affect';
import { getDimension } from '../dimensions';
import { hashSeed, uid } from '../rng';
import type { Confidence, Insight, SessionRecord } from '../types';
import type { CoachAction, CoachMessage } from './types';

function variant(seed: string, options: readonly string[]): string {
  return options[hashSeed(seed) % options.length];
}

export function hedge(confidence: Confidence, seed: string): string {
  if (confidence === 'high') return variant(seed, ['The data is clear: ', 'Clearly, ', '']);
  if (confidence === 'moderate') return variant(seed, ['It looks like ', 'The data suggests ', 'So far, it seems ']);
  return variant(seed, ["It's early, but possibly ", 'Tentatively, ', 'With limited data, it may be that ']);
}

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

export function strategyText(dimension: string | undefined, key: string | undefined): string | null {
  if (!dimension || !key) return null;
  const s = getDimension(dimension).strategies.find((x) => x.key === key);
  return s ? `${s.title}: ${lowerFirst(s.detail)}` : null;
}

const evidenceSentence = (i: Insight) =>
  i.evidence
    .slice(0, 2)
    .map((e) => `${e.label.toLowerCase()}: ${e.value}`)
    .join('; ');

/** One insight → 1–3 sentences. */
export function narrateInsight(i: Insight): string {
  const dim = i.dimension ? getDimension(i.dimension).short : '';
  const h = hedge(i.confidence, i.id);
  const tip = strategyText(i.dimension, i.suggestion);
  const ev = evidenceSentence(i);
  switch (i.kind) {
    case 'improvement':
    case 'decline': {
      const then = i.evidence.find((e) => e.label === 'Then' || e.label === 'Before');
      const now = i.evidence.find((e) => e.label === 'Now' || e.label === 'After');
      const change = then && now ? ` from ${then.value} to ${now.value}` : ev ? ` (${ev})` : '';
      const verb = i.kind === 'improvement' ? 'has grown' : 'has dipped';
      const subject = dim || 'Your estimate';
      const lead = `${h}${h ? subject.toLowerCase() : subject} ${verb}${change}.`;
      return i.kind === 'improvement'
        ? `${lead} That's the result of the practice you put in${i.confidence === 'low' ? ' — a few more sessions will confirm it' : ''}.`
        : `${lead} Dips are normal: sleep, stress and time of day all move scores. One calm session usually tells us more than one number.`;
    }
    case 'stable':
      return `${i.title} (${ev}). Stable estimates are useful too — they make the profile more precise.`;
    case 'speed_accuracy':
      return `${h}speed is costing you accuracy (${ev}). ${tip ?? 'A tiny pause before answering is cheaper than an error.'}`;
    case 'fatigue':
      return `${h}your focus faded towards the end (${ev}). Shorter sessions or a 2-minute break halfway can keep quality up.`;
    case 'consistency':
      return `${h}your rhythm was uneven (${ev}). ${tip ?? 'Aim for a steady pace rather than bursts.'}`;
    case 'interference':
    case 'switch_cost':
    case 'search_efficiency':
    case 'sequence_order':
    case 'reasoning_rule':
      return `${i.title}${ev ? ` (${ev})` : ''}. ${tip ?? ''}`.trim();
    case 'plateau':
      return `${h}${lowerFirst(i.title)} (${ev}). Plateaus are where a new strategy helps most. ${tip ?? 'Try a fresh approach next session.'}`;
    case 'strength':
      return `${i.title} — ${ev}. Strengths are worth maintaining with a light session now and then.`;
    case 'needs_data':
      return `${i.title}: ${i.evidence.map((e) => `${e.label} (${e.value})`).join(', ')}. A short check-in on each will sharpen your profile.`;
    case 'streak':
      return `${i.title}. ${i.tone === 'celebrate' ? 'Consistency is the strongest driver of progress — nice work.' : 'Short, regular sessions beat occasional long ones.'}`;
    case 'time_of_day':
      return `${h}${lowerFirst(i.title)} (${ev}). If you can, schedule the harder sessions then.`;
    case 'calibration':
      return `${i.title} (${ev}). Predicting your own score before each session sharpens self-awareness — it is a skill too.`;
    case 'data_quality':
      return `${i.title}: ${i.evidence[0]?.value ?? ''} The profile used it with reduced weight, so one noisy session can't mislead it.`;
    case 'affect':
      return affectAdvice(i);
    default:
      return `${i.title}. ${dim}`;
  }
}

/** Evidence labels from affect.ts, phrased for a sentence. */
const SIGNAL_PHRASE: Record<string, string> = {
  'Misses in a row': 'several misses in a row',
  'Very fast presses': 'some very fast presses',
  'Success dropped while responses slowed': 'success dropped while you slowed down',
  'Success dropped in the last third': 'success dropped towards the end',
  'Left the window': 'you switched away from the window',
  'Long pauses': 'some long pauses',
  'Irregular rhythm': 'an irregular rhythm',
  'Steady rhythm at a good challenge': 'a steady rhythm at a good level of challenge',
  'Mood check-in': 'your mood check-in',
  'Energy check-in': 'your energy check-in',
  'Mood & energy check-in': 'how you said you felt',
};

const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

function affectAdvice(i: Insight): string {
  const phrases = [...new Set(i.evidence.map((e) => SIGNAL_PHRASE[e.label] ?? (e.label.includes('camera') ? 'camera cues' : e.label.toLowerCase())))];
  const signals = joinAnd(phrases);
  switch (i.title) {
    case AFFECT_LABEL.fatigued:
      return `You might be getting tired — ${signals}. A short break (water, a stretch, looking out of a window) is a smart move; your next session can wait.`;
    case AFFECT_LABEL.strained:
      return `That looked effortful — ${signals}. I'll ease the next round a little; it's fine to reset with a few slow breaths first.`;
    case AFFECT_LABEL.disengaged:
      return `It looked like your attention was pulled elsewhere — ${signals}. If now isn't a good moment, stopping is a perfectly good choice.`;
    case AFFECT_LABEL.flow:
      return `You were in a good rhythm, with ${signals}. This is the zone where practice pays off most.`;
    default:
      return i.title;
  }
}

const MOTIVATION = {
  effort: [
    'Showing up is the part that compounds.',
    'Every session sharpens the picture — and the skill.',
    'Steady practice beats talent spikes.',
  ],
  comeback: ['Welcome back — the twin kept your progress.', 'Good to see you again; let’s rebuild the rhythm gently.'],
};

/** Feedback card after a session. */
export function sessionFeedback(session: SessionRecord, insights: Insight[]): CoachMessage {
  const dim = getDimension(session.dimension);
  const top = insights.slice(0, 3);
  const delta = session.scoreAfter.score - session.scoreBefore.score;
  const reliable = session.quality.reliability !== 'poor';
  const headline =
    session.mode === 'assessment'
      ? `${dim.short} check-in complete`
      : delta >= 2
        ? `Nice session — ${dim.short} is moving up`
        : `${dim.short} session done`;
  const paragraphs = top.map(narrateInsight);
  paragraphs.push(variant(session.id, MOTIVATION.effort));
  const affect = session.affect.state;
  let action: CoachAction | undefined;
  if (affect === 'fatigued' || affect === 'strained') action = { kind: 'take_break', minutes: 3, label: 'Take a 3-minute break' };
  else action = { kind: 'open', route: '/train', label: 'Back to today’s plan' };
  return {
    id: uid('cm_'),
    role: 'coach',
    text: paragraphs.join(' '),
    headline,
    at: session.endedAt,
    evidence: top.flatMap((i) => i.evidence),
    insightIds: top.map((i) => i.id),
    confidence: reliable ? session.scoreAfter.confidence : 'low',
    source: 'template',
    action,
  };
}

/** Daily briefing on the dashboard. */
export function dailyBriefing(insights: Insight[], planRationale: string | null, opts: { name?: string; daysAway: number | null; now: number }): CoachMessage {
  const hour = new Date(opts.now).getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const who = opts.name ? `, ${opts.name}` : '';
  const parts: string[] = [];
  if (opts.daysAway !== null && opts.daysAway >= 4) parts.push(variant(String(opts.now), MOTIVATION.comeback));
  const top = insights.slice(0, 2);
  parts.push(...top.map(narrateInsight));
  if (planRationale) parts.push(`Today's plan: ${lowerFirst(planRationale)}`);
  if (!insights.length && !planRationale) parts.push('Start with the baseline check-in so I can build your Brain Twin.');
  return {
    id: uid('cm_'),
    role: 'coach',
    headline: `${hello}${who}`,
    text: parts.join(' '),
    at: opts.now,
    evidence: top.flatMap((i) => i.evidence),
    insightIds: top.map((i) => i.id),
    confidence: top[0]?.confidence ?? 'low',
    source: 'template',
  };
}
