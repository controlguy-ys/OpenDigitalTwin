# Project V3 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Project Schema v3 as the single authoritative, crash-consistent foundation for assembly Robot sources, Simulation Jobs, STEP/Box/Cylinder Object Assets, canonical external-entity transforms, canonical numeric Status bindings, and read-only OPC UA Transform bindings before any feature work begins.

**Architecture:** Split the current monolithic project contract into focused v3 subcontracts, then migrate v1/v2 snapshots through one deterministic adapter. Store immutable Project revisions and a separately committed active-revision pointer; prepare all source-derived assets and one complete runtime bundle before the pointer is flipped. Project configuration is durable, while Workspace Mode and all live OPC UA values, timestamps, quality, interpolation state, and connection state remain transient.

**Tech Stack:** TypeScript 6, React 19, Zustand 5, Dexie 4, fflate 0.8.3, Three.js 0.185, Vitest 4, fake-indexeddb 6, Playwright 1.61.

## Global Constraints

- **Prerequisite:** Complete Gate G0, commit the single amended normative specification, and obtain explicit user approval before running any WS1 source task. If that approved revision is absent, stop and return to the master roadmap; do not infer the contract locally.
- This plan is WS1 and must complete, pass review, and satisfy its release gate before Assembly Import, Simulation Jobs, Primitive Objects, OPC UA Equipment Transform, or Mode Workspace feature implementation begins.
- Keep one active Robot, exactly six revolute Joints (`J1` through `J6`), and exactly seven Robot Links (`LINK00` through `LINK06`). Variable DOF, multiple Robots, URDF, and seven-axis Robots remain outside this milestone.
- Robot language is: **seven Robot Links mapped from one through seven STEP sources**. File names and assembly names may suggest mappings but never prove Kinematics.
- Schema v3 is the only schema introduced in this milestone. Jobs, Primitive Assets, Robot source de-duplication, canonical external transforms, and OPC UA Transform Binding configuration must land in the same v3 contract; do not create a v4 during the milestone.
- Preserve v1 and v2 visible placement, Joint values, rigid unit-scale MCP/TCP transforms, Pose order, outgoing speed, easing, collision Boxes, and collision policy through deterministic migration. Reject a non-unit legacy coordinate-frame scale before staging rather than silently changing it.
- Every migrated v1/v2 flat Pose array, including an empty array, becomes exactly one active Job with `id: 'job-default'` and `name: 'Default Job'`.
- A new Object Asset has exactly one `sourceKind` discriminator: `step`, `box`, or `cylinder`. STEP Assets own source bytes; Box and Cylinder Assets contain no fake filename, fake source bytes, nested generic Primitive kind, or archive STEP entry.
- `ProjectPoseStepV3` requires persisted `speedPercentToNext`; the legacy optional field is normalized to `100` when absent. Every command-space angle must lie within its current Mechanics inclusive limits with no clamping. Its non-terminal `durationMs` is redundant and must match the approved G0 max-Joint-delta/maximum-velocity/speed formula within `1e-9 ms`; terminal duration is exactly `1000`. Migration and every relevant mutation recompute the canonical value rather than retaining two motion authorities.
- `ObjectInstanceRecordV3` owns `graspable: boolean` and `manualNumericStatus` but no transform or live numeric value. Its transform exists only in the matching canonical external-entity state. V1/V2 Object Instances migrate with `graspable: false` because the durable legacy Project format did not preserve that choice.
- `ProjectBuiltInEquipmentRecordV3` owns durable built-in display/status/grasp/stack-light/collision configuration and `manualNumericStatus`, but no transform or live numeric value. Every built-in and Object Instance has exactly one canonical external transform state.
- `FixedSixAxisRobotMechanicsV3` owns six normalized `ProjectRobotJointV3` records plus separate rigid Flange and Tool0 transforms. MCP, TCP, Flange, and Tool0 use `ProjectRigidTransformV3` with exact scale `[1, 1, 1]`; V2 migration uses the exact deterministic defaults in the approved G0 specification.
- `ProjectExternalEntityTransformStateV3.manualTransform` is canonical MCP-local and has no Manual frame field. `referenceFrameId: 'world' | 'mcp'` exists only on the separate OPC UA Transform Binding.
- Box dimensions, Cylinder radius/height, scale/offset values, transforms, and all statistics must be finite. Each Box dimension is within inclusive `[0.001, 10] m`; Cylinder radius is within inclusive `[0.0005, 5] m`; Cylinder height is within inclusive `[0.001, 10] m`. Box and Cylinder `color` is canonical uppercase `#RRGGBB` and must match `/^#[0-9A-F]{6}$/`.
- Every OPC UA Equipment Transform Binding persists the fixed smoothing policy `{ mode: 'two-cycle', cycles: 2 }`. Runtime duration is derived as `2 * gatewayProfile.samplingIntervalMs`; with the default `100 ms` Profile interval it is `200 ms`. No millisecond smoothing duration is persisted.
- Enforce `MAX_JOBS = 32`, `MAX_POSES_PER_JOB = 256`, and `MAX_PROJECT_POSES = 2048` at validation, migration, capture, and archive decode boundaries.
- Enforce `MAX_OBJECT_ASSETS = 256`, `MAX_OBJECT_INSTANCES = 512`, and `MAX_VISIBLE_RENDER_ITEMS = 1024`; the last counts actual visible Three.js Mesh/material render groups after instancing/reuse and is separate from triangle/mesh/source limits. `MAX_VISIBLE_STATUS_OVERLAYS = 128` is a runtime presentation cap, not a persisted-configuration rejection: all 512 Instances may retain `statusOverlayVisible: true`, while only the deterministic selected/in-frustum/nearest subset mounts DOM overlays.
- General persisted IDs and display names accept 1-128 UTF-8 bytes; STEP/Manifest filenames accept 1-255 UTF-8 bytes; reject rather than truncate at native validation, migration, UI submit, and archive decode.
- Source STEP identity is SHA-256 of the exact input bytes. Hashing must work in trusted-LAN HTTP deployments and may not depend exclusively on secure-context Web Crypto. New or replaced source bytes are hashed once; metadata-only mutations preserve unforgeable verified source handles and perform zero source rehashes or source-byte rewrites.
- Raw STEP limits remain 25 MiB per unique Robot source, 100 MiB total Robot source bytes after de-duplication, 50 MiB per STEP Object Asset, and 256 MiB per Project. One source may supply confirmed parts to multiple Links without duplicating its bytes. Existing triangle, mesh, material, scene, and collision-Box limits remain unchanged.
- The authoritative ProjectDB aggregate is the active pointer plus an immutable byte-free revision projection and its namespace-local content-addressed source Blobs. A hydrated v3 snapshot owns those bytes in memory. Derived Geometry caches key by source digest plus Geometry-affecting configuration and carry revision associations only for publication; a Project revision change alone does not force parse/rebuild. Inactive Object Assets are byte-verified but lazily prepared.
- Workspace Mode is UI state and must not be serialized in IndexedDB Project revisions or `.wdtwin` archives.
- Live OPC UA values, last-good Pose, sequence number, receipt time, source timestamp, quality, stale timer, smoothing trajectory, socket state, and diagnostics must not be serialized.
- Project Import/New/replace is all-or-nothing. Interaction stays locked from preparation through publication or recovery.
- Runtime publication performs one prebuilt bundle-pointer replacement. It performs no STEP parse, hashing, Three.js allocation, or IndexedDB write.
- A failure before the publishing-pointer transaction leaves the old revision active. Runtime publication failure after that transaction is compensated back to the old pointer/runtime when possible. A failure after the new runtime publishes during finalization or post-finalization token consumption/handle activation keeps the coherent new publishing/stable pointer and runtime locked in `recovery-required`; it is not partially rolled back. Compensation failure also stays locked for recovery. Old-runtime disposal failure is a successful new commit with a bounded cleanup warning.
- Preserve existing user changes, do not stage the two untracked CAD/backup directories, and keep source comments in English.
- No PLC write, OPC UA write, controller command, deploy, transfer, restart, or live-controller operation is authorized by this plan.

## Existing Plan Disposition

| Existing artifact | Disposition for this milestone | Reason |
|---|---|---|
| `2026-07-13-portable-workcell-project-core.md` | Completed baseline; modify only through v3 migration | V1/V2 archive, Asset/Instance, and staged Project behavior already exist. |
| `2026-07-13-fixed-coordinate-frames.md` | Completed baseline; preserve and integrate | Fixed World/MCP/Base/Flange/TCP behavior plus the deterministic V3 Tool0 default is the migration source. |
| `2026-07-13-geometry-collision-core.md` | Completed baseline; preserve and integrate | V2 Compound Boxes and collision policy are v3 inputs. |
| `2026-07-13-on-prem-docker-deployment.md` | Completed baseline; rerun at release | Deployment packaging is not reimplemented here. |
| `2026-07-11-frame-graph-manual-coordinates.md` | Future, do not execute | It targets a generic editable graph beyond the fixed-frame milestone. |
| `2026-07-11-generic-robot-import-mechanical-configuration.md` | Superseded for this milestone | Variable DOF and URDF conflict with the approved fixed six-axis scope. |
| `2026-07-11-opcua-joint-source-gateway.md` | Partially realized; do not execute wholesale | The short-term read-only Joint gateway exists; v3 adds only the contracts required by later Transform work. |
| `2026-07-11-pose-sequence-speed-ordering.md` | Superseded by Simulation Jobs | Reuse its velocity, locking, ordering, and accessibility invariants; do not create a second Sequence store. |
| Baseline Tasks 10-12 in `2026-07-10-crb15000-web-simulation.md` | Superseded by the Mode Workspace release plan | Responsive shell work is partial and the old single-screen information architecture is obsolete. |

## Locked File Map

```text
src/domain/project/project.ts                         # v1/v2 compatibility exports and current-version dispatcher
src/domain/project/project-v3.ts                      # v3 snapshot envelope and graph validation
src/domain/project/robot-source-v3.ts                 # de-duplicated Robot sources, Link refs, Mechanics provenance
src/domain/project/simulation-job-v1.ts               # Job-owned Pose records and active selection
src/domain/project/object-asset-v3.ts                  # STEP/Box/Cylinder discriminated Asset records
src/domain/project/external-entity-v3.ts               # canonical Manual fallback/ownership state
src/domain/project/opcua-transform-binding-v3.ts       # durable gateway/Profile/reference/smoothing selection
src/domain/project/project-v2-migration.ts             # deterministic v1/v2 -> v3 migration
src/domain/project/*.test.ts                           # contract and migration tests
src/lib/hash/sha256.ts                                 # ProjectHashService and secure-context digest path
src/lib/hash/sha256.test.ts
src/lib/hash/sha256-worker.ts                          # incremental trusted-LAN HTTP fallback Worker
src/lib/hash/sha256-worker.test.ts
src/features/project/project-source-staging.ts         # one-hash prepared source token registry
src/features/project/project-source-staging.test.ts
src/lib/id/create-portable-id.ts                       # randomUUID plus getRandomValues trusted-LAN fallback
src/lib/id/create-portable-id.test.ts
src/features/project/project-codec.ts                  # v1/v2 decode and deterministic v3 archive encode/decode
src/features/project/project-codec.test.ts
src/features/project/project-db.ts                     # byte-free revisions, source Blobs, active pointer, legacy table
src/features/project/project-db.test.ts
src/features/project/project-revision-repository.ts    # compare-and-swap revision/pointer transactions
src/features/project/project-revision-repository.test.ts
src/features/project/project-runtime-bundle.ts         # prepared/published runtime bundle contract
src/features/project/project-commit-coordinator.ts     # commit lock, publication, compensation, recovery
src/features/project/project-commit-coordinator.test.ts
src/features/project/project-store.ts                  # v3 store orchestration and public actions
src/features/project/project-store.test.ts
src/features/project/browser-project-runtime.ts        # current stores/cache staging and v3 bridge
src/features/project/browser-project-runtime.test.ts
src/features/project/project-store-browser.ts
src/features/import/ImportStepDialog.tsx               # remove direct secure-context-only ID calls
src/features/import/ImportStepDialog.test.tsx
src/features/project/legacy-pose-job-adapter.ts        # flat keyframe compatibility bridge
src/features/project/legacy-pose-job-adapter.test.ts
src/features/equipment/equipment-store.ts              # built-in Equipment capture/replace boundary
src/features/objects/object-asset-store.ts              # v3 STEP/Primitive persistence boundary
src/features/robot/robot-geometry-store.ts              # source/link revision bridge
src/features/frames/coordinate-frame-store.ts           # MCP/TCP v3 bridge
src/features/joints/robot-store.ts                       # retiring flat Pose adapter only
src/features/collision/collision-store.ts                # v3 policy bridge
tests/project-v3-roundtrip.spec.ts
tests/nonsecure-origin-core.spec.ts
playwright.insecure.config.ts
vite.config.ts
package.json
docs/developer/project-v3-format.md
docs/progress/2026-07-13-project-status.md
docs/progress/2026-07-13-short-term-mvp-implementation.md
README.md
```

---

### Task 1: Define Focused Project V3 Contracts

**Files:**
- Create: `src/domain/project/robot-source-v3.ts`
- Create: `src/domain/project/simulation-job-v1.ts`
- Create: `src/domain/project/simulation-duration-v3.ts`
- Create: `src/domain/project/simulation-duration-v3.test.ts`
- Create: `src/domain/project/object-asset-v3.ts`
- Create: `src/domain/project/external-entity-v3.ts`
- Create: `src/domain/project/opcua-numeric-status-binding-v3.ts`
- Create: `src/domain/project/opcua-transform-binding-v3.ts`
- Create: `src/domain/project/project-v3.ts`
- Create: `src/domain/project/project-v3.test.ts`
- Create: `src/lib/id/create-portable-id.ts`
- Create: `src/lib/id/create-portable-id.test.ts`
- Modify: `src/domain/project/project.ts`
- Test: `src/domain/project/project.test.ts`

**Interfaces:**
- Consumes: existing `ProjectPoseRecordV1`, `ProjectCollisionBoxV2`, `ProjectCollisionPolicyV2`, `SerializableTransform`, `RobotLinkId`, and v1/v2 snapshot types.
- Produces: `WorkcellProjectSnapshotV3`, byte-free `ByteFreeWorkcellProjectProjectionV3`, `CurrentProjectSnapshot = WorkcellProjectSnapshotV3`, public `validateWorkcellProjectSnapshotV3()`, `preflightWorkcellProjectShapeV3()`, internal `validateStagedWorkcellProjectSnapshotV3()`, `collectProjectSourceDescriptorsV3()`, `createPortableId()`, `DeepReadonly`, `ProjectRigidTransformV3`, `ProjectPoseStepV3`, `SimulationJobV1`, `deriveCanonicalPoseDurationMsV3()`, `canonicalizeSimulationDurationsV3()`, `reconcileSimulationForMechanicsChange()`, `ObjectAssetGeometryV3`, `StepObjectAssetRecordV3`, `BoxObjectAssetRecordV3`, `CylinderObjectAssetRecordV3`, `ObjectAssetRecordV3`, `ObjectInstanceRecordV3`, `ProjectBuiltInEquipmentRecordV3`, `RobotStepSourceAssetV3`, `RobotAssemblyPartRefV3`, `RobotLinkGeometryRecordV3`, `ProjectRobotJointV3`, `FixedSixAxisRobotMechanicsV3`, `FixedSixAxisRobotManifestV1`, `RobotMechanicsProvenanceV3`, `ProjectExternalEntityTransformStateV3`, `ProjectOpcUaNumericStatusBindingV3`, `ProjectOpcUaEquipmentTransformBindingV3`, `MAX_OBJECT_ASSETS`, `MAX_OBJECT_INSTANCES`, `MAX_VISIBLE_RENDER_ITEMS`, `MAX_VISIBLE_STATUS_OVERLAYS`, and shared UTF-8 ID/name/filename limits.

- [ ] **Step 1: Write v3 contract RED tests**

At every native validator boundary, use `TextEncoder` byte counts rather than JavaScript character counts. Add multibyte fixtures proving Project/Robot/Asset/Instance/Job/Pose IDs and names accept exactly 128 UTF-8 bytes and reject 129 without truncation, and STEP/Manifest filenames accept exactly 255 UTF-8 bytes and reject 256. These domain tests complement Task 5 UI pre-read guards; neither layer may silently normalize an over-limit value.

