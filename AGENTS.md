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

## UI Feature Preservation
- Treat the checked-in V4, V5, and active V6 UI feature inventory as a compatibility contract. Before changing a shared UI surface, identify the existing commands, menus, Toolbox actions, Scene Explorer capabilities, ViewCube/camera controls, Inspector editors, Job controls, Simulation tools, and Connectivity dialogs affected by the change.
- Do not delete, hide, disable, replace with a placeholder, or leave disconnected any existing user-facing function during an update unless the user explicitly approves that removal in the current task.
- A redesign may regroup or restyle a function, but the replacement must retain equivalent discoverability, enabled-state rules, keyboard/accessibility behavior, and runtime effect before the old surface is removed.
- Preserve the real interactive 3D ViewCube and all supported standard camera orientations. An icon-only isometric shortcut is not a replacement for the ViewCube.
- Keep geometry-specific creation and editing semantics distinct. Box dimensions and Cylinder radius/height are separate capabilities even when their creation commands share a Geometry category.
- For every UI change, add or update a feature-preservation matrix in the task evidence that records each affected pre-existing function as retained, intentionally improved, or explicitly approved for removal. Add targeted regression coverage for every retained function whose command placement or rendering path changes.
- Run browser QA at desktop, 1024x768, and a 200%-zoom-equivalent viewport. A feature is not preserved if it exists in code but is clipped, obscured, unreachable, or unusable at a required viewport.

## Sub-agent Development
- Delegate bounded, pattern-following UI implementation to the `lazycodex-worker-low` role, configured as `gpt-5.6-luna` with `model_reasoning_effort = "xhigh"`. Do not lower its effort for implementation work.
- Give each implementation worker explicit file ownership, the feature-preservation matrix, and the rule that other agents share the worktree and unrelated edits must not be reverted.
- A parent agent must independently review the worker diff and regression evidence before integration. Final UI/UX release validation remains a separate SOL review after implementation and browser QA are complete.
