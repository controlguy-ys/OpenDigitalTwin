# Geometry Collision Core Design

## 1. Purpose

Replace runtime physics-engine collision with deterministic geometry-only
interference queries for one six-axis Robot workcell. The system answers whether
configured geometry proxies overlap or enter a warning clearance at the current
joint pose and along the existing Simulation Pose sequence. It does not calculate
forces, gravity, friction, rebound, rigid-body response, or safety-rated stopping
distance.

## 2. Product Boundary

This slice implements RobotStudio-style Collision Set validation in a lightweight
form:

- one rendered Robot;
- Robot Links, Tool/Gripper, held Object, Workbench Environment, legacy
  Equipment, and imported Object Instances participate through one runtime
  Entity contract;
- local Box and Compound Box collision proxies;
- current-pose collision and near-miss queries;
- deterministic Pose-sequence sampling in a Web Worker;
- pair enable/ignore settings and a collision report;
- `.wdtwin` persistence and V1 migration.

This slice explicitly excludes:

- `@react-three/rapier` and every rigid-body/physics callback;
- mass, gravity, impulse, friction, restitution, constraints, or falling Objects;
- Cartesian Target, IK, MoveL, automatic collision avoidance, swept-volume mesh,
  convex decomposition, and triangle-BVH exact validation;
- Robot self-collision except for explicitly configured non-adjacent Link pairs;
- safety certification or claims of RobotStudio/RobotWare-equivalent accuracy.

Triangle BVH and convex validation remain a later `Detailed Validation` slice.

## 3. Geometry Model

Every collision participant exposes immutable identity plus a current World
matrix and one or more parent-local Box proxies.

```ts
export type CollisionEntityCategory =
  | 'robot-link'
  | 'tool'
  | 'environment'
  | 'equipment'
  | 'object'
  | 'held-object'

export interface CollisionBox {
  readonly id: string
  readonly center: readonly [number, number, number]
  readonly halfExtents: readonly [number, number, number]
  readonly quaternion: readonly [number, number, number, number]
}

export interface GeometryCollisionEntity {
  readonly id: string
  readonly name: string
  readonly category: CollisionEntityCategory
  readonly worldMatrix: readonly number[]
  readonly boxes: readonly CollisionBox[]
}
```

Entity IDs are stable and namespaced:

```text
robot-link:LINK00 ... robot-link:LINK06
tool:default
workcell:workbench
equipment:<equipment-id>
object:<instance-id>
```

Attachment never changes an Entity ID. A grasped `object:<instance-id>` or
`equipment:<equipment-id>` keeps that canonical ID while its runtime category
changes to `held-object`; pair policy, enter/exit state, and report navigation
therefore remain continuous across grasp and release.

Robot Link proxies come from the active `robot-geometry-store`, including custom
Robot imports. Imported Object proxies come from their Asset collider metadata
and Instance World matrix. Legacy Equipment is adapted into the same runtime
contract without an immediate database migration.

The initial stored shape remains one Box per Link/Asset for V1 compatibility.
The new runtime and V2 project contract accept multiple boxes so the editor can
later expose Compound Box authoring without another collision-engine rewrite.

## 4. Pure Query Pipeline

### 4.1 Broad phase

Each oriented box also produces a World AABB expanded on all axes by the active
warning distance. Sweep-and-prune on the X axis rejects candidates outside that
expanded interval, followed by Y/Z checks. Pair policy is applied before narrow
phase. Expansion is mandatory so Broad Phase cannot discard a valid near-miss.

The runtime never tests an unconstrained all-to-all scene. Default categories:

- Robot Link or Tool against Environment/Equipment/Object;
- held Object against Environment/Equipment/Object;
- optionally selected non-adjacent Robot Link pairs.

Adjacent Robot Links and identical Entity pairs are ignored by default.

### 4.2 Narrow phase

OBB-vs-OBB uses the Separating Axis Theorem over the 15 candidate axes. The
query returns a signed separation approximation:

- `separationM <= 0`: collision;
- `0 < separationM <= warningDistanceM`: near miss;
- otherwise: clear.

