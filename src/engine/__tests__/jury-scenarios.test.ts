/**
 * The six Phase-2 surprise scenarios, as regression tests. Each scenario is played through the
 * real engine on a simulated learner (see scenarios.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  AdaptiveSession,
  DIMENSIONS,
  POPULATION_PRIOR,
  applyDispute,
  assessQuality,
  buildScenario,
  checkMessage,
  computeCollabScore,
  createRng,
  createTwin,
  currentProfile,
  detectAsymmetry,
  detectIntent,
  detectPlateau,
  detectPushback,
  dimensionHistory,
  explainChoice,
  finalizeSession,
  generateDailyPlan,
  isMashedSession,
  liveRapidGuessing,
  makeDispute,
  modelFor,
  nextFormat,
  parseHorizonDays,
  pickDisputedSession,
  profileInsights,
  project,
  pushbackReply,
  rushQuestion,
  sessionFeedback,
  sessionInsights,
  sessionPrior,
  simulateRun,
  taskForDimension,
  templateReply,
  type CoachContext,
  type DemoData,
  type SessionRecord,
  type SimUser,
} from '../index';
import { validateNarrative } from '../coach/narrative';

const NOW = new Date('2026-11-07T10:00:00').getTime();
const DAY = 86_400_000;

function coachContext(d: DemoData, now = NOW): CoachContext {
  const profile = currentProfile(d.twin, now);
  const projectAt = (dim: string, days: number) => {
    const r = project(dimensionHistory(d.twin, dim), modelFor(dim), now, days);
    return r.ok ? r.projection : null;
  };
  return {
    now,
    profile,
    insights: profileInsights(d.twin, d.sessions, now),
    plan: generateDailyPlan(d.twin, d.sessions, d.goals, d.prefs, now),
    goals: d.goals.map((goal) => ({ goal, current: null, probability: null })),
    collab: computeCollabScore(d.events),
    projections: Object.fromEntries(Object.keys(d.twin.dims).map((id) => [id, projectAt(id, 28)])),
    recentSessions: d.sessions.slice(-5),
    llmEnabled: false,
    twin: d.twin,
    sessions: d.sessions,
    prefs: d.prefs,
    projectAt,
  };
}

const allNumbers = (m: { evidence: { numbers: number[]; value: string }[] }) => m.evidence.flatMap((e) => [...e.numbers, ...(e.value.match(/\d+(\.\d+)?/g) ?? []).map(Number)]);

describe('1 · The "Button Masher" (Layer A)', () => {
  const masher = (extra: Partial<SimUser> = {}): SimUser => ({ theta: {}, growth: {}, rtScale: 1, lapseRate: 0, interruptRate: 0, randomResponder: true, ...extra });

  it.each(DIMENSIONS.map((d) => [d.id]))('%s: a mashed check-in is flagged as highly uncertain, not as a collapse in ability', (dim) => {
    const task = taskForDimension(dim);
    const prior = { mean: 0.8, sd: 0.35 };
    const res = simulateRun(task, masher(), { mode: 'assessment', prior, ability: 0.8, rng: createRng(3), startedAt: 0 });
    const record = finalizeSession({ id: 'm', taskId: task.id, mode: 'assessment', startedAt: 0, endedAt: res.endedAt, trials: res.trials, behaviour: res.behaviour, prior, deadlineFactor: 1 });
    expect(isMashedSession(record.quality)).toBe(true);
    expect(record.quality.reliability).toBe('poor');
    // Uncertainty documented explicitly: the posterior is wider than before the session …
    expect(record.after.sd).toBeGreaterThan(prior.sd);
    expect(record.scoreAfter.hi - record.scoreAfter.lo).toBeGreaterThan(record.scoreBefore.hi - record.scoreBefore.lo);
    // … and the estimate does not crash the way naive scoring would.
    expect(prior.mean - record.after.mean).toBeLessThan(0.4);
    // The coach intervenes contextually.
    const insights = sessionInsights(record);
    expect(insights[0].kind).toBe('data_quality');
    expect(sessionFeedback(record, insights).text).toMatch(/distracted, or rushing\?/);
    expect(rushQuestion(record)).toMatch(/Were you distracted, or rushing\?/);
  });

  it('never flags genuine users, including flawless fast ones', () => {
    const rng = createRng(9);
    for (const d of DIMENSIONS) {
      for (const ability of [-1, 0, 1, 3]) {
        const user: SimUser = { theta: {}, growth: {}, rtScale: 1, lapseRate: 0.02, interruptRate: 0 };
        const res = simulateRun(d.task, user, { mode: 'assessment', prior: POPULATION_PRIOR, ability, rng, startedAt: 0 });
        expect(isMashedSession(assessQuality(d.task, res.trials, res.behaviour))).toBe(false);
      }
    }
  });

  it('detects mashing live, within the first few trials, so the coach can ask during the session', () => {
    for (const d of DIMENSIONS) {
      const session = new AdaptiveSession(d.task, { mode: 'assessment', prior: POPULATION_PRIOR });
      const res = simulateRun(d.task, masher(), { mode: 'assessment', prior: POPULATION_PRIOR, ability: 0, rng: createRng(4), startedAt: 0 });
      let firedAt = -1;
      for (const t of res.trials) {
        session.record(t);
        if (firedAt < 0 && liveRapidGuessing(d.task, session.trials)) firedAt = session.trials.length;
      }
      expect(firedAt, d.task.name).toBeGreaterThan(0);
      expect(firedAt, d.task.name).toBeLessThanOrEqual(10);
    }
  });

  it('the masher scenario ends with a flagged, uncertain check-in in the history', () => {
    const d = buildScenario('masher', NOW);
    const last = d.sessions.at(-1)!;
    expect(isMashedSession(last.quality)).toBe(true);
    expect(last.after.sd).toBeGreaterThan(last.before.sd);
  });
});

describe('2 · The Stagnation Plateau (Layer C)', () => {
  const d = buildScenario('plateau', NOW);
  const plateaued = DIMENSIONS.map((x) => x.id).filter((id) => detectPlateau(d.twin, d.sessions, id));

  it('detects a plateau on a learner with flat, average scores', () => {
    expect(plateaued.length).toBeGreaterThan(0);
    for (const id of plateaued) {
      const p = detectPlateau(d.twin, d.sessions, id)!;
      expect(Math.abs(p.slope)).toBeLessThanOrEqual(1);
      expect(p.meanScore).toBeGreaterThan(20);
      expect(p.meanScore).toBeLessThan(80);
    }
  });

  it('changes the format instead of feeding the same exercise, and keeps rotating', () => {
    const plan = generateDailyPlan(d.twin, d.sessions, d.goals, d.prefs, NOW);
    const items = plan.items.filter((i) => plateaued.includes(i.dimension) && i.mode === 'training');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.format).toBeDefined();
      expect(item.format).not.toBe('standard');
      expect(item.reasons.some((r) => r.factor === 'plateau')).toBe(true);
    }
    expect(plan.rationale).toMatch(/break a plateau/);
    // Simulate doing the new format: the next plan for that dimension moves on to another format.
    const dim = items[0].dimension;
    const used = items[0].format!;
    const fake = { ...d.sessions.filter((s) => s.dimension === dim).at(-1)!, id: 'next', endedAt: NOW + 1000, mode: 'training' as const, format: used };
    expect(nextFormat([...d.sessions, fake], dim)).not.toBe(used);
  });

  it('the coach explains the plateau with numbers and proposes the new format', () => {
    const m = templateReply('I feel stuck, my scores are not improving.', coachContext(d));
    expect(m.intent).toBe('plateau');
    expect(m.text).toMatch(/levelled off/);
    expect(m.text).toMatch(/format/);
    expect(m.action?.kind).toBe('start_session');
  });
});

describe('3 · The "Why" Audit (explainability)', () => {
  const d = buildScenario('why', NOW);
  const ctx = coachContext(d);

  it.each([
    'Why did you assign me this specific exercise today?',
    'why this exercise?',
    'Why did you pick Sequence Recall for me?',
    'What is the reason behind this exercise?',
  ])('"%s" is answered from the Brain Twin data', (q) => {
    const m = templateReply(q, ctx);
    expect(m.intent).toBe('why_plan');
    // Cites charts by name …
    expect(m.text).toMatch(/session|progress curve|heatmap|radar|calendar|goal/i);
    expect(m.evidence.some((e) => /^(Session log|Progress curve|Weekly heatmap|Radar|Practice calendar|Goals) ·/.test(e.label))).toBe(true);
    // … with numbers that all come from the evidence (no black box, nothing invented).
    const nums = allNumbers(m);
    const textNums = (m.text.match(/(?<![\w.])\d+(\.\d+)?/g) ?? []).map(Number).filter((n) => ![1, 2, 3].includes(n));
    for (const n of textNums) expect(nums.some((a) => Math.abs(a - n) < 0.006 || Math.round(a) === n), `${n} in “${m.text}”`).toBe(true);
    expect(m.action?.kind).toBe('open');
  });

  it('explains why another area is NOT in the plan', () => {
    const outside = DIMENSIONS.map((x) => x.id).find((id) => !ctx.plan!.items.some((i) => i.dimension === id));
    if (!outside) return;
    const m = templateReply(`Why not ${DIMENSIONS.find((x) => x.id === outside)!.short}?`, ctx);
    expect(m.intent).toBe('why_plan');
    expect(m.text).toMatch(/isn't in today's plan/);
  });

  it('every justification links to the chart it comes from', () => {
    const x = explainChoice(ctx.plan!.items[0].dimension, ctx.plan, { twin: d.twin, sessions: d.sessions, goals: d.goals, prefs: d.prefs, now: NOW });
    expect(x.facts.length).toBeGreaterThan(0);
    for (const f of x.facts) expect(f.route).toMatch(/^\//);
  });
});

describe('4 · The Pushback (AI Collaboration Score)', () => {
  const text = 'I disagree — my score dropped yesterday because I was distracted by noise around me.';

  it('recognises pushback with an environmental reason', () => {
    expect(detectIntent(text).intent).toBe('pushback');
    expect(detectPushback(text).reason).toBe('noise');
    expect(detectPushback("That's not fair, there was construction noise during my memory test").pushback).toBe(true);
    expect(detectPushback('I was interrupted by a phone call during the session').reason).toBe('interruption');
    expect(detectPushback("I'm tired").pushback).toBe(false);
    expect(detectIntent("I'm tired").intent).toBe('tired');
  });

  it('raises the collaboration score and the uncertainty of that assessment instead of defending the profile', () => {
    const d = buildScenario('pushback', NOW);
    const target = pickDisputedSession(d.sessions, NOW)!;
    expect(target.dimension).toBe('memory');
    const res = applyDispute({ twin: d.twin, sessions: d.sessions, events: d.events }, target.id, makeDispute('noise', NOW, 'chat'), 'ev_x')!;
    const o = res.outcome;
    expect(o.after.hi - o.after.lo).toBeGreaterThan(o.before.hi - o.before.lo);
    expect(o.weightAfter).toBeLessThan(o.weightBefore);
    expect(o.acsAfter.total).toBeGreaterThan(o.acsBefore.total);
    const sub = (c: typeof o.acsBefore, k: string) => c.subs.find((s) => s.dim === k)!.score;
    expect(sub(o.acsAfter, 'verification')).toBeGreaterThan(sub(o.acsBefore, 'verification'));
    expect(sub(o.acsAfter, 'iteration')).toBeGreaterThan(sub(o.acsBefore, 'iteration'));
    const reply = pushbackReply(o, 'noise');
    expect(reply.text).toMatch(/disputed/);
    expect(reply.text).toMatch(/Collaboration Score went from/);
    expect(checkMessage(reply.text).ok).toBe(true);
  });

  it('rewards a first pushback visibly on a new profile, and repeated disputes earn less', () => {
    const twin0 = createTwin(NOW - 2 * DAY);
    const task = taskForDimension('memory');
    const prior = sessionPrior(twin0, 'memory', NOW - DAY);
    const run = simulateRun(task, { theta: {}, growth: {}, rtScale: 1, lapseRate: 0, interruptRate: 0 }, { mode: 'assessment', prior, ability: 0, rng: createRng(1), startedAt: NOW - DAY });
    const s: SessionRecord = finalizeSession({ id: 's1', taskId: task.id, mode: 'assessment', startedAt: NOW - DAY, endedAt: run.endedAt, trials: run.trials, behaviour: run.behaviour, prior, deadlineFactor: 1 });
    const state = { twin: twin0, sessions: [s], events: [] };
    const first = applyDispute(state, 's1', makeDispute('distraction', NOW, 'chat'), 'e1')!;
    expect(first.outcome.acsAfter.total - first.outcome.acsBefore.total).toBeGreaterThan(3);
    const credit = (n: number) => computeCollabScore([{ id: 'x', type: 'pushback', at: NOW, data: { reason: 'noise', nth: n } }]).total;
    expect(credit(4)).toBeLessThan(credit(0));
    // Disputing the same session twice gives (almost) nothing more.
    const again = applyDispute({ twin: first.twin, sessions: first.sessions, events: [first.event] }, 's1', makeDispute('distraction', NOW + 1, 'chat'), 'e2')!;
    expect(again.outcome.alreadyDisputed).toBe(true);
    expect(again.outcome.acsAfter.total - again.outcome.acsBefore.total).toBeLessThan(1);
  });
});

describe('5 · The Fortune Teller Trap (Brain Twin certainty)', () => {
  const d = buildScenario('fortune', NOW);
  const ctx = coachContext(d);
  const q = 'What exactly will my cognitive score be next month?';

  it('pivots to probabilistic ranges for the horizon asked, never an exact number', () => {
    expect(detectIntent(q).intent).toBe('projection');
    expect(parseHorizonDays(q)).toBe(30);
    const m = templateReply(q, ctx);
    expect(m.text).toMatch(/can't tell you exactly/);
    expect(m.text).toMatch(/no single 'cognitive score'/);
    expect(m.text).toMatch(/most likely \d+–\d+ %/);
    expect(m.text).toMatch(/chance/);
    expect(m.text).toMatch(/30 days/);
    expect(m.confidence).toBe('low');
    expect(checkMessage(m.text).ok).toBe(true);
  });

  it.each([
    'Your memory score will be 62 % next month.',
    "You'll reach 70 % in two weeks.",
    'Next month you are going to score exactly 64 %.',
    'Your attention will hit 80 percent in 4 weeks.',
    'In a month your memory is 63 %.',
  ])('guardrail blocks certain forecasts: "%s"', (text) => {
    const r = checkMessage(text);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.rule === 'forecast' || v.rule === 'certainty')).toBe(true);
  });

  it('lets hedged forecasts through', () => {
    expect(checkMessage('In a month your memory could be between 55 and 70 % (80 % range).').ok).toBe(true);
    expect(checkMessage('There is about a 60 % chance it is higher next month.').ok).toBe(true);
  });

  it('an LLM draft stating a certain forecast is rejected', () => {
    const source = { text: 'x', confidence: 'low' as const, evidence: [{ id: 'source_1', label: 'Projected', value: '62 %', numbers: [62] }] };
    const v = validateNarrative({ reply: 'Your memory score will be 62 % next month.', evidence_ids: ['source_1'], confidence: 'low', suggestions: [] }, source);
    expect(v.ok).toBe(false);
  });

  it('declines horizons beyond 90 days', () => {
    const m = templateReply('What will my memory score be next year?', ctx);
    expect(m.text).toMatch(/too far/);
  });
});

describe('6 · The Asymmetrical Mind (generalisation)', () => {
  const d = buildScenario('asymmetric', NOW);
  const profile = currentProfile(d.twin, NOW);
  const plan = generateDailyPlan(d.twin, d.sessions, d.goals, d.prefs, NOW);

  it('detects the split with non-overlapping intervals', () => {
    const a = detectAsymmetry(profile)!;
    expect(a.strong).toBe('reasoning');
    expect(a.weak).toBe('attention');
    expect(a.strongInterval[0]).toBeGreaterThan(a.weakInterval[1]);
    expect(profileInsights(d.twin, d.sessions, NOW).some((i) => i.kind === 'asymmetry')).toBe(true);
  });

  it('builds an asymmetric plan: advanced logic + foundational attention, never an averaged level', () => {
    const logic = plan.items.find((i) => i.dimension === 'reasoning')!;
    const attention = plan.items.find((i) => i.dimension === 'attention')!;
    expect(logic).toBeDefined();
    expect(attention).toBeDefined();
    expect(logic.tier).toBe('advanced');
    expect(attention.tier).toBe('foundational');
    expect(logic.level).toBeGreaterThanOrEqual(8);
    expect(attention.level).toBeLessThanOrEqual(2);
    expect(logic.targetSuccess!).toBeLessThan(attention.targetSuccess!);
    expect(plan.rationale).toMatch(/never averaged/);
    // An "average" difficulty would sit in the middle of the ladder for both.
    expect(logic.level - attention.level).toBeGreaterThanOrEqual(6);
  });

  it('the training controller honours each dimension’s own target', () => {
    const p = profile.find((x) => x.id === 'attention')!;
    const s = new AdaptiveSession(taskForDimension('attention'), { mode: 'training', prior: p.belief, targetSuccess: 0.86 });
    expect(s.targetSuccess).toBeCloseTo(0.86, 5);
    expect(s.nextLevel()).toBe(1);
  });
});
