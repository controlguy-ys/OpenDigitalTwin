# Project V4 Core Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the dependency-free Project V4 aggregate, validation/canonical contracts, compiled Runtime Gateway boundary, and byte-free atomic revision persistence without yet exposing V4 authoring in the browser.

**Architecture:** Put all browser/Gateway-shared logic below `src/core`, expressed as immutable TypeScript with no platform imports. Compile `src/core` together with the new TypeScript Gateway into `dist-gateway`, while Vite imports the same source modules. Build a new V4 Dexie/revision lane that persists canonical JSON projections only; the V3 lane remains active until the P2 cutover and is then deleted rather than migrated.

**Tech Stack:** TypeScript 6.0.3, Dexie 4.4.4, Web Crypto, Vitest 4.1.10, Vite 8.1.4, Node 22.15.1, npm 11.4.2.

## Global Constraints

- Follow the approved V4 design and reject schema versions 1-3 as `PROJECT_SCHEMA_UNSUPPORTED`.
- Do not import React, Three.js, DOM, WebSocket, filesystem, or `node-opcua` from `src/core`.
- Use metres, Z-up, normalized quaternion `[x,y,z,w]`, and RPY degrees with `Rz * Ry * Rx`.
- Revolute Joint values/limits/Home/offset use degrees and maximum velocity uses degrees/second. Prismatic values use metres and maximum velocity uses metres/second.
- A Joint origin is a complete `RigidTransformV4`, not only a position.
- `AttachmentConstraintV4`, live state, interpolation, Lease data, and physical mounts are runtime-only and absent from canonical JSON.
- Use exact spec limits. To make otherwise-unbounded arrays deterministic, also lock 8 referenced Robot Definitions, 256 Scene Groups, 32 Moving Frames per Spatial Entity, 1,024 total Frames, and 256 Action Definitions; exact limit passes and plus one fails.
- Keep comments in English and preserve unrelated/untracked CAD files.
- Every task ends with focused tests, lint/build, and one commit.

---

## File Structure

**Create:**

- `src/core/project-v4/errors.ts` — stable coded validation failures with JSON paths.
- `src/core/project-v4/rigid-transform.ts` — dependency-free transform/quaternion/RPY math.
- `src/core/project-v4/limits.ts` — all V4 cardinality and resource constants.
- `src/core/project-v4/types.ts` — immutable aggregate and domain discriminated unions.
- `src/core/project-v4/validate.ts` — closed-record, reference, graph, and budget validation.
- `src/core/project-v4/canonical-json.ts` — deterministic JSON bytes and revision input.
- `src/core/project-v4/index.ts` — public Core exports.
- `src/core/runtime-protocol/v1.ts` — revision, state, command, Lease, status envelopes.
- `src/features/project/v4/project-v4-codec.ts` — UTF-8 canonical Project Blob encode/decode.
- `src/features/project/v4/project-v4-db.ts` — new `robot-sim-project-v4` Dexie database.
- `src/features/project/v4/project-v4-repository.ts` — crash-consistent revision/pointer store.
- `src/features/project/v4/project-v4-publication.ts` — generic async runtime publication.
- Matching `*.test.ts` files for every module above.
- `tsconfig.gateway.json` — emitted Node ESM build for `src/core` and Gateway sources.
- `middleware/runtime-gateway/main.ts` — Off-mode process entrypoint scaffold.
- `middleware/runtime-gateway/deployment-config.ts` and test.

**Modify:** `tsconfig.json`, `tsconfig.node.json`, `vitest.config.ts`, `package.json`, `middleware/Dockerfile`.

### Task 1: Add Pure Rigid Transform and Error Contracts

**Files:**
- Create: `src/core/project-v4/errors.ts`
- Create: `src/core/project-v4/rigid-transform.ts`
- Test: `src/core/project-v4/errors.test.ts`
- Test: `src/core/project-v4/rigid-transform.test.ts`

**Interfaces:**
- Produces: `ProjectV4Error`, `failProjectV4`, `RigidTransformV4`, quaternion normalization/composition/inversion, and RPY conversion used by every later plan.

