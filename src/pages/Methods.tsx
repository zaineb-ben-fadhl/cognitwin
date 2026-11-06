import { ChevronDown, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { DimLabel } from '@/components/dim';
import { Badge, Button, Card, CardHeader, PageHeader } from '@/components/ui';
import {
  CLINICAL_TERMS,
  DIMENSIONS,
  DRIFT_PER_DAY,
  DRIFT_PER_SESSION,
  FATIGUE_PENALTY,
  GENERAL_REFERENCES,
  ASYMMETRY_GAP,
  PLAN_WEIGHTS,
  PLATEAU_MAX_RANGE,
  PLATEAU_MAX_SLOPE,
  PLATEAU_WINDOW,
  POPULATION_PRIOR,
  RAPID_FRACTION,
  TIER_LIMITS,
  TRAINING_FORMATS,
  TARGET_SUCCESS,
  THETA_GRID,
  posteriorDensity,
  scoreSummary,
  summariseDensity,
  type Observation,
} from '@/engine';

function PosteriorDemo() {
  const task = DIMENSIONS[2].task;
  const [obs, setObs] = useState<Observation[]>([]);
  const [level, setLevel] = useState(5);
  const dens = useMemo(() => posteriorDensity(POPULATION_PRIOR, obs, task), [obs, task]);
  const g = summariseDensity(dens);
  const s = scoreSummary(g, task);
  const w = 520;
  const h = 130;
  const max = Math.max(...dens);
  const x = (th: number) => ((th + 4.5) / 9) * w;
  const path = THETA_GRID.map((th, i) => `${i ? 'L' : 'M'}${x(th)},${h - (dens[i] / max) * (h - 10)}`).join(' ');
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink-2">
        Try it: pick a difficulty level and record a success or a miss. Watch the belief about ability (curve) move and narrow, and the score interval shrink. This is exactly the
        computation every exercise runs after each trial.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[13px]">
          Level
          <input type="range" min={1} max={10} value={level} onChange={(e) => setLevel(Number(e.target.value))} className="w-32 accent-[var(--brand)]" />
          <span className="w-5 tabular">{level}</span>
        </label>
        <Button size="sm" onClick={() => setObs((o) => [...o, { level, success: true }])}>
          ✓ success
        </Button>
        <Button size="sm" onClick={() => setObs((o) => [...o, { level, success: false }])}>
          ✗ miss
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setObs([])}>
          <RotateCcw size={13} /> reset
        </Button>
      </div>
      <svg viewBox={`0 0 ${w} ${h + 18}`} className="w-full max-w-[640px]" role="img" aria-label="Posterior distribution of ability">
        <line x1={0} x2={w} y1={h} y2={h} stroke="var(--axis)" />
        {[-4, -2, 0, 2, 4].map((t) => (
          <text key={t} x={x(t)} y={h + 13} fontSize={10} textAnchor="middle" fill="var(--muted)">
            θ {t}
          </text>
        ))}
        <path d={`${path} L${w},${h} L0,${h} Z`} fill="var(--brand)" fillOpacity={0.12} />
        <path d={path} fill="none" stroke="var(--brand)" strokeWidth={2} />
        <line x1={x(g.mean)} x2={x(g.mean)} y1={8} y2={h} stroke="var(--ink-2)" strokeWidth={1} />
      </svg>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
        <span>
          Trials: <strong>{obs.length}</strong>
        </span>
        <span>
          θ = <strong>{(Math.abs(g.mean) < 0.005 ? 0 : g.mean).toFixed(2)}</strong> ± {g.sd.toFixed(2)}
        </span>
        <span>
          Score <strong>{Math.round(s.score)} %</strong> (80 % interval {Math.round(s.lo)}–{Math.round(s.hi)})
        </span>
        <Badge>{s.confidence} confidence</Badge>
      </div>
    </div>
  );
}

