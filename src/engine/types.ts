/**
 * Core domain types for the CogniTwin engine.
 *
 * The engine is pure TypeScript (no DOM, no React) so that the exact same code
 * runs in the browser, in unit tests, in the validation simulator and on the server.
 */

/** Dimension identifiers are open strings so new dimensions can be registered without touching the core. */
export type DimensionId = string;

export type Confidence = 'low' | 'moderate' | 'high';

export type SessionMode = 'assessment' | 'training';

export type ErrorType =
  | 'commission' // responded when no response was required (e.g. no-go trial) or clicked a distractor
  | 'omission' // no response before the deadline
  | 'wrong_choice' // picked the wrong option
  | 'order' // right items, wrong order (sequence tasks)
  | 'item' // wrong item recalled (sequence tasks)
  | 'perseveration' // applied the previously valid rule (switching tasks)
  | 'anticipation' // responded implausibly fast (< 150 ms)
  | 'slow'; // correct but after the deadline

/** One response inside a session. */
export interface Trial {
  index: number;
  /** Difficulty level, 1 … task.levels. */
  level: number;
  /** Task-level correctness (ignores the deadline). */
  correct: boolean;
  /** Outcome used by the measurement model: correct AND within the (calibrated) deadline. */
  success: boolean;
  /** Response time in ms; null for omissions / withheld responses. */
  rtMs: number | null;
  deadlineMs: number;
  /** Task-specific condition label, e.g. 'congruent' | 'incongruent' | 'switch' | 'repeat' | 'nogo'. */
  condition?: string;
  errorType?: ErrorType;
  /** Likelihood weight in [0, 1]; trials right after an interruption are down-weighted. */
  weight?: number;
  /** Free-form task metadata (set size, span, attribute missed …). */
  meta?: Record<string, number | string | boolean>;
  /** ms since session start. */
  t: number;
}

/** Interaction behaviour captured during a session (no biometric data). */
export interface BehaviourLog {
  focusLosses: number;
  hiddenMs: number;
  /** Gaps > 8 s without any input while a trial was waiting. */
  longPauses: number;
  hintsUsed: number;
  /** Corrections / undo actions (sequence tasks). */
  corrections: number;
  anticipations: number;
  quitEarly: boolean;
  input: 'mouse' | 'touch' | 'keyboard' | 'mixed' | 'simulated';
}

export interface Gaussian {
  mean: number;
  sd: number;
}

export interface ScoreSummary {
  /** Expected mastery of the task's difficulty ladder, 0–100 (posterior median). */
  score: number;
  /** 80 % credible interval bounds. */
  lo: number;
  hi: number;
  confidence: Confidence;
}

export interface MetricValue {
  key: string;
  label: string;
  value: number | null;
  unit?: string;
  /** Which direction counts as growth; 'neutral' for purely descriptive values. */
  better: 'higher' | 'lower' | 'neutral';
  digits?: number;
  help?: string;
}

export type QualityFlagKind =
  | 'interruptions'
  | 'anticipations'
  | 'random_responding'
  | 'too_few_trials'
  | 'long_pauses'
  | 'quit_early';

export interface QualityFlag {
  kind: QualityFlagKind;
  detail: string;
  severity: 'info' | 'warn';
}

export interface QualityReport {
  flags: QualityFlag[];
  /** Multiplier applied to all trial weights of the session (0.4 – 1). */
  weight: number;
  reliability: 'good' | 'fair' | 'poor';
}

export type AffectState = 'flow' | 'strained' | 'fatigued' | 'disengaged' | 'neutral';

export interface AffectEvidence {
  source: 'behaviour' | 'self-report' | 'camera';
  signal: string;
  value: string;
  toward: AffectState;
}

export interface AffectEstimate {
  state: AffectState;
  /** 0–1. */
  confidence: number;
  evidence: AffectEvidence[];
  sources: Array<'behaviour' | 'self-report' | 'camera'>;
  /** True when a camera cue was available but deliberately not allowed to decide alone. */
  cameraCapped?: boolean;
}

/** Aggregated, non-identifying camera cues (no frames are ever stored). */
export interface CameraCues {
  samples: number;
  /** Mean of brow-lowering blendshape, 0–1. */
  browTension: number;
  /** Share of samples with eyes mostly closed, 0–1 (PERCLOS-like). */
  eyeClosure: number;
  /** Share of samples where the head was turned away from the screen, 0–1. */
  gazeAway: number;
  /** Mean smile blendshape, 0–1. */
  smile: number;
}

