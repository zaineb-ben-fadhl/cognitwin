# Phase 2 surprise scenarios — how CogniTwin handles them

The six anomalies and edge cases announced for the final defence, each mapped to the mechanism, the code, the tests and a one-click demo. Every scenario can be reproduced from the in-app **Robustness lab** (`/lab`). It loads a synthetic learner played through the real engine and planner (labelled demo data), and its **Run self-check** button re-runs the assertions live in the browser.

Regression tests: [`src/engine/__tests__/jury-scenarios.test.ts`](../src/engine/__tests__/jury-scenarios.test.ts) (33 tests), plus UI tests in [`src/pages/pages.test.tsx`](../src/pages/pages.test.tsx).

| # | Scenario | Tests | Mechanism | Code |
|---|---|---|---|---|
| 1 | Button masher | Layer A | Rapid-guess detection, effort-moderated scoring, uncertainty inflation, live and post-session coach check-in | `quality.ts`, `session.ts`, `TaskRunner.tsx`, `Session.tsx` |
| 2 | Stagnation plateau | Layer C | Plateau detector, rotation of practice formats, strategy focus | `formats.ts`, `planner.ts`, `adaptive.ts` |
| 3 | "Why" audit | Explainability | Chart-backed justifications with numbers and links | `explain.ts`, `heatmaps.ts`, `coach/chat.ts` |
| 4 | Pushback | AI Collaboration Score | Session dispute: 50 % weight, extra variance, verification and iteration credit | `pushback.ts`, `collaboration.ts`, `Coach.tsx` |
| 5 | Fortune teller | Brain Twin certainty | Ranges and probabilities for the horizon asked, plus a forecast guardrail | `coach/chat.ts`, `coach/guardrails.ts` |
| 6 | Asymmetrical mind | Generalisation | Difficulty tier per dimension, asymmetry detector, radar split | `tiers.ts`, `planner.ts`, `ProfileRadar.tsx` |

## 1. The "Button Masher" (Layer A)

**Detection.** A response is *rapid* when it is faster than 30 % of the typical response time at its level (floor 150 ms). This is the normative-threshold method of Wise & Ma (2012). A session is flagged when at least 4 responses (≥ 30 %) are rapid **and** the rapid responses are no better than guessing (≤ 60 % correct). Fast *and accurate* responding is genuine skill and is never flagged. On two-choice tasks, a coin-flip hit rate at a fast pace is flagged as random pressing.

**Measurement.** Rapid guesses are removed from the likelihood (effort-moderated scoring, Wise & DeMars 2006). The remaining answers keep a floor weight of 20 %. The posterior may not shrink: its sd is at least the prior sd plus extra variance (0.1 + 0.3 × rapid share). The session therefore makes the Brain Twin **less certain** instead of recording a drop in ability.

**Coach.** During the session, after a burst of rapid, mostly wrong answers, the activity pauses. The coach asks "Are you distracted, or rushing?" with four answers: rushing, distracted (stays paused), keep going, stop. After the session, a "Data flagged as highly uncertain" card asks again and records the answer. An honest answer counts toward *responsible use*.

**Validation** (`npm run validate`, [VALIDATION.md](VALIDATION.md) §6). The test pits an established profile against a mashed check-in, on all six tasks:

- **Detection:** 100 % of masher sessions flagged, 0 % of genuine users and 0 % of flawless fast users (θ = +3).
- **Estimate:** the mean drop in θ is 0.0–0.33, against 0.64–1.24 with naive scoring.
- **Uncertainty:** the posterior sd grows from 0.35 to about 0.5–0.7.

## 2. The Stagnation Plateau (Layer C)

**Detection.** Over the last 5 sessions, the estimate must have a spread of at most 8 points and an OLS trend within ±1 point per session. This means flat, not just noisy. Floors (≤ 8 %) and ceilings (≥ 92 %) are excluded: there the tier handles difficulty.

**Response.** The planner stops feeding the same exercise the same way. It rotates the practice format while the plateau lasts:

