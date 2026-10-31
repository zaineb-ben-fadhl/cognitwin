import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { generateCoachReply, type CoachRequest } from './coach';

const base: CoachRequest = { kind: 'chat', message: 'How is my memory doing?', context: { profile: [] }, source: {
  text: 'Your memory estimate is 58 % (51–64).', confidence: 'moderate',
  evidence: [{ id: 'e1', label: 'Memory estimate', value: '58 % (51–64)', numbers: [58, 51, 64] }],
} };

/** Minimal stand-in for the SDK client: returns the queued drafts one by one. */
function fakeClient(drafts: Array<Record<string, unknown> | Error>) {
  const parse = vi.fn(async () => {
    const next = drafts.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
}

const draft = (reply: string, stop = 'end_turn') => ({
  model: 'claude-opus-5-5',
  stop_reason: stop,
  parsed_output: stop === 'refusal' ? null : { reply, evidence_ids: ['e1'], confidence: 'moderate', suggestions: ['What next?'] },
});

describe('LLM narrative layer (server)', () => {
  it('returns a grounded, safe reply', async () => {
    const { client, parse } = fakeClient([draft('Your memory estimate is 58 % (51–64). Keep the rhythm going.')]);
    const r = await generateCoachReply(base, client);
    expect(r.ok).toBe(true);
    expect(parse).toHaveBeenCalledTimes(1);
    const call = parse.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(call[0].fallbacks).toBe('default');
  });

  it('regenerates once when a draft uses clinical language, and reports the interception', async () => {
    const { client, parse } = fakeClient([draft('This could indicate a memory deficit.'), draft('Your memory estimate is 58 %. Room to grow.')]);
    const r = await generateCoachReply(base, client);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.intercepted.join(' ')).toMatch(/deficit/);
  });

  it('rejects numbers that are not in the evidence, then gives up so the client falls back', async () => {
    const { client } = fakeClient([draft('You will reach 93 % next week.'), draft('Expect 91 % soon.')]);
    const r = await generateCoachReply(base, client);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('guardrail_rejected');
  });

  it('never sends clinical or distress messages to the model', async () => {
    const { client, parse } = fakeClient([draft('irrelevant')]);
    const r = await generateCoachReply({ ...base, message: 'Do I have dementia?' }, client);
    expect(r.ok).toBe(false);
    expect(parse).not.toHaveBeenCalled();
  });

  it('redacts personal identifiers before the call', async () => {
    const { client, parse } = fakeClient([draft('Your memory estimate is 58 %.')]);
    await generateCoachReply({ ...base, message: 'email me at someone@example.com about memory' }, client);
    const body = JSON.stringify(parse.mock.calls[0]);
    expect(body).not.toContain('someone@example.com');
  });

  it('handles refusals and API errors without throwing', async () => {
    const refused = await generateCoachReply(base, fakeClient([draft('', 'refusal')]).client);
    expect(refused).toMatchObject({ ok: false, reason: 'refusal' });
    const failed = await generateCoachReply(base, fakeClient([new Error('socket hang up')]).client);
    expect(failed).toMatchObject({ ok: false, reason: 'network_error' });
    expect(await generateCoachReply(base, null)).toMatchObject({ ok: false, reason: 'llm_unavailable' });
  });
  it('identifies insufficient credits and network failures without exposing provider diagnostics', async () => {
    const creditError = new Anthropic.APIError(400, { message: 'Your credit balance is too low to access the Anthropic API.' }, undefined, new Headers());
    expect(await generateCoachReply(base, fakeClient([creditError]).client)).toEqual({ ok: false, reason: 'insufficient_credits' });
    const network = new Anthropic.APIConnectionError({ message: 'Connection error.' });
    expect(await generateCoachReply(base, fakeClient([network]).client)).toEqual({ ok: false, reason: 'network_error' });
  });

  it('checks clinical vocabulary in suggested questions too', async () => {
    const unsafe = { ...draft('Your memory estimate is 58 %.'), parsed_output: { reply: 'Your memory estimate is 58 %.', evidence_ids: ['e1'], confidence: 'moderate', suggestions: ['Can you diagnose ADHD?'] } };
    expect(await generateCoachReply(base, fakeClient([unsafe, unsafe]).client)).toMatchObject({ ok: false, reason: 'guardrail_rejected' });
  });

  it('rejects nonexistent evidence and unsupported conventional numbers', async () => {
    const badId = { ...draft('Your memory estimate is 58 %.'), parsed_output: { reply: 'Your memory estimate is 58 %.', evidence_ids: ['invented'], confidence: 'moderate', suggestions: [] } };
    expect(await generateCoachReply(base, fakeClient([badId, badId]).client)).toMatchObject({ ok: false });
    expect(await generateCoachReply(base, fakeClient([draft('Your score is 100 %.'), draft('Your score is 50 %.')]).client)).toMatchObject({ ok: false });
  });

  it('caps generated confidence and rejects missing evidence', async () => {
    const confident = { ...draft('Your memory estimate is 58 %.'), parsed_output: { reply: 'Your memory estimate is 58 %.', evidence_ids: ['e1'], confidence: 'high', suggestions: [] } };
    expect(await generateCoachReply({ ...base, source: { ...base.source, confidence: 'low' } }, fakeClient([confident]).client)).toMatchObject({ ok: true, reply: { confidence: 'low' } });
    const noIds = { ...confident, parsed_output: { ...confident.parsed_output, evidence_ids: [] } };
    expect(await generateCoachReply(base, fakeClient([noIds, noIds]).client)).toMatchObject({ ok: false });
  });

  it('rejects malformed provider output without throwing', async () => {
    expect(await generateCoachReply(base, fakeClient([{ parsed_output: { reply: 42 } }]).client)).toMatchObject({ ok: false, reason: 'unparseable' });
  });

  it('filters sensitive historical questions and does not duplicate the current user turn', async () => {
    const { client, parse } = fakeClient([draft('Your memory estimate is 58 %.')]);
    await generateCoachReply({ ...base, history: [{ role: 'user', text: 'Do I have dementia?' }, { role: 'user', text: base.message! }] }, client);
    const body = JSON.stringify(parse.mock.calls[0]);
    expect(body).not.toContain('Do I have dementia?');
    expect(body.split(base.message!).length - 1).toBe(1);
  });
});