The approximation is sufficient for Box/Compound Box validation and is labeled
as proxy clearance, not exact mesh distance.

```ts
export interface CollisionFinding {
  readonly pairKey: string
  readonly firstEntityId: string
  readonly secondEntityId: string
  readonly firstBoxId: string
  readonly secondBoxId: string
  readonly kind: 'collision' | 'near-miss'
  readonly separationM: number
  readonly sampleIndex: number | null
  readonly timeMs: number | null
}
```

Pair findings are stable-sorted by time, severity, pair key, and box IDs.

## 5. Pair Policy

```ts
export interface CollisionPolicy {
  readonly enabled: boolean
  readonly warningDistanceM: number
  readonly ignoredPairKeys: readonly string[]
  readonly enabledRobotSelfPairs: readonly string[]
}
```

`pairKey(a, b)` sorts Entity IDs lexically so the key is order-independent.
Unknown or deleted Entity IDs are retained during project load but reported as
inactive diagnostics; they do not fail the whole project.

The UI provides:

- global enable;
- warning distance in millimetres;
- active findings;
- `Ignore Pair` and `Restore Pair`;
- `Validate Sequence`;
- first/previous/next finding navigation;
- JSON and CSV report export.

## 6. Current-Pose Runtime

React Three Fiber continues rendering the scene, but `<Physics>`, `RigidBody`,
`CuboidCollider`, and `useBeforePhysicsStep` are removed. A geometry registry
publishes Object3D references and local proxies. A throttled current-pose query
runs at no more than 10 Hz and only when Robot joints, Entity transforms,
collider revisions, or policy revisions change.

Collision does not move anything. The runtime response is limited to:

- update finding state;
- highlight involved Robot Links and external Entities;
- append edge-triggered enter/exit events;
- optionally pause Simulation playback.

Grasp remains kinematic parenting under TCP. The grasp sensor becomes a pure
oriented-box overlap query. Release preserves World pose and converts it once to
MCP-local storage; the Object does not fall.

## 7. Pose-Sequence Validation

This slice validates the existing joint-space Pose sequence only. Each segment
uses the existing duration/easing contract and samples joint interpolation by a
deterministic angular step:

- Preview: maximum `2 deg` change of any Joint per sample;
- Validate: maximum `0.5 deg` change of any Joint per sample;
- maximum `20,000` samples per run;
- cancellation when the sequence, collider, or policy revision changes.

A dedicated Worker receives serializable Robot mechanics, MCP/Base transforms,
each Link proxy's local geometry transform and scale, flange/tool/TCP transforms,
Link/Tool boxes, an optional held-Object TCP-local attachment, static Entity
boxes, sequence records, and policy. Its pure FK result includes Link-slot,
geometry, flange, Tool, and TCP World matrices, so the Worker reproduces the
rendered hierarchy without Three.js scene objects. The held Object World matrix
is recomputed from TCP at every sample; it is never treated as a static
environment Entity.

```ts
export interface CollisionValidationSummary {
  readonly mode: 'preview' | 'validate'
  readonly sampleCount: number
  readonly collisionCount: number
  readonly nearMissCount: number
  readonly firstFindingTimeMs: number | null
  readonly durationMs: number
  readonly truncated: boolean
}
```

## 8. Persistence

The project format advances to schema V2. Version constants and types remain
literal and distinct: V1 decode types always use `schemaVersion: 1`, V2/current
types use `schemaVersion: 2`, and runtime stores consume a
`CurrentProjectSnapshot` alias rather than a V1 type. V2 keeps existing Box
center/half extents and adds:

- optional per-Link and per-Asset `collisionBoxes` arrays;
- one `collision/policy.json` archive entry;
- project snapshot `collisionPolicy`;
- validation of finite normalized quaternions, positive half extents, unique Box
  IDs, non-negative warning distance, and unique sorted pair keys.

V1 decode migrates each existing `collisionCenter/collisionHalfExtents` pair to
one identity-rotation Box and creates the default policy. V2 encode/decode is
deterministic. A failed migration or invalid proxy rejects the imported project
before active state changes.

