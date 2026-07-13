# Project V3 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Project Schema v3 as the single authoritative, crash-consistent foundation for assembly Robot sources, Simulation Jobs, STEP/Box/Cylinder Object Assets, canonical external-entity transforms, and read-only OPC UA Transform bindings before any feature work begins.

**Architecture:** Split the current monolithic project contract into focused v3 subcontracts, then migrate v1/v2 snapshots through one deterministic adapter. Store immutable Project revisions and a separately committed active-revision pointer; prepare all source-derived assets and one complete runtime bundle before the pointer is flipped. Project configuration is durable, while Workspace Mode and all live OPC UA values, timestamps, quality, interpolation state, and connection state remain transient.

**Tech Stack:** TypeScript 6, React 19, Zustand 5, Dexie 4, fflate 0.8.3, Three.js 0.185, Vitest 4, fake-indexeddb 6, Playwright 1.61.

## Global Constraints

- **Prerequisite:** Complete Gate G0, commit the single amended normative specification, and obtain explicit user approval before running any WS1 source task. If that approved revision is absent, stop and return to the master roadmap; do not infer the contract locally.
- This plan is WS1 and must complete, pass review, and satisfy its release gate before Assembly Import, Simulation Jobs, Primitive Objects, OPC UA Equipment Transform, or Mode Workspace feature implementation begins.
- Keep one active Robot, exactly six revolute Joints (`J1` through `J6`), and exactly seven Robot Links (`LINK00` through `LINK06`). Variable DOF, multiple Robots, URDF, and seven-axis Robots remain outside this milestone.
- Robot language is: **seven Robot Links mapped from one through seven STEP sources**. File names and assembly names may suggest mappings but never prove Kinematics.
- Schema v3 is the only schema introduced in this milestone. Jobs, Primitive Assets, Robot source de-duplication, canonical external transforms, and OPC UA Transform Binding configuration must land in the same v3 contract; do not create a v4 during the milestone.
- Preserve v1 and v2 visible placement, Joint values, MCP/TCP transforms, Pose order, outgoing speed, easing, collision Boxes, and collision policy through deterministic migration.
- Every migrated v1/v2 flat Pose array, including an empty array, becomes exactly one active Job with `id: 'job-default'` and `name: 'Default Job'`.
- A new Object Asset has exactly one `sourceKind` discriminator: `step`, `box`, or `cylinder`. STEP Assets own source bytes; Box and Cylinder Assets contain no fake filename, fake source bytes, nested generic Primitive kind, or archive STEP entry.
- `ObjectInstanceRecordV3` owns `graspable: boolean` but no transform. Its transform exists only in the matching canonical external-entity state. V1/V2 Object Instances migrate with `graspable: false` because the durable legacy Project format did not preserve that choice.
- `ProjectExternalEntityTransformStateV3.manualTransform` is canonical MCP-local and has no Manual frame field. `referenceFrameId: 'world' | 'mcp'` exists only on the separate OPC UA Transform Binding.
- Box dimensions, Cylinder radius/height, scale/offset values, transforms, and all statistics must be finite. Each Box dimension is within inclusive `[0.001, 10] m`; Cylinder radius is within inclusive `[0.0005, 5] m`; Cylinder height is within inclusive `[0.001, 10] m`. Box and Cylinder `color` is canonical uppercase `#RRGGBB` and must match `/^#[0-9A-F]{6}$/`.
- Every OPC UA Equipment Transform Binding persists the fixed smoothing policy `{ mode: 'two-cycle', cycles: 2 }`. Runtime duration is derived as `2 * gatewayProfile.samplingIntervalMs`; with the default `100 ms` Profile interval it is `200 ms`. No millisecond smoothing duration is persisted.
- Enforce `MAX_JOBS = 32`, `MAX_POSES_PER_JOB = 256`, and `MAX_PROJECT_POSES = 2048` at validation, migration, capture, and archive decode boundaries.
- Source STEP identity is SHA-256 of the exact input bytes. Hashing must work in trusted-LAN HTTP deployments and may not depend exclusively on secure-context Web Crypto.
- Raw STEP limits remain 25 MiB per unique Robot source, 100 MiB total Robot source bytes after de-duplication, 50 MiB per STEP Object Asset, and 256 MiB per Project. One source may supply confirmed parts to multiple Links without duplicating its bytes. Existing triangle, mesh, material, scene, and collision-Box limits remain unchanged.
- The v3 Project snapshot is authoritative. Robot Geometry, Object Geometry, Equipment rows, and converted Three.js assets are revision-tagged derived caches.
- Workspace Mode is UI state and must not be serialized in IndexedDB Project revisions or `.wdtwin` archives.
- Live OPC UA values, last-good Pose, sequence number, receipt time, source timestamp, quality, stale timer, smoothing trajectory, socket state, and diagnostics must not be serialized.
- Project Import/New/replace is all-or-nothing. Interaction stays locked from preparation through publication or recovery.
- Runtime publication performs one prebuilt bundle-pointer replacement. It performs no STEP parse, hashing, Three.js allocation, or IndexedDB write.
- A failure before the active pointer flip leaves the old revision active. A failure after the flip restores the old pointer before interaction unlocks. Compensation failure leaves the application in `recovery-required` and reloads from the authoritative DB pointer.
- Preserve existing user changes, do not stage the two untracked CAD/backup directories, and keep source comments in English.
- No PLC write, OPC UA write, controller command, deploy, transfer, restart, or live-controller operation is authorized by this plan.