```ts
it('prefers randomUUID and supports the getRandomValues-only trusted-LAN path', () => {
  expect(createPortableId({
    randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    getRandomValues: () => { throw new Error('fallback must not run') },
  })).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')

  const bytes = Uint8Array.from([
    0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
    0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
  ])
  expect(createPortableId({
    getRandomValues: (target) => { target.set(bytes); return target },
  })).toBe('00112233-4455-4677-8899-aabbccddeeff')
})

it('fails explicitly instead of using Math.random when cryptographic IDs are unavailable', () => {
  expect(() => createPortableId({})).toThrow(/PORTABLE_ID_CRYPTO_UNAVAILABLE/)
})

it('accepts Jobs, all Object source kinds, Robot sources, and canonical OPC UA bindings', () => {
  const snapshot = validV3Project()
  snapshot.simulation.jobs = [job('job-1', [pose('pose-1')])]
  snapshot.objectAssets = [stepAsset('step-1'), boxAsset('box-1'), cylinderAsset('cylinder-1')]
  snapshot.opcUa.numericStatusBindings = [
    numericStatusBinding('equipment:cup-01'),
    numericStatusBinding('object:instance-1'),
  ]
  snapshot.opcUa.equipmentTransforms = [
    transformBinding('object:instance-1', { mode: 'two-cycle', cycles: 2 }),
  ]
  expect(validateWorkcellProjectSnapshotV3(snapshot)).toEqual(snapshot)
})

it('rejects legacy, duplicate, and orphan numeric Status binding ownership', () => {
  expect(() => validateWorkcellProjectSnapshotV3(projectWithLegacyEquipmentBinding()))
    .toThrow(/equipment|legacy|unknown/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithNumericBindingInstanceId()))
    .toThrow(/instanceId|unknown/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithDuplicateNumericStatusTarget()))
    .toThrow(/duplicate/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithOrphanNumericStatusTarget()))
    .toThrow(/missing|orphan/i)
})

it('requires one binding whenever either external source is OPC UA', () => {
  expect(() => validateWorkcellProjectSnapshotV3(projectWithOpcNumericSourceAndNoBinding()))
    .toThrow(/numeric|binding/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithOpcTransformSourceAndNoBinding()))
    .toThrow(/transform|binding/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithDormantManualBindings()))
    .not.toThrow()
})

it.each([
  ['workspace mode', (snapshot: any) => { snapshot.workspaceMode = 'BUILD' }],
  ['live telemetry', (snapshot: any) => { snapshot.opcUa.liveValues = {} }],
])('rejects transient %s from the durable snapshot', (_label, mutate) => {
  const snapshot: any = validV3Project()
  mutate(snapshot)
  expect(() => validateWorkcellProjectSnapshotV3(snapshot)).toThrow(/unknown|transient/i)
})

it('rejects invalid Object dimensions and any non-fixed smoothing policy', () => {
  expect(() => validateWorkcellProjectSnapshotV3(projectWithBoxDimensions([1, 0, 1]))).toThrow(/0.001/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithCylinderRadius(Number.NaN))).toThrow(/finite/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithPrimitiveColor('#aabbcc'))).toThrow(/#RRGGBB/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithSmoothing({ mode: 'duration', milliseconds: 100 })))
    .toThrow(/two-cycle/i)
})

it('accepts primitive dimension boundaries and rejects a fixed epsilon outside', () => {
  const epsilon = 1e-12
  expect(() => validateWorkcellProjectSnapshotV3(projectWithBoxDimensions([0.001, 0.001, 0.001]))).not.toThrow()
  expect(() => validateWorkcellProjectSnapshotV3(projectWithBoxDimensions([10, 10, 10]))).not.toThrow()
  expect(() => validateWorkcellProjectSnapshotV3(projectWithBoxDimensions([0.001 - epsilon, 1, 1]))).toThrow(/0.001/)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithBoxDimensions([10 + epsilon, 1, 1]))).toThrow(/10/)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithCylinder(0.0005, 0.001))).not.toThrow()
  expect(() => validateWorkcellProjectSnapshotV3(projectWithCylinder(5, 10))).not.toThrow()
  expect(() => validateWorkcellProjectSnapshotV3(projectWithCylinder(0.0005 - epsilon, 1))).toThrow(/0.0005/)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithCylinder(5 + epsilon, 1))).toThrow(/5/)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithCylinder(1, 0.001 - epsilon))).toThrow(/0.001/)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithCylinder(1, 10 + epsilon))).toThrow(/10/)
})

it('enforces Job, per-Job Pose, and Project Pose boundaries exactly', () => {
  expect(() => validateWorkcellProjectSnapshotV3(projectWithJobs(32, 64))).not.toThrow()
  expect(() => validateWorkcellProjectSnapshotV3(projectWithJobs(33, 1))).toThrow(/32/)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithJobs(1, 256))).not.toThrow()
  expect(() => validateWorkcellProjectSnapshotV3(projectWithJobs(1, 257))).toThrow(/256/)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithTotalPoses(2048))).not.toThrow()
  expect(() => validateWorkcellProjectSnapshotV3(projectWithTotalPoses(2049))).toThrow(/2048/)
})

it('enforces one through seven unique Robot STEP sources at the Project boundary', () => {
  expect(() => validateWorkcellProjectSnapshotV3(projectWithRobotSourceCount(1))).not.toThrow()
  expect(() => validateWorkcellProjectSnapshotV3(projectWithRobotSourceCount(7))).not.toThrow()
  expect(() => validateWorkcellProjectSnapshotV3(projectWithRobotSourceCount(0))).toThrow(/1.*7/)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithRobotSourceCount(8))).toThrow(/1.*7/)
})

it('rejects unreferenced Robot sources and duplicate part ownership across Links', () => {
  expect(() => validateWorkcellProjectSnapshotV3(projectWithUnreferencedRobotSource())).toThrow(/unreferenced/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithDuplicateRobotPartOwner())).toThrow(/ownership/i)
})

it('rejects empty Link occurrence ownership', () => {
  expect(() => validateWorkcellProjectSnapshotV3(projectWithEmptyRobotLinkSourceRefs())).toThrow(/sourceRefs/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithEmptyRobotPartMeshIndices())).toThrow(/meshIndices/i)
})

it('requires positive integer Job revisions and a valid active Job reference', () => {
  expect(() => validateWorkcellProjectSnapshotV3(projectWithJobRevision(1))).not.toThrow()
  for (const invalid of [0, -1, 1.5]) {
    expect(() => validateWorkcellProjectSnapshotV3(projectWithJobRevision(invalid))).toThrow(/revision/i)
  }
  expect(() => validateWorkcellProjectSnapshotV3(projectWithActiveJobId('missing-job')))
    .toThrow(/activeJobId/i)
})

it.each(['mcp', 'tcp', 'flange', 'tool0'] as const)(
  'rejects non-unit scale on rigid %s transforms',
  (field) => {
    expect(() => validateWorkcellProjectSnapshotV3(projectWithRigidScale(field, [1, 2, 1])))
      .toThrow(/rigid|unit scale/i)
  },
)

it('requires persisted V3 Pose speed and normalized Robot Mechanics', () => {
  expect(() => validateWorkcellProjectSnapshotV3(projectWithMissingPoseSpeed())).toThrow(/speed/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithMismatchedDerivedDuration(1e-9 + Number.EPSILON))).toThrow(/duration/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithTerminalDuration(999))).toThrow(/duration/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithMissingMechanicsField('homeDeg'))).toThrow(/home/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithMissingMechanicsField('tool0'))).toThrow(/tool0/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithMaximumVelocity(0))).toThrow(/velocity/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithMaximumVelocity(-1))).toThrow(/velocity/i)
})

it('accepts Pose limit boundaries and rejects any command-space angle outside', () => {
  const epsilonDeg = 1e-9
  expect(() => validateWorkcellProjectSnapshotV3(projectWithPoseAtJointLimits())).not.toThrow()
  expect(() => validateWorkcellProjectSnapshotV3(projectWithPoseAngle('J1', MIN_J1_DEG - epsilonDeg)))
    .toThrow(/PROJECT_JOB_POSE_OUT_OF_LIMITS/)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithPoseAngle('J6', MAX_J6_DEG + epsilonDeg)))
    .toThrow(/PROJECT_JOB_POSE_OUT_OF_LIMITS/)
})

it('preserves fixed tuple arity through the public DeepReadonly aggregate', () => {
  expectTypeOf<WorkcellProjectSnapshotV3['robot']['mechanics']['joints']>()
    .toEqualTypeOf<readonly [ProjectRobotJointV3, ProjectRobotJointV3, ProjectRobotJointV3, ProjectRobotJointV3, ProjectRobotJointV3, ProjectRobotJointV3]>()
  expectTypeOf<ProjectPoseStepV3['anglesDeg']>()
    .toEqualTypeOf<readonly [number, number, number, number, number, number]>()
  expectTypeOf<ObjectAssetGeometryV3['collisionHalfExtents']>()
    .toEqualTypeOf<readonly [number, number, number]>()
  expectTypeOf<ObjectAssetGeometryV3['collisionBoxes']>()
    .toMatchTypeOf<readonly unknown[]>()
  const geometry = {} as ObjectAssetGeometryV3
  const instance = {} as ObjectInstanceRecordV3
  // @ts-expect-error standalone V3 asset records are deeply readonly
  geometry.collisionHalfExtents[0] = 99
  // @ts-expect-error standalone V3 instance records cannot mutate inherited fields
  instance.name = 'changed'
})

it('owns source buffers at an untrusted structural boundary', () => {
  const input = Uint8Array.from([1, 2, 3]).buffer
  const owned = validateWorkcellProjectSnapshotV3(projectWithRobotSourceBytes(input))
  new Uint8Array(input)[0] = 9
  expect(new Uint8Array(owned.robot.sources[0]!.sourceBytes)[0]).toBe(1)
  expect(collectProjectSourceDescriptorsV3(owned)).toEqual([
    expect.objectContaining({ namespace: 'robot', ownerKey: expect.stringMatching(/^robot-source:/) }),
  ])
})

it('accepts exact object/string boundaries and rejects plus one without truncation', () => {
  expect(() => validateWorkcellProjectSnapshotV3(projectWithObjectCounts(256, 512)))
    .not.toThrow()
  expect(() => validateWorkcellProjectSnapshotV3(projectWithObjectCounts(257, 512)))
    .toThrow(/MAX_OBJECT_ASSETS/)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithObjectCounts(256, 513)))
    .toThrow(/MAX_OBJECT_INSTANCES/)
  expect(() => validateNameAndFile(utf8Bytes(128), utf8Bytes(255))).not.toThrow()
  expect(() => validateNameAndFile(multibyteUtf8Bytes(129), utf8Bytes(255))).toThrow(/128/)
  expect(() => validateNameAndFile(utf8Bytes(128), multibyteUtf8Bytes(256))).toThrow(/255/)
})

it('reconciles Mechanics and every affected Job in one owned candidate', () => {
  const previous = projectWithMovingJobsAndVelocity(180)
  const nextMechanics = mechanicsWithVelocity(90)
  const nextSimulation = reconcileSimulationForMechanicsChange(previous.simulation, nextMechanics)
  expect(nextSimulation.jobs[0]!.poses[0]!.durationMs)
    .toBe(previous.simulation.jobs[0]!.poses[0]!.durationMs * 2)
  expect(nextSimulation.jobs[0]!.revision).toBe(previous.simulation.jobs[0]!.revision + 1)
  expect(nextSimulation.jobs[1]).toBe(previous.simulation.jobs[1]) // no moving segment
  expect(() => validateWorkcellProjectSnapshotV3({
    ...previous,
    robot: { ...previous.robot, mechanics: nextMechanics },
    simulation: nextSimulation,
  })).not.toThrow()
})

it('atomically rejects Mechanics limits narrowed around saved Poses', () => {
  const previous = projectWithPoseAngle('J2', 80)
  const before = structuredClone(previous)
  const proposed = mechanicsWithJointLimits('J2', -60, 60)
  let failure: unknown
  try { reconcileSimulationForMechanicsChange(previous.simulation, proposed) }
  catch (error) { failure = error }
  expect(failure).toMatchObject({
    code: 'PROJECT_JOB_POSE_OUT_OF_LIMITS',
    totalCount: 1,
    details: [expect.objectContaining({ jobId: 'job-1', poseId: 'pose-1', jointId: 'J2' })],
  })
  expect(previous).toEqual(before)
})

it('rejects inconsistent primitive-derived fields and live numeric Status', () => {
  expect(() => validateWorkcellProjectSnapshotV3(projectWithWrongPrimitiveProxy())).toThrow(/proxy/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithWrongPrimitiveStatistics())).toThrow(/statistics/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithManualNumericStatus(Number.NaN))).toThrow(/finite/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithManualNumericStatus(Number.POSITIVE_INFINITY))).toThrow(/finite/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithLiveNumericStatus())).toThrow(/live|unknown/i)
})

it('requires one built-in record/state pair and exact content-addressed Robot source IDs', () => {
  expect(() => validateWorkcellProjectSnapshotV3(projectWithMissingBuiltInTransformState())).toThrow(/equipment/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithUnknownBuiltInCatalogId())).toThrow(/catalog/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithBuiltInGeometryMismatch())).toThrow(/geometry|catalog/i)
  expect(() => validateWorkcellProjectSnapshotV3(projectWithRobotSourceIdDifferentFromDigest())).toThrow(/sha256|digest/i)
})

it('accepts only the reserved legacy whole-source occurrence exception', () => {
  expect(() => validateWorkcellProjectSnapshotV3(projectWithSevenReservedLegacyOccurrences())).not.toThrow()
  expect(() => validateWorkcellProjectSnapshotV3(projectWithInvalidNegativeNodePath())).toThrow(/nodePath/i)
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/domain/project/project-v3.test.ts src/domain/project/project.test.ts`

Expected: FAIL because the v3 modules and current-version exports do not exist.

- [ ] **Step 3: Implement the exact v3 discriminated contracts**

```ts
export type ObjectAssetGeometryV3 = DeepReadonly<Pick<
  ObjectAssetRecordV2,
  'id' | 'name' | 'colliderCenter' | 'collisionHalfExtents' | 'collisionBoxes' | 'statistics'
>>

export type StepObjectAssetRecordV3 = ObjectAssetGeometryV3 & {
  readonly sourceKind: 'step'
  readonly sourceFileName: string
  readonly sourceBytes: ArrayBuffer
  readonly importScale: number
  readonly originMode: EquipmentOriginMode
}

export type BoxObjectAssetRecordV3 = ObjectAssetGeometryV3 & {
  readonly sourceKind: 'box'
  readonly dimensionsM: readonly [number, number, number]
  readonly color: `#${string}`
}

export type CylinderObjectAssetRecordV3 = ObjectAssetGeometryV3 & {
  readonly sourceKind: 'cylinder'
  readonly radiusM: number
  readonly heightM: number
  readonly axis: 'z'
  readonly radialSegments: 32
  readonly color: `#${string}`
}

export type ObjectAssetRecordV3 =
  | StepObjectAssetRecordV3
  | BoxObjectAssetRecordV3
  | CylinderObjectAssetRecordV3

export type ProjectPoseStepV3 = Readonly<
  Omit<ProjectPoseRecordV1, 'anglesDeg' | 'speedPercentToNext'> & {
    readonly anglesDeg: readonly [number, number, number, number, number, number]
    readonly speedPercentToNext: number
  }
>

export function deriveCanonicalPoseDurationMsV3(
  from: Readonly<Pick<ProjectPoseStepV3, 'anglesDeg' | 'speedPercentToNext'>>,
  to: Readonly<Pick<ProjectPoseStepV3, 'anglesDeg'>>,
  mechanics: Readonly<Pick<FixedSixAxisRobotMechanicsV3, 'joints'>>,
): number {
  if (!Number.isFinite(from.speedPercentToNext) || from.speedPercentToNext < 1 || from.speedPercentToNext > 100) {
    throw new Error('speedPercentToNext must be within [1, 100].')
  }
  const jointDurationsMs = from.anglesDeg.map((fromDeg, index) => {
    const toDeg = to.anglesDeg[index]!
    const maxVelocity = mechanics.joints[index]!.maxVelocityDegPerSec
    if (!Number.isFinite(fromDeg) || !Number.isFinite(toDeg) || !Number.isFinite(maxVelocity) || maxVelocity <= 0) {
      throw new Error('Pose angles must be finite and maximum velocity must be positive.')
    }
    return Math.abs(toDeg - fromDeg) / maxVelocity * 1000 * 100 / from.speedPercentToNext
  })
  return Math.max(16, ...jointDurationsMs)
}

export interface SimulationJobV1 {
  readonly id: string
  readonly name: string
  readonly revision: number
  readonly poses: readonly ProjectPoseStepV3[]
}

export interface ProjectSimulationStateV3 {
  readonly activeJobId: string | null
  readonly jobs: readonly SimulationJobV1[]
}

export type ObjectInstanceRecordV3 = Readonly<
  Omit<ObjectInstanceRecordV1, 'transform' | 'numericStatus'> & {
  readonly graspable: boolean
  readonly manualNumericStatus: number
  }
>

export interface ProjectBuiltInEquipmentRecordV3 {
  readonly id: string
  readonly name: string
  readonly kind: 'cup' | 'machine'
  readonly status: EquipmentStatus
  readonly manualNumericStatus: number
  readonly statusSource: EquipmentStatusSource
  readonly statusOverlayVisible: boolean
  readonly graspable: boolean
  readonly collisionHalfExtents: readonly [number, number, number]
  readonly collisionCenter?: readonly [number, number, number]
  readonly stackLightAnchor: readonly [number, number, number] | null
}

export const MAX_JOBS = 32
export const MAX_POSES_PER_JOB = 256
export const MAX_PROJECT_POSES = 2048
export const MIN_ROBOT_STEP_SOURCES = 1
export const MAX_ROBOT_STEP_SOURCES = 7

export interface FixedTwoCycleSmoothingPolicyV1 {
  readonly mode: 'two-cycle'
  readonly cycles: 2
}

export interface ProjectOpcUaNumericStatusBindingV3 {
  readonly entityId: ExternalEntityId
  readonly nodeId: string
  readonly scale: number
  readonly offset: number
}

