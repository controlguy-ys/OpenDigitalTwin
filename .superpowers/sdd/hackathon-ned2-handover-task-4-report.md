# Task 4 Report: Project-Owned Handover Runtime Wiring

## Status

DONE

## Behavior

- Added the optional `BrowserHandoverRuntimeResourcesV4` boundary to every V4 Job runtime bundle, with `null` for ordinary Projects.
- Creates the transient Handover store and Coordinator only for the exact Hackathon sample.
- Routes the representative Job's existing Start and Cancel actions through the Coordinator while ordinary Jobs retain the existing playback path.
- Added Coordinator-backed `canReset(jobId)` and `reset(jobId)` without adding UI or a second Start surface.
- Disposes the Coordinator before normal Job resources and exhausts both cleanup paths if either throws.
- Uses a scoped scheduler and publication-identity guard so rejected or replaced Handover resources cannot publish stale Robot/Job state during disposal.
- Added only mechanical `handover: null` and Reset method stubs to existing App test fixtures; no renderer, UI, sample-loader, command, or documentation behavior was added.

## TDD Evidence

- RED: focused Job/operator and Project runtime tests failed 3 expected assertions: Handover Start routing, Handover Cancel routing, and Coordinator disposal. The bundle-store test separately failed because incomplete Handover resources were accepted.
- GREEN: the three focused files passed 23 tests.
- Task-focused gate: 8 files passed, 134 tests passed.

## Verification

- `npm run lint`: passed with zero diagnostics.
- `npx tsc -b --pretty false`: passed with zero diagnostics.
- `npm run test:run`: 169 files passed, 2,171 tests passed after the review fix.
- Targeted `git diff --check`: passed for every staged Task 4 file.

## Review Fix Evidence

- Confirmed the rejected lifecycle path: successful replacement calls the committed Job resource's `dispose()` directly, so the prepared-resource helper could not stop the prior Coordinator.
- RED: the committed running Handover replacement test invoked a captured old RAF after replacement and received `ROBOT_INSTANCE_NOT_FOUND`; the contract test also proved a Coordinator missing `canStart` was accepted.
- GREEN: the Job resource disposer now owns Coordinator-first cleanup, then playback and executor cleanup, retaining the first error while exhausting all three operations.
- GREEN: the bundle validator now checks `canHandle`, `canStart`, `start`, `canCancel`, `cancel`, `canReset`, `reset`, `setGripConfirmTimeoutInjection`, and `dispose`.
- Review-focused gate: 4 files passed, 32 tests passed.
- Full post-fix gate: 169 files passed, 2,171 tests passed; lint and strict TypeScript passed.

## Self-Review and Risks

- Confirmed ordinary Job Start/Cancel still delegates to playback and non-demo bundles publish `handover: null`.
- Confirmed Coordinator cleanup precedes the normal resource disposer and is idempotent at both boundaries.
- Confirmed the parent-owned Task 4 brief modification remains unstaged.
- The active App does not consume the optional Coordinator until the planned Task 6 App wiring; this task intentionally adds no later-scope UI/command integration.