## Existing Plan Disposition

| Existing artifact | Disposition for this milestone | Reason |
|---|---|---|
| `2026-07-13-portable-workcell-project-core.md` | Completed baseline; modify only through v3 migration | V1/V2 archive, Asset/Instance, and staged Project behavior already exist. |
| `2026-07-13-fixed-coordinate-frames.md` | Completed baseline; preserve and integrate | Fixed World/MCP/Base/Flange/TCP behavior is the v3 migration source. |
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
src/lib/hash/sha256.ts                                 # secure-context path plus bundled HTTP-safe fallback
src/lib/hash/sha256.test.ts
src/features/project/project-codec.ts                  # v1/v2 decode and deterministic v3 archive encode/decode
src/features/project/project-codec.test.ts
src/features/project/project-db.ts                     # immutable revisions, active pointer, legacy table
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
src/features/project/legacy-pose-job-adapter.ts        # flat keyframe compatibility bridge
src/features/project/legacy-pose-job-adapter.test.ts
src/features/equipment/equipment-store.ts              # built-in Equipment capture/replace boundary
src/features/objects/object-asset-store.ts              # v3 STEP/Primitive persistence boundary
src/features/robot/robot-geometry-store.ts              # source/link revision bridge
src/features/frames/coordinate-frame-store.ts           # MCP/TCP v3 bridge
src/features/joints/robot-store.ts                       # retiring flat Pose adapter only
src/features/collision/collision-store.ts                # v3 policy bridge
tests/project-v3-roundtrip.spec.ts
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
- Create: `src/domain/project/object-asset-v3.ts`
- Create: `src/domain/project/external-entity-v3.ts`
- Create: `src/domain/project/opcua-transform-binding-v3.ts`
- Create: `src/domain/project/project-v3.ts`
- Create: `src/domain/project/project-v3.test.ts`
- Modify: `src/domain/project/project.ts`
- Test: `src/domain/project/project.test.ts`

**Interfaces:**
- Consumes: existing `ProjectPoseRecordV1`, `ProjectCollisionBoxV2`, `ProjectCollisionPolicyV2`, `SerializableTransform`, `RobotLinkId`, and v1/v2 snapshot types.
- Produces: `WorkcellProjectSnapshotV3`, `CurrentProjectSnapshot = WorkcellProjectSnapshotV3`, `validateWorkcellProjectSnapshotV3()`, `SimulationJobV1`, `ObjectAssetGeometryV3`, `StepObjectAssetRecordV3`, `BoxObjectAssetRecordV3`, `CylinderObjectAssetRecordV3`, `ObjectAssetRecordV3`, `RobotStepSourceAssetV3`, `RobotAssemblyPartRefV3`, `RobotLinkGeometryRecordV3`, `FixedSixAxisRobotManifestV1`, `RobotMechanicsProvenanceV3`, `ProjectExternalEntityTransformStateV3`, and `ProjectOpcUaEquipmentTransformBindingV3`.

- [ ] **Step 1: Write v3 contract RED tests**

```ts
it('accepts Jobs, all three Object source kinds, de-duplicated Robot sources, and Transform bindings', () => {
  const snapshot = validV3Project()
  snapshot.simulation.jobs = [job('job-1', [pose('pose-1')])]
  snapshot.objectAssets = [stepAsset('step-1'), boxAsset('box-1'), cylinderAsset('cylinder-1')]
  snapshot.opcUa.equipmentTransforms = [
    transformBinding('object:instance-1', { mode: 'two-cycle', cycles: 2 }),
  ]
  expect(validateWorkcellProjectSnapshotV3(snapshot)).toEqual(snapshot)
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
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/domain/project/project-v3.test.ts src/domain/project/project.test.ts`

