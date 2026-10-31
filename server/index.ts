/**
 * Minimal API server. Stateless by design: it stores nothing, logs no request bodies,
 * and only exists to keep the Anthropic API key off the client. The web app works fully
 * without it (template coach), so a static deployment is also valid.
 */
import './env';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApi } from './app';
import { existsSync } from 'node:fs';
import { COACH_MODEL, llmAvailable } from './coach';

const app = createApi();
const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);

// In production, serve the built SPA from the same origin.
if (existsSync('./dist')) {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`CogniTwin API on http://localhost:${info.port} — LLM coach ${llmAvailable() ? `enabled (${COACH_MODEL})` : 'disabled (template mode)'}`);
});
