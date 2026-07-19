# OPC UA Client Write and Job I/O Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute Project V5 `set-do`, `wait-di`, `delay`, `attach`, and `detach` instructions deterministically, with Boolean outputs written through the Runtime Gateway OPC UA Client and subscribed logical inputs represented by quality-aware browser runtime state.

**Architecture:** Keep Project V5 definitions immutable and build three runtime boundaries around them: a browser logical-signal store for subscribed values, a revision/lease-fenced Runtime Protocol command path for OPC UA writes, and an attachment runtime overlay for pose-preserving pick/place. The Job executor consumes only small Signal and Attachment ports, so Simulation timing, OPC UA transport, and Three.js presentation remain independently testable.

**Tech Stack:** TypeScript 6.0.3, React 19.2.7, Zustand 5.0.14, Three.js 0.185.1, node-opcua 2.175.0, Vitest 4.1.10, Node 22.15.1, npm 11.4.2.

## Global Constraints

- Execute after Milestone 1 connectivity stabilization and Milestone 2 Project V5 core contracts have landed.
- Consume `WorkcellProjectV5`, `LogicalSignalV1`, `RobotJobInstructionV1`, `OpcUaMappingV5`, `OpcUaNodeAddressV1`, and `validateWorkcellProjectV5` from `src/core/project-v5/index.ts`; do not reopen or duplicate those contracts.
- Consume `RigidTransformV5`, `normalizeRigidTransformV5`, `composeRigidTransformV5`, and `relativeRigidTransformV5` from the standalone `src/core/project-v5/rigid-transform.ts` module delivered by Milestone 2; do not import Project V4 transform types.
- Consume `RuntimeGatewayStatusV1` from `src/core/runtime-protocol/gateway-status-v1.ts` and `RuntimePublisherLeaseV1`, `CommandRequestV1`, `CommandResultV1`, `StateBatchV1`, and their validators from `src/core/runtime-protocol/v1.ts`.
- Cut `src/core/runtime-protocol/v1.ts` atomically from its Project V4 imports to `WorkcellProjectV5` and `validateWorkcellProjectV5`. The wire envelope remains Runtime Protocol v1 for this closed deployment, but a staged Project payload is V5-only and V4 fails before adapter preparation.
- In Task 3, cut the existing OPC UA Server adapter input to validated Project V5 before `main.ts` becomes V5-only. Preserve Off/Client/Server/Bridge activation and the temporary custom read-only telemetry tree; official Robotics NodeSets and model semantics remain Milestone 4 work. Never cast or translate V5 through Project V4.
- Use `OpcUaMappingV5.id` as `CommandRequestV1.targetId`; Job instructions and runtime state continue to address stable `LogicalSignalV1.id` values.
- `set-do` may target only a Boolean `output` or `bidirectional` Signal with exactly one enabled `write` or `readWrite` Mapping.
- `wait-di` may observe only a Boolean `input` or `bidirectional` Signal and completes only from current `GOOD` quality. `BAD`, `UNCERTAIN`, and `STALE` retained values cannot satisfy it.
- A disconnect retains the last display value, changes its quality to `STALE`, sets status to `BadNoCommunication`, and never transfers ownership to Manual.
- One SetDO instruction issues one OPC UA `Session.write`; it advances only after a terminal `SUCCEEDED` result. Any rejection or failed write fails the Job with the returned stable code.
- The Gateway rejects wrong Project, wrong Revision, stale lease generation, expired request, disconnected Endpoint, type mismatch, and direction mismatch before calling `Session.write`.
- Retain at most 4,096 command deduplication records. An identical duplicate of an admitted record returns the retained in-flight/terminal result even after the original request expiry; preflight-rejected records are not retained. A reused admitted Command ID with a different fingerprint fails as `COMMAND_ID_CONFLICT` without a second write. Temporal and target preflight applies only to a new record and runs before admission. Evict the oldest terminal record before admitting a new record; if all 4,096 records are in-flight, reject the new command before its operation starts as `COMMAND_DEDUPE_CAPACITY_EXHAUSTED`.
- The Client-write command lease uses publisher ID `${gatewayId}:client-write`, a five-second TTL refreshed on every `GET /runtime/command-lease`, and the active activation generation. A command expiry must be no later than both the returned lease expiry and five seconds after command creation.
- `attach` and `detach` use only the IDs in the instruction. Never search selection, collision candidates, names, or a nearest Object; gripper state does not imply attachment state.
- Attach and Detach preserve Object World pose. An OPC UA-owned Object fails as `SOURCE_OWNERSHIP_CONFLICT`; an already attached Object fails as `ALREADY_ATTACHED`; an out-of-range attach fails as `OUT_OF_RANGE`.
- `targetParentFrameId: null` on Detach means the Object's authored Project parent Frame. Runtime attachment and detached-pose overrides are absent from canonical Project JSON and revision hashing.
- Do not add manufacturer program generation, security configuration, Legacy Adoption, migration aliases, polling reads for WaitDI, a physics engine, or PLC deployment/write outside the configured OPC UA Client Mapping.
- Keep comments in English, preserve unrelated user files, and never stage external CAD directories or `.pnpm-store`.
- Every task follows RED, focused GREEN, `git diff --check`, and one commit.

---

## File Structure

**Create:**

- `src/features/signals/v5/logical-signal-runtime-store.ts` and test — quality-aware Signal values compiled from V5 read Mappings.
- `src/features/scene/v5/object-runtime-state.ts` and test — V5 Object pose/status ownership, smoothing, freshness, and disconnect state compiled from read Mappings.
- `src/features/robot/v5/robot-frame-status-runtime-store.ts` and test — V5 Robot Frame/status subscription state, ownership, smoothing, and disconnect behavior.
- `middleware/runtime-gateway/opcua-client-write-service.ts` and test — deterministic Mapping compilation, Namespace-URI resolution, type conversion, and one OPC UA write.
- `middleware/runtime-gateway/runtime-command-dedupe-registry.ts` and test — one active-Revision, direction-neutral 4,096-record command deduplication budget shared by Client writes and later Server commands.
- `middleware/runtime-gateway/runtime-command-service.ts` and test — command fencing, expiry, stable results, and Client-write execution through the shared registry.
- `src/features/runtime-gateway/v5/runtime-gateway-command-client.ts` and test — browser lease acquisition and Runtime Protocol command transport.
- `src/features/runtime-gateway/v5/runtime-gateway-state-stream.ts` and test — one V1 WebSocket stream with isolated V5 runtime consumers.
- `src/core/robot-runtime-v5/serial-kinematics.ts` and test — dependency-free V5 serial-chain Forward Kinematics and live Robot Frame world poses; no V4 import.
- `src/features/robot/v5/robot-joint-runtime-store.ts` and test — the V5 Simulation-owned Joint state used by MoveJoint.
- `src/features/jobs/v5/job-runtime-store.ts` and test — V5 per-Robot Job progress and terminal results.
- `src/features/jobs/v5/job-executor.ts` and test — MoveJoint, SetDO, WaitDI, Delay, Attach, and Detach execution.
- `src/features/jobs/v5/simulation-clock.ts` and test — one nondecreasing Simulation clock loop for V5 Jobs.
- `src/core/action-runtime-v5/attachment-instruction-error.ts` and test — one closed stable error producer/validator shared by the Job executor and Attachment ports.
- `src/core/action-runtime-v5/attachment-transition.ts` and test — pure pose-preserving Attach/Detach calculations.
- `src/core/action-runtime-v5/index.ts` — public attachment transition exports.
- `src/features/actions/v5/attachment-runtime-store.ts` and test — runtime-only attachment and detached-pose records.
- `src/features/actions/v5/browser-attachment-instruction-port.ts` and test — ID-based frame lookup and atomic transition commit.
- `src/features/scene/v5/attachment-pose-runtime.ts` and test — attachment/detached pose projection through injected live Frame readers.
- `src/features/project/v5/browser-runtime-bundle-store-v5.ts` and test — one revision-aligned V5 runtime snapshot.
- `src/features/project/v5/browser-project-runtime-v5.ts` and test — atomic preparation, replacement, reset, and disposal of V5 runtime resources.
- `middleware/runtime-gateway/opcua-client-write.integration.test.ts` — local OPC UA Server write, disconnect, and duplicate evidence.
- `src/features/jobs/v5/job-io.integration.test.ts` — authored-order Job I/O and attachment evidence.

**Modify:**

- `src/core/runtime-protocol/v1.ts` and test — remove all Project V4 imports and make revision staging V5-only.
- `middleware/runtime-gateway/opcua-client-adapter.ts` and test — expose one write boundary on the active Endpoint Session.
- `middleware/runtime-gateway/opcua-server-adapter.ts` and test — narrow compatibility cutover from V4 input to validated V5 while retaining temporary Server/Bridge telemetry until Milestone 4.
- `middleware/runtime-gateway/main.ts` and test — active command generation, lease route, command route, and adapter wiring.
- `middleware/runtime-gateway/opcua-client-adapter.ts` and test are converted from V4 Project input to the V5 Project/Mapping contract; no V4 browser runtime file is modified.
- `package.json` — add a focused `test:job-io` verification script.

## Runtime Interfaces Used Across Tasks

These signatures are fixed for this plan. Later tasks consume them verbatim.

