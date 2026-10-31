# CogniTwin — local check-up, 31 October 2026

The corrections below were implemented in the local project. A passing automated test is evidence for the scenario it exercises, not a guarantee that every browser, device or model response will work perfectly.

## Follow-up: real API setup

The user supplied an Anthropic key locally. The API was reloaded and now reports `llm: true` (configured, not proof of successful generation). The first HTTPS request failed because Node did not use the Windows certificate store. Optional `COACH_USE_SYSTEM_CA=true` now adds the OS-trusted roots while preserving normal certificate and hostname verification. This follows the [Node.js network configuration guidance](https://nodejs.org/learn/http/enterprise-network-configuration).

A real request containing only a synthetic practice profile reached Anthropic. The provider refused it with HTTP 400 because the account's API credit balance is too low. The app now reports `insufficient_credits` and explains the local fallback in the message's **Why?** panel. No successful live-model response, model availability or output quality is claimed. The account owner must add API credits before testing can continue. The key was not printed or included in source/build files.

`node scripts/check-live-coach.mjs` reproduces this optional live test against the local server; successful provider calls may consume credits. Two regression cases were added; all 129 tests, TypeScript and the production build passed after the changes. A scan confirmed that the configured API key is absent from the production build. Earlier report/pitch test counts describe the preceding 127-test snapshot.

## Verified locally

- **129 automated tests across 14 files passed.** This includes the original engine and simulation assertions, 15 exercise/session interaction cases, 17 route/form cases, storage integration and failure recovery, camera/voice adapters, client fallback, provider-response validation and HTTP API cases.
- **TypeScript and production compilation passed.** Vite reports two harmless annotation warnings originating in Zod; compilation succeeds.
- **Seeded simulation passed**, reproducing the numerical results in `VALIDATION.md`. This uses synthetic users generated from the model and does not establish validity with real participants.
- **Production server started with `npm start` on temporary port 8790.** `node scripts/check-http.mjs http://localhost:8790/` verified the HTML page, four entry assets, three local camera resources, health response and JSON 404 for an unknown API route.
- **Development server responds** at http://localhost:5173 with its API proxy. Health now reports `llm: true`; the provider currently rejects generation because API credits are insufficient. The local coach remains available.
- **Dependency audit:** `npm audit --json` reported zero known vulnerabilities (all severities) for the installed lockfile. This is a dated registry result, not a guarantee of absence of vulnerabilities.
- **Documentation generation** is checked against the dimension registry. English technical documentation and demo script were updated.
- **Deliverables:** revised technical PDF remains 6 pages (maximum 8); pitch remains 15 slides/pages (maximum 15). PDF pages were rendered and inspected. The PowerPoint passed the Office XML/relationship validator; a fresh PowerPoint/LibreOffice rendering was unavailable on this machine. Its paired PDF was updated and inspected separately.

## Corrections made

1. **Coach:** check replies and suggestions, reject unknown evidence references and unsupported numbers, cap confidence to the source, validate responses at both client and server, and keep a deterministic fallback for malformed/provider/network failures. Sensitive safety routes remain local. These syntactic/numeric checks do not prove semantic correctness.
2. **Privacy:** consent, in-app explanations and documentation now disclose the current message and up to six filtered history messages sent with aggregates. Camera-derived coach messages are filtered out of model history. Profile nicknames and collected camera measurements are excluded. Arbitrary personal details in free text cannot all be detected.
3. **Erasure/retention:** remove original and derived camera evidence, recompute the working state without camera and remove related coach messages. Replaying history after session deletion also updates goal attainment and linked plan items. An in-flight coach reply cannot recreate a cleared conversation; AI replies are discarded if AI consent was revoked meanwhile.
4. **Import/export:** validate version, task/dimension consistency, dates, score intervals, settings, events and duplicate sessions; cap imported files at 25 MB; reject invalid imports before mutation. Restore missions and ACS weights. Consent is exported as an archive and never enables permissions on import; plans are regenerated and verification-game state is reset.
5. **Storage:** serialise asynchronous operations and switch to a usable fallback when IndexedDB or localStorage fails. An in-memory fallback cannot survive closing the page; the settings page identifies the storage mode.
6. **Exercises:** support keyboard activation across the six views; reject duplicate responses; control transition timers during pause, resume and quit; cancel delayed memory responses on unmount.
7. **Camera/voice:** handle late camera permission/model resolution, release streams and models, use CPU if GPU initialization fails, and serve WASM locally. Cancel late speech-recognition callbacks and prefer local English synthesis voices.
8. **Goals/plans:** reject missing or invalid deadlines, bound projections, permit swapping to any registered dimension, avoid duplicate dimensions in a plan and clamp contribution bars. Confirm before replacing an existing history with demo data.
9. **Packaging:** copy generated camera WASM during install/development/build; fix Docker's copy order for postinstall; add the complete `npm run check` command and a reproducible local HTTP check.

## Still unverified or external to the local fixes

- **Live Claude request:** the key is configured and Anthropic was reached, but generation was refused because API credits are insufficient. A successful response, model availability, latency and response quality remain unverified. See `LOCAL_SETUP_FR.md`; never share the key in chat.
- **Real camera and microphone / audible speech:** adapters were tested with simulated browser APIs. Physical-device operation and permissions still require a manual run.
- **Visual application QA in Chrome/mobile:** native browser control stopped because it could not determine the current URL with enough confidence. The route tests use jsdom, not a rendered browser; responsive appearance, focus behaviour and real input timing therefore still need manual checks.
- **Docker execution:** Docker's daemon was not running. The Dockerfile correction is in place, but no image build or container run is claimed.
- **Public GitHub repository, hosted demo, 3–5 minute video and submission receipt:** absent or unverified. The user confirmed that the repository and video do not yet exist. No external publication or form submission was performed.
- **Eligibility/team details and the exact official dimension list:** not confirmed by the available materials. The supplied brief refers to a list without enumerating it.
- **Scientific validation:** no real-user pilot, item calibration, construct validation or proof of real-life transfer is claimed.

## Reproduce

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run validate
npm.cmd run docs
npm.cmd start
# In another terminal while the server is running:
node scripts/check-http.mjs http://localhost:8787/
```

The report source is `docs/TECHNICAL_REPORT.md`; `python scripts/build-report.py` rebuilds its PDF with ReportLab and Pillow installed. The original project was backed up before correction at `C:\tmp\cognitwin-before-fixes.zip` (excluding dependencies, generated build, public assets and `.env`).
