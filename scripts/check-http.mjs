/** Non-mutating HTTP smoke checks for an already-started production server. */
import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'http://localhost:8787/';
const origin = new URL(base);
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname), 'This check targets a local test server.');
const get = (path, method = 'GET') => fetch(new URL(path, origin), { method, signal: AbortSignal.timeout(10000) });
const page = await get('');
assert.equal(page.status, 200);
const html = await page.text();
assert.ok(html.includes('id="root"'));
const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^\"]+)"/g)].map((m) => m[1]);
assert.ok(assets.length >= 3);
for (const path of assets) {
  const res = await get(path, 'HEAD');
  assert.equal(res.status, 200, path);
  assert.ok(!res.headers.get('content-type')?.includes('text/html'), `Missing asset: ${path}`);
}
for (const path of ['models/face_landmarker.task', 'models/wasm/vision_wasm_internal.wasm', 'models/wasm/vision_wasm_internal.js']) {
  const res = await get(path, 'HEAD');
  assert.equal(res.status, 200, path);
  assert.ok(Number(res.headers.get('content-length')) > 1000, path);
  assert.ok(!res.headers.get('content-type')?.includes('text/html'), path);
}
const health = await (await get('api/health')).json();
assert.equal(health.ok, true);
const missing = await get('api/not-a-route');
assert.equal(missing.status, 404);
assert.ok(missing.headers.get('content-type')?.includes('application/json'));
console.log(JSON.stringify({ base, page: 'passed', entryAssets: assets.length, localCameraAssets: 3, apiHealth: 'passed', llmConfigured: health.llm, unknownApiRoute: 'passed' }, null, 2));
