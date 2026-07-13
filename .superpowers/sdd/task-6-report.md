# Task 6 Report: Deterministic Pose-Sequence Collision Worker

## Outcome

Implemented deterministic, FPS-independent Pose-sequence collision validation:

- added Preview sampling with a maximum `2 deg` Joint step and Validate
  sampling with a maximum `0.5 deg` Joint step;
- preserved easing, segment duration, exact non-truncated endpoints, zero-motion
  segment duration, deterministic sample indices/timestamps, and true truncation
  at 20,000 samples;
- added an owned, serializable Worker protocol and a resilient client with
  monotonic progress, explicit cancellation, stale revision rejection, native
  Worker error recreation, and a 10,000-finding cap;
- added pure `computeRobotWorldMatrices()` composition for all seven Link slots,
  per-Link geometry local transforms and non-uniform scale, Flange, Tool, and TCP;
- inserted an explicit rendered Flange frame without changing the existing Tool
  or TCP World hierarchy;
- added a dedicated Worker that recomputes Link/Tool geometry and an optional
  TCP-local held Object for every sample, retains static Workbench and external
  Entities, attaches sample/time metadata, reports progress every 250 samples,
  and observes cancellation at those yield boundaries;
- connected `Preview Sequence`, `Validate Sequence`, progress, and cancellation
  controls to `CollisionPanel`;
- composed the Worker Robot root from MCP, the Workbench mount, and Robot Base,
  and included mechanics, Link geometry, proxy Boxes, Tool/TCP, held attachment,
  static Entity matrices, Poses, and collision policy in the runtime request;
- marked completed reports stale and cancelled active work when a relevant
  mechanics, frame, Pose, collider, external transform, held state, or policy
  revision changes.

No Three `Object3D`, render mesh, STEP bytes, or source geometry crosses the
Worker boundary. The protocol reconstructs only known serializable fields and
strips unknown runtime fields before `postMessage()`.

## TDD Evidence

### Sampling RED -> GREEN

Initial command:

```text
npm run test:run -- src/features/collision/validate-pose-sequence.test.ts
```

Observed RED: Vite could not resolve the missing
`./validate-pose-sequence` module.

GREEN result before Worker extensions: 1 file, 7 tests passed. The tests cover
both angular limits, easing-derived angles, duration-derived timestamps, exact
segment endpoints, repeatable counts, zero-motion segments, and true 20,000-row
truncation without replacing the last retained sample.

### Protocol and Client RED -> GREEN

Initial command:

```text
npm run test:run -- src/features/collision/collision-validation-protocol.test.ts src/features/collision/collision-validation-client.test.ts
```

Observed RED: both suites failed because the protocol and client modules did
not exist.

GREEN result: 2 files, 10 tests passed. Coverage includes defensive request
ownership, unknown render-field stripping, malformed transform/Link guards,
bounded progress, 10,000-finding truncation, monotonic progress, cancellation,
stale revision rejection, older-request rejection, and fresh Worker creation
after a native Worker error.

### FK Parity RED -> GREEN

Initial command:

```text
npm run test:run -- src/domain/robot/kinematics.test.ts
```

Observed RED: 3 expected failures because the rendered Flange and pure matrix
API were absent.

GREEN result with Robot registration coverage: 2 files, 14 tests passed.
Zero and non-zero Joint poses compare every element of:

- seven rendered Link-slot World matrices;
- seven geometry World matrices after local position, quaternion, and
  non-uniform scale;
- Flange, Tool, and TCP World matrices.

The pure output matches Three `matrixWorld` to 11 decimal places without
allocating an `Object3D` in the pure computation.

### Worker and UI RED -> GREEN

Worker RED first observed a missing Worker module. A second narrow RED observed
the missing validate/cancel command handler at the 250-sample boundary.

Worker GREEN result: the combined sampling/Worker suite passed 11 tests,
including TCP-local held Object recomputation, static Workbench participation,
sample/time metadata, 250-sample progress/cancel boundaries, and the 10,000
finding cap.

CollisionPanel RED result: 1 file ran with 3 expected failures because sequence
start/cancel controls and revision stale handling were absent. A second narrow
RED proved registry collider-revision and Entity-visibility changes were not
yet part of the default revision. GREEN result: 1 file, 10 tests passed.

## Final Verification

Focused Task 6 command:

```text
npm run test:run -- src/features/collision/collision-validation-protocol.test.ts src/features/collision/collision-validation-client.test.ts src/features/collision/validate-pose-sequence.test.ts src/features/collision/CollisionPanel.test.tsx src/domain/robot/kinematics.test.ts src/features/robot/RobotModel.test.ts
```

Result: 6 files, 45 tests passed, 0 failed.

Full suite:

```text
npm run test:run
```

Result: 72 files, 420 tests passed, 0 failed.

Static and production gates:

```text
npm run lint
npm run build
git diff --check
```

Results:

- oxlint passed without diagnostics;
- TypeScript and Vite production build passed;
- Vite emitted the dedicated `collision-validation.worker` chunk;
- diff check passed.

## Notes

- Worker findings are proxy-based and remain explicitly outside physics,
  RobotWare, SafeMove, and safety-rated validation.
