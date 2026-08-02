# Task 5: Group/Frame Inspector and active Job selection

## Result

Implemented the V6 Group/Scene Frame inspector recovery and multi-Job monitor selection from base `eaa5f7f18e4b61e3646bf336c152d62adbb6922f`.

- `GroupInspectorV6` exposes Group name, parent, effective visibility, and persisted visibility. Apply sends one `updateGroup` mutation with the expected current revision. The scene command rejects self/ancestor parent cycles before and during publication.
- `FrameInspectorV6` exposes Scene Frame name, role, parent, and local pose fields. World is explicitly read-only; editable non-World poses publish through one `updateSceneFrame` mutation.
- `SelectionInspectorV6` now routes `group` and `frame` selections to their inspectors while preserving existing Robot/Object routing, Inspector mutation ports, Runtime sections, and OPC UA Binding callbacks.
- `RobotJobMonitorV6` renders an accessible `Active Job` combobox only when more than one Job exists. `AppV6` owns the existing `jobId` state, preserves a selected ID while it remains in a valid revision, and keeps the existing deterministic first-Job fallback when the selected Job is removed.
- Existing Start, Retry, Cancel, Edit Job, Inspect failed step, runtime status, compact status, and failure-recovery paths remain wired to the selected Job and playback controller.

## TDD evidence

### RED

Focused command:

```text
npm run test:run -- src/features/inspector/v6/SelectionInspectorV6.test.tsx src/features/scene/v6/scene-command-service-v6.test.ts src/features/jobs/v6/RobotJobMonitorV6.test.tsx
```

The pre-implementation run failed in all three focused files: 6 expected failures and 13 passing tests. Failures covered missing `updateGroup`, missing `updateSceneFrame`, generic Group/Frame Inspector routing, and the missing Active Job combobox. Captured by the parent integration runner as Task 5 RED evidence.

### GREEN and static validation

The parent integration runner reports the focused four-file Task 5 suite green with the follow-up same-Robot multi-Job and App revision-selection tests included, full TypeScript checking green, and targeted oxlint green. The exact command output, exit codes, final SHA, and scope evidence are recorded in the actual Task 5 artifact:

```text
.omo/evidence/task-5-green-actual.txt
```

The earlier baseline summary remains available at [task-5-group-frame-job-verification.md](../../../.omo/evidence/task-5-group-frame-job-verification.md); the `task-5-green-actual.txt` artifact is authoritative for this follow-up.

### Follow-up recovery evidence

- `RobotJobMonitorV6` now accepts runtime state only when `state.jobId === selectedJob.id`; a same-Robot state owned by another Job renders the selected Job as `IDLE` and cannot expose the other Job's retry, cancel, or failed-step details.
- `AppV6` coverage verifies that a selected Job survives a Project revision while still present and deterministically falls back to the first Job when the selected Job is removed, with resource and preference cleanup isolated in the test.

## Feature-preservation matrix

| Existing function | Outcome | Evidence / implementation boundary |
|---|---|---|
| Robot/Object Inspector routing | Retained | `SelectionInspectorV6` still forwards `mutations`, `runtime`, and `onOpenBinding` unchanged. |
| Inspector Transform, Status, Communications, Binding sections | Retained | Existing `ObjectInspectorV6` and `RobotInspectorV6` remain mounted for their original selection kinds. |
| Group selection | Recovered | `GroupInspectorV6` replaces the generic prompt and delegates edits to `SceneCommandServiceV6.updateGroup`. |
| Group parent-cycle prevention | Recovered and guarded | Candidate parent options omit descendants; command validation repeats against the active revision before recipe application. |
| Group effective/persisted visibility | Recovered | Inspector displays both ancestor-resolved effective state and persisted `group.visible`. |
| Scene Frame selection | Recovered | `FrameInspectorV6` displays name, role, parent, and local pose instead of the generic prompt. |
| World Frame ownership | Retained and explicit | World local pose fields and Apply are disabled; command service rejects World mutation. |
| Job Start/Retry | Retained | Existing `playback.startJob(job.id)` and FAILED action label remain unchanged. |
| Job Cancel | Retained | Existing `playback.cancelRobotJob(job.robotId, ...)` path remains unchanged. |
| Job editor and failed-step recovery | Retained | Existing `onOpenEditor` callbacks and failed instruction ID path remain unchanged. |
| Runtime ownership | Retained | Selector only changes browser `jobId` state; no Project V5 or external runtime write is introduced. |
| Compact Job status | Retained | `RobotJobCompactStatusV6` remains noninteractive and unchanged. |
| Revision selection recovery | Retained | Existing App effect keeps a valid selected ID and calls `initialJobIdV6` when removed. |

## Scope and remaining gate

Changed production/test/style files are limited to the Task 5 inspector, scene command, Job monitor, App wiring, and local V6 CSS surfaces. No PLC, robot, OPC UA, transfer, deployment, or external write was performed. Browser viewport QA and final integration/release review remain the parent integration gate.