- [x] **Step 1: Write RED transform and error tests**

```ts
it('composes RPY degrees as Rz * Ry * Rx without Three.js', () => {
  const q = rpyDegreesToQuaternionV4([10, 20, 30])
  expect(quaternionToMatrix3V4(q)).toEqualMatrix([
    0.8137976813, -0.4409696105, 0.3785223064,
    0.4698463104,  0.8825641193, 0.0180283112,
   -0.3420201433,  0.1631759112, 0.9254165784,
  ], 1e-9)
})

it('reports a stable code and JSON path', () => {
  expect(() => normalizeRigidTransformV4({
    positionM: [0, 0, 0], quaternion: [0, 0, 0, 0],
  }, '$.robots[0].localBasePose')).toThrowError(
    expect.objectContaining({ code: 'QUATERNION_NOT_NORMALIZABLE', path: '$.robots[0].localBasePose' }),
  )
})
```

- [x] **Step 2: Run RED**

```powershell
npm run test:run -- src/core/project-v4/errors.test.ts src/core/project-v4/rigid-transform.test.ts
```

Expected: FAIL because the Core modules do not exist.

- [x] **Step 3: Implement the public contracts**

```ts
export type Vector3V4 = readonly [number, number, number]
export type QuaternionV4 = readonly [number, number, number, number]
export interface RigidTransformV4 {
  readonly positionM: Vector3V4
  readonly quaternion: QuaternionV4
}

export class ProjectV4Error extends Error {
  constructor(
    readonly code: string,
    readonly path: string,
    message: string,
    readonly recovery?: string,
  ) { super(`${code} at ${path}: ${message}`) }
}

export function normalizeRigidTransformV4(
  value: RigidTransformV4,
  path: string,
): RigidTransformV4
export function composeRigidTransformV4(
  parent: RigidTransformV4,
  local: RigidTransformV4,
): RigidTransformV4
export function invertRigidTransformV4(value: RigidTransformV4): RigidTransformV4
export function relativeRigidTransformV4(
  referenceWorld: RigidTransformV4,
  targetWorld: RigidTransformV4,
): RigidTransformV4
export function rpyDegreesToQuaternionV4(rpyDeg: Vector3V4): QuaternionV4
export function quaternionToRpyDegreesV4(q: QuaternionV4): Vector3V4
```

Implement Hamilton quaternion multiplication and vector rotation directly. Canonicalize `-0` to `0` and choose a stable quaternion sign (`w > 0`, then Z/Y/X tie break) so equal transforms hash identically.

- [x] **Step 4: Run GREEN and dependency scan**

```powershell
npm run test:run -- src/core/project-v4
rg -n "from ['\"](react|three|node:|ws|node-opcua)|window|document" src/core
```

Expected: tests PASS and `rg` returns no matches.

- [x] **Step 5: Commit**

```powershell
git add src/core/project-v4/errors* src/core/project-v4/rigid-transform*
git diff --cached --check
git commit -m "feat: add project v4 transform core"
```

### Task 2: Define and Strictly Validate the V4 Aggregate

**Files:**
- Create: `src/core/project-v4/limits.ts`
- Create: `src/core/project-v4/types.ts`
- Create: `src/core/project-v4/validate.ts`
- Create: `src/core/project-v4/test-support.ts`
- Test: `src/core/project-v4/validate.test.ts`
- Create: `src/core/project-v4/index.ts`

**Interfaces:**
- Consumes: `RigidTransformV4`, `ProjectV4Error`.
- Produces: `WorkcellProjectV4`, all stable ID aliases/unions, `validateWorkcellProjectV4`, `preflightWorkcellProjectShapeV4`, and exact resource constants.

- [x] **Step 1: Write RED boundary/reference tests**

