import type { ComponentType } from 'react';
import type { ErrorType } from '@/engine';

export interface RespondArgs<Resp> {
  response: Resp | null;
  rtMs: number | null;
  /** Extra behaviour captured by the view. */
  corrections?: number;
  hintUsed?: boolean;
}

export interface TaskViewProps<Stim, Resp> {
  stim: Stim;
  level: number;
  deadlineMs: number;
  colourIndependent: boolean;
  practice: boolean;
  onRespond(args: RespondArgs<Resp>): void;
}

export interface Evaluation {
  correct: boolean;
  errorType?: ErrorType;
  meta?: Record<string, number | string | boolean>;
}

export interface TaskModule<Stim, Resp> {
  View: ComponentType<TaskViewProps<Stim, Resp>>;
  evaluate(stim: Stim, response: Resp | null, rtMs: number | null): Evaluation;
  /** Short text shown as training feedback after an error. */
  explainError?(stim: Stim, response: Resp | null): string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTaskModule = TaskModule<any, any>;
