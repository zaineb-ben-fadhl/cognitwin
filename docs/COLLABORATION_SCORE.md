# AI Collaboration Score (ACS)

**What it measures.** How effectively the user collaborates with the AI coach, on a 0–100 scale: asking for clarification, verifying claims critically, iterating on suggestions, staying autonomous, and using the system responsibly. It describes a *way of working with AI*, not the person. Implementation: `src/engine/collaboration.ts`.

## Formula

```
ACS = 0.20·C + 0.25·V + 0.20·I + 0.20·A + 0.15·R          (weights normalised to sum to 1)

S_k = 100 · (α + Σ_i w_i·x_i) / (α + β + Σ_i w_i)         α = β = 2   (Beta–Bernoulli posterior mean)
Var(S_k) = 100² · a·b / ((a+b)²·(a+b+1))                  a = α + Σ w·x,  b = β + Σ w·(1−x)
Var(ACS) = Σ_k W_k² · Var(S_k)                             → 80 % interval = ACS ± 1.2816·SD
```

- C = clarification, V = critical verification, I = iteration, A = autonomy, R = responsible use.
- Each logged interaction creates one or more **opportunities** *i* with an outcome *x_i* ∈ [0, 1] and an evidence weight *w_i*.
- The Beta(2, 2) prior keeps a new user at a neutral **50 with a wide interval**; one click cannot swing the score, and the confidence label (high SD ≤ 6, moderate ≤ 10, low otherwise) tells the user how much to trust it.
- **Weights are the challenge's design proposal, not a validated standard.** Users can change them in the app; a sensitivity table shows the score under equal weights and with +10 points on each component.

## Indicators

| Event (logged by the app) | Component | x | w | Rationale |
|---|---|---|---|---|
| Opens "Why?" on a coach message / plan item | C, V | 1 | 0.7, 0.4 | Asking for the reasoning and looking at evidence |
| Coach message read with no follow-up | C | 0.4 | 0.15 | Weak "missed opportunity"; outweighed by any engagement |
| Asks the coach a question | C | 0.4 + 0.3·clarifying + 0.3·specificity | 1 | Clarifying ("why", "how sure", "explain", "based on") and specific (dimension, metric, time frame) questions score higher |
| Follow-up refining a previous answer | I | 1 | 0.8 | Iterating on AI output |
| Rates a coach claim against own data | V | 1 if calibrated, else 0.3 | 1 | Calibrated trust: agree with well-supported claims, doubt weakly supported ones |
| "Verify the coach" challenge | V | 1 found / 0 missed | 1.5 | Openly announced AI-literacy game: spot the one deliberately wrong statement |
| Accepts a **low-confidence** suggestion without checking | V, C | 0, 0 | 1, 0.6 | Blind trust where the AI itself is unsure |
| Checks evidence before deciding on a suggestion | V | 1 | 0.7 | |
| Accepts a well-supported suggestion | V | 0.6 | 0.3 | Reasonable trust, small credit |
| Takes a suggestion as-is | I | 0.45 | 0.25 | Fine occasionally; iteration means sometimes refining |
| Dismisses a suggestion without looking at why | V | 0.3 | 0.5 | |
| Modifies a suggestion / edits the plan | I | 1 | 1 | |
| Retries after coaching feedback | I | 1 | 0.8 | |
| Declines a suggestion (with / without a reason) | A | 1 / 0.6 | 0.8 | Staying in charge |
| Overrides the plan with a reason | A | 1 | 1 | |
| Sets an own goal / adopts an AI-suggested goal | A | 1 / 0.5 | 1 / 0.5 | Self-set goals stick better |
| Self-prediction before a session | A | 1 − \|predicted − actual\| / 40 | 1 | Metacognitive calibration — knowing your own level without the AI |
| Session with hints available | A | 1 − min(1, hints/3) | 0.4 | Hint reliance (Pattern Logic) |
| Reads the consent details / reviews privacy | R | 1 | 1 / 0.5 | Informed use |
| Asks a clinical question | R | 0.8 if the redirect is accepted, 0.2 if insisted | 1 | Asking is fine; insisting on a diagnosis from a non-clinical tool is not |
| Shares personal identifiers in chat | R | 0 | 1 | Data hygiene |
| Suggested break taken / skipped | R | 1 / 0.4 | 0.7 | Respecting fatigue signals |
| Random pressing detected | R | 0 | 1 | Honest effort |
| Session of good quality / too noisy | R | 1 / 0.2 | 0.1 / 0.5 | |

## Validation (simulation — `npm run validate`)

Four archetypes generate 40 interactions each, 200 replications:

| Archetype | Mean ACS | 80 % interval width |
|---|---|---|
| Critical collaborator | ≈ 75 | ≈ 15 |
| Balanced new user (only 5 interactions) | ≈ 58 | ≈ 24 (wide: little evidence) |
| Disengaged / careless | ≈ 44 | ≈ 21 |
| Over-reliant (blind trust) | ≈ 41 | ≈ 18 |

The score separates effective collaboration from both failure modes and widens its interval when evidence is scarce. An earlier version ranked the disengaged archetype *above* the over-reliant one because sub-scores without evidence stayed at the prior; weak "missed opportunity" evidence and reliability-gated autonomy credit fixed this.

## Limitations

- Behavioural proxies, not a validated psychometric scale. A study correlating ACS with expert ratings of human–AI collaboration transcripts would be the next step.
- The weights encode a value judgement; the sensitivity table makes that judgement visible.
- Indicators reward behaviours the app can observe; good collaboration that happens outside the app is invisible.