- **Stretch:** about 68 % target success (challenge-point framework, Guadagnoli & Lee 2004).
- **Mixed levels:** difficulty jumps around the target level (contextual interference, Shea & Morgan 1979).
- **Strategy focus:** the usual difficulty plus one new strategy from the dimension's library. Afterwards the user is asked whether it helped.

Formats change level selection only, never scoring, so the measurement model stays valid. The plan shows a "Plateau" reason with its numbers, and the coach explains the change ("I feel stuck…").

## 3. The "Why" Audit (explainability)

"Why did you assign me this specific exercise today?" (also "why this exercise?", "why did you pick Arrow Focus?", "why not Attention?"). The coach answers from the Brain Twin data. Each fact names its chart, carries its numbers and links to it:

- **Session log:** e.g. "your median response time rose 20 % (4709 → 5664 ms) compared with your previous 3 sessions", or a change in on-time success.
- **Progress curve:** the trend or plateau.
- **Weekly heatmap:** this week's cell, ranked against the other areas.
- **Radar:** the score, the 80 % interval and whether it is the widest.
- **Practice calendar:** the spacing since the last session.
- **Goals:** the goal this item serves.

It then gives the planner utility, the rank, the runner-up and the top weighted factors. The same facts appear in the plan's "Why?" panel. The heatmap numbers come from the same engine functions as the charts.

## 4. The Pushback (AI Collaboration Score)

"I disagree — my score dropped because I was distracted by noise." The coach does not defend the profile:

- **Revise the profile.** The session the user refers to is marked as disputed (reason, note, reversible). It keeps its data but counts 50 %, and its posterior gets +0.12 logit² of variance. The twin is rebuilt, so the dimension's interval widens. When uncertainty crosses the threshold, the plan schedules a re-check.
- **Reward the challenge.** The pushback is credited to the weighted *critical verification* (x = 1, w = 2) and *iteration* (x = 1, w = 1.5) components. That is as strong as finding the flaw in "Verify the coach". Repeated disputes in a week earn less (w / (1 + 0.5·n)), so the score cannot be farmed.
- **Show the numbers.** The reply quotes the exact before → after values: the estimate and interval, the session weight, the ACS and both sub-scores.

On a long history one challenge moves the total by under a point, and the reply says why. On a new profile it moves it by several points.

The same dispute is available from the session results ("Disagree with this result") and from the Brain Twin session log, which also has an undo button.

## 5. The Fortune Teller Trap (Brain Twin certainty)

"What exactly will my cognitive score be next month?" The coach:

- refuses the exact number ("I can't tell you exactly — and an honest system shouldn't pretend it can");
- explains that there is no single "cognitive score", because averaging would hide what matters;
- answers per dimension for the horizon asked (30 days): the 80 % range, the central estimate and the probability of beating today's score;
- recalls that the bands were calibrated in simulation (89 % coverage), so about 1 time in 10 reality lands outside;
- declines to forecast beyond 90 days.

A guardrail applies to every coach message, rule-based or AI. It rejects a future score stated as one number ("will be 62 %", "exactly 64 %") and any forecast with a percentage but no range or probability. An AI draft that breaks the rule is regenerated, and the coach falls back to the rule-based answer if it fails again.

## 6. The Asymmetrical Mind (generalisation)

Take a learner who is flawless at logic and fails completely at attention.

**Tiers.** Each dimension gets a difficulty tier from **its own** estimate:

- **Foundational** (≤ 30 %): target success +6 points, with a practice round switched on.
- **Advanced** (≥ 75 %): target success −8 points, in the Stretch format.

Nothing is averaged across dimensions.

**Asymmetry detector.** It requires a gap of at least 40 points and 80 % intervals that do not overlap. When it fires, both ends of the split go into the plan. In the scenario that gives Reasoning advanced at level 10 and Attention foundational at level 1. The rationale states "difficulty is set per area, never averaged".

**Radar.** The radar marks ▲ strongest and ▼ lowest and draws the split. A callout lists each area's own level and target.
