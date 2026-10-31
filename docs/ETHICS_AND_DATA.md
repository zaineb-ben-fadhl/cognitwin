# Ethics, consent and data

CogniTwin follows three principles: **non-clinical by design**, **choice is mandatory**, **show uncertainty**. This document covers consent, retention and deletion as required by the challenge brief, and the reasoning behind each choice.

## 1. Non-clinical scope

- Scores describe performance on six specific exercises, relative to the exercises (criterion-referenced mastery). They are never compared with population norms and never interpreted as health information.
- Clinical and diagnostic vocabulary is blocked in every coach message and scanned for in the UI copy by an automated test (see `docs/COACH.md`).
- Questions about health conditions receive a fixed, reviewed reply that points to qualified professionals. Messages expressing distress receive a fixed supportive reply with emergency contacts (Tunisia: SAMU 190, police 197).
- The welcome screen states what CogniTwin is *not* before any data is collected.
- Claims about transfer are deliberately modest: gains are framed as task progress, and "everyday missions" are offered as the bridge to daily life (Simons et al., 2016).

## 2. Consent

| Processing | Default | Where it happens | What leaves the device |
|---|---|---|---|
| Exercise results, Brain Twin, goals, chat, interaction events | **Required** (to use the app) | Browser storage (IndexedDB) | Nothing |
| AI narrative coach (LLM) | Off | Stateless API server → Claude API | Aggregated estimates, evidence, plan reasons, goals and collaboration scores, plus the current message and up to six filtered conversation messages. Profile nickname, raw trials and camera measurements are excluded. Redaction covers common identifiers, not every possible name or sensitive detail. |
| Voice output | Off | Browser speech synthesis; local English voices preferred | Some browser voices may send the spoken text to a vendor service. |
| Voice input | Off | Browser speech recognition | Depending on the browser, audio may be processed by its vendor. Stated on the consent screen. Nothing is recorded by CogniTwin. |
| Camera cues (biometric) | Off, and switchable per session | MediaPipe in the browser (on-device) | Nothing. Frames are discarded immediately; four averages per session are kept locally. |

- Consent is **granular**, **informed** (a "full details" panel; opening it is logged), **revocable** at any time in *Privacy & settings*, and **recorded** in a timestamped consent log.
- Users confirm they are 16 or older, or that a parent/guardian agrees.
- A **non-biometric mode is the default** and offers every feature. Biometric features are additive, never required.

## 3. No sensitive decisions on face or voice alone

- Camera cues (brow tension, eye closure, looking away, smile) are fused with behaviour and self-report with the lowest weight (0.4 vs 1.0 / 0.8).
- A working state is only reported if at least 0.3 of its support comes from **non-camera** sources; otherwise the result is "neutral" and the UI says the camera was not allowed to decide (unit-tested in `safety-collab.test.ts`).
- The working state only changes the coach's tone, break suggestions and training difficulty. It **never** changes a score, a plan priority or the twin.
- We do not infer emotions from facial expressions (Barrett et al., 2019); we use the neutral term *working state*.
- Voice is used for input/output only; no attribute of the user is inferred from it.

## 4. Data inventory (all on device)

| Data | Purpose | Retention |
|---|---|---|
| Trials (level, correct, response time, condition, error type, weight) | Estimating the profile, insights | Configurable: 30 / 90 / 365 days or until deleted (default 365). Older raw trials are deleted automatically; the session summary is kept. |
| Session summaries (estimates, metrics, quality, working state) | Brain Twin history, charts | Until the user deletes them |
| Camera cue averages | Working-state estimate | Deleted with raw data or separately, including derived camera evidence; working states are recomputed without camera and related coach messages are removed |
| Brain Twin snapshots | History, replay | Until deleted |
| Goals, plans, missions | Learning path | Until deleted |
| Coach conversations | Context for the coach | Retention period; deletable separately |
| Interaction events | AI Collaboration Score | Retention period |
| Calibration (reaction time factor) | Fair response windows | Until deleted |
| Nickname (optional) | Greeting | Until deleted; never sent to the AI |

The retention policy runs automatically when the app starts (at most once a day) and immediately when the setting changes.

## 5. User rights in the app

| Right | How |
|---|---|
| Access & portability | *Export all (JSON)* — complete, human-readable file |
| Rectification | Delete individual sessions; the twin is rebuilt from the remaining history |
| Erasure | *Delete conversations*, *Delete camera cues*, *Delete training history*, *Delete everything* (wipes storage and returns to the welcome screen) |
| Withdraw consent | Toggles in *Privacy & settings*; logged |
| Restore | *Import* a previous export (maximum 25 MB; validated atomically; the twin is recomputed). Sessions, goals, chat, settings, calibration, missions and ACS weights are restored. Plans are regenerated and verification-game state is reset. Archived consent is exported but never activates permissions on import. |

Designed with the EU GDPR (Art. 5 minimisation, Art. 7 consent, Art. 9 biometric data, Art. 15–20 rights) and the Tunisian Organic Law n° 2004-63 on the protection of personal data in mind. A real deployment would add a data-protection impact assessment and, in Tunisia, the formalities with the INPDP.

## 6. Security notes

- No accounts, no server-side storage: there is no central database to breach.
- The API server is stateless, logs no request bodies, caps request size (64 KB) and uses a bounded server-wide rate limit of 30 requests/minute (not a per-user quota).
- The API key never reaches the browser.
- Imports are size-capped and schema-validated; derived state is recomputed.
- The lockfile records exact installed versions. Dependency audit results are dated in the local check-up; no future submission-time result is assumed.

## 7. Known ethical limitations

- Local storage means data is as safe as the device; shared computers should use *Delete everything* after use.
- The LLM provider processes aggregates and filtered conversation text under its own terms when AI narration is enabled. Free text may still contain personal information.
- Gamified feedback can create pressure; the gentle challenge setting, break suggestions and process-focused praise mitigate this.
