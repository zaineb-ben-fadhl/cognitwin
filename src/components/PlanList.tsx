import { clsx } from 'clsx';
import { Check, ChevronDown, Play, Shuffle, SkipForward } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DIMENSIONS, PLAN_WEIGHTS, getDimension, type DailyPlan, type PlanItem } from '@/engine';
import { useStore } from '@/store';
import { DimLabel } from './dim';
import { Badge, Button, Modal } from './ui';

const FACTOR_LABEL: Record<string, string> = {
  gap: 'Room to grow',
  uncertainty: 'Uncertainty',
  goal: 'Your goal',
  spacing: 'Spacing',
  momentum: 'Momentum',
  variety: 'Variety',
  preference: 'Your focus',
  fatigue: 'Rotation',
};

function ReasonBars({ item }: { item: PlanItem }) {
  const max = Math.max(...Object.values(PLAN_WEIGHTS));
  return (
    <div className="mt-3 space-y-1.5 rounded-xl bg-card-2/60 p-3">
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-2">Why this activity — utility {item.utility.toFixed(2)}</div>
      {item.reasons.map((r) => (
        <div key={r.factor} className="grid grid-cols-[96px_1fr_44px] items-center gap-2 text-[12.5px]">
          <span className="text-ink-2">{FACTOR_LABEL[r.factor]}</span>
          <div className="relative h-2 rounded-full bg-card">
            <div
              className="absolute inset-y-0 rounded-full"
              style={{ left: r.contribution < 0 ? undefined : 0, right: r.contribution < 0 ? 0 : undefined, width: `${Math.min(100, (Math.abs(r.contribution) / max) * 100)}%`, background: r.contribution < 0 ? 'var(--serious)' : 'var(--brand)' }}
            />
          </div>
          <span className="text-right tabular text-ink-2">{r.contribution >= 0 ? '+' : ''}{r.contribution.toFixed(2)}</span>
          <span className="col-span-3 -mt-1 text-[12px] text-ink-2">{r.text}</span>
        </div>
      ))}
      <p className="pt-1 text-[11.5px] text-muted">Contribution = feature value (0–1) × weight. Weights are documented in Methods.</p>
    </div>
  );
}

function SwapDialog({ item, onClose }: { item: PlanItem; onClose: () => void }) {
  const editPlanItem = useStore((s) => s.editPlanItem);
  const [dim, setDim] = useState<string>(DIMENSIONS.find((d) => d.id !== item.dimension)!.id);
  const [reason, setReason] = useState('');
  const [skip, setSkip] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Change “${getDimension(item.dimension).task.name}”`}>
      <div className="space-y-4 text-sm">
        <p className="text-ink-2">You are in charge — the plan is a suggestion. Telling the coach why helps it learn your preferences (and counts toward autonomy).</p>
        <div className="flex gap-2">
          <Button variant={skip ? 'secondary' : 'primary'} size="sm" onClick={() => setSkip(false)}>
            <Shuffle size={14} /> Swap
          </Button>
          <Button variant={skip ? 'primary' : 'secondary'} size="sm" onClick={() => setSkip(true)}>
            <SkipForward size={14} /> Skip today
          </Button>
        </div>
        {!skip && (
          <select value={dim} onChange={(e) => setDim(e.target.value)} className="w-full rounded-xl border border-line bg-card px-3 py-2">
            {DIMENSIONS.filter((d) => d.id !== item.dimension).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — {d.task.name}
              </option>
            ))}
          </select>
        )}
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          rows={2}
          placeholder="Optional: why? e.g. “I have an exam that needs focus”"
          className="w-full rounded-xl border border-line bg-card px-3 py-2"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              editPlanItem(item.id, skip ? null : dim, reason.trim() || undefined);
              onClose();
            }}
          >
            Confirm
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function PlanList({ plan, showChanges = true }: { plan: DailyPlan; showChanges?: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlanItem | null>(null);
  const logEvent = useStore((s) => s.logEvent);
  return (
    <div className="space-y-2.5">
      <p className="text-[13px] text-ink-2">{plan.rationale}</p>
      {plan.items.map((item) => {
        const d = getDimension(item.dimension);
        const expanded = open === item.id;
        return (
          <div key={item.id} className={clsx('rounded-xl border border-line p-3', item.done && 'opacity-60')}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <DimLabel id={item.dimension} />
              <span className="text-[13px] text-ink-2">{d.task.name}</span>
              <Badge tone={item.mode === 'assessment' ? 'brand' : 'neutral'}>{item.mode === 'assessment' ? 'Check-in' : `Training · from level ${item.level}`}</Badge>
              <span className="text-[12px] text-ink-2">~{item.minutes} min</span>
              {item.userEdited && <Badge>edited by you</Badge>}
              <div className="ml-auto flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={expanded}
                  onClick={() => {
                    if (!expanded) logEvent('why_opened', { confidence: 'high', source: 'plan' });
                    setOpen(expanded ? null : item.id);
                  }}
                >
                  Why? <ChevronDown size={13} className={clsx(expanded && 'rotate-180')} />
                </Button>
                {!item.done && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(item)}>
                    Change
                  </Button>
                )}
                {item.done ? (
                  <Badge tone="good">
                    <Check size={12} /> Done
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      logEvent('recommendation_response', { response: 'accepted', confidence: item.mode === 'assessment' ? 'low' : 'moderate', evidenceViewed: expanded });
                      navigate(`/session/${item.taskId}?mode=${item.mode}&plan=${item.id}`);
                    }}
                  >
                    <Play size={13} /> Start
                  </Button>
                )}
              </div>
            </div>
            {!expanded && item.reasons[0] && <p className="mt-1.5 text-[12.5px] text-ink-2">{item.reasons[0].text}</p>}
            {expanded && <ReasonBars item={item} />}
          </div>
        );
      })}
      {showChanges && plan.changes.length > 0 && (
        <div className="rounded-xl bg-card-2/60 p-3 text-[12.5px] text-ink-2">
          <div className="mb-1 font-semibold text-ink">How the plan evolved</div>
          <ul className="list-disc space-y-0.5 pl-4">
            {plan.changes.slice(-4).map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {editing && <SwapDialog item={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