export interface ProjectOpcUaEquipmentTransformBindingV3 {
  readonly entityId: ExternalEntityId
  readonly gatewayId: string
  readonly gatewayProfileId: string
  readonly gatewayProfileRevision: string
  readonly mode: 'absolute'
  readonly referenceFrameId: 'world' | 'mcp'
  readonly smoothing: FixedTwoCycleSmoothingPolicyV1
}
```

Implement `createPortableId(cryptoSource = globalThis.crypto)` once under
`src/lib/id`. If `randomUUID` is callable, return it. Otherwise require
`getRandomValues`, fill exactly 16 bytes, set byte 6 version bits to `0100` and
byte 8 variant bits to `10`, and format lowercase `8-4-4-4-12` hexadecimal. Bind
native methods to their source object, never call `Math.random`, and throw
`PORTABLE_ID_CRYPTO_UNAVAILABLE` before any caller mutation when neither path is
available. Generate 10,000 IDs with the real test-runtime crypto source and
assert uniqueness plus version/variant shape.

Define `ProjectRigidTransformV3`, `RobotStepSourceAssetV3`, `RobotAssemblyPartRefV3`, `RobotLinkGeometryRecordV3`, `ProjectRobotJointV3`, `FixedSixAxisRobotMechanicsV3`, `FixedSixAxisRobotManifestV1`, and `RobotMechanicsProvenanceV3` exactly as the approved G0 design in `robot-source-v3.ts`; downstream Robot Import consumes these names and must not redefine them. Override inherited V2 `frames` so MCP/TCP also use the rigid type. Require finite positions, normalized nonzero quaternions, and exact scale `[1, 1, 1]` for MCP/TCP/Flange/Tool0; reject non-unit scale rather than canonicalizing it. Require Robot source `id === sha256`, exact lowercase digest/bytes, and unique IDs. Ordinary node paths contain non-negative child ordinals. WS1 alone accepts and produces reserved legacy `[-1, linkOrdinal]` whole-source occurrences with the exact owner/name/full-mesh rules from G0; WS2 Robot Import may never emit them.

For Mechanics provenance, require non-empty Datasheet ID/revision; require a
non-empty Manifest filename plus lowercase 64-hex digest but do not invent or
persist raw Manifest bytes; and structurally require Manual `canonicalSha256` to
be lowercase 64-hex. Task 2 asynchronously recomputes the fixed-order normalized
Mechanics JSON digest on every untrusted staging/decode/commit path through the
shared `ProjectHashService`; the synchronous Task 1 validator does not implement
a second main-thread hash. Native/archive input containing a raw Manifest
field or `robot/mechanics/source-manifest.json` entry is rejected as unknown.

Define canonical IDs as ``equipment:${string}` | `object:${string}``. Make `ObjectAssetGeometryV3` deeply readonly and make `ObjectInstanceRecordV3` readonly across both inherited and new fields. The Instance omits the legacy transform/effective numeric value; its only durable transform is the matching canonical external-entity state and its only durable numeric value is finite `manualNumericStatus`. Apply the same finite fallback rule to built-ins and reject unsupported status/source/visibility values. Require one built-in configuration record plus one transform state per built-in, and one Instance plus one transform state per Object. Replace inherited `opcUa.equipment` with `opcUa.numericStatusBindings`; each binding uses canonical `entityId`, non-empty `nodeId`, finite `scale`/`offset`, and at most one target assignment. Accept both existing built-in and Object canonical IDs; reject legacy `instanceId`, duplicates, and orphans. Whenever numeric `statusSource` or `transformSource` is OPC UA, require exactly one matching binding of that kind; Manual source may retain a dormant binding. Require Job IDs unique among Jobs and Pose IDs unique across all Jobs; their namespaces may overlap. Require every Job revision to be a positive integer and every non-null `activeJobId` to reference exactly one Job. Validate every Pose angle against the corresponding Mechanics inclusive command-space limits with no clamp; report `PROJECT_JOB_POSE_OUT_OF_LIMITS` with total count and the first 64 stable Job/Pose/Joint details. Validate each non-terminal Pose `durationMs` against the exact G0 formula using the same six Mechanics maximum velocities and reject absolute error above `1e-9 ms`; canonicalization overwrites an accepted within-tolerance value with the exact derived result and requires terminal `durationMs === 1000`. Require unique Profile assignment, one through seven unique Robot source hashes, every Robot source referenced by at least one Link part, every Link to contain at least one source reference with at least one mesh index, no duplicate `(sourceAssetId, nodePath, meshIndex)` ownership across Links except distinct reserved legacy paths, valid Link source references, and complete `LINK00` through `LINK06` ownership.

Define `ProjectPoseStepV3`, `SimulationJobV1`, and the Job limit constants in `simulation-job-v1.ts`. Define the exact G0 duration formula, `validateSimulationPoseLimitsV3()`, and pure canonicalization/reconciliation helpers in `simulation-duration-v3.ts`. `canonicalizeSimulationDurationsV3()` validates/canonicalizes an already versioned snapshot without revision invention; `reconcileSimulationForMechanicsChange()` first rejects every Pose outside proposed Mechanics limits, then recomputes against those Mechanics, increments each duration-affected Job revision exactly once, and retains unaffected Job identity/revision. A limit violation returns no candidate. Explicitly re-export these public names from `project-v3.ts`. Downstream WS2/WS3 import them only from `src/domain/project/project-v3.ts`; neither may implement a post-commit duration repair subscription.

- [ ] **Step 4: Make validation closed and ownership-safe**

Reject unknown top-level and nested configuration keys so transient runtime fields cannot leak into archives. Implement the mapped tuple-preserving `DeepReadonly` contract from G0. Public standalone validation clones a source exactly once. The production pipeline first calls cheap `preflightWorkcellProjectShapeV3()`, then Task 2 staging makes the sole full source copy, and internal `validateStagedWorkcellProjectSnapshotV3()` adopts only registry-branded buffers without copying them again. `collectProjectSourceDescriptorsV3()` deterministically enumerates every Robot/STEP Object owner, namespace, supplied buffer, and declared Robot digest for staging without hashing. Task 4's active metadata-recipe path is distinct and never exposes source bytes. Normalize quaternions and reject a norm at or below `1e-9`. Validate exact Box/Cylinder derived centres, proxies, and statistics instead of trusting redundant fields. Enforce 256 Assets, 512 Instances, shared UTF-8 identifier/name/filename byte limits, and the other structural budgets here; runtime preparation separately enforces 1,024 actual visible Mesh/material render groups. Keep v1/v2 validators available only for decode/migration.

- [ ] **Step 5: Run GREEN and compatibility tests**

Run: `npm run test:run -- src/domain/project src/lib/id`

Expected: PASS for v1, v2, and v3 contracts; current-version callers compile against v3.

- [ ] **Step 6: Commit**

```powershell
git add src/domain/project src/lib/id
git diff --cached --check
git commit -m "feat: define workcell project v3 contracts"
```

---

### Task 2: Migrate V1 and V2 Deterministically to V3

**Files:**
- Create: `src/domain/project/project-v2-migration.ts`
- Create: `src/domain/project/project-v2-migration.test.ts`
- Modify: `src/domain/project/project-v1-migration.ts`
- Modify: `src/domain/project/project.ts`
- Test: `src/domain/project/project-v1-migration.test.ts`
- Create: `src/lib/hash/sha256.ts`
- Create: `src/lib/hash/sha256.test.ts`
- Create: `src/lib/hash/sha256-worker.ts`
- Create: `src/lib/hash/sha256-worker.test.ts`
- Create: `src/features/project/project-source-staging.ts`
- Create: `src/features/project/project-source-staging.test.ts`

**Interfaces:**
- Consumes: validated v1/v2 snapshots, Task 1 `collectProjectSourceDescriptorsV3()`, injected `ProjectHashService`, injected locked-parser legacy source analysis, and immutable built-in Equipment defaults.
- Produces: `createProjectHashService({ subtle?, workerFactory })`, cancellable `ProjectHashService.sha256(bytes, signal?)`, the separately injectable call-site adapters `ProjectSourceDigest` and `ProjectRevisionIdentityHasher`, async `verifyProjectCryptographicProvenanceV3()`, `ProjectSourceStagingService`, opaque `PreparedProjectSourceV1`, `PreparedProjectSourceGroupV1`, `stageProjectSourcesV3()`, plus `migrateProjectToV3(snapshot, dependencies): Promise<ProjectMigrationResultV3>` where the result contains one validated byte-free v3 projection, prepared source groups, and bounded migration warnings.

- [ ] **Step 1: Write migration RED tests**

```ts
it.each([
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
])('hashes %j identically with Web Crypto and the Worker fallback', async (source, digest) => {
  const bytes = new TextEncoder().encode(source)
  expect(await hashService({ subtle: crypto.subtle }).sha256(bytes)).toBe(digest)
  expect(await hashService({ subtle: undefined, workerFactory: incrementalWorker() }).sha256(bytes)).toBe(digest)
})

it('fails before mutation when trusted-LAN hashing has no Worker', async () => {
  await expect(hashService({ subtle: undefined, workerFactory: undefined }).sha256(bytes('abc')))
    .rejects.toMatchObject({ code: 'PROJECT_HASH_WORKER_UNAVAILABLE' })
  expect(projectMutationSpy).not.toHaveBeenCalled()
})

it('terminates a silent Worker at exactly 60 seconds and ignores its late acknowledgement', async () => {
  const worker = silentWorker()
  const pending = hashService({ subtle: undefined, workerFactory: () => worker }).sha256(bytes('abc'))
  await clock.tickAsync(59_999)
  expect(worker.terminated).toBe(false)
  await clock.tickAsync(1)
  await expect(pending).rejects.toMatchObject({ code: 'PROJECT_HASH_TIMEOUT' })
  expect(worker.terminated).toBe(true)
  worker.emitLateAck()
  expect(projectMutationSpy).not.toHaveBeenCalled()
})

it('rejects Robot bytes that do not match both declared digest fields', async () => {
  const bytes = new TextEncoder().encode('abc').buffer
  const wrongDigest = '0'.repeat(64)
  const owned = validateWorkcellProjectSnapshotV3(
    projectWithRobotSource({ id: wrongDigest, sha256: wrongDigest, sourceBytes: bytes }),
  )
  await expect(stageProjectSourcesV3(owned, sourceStagingService()))
    .rejects.toMatchObject({ code: 'PROJECT_SOURCE_DIGEST_MISMATCH' })
})

it('hashes a source once, leases/returns its bytes, and revokes it on discard', async () => {
  const staging = sourceStagingService({ sourceDigestSpy, sourceCopySpy })
  const prepared = await staging.stage('object', mutableBytes([1, 2, 3]))
  expect(sourceDigestSpy).toHaveBeenCalledTimes(1)
  expect(sourceCopySpy).toHaveBeenCalledTimes(1)
  await staging.leaseToWorker(prepared, echoWorkerReturningTransferredBytes())
  expect(sourceDigestSpy).toHaveBeenCalledTimes(1)
  expect(sourceCopySpy).toHaveBeenCalledTimes(1)
  const discarded = await staging.stage('object', mutableBytes([4, 5, 6]))
  staging.revoke(discarded)
  expect(() => staging.assertPrepared(discarded)).toThrow(/revoked/i)
})

it('owns every raw source and the configuration graph before the first await', async () => {
  const hash = deferredSequentialHasher()
  const input = projectWithTwoDistinctObjectSources({ name: 'Invocation Name' })
  const sourceBBefore = [...new Uint8Array(input.objectAssets[1]!.sourceBytes)]
  const pending = stageProjectSourcesV3(input, sourceStagingService({ hash: hash.fn }))
  await hash.firstSourceStarted()
  input.manifest.name = 'Mutated Name'
  new Uint8Array(input.objectAssets[1]!.sourceBytes).fill(255)
  hash.releaseAll()
  const result = await pending
  expect(result.projection.manifest.name).toBe('Invocation Name')
  expect(stagingRegistry.bytesFor(result.preparedSourceGroups[1]!.preparedSource))
    .toEqual(Uint8Array.from(sourceBBefore))
})

it('verifies Manual Mechanics provenance asynchronously through the shared hash service', async () => {
  const mechanics = normalizedManualMechanics()
  const canonicalSha256 = await projectHashService.sha256(canonicalMechanicsBytes(mechanics))
  await expect(verifyProjectCryptographicProvenanceV3(
    projectionWithManualMechanics(mechanics, canonicalSha256), projectHashService,
  )).resolves.toBeUndefined()
  await expect(verifyProjectCryptographicProvenanceV3(
    projectionWithManualMechanics(mechanics, '0'.repeat(64)), projectHashService,
  )).rejects.toMatchObject({ code: 'PROJECT_MANUAL_MECHANICS_DIGEST_MISMATCH' })
})

it('moves a non-empty flat Pose list into exactly one active Default Job', async () => {
  const source = validV2Project({ poses: [pose('A', 40), pose('B', 100)] })
  const migrated = await migrateProjectToV3(source, migrationDependencies())
  expect(migrated.projection.simulation).toMatchObject({
    activeJobId: 'job-default',
    jobs: [{
      id: 'job-default',
      name: 'Default Job',
      revision: 1,
      poses: [
        expect.objectContaining({ id: 'A', speedPercentToNext: 40 }),
        expect.objectContaining({ id: 'B', speedPercentToNext: 100, durationMs: 1000 }),
      ],
    }],
  })
  expect(migrated.projection.simulation.jobs[0]!.poses[0]!.durationMs).toBe(
    deriveCanonicalPoseDurationMsV3(
      migrated.projection.simulation.jobs[0]!.poses[0]!,
      migrated.projection.simulation.jobs[0]!.poses[1]!,
      migrated.projection.robot.mechanics,
    ),
  )
})

it('moves an empty flat Pose list into one empty active Default Job', async () => {
  const migrated = await migrateProjectToV3(validV2Project({ poses: [] }), migrationDependencies())
  expect(migrated.projection.simulation).toEqual({
    activeJobId: 'job-default',
    jobs: [{ id: 'job-default', name: 'Default Job', revision: 1, poses: [] }],
  })
})

it('rejects an out-of-limit legacy Pose without clamping or partial migration', async () => {
  await expect(migrateProjectToV3(
    v2WithPoseAngle('J3', LEGACY_MAX_J3_DEG + 1e-9),
    migrationDependencies(),
  )).rejects.toMatchObject({
    code: 'PROJECT_LEGACY_POSE_OUT_OF_LIMITS',
    totalCount: 1,
    details: [expect.objectContaining({ poseId: expect.any(String), jointId: 'J3' })],
  })
})

it('stores byte-identical legacy Link sources once and retains seven Link refs', async () => {
  const migrated = await migrateProjectToV3(v2WithSevenLinksSharingOneSource(), migrationDependencies())
  expect(migrated.projection.robot.sources).toHaveLength(1)
  expect(migrated.projection.robot.links).toHaveLength(7)
  expect(new Set(migrated.projection.robot.links.map((link) => link.sourceRefs[0]!.sourceAssetId))).toEqual(
    new Set([migrated.projection.robot.sources[0]!.id]),
  )
  expect(migrated.projection.robot.links.map((link) => link.sourceRefs[0]!.nodePath)).toEqual(
    LINK_IDS.map((_linkId, linkOrdinal) => [-1, linkOrdinal]),
  )
})

it('fills missing V2 mechanics, Tool0, and Manual status fallbacks deterministically', async () => {
  const migrated = await migrateProjectToV3(v2WithMissingPoseSpeedAndOpcUaStatus(), migrationDependencies())
  expect(migrated.projection.robot.mechanics.joints[0]).toMatchObject({
    homeDeg: 0, zeroOffsetDeg: 0, direction: 1,
  })
  expect(migrated.projection.robot.mechanics.tool0.quaternion).toEqual([
    0, 0.7071067811865476, 0, 0.7071067811865476,
  ])
  expect(migrated.projection.objectInstances[0]).toHaveProperty('manualNumericStatus')
  expect(migrated.projection).not.toHaveProperty('liveNumericStatus')
})

it('preserves the legacy implicit Tool0 zero-pose and TCP world matrices', async () => {
  const source = v2WithNontrivialJointAnglesAndTcp()
  const expectedZeroPose = evaluateLegacyV2LinkWorldMatrices(source, ZERO_JOINT_ANGLES)
  const expectedTcp = evaluateLegacyV2TcpWorldMatrix(source, source.robotJointAnglesDeg)
  const migrated = await migrateProjectToV3(source, migrationDependencies())
  expectMatricesClose(
    evaluateV3LinkWorldMatrices(migrated.projection, ZERO_JOINT_ANGLES),
    expectedZeroPose,
    1e-9,
  )
  expectMatrixClose(
    evaluateV3TcpWorldMatrix(migrated.projection, source.robotJointAnglesDeg),
    expectedTcp,
    1e-9,
  )
})

it.each(['mcp', 'tcp'] as const)(
  'rejects a non-rigid legacy %s frame without publishing a partial snapshot',
  async (field) => {
    await expect(migrateProjectToV3(v2WithFrameScale(field, [1, 2, 1]), migrationDependencies()))
      .rejects.toMatchObject({ code: 'PROJECT_LEGACY_FRAME_NON_RIGID' })
  },
)

it('fails an unknown legacy source unit without publishing a partial snapshot', async () => {
  await expect(migrateProjectToV3(v2WithUnknownUnit(), migrationDependencies())).rejects.toMatchObject({
    code: 'ROBOT_STEP_UNIT_REQUIRED',
  })
})

it('emits one mechanics-default warning for deterministic V2 defaults', async () => {
  const migrated = await migrateProjectToV3(v2WithLegacyMechanics(), migrationDependencies())
  expect(migrated.warnings.filter((warning) => warning === 'PROJECT_V2_MECHANICS_DEFAULTED'))
    .toHaveLength(1)
  expect(migrated.projection.robot.mechanics).toMatchObject(expectedDefaultedHomeOffsetDirectionFlangeTool0())
})

it('moves Object transforms to canonical state and defaults legacy graspable to false', async () => {
  const migrated = await migrateProjectToV3(v2WithObject('object-1'), migrationDependencies())
  expect(migrated.projection.objectInstances[0]).toMatchObject({ id: 'object-1', graspable: false })
  expect(migrated.projection.objectInstances[0]).not.toHaveProperty('transform')
  expect(migrated.projection.externalEntities).toContainEqual(
    expect.objectContaining({ entityId: 'object:object-1' }),
  )
})

it('canonicalizes V2 Object-only numeric Status binding targets without changing mapping values', async () => {
  const migrated = await migrateProjectToV3(v2WithNumericStatusBinding({
    instanceId: 'object-1', nodeId: 'ns=2;s=Object.Status', scale: 2, offset: -1,
  }), migrationDependencies())
  expect(migrated.projection.opcUa.numericStatusBindings).toEqual([{
    entityId: 'object:object-1', nodeId: 'ns=2;s=Object.Status', scale: 2, offset: -1,
  }])
  expect(migrated.projection.opcUa).not.toHaveProperty('equipment')
})

it('retains a bound legacy OPC numeric source and its durable Manual fallback', async () => {
  const migrated = await migrateProjectToV3(
    v2WithBoundOpcNumericSource({ instanceId: 'object-1', numericStatus: 7 }),
    migrationDependencies(),
  )
  expect(migrated.projection.objectInstances[0]).toMatchObject({
    id: 'object-1', statusSource: 'opcua', manualNumericStatus: 7,
  })
  expect(migrated.projection.opcUa.numericStatusBindings).toContainEqual(
    expect.objectContaining({ entityId: 'object:object-1' }),
  )
  expect(migrated.warnings.filter((warning) => warning === 'PROJECT_V2_STATUS_FALLBACK_ASSUMED'))
    .toHaveLength(1)
})

