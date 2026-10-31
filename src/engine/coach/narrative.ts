import { z } from 'zod';
import type { CoachMessage } from './types';
import { checkMessage, extractNumbers } from './guardrails';

const confidence = z.enum(['low', 'moderate', 'high']);
export const narrativeSourceSchema = z.object({
  text: z.string().min(1).max(5000),
  confidence,
  evidence: z.array(z.object({
    id: z.string().min(1).max(100),
    label: z.string().max(300),
    value: z.string().max(1500),
    numbers: z.array(z.number().finite()).max(100),
  })).max(100),
});
export const narrativeReplySchema = z.object({
  reply: z.string().min(1).max(900),
  evidence_ids: z.array(z.string().max(100)).max(100),
  confidence,
  suggestions: z.array(z.string().min(1).max(160)).max(3),
});
export type NarrativeSource = z.infer<typeof narrativeSourceSchema>;
export type NarrativeReply = z.infer<typeof narrativeReplySchema>;

/** Only the deterministic answer's evidence may support a generated reformulation. */
export function narrativeSource(message: CoachMessage): NarrativeSource {
  return {
    text: message.text,
    confidence: message.confidence,
    evidence: message.evidence.map((e, i) => ({ ...e, id: `source_${i + 1}` })),
  };
}

export function validateNarrative(reply: NarrativeReply, source: NarrativeSource) {
  const violations: string[] = [];
  const ids = [...new Set(reply.evidence_ids)];
  if (ids.some((id) => !source.evidence.some((e) => e.id === id))) violations.push('Unknown evidence reference');
  if (source.evidence.length && !ids.length) violations.push('Cite the evidence supporting the source answer');
  const cited = source.evidence.filter((e) => ids.includes(e.id));
  const numbers = cited.flatMap((e) => [...e.numbers, ...extractNumbers(e.value)]);
  const texts = [reply.reply, ...reply.suggestions];
  for (const text of texts) {
    const checked = checkMessage(text, { allowedNumbers: numbers });
    violations.push(...checked.violations.map((v) => v.detail));
  }
  const ranks = { low: 0, moderate: 1, high: 2 };
  const ceiling = cited.length ? source.confidence : 'low';
  const capped = ranks[reply.confidence] > ranks[ceiling] ? ceiling : reply.confidence;
  return {
    ok: violations.length === 0,
    violations: [...new Set(violations)],
    reply: { ...reply, evidence_ids: ids, confidence: capped },
    checks: ['Non-clinical language in every displayed field', 'No guarantees about the future', 'Numbers checked against cited evidence', 'Evidence references checked', 'Confidence capped by the source'],
  };
}
