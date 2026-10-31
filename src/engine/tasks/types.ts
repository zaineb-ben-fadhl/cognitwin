import type { MeasurementModel } from '../irt';
import type { Rng } from '../rng';
import type { DimensionId, MetricValue, Trial } from '../types';

/**
 * Contract every task implements. Stimulus generation, deadlines, measurement parameters
 * and metrics live here (pure, testable); rendering lives in `src/components/tasks`.
 */
export interface TaskSpec<Stim = unknown> extends MeasurementModel {
  id: string;
  dimension: DimensionId;
  name: string;
  tagline: string;
  /** Short, plain-language, step-by-step instructions. */
  instructions: string[];
  controls: string;
  assessment: { minTrials: number; maxTrials: number; targetSd: number };
  trainingTrials: number;
  practiceTrials: number;
  /** Base response window before the user's device/motor calibration factor is applied. */
  deadlineMs(level: number): number;
  /** What makes this level harder, in plain language (used by the explainable UI). */
  levelDescription(level: number): string;
  /** Deterministic stimulus generation; `prev` lets sequential tasks create switches. */
  generate(level: number, rng: Rng, index: number, prev?: Stim): Stim;
  /** Task-specific metrics, appended to the common ones. */
  metrics(trials: readonly Trial[]): MetricValue[];
  /** Parameters used by the simulator (validation + demo data). */
  sim: SimProfile<Stim>;
}

export interface SimProfile<Stim> {
  /** Median correct RT at level 1 for an average simulated user. */
  baseRtMs: number;
  rtPerLevelMs: number;
  /** Additive RT effect per condition label. */
  conditionRtMs?: Record<string, number>;
  /** Shift of the success logit per condition (negative = harder). */
  conditionLogit?: Record<string, number>;
  /** Condition label and metadata of a generated stimulus. */
  describe(stim: Stim): { condition?: string; meta?: Record<string, number | string | boolean> };
  /** Error type to record when a simulated response fails. */
  errorFor(stim: Stim, rng: Rng): Trial['errorType'];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTaskSpec = TaskSpec<any>;