```ts
it.each([
  ['robots', 8, 9, 'ROBOT_INSTANCE_LIMIT_EXCEEDED'],
  ['robotDefinitions', 8, 9, 'ROBOT_DEFINITION_LIMIT_EXCEEDED'],
  ['joints', 16, 17, 'ROBOT_JOINT_LIMIT_EXCEEDED'],
  ['robotSources', 7, 8, 'ROBOT_STEP_SOURCE_LIMIT_EXCEEDED'],
  ['spatialEntities', 256, 257, 'SPATIAL_ENTITY_LIMIT_EXCEEDED'],
  ['sceneGroups', 256, 257, 'SCENE_GROUP_LIMIT_EXCEEDED'],
  ['movingFramesPerEntity', 32, 33, 'MOVING_FRAME_LIMIT_EXCEEDED'],
  ['totalFrames', 1_024, 1_025, 'PROJECT_FRAME_LIMIT_EXCEEDED'],
  ['actions', 256, 257, 'ACTION_LIMIT_EXCEEDED'],
])('%s accepts %i and rejects %i', (field, exact, plusOne, code) => {
  expect(() => validateWorkcellProjectV4(projectAtLimit(field, exact))).not.toThrow()
  expect(() => validateWorkcellProjectV4(projectAtLimit(field, plusOne))).toThrow(code)
})

it('rejects every dangling reference and frame cycle before returning a project', () => {
  expect(() => validateWorkcellProjectV4(projectWithMissingDefinition())).toThrow('ROBOT_DEFINITION_NOT_FOUND')
  expect(() => validateWorkcellProjectV4(projectWithFrameCycle())).toThrow('FRAME_CYCLE')
})

it.each([1, 2, 3])('rejects schema %i without migration', (schemaVersion) => {
  expect(() => validateWorkcellProjectV4({ schemaVersion })).toThrow('PROJECT_SCHEMA_UNSUPPORTED')
})
```

- [x] **Step 2: Run RED**

```powershell
npm run test:run -- src/core/project-v4/validate.test.ts
```

Expected: FAIL because the V4 types/validator are missing.

- [x] **Step 3: Implement immutable domain types**

```ts
export interface AssetReferenceV4 {
  readonly id: string
  readonly uri: `asset://${string}/${string}` | `builtin://${string}/${string}@${string}`
  readonly sha256: string
  readonly byteLength: number
  readonly sourceFileName: string
  readonly mediaType: 'model/step'
}

export type SourceOrientationV4 =
  | { readonly mode: 'up-axis'; readonly upAxis: 'x' | 'y' | 'z' }
  | { readonly mode: 'root-rotation'; readonly quaternion: QuaternionV4 }

export interface RobotJointDefinitionV4 {
  readonly id: string
  readonly type: 'revolute' | 'prismatic'
  readonly parentLinkId: string
  readonly childLinkId: string
  readonly origin: RigidTransformV4
  readonly axis: Vector3V4
  readonly min: number
  readonly max: number
  readonly home: number
  readonly zeroOffset: number
  readonly direction: 1 | -1
  readonly maximumVelocity: number
}

export interface RobotDefinitionV4 {
  readonly id: string
  readonly name: string
  readonly manufacturer: string
  readonly model: string
  readonly assetReferenceIds: readonly string[]
  readonly sourceConventions: Readonly<Record<string, {
    readonly linearUnit: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot'
    readonly sourceToMeters: number
    readonly orientation: SourceOrientationV4
  }>>
  readonly links: readonly RobotLinkDefinitionV4[]
  readonly joints: readonly RobotJointDefinitionV4[]
  readonly frames: readonly FrameDefinitionV4[]
}

export type RobotJobStepV4 =
  | { readonly kind: 'joint-pose'; readonly jointValues: Readonly<Record<string, number>>; readonly speedPercentToNext: number }
  | { readonly kind: 'action-reference'; readonly actionId: string }

export type RobotActionDefinitionV4 =
  | { readonly id: string; readonly kind: 'set-gripper-state'; readonly robotId: string; readonly state: 'OPEN' | 'CLOSED' }
  | { readonly id: string; readonly kind: 'attach-object'; readonly robotId: string; readonly toolFrameId: string; readonly objectId: string; readonly objectGraspFrameId?: string; readonly maximumDistanceM: number }
  | { readonly id: string; readonly kind: 'detach-object'; readonly objectId: string; readonly targetParentFrameId?: string }