Expected: FAIL because the v3 modules and current-version exports do not exist.

- [ ] **Step 3: Implement the exact v3 discriminated contracts**

```ts
export type ObjectAssetGeometryV3 = Readonly<Pick<
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

export interface SimulationJobV1 {
  readonly id: string
  readonly name: string
  readonly revision: number
  readonly poses: readonly ProjectPoseRecordV1[]
}

export interface ProjectSimulationStateV3 {
  readonly activeJobId: string | null
  readonly jobs: readonly SimulationJobV1[]
}

export interface ObjectInstanceRecordV3
  extends Omit<ObjectInstanceRecordV1, 'transform'> {
  readonly graspable: boolean
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

Define `RobotStepSourceAssetV3`, `RobotAssemblyPartRefV3`, `RobotLinkGeometryRecordV3`, `FixedSixAxisRobotManifestV1`, and `RobotMechanicsProvenanceV3` exactly as the approved assembly design in `robot-source-v3.ts`; downstream Robot Import consumes these names and must not redefine them. Define canonical IDs as ``equipment:${string}` | `object:${string}``. Make `ObjectInstanceRecordV3` omit the legacy transform; its only durable transform is the matching canonical external-entity state. Require every Job revision to be a positive integer and every non-null `activeJobId` to reference exactly one Job. Require exactly one transform state per built-in Equipment and Object Instance, unique Job/Pose IDs, unique Profile assignment, one through seven unique Robot source hashes, every Robot source referenced by at least one Link part, every Link to contain at least one source reference with at least one mesh index, no duplicate `(sourceAssetId, nodePath, meshIndex)` ownership across Links, valid Link source references, and complete `LINK00` through `LINK06` ownership.

Define `SimulationJobV1` and the Job limit constants in `simulation-job-v1.ts`, then explicitly re-export `SimulationJobV1`, `MAX_JOBS`, `MAX_POSES_PER_JOB`, and `MAX_PROJECT_POSES` from `project-v3.ts`. Downstream WS3 imports those public names only from `src/domain/project/project-v3.ts`.

- [ ] **Step 4: Make validation closed and ownership-safe**

Reject unknown top-level and nested configuration keys so transient runtime fields cannot leak into archives. Clone every tuple, ArrayBuffer, Job/Pose array, source reference, and collision Box at the validation boundary. Normalize quaternions and reject a norm at or below `1e-9`. Keep v1/v2 validators available only for decode/migration.

- [ ] **Step 5: Run GREEN and compatibility tests**

Run: `npm run test:run -- src/domain/project`

Expected: PASS for v1, v2, and v3 contracts; current-version callers compile against v3.

- [ ] **Step 6: Commit**

```powershell
git add src/domain/project
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

**Interfaces:**
- Consumes: validated v1/v2 snapshots, injected SHA-256 source hashing, injected locked-parser legacy source analysis, and immutable built-in Equipment defaults.
- Produces: `sha256Hex(bytes, { subtle? })`, plus `migrateProjectToV3(snapshot, dependencies): Promise<ProjectMigrationResultV3>` where the result contains one validated v3 snapshot and bounded migration warnings.

- [ ] **Step 1: Write migration RED tests**

