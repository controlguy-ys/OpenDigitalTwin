# Generic Robot Import and Mechanical Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace NED2-specific runtime assumptions with a validated variable-DOF robot model, preserve the supplied NED2 exactly as the first built-in definition, import additional robots from STEP plus Manifest or resolved URDF, and apply versioned mechanical-dimension overrides without deforming CAD topology.

**Architecture:** Immutable `RobotDefinitionV1` records describe normalized links, joints, frames, and content-addressed assets. `MechanicalConfigurationV1` records contain versioned overrides; their validated composition produces an in-memory `EffectiveRobotDefinition`. `RobotInstanceV1` attaches that definition/configuration to the Frame Graph. A generic rig, renderer, collision system, and gripper runtime consume the effective definition, while a transactional import service converts STEP assets to metre-based GLB, validates complete topology, and persists assets only after all stages succeed.

**Tech Stack:** TypeScript 6, React 19, Three.js 0.185, React Three Fiber 9.6, React Three Rapier 2.2, OCCT Import JS 0.0.23, Three GLTFExporter/GLTFLoader, Zustand 5, Dexie 4, Web Crypto SHA-256, DOMParser, Vitest 4, Playwright 1.61

## Global Constraints

- Start after the Frame Graph plan is complete and reviewed. Consume its exact `Pose3D`, frame graph, `useFrameStore`, equipment v2, and Dexie v2 outputs.
- Export the exact names `RobotDefinitionV1`, `EffectiveRobotDefinition`, `RobotInstanceV1`, `orderedMovableJoints`, `useRobotInstanceStore`, `SceneDatabase`, and `sceneDb` for the OPC UA and Pose Sequence plans.
- Internal coordinates are right-handed Z-up, metres, radians, and normalized quaternions. Preserve source units and conversions as provenance.
- First-release topology is one rooted acyclic tree with `fixed`, `revolute`, `continuous`, and `prismatic` joints. Reject parallel/closed-loop, planar/floating, mimic/coupled, and multi-parent mechanisms.
- STEP geometry never supplies implicit kinematics. A STEP-only robot is activated only after the manual Setup Wizard defines and validates every required relationship.
- Resolved `.urdf` is supported; do not execute Xacro and do not silently ignore unsupported tags.
- Nominal definitions are immutable. Mechanical changes create a new configuration revision and never mutate source definition/assets.
- `[id, revision]` is an immutable content key for definitions and configurations: identical canonical content is idempotently reused, different content at the same key aborts with a revision-conflict error, and creating a new revision is an explicit operator/import action.
- Robot-definition named-frame IDs are definition-local. Every instance expands
  them through one canonical namespace helper; no reusable definition embeds a
  scene-global `FrameNode` ID.
- A TCP has one owner and one graph node: it is a persisted, editable manual
  frame owned by its RobotInstance and parented to that instance's derived
  flange. The pure FK adapter emits derived nodes before graph validation;
  `RobotModel` only binds object refs and never effect-registers any duplicate
  `FrameNode`, especially a TCP.
- Definition-local editable sensor/camera templates materialize as namespaced
  persisted manual children of an existing same-owner manual TCP. They never
  point directly at a derived flange, so only TCP requires the Frame plan's
  deferred-parent persistence allowance.
- Kinematic dimensions, visual assets, and collision assets are separate. Joint-origin changes do not stretch a mesh; mismatches remain visibly warned until acknowledged or a matching visual variant is selected.
- A link may contain multiple visual and collision geometry instances. Every
  geometry instance retains its own asset, local pose, and scale; rendering,
  collision, manifests, and URDF adaptation preserve that order and transform.
- Mechanical collision overrides are link-level (including the root link),
  never joint-level. This keeps collision ownership independent of kinematic
  parentage and supports fixed/root geometry.
- Preserve the current NED2 zero pose, seven supplied GLBs, six joint behavior, 1.08 m base placement, flange/TCP, deterministic Cup 01 pick fixture, collision bounds, stack-light/equipment interactions, and saved Pose values.
- Use exact built-in definition ID `NED2-12kg-127`, definition revision `builtin-v1`, instance ID `NED2-01`, and owner ID `robot:NED2-01` so the Frame, OPC UA, and Pose plans migrate the same entity.
- Keep content bytes private to repositories/Dexie. Never put `ArrayBuffer`, Three objects, Blob URLs, workers, refs, Rapier objects, or DOM nodes in Zustand serializable state.
- Every import uses aggregate resource limits, cancellation cleanup, immutable buffer ownership, SHA-256 addressing, and one final Dexie transaction.
- Do not modify or deploy any PLC or Automation Studio project.
- Every Terra task uses RED/GREEN TDD and a focused commit. After every shown `git add`, run `git diff --cached --check` and stop before commit on any nonzero exit so newly created files are included. Luna documentation is a separate final commit.

---

## File Map

```text
src/domain/robot/robot-definition.ts
src/domain/robot/robot-definition.test.ts
src/domain/robot/mechanical-configuration.ts
src/domain/robot/mechanical-configuration.test.ts
src/domain/robot/builtins/NED2-definition.ts
src/domain/robot/builtins/NED2-parity.test.ts
src/domain/robot/kinematics.ts
src/domain/robot/kinematics.test.ts
src/state/scene-db.ts
src/state/scene-db.test.ts
src/features/equipment/equipment-db.ts
src/features/robots/robot-asset-repository.ts
src/features/robots/robot-asset-repository.test.ts
src/features/robots/robot-definition-store.ts
src/features/robots/robot-definition-store.test.ts
src/features/robots/robot-instance-store.ts
src/features/robots/robot-instance-store.test.ts
src/features/robots/robot-instance-lifecycle.ts
src/features/robots/robot-instance-lifecycle.test.ts
src/features/robots/RobotInstanceList.tsx
src/features/robots/RobotInstanceList.test.tsx
src/features/robot/RobotModel.tsx
src/features/robot/RobotModel.test.ts
src/features/frames/frame-store.ts
src/features/frames/frame-store.test.ts
src/features/frames/scene-frame-graph.ts
src/features/frames/scene-frame-graph.test.ts
src/features/interaction/CollisionSystem.tsx
src/features/interaction/GraspController.tsx
src/features/interaction/interaction-store.ts
src/features/interaction/grasp-actions.ts
src/features/interaction/grasp-actions.test.ts
src/features/robot-import/robot-manifest.ts
src/features/robot-import/robot-manifest.test.ts
src/features/robot-import/robot-import-service.ts
src/features/robot-import/robot-import-service.test.ts
src/features/robot-import/three-group-to-glb.ts
src/features/robot-import/three-group-to-glb.test.ts
src/features/robot-import/urdf-adapter.ts
src/features/robot-import/urdf-adapter.test.ts
src/features/robot-import/RobotImportWizard.tsx
src/features/robot-import/RobotImportWizard.test.tsx
src/features/robot-config/mechanical-config-store.ts
src/features/robot-config/mechanical-config-store.test.ts
src/features/robot-config/MechanicalEditor.tsx
src/features/robot-config/MechanicalEditor.test.tsx
e2e/fixtures/robot/two-link/robot-manifest.json
e2e/fixtures/robot/two-link/base.step
e2e/fixtures/robot/two-link/arm.step
e2e/fixtures/robot/two-link/tool.step
e2e/fixtures/robot/resolved-urdf/robot.urdf
e2e/fixtures/robot/resolved-urdf/base-visual.glb
e2e/fixtures/robot/resolved-urdf/arm-visual-a.glb
e2e/fixtures/robot/resolved-urdf/arm-visual-b.glb
e2e/fixtures/robot/resolved-urdf/arm-collision-a.glb
e2e/fixtures/robot/resolved-urdf/arm-collision-b.glb
e2e/fixtures/robot/resolved-urdf/slider-visual.glb
e2e/fixtures/robot/resolved-urdf/slider-collision.glb
e2e/fixtures/robot/FIXTURE_PROVENANCE.md
e2e/generic-robot-import.spec.ts
src/test/debug-bridge.ts
src/test/debug-bridge.test.ts
docs/developer/robot-definition-manifest.md
docs/operator/robot-import.md
docs/operator/mechanical-configuration.md
docs/verification/generic-robot-verification.md
```

## Task 1: Define and Validate Nominal, Mechanical, and Effective Models

**Files:**
- Create: `src/domain/robot/robot-definition.ts`
- Create: `src/domain/robot/robot-definition.test.ts`
- Create: `src/domain/robot/mechanical-configuration.ts`
- Create: `src/domain/robot/mechanical-configuration.test.ts`

**Interfaces:**
- Consumes: Frame Graph `Pose3D`, `FrameRole`, scene-frame ID validation, and
  pose normalization. It deliberately does not consume `FrameNode` as reusable
  definition data.
- Produces: `RobotDefinitionV1`, `RobotJointDefinitionV1`,
  `RobotLinkDefinitionV1`, `RobotGeometryInstanceV1`,
  `RobotNamedFrameDefinitionV1`, `MechanicalConfigurationV1`,
  `EffectiveRobotDefinition`, `validateRobotDefinition`,
  `applyMechanicalConfiguration`, and `orderedMovableJoints`.

- [ ] **Step 1: Write topology, units, limits, and immutable-composition RED tests**

```ts
it('accepts one rooted tree and returns deterministic parent-before-child joints', () => {
  const definition = twoLinkDefinition()
  expect(validateRobotDefinition(definition)).toEqual(definition)
  expect(orderedMovableJoints(definition).map(({ id }) => id)).toEqual(['joint-1'])
})

it.each(['duplicate-id', 'missing-root', 'cycle', 'multi-parent', 'zero-axis', 'bad-home', 'unsupported-joint', 'named-frame-cycle', 'bad-manual-sensor-parent', 'bad-geometry-scale', 'bad-collision-source']) (
  'rejects %s without returning a partial model',
  (fault) => expect(() => validateRobotDefinition(definitionWithFault(fault))).toThrow(),
)

it('composes overrides without mutating the nominal definition', () => {
  const nominal = twoLinkDefinition()
  const snapshot = structuredClone(nominal)
  const effective = applyMechanicalConfiguration(nominal, configuration({
    jointOverrides: { 'joint-1': { origin: poseAt(0, 0, 0.8), direction: -1, zeroOffset: 0.1 } },
  }))
  expect(effective.joints[0]).toMatchObject({ origin: poseAt(0, 0, 0.8), direction: -1, zeroOffset: 0.1 })
  expect(nominal).toEqual(snapshot)
})

it('keeps named frames local to a reusable definition and validates their local attachment graph', () => {
  const definition = twoLinkDefinition()
  expect(definition.namedFrames).toContainEqual(expect.objectContaining({
    id: 'tool0', parent: { kind: 'link', linkId: 'arm' }, ownership: 'derived',
  }))
  expect(definition.namedFrames).toContainEqual(expect.objectContaining({
    id: 'wrist-camera', parent: { kind: 'frame', frameId: 'gripper' },
    role: 'camera', ownership: 'instance-manual',
  }))
  expect(definition.namedFrames.every(({ id }) => !id.includes('robot-a'))).toBe(true)
  expect(() => validateRobotDefinition(definitionWithFault('named-frame-cycle'))).toThrow(/frame/i)
})

it('preserves ordered independent visual and collision geometry transforms', () => {
  const definition = twoLinkDefinitionWithMultipleGeometries()
  const arm = definition.links.find(({ id }) => id === 'arm')!
  expect(arm.visualGeometries.map(({ assetId, pose, scale }) => ({ assetId, pose, scale })))
    .toEqual(expectedArmVisualGeometries())
  expect(arm.collisionGeometries).toHaveLength(2)
})

it('overrides collision geometry on the root link without changing a joint', () => {
  const nominal = twoLinkDefinition()
  const effective = applyMechanicalConfiguration(nominal, configuration({
    linkGeometryOverrides: {
      base: {
        collisionGeometries: [{
          id: 'root-collision', assetId: fixtureSha256AssetId('root-collision'),
          pose: poseAt(0, 0, 0.1), scale: [1, 2, 1],
        }],
        collisionBounds: [{
          id: 'root-box', sourceGeometryId: 'root-collision',
          pose: poseAt(0, 0, 0.1), halfExtents: [0.2, 0.3, 0.1],
        }],
      },
    },
  }))
  expect(effective.links.find(({ id }) => id === 'base')!.collisionGeometries[0]!.assetId)
    .toBe(fixtureSha256AssetId('root-collision'))
  expect(effective.joints).toEqual(nominal.joints)
})
```

The test file defines complete valid factories for every referenced fixture so
each fault changes exactly one invariant. `fixtureSha256AssetId(label)` maps
fixture labels to checked-in deterministic lowercase 64-hex digests; no test
uses a human-readable value after the `sha256:` prefix.

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/domain/robot/robot-definition.test.ts src/domain/robot/mechanical-configuration.test.ts`

Expected: FAIL because the generic definition/configuration modules do not exist.

- [ ] **Step 3: Implement canonical definition types**

```ts
export type RobotJointType = 'fixed' | 'revolute' | 'continuous' | 'prismatic'
export type RobotAssetId = `builtin:${string}` | `sha256:${string}`

export interface RobotJointLimits {
  readonly lower: number | null
  readonly upper: number | null
  readonly maxVelocity: number | null
  readonly maxAcceleration: number | null
  readonly maxEffort: number | null
}

export interface RobotJointDefinitionV1 {
  readonly id: string
  readonly name: string
  readonly type: RobotJointType
  readonly parentLinkId: string
  readonly childLinkId: string
  readonly origin: Pose3D
  readonly axis: readonly [number, number, number] | null
  readonly limits: RobotJointLimits
  readonly homePosition: number
  readonly direction: 1 | -1
  readonly zeroOffset: number
}

export interface RobotGeometryInstanceV1 {
  /** Stable only inside this link and geometry collection. */
  readonly id: string
  readonly assetId: RobotAssetId
  readonly pose: Pose3D
  /** Positive finite source/import scale; not a mechanical-editor deform control. */
  readonly scale: readonly [number, number, number]
}

export interface RobotCollisionBoxV1 {
  readonly id: string
  readonly sourceGeometryId: string | null
  readonly pose: Pose3D
  readonly halfExtents: readonly [number, number, number]
}

export interface RobotLinkDefinitionV1 {
  readonly id: string
  readonly name: string
  readonly visualGeometries: readonly RobotGeometryInstanceV1[]
  readonly collisionGeometries: readonly RobotGeometryInstanceV1[]
  readonly collisionBounds: readonly RobotCollisionBoxV1[]
}

export type RobotNamedFrameParentV1 =
  | { readonly kind: 'link'; readonly linkId: string }
  | { readonly kind: 'frame'; readonly frameId: string }

export interface RobotNamedFrameDefinitionV1 {
  /** Definition-local ID; it is never a scene FrameNode ID. */
  readonly id: string
  readonly name: string
  readonly role: 'flange' | 'tcp' | 'sensor' | 'camera' | 'custom'
  readonly parent: RobotNamedFrameParentV1
  readonly localPose: Pose3D
  readonly ownership: 'derived' | 'instance-manual'
}