```ts
export type LogicalSignalRuntimeQualityV1 = 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE'

export interface LogicalSignalRuntimeValueV1 {
  readonly signalId: string
  readonly value: boolean | number | string
  readonly quality: LogicalSignalRuntimeQualityV1
  readonly statusCode: string
  readonly sourceTimestampMs: number
  readonly publishedTimestampMs: number
  readonly receivedTimestampMs: number
  readonly owner: 'initial' | 'simulation' | `opcua:${string}`
}

export interface LogicalSignalRuntimeStoreV1 {
  readonly projectRevisionId: string | null
  readonly configRevision: string | null
  readonly bySignalId: Readonly<Record<string, LogicalSignalRuntimeValueV1>>
  replaceProject(project: WorkcellProjectV5, configRevision: string): void
  ingest(batch: StateBatchV1, receivedTimestampMs: number): boolean
  markEndpointDisconnected(endpointId: string, atMs: number): void
  resetGatewaySession(atMs: number): void
  read(signalId: string): LogicalSignalRuntimeValueV1 | null
}

export interface ObjectFrameRuntimeValueV5 {
  readonly entityId: string
  readonly frameId: string
  readonly worldPose: RigidTransformV5 | null
  readonly quality: LogicalSignalRuntimeQualityV1
  readonly statusCode: string
  readonly owner: 'manual' | 'simulation' | `opcua:${string}` | 'attachment'
  readonly sourceTimestampMs: number
  readonly receivedTimestampMs: number
}

export interface ObjectNumericStatusRuntimeValueV5 {
  readonly entityId: string
  readonly value: number | null
  readonly quality: LogicalSignalRuntimeQualityV1
  readonly statusCode: string
  readonly owner: 'manual' | 'simulation' | `opcua:${string}`
  readonly sourceTimestampMs: number
  readonly receivedTimestampMs: number
}

export interface ObjectRuntimeStateV5 {
  readonly projectRevisionId: string | null
  readonly configRevision: string | null
  replaceProject(project: WorkcellProjectV5, configRevision: string): void
  ingest(batch: StateBatchV1, receivedTimestampMs: number): boolean
  sampleFrame(entityId: string, frameId: string, renderTimestampMs: number): ObjectFrameRuntimeValueV5 | null
  readNumericStatus(entityId: string): ObjectNumericStatusRuntimeValueV5 | null
  markEndpointDisconnected(endpointId: string, atMs: number): void
  resetGatewaySession(atMs: number): void
}

export interface RobotFrameRuntimeValueV5 {
  readonly robotId: string
  readonly frameId: string
  readonly worldPose: RigidTransformV5 | null
  readonly quality: LogicalSignalRuntimeQualityV1
  readonly statusCode: string
  readonly owner: 'manual' | 'simulation' | `opcua:${string}`
  readonly sourceTimestampMs: number
  readonly receivedTimestampMs: number
}

export interface RobotFrameStatusRuntimeStoreV5 {
  readonly projectRevisionId: string | null
  readonly configRevision: string | null
  replaceProject(project: WorkcellProjectV5, configRevision: string): void
  ingest(batch: StateBatchV1, receivedTimestampMs: number): boolean
  sampleFrame(robotId: string, frameId: string, renderTimestampMs: number): RobotFrameRuntimeValueV5 | null
  readNumericStatus(robotId: string): Readonly<{
    value: number | null
    quality: LogicalSignalRuntimeQualityV1
    statusCode: string
    owner: 'manual' | 'simulation' | `opcua:${string}`
  }> | null
  markEndpointDisconnected(endpointId: string, atMs: number): void
  resetGatewaySession(atMs: number): void
}

export interface GatewaySignalWritePortV1 {
  writeBoolean(signalId: string, value: boolean): Promise<CommandResultV1>
}

export interface AttachmentInstructionPortV1 {
  attach(instruction: Extract<RobotJobInstructionV1, { readonly kind: 'attach' }>, context: JobInstructionContextV1): Promise<void>
  detach(instruction: Extract<RobotJobInstructionV1, { readonly kind: 'detach' }>, context: JobInstructionContextV1): Promise<void>
}

export type AttachmentInstructionFailureCodeV1 =
  | 'SOURCE_OWNERSHIP_CONFLICT'
  | 'ALREADY_ATTACHED'
  | 'NOT_ATTACHED'
  | 'OUT_OF_RANGE'
  | 'ATTACHMENT_TARGET_NOT_FOUND'
  | 'ATTACHMENT_FRAME_UNAVAILABLE'

export class AttachmentInstructionErrorV1 extends Error {
  readonly code: AttachmentInstructionFailureCodeV1
}

export function createAttachmentInstructionErrorV1(
  code: AttachmentInstructionFailureCodeV1,
  message: string,
): AttachmentInstructionErrorV1

export function isAttachmentInstructionErrorV1(
  value: unknown,
): value is AttachmentInstructionErrorV1

export interface JobInstructionContextV1 {
  readonly jobId: string
  readonly robotId: string
  readonly runId: string
  readonly simulationMs: number
}
```

### Task 1: Build Quality-Aware Signal and Smoothed Object Runtime State

**Files:**
- Modify: `src/core/runtime-interpolation/v1.ts`
- Test: `src/core/runtime-interpolation/v1.test.ts`
- Create: `src/features/signals/v5/logical-signal-runtime-store.ts`
- Test: `src/features/signals/v5/logical-signal-runtime-store.test.ts`
- Create: `src/features/scene/v5/object-runtime-state.ts`
- Test: `src/features/scene/v5/object-runtime-state.test.ts`
- Create: `src/features/robot/v5/robot-frame-status-runtime-store.ts`
- Test: `src/features/robot/v5/robot-frame-status-runtime-store.test.ts`

**Interfaces:**
- Consumes: `WorkcellProjectV5`, logical-signal/entity-frame/entity-status/robot-frame/robot-status Mapping targets, Mapping `projectPath`, `StateBatchV1`, `RuntimeValueQualityV1`, and the runtime interpolation functions after making their public types and names genuinely Project-version-neutral.
- Produces: `LogicalSignalRuntimeStoreV1`, `ObjectRuntimeStateV5`, `RobotFrameStatusRuntimeStoreV5`, `createLogicalSignalRuntimeStoreV1(project, configRevision)`, `createObjectRuntimeStateV5(project, configRevision)`, and `createRobotFrameStatusRuntimeStoreV5(project, configRevision)`.

- [ ] **Step 1: Write the RED Signal ingestion tests**

First add a runtime-interpolation boundary regression: `src/core/runtime-interpolation/v1.ts` must import neither `project-v4` nor `project-v5`, expose structural `RuntimeVector3V1`, `RuntimeQuaternionV1`, and `RuntimeRigidTransformV1` types, and export `interpolateRuntimeRigidTransformV1` rather than the V4-named `interpolateRigidTransformV4`. Update the existing interpolation tests to the neutral export. Do not retain a legacy V4 alias. Preserve the existing quaternion normalization, finite-value validation, deep freezing, shortest-arc SLERP, delayed sampling, and stale behavior.

```ts
it('publishes a subscribed GOOD Boolean by stable Signal ID', () => {
  const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)
  expect(runtime.getState().ingest(signalBatch({ sequence: 1, value: true }), 1_050)).toBe(true)
  expect(runtime.getState().read('part-present')).toMatchObject({
    signalId: 'part-present', value: true, quality: 'GOOD',
    owner: 'opcua:plc', sourceTimestampMs: 1_000, publishedTimestampMs: 1_020,
  })
})

it('retains the last GOOD Signal payload when a later value is UNCERTAIN', () => {
  const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)
  runtime.getState().ingest(signalBatch({ sequence: 1, value: true, quality: 'GOOD' }), 1_050)
  runtime.getState().ingest(signalBatch({
    sequence: 2, sourceTimestampMs: 1_100, value: false,
    quality: 'UNCERTAIN', statusCode: 'UncertainLastUsableValue',
  }), 1_150)
  expect(runtime.getState().read('part-present')).toMatchObject({
    value: true, quality: 'UNCERTAIN', statusCode: 'UncertainLastUsableValue',
    sourceTimestampMs: 1_100, receivedTimestampMs: 1_150,
  })
})

it('retains the last value but marks disconnect STALE', () => {
  const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)
  runtime.getState().ingest(signalBatch({ sequence: 1, value: true }), 1_050)
  runtime.getState().markEndpointDisconnected('plc', 1_100)
  expect(runtime.getState().read('part-present')).toMatchObject({
    value: true, quality: 'STALE', statusCode: 'BadNoCommunication',
    receivedTimestampMs: 1_100,
  })
})

it('rejects old sequence, wrong revision, wrong endpoint, and non-Boolean payload', () => {
  const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)
  expect(runtime.getState().ingest(signalBatch({ sequence: 2, value: false }), 2_000)).toBe(true)
  expect(runtime.getState().ingest(signalBatch({ sequence: 1, value: true }), 2_010)).toBe(false)
  expect(runtime.getState().ingest(signalBatch({ configRevision: OTHER_REVISION }), 2_020)).toBe(false)
  expect(runtime.getState().ingest(signalBatch({ endpointId: 'unknown' }), 2_030)).toBe(false)
  expect(runtime.getState().ingest(signalBatch({ sequence: 3, value: 1 }), 2_040)).toBe(true)
  expect(runtime.getState().read('part-present')).toMatchObject({
    value: false, quality: 'BAD', statusCode: 'BadTypeMismatch',
  })
})
```

Add Object regressions using a PLC `Double[6]` source whose `leafPath` values are `[0]..[5]` and whose `projectPath` values are `positionM[0..2]` plus `rpyDegrees[0..2]`:

```ts
it('samples a coherent OPC UA-owned Object Frame two publishing cycles behind', () => {
  const runtime = createObjectRuntimeStateV5(
    projectWithArrayMappedBox({ publishingIntervalMs: 100 }), REVISION,
  )
  runtime.ingest(objectPoseBatch({
    sequence: 1, sourceTimestampMs: 1_000, positionM: [0, 0, 0], yaw: 0,
  }), 1_000)
  runtime.ingest(objectPoseBatch({
    sequence: 2, sourceTimestampMs: 1_100, positionM: [1, 0, 0], yaw: 90,
  }), 1_100)
  expect(runtime.sampleFrame('box', 'box-motion', 1_250)).toMatchObject({
    sourceTimestampMs: 1_050,
    worldPose: { positionM: [0.5, 0, 0] }, quality: 'GOOD', owner: 'opcua:plc',
  })
})

it('retains the Object but marks it STALE and keeps OPC UA ownership on disconnect', () => {
  const runtime = createObjectRuntimeStateV5(projectWithArrayMappedBox(), REVISION)
  runtime.ingest(objectPoseBatch({ sequence: 1 }), 1_000)
  runtime.markEndpointDisconnected('plc', 1_100)
  expect(runtime.sampleFrame('box', 'box-motion', 1_100)).toMatchObject({
    quality: 'STALE', statusCode: 'BadNoCommunication', owner: 'opcua:plc',
  })
})

it('keeps Object Frame and numeric Status channels independent', () => {
  const runtime = createObjectRuntimeStateV5(
    projectWithMappedBoxFrameAndStatusOnSeparateEndpoints(), REVISION,
  )
  runtime.ingest(objectPoseBatch({ endpointId: 'motion-plc', sequence: 1 }), 1_000)
  runtime.ingest(objectStatusBatch({ endpointId: 'status-plc', sequence: 1, status: 7 }), 1_010)
  runtime.markEndpointDisconnected('motion-plc', 1_100)
  expect(runtime.sampleFrame('box', 'box-motion', 1_100)).toMatchObject({ quality: 'STALE' })
  expect(runtime.readNumericStatus('box')).toMatchObject({
    value: 7, quality: 'GOOD', owner: 'opcua:status-plc',
  })
})

it('ingests a coherent Robot Frame and numeric Status, then retains both STALE', () => {
  const runtime = createRobotFrameStatusRuntimeStoreV5(projectWithMappedRobotTcpAndStatus(), REVISION)
  runtime.ingest(robotFrameStatusBatch({ sequence: 1, positionM: [0.4, 0.1, 0.8], yaw: 30, status: 7 }), 1_000)
  expect(runtime.sampleFrame('robot-a', 'TCP', 1_000)).toMatchObject({
    worldPose: { positionM: [0.4, 0.1, 0.8] }, quality: 'GOOD', owner: 'opcua:plc',
  })
  expect(runtime.readNumericStatus('robot-a')).toMatchObject({ value: 7, quality: 'GOOD', owner: 'opcua:plc' })
  runtime.markEndpointDisconnected('plc', 1_100)
  expect(runtime.sampleFrame('robot-a', 'TCP', 1_100)).toMatchObject({
    quality: 'STALE', statusCode: 'BadNoCommunication', owner: 'opcua:plc',
  })
  expect(runtime.readNumericStatus('robot-a')).toMatchObject({
    value: 7, quality: 'STALE', statusCode: 'BadNoCommunication', owner: 'opcua:plc',
  })
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/core/runtime-interpolation/v1.test.ts src/features/signals/v5/logical-signal-runtime-store.test.ts src/features/scene/v5/object-runtime-state.test.ts src/features/robot/v5/robot-frame-status-runtime-store.test.ts
```

