# Layer B — the explainable AI coach

## Design goals (from the brief)

*Explainable natural-language coaching; free but justified architecture; no clinical terms.*

## Architecture: "engine decides, language model phrases, guardrails verify"

```
sessions ──► insight detectors ──► Insight { kind, evidence[], confidence, suggestion }
                                         │
                       ┌─────────────────┴──────────────────┐
                       ▼                                    ▼
          Rule-based NLG (always)                 LLM narrative (opt-in)
          templates.ts / chat.ts                  server/coach.ts
                       │                                    │
                       └──────────────► guardrails ◄────────┘
                                         │
                       CoachMessage { text, evidence[], confidence,
                                      source, safety report, action? }
```

### 1. Insight detectors (`src/engine/insights.ts`)

Deterministic functions that turn data into findings, each with **evidence items** (label, value, raw numbers) and a **confidence** level:

| Detector | Trigger (simplified) |
|---|---|
| Improvement / decline | change vs ~14 days ago with z = Δθ / √(σ₁² + σ₀²) > 0.5 (confidence from z) |
| Speed–accuracy | ≥ 3 errors faster than 0.8 × median correct RT, ≥ 60 % of errors |
| Fatigue | success first third − last third ≥ 25 points |
| Consistency | RT coefficient of variation > 0.42 |
| Distraction / switch cost | flanker interference, switch cost vs previous session |
| Search efficiency | slope of RT on set size |
| Sequence order | ≥ 50 % of missed sequences are order swaps |
| Reasoning rule | attribute most often broken by wrong answers |
| Plateau | ≥ 6 sessions, last 5 within 4 points |
| Time of day | success vs model expectation by time band, two-proportion z > 1.28 |
| Calibration | mean gap between self-prediction and estimate |
| Data quality / working state | quality flags; affect estimate |

A noisy session (poor reliability) caps every derived insight at *low* confidence — the coach can never say "the data is clear" about data that is not.

### 2. Rule-based NLG (`src/engine/coach/templates.ts`, `chat.ts`)

- **Hedging proportional to confidence**: high → "Clearly, …", moderate → "It looks like …", low → "It's early, but possibly …".
- **Structure**: finding → evidence in plain words → one concrete next step (from the dimension's strategy library, with sources).
- **Feedback science**: process praise (effort, strategy, consistency), never trait praise (Hattie & Timperley, 2007).
- **Chat**: 17 transparent intents (regex rules) + dimension detection from synonyms; each answer carries evidence and, where useful, an **action** (start a session, set a goal, take a break, open a page) that is only executed on the user's click.

### 3. Optional LLM narrative (`server/coach.ts`)

- **Model**: `claude-opus-5-5` by default (configurable with `COACH_MODEL`), effort `low` because the reasoning has already been done by the engine — the model only phrases. Server-side refusal fallback (`fallbacks: "default"`) keeps the coach available.
- **Input**: the de-identified context from `buildLLMContext` — profile estimates with intervals, top insights with evidence ids, plan reasons, goals with probabilities, projections, collaboration score, strategy library. It also sends the current message, a source answer with evidence, and up to six filtered conversation messages. Profile nicknames, raw trials and camera measurements are excluded. Common identifiers are redacted, but arbitrary names and sensitive free text cannot be reliably detected; users are told not to include them.
- **Output**: structured JSON (`reply`, `evidence_ids`, `confidence`, `suggestions`), parsed with a zod schema.
- **Prompt rules**: only numbers from the data; uncertainty stated; no certainty about the future; no clinical vocabulary; process praise; strategies only from the provided library; user text is delimited as untrusted input; this is one defence and not a proof against prompt injection.

### 4. Guardrails (`src/engine/coach/guardrails.ts`) — applied to every message

| Check | Implementation | On failure |
|---|---|---|
| Non-clinical language | 38 term patterns (diagnosis, disorder, deficit, impairment, ADHD, dementia, IQ, therapy, symptom, patient, …) | LLM: one regeneration with the violation fed back, then fallback to the template answer |
| Grounding | numbers in the reply and suggestions must match cited source evidence (exact or integer-rounded); unknown evidence ids are rejected and confidence is capped to the source | same |
| No false certainty | regex for "will definitely", "guaranteed", "you will reach", … | same |
| Length | ≤ 900 characters | same |
| PII hygiene (input) | e-mails, phone numbers, card numbers, 8-digit IDs (e.g. Tunisian CIN) are redacted before any call; the event is logged for the collaboration score | user is told what was removed |
| Clinical questions | detector routes "do I have ADHD/dementia…", "diagnose…", "medication…" to a **fixed, reviewed reply** pointing to qualified professionals; never sent to the model | — |
| Distress | detector routes to a fixed supportive reply with emergency numbers (Tunisia: SAMU 190, police 197) | — |

The UI copy itself is scanned for the same lexicon by a unit test (`ui-language.test.ts`).

### 5. Transparency in the UI

Every coach message has a **"Why?"** panel listing the evidence used, the confidence, the source (rule-based coach or AI narrative with model name), the safety checks that passed, and whether a first AI draft was intercepted or a fallback was used. Users can rate whether a message matches their data — which feeds the *critical verification* component of the AI Collaboration Score.

### 6. Voice coaching (bonus)

Browser speech synthesis prefers a local English voice but may use a vendor service; it reads coach messages (manually or automatically) and gives short cues during training ("Great streak", "Let's ease off a little"). Voice input uses the browser's speech recognition, with explicit consent because some browsers process audio on their vendor's servers.

### 7. Emotion-aware coaching (bonus) — done responsibly

The coach adapts its tone, proposes breaks and eases training difficulty from a coarse **working state** (in the zone, under strain, getting tired, distracted). The state is fused from behaviour (always available, non-biometric), optional self-report and optional camera cues — with the camera capped so it can never decide alone. The working state **never changes a score**.

## Tests

- `safety-collab.test.ts`: lexicon, grounding, certainty, PII, routing, every template and session feedback in a 6-week demo history passes the guardrails, LLM context is de-identified.
- `server/coach.test.ts`: the regeneration loop with a fake model (clinical draft → regenerated; ungrounded numbers → rejected → fallback; refusals and network errors handled; clinical questions never reach the model; PII redacted before the call).


## Limits of the safety checks

The shared client/server validator checks evidence ids, numeric membership, confidence, clinical terms and certainty patterns. It does not prove that a number describes the correct dimension, nor that every paraphrase preserves the original meaning. The deterministic source answer remains the fallback. Real-provider responses require separate evaluation.