export interface RobotDefinitionV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly revision: string
  readonly name: string
  readonly sourceFormat: 'builtin' | 'step-manifest' | 'urdf'
  readonly sourceSha256: string
  readonly sourceAssetIds: readonly RobotAssetId[]
  readonly rootLinkId: string
  readonly links: readonly RobotLinkDefinitionV1[]
  readonly joints: readonly RobotJointDefinitionV1[]
  readonly namedFrames: readonly RobotNamedFrameDefinitionV1[]
  readonly defaultFlangeFrameLocalId: string
  readonly defaultTcpFrameLocalId: string | null
}
```

`validateRobotDefinition()` clones/normalizes every tuple, requires unique IDs,
one root, complete reachability, one incoming joint per non-root link, no cycle,
well-formed/deduplicated source and runtime asset IDs, null axis for fixed joints, finite normalized non-zero axis for
movable joints, finite lower<=home<=upper for bounded joints, null position
limits for continuous joints, and positive optional dynamic limits. It also
requires each geometry ID to be unique within its collection, every geometry
scale and collision half-extent to be finite and positive, every local pose to
normalize, at least one visual geometry per link, and every non-null collision
box `sourceGeometryId` to resolve within that link's collision collection.
Every definition-local named-frame parent graph must be reachable and acyclic.
The default flange must be a derived `flange`; every `tcp` must be
an `instance-manual` template whose parent chain reaches a derived flange. V1
requires every `instance-manual` sensor/camera to have a direct
`instance-manual` TCP parent, rejects manual roles other than TCP/sensor/camera,
and rejects a manual sensor/camera attached directly to a derived flange.
Repository/import validation separately resolves every non-built-in asset ID
before persistence; the pure domain validator never reaches into Dexie.

- [ ] **Step 4: Implement versioned overrides**

```ts
export interface MechanicalJointOverrideV1 {
  readonly origin?: Pose3D
  readonly axis?: readonly [number, number, number]
  readonly direction?: 1 | -1
  readonly zeroOffset?: number
  readonly homePosition?: number
  readonly limits?: Partial<RobotJointLimits>
}

export interface MechanicalLinkGeometryOverrideV1 {
  readonly visualGeometries?: readonly RobotGeometryInstanceV1[]
  readonly collisionGeometries?: readonly RobotGeometryInstanceV1[]
  readonly collisionBounds?: readonly RobotCollisionBoxV1[]
}

export interface MechanicalConfigurationV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly revision: string
  readonly robotDefinitionId: string
  readonly robotDefinitionRevision: string
  readonly name: string
  readonly retention: 'shared' | 'instance-owned'
  readonly jointOverrides: Readonly<Record<string, MechanicalJointOverrideV1>>
  readonly frameOverrides: Readonly<Record<string, Pose3D>>
  readonly linkGeometryOverrides: Readonly<Record<string, MechanicalLinkGeometryOverrideV1>>
  readonly acknowledgedGeometryMismatch: boolean
}

export interface EffectiveRobotDefinition extends RobotDefinitionV1 {
  readonly nominalRevision: string
  readonly configurationId: string
  readonly configurationRevision: string
  readonly geometryMismatchLinkIds: readonly string[]
}
```

Compose on deep clones, reject unknown joint, local-frame, and link override
IDs, and re-run complete definition validation. `frameOverrides` keys are
definition-local named-frame IDs, not scene IDs. Link geometry replacement is
whole-collection and works for every link, including the root; no joint
contains collision fields. Runtime joint transform uses
`effectivePosition = direction * commandedPosition + zeroOffset`; stored limits
and Poses remain in commanded canonical coordinates. Mark descendants of any
origin override as geometry-mismatched unless every affected link selects an
explicit `visualGeometries` variant. Applying a mismatched configuration requires
`acknowledgedGeometryMismatch=true` but never suppresses the persistent badge.

- [ ] **Step 5: Run GREEN and commit**

Run each command separately and stop on the first nonzero exit:

1. `npm run test:run -- src/domain/robot/robot-definition.test.ts src/domain/robot/mechanical-configuration.test.ts`
2. `npm run lint`
3. `git diff --check`

Expected: every command exits 0; topology, joint-type, unit, limit,
immutability, definition-local frame, multi-geometry, root-link override,
mismatch, and calibration-formula tests PASS.

```powershell
git add src/domain/robot/robot-definition.ts src/domain/robot/robot-definition.test.ts src/domain/robot/mechanical-configuration.ts src/domain/robot/mechanical-configuration.test.ts
git diff --cached --check
git commit -m "feat: define configurable robot mechanisms"
```

## Task 2: Migrate NED2 to the First Built-In Definition With Exact Parity

**Files:**
- Create: `src/domain/robot/builtins/NED2-definition.ts`
- Create: `src/domain/robot/builtins/NED2-parity.test.ts`
- Modify: `src/domain/robot/NED2.ts`
- Modify: `src/domain/robot/kinematics.ts`
- Modify: `src/domain/robot/kinematics.test.ts`
- Modify: `src/features/interaction/robot-collision-bounds.ts`

**Interfaces:**
- Consumes: current NED2 constants, seven GLBs, `asset-report.json`, Task 9 deterministic pick fixture.
- Produces: `NED2_ROBOT_DEFINITION` with exact ID `NED2-12kg-127` and revision `builtin-v1`, generic `createRobotRig`, and matrix-parity evidence.

- [ ] **Step 1: Capture immutable legacy parity fixtures before refactoring**

```ts
const SAMPLE_POSES = [
  [0, 0, 0, 0, 0, 0],
  [90, -45, 20, 30, -60, 120],
  [184.8, -63.6, -205.2, -152, -22.1, -144.2],
] as const

function expectMatrixMapsClose(
  actual: Readonly<Record<string, readonly number[]>>,
  expected: Readonly<Record<string, readonly number[]>>,
  digits = 9,
): void {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort())
  for (const id of Object.keys(expected)) {
    expect(actual[id]).toHaveLength(expected[id]!.length)
    expected[id]!.forEach((value, index) => {
      expect(actual[id]![index]).toBeCloseTo(value, digits)
    })
  }
}

it.each(SAMPLE_POSES)('matches every legacy link and tool matrix at %j', (degrees) => {
  const legacy = snapshotLegacyMatrices(degrees)
  const generic = snapshotDefinitionMatrices(NED2_ROBOT_DEFINITION, degrees.map(MathUtils.degToRad))
  expectMatrixMapsClose(generic, legacy)
})

it('propagates a prismatic displacement through a rotated revolute parent to flange and TCP', () => {
  const definition = mixedRevolutePrismaticDefinition({
    revoluteOrigin: poseAt(1, 0, 0),
    revoluteAxis: [0, 0, 1],
    prismaticOrigin: poseAt(1, 0, 0),
    prismaticAxis: [1, 0, 0],
    flangeOrigin: poseAt(0.3, 0, 0),
    tcpOrigin: poseAt(0.1, 0, 0),
  })
  const zero = snapshotDefinitionWorldPoses(definition, {
    'arm-revolute': Math.PI / 2,
    'slider-prismatic': 0,
  })
  const moved = snapshotDefinitionWorldPoses(definition, {
    'arm-revolute': Math.PI / 2,
    'slider-prismatic': 0.2,
  })

  expectPoseClose(moved.links.arm, zero.links.arm)
  const zeroTargets = {
    slider: zero.links.slider,
    'flange:tool0': zero.frames['flange:tool0'],
    'tcp:default': zero.frames['tcp:default'],
  }
  const movedTargets = {
    slider: moved.links.slider,
    'flange:tool0': moved.frames['flange:tool0'],
    'tcp:default': moved.frames['tcp:default'],
  }
  for (const id of ['slider', 'flange:tool0', 'tcp:default'] as const) {
    expectTupleClose(
      movedTargets[id].position,
      zeroTargets[id].position.map((value, axis) => value + [0, 0.2, 0][axis]!) as Vec3,
    )
    expectTupleClose(movedTargets[id].quaternion, zeroTargets[id].quaternion)
  }
  expectTupleClose(moved.frames['tcp:default'].position, [1, 1.6, 0])
})

it('retains GLB bounds, collision bounds, and deterministic Cup 01 sensor entry', () => {
  expect(readDefinitionBounds(NED2_ROBOT_DEFINITION)).toEqual(readAssetReportBounds())
  expect(sensorIntersectsCup(NED2_ROBOT_DEFINITION, CUP01_PICK_ANGLES_DEG)).toBe(true)
})
```

- [ ] **Step 2: Run the parity test on the legacy implementation**

Run: `npm run test:run -- src/domain/robot/builtins/NED2-parity.test.ts`

Expected: FAIL because `NED2_ROBOT_DEFINITION` does not exist; the legacy
snapshot side must already pass independently.

- [ ] **Step 3: Encode the built-in definition**

Create one immutable definition with LINK00–LINK06 assets, J1–J6 parent/child,
the approved origins/axes/limits, ordered visual/collision geometry instances,
and local collision boxes from `asset-report.json`. Encode the flange/tool0 as
a definition-local derived frame and the gripper TCP as a definition-local
`instance-manual` template; neither contains a scene-global frame ID. Use
metres/radians and keep LINK05's original-inch provenance while referencing its
already normalized GLB.
Seed its no-op/default MechanicalConfiguration with `retention:'shared'`.
Compute `sourceSha256` from a stable canonical JSON serialization in the CAD
validation script; do not invent or hand-edit a hash.
Populate `sourceAssetIds` with stable `builtin:` IDs for the supplied STEP
sources while the seven normalized GLBs remain referenced by geometry records;
source provenance and runtime geometry therefore have separate reachable IDs.

- [ ] **Step 4: Generalize kinematics without a joint-count constant**

```ts
export interface RobotRig {
  readonly definition: EffectiveRobotDefinition
  readonly root: Group
  readonly jointPivots: Readonly<Record<string, Group>>
  readonly linkSlots: Readonly<Record<string, Group>>
  readonly frameSlots: Readonly<Record<string, Group>>
}

export function setRigJointPositions(
  rig: RobotRig,
  commanded: Readonly<Record<string, number>>,
): void {
  for (const joint of orderedMovableJoints(rig.definition)) {
    const value = joint.direction * requireFinite(commanded[joint.id], joint.id) + joint.zeroOffset
    applyJointTransform(rig.jointPivots[joint.id]!, joint, value)
  }
}
```

Fixed joints create a child slot without a movable value. Revolute/continuous
apply axis-angle; prismatic applies `origin + axis*value`. Build slots in the
validator's deterministic topological order. Keep a deprecated NED2 tuple adapter
only until the named-joint source plan migrates callers.

- [ ] **Step 5: Run parity, CAD, and commit**

Run each command separately and stop on the first nonzero exit:

1. `npm run test:run -- src/domain/robot src/features/interaction/interaction-rapier.test.ts`
2. `npm run cad:validate`
3. `git diff --check`

Expected: every command exits 0; all three NED2 sample poses match every
link/tool matrix; the mixed revolute/prismatic rig moves its slider, flange,
and TCP exactly 0.2 m along the revolute-transformed axis; fixed pick enters;
CAD 7/7, 0 errors, 0 warnings.

```powershell
git add src/domain/robot src/features/interaction/robot-collision-bounds.ts public/models/robot/asset-report.json scripts/cad
git diff --cached --check
git commit -m "refactor: migrate NED2 to a robot definition"
```

## Task 3: Render and Interact With Variable-DOF Robot Instances

**Files:**
- Create: `src/features/robots/robot-instance-store.ts`
- Create: `src/features/robots/robot-instance-store.test.ts`
- Modify: `src/features/frames/frame-store.ts`
- Modify: `src/features/frames/frame-store.test.ts`
- Modify: `src/features/frames/FrameTree.tsx`
- Modify: `src/features/frames/FrameTree.test.tsx`
- Modify: `src/features/frames/scene-frame-graph.ts`
- Modify: `src/features/frames/scene-frame-graph.test.ts`
- Modify: `src/features/robot/RobotModel.tsx`
- Modify: `src/features/robot/RobotModel.test.ts`
- Modify: `src/features/scene/Workcell.tsx`
- Modify: `src/features/interaction/interaction-store.ts`
- Modify: `src/features/interaction/interaction-store.test.ts`
- Modify: `src/features/interaction/CollisionSystem.tsx`
- Modify: `src/features/interaction/GraspController.tsx`
- Modify: `src/features/joints/JointInspector.tsx`
- Modify: `src/features/joints/JointInspector.test.tsx`

**Interfaces:**
- Consumes: `EffectiveRobotDefinition`, Frame Graph Robot Base, persisted
  same-owner TCP allowance, and generic rig.
- Produces: `RobotInstanceV1`, `useRobotInstanceStore`, canonical
  `robotFrameId()`/`robotOwnerEntityId()` helpers, multi-instance renderer,
  dynamic joint UI/collision/grasp identity, and exactly one graph owner per TCP.

- [ ] **Step 1: Write variable-count and multi-instance RED tests**

```ts
it('stores independent joint maps and active TCPs for two instances of one definition', () => {
  const store = createRobotInstanceStore(dependencies)
  store.getState().addInstance(instance('robot-a'))
  store.getState().addInstance(instance('robot-b'))
  store.getState().setJoint('robot-a', 'joint-1', 0.5)
  expect(store.getState().runtimeByInstance['robot-a']!.jointPositions['joint-1']).toBe(0.5)
  expect(store.getState().runtimeByInstance['robot-b']!.jointPositions['joint-1']).toBe(0)
  expect(store.getState().instances['robot-a']).not.toHaveProperty('jointPositions')
})

it('namespaces TCPs and their editable sensor/camera children as manual persisted nodes', () => {
  const frames = materializeRobotInstanceFrames(instance('robot-a'), twoTcpDefinitionWithTools())
  expect(frames.manual.map(({ id }) => id)).toEqual([
    'robot:robot-a:tcp:welder', 'robot:robot-a:tcp:camera',
    'robot:robot-a:sensor:force-sensor', 'robot:robot-a:camera:wrist-camera',
  ])
  expect(frames.manual).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'robot:robot-a:tcp:welder',
      parentId: 'robot:robot-a:flange:tool0',
      ownerEntityId: 'robot:robot-a', source: 'manual', editable: true,
    }),
    expect.objectContaining({
      id: 'robot:robot-a:camera:wrist-camera',
      parentId: 'robot:robot-a:tcp:camera',
      ownerEntityId: 'robot:robot-a', source: 'manual', editable: true,
    }),
  ]))
  const derived = deriveRobotFrameNodes(instance('robot-a'), effectiveDefinition(), homeJointMap())
  expect(derived.some(({ id }) => frames.manual.some((manual) => manual.id === id))).toBe(false)
  expect(derived.every(({ ownerEntityId, source }) =>
    ownerEntityId === 'robot:robot-a' && source === 'derived')).toBe(true)
  expect(() => createSceneFrameGraph({
    persisted: [frames.base, ...frames.manual], derived,
  })).not.toThrow()
})

it('derives a link-mounted camera with an exact instance namespace and never derives TCP', () => {
  const definition = definitionWithDerivedCamera({
    id: 'wrist-fixed', parent: { kind: 'link', linkId: 'arm' },
  })
  const derived = deriveRobotFrameNodes(instance('robot-a'), definition, homeJointMap())
  expect(derived).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'robot:robot-a:camera:wrist-fixed',
      role: 'camera', source: 'derived', ownerEntityId: 'robot:robot-a',
    }),
  ]))
  expect(derived.some(({ role }) => role === 'tcp')).toBe(false)
})

it('binds RobotModel objects to pre-derived frame IDs without registering graph nodes', () => {
  render(<RobotModel robotInstanceId="robot-a" />)
  expect(bindRobotFrameObject).toHaveBeenCalled()
  expect(registerFrameNode).not.toHaveBeenCalled()
})

