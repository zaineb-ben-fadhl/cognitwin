/** Explicit live-provider smoke test. Uses a synthetic profile; may consume API credits. */
import assert from 'node:assert/strict';
const base = new URL(process.argv[2] ?? 'http://localhost:5173/');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'Target a local CogniTwin server.');
const health = await (await fetch(new URL('api/health', base), { signal: AbortSignal.timeout(5000) })).json();
if (!health.llm) {
  console.log(JSON.stringify({ ok: false, reason: 'llm_not_configured', liveProviderVerified: false }));
  process.exit(1);
}
const source = {
  text: 'Your working memory practice score is 58%, with an 80% interval from 51 to 64. This estimate has moderate confidence. Try grouping the sequence into small chunks.',
  confidence: 'moderate',
  evidence: [{ id: 'source_1', label: 'Working memory practice score', value: '58%, with an 80% interval from 51 to 64', numbers: [58, 80, 51, 64] }],
};
const started = Date.now();
const response = await fetch(new URL('api/coach', base), {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
  body: JSON.stringify({ kind: 'chat', message: 'Explain this result and give one practical next step.', source,
    context: { synthetic: true, strategies: [{ dimension: 'Working Memory', title: 'Chunking', detail: 'Group the sequence into small chunks.' }] }, history: [] }),
});
const result = await response.json();
if (!response.ok || !result.ok) {
  console.log(JSON.stringify({ ok: false, httpStatus: response.status, reason: result.reason ?? 'unknown', elapsedMs: Date.now() - started, liveProviderVerified: false }, null, 2));
  process.exit(1);
}
assert.ok(typeof result.reply?.reply === 'string' && result.reply.reply.length > 0);
assert.deepEqual(result.reply.evidence_ids, ['source_1']);
assert.ok(['low', 'moderate'].includes(result.reply.confidence));
console.log(JSON.stringify({ ok: true, model: result.model, elapsedMs: Date.now() - started, reply: result.reply, checks: result.checks, intercepted: result.intercepted, liveProviderVerified: true }, null, 2));
