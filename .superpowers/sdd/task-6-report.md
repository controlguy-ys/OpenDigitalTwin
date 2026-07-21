# Task 6 Report: Minimal Handover Demo Controls

## Status

DONE

## Behavior

- Added `Project > Samples > NED2 Direct Handover Demo` through the existing Project mutation boundary.
- Added one `job.reset` command and one Timeline Reset button for the active representative Handover Job; the existing `job.start` command remains the only Start trigger.
- Added the runtime-only `Simulation > Fault Injection > Grip Confirm Timeout` toggle backed by the active Handover Coordinator/store.
- Added a compact accessible status strip for Current Step, Part Owner, Shared Zone Owner, and optional failure code.
- Qualified Handover UI and renderer resources by the active Project revision and exact sample/Job identity.
- Passed the live Workpiece pose override and Shared Zone owner into `SceneCanvasV4`.
- Stabilized the renderer's store-backed pose adapter and limited React subscriptions to displayed scalar status/owner fields, so animation-frame pose publications do not rebuild scene transforms or republish collision registration.
- Kept `StudioHeaderV4` and `composeAppHeaderStatusV4()` unchanged as the sole Gateway/OPC UA status presentation.
- Kept ordinary Projects free of Handover Reset, status, and fault surfaces.

## TDD Evidence

- Status RED: the focused test failed because `HandoverDemoStatusStripV4` did not exist; GREEN passed 2 tests using the real Handover store.
- Timeline RED: 1 of 24 tests failed because Reset/status were absent; GREEN passed the combined status/Timeline gate with 2 files and 26 tests.
- Command/menu RED: 2 files failed with 8 expected missing-placement/command assertions after correcting one fixture setup issue; GREEN passed 2 files and 31 tests.
- App RED: 2 of 20 tests failed because sample loading and renderer/runtime wiring were absent; GREEN passed all 20 tests.
- Review RED: 3 focused regressions failed as expected because the App passed each new store snapshot as the pose adapter, the status strip re-rendered on a pose-only update, and no stable adapter factory existed; GREEN passed 3 files and 45 tests.

## Verification

- Task 6 focused gate: 5 files, 77 tests passed.
- Review-fix focused gate: 3 files, 45 tests passed.
- Full unit gate: 171 files, 2,184 tests passed.
- `npm run lint`: passed with zero diagnostics.
- `npx tsc -b --pretty false`: passed with zero diagnostics.
- Review-fix `npx tsc --noEmit --strict`: passed with zero diagnostics.
- `git diff --cached --check` and post-commit `git show --check`: passed.

## Commit

- `feat: add minimal handover demo controls` (exact SHA reported in the Task 6 handoff)
- `fix: stabilize handover pose subscriptions` (exact SHA reported in the Task 6 handoff)

## Self-Review and Risks

- Confirmed no second Start control, permanent viewport overlay, Header OPC UA duplication, Task 7 Playwright/docs/video work, deployment, or PLC operation was added.
- Confirmed the pre-existing `.superpowers/sdd/task-4-brief.md` modification remains unstaged and untouched.
- The timeout toggle is intentionally runtime-only and reads its checked state directly from the active transient store.
- Confirmed pose-only store publications retain the adapter, scene registration, collision proxy, and unrelated React render counts while live pose reads still move the Workpiece and collision proxy.
- Browser visual/acceptance validation remains Task 7 scope; Task 6 is covered by component, composition, integration, full-unit, lint, and TypeScript gates.