export interface WorkcellProjectV4 {
  readonly schemaVersion: 4
  readonly projectId: string
  readonly revisionId: string
  readonly metadata: { readonly name: string; readonly createdAt: string; readonly updatedAt: string }
  readonly assetReferences: readonly AssetReferenceV4[]
  readonly scene: ProjectSceneV4
  readonly robotDefinitions: readonly RobotDefinitionV4[]
  readonly robots: readonly RobotInstanceV4[]
  readonly spatialEntities: readonly SpatialEntityV4[]
  readonly sceneGroups: readonly SceneGroupV4[]
  readonly jobs: readonly RobotJobV4[]
  readonly actions: readonly RobotActionDefinitionV4[]
  readonly opcUa: OpcUaProjectConfigurationV4
}
```

Complete the referenced types in the same file. Require every Robot Definition to be referenced, every Joint chain to be one connected serial chain, every axis to normalize, every Joint value to use the correct type-specific units, and every persisted ID to be globally unique.

- [x] **Step 4: Implement closed validation and deep freeze**

Validate dense arrays, exact allowed keys, finite numbers, UTF-8 identifier/name bounds, ISO timestamps, SHA-256, normalized logical URI syntax, all references, Frame graph cycles, Job exact Joint key sets, source/link counts, scene/OPC budgets, and total visible Geometry budgets. Return a deeply frozen clone; never return caller-owned mutable objects.

- [x] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/core/project-v4
npm run lint
git add src/core/project-v4
git diff --cached --check
git commit -m "feat: define project v4 contracts"
```

Expected: all exact/plus-one, reference, cycle, and schema rejection tests PASS.

### Task 3: Add Canonical JSON and Runtime Protocol Envelopes

**Files:**
- Create: `src/core/project-v4/canonical-json.ts`
- Test: `src/core/project-v4/canonical-json.test.ts`
- Create: `src/core/runtime-protocol/v1.ts`
- Test: `src/core/runtime-protocol/v1.test.ts`
- Modify: `src/core/project-v4/index.ts`

**Interfaces:**
- Produces: `canonicalProjectV4Json`, `canonicalProjectV4Bytes`, `configRevisionForProjectV4`, `StateBatchV1`, `CommandBatchV1`, `CommandRequestV1`, `CommandResultV1`, `RuntimePublisherLeaseV1`, and revision stage/activation envelopes.

- [x] **Step 1: Write RED canonical/protocol tests**

```ts
it('produces identical bytes for semantically identical object-key order', async () => {
  expect(canonicalProjectV4Bytes(projectA)).toEqual(canonicalProjectV4Bytes(reorderedProjectA))
  expect(await configRevisionForProjectV4(projectA)).toMatch(/^[a-f0-9]{64}$/)
})

it('rejects a state batch carrying an old or positional robot payload', () => {
  expect(() => validateStateBatchV1({ protocolVersion: 1, anglesDeg: [0, 0, 0, 0, 0, 0] }))
    .toThrow('RUNTIME_PROTOCOL_INVALID')
})
```

- [x] **Step 2: Implement canonical serialization**

Sort object keys lexicographically, preserve validated array order, normalize `-0`, reject non-finite values, and emit UTF-8 without whitespace. Do not sort Robot/Job/step arrays because their order is semantic.

```ts
export function canonicalProjectV4Json(project: WorkcellProjectV4): string
export function canonicalProjectV4Bytes(project: WorkcellProjectV4): Uint8Array
export async function configRevisionForProjectV4(project: WorkcellProjectV4): Promise<string>
```

- [x] **Step 3: Implement versioned envelopes**

```ts
export interface StateBatchV1 {
  readonly protocolVersion: 1
  readonly gatewayId: string
  readonly projectId: string
  readonly configRevision: string
  readonly endpointId: string
  readonly sequence: number
  readonly sourceTimestampMs: number
  readonly publishedTimestampMs: number
  readonly originId: string
  readonly values: readonly RuntimeMappedValueV1[]
}

export interface RuntimePublisherLeaseV1 {
  readonly projectId: string
  readonly configRevision: string
  readonly publisherId: string
  readonly generation: number
  readonly expiresAt: number
}

export interface CommandRequestV1 {
  readonly protocolVersion: 1
  readonly commandId: string
  readonly projectId: string
  readonly configRevision: string
  readonly leaseGeneration: number
  readonly expiresAt: number
  readonly targetId: string
  readonly value?: RuntimeScalarOrStructureV1
}
```