it('names selection and collision entities with instance and link IDs', () => {
  selectRobotLink('robot-b', 'arm-link')
  expect(selection()).toEqual({ kind: 'robot-link', robotInstanceId: 'robot-b', linkId: 'arm-link' })
  expect(canonicalCollisionPair('robot-link:robot-b:arm-link', 'equipment:cup-01')).toContain('robot-b')
})

it('registers Robot Base as a lifecycle root and blocks frame-only ancestor deletion', async () => {
  const parentId = await frameStore.getState().createManualFrame(machineFrameDraft('Robot Cell'))
  robotStore.getState().addInstance(instance('robot-a', { baseParentFrameId: parentId }))
  const framesBefore = frameStore.getState().frames
  await expect(frameStore.getState().deleteFrame(parentId, {
    childDisposition: { mode: 'delete-subtree' },
    replacementActiveTcpFrameId: null,
  })).rejects.toThrow(/robot-a.*lifecycle/i)
  expect(robotStore.getState().instances['robot-a']).toBeDefined()
  expect(frameStore.getState().frames).toEqual(framesBefore)
})

it('routes active TCP selection to the RobotInstance owner', async () => {
  robotStore.getState().addInstance(instanceWithTwoTcps('robot-a', 'tcp-1'))
  await robotStore.getState().setActiveTcp('robot-a', 'robot:robot-a:tcp:tcp-2')
  expect(robotStore.getState().instances['robot-a']!.activeTcpFrameId)
    .toBe('robot:robot-a:tcp:tcp-2')
  render(<FrameTree />)
  await user.selectOptions(screen.getByLabelText('robot-a Active TCP'), 'robot:robot-a:tcp:tcp-1')
  expect(robotSetActiveTcp).toHaveBeenCalledWith('robot-a', 'robot:robot-a:tcp:tcp-1')
  expect(frameStoreSetActiveTcp).not.toHaveBeenCalled()
})

it.each([
  '', ' leading', 'trailing ', 'a:b', '../robot', '한글', 'world', 'robot-link', 'a'.repeat(65),
])('rejects unsafe local ID %s', (value) => {
  expect(() => requireLocalId(value)).toThrow(/local ID/i)
})

