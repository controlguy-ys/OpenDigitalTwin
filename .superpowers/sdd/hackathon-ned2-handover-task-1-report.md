# Task 1 Report: Deterministic Two-NED2 Sample Project

## Status

DONE

## Implementation

- Added `createHackathonHandoverSampleV4(options)` as a validated, deterministic Project V4 factory.
- Added the exact frozen `HACKATHON_HANDOVER_IDS_V4` identifiers and eight `HACKATHON_HANDOVER_STEPS_V4` Coordinator state labels from the task brief.
- Reused one checked-in NED2 Definition and asset-reference set across two independent Robot Instances.
- Persisted one NED2-A Job with the prescribed eight representative Joint Pose steps and speeds.
- Computed NED2-A's Shared TCP from forward kinematics, applied a 180-degree Z rotation to NED2-B, and derived NED2-B's base translation so both Shared TCP World positions coincide.
- Derived the Workpiece initial pose from NED2-A's Pick TCP and the Output Tray center from NED2-B's Place TCP.
- Added Table, Workpiece, and Output Tray solid box primitives. The Workpiece is graspable; both Robots identify the Table as their intentional mount entity.
- Kept OPC UA offline with no endpoints, mappings, action bindings, or bridge routes.
- Added `isHackathonHandoverSampleV4(project)` with the exact required Job, Robot, and Workpiece recognition checks.
- Did not wire browser UI, runtime, Coordinator, or Shared Zone rendering; those are outside Task 1.

## TDD Evidence

### RED

Command:

```powershell
npx vitest run src/features/project/v4/hackathon-handover-sample-v4.test.ts
```

Result: exit code 1. Vitest reported 1 failed test file and 0 tests because `./hackathon-handover-sample-v4.js` could not be resolved. This was the expected failure before the production module existed.

### GREEN

Command:

```powershell
npx vitest run src/features/project/v4/hackathon-handover-sample-v4.test.ts
```

Result: exit code 0; 1 test file passed and all 6 tests passed. Coverage includes Project V4 validation, one-Definition/two-Instance sharing, one Job/three solid entities, eight representative steps, Shared TCP coincidence within `1e-6 m`, Pick/Place-derived entity placement, intentional Table mounts, and sample recognition.

## Full Unit Suite

Command, run once before commit:

```powershell
npm run test:run
```

Result: exit code 0; 167 test files passed and all 2,154 tests passed in 83.87 seconds.

## Additional Verification

Commands:

```powershell
git diff --check
npx oxlint src/features/project/v4/hackathon-handover-sample-v4.ts src/features/project/v4/hackathon-handover-sample-v4.test.ts
npx tsc -b --pretty false
```

Results: all commands exited 0 with no diagnostics.

Post-commit checks:

```powershell
git show --check --stat --oneline HEAD
rg -n "robot-hackathon-ned2-a|robot-hackathon-ned2-b|job-hackathon-direct-handover|entity-hackathon-table|entity-hackathon-workpiece|entity-hackathon-output-tray|runtime-hackathon-shared-zone|READY|PICK_APPROACH|PICK_GRIP|MOVE_TO_SHARED_ZONE|HANDOVER_APPROACH|HANDOVER_CONFIRM|PLACE|COMPLETE" src/features/project/v4/hackathon-handover-sample-v4.ts
```

Results: committed patch passed Git whitespace validation, and every mandated identifier/state label was present verbatim.

## Files

- `src/features/project/v4/hackathon-handover-sample-v4.ts`
- `src/features/project/v4/hackathon-handover-sample-v4.test.ts`
- `.superpowers/sdd/task-1-report.md` (execution report; ignored coordination artifact)

## Commit

- `38a0a0f12619e36455f7c4e68bdf8096a97c4fbf` — `feat: add two-NED2 handover sample`

## Self-Review

- Confirmed the implementation is limited to the Task 1 factory and tests.
- Confirmed exact brief IDs, Joint values, state labels, representative pose ordering, and speed values.
- Confirmed both Robot Instances share the same Definition ID while retaining distinct IDs and Base poses.
- Confirmed the NED2-B base is derived from the computed Shared TCP geometry and a Z rotation, not copied from a hand-authored approximation.
- Confirmed the sample factory returns only after `validateWorkcellProjectV4()` succeeds.
- Confirmed no unrelated tracked files were changed.

## Concerns

None. Mechanical safety and collision-free motion remain explicitly outside this bounded sample task and require later visual verification, as stated in the approved design.