Define explicit acknowledgement/execution-state/result unions and validators; never use `unknown` past the decode boundary.

- [x] **Step 4: Run GREEN and commit**

```powershell
npm run test:run -- src/core/project-v4/canonical-json.test.ts src/core/runtime-protocol/v1.test.ts
git add src/core/project-v4 src/core/runtime-protocol
git diff --cached --check
git commit -m "feat: add v4 canonical runtime contracts"
```

### Task 4: Create the Compiled TypeScript Gateway Boundary

**Files:**
- Create: `tsconfig.gateway.json`
- Create: `middleware/runtime-gateway/deployment-config.ts`
- Test: `middleware/runtime-gateway/deployment-config.test.ts`
- Create: `middleware/runtime-gateway/main.ts`
- Modify: `tsconfig.json`
- Modify: `tsconfig.node.json`
- Modify: `vitest.config.ts`
- Modify: `package.json`
- Modify: `middleware/Dockerfile`

**Interfaces:**
- Consumes: `src/core/project-v4` and `src/core/runtime-protocol` source.
- Produces: emitted `dist-gateway/middleware/runtime-gateway/main.js`, `build:gateway`, and a typed Off-mode process. P4/P5 add behavior to this process.

- [x] **Step 1: Write RED configuration tests**

```ts
// @vitest-environment node
it('validates deployment ports without owning active Project mode', () => {
  const config = readDeploymentConfig({})
  expect(config).toMatchObject({
    httpPort: 8081, websocketPath: '/runtime/ws', opcUaPort: 4840,
  })
  expect(config).not.toHaveProperty('mode')
})
```

- [x] **Step 2: Add the emitted build configuration**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": ".",
    "outDir": "dist-gateway",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "types": ["node"]
  },
  "include": ["src/core/**/*.ts", "middleware/runtime-gateway/**/*.ts"],
  "exclude": ["**/*.test.ts"]
}
```

Add scripts:

```json
{
  "build:gateway": "tsc -p tsconfig.gateway.json",
  "runtime:gateway": "node dist-gateway/middleware/runtime-gateway/main.js"
}
```

- [x] **Step 3: Implement and build the Off-mode scaffold**

`main.ts` must parse deployment-only environment values, report an effective pre-Apply Off state without storing mode in deployment configuration, start no OPC UA object before an active Project exists, install SIGINT/SIGTERM shutdown, and expose its service construction through a testable factory rather than executing on import.

```powershell
npm run build:gateway
node dist-gateway/middleware/runtime-gateway/main.js --check-config
```

Expected: both commands exit 0; no `tsx` runtime is required.

- [x] **Step 4: Update the Gateway Docker build stage**

Use a build stage with dev dependencies to run `npm run build:gateway`, then a production stage with `npm ci --omit=dev` and copied `dist-gateway`. Do not yet replace the current Compose service; P5 owns the production Compose/Nginx cutover after Client, Server, and Bridge behavior exists.

- [x] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- middleware/runtime-gateway/deployment-config.test.ts
npm run build:gateway
npm run build
git add tsconfig*.json vitest.config.ts package.json package-lock.json middleware/Dockerfile middleware/runtime-gateway
git diff --cached --check
git commit -m "build: add typed runtime gateway target"
```

### Task 5: Add Byte-Free V4 Revision Persistence

**Files:**
- Create: `src/features/project/v4/project-v4-codec.ts`
- Test: `src/features/project/v4/project-v4-codec.test.ts`
- Create: `src/features/project/v4/project-v4-db.ts`
- Test: `src/features/project/v4/project-v4-db.test.ts`
- Create: `src/features/project/v4/project-v4-repository.ts`
- Test: `src/features/project/v4/project-v4-repository.test.ts`
- Create: `src/features/project/v4/project-v4-publication.ts`
- Test: `src/features/project/v4/project-v4-publication.test.ts`

