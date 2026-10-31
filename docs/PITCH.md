# Pitch outline — 15 slides, 8 minutes

Timing budget: ~30 s per slide, demo moment 60 s. Each slide: one message, one visual.

| # | Slide | Message (what the jury must remember) | Visual | Time |
|---|---|---|---|---|
| 1 | **CogniTwin** | A cognitive growth agent with an honest Brain Twin. | Logo + Today screenshot | 0:00 |
| 2 | The problem | One-time tests, apps that overclaim, black-box AI coaches, drift into clinical language. | Four "pain" tiles | 0:20 |
| 3 | Our answer | Assess · Understand · Coach · Improve — facts from a tested engine, language from AI, uncertainty everywhere. | 4-pillar diagram | 0:45 |
| 4 | Assess | 6 language-free, procedurally generated tasks; adaptive check-ins stop when precise; device calibration for fairness. | Task tiles (Target Hunt, Pattern Logic…) | 1:15 |
| 5 | Understand | Bayesian IRT → percentage + 80 % interval; Brain Twin drifts when a skill isn't practised and keeps every snapshot. | Radar with uncertainty ring + replay slider | 1:50 |
| 6 | Demo moment | One session: adaptive difficulty path, before/after interval, coach feedback with "Why?". | Session results screenshot / 40 s live | 2:25 |
| 7 | Coach | Engine decides → AI phrases → guardrails verify. Clinical-language, numeric-evidence and certainty checks; semantic correctness still needs review. | Pipeline + "Why?" panel | 3:20 |
| 8 | Improve | 80 % target success; transparent utility planner with reasons and plan diffs; goals → weekly milestones. | Plan "Why?" bars | 3:55 |
| 9 | Predictive growth | Bayesian learning curves as fans; goal chance labelled as an estimate. 89 % coverage. | Progress chart with fan | 4:30 |
| 10 | AI Collaboration Score | 20/25/20/20/15, Beta-smoothed, with an interval and a sensitivity table; Verify-the-coach game. | Collaboration page | 5:00 |
| 11 | Emotion-aware & voice, responsibly | Working state from behaviour + self-report + optional on-device camera; the camera can never decide alone. | Fusion diagram | 5:35 |
| 12 | Trust by design | Local-first, granular consent, retention, export, delete-all, non-biometric default. | Privacy page | 6:05 |
| 13 | Validation | r ≈ 0.9 from one check-in; −30 % error with CAT; 73 % vs 33 % coverage; 99 % noise detection. | Results table | 6:35 |
| 14 | Generalisation & robustness | New dimension = 3 files; offline; storage/LLM fallbacks; 127 automated tests; CI workflow provided. | Extension diagram | 7:05 |
| 15 | Thank you | Limitations we know; what's next; repo link. | QR + repo | 7:35 |

## Speaker notes (condensed)

1. "Imagine a fitness tracker for thinking skills that tells you not just a number, but how sure it is — and why."
2. "Cognitive tests give one number, once. Brain-training apps overclaim. AI coaches invent things. And it's easy to slide into medical language. We designed against all four."
3. "Our rule: facts come from a deterministic, tested engine; language comes from AI; uncertainty is shown everywhere."
4. "Six tasks, one per dimension, no words, generated fresh every time. Check-ins are adaptive — they stop as soon as the estimate is precise. A 20-second calibration makes timing fair on any device."
5. "Every trial updates a Bayesian model. You see a percentage *and* an 80 % interval. If you stop practising, the twin becomes less sure — honestly. Every session is a snapshot you can replay."
6. Live: run 20 s of Arrow Focus, show the difficulty path, the interval narrowing, then click "Why?".
7. "The coach can only talk about insights the engine found, with evidence. A safety layer blocks clinical words, numbers not in your data and promises about the future. If the AI fails, the rule-based coach answers."
8. "Training keeps you around 80 % success — hard enough to learn. The plan is a transparent formula; click 'Why?' and you see each weight."
9. "Projections are fans, not lines. In simulation, our 80 % band contained the real future level 89 % of the time."
10. "The AI Collaboration Score rewards asking why, checking claims, adapting suggestions, staying autonomous and using AI responsibly. New users start at 50 with a wide interval; weights are editable because they're a proposal."
11. "Emotion-aware, but honest: faces aren't emotions. Camera cues are on-device, aggregated, low-weight, and can never decide alone — we test that."
12. "Optional AI narration sends aggregates and filtered conversation text. Some browser voices use vendor services. Export, delete, choose retention."
13. "We validated the machinery with synthetic users of known ability." (read 4 numbers)
14. "Adding a dimension touches three files; the twin, planner, coach and docs pick it up. It runs offline, survives storage and AI failures, and 127 automated tests pass locally; a CI workflow is ready."
15. "We know the limits — item calibration with real users is next. Thank you."