- Sample truncation and finding truncation share the result `truncated` flag.
- Cancellation is observed on deterministic 250-sample yield boundaries, so
  the Worker event loop can receive the `cancel` command.
- Vite retains the pre-existing OCCT `path` / `crypto` browser-externalization
  messages and large main-chunk warning. The dedicated collision Worker is
  approximately 110 kB and the production build succeeds.

## Review Follow-up: Link Participation and Client Hardening

The review follow-up added an owned `collisionActive` boolean to every Robot
Link protocol row. The default CollisionPanel request maps that flag from both
the persisted Link geometry visibility and the live geometry-registry snapshot.
The Worker still computes FK for all seven Links, but creates collision proxies
only for active Link rows. This prevents hidden or unregistered Link fallback
boxes from producing sequence-validation findings.

The client now:

- rejects cancellation locally and recreates the Worker when cancel transport
  throws;
- ignores `cancelled` and `error` events whose revision does not match the
  active request;
- rejects a result whose mode differs from the active request and recreates the
  Worker;
- suppresses progress updates that regress either processed samples or the
  processed/total ratio.

The result guard determines truncation from the original findings length and
validates only the first 10,000 owned findings.

### Follow-up TDD Evidence

Production files were unchanged when this focused command first ran:

```text
npm run test:run -- src/features/collision/collision-validation-client.test.ts src/features/collision/collision-validation-protocol.test.ts src/features/collision/validate-pose-sequence.test.ts
```

Observed RED: 3 files failed with 8 expected failures and 20 passing tests. The
failures covered regressing progress ratio, cancel transport failure, stale
terminal events, result-mode mismatch, missing/invalid Link participation,
overflow finding validation, and inactive-Link collider participation.

The Link collision probe was corrected from the intentionally excluded
Workbench/LINK00 policy pair to a general equipment/LINK00 pair. With the Worker
filter temporarily removed, the corrected test failed because the inactive Link
produced two collision findings. Restoring the filter made the regression green.

Focused GREEN:

```text
npm run test:run -- src/features/collision/collision-validation-client.test.ts src/features/collision/collision-validation-protocol.test.ts src/features/collision/validate-pose-sequence.test.ts src/features/collision/CollisionPanel.test.tsx
```

Result: 4 files, 39 tests passed, 0 failed.

### Follow-up Final Verification

```text
npm run lint
npm run build
npm run test:run
git diff --check
```

Results:

- oxlint passed without diagnostics;
- TypeScript and Vite production build passed and emitted the collision Worker;
- full Vitest suite passed: 72 files, 428 tests, 0 failures;
- diff check passed.

Per task scope, no CAD conversion or validation command was run. Vite retained
the pre-existing OCCT browser-externalization messages and chunk-size warning.

## Registry Reactivity Follow-up

The geometry Entity registry now acts as a React-compatible external store. It
exposes stable subscribe and revision-snapshot functions and increments a
monotonic revision for meaningful registration, replacement, live Object
ownership, deletion, and clearing changes. Stale lifecycle cleanup, missing
deletion, empty clearing, same-registration assignment, missing Object updates,
and same-Object updates do not increment the revision.

The exported registry remains Map-compatible. Its observable Map implementation
also captures direct `set`, `delete`, and `clear` calls, while custom registries
used by current-pose queries retain their existing plain-Map behavior.

`CollisionPanel` subscribes with `useSyncExternalStore` and includes the
registry revision in its default validation revision. A registry-only change
after render now cancels an active sequence validation and marks a completed
report stale without requiring a parent rerender. The existing
`currentPoseCollisionRevision()` transform and hierarchy semantics were not
changed.

### Registry Reactivity TDD Evidence

Production files were unchanged when the first focused RED command ran:

```text
npm run test:run -- src/features/collision/geometry-entity-registry.test.ts src/features/collision/CollisionPanel.test.tsx
```

Observed RED: 2 files failed with 4 expected failures and 15 passing tests. The
registry tests reported missing revision-snapshot and subscribe functions. The
panel tests expected one cancellation after post-render registration and
cleanup changes but observed zero.

After the initial implementation, the same command passed 2 files and 19 tests.

A second test-first pass covered direct public Map mutations:

```text
npm run test:run -- src/features/collision/geometry-entity-registry.test.ts
```

Observed RED: 1 file failed with 2 expected failures and 6 passing tests. Direct
deletion of an existing registration and direct non-empty clearing both left
the revision unchanged. The observable Map implementation made the registry
suite pass 8 tests, including no-op deletion/clearing and subscription cleanup.

### Registry Reactivity Final Verification

Focused registry, panel, and current-pose regression command:

```text
npm run test:run -- src/features/collision/geometry-entity-registry.test.ts src/features/collision/CollisionPanel.test.tsx src/features/collision/current-pose-collision.test.ts
```

Result: 3 files, 25 tests passed, 0 failed.

Full suite:

```text
npm run test:run
```

Result: exit 0, 72 files, 434 tests passed, 0 failed in 72.57 seconds.

Static and production gates:

```text
npm run lint
npm run build
git diff --check
```

Results:

- oxlint passed without diagnostics;
- TypeScript and Vite production build passed and emitted the collision Worker;
- diff check passed.

Per task scope, no CAD conversion or validation command was run. Vite retained
the pre-existing OCCT browser-externalization messages and chunk-size warning.
