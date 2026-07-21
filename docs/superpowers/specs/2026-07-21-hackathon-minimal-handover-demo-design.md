# Hackathon Minimal NED2 Handover Demo Design

**Date:** 2026-07-21

**Status:** Approved for implementation planning

**Target:** `main`

## 1. Goal

Provide one deterministic, browser-first technical demonstration that proves a
two-Robot handover without requiring OPC UA connectivity. The operator starts
one visible Job and the application completes this sequence:

```text
Pick -> Shared Zone -> Direct Handover -> Place
```

The demonstration is a bounded Hackathon scenario, not a general multi-Robot
scheduler, Cartesian planner, or physics simulation.

## 2. Assets and Scene

The Project contains one reusable NED2 Robot Definition backed by the current
link GLB set. It is presented as one NED2 asset even though its implementation
uses the existing per-Link GLB resources. Two Runtime Robot Instances reference
that same Definition and keep independent Base and Joint state:

- `NED2-A` performs Pick and delivery to the Shared Zone.
- `NED2-B` performs Direct Handover and Place.

The Scene creates four lightweight primitives in code:

- one graspable Workpiece;
- one Output Tray;
- one Table; and
- one Shared Zone marker.

These primitives use geometry and ownership state only. Physics, automatic
grasp selection, IK, and path planning are outside this release.

## 3. Runtime Architecture

A sample-specific Handover Coordinator owns the choreography. Starting the one
visible representative Job starts the Coordinator; Robot-specific internal
motion tracks are not separately started by the operator.

The Coordinator has five responsibilities:

1. advance fixed, visually verified NED2 Joint Pose keyframes;
2. coordinate the two independent Robot runtimes;
3. project the Workpiece pose from the owning Robot TCP;
4. update Part and Shared Zone ownership; and
5. handle Reset and the single Grip Confirm Timeout fault.

Runtime state is not written into canonical Project JSON on every frame. A
dedicated runtime store contains:

- `IDLE | RUNNING | SUCCEEDED | FAULTED`;
- the current scenario step;
- the Part owner;
- the Shared Zone owner;
- the active run generation; and
- Grip Confirm and timeout state.

The current Project V4 browser path remains the presentation and persistence
boundary. Project V5 Attach/Detach and logical-I/O code is not promoted into the
UI as part of this bounded feature. The Coordinator is isolated so its runtime
ports can later be replaced with the V5 instruction engine.

## 4. Scenario and Ownership Rules

The fixed scenario is:

| Step | Motion and state | Part owner | Shared Zone owner |
|---|---|---|---|
| `READY` | Workpiece is at its authored Table pose | `TABLE` | `NONE` |
| `PICK_APPROACH` | NED2-A moves to the Pick approach | `TABLE` | `NONE` |
| `PICK_GRIP` | A closes, confirms, and attaches | `NED2-A` | `NONE` |
| `MOVE_TO_SHARED_ZONE` | A moves to the handover pose | `NED2-A` | `NED2-A` |
| `HANDOVER_APPROACH` | B moves to the opposite handover pose | `NED2-A` | `NED2-A` |
| `HANDOVER_CONFIRM` | B closes and waits for confirmation | `NED2-A` | `NED2-A` |
| `PLACE` | Ownership changes to B, A retreats, B places | `NED2-B` | `NED2-B` |
| `COMPLETE` | B detaches at the tray | `OUTPUT_TRAY` | `NONE` |

The Direct Handover is one atomic ownership transition. The Coordinator captures
the Workpiece World pose, detaches it from NED2-A, attaches it to NED2-B, and
then publishes the new owner in one simulation update. The rendered World pose
must remain continuous through the transition.

Fixed Joint Pose keyframes and speed interpolation drive Robot motion. No Pose
is described as mechanically safe or collision-free until it has been visually
verified in the bundled NED2 geometry.

## 5. Minimal UI

The design does not add a large viewport overlay or a second Robot control
surface.

- The representative Job's existing Play control is Start.
- One Reset control is added beside the Job execution controls.
- One compact Bottom Job status strip displays Current Step, Part Owner, and
  Shared Zone Owner.
- The existing Header Gateway presentation is the OPC UA Status; the same state
  is not duplicated in a new panel.

The only Fault control is a runtime-only menu item:

```text
Simulation
└─ Fault Injection
   └─ Grip Confirm Timeout
```

The toggle applies to the next run and clears after completion or Reset. It does
not dirty or persist the Project.

## 6. OPC UA Boundary

The normal demo must complete while OPC UA is Offline. Local deterministic Grip
Confirm is the default input, and OPC UA connectivity is presentation-only for
this slice.

The UI displays the actual Gateway state as Offline, Connected, Reconnecting,
or Faulted. A disconnected Gateway never disables Start. Mapping a real PLC
Grip Confirm input is a follow-up feature and must use the existing logical
signal/OPC UA boundary rather than adding a second ad hoc transport.

## 7. Fault and Reset Behavior

When Grip Confirm Timeout is injected, confirmation for NED2-B is withheld at
`HANDOVER_CONFIRM`. When the deterministic timeout expires:

- the representative Job becomes `FAILED`;
- its failure code is `GRIP_CONFIRM_TIMEOUT`;
- the Workpiece remains attached to NED2-A;
- Part Owner remains `NED2-A`;
- Shared Zone Owner remains `NED2-A`; and
- both Robot motion tracks stop.

Reset cancels both motion tracks and pending timers, restores both Robots and
the Workpiece to their initial poses, restores initial ownership, returns the
Job to `IDLE`, clears Fault injection, and invalidates the previous run
generation so stale asynchronous callbacks cannot mutate the new run.

## 8. Verification and Success Criteria

The feature is complete when all of the following are true:

1. The sample renders one NED2 Definition through two visible Runtime Instances.
2. Workpiece, Output Tray, Table, and Shared Zone are visible code-created
   geometry.
3. One Job Play action completes Pick, Shared Zone entry, Direct Handover, and
   Place without any second Start action.
4. Part ownership follows `TABLE -> NED2-A -> NED2-B -> OUTPUT_TRAY`.
5. Shared Zone ownership follows `NONE -> NED2-A -> NED2-B -> NONE`.
6. The Workpiece World pose is continuous across Direct Handover within the
   asserted numeric tolerance.
7. Fault injection fails at `HANDOVER_CONFIRM` with
   `GRIP_CONFIRM_TIMEOUT` and preserves NED2-A ownership.
8. Reset reproduces the exact initial Joint, Workpiece, owner, Job, and Fault
   state.
9. The happy path succeeds while the Gateway and OPC UA are Offline.
10. Unit tests cover the sample, Coordinator, ownership transition, timeout,
    Reset, and stale-run rejection.
11. Browser acceptance covers the successful run and the injected timeout.
12. Lint, the full unit suite, browser build, and relevant Playwright suites
    pass before release.

## 9. Explicit Non-Goals

This feature does not add:

- generic multi-Robot scheduling or deadlock resolution;
- IK, Cartesian planning, physics, or safety-rated validation;
- automatic Robot code generation;
- automatic STEP semantics or mechanical calibration;
- a required OPC UA or Docker dependency for Start; or
- a second persistent Fault/configuration model.