```ts
it.each([
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
])('hashes %j identically with Web Crypto and the bundled fallback', async (source, digest) => {
  const bytes = new TextEncoder().encode(source)
  expect(await sha256Hex(bytes, { subtle: crypto.subtle })).toBe(digest)
  expect(await sha256Hex(bytes, { subtle: undefined })).toBe(digest)
})

it('moves a non-empty flat Pose list into exactly one active Default Job', async () => {
  const source = validV2Project({ poses: [pose('A', 40), pose('B', 100)] })
  const migrated = await migrateProjectToV3(source, migrationDependencies())
  expect(migrated.snapshot.simulation).toEqual({
    activeJobId: 'job-default',
    jobs: [{ id: 'job-default', name: 'Default Job', revision: 1, poses: source.poses }],
  })
})

it('moves an empty flat Pose list into one empty active Default Job', async () => {
  const migrated = await migrateProjectToV3(validV2Project({ poses: [] }), migrationDependencies())
  expect(migrated.snapshot.simulation).toEqual({
    activeJobId: 'job-default',
    jobs: [{ id: 'job-default', name: 'Default Job', revision: 1, poses: [] }],
  })
})

it('stores byte-identical legacy Link sources once and retains seven Link refs', async () => {
  const migrated = await migrateProjectToV3(v2WithSevenLinksSharingOneSource(), migrationDependencies())
  expect(migrated.snapshot.robot.sources).toHaveLength(1)
  expect(migrated.snapshot.robot.links).toHaveLength(7)
  expect(new Set(migrated.snapshot.robot.links.map((link) => link.sourceRefs[0]!.sourceAssetId))).toEqual(
    new Set([migrated.snapshot.robot.sources[0]!.id]),
  )
})

it('fails an unknown legacy source unit without publishing a partial snapshot', async () => {
  await expect(migrateProjectToV3(v2WithUnknownUnit(), migrationDependencies())).rejects.toMatchObject({
    code: 'PROJECT_V2_ROBOT_UNIT_CONFIRMATION_REQUIRED',
  })
})

it('moves Object transforms to canonical state and defaults legacy graspable to false', async () => {
  const migrated = await migrateProjectToV3(v2WithObject('object-1'), migrationDependencies())
  expect(migrated.snapshot.objectInstances[0]).toMatchObject({ id: 'object-1', graspable: false })
  expect(migrated.snapshot.objectInstances[0]).not.toHaveProperty('transform')
  expect(migrated.snapshot.externalEntities).toContainEqual(
    expect.objectContaining({ entityId: 'object:object-1' }),
  )
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/lib/hash/sha256.test.ts src/domain/project/project-v2-migration.test.ts src/domain/project/project-v1-migration.test.ts`

Expected: FAIL because the HTTP-safe SHA-256 utility and v2-to-v3 migration do not exist.

- [ ] **Step 3: Implement one explicit migration entrypoint**

```ts
export interface ProjectV3MigrationDependencies {
  readonly sha256: (bytes: ArrayBuffer) => Promise<string>
  readonly analyzeLegacyRobotSource: (
    bytes: ArrayBuffer,
  ) => Promise<{ detectedUnit: 'meter' | 'millimeter' | 'inch' | 'unknown'; meshIndices: readonly number[] }>
  readonly builtInEquipmentDefaults: readonly ProjectExternalEntityTransformStateV3[]
}

export interface ProjectMigrationResultV3 {
  readonly snapshot: WorkcellProjectSnapshotV3
  readonly warnings: readonly string[]
}
```

Validate that every `builtInEquipmentDefaults` entry has an `equipment:*` ID, a finite canonical Manual transform, and no duplicate ID. Do not introduce a second built-in Equipment state type.

Implement `sha256Hex()` once in `src/lib/hash`: prefer injected/native `SubtleCrypto` when available and fall back to a bundled pure TypeScript SHA-256 implementation when it is absent, including trusted-LAN HTTP. Both paths return lowercase 64-character hex and never mutate the input bytes. Dispatch v1 through the existing owned v1-to-v2 migration, then run exactly one v2-to-v3 path. Use source SHA-256 as identity, build a synthetic whole-source part reference for each legacy Link, preserve `localTransform` as `zeroPoseLocalization`, start `operatorAdjustment` at identity, and mark known units `legacy-detected`. Hash normalized Manual Mechanics and retain the current six-Joint configuration as authoritative.

- [ ] **Step 4: Migrate external entities, Jobs, primitives, and bindings without invention**

Create canonical Manual transform entries from every v2 Object Instance, remove transform from the v3 Instance projection, and set `graspable: false`. Restore built-in Equipment from immutable catalog defaults and emit one bounded warning because v1/v2 archives did not contain those transforms. Convert each v2 STEP Asset to `sourceKind: 'step'`. Create no Box/Cylinder Assets and no Equipment Transform bindings during migration. Keep existing numeric Status bindings and collision policy unchanged. Reject legacy input above `MAX_JOBS`, `MAX_POSES_PER_JOB`, or `MAX_PROJECT_POSES` rather than truncating it.

- [ ] **Step 5: Prove idempotence and deterministic failure**

Run the migration twice from independently cloned inputs and compare normalized v3 JSON byte-for-byte. Inject hash, parser, unit, reference, and budget failures and assert the input snapshots remain deeply equal to their pre-call copies.

Run: `npm run test:run -- src/lib/hash/sha256.test.ts src/domain/project`

Expected: PASS with deterministic warnings, exact flat-Pose preservation, source de-duplication, and no input mutation.

- [ ] **Step 6: Commit**

