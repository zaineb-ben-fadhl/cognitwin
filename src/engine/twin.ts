/**
 * Brain Twin — a dynamic, historised, uncertainty-aware model of the user.
 *
 * For each dimension the twin stores a Gaussian belief over ability θ. Between observations
 * the belief drifts (variance grows with time), so the twin is honest about stale knowledge
 * and can follow real change. Every session appends a full snapshot, which gives a complete,
 * replayable history (the "mandatory history" of the brief).
 */
import { DIMENSION_IDS, findDimension } from './dimensions';
import { POPULATION_PRIOR, scoreSummary, type MeasurementModel } from './irt';
import type { DimensionId, DimensionState, Gaussian, ScoreSummary, SessionRecord, SnapshotEntry, TwinSnapshot, TwinState } from './types';

export const TWIN_VERSION = 1;
/** Variance added per day without observation (logit²). */
export const DRIFT_PER_DAY = 0.003;
/** Process noise added at the start of every session, so that learning can be tracked. */
export const DRIFT_PER_SESSION = 0.012;
const DAY = 86_400_000;

export function createTwin(now: number, dims: DimensionId[] = DIMENSION_IDS): TwinState {
  return {
    version: TWIN_VERSION,
    createdAt: now,
    dims: Object.fromEntries(dims.map((d) => [d, freshDimension()])),
    snapshots: [],
  };
}

function freshDimension(): DimensionState {
  return { ...POPULATION_PRIOR, lastUpdated: null, nTrials: 0, nSessions: 0, bestLevel: 0 };
}

/** Make sure dimensions registered after the twin was created exist (forward compatibility). */
export function ensureDimensions(twin: TwinState, dims: DimensionId[] = DIMENSION_IDS): TwinState {
  const missing = dims.filter((d) => !twin.dims[d]);
  if (!missing.length) return twin;
  return { ...twin, dims: { ...twin.dims, ...Object.fromEntries(missing.map((d) => [d, freshDimension()])) } };
}

/** Belief at time `now`, with inactivity drift applied (capped at the population prior). */
export function beliefAt(state: DimensionState, now: number): Gaussian {
  if (state.lastUpdated === null) return { mean: state.mean, sd: state.sd };
  const days = Math.max(0, (now - state.lastUpdated) / DAY);
  const variance = Math.min(state.sd ** 2 + DRIFT_PER_DAY * days, POPULATION_PRIOR.sd ** 2);
  return { mean: state.mean, sd: Math.sqrt(variance) };
}

/** Prior used to start a session: drifted belief + per-session process noise. */
export function sessionPrior(twin: TwinState, dim: DimensionId, now: number): Gaussian {
  const state = twin.dims[dim] ?? freshDimension();
  const b = beliefAt(state, now);
  if (state.lastUpdated === null) return b;
  return { mean: b.mean, sd: Math.min(Math.sqrt(b.sd ** 2 + DRIFT_PER_SESSION), POPULATION_PRIOR.sd) };
}

export function modelFor(dim: DimensionId): MeasurementModel {
  const d = findDimension(dim);
  // Unknown (e.g. removed) dimensions fall back to a neutral model so old data still renders.
  return d ? d.task : { levels: 10, discrimination: 1.5, guessing: 0 };
}

export function entryFor(belief: Gaussian, dim: DimensionId): SnapshotEntry {
  const s = scoreSummary(belief, modelFor(dim));
  return { mean: belief.mean, sd: belief.sd, score: s.score, lo: s.lo, hi: s.hi };
}

export function applySession(twin: TwinState, session: SessionRecord): TwinState {
  const prev = twin.dims[session.dimension] ?? freshDimension();
  const passed = session.trials.filter((t) => t.success).map((t) => t.level);
  const updated: DimensionState = {
    mean: session.after.mean,
    sd: session.after.sd,
    lastUpdated: session.endedAt,
    nTrials: prev.nTrials + session.trials.length,
    nSessions: prev.nSessions + 1,
    bestLevel: Math.max(prev.bestLevel, ...passed, 0),
  };
  const dims = { ...twin.dims, [session.dimension]: updated };
  const snapshot: TwinSnapshot = {
    at: session.endedAt,
    sessionId: session.id,
    changed: session.dimension,
    dims: Object.fromEntries(Object.entries(dims).map(([id, st]) => [id, entryFor(st, id)])),
  };
  return { ...twin, dims, snapshots: [...twin.snapshots, snapshot] };
}

export interface DimensionProfile {
  id: DimensionId;
  belief: Gaussian;
  summary: ScoreSummary;
  state: DimensionState;
  /** Never observed: the score is the population prior and must be shown as unknown. */
  unmeasured: boolean;
  daysSinceUpdate: number | null;
}

export function currentProfile(twin: TwinState, now: number): DimensionProfile[] {
  return Object.entries(twin.dims)
    .filter(([id]) => findDimension(id))
    .map(([id, state]) => {
      const belief = beliefAt(state, now);
      return {
        id,
        belief,
        summary: scoreSummary(belief, modelFor(id)),
        state,
        unmeasured: state.lastUpdated === null,
        daysSinceUpdate: state.lastUpdated === null ? null : (now - state.lastUpdated) / DAY,
      };
    });
}

export interface HistoryPoint extends SnapshotEntry {
  at: number;
  sessionId?: string;
}

/** Progress series of one dimension (one point per session on that dimension). */
export function dimensionHistory(twin: TwinState, dim: DimensionId): HistoryPoint[] {
  return twin.snapshots
    .filter((s) => s.changed === dim && s.dims[dim])
    .map((s) => ({ at: s.at, sessionId: s.sessionId, ...s.dims[dim] }));
}

/** The twin as it was at time `at` (for replay / comparison). */
export function snapshotAt(twin: TwinState, at: number): TwinSnapshot | null {
  let found: TwinSnapshot | null = null;
  for (const s of twin.snapshots) {
    if (s.at <= at) found = s;
    else break;
  }
  return found;
}
