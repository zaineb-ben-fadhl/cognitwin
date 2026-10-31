/**
 * Validation of imported data files. Imports are untrusted: structure is checked with zod,
 * and the Brain Twin is always rebuilt from the sessions rather than trusted as-is.
 */
import { z } from 'zod';
import { DIMENSION_IDS, findTask } from '@/engine/dimensions';

const num = z.number().finite();
const dimension = z.string().refine((id) => DIMENSION_IDS.includes(id), 'Unknown dimension');
const timestamp = num.min(0).max(4_102_444_800_000);
const proportion = num.min(0).max(1);
const count = num.int().nonnegative();
const affectState = z.enum(['flow', 'strained', 'fatigued', 'disengaged', 'neutral']);
const selfReport = z.object({ mood: num.int().min(1).max(5).optional(), energy: num.int().min(1).max(5).optional() });
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

const trial = z.object({
  index: count,
  level: num.int().min(1).max(10),
  correct: z.boolean(),
  success: z.boolean(),
  rtMs: num.nonnegative().nullable(),
  deadlineMs: num.positive(),
  condition: z.string().max(40).optional(),
  errorType: z.string().max(40).optional(),
  weight: num.min(0).max(1).optional(),
  meta: z.record(z.string(), z.union([z.string().max(80), num, z.boolean()])).optional(),
  t: num,
});

const gaussian = z.object({ mean: num, sd: num.positive() });
const score = z.object({ score: num.min(0).max(100), lo: num.min(0).max(100), hi: num.min(0).max(100), confidence: z.enum(['low', 'moderate', 'high']) }).refine((s) => s.lo <= s.score && s.score <= s.hi, 'Invalid score interval');

export const sessionSchema = z.object({
  id: z.string().max(80),
  dimension,
  taskId: z.string().max(40),
  mode: z.enum(['assessment', 'training']),
  startedAt: timestamp,
  endedAt: timestamp,
  trials: z.array(trial).max(500),
  behaviour: z.object({
    focusLosses: count,
    hiddenMs: num.nonnegative(),
    longPauses: count,
    hintsUsed: count,
    corrections: count,
    anticipations: count,
    quitEarly: z.boolean(),
    input: z.enum(['mouse', 'touch', 'keyboard', 'mixed', 'simulated']),
  }),
  selfPrediction: num.optional(),
  selfReportBefore: selfReport.optional(),
  selfReportAfter: selfReport.optional(),
  camera: z.object({ samples: count, browTension: proportion, eyeClosure: proportion, gazeAway: proportion, smile: proportion }).optional(),
  affect: z.object({
    state: affectState, confidence: proportion,
    sources: z.array(z.enum(['behaviour', 'self-report', 'camera'])).default([]),
    evidence: z.array(z.object({ source: z.enum(['behaviour', 'self-report', 'camera']), signal: z.string().max(300), value: z.string().max(300), toward: affectState })).default([]),
    cameraCapped: z.boolean().optional(),
  }),
  metrics: z.array(z.object({ key: z.string(), label: z.string(), value: num.nullable() }).passthrough()),
  quality: z.object({ flags: z.array(z.object({ kind: z.enum(['interruptions', 'anticipations', 'random_responding', 'too_few_trials', 'long_pauses', 'quit_early']), detail: z.string().max(1000), severity: z.enum(['info', 'warn']) })), weight: proportion, reliability: z.enum(['good', 'fair', 'poor']) }),
  before: gaussian,
  after: gaussian,
  scoreBefore: score,
  scoreAfter: score,
  deadlineFactor: num.min(0.5).max(3),
  demo: z.boolean().optional(),
  planItemId: z.string().max(100).optional(),
}).refine((s) => findTask(s.taskId)?.dimension === s.dimension, 'Unknown task or mismatched dimension')
  .refine((s) => s.endedAt >= s.startedAt, 'Session ends before it starts');

const settingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']), colourIndependent: z.boolean(), reducedMotion: z.boolean(),
  textScale: num.min(0.8).max(2), challenge: z.enum(['gentle', 'balanced', 'stretch']),
  dailyMinutes: num.min(1).max(120), focus: z.array(dimension).max(20),
  retentionDays: num.int().min(1).max(3650).nullable(), speakCoach: z.boolean(), askSelfPrediction: z.boolean(), askCheckIn: z.boolean(),
}).partial();
const evidence = z.object({ id: z.string(), label: z.string().max(300), value: z.string().max(1500), numbers: z.array(num) });
const chatMessage = z.object({
  id: z.string(), role: z.enum(['coach', 'user']), text: z.string().max(5000), at: timestamp,
  headline: z.string().max(300).optional(), evidence: z.array(evidence).max(100).default([]),
  insightIds: z.array(z.string()).max(100).default([]), confidence: z.enum(['low', 'moderate', 'high']).default('low'),
  source: z.enum(['template', 'llm', 'safe-reply', 'user']).default('template'),
  suggestions: z.array(z.string().max(300)).max(10).optional(), intent: z.string().optional(), model: z.string().optional(),
});
export const goalSchema = z.object({
  id: z.string(), kind: z.enum(['score', 'habit']), dimension: dimension.optional(), target: num.min(1).max(100),
  deadline: timestamp, createdAt: timestamp, selfSet: z.boolean(), note: z.string().max(2000).optional(),
  archived: z.boolean().optional(), achievedAt: timestamp.optional(),
}).refine((g) => g.kind === 'habit' ? g.target <= 7 : !!g.dimension, 'Invalid goal target or dimension')
  .refine((g) => g.deadline >= g.createdAt && g.deadline - g.createdAt <= 3650 * 86400000, 'Invalid goal period');

export const exportSchema = z.object({
  app: z.literal('cognitwin'),
  schemaVersion: z.literal(1),
  exportedAt: num,
  data: z.object({
    sessions: z.array(sessionSchema).max(5000).refine((s) => new Set(s.map((x) => x.id)).size === s.length, 'Duplicate session ids'),
    goals: z.array(goalSchema).max(200),
    events: z.array(z.object({
      id: z.string(), at: timestamp,
      type: z.enum(['coach_message', 'why_opened', 'chat_question', 'followup', 'claim_rated', 'verify_challenge', 'recommendation_response', 'plan_edited', 'retry_after_feedback', 'session_completed', 'goal_self_set', 'goal_from_ai', 'self_prediction', 'override_with_reason', 'clinical_query', 'pii_shared', 'break_suggested', 'privacy_reviewed', 'consent_informed', 'random_responding']),
      data: z.record(z.string(), z.union([num, z.string().max(3000), z.boolean()])).optional(),
    }).refine((e) => ['specificity', 'hints', 'predicted', 'actual'].every((k) => e.data?.[k] === undefined || typeof e.data[k] === 'number'), 'Invalid numeric event field')
      .refine((e) => e.type !== 'self_prediction' || (typeof e.data?.predicted === 'number' && typeof e.data?.actual === 'number'), 'Missing prediction data')).max(20000),
    chat: z.array(chatMessage).max(2000).optional(),
    settings: settingsSchema.optional(),
    profile: z.object({ nickname: z.string().max(40) }).passthrough().optional(),
    calibration: z.object({ srtMs: num.positive(), factor: num.min(1).max(1.6), input: z.enum(['mouse', 'touch', 'keyboard']).default('mouse'), at: timestamp.default(0) }).nullable().optional(),
    missions: z.array(z.object({ id: z.string(), dimension, text: z.string().max(3000), doneAt: timestamp, reflection: z.string().max(3000).optional() })).max(10000).optional(),
    acsWeights: z.object({ clarification: proportion, verification: proportion, iteration: proportion, autonomy: proportion, responsible: proportion }).optional(),
    demo: z.boolean().optional(),
  }),
});

export type ExportFile = z.infer<typeof exportSchema>;
