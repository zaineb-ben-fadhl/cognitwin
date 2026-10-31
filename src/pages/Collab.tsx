import { ChevronDown, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Button, Card, CardHeader, ConfidenceBadge, EmptyState, IntervalBar, PageHeader } from '@/components/ui';
import {
  COLLAB_DESCRIPTION,
  COLLAB_DIMENSIONS,
  COLLAB_LABEL,
  DEFAULT_ACS_WEIGHTS,
  collabHistory,
  normaliseWeights,
  weightSensitivity,
  type CollabDimension,
} from '@/engine';
import { fmtDate } from '@/lib/format';
import { useStore } from '@/store';
import { useCollab } from '@/store/derived';

const TIPS: Record<CollabDimension, string> = {
  clarification: 'Open “Why?” on recommendations — especially those marked low confidence — and ask the coach to explain its reasoning.',
  verification: 'Play “Verify the coach”, compare claims with your charts, and rate whether answers match your data.',
  iteration: 'Adapt suggestions instead of taking them as-is: swap a plan item, refine a question, retry after feedback.',
  autonomy: 'Set your own goals, predict your score before sessions, and override the plan when you have a reason.',
  responsible: 'Review your privacy settings, avoid sharing personal identifiers in chat, and take suggested breaks.',
};

export default function CollabPage() {
  const score = useCollab();
  const events = useStore((s) => s.events);
  const weights = useStore((s) => s.acsWeights);
  const setWeights = useStore((s) => s.setAcsWeights);
  const [open, setOpen] = useState<CollabDimension | null>(null);
  const history = useMemo(() => collabHistory(events, weights).map((h) => ({ ...h, band: [h.lo, h.hi] as [number, number] })), [events, weights]);
  const sensitivity = useMemo(() => weightSensitivity(events), [events]);
  const W = normaliseWeights(weights);
  const custom = COLLAB_DIMENSIONS.some((k) => Math.abs(W[k] - DEFAULT_ACS_WEIGHTS[k]) > 0.001);
  const lowest = [...score.subs].sort((a, b) => a.score - b.score)[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Collaboration Score"
        subtitle="How effectively you work with the AI coach — asking, checking, adapting and staying in charge. It is about the partnership, not about you as a person."
      />

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card>
          <div className="text-[13px] text-ink-2">Your score</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-6xl font-semibold tracking-tight">{Math.round(score.total)}</span>
            <span className="text-ink-2">/ 100</span>
          </div>
          <div className="mt-4">
            <IntervalBar score={score.total} lo={score.lo} hi={score.hi} color="var(--brand)" height={10} />
          </div>
          <div className="mt-2 flex items-center justify-between text-[12.5px] text-ink-2">
            <span>
              80 % interval {Math.round(score.lo)}–{Math.round(score.hi)}
            </span>
            <ConfidenceBadge confidence={score.confidence} compact />
          </div>
          <p className="mt-3 text-[12.5px] text-ink-2">Based on {score.evidence.toFixed(1)} units of evidence from {events.length} logged interactions. New users start at a neutral 50 with a wide interval.</p>
          {custom && <Badge tone="warn" className="mt-2">custom weights</Badge>}
        </Card>

        <Card>
          <CardHeader title="Formula" subtitle="Documented in docs/COLLABORATION_SCORE.md. Weights are the challenge’s design proposal — not a validated standard — so you can change them below." />
          <div className="overflow-x-auto rounded-xl bg-card-2/60 p-3 font-mono text-[12.5px] leading-relaxed">
            ACS = {COLLAB_DIMENSIONS.map((k, i) => `${i ? ' + ' : ''}${W[k].toFixed(2)}·${k[0].toUpperCase()}`).join('')}
            <br />
            S<sub>k</sub> = 100 · (α + Σ wᵢ·xᵢ) / (α + β + Σ wᵢ), α = β = 2
            <br />
            Var(ACS) = Σ W<sub>k</sub>² · Var(S<sub>k</sub>) → 80 % interval
          </div>
          <p className="mt-2 text-[12.5px] text-ink-2">
            Each logged interaction is an <em>opportunity</em> with an outcome x ∈ [0, 1] and an evidence weight w. The Beta prior keeps scores near 50 until there is enough
            evidence, so one click cannot swing the score.
          </p>
        </Card>
      </div>

      <Card>
        <CardHeader title="Components" subtitle={`Room to grow: ${COLLAB_LABEL[lowest.dim].toLowerCase()}. ${TIPS[lowest.dim]}`} />
        <div className="space-y-3">
          {score.subs.map((s) => {
            const expanded = open === s.dim;
            return (
              <div key={s.dim} className="rounded-xl border border-line p-3">
                <button type="button" className="flex w-full flex-wrap items-center gap-3 text-left" onClick={() => setOpen(expanded ? null : s.dim)} aria-expanded={expanded}>
                  <span className="w-44 text-sm font-medium">{COLLAB_LABEL[s.dim]}</span>
                  <span className="text-[12px] text-ink-2">weight {Math.round(W[s.dim] * 100)} %</span>
                  <div className="min-w-[160px] flex-1">
                    <IntervalBar score={s.score} lo={Math.max(0, s.score - 1.28 * s.sd)} hi={Math.min(100, s.score + 1.28 * s.sd)} color="var(--brand)" />
                  </div>
                  <span className="w-10 text-right font-semibold tabular">{Math.round(s.score)}</span>
                  <ChevronDown size={15} className={expanded ? 'rotate-180' : ''} />
                </button>
                {expanded && (
                  <div className="mt-3 space-y-2 border-t border-line pt-3 text-[13px]">
                    <p className="text-ink-2">{COLLAB_DESCRIPTION[s.dim]}</p>
                    {s.opportunities.length ? (
                      <ul className="max-h-56 space-y-1 overflow-y-auto">
                        {[...s.opportunities]
                          .reverse()
                          .slice(0, 25)
                          .map((o, i) => (
                            <li key={i} className="flex items-center justify-between gap-3">
                              <span>
                                {o.label} <span className="text-muted">· {fmtDate(o.at)}</span>
                              </span>
                              <span className="whitespace-nowrap text-[12px] tabular text-ink-2">
                                x = {o.x.toFixed(2)} · w = {o.w}
                              </span>
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <p className="text-ink-2">No evidence yet — this component sits at the neutral prior.</p>
                    )}
                    <p className="rounded-lg bg-brand-soft px-2.5 py-1.5 text-[12.5px]">{TIPS[s.dim]}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Trend" subtitle="End-of-day score with its 80 % interval" />
          {history.length > 1 ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={history} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="at" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(t) => fmtDate(t)} tickLine={false} minTickGap={36} />
                  <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickLine={false} axisLine={false} />
                  <Area dataKey="band" stroke="none" fill="var(--brand)" fillOpacity={0.14} isAnimationActive={false} />
                  <Line dataKey="total" stroke="var(--brand)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Tooltip
                    cursor={{ stroke: 'var(--axis)' }}
                    content={({ active, payload }) =>
                      active && payload?.length ? (
                        <div className="rounded-xl border border-line bg-card px-3 py-2 text-[12.5px] shadow-lg">
                          <div className="text-ink-2">{fmtDate((payload[0].payload as { at: number }).at)}</div>
                          <strong>{Math.round((payload[0].payload as { total: number }).total)}</strong> <span className="text-ink-2">/ 100</span>
                        </div>
                      ) : null
                    }
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="Not enough history yet" />
          )}
        </Card>
        <Card>
          <CardHeader
            title="Weights & sensitivity"
            subtitle="Change the weights to your own view of good collaboration; the table shows how much the score depends on the weighting choice."
            right={
              custom && (
                <Button size="sm" variant="ghost" onClick={() => setWeights({ ...DEFAULT_ACS_WEIGHTS })}>
                  <RotateCcw size={13} /> Reset
                </Button>
              )
            }
          />
          <div className="space-y-2">
            {COLLAB_DIMENSIONS.map((k) => (
              <label key={k} className="grid grid-cols-[150px_1fr_44px] items-center gap-3 text-[13px]">
                <span>{COLLAB_LABEL[k]}</span>
                <input type="range" min={0} max={50} value={Math.round(weights[k] * 100)} onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) / 100 })} className="accent-[var(--brand)]" />
                <span className="text-right tabular text-ink-2">{Math.round(W[k] * 100)} %</span>
              </label>
            ))}
          </div>
          <table className="mt-4 w-full text-[12.5px]">
            <tbody>
              {sensitivity.map((r) => (
                <tr key={r.label} className="border-b border-line/60">
                  <td className="py-1 text-ink-2">{r.label}</td>
                  <td className="py-1 text-right font-medium tabular">{r.total.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
