# Task 3 Report: Two-Robot Handover Coordinator

## Files

- `src/features/handover/v4/handover-demo-coordinator.ts`
- `src/features/handover/v4/handover-demo-coordinator.test.ts`

## Behavior

- Added one deterministic RAF-driven Coordinator for `READY -> PICK_APPROACH -> PICK_GRIP -> MOVE_TO_SHARED_ZONE -> HANDOVER_APPROACH -> HANDOVER_CONFIRM -> PLACE -> COMPLETE`.
- Reads the representative Job's authored home, pick, shared, retreat keyframes and speeds; derives the fixed NED2-B place pose by mirroring the sample Pick J1 because Task 1 keeps its place constant private.
- Writes both Robot runtime registries through the simulation Joint source, recomputes each selected TCP World pose after every Joint write, and updates the attached Workpiece from its current owner.
- Transfers ownership atomically after the 250 ms local Grip Confirm while preserving the captured Workpiece World pose.
- With fault injection captured for the run, remains RUNNING through 1,999 ms and fails at exactly 2,000 ms with `GRIP_CONFIRM_TIMEOUT`, leaving Part and Shared Zone ownership at NED2-A.
- Publishes only NED2-A's representative Job as RUNNING/SUCCEEDED/FAILED/CANCELLED and leaves NED2-B's Job state IDLE.
- Reset and Dispose cancel the sole pending RAF, invalidate the lifecycle and store generation, restore both Robots/Jobs from the Project, restore the authored Workpiece state, and reject stale callbacks.

## RED-to-GREEN Evidence

- RED: `npx vitest run src/features/handover/v4/handover-demo-coordinator.test.ts` failed because `handover-demo-coordinator.js` did not exist.
- GREEN: the same focused file passed 1 file and 6 tests.
- Combined Task 1-3 focused suite passed 3 files and 18 tests.
- Coverage includes offline completion, complete owner progression, both Robot writes, exact 1,999/2,000 ms timeout, 249/250 ms local confirmation, World-pose continuity, double-Start rejection, Cancel, Reset, and disposed-callback rejection.

## Verification

- Focused Oxlint: passed with zero warnings.
- Strict TypeScript (`npx tsc -b --pretty false`): passed.
- Full unit gate (`npm run test:run`): 169 files passed, 2,166 tests passed.
- `git diff --check`: passed before staging.

## Self-review and Risks

- No runtime-bundle wiring, UI, renderer, documentation, OPC UA transport, PLC operation, or later-task behavior was added.
- No correctness issue was found in the final self-review.
- The Coordinator intentionally depends on the bounded sample topology and NED2 `J1` mirror convention; it is not a generic multi-Robot scheduler or planner.
