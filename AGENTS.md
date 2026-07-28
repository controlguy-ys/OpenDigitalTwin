# OpenDigitalTwin Repository Guidance

## Architecture
- Project V5 is the active source of truth.
- Project persistence is browser-owned; Runtime Gateway mirrors published revisions.
- Start code reading from `src/core/project-v5`, `src/features/project/v5`, and `middleware/runtime-gateway`.

## Commands
- Install: `npm install`
- Targeted tests: `npm run test:run -- <paths>`
- Full verification: `npm run verify`
- Codex verification: `npm run --silent verify:codex -- --scope <scope> --json`

## Safety
- Never perform an external OPC UA write or physical PLC/Robot action unless the current user explicitly requests it.
- Preserve revision, lease, idempotency, and atomic publication boundaries.
- Do not restore Legacy functionality unless the user explicitly requests it.

## Verification
- Add a targeted test that fails before each behavioral fix.
- Run targeted tests, lint, relevant builds, and runtime acceptance proportional to the change.
- Do not call work complete when the browser, Gateway, or required E2E flow is unverified.
