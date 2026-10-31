# Architecture

CogniTwin is a **local-first web application** with a pure-TypeScript cognitive engine and an optional, stateless API server for the LLM narrative layer.

```
┌──────────────────────────── Browser (React 18 + Vite) ─────────────────────────────┐
│                                                                                    │
│  Pages: Today · Train · Session · Brain Twin · Coach · Goals · Collaboration ·     │
│         Methods · Privacy                                                          │
│                                                                                    │
│  ┌──────────── src/engine (pure TS, no DOM, automated tests) ─────────────────┐  │
│  │ A  tasks/*        procedural, language-free stimuli · 10-level ladders        │  │
│  │    adaptive.ts    CAT (assessment) / target-success (training) controller     │  │
│  │    quality.ts     interruptions · anticipations · random pressing → weight    │  │
│  │    affect.ts      working-state fusion (behaviour + self-report + camera cap) │  │
│  │ U  irt.ts         Bayesian IRT posterior on a grid · mastery % · 80 % CI      │  │
│  │    twin.ts        Brain Twin: drift, snapshots, replay                        │  │
│  │    insights.ts    evidence-backed detectors                                   │  │
│  │ B  coach/*        templates · intents · guardrails · LLM context · verify     │  │
│  │ C  planner.ts     utility plan + reasons + diffs · milestones                 │  │
│  │    projection.ts  Bayesian growth curve, fan chart, goal probability          │  │
│  │    collaboration.ts  AI Collaboration Score (Beta-smoothed, with interval)    │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│  store/ (zustand) ── persisted to IndexedDB (→ localStorage → memory fallback)     │
│  lib/   coachClient (hybrid) · voice (Web Speech) · camera (MediaPipe, on-device)  │
└──────────────────────────────────────┬─────────────────────────────────────────────┘
                                       │ only if the user opted in: de-identified
                                       │ aggregates + filtered conversation text
                              ┌────────▼─────────┐        ┌────────────────────┐
                              │ server/ (Hono)   │───────►│ Claude API          │
                              │ stateless proxy, │        │ structured output,  │
                              │ guardrails, rate │◄───────│ server-side fallback│
                              │ limit, no logs   │        └────────────────────┘
                              └──────────────────┘
```

## Key decisions (ADR summary)

| # | Decision | Alternatives considered | Why |
|---|---|---|---|
| 1 | **Deterministic engine produces every fact; the LLM only phrases** | LLM analyses raw data end-to-end | Explainability (every claim has evidence), safety (numeric checks against cited source evidence), robustness (works offline), testability (127 automated tests + simulation). |
| 2 | **Bayesian item-response model on a grid** | Raw accuracy %; Elo; neural knowledge tracing | Gives a calibrated *uncertainty* for free (required by the brief), handles adaptive difficulty correctly (accuracy at different levels is not comparable), interpretable parameters, no training data needed. Grid posterior is exact for one dimension and fast (181 points). |
| 3 | **Criterion-referenced % (mastery of the task ladder)** | Percentile vs population; IQ-like scale | No normative data exists, and population comparison drifts toward clinical/judgemental framing. Mastery % is intuitive and honest. |
| 4 | **Brain Twin = Gaussian state + drift + full snapshots** | Store only the latest score; full particle filter | Drift keeps uncertainty honest and lets the twin follow learning (validated: 73 % vs 33 % interval coverage). Snapshots give the mandatory history and replay. |
| 5 | **Computerised adaptive testing for check-ins** | Fixed-length staircase | ~30 % lower estimation error for the same number of trials (validated). Stops early when precise → shorter sessions. |
| 6 | **Utility-based planner with visible reasons** | Black-box recommender; fixed curriculum | Every plan item is explained as weight × feature; plan diffs explain *why the plan evolved*. |
| 7 | **Local-first storage, no accounts** | Cloud database | Privacy by design, no breach surface, works offline, GDPR / Tunisian law 2004-63 data minimisation. Export/import gives portability. |
| 8 | **Hybrid coach (rules + optional LLM) with server-side guardrails** | Rules only; LLM only | Rules provide a local fallback and a constrained scope; the LLM adds personal, varied language when allowed. Guardrails run on both. |
| 9 | **Camera is optional, on-device and capped** | Emotion recognition from faces | Facial movements are unreliable emotion readouts (Barrett et al., 2019) and are biometric data. Cues are aggregated, never stored as images, and cannot decide alone (unit-tested). |
| 10 | **Hash routing + relative base** | Server routing | The static build runs anywhere (GitHub Pages or a local HTTP file server) — robustness for demos and judging. |

## Data flow of one session

1. **Plan** → `planner.generateDailyPlan` picks the dimension and mode, with reasons.
2. **Prior** → `twin.sessionPrior` (stored belief + inactivity drift + per-session noise).
3. **Trials** → `AdaptiveSession.nextLevel` → `task.generate(level)` → UI view → `module.evaluate` → `Trial` (correct, success-within-window, RT, condition, error type, weight).
4. **Live adaptation** → posterior updated after every trial; training eases off on strain (`affect.liveStrain`).
5. **Finalise** → `session.finalizeSession`: quality weight, posterior, score with interval, metrics, working state.
6. **Twin** → `twin.applySession` appends a snapshot. Goals checked, plan regenerated and diffed.
7. **Coach** → `insights.sessionInsights` → `templates.sessionFeedback` (→ optional LLM rephrase under guardrails).

## Generalisation: adding a dimension

The engine never hard-codes the dimension list.

1. Write `src/engine/tasks/<name>.ts` implementing `TaskSpec` (generator, deadlines, level descriptions, metrics, simulation profile).
2. Add one `DimensionDoc` entry in `src/engine/dimensions.ts` (definition, scoring, uncertainty, biases, strategies, references).
3. Add a view in `src/components/tasks/` and register it in `TASK_MODULES`.

The twin (`ensureDimensions`), planner, insights, coach, projections, docs generator (`npm run docs`) and validation script pick it up automatically. Existing users' data stays valid: missing dimensions are added at load time with the population prior.

## Robustness measures

- Storage fallback chain (IndexedDB → localStorage → memory); schema versioning and a `merge` step for forward compatibility.
- Imports are untrusted: zod-validated, size-capped, and the twin is **rebuilt from sessions** rather than trusted.
- Session interruptions: focus loss is detected, affected trials weigh 0.3, the session is flagged.
- Random pressing detection (99 % detected / 0 % false alarms in simulation), weight 0.2.
- LLM failures (no key, network, refusal, rate limit, unsafe draft): automatic fallback to the template coach, reported in the "Why?" panel.
- Retention policy runs on start; deleting a session replays the remaining history.
- CI: typecheck, tests, validation, docs drift check, build.

## Tech stack

React 18, TypeScript 5 (strict), Vite 6, Tailwind CSS 4, Recharts 2 (line/area charts; radar and heatmaps are custom SVG), zustand + idb-keyval, zod, lucide icons, MediaPipe Tasks Vision (optional, lazy-loaded), Hono (server), `@anthropic-ai/sdk`, Vitest. The lockfile pins installed versions; audit status is recorded in the dated check-up.