it.each(['NED2-01', 'joint_1', 'tool.0', 'camera-a'])('accepts stable ASCII local ID %s', (value) => {
  expect(requireLocalId(value)).toBe(value)
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/robots/robot-instance-store.test.ts src/features/frames/frame-store.test.ts src/features/frames/FrameTree.test.tsx src/features/frames/scene-frame-graph.test.ts src/features/robot/RobotModel.test.ts src/features/interaction`

Expected: FAIL because stores, selections, and collision IDs are NED2-singleton types.

- [ ] **Step 3: Implement instance ownership**

```ts
export interface RobotInstanceV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly robotDefinitionId: string
  readonly robotDefinitionRevision: string
  readonly mechanicalConfigurationId: string
  readonly mechanicalConfigurationRevision: string
  readonly baseFrameId: string
  readonly activeTcpFrameId: string
}

export interface RobotInstanceRuntimeState {
  readonly jointPositions: Readonly<Record<string, number>>
  readonly quality: 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE'
}
```

`useRobotInstanceStore` owns serializable persisted `instances`, active
selection, and a structurally separate memory-only `runtimeByInstance` map. It
validates definition/config revisions, exact movable joint IDs, finite values,
limits, Base frame role, and attached TCP before mutation. `baseFrameId` and
`activeTcpFrameId` are globally namespaced scene IDs; an active TCP must have
role `tcp`, `source:'manual'`, `editable:true`, and
`ownerEntityId===robotOwnerEntityId(instance.id)`. Hydration initializes the
runtime joint map from effective Home values; joint changes never mutate a
`RobotInstanceV1` row and remain transient until Pose Sequence capture. Only
instance metadata persists in Task 4.
Definitions without a default TCP may remain in the library as incomplete
drafts, but `addInstance`/import activation rejects them until the Wizard adds
at least one TCP and selects `defaultTcpFrameLocalId`.

`addInstance()` registers `baseFrameId` in the Frame plan's shared
entity-lifecycle-root index with entity kind/ID `robot-instance:<id>` only after
the Base/manual frames and instance are accepted. Task 4 hydration registers
every valid persisted instance before Frame delete actions become available;
import does so only after its outer transaction commits. Only committed
RobotInstance lifecycle deletion unregisters the Base root, after its frame and
instance rows are deleted. Rollback/cancel preserves the registration. Thus
Frame Store subtree deletion reports the concrete RobotInstance and can never
orphan `RobotInstanceV1.baseFrameId`.

Implement one namespace function used by import, hydration, rendering,
selection, and deletion:

```ts
export type RobotFrameKind = 'base' | 'joint' | 'link' | 'flange' | 'tcp' | 'sensor' | 'camera' | 'custom'

const LOCAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const RESERVED_LOCAL_IDS = new Set(['world', 'mcp', 'equipment', 'robot', 'robot-link'])

export function requireLocalId(value: unknown, label = 'local ID'): string {
  if (
    typeof value !== 'string' ||
    !LOCAL_ID_PATTERN.test(value) ||
    RESERVED_LOCAL_IDS.has(value.toLowerCase())
  ) {
    throw new Error(`${label} must be 1-64 ASCII letters, digits, dot, underscore, or hyphen and not reserved`)
  }
  return value
}

export function robotOwnerEntityId(robotInstanceId: string): `robot:${string}` {
  return `robot:${requireLocalId(robotInstanceId)}`
}

export function robotFrameId(
  robotInstanceId: string,
  kind: RobotFrameKind,
  localId?: string,
): string {
  const owner = robotOwnerEntityId(robotInstanceId)
  return kind === 'base'
    ? `${owner}:base`
    : `${owner}:${kind}:${requireLocalId(localId)}`
}

export interface MaterializedRobotInstanceFrames {
  readonly base: FrameNode
  readonly manual: readonly FrameNode[] // TCP plus editable sensor/camera children
}
```

Apply `requireLocalId()` at every definition/import/activation boundary for
RobotInstance, link, joint, named-frame, geometry, and requested activation IDs
before composing colon-delimited frame/collision IDs. Definition display names
may use Unicode, but structural local IDs are ASCII-only and never silently
trimmed. Duplicate detection runs after this validation; canonical namespaces
remain parseable and collision-free.

`materializeRobotInstanceFrames()` expands definition-local named frames. It
returns the Base separately and every `instance-manual` TCP/sensor/camera in
`manual` as persistent manual `FrameNode`s, applying effective local-frame
overrides. A TCP's persisted parent is the
namespaced same-owner derived flange ID; each sensor/camera parent is an already
persisted namespaced same-owner TCP. Reject a second node with the same
namespaced ID or any owner/parent mismatch. For the existing NED2 adapter,
migrate its current persisted active TCP to this exact ID and put
`activeTcpFrameId` on the RobotInstance; do not
leave the Frame store as a second active-TCP owner.

Expose `useRobotInstanceStore.setActiveTcp(robotInstanceId, tcpFrameId)`. It
validates a namespaced persisted manual TCP with matching owner, updates only
that RobotInstance, and Task 4 persists the row transactionally. Adapt
`FrameTree`/`FrameInspector` active-TCP controls to this action. During the
v2-to-v3 transition, Frame Store's old `setActiveTcp(robotOwnerId, ...)` becomes
an internal compatibility delegate only for an unmigrated owner; once the
instance exists it must not mutate `scene.activeTcpByRobotOwnerId` or maintain
parallel active-TCP state. Remove the public UI dependency on that action.

Separately, `deriveRobotFrameNodes(instance, effectiveDefinition,
jointPositions)` is a synchronous pure FK adapter. It emits all namespaced
`source:'derived'` joint/link nodes plus every definition named frame with
`ownership:'derived'` and role flange/sensor/camera/custom, resolving their
link/derived-frame parent chain in validated topological order, before
`createSceneFrameGraph()` performs strict whole-graph validation. It rejects a
derived TCP; every TCP remains one persisted instance-manual node. It has no
React lifecycle, Three ref, or registration side effect. RobotModel binds its
Object3D refs to those pre-existing frame IDs in a separate runtime object map;
moving/render metadata may update there, but it cannot create or own FrameNodes.

- [ ] **Step 4: Generalize rendering and interactions**

RobotModel accepts `robotInstanceId`, resolves its effective definition, loads
every ordered visual geometry asset, clones once per geometry instance,
attaches by link ID, and applies that instance's local pose and scale. It binds
object refs to pure-adapter joint/link/flange IDs and never registers FrameNodes
in an effect. Workcell maps every persisted instance. Robot selection and
collision IDs become:

```ts
type RobotEntityId = `robot:${string}` | `robot-link:${string}:${string}`
```

CollisionSystem iterates every effective link collision box, including all
root-link boxes; a generated box references its `sourceGeometryId`, so multiple
URDF collision geometries retain independent transforms while using the
approved simplified-collision runtime. Adjacent pairs come from actual
parent/child joints instead of LINK index. GraspController is bound
to the selected/active robot instance's TCP and keeps Task 9's held registry,
local-Z sensor, nearest collider center, carried collider, removal lock, and
pair cleanup. JointInspector renders `orderedMovableJoints()` and uses each
joint's unit/limits.

- [ ] **Step 5: Run GREEN and commit**

Run each command separately and stop on the first nonzero exit:

1. `npm run test:run -- src/features/robots src/features/frames/frame-store.test.ts src/features/frames/FrameTree.test.tsx src/features/frames/scene-frame-graph.test.ts src/features/robot src/features/interaction src/features/joints/JointInspector.test.tsx`
2. `npm run build`
3. `git diff --check`

Expected: every command exits 0. NED2 and two-link/prismatic fixtures render and
move; multiple geometry transforms remain independent; instance frame IDs do
not collide; each TCP appears exactly once as a persisted manual frame and each
editable sensor/camera remains a persisted child of its TCP; Task 9 tests remain
green; active-TCP UI routes to the instance owner; frame-only ancestor deletion
cannot orphan a Robot Base.

```powershell
git add src/features/robots src/features/frames/frame-store.ts src/features/frames/frame-store.test.ts src/features/frames/FrameTree.tsx src/features/frames/FrameTree.test.tsx src/features/frames/scene-frame-graph.ts src/features/frames/scene-frame-graph.test.ts src/features/robot src/features/scene/Workcell.tsx src/features/interaction src/features/joints/JointInspector.tsx src/features/joints/JointInspector.test.tsx
git diff --cached --check
git commit -m "feat: run variable-DOF robot instances"
```

## Task 4: Add Canonical Scene Database and Content-Addressed Robot Assets

**Files:**
- Create: `src/state/scene-db.ts`
- Create: `src/state/scene-db.test.ts`
- Modify: `src/features/equipment/equipment-db.ts`
- Create: `src/features/robots/robot-asset-repository.ts`
- Create: `src/features/robots/robot-asset-repository.test.ts`
- Create: `src/features/robots/robot-definition-store.ts`
- Create: `src/features/robots/robot-definition-store.test.ts`
- Modify: `src/features/robots/robot-instance-store.ts`
- Modify: `src/features/robots/robot-instance-store.test.ts`
- Create: `src/features/robots/robot-instance-lifecycle.ts`
- Create: `src/features/robots/robot-instance-lifecycle.test.ts`
- Create: `src/features/robots/RobotInstanceList.tsx`
- Create: `src/features/robots/RobotInstanceList.test.tsx`
- Modify: `src/features/frames/frame-store.ts`
- Modify: `src/features/frames/frame-store.test.ts`
- Modify: `src/features/interaction/grasp-actions.ts`
- Modify: `src/features/interaction/grasp-actions.test.ts`
- Modify: `src/features/interaction/interaction-store.ts`
- Modify: `src/features/interaction/interaction-store.test.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.test.tsx`

**Interfaces:**
- Consumes: Dexie v2 frames/equipment DB and generic domain records.
- Produces: `SceneDatabase`, singleton `sceneDb`, content-addressed assets,
  definition/config/instance tables, compatibility `equipmentDb` re-export,
  and one transactional RobotInstance deletion lifecycle.

- [ ] **Step 1: Write database migration and asset-lifetime RED tests**

```ts
it('opens a v2 scene as v3 without duplicating equipment or frames', async () => {
  const v2SceneRecord = await seedFramePlanV2('scene-v3')
  const db = new SceneDatabase('scene-v3')
  await db.open()
  expect(await db.equipment.count()).toBe(3)
  expect(await db.frames.count()).toBeGreaterThanOrEqual(6)
  expect(await db.scene.get(v2SceneRecord.key)).toEqual({
    ...v2SceneRecord,
    activeTcpByRobotOwnerId: {},
  })
  expect(await db.robotDefinitions.count()).toBe(1)
  expect((await db.robotInstances.get('NED2-01'))!.activeTcpFrameId)
    .toBe(v2SceneRecord.activeTcpByRobotOwnerId['robot:NED2-01'])
  await db.close()
  await db.open()
  expect(await db.robotInstances.count()).toBe(1)
  expect(await db.frames.where('role').equals('tcp').count()).toBe(1)
})

it('populates a brand-new latest database with one complete NED2 instance exactly once', async () => {
  const db = new SceneDatabase(uniqueDatabaseName())
  await db.open()
  expect(await db.robotDefinitions.get(['NED2-12kg-127', 'builtin-v1'])).toBeDefined()
  expect(await db.mechanicalConfigurations.get(['NED2-default', 'builtin-v1'])).toBeDefined()
  expect(await db.robotInstances.get('NED2-01')).toMatchObject({
    baseFrameId: 'robot:NED2-01:base',
    activeTcpFrameId: 'robot:NED2-01:tcp:default',
  })
  expect(await db.frames.get('robot:NED2-01:base')).toBeDefined()
  expect(await db.frames.get('robot:NED2-01:tcp:default')).toMatchObject({ revision: 1 })
  const counts = await sceneTableCounts(db)
  db.close()
  await db.open()
  expect(await sceneTableCounts(db)).toEqual(counts)
  await db.delete()
})

it('does not retire the v2 active-TCP adapter when the instance upgrade write fails', async () => {
  const v2SceneRecord = await seedFramePlanV2('scene-v3-failure')
  await expect(openVersion3WithInjectedInstancePutFailure('scene-v3-failure'))
    .rejects.toThrow('injected instance put failure')
  const v2 = await reopenFramePlanV2('scene-v3-failure')
  expect(await v2.scene.get(v2SceneRecord.key)).toEqual(v2SceneRecord)
})

it('persists TCP2 on the RobotInstance and leaves no migrated adapter owner', async () => {
  await seedInstanceWithTwoTcps(db, 'robot-a', 'tcp-1')
  await robotStore.getState().hydrate()
  await robotStore.getState().setActiveTcp('robot-a', 'robot:robot-a:tcp:tcp-2')
  await reopenStores()
  expect((await db.robotInstances.get('robot-a'))!.activeTcpFrameId)
    .toBe('robot:robot-a:tcp:tcp-2')
  expect((await db.scene.get('scene'))!.activeTcpByRobotOwnerId)
    .not.toHaveProperty('robot:robot-a')
  expect(await db.frames.where('ownerEntityId').equals('robot:robot-a').and(
    ({ role }) => role === 'tcp',
  ).count()).toBe(2)
})

it('replaces active TCP atomically when deleting it and survives reopen', async () => {
  await seedInstanceWithTwoTcps(db, 'robot-a', 'tcp-1')
  await frameStore.getState().deleteFrame('robot:robot-a:tcp:tcp-1', {
    childDisposition: { mode: 'delete-subtree' },
    replacementActiveTcpFrameId: 'robot:robot-a:tcp:tcp-2',
  })
  await reopenStores()
  expect(await db.frames.get('robot:robot-a:tcp:tcp-1')).toBeUndefined()
  expect((await db.robotInstances.get('robot-a'))!.activeTcpFrameId)
    .toBe('robot:robot-a:tcp:tcp-2')

  await seedInstanceWithTwoTcps(db, 'robot-b', 'tcp-1')
  db.failNextTransaction(new Error('disk full'))
  await expect(frameStore.getState().deleteFrame('robot:robot-b:tcp:tcp-1', {
    childDisposition: { mode: 'delete-subtree' },
    replacementActiveTcpFrameId: 'robot:robot-b:tcp:tcp-2',
  })).rejects.toThrow('disk full')
  expect(await db.frames.get('robot:robot-b:tcp:tcp-1')).toBeDefined()
  expect((await db.robotInstances.get('robot-b'))!.activeTcpFrameId)
    .toBe('robot:robot-b:tcp:tcp-1')
})

it('deduplicates identical GLB bytes and revokes Blob URLs on final release', async () => {
  const first = await repository.putAndAcquire(bytes, 'model/gltf-binary')
  const second = await repository.putAndAcquire(bytes.slice(0), 'model/gltf-binary')
  expect(first.sha256).toBe(second.sha256)
  expect(assetPut).toHaveBeenCalledOnce()
  repository.release(first.sha256)
  repository.release(second.sha256)
  expect(revokeObjectURL).toHaveBeenCalledOnce()
})

it.each(['definition', 'configuration'] as const) (
  'reuses identical immutable %s content and rejects a same-key content conflict', async (kind) => {
    const repository = immutableRecordRepository(kind, db)
    const original = immutableFixture(kind, { id: 'record-a', revision: '1' })
    await repository.putImmutable(original)
    await expect(repository.putImmutable(structuredClone(original))).resolves.toMatchObject({ reused: true })
    await expect(repository.putImmutable(changeCanonicalContent(original)))
      .rejects.toMatchObject({ code: `${kind.toUpperCase()}_REVISION_CONFLICT` })
    expect(await repository.get(['record-a', '1'])).toEqual(original)
  },
)

it('deletes owned frames and a last instance-owned config but retains shared records', async () => {
  await seedTwoInstancesSharingDefinitionAndConfig(db)
  await lifecycle.deleteRobotInstance('robot-a')
  expect(await db.robotInstances.get('robot-a')).toBeUndefined()
  expect(await db.frames.where('ownerEntityId').equals('robot:robot-a').count()).toBe(0)
  expect(await db.robotDefinitions.get(['two-link', '1'])).toBeDefined()
  expect(await db.mechanicalConfigurations.get(['two-link-cal', '1'])).toBeDefined()

  await lifecycle.deleteRobotInstance('robot-b')
  expect(await db.mechanicalConfigurations.get(['two-link-cal', '1'])).toBeUndefined()
  expect(await db.robotDefinitions.get(['two-link', '1'])).toBeDefined()
  expect(operationLog).toEqual(expect.arrayContaining(['delete-transaction:commit', 'asset-gc:start']))
  expect(operationLog.indexOf('asset-gc:start'))
    .toBeGreaterThan(operationLog.indexOf('delete-transaction:commit'))
})

it('retains original source assets reachable only through a retained definition', async () => {
  const sourceAssetId = fixtureSha256AssetId('source-step')
  const runtimeAssetId = fixtureSha256AssetId('runtime-glb')
  const orphanAssetId = fixtureSha256AssetId('orphan')
  await seedDefinitionWithSourceAndRuntimeAssets(db, {
    sourceAssetId, runtimeAssetId, orphanAssetId,
  })
  await lifecycle.deleteRobotInstance('robot-a')
  expect(await db.robotAssets.get(assetHash(sourceAssetId))).toBeDefined()
  expect(await db.robotAssets.get(assetHash(runtimeAssetId))).toBeDefined()
  expect(await db.robotAssets.get(assetHash(orphanAssetId))).toBeUndefined()
})

it('rolls back held release and source quiescence when instance deletion fails', async () => {
  const sourceToken = { robotInstanceId: 'robot-a', generation: 7 }
  source.quiesce.mockResolvedValueOnce(sourceToken)
  holdEquipmentFrom('robot-a', 'cup-01')
  db.failNextTransaction(new Error('disk full'))
  await expect(lifecycle.deleteRobotInstance('robot-a')).rejects.toThrow('disk full')
  expect(heldEquipment()).toEqual({ robotInstanceId: 'robot-a', equipmentId: 'cup-01' })
  expect(source.resume).toHaveBeenCalledWith(sourceToken)
  expect(selection()).toEqual({ kind: 'robot', robotInstanceId: 'robot-a' })
  expect(collisionPairsFor('robot-a')).not.toHaveLength(0)
  expect(await db.robotInstances.get('robot-a')).toBeDefined()
})

it('publishes held release and clears source, selection, collision, and runtime only after commit', async () => {
  holdEquipmentFrom('robot-a', 'cup-01')
  await lifecycle.deleteRobotInstance('robot-a')
  expect(operationLog).toEqual([
    'lock', 'source:quiesce', 'held:prepare', 'source:barrier:begin',
    'delete-transaction:begin', 'delete-transaction:commit', 'source:barrier:end',
    'held:publish', 'source:finalize',
    'selection:clear', 'collision:clear', 'object-bindings:clear', 'store:remove',
    'asset-gc:start', 'asset-gc:commit', 'unlock',
  ])
  expect(heldEquipment()).toBeNull()
  expect(collisionPairsFor('robot-a')).toHaveLength(0)
})

it('blocks deletion rather than orphaning a foreign-owned persisted child frame', async () => {
  await db.frames.put(fixtureFrameOwnedBy('fixture-7', 'robot:robot-a:base'))
  await expect(lifecycle.deleteRobotInstance('robot-a')).rejects.toThrow(/reparent.*fixture-7/i)
  expect(await db.robotInstances.get('robot-a')).toBeDefined()
})
```

The lifecycle test builds a fresh fake-indexeddb database and complete
operation-log, source, grasp, selection, collision, object-binding, and asset-GC
adapters in `beforeEach`; no test relies on process-global store state.

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/state/scene-db.test.ts src/features/robots/robot-asset-repository.test.ts src/features/robots/robot-definition-store.test.ts src/features/robots/robot-instance-lifecycle.test.ts`

Expected: FAIL because the canonical DB and repositories do not exist.

- [ ] **Step 3: Create schema v3 and compatibility exports**

```ts
export interface RobotAssetRecord {
  readonly sha256: string
  readonly mediaType: 'model/gltf-binary' | 'model/step' | 'application/urdf+xml' | 'application/json'
  readonly sourceName: string
  readonly bytes: ArrayBuffer
}

// Move the existing v1/v2 record contract here with the canonical database.
export interface SceneDatabaseRecord {
  readonly key: string
  readonly selectedEquipmentId: string | null
  /** Frame-plan v2 compatibility adapter; retained in schema, emptied per migrated owner. */
  readonly activeTcpByRobotOwnerId: Readonly<Record<string, string>>
}

export class SceneDatabase extends Dexie {
  equipment!: Table<EquipmentRecordV2, string>
  scene!: Table<SceneDatabaseRecord, string>
  frames!: Table<PersistedFrameRecord, string>
  robotAssets!: Table<RobotAssetRecord, string>
  robotDefinitions!: Table<RobotDefinitionV1, [string, string]>
  mechanicalConfigurations!: Table<MechanicalConfigurationV1, [string, string]>
  robotInstances!: Table<RobotInstanceV1, string>
}

// Keep the deployed v1/v2 database name so version 3 upgrades in place.
export const SCENE_DB_NAME = 'robot-sim-equipment'
export const sceneDb = new SceneDatabase(SCENE_DB_NAME)
```

Version 3 retains the exact v2 equipment/scene/frames stores and adds compound
indexes `[id+revision]` for definitions/configurations. Its upgrade migrates the
Frame-plan NED2 active-TCP adapter to
`RobotInstanceV1.activeTcpFrameId` without creating a second TCP row. In the
same Dexie upgrade transaction, write and validate the instance first, then
remove only that successfully migrated owner key from
`SceneDatabaseRecord.activeTcpByRobotOwnerId`; retain unknown/unmigrated keys.
If the instance/frame write fails, the upgrade aborts and the v2 scene adapter
remains intact. Reopen must not duplicate the instance or TCP. The legacy database name is
intentionally retained to prevent data loss; no second empty database is
created. Change `equipment-db.ts` to re-export `SceneDatabaseRecord`,
`SceneDatabase as EquipmentDatabase`, and `sceneDb as equipmentDb`, so existing
imports and tests keep one physical database.

Override `SceneDatabase.open()` to await Dexie open/migrations and then call one
exported `ensureBuiltInSceneSeeds(db)` transaction. That idempotent function
checks exact compound/instance/frame keys and creates the complete NED2
definition, default configuration, `NED2-01`, namespaced Base, revision-1
manual TCP, and active TCP only when absent; it validates an existing partial
or conflicting set rather than duplicating/overwriting it. This post-open path
runs for both a brand-new latest-version database (where no upgrade callback
fires) and reopen, while the version-3 upgrade remains responsible for copying
v2 state.

After migration, `RobotInstanceV1.activeTcpFrameId` is the only persisted active
TCP owner. Its `setActiveTcp()` action validates and writes that instance row in
one transaction, publishes memory only after commit, and never recreates a
`scene.activeTcpByRobotOwnerId` key. Frame UI consumes this action; the scene
field remains an empty/unknown-key compatibility shell, not live state.
Inject that same owner into Frame Store deletion. If the deletion closure
contains a robot's active TCP, validate the policy's replacement as a different
persisted same-owner manual TCP, then delete the requested frame rows and patch
the latest `RobotInstanceV1.activeTcpFrameId` inside one Dexie transaction.
Publish both stores and frame events only after commit. Missing/stale
replacement, instance revision drift, or transaction failure leaves the active
TCP and every frame untouched; the retired scene adapter is never written.

- [ ] **Step 4: Implement repositories and strict buffer ownership**

Hash a private copy through `crypto.subtle.digest('SHA-256', bytes)`, persist a
second owned copy only if absent, and keep Blob URLs/ref counts in repository-
local maps. Definition/config/instance stores use single-flight hydration,
row-level corrupt isolation, complete cross-table validation, and memory-only
fallback. `robotInstances` stores only `RobotInstanceV1`; transient
`runtimeByInstance` joint/quality state is rebuilt from Home and is never put in
Dexie. No byte arrays enter Zustand snapshots.

Definition and configuration repositories expose `putImmutable()`. Before a
compound-key put, calculate a stable canonical SHA-256 of the fully normalized
record (sorted object keys while preserving semantic array order). If no row
exists, insert it; if the existing canonical hash matches, return
`{ reused: true }` without writing; otherwise throw
`DEFINITION_REVISION_CONFLICT` or `CONFIGURATION_REVISION_CONFLICT` and leave
the row unchanged. Never use Dexie `put` as silent replacement for these
tables. A new revision requires an explicit manifest/wizard/editor value.
Canonicalize and hash the incoming record before entering a caller-owned final
transaction. When an existing row must be hashed/rechecked inside a Dexie
transaction, wrap only that WebCrypto Promise with `Dexie.waitFor()` so IndexedDB
cannot auto-commit while the non-IDB digest is pending; then synchronously
compare the prepared incoming digest and re-read existing row before any put.
No bare `crypto.subtle.digest()` Promise may be awaited inside a transaction.

- [ ] **Step 5: Implement rollback-safe instance deletion**

Make `deleteRobotInstance(robotInstanceId)` the only public removal path;
`useRobotInstanceStore` exposes only an internal publication callback to the
lifecycle service. Inject explicit adapters so the later OPC UA plan can use
the same source teardown contract:

```ts
export interface RobotSourceDeletionAdapter<Token> {
  quiesce(robotInstanceId: string): Promise<Token>
  withDeletionBarrier<T>(token: Token, operation: () => Promise<T>): Promise<T>
  resume(token: Token): Promise<void>
  finalizeDelete(token: Token): Promise<void>
}

export interface PreparedHeldRelease {
  readonly frameWrites: readonly PersistedFrameRecord[]
  publishAfterCommit(): void
  rollback(): void
}
```

The current Simulation adapter stops that instance's playback/subscription and
returns a resumable token; the OPC UA plan replaces it with coordinator/socket
quiescence without changing this service. Deletion follows this exact order:

1. Acquire a per-instance removal lock so no new grasp, frame edit, joint frame,
   or playback can begin. Validate the instance and collect its Base plus every
   persisted manual descendant whose `ownerEntityId` equals the canonical robot
   owner. Build this closure from the effective definition's derived descriptors
   plus persisted rows, so it works before `RobotModel` mounts and does not rely
   on a derived flange being stored in Dexie. If a persisted descendant has
   another owner, abort with the exact ID and require reparenting; never
   cascade-delete foreign data.
2. Quiesce the joint source and call Task 9's grasp adapter to *prepare* release
   of every object held by this instance. Preparation computes equipment-frame
   writes and a runtime publication callback but does not detach the live object.
3. Call `source.withDeletionBarrier(token, ...)` and, while that per-instance
   barrier is held, run one Dexie transaction that writes prepared equipment
   release frames; deletes the RobotInstance and its Base/manual child frames
   (including all TCPs); and deletes its selected MechanicalConfiguration only when
   `retention==='instance-owned'` and no other instance references that exact
   ID/revision. Shared or still-referenced configurations and every reusable
   RobotDefinition remain.
4. Only after commit, publish held releases, finalize/disconnect the source,
   clear robot selection and every collision pair, clear RobotModel's
   object-ref/moving-metadata bindings, and remove the
   instance plus its memory-only joint state from Zustand. Pure derived
   FrameNodes disappear on the next synchronous graph derivation; there is no
   frame-registration cleanup side effect. These callbacks are idempotent; a
   post-commit callback failure enters a memory retry queue and never resurrects
   deleted database rows.
5. After the deletion transaction and runtime publication, run repository GC in
   a separate transaction. Recompute reachability from all retained definitions
   and configurations (including every definition `sourceAssetIds` entry and
   every visual/collision geometry override),
   delete only unreachable `sha256:` asset rows, and revoke their Blob URLs only
   after the GC transaction commits. GC failure safely leaks data for retry.

If any pre-commit step or the Dexie transaction fails, call
`PreparedHeldRelease.rollback()`, resume the source token, release the removal
lock, and leave store selection, collision pairs, frames, instance, config, and
assets unchanged.

The generic Simulation adapter implements the barrier with the existing
per-instance removal lock. The later OPC plan maps the same method to its shared
Simulation-mutation mutex: quiesce invalidates queued writes synchronously,
an edit already inside the mutex finishes before the deletion transaction, and
the transaction then deletes its result. The token holds the pending deletion
transition until `resume()` clears it on rollback or `finalizeDelete()` removes
the instance's gate slot after success. This contract is intentionally defined
before Pose tables exist so the Pose plan can add those rows to the same guarded
transaction without a post-delete orphan race.

- [ ] **Step 6: Add an accessible deletion surface**

`RobotInstanceList` renders instances and a per-row Delete action. Confirmation
names the robot, warns that its Base/TCP/sensor/camera frames will be removed,
reports held objects or foreign-owned child frames, and calls the lifecycle service exactly
once. Disable the row while removal is locked; on success move focus to the next
robot, and on rollback retain focus plus an actionable alert. Wire it into
AppShell's Robots group and cover keyboard, double-click prevention, success,
foreign-child rejection, and rollback.

- [ ] **Step 7: Run GREEN and commit**

Run each command separately and stop on the first nonzero exit:

1. `npm run test:run -- src/state src/features/equipment src/features/robots src/features/frames/frame-store.test.ts src/features/interaction src/app/AppShell.test.tsx`
2. `npm run lint`
3. `git diff --check`

Expected: every command exits 0. The suite covers v2->v3 reopen, idempotent
seeds, hash dedupe, URL cleanup, corrupt isolation, StrictMode hydration,
single-owner TCP migration, full deletion success, shared-reference retention,
source/runtime provenance reachability through post-transaction GC,
held/source/collision cleanup, foreign-child rejection,
and rollback without visible mutation.

```powershell
git add src/state/scene-db.ts src/state/scene-db.test.ts src/features/equipment/equipment-db.ts src/features/robots src/features/frames/frame-store.ts src/features/frames/frame-store.test.ts src/features/interaction/grasp-actions.ts src/features/interaction/grasp-actions.test.ts src/features/interaction/interaction-store.ts src/features/interaction/interaction-store.test.ts src/app/AppShell.tsx src/app/AppShell.test.tsx
git diff --cached --check
git commit -m "feat: persist robot definitions and assets"
```

## Task 5: Import STEP Plus Robot Manifest Transactionally

**Files:**
- Create: `src/features/robot-import/robot-manifest.ts`
- Create: `src/features/robot-import/robot-manifest.test.ts`
- Create: `src/features/robot-import/three-group-to-glb.ts`
- Create: `src/features/robot-import/three-group-to-glb.test.ts`
- Create: `src/features/robot-import/robot-import-service.ts`
- Create: `src/features/robot-import/robot-import-service.test.ts`
- Modify: `src/features/import/StepImportClient.ts`
- Test: `src/features/import/StepImportClient.test.ts`

**Interfaces:**
- Consumes: existing worker OCCT conversion, aggregate resource budgets, manifest plus browser Files.
- Produces: validated staged definition/assets and one atomic `importRobotPackage()` transaction.

- [ ] **Step 1: Write manifest, cancellation, resource, and rollback RED tests**

```ts
it('maps ordered geometry instances, converts each unique source once, and commits once', async () => {
  const result = await service.importRobotPackage({
    kind: 'step-manifest',
    manifestFile,
    files: [baseStep, armStep, sharedToolStep],
    activation: {
      instanceName: 'Cell Robot',
      baseParentFrameId: 'mcp:default',
      baseLocalPose: poseAt(0.5, 0, 0),
    },
  })
  expect(convert).toHaveBeenCalledTimes(3)
  expect(transaction).toHaveBeenCalledOnce()
  expect(result.definition.links.map(({ id }) => id)).toEqual(['base', 'arm'])
  expect(result.definition.links[1]!.visualGeometries).toEqual([
    expect.objectContaining({ id: 'arm-body', scale: [1, 1, 1] }),
    expect.objectContaining({ id: 'tool-visual', scale: [0.5, 0.5, 0.5] }),
  ])
  expect(result.definition.links[1]!.collisionGeometries).toEqual([
    expect.objectContaining({
      id: 'tool-collision',
      pose: { position: [0, 0.1, 0], quaternion: [0, 0, 0, 1] },
    }),
  ])
  expect(await db.frames.get(result.instance.baseFrameId)).toMatchObject({
    parentId: 'mcp:default', localPose: poseAt(0.5, 0, 0), role: 'robot-base',
  })
  await reopenStores()
  expect(await db.frames.get(result.instance.baseFrameId)).toMatchObject({
    parentId: 'mcp:default', localPose: poseAt(0.5, 0, 0),
  })
})

it('reuses an identical definition/config revision and rolls back a conflicting reimport', async () => {
  const first = await service.importRobotPackage(stepPackageInput('cell-robot', '1'))
  const same = await service.importRobotPackage(stepPackageInput('cell-robot', '1'))
  expect(same.definition).toEqual(first.definition)
  expect(first.instance.id).toBe('cell-robot-1')
  expect(same.instance.id).toBe('cell-robot-2')
  expect(first.instance.baseFrameId).not.toBe(same.instance.baseFrameId)
  expect(first.instance.activeTcpFrameId).not.toBe(same.instance.activeTcpFrameId)
  expect(definitionPut).toHaveBeenCalledOnce()
  await expect(service.importRobotPackage(changedStepPackageInput('cell-robot', '1')))
    .rejects.toMatchObject({ code: 'DEFINITION_REVISION_CONFLICT' })
  expect(await readDefinition('cell-robot', '1')).toEqual(first.definition)
  expect(await countAssetsFromConflictingAttempt()).toBe(0)
})

it('rejects a requested instance ID conflict without overwriting or partial assets', async () => {
  const requested = stepPackageInput('cell-robot', '1', {
    activation: { requestedInstanceId: 'press-robot', instanceName: 'Press Robot' },
  })
  const first = await service.importRobotPackage(requested)
  const countsBefore = await sceneTableCounts(db)
  await expect(service.importRobotPackage(requested)).rejects.toMatchObject({
    code: 'ROBOT_INSTANCE_ID_CONFLICT', instanceId: 'press-robot',
  })
  expect(await db.robotInstances.get('press-robot')).toEqual(first.instance)
  expect(await sceneTableCounts(db)).toEqual(countsBefore)
})

it('keeps the real Dexie import transaction alive across an existing-record digest', async () => {
  const db = new SceneDatabase(uniqueDatabaseName())
  await seedIdenticalDefinitionAndConfiguration(db)
  digestHarness.deferExistingRecordDigest()
  const importing = realService(db).importRobotPackage(stepPackageInput('cell-robot', '1'))
  await digestHarness.waitUntilDigestPending()
  digestHarness.resolveDigest()
  await expect(importing).resolves.toMatchObject({ instance: expect.any(Object) })
  expect(await db.robotInstances.count()).toBe(1)
  expect(await db.frames.where('ownerEntityId').equals('robot:cell-robot-1').count())
    .toBeGreaterThan(1)
  await expect(realService(db).importRobotPackage(
    changedStepPackageInput('cell-robot', '1'),
  )).rejects.toMatchObject({ code: 'DEFINITION_REVISION_CONFLICT' })
  expect(await db.robotInstances.count()).toBe(1)
  expect(await countAssetsFromConflictingAttempt()).toBe(0)
  db.close()
})

it.each([
  ['millimeter', 0.001],
  ['inch', 0.0254],
] as const)('normalizes every %s length-valued manifest field exactly once', async (unit, metresPerUnit) => {
  const definition = await stageManifest(lengthUnitFixture(unit)).then(({ definition }) => definition)
  const prismatic = definition.joints.find(({ id }) => id === 'slide')!
  expect(prismatic.origin.position[0]).toBeCloseTo(10 * metresPerUnit)
  expect(prismatic.homePosition).toBeCloseTo(20 * metresPerUnit)
  expect(prismatic.zeroOffset).toBeCloseTo(2 * metresPerUnit)
  expect(prismatic.limits.upper).toBeCloseTo(250 * metresPerUnit)
  expect(prismatic.limits.maxVelocity).toBeCloseTo(100 * metresPerUnit)
  expect(definition.links[0]!.collisionBounds[0]!.halfExtents[0])
    .toBeCloseTo(50 * metresPerUnit)
})

it.each(['missing-file', 'hash-mismatch', 'cycle', 'cancel', 'aggregate-budget', 'db-failure']) (
  'rolls back staged assets for %s', async (fault) => {
    await expect(importFault(fault)).rejects.toThrow()
    expect(await db.robotAssets.count()).toBe(0)
    expect(disposeStagedGroups).toHaveBeenCalled()
  },
)
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/robot-import src/features/import/StepImportClient.test.ts`

Expected: FAIL because manifest parser/exporter/import service do not exist.

- [ ] **Step 3: Define the STEP Manifest wire format**

```ts
export interface StepRobotGeometryV1 {
  readonly id: string
  readonly stepPath: string
  readonly expectedSha256: string | null
  readonly pose: Pose3D
  readonly scale: readonly [number, number, number]
}

export interface StepRobotManifestV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly revision: string
  readonly name: string
  readonly unit: 'millimeter' | 'meter' | 'inch'
  readonly rootLinkId: string
  readonly links: readonly {
    readonly id: string
    readonly name: string
    readonly visualGeometries: readonly StepRobotGeometryV1[]
    readonly collisionGeometries: readonly StepRobotGeometryV1[]
    readonly collisionBounds: readonly RobotCollisionBoxV1[]
  }[]
  readonly joints: readonly RobotJointDefinitionV1[]
  readonly namedFrames: readonly RobotNamedFrameDefinitionV1[]
  readonly defaultFlangeFrameLocalId: string
  readonly defaultTcpFrameLocalId: string | null
}

export interface RobotSetupInputV1 {
  readonly flange: {
    readonly localId: string
    readonly name: string
    readonly parentLinkId: string
    readonly localPose: Pose3D
  }
  readonly tcp: {
    readonly localId: string
    readonly name: string
    readonly localPose: Pose3D
  }
}

export interface RobotActivationInputV1 {
  readonly instanceName: string
  readonly requestedInstanceId?: string
  readonly baseParentFrameId: string
  readonly baseLocalPose: Pose3D
}

export interface ManualRobotTopologyInputV1 {
  readonly definitionId: string
  readonly definitionRevision: string
  readonly definitionName: string
  readonly unit: 'millimeter' | 'meter' | 'inch'
  readonly rootLinkId: string
  readonly links: StepRobotManifestV1['links']
  readonly joints: readonly RobotJointDefinitionV1[]
}

export type RobotPackageInput =
  | {
      readonly kind: 'step-manifest'
      readonly manifestFile: File
      readonly files: readonly File[]
      readonly activation: RobotActivationInputV1
    }
  | {
      readonly kind: 'step-wizard'
      readonly files: readonly File[]
      readonly topology: ManualRobotTopologyInputV1
      readonly setup: RobotSetupInputV1
      readonly activation: RobotActivationInputV1
    }
  | {
      readonly kind: 'resolved-urdf'
      readonly urdfFile: File
      readonly files: readonly File[]
      readonly setup: RobotSetupInputV1
      readonly activation: RobotActivationInputV1
    }

export interface StagedRobotPackage {
  readonly definition: RobotDefinitionV1
  readonly configuration: MechanicalConfigurationV1
  readonly sourceAssets: readonly RobotAssetRecord[]
  readonly runtimeAssets: readonly RobotAssetRecord[]
  dispose(): void
}

export interface RobotPackageStager<K extends RobotPackageInput['kind']> {
  readonly kind: K
  stage(input: Extract<RobotPackageInput, { kind: K }>, signal: AbortSignal): Promise<StagedRobotPackage>
}
```

Reject unknown fields that change semantics, absolute/traversal paths, duplicate
link/geometry/local-frame IDs, normalized-path collisions, missing files, wrong
hashes, and topology errors. The same normalized source path may intentionally
be referenced by multiple geometry instances and is converted once. Preserve
manifest array order. `sourceSha256` is a canonical hash of the manifest plus
sorted raw source hashes. `sourceAssetIds` contains the content-addressed
manifest plus every original STEP file exactly once, independent of how many
geometry instances reference it.

`RobotActivationInputV1` is separate from immutable package content. Validate a
trimmed instance name, optional collision-safe requested ID, finite normalized
Base pose, and an existing permitted MCP/machine parent. Re-read and validate
the Base parent/graph relationship inside the final transaction so a deleted or
reparented MCP cannot produce an orphan. With no
requested ID, allocate `<definition-id-slug>-<n>` using the smallest positive
unused suffix inside the common instance/frame transaction. A requested ID that
already exists aborts with `ROBOT_INSTANCE_ID_CONFLICT`; never overwrite or
reinterpret an existing instance. Reimporting identical package bytes reuses
definition/configuration/assets but creates a new instance with separately
namespaced Base/manual TCP frames. The allocator and unique instance put share
the same transaction so concurrent activation cannot silently choose one ID.

The manifest `unit` applies exactly once to every length-valued wire field:
all joint/geometry/frame/collision-box Pose positions, collision centres and
half-extents, and for prismatic joints Home, lower/upper, zero offset,
maxVelocity, and maxAcceleration convert to m, m/s, and m/s^2. Revolute/
continuous Home, limits, zero offset, velocity, and acceleration are already
rad, rad/s, and rad/s^2. Axis/scale/direction are dimensionless; effort is
declared in canonical SI. Fixed/revolute joint-origin translations still use
the package length unit. Convert these wire values into new canonical
`RobotJointDefinitionV1`/`RobotCollisionBoxV1` objects before validation; never
mutate/reuse the raw manifest object as canonical data.

- [ ] **Step 4: Export normalized runtime GLBs and enforce package budgets**

Use `GLTFExporter.parseAsync(group, { binary: true, onlyVisible: false })`,
dispose clones after export, and validate the GLB with `GLTFLoader.parseAsync`.
Bake the declared STEP package unit into vertex positions exactly once so every
persisted GLB has metre coordinates. Manifest pose positions are declared in
the same package unit and normalize to metres; quaternions are normalized and
the positive dimensionless geometry `scale` is retained in
`RobotGeometryInstanceV1` rather than silently baked a second time. Calculate
one transformed collision box per collision geometry (preserving its rotation,
scaled local centre, and `sourceGeometryId`) unless the manifest supplies an
explicit validated set. Visual and collision arrays keep independent poses,
scales, assets, and order.
Aggregate limits across the full robot before allocating/exporting: 10 million
vertices, 30 million indices, 512 materials, 256 meshes, 512 MiB source bytes,
and 1 GiB estimated working bytes. Cancellation terminates the active worker,
disposes every staged geometry/material, revokes URLs, and leaves no DB row.

- [ ] **Step 5: Commit one validated transaction**

After all source/GLB hashes and `sourceAssetIds`, local bounds, collision approximations, local named
frames, and definition validate, transactionally put missing assets, definition,
configuration, namespaced Robot Base frame, every namespaced manual TCP frame,
each namespaced manual sensor/camera child, and instance with its default active
TCP using the validated activation ID/name. The newly imported baseline
configuration uses `retention:'instance-owned'`; a later instance may share it,
and Task 4 deletes it only after the last exact reference disappears.
`materializeRobotInstanceFrames()` is the sole converter for persisted
Base/manual frames; `deriveRobotFrameNodes()` is the sole converter for derived
FK frames. Publish to
Zustand/repositories only after transaction completion; failed publication
invalidates staged cache.

`RobotImportService` dispatches the discriminated input to one registered
`RobotPackageStager`, revalidates the returned staged package, and owns the one
commit path above. Task 5 registers the STEP Manifest stager; the resolved-URDF
stager lands in Task 6 and uses the same service/transaction/rollback path.
Missing stagers fail before allocation with an exact unsupported-input error.
Inside the final transaction it calls the Task 4 immutable definition/config
repositories before publishing any asset or instance state. Identical compound
keys reuse the existing records; a differing canonical hash aborts the entire
transaction with the exact revision-conflict code and disposes every staged
asset. The service never auto-invents a revision.

- [ ] **Step 6: Run GREEN and commit**

Run each command separately and stop on the first nonzero exit:

1. `npm run test:run -- src/features/robot-import src/features/import`
2. `npm run build`
3. `git diff --check`

Expected: every command exits 0. Success, repeated-source dedupe with distinct
instance/Base/TCP namespaces, requested-ID conflict rollback,
multi-geometry order/transform/scale, aggregate overflow, cancel, invalid
manifest, DB failure, buffer-copy, and resource-disposal tests PASS; OCCT stays
worker-split.

```powershell
git add src/features/robot-import src/features/import/StepImportClient.ts src/features/import/StepImportClient.test.ts
git diff --cached --check
git commit -m "feat: import STEP robot packages"
```

## Task 6: Adapt Resolved URDF and Build the Manual Setup Wizard

**Files:**
- Create: `src/features/robot-import/urdf-adapter.ts`
- Create: `src/features/robot-import/urdf-adapter.test.ts`
- Create: `src/features/robot-import/resolved-urdf-stager.ts`
- Create: `src/features/robot-import/resolved-urdf-stager.test.ts`
- Create: `src/features/robot-import/step-wizard-stager.ts`
- Create: `src/features/robot-import/step-wizard-stager.test.ts`
- Modify: `src/features/robot-import/robot-import-service.ts`
- Modify: `src/features/robot-import/robot-import-service.test.ts`
- Create: `src/features/robot-import/RobotImportWizard.tsx`
- Create: `src/features/robot-import/RobotImportWizard.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: resolved URDF+asset File map or STEP files and the common staged import service.
- Produces: resolved-URDF and STEP-only topology drafts, explicit
  Base/Flange/TCP setup, `resolved-urdf` and `step-wizard` stagers that accept
  only completed setup, one atomic normalized package commit, and an accessible
  8-step setup/review flow.

- [ ] **Step 1: Write URDF semantics and wizard-state RED tests**

```ts
function expectTupleClose(
  actual: readonly number[],
  expected: readonly number[],
  digits = 9,
): void {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, digits))
}

