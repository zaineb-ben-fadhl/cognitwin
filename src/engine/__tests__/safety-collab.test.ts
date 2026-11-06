import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACS_WEIGHTS,
  DIMENSIONS,
  assessQuality,
  buildDemoHistory,
  buildLLMContext,
  checkMessage,
  computeCollabScore,
  createRng,
  createVerifyChallenge,
  currentProfile,
  dailyBriefing,
  detectIntent,
  estimateAffect,
  findClinicalTerms,
  isClinicalQuery,
  isDistress,
  narrateInsight,
  profileInsights,
  redactPII,
  sessionFeedback,
  sessionInsights,
  simulateRun,
  taskForDimension,
  templateReply,
  computeCollabScore as acs,
  type AIEvent,
  type BehaviourLog,
  type CoachContext,
  type SimUser,
} from '../index';

const NOW = new Date('2026-10-25T10:00:00').getTime();
const behaviour: BehaviourLog = { focusLosses: 0, hiddenMs: 0, longPauses: 0, hintsUsed: 0, corrections: 0, anticipations: 0, quitEarly: false, input: 'keyboard' };

describe('guardrails', () => {
  it('detects clinical vocabulary', () => {
    expect(findClinicalTerms('This could be a sign of ADHD or a memory deficit.')).toEqual(['adhd', 'deficit']);
    expect(findClinicalTerms('Your memory estimate grew by 6 points.')).toEqual([]);
  });

  it('blocks ungrounded numbers and certainty language', () => {
    const r = checkMessage('You will definitely reach 93 % next week.', { allowedNumbers: [58, 64] });
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.rule).sort()).toEqual(['certainty', 'forecast', 'grounding']);
    expect(checkMessage('Your score is 58 % (interval 51–64).', { allowedNumbers: [58, 51, 64] }).ok).toBe(true);
  });

  it('redacts personal identifiers before any LLM call', () => {
    const r = redactPII('Mail me at amira.b@example.com or +216 22 333 444, CIN 12345678');
    expect(r.text).not.toMatch(/example\.com|22 333 444|12345678/);
    expect(r.found).toEqual(expect.arrayContaining(['email', 'phone number', 'ID number']));
  });

  it('routes clinical questions and distress to fixed safe replies', () => {
    expect(isClinicalQuery('Do I have ADHD?')).toBe(true);
    expect(isClinicalQuery('Could I have dementia because my memory score dropped?')).toBe(true);
    expect(isClinicalQuery('Am I able to add a goal?')).toBe(false);
    expect(isClinicalQuery('Is it normal that my score dropped?')).toBe(false);
    expect(isDistress('sometimes I want to die')).toBe(true);
    expect(detectIntent('Do I have ADHD?').intent).toBe('clinical');
  });
});

describe('affect estimation', () => {
  // Behaviour with no signal at all: alternating success, steady RTs, no interruptions.
  const quiet = Array.from({ length: 12 }, (_, i) => ({ index: i, level: 5, correct: i % 2 === 0, success: i % 2 === 0, rtMs: 600 + (i % 3) * 20, deadlineMs: 1200, t: i * 1500 }));
  const tenseFace = { samples: 60, browTension: 0.8, eyeClosure: 0.5, gazeAway: 0.6, smile: 0 };

  it('never decides from camera cues alone', () => {
    const a = estimateAffect(quiet, behaviour, undefined, tenseFace);
    expect(a.state).toBe('neutral');
    expect(a.cameraCapped).toBe(true);
  });

  it('lets camera cues support a state that non-camera evidence also shows', () => {
    const a = estimateAffect(quiet, behaviour, { energy: 1 }, tenseFace);
    expect(a.state).toBe('fatigued');
    expect(a.sources).toEqual(expect.arrayContaining(['self-report', 'camera']));
  });

  it('detects fatigue from behaviour + self-report', () => {
    const trials = Array.from({ length: 18 }, (_, i) => ({ index: i, level: 5, correct: i < 9, success: i < 9, rtMs: 500 + i * 40, deadlineMs: 2000, t: i * 1500 }));
    const a = estimateAffect(trials, behaviour, { energy: 1 });
    expect(a.state).toBe('fatigued');
    expect(a.sources).toContain('behaviour');
  });
});

describe('data quality', () => {
  it('flags random pressing and down-weights the session', () => {
    const task = taskForDimension('speed');
    const user: SimUser = { theta: {}, growth: {}, rtScale: 1, lapseRate: 0, interruptRate: 0, randomResponder: true };
    const res = simulateRun(task, user, { mode: 'training', prior: { mean: 0, sd: 1 }, ability: 0, rng: createRng(2), startedAt: 0 });
    const q = assessQuality(task, res.trials, res.behaviour);
    // Fast near-chance pressing is caught either as rapid guessing or as random responding.
    expect(q.flags.some((f) => f.kind === 'random_responding' || f.kind === 'rapid_guessing')).toBe(true);
    expect(q.weight).toBeLessThanOrEqual(0.5);
    expect(q.uncertaintyInflation).toBeGreaterThan(0);
  });
});

