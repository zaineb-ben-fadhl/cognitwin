import { describe, expect, it, vi } from 'vitest';
import { createApi } from './app';

const body = { kind: 'chat', message: 'How is my practice?', context: {}, source: { text: 'Keep practising.', confidence: 'low', evidence: [] } };
const request = (value: unknown = body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
describe('HTTP API', () => {
  it('reports offline mode and rejects valid narrative requests cleanly', async () => {
    const app = createApi({ available: () => false });
    expect(await (await app.request('/api/health')).json()).toMatchObject({ ok: true, llm: false, model: null });
    expect((await app.request('/api/coach', request())).status).toBe(503);
  });
  it('validates malformed JSON and missing evidence contracts', async () => {
    const app = createApi();
    expect((await app.request('/api/coach', { method: 'POST', body: '{' })).status).toBe(400);
    expect((await app.request('/api/coach', request({ kind: 'chat', context: {} }))).status).toBe(400);
  });
  it('limits body size before calling the provider', async () => {
    const reply = vi.fn();
    const app = createApi({ available: () => true, reply });
    expect((await app.request('/api/coach', request({ ...body, message: 'a'.repeat(70_000) }))).status).toBe(413);
    expect(reply).not.toHaveBeenCalled();
  });
  it('returns successful replies and contains unexpected service errors', async () => {
    const reply = vi.fn().mockResolvedValueOnce({ ok: true, reply: { reply: 'Keep practising.', suggestions: [], evidence_ids: [], confidence: 'low' }, model: 'test', checks: [], intercepted: [] }).mockRejectedValueOnce(new Error('provider failure'));
    const app = createApi({ available: () => true, reply });
    expect((await app.request('/api/coach', request())).status).toBe(200);
    const fail = await app.request('/api/coach', request());
    expect(fail.status).toBe(502);
    expect(await fail.json()).toEqual({ ok: false, reason: 'service_error' });
  });
  it('cannot bypass the request limit by forging forwarding headers', async () => {
    const app = createApi({ available: () => false });
    for (let i = 0; i < 30; i++) await app.request('/api/coach', { ...request(), headers: { ...request().headers, 'x-forwarded-for': `10.0.0.${i}` } });
    expect((await app.request('/api/coach', request())).status).toBe(429);
  });
  it('returns JSON 404 for unknown API paths', async () => {
    const res = await createApi().request('/api/unknown');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, reason: 'not_found' });
  });
});