Expected: FAIL because the V5 logical-Signal, Object, and Robot Frame/status runtime modules do not exist.

- [ ] **Step 3: Implement exact Mapping compilation and immutable snapshots**

Make `src/core/runtime-interpolation/v1.ts` self-contained before the V5 stores consume it. Define and validate its structural tuple/pose types locally, implement RPY-to-quaternion and rigid-transform normalization locally, and use only neutral V1 names throughout the module. This is a type-boundary cleanup only: existing structurally compatible V4 callers must continue to compile without conversion or casts, while new V5 callers must not acquire any V4 dependency.

```ts
export function createLogicalSignalRuntimeStoreV1(
  projectInput: WorkcellProjectV5,
  configRevision: string,
): StoreApi<LogicalSignalRuntimeStoreV1>
```

Require `configRevision` to be the lowercase 64-hex result of `configRevisionForProjectV5(projectInput)` supplied by the publication boundary; never substitute `project.revisionId`. Validate the Project once. Construction throws the existing Project V5 validation error for any malformed or duplicate Mapping. `replaceProject` validates both the Project and its supplied Revision before mutating anything and preserves the prior runtime snapshot on failure. Compile only enabled Endpoint Mappings with `read` or `readWrite` direction whose single root Leaf target is `{ type: 'logical-signal', signalId }`; Project V5 validation is the sole duplicate-writer gate. Initialize every Signal from `initialValue` with owner `initial`, timestamps `0`, and `BAD/BadWaitingForInitialData`. Apply only increasing per-Endpoint sequences and exact `projectId` plus `configRevision` matches. On BAD, UNCERTAIN, or type mismatch, retain the last GOOD payload while updating quality, status code, source/published/received timestamps, and OPC UA ownership; only GOOD replaces the payload.

For Objects, key Frame channels by `(entityId, frameId)` and Status channels independently by `entityId`; never aggregate their quality, owner, status code, or timestamps. Support every mapped Moving Frame independently. Project V5 validation rejects duplicate or malformed Mapping definitions before channel compilation. Require all six unique Frame `projectPath` destinations, coherent pose publication, and the target Moving Frame's authored owner `opcua:<endpointId>`. Interpret each completed mapped Frame as a Project World pose. Reuse `createRuntimePoseBufferV1` and shortest-quaternion interpolation; do not import the V4 Object runtime. `sampleFrame(entityId, frameId, ...)` returns only Frame state. `readNumericStatus(entityId)` returns only held Status state, without interpolation. At the render selector boundary, only a mapped Frame whose ID equals the Entity's authored `parentFrameId` changes that Entity's World transform: compose the sampled Frame World pose with the Entity's authored `localPose`. Other mapped Moving Frames update only their own frame consumers. Attachment projection retains precedence over an OPC UA parent-Frame pose. BAD, UNCERTAIN, type-mismatched, stale, and disconnected updates retain the last GOOD pose/status payload while updating only that channel's quality, status code, and timestamps; ownership remains OPC UA.

For Robots, compile exactly one enabled read/readWrite Mapping per robot-frame and robot-status target after Project V5 validation has rejected partial or duplicate Frame destinations. A Frame requires the same six unique `projectPath` destinations and `robot.frameSources[frameId] === opcua:<endpointId>`; Status requires `projectPath: []` and matching `robot.numericStatus.sourceOwnership`. Interpret the completed mapped Frame pose as a Project World pose. Smooth it with the same pose buffer, hold Status without interpolation, and preserve OPC UA ownership through BAD/UNCERTAIN/STALE/disconnect. BAD, UNCERTAIN, and type-mismatched updates retain the last GOOD Frame/Status payload while updating quality, status code, and timestamps. A mapped Base Frame becomes the V5 kinematic world-base input; another mapped Robot Frame overrides only that Frame's Actual marker/readout/attachment lookup, not the link chain or Joint state.

Sequence acceptance is independent per Endpoint. Tests must ingest two Endpoints, reject only a non-increasing sequence for the affected Endpoint, and prove that disconnecting one Endpoint marks only its owned Signal/Frame/Status channels STALE. Also prove that a value carrying an unknown or wrong-target Mapping ID cannot mutate another store, that older source timestamps and future source timestamps cannot rewind or snap an emitted pose, that duplicate or partial six-path Frames are rejected with the existing Project V5 validation codes (`OPCUA_READ_OWNER_DUPLICATE` or `OPCUA_PROJECT_PATH_INVALID`) without replacing an active runtime snapshot, and that numeric Status is held rather than interpolated.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm run test:run -- src/core/runtime-interpolation/v1.test.ts src/features/signals/v5/logical-signal-runtime-store.test.ts src/features/scene/v5/object-runtime-state.test.ts src/features/robot/v5/robot-frame-status-runtime-store.test.ts
npm run lint
npm run build
git add src/core/runtime-interpolation/v1.ts src/core/runtime-interpolation/v1.test.ts src/features/signals/v5/logical-signal-runtime-store.ts src/features/signals/v5/logical-signal-runtime-store.test.ts src/features/scene/v5/object-runtime-state.ts src/features/scene/v5/object-runtime-state.test.ts src/features/robot/v5/robot-frame-status-runtime-store.ts src/features/robot/v5/robot-frame-status-runtime-store.test.ts
git diff --cached --check
git commit -m "feat: add logical signal runtime state"
```

Expected: all focused tests PASS and no lint errors.

### Task 2: Add One Typed OPC UA Client Write Boundary

**Files:**
- Create: `middleware/runtime-gateway/opcua-client-write-service.ts`
- Test: `middleware/runtime-gateway/opcua-client-write-service.test.ts`
- Modify: `middleware/runtime-gateway/opcua-client-adapter.ts`
- Test: `middleware/runtime-gateway/opcua-client-adapter.test.ts`

**Interfaces:**
- Consumes: V5 Endpoint/Mapping/Signal contracts and the active `ClientSession` held by `OpcUaClientAdapterV1`.
- Produces: `compileOpcUaClientReadPlanV1`, `resolveOpcUaClientReadRootsV1`, and `assembleMappingValueV1` using independent root/`leafPath`/`projectPath`; `CompiledOpcUaClientWriteV1`, `OpcUaClientWriteRequestV1`, `OpcUaClientWriteResultV1`, `compileOpcUaClientWritePlanV1`, and `OpcUaClientAdapterV1.write`.

- [ ] **Step 1: Write RED plan, disconnect, and one-write tests**

```ts
it('compiles exactly one Boolean output Mapping by Namespace URI', () => {
  expect(compileOpcUaClientWritePlanV1(projectWithBooleanOutput())).toEqual([{
    mappingId: 'map-start', endpointId: 'plc', signalId: 'start',
    nodeAddress: { namespaceUri: 'urn:virtual-plc', identifierType: 'string', identifier: 'Start' },
    dataType: 'Boolean',
  }])
})

it('writes once through the connected Endpoint Session', async () => {
  const write = vi.fn(async () => 'Good')
  const service = createOpcUaClientWriteServiceV1(projectWithBooleanOutput(), {
    resolveEndpoint: () => ({ phase: 'connected', namespaceIndex: async () => 4, write }),
  })
  await expect(service.write({ mappingId: 'map-start', value: true })).resolves.toEqual({
    ok: true, statusCode: 'Good',
  })
  expect(write).toHaveBeenCalledOnce()
  expect(write).toHaveBeenCalledWith({ nodeId: 'ns=4;s=Start', dataType: 'Boolean', value: true })
})

