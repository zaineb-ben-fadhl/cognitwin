/**
 * Turns a finished task run into a SessionRecord (Understand layer) and folds it into the twin.
 */
import { estimateAffect } from './affect';
import { toObservations } from './adaptive';
import { getTask } from './dimensions';
import { POPULATION_PRIOR, scoreSummary, updateBelief, type Observation } from './irt';
import { commonMetrics } from './metrics';
import { assessQuality, isRapid } from './quality';
import type { AnyTaskSpec } from './tasks/types';
import { applySession, createTwin, ensureDimensions, sessionPrior } from './twin';
import type {
  BehaviourLog,
  CameraCues,
  Gaussian,
  QualityReport,
  SelfReport,
  SessionDispute,
  SessionMode,
  SessionRecord,
  TrainingFormat,
  Trial,
  TwinState,
} from './types';

export interface SessionInput {
  id: string;
  taskId: string;
  mode: SessionMode;
  startedAt: number;
  endedAt: number;
  trials: Trial[];
  behaviour: BehaviourLog;
  /** Prior the adaptive session started from (from `sessionPrior`). */
  prior: Gaussian;
  selfPrediction?: number;
  selfReportBefore?: SelfReport;
  selfReportAfter?: SelfReport;
  camera?: CameraCues;
  deadlineFactor: number;
  planItemId?: string;
  demo?: boolean;
  format?: TrainingFormat;
  targetSuccess?: number;
  strategyKey?: string;
}

/**
 * Observations that enter the likelihood. Rapid guesses of a flagged session are removed
 * (effort-moderated scoring); a disputed session counts with reduced weight.
 */
export function sessionObservations(task: AnyTaskSpec, trials: readonly Trial[], quality: QualityReport, dispute?: SessionDispute): Observation[] {
  const factor = quality.weight * (dispute?.weightFactor ?? 1);
  const dropRapid = quality.anomaly?.kind === 'rapid_guessing';
  return toObservations(trials, factor).map((o, i) => (dropRapid && isRapid(task, trials[i]) ? { ...o, weight: 0 } : o));
}

/**
 * Posterior after a session. When the data itself is suspect (rapid guessing, or the user
 * disputed the session), the session may not make the twin more confident: the posterior sd
 * is at least the prior sd, plus the extra variance — "highly uncertain", not "much worse".
 */
export function sessionPosterior(prior: Gaussian, trials: readonly Trial[], quality: QualityReport, task: AnyTaskSpec, dispute?: SessionDispute): Gaussian {
  const after = updateBelief(prior, sessionObservations(task, trials, quality, dispute), task);
  return inflate(after, prior, (quality.uncertaintyInflation ?? 0) + (dispute?.varianceAdded ?? 0));
}

function inflate(after: Gaussian, prior: Gaussian, extra: number): Gaussian {
  if (extra <= 0) return after;
  const base = Math.max(after.sd, prior.sd);
  return { mean: after.mean, sd: Math.min(POPULATION_PRIOR.sd, Math.sqrt(base ** 2 + extra)) };
}

export function finalizeSession(input: SessionInput): SessionRecord {
  const task = getTask(input.taskId);
  const quality = assessQuality(task, input.trials, input.behaviour);
  const after = sessionPosterior(input.prior, input.trials, quality, task);
  const selfReport = { ...input.selfReportBefore, ...input.selfReportAfter };
  return {
    id: input.id,
    dimension: task.dimension,
    taskId: task.id,
    mode: input.mode,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    trials: input.trials,
    behaviour: input.behaviour,
    selfPrediction: input.selfPrediction,
    selfReportBefore: input.selfReportBefore,
    selfReportAfter: input.selfReportAfter,
    camera: input.camera,
    affect: estimateAffect(input.trials, input.behaviour, selfReport, input.camera),
    metrics: [...commonMetrics(input.trials), ...task.metrics(input.trials)],
    quality,
    before: input.prior,
    after,
    scoreBefore: scoreSummary(input.prior, task),
    scoreAfter: scoreSummary(after, task),
    deadlineFactor: input.deadlineFactor,
    planItemId: input.planItemId,
    demo: input.demo,
    ...(input.format && input.format !== 'standard' ? { format: input.format } : {}),
    ...(input.targetSuccess !== undefined ? { targetSuccess: input.targetSuccess } : {}),
    ...(input.strategyKey ? { strategyKey: input.strategyKey } : {}),
  };
}

/**
 * Replay sessions in chronological order to rebuild the twin — used after a session is deleted,
 * after an import, or after a model change. Sessions whose raw trials were purged by the
 * retention policy keep their stored posterior.
 */
export function replaySessions(sessions: readonly SessionRecord[], createdAt: number): { twin: TwinState; sessions: SessionRecord[] } {
  let twin = createTwin(createdAt);
  const out: SessionRecord[] = [];
  for (const s of [...sessions].sort((a, b) => a.endedAt - b.endedAt)) {
    twin = ensureDimensions(twin, [s.dimension]);
    let record = s;
    const task = getTask(s.taskId);
    if (s.trials.length) {
      const prior = sessionPrior(twin, s.dimension, s.startedAt);
      const after = sessionPosterior(prior, s.trials, s.quality, task, s.dispute);
      record = { ...s, before: prior, after, scoreBefore: scoreSummary(prior, task), scoreAfter: scoreSummary(after, task) };
    } else if (s.dispute) {
      // Raw trials were purged: widen the stored posterior instead.
      const after = inflate(s.after, s.before, s.dispute.varianceAdded);
      record = { ...s, after, scoreAfter: scoreSummary(after, task) };
    }
    twin = applySession(twin, record);
    out.push(record);
  }
  return { twin, sessions: out };
}