describe('AI Collaboration Score', () => {
  const ev = (type: AIEvent['type'], data?: AIEvent['data'], at = 0): AIEvent => ({ id: Math.random().toString(), type, at, data });

  it('starts neutral (50) with a wide interval', () => {
    const s = computeCollabScore([]);
    expect(s.total).toBeCloseTo(50, 5);
    expect(s.confidence).toBe('low');
  });

  it('weights are normalised and follow the proposal by default', () => {
    const s = computeCollabScore([]);
    expect(Object.values(s.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(s.weights).toEqual(DEFAULT_ACS_WEIGHTS);
  });

  it('ranks a critical, iterative user above an over-reliant one', () => {
    const critical = [
      ...Array.from({ length: 4 }, () => ev('why_opened')),
      ev('verify_challenge', { found: true }),
      ev('verify_challenge', { found: true }),
      ev('plan_edited'),
      ev('followup'),
      ev('goal_self_set'),
      ev('self_prediction', { predicted: 60, actual: 58 }),
      ev('consent_informed'),
      ev('chat_question', { clarifying: true, specificity: 0.9 }),
    ];
    const overReliant = [
      ...Array.from({ length: 6 }, () => ev('recommendation_response', { response: 'accepted', confidence: 'low', evidenceViewed: false })),
      ev('verify_challenge', { found: false }),
      ev('goal_from_ai'),
      ev('self_prediction', { predicted: 90, actual: 50 }),
      ev('pii_shared'),
    ];
    const a = acs(critical);
    const b = acs(overReliant);
    expect(a.total).toBeGreaterThan(65);
    expect(b.total).toBeLessThan(45);
    expect(a.total - b.total).toBeGreaterThan(25);
    expect(a.hi).toBeGreaterThanOrEqual(a.total);
    expect(a.lo).toBeLessThanOrEqual(a.total);
  });
});

describe('coach output never uses clinical language', () => {
  const demo = buildDemoHistory(NOW, 21);
  const profile = currentProfile(demo.twin, NOW);
  const insights = profileInsights(demo.twin, demo.sessions, NOW);
  const ctx: CoachContext = {
    now: NOW,
    profile,
    insights,
    plan: null,
    goals: [],
    collab: computeCollabScore(demo.events),
    projections: {},
    recentSessions: demo.sessions.slice(-3),
    llmEnabled: false,
  };

  it('dimension documentation is free of clinical terms (except explicit "non-clinical" disclaimers)', () => {
    for (const d of DIMENSIONS) {
      const text = [d.definition, d.notThis, d.scoring, d.uncertainty, ...d.everyday, ...d.strategies.map((s) => s.detail), ...d.missions].join(' ');
      expect(findClinicalTerms(text.replace(/non-clinical/gi, ''))).toEqual([]);
    }
  });

  it('all generated insights and session feedback pass the guardrails', () => {
    for (const i of insights) expect(checkMessage(narrateInsight(i)).ok).toBe(true);
    for (const s of demo.sessions.slice(-25)) {
      const fb = sessionFeedback(s, sessionInsights(s));
      expect(checkMessage(fb.text).violations).toEqual([]);
    }
    expect(checkMessage(dailyBriefing(insights, 'two items', { daysAway: 5, now: NOW }).text).ok).toBe(true);
  });

  it('template chat answers common questions safely and with evidence', () => {
    const questions = [
      'How am I doing?',
      'Why is my reasoning score uncertain?',
      "What's my plan today?",
      'Give me a memory tip',
      'Will my flexibility improve in two weeks?',
      'Am I improving in attention?',
      'Help me set a goal',
      'I feel tired',
      'How is my data used?',
      'Explain my collaboration score',
      'How does the scoring work?',
      'Tell me about speed',
      'blah',
    ];
    for (const q of questions) {
      const r = templateReply(q, ctx);
      expect(r.text.length).toBeGreaterThan(20);
      expect(r.safety?.passed).toBe(true);
      expect(findClinicalTerms(r.text.replace(/non-clinical/gi, ''))).toEqual([]);
    }
  });

  it('LLM context is de-identified and its numbers are extractable for grounding', () => {
    const { context, allowedNumbers } = buildLLMContext({ ...ctx, name: 'Amira' });
    expect(JSON.stringify(context)).not.toContain('Amira');
    expect(JSON.stringify(context)).not.toContain('rtMs');
    expect(allowedNumbers.length).toBeGreaterThan(5);
  });

  it('verify-the-coach challenge has exactly one false statement', () => {
    for (let seed = 1; seed < 20; seed++) {
      const c = createVerifyChallenge(profile, createRng(seed), NOW);
      expect(c).not.toBeNull();
      expect(c!.statements).toHaveLength(3);
      expect(c!.statements.filter((s) => !s.isTrue)).toHaveLength(1);
    }
  });
});