When V2 `collisionBoxes` is present and non-empty it is canonical; invalid V2
data is rejected rather than falling back to legacy fields. The legacy
center/half-extents fields mirror the first Box for one compatibility cycle.
Existing single-Box editor actions update that first Box while preserving its
ID/quaternion and every additional Compound Box. Robot Geometry and Object Asset
stores clone, replace, capture, and restore the full canonical array.

## 9. Performance and Resource Rules

- Current-pose query frequency is capped at 10 Hz.
- Broad phase runs before every OBB test.
- Default active proxies: at most 7 Robot Link boxes, 1 Tool box, 1 Workbench
  Environment box, and 256 external boxes.
- Compound limit: at most 16 boxes per Entity and 1,024 boxes per project.
- Sequence validation runs only in a Worker and caps at 20,000 samples.
- Finding output caps at 10,000 rows; summary marks truncation.
- No render Mesh vertices or STEP bytes are copied into the collision Worker.
- Collision results must not be written into React state per render frame.
- Existing project triangle budgets remain unchanged because proxy complexity is
  budgeted independently.

## 10. Error Handling

- Invalid Box values are rejected at edit/import boundaries.
- Missing scene objects produce inactive diagnostics, not false collision rows.
- Worker cancellation resolves as cancelled rather than failed.
- Worker crash leaves the previous report visible with a stale marker and an
  actionable error.
- Pair settings referencing removed Entities remain inactive until explicitly
  deleted or the Entity returns.
- Report export never includes raw STEP data or project secrets.

## 11. Success Criteria

### Functional

1. No production source imports or mounts `@react-three/rapier`.
2. Robot Link, Tool/Gripper, held Object, built-in Equipment, and imported Object
   Instances use one geometry collision query contract.
3. Custom Robot Link center/half-extents are used by the actual query.
4. Imported Object collider metadata participates in current-pose and sequence
   validation.
5. The existing `workcell:workbench` proxy remains an Environment participant,
   including the existing allowed Robot-Link pair behavior.
6. OBB collision and proxy near-miss results are deterministic under Entity
   input order changes.
7. Pair ignore/restore takes effect without changing scene transforms and stays
   attached to the same canonical Entity IDs across grasp/release.
8. Collision never changes Object/Robot pose; it only reports, highlights,
   logs, and optionally pauses playback.
9. Grasp detection works without Physics/RigidBody and held Objects remain TCP
   children.
10. Preview and Validate sequence scans return stable sample counts and finding
   times independent of render FPS.
11. Collision findings can be navigated and exported as JSON/CSV.

### Persistence and compatibility

12. Existing V1 `.wdtwin` projects import with identical visible placement and
    one generated Box per prior collider.
13. V2 export/import and active Robot/Object store replacement preserve Compound
    Boxes, policy, ignored pairs, Robot, Objects, frames, Poses, and OPC UA
    settings without reducing proxies to one Box.
14. Invalid or oversized collision data is rejected atomically.

### Performance and quality

15. Current-pose queries never exceed the configured 10 Hz scheduler cap.
16. Sequence scan runs in a Worker, supports cancellation, and enforces sample
    and finding caps.
17. A reference fixture with 7 Link boxes, 1 Tool box, and 50 external boxes
    completes a 1,000-sample Validate run without blocking browser animation.
18. Scene telemetry exposes current Entity/Box/candidate/narrow-phase/finding
    counts.
19. Full unit/integration suite, CAD validation, production build, Playwright
    project round-trip, Web-only Docker smoke, and OPC UA-profile smoke pass.

### Product and safety language

20. UI and reports identify results as `Geometry Proxy Collision` and
    `Approximate Clearance`.
21. Documentation explicitly states that results are not physics, RobotWare,
    SafeMove, or safety-rated validation.

## 12. Deferred Detailed Validation

The next optional slice may add Worker-built convex hulls and triangle BVHs for
an explicit `Detailed Mesh Validation` command. It must remain opt-in, use the
same Entity/Pair/Finding contracts, and never become a per-frame query.
