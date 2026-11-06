/**
 * Data behind the Brain Twin heatmaps. Kept in the engine (not in the page) so the coach's
 * explanations cite exactly the numbers the charts show.
 */
import { DIMENSIONS } from './dimensions';
import { pSuccess } from './irt';
import { modelFor, snapshotAt } from './twin';
import type { DimensionId, SessionRecord, TwinState } from './types';

const DAY = 86_400_000;

export interface HeatCell {
  value: number | null;
  label: string;
  detail?: string;
}

export interface WeeklyMatrix {
  ids: DimensionId[];
  /** Start of each weekly column (epoch ms), oldest first. */
  starts: number[];
  cells: HeatCell[][];
}

/** Change of each estimate per week (score points), oldest week first; the last column is the current week. */
export function weeklyChangeMatrix(sessions: readonly SessionRecord[], twin: TwinState, now: number, weeks = 8): WeeklyMatrix {
  const ids = DIMENSIONS.map((d) => d.id);
  const starts: number[] = [];
  const cells: HeatCell[][] = ids.map(() => []);
  for (let w = weeks - 1; w >= 0; w--) {
    const end = now - w * 7 * DAY;
    const start = end - 7 * DAY;
    starts.push(start);
    ids.forEach((id, ri) => {
      const inWeek = sessions.filter((s) => s.dimension === id && s.endedAt > start && s.endedAt <= end);
      if (!inWeek.length) return cells[ri].push({ value: null, label: 'no session' });
      // The first-ever measurement is a baseline, not a change from the (arbitrary) starting prior.
      const measuredBefore = sessions.some((s) => s.dimension === id && s.endedAt <= start);
      if (!measuredBefore && inWeek.length === 1) return cells[ri].push({ value: null, label: 'baseline measurement', detail: `${Math.round(inWeek[0].scoreAfter.score)} %` });
      const before = measuredBefore ? (snapshotAt(twin, start)?.dims[id]?.score ?? inWeek[0].scoreBefore.score) : inWeek[0].scoreAfter.score;
      const after = snapshotAt(twin, end)?.dims[id]?.score ?? inWeek.at(-1)!.scoreAfter.score;
      const d = after - before;
      cells[ri].push({ value: d, label: `${d >= 0 ? '+' : ''}${d.toFixed(1)} pts`, detail: `${inWeek.length} session${inWeek.length > 1 ? 's' : ''}` });
    });
  }
  return { ids, starts, cells };
}

export const TIME_BANDS = ['Morning', 'Afternoon', 'Evening'] as const;

export const timeBand = (ts: number) => {
  const h = new Date(ts).getHours();
  return h < 12 ? 0 : h < 18 ? 1 : 2;
};

/** Success compared with the model's expectation, per dimension × time of day (removes the effect of level choice). */
export function timeOfDayMatrix(sessions: readonly SessionRecord[]): { ids: DimensionId[]; bands: readonly string[]; cells: HeatCell[][] } {
  const ids = DIMENSIONS.map((d) => d.id);
  const cells: HeatCell[][] = ids.map((id) =>
    TIME_BANDS.map((_, b) => {
      const ss = sessions.filter((s) => s.dimension === id && s.trials.length && timeBand(s.startedAt) === b);
      if (ss.length < 2) return { value: null, label: 'too few sessions' };
      let k = 0;
      let e = 0;
      let n = 0;
      for (const s of ss) {
        for (const t of s.trials) {
          k += t.success ? 1 : 0;
          e += pSuccess(s.before.mean, t.level, modelFor(id));
          n++;
        }
      }
      const v = (100 * (k - e)) / n;
      return { value: v, label: `${v >= 0 ? '+' : ''}${v.toFixed(1)} pts vs expected`, detail: `${ss.length} sessions, ${n} trials` };
    }),
  );
  return { ids, bands: TIME_BANDS, cells };
}
