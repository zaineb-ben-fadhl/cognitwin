import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDemoHistory, computeCollabScore, currentProfile, profileInsights, type CoachContext, type CoachMessage } from '@/engine';

const now = Date.now();
const demo = buildDemoHistory(now);
const context: CoachContext = {
  now, name: 'PRIVATE_NICKNAME', profile: currentProfile(demo.twin, now),
  insights: profileInsights(demo.twin, demo.sessions, now), plan: demo.plans.at(-1) ?? null,
  goals: [], collab: computeCollabScore(demo.events), projections: {}, recentSessions: demo.sessions.slice(-5), llmEnabled: true,
};
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe('hybrid coach client', () => {
  it('makes no request without consent and rechecks permission after asynchronous health lookup', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { askCoach } = await import('./coachClient');
    const result = await askCoach('How is my memory?', { ...context, llmEnabled: false }, []);
    expect(result.source).toBe('template');
    expect(fetch).not.toHaveBeenCalled();
    let allowed = true;
    fetch.mockImplementationOnce(async () => { allowed = false; return response({ llm: true, model: 'test' }); });
    const revoked = await askCoach('How is my memory?', context, [], () => allowed);
    expect(fetch).toHaveBeenCalledOnce(); // only health, no conversation sent
    expect(revoked.source).toBe('template');
  });
  it('routes clinical questions locally even when AI is enabled', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { askCoach } = await import('./coachClient');
    const result = await askCoach('Do I have ADHD?', context, []);
    expect(result.source).toBe('safe-reply');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['network', 'malformed', 'clinical suggestion', 'unknown evidence', 'http error', 'insufficient credits'])('falls back safely after %s', async (kind) => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ llm: true, model: 'test' }));
    const reply = { reply: 'Keep practising.', evidence_ids: [], confidence: 'low', suggestions: [] as string[] };
    if (kind === 'network') fetch.mockRejectedValueOnce(new Error('Offline'));
    else if (kind === 'insufficient credits') fetch.mockResolvedValueOnce(response({ ok: false, reason: 'insufficient_credits' }, 502));
    else if (kind === 'malformed') fetch.mockResolvedValueOnce(response({ ok: true, intercepted: 'invalid', reply: 'invalid' }));
    else {
      if (kind === 'clinical suggestion') reply.suggestions = ['Ask about your ADHD diagnosis'];
      if (kind === 'unknown evidence') reply.evidence_ids = ['made_up'] as never[];
      fetch.mockResolvedValueOnce(response({ ok: true, reply }, kind === 'http error' ? 500 : 200));
    }
    vi.stubGlobal('fetch', fetch);
    const { askCoach } = await import('./coachClient');
    const result = await askCoach('How is my memory?', context, []);
    expect(result.source).toBe('template');
    expect(result.safety?.fallbackUsed).toBe(true);
    expect(result.text).not.toContain('ADHD');
    if (kind === 'insufficient credits') expect(result.safety?.fallbackReason).toContain('insufficient API credits');
  });
  it('minimises the transmitted context and redacts chat identifiers', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ llm: true, model: 'test' })).mockResolvedValueOnce(response({ ok: false, reason: 'refused' }));
    vi.stubGlobal('fetch', fetch);
    const chat: CoachMessage[] = [
      { id:'m1',at:now,role:'user',text:'Email me at test@example.com',source:'user',confidence:'low',evidence:[],insightIds:[] },
      { id:'m2',at:now,role:'user',text:'Do I have ADHD?',source:'user',confidence:'low',evidence:[],insightIds:[] },
      { id:'m3',at:now,role:'coach',text:'PRIVATE_CAMERA_STATE',source:'template',confidence:'low',evidence:[{id:'cam',label:'Camera cue',value:'40 %',numbers:[40]}],insightIds:['session-affect'] },
    ];
    const { askCoach } = await import('./coachClient');
    await askCoach('How is my memory? test@example.com', context, chat);
    const sent = JSON.parse(fetch.mock.calls[1][1].body);
    const serial = JSON.stringify(sent);
    expect(serial).not.toContain('test@example.com');
    expect(serial).not.toContain('PRIVATE_NICKNAME');
    expect(serial).not.toContain('ADHD');
    expect(serial).not.toContain('PRIVATE_CAMERA_STATE');
    expect(serial).not.toContain('"trials"');
    expect(sent.history).toHaveLength(1);
    expect(sent.source.evidence.length).toBeGreaterThan(0);
  });
});