**Interfaces:**
- Consumes: `WorkcellProjectV4`, canonical bytes, `configRevisionForProjectV4`.
- Produces: `ProjectRepositoryV4`, `PreparedProjectRuntimeBundleV4<R>`, `ProjectRuntimeV4<R>`, `PublishedProjectBundleV4`, `ProjectPublicationCoordinatorV4`, and plain canonical JSON import/export.
- Ownership: P1 owns `PublishedProjectBundleV4`; P2 is the sole owner of `ProjectMutationServiceV4`, which P1 does not define.

- [x] **Step 1: Write RED codec/repository failure-injection tests**

```ts
it('exports canonical JSON without STEP bytes or physical paths', async () => {
  const blob = encodeProjectV4(projectWithLogicalAssets())
  const text = await blob.text()
  expect(text).toContain('asset://cell-library/fixture.step')
  expect(text).not.toMatch(/sourceBytes|[A-Z]:\\|\/srv\//)
})

it('keeps the old pointer and runtime when candidate apply fails', async () => {
  runtime.prepare.mockResolvedValue({
    project: projectB,
    revisionId: projectB.revisionId,
    resources: resourcesB,
  })
  runtime.apply.mockRejectedValue(new Error('apply failed'))
  await expect(coordinator.replace({
    candidate: projectB,
    expectedRevisionId: projectA.revisionId,
  })).rejects.toThrow('apply failed')
  expect(await repository.readActive()).toEqual(projectA)
  expect(coordinator.readPublished()?.project).toEqual(projectA)
})
```

- [x] **Step 2: Implement a new V4 database**

```ts
export function encodeProjectV4(project: WorkcellProjectV4): Blob
export function decodeProjectV4(
  source: Blob | Uint8Array | ArrayBuffer,
): Promise<WorkcellProjectV4>

export class ProjectDatabaseV4 extends Dexie {
  projectRevisions!: Table<StoredProjectRevisionV4, string>
  projectPointers!: Table<StoredProjectPointerV4, string>
  projectCommitTokens!: Table<StoredProjectCommitTokenV4, string>

  constructor(name = 'robot-sim-project-v4') {
    super(name)
    this.version(1).stores({
      projectRevisions: '&revisionId,projectId',
      projectPointers: '&key,state,revisionId',
      projectCommitTokens: '&commitToken,revisionId',
    })
  }
}
```

Do not open or migrate `robot-sim-project`; do not create a source-blob table.

- [x] **Step 3: Implement async publication interfaces**

```ts
export interface PreparedProjectRuntimeBundleV4<R> {
  readonly project: WorkcellProjectV4
  readonly revisionId: string
  readonly resources: R
}

export interface ProjectRuntimeV4<R> {
  prepare(
    project: WorkcellProjectV4,
    revisionId: string,
  ): Promise<PreparedProjectRuntimeBundleV4<R>>
  apply(bundle: PreparedProjectRuntimeBundleV4<R>): Promise<AppliedProjectRuntimePublicationV4>
  dispose(bundle: PreparedProjectRuntimeBundleV4<R>): Promise<void> | void
}

export interface AppliedProjectRuntimePublicationV4 {
  commit(): Promise<void> | void
  rollback(): Promise<void> | void
  cleanup(): Promise<void> | void
}

export interface ProjectPublicationRequestV4 {
  readonly candidate: WorkcellProjectV4
  readonly expectedRevisionId: string | null
}

export interface PublishedProjectBundleV4 {
  readonly project: WorkcellProjectV4
  readonly revisionId: string
  readonly configRevision: string
}

export interface ProjectPublicationCoordinatorV4 {
  replace(request: ProjectPublicationRequestV4): Promise<PublishedProjectBundleV4>
  restorePublished(bundle: PublishedProjectBundleV4): Promise<PublishedProjectBundleV4>
  readPublished(): PublishedProjectBundleV4 | null
  isRecoveryRequired(): boolean
}
```