it('normalizes an unbound legacy OPC numeric source to Manual fallback', async () => {
  const migrated = await migrateProjectToV3(v2WithOpcNumericSourceButNoBinding(), migrationDependencies())
  expect(migrated.projection.objectInstances[0]).toMatchObject({
    statusSource: 'manual', manualNumericStatus: 7,
  })
  expect(migrated.warnings).toContain('PROJECT_V2_STATUS_FALLBACK_ASSUMED')
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/lib/hash/sha256.test.ts src/lib/hash/sha256-worker.test.ts src/domain/project/project-v2-migration.test.ts src/domain/project/project-v1-migration.test.ts`

Expected: FAIL because the HTTP-safe Worker SHA-256 service and v2-to-v3 migration do not exist.

- [ ] **Step 3: Implement one explicit migration entrypoint**

```ts
export interface PreparedProjectSourceGroupV1 {
  readonly ownerKeys: readonly (`robot-source:${string}` | `object-asset:${string}`)[]
  readonly preparedSource: PreparedProjectSourceV1
}

export interface ProjectV3MigrationDependencies {
  readonly sourceStaging: ProjectSourceStagingService
  readonly analyzeLegacyRobotSource: (
    source: PreparedProjectSourceV1,
  ) => Promise<{ detectedUnit: 'meter' | 'millimeter' | 'inch' | 'unknown'; meshIndices: readonly number[] }>
  readonly builtInEquipmentDefaults: readonly ProjectBuiltInEquipmentRecordV3[]
  readonly builtInEquipmentTransformDefaults: readonly ProjectExternalEntityTransformStateV3[]
}

export interface ProjectMigrationResultV3 {
  readonly projection: ByteFreeWorkcellProjectProjectionV3
  readonly preparedSourceGroups: readonly PreparedProjectSourceGroupV1[]
  readonly warnings: readonly string[]
}
```

Validate immutable built-in configuration and transform defaults as paired collections: every configuration ID resolves the catalog with the same fixed kind/Geometry, every transform entry has the matching `equipment:*` ID and finite MCP-local Manual transform, and neither collection has duplicates or orphans. Configuration and transform ownership remain separate types; never duplicate a transform on `ProjectBuiltInEquipmentRecordV3`.

Implement one `ProjectHashService` in `src/lib/hash`. Prefer injected/native `SubtleCrypto.digest` when available. When it is absent on a trusted-LAN HTTP origin, run the bundled incremental pure-TypeScript SHA-256 only in a dedicated Worker; the main thread must never execute a whole-source JavaScript hash loop. The Worker protocol is closed and ordered: `init(totalBytes)`, sequential `chunk(sequence, bytes)`, `final`, and `cancel`. Send fixed 4 MiB chunks with `postMessage(message, [chunkBuffer])`, wait for one acknowledgement before sending the next, validate sequence and cumulative length, and retain at most one transferred chunk in flight. Cancellation terminates the Worker and rejects within 250 ms. Every source hash has an exact 60,000 ms watchdog covering Worker acknowledgements and native digest completion; timeout terminates the Worker when present, rejects `PROJECT_HASH_TIMEOUT`, invalidates the operation generation, and ignores any late Worker/native completion. Worker construction/error/messageerror fails as `PROJECT_HASH_WORKER_UNAVAILABLE` or `PROJECT_HASH_WORKER_FAILED` before Project mutation. Both secure and Worker paths return lowercase 64-character hex and never mutate the caller's input bytes.

Export `createProjectSourceDigest(hashService)` and `createProjectRevisionIdentityHasher(hashService)` as distinct injected adapters even though both delegate to the same primitive. Source staging receives only the first; revision projection receives only the second. Tests can therefore prove zero source rehashes while still expecting one small canonical-projection hash per metadata revision.

Boundary tests cover 25, 50, 100, and 256 MiB inputs. Project-level verification hashes Robot/Object sources sequentially through one service job, never `Promise.all`, so at most one native digest or Worker and one 4 MiB transferable chunk are active across the entire import. A fake Worker proves exactly one chunk is in flight globally, less than 8 MiB auxiliary payload is retained, cancellation completes within 250 ms, malformed acknowledgements fail closed, and the UI heartbeat advances more than ten frames. A dedicated reference-Chromium fallback test hashes a multi-source 256 MiB Project within the existing 60,000 ms source watchdog while requestAnimationFrame continues; it is not replaced by a hardware-dependent unit-test timeout. If no Worker can be created, reject before any mutation rather than silently hashing on the main thread.

`ProjectSourceStagingService.stage()` synchronously owns a raw buffer, calls `ProjectHashService` exactly once, and registers the resulting bytes/digest behind an opaque branded token. The token itself exposes only token ID, namespace, digest, and byte length. A private registry supplies bytes to the archive/commit path and supports a transfer-and-return Worker lease for parsing; while leased, commit is forbidden. Worker success returns the same transferred buffer and reactivates the token, while Worker failure/cancel revokes it because no commit is allowed. For public raw snapshots, `stageProjectSourcesV3()` synchronously clones the complete non-binary graph and owns **all** source buffers before its first `await`; it then hashes that immutable invocation-time source set sequentially, rejects a Robot digest mismatch, and revokes every token from that operation on any failure. Private Worker/File-stream buffers already outside caller ownership may be adopted sequentially. Only matching stable-pointer finalization followed by active runtime/handle activation upgrades tokens to verified repository handles; a merely prepared or publishing Project never does. Cancel, wizard discard, failed import, compensation, or superseded generation revokes them and releases retained bytes.

Dispatch v1 through the existing owned v1-to-v2 migration, then run exactly one v2-to-v3 path. Stage every legacy source once before source-dependent migration, use the token SHA-256 as both digest and source ID, and pass the same token to locked-parser legacy analysis. Build reserved `[-1, linkOrdinal]` whole-source refs for legacy Links, preserve `localTransform` as `zeroPoseLocalization`, start `operatorAdjustment` at identity, and mark known units `legacy-detected`. After constructing and structurally validating the owned V3 result, return only its byte-free projection plus owner-to-token assignments; no result object exposes a source buffer. Commit validates/reuses the private registry bytes without another digest. A mismatch revokes all tokens and returns no partial migration result.

Map V2 Joint origin/axis/limits/velocity into `ProjectRobotJointV3`, default Home/offset/direction and the separate Flange/Tool0 transforms exactly as G0 specifies, preserve rigid `frames.mcp` and `frames.tcp`, then hash the normalized Mechanics block as Manual provenance through the same injected `ProjectHashService`. `verifyProjectCryptographicProvenanceV3()` canonicalizes that closed normalized block and asynchronously verifies every untrusted Manual provenance during migration, archive decode, and `prepareRevision()`; structural validation only checks digest shape. Require both legacy frame scales to equal `[1, 1, 1]`; reject any non-unit value as `PROJECT_LEGACY_FRAME_NON_RIGID` before returning a candidate, with no silent scale removal. FK uses `direction * commandAngleDeg + zeroOffsetDeg`; reject non-positive maximum velocity. After Mechanics exists, validate every legacy Pose angle against its inclusive command-space limits and fail as `PROJECT_LEGACY_POSE_OUT_OF_LIMITS` with total plus at most 64 stable details; never clamp. Only then normalize all legacy Pose durations with the exact G0 formula, force the terminal value to `1000`, and emit at most one `PROJECT_LEGACY_POSE_DURATION_NORMALIZED` warning when any legacy value differs by more than `1e-9 ms`.

- [ ] **Step 4: Migrate external entities, Jobs, primitives, and bindings without invention**

Create canonical Manual transform entries from every v2 Object Instance, remove transform/effective numeric value from the v3 Instance projection, rename the archived numeric value to `manualNumericStatus`, and set `graspable: false`. If legacy `statusSource` is OPC UA, retain that archived number only as Manual fallback and emit the bounded G0 warning; keep OPC UA source only when the matching V2 binding migrates, otherwise normalize source to Manual. Restore paired built-in configuration plus transform defaults from the immutable catalog and emit one bounded warning because v1/v2 archives did not contain them. Convert each v2 STEP Asset to `sourceKind: 'step'`. Create no Box/Cylinder Assets and no Equipment Transform bindings during migration. Replace each V2 `opcUa.equipment` binding with one V3 `numericStatusBindings` entry whose `entityId` is `object:${instanceId}` and whose `nodeId`, `scale`, and `offset` are unchanged; create no built-in numeric binding because the legacy schema could not represent one. Keep collision policy unchanged. Reject legacy input above `MAX_JOBS`, `MAX_POSES_PER_JOB`, or `MAX_PROJECT_POSES` rather than truncating it.

- [ ] **Step 5: Prove idempotence and deterministic failure**

Run the migration twice from independently cloned inputs and compare normalized v3 JSON byte-for-byte. Inject hash, parser, unit, reference, and budget failures and assert the input snapshots remain deeply equal to their pre-call copies.

Run: `npm run test:run -- src/lib/hash/sha256.test.ts src/lib/hash/sha256-worker.test.ts src/features/project/project-source-staging.test.ts src/domain/project`

Expected: PASS with deterministic warnings, exact flat-Pose preservation, source de-duplication, and no input mutation.

- [ ] **Step 6: Commit**

```powershell
git add src/domain/project src/lib/hash/sha256.ts src/lib/hash/sha256.test.ts src/lib/hash/sha256-worker.ts src/lib/hash/sha256-worker.test.ts src/features/project/project-source-staging.ts src/features/project/project-source-staging.test.ts
git diff --cached --check
git commit -m "feat: migrate legacy projects to schema v3"
```

---

### Task 3: Encode and Decode the Deterministic V3 Archive

**Files:**
- Modify: `src/features/project/project-codec.ts`
- Modify: `src/features/project/project-codec.test.ts`
- Create: `src/features/project/project-v3-archive.ts`
- Create: `src/features/project/project-v3-archive.test.ts`
- Create: `src/features/project/project-archive-worker.ts`
- Create: `src/features/project/project-archive-worker.test.ts`

**Interfaces:**
- Consumes: structurally validated v3 snapshots, Task 1 source descriptors, Task 2 `ProjectSourceStagingService`/prepared source tokens, and the Task 2 migration entrypoint.
- Produces: byte-free `ProjectDecodeResultV3 { projection, preparedSourceGroups, warnings }`, `ProjectArchiveCodecWorker`, cancellable streaming v1/v2/v3 decode to current v3, `ArchivedStepObjectAssetRecordV3`, `ArchivedObjectAssetRecordV3`, and deterministic v3-only streaming encode with content-addressed Robot and Object STEP entries.

- [ ] **Step 1: Write archive RED tests**

```ts
it('writes one Robot STEP entry for seven Links sharing one source', async () => {
  const entries = await inspectArchiveEntries(await encodeWorkcellProject(v3WithOneAssemblySource()))
  expect(Object.keys(entries).filter((path) => path.startsWith('robot/sources/') && path.endsWith('.step')))
    .toEqual([`robot/sources/${ASSEMBLY_SHA256}.step`])
})

it('stores Box and Cylinder definitions inline without fake STEP entries', async () => {
  const entries = await inspectArchiveEntries(await encodeWorkcellProject(v3WithThreeObjectKinds()))
  expect(Object.keys(entries).filter((path) => path.startsWith('objects/assets/') && path.endsWith('.step')))
    .toHaveLength(1)
  expect(JSON.parse(new TextDecoder().decode(entries['objects/assets.json']))).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sourceKind: 'box' }),
      expect.objectContaining({ sourceKind: 'cylinder' }),
    ]),
  )
})

it('shares one Object STEP blob between Assets with byte-identical sources', async () => {
  const entries = await inspectArchiveEntries(await encodeWorkcellProject(v3WithTwoStepAssetsSharingBytes()))
  expect(Object.keys(entries).filter((path) => path.startsWith('objects/assets/') && path.endsWith('.step')))
    .toEqual([`objects/assets/${OBJECT_SHA256}.step`])
  expect(JSON.parse(new TextDecoder().decode(entries['objects/assets.json'])))
    .toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'asset-a', sourceKind: 'step', sourceSha256: OBJECT_SHA256 }),
      expect.objectContaining({ id: 'asset-b', sourceKind: 'step', sourceSha256: OBJECT_SHA256 }),
    ]))
})

it('omits Workspace Mode and every live OPC UA field', async () => {
  const text = await inspectArchiveText(await encodeWorkcellProject(validV3Project()))
  expect(text).not.toMatch(/workspaceMode|lastGood|receiptTime|quality|trajectory|socketState/)
  expect(text).not.toMatch(/"(?:numericStatus|liveNumericStatus)"/)
})

it('round-trips canonical numeric and Transform bindings without legacy ownership', async () => {
  const decoded = await decodeWorkcellProject(await encodeWorkcellProject(v3WithBothBindingKinds()))
  expect(decoded.projection.opcUa.numericStatusBindings).toEqual([
    expect.objectContaining({ entityId: 'equipment:cup-01' }),
    expect.objectContaining({ entityId: 'object:instance-1' }),
  ])
  expect(decoded.projection.opcUa.equipmentTransforms).toHaveLength(1)
  expect(decoded.projection.opcUa).not.toHaveProperty('equipment')
  expect(decoded.preparedSourceGroups).toHaveLength(2)
  expect(decoded).not.toHaveProperty('snapshot')
  expect(JSON.stringify(decoded)).not.toContain('sourceBytes')
})