export interface SelfReport {
  /** 1 (low) – 5 (high). */
  mood?: number;
  energy?: number;
}

export interface SessionRecord {
  id: string;
  dimension: DimensionId;
  taskId: string;
  mode: SessionMode;
  startedAt: number;
  endedAt: number;
  trials: Trial[];
  behaviour: BehaviourLog;
  /** User's own prediction of the score before starting (metacognition). */
  selfPrediction?: number;
  selfReportBefore?: SelfReport;
  selfReportAfter?: SelfReport;
  camera?: CameraCues;
  affect: AffectEstimate;
  metrics: MetricValue[];
  quality: QualityReport;
  /** Twin state of this dimension before / after the session. */
  before: Gaussian;
  after: Gaussian;
  scoreBefore: ScoreSummary;
  scoreAfter: ScoreSummary;
  /** Calibration factor applied to deadlines (motor / device fairness). */
  deadlineFactor: number;
  /** Planner item that triggered the session, when any. */
  planItemId?: string;
  demo?: boolean;
}

export interface DimensionState extends Gaussian {
  lastUpdated: number | null;
  nTrials: number;
  nSessions: number;
  bestLevel: number;
}

export interface SnapshotEntry extends Gaussian {
  score: number;
  lo: number;
  hi: number;
}

export interface TwinSnapshot {
  at: number;
  sessionId?: string;
  /** Dimension changed by this snapshot (others are carried over, with drift applied). */
  changed?: DimensionId;
  dims: Record<DimensionId, SnapshotEntry>;
}

export interface TwinState {
  version: number;
  createdAt: number;
  dims: Record<DimensionId, DimensionState>;
  snapshots: TwinSnapshot[];
}

export type GoalKind = 'score' | 'habit';

export interface Goal {
  id: string;
  kind: GoalKind;
  /** For score goals. */
  dimension?: DimensionId;
  target: number;
  /** epoch ms. */
  deadline: number;
  createdAt: number;
  /** true when the user wrote it, false when accepted from a coach suggestion. */
  selfSet: boolean;
  note?: string;
  archived?: boolean;
  achievedAt?: number;
}

export interface PlanReason {
  factor: 'gap' | 'uncertainty' | 'goal' | 'spacing' | 'momentum' | 'variety' | 'fatigue' | 'preference';
  /** Normalised feature value 0–1. */
  value: number;
  weight: number;
  contribution: number;
  text: string;
}

export interface PlanItem {
  id: string;
  dimension: DimensionId;
  taskId: string;
  mode: SessionMode;
  /** Suggested starting level. */
  level: number;
  minutes: number;
  utility: number;
  reasons: PlanReason[];
  done?: boolean;
  sessionId?: string;
  /** User edited / swapped this item. */
  userEdited?: boolean;
}

export interface DailyPlan {
  id: string;
  /** YYYY-MM-DD (local). */
  date: string;
  generatedAt: number;
  items: PlanItem[];
  rationale: string;
  /** Human-readable differences vs the previous plan. */
  changes: string[];
}

export type InsightKind =
  | 'improvement'
  | 'decline'
  | 'stable'
  | 'speed_accuracy'
  | 'fatigue'
  | 'consistency'
  | 'interference'
  | 'switch_cost'
  | 'search_efficiency'
  | 'sequence_order'
  | 'reasoning_rule'
  | 'time_of_day'
  | 'calibration'
  | 'strength'
  | 'needs_data'
  | 'streak'
  | 'data_quality'
  | 'plateau'
  | 'affect';

export interface Evidence {
  id: string;
  label: string;
  value: string;
  /** Raw numbers that may legitimately appear in coaching text (used by the grounding check). */
  numbers: number[];
}

export interface Insight {
  id: string;
  kind: InsightKind;
  dimension?: DimensionId;
  title: string;
  evidence: Evidence[];
  confidence: Confidence;
  /** Higher = shown first. */
  priority: number;
  tone: 'celebrate' | 'encourage' | 'advise' | 'inform';
  /** Strategy suggestion key from the dimension's strategy library. */
  suggestion?: string;
}