Preserve serialized mutation, expected-revision compare, prepared pointer, compensation, commit-token uniqueness, and recovery-required behavior from the V3 coordinator. The V4 implementation operates on canonical JSON only.

- [x] **Step 4: Prove rejection and crash recovery**

Test V1/V2/V3 decode rejection before DB writes, stale expected revision, failure before pointer, failure after pointer with compensation, crash at publishing pointer, restore/finalize, and garbage collection retaining active revision.

- [x] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/project/v4
npm run lint
npm run build
git add src/features/project/v4
git diff --cached --check
git commit -m "feat: persist byte-free project v4 revisions"
```

### Task 6: Prove the Dark V4 Foundation Gate

**Files:**
- Create: `src/core/project-v4/core-boundary.test.ts`
- Create: `middleware/runtime-gateway/core-source-boundary.test.ts`
- Modify: `package.json`
- Modify: `docs/superpowers/plans/2026-07-16-project-v4-core-contracts.md`

**Interfaces:**
- Produces: a green shared Core and persistence lane ready for P2; no browser V4 authoring is exposed yet.

- [x] **Step 1: Add the dependency-boundary test**

Read every `src/core/**/*.ts` import and fail if it resolves to React, Three.js, Node built-ins, Web APIs, `ws`, or `node-opcua`. Import the Core from one browser test and one Node-environment Gateway test to prove both compiler targets consume the same source.

- [x] **Step 2: Run the P1 gate**

```powershell
npm run test:run -- src/core src/features/project/v4 middleware/runtime-gateway
npm run lint
npm run build:gateway
npm run build
git status --short
```

Expected: PASS; only intentional plan/status edits remain, and untracked CAD folders remain unstaged.

- [x] **Step 3: Commit the gate evidence**

Record exact test counts/results in this plan, then:

```powershell
git add package.json docs/superpowers/plans/2026-07-16-project-v4-core-contracts.md `
  src/core/project-v4/core-boundary.test.ts `
  middleware/runtime-gateway/core-source-boundary.test.ts
git diff --cached --check
git commit -m "test: prove project v4 core boundary"
```

## P1 Gate Evidence - 2026-07-17 (Asia/Seoul)

- Gate commit base/head: base `64543fa34d06e6a4dddde3fa4f482a0a90714f39`;
  head is the commit containing this section, with message
  `test: prove project v4 core boundary`. Its SHA is recorded after commit in the
  ignored Task 6 report and implementation handoff because a commit cannot
  contain its own hash.
- Boundary RED preceded both test files: Vitest exited 1 with `No test files
  found` for the two exact boundary paths. Boundary GREEN passed 2 files and 3
  tests.
- The focused P1 gate passed 14 files and 241 tests; the complete repository
  regression gate passed 136 files and 1,244 tests. Both ran serially.
- The TypeScript-parser source graph scanned the exact Gateway-emitted Core set:
  8 production files and 20 module specifiers, with zero external specifiers,
  unresolved/ambiguous relative specifiers, forbidden platform identifiers,
  triple-slash/ambient references, parse diagnostics, or AST/preprocess
  mismatches.
- The default-jsdom browser consumer and explicit Node Gateway consumer both
  validated the deterministic Project and keyed Runtime Protocol fixture, and
  both matched the independently derived golden config revision
  `e679de7f286e2aa5bd2c3e9ca72c32916d527c9b7a68af7a7639dc16ba519969`.
- Lint, Gateway TypeScript emit, emitted `--check-config`, and the browser
  production build each exited 0. The emitted smoke reported deployment defaults
  and a not-ready Off state with no active revision.
- No generated-output, dependency, report, result, or `.tsbuildinfo` path is
  tracked; `package-lock.json` did not change. The main checkout's existing
  untracked CAD directories remained present and unstaged.
- The production build retained exactly the known warnings: OCCT caused browser
  externalization notices for `path` and `crypto`, and Vite reported one chunk
  larger than 500 kB after minification.
- P1 is a dark foundation only. V4 Core, Gateway, and persistence contracts are
  verified, but browser V4 authoring remains unexposed until P2.
