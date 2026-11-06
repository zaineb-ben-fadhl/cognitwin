/**
 * Template-mode conversational coach: transparent intent rules + grounded answer builders.
 * The LLM mode (server/coach.ts) receives the same context and is held to the same guardrails;
 * this module is also its fallback whenever the LLM is unavailable or fails a safety check.
 */
import { COLLAB_DESCRIPTION, COLLAB_LABEL, type CollabScore } from '../collaboration';
import { DIMENSIONS, getDimension } from '../dimensions';
import { FACTOR_NAME, explainChoice, formatPhrase } from '../explain';
import { TRAINING_FORMATS, nextFormat, PLATEAU_MAX_RANGE, PLATEAU_MAX_SLOPE, PLATEAU_WINDOW } from '../formats';
import type { PlannerPrefs } from '../planner';
import type { Projection } from '../projection';
import { DISPUTE_LABEL, describeOutcome, detectPushback, type DisputeOutcome } from '../pushback';
import { uid } from '../rng';
import { normCdf } from '../stats';
import type { DimensionProfile } from '../twin';
import type { DailyPlan, DimensionId, DisputeReason, Evidence, Goal, Insight, SessionRecord, TwinState } from '../types';
import { checkMessage, isClinicalQuery, isDistress, SAFE_REPLIES } from './guardrails';
import { narrateInsight } from './templates';
import type { CoachAction, CoachMessage } from './types';

export interface GoalStatus {
  goal: Goal;
  current: number | null;
  probability: number | null;
}

export interface CoachContext {
  now: number;
  name?: string;
  profile: DimensionProfile[];
  insights: Insight[];
  plan: DailyPlan | null;
  goals: GoalStatus[];
  collab: CollabScore;
  projections: Record<DimensionId, Projection | null>;
  recentSessions: SessionRecord[];
  llmEnabled: boolean;
  /** Raw state for data-driven explanations ("why this exercise?"). Never sent to the LLM. */
  twin?: TwinState;
  sessions?: readonly SessionRecord[];
  prefs?: PlannerPrefs;
  /** Forecast for an arbitrary horizon (days); null when there is not enough history. */
  projectAt?: (dim: DimensionId, days: number) => Projection | null;
}

export type Intent =
  | 'distress'
  | 'clinical'
  | 'pushback'
  | 'why_plan'
  | 'plateau'
  | 'greeting'
  | 'thanks'
  | 'overview'
  | 'dimension'
  | 'uncertainty'
  | 'plan'
  | 'goal'
  | 'tips'
  | 'progress'
  | 'projection'
  | 'tired'
  | 'privacy'
  | 'collab'
  | 'methods'
  | 'help'
  | 'unknown';