it('retains every ordered URDF visual/collision origin and scale with both joint types', () => {
  const definition = adaptResolvedUrdf(readFixture('robot.urdf'), fixtureFiles())
  expect(definition.joints[0]).toMatchObject({
    type: 'revolute', parentLinkId: 'base', childLinkId: 'arm', axis: [0, 0, 1],
    limits: { lower: -Math.PI, upper: Math.PI, maxVelocity: 2 },
  })
  expect(definition.joints[1]).toMatchObject({
    type: 'prismatic', parentLinkId: 'arm', childLinkId: 'slider', axis: [1, 0, 0],
    limits: { lower: 0, upper: 0.25, maxVelocity: 0.4 },
  })
  expectTupleClose(
    definition.joints[0]!.origin.quaternion,
    rpyToQuaternion([0.1, 0.2, 0.3]),
  )
  const arm = definition.links.find(({ id }) => id === 'arm')!
  expect(arm.visualGeometries).toEqual([
    expect.objectContaining({ id: 'visual-0', scale: [1, 1, 1] }),
    expect.objectContaining({ id: 'visual-1', scale: [0.5, 1, 2] }),
  ])
  expect(arm.collisionGeometries).toEqual([
    expect.objectContaining({ id: 'collision-0', scale: [0.8, 0.8, 0.8] }),
    expect.objectContaining({
      id: 'collision-1',
      pose: { position: [0.02, 0, 0.1], quaternion: [0, 0, 0, 1] },
    }),
  ])
  expect(arm.collisionBounds.map(({ sourceGeometryId }) => sourceGeometryId))
    .toEqual(['collision-0', 'collision-1'])
})

