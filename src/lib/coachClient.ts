/**
 * Hybrid coach client. The deterministic template coach always produces an answer (with its
 * evidence and suggested action). When the user opted into the LLM narrative layer and the
 * server has a key, the LLM rephrases it in a more personal way — under the same guardrails.
 * Any failure silently falls back to the template answer, and the safety report says so.
 */
import {
  buildLLMContext,
  detectIntent,
  sessionFeedback,
  templateReply,
  uid,
  type CoachContext,
  type CoachMessage,
  type Insight,
  type SessionRecord,
} from '@/engine';
import { narrativeReplySchema, narrativeSource, validateNarrative, type NarrativeSource } from '@/engine/coach/narrative';
import { isClinicalQuery, isDistress, redactPII } from '@/engine/coach/guardrails';
import { withoutCamera } from '@/engine/privacy';
import { sessionInsights } from '@/engine/insights';
import { z } from 'zod';

let health: { llm: boolean; model: string | null; checkedAt: number } | null = null;

export async function checkHealth(force = false): Promise<{ llm: boolean; model: string | null }> {
  if (!force && health && Date.now() - health.checkedAt < 60_000) return health;
  try {
    const res = await fetch('./api/health', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error('Health unavailable');
    const json = (await res.json()) as { llm: boolean; model: string | null };
    health = { llm: !!json.llm, model: json.model ?? null, checkedAt: Date.now() };
  } catch {
    health = { llm: false, model: null, checkedAt: Date.now() };
  }
  return health;
}

interface LLMResponse {
  ok: boolean;
  reason?: string;
  reply?: { reply: string; evidence_ids: string[]; confidence: 'low' | 'moderate' | 'high'; suggestions: string[] };
  model?: string;
  intercepted?: string[];
  checks?: string[];
}

async function callLLM(body: unknown): Promise<LLMResponse> {
  try {
    const res = await fetch('./api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25_000),
    });
    const parsed = z.object({
      ok: z.boolean(), reason: z.string().optional(), reply: narrativeReplySchema.optional(),
      model: z.string().optional(), intercepted: z.array(z.string()).optional(), checks: z.array(z.string()).optional(),
    }).safeParse(await res.json());
    if (!parsed.success) return { ok: false, reason: 'invalid_response' };
    if (!res.ok && parsed.data.ok) return { ok: false, reason: 'service_error' };
    return parsed.data;
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}

function merge(template: CoachMessage, llm: LLMResponse, source: NarrativeSource): CoachMessage {
  const parsed = narrativeReplySchema.safeParse(llm?.reply);
  const validated = parsed.success ? validateNarrative(parsed.data, source) : null;
  if (llm?.ok && !validated?.ok) llm = { ok: false, reason: 'invalid_response', intercepted: validated?.violations ?? ['Invalid response format'] };
  if (!llm.ok || !llm.reply) {
    return {
      ...template,
      safety: {
        passed: true,
        checks: template.safety?.checks ?? [],
        intercepted: llm.intercepted ?? [],
        fallbackUsed: llm.reason !== 'llm_unavailable' && llm.reason !== 'disabled',
        fallbackReason: llm.reason === 'insufficient_credits' ? 'The AI provider account has insufficient API credits. The local coach remains available.' : undefined,
      },
    };
  }
  return {
    ...template,
    id: uid('cm_'),
    text: llm.reply.reply,
    evidence: source.evidence.filter((e) => validated!.reply.evidence_ids.includes(e.id)),
    confidence: validated!.reply.confidence,
    suggestions: llm.reply.suggestions.length ? llm.reply.suggestions : template.suggestions,
    source: 'llm',
    model: llm.model,
    safety: { passed: true, checks: llm.checks ?? [], intercepted: llm.intercepted ?? [], fallbackUsed: false },
  };
}

const historyOf = (chat: CoachMessage[]) =>
  chat.filter((m) => m.source !== 'safe-reply' && !isClinicalQuery(m.text) && !isDistress(m.text))
    .filter((m) => !m.evidence.some((e) => /camera/i.test(e.label)) && !m.insightIds.some((id) => id.endsWith('-affect')))
    .slice(-6).map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('coach' as const), text: redactPII(m.text).text }));

export async function askCoach(text: string, ctx: CoachContext, chat: CoachMessage[], canUseLLM = () => ctx.llmEnabled): Promise<CoachMessage> {
  const template = templateReply(text, { ...ctx, name: undefined });
  const { intent } = detectIntent(text);
  // Safety routes never go to the model.
  if (!ctx.llmEnabled || !canUseLLM() || intent === 'clinical' || intent === 'distress') return template;
  if (!(await checkHealth()).llm || !canUseLLM()) return template;
  const { context } = buildLLMContext(ctx);
  const cleanContext = { ...ctx, name: undefined, insights: ctx.insights.filter((i) => i.kind !== 'affect'), recentSessions: ctx.recentSessions.map(withoutCamera) };
  const source = narrativeSource(templateReply(text, cleanContext));
  const llm = await callLLM({ kind: 'chat', message: redactPII(text).text, context, source, history: historyOf(chat) });
  return canUseLLM() ? merge(template, llm, source) : template;
}

export async function sessionCoach(session: SessionRecord, insights: Insight[], ctx: CoachContext, canUseLLM = () => ctx.llmEnabled): Promise<CoachMessage> {
  const template = { ...sessionFeedback(session, insights), safety: { passed: true, checks: ['Non-clinical language', 'No guarantees about the future'], intercepted: [], fallbackUsed: false } };
  if (!ctx.llmEnabled || !canUseLLM() || !(await checkHealth()).llm || !canUseLLM()) return template;
  const cleanSession = withoutCamera(session);
  const cleanInsights = sessionInsights(cleanSession);
  const cleanTemplate = sessionFeedback(cleanSession, cleanInsights);
  const { context } = buildLLMContext({ ...ctx, insights: [...cleanInsights, ...ctx.insights], recentSessions: [...ctx.recentSessions, cleanSession] });
  const source = narrativeSource(cleanTemplate);
  const llm = await callLLM({ kind: 'feedback', context, source });
  return canUseLLM() ? merge(template, llm, source) : template;
}
