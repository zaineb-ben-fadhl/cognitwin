/**
 * Template-mode conversational coach: transparent intent rules + grounded answer builders.
 * The LLM mode (server/coach.ts) receives the same context and is held to the same guardrails;
 * this module is also its fallback whenever the LLM is unavailable or fails a safety check.
 */
import { COLLAB_DESCRIPTION, COLLAB_LABEL, type CollabScore } from '../collaboration';
import { DIMENSIONS, getDimension } from '../dimensions';
import type { Projection } from '../projection';
import { uid } from '../rng';
import type { DimensionProfile } from '../twin';
import type { DailyPlan, DimensionId, Evidence, Goal, Insight, SessionRecord } from '../types';
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
}

export type Intent =
  | 'distress'
  | 'clinical'
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
  ['collab', /\b(collaboration|collab|acs|ai score|working with (the )?ai)\b/i],
  ['privacy', /\b(privacy|my data|delete|retention|camera|microphone|stored?|consent|gdpr|who can see)\b/i],
  ['methods', /\b(how (does|do) (it|this|you|the score|scoring) work|algorithm|model|irt|bayes\w*|methodology|how (is|are) (my )?(score|scores) (calculated|computed))\b/i],
  ['uncertainty', /\b(uncertain\w*|confidence|interval|how sure|accurate|reliable|plus or minus|error bars?|range)\b/i],
  ['projection', /\b(predict\w*|projection|forecast|future|will i|in (a|one|two|three|\d+) (weeks?|months?)|expect to)\b/i],
  ['tired', /\b(tired|exhausted|stressed|frustrated|bored|sleepy|overwhelmed|annoyed|fatigued?|can'?t focus)\b/i],
  ['goal', /\b(goals?|target|objective|aim for)\b/i],
  ['plan', /\b(plan|today|what should i (do|train|practi[cs]e)|what next|schedule|recommend\w*)\b/i],
  ['tips', /\b(tips?|strateg\w*|how (can|do) i (improve|get better)|improve|better at|advice|tricks?)\b/i],
  ['progress', /\b(progress\w*|improv\w*|trend|history|getting better|over time|compared to|since)\b/i],
  ['overview', /\b(how am i doing|overview|summary|my profile|my scores?|strengths?|weak\w*)\b/i],
  ['help', /\b(help|what can you do|commands)\b/i],
  ['thanks', /\b(thanks|thank you|merci|cheers|great)\b/i],
  ['greeting', /^\s*(hi|hello|hey|salut|bonjour|salam|good (morning|afternoon|evening))\b/i],
];

export function detectDimension(text: string): DimensionId | undefined {
  const t = text.toLowerCase();
  let best: { id: DimensionId; len: number } | undefined;
  for (const d of DIMENSIONS) {
    for (const s of [d.name.toLowerCase(), d.short.toLowerCase(), ...d.synonyms]) {
      if (new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(t) && (!best || s.length > best.len)) best = { id: d.id, len: s.length };
    }
  }
  return best?.id;
}

export function detectIntent(text: string): { intent: Intent; dimension?: DimensionId } {
  const dimension = detectDimension(text);
  if (isDistress(text)) return { intent: 'distress' };
  if (isClinicalQuery(text)) return { intent: 'clinical', dimension };
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

function build(intent: Intent, dimension: DimensionId | undefined, ctx: CoachContext): Draft {
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
      if (!dim) return build('overview', undefined, ctx);
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
      if (!p) return build('help', undefined, ctx);
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
      if (!dim) return build('help', undefined, ctx);
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
      const dim = dimension ?? focusDimension(ctx);
      if (!dim) return build('help', undefined, ctx);
      const proj = ctx.projections[dim];
      const d = getDimension(dim);
      if (!proj)
        return {
          text: `I can't project ${d.short} yet: a projection needs at least 3 sessions spread over a few days. I'd rather say "unknown" than guess.`,
          evidence: [],
          confidence: 'low',
          action: startAction(dim, ctx),
        };
      const end = proj.points.at(-1)!;
      return {
        text:
          `If you keep practising at your current pace, ${d.short} could be around ${r0(end.mid)} % in four weeks — but the honest range is wide: 80 % interval ${r0(end.lo80)}–${r0(end.hi80)}. ` +
          `This is a model of your own learning curve (based on ${proj.basedOn} sessions), not a prediction of certainty. Sleep, stress and how you practise all shift it.`,
        evidence: [ev('Projected (4 weeks)', `${r0(end.mid)} %`, [r0(end.mid)]), ev('80 % interval', `${r0(end.lo80)}–${r0(end.hi80)}`, [r0(end.lo80), r0(end.hi80)]), ev('Sessions used', `${proj.basedOn}`, [proj.basedOn])],
        confidence: 'low',
        action: { kind: 'open', route: '/twin', label: 'See the projection chart' },
      };
    }
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
  const draft = build(intent, dimension, ctx);
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