it.each([
  ['xacro', /Xacro execution is not supported/i],
  ['mimic', /mimic joint .* is not supported/i],
  ['floating', /floating joint .* is not supported/i],
  ['cycle', /cycle.*base.*arm.*base/i],
  ['multiple-parents', /link .* has multiple parent joints/i],
  ['missing-mesh', /mesh .* was not supplied/i],
  ['package-traversal', /path traversal/i],
  ['stl-mesh', /STL.*unsupported/i],
  ['dae-mesh', /DAE.*unsupported/i],
  ['obj-mesh', /OBJ.*unsupported/i],
] as const) (
  'rejects unsupported %s with an exact report',
  (fault, message) => expect(() => adaptFault(fault)).toThrow(message),
)

it('does not commit a STEP-only draft until all eight wizard stages validate', async () => {
  render(<RobotImportWizard open files={[baseStep, armStep]} />)
  await user.click(screen.getByRole('button', { name: 'Import robot' }))
  expect(commit).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('Define the root link')
})

it('commits a completed STEP-only Wizard package through the common transaction and reloads', async () => {
  const input = completedStepWizardInput({
    files: [baseStep, armStep],
    definitionId: 'wizard-two-link',
    definitionRevision: '1',
    rootLinkId: 'base',
    flangeParentLinkId: 'arm',
    flangeLocalId: 'tool0',
    tcpLocalId: 'default',
    requestedInstanceId: 'wizard-robot-1',
  })
  const result = await service.importRobotPackage(input)
  expect(stepWizardStager.stage).toHaveBeenCalledOnceWith(input, expect.any(AbortSignal))
  expect(transaction).toHaveBeenCalledOnce()
  expect(result.definition).toMatchObject({
    sourceFormat: 'step-manifest',
    defaultFlangeFrameLocalId: 'tool0',
    defaultTcpFrameLocalId: 'default',
  })
  expect(result.instance).toMatchObject({
    id: 'wizard-robot-1',
    baseFrameId: 'robot:wizard-robot-1:base',
    activeTcpFrameId: 'robot:wizard-robot-1:tcp:default',
  })
  expect(await db.frames.get('robot:wizard-robot-1:tcp:default')).toMatchObject({
    parentId: 'robot:wizard-robot-1:flange:tool0', source: 'manual', revision: 1,
  })
  await reopenStores()
  expect(await db.robotInstances.get('wizard-robot-1')).toEqual(result.instance)
})

it('normalizes and commits a resolved URDF package through the common transaction', async () => {
  const result = await service.importRobotPackage({
    kind: 'resolved-urdf',
    urdfFile: robotUrdf,
    files: resolvedMeshFiles,
    activation: {
      requestedInstanceId: 'urdf-1',
      instanceName: 'URDF Robot 1',
      baseParentFrameId: 'mcp:default',
      baseLocalPose: poseAt(0, 0, 0),
    },
    setup: robotSetup({
      flangeLocalId: 'tool0',
      flangeParentLinkId: 'slider',
      tcpLocalId: 'default',
    }),
  })
  expect(urdfStager.stage).toHaveBeenCalledOnce()
  expect(transaction).toHaveBeenCalledOnce()
  expect(result.definition.sourceFormat).toBe('urdf')
  expect(result.definition.sourceAssetIds).toEqual(expect.arrayContaining([
    hashOf(robotUrdf), ...resolvedMeshFiles.map(hashOf),
  ]))
  expect(result.definition).toMatchObject({
    defaultFlangeFrameLocalId: 'tool0',
    defaultTcpFrameLocalId: 'default',
    namedFrames: expect.arrayContaining([
      expect.objectContaining({ id: 'tool0', role: 'flange', ownership: 'derived' }),
      expect.objectContaining({ id: 'default', role: 'tcp', ownership: 'instance-manual' }),
    ]),
  })
  expect(result.instance.activeTcpFrameId).toBe(`robot:${result.instance.id}:tcp:default`)
  expect(await db.frames.get(result.instance.activeTcpFrameId)).toMatchObject({
    parentId: `robot:${result.instance.id}:flange:tool0`,
    source: 'manual', role: 'tcp', revision: 1,
  })
})

it('keeps resolved URDF as an uncommitted draft until Base/Flange/TCP setup exists', async () => {
  const input = {
    kind: 'resolved-urdf',
    urdfFile: robotUrdf,
    files: resolvedMeshFiles,
    activation: {
      instanceName: 'URDF Draft',
      baseParentFrameId: 'mcp:default',
      baseLocalPose: poseAt(0, 0, 0),
    },
  } as const
  await expect(service.importRobotPackage(input as never)).rejects.toThrow(/Base.*Flange.*TCP/i)
  expect(transaction).not.toHaveBeenCalled()
  expect(await db.robotDefinitions.count()).toBe(0)
  expect(await db.robotInstances.count()).toBe(0)
})

it('retains parsed URDF topology in the Wizard while setup validation blocks Import', async () => {
  render(<RobotImportWizard open files={[robotUrdf, ...resolvedMeshFiles]} />)
  await navigateToBaseFlangeTcp(user)
  await user.click(screen.getByRole('button', { name: 'Import robot' }))
  expect(screen.getByRole('alert')).toHaveTextContent(/select.*flange.*TCP/i)
  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByText('slider')).toBeVisible()
  expect(commit).not.toHaveBeenCalled()
})

it.each(['mesh-normalization-failure', 'cancel', 'db-failure']) (
  'rolls back all URDF source/runtime assets for %s', async (fault) => {
    await expect(importResolvedUrdfFault(fault)).rejects.toThrow()
    expect(await db.robotAssets.count()).toBe(0)
    expect(disposeStagedGroups).toHaveBeenCalled()
  },
)
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/robot-import src/app/AppShell.test.tsx`

Expected: FAIL because the adapter and wizard do not exist.

- [ ] **Step 3: Implement resolved URDF parsing**

Parse with `DOMParser`, reject `parsererror`, `.xacro`, namespace/Xacro tags,
mimic, unsupported joint types, multiple parents, and unresolved files. Build a
normalized relative-path map from `File.webkitRelativePath || File.name` and
resolve `package://`, `file://`-free relative mesh paths without `..`. V1
accepts resolved binary `.glb` meshes only; `.gltf`, STL, DAE, OBJ, and every
other mesh/primitive format receive an exact unsupported-format report rather
than a missing-loader failure or silent drop. Convert
every joint/visual/collision `origin xyz/rpy` using Frame Plan ZYX RPY. URDF
metres/radians remain canonical. For each link, retain every `<visual>` and
`<collision>` in document order as an independent geometry instance with its
own content-addressed GLB, pose, and positive finite `<mesh scale>`; scale is
not shared between visual and collision and is not baked twice. Bake only the
loaded mesh's intrinsic scene transforms into its canonical GLB. Generate a
corresponding transformed collision box for each collision instance and keep
the source geometry ID. Support resolved mesh geometries in v1 and report every
unsupported primitive/tag instead of dropping it.
Return an `AdaptedRobotTopologyV1`, not a prematurely valid
`RobotDefinitionV1`: URDF has no portable canonical flange/TCP semantics.
Persist the resolved URDF XML and every original referenced mesh in
`sourceAssetIds`; geometry instances reference the separately normalized
runtime GLBs. Hash deduplication may make a source/runtime ID identical only
when the exact bytes are already canonical, but the definition still records
both provenance reachability and geometry use explicitly.

Use Task 5's `RobotSetupInputV1` for flange local ID/name/parent-link/local
pose and TCP local ID/name/local pose. Its validator requires a real link
parent, unique definition-local IDs, finite poses, and a manual TCP under the
chosen derived flange. Base parent/local pose and instance ID/name live only in
the common `RobotActivationInputV1`; the import service revalidates its
MCP/machine parent and Base pose inside the final transaction. Together these
compose the topology into the final definition/configuration/materialization
input. The UI may suggest a leaf link but never commits that guess without
operator confirmation.

`resolved-urdf-stager.ts` implements
`RobotPackageStager<'resolved-urdf'>`: it requires the validated setup, then
parses/adapts the complete file map,
normalizes or copies each resolved mesh into a validated runtime GLB, builds
source/runtime asset records plus the canonical definition/configuration, and
returns only a disposable `StagedRobotPackage`. Register it with the Task 5
`RobotImportService`; the stager never opens its own Dexie transaction. The
service alone commits assets/definition/config/frames/instance atomically and
disposes the staged package on cancel, normalization failure, conflict, or DB
failure. Missing/incomplete setup returns the topology and validation report to
the component-local Wizard draft and performs no transaction. On commit, the
common materializer creates the namespaced derived flange reference, one
persisted manual TCP at revision 1, and the instance's matching active TCP in
the same transaction.

`step-wizard-stager.ts` implements
`RobotPackageStager<'step-wizard'>`. It accepts only a completed
`ManualRobotTopologyInputV1`, validated setup, activation, and STEP File map;
reuses Task 5 unit normalization, OCCT conversion, budgets, hashes, and
materialization; and produces the same canonical staged package as an explicit
Manifest. Register both Task 6 stagers with `RobotImportService`. An incomplete
Wizard remains component-local and never reaches a stager; completing all eight
stages calls the common service exactly once, so STEP-without-Manifest receives
the same one-transaction Base/flange/manual-TCP/instance/assets guarantees and
reload behavior as the other inputs.

- [ ] **Step 4: Implement the eight-step wizard**

Stages are Source/Units, Links, Joint Graph, Zero Pose, Limits/Home/Velocity,
Base/Flange/TCP, Collision, Review. Store the draft in component-local reducer
state, not persisted Zustand. Each Next validates the current stage; Back
preserves input; Cancel calls import cancellation and disposes staged resources.
Review shows errors, warnings, source hashes, conversions, bounds, generated
collision approximations, and unsupported details. Import calls the Task 5
service exactly once and selects the new RobotInstance on success. Links shows
each ordered visual/collision geometry and its independent pose/scale.
Base/Flange/TCP creates definition-local flange/TCP templates and previews their
future namespaced IDs; it never writes a global FrameNode into the definition.
Resolved URDF follows this stage exactly like STEP-only input; it does not skip
the stage merely because link/joint topology was parsed successfully.
Collision edits link-level boxes/asset variants for any link, including root,
and never exposes a joint-owned collision field.

- [ ] **Step 5: Run GREEN and commit**

Run each command separately and stop on the first nonzero exit:

1. `npm run test:run -- src/features/robot-import src/app/AppShell.test.tsx`
2. `npm run lint`
3. `npm run build`
4. `git diff --check`

Expected: every command exits 0. URDF and wizard tests PASS for multiple visual
and collision transforms/scales, revolute/prismatic joints, local named frames,
explicit Base/Flange/TCP completion, materialized active TCP, missing-setup
no-commit behavior, root-link collision editing, shared-stager atomic commit/rollback, mesh
normalization disposal, navigation, focus, cancellation, validation, import
error/retry, and no partial persistence.

```powershell
git add src/features/robot-import src/app/App.tsx src/app/AppShell.tsx src/styles/global.css
git diff --cached --check
git commit -m "feat: configure imported robot kinematics"
```

## Task 7: Preview and Commit Mechanical Configurations

**Files:**
- Create: `src/features/robot-config/mechanical-config-store.ts`
- Create: `src/features/robot-config/mechanical-config-store.test.ts`
- Create: `src/features/robot-config/MechanicalEditor.tsx`
- Create: `src/features/robot-config/MechanicalEditor.test.tsx`
- Modify: `src/features/ui/InspectorPanel.tsx`
- Modify: `src/features/robot/RobotModel.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: nominal/effective definition, scene DB, and an explicit
  RobotInstance ID plus its current configuration revision (never implicit
  active-tree selection).
- Produces: instance-scoped nominal-vs-override drafts, live FK/collision
  preview, mismatch acknowledgement, atomic configuration activation, and a
  typed per-instance post-commit configuration-change subscription.

```ts
export interface CommittedMechanicalConfigurationChange {
  readonly robotInstanceId: string
  readonly previousConfigurationId: string
  readonly previousRevision: string
  readonly configurationId: string
  readonly revision: string
}

