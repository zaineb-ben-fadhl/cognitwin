import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { COACH_MODEL, generateCoachReply, llmAvailable } from './coach';
import { narrativeSourceSchema } from '../src/engine/coach/narrative';

const requestSchema = z.object({
  kind: z.enum(['chat', 'feedback', 'briefing']),
  message: z.string().max(2000).optional(),
  context: z.record(z.string(), z.unknown()),
  source: narrativeSourceSchema,
  history: z.array(z.object({ role: z.enum(['user', 'coach']), text: z.string().max(3000) })).max(6).optional(),
});

/** Test HTTP contracts without a port or a provider call. */
export function createApi(options: { available?: () => boolean; reply?: typeof generateCoachReply } = {}) {
  const available = options.available ?? llmAvailable;
  const reply = options.reply ?? generateCoachReply;
  const app = new Hono();
  let requests = 0;
  let resetAt = 0;
  app.get('/api/health', (c) => c.json({ ok: true, llm: available(), model: available() ? COACH_MODEL : null }));
  app.post('/api/coach', bodyLimit({ maxSize: 64 * 1024 }), async (c) => {
    const now = Date.now();
    if (now >= resetAt) { requests = 0; resetAt = now + 60_000; }
    // Bounded server-wide limiter for this single-instance app; forwarded IP headers are untrusted.
    if (++requests > 30) return c.json({ ok: false, reason: 'rate_limited' }, 429);
    let body: unknown;
    try { body = await c.req.json(); }
    catch { return c.json({ ok: false, reason: 'invalid_json' }, 400); }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) return c.json({ ok: false, reason: 'invalid_request' }, 400);
    if (!available()) return c.json({ ok: false, reason: 'llm_unavailable' }, 503);
    try {
      const result = await reply(parsed.data);
      return c.json(result, result.ok ? 200 : 502);
    } catch { return c.json({ ok: false, reason: 'service_error' }, 502); }
  });
  app.all('/api/*', (c) => c.json({ ok: false, reason: 'not_found' }, 404));
  return app;
}