function Architecture() {
  const box = 'rounded-xl border border-line bg-card px-3 py-2 text-[12.5px]';
  return (
    <div className="grid gap-3 text-center md:grid-cols-4">
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">A · Assess</div>
        <div className={box}>6 procedurally generated tasks</div>
        <div className={box}>Adaptive controller (CAT / target success)</div>
        <div className={box}>Behaviour & data-quality capture</div>
        <div className={box}>Optional camera / voice (on-device)</div>
      </div>
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">Understand</div>
        <div className={box}>Bayesian IRT posterior per dimension</div>
        <div className={box}>Brain Twin: drift + full snapshot history</div>
        <div className={box}>Insight detectors with evidence</div>
        <div className={box}>Working-state fusion (camera capped)</div>
      </div>
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">B · Coach</div>
        <div className={box}>Rule-based NLG (offline, always on)</div>
        <div className={box}>Optional LLM narrative on de-identified aggregates</div>
        <div className={box}>Guardrails: clinical lexicon · number grounding · no certainty</div>
        <div className={box}>“Why?” evidence on every message</div>
      </div>
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">C · Improve</div>
        <div className={box}>Utility-based daily plan with reasons</div>
        <div className={box}>Goals → weekly milestones</div>
        <div className={box}>Bayesian growth projections (fan)</div>
        <div className={box}>AI Collaboration Score</div>
      </div>
    </div>
  );
}