it('fails before Session.write while disconnected', async () => {
  const write = vi.fn()
  const service = createOpcUaClientWriteServiceV1(projectWithBooleanOutput(), {
    resolveEndpoint: () => ({ phase: 'reconnecting', namespaceIndex: async () => 4, write }),
  })
  await expect(service.write({ mappingId: 'map-start', value: true }))
    .resolves.toMatchObject({ ok: false, failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED' })
  expect(write).not.toHaveBeenCalled()
})

it('assembles an array source into the canonical Project pose shape', () => {
  const mapped = assembleMappingValueV1(arrayObjectPoseMapping(), [1, 2, 3, 10, 20, 30])
  expect(mapped.value).toMatchObject({ positionM: [1, 2, 3] })
  expect(mapped.value).toHaveProperty('quaternion')
})

it('creates one monitored root for six leaves of one structured Mapping', () => {
  const plan = compileOpcUaClientReadPlanV1(projectWithArrayMappedBox())
  const resolved = resolveOpcUaClientReadRootsV1(plan, sessionNamespaceArray())
  expect(resolved[0]!.monitoredRoots).toEqual([
    expect.objectContaining({ mappingId: 'box-pose', nodeId: 'ns=4;s=ObjectPos' }),
  ])
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-client-write-service.test.ts middleware/runtime-gateway/opcua-client-adapter.test.ts
```

Expected: FAIL because no Client write port exists.

- [ ] **Step 3: Define and implement the typed write service**

```ts
export interface CompiledOpcUaClientWriteV1 {
  readonly mappingId: string
  readonly endpointId: string
  readonly signalId: string
  readonly nodeAddress: OpcUaNodeAddressV1
  readonly dataType: 'Boolean'
}

export type OpcUaClientWriteResultV1 =
  | { readonly ok: true; readonly statusCode: 'Good' }
  | { readonly ok: false; readonly statusCode: string; readonly failureCode: string; readonly message: string }

export interface OpcUaClientAdapterV1 {
  start(): Promise<void>
  stop(): Promise<void>
  status(): readonly OpcUaClientEndpointStatusV1[]
  write(request: { readonly mappingId: string; readonly value: boolean }): Promise<OpcUaClientWriteResultV1>
}
```

For subscribed reads, resolve each Mapping's root `nodeAddress` against the connected Session NamespaceArray and create one monitored item per unique root Node, not one per leaf. On a root notification, use each leaf's `leafPath` only to extract the OPC UA scalar/ExtensionObject/array component and use `projectPath` only to construct the Project-semantic value. A complete entity/robot Frame mapping becomes `{ positionM, quaternion }` after one RPY-degree conversion; missing source paths, incomplete/duplicate destinations, or leaf type mismatches publish BAD instead of a partial pose. Re-resolve root NodeIds after reconnect and never persist the Namespace Index.

For writes, resolve `namespaceUri` against the live Session immediately before the write; never persist or cache a session-local Namespace Index across reconnect. Construct exactly one Value write with `AttributeIds.Value` and `DataType.Boolean`. Map non-Good StatusCodes to `OPC_UA_WRITE_REJECTED`, thrown Session errors to `OPC_UA_WRITE_FAILED`, absent active Session to `OPC_UA_ENDPOINT_DISCONNECTED`, and unknown/non-write Mapping to `OPC_UA_WRITE_MAPPING_INVALID`.

- [ ] **Step 4: Run GREEN, Gateway build, and commit**

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-client-write-service.test.ts middleware/runtime-gateway/opcua-client-adapter.test.ts
npm run build:gateway
npm run lint
git add middleware/runtime-gateway/opcua-client-write-service.ts middleware/runtime-gateway/opcua-client-write-service.test.ts middleware/runtime-gateway/opcua-client-adapter.ts middleware/runtime-gateway/opcua-client-adapter.test.ts
git diff --cached --check
git commit -m "feat: add opc ua client write service"
```

Expected: focused tests PASS and Gateway TypeScript compiles.

### Task 3: Fence, Deduplicate, and Transport Runtime Commands

**Files:**
- Create: `middleware/runtime-gateway/runtime-command-dedupe-registry.ts`
- Test: `middleware/runtime-gateway/runtime-command-dedupe-registry.test.ts`
- Create: `middleware/runtime-gateway/runtime-command-service.ts`
- Test: `middleware/runtime-gateway/runtime-command-service.test.ts`
- Modify: `src/core/runtime-protocol/v1.ts`
- Test: `src/core/runtime-protocol/v1.test.ts`
- Modify: `middleware/runtime-gateway/opcua-server-adapter.ts`
- Test: `middleware/runtime-gateway/opcua-server-adapter.test.ts`
- Modify: `middleware/runtime-gateway/main.ts`
- Test: `middleware/runtime-gateway/main.test.ts`

**Interfaces:**
- Consumes: Task 2 `OpcUaClientAdapterV1.write`, `CommandRequestV1`, `CommandResultV1`, and active Gateway Project/Revision state.
- Produces: V5-only `RevisionStageRequestV1`, `RuntimeCommandDedupeRegistryV1`, `RuntimeCommandDedupeAdmissionErrorV1`, `RuntimeCommandServiceV1`, `GET /runtime/command-lease`, and `POST /runtime/command`.

- [ ] **Step 1: Write RED fencing and deduplication tests**

```ts
it('executes one write and returns the retained result for an identical duplicate', async () => {
  const write = vi.fn(async () => ({ ok: true as const, statusCode: 'Good' as const }))
  const service = createRuntimeCommandServiceV1(activeContext({ write, generation: 7, nowMs: 1_000 }))
  const request = commandRequest({ commandId: 'set-start-1', leaseGeneration: 7, expiresAt: 2_000 })
  const first = await service.execute(request)
  const duplicate = await service.execute(structuredClone(request))
  expect(first).toBe(duplicate)
  expect(first).toMatchObject({ acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED' })
  expect(write).toHaveBeenCalledOnce()
})

it.each([
  ['wrong revision', { configRevision: OTHER_REVISION }, 'REVISION_MISMATCH'],
  ['stale generation', { leaseGeneration: 6 }, 'COMMAND_LEASE_STALE'],
  ['expired', { expiresAt: 999 }, 'COMMAND_EXPIRED'],
  ['too far in the future', { expiresAt: 6_001 }, 'COMMAND_EXPIRY_INVALID'],
  ['wrong type', { value: 1 }, 'COMMAND_TYPE_MISMATCH'],
])('%s rejects before write', async (_name, override, code) => {
  const write = vi.fn()
  const service = createRuntimeCommandServiceV1(activeContext({ write, generation: 7, nowMs: 1_000 }))
  await expect(service.execute(commandRequest(override))).resolves.toMatchObject({
    acknowledgement: 'REJECTED', executionState: 'FAILED', failureCode: code,
  })
  expect(write).not.toHaveBeenCalled()
})

it('accepts the exact five-second command-expiry boundary', async () => {
  const write = vi.fn(async () => ({ ok: true as const, statusCode: 'Good' as const }))
  const service = createRuntimeCommandServiceV1(activeContext({ write, nowMs: 1_000 }))
  await expect(service.execute(commandRequest({ expiresAt: 6_000 }))).resolves.toMatchObject({
    acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED',
  })
  expect(write).toHaveBeenCalledOnce()
})

it('renews the fixed client-write lease without changing publisher or generation', () => {
  const clock = controlledClock(1_000)
  const service = createRuntimeCommandServiceV1(activeContext({
    publisherId: 'gateway-a:client-write', generation: 7, nowMs: clock.now,
  }))
  expect(service.lease()).toEqual(expect.objectContaining({
    publisherId: 'gateway-a:client-write', generation: 7, expiresAt: 6_000,
  }))
  clock.set(1_250)
  expect(service.lease()).toEqual(expect.objectContaining({
    publisherId: 'gateway-a:client-write', generation: 7, expiresAt: 6_250,
  }))
})

it('serves the Gateway-derived publisher ID and renewed expiry on consecutive lease GETs', async () => {
  const harness = activeGatewayHarness({ gatewayId: 'gateway-a', generation: 7, nowMs: 1_000 })
  await expect(harness.get('/runtime/command-lease')).resolves.toMatchObject({
    publisherId: 'gateway-a:client-write', generation: 7, expiresAt: 6_000,
  })
  harness.clock.set(1_250)
  await expect(harness.get('/runtime/command-lease')).resolves.toMatchObject({
    publisherId: 'gateway-a:client-write', generation: 7, expiresAt: 6_250,
  })
})

it('rejects a reused Command ID with a different payload', async () => {
  const service = createRuntimeCommandServiceV1(activeContext({ generation: 7, nowMs: 1_000 }))
  await service.execute(commandRequest({ commandId: 'same', value: false }))
  await expect(service.execute(commandRequest({ commandId: 'same', value: true })))
    .resolves.toMatchObject({ failureCode: 'COMMAND_ID_CONFLICT' })
})

it('rejects a registry fingerprint conflict before preflight or operation', async () => {
  const registry = createRuntimeCommandDedupeRegistryV1({ maximumRecords: 4_096 })
  await registry.execute(commandRecord('client-write', 'same', 'fingerprint-a'), {
    preflight: () => null,
    operation: async () => terminal('same'),
  })
  const preflight = vi.fn(() => null)
  const operation = vi.fn(async () => terminal('same'))
  await expect(registry.execute(commandRecord('client-write', 'same', 'fingerprint-b'), {
    preflight, operation,
  })).rejects.toMatchObject({ code: 'COMMAND_ID_CONFLICT' })
  expect(preflight).not.toHaveBeenCalled()
  expect(operation).not.toHaveBeenCalled()
})

it('returns the retained identical result after the original request expires', async () => {
  const clock = controlledClock(1_000)
  const write = vi.fn(async () => ({ ok: true as const, statusCode: 'Good' as const }))
  const service = createRuntimeCommandServiceV1(activeContext({ write, nowMs: clock.now }))
  const request = commandRequest({ commandId: 'same-after-expiry', expiresAt: 2_000 })
  const first = await service.execute(request)
  clock.set(2_001)
  const duplicate = await service.execute(structuredClone(request))
  expect(duplicate).toBe(first)
  expect(write).toHaveBeenCalledOnce()
})

it('shares one exact 4096-record budget across command channels', async () => {
  const registry = createRuntimeCommandDedupeRegistryV1({ maximumRecords: 4_096 })
  await fillTerminalRecords(registry, 4_096, 'client-write')
  await registry.execute(commandRecord('server-command', 'next'), {
    preflight: () => null,
    operation: async () => terminal('next'),
  })
  expect(registry.size()).toBe(4_096)
  expect(registry.has(oldestRecordKey())).toBe(false)
})

it('rejects registry admission for record 4097 before execution when every record is in flight', async () => {
  const registry = createRuntimeCommandDedupeRegistryV1({ maximumRecords: 4_096 })
  await fillInFlightRecordsWithoutSettling(registry, 4_096)
  const operation = vi.fn(async () => terminal('overflow'))
  await expect(registry.execute(commandRecord('client-write', 'overflow'), {
    preflight: () => null, operation,
  }))
    .rejects.toMatchObject({ code: 'COMMAND_DEDUPE_CAPACITY_EXHAUSTED' })
  expect(operation).not.toHaveBeenCalled()
})

it('converts dedupe capacity exhaustion into a valid rejected command result', async () => {
  const write = vi.fn()
  const service = createRuntimeCommandServiceV1(activeContext({
    dedupe: fullInFlightRegistry(), write,
  }))
  await expect(service.execute(commandRequest({ commandId: 'overflow' }))).resolves.toMatchObject({
    commandId: 'overflow', acknowledgement: 'REJECTED', executionState: 'FAILED',
    failureCode: 'COMMAND_DEDUPE_CAPACITY_EXHAUSTED',
  })
  expect(write).not.toHaveBeenCalled()
})
```

Add protocol regression tests before touching Gateway code:

```ts
it('accepts a staged Project V5 and rejects a staged Project V4', () => {
  expect(validateRevisionStageRequestV1(revisionStageRequest(projectV5)))
    .toMatchObject({ project: { schemaVersion: 5 } })
  expect(() => validateRevisionStageRequestV1(revisionStageRequest(projectV4)))
    .toThrowError(expect.objectContaining({ code: 'PROJECT_SCHEMA_UNSUPPORTED' }))
})

it('has no production dependency on project-v4', async () => {
  const source = await readFile(new URL('../../../src/core/runtime-protocol/v1.ts', import.meta.url), 'utf8')
  expect(source).not.toContain('project-v4')
  expect(source).not.toContain('WorkcellProjectV4')
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/core/runtime-protocol/v1.test.ts middleware/runtime-gateway/runtime-command-dedupe-registry.test.ts middleware/runtime-gateway/runtime-command-service.test.ts middleware/runtime-gateway/opcua-server-adapter.test.ts middleware/runtime-gateway/main.test.ts
```

Expected: FAIL because command execution routes and deduplication do not exist.

- [ ] **Step 3: Implement the bounded command service**

```ts
export interface RuntimeCommandServiceV1 {
  lease(): RuntimePublisherLeaseV1
  execute(value: unknown): Promise<CommandResultV1>
  size(): number
  close(): void
}

export function createRuntimeCommandServiceV1(options: {
  readonly project: WorkcellProjectV5
  readonly configRevision: string
  readonly publisherId: string
  readonly generation: number
  readonly leaseTtlMs?: 5_000
  readonly nowMs: () => number
  readonly write: OpcUaClientAdapterV1['write']
  readonly dedupe: RuntimeCommandDedupeRegistryV1
}): RuntimeCommandServiceV1
```

```ts
export interface RuntimeCommandDedupeRegistryV1 {
  execute(
    record: Readonly<{ key: string; fingerprint: string; channel: 'client-write' | 'server-command' }>,
    callbacks: Readonly<{
      preflight: () => CommandResultV1 | null
      operation: () => Promise<CommandResultV1>
    }>,
  ): Promise<CommandResultV1>
  size(): number
  clear(): void
}

export class RuntimeCommandDedupeAdmissionErrorV1 extends Error {
  readonly code: 'COMMAND_ID_CONFLICT' | 'COMMAND_DEDUPE_CAPACITY_EXHAUSTED'
}
```

`RuntimeCommandDedupeRegistryV1.execute` first checks the `(channel, key)` record synchronously. An identical fingerprint joins/returns the existing in-flight or terminal result without rerunning preflight, so an idempotent retry still receives the original result after expiry. A different fingerprint throws the typed `COMMAND_ID_CONFLICT` admission error. For a new key, invoke the caller's synchronous `preflight` before capacity admission; a non-null rejected result is returned but not retained. Only a null preflight result proceeds to capacity admission and operation insertion. The registry throws a typed `RuntimeCommandDedupeAdmissionErrorV1` with code `COMMAND_DEDUPE_CAPACITY_EXHAUSTED` when it cannot admit a new record; it does not manufacture a `CommandResultV1` because it does not own Project, generation, target, command, or completion-time context. Client-write and Milestone 4 Server-command callers convert admission errors into their own validated `REJECTED/FAILED` envelope without invoking the operation or browser dispatch.

Validate command request shape before forming the key/fingerprint. Fingerprint the closed request fields with deterministic `JSON.stringify([projectId, configRevision, leaseGeneration, expiresAt, targetId, value])`. Put wrong Project/Revision/generation, `expiresAt < nowMs()` (`COMMAND_EXPIRED`), `expiresAt > nowMs() + 5_000` (`COMMAND_EXPIRY_INVALID`), target/type/direction, and disconnected-Endpoint checks in the synchronous new-record `preflight`; the exact future boundary is accepted. The shared registry inserts the in-flight Promise before awaiting the write so concurrent duplicates join it. It keeps terminal records in insertion order and evicts the oldest terminal record before admitting a new record when total Client-write plus Server-command records would exceed 4,096; it never evicts an in-flight record. If all 4,096 retained records are in-flight, reject admission with the typed error before calling the operation. Return one terminal envelope with both acknowledgement and execution state: successful write is `ACCEPTED/SUCCEEDED`; a validated attempted write failure is `ACCEPTED/FAILED`; preflight or admission failure is `REJECTED/FAILED`.

- [ ] **Step 4: Wire activation generation and HTTP routes**

```ts
interface ActiveProjectRuntimeV1 {
  readonly project: WorkcellProjectV5
  readonly configRevision: string
  readonly generation: number
  readonly commandDedupe: RuntimeCommandDedupeRegistryV1
  readonly commandService: RuntimeCommandServiceV1 | null
  readonly serverAdapter: OpcUaServerAdapterV1 | null
  readonly clientAdapter: OpcUaClientAdapterV1 | null
}
```

In `src/core/runtime-protocol/v1.ts`, replace `ProjectV4Error`, V4 limits, `WorkcellProjectV4`, and `validateWorkcellProjectV4` with the V5 error/limit/type/validator exports created in Milestone 2. `RevisionStageRequestV1.project` is exactly `WorkcellProjectV5`; `validateRevisionStageRequestV1` validates schema 5 before returning the closed request. Preserve the existing command/state envelope discriminants and protocol version so M1 status and existing transport framing do not fork.

Increment a process-local safe integer for every successful candidate activation, including reactivation of the same Revision. Create one 4,096-record dedupe registry for every active Revision in all modes, inject it into the Client command service when Client role is active, and expose that same instance to Milestone 4 Server-command dispatch. Create `commandService` only after the Client adapter has started; it remains `null` in Off and Server-only modes while `commandDedupe` remains available. Build its publisher ID exactly as `${config.gatewayId}:client-write`; `lease()` returns the active generation and `expiresAt = nowMs() + 5_000` on each call. `GET /runtime/command-lease` returns `validateRuntimePublisherLeaseV1(active.commandService.lease())` only when the service exists and otherwise returns a closed `OPC_UA_CLIENT_NOT_ACTIVE` failure; `POST /runtime/command` reads at most `MAX_RUNTIME_BATCH_BYTES_V1`, executes once when available, and returns `validateCommandResultV1(result)`. With no Client adapter, return a valid `REJECTED/FAILED` result with `OPC_UA_CLIENT_NOT_ACTIVE`, not an untyped 500 response. Milestone 4's separate browser-publisher lease keeps Server-only product commands functional without manufacturing a Client write service.

Before changing the active runtime and protocol staging payload to V5, change `OpcUaServerAdapterV1` to accept a validated `WorkcellProjectV5`. Preserve current Server/Bridge startup, endpoint diagnostics, and temporary read-only custom telemetry using V5 Robot Definition/Instance IDs. This is only a compatibility cutover: do not load Robotics NodeSets or claim the standard Robotics model here. Candidate activation must still prepare both requested adapters and publish the new generation only after both start successfully; on any failure, stop candidate adapters and retain the prior active runtime, generation, registry, and adapters.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/core/runtime-protocol/v1.test.ts middleware/runtime-gateway/runtime-command-dedupe-registry.test.ts middleware/runtime-gateway/runtime-command-service.test.ts middleware/runtime-gateway/opcua-server-adapter.test.ts middleware/runtime-gateway/main.test.ts
npm run build:gateway
npm run lint
git add src/core/runtime-protocol/v1.ts src/core/runtime-protocol/v1.test.ts middleware/runtime-gateway/runtime-command-dedupe-registry.ts middleware/runtime-gateway/runtime-command-dedupe-registry.test.ts middleware/runtime-gateway/runtime-command-service.ts middleware/runtime-gateway/runtime-command-service.test.ts middleware/runtime-gateway/opcua-server-adapter.ts middleware/runtime-gateway/opcua-server-adapter.test.ts middleware/runtime-gateway/main.ts middleware/runtime-gateway/main.test.ts
git diff --cached --check
git commit -m "feat: transport deduplicated runtime commands"
```

Expected: exact fencing codes PASS, duplicate execution count remains one, V5 Server/Bridge activation remains available, and the Gateway build passes.

### Task 4: Add the Browser Command Client and Signal Write Port

**Files:**
- Create: `src/features/runtime-gateway/v5/runtime-gateway-command-client.ts`
- Test: `src/features/runtime-gateway/v5/runtime-gateway-command-client.test.ts`
- Create: `src/features/runtime-gateway/v5/runtime-gateway-state-stream.ts`
- Test: `src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts`

**Interfaces:**
- Consumes: Task 3 HTTP routes, `RuntimePublisherLeaseV1`, `CommandRequestV1`, and `CommandResultV1`.
- Produces: `RuntimeGatewayCommandClientV1`, `GatewaySignalWritePortV1`, and multi-consumer State Batch routing.

- [ ] **Step 1: Write RED lease, terminal result, and reconnect tests**

```ts
it('obtains the current lease and posts one revision-qualified command', async () => {
  const fetch = commandFetchHarness({ generation: 9 })
  const client = createRuntimeGatewayCommandClientV1({
    fetch: fetch.call, basePath: '/runtime', nowMs: () => 1_000,
    createCommandId: () => 'command-1',
  })
  await expect(client.writeBoolean({
    projectId: 'project', configRevision: REVISION, targetId: 'map-start', value: true,
  })).resolves.toMatchObject({ executionState: 'SUCCEEDED' })
  expect(fetch.requests).toEqual([
    ['GET', '/runtime/command-lease'],
    ['POST', '/runtime/command', expect.objectContaining({
      commandId: 'command-1', leaseGeneration: 9, targetId: 'map-start', value: true,
    })],
  ])
})

it.each([
  ['request horizon', 10_000, 6_000],
  ['shorter lease', 5_500, 5_500],
] as const)('posts expiry bounded by %s', async (_name, leaseExpiresAt, expectedExpiresAt) => {
  const fetch = commandFetchHarness({ generation: 9, leaseExpiresAt })
  const client = createRuntimeGatewayCommandClientV1({
    fetch: fetch.call, nowMs: () => 1_000, createCommandId: () => 'bounded-expiry',
  })
  await client.writeBoolean(writeRequest())
  expect(fetch.postedCommands[0]?.expiresAt).toBe(expectedExpiresAt)
})

it('refreshes the lease once after COMMAND_LEASE_STALE and keeps one Command ID', async () => {
  const fetch = staleThenCurrentLeaseHarness()
  const client = createRuntimeGatewayCommandClientV1({ fetch: fetch.call, createCommandId: () => 'stable-id' })
  await client.writeBoolean(writeRequest())
  expect(fetch.postedCommandIds).toEqual(['stable-id', 'stable-id'])
  expect(fetch.writeExecutionCount).toBe(1)
})

it('fans one State Batch to Object and Signal consumers and resets both on socket reopen', () => {
  const objectIngest = vi.fn(() => true)
  const signalIngest = vi.fn(() => true)
  const resetObject = vi.fn()
  const resetSignals = vi.fn()
  const stream = createRuntimeGatewayStateStreamV5({
    consumers: [objectIngest, signalIngest], onSessionStart: () => { resetObject(); resetSignals() },
    createWebSocket: () => socket,
  })
  stream.start(); socket.open(); socket.message(JSON.stringify(signalBatch()))
  expect(objectIngest).toHaveBeenCalledOnce()
  expect(signalIngest).toHaveBeenCalledOnce()
  expect(resetObject).toHaveBeenCalledOnce()
  expect(resetSignals).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/runtime-gateway/v5/runtime-gateway-command-client.test.ts src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts
```

Expected: FAIL because browser command transport and multiple stream consumers do not exist.

- [ ] **Step 3: Implement the browser command client and stable Mapping resolver**

```ts
export interface RuntimeGatewayCommandClientV1 {
  writeBoolean(request: {
    readonly projectId: string
    readonly configRevision: string
    readonly targetId: string
    readonly value: boolean
  }, signal?: AbortSignal): Promise<CommandResultV1>
  clearLease(): void
}

export function createGatewaySignalWritePortV1(options: {
  readonly readProject: () => WorkcellProjectV5
  readonly commandClient: RuntimeGatewayCommandClientV1
}): GatewaySignalWritePortV1
```

The Signal port resolves exactly one enabled `write` or `readWrite` Mapping whose Leaf target is the requested Boolean output/bidirectional Signal. It fails locally as `SIGNAL_WRITE_MAPPING_NOT_FOUND` or `SIGNAL_WRITE_MAPPING_AMBIGUOUS` before network I/O. The command client uses an expiry of `min(nowMs() + 5_000, lease.expiresAt)` and a five-second AbortController timeout, validates lease/result envelopes, retries only `COMMAND_LEASE_STALE` once with the same Command ID, and exposes terminal failure codes unchanged. An expired lease is refreshed before POST; an abort/timeout is terminal and never triggers an untracked retry write.

Define `RuntimeGatewayStateStreamOptionsV5.consumers` as `readonly ((value: unknown, receivedTimestampMs: number) => boolean)[]`; each consumer is isolated with `try/catch`, and a malformed consumer cannot stop other consumers or reconnect logic. Reuse the same-origin `/runtime/ws` URL behavior without importing or modifying the V4 stream implementation.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm run test:run -- src/features/runtime-gateway/v5/runtime-gateway-command-client.test.ts src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts
npm run lint
npm run build
git add src/features/runtime-gateway/v5/runtime-gateway-command-client.ts src/features/runtime-gateway/v5/runtime-gateway-command-client.test.ts src/features/runtime-gateway/v5/runtime-gateway-state-stream.ts src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts
git diff --cached --check
git commit -m "feat: add browser signal command client"
```

Expected: focused tests, lint, and browser build PASS.

### Task 5: Execute SetDO, WaitDI, and Delay in Authored Order

**Files:**
- Create: `src/core/action-runtime-v5/attachment-instruction-error.ts`
- Test: `src/core/action-runtime-v5/attachment-instruction-error.test.ts`
- Create: `src/core/robot-runtime-v5/serial-kinematics.ts`
- Test: `src/core/robot-runtime-v5/serial-kinematics.test.ts`
- Create: `src/features/robot/v5/robot-joint-runtime-store.ts`
- Test: `src/features/robot/v5/robot-joint-runtime-store.test.ts`
- Create: `src/features/jobs/v5/job-runtime-store.ts`
- Test: `src/features/jobs/v5/job-runtime-store.test.ts`
- Create: `src/features/jobs/v5/job-executor.ts`
- Test: `src/features/jobs/v5/job-executor.test.ts`
- Create: `src/features/jobs/v5/simulation-clock.ts`
- Test: `src/features/jobs/v5/simulation-clock.test.ts`

**Interfaces:**
- Consumes: V5 Robot Definitions/Instances/rigid transforms, V5 Jobs, Robot Joint read Mappings/State Batches, existing version-neutral Joint interpolation formulas, Task 1 Signal and Robot Frame/status stores, Task 4 `GatewaySignalWritePortV1`, and `AttachmentInstructionPortV1`.
- Produces: `AttachmentInstructionErrorV1` plus its creator/validator, `SerialRobotPoseV5`, `computeSerialRobotPoseV5`, OPC UA-capable `RobotJointRuntimeStoreV5`, `JobRuntimeStoreV5`, `RobotJobExecutorV5`, `RobotJobPlaybackControllerV5`, and stable I/O failure propagation.

- [ ] **Step 1: Write RED authored-order and SetDO acknowledgement tests**

```ts
it('creates and recognizes only a listed Attachment instruction failure code', () => {
  const error = createAttachmentInstructionErrorV1('OUT_OF_RANGE', 'Object is outside the grasp range.')
  expect(error).toMatchObject({ name: 'AttachmentInstructionErrorV1', code: 'OUT_OF_RANGE' })
  expect(isAttachmentInstructionErrorV1(error)).toBe(true)
  expect(isAttachmentInstructionErrorV1({ code: 'UNLISTED', message: 'spoof' })).toBe(false)
})

it('waits for SetDO terminal success before advancing', async () => {
  const pending = deferred<CommandResultV1>()
  const harness = jobHarness({
    instructions: [setDo('set', 'start', true), delay('settle', 100)],
    writeBoolean: vi.fn(() => pending.promise),
  })
  harness.executor.startJob('job', 0)
  const advance = harness.executor.advanceAll(0)
  expect(harness.state().stepIndex).toBe(0)
  pending.resolve(succeededCommandResult())
  await advance
  expect(harness.state().stepIndex).toBe(1)
  expect(harness.writeBoolean).toHaveBeenCalledOnce()
})

it('fails with the Gateway code after one failed SetDO', async () => {
  const harness = jobHarness({
    instructions: [setDo('set', 'start', true)],
    writeBoolean: vi.fn(async () => failedCommandResult('OPC_UA_WRITE_REJECTED')),
  })
  harness.executor.startJob('job', 0)
  await harness.executor.advanceAll(0)
  expect(harness.state()).toMatchObject({ state: 'FAILED', failureCode: 'OPC_UA_WRITE_REJECTED' })
  expect(harness.writeBoolean).toHaveBeenCalledOnce()
})

it.each([
  'SOURCE_OWNERSHIP_CONFLICT',
  'ALREADY_ATTACHED',
  'NOT_ATTACHED',
  'OUT_OF_RANGE',
  'ATTACHMENT_TARGET_NOT_FOUND',
  'ATTACHMENT_FRAME_UNAVAILABLE',
] as const)('preserves Attachment port failure %s after one call', async (code) => {
  const attach = vi.fn(async () => {
    throw createAttachmentInstructionErrorV1(code, `Attachment failed: ${code}`)
  })
  const harness = jobHarness({ instructions: [attachPart('attach')], attach })
  harness.executor.startJob('job', 0)
  await harness.executor.advanceAll(0)
  expect(harness.state()).toMatchObject({ state: 'FAILED', failureCode: code })
  expect(attach).toHaveBeenCalledOnce()
})

it('normalizes an unknown Attachment rejection and never retries it', async () => {
  const detach = vi.fn(async () => { throw new Error('unexpected') })
  const harness = jobHarness({ instructions: [detachPart('detach')], detach })
  harness.executor.startJob('job', 0)
  await harness.executor.advanceAll(0)
  await harness.executor.advanceAll(1)
  expect(harness.state()).toMatchObject({
    state: 'FAILED', failureCode: 'ATTACHMENT_INSTRUCTION_FAILED',
  })
  expect(detach).toHaveBeenCalledOnce()
})

it('applies a subscribed Joint only to an OPC UA-owned Robot', () => {
  const robots = createRobotJointRuntimeStoreV5(projectWithOpcUaRobot(), REVISION)
  expect(robots.getState().ingest(jointBatch('robot-b', 'J1', 22.5), 1_000)).toBe(true)
  expect(robots.getState().readRobot('robot-b')).toMatchObject({
    jointValues: { J1: 22.5 }, jointSource: 'opcua:plc', quality: 'GOOD',
  })
  expect(() => robots.getState().writeJointValues('robot-b', { J1: 0 }, 'simulation'))
    .toThrow('ROBOT_JOINT_OWNERSHIP_CONFLICT')
})

it('does not start a Simulation Job for an OPC UA-owned Robot', () => {
  const harness = jobHarness({ robotJointSource: 'opcua:plc', instructions: [moveJoint('move', { J1: 10 })] })
  expect(() => harness.executor.startJob('job', 0))
    .toThrow('ROBOT_JOINT_SOURCE_NOT_SIMULATION')
})

it('computes V5 link and TCP world poses without a V4 import', async () => {
  const project = projectWithSimulationRobot()
  const robot = project.robots[0]!
  const definition = project.robotDefinitions[0]!
  const result = computeSerialRobotPoseV5(definition, robot.initialJointValues, robot.localBasePose)
  expect(Object.keys(result.linkWorldPoses)).toHaveLength(definition.links.length)
  expect(result.frameWorldPoses[robot.selectedTcpFrameId]).toBeDefined()
  const source = await readFile(new URL('../../../core/robot-runtime-v5/serial-kinematics.ts', import.meta.url), 'utf8')
  expect(source).not.toMatch(/project-v4|RigidTransformV4|RobotDefinitionV4/u)
})
```

- [ ] **Step 2: Write RED WaitDI and Delay timing tests**

```ts
it('does not satisfy WaitDI from stale retained data, then succeeds on GOOD data', async () => {
  const harness = jobHarness({ instructions: [waitDi('wait', 'ready', true, 1_000)] })
  harness.signals.set(runtimeSignal({ value: true, quality: 'STALE' }))
  harness.executor.startJob('job', 0)
  await harness.executor.advanceAll(500)
  expect(harness.state().state).toBe('RUNNING')
  harness.signals.set(runtimeSignal({ value: true, quality: 'GOOD', sourceTimestampMs: 600 }))
  await harness.executor.advanceAll(600)
  expect(harness.state().state).toBe('SUCCEEDED')
})

it('fails WaitDI at its exact timeout and delays by Simulation time only', async () => {
  const timedOut = jobHarness({ instructions: [waitDi('wait', 'ready', true, 1_000)] })
  timedOut.executor.startJob('job', 50)
  await timedOut.executor.advanceAll(1_049)
  expect(timedOut.state().state).toBe('RUNNING')
  await timedOut.executor.advanceAll(1_050)
  expect(timedOut.state()).toMatchObject({ state: 'FAILED', failureCode: 'WAIT_DI_TIMEOUT' })

  const delayed = jobHarness({ instructions: [delay('delay', 250)] })
  delayed.executor.startJob('job', 10)
  await delayed.executor.advanceAll(259)
  expect(delayed.state().state).toBe('RUNNING')
  await delayed.executor.advanceAll(260)
  expect(delayed.state().state).toBe('SUCCEEDED')
})
```

- [ ] **Step 3: Run RED**

```powershell
npm run test:run -- src/core/action-runtime-v5/attachment-instruction-error.test.ts src/features/robot/v5/robot-joint-runtime-store.test.ts src/features/jobs/v5
```

Expected: FAIL because the V5 serial kinematics and Job runtime do not exist.

- [ ] **Step 4: Implement the V5 executor with explicit per-instruction state**

```ts
interface ActiveInstructionStateV1 {
  readonly instructionId: string
  readonly enteredAtSimulationMs: number
  readonly pending: Promise<void> | null
}

export interface SerialRobotPoseV5 {
  readonly jointValues: Readonly<Record<string, number>>
  readonly linkLocalPoses: Readonly<Record<string, RigidTransformV5>>
  readonly linkWorldPoses: Readonly<Record<string, RigidTransformV5>>
  readonly frameWorldPoses: Readonly<Record<string, RigidTransformV5>>
}

export function computeSerialRobotPoseV5(
  definition: RobotDefinitionV5,
  jointValues: Readonly<Record<string, number>>,
  worldBasePose?: RigidTransformV5,
): SerialRobotPoseV5

export interface RobotJobExecutorDependenciesV5 {
  readonly readProject: () => WorkcellProjectV5
  readonly robots: StoreApi<RobotJointRuntimeStoreV5>
  readonly jobs: StoreApi<JobRuntimeStoreV5>
  readonly signals: StoreApi<LogicalSignalRuntimeStoreV1>
  readonly signalWrites: GatewaySignalWritePortV1
  readonly attachments: AttachmentInstructionPortV1
  readonly createRunId: () => string
}
```

Port the proven serial-chain algorithm under V5 symbols into `src/core/robot-runtime-v5/serial-kinematics.ts`. Import only `src/core/project-v5` types, transforms, limits, and errors; do not import or re-export a V4 module. Preserve revolute commands in degrees, prismatic commands in metres, exact Joint-ID validation, serial-chain/cycle checks, normalized axes/quaternions, world-base composition, and Definition Frame resolution. This module is the only Forward Kinematics implementation used by the active V5 Workcell and by deterministic demo grasp placement.

Create `RobotJointRuntimeStoreV5` with separate `projectRevisionId` and `configRevision`, one exact Joint-ID record per Robot, `replaceProject(project, configRevision)`, `ingest(batch, receivedTimestampMs)`, `markEndpointDisconnected`, `resetGatewaySession`, `writeJointValues`, and `readRobotPose(robotId, worldBasePose?)`. `readRobotPose` calls `computeSerialRobotPoseV5` with the current values and the supplied mapped Base World pose when present, otherwise the Robot's authored `localBasePose`. Compile one enabled read/readWrite Mapping per Joint target; use the Mapping root/leaf extraction from Task 2, apply increasing endpoint sequences only when `robot.jointSource === opcua:<endpointId>` and the batch `configRevision` matches, and retain values with STALE quality across disconnect. Manual/Simulation writes against an OPC UA owner fail and no automatic takeover occurs. `JobRuntimeStoreV5` also retains both revision fields so an old run cannot survive a same-`revisionId` content replacement.

Adapt the proven V4 one-chain-per-Robot executor without importing V4 Project or Action types. A Job starts only when its Robot's `jointSource === 'simulation'`. `move-joint` retains wrapped/limited interpolation. `set-do` stores one Promise before awaiting it and never reissues during repeated `advanceAll`. `wait-di` reads the store without network polling and checks `quality === 'GOOD'`, Boolean value equality, and `simulationMs >= entered + timeoutMs` in that order. `delay` advances at `entered + durationMs`. Attach/Detach call the injected port once. The port rejects with a structurally validated `AttachmentInstructionErrorV1`; the executor preserves its listed stable `code`, while an unknown rejection becomes `ATTACHMENT_INSTRUCTION_FAILED`. Cancellation or disposal invalidates the session generation so late SetDO or Attachment Promise settlement cannot advance a replacement run.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/core/action-runtime-v5/attachment-instruction-error.test.ts src/core/robot-runtime-v5/serial-kinematics.test.ts src/features/robot/v5/robot-joint-runtime-store.test.ts src/features/jobs/v5
npm run lint
npm run build
git add src/core/action-runtime-v5/attachment-instruction-error.ts src/core/action-runtime-v5/attachment-instruction-error.test.ts src/core/robot-runtime-v5/serial-kinematics.ts src/core/robot-runtime-v5/serial-kinematics.test.ts src/features/robot/v5/robot-joint-runtime-store.ts src/features/robot/v5/robot-joint-runtime-store.test.ts src/features/jobs/v5/job-runtime-store.ts src/features/jobs/v5/job-runtime-store.test.ts src/features/jobs/v5/job-executor.ts src/features/jobs/v5/job-executor.test.ts src/features/jobs/v5/simulation-clock.ts src/features/jobs/v5/simulation-clock.test.ts
git diff --cached --check
git commit -m "feat: execute logical io job instructions"
```

Expected: authored-order, exact-time, cancellation, and late-settlement tests PASS.

### Task 6: Execute Explicit Pose-Preserving Attach and Detach

**Files:**
- Create: `src/core/action-runtime-v5/attachment-transition.ts`
- Test: `src/core/action-runtime-v5/attachment-transition.test.ts`
- Create: `src/core/action-runtime-v5/index.ts`
- Create: `src/features/actions/v5/attachment-runtime-store.ts`
- Test: `src/features/actions/v5/attachment-runtime-store.test.ts`
- Create: `src/features/actions/v5/browser-attachment-instruction-port.ts`
- Test: `src/features/actions/v5/browser-attachment-instruction-port.test.ts`
- Create: `src/features/scene/v5/attachment-pose-runtime.ts`
- Test: `src/features/scene/v5/attachment-pose-runtime.test.ts`

**Interfaces:**
- Consumes: V5 Attach/Detach instructions, V5 rigid transforms, live Robot Frame poses, and Spatial Entity world poses.
- Produces: runtime-only `AttachmentRuntimeRecordV1`, pure transitions, `AttachmentRuntimeStoreV1`, and `AttachmentInstructionPortV1`.

- [ ] **Step 1: Write RED transition continuity and explicit-ID tests**

```ts
it('attaches only the named Object and preserves World pose', () => {
  const before = pose([0.40, 0.10, 0.20])
  const transition = prepareAttachTransitionV1(attachInstruction({
    objectId: 'cup', toolFrameId: 'tcp', objectGraspFrameId: 'cup-grasp', maximumDistanceM: 0.05,
  }), attachContext({ objectWorld: before, toolWorld: pose([0.40, 0.10, 0.25]) }))
  const reconstructed = composeRigidTransformV5(
    transition.record.toolWorldPoseAtAttach,
    transition.record.toolFromObject,
  )
  const discontinuity = poseDiscontinuityV1(before, reconstructed)
  expect(discontinuity.positionM).toBeLessThanOrEqual(0.0005)
  expect(discontinuity.orientationDeg).toBeLessThanOrEqual(0.1)
  expect(transition.record.objectId).toBe('cup')
})

it.each([
  ['opcua owner', attachContext({ owner: 'opcua:plc' }), 'SOURCE_OWNERSHIP_CONFLICT'],
  ['already attached', attachContext({ alreadyAttached: true }), 'ALREADY_ATTACHED'],
  ['out of range', attachContext({ toolToGraspDistanceM: 0.050001 }), 'OUT_OF_RANGE'],
])('%s fails without a store commit', (_name, context, code) => {
  expect(() => prepareAttachTransitionV1(attachInstruction({ maximumDistanceM: 0.05 }), context))
    .toThrowError(expect.objectContaining({ name: 'AttachmentInstructionErrorV1', code }))
  expect(context.commitCount()).toBe(0)
})

it('detaches to the explicit parent and preserves the attached World pose', () => {
  const transition = prepareDetachTransitionV1(detachInstruction({
    objectId: 'cup', targetParentFrameId: 'fixture',
  }), detachContext())
  expect(composeRigidTransformV5(transition.targetParentWorld, transition.nextLocalPose))
    .toEqual(transition.objectWorldBefore)
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/core/action-runtime-v5 src/features/actions/v5
```

Expected: FAIL because no V5 Attachment runtime exists.

- [ ] **Step 3: Implement immutable transition and store contracts**

```ts
export interface AttachmentRuntimeRecordV1 {
  readonly objectId: string
  readonly robotId: string
  readonly toolFrameId: string
  readonly objectGraspFrameId: string | null
  readonly toolFromObject: RigidTransformV5
  readonly toolWorldPoseAtAttach: RigidTransformV5
  readonly objectWorldPoseAtAttach: RigidTransformV5
  readonly attachedAtSimulationMs: number
}

export interface DetachedPoseOverrideV1 {
  readonly objectId: string
  readonly parentFrameId: string
  readonly localPose: RigidTransformV5
  readonly detachedAtSimulationMs: number
}

export interface AttachmentRuntimeStoreV1 {
  readonly projectRevisionId: string | null
  readonly configRevision: string | null
  readonly attachmentsByObjectId: Readonly<Record<string, AttachmentRuntimeRecordV1>>
  readonly detachedOverridesByObjectId: Readonly<Record<string, DetachedPoseOverrideV1>>
  replaceProject(project: WorkcellProjectV5, configRevision: string): void
  commitAttach(record: AttachmentRuntimeRecordV1): void
  commitDetach(record: DetachedPoseOverrideV1): void
  reset(project: WorkcellProjectV5, configRevision: string): void
}
```

Calculate Tool-to-Grasp distance from `objectWorld * objectGraspLocal`; if no Object Grasp Frame is supplied, use the Object root. Attach stores `toolFromObject = relativeRigidTransformV5(toolWorld, objectWorld)`. Detach computes current Object World from the current Tool World and stores `relativeRigidTransformV5(targetParentWorld, objectWorld)`; a null target resolves to the Object's authored parent ID before commit. Normalize/freeze every pose with `normalizeRigidTransformV5` and verify continuity before mutating the store. Every listed transition/lookup/ownership failure must be produced with Task 5 `createAttachmentInstructionErrorV1`; neither pure transitions nor `browser-attachment-instruction-port` may throw an ordinary string-only `Error` for a listed condition. Tests assert the real port rejection passes `isAttachmentInstructionErrorV1`.

- [ ] **Step 4: Project attachment overrides through the existing render transform boundary**

```ts
export interface AttachmentPoseRuntimeV1 {
  readObjectWorldPose(
    objectId: string,
    readRobotFrameWorldPose: (robotId: string, frameId: string) => RigidTransformV5 | null,
    readSceneFrameWorldPose: (frameId: string) => RigidTransformV5 | null,
  ): RigidTransformV5 | null
}
```

Implement `createAttachmentPoseRuntimeV1(store)` as a dependency-free projection over injected Frame readers. Resolve an active Attachment before OPC UA/manual pose sources; resolve a detached override against its Scene parent next; return null when no override exists. `browser-attachment-instruction-port.ts` receives `readRobotFrameWorldPose(robotId, frameId)`, `readSceneFrameWorldPose(frameId)`, and `readObjectWorldPose(objectId)` callbacks from the eventual V5 Workcell rather than importing Three.js. Do not modify V4 render components, reparent Three.js Objects, or create a duplicate renderer in this milestone.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/core/action-runtime-v5 src/features/actions/v5 src/features/scene/v5/attachment-pose-runtime.test.ts
npm run lint
npm run build
git add src/core/action-runtime-v5/attachment-transition.ts src/core/action-runtime-v5/attachment-transition.test.ts src/core/action-runtime-v5/index.ts src/features/actions/v5/attachment-runtime-store.ts src/features/actions/v5/attachment-runtime-store.test.ts src/features/actions/v5/browser-attachment-instruction-port.ts src/features/actions/v5/browser-attachment-instruction-port.test.ts src/features/scene/v5/attachment-pose-runtime.ts src/features/scene/v5/attachment-pose-runtime.test.ts
git diff --cached --check
git commit -m "feat: execute explicit attachment instructions"
```

Expected: continuity, ownership, reset, renderer-follow, and no-duplicate-renderer tests PASS.

### Task 7: Compose the Browser Runtime and Prove Real OPC UA Job I/O

**Files:**
- Create: `src/features/project/v5/browser-runtime-bundle-store-v5.ts`
- Test: `src/features/project/v5/browser-runtime-bundle-store-v5.test.ts`
- Create: `src/features/project/v5/browser-project-runtime-v5.ts`
- Test: `src/features/project/v5/browser-project-runtime-v5.test.ts`
- Create: `middleware/runtime-gateway/opcua-client-write.integration.test.ts`
- Create: `src/features/jobs/v5/job-io.integration.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Tasks 1-6, a validated Project V5, its caller-supplied canonical `configRevision`, and injected Gateway/test lifecycle ports.
- Produces: one disposable revision-aligned V5 runtime graph and repeatable native integration evidence. It does not own repository publication or active-App/Gateway cutover; Milestone 5 owns that coordinator.

- [ ] **Step 1: Write RED composition/reset tests**

```ts
it('publishes one revision across Robot, Job, Signal, and Attachment runtimes', async () => {
  const resources = createBrowserProjectRuntimeV5(testOptions())
  const prepared = await resources.prepare(projectV5, CONFIG_REVISION)
  await resources.apply(prepared)
  resources.commit(prepared)
  expect(resources.robots.getState().projectRevisionId).toBe(projectV5.revisionId)
  expect(resources.robotFrames.projectRevisionId).toBe(projectV5.revisionId)
  expect(resources.objects.projectRevisionId).toBe(projectV5.revisionId)
  expect(resources.jobs.getState().projectRevisionId).toBe(projectV5.revisionId)
  expect(resources.signals.getState().projectRevisionId).toBe(projectV5.revisionId)
  expect(resources.attachments.getState().projectRevisionId).toBe(projectV5.revisionId)
  expect([
    resources.robots.getState().configRevision,
    resources.robotFrames.configRevision,
    resources.objects.configRevision,
    resources.jobs.getState().configRevision,
    resources.signals.getState().configRevision,
    resources.attachments.getState().configRevision,
    resources.bundle.getState().configRevision,
  ]).toEqual(Array(7).fill(CONFIG_REVISION))
})

it('marks Signals stale on Gateway session reset without changing the Project', () => {
  const before = resources.bundle.getState().project
  gatewaySocket.close(); gatewaySocket.reopen()
  expect(resources.signals.getState().read('ready')?.quality).toBe('STALE')
  expect(resources.bundle.getState().project).toBe(before)
})

it('rolls back every local runtime checkpoint when candidate apply fails', async () => {
  const failingResources = createBrowserProjectRuntimeV5(testOptions({ failApplyAfter: 'objects' }))
  const before = snapshotAllRuntimeStores(failingResources)
  const prepared = await failingResources.prepare(projectV5B, CONFIG_REVISION_B)
  await expect(failingResources.apply(prepared)).rejects.toThrow('TEST_APPLY_FAILURE')
  failingResources.rollback(prepared)
  expect(snapshotAllRuntimeStores(failingResources)).toEqual(before)
  expect(() => failingResources.commit(prepared)).toThrow('BROWSER_RUNTIME_CANDIDATE_CONSUMED')
})
```

- [ ] **Step 2: Compose lifecycle ownership and disposal**

```ts
export interface BrowserRuntimeBundleStateV5 {
  readonly project: WorkcellProjectV5
  readonly projectRevisionId: string
  readonly configRevision: string
}

export interface PreparedBrowserRuntimeCandidateV5 {
  readonly projectRevisionId: string
  readonly configRevision: string
}

export interface BrowserProjectResourcesV5 {
  readonly bundle: StoreApi<BrowserRuntimeBundleStateV5>
  readonly robots: StoreApi<RobotJointRuntimeStoreV5>
  readonly robotFrames: RobotFrameStatusRuntimeStoreV5
  readonly signals: StoreApi<LogicalSignalRuntimeStoreV1>
  readonly objects: ObjectRuntimeStateV5
  readonly jobs: StoreApi<JobRuntimeStoreV5>
  readonly attachments: StoreApi<AttachmentRuntimeStoreV1>
  readonly signalWrites: GatewaySignalWritePortV1
  readonly jobExecutor: RobotJobExecutorV5
  readonly playback: RobotJobPlaybackControllerV5
  prepare(project: WorkcellProjectV5, configRevision: string): Promise<PreparedBrowserRuntimeCandidateV5>
  apply(prepared: PreparedBrowserRuntimeCandidateV5): Promise<void>
  commit(prepared: PreparedBrowserRuntimeCandidateV5): void
  rollback(prepared: PreparedBrowserRuntimeCandidateV5): void
  startGatewayStream(): void
  stopGatewayStream(): void
  dispose(): void
}
```

Create these resources as a V5 runtime candidate using a validated Project and a caller-supplied lowercase 64-hex `configRevision`; never recompute the hash and never substitute `revisionId`. Task 7 owns an opaque, single-use local `PreparedBrowserRuntimeCandidateV5` and atomic `prepare/apply/commit/rollback` only for the Robot, Job, Signal, Object, Frame/status, and Attachment resources. `prepare` validates and snapshots the Project plus supplied hash without mutating the active runtime; `apply` installs the candidate behind unpublished checkpoints; `commit` publishes it and disposes prior playback/executor; `rollback` restores every prior checkpoint and disposes the candidate. Its integration harness may stage a Gateway through an injected lifecycle port, but it does not open the Project repository, publish the active Project, compute a canonical hash, or become the production Gateway publication authority. Milestone 5 computes the canonical hash exactly once and coordinates repository, Gateway activation, and these existing runtime lifecycle methods. On successful local commit clear the command Client lease and reset runtime-only Robot Joint, Robot Frame/status, Object, Signal, and Attachment data. `BrowserProjectRuntimeV5.startGatewayStream()` constructs one V5 stream with the Robot Joint, Robot Frame/status, Object, and Signal consumers; on session start it calls all four reset functions. Endpoint status transitions from connected to reconnecting/faulted call all four `markEndpointDisconnected` methods exactly once per transition. Expose this runtime for the Milestone 5 V5 UI composition; do not import it into the V4 App.

- [ ] **Step 3: Write the real local OPC UA write/dedupe/disconnect integration test**

```ts
it('writes one virtual PLC Boolean, deduplicates, then rejects while disconnected', async () => {
  const plc = await startLocalOpcUaBooleanServer({ namespaceUri: 'urn:virtual-plc', nodeId: 'Start' })
  const gateway = await startGatewayWithProject(projectFor(plc.endpointUrl))
  try {
    const request = commandRequest({ commandId: 'same', targetId: 'map-start', value: true })
    const first = await gateway.command(request)
    const duplicate = await gateway.command(request)
    expect(first).toEqual(duplicate)
    expect(plc.read('Start')).toBe(true)
    expect(plc.writeCount('Start')).toBe(1)
    await plc.stop()
    await waitFor(() => expect(gateway.status().opcUa.clientEndpoints[0]?.phase).toBe('reconnecting'))
    await expect(gateway.command(commandRequest({ commandId: 'after-disconnect' })))
      .resolves.toMatchObject({ failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED' })
  } finally {
    await gateway.stop()
    await plc.stop()
  }
})

it('re-resolves a persisted Namespace URI after the Server changes its Namespace Index', async () => {
  const namespaceUri = 'urn:virtual-plc:reindexed'
  const project = projectWithSignalObjectAndJointMappings({ namespaceUri })
  const canonicalBefore = canonicalProjectV5Json(project)
  const first = await startReindexableOpcUaServer({ namespaceUri, namespacesBeforeTarget: 0 })
  const gateway = await startGatewayWithProjectAndBrowserRuntime(project, first.endpointUrl)
  try {
    expect(await first.namespaceIndex(namespaceUri)).toBe(2)
    await first.publish({ signal: true, objectX: 0.2, jointJ1: 10 })
    await waitFor(() => expect(gateway.runtime.snapshot()).toMatchObject({
      signal: { value: true, quality: 'GOOD' },
      object: { x: 0.2, quality: 'GOOD' },
      joint: { value: 10, quality: 'GOOD' },
    }))
    await first.stop()
    const second = await startReindexableOpcUaServer({
      endpointUrl: first.endpointUrl,
      namespaceUri,
      namespacesBeforeTarget: 1,
    })
    expect(await second.namespaceIndex(namespaceUri)).toBe(3)
    await second.publish({ signal: false, objectX: 0.4, jointJ1: 20 })
    await waitFor(() => expect(gateway.runtime.snapshot()).toMatchObject({
      signal: { value: false, quality: 'GOOD' },
      object: { x: 0.4, quality: 'GOOD' },
      joint: { value: 20, quality: 'GOOD' },
    }))
    expect(canonicalProjectV5Json(gateway.project())).toBe(canonicalBefore)
  } finally {
    await gateway.stop()
    await first.stop()
    await stopReindexedServerIfRunning()
  }
})
```

- [ ] **Step 4: Write the complete Job I/O integration test**

```ts
it('executes MoveJoint, SetDO, WaitDI, Delay, Attach, and Detach in authored order', async () => {
  const harness = integratedJobHarness([
    moveJoint('move-1', { J1: 0.1 }),
    setDo('set-start', 'start', true),
    waitDi('wait-ready', 'ready', true, 2_000),
    delay('settle', 100),
    attach('pick', 'box', 'tcp', 'box-grasp', 0.05),
    moveJoint('move-2', { J1: 0.2 }),
    detach('place', 'box', 'fixture'),
  ])
  harness.start(0)
  await harness.advance(0)
  expect(harness.opcUaWrites).toEqual([{ signalId: 'start', value: true }])
  harness.publishSignal('ready', true, 'GOOD', 50)
  await harness.advance(50)
  await harness.advance(150)
  await harness.advance(1_000)
  expect(harness.jobState()).toMatchObject({ state: 'SUCCEEDED', stepIndex: 7 })
  expect(harness.actionOrder).toEqual(['set:start', 'wait:ready', 'delay:100', 'attach:box', 'detach:box'])
  expect(harness.poseDiscontinuities.every(({ positionM, orientationDeg }) => (
    positionM <= 0.0005 && orientationDeg <= 0.1
  ))).toBe(true)
})

it('propagates a real Attachment port failure through the Job executor', async () => {
  const harness = integratedJobHarness({
    instructions: [attach('pick', 'box', 'tcp', 'box-grasp', 0.01)],
    objectWorldPose: pose([1, 0, 0]),
    toolWorldPose: pose([0, 0, 0]),
    useRealBrowserAttachmentPort: true,
  })
  harness.start(0)
  await harness.advance(0)
  expect(harness.jobState()).toMatchObject({
    state: 'FAILED', failureCode: 'OUT_OF_RANGE', stepIndex: 0,
  })
  expect(harness.attachmentCommitCount()).toBe(0)
})
```

- [ ] **Step 5: Add the focused verification script and run all gates**

```json
{
  "scripts": {
    "test:job-io": "vitest run src/core/robot-runtime-v5 src/features/signals/v5 src/features/runtime-gateway/v5 src/features/robot/v5 src/features/jobs/v5 src/features/actions/v5 src/features/scene/v5 middleware/runtime-gateway/opcua-client-write-service.test.ts middleware/runtime-gateway/runtime-command-dedupe-registry.test.ts middleware/runtime-gateway/runtime-command-service.test.ts middleware/runtime-gateway/opcua-client-write.integration.test.ts"
  }
}
```

```powershell
npm run test:job-io
npm run test:run
npm run lint
npm run build:gateway
node dist-gateway/middleware/runtime-gateway/main.js --check-config
npm run build
git diff --check
```

Expected: all focused and full tests PASS, lint is clean, both builds succeed, check-config exits 0, and diff check prints nothing.

- [ ] **Step 6: Commit the integrated milestone**

```powershell
git add src/features/project/v5/browser-runtime-bundle-store-v5.ts src/features/project/v5/browser-runtime-bundle-store-v5.test.ts src/features/project/v5/browser-project-runtime-v5.ts src/features/project/v5/browser-project-runtime-v5.test.ts middleware/runtime-gateway/opcua-client-write.integration.test.ts src/features/jobs/v5/job-io.integration.test.ts package.json
git diff --cached --check
git commit -m "feat: integrate opc ua job io runtime"
```

## Completion Checklist

- [ ] Runtime Protocol revision staging validates `WorkcellProjectV5` and has no Project V4 production import.
- [ ] A GOOD subscribed Boolean updates its logical Signal with timestamps and OPC UA owner.
- [ ] A structured/array Object pose uses source `leafPath`, destination `projectPath`, smooth interpolation, and retained OPC UA ownership across disconnect.
- [ ] OPC UA-owned Robot Joints ingest subscribed values, retain stale ownership on disconnect, and reject Manual/Simulation writes and Simulation Job start.
- [ ] OPC UA-owned Robot Base/other Frames and numeric Status ingest coherently; Base moves the kinematic chain, other Frame Actuals drive markers/readout/attachment lookup, and disconnect retains stale ownership.
- [ ] Reconnect re-resolves the persisted Namespace URI when the Server changes its Namespace Index, with Signal/Object/Joint updates resuming and canonical Project JSON unchanged.
- [ ] Disconnect retains the value as STALE, and STALE cannot satisfy WaitDI.
- [ ] SetDO resolves one write Mapping, performs one Session.write, and waits for success.
- [ ] Wrong Revision, stale generation, expiry, type, direction, and disconnect fail before write.
- [ ] Identical duplicate Command IDs return one retained result; conflicting reuse does not execute.
- [ ] Client writes and later Server commands share one active-Revision 4,096-record deduplication budget.
- [ ] Delay and WaitDI use nondecreasing Simulation time and exact boundary comparisons.
- [ ] Attach and Detach use explicit IDs, preserve World pose, and never infer from the gripper.
- [ ] Runtime-only Signal quality and attachment state do not change canonical Project V5 JSON.
- [ ] Project replacement and Gateway reconnect reset runtime ownership deterministically.
- [ ] Local OPC UA integration, full tests, lint, Gateway build, and browser build pass.