```powershell
git add src/domain/project src/lib/hash/sha256.ts src/lib/hash/sha256.test.ts
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

**Interfaces:**
- Consumes: validated v3 snapshots, Task 2 `sha256Hex()`, and the Task 2 migration entrypoint.
- Produces: v1/v2/v3 decode to current v3 and deterministic v3-only encode with content-addressed Robot STEP entries.

- [ ] **Step 1: Write archive RED tests**

```ts
it('writes one Robot STEP entry for seven Links sharing one source', async () => {
  const entries = unzipSync(await encodeWorkcellProject(v3WithOneAssemblySource()))
  expect(Object.keys(entries).filter((path) => path.startsWith('robot/sources/') && path.endsWith('.step')))
    .toEqual([`robot/sources/${ASSEMBLY_SHA256}.step`])
})

it('stores Box and Cylinder definitions inline without fake STEP entries', async () => {
  const entries = unzipSync(await encodeWorkcellProject(v3WithThreeObjectKinds()))
  expect(Object.keys(entries).filter((path) => path.startsWith('objects/assets/') && path.endsWith('.step')))
    .toHaveLength(1)
  expect(JSON.parse(new TextDecoder().decode(entries['objects/assets.json']))).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sourceKind: 'box' }),
      expect.objectContaining({ sourceKind: 'cylinder' }),
    ]),
  )
})