export function subscribeCommittedConfigurationChanges(
  robotInstanceId: string,
  listener: (event: CommittedMechanicalConfigurationChange) => void,
): () => void
```

- [ ] **Step 1: Write preview, mismatch, rollback, and concurrency RED tests**

```ts
it('previews many joint-origin edits and commits one new configuration revision', async () => {
  store.getState().previewJointOrigin('robot-a', 'config-1', 'joint-1', poseAt(0, 0, 0.71))
  store.getState().previewJointOrigin('robot-a', 'config-1', 'joint-1', poseAt(0, 0, 0.72))
  await store.getState().apply('robot-a', 'config-1', { acknowledgeGeometryMismatch: true })
  expect(configurationPut).toHaveBeenCalledOnce()
  expect(instancePut).toHaveBeenCalledOnce()
  expect(activeEffective('robot-a').joints[0]!.origin.position[2]).toBe(0.72)
})

it('blocks mismatched Apply without acknowledgement and restores the old runtime on DB failure', async () => {
  previewDimensionChange('robot-a')
  await expect(store.getState().apply('robot-a', 'config-1', { acknowledgeGeometryMismatch: false })).rejects.toThrow(/mismatch/i)
  db.transaction.mockRejectedValueOnce(new Error('disk full'))
  await expect(store.getState().apply('robot-a', 'config-1', { acknowledgeGeometryMismatch: true })).rejects.toThrow()
  expect(activeEffective('robot-a')).toEqual(previousEffective)
})

it('previews multiple root-link collision geometries without creating a joint override', () => {
  store.getState().previewLinkGeometry('robot-a', 'config-1', 'base', {
    collisionGeometries: [
      geometry(fixtureSha256AssetId('base-a'), poseAt(0, 0, 0), [1, 1, 1]),
      geometry(fixtureSha256AssetId('base-b'), poseAt(0.2, 0, 0), [0.5, 1, 1]),
    ],
    collisionBounds: [boxFor('base-a'), boxFor('base-b')],
  })
  expect(activeEffective('robot-a').links.find(({ id }) => id === 'base')!.collisionGeometries)
    .toHaveLength(2)
  expect(draftConfiguration('robot-a').jointOverrides).toEqual({})
})

it('updates the one persisted manual TCP node in the same Apply transaction', async () => {
  store.getState().previewNamedFrame('robot-a', 'config-1', 'welder', poseAt(0, 0, 0.25))
  expect(readRuntimeFrame('robot:robot-a:tcp:welder').localPose).toEqual(poseAt(0, 0, 0.25))
  expect(frameStore.getState().previews['robot:robot-a:tcp:welder']?.ownerToken)
    .toMatch(/^mechanical:robot-a:/)
  await store.getState().apply('robot-a', 'config-1', { acknowledgeGeometryMismatch: false })
  expect(await db.frames.get('robot:robot-a:tcp:welder')).toMatchObject({
    ownerEntityId: 'robot:robot-a', source: 'manual', localPose: poseAt(0, 0, 0.25),
  })
  expect(deriveRobotFrameNodes(instance('robot-a'), activeEffective('robot-a'), liveJointMap('robot-a'))
    .filter(({ role }) => role === 'tcp')).toHaveLength(0)
  expect(frameStore.getState().previews).not.toHaveProperty('robot:robot-a:tcp:welder')
})

it('cancels only its owned named-frame previews and rejects a competing inspector preview', () => {
  const tcpId = 'robot:robot-a:tcp:welder'
  const committed = frameStore.getState().getCommittedFrameRecord(tcpId)!
  frameStore.getState().previewFrame(tcpId, poseAt(0, 0, 0.3), 'frame-inspector:existing')
  expect(() => store.getState().previewNamedFrame(
    'robot-a', 'config-1', 'welder', poseAt(0, 0, 0.25),
  )).toThrow(/preview.*owned/i)
  expect(readRuntimeFrame(tcpId).localPose).toEqual(poseAt(0, 0, 0.3))
  frameStore.getState().cancelFrame(tcpId, 'frame-inspector:existing')
  store.getState().previewNamedFrame('robot-a', 'config-1', 'welder', poseAt(0, 0, 0.25))
  store.getState().cancel('robot-a')
  expect(readRuntimeFrame(tcpId).localPose).toEqual(committed.localPose)
  expect(frameStore.getState().previews).not.toHaveProperty(tcpId)
})

it('keeps a draft bound to its robot when two instances share a configuration', async () => {
  seedInstancesSharingConfiguration('robot-a', 'robot-b', 'config-1', 'rev-1')
  store.getState().previewJointOrigin('robot-a', 'config-1', 'joint-1', poseAt(0, 0, 0.72))
  selectRobotInTree('robot-b')
  await store.getState().apply('robot-a', 'config-1', { acknowledgeGeometryMismatch: true })
  expect(readInstance('robot-a').mechanicalConfigurationRevision).not.toBe('rev-1')
  expect(readInstance('robot-b').mechanicalConfigurationRevision).toBe('rev-1')
  expect(activeEffective('robot-b')).toEqual(effectiveFor('config-1', 'rev-1'))
})

it('emits one post-commit configuration event for only the changed instance', async () => {
  seedInstancesSharingConfiguration('robot-a', 'robot-b', 'config-1', 'rev-1')
  const events: CommittedMechanicalConfigurationChange[] = []
  const unsubscribe = subscribeCommittedConfigurationChanges('robot-a', (event) => events.push(event))
  store.getState().previewJointOrigin('robot-a', 'config-1', 'joint-1', poseAt(0, 0, 0.72))
  await store.getState().apply('robot-a', 'config-1', { acknowledgeGeometryMismatch: true })
  expect(events).toEqual([expect.objectContaining({
    robotInstanceId: 'robot-a',
    previousConfigurationId: 'config-1',
    previousRevision: 'rev-1',
  })])
  db.transaction.mockRejectedValueOnce(new Error('disk full'))
  previewDimensionChange('robot-b')
  await expect(store.getState().apply(
    'robot-b', 'config-1', { acknowledgeGeometryMismatch: true },
  )).rejects.toThrow()
  expect(events).toHaveLength(1)
  unsubscribe()
})