export default function MethodsPage() {
  const [open, setOpen] = useState<string | null>(DIMENSIONS[0].id);
  return (
    <div className="space-y-6">
      <PageHeader title="Methods & transparency" subtitle="How every number in CogniTwin is produced, what it means, how uncertain it is, and where it can be biased." />

      <Card>
        <CardHeader title="Architecture" subtitle="A deterministic, testable engine produces every fact; language models only phrase them, under guardrails." />
        <Architecture />
      </Card>

      <Card>
        <CardHeader title="Measurement model" subtitle="Bayesian item-response model over a 10-level difficulty ladder per task" />
        <div className="mb-4 overflow-x-auto rounded-xl bg-card-2/60 p-3 font-mono text-[12.5px] leading-relaxed">
          P(success | θ, level) = c + (1 − c) · σ(a · (θ − b<sub>level</sub>)), b ∈ [−2.25, 2.25]
          <br />
          posterior(θ) ∝ N(θ; μ<sub>prior</sub>, σ<sub>prior</sub>) · Π P(outcome<sub>i</sub>)^w<sub>i</sub> (grid, 181 points)
          <br />
          score = 100 · mean<sub>levels</sub> σ(a · (θ − b<sub>level</sub>)) — expected mastery of the ladder
          <br />
          Twin drift: σ² += {DRIFT_PER_DAY} per idle day, + {DRIFT_PER_SESSION} per session (capped at the population prior σ = {POPULATION_PRIOR.sd})
        </div>
        <PosteriorDemo />
      </Card>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Dimensions — definition, task, scoring, uncertainty, biases</h2>
        {DIMENSIONS.map((d) => {
          const expanded = open === d.id;
          return (
            <Card key={d.id} className="p-0">
              <button type="button" className="flex w-full items-center justify-between gap-3 p-4 text-left" onClick={() => setOpen(expanded ? null : d.id)} aria-expanded={expanded}>
                <span className="flex items-center gap-3">
                  <DimLabel id={d.id} short={false} />
                  <span className="text-[13px] text-ink-2">{d.task.name}</span>
                </span>
                <ChevronDown size={16} className={expanded ? 'rotate-180' : ''} />
              </button>
              {expanded && (
                <div className="grid gap-5 border-t border-line p-4 text-[13.5px] lg:grid-cols-2">
                  <div className="space-y-3">
                    <section>
                      <h3 className="font-semibold">Definition</h3>
                      <p className="text-ink-2">{d.definition}</p>
                      <p className="mt-1 text-ink-2">
                        <em>Everyday examples:</em> {d.everyday.join('; ')}.
                      </p>
                      <p className="mt-1 text-ink-2">
                        <em>What it is not:</em> {d.notThis}
                      </p>
                    </section>
                    <section>
                      <h3 className="font-semibold">Task — {d.task.name}</h3>
                      <ul className="list-disc pl-5 text-ink-2">
                        {d.task.instructions.map((i: string) => (
                          <li key={i}>{i}</li>
                        ))}
                      </ul>
                      <table className="mt-2 w-full text-[12px]">
                        <tbody>
                          {[1, 3, 5, 7, 10].map((l) => (
                            <tr key={l} className="border-b border-line/60">
                              <td className="py-1 pr-2 text-ink-2">Level {l}</td>
                              <td className="py-1">{d.task.levelDescription(l)}</td>
                              <td className="py-1 text-right tabular text-ink-2">{(d.task.deadlineMs(l) / 1000).toFixed(1)} s</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-1 text-[12px] text-muted">
                        Model parameters: a = {d.task.discrimination}, c = {d.task.guessing}; check-in {d.task.assessment.minTrials}–{d.task.assessment.maxTrials} trials (stops at σ ≤{' '}
                        {d.task.assessment.targetSd}); training {d.task.trainingTrials} trials. Windows shown before personal calibration.
                      </p>
                    </section>
                    <section>
                      <h3 className="font-semibold">Scoring</h3>
                      <p className="text-ink-2">{d.scoring}</p>
                    </section>
                    <section>
                      <h3 className="font-semibold">Uncertainty</h3>
                      <p className="text-ink-2">{d.uncertainty}</p>
                    </section>
                  </div>
                  <div className="space-y-3">
                    <section>
                      <h3 className="font-semibold">Possible biases & mitigations</h3>
                      <table className="w-full text-[12.5px]">
                        <tbody>
                          {d.biases.map((b) => (
                            <tr key={b.bias} className="border-b border-line/60 align-top">
                              <td className="py-1.5 pr-3 font-medium">{b.bias}</td>
                              <td className="py-1.5 text-ink-2">{b.mitigation}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                    <section>
                      <h3 className="font-semibold">Coaching strategies</h3>
                      <ul className="space-y-1 text-ink-2">
                        {d.strategies.map((s) => (
                          <li key={s.key}>
                            <strong className="text-ink">{s.title}.</strong> {s.detail} {s.source && <span className="text-muted">({s.source})</span>}
                          </li>
                        ))}
                      </ul>
                    </section>
                    <section>
                      <h3 className="font-semibold">References</h3>
                      <ul className="space-y-1 text-[12px] text-ink-2">
                        {d.references.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </section>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Adaptive learning" />
          <div className="space-y-2 text-[13px] text-ink-2">
            <p>
              <strong className="text-ink">Within a session.</strong> Check-ins pick the most informative level (computerised adaptive testing) and stop when precise. Training
              keeps success near the chosen target (gentle {TARGET_SUCCESS.gentle * 100} %, balanced {TARGET_SUCCESS.balanced * 100} %, stretch {TARGET_SUCCESS.stretch * 100} %),
              never jumps more than two levels, eases after two misses in a row, and temporarily raises the target by 8 points when strain builds up.
            </p>
            <p>
              <strong className="text-ink">Across days.</strong> The daily plan ranks dimensions by utility = Σ weight × feature:
            </p>
            <table className="w-full text-[12.5px]">
              <tbody>
                {Object.entries(PLAN_WEIGHTS).map(([k, v]) => (
                  <tr key={k} className="border-b border-line/60">
                    <td className="py-1 capitalize">{k}</td>
                    <td className="py-1 text-right tabular">{v.toFixed(2)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-1">fatigue (≥ 2 sessions today)</td>
                  <td className="py-1 text-right tabular">−{FATIGUE_PENALTY.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHeader title="Coach safety & emotion-awareness" />
          <div className="space-y-2 text-[13px] text-ink-2">
            <p>
              <strong className="text-ink">Guardrails.</strong> {CLINICAL_TERMS.length} clinical / diagnostic term patterns are checked in AI replies and suggestions. Numbers must match cited evidence,
              references must exist, and confidence cannot exceed the source. These checks do not prove semantic accuracy. Common identifiers are filtered before AI calls,
              but personal details may remain in free text. Health-condition questions and distress use fixed replies.
            </p>
            <p>
              <strong className="text-ink">Working state.</strong> Behaviour (always), self-report and camera cues (optional) are fused with weights 1.0 / 0.8 / 0.4. A state is
              reported only if at least 0.3 of its support comes from non-camera sources — the camera can never decide alone, and the state only changes tone, breaks and training
              difficulty, never a score. Facial movements are not treated as emotions (Barrett et al., 2019).
            </p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Validation (simulation)" subtitle="Run `npm run validate` to reproduce; full tables in docs/VALIDATION.md" />
        <ul className="grid gap-2 text-[13px] text-ink-2 sm:grid-cols-2">
          <li>One adaptive check-in recovers known abilities with r ≈ 0.88–0.91 and 80 % intervals that contain the truth ~74–83 % of the time.</li>
          <li>Adaptive item selection reduces estimation error by ~27–32 % versus random levels with the same number of trials.</li>
          <li>Brain Twin drift keeps tracking honest during learning: interval coverage 73 % vs 33 % for a model that never forgets.</li>
          <li>14-day projections: the 80 % band contained the true future level 89 % of the time (cautious by design).</li>
          <li>Training targeting: observed success within ~2 points of the gentle / balanced / stretch targets.</li>
          <li>Random-pressing detector: 100 % detected, 0 % false alarms on genuine simulated users.</li>
          <li>Button masher on all six tasks: 100 % flagged, 0 % of genuine or flawless users flagged; the estimate barely moves (naive scoring drops it by ~1 logit).</li>
        </ul>
      </Card>

      <Card>
        <CardHeader title="Robustness to edge cases" subtitle="Each mechanism is reproducible in the Robustness lab and covered by regression tests" />
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-ink-2">
          <li>
            <strong className="text-ink">Rapid guessing (“button masher”).</strong> Answers faster than {RAPID_FRACTION * 100} % of the typical time at their level and no better than guessing
            are removed from the likelihood (effort-moderated scoring, Wise &amp; DeMars 2006); the rest counts 20 % and the posterior may not shrink, so the session is flagged as highly
            uncertain instead of a drop. The coach asks, live and afterwards, whether you were distracted or rushing.
          </li>
          <li>
            <strong className="text-ink">Plateaus.</strong> Flat over the last {PLATEAU_WINDOW} sessions (spread ≤ {PLATEAU_MAX_RANGE} pts, trend within ±{PLATEAU_MAX_SLOPE} pt/session) → the
            planner rotates the practice format: {(['stretch', 'interleaved', 'strategy'] as const).map((f) => TRAINING_FORMATS[f].name).join(' → ')}. Formats change level selection, never
            scoring.
          </li>
          <li>
            <strong className="text-ink">Asymmetric profiles.</strong> Difficulty tier per dimension from its own estimate (foundational ≤ {TIER_LIMITS.foundational} %, advanced ≥{' '}
            {TIER_LIMITS.advanced} %); a gap ≥ {ASYMMETRY_GAP} pts with non-overlapping intervals puts both ends in the plan. Nothing is averaged across dimensions.
          </li>
          <li>
            <strong className="text-ink">Pushback.</strong> A disputed session counts 50 % and its posterior gets extra variance; the reasoned challenge is credited to critical verification
            and iteration (diminishing for repeats) and can be undone.
          </li>
          <li>
            <strong className="text-ink">Forecasts.</strong> Always an 80 % range with a probability, never one number; a guardrail blocks “will be N %” phrasing in every coach message,
            and nothing is forecast beyond 90 days.
          </li>
          <li>
            <strong className="text-ink">“Why this exercise?”</strong> Answered from the Brain Twin charts (session log, progress curve, weekly heatmap, radar, calendar, goals), each with its
            numbers and a link.
          </li>
        </ul>
        <Link to="/lab" className="mt-3 inline-block text-[13px] font-medium text-brand">
          Open the Robustness lab →
        </Link>
      </Card>

      <Card>
        <CardHeader title="Limitations (stated honestly)" />
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-2">
          <li>Difficulty parameters are expert-set priors, not yet calibrated on real participants; a pilot study would fit them with a Rasch model.</li>
          <li>Simulation validates the machinery, not construct validity. Scores describe these exercises; transfer to daily life is not assumed (see “Everyday missions”).</li>
          <li>Practice effects inflate task-specific gains; the coach frames progress as task progress.</li>
          <li>The working-state estimate is coarse and can be wrong; that is why it never changes scores.</li>
          <li>The AI Collaboration Score weights are a design proposal; the sensitivity table shows how much they matter.</li>
        </ul>
      </Card>

      <Card>
        <CardHeader title="General references" />
        <ul className="space-y-1 text-[12.5px] text-ink-2">
          {GENERAL_REFERENCES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