it('omits Workspace Mode and every live OPC UA field', async () => {
  const text = new TextDecoder().decode(await encodeWorkcellProject(validV3Project()))
  expect(text).not.toMatch(/workspaceMode|lastGood|receiptTime|quality|trajectory|socketState/)
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
robot/mechanics/source-manifest.json        # Manifest provenance only, optional
objects/assets.json
objects/assets/<sha256>.step                # STEP source kind only
objects/instances.json
equipment/built-ins.json
external/entities.json
simulation/jobs.json
opcua/bindings.json
collision/policy.json
```

Sort every entry path and every unordered source, Link, Asset, Instance, built-in Equipment, external-entity, and Binding collection by stable ID before encoding. Preserve the stored Simulation Job array order and each Job's Pose array order exactly; these arrays are domain order, not sets. Keep the fixed ZIP timestamp. Verify that an archive path hash matches both the index hash and the exact entry bytes before staging.

- [ ] **Step 4: Preserve bounded pre-expansion validation and version dispatch**

Keep safe-path, duplicate-path, encryption, ZIP64, entry-count, per-entry, expanded-size, and total-source limits. Decode the manifest first. Decode v1/v2 using their existing layouts, migrate to v3, then validate. Decode v3 directly. Reject unknown versions; never downgrade.

- [ ] **Step 5: Run deterministic round-trip GREEN tests**

Run: `npm run test:run -- src/features/project/project-codec.test.ts src/features/project/project-v3-archive.test.ts src/domain/project`

Expected: PASS; two encodes of the same owned snapshot are byte-identical, and decode/encode preserves semantic v3 state exactly.

- [ ] **Step 6: Commit**

```powershell
git add src/features/project/project-codec.ts src/features/project/project-codec.test.ts src/features/project/project-v3-archive.ts src/features/project/project-v3-archive.test.ts
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
- Consumes: validated owned v3 snapshots and Task 2 `sha256Hex()` for deterministic revision identity.
- Produces: `ProjectRevisionRepository`, immutable `StoredProjectRevisionV1`, compare-and-swap active-pointer operations, and a one-time legacy `projects.active` adoption path.

- [ ] **Step 1: Write revision/pointer RED tests**

```ts
it('writes an immutable revision before flipping the active pointer', async () => {
  const revision = await repository.writeRevision(snapshotA())
  expect(await repository.readActive()).toBeNull()
  await repository.compareAndSwapActive(null, revision.revisionId)
  expect((await repository.readActive())?.snapshot).toEqual(snapshotA())
})

it('rejects a stale pointer writer without replacing the winner', async () => {
  const a = await repository.writeRevision(snapshotA())
  const b = await repository.writeRevision(snapshotB())
  await repository.compareAndSwapActive(null, a.revisionId)
  await expect(repository.compareAndSwapActive(null, b.revisionId)).rejects.toMatchObject({
    code: 'PROJECT_ACTIVE_REVISION_CHANGED',
  })
  expect((await repository.readActive())?.revisionId).toBe(a.revisionId)
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
  readonly parentRevisionId: string | null
  readonly createdAt: string
  readonly snapshot: WorkcellProjectSnapshotV3
}

export interface StoredProjectPointerV1 {
  readonly key: 'active'
  readonly revisionId: string
}
```

Add `projectRevisions` keyed by `revisionId` and indexed by `projectId`, plus `projectPointers` keyed by `key`. Retain the v1 `projects` table for adoption and recovery during this compatibility cycle. Generate `revisionId` from canonical configuration JSON SHA-256 plus project ID; identical configuration may reuse an existing immutable revision.

- [ ] **Step 4: Implement compare-and-swap and legacy adoption transactions**

Run pointer reads and writes in one Dexie transaction. Require the caller's expected revision. Legacy adoption validates/migrates/stages the old row first, writes a v3 revision, flips a previously empty pointer, and leaves the old row intact until the complete release gate passes.

- [ ] **Step 5: Run GREEN, reopen, and concurrency tests**

Run: `npm run test:run -- src/features/project/project-db.test.ts src/features/project/project-revision-repository.test.ts`

Expected: PASS for reopen persistence, immutable rows, stale-writer rejection, legacy adoption idempotence, and tuple ownership.

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
- Consumes: the Task 4 Part A revision repository and a browser runtime that can prepare all derived assets without mutating active state.
- Produces: `PreparedProjectRevision`, `ActiveProjectRuntimeBundle`, `ProjectCommitCoordinator`, a serialized mutation gate, and store status `recovery-required`.

- [ ] **Step 1: Write phase-fault RED tests**

```ts
it.each([
  'validate', 'prepare-robot', 'prepare-object', 'write-revision',
  'reconcile-cache', 'flip-pointer', 'publish-runtime',
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
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/project/project-commit-coordinator.test.ts src/features/project/project-store.test.ts src/features/project/browser-project-runtime.test.ts`

Expected: FAIL because the current store mutates runtime before writing one mutable DB row and uses best-effort reconstruction.

- [ ] **Step 3: Define preparation and publication as separate operations**

```ts
export interface PreparedProjectRevision<RuntimeBundle> {
  readonly revision: StoredProjectRevisionV1
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
  replace(snapshot: WorkcellProjectSnapshotV3): Promise<void>
}
```

`prepare()` parses sources, allocates Geometry, validates references, and builds every selector-ready record without mutating active stores. `publish()` replaces exactly one `ActiveProjectRuntimeBundle` pointer synchronously. Scene, collision, selection, and interaction adapters read the bundle revision and ignore callbacks captured from an older generation.

- [ ] **Step 4: Implement the ordered commit and compensation protocol**

Acquire one Project mutation lock; disable interaction; validate and prepare; write the immutable revision; reconcile revision-tagged caches; compare-and-swap the active pointer; publish the prepared bundle; release the lock; notify observers; dispose the old bundle; garbage-collect only unreferenced old caches. If publication throws, restore the previous pointer in a compensating transaction and republish the retained old bundle before unlocking.

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
- Modify: `src/features/project/browser-project-runtime.ts`
- Modify: `src/features/project/browser-project-runtime.test.ts`
- Modify: `src/features/project/project-store-browser.ts`
- Modify: `src/features/equipment/equipment-store.ts`
- Test: `src/features/equipment/equipment-store.test.ts`
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
- Consumes: Task 4 runtime bundle and current feature-store records.
- Produces: one capture/prepare/publish adapter that preserves current behavior while later feature work replaces compatibility projections.

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
  expect(snapshot.externalEntities.map(({ entityId }) => entityId)).toEqual(
    expect.arrayContaining(['equipment:cup-01', 'object:object-01']),
  )
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/project/browser-project-runtime.test.ts src/features/project/legacy-pose-job-adapter.test.ts src/features/equipment src/features/objects src/features/robot src/features/frames src/features/joints src/features/collision`

Expected: FAIL because current stores expose v2 Link/Asset/flat-Pose records and built-in Equipment is outside the Project snapshot.

- [ ] **Step 3: Implement one-way compatibility projections**

Capture current Robot Geometry as de-duplicated v3 sources and synthetic whole-source Link refs, current keyframes as the Default Job, current Object transforms as canonical `object:*` states, built-in Equipment as `equipment:*` states, fixed frames, and collision policy. Do not write dormant OPC UA Transform bindings or Primitive runtime Geometry into legacy stores. Keep unimplemented v3 configuration in the authoritative active snapshot so Save does not erase it before its feature store exists.

- [ ] **Step 4: Tag every derived cache row with Project revision**

Robot Geometry, Object Geometry, built-in Equipment cache, and converted asset repositories must expose their revision. `prepare()` rejects a cache hit whose revision differs from the prepared Project revision and rebuilds it from source. Publication swaps only cache maps bearing the prepared revision.

- [ ] **Step 5: Verify no current workflow regresses**

Run: `npm run test:run -- src/features/project src/features/equipment src/features/objects src/features/robot src/features/frames src/features/joints src/features/collision src/app`

Expected: PASS for current Robot, Object import, Manual transform, Pose ordering/speed, numeric Status, grasp, collision, frame, New/Save/Export/Import, and rollback workflows.

- [ ] **Step 6: Commit**

```powershell
git add src/features/project src/features/equipment src/features/objects src/features/robot src/features/frames src/features/joints src/features/collision
git diff --cached --check
git commit -m "feat: bridge browser runtime to project v3"
```

---

### Task 6: Prove V3 Round-Trip, Recovery, and Documentation

**Files:**
- Create: `tests/project-v3-roundtrip.spec.ts`
- Modify: `tests/project-roundtrip.spec.ts`
- Create: `docs/developer/project-v3-format.md`
- Modify: `docs/progress/2026-07-13-project-status.md`
- Modify: `docs/progress/2026-07-13-short-term-mvp-implementation.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the completed v3 domain, codec, revision repository, commit coordinator, and browser bridge.
- Produces: browser evidence, operator/developer format guidance, and an authoritative plan-status ledger.

- [ ] **Step 1: Write the browser acceptance before final verification**

The test must create or migrate one v2 Project containing a non-default Robot name and Base XYZRPY, all six edited Joint origins/axes/limits/maximum velocities, all seven edited Link geometry-local transforms, seven Robot Links, two ordered Poses, one imported Object, edited MCP/TCP, and non-default collision policy; save it as v3; export; clear browser storage; import; and assert every named Robot/Mechanics/Geometry field plus the remaining snapshot is semantically equal. It must also use a programmatically generated v3 archive containing one Box and one Cylinder definition plus an inactive OPC UA Transform Binding and prove they survive decode/export without transient telemetry.

- [ ] **Step 2: Add deterministic archive and recovery assertions**

Assert one STEP entry per unique Robot source hash, no primitive STEP entries, one `Default Job`, exact Pose order/speed/easing, exact collision Boxes/policy, exact canonical Manual fallback transforms, null live telemetry, and null Workspace Mode. Force a failed staging parse and assert the visible revision, DB pointer, and cache revision remain unchanged.

- [ ] **Step 3: Document the exact v3 format and recovery contract**

Document every archive path, `step | box | cylinder` source union, units, ZYX Quaternion convention, fixed two-cycle smoothing configuration versus transient trajectory, canonical entity IDs, Job ownership and limits, migration warnings, revision/pointer phases, recovery-required state, resource limits, and downgrade rejection. Mark completed, superseded, and future plans using the disposition table in this plan.

- [ ] **Step 4: Run the complete WS1 gate**

```powershell
npm run lint
npm run test:run
npm run test:middleware
npm run cad:validate
npm run build
npm run test:e2e -- tests/project-roundtrip.spec.ts tests/project-v3-roundtrip.spec.ts tests/geometry-collision.spec.ts
npm run deploy:validate
npm run deploy:smoke
npm run deploy:smoke:opcua
npm audit --audit-level=high
git diff --check
```

Expected: zero lint errors; all unit/middleware tests pass; seven CAD Links with `0 errors, 0 warnings`; production build passes; all three serialized browser workflows pass without a flaky-timeout waiver; both deployment smokes clean up; zero high-severity audit findings; no whitespace errors.

- [ ] **Step 5: Request independent review and resolve every actionable finding**

Use `superpowers:requesting-code-review`. Re-run the focused test for each correction, then rerun the complete WS1 gate. Do not authorize downstream feature work until the reviewer confirms the quantitative success criteria below.

- [ ] **Step 6: Commit evidence and documentation**

```powershell
git add tests/project-v3-roundtrip.spec.ts tests/project-roundtrip.spec.ts docs/developer/project-v3-format.md docs/progress README.md
git diff --cached --check
git commit -m "docs: verify project v3 foundation"
```

## Quantitative Success Criteria

1. `CurrentProjectSnapshot` has schema version `3`; v1 and v2 remain decode-only inputs.
2. Every v1/v2 fixture migrates deterministically to v3; two independent migrations produce byte-identical normalized configuration JSON.
3. Every legacy Pose array produces exactly one active `job-default` / `Default Job`. A non-empty array preserves Pose count, IDs, names, six Joint angles, order, easing, duration, and outgoing speed; an empty array produces one Job with zero Poses. Native v3 Save/reload and Export/Import preserve both Job array order and each Job's Pose array order exactly. Job revision `1` passes; `0`, `-1`, and `1.5` fail, and every non-null `activeJobId` must resolve to one stored Job.
4. A native or decoded v3 Project accepts exactly one through seven unique Robot STEP source records; zero and eight fail before preparation, every accepted source is referenced by at least one Link part, every Link has a non-empty `sourceRefs` list whose entries have non-empty `meshIndices`, and duplicate `(sourceAssetId, nodePath, meshIndex)` ownership across Links fails. Seven Links referencing the same source bytes produce one source record and one archive STEP entry. Source entry bytes match the original SHA-256 exactly.
5. `ObjectAssetRecordV3.sourceKind` is exactly `step | box | cylinder`. Box and Cylinder Assets produce zero STEP entries. Box dimensions accept exactly `[0.001, 10] m`, Cylinder radius exactly `[0.0005, 5] m`, and Cylinder height exactly `[0.001, 10] m`; each exact boundary passes and each boundary plus or minus the fixed `1e-12` test epsilon outside the interval fails. Box `dimensionsM`, Cylinder radius/height, local `axis: 'z'`, accepted bounds/proxy `[r, r, h/2]`, `radialSegments: 32`, and canonical uppercase `color: '#RRGGBB'` survive Save, reload, Export, and Import exactly. Rendering rotates Three.js's Y-axis Cylinder geometry to local +Z before applying the Object transform.
6. A v3 Project has exactly one canonical external transform state per Object Instance and per persisted built-in Equipment record. `ObjectInstanceRecordV3` contains a required Boolean `graspable` and no transform; every v1/v2 Object migrates with `graspable: false`. Duplicate or orphan canonical IDs fail before commit.
7. OPC UA Transform configuration persists Gateway ID, Profile ID, Profile revision, absolute mode, World/MCP reference, and exactly `{ mode: 'two-cycle', cycles: 2 }`. Duration derives as twice the selected Profile sampling interval and is never stored as milliseconds. No runtime value, timestamp, quality, sequence, socket, or trajectory is present in DB or archive.
8. Workspace Mode is absent from Project DB revisions and every `.wdtwin` entry.
9. `MAX_JOBS = 32`, `MAX_POSES_PER_JOB = 256`, and `MAX_PROJECT_POSES = 2048`, plus every configured byte, triangle, mesh, material, scene, Link-reference, identifier, and collision-Box limit, accept their exact boundary and reject one unit above it before active-state mutation.
10. Fault injection at validation, Robot preparation, Object preparation, revision write, cache reconciliation, pointer flip, runtime publication, and disposal leaves pointer/cache/runtime entirely on the old or new revision. No mixed revision is observable while interaction is enabled.
11. A runtime-publication failure with successful compensation restores the old pointer and old runtime before unlocking. A compensation failure enters `recovery-required`, keeps interaction disabled, and requests one reload.
12. A browser/process restart reads the active pointer first, rejects a mismatched cache revision, rebuilds from authoritative source bytes, and publishes that one revision.
13. Existing Simulation/OPC UA Joint source, Manual Object transforms, one-whole-STEP Object import, Object removal, Pose speed/order, fixed frames, grasp, current collision, sequence collision, Project round-trip, and deployment workflows remain green.
14. The complete WS1 gate reports zero lint errors, seven valid CAD Links with zero errors/warnings, successful build, passing targeted E2E, passing deployment smokes, and zero high-severity audit findings.

## Self-Review

- **Spec coverage:** v1/v2 migration, all v3 future-feature contracts, source de-duplication, Job migration, Primitive Asset representation, canonical external transforms, OPC UA durable selection, telemetry/Mode exclusion, revision persistence, atomic publication, recovery, and release evidence each map to a task above.
- **Scope:** This plan establishes contracts, persistence, compatibility projections, and crash consistency only. Assembly part mapping, Job editor/playback ownership, Primitive rendering, OPC UA live reduction/smoothing, and Mode UI behavior remain separate plans.
- **Placeholder scan:** No unresolved placeholders, ambiguous implementation choices, or deferred interface names remain.
- **Type consistency:** All downstream work consumes `WorkcellProjectSnapshotV3`, `SimulationJobV1`, `ObjectAssetGeometryV3`, `StepObjectAssetRecordV3`, `BoxObjectAssetRecordV3`, `CylinderObjectAssetRecordV3`, `ObjectAssetRecordV3`, `RobotStepSourceAssetV3`, `RobotAssemblyPartRefV3`, `RobotLinkGeometryRecordV3`, `FixedSixAxisRobotManifestV1`, `RobotMechanicsProvenanceV3`, `ProjectExternalEntityTransformStateV3`, and `ProjectOpcUaEquipmentTransformBindingV3` with the spellings defined in Task 1.
- **Dependency gate:** No downstream feature plan may start until Task 6 and independent review pass.
