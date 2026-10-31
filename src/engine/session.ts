/**
 * Turns a finished task run into a SessionRecord (Understand layer) and folds it into the twin.
 */
import { estimateAffect } from './affect';
import { toObservations } from './adaptive';
import { getTask } from './dimensions';
import { scoreSummary, updateBelief } from './irt';
import { commonMetrics } from './metrics';
import { assessQuality } from './quality';
import { applySession, createTwin, ensureDimensions, sessionPrior } from './twin';
import type {
  BehaviourLog,
  CameraCues,
  Gaussian,
  SelfReport,
  SessionMode,
  SessionRecord,
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
}

export function finalizeSession(input: SessionInput): SessionRecord {
  const task = getTask(input.taskId);
  const quality = assessQuality(task, input.trials, input.behaviour);
  const after = updateBelief(input.prior, toObservations(input.trials, quality.weight), task);
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
    if (s.trials.length) {
      const task = getTask(s.taskId);
      const prior = sessionPrior(twin, s.dimension, s.startedAt);
      const after = updateBelief(prior, toObservations(s.trials, s.quality.weight), task);
      record = { ...s, before: prior, after, scoreBefore: scoreSummary(prior, task), scoreAfter: scoreSummary(after, task) };
    }
    twin = applySession(twin, record);
    out.push(record);
  }
  return { twin, sessions: out };
}