it('rejects Mechanical Apply when Frame Inspector committed a newer TCP revision', async () => {
  const tcpId = 'robot:robot-a:tcp:welder'
  expect(frameStore.getState().getCommittedFrameRecord(tcpId)?.revision).toBe(1)
  store.getState().previewNamedFrame('robot-a', 'config-1', 'welder', poseAt(0, 0, 0.25))
  await commitExternalFrameEditForTest(tcpId, {
    parentId: 'robot:robot-a:flange:tool0', localPose: poseAt(0, 0, 0.3), expectedRevision: 1,
  })
  const newer = frameStore.getState().getCommittedFrameRecord(tcpId)
  expect(newer?.revision).toBe(2)
  await expect(store.getState().apply(
    'robot-a', 'config-1', { acknowledgeGeometryMismatch: false },
  )).rejects.toThrow(/TCP.*revision.*changed/i)
  expect(frameStore.getState().getCommittedFrameRecord(tcpId)).toEqual(newer)
  expect(readRuntimeFrame(tcpId).localPose).toEqual(newer!.localPose)
  expect(frameStore.getState().previews).not.toHaveProperty(tcpId)
  expect(readInstance('robot-a').mechanicalConfigurationRevision).toBe('rev-1')
  expect(readCommittedEffectiveDefinition('robot-a')).toEqual(effectiveFor('config-1', 'rev-1'))
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/robot-config`

Expected: FAIL because mechanical store/editor do not exist.

- [ ] **Step 3: Implement revisioned preview and atomic Apply**

Keep drafts and preview effective definitions in the config store as plain
serializable data keyed by the immutable pair
`robotInstanceId + baseMechanicalConfigurationId/revision`; never key them by
the active tree selection or configuration ID alone. Every preview/cancel/Apply
action takes the RobotInstance ID explicitly. On first touch of each manual
TCP/sensor/camera that the draft may write, snapshot its exact persisted frame
ID, owner, parent, and committed transform revision. Preview validates on each change
and swaps only that instance's runtime effective definition; nominal data and
persisted instance revision stay fixed. Apply re-resolves the exact instance
and verifies it still references the draft's base configuration/revision both
before validation and inside the transaction. It creates a new immutable
revision ID/hash, validates the full definition, requires mismatch
acknowledgement, and transactionally writes configuration plus only that
instance revision and every changed namespaced manual TCP/sensor/camera frame.
Inside that same transaction, re-read every affected persisted frame and reject
the whole Apply if its ID/owner/parent/revision no longer matches the draft
baseline. Keep the newer Frame Inspector commit, the old mechanical
configuration/runtime, and the draft conflict warning; require Cancel/reopen or
an explicit rebase before retry. Never last-write-wins across the two editors.
Two instances that shared the old revision do not both change. Flange
overrides remain definition-local effective data and are emitted by the pure
derived-frame adapter; TCP/sensor/camera overrides update their existing
persisted same-owner nodes with the Frame plan's pure
`preparePersistedFrameCommit()` inside the Mechanical caller-owned transaction,
then publish its collected `FrameCommitEvent`s only after that outer transaction
commits. A changed local pose/parent therefore increments its committed
transform revision exactly once without a nested transaction; they never
create/register duplicates. Link geometry preview/Apply replaces whole
ordered collections and supports root links. Publish the new runtime only after
commit. Cancel restores the committed effective definition, collision boxes,
and TCP poses and clears draft warnings.
For manual TCP/sensor/camera fields, preview also calls Frame Store
`previewFrame()` with a stable `mechanical:<robotInstanceId>:<draftId>` owner
token, so the runtime graph/tool/collider sees the draft even though the FK
adapter intentionally emits no TCP. A competing Frame Inspector owner is a
visible conflict and neither preview overwrites the other. Operator Cancel,
Apply success, and OPC/Play transition cleanup cancel only this draft's owner
tokens. Operator Cancel and transition cleanup also discard the serializable
mechanical draft and its warnings so no stale Apply remains after ownership
changes; Apply success replaces the draft with committed state. Database
rollback or Frame/configuration revision conflict removes every
mechanical-owned runtime/frame preview and restores the committed effective
definition/TCP/colliders, but retains the serializable draft data and an
actionable warning for explicit rebase/retry. The committed record remains
untouched in every failure path.
After the outer transaction and committed runtime/TCP/collider publication both
succeed, emit exactly one `CommittedMechanicalConfigurationChange` for the
explicit instance. Preview, no-op, cancellation, validation failure, DB
rollback, and changes to another instance emit nothing. Listener callbacks are
memory-only; unsubscribe on consumer teardown and remove instance-scoped
listener state during committed RobotInstance deletion. The Pose plan consumes
this API to invalidate only the affected active playback snapshot.

- [ ] **Step 4: Implement the editor**

Show nominal and override for joint origin XYZ/RPY, axis, direction, zero offset,
Home, lower/upper, velocity, acceleration, flange/TCP, collision asset, and
visual variant. Collision and visual rows are grouped by link—not joint—and
show every geometry ID, asset, independent pose, retained source scale, and
generated collision box; root link is editable. Scale is provenance/read-only,
not an arbitrary non-uniform CAD deformation control. Use explicit metre/mm,
radian/degree, rad/s or m/s labels.
Invalid drafts cannot apply. Geometry mismatch identifies exact descendant
links and offers Select Matching Visual Variant or Acknowledge; it never offers
arbitrary non-uniform CAD deformation. Disable editing during playback, import,
or held-object reset in this plan. The later OPC UA plan adds its shared
per-instance Simulation-mutation gate at both this editor and the store's Apply
boundary; do not add a provisional `sourceMode` or a second ownership owner here.

- [ ] **Step 5: Run GREEN and commit**

Run each command separately and stop on the first nonzero exit:

1. `npm run test:run -- src/features/robot-config src/features/robot/RobotModel.test.ts src/features/ui/InspectorPanel.test.tsx`
2. `npm run build`
3. `git diff --check`

Expected: every command exits 0. Preview/commit counts, cancellation, mismatch,
rollback, revision, local flange/TCP ownership, multi-geometry root collision,
units, focus, and runtime FK/collider tests PASS.

```powershell
git add src/features/robot-config src/features/ui/InspectorPanel.tsx src/features/ui/InspectorPanel.test.tsx src/features/robot/RobotModel.tsx src/styles/global.css
git diff --cached --check
git commit -m "feat: edit robot mechanical dimensions"
```

## Task 8: End-to-End Acceptance and Luna Documentation

**Files:**
- Create: `e2e/fixtures/robot/two-link/robot-manifest.json`
- Create: `e2e/fixtures/robot/two-link/base.step`
- Create: `e2e/fixtures/robot/two-link/arm.step`
- Create: `e2e/fixtures/robot/two-link/tool.step`
- Create: `e2e/fixtures/robot/resolved-urdf/robot.urdf`
- Create: `e2e/fixtures/robot/resolved-urdf/base-visual.glb`
- Create: `e2e/fixtures/robot/resolved-urdf/arm-visual-a.glb`
- Create: `e2e/fixtures/robot/resolved-urdf/arm-visual-b.glb`
- Create: `e2e/fixtures/robot/resolved-urdf/arm-collision-a.glb`
- Create: `e2e/fixtures/robot/resolved-urdf/arm-collision-b.glb`
- Create: `e2e/fixtures/robot/resolved-urdf/slider-visual.glb`
- Create: `e2e/fixtures/robot/resolved-urdf/slider-collision.glb`
- Create: `e2e/fixtures/robot/FIXTURE_PROVENANCE.md`
- Create: `scripts/test/generate-robot-fixtures.mjs`
- Modify: `package.json`
- Create: `e2e/generic-robot-import.spec.ts`
- Modify: `src/test/debug-bridge.ts`
- Modify: `src/test/debug-bridge.test.ts`
- Create: `docs/developer/robot-definition-manifest.md`
- Create: `docs/operator/robot-import.md`
- Create: `docs/operator/mechanical-configuration.md`
- Create: `docs/verification/generic-robot-verification.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: production app, Task 11/Frame-plan read-only E2E bridge, supplied
  NED2 sources, two-link STEP, and three-link resolved URDF fixtures.
- Produces: dynamic instance/link/frame snapshot fields, reproducible browser
  proof, and operator/developer/verification documentation.

- [ ] **Step 1: Add provenance-safe fixtures and browser acceptance**

Use three small project-authored AP242 box/cylinder STEP fixtures with a
checked-in Manifest and SHA-256 values. The same `tool.step` is referenced as a
second visual and a collision geometry with different poses/scales to prove
source dedupe without transform collapse. Its local named-frame fixture includes
derived tool0, a manual gripper TCP, and a manual wrist camera parented to that
TCP. The URDF fixture has base/arm/slider links, revolute plus prismatic joints,
two arm visuals, two arm collisions, and
the seven concrete project-authored GLBs listed above. Record generator,
commands, licensing/provenance, raw hashes, and detected units in
`FIXTURE_PROVENANCE.md`; tests never use absolute developer-machine paths.

Implement `scripts/test/generate-robot-fixtures.mjs` with no external CAD tool
or machine-specific path. A fixed-precision, fixed-entity-order AP242 template
writer generates the three small STEP box/cylinder solids with a constant
header timestamp. A minimal deterministic GLB 2.0 writer generates the seven
triangle fixtures using canonical JSON key order, fixed vertex/index order,
zero timestamps, and 4-byte chunk padding. `--write` writes all ten binaries,
updates exact SHA-256 fields in `robot-manifest.json`, and replaces only a
marked generated hash table in `FIXTURE_PROVENANCE.md`; default `--check`
generates into memory and fails on any byte/hash drift without modifying files.
Add:

```json
{
  "scripts": {
    "fixtures:robot:generate": "node scripts/test/generate-robot-fixtures.mjs --write",
    "fixtures:robot:verify": "node scripts/test/generate-robot-fixtures.mjs --check"
  }
}
```

Run `npm run fixtures:robot:generate` once in the fixture task, inspect the
diff/hashes, then run `npm run fixtures:robot:verify` and `npm run cad:validate`.
The provenance file records generator version, the exact two commands,
project-authored licensing, units, and generated hashes. Terra never hand-edits
binary fixture bytes.

Before browser GREEN, extend the Task 11/Frame-plan E2E-only read-only snapshot
and its unit test. Include aggregate `robotDefinitionCount` and
`robotAssetCount` numbers without bytes or mutation access. `robots` is an array of plain JSON records containing instance
ID, definition/config revision, Base ID, active TCP ID, named joint map, and a
dynamic `links` array with link ID, world pose, visual-geometry count,
collision-geometry count, collision-box count, and plain-JSON effective
collision-box poses/bounds. Include effective joint-origin poses and the
persistent geometry-mismatch acknowledgement/warning state. Include that instance's
namespaced frame rows with parent ID, local/world pose, role/source/owner so the
test can prove one manual TCP and no duplicate derived TCP. Do not expose asset bytes, Blob URLs, Three/Rapier
objects, source credentials, mutation methods, or fixed-six assumptions.

```ts
function expectDebugPoseClose(actual: Pose3D, expected: Pose3D, digits = 8): void {
  actual.position.forEach((value, index) => expect(value).toBeCloseTo(expected.position[index]!, digits))
  const dot = actual.quaternion.reduce(
    (sum, value, index) => sum + value * expected.quaternion[index]!,
    0,
  )
  actual.quaternion.forEach((value, index) => {
    expect(dot < 0 ? -value : value).toBeCloseTo(expected.quaternion[index]!, digits)
  })
}

function expectDebugPoseTranslatedBy(actual: Pose3D, before: Pose3D, delta: Vec3): void {
  expectDebugPoseClose(actual, {
    position: before.position.map((value, index) => value + delta[index]!) as Vec3,
    quaternion: before.quaternion,
  })
}

function persistedManualFrameSignature(frames: readonly DebugFrameSnapshot[]) {
  return frames
    .filter(({ source }) => source === 'manual')
    .map(({ id, parentId, localPose, role, source, ownerEntityId }) => ({
      id, parentId, localPose, role, source, ownerEntityId,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

test('imports, reloads, configures, and deletes a second STEP robot', async ({ page }) => {
  await page.goto('/')
  await importRobotPackage(page, fixturePath('two-link'))
  await expect(page.getByRole('treeitem', { name: 'Two Link Test Robot' })).toBeVisible()
  await setRobotJoint(page, 'Two Link Test Robot', 'joint-1', 30)
  const moved = await readRobotLinkWorld(page, 'two-link-1', 'arm')
  const beforeReload = (await readDebugSnapshot(page)).robots.find(({ id }) => id === 'two-link-1')!
  await page.reload()
  const afterReload = (await readDebugSnapshot(page)).robots.find(({ id }) => id === 'two-link-1')!
  expect({
    definitionRevision: afterReload.definitionRevision,
    configurationRevision: afterReload.configurationRevision,
    baseFrameId: afterReload.baseFrameId,
    activeTcpFrameId: afterReload.activeTcpFrameId,
    frames: persistedManualFrameSignature(afterReload.frames),
  }).toEqual({
    definitionRevision: beforeReload.definitionRevision,
    configurationRevision: beforeReload.configurationRevision,
    baseFrameId: beforeReload.baseFrameId,
    activeTcpFrameId: beforeReload.activeTcpFrameId,
    frames: persistedManualFrameSignature(beforeReload.frames),
  })
  expect(afterReload.joints['joint-1']).toBe(0) // live joint state is intentionally transient
  await setRobotJoint(page, 'Two Link Test Robot', 'joint-1', 30)
  expect(await readRobotLinkWorld(page, 'two-link-1', 'arm')).toEqual(moved)
  const beforeConfiguration = (await readDebugSnapshot(page)).robots
    .find(({ id }) => id === 'two-link-1')!
  const beforeArm = beforeConfiguration.links.find(({ id }) => id === 'arm')!
  expect(beforeArm.collisionBoxes.length).toBeGreaterThan(0)
  await applyJointOriginOverride(page, 'joint-1', { zMm: 800, acknowledgeMismatch: true })
  await expect(page.getByText(/geometry mismatch/i)).toBeVisible()
  const configured = (await readDebugSnapshot(page)).robots.find(({ id }) => id === 'two-link-1')!
  const configuredSignature = {
    configurationRevision: configured.configurationRevision,
    jointOrigins: configured.effectiveJointOrigins,
    armWorld: configured.links.find(({ id }) => id === 'arm')!.worldPose,
    collisionBoxes: configured.links.find(({ id }) => id === 'arm')!.collisionBoxes,
    geometryMismatch: configured.geometryMismatch,
  }
  expect(configuredSignature.collisionBoxes).toHaveLength(beforeArm.collisionBoxes.length)
  expectDebugPoseTranslatedBy(configuredSignature.armWorld, beforeArm.worldPose, [0, 0, 0.3])
  configuredSignature.collisionBoxes.forEach((box, index) => {
    expectDebugPoseTranslatedBy(box.worldPose, beforeArm.collisionBoxes[index]!.worldPose, [0, 0, 0.3])
    expect(box.halfExtents).toEqual(beforeArm.collisionBoxes[index]!.halfExtents)
  })
  await page.reload()
  await expect(page.getByText(/geometry mismatch/i)).toBeVisible()
  const imported = (await readDebugSnapshot(page)).robots.find(({ id }) => id === 'two-link-1')!
  expect(imported.configurationRevision).toBe(configuredSignature.configurationRevision)
  expect(imported.effectiveJointOrigins).toEqual(configuredSignature.jointOrigins)
  expect(imported.geometryMismatch).toEqual(configuredSignature.geometryMismatch)
  expectDebugPoseClose(
    imported.links.find(({ id }) => id === 'arm')!.worldPose,
    configuredSignature.armWorld,
  )
  const importedCollisionBoxes = imported.links.find(({ id }) => id === 'arm')!.collisionBoxes
  expect(importedCollisionBoxes).toHaveLength(configuredSignature.collisionBoxes.length)
  expect(importedCollisionBoxes.length).toBeGreaterThan(0)
  importedCollisionBoxes.forEach((box, index) => {
    expectDebugPoseClose(box.worldPose, configuredSignature.collisionBoxes[index]!.worldPose)
    expect(box.halfExtents).toEqual(configuredSignature.collisionBoxes[index]!.halfExtents)
  })
  expect(imported.links.find(({ id }) => id === 'arm')).toMatchObject({
    visualGeometryCount: 2, collisionGeometryCount: 1,
  })
  expect(imported.frames.filter(({ role }) => role === 'tcp')).toEqual([
    expect.objectContaining({
      id: 'robot:two-link-1:tcp:gripper', source: 'manual', ownerEntityId: 'robot:two-link-1',
    }),
  ])
  expect(imported.frames.filter(({ role }) => role === 'camera')).toEqual([
    expect.objectContaining({
      id: 'robot:two-link-1:camera:wrist-camera',
      parentId: 'robot:two-link-1:tcp:gripper', source: 'manual',
      ownerEntityId: 'robot:two-link-1',
    }),
  ])

  await moveIntoFixtureAndCloseGripper(page, 'Two Link Test Robot', 'Cup 01')
  await expect.poll(async () => (await readDebugSnapshot(page)).heldEquipmentId).toBe('cup-01')
  await deleteRobotInstance(page, 'Two Link Test Robot')
  const deleted = await readDebugSnapshot(page)
  expect(deleted.robots.some(({ id }) => id === 'two-link-1')).toBe(false)
  expect(deleted.heldEquipmentId).toBeNull()
  expect(deleted.collisionPairs.some((pair) => pair.includes('two-link-1'))).toBe(false)
  await page.reload()
  expect((await readDebugSnapshot(page)).robots.some(({ id }) => id === 'two-link-1')).toBe(false)
})

test('imports all resolved URDF geometries with revolute and prismatic joints', async ({ page }) => {
  await page.goto('/')
  await importResolvedUrdf(page, fixturePath('resolved-urdf'), {
    requestedInstanceId: 'urdf-1',
    flangeParentLinkId: 'slider',
    flangeLocalId: 'tool0',
    tcpLocalId: 'default',
  })
  const robot = (await readDebugSnapshot(page)).robots.find(({ id }) => id === 'urdf-1')!
  expect(Object.keys(robot.joints)).toEqual(['arm-revolute', 'slider-prismatic'])
  expect(robot.links.find(({ id }) => id === 'arm')).toMatchObject({
    visualGeometryCount: 2, collisionGeometryCount: 2, collisionBoxCount: 2,
  })
  expect(robot.activeTcpFrameId).toBe('robot:urdf-1:tcp:default')
  expect(robot.frameIds).toEqual(expect.arrayContaining([
    'robot:urdf-1:flange:tool0', 'robot:urdf-1:tcp:default',
  ]))

  await expect(page.getByLabel('arm-revolute position')).toHaveAttribute('data-unit', 'deg')
  await expect(page.getByLabel('slider-prismatic position')).toHaveAttribute('data-unit', 'mm')
  await setJointPosition(page, 'arm-revolute', { displayValue: 90, unit: 'deg' })
  const zero = await readRobotWorldPoses(page, 'urdf-1', [
    'link:arm', 'link:slider', 'flange:tool0', 'tcp:default',
  ])
  await setJointPosition(page, 'slider-prismatic', { displayValue: 200, unit: 'mm' })
  const moved = await readRobotWorldPoses(page, 'urdf-1', [
    'link:arm', 'link:slider', 'flange:tool0', 'tcp:default',
  ])

  expectPoseClose(moved['link:arm']!, zero['link:arm']!)
  for (const id of ['link:slider', 'flange:tool0', 'tcp:default']) {
    expectPoseTranslatedBy(moved[id]!, zero[id]!, [0, 0.2, 0])
  }
  expect(moved['tcp:default']!.position[1] - zero['tcp:default']!.position[1])
    .toBeCloseTo(0.2, 9)
})

test('rejects a cyclic resolved URDF with no partial persistence', async ({ page }) => {
  await page.goto('/')
  const before = await readDebugSnapshot(page)
  await importResolvedUrdfFiles(page, [{
    name: 'cyclic.urdf',
    mimeType: 'application/urdf+xml',
    buffer: Buffer.from(cyclicUrdfText('base', 'arm', 'base')),
  }])
  await expect(page.getByRole('alert')).toContainText(/cycle.*base.*arm.*base/i)
  const after = await readDebugSnapshot(page)
  expect(after.robots).toEqual(before.robots)
  expect(after.robotDefinitionCount).toBe(before.robotDefinitionCount)
  expect(after.robotAssetCount).toBe(before.robotAssetCount)
})
```

- [ ] **Step 2: Run RED, then GREEN**

Run: `npm run test:e2e -- e2e/generic-robot-import.spec.ts`

Expected before wiring: FAIL at Robot Import. Expected after wiring: PASS for
actual STEP worker conversion, Manifest, reload, dynamic joints, collision,
mechanical revision/mismatch, held-object deletion/reload/source/collision
cleanup, resolved URDF multi-geometry, degree/radian and millimetre/metre UI
conversion, exact 0.2 m revolute-transformed prismatic propagation through the
slider/flange/TCP, cancel, cyclic topology with zero partial persistence,
corrupt package, aggregate limit, and transaction rollback.

- [ ] **Step 3: Write Luna documentation**

Manifest reference defines every schema field, units, IDs, assets, hashes,
joint types, limits, definition-local named frames and per-instance namespace,
single-owner manual TCP plus sensor/camera-child materialization, ordered
visual/collision geometry instances, pose/scale retention versus metre baking,
link-level/root collision
overrides, validation, examples, and versioning.
Operator guides cover STEP+Manifest, STEP Wizard, resolved URDF/no-Xacro,
Mechanical Editor, mismatch, revisions, RobotInstance deletion (held release,
source/selection/collision cleanup, foreign-child block), rollback, asset GC,
and recovery. State plainly that reload persists instance/config/Base/manual
frames but initializes live joints from Home; Pose Sequence is the persistence
surface for commanded poses. Verification records NED2 parity matrices, CAD 7/7, every fixture
hash, multi-geometry transforms/scales, deletion ordering/rollback evidence,
browser captures, commands, and any upstream-only warnings.

- [ ] **Step 4: Run final gates**

Run each gate separately and stop on the first nonzero exit:

1. `npm run lint`
2. `npm run test:run`
3. `npm run fixtures:robot:verify`
4. `npm run cad:validate`
5. `npm run build`
6. `npm run test:e2e -- e2e/generic-robot-import.spec.ts`
7. `npm audit --omit=dev --audit-level=high`
8. Run this PowerShell 5.1-safe inverted placeholder scan:

```powershell
$placeholderMatches = rg -n -i "T[B]D|T[O]DO|F[I]XME" docs/developer/robot-definition-manifest.md docs/operator/robot-import.md docs/operator/mechanical-configuration.md
if ($LASTEXITCODE -eq 0) { $placeholderMatches; throw 'Documentation placeholders remain' }
if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
```

9. Run this policy-wording review; exit 0 prints matching explicit non-support
   statements and exit 1 is a valid no-match result:

```powershell
$policyMatches = rg -n -i "xacro execution|non-uniform deformation" docs/developer/robot-definition-manifest.md docs/operator/robot-import.md docs/operator/mechanical-configuration.md
if ($LASTEXITCODE -eq 0) { $policyMatches }
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
```

10. `git diff --check`

Expected: all gates PASS; fixture regeneration has zero byte/hash drift; CAD
7/7, 0 errors, 0 warnings; no high/critical
production dependency audit issue; `rg` exit 1 is explicitly accepted as the
successful empty placeholder scan; any matches for Xacro/deformation are
explicit non-support statements.

- [ ] **Step 5: Commit Luna artifacts**

```powershell
git add e2e/fixtures/robot scripts/test/generate-robot-fixtures.mjs package.json e2e/generic-robot-import.spec.ts src/test/debug-bridge.ts src/test/debug-bridge.test.ts docs/developer/robot-definition-manifest.md docs/operator/robot-import.md docs/operator/mechanical-configuration.md docs/verification/generic-robot-verification.md README.md
git diff --cached --check
git commit -m "docs: document generic robot configuration"
```

## Completion Gate

A fresh reviewer must confirm schema/topology validation, NED2 matrix/collision/
grasp parity, multi-instance identity, buffer and Three resource ownership,
content-addressed persistence, transactional rollback, actual STEP conversion,
resolved URDF multi-geometry semantics, definition-local frame namespacing,
single-owner TCP persistence, mechanical revision/mismatch and root-link
collision behavior, rollback-safe instance deletion, post-transaction asset GC,
accessibility, dynamic debug snapshots, reload persistence, documentation, and
every automated gate before completion.
