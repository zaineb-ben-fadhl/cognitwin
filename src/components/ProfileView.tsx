import { Table2 } from 'lucide-react';
import { useState } from 'react';
import { getDimension, type DimensionProfile } from '@/engine';
import { ProfileRadar, type RadarEntry } from './charts/ProfileRadar';
import { DimLabel } from './dim';
import { Button, ConfidenceBadge } from './ui';

export const toRadar = (profile: DimensionProfile[]): RadarEntry[] =>
  profile.map((p) => ({ id: p.id, score: p.summary.score, lo: p.summary.lo, hi: p.summary.hi, unmeasured: p.unmeasured }));

/** Radar + its table twin (the accessible equivalent of the chart). */
export function ProfileView({ entries, compare, compareLabel, label, profile }: { entries: RadarEntry[]; compare?: RadarEntry[]; compareLabel?: string; label?: string; profile?: DimensionProfile[] }) {
  const [table, setTable] = useState(false);
  return (
    <div>
      <div className="mb-1 flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          <Table2 size={14} /> {table ? 'Chart' : 'Table'}
        </Button>
      </div>
      {table ? (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-ink-2">
              <th className="py-1.5 font-medium">Dimension</th>
              <th className="py-1.5 text-right font-medium">Estimate</th>
              <th className="py-1.5 text-right font-medium">80 % interval</th>
              {compare && <th className="py-1.5 text-right font-medium">{compareLabel}</th>}
              {profile && <th className="py-1.5 text-right font-medium">Confidence</th>}
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={e.id} className="border-b border-line/60">
                <td className="py-2">
                  <DimLabel id={e.id} />
                </td>
                <td className="py-2 text-right tabular">{e.unmeasured ? '—' : `${Math.round(e.score)} %`}</td>
                <td className="py-2 text-right tabular text-ink-2">{e.unmeasured ? 'not measured' : `${Math.round(e.lo)}–${Math.round(e.hi)}`}</td>
                {compare && <td className="py-2 text-right tabular text-ink-2">{compare[i].unmeasured ? '—' : `${Math.round(compare[i].score)} %`}</td>}
                {profile && <td className="py-2 text-right">{profile[i].unmeasured ? '—' : <ConfidenceBadge confidence={profile[i].summary.confidence} compact />}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ProfileRadar entries={entries} compare={compare} compareLabel={compareLabel} label={label} />
      )}
      <p className="mt-2 text-center text-[11.5px] text-muted">
        % = expected mastery of each exercise’s 10 difficulty levels — compared with the exercise, never with other people. {entries.some((e) => e.unmeasured) && `Hollow dots: ${entries.filter((e) => e.unmeasured).map((e) => getDimension(e.id).short).join(', ')} not measured yet.`}
      </p>
    </div>
  );
}