const RULES: Array<[Intent, RegExp]> = [
  ['why_plan', /\bwhy\b[^?.!]*\b(assign\w*|cho(o)?se|chosen|pick\w*|gave|give|giving|recommend\w*|suggest\w*|select\w*|schedul\w*|put|this (exercise|activity|task|session|one|training)|(today|today'?s|my) (plan|exercise|activity|task|session|training)|in (my|the|today'?s) plan)\b|\bwhy not\b|\b(reason|justif\w*) (for|behind) (this|my|today'?s) (exercise|activity|task|plan|session)\b|\bwhy (am i|should i) (doing|do|training|practi[cs]ing)\b/i],
  ['collab', /\b(collaboration|collab|acs|ai score|working with (the )?ai)\b/i],
  ['privacy', /\b(privacy|my data|delete|retention|camera|microphone|stored?|consent|gdpr|who can see)\b/i],
  ['methods', /\b(how (does|do) (it|this|you|the score|scoring) work|algorithm|model|irt|bayes\w*|methodology|how (is|are) (my )?(score|scores) (calculated|computed))\b/i],
  ['projection', /\b(predict\w*|projection|forecast\w*|future|will (i|my)|going to (be|score|get|improve)|next (week|month|year)|in (a|one|two|three|four|five|six|\d+) (days?|weeks?|months?|years?)|expect(ed)? to|a month from now|fortune)\b/i],
  ['uncertainty', /\b(uncertain\w*|confidence|interval|how sure|accurate|reliable|plus or minus|error bars?|range)\b/i],
  ['plateau', /\b(plateau\w*|stuck|stagnat\w*|not (improving|progressing|getting better|moving)|no (progress|improvement)|same (score|level|results?)|levell?ed off|flat(lined)?|hit a wall)\b/i],
  ['tired', /\b(tired|exhausted|stressed|frustrated|bored|sleepy|overwhelmed|annoyed|fatigued?|can'?t focus)\b/i],
  ['goal', /\b(goals?|target|objective|aim for)\b/i],
  ['plan', /\b(plan|today|what should i (do|train|practi[cs]e)|what next|schedule|recommend\w*)\b/i],
  ['tips', /\b(tips?|strateg\w*|how (can|do) i (improve|get better)|improve|better at|advice|tricks?)\b/i],
  ['progress', /\b(progress\w*|improv\w*|trend|history|getting better|over time|compared to|since|drop(ped)?|declin\w*|went down|worse)\b/i],
  ['overview', /\b(how am i doing|overview|summary|my profile|my scores?|strengths?|weak\w*)\b/i],
  ['help', /\b(help|what can you do|commands)\b/i],
  ['thanks', /\b(thanks|thank you|merci|cheers|great)\b/i],
  ['greeting', /^\s*(hi|hello|hey|salut|bonjour|salam|good (morning|afternoon|evening))\b/i],
];

export function detectDimension(text: string): DimensionId | undefined {
  const t = text.toLowerCase();
  let best: { id: DimensionId; len: number } | undefined;
  for (const d of DIMENSIONS) {
    for (const s of [d.name.toLowerCase(), d.short.toLowerCase(), d.task.name.toLowerCase(), ...d.synonyms]) {
      if (new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(t) && (!best || s.length > best.len)) best = { id: d.id, len: s.length };
    }
  }
  return best?.id;
}

export function detectIntent(text: string): { intent: Intent; dimension?: DimensionId; reason?: DisputeReason | null } {
  const dimension = detectDimension(text);
  if (isDistress(text)) return { intent: 'distress' };
  if (isClinicalQuery(text)) return { intent: 'clinical', dimension };
  const pushback = detectPushback(text);
  if (pushback.pushback) return { intent: 'pushback', dimension, reason: pushback.reason };
  for (const [intent, re] of RULES) if (re.test(text)) return { intent, dimension };
  if (dimension) return { intent: 'dimension', dimension };
  return { intent: 'unknown' };
}

const r0 = (x: number) => Math.round(x);
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
let evc = 0;
const ev = (label: string, value: string, numbers: number[] = []): Evidence => ({ id: `c${++evc}`, label, value, numbers });

function profileEvidence(p: DimensionProfile): Evidence {
  const d = getDimension(p.id);
  return p.unmeasured
    ? ev(d.short, 'not measured yet')
    : ev(d.short, `${r0(p.summary.score)} % (80 % interval ${r0(p.summary.lo)}–${r0(p.summary.hi)}, ${p.summary.confidence} confidence)`, [
        r0(p.summary.score),
        r0(p.summary.lo),
        r0(p.summary.hi),
      ]);
}

function startAction(dim: DimensionId, ctx: CoachContext): CoachAction {
  const d = getDimension(dim);
  const p = ctx.profile.find((x) => x.id === dim);
  const mode = !p || p.unmeasured || p.summary.confidence === 'low' ? 'assessment' : 'training';
  return { kind: 'start_session', taskId: d.task.id, mode, label: `Start ${d.task.name}${mode === 'assessment' ? ' check-in' : ''}` };
}

function focusDimension(ctx: CoachContext): DimensionId | undefined {
  return ctx.plan?.items[0]?.dimension ?? ctx.profile.filter((p) => !p.unmeasured).sort((a, b) => a.summary.score - b.summary.score)[0]?.id;
}

type Draft = Omit<CoachMessage, 'id' | 'role' | 'at' | 'source' | 'insightIds'> & { insightIds?: string[] };

const WORD_NUM: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/** Horizon of a forecast question in days ("next month" → 30); null when none is stated. */
export function parseHorizonDays(text: string): number | null {
  const t = text.toLowerCase();
  if (/\btomorrow\b/.test(t)) return 1;
  if (/\b(next|in a|in one|one) week\b/.test(t)) return 7;
  if (/\b(next|in a|in one|one) month\b|\ba month from now\b/.test(t)) return 30;
  if (/\b(next|in a|in one|one) year\b/.test(t)) return 365;
  const m = t.match(/\bin (\d+|a|one|two|three|four|five|six) (day|week|month|year)s?\b/);
  if (!m) return null;
  const n = WORD_NUM[m[1]] ?? Number(m[1]);
  return n * { day: 1, week: 7, month: 30, year: 365 }[m[2] as 'day' | 'week' | 'month' | 'year'];
}

const horizonLabel = (days: number) => (days === 7 ? 'in a week' : days === 30 ? 'in about a month (30 days)' : days === 28 ? 'in four weeks' : days === 1 ? 'tomorrow' : `in ${days} days`);
/** Furthest horizon the coach will forecast; beyond it the model has nothing honest to say. */
export const MAX_FORECAST_DAYS = 90;

function build(intent: Intent, dimension: DimensionId | undefined, ctx: CoachContext, text = ''): Draft {
  const measured = ctx.profile.filter((p) => !p.unmeasured);
  switch (intent) {
    case 'greeting': {
      const top = ctx.insights[0];
      return {
        text: `Hello${ctx.name ? ` ${ctx.name}` : ''}! ${top ? narrateInsight(top) : 'Ready when you are — the baseline check-in takes about 12 minutes.'} What would you like to look at?`,
        evidence: top?.evidence ?? [],
        insightIds: top ? [top.id] : [],
        confidence: top?.confidence ?? 'low',
        suggestions: ['How am I doing?', "What's my plan today?", 'Give me a memory tip'],
      };
    }
    case 'thanks':
      return { text: "You're welcome. Small, regular sessions are what move the needle — see you at the next one.", evidence: [], confidence: 'high', suggestions: ["What's my plan today?"] };
    case 'help':
      return {
        text:
          'I can explain your profile and how sure it is, walk you through today’s plan and why it was chosen, suggest strategies for any area, show your progress and a cautious projection, help you set goals, and explain how your data is handled. I always show the evidence behind what I say — tap "Why?" on any answer.',
        evidence: [],
        confidence: 'high',
        suggestions: ['How am I doing?', 'Why is my profile uncertain?', 'Help me set a goal', 'How is my data used?'],
      };
    case 'overview': {
      if (!measured.length)
        return {
          text: 'Your Brain Twin is still empty. The baseline check-in (about 12 minutes, six short activities) gives a first, deliberately cautious picture.',
          evidence: [],
          confidence: 'low',
          action: { kind: 'open', route: '/assess', label: 'Start the baseline' },
        };
      const sorted = [...measured].sort((a, b) => b.summary.score - a.summary.score);
      const best = sorted[0];
      const focus = sorted.at(-1)!;
      const lines = sorted.map((p) => `${getDimension(p.id).short} ${r0(p.summary.score)} % (${r0(p.summary.lo)}–${r0(p.summary.hi)})`).join(', ');
      const unsure = ctx.profile.filter((p) => p.unmeasured || p.summary.confidence === 'low').length;
      return {
        text:
          `Here's your current profile: ${lines}. Your relative strength is ${getDimension(best.id).short}; the most room to grow is in ${getDimension(focus.id).short}. ` +
          (unsure ? `${unsure} area${unsure > 1 ? 's are' : ' is'} still uncertain, so treat those numbers as rough. ` : '') +
          'These are skill estimates on these specific exercises — they change with practice, rest and time of day.',
        evidence: ctx.profile.map(profileEvidence),
        confidence: unsure > 2 ? 'low' : 'moderate',
        suggestions: [`Tips for ${getDimension(focus.id).short}`, 'Why is my profile uncertain?', 'Show my progress'],
      };
    }
    case 'dimension': {
      const dim = dimension ?? focusDimension(ctx);
      if (!dim) return build('overview', undefined, ctx, text);
      const d = getDimension(dim);
      const p = ctx.profile.find((x) => x.id === dim)!;
      const related = ctx.insights.find((i) => i.dimension === dim);
      const sentence = p.unmeasured
        ? `${d.name} hasn't been measured yet.`
        : `Your ${d.name} estimate is ${r0(p.summary.score)} % (80 % interval ${r0(p.summary.lo)}–${r0(p.summary.hi)}, ${p.summary.confidence} confidence), from ${p.state.nSessions} session${p.state.nSessions === 1 ? '' : 's'}.`;
      return {
        text: `${d.name} is ${d.definition.charAt(0).toLowerCase()}${d.definition.slice(1)} ${sentence} ${related ? narrateInsight(related) : ''} ${d.notThis}`.replace(/\s+/g, ' ').trim(),
        evidence: [profileEvidence(p), ...(related?.evidence ?? [])],
        insightIds: related ? [related.id] : [],
        confidence: p.unmeasured ? 'low' : p.summary.confidence,
        action: startAction(dim, ctx),
        suggestions: [`Tips for ${d.short}`, `Will my ${d.short.toLowerCase()} improve?`],
      };
    }
    case 'uncertainty': {
      const dim = dimension;
      const p = dim ? ctx.profile.find((x) => x.id === dim) : [...ctx.profile].sort((a, b) => b.summary.hi - b.summary.lo - (a.summary.hi - a.summary.lo))[0];
      if (!p) return build('help', undefined, ctx, text);
      const d = getDimension(p.id);
      const width = p.summary.hi - p.summary.lo;
      const reasons: string[] = [];
      if (p.unmeasured) reasons.push('it has not been measured yet, so it is just the starting assumption');
      else {
        if (p.state.nTrials < 40) reasons.push(`it rests on only ${p.state.nTrials} trials`);
        if ((p.daysSinceUpdate ?? 0) > 5) reasons.push(`the last session was ${r0(p.daysSinceUpdate!)} days ago, and the twin widens the interval when a skill isn't observed`);
        if (!reasons.length) reasons.push('responses naturally vary from trial to trial');
      }
      return {
        text:
          `Every score comes with an 80 % interval: the range where your true level most likely sits. For ${d.short} it is ${r0(p.summary.lo)}–${r0(p.summary.hi)} (${r0(width)} pts wide) because ${reasons.join(' and ')}. ` +
          'Each extra session narrows it. I deliberately show this range instead of a single confident number.',
        evidence: [profileEvidence(p), ev('Trials so far', `${p.state.nTrials}`, [p.state.nTrials])],
        confidence: 'high',
        action: startAction(p.id, ctx),
      };
    }
    case 'plan': {
      if (!ctx.plan || !ctx.plan.items.length)
        return { text: 'No plan yet — complete the baseline check-in and I will build one around your profile and goals.', evidence: [], confidence: 'low', action: { kind: 'open', route: '/assess', label: 'Start the baseline' } };
      const items = ctx.plan.items.map((i, k) => `${k + 1}) ${getDimension(i.dimension).short} ${i.mode === 'assessment' ? 'check-in' : `training from level ${i.level}`} (~${i.minutes} min) — ${i.reasons[0]?.text.toLowerCase()}`);
      const first = ctx.plan.items.find((i) => !i.done) ?? ctx.plan.items[0];
      return {
        text: `Today's plan: ${items.join('; ')}. Each item is picked by a transparent score that weighs room to grow, uncertainty, your goals and spacing. You can swap or skip anything.`,
        evidence: ctx.plan.items.flatMap((i) => i.reasons.slice(0, 2).map((r) => ev(`${getDimension(i.dimension).short}: ${r.factor}`, `${r.text} (+${r.contribution.toFixed(2)})`, [Number(r.contribution.toFixed(2))]))),
        confidence: 'high',
        action: { kind: 'start_session', taskId: first.taskId, mode: first.mode, label: `Start ${getDimension(first.dimension).task.name}` },
      };
    }
    case 'goal': {
      const active = ctx.goals.filter((g) => !g.goal.archived && !g.goal.achievedAt);
      if (active.length) {
        const parts = active.map((g) => {
          if (g.goal.kind === 'habit') return `practise ${g.goal.target} days a week (this week: ${g.current ?? 0})`;
          const d = getDimension(g.goal.dimension!);
          const prob = g.probability === null ? 'not enough history for a projection yet' : `the model gives roughly a ${r0(g.probability * 100)} % chance if you keep practising — an estimate, not a promise`;
          return `${d.short} to ${g.goal.target} % by ${fmtDate(g.goal.deadline)} (now ${g.current === null ? '—' : r0(g.current)} %; ${prob})`;
        });
        return {
          text: `Your goals: ${parts.join('; ')}.`,
          evidence: active.filter((g) => g.probability !== null).map((g) => ev('Goal probability', `${r0(g.probability! * 100)} %`, [r0(g.probability! * 100)])),
          confidence: 'moderate',
          action: { kind: 'open', route: '/goals', label: 'Open goals' },
        };
      }
      const dim = dimension ?? focusDimension(ctx);
      if (!dim) return { text: 'Once your baseline is done, I can suggest a realistic first goal.', evidence: [], confidence: 'low' };
      const p = ctx.profile.find((x) => x.id === dim)!;
      const target = Math.min(95, r0(p.summary.score + 8));
      return {
        text: `A realistic first goal: ${getDimension(dim).short} from ${r0(p.summary.score)} % to ${target} % within 3 weeks, practising 3–4 times a week. You can accept it, change the numbers, or write your own — goals you set yourself tend to stick better.`,
        evidence: [profileEvidence(p)],
        confidence: 'moderate',
        action: { kind: 'create_goal', dimension: dim, target, deadlineDays: 21, label: `Set goal: ${getDimension(dim).short} ${target} %` },
      };
    }
    case 'tips': {
      const dim = dimension ?? focusDimension(ctx);
      if (!dim) return build('help', undefined, ctx, text);
      const d = getDimension(dim);
      const [a, b] = d.strategies;
      return {
        text: `Two strategies for ${d.short}: (1) ${a.title} — ${a.detail} (2) ${b.title} — ${b.detail} And one for real life: ${d.missions[0]}`,
        evidence: d.strategies.slice(0, 2).filter((s) => s.source).map((s) => ev('Source', s.source!)),
        confidence: 'moderate',
        action: startAction(dim, ctx),
        suggestions: [`Why does ${d.short.toLowerCase()} matter?`],
      };
    }
    case 'progress': {
      const trends = ctx.insights.filter((i) => (i.kind === 'improvement' || i.kind === 'decline') && (!dimension || i.dimension === dimension));
      if (!trends.length)
        return {
          text: dimension
            ? `No clear change in ${getDimension(dimension).short} yet — either it is stable or there isn't enough history to separate a trend from normal day-to-day variation.`
            : 'No clear trends yet. With a few more sessions spread over different days, I can separate real progress from day-to-day noise.',
          evidence: [],
          confidence: 'low',
          action: { kind: 'open', route: '/twin', label: 'Open Brain Twin history' },
        };
      return {
        text: trends.slice(0, 3).map(narrateInsight).join(' '),
        evidence: trends.slice(0, 3).flatMap((t) => t.evidence),
        insightIds: trends.slice(0, 3).map((t) => t.id),
        confidence: trends[0].confidence,
        action: { kind: 'open', route: '/twin', label: 'See progress curves' },
      };
    }
    case 'projection': {
      const asked = parseHorizonDays(text);
      const days = asked ?? 28;
      const exact = /\b(exact\w*|precise\w*|for sure|guarantee\w*|certain\w*|definitely)\b/i.test(text);
      const overall = !dimension;
      const head = exact
        ? "I can't tell you exactly — and an honest system shouldn't pretend it can."
        : "Here's what the model can say — as ranges, not promises.";
      const noSingle = overall
        ? " There is also no single 'cognitive score' in CogniTwin: you have separate skill estimates, and averaging them would hide exactly what matters."
        : '';
      if (days > MAX_FORECAST_DAYS) {
        return {
          text: `${head}${noSingle} ${days >= 365 ? 'A year' : `${days} days`} ahead is too far for any honest forecast: practice, sleep, stress and life change too much. I only project up to ${MAX_FORECAST_DAYS} days, always as an 80 % range. Ask me about the next month instead.`,
          evidence: [ev('Maximum forecast horizon', `${MAX_FORECAST_DAYS} days`, [MAX_FORECAST_DAYS])],
          confidence: 'high',
          suggestions: ['What could my memory be next month?', 'How sure are these projections?'],
        };
      }
      const dims = dimension ? [dimension] : ctx.profile.filter((p) => !p.unmeasured).map((p) => p.id);
      const lines: string[] = [];
      const evidence: Evidence[] = [];
      const missing: string[] = [];
      for (const dim of dims) {
        const d = getDimension(dim);
        const p = ctx.profile.find((x) => x.id === dim);
        const proj = ctx.projectAt?.(dim, days) ?? (days === 28 ? ctx.projections[dim] : null);
        if (!proj || !p || p.unmeasured) {
          missing.push(d.short);
          continue;
        }
        const end = proj.points.at(-1)!;
        const up = r0(100 * (1 - normCdf((p.belief.mean - proj.horizon.mean) / proj.horizon.sd)));
        lines.push(`${d.short} most likely ${r0(end.lo80)}–${r0(end.hi80)} % (central ${r0(end.mid)} %, about ${up} % chance of beating today's ${r0(p.summary.score)} %)`);
        evidence.push(
          ev(`${d.short}: 80 % range ${horizonLabel(days)}`, `${r0(end.lo80)}–${r0(end.hi80)} % (central ${r0(end.mid)} %)`, [r0(end.lo80), r0(end.hi80), r0(end.mid)]),
          ev(`${d.short}: chance of being above today`, `${up} % (today ${r0(p.summary.score)} %)`, [up, r0(p.summary.score)]),
        );
      }
      if (!lines.length) {
        const d = dimension ? getDimension(dimension) : null;
        return {
          text: `${head}${noSingle} I can't project ${d ? d.short : 'anything'} yet: a projection needs at least 3 sessions spread over a few days. I'd rather say "unknown" than guess.`,
          evidence: [],
          confidence: 'low',
          action: d ? startAction(d.id, ctx) : undefined,
        };
      }
      evidence.push(ev('Projection calibration (simulation)', '80 % bands contained the true later level 89 % of the time', [80, 89]), ev('Horizon', `${days} days`, [days]));
      return {
        text:
          `${head}${noSingle} If you keep practising at your current pace, here are the 80 % ranges ${horizonLabel(days)} — ${lines.join('; ')}.` +
          (missing.length ? ` No forecast yet for ${missing.join(', ')} — not enough history.` : '') +
          ' Each range is where the result lands 8 times out of 10 in the model — so roughly 1 time in 10 it falls outside. Sleep, stress and how you practise all shift it.',
        evidence,
        confidence: 'low',
        action: { kind: 'open', route: dimension ? `/twin?dim=${dimension}` : '/twin', label: 'See the projection fans' },
        suggestions: ['How sure are these projections?', 'What would improve my odds?'],
      };
    }
    case 'why_plan': {
      if (!ctx.plan || !ctx.plan.items.length) return build('plan', dimension, ctx, text);
      if (!ctx.twin || !ctx.sessions || !ctx.prefs) return build('plan', dimension, ctx, text);
      const target = dimension ?? (ctx.plan.items.find((i) => !i.done) ?? ctx.plan.items[0]).dimension;
      const x = explainChoice(target, ctx.plan, { twin: ctx.twin, sessions: ctx.sessions, goals: ctx.goals.map((g) => g.goal), prefs: ctx.prefs, now: ctx.now });
      const d = getDimension(target);
      const facts = x.facts.slice(0, 3);
      const numbered = facts.map((f, k) => `(${k + 1}) ${f.text}`).join('; ');
      const positive = x.reasons.filter((r) => r.contribution > 0).slice(0, 3);
      const top = positive.map((r) => `${FACTOR_NAME[r.factor]} +${r.contribution.toFixed(2)}`).join(', ');
      const runner = x.runnerUp ? getDimension(x.runnerUp.dimension).short : null;
      const evidence = [
        ...(x.item ? [ev('Planned activity', `${d.task.name} · ${formatPhrase(x.item)} · about ${x.item.minutes} min`, [x.item.level, x.item.minutes])] : []),
        ...facts.map((f) => f.evidence),
        ev('Planner utility', `${x.utility.toFixed(2)} (rank ${x.rank} of ${x.of})`, [x.utility, x.rank, x.of]),
        ...(x.runnerUp && x.rank === 1 ? [ev('Next highest', `${runner} ${x.runnerUp.utility.toFixed(2)}`, [x.runnerUp.utility])] : []),
        ...positive.map((r) => ev(`Factor · ${FACTOR_NAME[r.factor]}`, `${r.text} (+${r.contribution.toFixed(2)})`, [Number(r.contribution.toFixed(2))])),
      ];
      const charts = [...new Set(facts.map((f) => f.chart))];
      const text2 = x.inPlan
        ? `I assigned ${d.task.name} (${d.short}, ${formatPhrase(x.item!)}, about ${x.item!.minutes} min) because of what your Brain Twin shows: ${numbered || 'it has not been measured yet, so a first check-in adds the most information'}. ` +
          `In planner terms it scored a utility of ${x.utility.toFixed(2)} — ${x.rank === 1 ? `the highest of your ${x.of} areas today${runner ? ` (next: ${runner} at ${x.runnerUp!.utility.toFixed(2)})` : ''}` : `number ${x.rank} of ${x.of}`}${top ? `; top factors: ${top}` : ''}. ` +
          (x.item!.formatNote ? `${x.item!.formatNote} ` : '') +
          'It is a suggestion — you can swap it in the plan.'
        : `${d.short} isn't in today's plan: it scored ${x.utility.toFixed(2)}, number ${x.rank} of ${x.of}${x.cutoff !== undefined ? `, below the lowest planned item (${x.cutoff.toFixed(2)})` : ''}. ` +
          `What the data shows: ${numbered || 'nothing that makes it urgent today'}. You can still start it any time.`;
      return {
        text: text2,
        evidence,
        confidence: 'high',
        action: { kind: 'open', route: facts[0]?.route ?? `/twin?dim=${target}`, label: charts[0] ? `Open the ${charts[0] === 'session_log' ? 'session log' : charts[0] === 'weekly_heatmap' ? 'weekly heatmap' : charts[0] === 'radar' ? 'radar' : charts[0] === 'calendar' ? 'practice calendar' : charts[0] === 'goal' ? 'goals' : 'progress curve'}` : 'Open the Brain Twin' },
        suggestions: [...(runner && runner !== d.short ? [`Why not ${runner}?`] : []), `Show my ${d.short.toLowerCase()} progress`, 'How is the plan calculated?'],
      };
    }
    case 'plateau': {
      const ins = ctx.insights.find((i) => i.kind === 'plateau' && (!dimension || i.dimension === dimension));
      const dim = ins?.dimension ?? dimension ?? focusDimension(ctx);
      if (!dim) return build('help', undefined, ctx, text);
      const d = getDimension(dim);
      const rule = `I call it a plateau when the estimate stays flat over ${PLATEAU_WINDOW} sessions (spread ≤ ${PLATEAU_MAX_RANGE} pts, trend within ±${PLATEAU_MAX_SLOPE} pt per session).`;
      if (!ins) {
        const p = ctx.profile.find((x) => x.id === dim);
        return {
          text: `I don't see a plateau in ${d.short} right now${p && !p.unmeasured ? ` (it is at ${r0(p.summary.score)} %, from ${p.state.nSessions} session${p.state.nSessions === 1 ? '' : 's'})` : ''}. ${rule} When that happens I change the format of practice instead of repeating the same exercise.`,
          evidence: p && !p.unmeasured ? [profileEvidence(p)] : [],
          confidence: 'moderate',
          action: startAction(dim, ctx),
        };
      }
      const format = ctx.sessions ? nextFormat(ctx.sessions, dim) : 'stretch';
      const f = TRAINING_FORMATS[format];
      return {
        text: `${narrateInsight(ins)} ${rule} The ${f.name} format: ${f.description.charAt(0).toLowerCase()}${f.description.slice(1)} Why it can help: ${f.science}`,
        evidence: ins.evidence,
        insightIds: [ins.id],
        confidence: ins.confidence,
        action: { kind: 'start_session', taskId: d.task.id, mode: 'training', format, label: `Start ${d.task.name} · ${f.name}` },
        suggestions: [`Tips for ${d.short}`, 'Why did you assign me this exercise?'],
      };
    }
    case 'pushback':
      return {
        text:
          "Fair challenge — pushing back on me is exactly the right instinct, and I'd rather revise than defend a number. " +
          'What got in the way: were you distracted, interrupted, tired, or was something off with your device? Tell me and I will mark that session as uncertain instead of letting it weigh on your profile.',
        evidence: [],
        confidence: 'high',
        suggestions: ['I was distracted by noise during the session', 'I was interrupted during the session', 'I was tired during the session'],
      };
    case 'tired':
      return {
        text: "Thanks for telling me. Practice works best when you're reasonably fresh — tired practice mostly measures tiredness. A short break or calling it a day are both good choices. If you'd still like to train, I'll switch you to the gentle challenge level.",
        evidence: [],
        confidence: 'high',
        action: { kind: 'take_break', minutes: 5, label: 'Take a 5-minute break' },
      };
    case 'privacy':
      return {
        text:
          'Your history is stored in this browser. Optional AI narration sends aggregated scores, evidence, your current message and up to six filtered chat messages to Anthropic. Profile nicknames, raw trials and collected camera measurements are excluded; avoid personal details in free text. Browser voice services may process text or audio externally. ' +
          'Camera and voice are off by default and processed on-device when enabled. You choose the retention period, can export everything as a file, and can delete it all with one click.',
        evidence: [],
        confidence: 'high',
        action: { kind: 'open', route: '/privacy', label: 'Open privacy & data' },
      };
    case 'collab': {
      const c = ctx.collab;
      const low = [...c.subs].sort((a, b) => a.score - b.score)[0];
      return {
        text:
          `Your AI Collaboration Score is ${r0(c.total)} / 100 (80 % interval ${r0(c.lo)}–${r0(c.hi)}). It measures how you work with me, not how "good" you are: ` +
          `${c.subs.map((s) => `${COLLAB_LABEL[s.dim]} ${r0(s.score)}`).join(', ')}. ` +
          `The area with most room is ${COLLAB_LABEL[low.dim].toLowerCase()} — ${COLLAB_DESCRIPTION[low.dim].charAt(0).toLowerCase()}${COLLAB_DESCRIPTION[low.dim].slice(1)}`,
        evidence: c.subs.map((s) => ev(COLLAB_LABEL[s.dim], `${r0(s.score)} (weight ${r0(c.weights[s.dim] * 100)} %)`, [r0(s.score), r0(c.weights[s.dim] * 100)])),
        confidence: c.confidence,
        action: { kind: 'open', route: '/collab', label: 'See the full breakdown' },
      };
    }
    case 'methods':
      return {
        text:
          'Each exercise adapts its difficulty trial by trial. Every response updates a Bayesian model of your skill on that dimension, which gives both an estimate and an uncertainty. ' +
          'The percentage is how much of the exercise’s difficulty ladder you are expected to master — it is compared with the exercise, not with other people. ' +
          'Your Brain Twin keeps every snapshot, so you can replay how your profile evolved.',
        evidence: [],
        confidence: 'high',
        action: { kind: 'open', route: '/methods', label: 'Read the methods' },
      };
    case 'clinical':
    case 'distress':
      return { text: SAFE_REPLIES[intent], evidence: [], confidence: 'high' };
    case 'unknown':
    default:
      return {
        text: "I'm not sure I understood that. I can talk about your profile, today's plan, strategies, goals, progress, or how your data is handled.",
        evidence: [],
        confidence: 'high',
        suggestions: ['How am I doing?', "What's my plan today?", 'Give me a tip', 'How is my data used?'],
      };
  }
}

/** Template answer, already safety-checked. */
export function templateReply(text: string, ctx: CoachContext): CoachMessage {
  const { intent, dimension } = detectIntent(text);
  const draft = build(intent, dimension, ctx, text);
  const isSafe = intent === 'clinical' || intent === 'distress';
  const check = checkMessage(draft.text);
  return {
    id: uid('cm_'),
    role: 'coach',
    at: Date.now(),
    source: isSafe ? 'safe-reply' : 'template',
    intent,
    insightIds: draft.insightIds ?? [],
    ...draft,
    safety: { passed: isSafe || check.ok, checks: isSafe ? ['Fixed, reviewed safety reply'] : check.checks, intercepted: [], fallbackUsed: false },
  };
}

/**
 * Reply to a pushback once the dispute has been applied (or when there is nothing to dispute).
 * Deterministic on purpose: it reports the exact before/after numbers.
 */
export function pushbackReply(outcome: DisputeOutcome | null, reason: DisputeReason | null, opts: { planNote?: string } = {}): CoachMessage {
  const base = { id: uid('cm_'), role: 'coach' as const, at: Date.now(), source: 'template' as const, intent: 'pushback', insightIds: [] };
  if (!outcome) {
    const text = reason
      ? `Thanks for the context (${DISPUTE_LABEL[reason]}) — that's exactly what the data can't see. I couldn't find a session from the last 7 days to revise; you can dispute an older one from the Brain Twin session log.`
      : "Fair challenge — I'd rather revise than defend a number. What got in the way: were you distracted, interrupted, tired, or was something off with your device?";
    return { ...base, text, evidence: [], confidence: 'high', suggestions: reason ? undefined : ['I was distracted by noise during the session', 'I was interrupted during the session', 'I was tired during the session'], safety: { passed: true, checks: ['Non-clinical language', 'No guarantees about the future'], intercepted: [], fallbackUsed: false } };
  }
  const o = outcome;
  const d = getDimension(o.dimension);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const sub = (c: CollabScore, k: 'verification' | 'iteration') => r1(c.subs.find((x) => x.dim === k)!.score);
  const lead = o.alreadyDisputed ? 'Understood.' : "Thank you — that's context the data can't see, and pushing back on me is the right move.";
  const text = `${lead} ${describeOutcome(o).text}${opts.planNote ? ` ${opts.planNote}` : ''} You can undo the dispute in the Brain Twin session log.`;
  const evidence: Evidence[] = o.alreadyDisputed
    ? [ev(`${d.short} estimate`, `${r0(o.after.score)} % (${r0(o.after.lo)}–${r0(o.after.hi)})`, [r0(o.after.score), r0(o.after.lo), r0(o.after.hi)])]
    : [
        ev(`${d.short} before the dispute`, `${r0(o.before.score)} % (${r0(o.before.lo)}–${r0(o.before.hi)})`, [r0(o.before.score), r0(o.before.lo), r0(o.before.hi)]),
        ev(`${d.short} after the dispute`, `${r0(o.after.score)} % (${r0(o.after.lo)}–${r0(o.after.hi)})`, [r0(o.after.score), r0(o.after.lo), r0(o.after.hi)]),
        ev('Session weight', `${Math.round(o.weightBefore * 100)} % → ${Math.round(o.weightAfter * 100)} %`, [Math.round(o.weightBefore * 100), Math.round(o.weightAfter * 100)]),
        ev('AI Collaboration Score', `${r1(o.acsBefore.total).toFixed(1)} → ${r1(o.acsAfter.total).toFixed(1)}`, [r1(o.acsBefore.total), r1(o.acsAfter.total)]),
        ev('Critical verification', `${sub(o.acsBefore, 'verification').toFixed(1)} → ${sub(o.acsAfter, 'verification').toFixed(1)}`, [sub(o.acsBefore, 'verification'), sub(o.acsAfter, 'verification')]),
        ev('Iteration', `${sub(o.acsBefore, 'iteration').toFixed(1)} → ${sub(o.acsAfter, 'iteration').toFixed(1)}`, [sub(o.acsBefore, 'iteration'), sub(o.acsAfter, 'iteration')]),
      ];
  return {
    ...base,
    text,
    evidence,
    confidence: 'high',
    action: { kind: 'open', route: `/twin?dim=${o.dimension}#session-log`, label: 'Review it in the session log' },
    suggestions: [`Why is my ${d.short.toLowerCase()} uncertain?`, 'Explain my collaboration score'],
    safety: { passed: true, checks: ['Non-clinical language', 'No guarantees about the future', 'Numbers computed by the engine'], intercepted: [], fallbackUsed: false },
  };
}