it('decodes each unique archive source with one digest and exposes no bytes', async () => {
  const decoded = await decodeWorkcellProject(maximumSourceFixture(), { sourceDigestSpy })
  expect(sourceDigestSpy).toHaveBeenCalledTimes(UNIQUE_ARCHIVE_SOURCE_COUNT)
  expect(JSON.stringify(decoded)).not.toContain('sourceBytes')
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/project/project-codec.test.ts src/features/project/project-v3-archive.test.ts`

Expected: FAIL because the codec supports only v1/v2 Link-per-file archives.

- [ ] **Step 3: Implement the fixed v3 layout**

```text
manifest.json
frames.json
robot/configuration.json
robot/sources/index.json
robot/sources/<sha256>.step
robot/links/index.json
objects/assets.json
objects/assets/<sha256>.step                # STEP source kind only
objects/instances.json
equipment/built-ins.json
external/entities.json
simulation/jobs.json
opcua/bindings.json
collision/policy.json
```

`robot/sources/index.json` stores Robot source records without `sourceBytes` and resolves each payload through the existing `sha256`. Raw Mechanics Manifest bytes are deliberately not Project-owned and no `robot/mechanics/source-manifest.json` entry exists; Manifest filename/digest are audit provenance only, while normalized Mechanics is authoritative. Define `ArchivedStepObjectAssetRecordV3 = Omit<StepObjectAssetRecordV3, 'sourceBytes'> & { readonly sourceSha256: string }` and `ArchivedObjectAssetRecordV3` as that branch plus the unchanged Box/Cylinder branches. `objects/assets.json` stores only this archive projection; it never embeds/base64-encodes STEP bytes. Decode resolves `sourceSha256` to the corresponding entry and then reconstructs the owned runtime record. `opcua/bindings.json` stores exactly the sorted `numericStatusBindings` and `equipmentTransforms` collections; it contains no legacy `equipment` array or live telemetry.

Sort every entry path and every unordered source, Link, Asset, Instance, built-in Equipment, external-entity, and Binding collection by stable ID before encoding. Preserve the stored Simulation Job array order and each Job's Pose array order exactly; these arrays are domain order, not sets. Keep the fixed ZIP timestamp. Verify that an archive path hash matches both the index hash and the exact entry bytes before staging. Each STEP Object Asset remains one semantic whole-source Asset, while byte-identical STEP Object Assets reference one shared `objects/assets/<sha256>.step` blob per unique content hash. Reject missing/unreferenced blobs, digest/byte mismatches, duplicate Asset IDs, and conflicting archive paths before staging.

The browser production path must not call `zipSync`, `unzipSync`, or materialize a complete archive with `File.arrayBuffer()` on the main thread. `ProjectArchiveCodecWorker` receives/returns fixed 4 MiB transferable chunks. Encode uses streaming ZIP entries and returns Blob parts so download does not require one additional contiguous archive copy. Decode streams the input File, validates path/header/encryption/ZIP64/count/compressed-size limits before expansion, expands one entry at a time, and transfers each completed source entry to `ProjectSourceStagingService`; JSON entries remain capped at 8 MiB. Retain at most one 50 MiB expansion entry plus 16 MiB streaming/central-directory workspace. Memory accounting names three non-overlapping categories: caller-owned input/output, the complete Project-owned staged-source payload set (already bounded by 256 MiB raw), and codec auxiliary workspace. Only the last category is the 64 MiB cap. The Worker has an exact 120,000 ms operation watchdog, cancellation terminates within 250 ms, and late messages are generation-inert. `error`, `messageerror`, malformed chunk order, or timeout revokes all tokens and releases output parts.

- [ ] **Step 4: Preserve bounded pre-expansion validation and version dispatch**

Keep safe-path, duplicate-path, encryption, ZIP64, entry-count, per-entry, expanded-size, and total-source limits. Decode the manifest first. Decode v1/v2 using their existing layouts, migrate to v3, then validate. Decode v3 directly. For every version, stage each reconstructed source exactly once and return only the byte-free projection plus the same opaque owner-token assignments; import passes them to `replacePreparedUntrusted()` without another hash. Any decode, validation, migration, cancel, or import failure revokes the complete operation token set. Reject unknown versions; never downgrade. Type tests and a production-source scan prove no `ProjectDecodeResultV3` or `ProjectMigrationResultV3` field exposes `sourceBytes`, `ArrayBuffer`, or a typed-array view.

Add fake-Worker and reference-Chromium max-boundary tests. At 300 MiB compressed/256 MiB raw the main-thread heartbeat advances more than ten frames, cancellation/timeout bounds hold, no more than one source entry is expanded at once, and measured auxiliary payload remains at or below 64 MiB. One byte/entry above any frozen cap rejects before active mutation. A production-source scan finds no main-thread `zipSync`/`unzipSync` call.

- [ ] **Step 5: Run deterministic round-trip GREEN tests**

Run: `npm run test:run -- src/features/project/project-codec.test.ts src/features/project/project-v3-archive.test.ts src/domain/project`

Expected: PASS; two encodes of the same owned snapshot are byte-identical, and decode/encode preserves semantic v3 state exactly.

- [ ] **Step 6: Commit**

```powershell
git add src/features/project/project-codec.ts src/features/project/project-codec.test.ts src/features/project/project-v3-archive.ts src/features/project/project-v3-archive.test.ts src/features/project/project-archive-worker.ts src/features/project/project-archive-worker.test.ts
git diff --cached --check
git commit -m "feat: encode project v3 archives"
```

---

### Task 4: Store and Publish Crash-Consistent Project Revisions

**Files:**
- Modify: `src/features/project/project-db.ts`
- Create: `src/features/project/project-db.test.ts`
- Create: `src/features/project/project-revision-repository.ts`
- Create: `src/features/project/project-revision-repository.test.ts`

**Interfaces:**
- Consumes: structurally validated v3 candidates, Task 2 prepared-source registry plus `ProjectRevisionIdentityHasher`, and Task 3 archive projections for deterministic byte-aware revision identity.
- Produces: `ProjectRevisionCandidateFactory`, `ProjectMutationService`, namespace-local `ProjectSourceBlobV1`, opaque `VerifiedProjectSourceHandleV1`, byte-free `StoredWorkcellProjectSnapshotProjectionV3`, immutable `PreparedProjectRevisionRecordV1` and `StoredProjectRevisionV1`, side-effect-free `prepareRevision()`, atomic `commitPreparedRevision()`, publication finalization/compensation, `createProjectRevisionIdentityProjectionV3()`, and hydration plus mark/sweep.

- [ ] **Step 1: Write revision/pointer RED tests**

```ts
it('atomically writes Blobs/revision and flips a publishing pointer', async () => {
  const revision = await repository.prepareRevision(await preparedCandidate(snapshotA()))
  await repository.commitPreparedRevision(null, revision, 'commit-a')
  expect(await repository.readPointer()).toEqual({
    key: 'active', state: 'publishing', revisionId: revision.storedRevision.revisionId,
    previousRevisionId: null, commitToken: 'commit-a',
  })
  expect((await repository.readActive())?.snapshot).toEqual(snapshotA())
  await repository.finalizePublication('commit-a')
  expect((await repository.readPointer())?.state).toBe('stable')
})

it('rejects a stale pointer writer without replacing the winner', async () => {
  const a = await repository.prepareRevision(await preparedCandidate(snapshotA()))
  const b = await repository.prepareRevision(await preparedCandidate(snapshotB()))
  await repository.commitPreparedRevision(null, a, 'commit-a')
  await repository.finalizePublication('commit-a')
  await expect(repository.commitPreparedRevision(null, b, 'commit-b')).rejects.toMatchObject({
    code: 'PROJECT_ACTIVE_REVISION_CHANGED',
  })
  expect((await repository.readActive())?.revisionId).toBe(a.storedRevision.revisionId)
  expect(await repository.readStoredRevisionProjection(b.storedRevision.revisionId)).toBeNull()
})

it('includes exact STEP source content in revision identity without serializing ArrayBuffer', async () => {
  const a = await repository.prepareRevision(await preparedCandidate(snapshotWithStepObjectBytes([1, 2, 3])))
  const different = await repository.prepareRevision(await preparedCandidate(snapshotWithStepObjectBytes([1, 2, 4])))
  const byteIdenticalCopy = await repository.prepareRevision(await preparedCandidate(snapshotWithStepObjectBytes([1, 2, 3])))
  expect(different.storedRevision.revisionId).not.toBe(a.storedRevision.revisionId)
  expect(byteIdenticalCopy.storedRevision.revisionId).toBe(a.storedRevision.revisionId)
})

it('stores source bytes once and writes no bytes or hashes for 100 metadata revisions', async () => {
  const first = await repository.prepareRevision(await preparedCandidate(maximumProjectBytes()))
  await repository.commitPreparedRevision(null, first, 'initial')
  await repository.finalizePublication('initial')
  const blobBytes = await repository.totalSourceBlobBytes()
  const publicClone = (await projectStore.readPublicSnapshot())!
  sourceDigestSpy.mockClear()
  revisionIdentityHashSpy.mockClear()
  blobPutSpy.mockClear()
  sourceCopySpy.mockClear()
  parserSpy.mockClear()
  geometryBuildSpy.mockClear()
  for (let index = 0; index < 100; index += 1) {
    await mutationService.replaceFromActive((current) => ({
      ...current,
      manifest: { ...current.manifest, name: `${publicClone.manifest.name} ${index}` },
    }))
  }
  expect(sourceDigestSpy).not.toHaveBeenCalled()
  expect(sourceCopySpy).not.toHaveBeenCalled()
  expect(parserSpy).not.toHaveBeenCalled()
  expect(geometryBuildSpy).not.toHaveBeenCalled()
  expect(revisionIdentityHashSpy).toHaveBeenCalledTimes(100)
  expect(blobPutSpy).not.toHaveBeenCalled()
  expect(await repository.totalSourceBlobBytes()).toBe(blobBytes)
  expect(await repository.revisionCount()).toBe(1)
})

it('keeps Robot and Object content addressing namespace-local', async () => {
  const prepared = await repository.prepareRevision(candidateUsingSameBytesAsRobotAndObject())
  expect(prepared.requiredBlobs.map((blob) => blob.key).sort()).toEqual([
    `object:${SAME_SHA256}`,
    `robot:${SAME_SHA256}`,
  ])
})

it('commits two Object owners from one prepared archive Blob', async () => {
  const decoded = await decodeWorkcellProject(archiveWithTwoAssetsSharingOneBlob(), {
    sourceDigestSpy,
  })
  const objectGroup = decoded.preparedSourceGroups.find(
    (group) => group.preparedSource.namespace === 'object',
  )!
  expect(objectGroup.ownerKeys).toEqual(['object-asset:asset-a', 'object-asset:asset-b'])
  await mutationService.replacePreparedUntrusted(decoded)
  expect(sourceDigestSpy).toHaveBeenCalledTimes(UNIQUE_ARCHIVE_SOURCE_COUNT)
  expect(blobPutSpy).toHaveBeenCalledTimes(UNIQUE_ARCHIVE_SOURCE_COUNT)
  expect(sourceHandleRegistry.ownersFor(`object:${objectGroup.preparedSource.sha256}`)).toEqual([
    'object-asset:asset-a', 'object-asset:asset-b',
  ])
  await mutationService.replaceFromActive(deleteAssetRecipe('asset-a'))
  expect(await repository.hasBlob(`object:${objectGroup.preparedSource.sha256}`)).toBe(true)
  await mutationService.replaceFromActive(deleteAssetRecipe('asset-b'))
  await repository.garbageCollect()
  expect(await repository.hasBlob(`object:${objectGroup.preparedSource.sha256}`)).toBe(false)
})

it('retains one canonical resident buffer and one parse for many same-digest owners', async () => {
  for (const ownerKey of manyDistinctObjectOwners(256)) {
    const token = await staging.stage('object', copyOfSameSmallFixture())
    await mutationService.replaceFromActive(addOwnerRecipe(ownerKey, token.sha256), [
      { ownerKeys: [ownerKey], preparedSource: token },
    ])
  }
  const key = `object:${SAME_SHA256}`
  expect(sourceDigestSpy).toHaveBeenCalledTimes(256) // one per independent raw ingress
  expect(await repository.blobCountFor(key)).toBe(1)
  expect(new Set(sourceHandleRegistry.internalBuffersFor(key))).toHaveLength(1)
  expect(parserSpy).toHaveBeenCalledTimes(1)
  expect(geometryBuildSpy).toHaveBeenCalledTimes(1)
})

it('clones a shared Blob once per public snapshot without aliasing stored bytes', async () => {
  await seedTwoSemanticAssetsSharingOneBlob()
  const first = (await repository.readActive())!.snapshot
  const firstA = stepBytes(first, 'asset-a')
  const firstB = stepBytes(first, 'asset-b')
  expect(firstA).toBe(firstB)
  new Uint8Array(firstA)[0] = 255
  const second = (await repository.readActive())!.snapshot
  expect(stepBytes(second, 'asset-a')).toBe(stepBytes(second, 'asset-b'))
  expect(stepBytes(second, 'asset-a')).not.toBe(firstA)
  expect(new Uint8Array(stepBytes(second, 'asset-a'))[0]).toBe(ORIGINAL_FIRST_BYTE)
})

it('changes revision identity for changed Robot bytes with matching updated declarations', async () => {
  const bytesA = Uint8Array.from([10, 20, 30]).buffer
  const bytesB = Uint8Array.from([10, 20, 31]).buffer
  const digestA = await hashService().sha256(bytesA)
  const digestB = await hashService().sha256(bytesB)
  const a = await repository.prepareRevision(await preparedCandidate(snapshotWithRobotSource({
    id: digestA, sha256: digestA, sourceBytes: bytesA,
  })))
  const b = await repository.prepareRevision(await preparedCandidate(snapshotWithRobotSource({
    id: digestB, sha256: digestB, sourceBytes: bytesB,
  })))
  expect(b.storedRevision.revisionId).not.toBe(a.storedRevision.revisionId)
})

it('isolates stored source buffers from caller and public-read mutations', async () => {
  const source = snapshotWithStepObjectBytes([1, 2, 3])
  const revision = await repository.prepareRevision(await preparedCandidate(source))
  await repository.commitPreparedRevision(null, revision, 'isolation')
  await repository.finalizePublication('isolation')
  const sourceAsset = source.objectAssets[0]!
  if (sourceAsset.sourceKind !== 'step') throw new Error('Expected STEP fixture.')
  new Uint8Array(sourceAsset.sourceBytes)[0] = 9
  const firstRead = (await repository.readActive())!
  const firstAsset = firstRead.snapshot.objectAssets[0]!
  if (firstAsset.sourceKind !== 'step') throw new Error('Expected STEP fixture.')
  expect(new Uint8Array(firstAsset.sourceBytes)[0]).toBe(1)
  new Uint8Array(firstAsset.sourceBytes)[0] = 8
  const secondRead = (await repository.readActive())!
  const secondAsset = secondRead.snapshot.objectAssets[0]!
  if (secondAsset.sourceKind !== 'step') throw new Error('Expected STEP fixture.')
  expect(new Uint8Array(secondAsset.sourceBytes)[0]).toBe(1)
  expect(secondRead.revisionId).toBe(revision.storedRevision.revisionId)
})

it('owns, hashes once, and carries a staged source through commit', async () => {
  const hash = deferredHasher()
  const source = snapshotWithStepObjectBytes([1, 2, 3])
  sourceCopySpy.mockClear()
  const staging = sourceStagingService({ hash: hash.fn, sourceDigestSpy, sourceCopySpy })
  const pending = staging.stage('object', source.objectAssets[0]!.sourceBytes)
  const sourceAsset = source.objectAssets[0]!
  if (sourceAsset.sourceKind !== 'step') throw new Error('Expected STEP fixture.')
  new Uint8Array(sourceAsset.sourceBytes)[0] = 9
  hash.release()
  const sourceToken = await pending
  await mutationService.replaceFromActive(addStepAssetRecipe(sourceToken.sha256), [
    { ownerKeys: ['object-asset:asset-1'], preparedSource: sourceToken },
  ])
  const stored = await repository.readActive()
  const storedAsset = stored!.snapshot.objectAssets[0]!
  if (storedAsset.sourceKind !== 'step') throw new Error('Expected STEP fixture.')
  expect([...new Uint8Array(storedAsset.sourceBytes)]).toEqual([1, 2, 3])
  expect(sourceDigestSpy).toHaveBeenCalledTimes(1)
  expect(sourceCopySpy).toHaveBeenCalledTimes(1)
})

it('promotes staged tokens only after stable finalization', async () => {
  const token = await staging.stage('object', goodBytes())
  const pending = commitHarness({ pauseBeforeFinalize }).replaceFromActive(
    addStepAssetRecipe(token.sha256),
    [{ ownerKeys: ['object-asset:asset-1'], preparedSource: token }],
  )
  await pauseBeforeFinalize.reached()
  expect(sourceHandleRegistry.hasOwner('object-asset:asset-1')).toBe(false)
  expect(staging.isPrepared(token)).toBe(true)
  pauseBeforeFinalize.release()
  await pending
  expect(staging.isPrepared(token)).toBe(false)
  expect(sourceHandleRegistry.hasOwner('object-asset:asset-1')).toBe(true)
})

it('sweeps orphan revisions and source blobs after a crash or successful publication', async () => {
  await seedActiveRevisionAAndOrphanRevisionB()
  await repository.garbageCollect()
  expect(await repository.readRevision(REVISION_A)).not.toBeNull()
  expect(await repository.readStoredRevisionProjection(REVISION_B)).toBeNull()
  expect(await repository.sourceBlobKeys()).toEqual(sourceKeysReachableFrom(REVISION_A))
})

it('serializes cross-tab commit against pointer-derived mark and sweep', async () => {
  const gc = repositoryAWithHooks({ afterPointerRead: gcBarrier.pause }).garbageCollect()
  await gcBarrier.reached()
  const commitB = repositoryB.commitPreparedRevision(REVISION_A, PREPARED_B, 'commit-b')
  gcBarrier.release()
  await Promise.all([gc, commitB])
  expect(await repositoryB.readStoredRevisionProjection(REVISION_B)).not.toBeNull()
  expect(await repositoryB.sourceBlobKeys()).toEqual(expect.arrayContaining(SOURCE_KEYS_B))
})

it('treats concurrent finalization of the same token and target as idempotent', async () => {
  await repositoryA.commitPreparedRevision(REVISION_A, PREPARED_B, 'commit-b')
  await Promise.all([
    repositoryA.finalizePublication('commit-b'),
    repositoryB.finalizePublication('commit-b'),
  ])
  expect(await repositoryA.readPointer()).toMatchObject({
    state: 'stable', revisionId: REVISION_B, commitToken: 'commit-b',
  })
  await expect(repositoryB.compensatePublication('commit-b')).rejects.toMatchObject({
    code: 'PROJECT_PUBLICATION_ALREADY_FINALIZED',
  })
})

it('repairs an unverified corrupt same-key Blob from newly staged owned bytes', async () => {
  await seedBlobRow({ key: `object:${GOOD_SHA}`, sha256: GOOD_SHA, sourceBytes: corruptBytes() })
  const prepared = await preparedCandidate(snapshotWithObjectSource(goodBytes()))
  await repository.commitPreparedRevision(null, prepared, 'repair')
  await repository.finalizePublication('repair')
  expect(await reopenRepository().then((next) => next.readActive())).toMatchObject({
    snapshot: expect.objectContaining(expectedGoodObjectSource()),
  })
})

it.each(['missing', 'corrupt'] as const)(
  'repairs a %s Blob for an equal immutable revision without rewriting that revision',
  async (fault) => {
    const original = await seedEqualRevisionWithBlobFault(fault)
    const prepared = await preparedCandidate(snapshotForEqualRevision())
    await repository.commitPreparedRevision(original.revisionId, prepared, 'equal-repair')
    await repository.finalizePublication('equal-repair')
    expect(await repository.readStoredRevisionProjection(original.revisionId)).toEqual(original.projection)
    expect((await repository.readRevisionRow(original.revisionId))!.createdAt).toBe(original.createdAt)
    expect(await reopenRepository().then((next) => next.readActive())).toMatchObject({
      revisionId: original.revisionId,
      snapshot: expect.objectContaining(expectedGoodSources()),
    })
  },
)

it('fails quota preflight and IndexedDB QuotaExceededError before active mutation', async () => {
  await expect(commitWithInsufficientEstimatedStorage()).rejects.toMatchObject({
    code: 'PROJECT_STORAGE_QUOTA_INSUFFICIENT',
  })
  await expect(commitWithQuotaExceededDuringBlobTransaction()).rejects.toMatchObject({
    code: 'PROJECT_STORAGE_QUOTA_INSUFFICIENT',
  })
  expect(await authoritativeIds()).toEqual(OLD_REVISION_IDS)
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/project/project-db.test.ts src/features/project/project-revision-repository.test.ts`

Expected: FAIL because the DB contains only one mutable `projects.active` row.

- [ ] **Step 3: Add the Dexie revision schema without deleting the legacy table**

```ts
export interface StoredProjectRevisionV1 {
  readonly revisionId: string
  readonly projectId: string
  readonly createdAt: string
  readonly snapshot: StoredWorkcellProjectSnapshotProjectionV3
}

export type ProjectSourceNamespaceV1 = 'robot' | 'object'
export type ProjectSourceBlobKeyV1 = `${ProjectSourceNamespaceV1}:${string}`

export interface ProjectSourceBlobV1 {
  readonly key: ProjectSourceBlobKeyV1
  readonly namespace: ProjectSourceNamespaceV1
  readonly sha256: string
  readonly sourceBytes: ArrayBuffer
  readonly byteLength: number
}

export type StoredWorkcellProjectSnapshotProjectionV3 = ByteFreeWorkcellProjectProjectionV3

export type ProjectSourceOwnerKeyV1 = `robot-source:${string}` | `object-asset:${string}`
declare const verifiedProjectSourceBrand: unique symbol
export interface VerifiedProjectSourceHandleV1 {
  readonly [verifiedProjectSourceBrand]: true
  readonly ownerKey: ProjectSourceOwnerKeyV1
  readonly blobKey: ProjectSourceBlobKeyV1
  readonly sha256: string
  readonly byteLength: number
}

export type ProjectCandidateSourceClaimV1 =
  | { readonly kind: 'verified-ref'; readonly handle: VerifiedProjectSourceHandleV1 }
  | {
      readonly kind: 'prepared-source'
      readonly ownerKeys: readonly ProjectSourceOwnerKeyV1[]
      readonly preparedSource: PreparedProjectSourceV1
    }

export interface ProjectRevisionCandidateV1 {
  readonly snapshot: WorkcellProjectSnapshotV3
  readonly sourceClaims: readonly ProjectCandidateSourceClaimV1[]
}

export interface ProjectRevisionCandidateFactory {
  fromActive(
    active: ActiveProjectRevisionContextV1,
    nextProjection: StoredWorkcellProjectSnapshotProjectionV3,
    sourceChanges: readonly PreparedProjectSourceGroupV1[],
  ): ProjectRevisionCandidateV1
  fromPreparedUntrusted(
    projection: ByteFreeWorkcellProjectProjectionV3,
    sourceChanges: readonly PreparedProjectSourceGroupV1[],
  ): ProjectRevisionCandidateV1
}

export type ActiveProjectMutationRecipeV1 = (
  current: StoredWorkcellProjectSnapshotProjectionV3,
) => StoredWorkcellProjectSnapshotProjectionV3

export interface ProjectMutationService {
  replaceFromActive(
    recipe: ActiveProjectMutationRecipeV1,
    sourceChanges?: readonly PreparedProjectSourceGroupV1[],
  ): Promise<void>
  replaceUntrusted(snapshot: WorkcellProjectSnapshotV3): Promise<void>
  replacePreparedUntrusted(result: ProjectDecodeResultV3 | ProjectMigrationResultV3): Promise<void>
}

export interface PreparedProjectRevisionRecordV1 {
  readonly runtimeSnapshot: WorkcellProjectSnapshotV3
  readonly storedRevision: StoredProjectRevisionV1
  readonly requiredBlobs: readonly ProjectSourceBlobV1[]
  readonly retainedSourceHandles: readonly VerifiedProjectSourceHandleV1[]
  readonly pendingSourceUpgrades: readonly PreparedProjectSourceGroupV1[]
}

export interface ProjectRevisionRepository {
  prepareRevision(candidate: ProjectRevisionCandidateV1): Promise<PreparedProjectRevisionRecordV1>
  commitPreparedRevision(
    expectedRevisionId: string | null,
    revision: PreparedProjectRevisionRecordV1,
    commitToken: string,
  ): Promise<void>
  finalizePublication(commitToken: string): Promise<void>
  compensatePublication(commitToken: string): Promise<void>
  readRevision(revisionId: string): Promise<HydratedProjectRevisionV1 | null>
  garbageCollect(): Promise<void>
}

export type StoredProjectPointerV1 =
  | {
      readonly key: 'active'
      readonly state: 'stable'
      readonly revisionId: string
      readonly commitToken: string
    }
  | {
      readonly key: 'active'
      readonly state: 'publishing'
      readonly revisionId: string
      readonly previousRevisionId: string | null
      readonly previousCommitToken: string | null
      readonly commitToken: string
    }

```

Add `projectRevisions` keyed by `revisionId` and indexed by `projectId`, `projectSourceBlobs` keyed by `key`, and `projectPointers` keyed by `key`. Retain the existing `projects` table only until Task 5 removes the current browser-store authority; Task 4 does not read, migrate, normalize, or delete its rows. A revision row intentionally has no mutable parent pointer and contains no source `ArrayBuffer`: Robot source projections omit `sourceBytes` while retaining `id === sha256`; STEP Object projections replace `sourceBytes` with `sourceSha256`; primitive branches are unchanged. Raw Mechanics Manifest bytes are not stored. Content addressing is deliberately namespace-local, so equal bytes create one `robot:<sha256>` Blob and one `object:<sha256>` Blob when used in both roles, but only one Blob within either namespace.

Every pointer in this schema has a required commit token. Tokenless or unknown
pointer shapes fail closed; no legacy pointer normalization API is exposed.

`PreparedProjectRevisionRecordV1` is a frozen repository-bound WeakMap capability, not a serializable command record. Copied, forged, foreign-repository, revoked, or replayed facades fail before DB access. Any public summaries on the facade are informational only; commit, activation, and rollback use the repository-owned private state. New staged groups are captured as a closed data-only graph, attested once, and atomically moved through the exact canonical staging service's repository-only port (`active -> publication-leased -> consumed|revoked`). No public staging method, raw-buffer adopter, generic consume callback, or publication-lease type is exposed. Stable pointer finalization alone mints no verified handle: activation rechecks the exact stable revision and commit token inside the pointer/revision transaction and synchronously performs an all-or-none canonical resident/handle registry swap before the no-throw ownership commit.

`VerifiedProjectSourceHandleV1` is a non-serializable, unforgeable runtime token minted only after successful stable publication or hydrating and re-verifying a committed Blob. The repository registers it in a private WeakSet/WeakMap against owner, namespace, digest, byte length, and one canonical repository-owned resident buffer per namespace/digest Blob key. All handles for that key share the canonical buffer. Promoting a newly staged owner for an already verified digest discards the duplicate staged bytes and binds the owner to the canonical buffer; digest/config-derived parse and Geometry caches are shared too. A public hydration/read clones each unique Blob key at most once per returned snapshot, shares that caller-owned clone among same-key records in that snapshot, and never aliases the canonical buffer or a later read. `PreparedProjectSourceV1` has a separate private staging registry and is the only accepted new-source claim. `ActiveProjectRevisionContextV1` is internal to the Project store and never returned by a public selector. The public `replaceFromActive()` callback receives only a frozen byte-free projection, never handles or internal buffers. The service preserves verified sources by unchanged owner key and accepts added/replaced sources only as exact prepared-token groups. Every source owner appears in exactly one group; one token may cover multiple distinct owners only when they share its namespace/digest, such as two semantic Object Assets backed by one archive Blob. Reusing a token across groups, a missing/duplicate owner, or a stray/revoked/leased token fails before preparation. `replaceUntrusted()` stages every unique raw Blob once internally; migration/archive decode call `replacePreparedUntrusted()` with their existing groups. `ProjectRevisionCandidateFactory` is private infrastructure. Downstream WS2-WS5 consume `ProjectMutationService` and never construct claims/handles. `prepareRevision()` performs no source hashing: it validates registered handles/tokens, obtains the already owned staged bytes, retains existing handles separately, and records new groups only as `pendingSourceUpgrades`. After matching pointer finalization, the staging service consumes each pending token once and mints one active verified handle per owner against the shared committed Blob key; no handle exists for that source before then. Any validation/stale-commit/publication-compensation/cancel/discard path revokes pending tokens once. Finalization/activation failure enters recovery and reload hydration mints handles from committed Blobs. A metadata-only recipe therefore copies, hashes, and writes zero source bytes even when displayed values originated from a public cloned read.

Generate lowercase `revisionId` as SHA-256 of UTF-8 `projectId + "\n" + canonicalJson(storedProjection)`. The projection keeps every normalized configuration field, recursively sorts object keys and unordered collections, preserves Job/Pose domain order, and contains only verified digest references. Never call `JSON.stringify()` on an `ArrayBuffer`. `commitPreparedRevision(expected, prepared, token)` accepts only a prepared record and, in one Dexie transaction spanning Blobs, revisions, and pointers, verifies the expected stable pointer, inserts required Blobs plus the byte-free revision row, then writes a `publishing` pointer containing new/previous revision IDs and the unique token. An existing Blob is reused without a write only when its key is registered as digest-verified in this hydration session. Otherwise the transaction replaces that same-key row from the newly staged, verified owned bytes and exact namespace/digest/length; this repairs a corrupt stale row instead of publishing an unreopenable revision. It performs no source hashing or caller-buffer reads. Before that transaction, calculate the additional unique Blob bytes plus bounded revision overhead and use `navigator.storage.estimate()` when available; known insufficient headroom or an IndexedDB `QuotaExceededError` maps to `PROJECT_STORAGE_QUOTA_INSUFFICIENT` without changing the pointer/runtime. Estimate success is not treated as a guarantee. A second tab that observes `publishing` rejects mutation as `PROJECT_PUBLICATION_IN_PROGRESS`; no unpointed DB revision exists for concurrent GC to sweep.

`readRevision()` resolves every byte-free reference, rejects missing/cross-namespace/mismatched-length Blobs, recomputes each unique referenced Blob digest through `ProjectHashService` once per hydration, then returns an owned hydrated snapshot plus fresh verified handles. Internal hydration interns one canonical resident buffer per Blob key. Every public snapshot/archive read receives one clone per unique key, shared only within that returned snapshot, never the repository-owned buffer. Identical configuration plus byte-identical sources may reuse an immutable revision; changed bytes produce a different revision ID even when filenames and metadata are unchanged. When `commitPreparedRevision()` finds an existing `revisionId`, it treats the revision row as idempotent only if `projectId` and the complete byte-free projection are exactly equal, retains its original `createdAt`, and never rewrites that immutable row. Required Blob rows are still independently verified/reused or repaired from the current owned staged bytes under the preceding rule before the pointer may publish; a missing/corrupt Blob is not excused by an equal revision ID. Any revision identity collision/mismatch fails closed without `put`-overwriting the immutable row.

- [ ] **Step 4: Implement compare-and-swap and recovery transactions**

`finalizePublication(token)` atomically changes only the matching publishing pointer to stable and retains that token on the stable pointer. If another tab already finalized the same token/target, finalization is an idempotent success; a stable different token/target fails closed. `compensatePublication(token)` restores the exact retained `(previousRevisionId, previousCommitToken)` pair only while the matching pointer is still publishing; an initial publication deletes the pointer. It never rolls back an already stable target, and a late `finalizePublication(newToken)` after compensation fails closed instead of finalizing the restored previous revision. `garbageCollect()` opens one Dexie read-write transaction spanning pointer, revision, and Blob tables; inside that same transaction it rereads the pointer, derives the stable/publishing mark set, removes every other revision, then removes every Blob unreachable from the retained projections. This transaction boundary serializes against a second-tab `commitPreparedRevision()` so GC cannot mark A, interleave commit B, and sweep B. Run it after finalization and at startup. Cleanup-retry IDs for in-memory Three.js disposal do not pin DB revisions or Blobs. A cleanup failure never rolls back a commit: emit one bounded diagnostic and retry idempotently.

Legacy adoption, tokenless-pointer normalization, cleanup-eligibility capabilities, and deletion of existing feature-store rows are explicitly out of scope until the user requests them again. The new repository must ignore those rows and never treat them as a fallback authority.

- [ ] **Step 5: Run GREEN, reopen, and concurrency tests**

Run: `npm run test:run -- src/features/project/project-db.test.ts src/features/project/project-revision-repository.test.ts`

Expected: PASS for reopen persistence, byte-free immutable rows, namespace-local Blob de-duplication, stale-writer rejection, durable token replay rejection, startup orphan cleanup, exact quota mapping, newly verified Robot/Object byte identity, zero rehash/rewrite on metadata edits, bounded revision retention, tuple ownership, and input/public-read buffer isolation.

- [ ] **Step 6: Commit**

```powershell
git add src/features/project/project-db.ts src/features/project/project-db.test.ts src/features/project/project-revision-repository.ts src/features/project/project-revision-repository.test.ts
git diff --cached --check
git commit -m "feat: store immutable project revisions"
```

---

#### Part B: Publish One Prebuilt Runtime Bundle

**Files:**
- Create: `src/features/project/project-runtime-bundle.ts`
- Create: `src/features/project/project-commit-coordinator.ts`
- Create: `src/features/project/project-commit-coordinator.test.ts`
- Modify: `src/features/project/project-store.ts`
- Modify: `src/features/project/project-store.test.ts`
- Modify: `src/features/project/browser-project-runtime.ts`
- Modify: `src/features/project/browser-project-runtime.test.ts`

**Interfaces:**
- Consumes: the Task 4 Part A repository-prepared runtime snapshot, verified source handles/new-source digest results, and a browser runtime that can prepare all derived assets without mutating active state.
- Produces: `PreparedProjectCommit`, `ActiveProjectRuntimeBundle`, `ProjectCommitCoordinator`, a serialized mutation gate, bounded cleanup diagnostics/retry queue, and store status `recovery-required`.

- [ ] **Step 1: Write phase-fault RED tests**

```ts
it.each([
  'validate', 'verify-cryptographic-provenance', 'prepare-robot', 'prepare-object',
  'reconcile-mechanics-jobs', 'reconcile-cache', 'commit-prepared', 'publish-runtime',
])('keeps one complete revision when %s fails', async (phase) => {
  const harness = commitHarness({ failAt: phase })
  await expect(harness.replace(snapshotB())).rejects.toBeDefined()
  expect(await harness.authoritativeIds()).toEqual({
    pointer: 'revision-a', cache: 'revision-a', runtime: 'revision-a',
  })
  expect(harness.interactionEnabled()).toBe(true)
})

it('enters recovery-required when pointer compensation fails', async () => {
  const harness = commitHarness({ failAt: 'publish-runtime', failCompensation: true })
  await expect(harness.replace(snapshotB())).rejects.toBeDefined()
  expect(harness.status()).toBe('recovery-required')
  expect(harness.interactionEnabled()).toBe(false)
  expect(harness.reloadRequested()).toBe(true)
})

it('keeps the new publishing revision blocked for startup recovery when finalization fails', async () => {
  const harness = commitHarness({ failAt: 'finalize-publication' })
  await expect(harness.replace(snapshotB())).rejects.toBeDefined()
  expect(await harness.authoritativeIds()).toEqual({
    pointer: 'revision-b:publishing', cache: 'revision-b', runtime: 'revision-b',
  })
  expect(harness.status()).toBe('recovery-required')
  expect(harness.interactionEnabled()).toBe(false)
  expect(harness.reloadRequested()).toBe(true)
})

it.each(['after-commit-before-publish', 'after-publish-before-finalize', 'during-finalize'])(
  'resolves a crash at %s without leaving publishing stuck',
  async (crashPoint) => {
    const reopened = await reopenCommitHarness(crashPoint)
    expect(await reopened.resolvePublishingPointer()).toMatchObject({ state: 'stable' })
    expect(await reopened.authoritativeIds()).toEqual(ALL_NEW_REVISION_IDS)
  },
)

it('keeps the committed new revision when old-runtime disposal fails', async () => {
  const harness = commitHarness({ failAt: 'dispose-old' })
  await expect(harness.replace(snapshotB())).resolves.toBeUndefined()
  expect(await harness.authoritativeIds()).toEqual({
    pointer: 'revision-b', cache: 'revision-b', runtime: 'revision-b',
  })
  expect(harness.interactionEnabled()).toBe(true)
  expect(harness.cleanupDiagnostics()).toEqual([
    expect.objectContaining({ code: 'PROJECT_OLD_RUNTIME_DISPOSE_FAILED', revisionId: 'revision-a' }),
  ])
  expect(harness.pendingCleanupRevisionIds()).toEqual(['revision-a'])
})

it('keeps inactive Object Assets lazy and enforces actual visible preparation budgets', async () => {
  const inactive = projectWithInactiveObjectAssets(256)
  await runtime.prepare(inactive, 'revision-inactive')
  expect(objectParserSpy).not.toHaveBeenCalled()
  expect(objectGeometryBuildSpy).not.toHaveBeenCalled()

  await expect(runtime.prepare(projectWithActualVisibleRenderGroups(1024), 'revision-at-limit'))
    .resolves.toBeDefined()
  await expect(runtime.prepare(projectWithActualVisibleRenderGroups(1025), 'revision-over-limit'))
    .rejects.toMatchObject({ code: 'PROJECT_VISIBLE_RENDER_ITEMS_EXCEEDED' })
  await expect(runtime.prepare(projectWithActualVisibleTriangles(1_500_001), 'revision-over-triangles'))
    .rejects.toMatchObject({ code: 'PROJECT_VISIBLE_TRIANGLES_EXCEEDED' })
  expect(runtime.activeRevisionId()).toBe('revision-a')
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/project/project-commit-coordinator.test.ts src/features/project/project-store.test.ts src/features/project/browser-project-runtime.test.ts`

Expected: FAIL because the current store mutates runtime before writing one mutable DB row and uses best-effort reconstruction.

- [ ] **Step 3: Define preparation and publication as separate operations**

```ts
export interface PreparedProjectCommit<RuntimeBundle> {
  readonly revision: PreparedProjectRevisionRecordV1
  readonly runtimeBundle: RuntimeBundle
  readonly cacheRevisionId: string
}

export interface ProjectRuntimeV3<RuntimeBundle> {
  prepare(snapshot: WorkcellProjectSnapshotV3, revisionId: string): Promise<RuntimeBundle>
  publish(bundle: RuntimeBundle): void
  activeRevisionId(): string | null
  dispose(bundle: RuntimeBundle): void
}

export interface ProjectCommitCoordinator {
  replace(candidate: ProjectRevisionCandidateV1): Promise<void>
}
```

The coordinator first obtains `PreparedProjectRevisionRecordV1` from the side-effect-free repository `prepareRevision()`, then passes `runtimeSnapshot` and `storedRevision.revisionId` to `prepare()`. `prepareRevision()` performs no STEP source hashing: it validates prepared/verified token registrations and asynchronously verifies small canonical cryptographic claims such as Manual Mechanics provenance through `ProjectHashService`; ordinary metadata-only edits preserve verified internal handles and perform zero source copies/source-digest calls. `prepare()` reuses Geometry by source digest plus Geometry-affecting configuration, not by whole Project revision. It eagerly prepares the Robot and only Object Assets referenced by visible Instances; inactive/uninstantiated Assets remain byte-verified lazy records. Before publication it checks declared statistics and actual parser totals, 1,500,000 rendered triangles, and 1,024 actual Three.js Mesh/material render groups. It builds selector-ready records without mutating active stores or ProjectDB, and bundle associations carry the new revision. `publish()` replaces exactly one `ActiveProjectRuntimeBundle` pointer synchronously. Scene, collision, selection, and interaction adapters read the bundle revision and ignore callbacks captured from an older generation.

Any candidate that changes `robot.mechanics` must first call `reconcileSimulationForMechanicsChange()` and include the returned Simulation state in that same candidate. The coordinator never publishes a Robot revision whose Jobs were derived from older Mechanics, and no runtime subscriber repairs durations after commit.

- [ ] **Step 4: Implement the ordered commit and compensation protocol**

Acquire one Project mutation lock and disable interaction. In exact order: create the internal candidate while preserving verified handles; call side-effect-free `prepareRevision()` so structural validation plus registered handle/prepared-token validation precedes the first write and no source is rehashed; prepare the runtime bundle and derived caches keyed by source digest plus geometry-affecting configuration; reconcile/write those non-authoritative revision-tagged associations; allocate one commit token; call `commitPreparedRevision(expected, prepared, token)` so missing/repaired Blobs, byte-free revision, expected-pointer check, and the `publishing` pointer land atomically; synchronously publish the prepared runtime bundle; call `finalizePublication(token)` to make the pointer stable; consume each `pendingSourceUpgrade` exactly once, bind every owner to its canonical resident buffer, and mint/activate its verified handle; only then make observers eligible, release the lock, and notify them; dispose the old bundle; then mark/sweep unreferenced caches, revision rows, and namespace-local source Blobs. Preparation, pointer publication, runtime publication, and stable finalization alone mint no handle.

If validation, a stale commit, or runtime publication fails, revoke every pending source token; after a publishing-pointer failure call `compensatePublication(token)` and republish the retained old bundle before unlocking. If compensation fails, enter `recovery-required`. If finalization or in-memory token consumption/handle activation fails after the new runtime publishes, do not expose observers, editing, or playback and do not roll back only one surface: keep the new publishing/stable pointer, cache, and runtime together as applicable, retain the lock under `recovery-required`, revoke only still-staged tokens, and request reload. Startup seeing `state: 'publishing'` integrity-hydrates and prepares the new revision; if successful it publishes that revision, atomically finalizes the matching token, and mints/activates verified handles from hydrated Blobs. Compensation is allowed only while that pointer is still publishing. Startup seeing a stable revision with missing in-memory handles integrity-hydrates that same revision and mints/activates its handles; it never compensates a stable pointer. If publishing-state integrity/preparation fails and `previousRevisionId` exists, it atomically compensates and rebuilds the previous revision; if no previous revision exists, compensation fails, or stable-revision activation fails, it remains `recovery-required`. Crash tests cover after atomic commit/before publish, after publish/before finalize, during finalization, and after finalization/before handle activation, and no publishing pointer remains indefinitely.

The prior revision remains DB-retained only while the pointer is `publishing`. After stable finalization it is eligible for mark/sweep regardless of an old in-memory Three.js disposal retry. If old-bundle disposal fails, keep the committed new pointer/cache/runtime, resolve the commit successfully, emit `PROJECT_OLD_RUNTIME_DISPOSE_FAILED`, queue only the in-memory resource cleanup token, and still run DB revision/Blob GC independently. A DB cleanup failure emits its own bounded diagnostic and retry without rolling back the committed Workcell.

- [ ] **Step 5: Make late work inert**

Increment one Project generation on every New, Import, delete, and replacement request. Guard Worker completion, cache writes, Manual transform Apply, Robot import Apply, OPC UA frame reduction, Job mutation, collision validation completion, and disposal callbacks with that generation. A stale callback returns without DB, cache, store, selection, collision, or Three.js mutation.

- [ ] **Step 6: Run GREEN and fake-crash recovery tests**

Run: `npm run test:run -- src/features/project`

Expected: PASS for every phase fault, stale callback, compare-and-swap race, compensation, process-reopen recovery, and resource disposal assertion.

- [ ] **Step 7: Commit**

```powershell
git add src/features/project
git diff --cached --check
git commit -m "feat: publish crash-consistent project revisions"
```

---

### Task 5: Bridge Current Browser Stores to the V3 Authority

**Files:**
- Create: `src/features/project/legacy-pose-job-adapter.ts`
- Create: `src/features/project/legacy-pose-job-adapter.test.ts`
- Create: `src/features/project/legacy-durable-command-adapter.ts`
- Create: `src/features/project/legacy-durable-command-adapter.test.ts`
- Create: `src/features/project/manual-transform-preview-overlay.ts`
- Create: `src/features/project/manual-transform-preview-overlay.test.ts`
- Modify: `src/features/project/browser-project-runtime.ts`
- Modify: `src/features/project/browser-project-runtime.test.ts`
- Modify: `src/features/project/project-store-browser.ts`
- Modify: `src/features/import/ImportStepDialog.tsx`
- Test: `src/features/import/ImportStepDialog.test.tsx`
- Modify: `src/features/equipment/equipment-store.ts`
- Test: `src/features/equipment/equipment-store.test.ts`
- Create: `src/features/equipment/status-overlay-selection.ts`
- Create: `src/features/equipment/status-overlay-selection.test.ts`
- Create: `src/features/equipment/status-overlay-scheduler.ts`
- Create: `src/features/equipment/status-overlay-scheduler.test.ts`
- Modify: `src/features/equipment/EquipmentScene.tsx`
- Test: `src/features/equipment/EquipmentStatusOverlay.test.tsx`
- Modify: `src/features/objects/object-asset-store.ts`
- Test: `src/features/objects/object-asset-store.test.ts`
- Modify: `src/features/robot/robot-geometry-store.ts`
- Test: `src/features/robot/robot-geometry-store.test.ts`
- Modify: `src/features/frames/coordinate-frame-store.ts`
- Test: `src/features/frames/coordinate-frame-store.test.ts`
- Modify: `src/features/joints/robot-store.ts`
- Test: `src/features/joints/robot-store.test.ts`
- Modify: `src/features/collision/collision-store.ts`
- Test: `src/features/collision/collision-store.test.ts`

**Interfaces:**
- Consumes: Task 4 runtime bundle, Task 1 `createPortableId()`, and current feature-store records.
- Produces: one-time legacy capture plus a `LegacyDurableCommandAdapter` that routes every still-mounted durable control through `ProjectMutationService`; all current feature stores become published-bundle projections while later workstreams replace their compatibility views.

- [ ] **Step 1: Write bridge RED tests**

```ts
it('captures current keyframes as one Default Job without deleting local state', async () => {
  seedCurrentKeyframes([pose('A', 25), pose('B', 100)])
  const snapshot = await browserProjectRuntime.capture(activeV2AsV3())
  expect(snapshot.simulation.jobs[0]).toMatchObject({
    id: 'job-default', name: 'Default Job', revision: 1,
    poses: [expect.objectContaining({ name: 'A' }), expect.objectContaining({ name: 'B' })],
  })
})

it('captures built-in Equipment and Object transforms through canonical IDs', async () => {
  const snapshot = await browserProjectRuntime.capture(validV3Project())
  expect(snapshot.builtInEquipment).toContainEqual(
    expect.objectContaining({ id: 'cup-01', manualNumericStatus: 7 }),
  )
  expect(snapshot.externalEntities.map(({ entityId }) => entityId)).toEqual(
    expect.arrayContaining(['equipment:cup-01', 'object:object-01']),
  )
  expect(JSON.stringify(snapshot)).not.toMatch(/"(?:numericStatus|liveNumericStatus)"/)
})

it('captures normalized Mechanics, Tool0, required Pose speed, and reserved legacy refs', async () => {
  const snapshot = await browserProjectRuntime.capture(activeV2AsV3())
  expect(snapshot.robot.mechanics).toMatchObject({
    joints: expect.arrayContaining([
      expect.objectContaining({ homeDeg: expect.any(Number), zeroOffsetDeg: 0, direction: 1 }),
    ]),
    flange: IDENTITY_TRANSFORM,
    tool0: LEGACY_TOOL0_TRANSFORM,
  })
  expect(snapshot.simulation.jobs[0]!.poses.every((pose) => pose.speedPercentToNext !== undefined)).toBe(true)
  expect(snapshot.robot.links.map((link) => link.sourceRefs[0]!.nodePath))
    .toEqual([[-1, 0], [-1, 1], [-1, 2], [-1, 3], [-1, 4], [-1, 5], [-1, 6]])
  expect(snapshot.robot.sources.every((source) => source.id === source.sha256)).toBe(true)
})

it('creates Projects and imported STEP Object IDs without randomUUID', async () => {
  const cryptoSource = getRandomValuesOnlyCrypto()
  const idFactory = () => createPortableId(cryptoSource)
  const project = await browserProjectRuntime.createNew({ idFactory })
  const imported = await importWholeStepObject(stepFile(), { idFactory })
  expect(project.manifest.projectId).toMatch(UUID_V4_PATTERN)
  expect(imported.asset.id).toMatch(/^asset-[0-9a-f-]{36}$/)
  expect(imported.instance.id).toMatch(/^imported-[0-9a-f-]{36}$/)
  expect(new Set([project.manifest.projectId, imported.asset.id, imported.instance.id]).size).toBe(3)
})

it('routes every mounted legacy durable command through one async Project recipe', async () => {
  for (const command of [
    applyObjectManualTransform(), applyObjectManualNumericStatus(), applyObjectStatusSource(),
    applyObjectOverlayVisibility(), applyBuiltInManualTransform(), applyBuiltInManualStatus(),
    applyBuiltInStatusSource(), applyBuiltInOverlayVisibility(), applyBuiltInGraspable(),
    applyMcpFrame(), applyTcpFrame(), applyCollisionPolicy(), applyCollisionIgnorePair(),
    deleteObject(), deleteBuiltInEquipment(),
  ]) {
    const pending = legacyDurableCommands.execute(command)
    expect(projectedFeatureStores()).toEqual(OLD_PUBLISHED_READ_MODELS)
    await pending
    expect(mutationService.replaceFromActive).toHaveBeenCalledTimes(1)
    expect(projectedFeatureStores()).toEqual(readModelsFromActiveBundle())
    vi.clearAllMocks()
  }
})

it('stages whole-STEP Object import once and commits Asset, Instance, and transform atomically', async () => {
  const pending = legacyDurableCommands.importWholeStepObject(stepFile())
  expect(projectedObjectStore()).toEqual(OLD_OBJECT_READ_MODEL)
  await pending
  expect(sourceDigestSpy).toHaveBeenCalledTimes(1)
  expect(sourceCopySpy).toHaveBeenCalledTimes(1)
  expect(mutationService.replaceFromActive).toHaveBeenCalledTimes(1)
  expect(activeProjection()).toMatchObject({
    objectAssets: [expect.anything()], objectInstances: [expect.anything()],
    externalEntities: [expect.objectContaining({ entityId: expect.stringMatching(/^object:/) })],
  })
})

it('keeps stores on the published bundle while a durable command is pending or rejected', async () => {
  const before = semanticPublishedState()
  const command = legacyDurableCommands.execute(applyMcpFrame(), { failAt: 'prepare-runtime' })
  expect(semanticPublishedState()).toEqual(before)
  await expect(command).rejects.toBeDefined()
  expect(semanticPublishedState()).toEqual(before)
})

it('renders Manual transform preview outside the published bundle', async () => {
  const before = semanticPublishedState()
  manualTransformPreview.begin('object:object-1', DRAFT_POSE, activeRevisionId())
  expect(semanticPublishedState()).toEqual(before)
  expect(scenePose('object:object-1')).toEqual(DRAFT_POSE)
  expect(projectRevisionId()).toBe(before.revisionId)
  await expect(manualTransformPreview.apply({ failAt: 'prepare-runtime' })).rejects.toBeDefined()
  expect(manualTransformPreview.draft()).toEqual(DRAFT_POSE)
  manualTransformPreview.discard()
  expect(scenePose('object:object-1')).toEqual(COMMITTED_POSE)
  manualTransformPreview.begin('object:object-1', DRAFT_POSE, activeRevisionId())
  publishReplacementProject()
  expect(manualTransformPreview.draft()).toBeNull()
})

it('mounts at most 128 deterministically ranked status overlays', () => {
  const candidates = statusOverlayCandidates(512, { allRequested: true })
  const selected = selectVisibleStatusOverlays(candidates, camera(), 'object:selected')
  expect(selected).toHaveLength(MAX_VISIBLE_STATUS_OVERLAYS)
  expect(selected[0]!.entityId).toBe('object:selected')
  expect(selected.slice(1)).toEqual(inFrustumDistanceThenCanonicalId(candidates))
  expect(mountedStatusOverlayRoots()).toHaveLength(128)
  expect(screen.getByText('128 of 512 overlays shown')).toBeVisible()
})

it('culls off-frustum selection and coalesces overlay invalidations to one RAF', () => {
  const scheduler = createStatusOverlayScheduler({ requestAnimationFrame: fakeRaf })
  selectEntity('object:off-frustum')
  for (let index = 0; index < 100; index += 1) {
    scheduler.invalidate(index % 2 === 0 ? 'camera' : 'transform')
    scheduler.invalidate('selection')
    scheduler.invalidate('visibility')
    scheduler.invalidate('overlay-request')
  }
  expect(selectVisibleStatusOverlays).not.toHaveBeenCalled()
  fakeRaf.flushOne()
  expect(selectVisibleStatusOverlays).toHaveBeenCalledTimes(1)
  expect(mountedEntityIds()).not.toContain('object:off-frustum')
  expect(persistedOverlayRequests()).toEqual(ORIGINAL_OVERLAY_REQUESTS)
  scheduler.invalidate('camera')
  fakeRaf.flushOne()
  expect(selectVisibleStatusOverlays).toHaveBeenCalledTimes(2)
})

it('saves an active V3 Project without hydrated capture or source work', async () => {
  await projectStore.saveActiveV3()
  expect(browserProjectRuntime.capture).not.toHaveBeenCalled()
  expect(sourceDigestSpy).not.toHaveBeenCalled()
  expect(sourceCopySpy).not.toHaveBeenCalled()
  expect(blobPutSpy).not.toHaveBeenCalled()
  expect(parserSpy).not.toHaveBeenCalled()
  expect(geometryBuildSpy).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/project/browser-project-runtime.test.ts src/features/project/legacy-pose-job-adapter.test.ts src/features/import/ImportStepDialog.test.tsx src/features/equipment src/features/objects src/features/robot src/features/frames src/features/joints src/features/collision`

Expected: FAIL because current stores expose v2 Link/Asset/flat-Pose records and built-in Equipment is outside the Project snapshot.

- [ ] **Step 3: Implement one-time capture and authoritative compatibility commands**

Reserve hydrated `capture()` for one-time V1/V2/no-active-Project bootstrap only. It captures current Robot Geometry as de-duplicated v3 sources whose IDs equal their SHA-256 digest and uses the reserved WS1-only `[-1, linkOrdinal]` whole-source Link refs; captures current keyframes as the Default Job with required outgoing speed; normalizes six-Joint Mechanics including Home/offset/direction plus separate Flange and Tool0; and captures current Object/built-in transforms, Manual numeric fallbacks, fixed frames, and collision policy. After that bootstrap, normal V3 Save reads/exports the active byte-free revision and never captures a hydrated snapshot or recommits feature stores.

Implement `LegacyDurableCommandAdapter` as the sole command boundary for every existing mounted whole-STEP Object import; Object/built-in Manual transform, Manual numeric fallback, status source, overlay visibility, and grasp configuration; MCP/TCP fixed-frame edit; durable collision policy/ignore-pair action; and canonical Object/built-in delete. Each action is async and builds one byte-free `replaceFromActive()` recipe; whole-STEP import first stages its raw source once and atomically adds Asset, Instance, and canonical transform in the same call. Delete atomically removes the applicable configuration/Instance, transform and both Binding kinds, selection/interaction/grasp ownership, collision registry/ignore references, and unreferenced Object Asset; built-in deletion follows the frozen catalog policy and cannot leave an orphan. Feature Zustand stores expose only projections from the published bundle and cannot publish a command-side draft. Pending disables repeat submit; pre-publication rejection preserves all old read models; post-publication recovery follows Task 4's locked terminal matrix. WS2 later owns Robot replacement, WS3 Job/Pose commands, and WS4 generalized Object/Primitive edit/delete without restoring direct store authority. Replace all four current direct `crypto.randomUUID()` calls in `browser-project-runtime.ts` and `ImportStepDialog.tsx` with injected/default `createPortableId()` calls, preserving existing prefixes. Do not write dormant OPC UA Transform bindings or Primitive runtime Geometry into legacy stores. Keep unimplemented v3 configuration in the authoritative projection so compatibility commands cannot erase it.

At the mounted UI boundary, validate UTF-8 bytes before expensive work or mutation. Component tests use multibyte input to prove Project name and whole-STEP Object Asset/Instance names accept 128 bytes and reject 129 with the field error focused, and STEP `File.name` accepts 255 bytes but rejects 256 before `arrayBuffer()`, staging, hash, parse, or ID allocation. Domain validation remains the final authority; the UI performs no truncation.

Implement `selectVisibleStatusOverlays()` as a pure runtime projection over persisted overlay requests. Exclude hidden/out-of-frustum candidates, reserve the first slot only when the selected entity is itself visible and in-frustum, then stable-sort remaining in-frustum candidates by camera distance and canonical entity ID. Route camera, transform, selection, visibility, and overlay-request invalidations through `StatusOverlayScheduler`: it keeps at most one pending `requestAnimationFrame`, recomputes/ranks at most once in that frame from the latest state, schedules at most one more frame for later invalidation, and cancels pending work on unmount. `EquipmentScene` mounts only the first `MAX_VISIBLE_STATUS_OVERLAYS = 128` `<Html>` roots and reports the mounted/requested count; neither selector nor scheduler mutates `statusOverlayVisible`, numeric runtime state, or Project configuration, rejects the Project, or erases culled configuration.

Move current Object/built-in Manual transform preview into
`ManualTransformPreviewOverlay`: transient `{ entityId, generation,
baseRevisionId, draft }` state composed by scene/Inspector selectors after the
published read model, never written into a feature store or Project. Apply calls
the durable adapter and clears only after publication; rejection retains the
draft/error for retry. Discard clears it and restores the committed Pose. Project
publication/replacement, entity delete, generation mismatch, or OPC UA ownership
change clears a stale overlay before it can affect the new scene. WS6's dirty-
editor registry reads this overlay for Apply/Discard/Stay without becoming a
second transform authority.

- [ ] **Step 4: Associate published caches without revision-only rebuilds**

Robot Geometry, Object Geometry, built-in Equipment cache, and converted asset repositories expose the bundle revision association used by selectors, but parse/Geometry cache identity is source digest plus Geometry-affecting configuration. A metadata-only Project revision re-associates the existing cache without source parse/build. Restore lazily prepares only visible Object Assets; a later show/create command prepares and budget-checks missing Geometry before its atomic publication. Publication swaps only maps associated with the prepared bundle revision.

- [ ] **Step 5: Verify no current workflow regresses**

Run: `npm run test:run -- src/features/project src/features/import src/features/equipment src/features/objects src/features/robot src/features/frames src/features/joints src/features/collision src/app`

Expected: PASS for current Robot, normalized Mechanics/Flange/Tool0, Object import, Manual transform, required Pose ordering/speed, paired built-in configuration/state, Manual numeric Status fallback without live-value persistence, grasp, collision, frame, New/Save/Export/Import, and rollback workflows.

- [ ] **Step 6: Commit**

```powershell
git add src/features/project src/features/import/ImportStepDialog.tsx src/features/import/ImportStepDialog.test.tsx src/features/equipment src/features/objects src/features/robot src/features/frames src/features/joints src/features/collision
git diff --cached --check
git commit -m "feat: bridge browser runtime to project v3"
```

---

### Task 6: Prove V3 Round-Trip, Recovery, and Documentation

**Files:**
- Create: `tests/project-v3-roundtrip.spec.ts`
- Create: `tests/nonsecure-origin-core.spec.ts`
- Create: `tests/project-resource-performance.spec.ts`
- Create: `playwright.insecure.config.ts`
- Modify: `tests/project-roundtrip.spec.ts`
- Modify: `vite.config.ts`
- Modify: `package.json`
- Create: `docs/developer/project-v3-format.md`
- Modify: `docs/progress/2026-07-13-project-status.md`
- Modify: `docs/progress/2026-07-13-short-term-mvp-implementation.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the completed v3 domain, codec, revision repository, commit coordinator, and browser bridge.
- Produces: browser evidence including a non-secure trusted-LAN-origin lane and quantitative reference-Chromium resource lane, operator/developer format guidance, and an authoritative plan-status ledger.

- [ ] **Step 1: Write the browser acceptance before final verification**

The test must create or migrate one v2 Project containing a non-default Robot name and Base XYZRPY, all six edited Joint origins/axes/limits/maximum velocities plus V3 Home/zero-offset/direction, all seven edited Link geometry-local transforms, seven Robot Links, separate edited Flange and Tool0, two ordered Poses with required speed, one imported Object, paired built-in Equipment configuration and transform states, edited MCP/TCP, Manual numeric Status fallbacks, one legacy Object numeric Status Binding, and non-default collision policy; save it as v3; export; clear browser storage; import; and assert every named Robot/Mechanics/Geometry/configuration field plus the canonicalized `object:*` binding and remaining snapshot is semantically equal. It must also use a programmatically generated v3 archive containing one Box and one Cylinder definition, two semantic STEP Object Assets sharing identical bytes, canonical numeric Status Bindings for one built-in and one Object, plus an inactive OPC UA Transform Binding and prove they survive decode/export without transient telemetry.

- [ ] **Step 2: Add deterministic archive and recovery assertions**

Assert Robot source `id === sha256`, exact declared digest-to-byte verification, reserved legacy Link refs exactly `[-1, linkOrdinal]`, one STEP entry per unique Robot source hash, one Object STEP entry per unique content hash, no primitive STEP entries, no raw Mechanics Manifest entry, exact provenance validation, exact primitive derived fields with mismatches rejected, one `Default Job`, exact required Pose order/speed/easing, exact six-Joint Mechanics plus separate Flange/Tool0/TCP, exact collision Boxes/policy, exact paired built-in records/canonical Manual fallback transforms, exact `manualNumericStatus` fallback, canonical numeric/Transform binding collections, null effective live telemetry, and null Workspace Mode. Force a failed digest verification or staging parse and assert the visible revision, DB pointer, and cache revision remain unchanged. Also assert same metadata/different Robot or Object STEP bytes produce different revision IDs while byte-identical content produces the same ID; mutating input/read buffers changes neither stored bytes nor subsequent exports.

- [ ] **Step 3: Add the non-secure-origin browser acceptance**

Create a dedicated Playwright config whose Chromium launch arguments map
`webdt.test` to `127.0.0.1`, whose preview server listens on `0.0.0.0`, and whose
base URL is `http://webdt.test:4174`. Permit only that test hostname in Vite
preview configuration. The test first asserts `isSecureContext === false`,
`typeof crypto.randomUUID === 'undefined'`, and
`typeof crypto.getRandomValues === 'function'`; then it creates a Project and
imports one redistributable STEP Object through the already implemented baseline
workflow. Collect the new Project and Asset/Instance IDs and assert non-empty
uniqueness. Add `test:e2e:insecure` to `package.json`; do not weaken browser
security flags or mark the origin secure. Job/Pose and Primitive creation are
not WS1 dependencies: WS3/WS4 add getRandomValues-only component coverage and
WS6 adds the final full-workflow insecure-origin spec after those features land.

- [ ] **Step 4: Document the exact v3 format and recovery contract**

Document every archive path, `step | box | cylinder` source union, units, ZYX Quaternion convention, fixed two-cycle smoothing configuration versus transient trajectory, canonical entity IDs, Job ownership and limits, migration warnings, revision/pointer phases, recovery-required state, resource limits, and downgrade rejection. Mark completed, superseded, and future plans using the disposition table in this plan.

Add `test:perf:reference` for production-preview Chromium at 1440x900 and fixed
`deviceScaleFactor: 1` on each separately declared controlled Windows and Linux
reference machine. The fixture has exactly 1,024 visible Mesh/material render
groups, no more than 1,500,000 rendered triangles, 512 Instances requesting
status overlays, and exactly 128 mounted status-overlay DOM roots. Overlay
selection is deterministic: the selected entity first, then in-frustum nearest
camera distance, then canonical entity ID as the stable tie-breaker; configured
but culled overlays remain persisted and the UI reports `128 of 512 overlays shown`.
After
a 5 s warm-up, script a 10 s camera orbit and require p95 animation-frame interval
`<= 33.4 ms`, zero main-thread Long Tasks above 200 ms, zero
`webglcontextlost`, and peak Chromium `JSHeapUsedSize <= 768 MiB`. Record browser,
OS, CPU, RAM, DPR, and WebGL renderer with the metrics. The gate also proves
1,025 groups reject before publication and a 129th requested mounted overlay is
culled rather than creating another DOM root. A separate DPR2 functional smoke
exercises WebGL rendering, overlay selection, and context-loss recovery without
reusing the DPR1 p95 threshold. This is a bounded regression reference, not a
Mac/Safari compatibility claim.

- [ ] **Step 5: Run the complete WS1 gate**

```powershell
npm run lint
npm run test:run
npm run test:middleware
npm run cad:validate
npm run build
npm run test:perf:reference
npm run test:e2e -- tests/project-roundtrip.spec.ts tests/project-v3-roundtrip.spec.ts tests/geometry-collision.spec.ts
npm run test:e2e:insecure -- tests/nonsecure-origin-core.spec.ts
npm run deploy:validate
npm run deploy:build
npm run deploy:smoke
npm run deploy:smoke:opcua
npm audit --audit-level=high
git diff --check
```

Expected: zero lint errors; all unit/middleware tests pass; seven CAD Links with `0 errors, 0 warnings`; production build passes; all serialized browser workflows and the getRandomValues-only non-secure-origin workflow pass without a flaky-timeout waiver; both deployment smokes clean up; zero high-severity audit findings; no whitespace errors.

- [ ] **Step 6: Request independent review and resolve every actionable finding**

Use `superpowers:requesting-code-review`. Re-run the focused test for each correction, then rerun the complete WS1 gate. Do not authorize downstream feature work until the reviewer confirms the quantitative success criteria below.

- [ ] **Step 7: Commit evidence and documentation**

```powershell
git add tests/project-v3-roundtrip.spec.ts tests/project-roundtrip.spec.ts tests/nonsecure-origin-core.spec.ts tests/project-resource-performance.spec.ts playwright.insecure.config.ts vite.config.ts package.json docs/developer/project-v3-format.md docs/progress README.md
git diff --cached --check
git commit -m "docs: verify project v3 foundation"
```

## Quantitative Success Criteria

1. `CurrentProjectSnapshot` has schema version `3`; v1 and v2 remain decode-only inputs.
2. Every v1/v2 fixture migrates deterministically to v3; two independent migrations produce byte-identical normalized configuration JSON.
3. Every legacy Pose array produces exactly one active `job-default` / `Default Job`. A non-empty array preserves Pose count, IDs, names, six Joint angles, order, easing, and outgoing speed; a missing legacy speed normalizes to `100`. Migration recomputes every non-terminal duration from normalized Mechanics/speed and sets terminal duration to `1000`, emitting one bounded warning if legacy timing changed; an empty array produces one Job with zero Poses. Every native/migrated V3 Pose angle must be within its corresponding inclusive Mechanics command limits: exact min/max pass, `1e-9 deg` outside fails with the native/legacy out-of-limits code and at most 64 stable details, and no path clamps. Every native V3 Pose requires speed, rejects a derived-duration mismatch above `1e-9 ms`, and requires terminal duration exactly `1000`. Native v3 Save/reload and Export/Import preserve both Job array order and each Job's Pose array order exactly. Job revision `1` passes; `0`, `-1`, and `1.5` fail, and every non-null `activeJobId` must resolve to one stored Job.
4. A native or decoded v3 Project accepts exactly one through seven unique Robot STEP source records; zero and eight fail before preparation, every source ID equals its lowercase 64-hex SHA-256 digest, every accepted source is referenced by at least one Link part, every Link has a non-empty `sourceRefs` list whose entries have non-empty `meshIndices`, and duplicate `(sourceAssetId, nodePath, meshIndex)` ownership across Links fails. Ordinary node paths are non-negative. WS1 migration accepts only the exact reserved `[-1, linkOrdinal]` legacy whole-source form. Seven Links referencing the same source bytes produce one source record and one archive STEP entry. Source entry bytes match the original SHA-256 exactly.
5. `ObjectAssetRecordV3.sourceKind` is exactly `step | box | cylinder`. Byte-identical semantic STEP Object Assets share one archive blob per unique content hash. Box and Cylinder Assets produce zero STEP entries. Box dimensions accept exactly `[0.001, 10] m`, Cylinder radius exactly `[0.0005, 5] m`, and Cylinder height exactly `[0.001, 10] m`; each exact boundary passes and each boundary plus or minus the fixed `1e-12` test epsilon outside the interval fails. Box `dimensionsM`, Cylinder radius/height, local `axis: 'z'`, accepted bounds/proxy `[r, r, h/2]`, `radialSegments: 32`, canonical uppercase `color: '#RRGGBB'`, exact collision proxy, and exact statistics survive Save, reload, Export, and Import. Any primitive redundant-field mismatch rejects before preparation. Rendering rotates Three.js's Y-axis Cylinder geometry to local +Z before applying the Object transform.
6. A v3 Project has exactly one canonical external transform state per Object Instance and per persisted built-in Equipment record, and every built-in configuration ID/kind/Geometry matches the immutable catalog. `ObjectInstanceRecordV3` and `ProjectBuiltInEquipmentRecordV3` persist finite `manualNumericStatus` but no transform or effective live numeric value; NaN/infinity and unsupported status/source/visibility values fail. `ObjectInstanceRecordV3` contains a required Boolean `graspable`; every v1/v2 Object migrates with `graspable: false`. Duplicate, unknown, mismatched, missing, or orphan records/IDs fail before commit.
7. OPC UA Transform configuration persists Gateway ID, Profile ID, Profile revision, absolute mode, World/MCP reference, and exactly `{ mode: 'two-cycle', cycles: 2 }`. Duration derives as twice the selected Profile sampling interval and is never stored as milliseconds. No runtime value, timestamp, quality, sequence, socket, or trajectory is present in DB or archive.
8. Workspace Mode is absent from Project DB revisions and every `.wdtwin` entry.
9. `MAX_JOBS = 32`, `MAX_POSES_PER_JOB = 256`, `MAX_PROJECT_POSES = 2048`, `MAX_OBJECT_ASSETS = 256`, `MAX_OBJECT_INSTANCES = 512`, and `MAX_VISIBLE_RENDER_ITEMS = 1024`, plus every configured byte, triangle, mesh, material, scene, Link-reference, identifier, and collision-Box limit, accept their exact boundary and reject one unit above it before active-state mutation. General ID/name 128-byte and STEP/Manifest filename 255-byte boundaries pass; plus one rejects without truncation. Runtime tests count actual Mesh/material groups, not records. Up to all 512 persisted Instances may request overlays, but deterministic runtime presentation mounts at most `MAX_VISIBLE_STATUS_OVERLAYS = 128`; a 129th candidate is culled, not rejected or deleted.
10. A Mechanics change with existing moving Jobs first validates every saved angle against proposed limits. Any violation rejects the complete candidate as `PROJECT_JOB_POSE_OUT_OF_LIMITS`, reports total plus at most 64 stable details, and preserves Robot/Mechanics/Jobs/revisions/pointer/runtime. Otherwise it submits exactly one byte-free recipe containing both new Mechanics and reconciled Job durations/revisions, calls `ProjectMutationService.replaceFromActive()` once, and publishes once. Every affected Job increments exactly once; unaffected Jobs retain identity/revision; no intermediate mismatch or post-commit repair is observable.
11. Fault injection at validation, digest verification, Robot preparation, Object preparation, Mechanics/Job reconciliation, prepared-revision write, cache reconciliation, pointer flip, and runtime publication leaves pointer/cache/runtime entirely on the old or new revision. No mixed revision is observable while interaction is enabled. A post-publication old-runtime disposal failure specifically retains the complete new revision, resolves the commit, records one bounded cleanup diagnostic, and queues an idempotent retry without leaking the old revision back into active selectors.
12. A runtime-publication failure with successful compensation restores the old pointer and old runtime before unlocking. A compensation failure enters `recovery-required`, keeps interaction disabled, and requests one reload.
13. A browser/process restart reads the active pointer first, integrity-verifies authoritative source Blobs, reuses digest-plus-Geometry-config caches when valid, lazily leaves inactive Object Assets unparsed, and publishes one coherent revision. Showing/creating an Object with missing Geometry prepares it and enforces actual triangle/render-group budgets before its mutation publishes.
14. Existing Simulation/OPC UA Joint source, Manual Object transforms, one-whole-STEP Object import, Object removal, Pose speed/order, fixed frames, grasp, current collision, sequence collision, Project round-trip, and deployment workflows remain green.
15. V2 migration produces a complete six-Joint Mechanics block with deterministic Home/zero-offset/direction defaults, strictly positive maximum velocities, separate Flange and Tool0, preserved Tool0-to-TCP, and command-space evaluation `direction * commandAngleDeg + zeroOffsetDeg`; it emits exactly one `PROJECT_V2_MECHANICS_DEFAULTED` warning. An unknown legacy Robot source unit fails as `ROBOT_STEP_UNIT_REQUIRED`. Native V3 round-trip preserves every field exactly. A nontrivial legacy Joint/TCP fixture has pre/post-migration zero-pose Link and commanded TCP world matrices equal within `1e-9`, proving the implicit legacy +90-degree-Y Tool frame is neither omitted nor applied twice. MCP/TCP/Flange/Tool0 positions and normalized quaternions are finite with exact scale `[1, 1, 1]`; native, Manifest, Manual, and legacy non-unit scale cases fail before staging, with legacy cases reporting `PROJECT_LEGACY_FRAME_NON_RIGID`.
16. The complete WS1 gate reports zero lint errors, seven valid CAD Links with zero errors/warnings, successful build, passing targeted E2E, passing deployment smokes, and zero high-severity audit findings.
17. V3 `opcUa.numericStatusBindings` targets both built-in `equipment:*` and imported/generated `object:*` entities through `ProjectOpcUaNumericStatusBindingV3`. Each target is unique and existing, NodeId is non-empty, scale/offset are finite, native legacy `equipment`/`instanceId` fields fail, and V2 migration preserves NodeId/scale/offset while mapping `instanceId` to `object:${instanceId}`. Numeric or Transform OPC UA source requires exactly one matching Binding; Manual source may retain a dormant Binding. A bound legacy OPC numeric source remains OPC UA with its `manualNumericStatus` preserved and exactly one bounded fallback-assumed warning; an unbound legacy OPC numeric source migrates to Manual with the same bounded warning. Save/reload/export/import preserves both canonical kinds without live telemetry.
18. Revision identity hashes the complete canonical byte-free configuration projection whose Robot/Object sources are verified digest references. Same metadata with different Robot or Object STEP bytes yields different revision IDs; independently owned byte-identical sources with identical configuration yield the same revision ID, and no raw `ArrayBuffer` is JSON-serialized. Public raw ingress synchronously clones the configuration graph and owns every source before its first await, then stages each supplied source exactly once; a two-source deferred-hash mutation cannot change the invocation-time candidate. An internal metadata-only mutation preserves repository-minted handles and causes exactly zero source-digest calls, source-buffer copies, parser/Geometry rebuilds, or source-Blob writes while still hashing the small revision projection once.
19. The repository stores source bytes once in namespace-local `robot:<sha256>` and `object:<sha256>` Blob rows and stores no source bytes in revision rows. It retains one canonical resident buffer per namespace/digest; 256 same-digest semantic owners share that buffer and one digest/config parse cache, while each independent raw ingress is still hashed once. Hydration verifies every unique Blob reference, length, namespace, and digest before minting handles; one public read clones each unique Blob once, same-key records share only that caller-owned clone, and its mutation changes neither the stored revision nor the next read/archive. One maximum-size Project followed by 100 metadata edits leaves raw Blob bytes constant and only one retained revision after mark/sweep. Replacing source content writes one new Blob, publishes atomically, then sweeps the unreachable old Blob; startup removes crash-orphan revisions/Blobs. Quota preflight failure and IndexedDB `QuotaExceededError` both report `PROJECT_STORAGE_QUOTA_INSUFFICIENT` with the old pointer/runtime unchanged.
20. On trusted-LAN HTTP without `SubtleCrypto`, SHA-256 runs only in the dedicated incremental Worker with fixed 4 MiB transferable chunks, at most one chunk in flight, less than 8 MiB auxiliary payload, ordered length/sequence validation, and cancellation within 250 ms. The 25/50/100/256 MiB boundary suite matches known digests; the reference 256 MiB fallback completes inside the 60,000 ms watchdog while more than ten animation frames advance. Worker unavailability/failure rejects before mutation, and the main thread contains no whole-source pure-TypeScript hash loop.
21. `createPortableId()` returns RFC 4122 v4 IDs through either `randomUUID` or the injected `getRandomValues`-only branch, never `Math.random`, and throws `PORTABLE_ID_CRYPTO_UNAVAILABLE` before mutation if both are absent. Ten thousand runtime IDs are unique, all current direct secure-context-only calls are removed, and the WS1 non-secure-origin core spec creates unique Project/STEP-Object Asset/Instance IDs while `isSecureContext` is false and `randomUUID` is undefined. Downstream Job/Pose/Primitive acceptance remains explicitly owned by WS3/WS4/WS6, not this gate.
22. Archive encode/decode uses the streaming Worker with 4 MiB chunks, no production main-thread `zipSync`/`unzipSync`/whole-File `arrayBuffer`, at most 64 MiB codec auxiliary workspace, exact 120,000 ms timeout, and cancel within 250 ms. A maximum 256 MiB staged-source Project remains responsive and late/malformed work mutates nothing.
23. After one-time legacy bootstrap, whole-STEP Object import; Object/built-in Manual transform, numeric/status-source/overlay/grasp controls; canonical deletion with Binding/selection/interaction/collision cleanup; MCP/TCP edits; and collision policy/ignore actions each execute through one async Project recipe. Published feature stores remain unchanged while pending/rejected; normal V3 Save performs zero hydrated capture/source work. Manual preview lives only in a generation/revision-bound overlay: it changes rendered preview but no Project/read model, rejection retains it, Discard restores committed Pose, and replacement clears it. Later WS2/WS3/WS4 commands retain that same authority boundary.
24. Only after matching stable-pointer finalization, active runtime/verified-handle activation, and a fresh reopen-equivalent V3 integrity proof are obsolete legacy Project/Object/Equipment Dexie rows idempotently cleared. Finalization, activation, or proof failure retains them; cleanup failure is retry-only and does not roll back. A later successful proof clears each row once, so source-byte quota accounting cannot retain permanent legacy duplicates.
25. Each declared controlled Windows and Linux reference production-Chromium run at 1440x900 and DPR1 passes exactly 1,024 render groups, at most 1,500,000 rendered triangles, and exactly 128 mounted overlays from 512 requests with p95 frame interval at most 33.4 ms over the measured 10 s orbit, no Long Task above 200 ms, no WebGL context loss, and peak `JSHeapUsedSize` at most 768 MiB; 1,025 groups reject before publication and the 129th overlay is deterministically culled. An off-frustum selected entity receives no reserved slot, and any burst of camera/transform/selection/visibility/request invalidations invokes overlay ranking at most once per animation frame without changing persisted requests or numeric runtime state. A separate DPR2 functional smoke passes WebGL, overlay, and context-loss recovery without applying the DPR1 p95 threshold.

## Self-Review

- **Spec coverage:** v1/v2 migration, all v3 future-feature contracts, source de-duplication, exact digest verification and buffer alias isolation, byte-aware revision identity, Job migration, Primitive Asset representation, canonical external transforms, canonical numeric Status bindings, OPC UA Transform selection, telemetry/Mode exclusion, revision persistence, atomic publication, recovery, and release evidence each map to a task above.
- **Scope:** This plan establishes contracts, persistence, compatibility projections, and crash consistency only. Assembly part mapping, Job editor/playback ownership, Primitive rendering, OPC UA live reduction/smoothing, and Mode UI behavior remain separate plans.
- **Placeholder scan:** No unresolved placeholders, ambiguous implementation choices, or deferred interface names remain.
- **Type consistency:** All downstream work consumes `createPortableId`, the tuple-preserving `DeepReadonly`, deeply readonly standalone Object Asset/Instance records, `WorkcellProjectSnapshotV3`, `ByteFreeWorkcellProjectProjectionV3`, `validateWorkcellProjectSnapshotV3`, `ProjectMutationService`, `ProjectPoseStepV3`, `SimulationJobV1`, `deriveCanonicalPoseDurationMsV3`, `canonicalizeSimulationDurationsV3`, `reconcileSimulationForMechanicsChange`, `ObjectAssetGeometryV3`, `StepObjectAssetRecordV3`, `BoxObjectAssetRecordV3`, `CylinderObjectAssetRecordV3`, `ObjectAssetRecordV3`, `ObjectInstanceRecordV3`, `ProjectBuiltInEquipmentRecordV3`, `RobotStepSourceAssetV3`, `RobotAssemblyPartRefV3`, `RobotLinkGeometryRecordV3`, `ProjectRobotJointV3`, `FixedSixAxisRobotMechanicsV3`, `FixedSixAxisRobotManifestV1`, `RobotMechanicsProvenanceV3`, `ProjectExternalEntityTransformStateV3`, `ProjectOpcUaNumericStatusBindingV3`, and `ProjectOpcUaEquipmentTransformBindingV3` with the spellings defined in Task 1.
- **Dependency gate:** No downstream feature plan may start until Task 6 and independent review pass.
