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
- In Task 2, atomically cut `src/core/runtime-protocol/v1.ts`, Gateway staging/main, and both OPC UA adapters from Project V4 to validated Project V5. The wire envelope remains Runtime Protocol v1 for this closed deployment, but a staged Project payload is V5-only and V4 fails before adapter preparation. Preserve Off/Client/Server/Bridge activation and the temporary custom read-only Server telemetry tree; official Robotics NodeSets and model semantics remain Milestone 4 work. Never accept a V4/V5 union, cast, translate, or retain a V4 compatibility path.
- Use `OpcUaMappingV5.id` as `CommandRequestV1.targetId`; Job instructions and runtime state continue to address stable `LogicalSignalV1.id` values.
- `set-do` may target only a Boolean `output` or `bidirectional` Signal with exactly one enabled `write` or `readWrite` Mapping.
- `wait-di` may observe only a Boolean `input` or `bidirectional` Signal and completes only from current `GOOD` quality. `BAD`, `UNCERTAIN`, and `STALE` retained values cannot satisfy it.
- A disconnect retains the last display value, changes its quality to `STALE`, sets status to `BadNoCommunication`, and never transfers ownership to Manual.
- One SetDO instruction issues one OPC UA `Session.write`; it advances only after a terminal `SUCCEEDED` result. Any rejection or failed write fails the Job with the returned stable code.
- The Gateway rejects wrong Project, wrong Revision, stale lease generation, expired request, disconnected Endpoint, type mismatch, and direction mismatch before calling `Session.write`.
- Retain at most 4,096 command deduplication records. An identical duplicate of an admitted record returns the retained in-flight/terminal result even after the original request expiry; preflight-rejected records are not retained. A reused admitted command identity `(projectId, configRevision, leaseGeneration, targetId, commandId)` with a different fingerprint fails as `COMMAND_ID_CONFLICT` without a second write. Temporal and target preflight applies only to a new record and runs before admission. Evict the oldest terminal record before admitting a new record; if all 4,096 records are in-flight, reject the new command before its operation starts as `COMMAND_DEDUPE_CAPACITY_EXHAUSTED`.
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
- `middleware/runtime-gateway/opcua-client-read-plan.ts` and test — endpoint-wide V5 root-node planning and Project-semantic Mapping assembly.
- `middleware/runtime-gateway/opcua-client-write-service.ts` and test — deterministic Mapping compilation, live-Session Namespace resolution, and one OPC UA write.
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

- `src/core/runtime-protocol/v1.ts` and test — Task 2 removes all Project V4 imports and makes revision staging V5-only before adapter preparation.
- `middleware/runtime-gateway/opcua-client-adapter.ts` and test — Task 2 atomically becomes V5-only, adds endpoint-wide root subscriptions, and exposes one live-Session write boundary.
- `middleware/runtime-gateway/opcua-server-adapter.ts` and test — Task 2 performs the narrow V5 compatibility cutover while retaining temporary Server/Bridge telemetry until Milestone 4.
- `middleware/runtime-gateway/main.ts` and test — Task 2 owns V5 staging/adapter activation; Task 3 adds active command generation, lease route, and command route.
- `src/features/signals/v5/logical-signal-runtime-store.ts` and test — accept valid Signal values assembled from either scalar or structured OPC UA roots.
- `package.json` — add a focused `test:job-io` verification script.

## Runtime Interfaces Used Across Tasks

These signatures are fixed for this plan. Later tasks consume them verbatim.

```ts
export type LogicalSignalRuntimeQualityV1 = 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE'

export interface EndpointCatchupGuardV5 {
  commit(): void
  abort(): void
}

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
  restoreReplayPrefix(batch: StateBatchV1, receivedTimestampMs: number): boolean
  beginEndpointCatchup(endpointId: string, atMs: number): EndpointCatchupGuardV5
  markEndpointDisconnected(endpointId: string, atMs: number): void
  resetEndpointSession(endpointId: string, atMs: number): void
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
  restoreReplayPrefix(batch: StateBatchV1, receivedTimestampMs: number): boolean
  beginEndpointCatchup(endpointId: string, atMs: number): EndpointCatchupGuardV5
  sampleFrame(entityId: string, frameId: string, renderTimestampMs: number): ObjectFrameRuntimeValueV5 | null
  readNumericStatus(entityId: string): ObjectNumericStatusRuntimeValueV5 | null
  markEndpointDisconnected(endpointId: string, atMs: number): void
  resetEndpointSession(endpointId: string, atMs: number): void
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
  restoreReplayPrefix(batch: StateBatchV1, receivedTimestampMs: number): boolean
  beginEndpointCatchup(endpointId: string, atMs: number): EndpointCatchupGuardV5
  sampleFrame(robotId: string, frameId: string, renderTimestampMs: number): RobotFrameRuntimeValueV5 | null
  readNumericStatus(robotId: string): Readonly<{
    value: number | null
    quality: LogicalSignalRuntimeQualityV1
    statusCode: string
    owner: 'manual' | 'simulation' | `opcua:${string}`
  }> | null
  markEndpointDisconnected(endpointId: string, atMs: number): void
  resetEndpointSession(endpointId: string, atMs: number): void
  resetGatewaySession(atMs: number): void
}

export interface GatewaySignalWritePortV1 {
  writeBoolean(signalId: string, value: boolean, signal?: AbortSignal): Promise<CommandResultV1>
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

`EndpointCatchupGuardV5` is a structural contract, not a reason for Signal/Scene/Robot stores to import the runtime-gateway feature. Define the exported stream-side name in the V5 stream module and use the same readonly `{ commit(): void; abort(): void }` shape locally at store boundaries.

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

Sequence acceptance is independent per Endpoint. Tests must ingest two Endpoints, reject only a non-increasing sequence for the affected Endpoint, and prove that disconnecting one Endpoint marks only its owned Signal/Frame/Status channels STALE. Also prove that a value carrying an unknown or wrong-target Mapping ID cannot mutate another store, that older source timestamps and an immutable future envelope (`sourceTimestampMs > publishedTimestampMs`) cannot rewind or snap an emitted pose regardless of browser receipt time, that duplicate or partial six-path Frames are rejected with the existing Project V5 validation codes (`OPCUA_READ_OWNER_DUPLICATE` or `OPCUA_PROJECT_PATH_INVALID`) without replacing an active runtime snapshot, and that numeric Status is held rather than interpolated.

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

### Task 2: Atomically Cut the Gateway to V5 and Add the Typed OPC UA Client Boundary

**Files:**
- Create: `middleware/runtime-gateway/opcua-client-read-plan.ts`
- Test: `middleware/runtime-gateway/opcua-client-read-plan.test.ts`
- Create: `middleware/runtime-gateway/opcua-client-write-service.ts`
- Test: `middleware/runtime-gateway/opcua-client-write-service.test.ts`
- Modify: `middleware/runtime-gateway/opcua-client-adapter.ts`
- Test: `middleware/runtime-gateway/opcua-client-adapter.test.ts`
- Modify: `middleware/runtime-gateway/opcua-server-adapter.ts`
- Test: `middleware/runtime-gateway/opcua-server-adapter.test.ts`
- Modify: `middleware/runtime-gateway/main.ts`
- Test: `middleware/runtime-gateway/main.test.ts`
- Modify: `src/core/runtime-protocol/v1.ts`
- Test: `src/core/runtime-protocol/v1.test.ts`
- Modify: `src/features/signals/v5/logical-signal-runtime-store.ts`
- Test: `src/features/signals/v5/logical-signal-runtime-store.test.ts`

**Interfaces:**
- Consumes: validated V5 Endpoint/Mapping/Signal contracts, Task 1 canonical Frame consumers, and the live `ClientSession` plus connection generation held by `OpcUaClientAdapterV1`.
- Produces: a V5-only Runtime Protocol/Gateway/adapter boundary; `compileOpcUaClientReadPlanV1`, `resolveOpcUaClientReadRootsV1`, `groupResolvedRootsBySamplingIntervalV1`, and `assembleMappingValueV1`; `CompiledOpcUaClientWriteV1`, `OpcUaClientWriteRequestV1`, `OpcUaClientWriteResultV1`, `compileOpcUaClientWritePlanV1`, `createOpcUaClientWriteServiceV1`; and `OpcUaClientAdapterV1.write`.

- [ ] **Step 1: Write the RED V5 cutover, root-plan, assembly, and one-write tests**

Add protocol and static-boundary regressions first:

```ts
it('accepts a staged Project V5 and rejects a staged Project V4', () => {
  expect(validateRevisionStageRequestV1(revisionStageRequest(projectV5)))
    .toMatchObject({ project: { schemaVersion: 5 } })
  expect(() => validateRevisionStageRequestV1(revisionStageRequest(projectV4)))
    .toThrowError(expect.objectContaining({ code: 'PROJECT_SCHEMA_UNSUPPORTED' }))
})

it('has no production Gateway dependency on project-v4', async () => {
  for (const source of await gatewayCutoverSources()) {
    expect(source).not.toContain('project-v4')
    expect(source).not.toContain('WorkcellProjectV4')
  }
})

it('rejects a V4 project at PUT before adapter preparation and retains active V5', async () => {
  const harness = await activeGatewayHarness(projectV5)
  const before = harness.activeSnapshot()
  const clientCalls = harness.createClientAdapter.mock.calls.length
  const serverCalls = harness.createServerAdapter.mock.calls.length
  await expect(harness.putRuntimeProject(projectV4)).resolves.toMatchObject({ status: 400 })
  expect(harness.createClientAdapter).toHaveBeenCalledTimes(clientCalls)
  expect(harness.createServerAdapter).toHaveBeenCalledTimes(serverCalls)
  expect(harness.activeSnapshot()).toEqual(before)
})
```

Add read-planning and assembly regressions:

```ts
it('deduplicates a shared root endpoint-wide and fans out to ordered Mapping consumers', () => {
  const endpoint = compileOpcUaClientReadPlanV1(projectWithTwoMappingsOnObjectPos())[0]!
  expect(endpoint.monitoredRoots).toEqual([expect.objectContaining({
    rootKey: `plc\0${opcUaNodeAddressKeyV1(objectPosAddress)}`,
    mappingIds: ['box-pose', 'box-status'],
    samplingIntervalMs: 50,
  })])
})

it('keeps roots with different sampling intervals in separate monitored groups', () => {
  const endpoint = compileOpcUaClientReadPlanV1(projectWithFastAndSlowRoots())[0]!
  const resolved = resolveOpcUaClientReadRootsV1(endpoint.monitoredRoots, sessionNamespaceArray())
  expect(groupResolvedRootsBySamplingIntervalV1(resolved))
    .toEqual([
      expect.objectContaining({ samplingIntervalMs: 50, roots: [expect.objectContaining({ mappingIds: ['fast'] })] }),
      expect.objectContaining({ samplingIntervalMs: 100, roots: [expect.objectContaining({ mappingIds: ['slow'] })] }),
    ])
})

it('assembles a typed-array root into the canonical Project Frame pose', () => {
  expect(assembleMappingValueV1(arrayObjectPoseMapping(), new Float64Array([1, 2, 3, 10, 20, 30])))
    .toMatchObject({ ok: true, value: { positionM: [1, 2, 3] } })
})

it('uses leafPath only for source extraction and projectPath only for destination assembly', () => {
  expect(assembleMappingValueV1(extensionObjectPoseMapping(), extensionObjectPose()))
    .toMatchObject({ ok: true, value: { positionM: [1, 2, 3] } })
})
```

Add write and lifecycle regressions against an actual `ClientSession`-shaped fake:

```ts
it('writes one Boolean Value through the still-current live Session', async () => {
  const session = fakeSession({ namespaceArray: ['http://opcfoundation.org/UA/', 'urn:virtual-plc'] })
  const service = createOpcUaClientWriteServiceV1(projectWithBooleanOutput(), currentSessionHarness(session))
  await expect(service.write({ mappingId: 'map-start', value: true }))
    .resolves.toEqual({ ok: true, statusCode: 'Good' })
  expect(session.write).toHaveBeenCalledOnce()
  expect(session.write).toHaveBeenCalledWith({
    nodeId: 'ns=1;s=Start', attributeId: AttributeIds.Value,
    value: { value: { dataType: DataType.Boolean, value: true } },
  })
})

it('connects a write-only Endpoint with an empty active Subscription', async () => {
  const adapter = createOpcUaClientAdapterV1(projectWithWriteOnlyEndpoint(), fakeClientOptions())
  await adapter.start()
  await eventually(() => adapter.status()[0]?.phase === 'connected')
  expect(adapter.status()[0]).toMatchObject({
    subscriptionActive: true, monitoredItemCount: 0, mappingCount: 1,
  })
})

it('recovers a write-only Endpoint when its empty Subscription terminates', async () => {
  const harness = writeOnlyAdapterHarness()
  await harness.adapter.start()
  await eventually(() => harness.adapter.status()[0]?.phase === 'connected')
  await harness.firstSubscription.terminateFromServer()
  expect(harness.adapter.status()[0]?.phase).toBe('reconnecting')
  await expect(harness.adapter.write({ mappingId: 'map-start', value: true }))
    .resolves.toMatchObject({ ok: false, failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED' })
  await eventually(() => harness.subscriptions.length === 2)
  expect(harness.subscriptions[1]!.monitoredGroupCount).toBe(0)
})
```

Also add tests for Namespace Index change after reconnect, all four Node identifier kinds, absent Namespace URI, namespace-read failure, non-Good write StatusCode, write-versus-stop/reconnect generation races, scalar Signal extraction from a structured root, Float64Array and ExtensionObject reads, numeric range/type/scale failures, retained last complete payload on invalid/BAD/UNCERTAIN notification, and no publication before any complete GOOD payload exists.

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/core/runtime-protocol/v1.test.ts src/features/signals/v5/logical-signal-runtime-store.test.ts middleware/runtime-gateway/opcua-client-read-plan.test.ts middleware/runtime-gateway/opcua-client-write-service.test.ts middleware/runtime-gateway/opcua-client-adapter.test.ts middleware/runtime-gateway/opcua-server-adapter.test.ts middleware/runtime-gateway/main.test.ts
```

Expected: FAIL because Gateway staging/adapters are V4, no V5 root plan or live-Session write port exists, and a valid structured-root Signal Mapping is still ignored by the browser store.

- [ ] **Step 3: Implement the endpoint-wide read plan and Project-semantic assembly**

```ts
export interface CompiledOpcUaClientMonitoredRootV1 {
  readonly rootKey: string
  readonly endpointId: string
  readonly nodeAddress: OpcUaNodeAddressV1
  readonly mappingIds: readonly string[]
  readonly samplingIntervalMs: number
}

export interface CompiledOpcUaClientEndpointReadPlanV1 {
  readonly endpointId: string
  readonly monitoredRoots: readonly CompiledOpcUaClientMonitoredRootV1[]
}

export interface ResolvedOpcUaClientMonitoredRootV1 {
  readonly rootKey: string
  readonly endpointId: string
  readonly nodeId: string
  readonly mappingIds: readonly string[]
  readonly samplingIntervalMs: number
}

export interface ResolvedOpcUaClientMonitoredGroupV1 {
  readonly samplingIntervalMs: number
  readonly roots: readonly ResolvedOpcUaClientMonitoredRootV1[]
}

export function groupResolvedRootsBySamplingIntervalV1(
  roots: readonly ResolvedOpcUaClientMonitoredRootV1[],
): readonly ResolvedOpcUaClientMonitoredGroupV1[]

export function compileOpcUaClientReadPlanV1(
  project: WorkcellProjectV5,
): readonly CompiledOpcUaClientEndpointReadPlanV1[]

export function resolveOpcUaClientReadRootsV1(
  roots: readonly CompiledOpcUaClientMonitoredRootV1[],
  namespaceArray: readonly string[],
): readonly ResolvedOpcUaClientMonitoredRootV1[]

export type AssembleMappingValueResultV1 =
  | { readonly ok: true; readonly value: RuntimeScalarOrStructureV1; readonly unit: string }
  | { readonly ok: false; readonly statusCode: 'BadNoData' | 'BadTypeMismatch' | 'BadOutOfRange' }
```

Validate the V5 Project before compilation. Define a root as `endpointId + '\0' + opcUaNodeAddressKeyV1(nodeAddress)`. Deduplicate roots across the entire Endpoint, retain Mapping consumers in Project order, and use the minimum effective publishing interval across those consumers. Resolve each root against the exact Namespace URI in the current Session NamespaceArray. Support `string`, `numeric`, `guid`, and `byteString` identifiers and emit canonical `ns=<index>;s|i|g|b=<identifier>` NodeId text. Resolved NodeIds are Session-generation state only and are discarded on stop/recovery. Because `ClientSubscription.monitorItems` applies one `MonitoringParametersOptions` object to an entire group, group resolved roots by `samplingIntervalMs`, create one monitored-item group per distinct interval, retain every group in the Endpoint runtime, and terminate every group during recovery/stop. A write-only Endpoint retains its empty Subscription and zero monitored groups.

`leafPath` extracts only from the root scalar, normal array, typed array, or ExtensionObject. Validate Boolean/String exactly; SByte/Byte/Int16/UInt16/Int32/UInt32 require integral in-range input; Float/Double require finite input. Apply numeric `scale` and `offset`, require a finite result, and retain `Math.trunc` when `projectDataType === 'integer'`. Use only `projectPath` for destination assembly. Entity and Robot Frames require the six Project-validated destinations, apply scale/offset first, then perform exactly one RPY-degrees-to-quaternion conversion and emit exactly `{ positionM: [x,y,z], quaternion: [x,y,z,w] }`. Duplicate/incomplete destinations are canonical Project V5 validation failures before adapter preparation; runtime BAD is only missing source paths, invalid runtime types/ranges/scales, or non-Good source quality.

One root notification fans out to every consuming Mapping. Normalize OPC UA status with `StatusCode.name` and severity to `GOOD`, `UNCERTAIN`, or `BAD`. A complete GOOD assembly becomes the retained payload. BAD/UNCERTAIN or invalid assembly publishes the last complete payload with the current quality/status; if no complete payload exists, publish nothing and leave Task 1 state at `BAD/BadWaitingForInitialData`. Never publish a partial or fabricated identity pose. Remove the Task 1 Signal store's `leafPath.length === 0` compile filter: it receives the already assembled scalar and must accept a valid structured-root logical-signal Mapping.

- [ ] **Step 4: Implement the exact live-Session Boolean write**

```ts
export interface CompiledOpcUaClientWriteV1 {
  readonly mappingId: string
  readonly endpointId: string
  readonly signalId: string
  readonly nodeAddress: OpcUaNodeAddressV1
  readonly dataType: 'Boolean'
}

export interface OpcUaClientWriteRequestV1 {
  readonly mappingId: string
  readonly value: boolean
}

export type OpcUaClientWriteResultV1 =
  | { readonly ok: true; readonly statusCode: 'Good' }
  | { readonly ok: false; readonly statusCode: string; readonly failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED' | 'OPC_UA_WRITE_MAPPING_INVALID' | 'OPC_UA_WRITE_REJECTED' | 'OPC_UA_WRITE_FAILED'; readonly message: string }

export interface OpcUaClientSessionLeaseV1 {
  readonly endpointId: string
  readonly generation: number
  readonly session: Pick<ClientSession, 'readNamespaceArray' | 'write'>
}

export interface OpcUaClientWriteServiceDependenciesV1 {
  currentSession(endpointId: string): OpcUaClientSessionLeaseV1 | null
}

export interface OpcUaClientWriteServiceV1 {
  write(request: OpcUaClientWriteRequestV1): Promise<OpcUaClientWriteResultV1>
}

export function createOpcUaClientWriteServiceV1(
  project: WorkcellProjectV5,
  dependencies: OpcUaClientWriteServiceDependenciesV1,
): OpcUaClientWriteServiceV1

export interface OpcUaClientAdapterV1 {
  start(): Promise<void>
  stop(): Promise<void>
  status(): readonly RuntimeGatewayOpcUaClientEndpointStatusV1[]
  write(request: OpcUaClientWriteRequestV1): Promise<OpcUaClientWriteResultV1>
}
```

`compileOpcUaClientWritePlanV1` accepts only an enabled `write`/`readWrite` Mapping targeting a Boolean `output`/`bidirectional` Signal with exactly one required leaf whose `leafPath` and `projectPath` are both empty and whose `opcUaDataType` is `Boolean`. A structured-root Boolean Mapping is valid for reading but is not a scalar root write target and must not enter the write plan. The write service calls `dependencies.currentSession(endpointId)` before NamespaceArray resolution, calls the captured `session.readNamespaceArray()` immediately before each write, resolves the URI exactly, then calls `currentSession(endpointId)` again and compares both generation and Session object identity before calling `session.write` once with `AttributeIds.Value` and `DataType.Boolean`. Never cache a Namespace Index across Session generations. Accept only the exact numeric value of `StatusCodes.Good`; use `statusCode.name` for results. An absent URI returns `OPC_UA_WRITE_FAILED/BadNodeIdUnknown`; a namespace-read or Session-write exception returns `OPC_UA_WRITE_FAILED/BadCommunicationError`; a changed/absent Session returns `OPC_UA_ENDPOINT_DISCONNECTED/BadNoCommunication`; unknown or non-write Mapping returns `OPC_UA_WRITE_MAPPING_INVALID/BadInvalidArgument`; any returned non-Good StatusCode becomes `OPC_UA_WRITE_REJECTED` with its exact `.name`. Task 2 does no command deduplication.

- [ ] **Step 5: Perform the atomic V5 Gateway/adapter cutover and preserve lifecycle behavior**

Change Runtime Protocol revision staging, `main.ts`, `OpcUaClientAdapterV1`, and `OpcUaServerAdapterV1` together to validated `WorkcellProjectV5`. Remove every production Project V4 import from those files. Do not use a V4/V5 union, cast, overload, migration alias, or translator. Preserve Off/Client/Server/Bridge candidate preparation, rollback, status diagnostics, nonblocking Client `start()`, and the temporary custom Server telemetry tree. Server telemetry derives its IDs from V5 Robot Definition/Instance records only; official Robotics NodeSets remain Milestone 4.

The Client connection plan includes every enabled Client/Bridge Endpoint having at least one compiled read or write Mapping. Always create a Subscription for a connected Endpoint; a write-only Endpoint has an empty Subscription, no monitored group, and zero monitored items so the current status invariant (`connected` implies `subscriptionActive`) remains true. Attach a `subscription.on('terminated')` recovery handler to every Endpoint Subscription, including an empty write-only Subscription. Termination invalidates the Session generation/lease before setting `reconnecting`, makes writes fail disconnected, closes remaining resources, and schedules creation of a new Session plus empty Subscription. Do not rely only on monitored-group termination events. `mappingCount` is the number of distinct enabled read-or-write Mapping IDs for that Endpoint, so one `readWrite` Mapping counts once; `monitoredItemCount` is the number of deduplicated read roots. Before `start`, while connecting/reconnecting, and after `stop`, `write()` returns disconnected. `stop()` invalidates the Session generation before closing resources, prevents new writes, and waits for pending connection/recovery work. A transport loss after `Session.write` begins maps the thrown error to `OPC_UA_WRITE_FAILED` because the one authorized write was attempted.

Candidate activation remains atomic: validate and prepare the V5 candidate, start both requested adapters, and publish it only after both succeed. On failure, stop candidate adapters and retain the prior active V5 runtime and adapters. Preserve the existing bare-Project `PUT /runtime/project` HTTP body and compute `configRevisionForProjectV5(validatedProject)` exactly once at that Gateway publication boundary. Separately, `RevisionStageRequestV1` continues to carry and validate its caller-supplied canonical Project hash. In both paths the active/staged `configRevision` is the canonical Project hash, never `project.revisionId`; do not change the HTTP request body into a stage envelope.

- [ ] **Step 6: Run GREEN, Gateway build, and commit**

```powershell
npm run test:run -- src/core/runtime-protocol/v1.test.ts src/features/signals/v5/logical-signal-runtime-store.test.ts middleware/runtime-gateway/opcua-client-read-plan.test.ts middleware/runtime-gateway/opcua-client-write-service.test.ts middleware/runtime-gateway/opcua-client-adapter.test.ts middleware/runtime-gateway/opcua-server-adapter.test.ts middleware/runtime-gateway/main.test.ts
npm run test:run
npm run build:gateway
npm run lint
npm run build
git add src/core/runtime-protocol/v1.ts src/core/runtime-protocol/v1.test.ts src/features/signals/v5/logical-signal-runtime-store.ts src/features/signals/v5/logical-signal-runtime-store.test.ts middleware/runtime-gateway/opcua-client-read-plan.ts middleware/runtime-gateway/opcua-client-read-plan.test.ts middleware/runtime-gateway/opcua-client-write-service.ts middleware/runtime-gateway/opcua-client-write-service.test.ts middleware/runtime-gateway/opcua-client-adapter.ts middleware/runtime-gateway/opcua-client-adapter.test.ts middleware/runtime-gateway/opcua-server-adapter.ts middleware/runtime-gateway/opcua-server-adapter.test.ts middleware/runtime-gateway/main.ts middleware/runtime-gateway/main.test.ts
git diff --cached --check
git commit -m "feat: cut gateway client boundary to project v5"
```

Expected: all focused and full tests PASS, Gateway/browser TypeScript compile, and no production import or compatibility path to Project V4 remains in the cutover files.

### Task 3: Fence, Deduplicate, and Transport Runtime Commands

**Files:**
- Create: `middleware/runtime-gateway/runtime-command-dedupe-registry.ts`
- Test: `middleware/runtime-gateway/runtime-command-dedupe-registry.test.ts`
- Create: `middleware/runtime-gateway/runtime-command-service.ts`
- Test: `middleware/runtime-gateway/runtime-command-service.test.ts`
- Modify: `middleware/runtime-gateway/deployment-config.ts`
- Test: `middleware/runtime-gateway/deployment-config.test.ts`
- Modify: `middleware/runtime-gateway/main.ts`
- Test: `middleware/runtime-gateway/main.test.ts`

**Interfaces:**
- Consumes: the Task 2 V5-only Gateway/adapter boundary, `compileOpcUaClientWritePlanV1`, `OpcUaClientAdapterV1.status/write`, Runtime Protocol v1 validators, and Task 2's atomic activation/recovery lifecycle.
- Produces: `RuntimeCommandDedupeRegistryV1`, `RuntimeCommandDedupeAdmissionErrorV1`, `RuntimeCommandServiceV1`, process-local active generation, `GET /runtime/command-lease`, and `POST /runtime/command`.

- [ ] **Step 1: Write RED dedupe, fencing, and close-race tests**

```ts
it('inserts before invoking the operation so simultaneous duplicates join one write', async () => {
  const gate = deferred<CommandResultV1>()
  const key = commandKey(request)
  const operation = vi.fn(() => {
    expect(registry.has('client-write', key)).toBe(true)
    return gate.promise
  })
  const record = commandRecord('client-write', key, commandFingerprint(request))
  const first = registry.execute(record, { preflight: () => null, operation })
  const duplicate = registry.execute(structuredClone(record), { preflight: () => null, operation })
  expect(first).toBe(duplicate)
  expect(operation).toHaveBeenCalledOnce()
  gate.resolve(terminal(request))
  await expect(Promise.all([first, duplicate])).resolves.toEqual([terminal(request), terminal(request)])
})

it.each([
  ['wrong project', { projectId: 'other-project' }, 'PROJECT_MISMATCH'],
  ['wrong revision', { configRevision: OTHER_REVISION }, 'REVISION_MISMATCH'],
  ['stale generation', { leaseGeneration: 6 }, 'COMMAND_LEASE_STALE'],
  ['expired', { expiresAt: 999 }, 'COMMAND_EXPIRED'],
  ['too far in the future', { expiresAt: 6_001 }, 'COMMAND_EXPIRY_INVALID'],
  ['unknown target', { targetId: 'missing-mapping' }, 'COMMAND_TARGET_INVALID'],
  ['non-write target', { targetId: 'read-only-mapping' }, 'COMMAND_TARGET_INVALID'],
  ['wrong direction', { targetId: 'wrong-direction-mapping' }, 'COMMAND_TARGET_INVALID'],
  ['wrong type', { value: 1 }, 'COMMAND_TYPE_MISMATCH'],
  ['disconnected endpoint', { targetId: 'disconnected-output' }, 'OPC_UA_ENDPOINT_DISCONNECTED'],
])('%s is an unretained rejection before write', async (_name, override, failureCode) => {
  const write = vi.fn()
  const service = createRuntimeCommandServiceV1(activeContext({ write, generation: 7, nowMs: 1_000 }))
  await expect(service.execute(commandRequest(override))).resolves.toMatchObject({
    acknowledgement: 'REJECTED', executionState: 'FAILED', failureCode,
  })
  expect(write).not.toHaveBeenCalled()
  expect(service.size()).toBe(0)
})

it('accepts expiresAt equal to the fixed five-second boundary using one preflight clock sample', async () => {
  const nowMs = vi.fn().mockReturnValueOnce(1_000).mockReturnValue(1_001)
  const service = createRuntimeCommandServiceV1(activeContext({ nowMs }))
  await expect(service.execute(commandRequest({ expiresAt: 6_000 }))).resolves.toMatchObject({
    acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED', failureCode: null,
  })
  expect(nowMs).toHaveBeenCalledTimes(2) // one preflight sample and one completion timestamp
})

it('keys identity by active context and rejects only a same-identity fingerprint conflict', async () => {
  const original = commandRequest({ commandId: 'same', value: false })
  await service.execute(original)
  await expect(service.execute({ ...original, value: true })).resolves.toMatchObject({
    failureCode: 'COMMAND_ID_CONFLICT',
  })
  expect(commandKey({ ...original, leaseGeneration: original.leaseGeneration + 1 }))
    .not.toBe(commandKey(original))
})

it('evicts only the oldest terminal record when in-flight and terminal records share capacity', async () => {
  const oldestInFlightKey = startOldestInFlightRecord(registry)
  const nextOldestTerminalKey = await insertNextTerminalRecord(registry)
  await fillRemainingMixedCapacity(registry, { terminal: 2_047, inFlight: 2_047 })
  await registry.execute(nextRecord, acceptedCallbacks())
  expect(registry.size()).toBe(4_096)
  expect(registry.has('client-write', nextOldestTerminalKey)).toBe(false)
  expect(registry.has('client-write', oldestInFlightKey)).toBe(true)
})

it('rejects record 4097 before execution when all 4096 records are in flight', async () => {
  await fillInFlightRecordsWithoutSettling(registry, 4_096)
  const operation = vi.fn()
  await expect(registry.execute(overflowRecord, { preflight: () => null, operation }))
    .rejects.toMatchObject({ code: 'COMMAND_DEDUPE_CAPACITY_EXHAUSTED' })
  expect(operation).not.toHaveBeenCalled()
})

it('does not resurrect an in-flight record after clear and completion', async () => {
  const gate = deferred<CommandResultV1>()
  const result = registry.execute(record, { preflight: () => null, operation: () => gate.promise })
  registry.clear()
  gate.resolve(terminal(request))
  await result
  expect(registry.size()).toBe(0)
})

it('close fences new records, settles a never-ending admitted write, and preserves joined duplicates', async () => {
  const write = vi.fn(() => new Promise<never>(() => undefined))
  const service = createRuntimeCommandServiceV1(activeContext({ write }))
  const request = commandRequest()
  const first = service.execute(request)
  const joined = service.execute(structuredClone(request))
  service.close()
  const afterClose = service.execute(structuredClone(request))
  expect(first).toBe(joined)
  expect(first).toBe(afterClose)
  expect(write).toHaveBeenCalledOnce()
  await expect(Promise.all([first, joined, afterClose])).resolves.toEqual([
    expect.objectContaining({ acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_SERVICE_CLOSED' }),
    expect.objectContaining({ acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_SERVICE_CLOSED' }),
    expect.objectContaining({ acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_SERVICE_CLOSED' }),
  ])
  await expect(service.execute(commandRequest({ commandId: 'new' }))).resolves.toMatchObject({
    acknowledgement: 'REJECTED', failureCode: 'COMMAND_LEASE_STALE',
  })
})
```

Also test retained identical results after expiry, different-fingerprint conflict before preflight/operation, one shared 4,096-record budget across `client-write` and future `server-command`, completion/admission interleaving without in-flight eviction, unexpected adapter rejection becoming a retained `ACCEPTED/FAILED OPC_UA_WRITE_FAILED` result, exact 13-field terminal envelopes, and non-Good Task 2 write results mapping without a `statusCode` field.

- [ ] **Step 2: Write RED Gateway generation, HTTP, and shutdown tests**

```ts
it('publishes generation one and renews the fixed client-write lease', async () => {
  const clock = controlledClock(1_000)
  const harness = activeClientGateway({ gatewayId: 'gateway-a', nowMs: clock.now })
  await expect(harness.get('/runtime/command-lease')).resolves.toEqual({
    status: 200,
    body: {
      projectId: harness.project.projectId, configRevision: harness.configRevision,
      publisherId: 'gateway-a:client-write', generation: 1, expiresAt: 6_000,
    },
  })
  clock.set(1_250)
  await expect(harness.get('/runtime/command-lease')).resolves.toMatchObject({
    status: 200,
    body: { publisherId: 'gateway-a:client-write', generation: 1, expiresAt: 6_250 },
  })
})

it('admits under the runtime transition fence but awaits the write outside it', async () => {
  const writeGate = deferred<OpcUaClientWriteResultV1>()
  const command = harness.postCommand(commandRequest(), () => writeGate.promise)
  await harness.waitForAdmission()
  await expect(harness.putProject(nextProject)).resolves.toMatchObject({ status: 200 })
  writeGate.resolve({ ok: false, failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED', statusCode: 'BadNoCommunication', message: 'stopped' })
  await expect(command).resolves.toMatchObject({ status: 200, body: { acknowledgement: 'ACCEPTED', executionState: 'FAILED' } })
})

it('retains generation and dedupe on recovered failure, then advances old plus one on success', async () => {
  const before = await harness.getLease()
  await harness.completeOneCommand('retained-id')
  await expect(harness.putProject(failingCandidate)).resolves.toMatchObject({ status: 503 })
  expect(await harness.getLease()).toMatchObject({ generation: before.generation })
  expect(await harness.retryCommand('retained-id')).toEqual(harness.retainedResult)
  await harness.putProject(nextProject)
  expect(await harness.getLease()).toMatchObject({ generation: before.generation + 1 })
})

it('stops without waiting for a never-settling Client write', async () => {
  const request = harness.postCommand(commandRequest(), neverSettlingWrite)
  await harness.waitForAdmission()
  await expect(harness.stop()).resolves.toBeUndefined()
  await expect(request).resolves.toMatchObject({ status: 200, body: { failureCode: 'COMMAND_SERVICE_CLOSED' } })
})
```

Add tests for first/same-revision generation and fresh registry, failed activation not consuming a generation, safe-integer exhaustion before any adapter stop, candidate cleanup, recovered rollback retaining old service, double-failure cleanup/non-ready behavior, and active resource cleanup during stop. Client activation and lease availability intentionally do not wait for an Endpoint connection; an offline Client still returns a lease, rejects a valid command unretained as `OPC_UA_ENDPOINT_DISCONNECTED`, and an identical retry may later succeed after status becomes `connected`.

The exact HTTP matrix is:

| Request | Status | Body |
|---|---:|---|
| `GET /runtime/command-lease` with active Client role | 200 | exact validated `RuntimePublisherLeaseV1` |
| `GET /runtime/command-lease` without active Client role | 409 | exact closed `{ code: 'OPC_UA_CLIENT_NOT_ACTIVE', message }` |
| valid `POST /runtime/command` with Client role | 200 | exact validated `CommandResultV1` |
| valid `POST /runtime/command` without Client role | 200 | `REJECTED/FAILED OPC_UA_CLIENT_NOT_ACTIVE`, echoing validated request identity |
| structurally invalid Command Request | 400 | exact closed `{ code: 'COMMAND_REQUEST_INVALID', message }` |
| malformed JSON | 400 | existing `JSON_BODY_INVALID` error |
| unsupported content type | 415 | existing `CONTENT_TYPE_UNSUPPORTED` error |
| body over `MAX_RUNTIME_BATCH_BYTES_V1` by declared or streamed size | 413 | existing `REQUEST_BODY_TOO_LARGE` error |
| wrong route or method | 404 | existing empty response |

Every POST first calls `readJsonBody(request, MAX_RUNTIME_BATCH_BYTES_V1)` and `validateCommandRequestV1`; transport/protocol failures never call the adapter. Every syntactically valid POST returns HTTP 200, including semantic, capacity, connectivity, write, and no-Client failures. Every Task 3 result has exactly the 13 Runtime Protocol fields, echoes the validated request's Project/Revision/generation/target/command identity, sets `attachedObjectId: null`, has terminal `completedAt`, and never adds `statusCode`. Test malformed JSON, invalid shape, unsupported content type, exact/plus-one declared and chunked limits, and no execution on every error.

Add deployment configuration tests accepting an ASCII `gatewayId` of exactly 115 characters and rejecting 116. Change the pattern to `^[A-Za-z0-9][A-Za-z0-9._-]{0,114}$` so both `${gatewayId}:client-write` and Task 2 `${gatewayId}:opcua-client` remain within the Runtime Protocol 128-byte identifier limit.

- [ ] **Step 3: Run RED**

```powershell
npm run test:run -- middleware/runtime-gateway/runtime-command-dedupe-registry.test.ts middleware/runtime-gateway/runtime-command-service.test.ts middleware/runtime-gateway/deployment-config.test.ts middleware/runtime-gateway/main.test.ts
```

Expected: FAIL because command registry/service/routes/generation do not exist, the Gateway ID bound is too large, and shutdown does not fence pending commands.

- [ ] **Step 4: Implement the bounded registry and command service**

```ts
export const RUNTIME_COMMAND_LEASE_TTL_MS_V1 = 5_000
export const MAX_RUNTIME_COMMAND_RECORDS_V1 = 4_096

export type RuntimeCommandChannelV1 = 'client-write' | 'server-command'

export interface RuntimeCommandDedupeRecordV1 {
  readonly channel: RuntimeCommandChannelV1
  readonly key: string
  readonly fingerprint: string
}

export interface RuntimeCommandDedupeRegistryV1 {
  execute(
    record: RuntimeCommandDedupeRecordV1,
    callbacks: Readonly<{
      preflight: () => CommandResultV1 | null
      operation: () => Promise<CommandResultV1>
    }>,
  ): Promise<CommandResultV1>
  size(): number
  has(channel: RuntimeCommandChannelV1, key: string): boolean
  clear(): void
}

export function createRuntimeCommandDedupeRegistryV1(): RuntimeCommandDedupeRegistryV1

export class RuntimeCommandDedupeAdmissionErrorV1 extends Error {
  readonly code: 'COMMAND_ID_CONFLICT' | 'COMMAND_DEDUPE_CAPACITY_EXHAUSTED'
}

export interface RuntimeCommandServiceV1 {
  lease(): RuntimePublisherLeaseV1
  execute(value: unknown): Promise<CommandResultV1>
  size(): number
  close(): void
}

export class RuntimeCommandServiceClosedErrorV1 extends Error {
  readonly code = 'COMMAND_LEASE_STALE' as const
}

export function createRuntimeCommandServiceV1(options: {
  readonly project: WorkcellProjectV5
  readonly configRevision: string
  readonly publisherId: string
  readonly generation: number
  readonly nowMs: () => number
  readonly clientAdapter: Pick<OpcUaClientAdapterV1, 'status' | 'write'>
  readonly dedupe: RuntimeCommandDedupeRegistryV1
}): RuntimeCommandServiceV1
```

The registry identity is `(channel, key)`, where a validated Client request key is exactly `JSON.stringify([projectId, configRevision, leaseGeneration, targetId, commandId])`; its fingerprint is exactly `JSON.stringify([projectId, configRevision, leaseGeneration, expiresAt, targetId, value])`. `execute` always returns a Promise. It checks an existing record synchronously: identical fingerprint joins the same in-flight/terminal Promise without rerunning preflight, while a conflict returns a rejected Promise with `COMMAND_ID_CONFLICT`. For a new key, run synchronous preflight; a rejected result is returned but not retained. Capacity admission follows. Insert a deferred record into the Map before invoking `operation`, convert a synchronous throw to a settled operation Promise, and never call `Map.set` again on completion so `clear()` cannot be undone.

At capacity, iterate insertion order and evict the oldest terminal record only. Never evict an in-flight record. If all 4,096 are in flight, return a rejected Promise with `COMMAND_DEDUPE_CAPACITY_EXHAUSTED` before operation. The budget is one shared active-runtime registry across both channels.

The service validates shape before computing identity. Existing identical records are returned before new-record preflight, preserving idempotent retries after expiry and already-admitted duplicates across close. For a new record, a closed service returns unretained `REJECTED/FAILED COMMAND_LEASE_STALE`; then use this exact semantic precedence: Project, Revision, generation, expiry, target, type, connectivity. Capture `nowMs()` once. Expired means `< now`; future-invalid means `> now + RUNTIME_COMMAND_LEASE_TTL_MS_V1`, so the exact boundary is accepted. Reuse `compileOpcUaClientWritePlanV1`; `targetId` is its Mapping ID. Require Boolean value and the exact target Endpoint status `phase === 'connected'`.

An admitted write is raced against the service close signal. Success is `ACCEPTED/SUCCEEDED`; any Task 2 failure or unexpected rejection is a retained `ACCEPTED/FAILED` result. Closing is idempotent, rejects new records, and settles a never-ending admitted operation once with `COMMAND_SERVICE_CLOSED`; identical callers already joined to that record, including a lookup after close, receive the same Promise/result. `close()` does not clear the injected registry because Milestone 4 shares it. Runtime disposal owns `registry.clear()`. While open, every `lease()` samples `nowMs()` once and returns the same Project/Revision/publisher/generation with `expiresAt = now + 5_000`; `lease()` after close throws a typed `COMMAND_LEASE_STALE` service error. Every result is passed through `validateCommandResultV1` and uses only these local failure codes: `PROJECT_MISMATCH`, `REVISION_MISMATCH`, `COMMAND_LEASE_STALE`, `COMMAND_EXPIRED`, `COMMAND_EXPIRY_INVALID`, `COMMAND_TARGET_INVALID`, `COMMAND_TYPE_MISMATCH`, `COMMAND_ID_CONFLICT`, `COMMAND_DEDUPE_CAPACITY_EXHAUSTED`, `COMMAND_SERVICE_CLOSED`, `OPC_UA_CLIENT_NOT_ACTIVE`, and Task 2's OPC UA write failure codes.

- [ ] **Step 5: Wire committed generation, command lifecycle, and HTTP routes**

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

Extend `RuntimeGatewayEntrypointDependenciesV1` with `initialCommittedCommandGeneration?: number`, defaulting to `0`; it accepts only a non-negative safe integer and is an explicit deterministic test/process-restore seam. Start the process-local committed generation from that value. Compute a tentative safe `committedGeneration + 1` before stopping prior adapters; safe-integer exhaustion is a 503 pre-destructive activation failure. A Gateway test seeds `Number.MAX_SAFE_INTEGER - 1`, successfully activates the prior Client/Bridge runtime at generation `Number.MAX_SAFE_INTEGER`, then proves the next PUT returns 503 before either prior adapter `stop()`, with readiness and the active max-generation lease unchanged. Create one fresh fixed-limit registry after candidate adapters start, and create the Client service only for Client/Bridge mode. Client `start()` remains nonblocking: service/lease availability does not claim Endpoint connectivity. Publish the candidate runtime and committed generation once, then close the previous service and clear its registry. Every successful activation, including Off/Server and the same Revision, advances generation and receives a fresh registry. A failed candidate does not consume generation.

Preserve Task 2 recovery exactly. If prior adapter recovery succeeds, retain its generation, service, registry, and records unchanged; discard only candidate command resources. If recovery fails, close/clear both candidate and prior command resources, keep Task 2's non-ready runtime and Hub deactivation, and do not advance generation. On Gateway stop, use the runtime transition queue first to detach the active runtime, close the service, clear the registry, and stop adapters; only then close Hub/WebSocket/HTTP resources. The service close race makes never-ending command handlers settle, so shutdown remains bounded.

For POST, parse and validate outside the runtime queue. Enter the existing runtime transition queue only long enough to select the active runtime and synchronously call `commandService.execute`, which performs registry lookup/admission before returning its Promise. Do not await the OPC UA operation inside the queue; await the captured result afterward. This prevents project replacement from stopping an adapter between active-runtime selection and admission without allowing a never-ending write to block activation. A missing Client service produces the exact validated no-Client result inside the same selection fence.

Add both command source files to the existing V5/no-Project-V4 static-boundary assertion. Do not modify Runtime Protocol v1 or the Server adapter in this task.

- [ ] **Step 6: Run GREEN and commit**

```powershell
npm run test:run -- src/core/runtime-protocol/v1.test.ts middleware/runtime-gateway
npm run test:run
npm run build:gateway
npm run lint
npm run build
git add middleware/runtime-gateway/runtime-command-dedupe-registry.ts middleware/runtime-gateway/runtime-command-dedupe-registry.test.ts middleware/runtime-gateway/runtime-command-service.ts middleware/runtime-gateway/runtime-command-service.test.ts middleware/runtime-gateway/deployment-config.ts middleware/runtime-gateway/deployment-config.test.ts middleware/runtime-gateway/main.ts middleware/runtime-gateway/main.test.ts
git diff --cached --check
git commit -m "feat: transport deduplicated runtime commands"
```

Expected: exact fencing/result/HTTP codes PASS; simultaneous duplicates execute once; mixed/all-in-flight capacity remains exactly 4,096; successful activation alone advances generation; recovered rollback retains prior dedupe; stop is bounded; Task 2 Client/Server/Bridge, Hub, and write lifecycle regressions remain green.

### Task 4: Stream Endpoint Lifecycle and Add the Browser Command Client

**Files:**
- Modify: `src/core/runtime-protocol/v1.ts`
- Test: `src/core/runtime-protocol/v1.test.ts`
- Modify: `middleware/runtime-gateway/state-batch-hub.ts`
- Test: `middleware/runtime-gateway/state-batch-hub.test.ts`
- Create: `middleware/runtime-gateway/runtime-stream-timeline.ts`
- Test: `middleware/runtime-gateway/runtime-stream-timeline.test.ts`
- Modify: `middleware/runtime-gateway/main.ts`
- Test: `middleware/runtime-gateway/main.test.ts`
- Modify: `src/features/signals/v5/logical-signal-runtime-store.ts`
- Test: `src/features/signals/v5/logical-signal-runtime-store.test.ts`
- Modify: `src/features/scene/v5/object-runtime-state.ts`
- Test: `src/features/scene/v5/object-runtime-state.test.ts`
- Modify: `src/features/robot/v5/robot-frame-status-runtime-store.ts`
- Test: `src/features/robot/v5/robot-frame-status-runtime-store.test.ts`
- Create: `src/core/project-v5/opcua-boolean-write-targets.ts`
- Test: `src/core/project-v5/opcua-boolean-write-targets.test.ts`
- Modify: `src/core/project-v5/index.ts`
- Modify: `middleware/runtime-gateway/opcua-client-write-service.ts`
- Test: `middleware/runtime-gateway/opcua-client-write-service.test.ts`
- Modify: `middleware/runtime-gateway/opcua-client-adapter.ts`
- Test: `middleware/runtime-gateway/opcua-client-adapter.test.ts`
- Create: `src/features/runtime-gateway/v5/runtime-gateway-command-client.ts`
- Test: `src/features/runtime-gateway/v5/runtime-gateway-command-client.test.ts`
- Create: `src/features/runtime-gateway/v5/runtime-gateway-state-stream.ts`
- Test: `src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts`
- Create: `src/features/runtime-gateway/v5/endpoint-lifecycle-router.ts`
- Test: `src/features/runtime-gateway/v5/endpoint-lifecycle-router.test.ts`

**Interfaces:**
- Consumes: Task 3 HTTP routes, `RuntimePublisherLeaseV1`, `CommandRequestV1`, and `CommandResultV1`.
- Produces: validated `EndpointLifecycleV1` messages, a bounded non-coalescible Hub barrier and replay timeline, Endpoint-local browser session reset/stale routing, one browser-safe writable-Boolean Mapping compiler shared with the Gateway, `RuntimeGatewayCommandClientV1`, `GatewaySignalWritePortV1`, and a discriminated multi-consumer Runtime stream.

- [ ] **Step 1: Write RED lifecycle, Hub replay, and Endpoint reset tests**

```ts
it('publishes connected before data and one zero-retained disconnect barrier', async () => {
  const published: RuntimeStreamMessageV1[] = []
  const adapter = clientAdapterHarness({
    publisherGeneration: 7,
    publish: (value) => published.push(readNormalizedOpcUaClientPublicationV1(value)),
  })
  await adapter.startEndpoint('plc-a')
  expect(published).toEqual([
    lifecycle({ endpointId: 'plc-a', sequence: 1, publisherGeneration: 7, sessionGeneration: 1, phase: 'connected' }),
  ])
  await adapter.loseSessionTwice('plc-a')
  expect(published).toEqual([
    expect.objectContaining({ type: 'endpoint-lifecycle-v1', phase: 'connected', sequence: 1 }),
    expect.objectContaining({ type: 'endpoint-lifecycle-v1', phase: 'disconnected', sequence: 2 }),
  ])
})

it('keeps a lifecycle barrier between coalesced snapshots for a blocked peer', () => {
  const socket = blockedSocketHarness()
  const hub = activeHub(['plc-a'])
  const publication = opcUaAdapterPublicationHarness()
  hub.attach(socket)
  hub.publish(publication.lifecycle({ endpointId: 'plc-a', sequence: 1, sessionGeneration: 1, phase: 'connected' }))
  hub.publish(publication.stateBatch({ endpointId: 'plc-a', sequence: 2, mappingId: 'a', value: 1 }))
  hub.publish(publication.stateBatch({ endpointId: 'plc-a', sequence: 3, mappingId: 'a', value: 2 }))
  hub.publish(publication.lifecycle({ endpointId: 'plc-a', sequence: 4, sessionGeneration: 1, phase: 'disconnected' }))
  hub.publish(publication.lifecycle({ endpointId: 'plc-a', sequence: 5, sessionGeneration: 2, phase: 'connected' }))
  hub.publish(publication.stateBatch({ endpointId: 'plc-a', sequence: 6, mappingId: 'a', value: 4 }))
  socket.releaseAll()
  expect(socket.messages.map(messageKindAndValue)).toEqual([
    ['lifecycle', 'connected'],
    ['catchup', 'start', 4],
    ['state', 2], ['lifecycle', 'disconnected'], ['lifecycle', 'connected'], ['state', 4],
    ['catchup', 'end', 4],
  ])
  expectExactBoundaryBytes(socket.messages, 'catchup')
})

it('resets only the connected Endpoint session and accepts its restarted source clock', () => {
  const stores = endpointStoreHarness(['plc-a', 'plc-b'])
  const router = createEndpointLifecycleRouterV5({
    readActiveContext: stores.readActiveContext,
    targets: stores.targets,
  })
  stores.ingest(goodState('plc-a', { sequence: 10, sourceTimestampMs: 80_000 }))
  stores.ingest(goodState('plc-b', { sequence: 12, sourceTimestampMs: 90_000 }))
  router.ingest(lifecycle({ endpointId: 'plc-a', sequence: 11, sessionGeneration: 2, phase: 'disconnected' }), 100_000)
  expect(stores.quality('plc-a')).toBe('STALE')
  expect(stores.quality('plc-b')).toBe('GOOD')
  router.ingest(lifecycle({ endpointId: 'plc-a', sequence: 12, sessionGeneration: 3, phase: 'connected' }), 100_100)
  expect(stores.quality('plc-a')).toBe('BAD')
  expect(stores.ingest(goodState('plc-a', { sequence: 13, sourceTimestampMs: 1_000 }))).toBe(true)
  expect(stores.quality('plc-a')).toBe('GOOD')
})
```

`opcUaAdapterPublicationHarness` must obtain wrappers through the real adapter normalization/construction path; it is not a public brand escape hatch. Keep separate compile/runtime RED cases proving `hub.publish(rawMessage)` is rejected and a forged `{ message }` wrapper fails the WeakSet reader without changing Hub state.

Add protocol tables for exact keys, discriminators, identifier bounds, non-negative safe integers, the only valid `connected/Good` and `disconnected/BadNoCommunication` pairs, deterministic Event IDs, and exact replay/catch-up boundary ID/phase/count/byte fields. Add adapter tests for connected-before-data ordering across multiple monitored groups, early-root coalescing and encoded-byte overflow, shared state/lifecycle source sequence, nondecreasing published/occurred timestamps under `nowMs: 1000 -> 900`, disconnect with zero retained values, repeated recovery idempotence, rejection of late lost-generation notifications, reconnect generation, and one disconnect for intentional live-session stop/replacement. Add Hub and candidate-staging tests for wrong Revision/Endpoint rejection, publisher rejection of either Hub-only boundary, same-Revision replacement, split/coherence batches, blocked-send ordering, bounded barrier overflow, framed chronological replay/catch-up, and two-Endpoint partial recovery with both lexicographic Endpoint orders. An ordinary connected-session `StateBatchV1` containing `BAD/BadNoCommunication` remains ordinary data and must not trigger Endpoint lifecycle behavior.

Add router/store tests for wrong Project, config Revision, Gateway, disabled/unknown Endpoint, malformed/deterministically wrong Event ID, duplicate/equal-conflict/older lifecycle tuples, two Endpoints carrying the same Endpoint-scoped Event ID, clock skew/reset, per-effective-channel source/published clock fences, and Endpoint-local interpolation reset. Rejected events must not consume dedupe or ordering state. Reopening the browser socket resets only the router's socket-session dedupe/order state; replay then reconstructs the retained lifecycle state.

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/core/runtime-protocol/v1.test.ts middleware/runtime-gateway/runtime-stream-timeline.test.ts middleware/runtime-gateway/state-batch-hub.test.ts middleware/runtime-gateway/main.test.ts middleware/runtime-gateway/opcua-client-adapter.test.ts src/features/signals/v5/logical-signal-runtime-store.test.ts src/features/scene/v5/object-runtime-state.test.ts src/features/robot/v5/robot-frame-status-runtime-store.test.ts src/features/runtime-gateway/v5/endpoint-lifecycle-router.test.ts
```

Expected: FAIL because the lifecycle/replay envelopes, Hub/staging timeline, Endpoint reset methods, and lifecycle router do not exist.

- [ ] **Step 3: Define the closed Endpoint lifecycle envelope**

```ts
export type EndpointLifecyclePhaseV1 = 'connected' | 'disconnected'

export interface EndpointLifecycleV1 {
  readonly type: 'endpoint-lifecycle-v1'
  readonly protocolVersion: 1
  readonly gatewayId: string
  readonly projectId: string
  readonly configRevision: string
  readonly endpointId: string
  readonly sequence: number
  readonly originId: string
  readonly eventId: string
  readonly publisherGeneration: number
  readonly sessionGeneration: number
  readonly phase: EndpointLifecyclePhaseV1
  readonly statusCode: 'Good' | 'BadNoCommunication'
  readonly occurredAtMs: number
}

export interface EndpointReplayBoundaryV1 {
  readonly type: 'endpoint-replay-boundary-v1'
  readonly protocolVersion: 1
  readonly gatewayId: string
  readonly projectId: string
  readonly configRevision: string
  readonly endpointId: string
  readonly sequence: number
  readonly replayId: string
  readonly messageCount: number
  readonly encodedBytes: number
  readonly phase: 'start' | 'end'
}

export interface EndpointCatchupBoundaryV1 {
  readonly type: 'endpoint-catchup-boundary-v1'
  readonly protocolVersion: 1
  readonly gatewayId: string
  readonly projectId: string
  readonly configRevision: string
  readonly endpointId: string
  readonly sequence: number
  readonly catchupId: string
  readonly messageCount: number
  readonly encodedBytes: number
  readonly phase: 'start' | 'end'
}

export type RuntimePublisherMessageV1 = StateBatchV1 | EndpointLifecycleV1
export type RuntimeStreamMessageV1 =
  | RuntimePublisherMessageV1
  | EndpointReplayBoundaryV1
  | EndpointCatchupBoundaryV1

export function endpointLifecycleEventIdV1(input: Pick<
  EndpointLifecycleV1,
  'publisherGeneration' | 'sessionGeneration' | 'phase'
>): string

export function validateEndpointLifecycleV1(value: unknown): EndpointLifecycleV1
export function validateEndpointReplayBoundaryV1(value: unknown): EndpointReplayBoundaryV1
export function validateEndpointCatchupBoundaryV1(value: unknown): EndpointCatchupBoundaryV1
export function validateRuntimeStreamMessageV1(value: unknown): RuntimeStreamMessageV1
```

Use exact closed objects. `publisherGeneration` is the committed candidate generation from Task 3 and must be a positive safe integer. `sessionGeneration` and `sequence` are positive safe integers. `occurredAtMs` is a non-negative Gateway-clock timestamp used only for diagnostics; it is never substituted for `StateBatchV1.sourceTimestampMs` and never advances a PLC source-time fence. The only valid phase/status pairs are `connected/Good` and `disconnected/BadNoCommunication`. `eventId` is the exact deterministic ASCII value `lifecycle:<publisherGeneration>:<sessionGeneration>:<phase>` and is explicitly Endpoint-scoped: identical strings on two Endpoints are valid because Project, Revision, Gateway, Origin, and Endpoint remain part of semantic identity.

Both boundary kinds are Hub-only; adapters and candidate staging cannot publish them. `EndpointReplayBoundaryV1` wraps attach-time cached replay, while `EndpointCatchupBoundaryV1` wraps one frozen Endpoint-local State/lifecycle timeline cut drained after socket backpressure or candidate staging. One unique bounded ID pairs exactly one start/end: replay uses `replay:<counter>` and a socket-local catch-up counter uses `catchup:<counter>`. Both boundary copies carry the exact positive enclosed `messageCount` and positive `encodedBytes` sum of the enclosed UTF-8 JSON frames. Boundary wire sequences are assigned by the Hub from the same per-Endpoint wire counter as their enclosed frames. Apply existing identifier/config-Revision bounds to every identifier and add all envelopes to `RuntimeProtocolV1Message`; `validateRuntimeStreamMessageV1` accepts all four wire kinds while Hub `publish` accepts only the adapter's opaque normalized publication wrapper whose message is a `RuntimePublisherMessageV1`. Replay-counter exhaustion rejects only the newly attaching peer; catch-up-counter exhaustion closes only that slow peer.

- [ ] **Step 4: Publish lifecycle and State data through one Endpoint source sequencer**

```ts
declare const NORMALIZED_OPCUA_CLIENT_PUBLICATION_V1: unique symbol
declare const SEALED_RUNTIME_TIMELINE_V1: unique symbol

export interface NormalizedOpcUaClientPublicationV1 {
  readonly message: RuntimePublisherMessageV1
  readonly [NORMALIZED_OPCUA_CLIENT_PUBLICATION_V1]: true
}

export function readNormalizedOpcUaClientPublicationV1(
  publication: NormalizedOpcUaClientPublicationV1,
): RuntimePublisherMessageV1

export interface SealedRuntimeTimelineV1 {
  readonly [SEALED_RUNTIME_TIMELINE_V1]: true
}
```

Make the adapter-to-staging/Hub boundary opaque and producer-normalized. Only `opcua-client-adapter.ts` can construct a `NormalizedOpcUaClientPublicationV1`; retain every constructed frozen wrapper in a module-private `WeakSet`, and make the exported reader throw exact `TypeError('Normalized OPC UA Client publication is invalid.')` for a raw or forged wrapper before returning its frozen wire message. `OpcUaClientAdapterOptionsV1.publish`, detached candidate staging, and `StateBatchHubV1.publish` accept only this opaque type; Hub live publish catches that exact validation failure and returns false without mutation, while candidate staging records its existing sticky health failure without throwing through the adapter callback. To keep the runtime module graph acyclic, move the neutral `splitStateBatchesV1` implementation from `state-batch-hub.ts` into `runtime-stream-timeline.ts`, update adapter/Hub imports, and do not retain a Hub re-export: the adapter may import the timeline but not the Hub, while the Hub may import the adapter's opaque reader. The adapter constructs State publications only from `assembleMappingValueV1`: every emitted `quality: 'GOOD'` has passed the target Mapping's scalar/range or canonical Frame-pose assembly, while invalid/BAD/UNCERTAIN observations carry the retained last complete payload as non-GOOD or publish nothing before one exists. Lifecycle construction must likewise pass the closed lifecycle validator before branding. This is the closed invariant that lets timeline/replay coalescing classify a declared GOOD as a payload basis; the Hub does not accept arbitrary protocol-valid State from another publisher. Tests prove the import graph has no adapter/Hub cycle, raw/forged wrappers are rejected without sequence/cache/socket mutation, and a target-invalid later notification becomes non-GOOD while retaining the earlier valid payload in blocked and fresh replay.

The Hub module owns a detached `createRuntimeTimelineStagingV1()` builder and the separate opaque `SealedRuntimeTimelineV1` WeakSet. The builder unwraps only valid normalized adapter publications, applies the same split/coalescing/barrier/acceptance/bounds rules, and may rebuild frozen State Batches containing selected retained values. `seal()` is single-use and returns an opaque handle to that derived raw timeline; it does not try to re-brand derived batches as adapter publications. `prepareRevisionActivation` is the only consumer of the sealed handle, verifies/consumes its WeakSet membership, and remains side-effect-free with respect to active Hub state. Calling the staging publisher after `seal()` is a deterministic programmer error and records sticky failure, but the activation algorithm must make that state unreachable: there is literally no `await`, user callback, socket send/close, disposal, injected callout, or other reentrant operation from the final pre-seal health check until the live publisher is enabled. Add the exact staging regression `P1(A1,B1) -> P2(A2) => sealed(B1,A2)` with A1 absent and encoded-byte accounting based only on the derived cut.

Give every eligible OPC UA Client Endpoint one adapter-owned `nextSourceSequence`, starting at one for the candidate adapter and shared by `StateBatchV1` chunks and `EndpointLifecycleV1`. The same Endpoint publisher owns a nondecreasing Gateway clock: validate each `nowMs()` sample and use `max(lastGatewayTimestampMs, sample)` for State `publishedTimestampMs` and lifecycle `occurredAtMs`, so a host clock rollback cannot make an otherwise valid publication fail the immutable admission rule. Remove the Snapshot assembler's private sequence ownership: it returns or delegates unsequenced mapped values, while the Endpoint publisher first computes the split count and atomically reserves that entire consecutive range before publishing any chunk. Lifecycle consumes exactly one sequence. Never wrap or partially publish: State/connected reservation must leave one final sequence available for a possible disconnected event. If no full range plus that reserve remains, publish one terminal disconnected at the reserved sequence for a live session, set exact diagnostic `OPC_UA_SOURCE_SEQUENCE_EXHAUSTED`, close it, and do not reconnect until a new adapter activation resets the source range. Check `sessionGeneration + 1` before mutation; `OPC_UA_SESSION_GENERATION_EXHAUSTED` fails the connection attempt without lifecycle/data or wrap.

Pass Task 3's `candidateGeneration` into `OpcUaClientAdapterOptionsV1.publisherGeneration`. For each Endpoint, increment `sessionGeneration` only when a newly created OPC UA Session/subscription is fully ready. While monitored groups are still being constructed, assemble but do not sequence/publish notifications: retain only the latest complete mapped snapshot per monitored root together with its arrival ordinal, bounded by the compiled root count and a combined `8 * MAX_RUNTIME_BATCH_BYTES_V1` encoded bytes. Overflow fails that connection attempt as `OPC_UA_EARLY_NOTIFICATION_CAPACITY_EXCEEDED` before any `connected` event. Once every group is ready, publish `connected`, drain buffered roots by arrival ordinal through the shared sequencer without an `await`, and only then mark the session live; callbacks that occur reentrantly during the drain remain in the same bounded buffer until it is empty. Thus no value for that session can precede its barrier. A write-only eligible Endpoint still publishes `connected` even though it has no retained read value.

On the first recovery transition from a live session, first invalidate the monitored-notification connection generation, then synchronously reserve and publish exactly one `disconnected` event for that same `sessionGeneration` before clearing the session/assembler and scheduling reconnect. Late notifications from the lost generation are dropped, so no State data may appear after `disconnected` until a later `connected` barrier. Repeated close/error/recovery signals for that session are idempotent. A failed connection attempt that never published `connected` publishes no `disconnected`.

Intentional `stop()` also publishes that same idempotent `disconnected/BadNoCommunication` event for every currently live session after notification-generation invalidation and before resource close. This includes same-Revision replacement, failed-candidate rollback, and final Gateway shutdown; the reason is diagnostic-only and does not alter the closed lifecycle envelope. Consequently old GOOD values become STALE before a nonblocking replacement begins, stay non-consumable if the candidate never connects, and remain STALE if a rollback-restarted prior adapter never reconnects. A successful new or restarted session publishes `connected` with the candidate's publisher generation and the next session generation, then accepts lower or restarted PLC source timestamps because the browser Endpoint fences are reset by that barrier. Stopping a never-connected attempt emits nothing.

- [ ] **Step 5: Make lifecycle a bounded, non-coalescible Hub barrier**

Change `StateBatchHubV1.publish` to accept only `NormalizedOpcUaClientPublicationV1` and unwrap it through the WeakSet-backed reader before any mutation. Replace direct activation with a fallible, side-effect-free `prepareRevisionActivation({ projectId, configRevision, gatewayId, originId, publisherGeneration, endpointIds, stagedTimeline })` that returns an opaque single-use prepared handle; `stagedTimeline` is the consumed `SealedRuntimeTimelineV1`, never an array of normalized wrappers. The handle exposes a no-throw, pure `installPrepared()` operation that synchronously installs the prepared activation/cache/socket queues and returns or enables a no-throw `flushPrepared()` operation. `installPrepared()` performs no socket send/close, disposal, timer, callback, or other external callout; only `flushPrepared()` may perform the isolated sends/closes after the live publisher has been enabled. In Client/Bridge mode, `main.ts` passes its Gateway ID, exact `${gatewayId}:opcua-client` Origin, the candidate command generation, and the unique IDs of every enabled Project OPC UA Endpoint; Server/off mode passes the same identity with an empty Endpoint list. Validate and freeze that activation during prepare. Ignore a live publication unless its unwrapped Project, config Revision, Gateway, Origin, and Endpoint all match. Lifecycle additionally requires the exact active publisher generation. Each activated Endpoint begins `awaiting-connected`; accept State only after that generation's validated `connected` and reject it after `disconnected` until a newer valid connected session. This, plus adapter notification-generation fencing, prevents a late prior adapter from repopulating replay after same-Revision cutover.

Maintain one incoming source-sequence fence per Endpoint across State and lifecycle. Internally tag every accepted snapshot/barrier with the Hub activation epoch and lifecycle publisher/session tuple; source sequence may restart only when a prepared activation commit installs a new adapter activation, never merely on OPC UA reconnect. Drain by Endpoint, then activation epoch, publisher/session tuple, original source sequence, and finally channel key only as an equal-sequence tie-breaker. Hub-assigned outgoing wire sequences are common to State, lifecycle, and both Hub-only boundary kinds; splitting one State Batch reserves consecutive wire sequences and the next wire frame follows them.

Use one deterministic Endpoint-local timeline representation in both the Hub's blocked-socket queue and `main.ts` candidate staging. Cross-Endpoint arrival order has no lifecycle semantics; store timelines independently and drain non-empty Endpoint timelines by Endpoint ID:

1. Split each incoming State Batch into effective channel/coherence groups before publication. For the active lifecycle session, keep Hub-side source/published-time acceptance fences per effective channel and reset them on `connected`. Reject a group when either PLC timestamp regresses or `sourceTimestampMs > publishedTimestampMs`, before live delivery, pending/coalescing, and replay caching, so live and fresh consumers see the same accepted history. This immutable envelope check replaces every browser-receipt wall-clock comparison. A snapshot segment then contains one bounded reconstruction record per effective channel and may coalesce only with accepted State data in that same Endpoint segment. The record retains the most recent observation declared `GOOD` plus the latest quality observation when those differ; target-specific type validation remains the consumer's responsibility. A later accepted `GOOD` replaces both; a later accepted non-`GOOD` replaces only the quality observation. If no `GOOD` has occurred, retain only the latest observation. Preserve validation, acceptance, and eviction for every coherence group atomically, and rebuild emitted Batches with only the retained values/coherence siblings.
2. An Endpoint lifecycle event is an immutable barrier in only that Endpoint's timeline. Append it after the current segment and begin a new segment; no later State update may replace, cross, or erase it. A lifecycle event for Endpoint A does not split Endpoint B's segment.
3. When a blocked socket becomes writable, freeze its whole currently pending per-Endpoint timeline cut, including every snapshot segment and lifecycle barrier, then drain Endpoint cuts by Endpoint ID. A prepared activation commit treats every non-empty staged Endpoint timeline as the same kind of frozen cut even when the existing socket is writable; coalesced candidate history is never emitted as unrelated live frames. Within a segment, order retained snapshots by original source sequence and channel key and rejoin siblings that share one source sequence. Wrap the complete non-empty Endpoint cut in one `EndpointCatchupBoundaryV1` pair and preserve all intervening barriers; do not expose one segment before a known following disconnect. Direct, non-backpressured, non-staged live messages remain unframed. Messages arriving after the frozen cut queue behind its matching end. Thus `connected -> GOOD(true) -> disconnected` already pending at flush becomes one atomic catch-up whose final observable state is STALE, and no Job tick can consume its historical GOOD.
4. Preserve the existing bounds of eight Endpoints and 128 effective cached channels per Endpoint. One effective channel still counts once when its reconstruction record contains two State snapshots. Bound both each Endpoint replay and the whole pending socket/candidate timeline, including predicted boundary overhead, to `8 * MAX_RUNTIME_BATCH_BYTES_V1` encoded bytes, and permit at most 32 pending lifecycle barriers. On either slow-socket pending overflow, detach and close only that peer. Active replay-cache pressure never drops the current lifecycle barriers: remove the least-recently-updated effective reconstruction record, atomically across its coherence group and from both prefix/current copies, until both channel and byte bounds hold. If the newly published channel alone cannot fit, remove any older cached copy and leave that channel uncached while still delivering it live; an attached peer is unaffected and a fresh peer never receives an older value falsely presented as latest. Candidate staging never throws through an adapter notification callback: it records one sticky `RUNTIME_STREAM_BARRIER_CAPACITY_EXCEEDED` failure, ignores later candidate publications, and exposes `assertHealthy()` for the activation transition.
5. `queueDepth` counts an in-flight transmission, every replay/catch-up item, every non-empty pending snapshot segment, and every pending barrier.

The replay cache is Endpoint-local and retains four chronological parts:

1. `prefixRecords`: one reconstruction record per effective channel accumulated from sessions completed before the current session;
2. the current session's required `connected` barrier;
3. `currentRecords`: one reconstruction record per effective channel published after that `connected`;
4. an optional matching `disconnected` barrier for the same publisher/session.

On a newer `connected`, merge prior prefix/current reconstruction records by channel into the new prefix, install the new connected barrier, clear the current source/published acceptance fences, and clear current/disconnected. The merge retains the latest already-accepted observation declared `GOOD` as payload basis and the latest already-accepted observation for each channel using the internal activation/lifecycle/source order. It never re-evaluates or resurrects an observation rejected for a regressing PLC clock. State data after connected passes the same per-channel acceptance function exactly once before updating current records and any peer. A matching disconnected appends after current and never replaces connected; reject later State data until a newer connected arrives. State before the active generation's first connected is rejected rather than cached.

`prefixRecords` may combine sparse updates from arbitrarily many completed PLC clock epochs, so they are not ordinary live State. During an atomically framed replay, the browser sends only the State frames before the retained current `connected` barrier to every consumer's required `restoreReplayPrefix` method. That method validates active Project/Revision/Endpoint/mapping and applies the reconstruction observations in Hub chronological order, but bypasses and never advances Endpoint sequence, receipt, source-time, published-time, and interpolation fences. A type-valid `GOOD` observation replaces the held/display payload and its diagnostic timestamps exactly; a non-`GOOD` observation retains that payload and changes only quality/status/timestamps. The immediately following retained `connected` event then calls `resetEndpointSession`, retains the restored payload, marks it `BAD/BadWaitingForInitialData`, and clears the normal live fences before `currentRecords` use ordinary `ingest`. This preserves both clock reset and display state without treating an old value as currently GOOD.

For example, session 1 publishes only `B@90k`, session 2 publishes only `A@1k`, and session 3 connects then disconnects without data. Fresh replay is `prefix(B@90k,A@1k) -> connected(session 3) -> disconnected(session 3)`: both prefix values restore despite their opposite clock order, the connected barrier resets live fences, and the final values are both STALE. Separately, `connected -> A GOOD(true) -> A BAD -> disconnected` retains a two-observation reconstruction record, so a fresh browser finishes with payload `true` and `STALE/BadNoCommunication`, never the Project initial payload.

For a new socket, replay Endpoints in sorted order. Reserve one Hub-lifetime positive safe-integer replay counter per Endpoint replay and use exact `replay:<counter>` as the paired Replay ID; counter exhaustion isolates the newly attached peer without mutating Hub/cache state. Surround each non-empty Endpoint replay with a Hub-generated `EndpointReplayBoundaryV1(start/end)` pair, then transmit prefix records by internal activation epoch/lifecycle tuple/original source sequence/channel, each payload basis before its distinct latest observation, followed by connected, current records in the same deterministic order, and optional disconnected. Require exactly one retained `connected` in the framed replay and at most one matching terminal `disconnected`; no lifecycle event may occur in the prefix. The start/end and every enclosed frame receive consecutive Hub wire sequences. Live publications for that socket remain queued after the matching end. A lifecycle event remains replayable with zero snapshots.

Before encoding any logical live/replay/catch-up transmission, compute its complete split/boundary frame count and atomically reserve the full Hub wire-sequence range; never mutate the counter or send a prefix on failure. If the shared Endpoint wire range is exhausted, synchronously detach every socket, reset that wire counter only after all old socket states are detached, and close them so fresh sockets restart at one and reconstruct from replay. Tests inject counters at the last safe values for State splitting, connected/disconnected reserve, session generation, replay IDs, catch-up IDs, and Hub wire ranges; every case proves no partial frame, wrap, or stale open peer.

Same-Revision activation retains replay and socket connections; the old adapter's stop-time disconnected is already in the timeline before the candidate can connect. For a different Revision, synchronously detach every old socket state, install the new active Revision/membership and clear source/wire/replay/pending state, then close the detached sockets. Even a reentrant reconnect therefore attaches only to the new empty activation before new-Revision wire sequence one. Deactivation uses the same detach -> clear -> close order.

`main.ts` must stage mixed normalized publications through the same barrier semantics; the prior State-only coalescer is insufficient. Construct every candidate adapter, command registry, and command service, run every fallible validation and the explicit failure-injection hook, then call the final `staged.assertHealthy()` and synchronously `seal()` the detached timeline before Hub activation or `committedCommandGeneration` changes. The injection hook is allowed to synchronously trigger a candidate publication and the final health check/seal must either include that publication or fail; there is no injection hook after seal. From that final health check through live-publisher enablement, no `await`, user callback, socket send/close, disposal, timer, or other reentrant callout is allowed. A sticky staging failure contributes no candidate message to active replay and does not advance generation; if the prior live adapter was already stopped, only its own required disconnected barrier remains and rollback reconnects from that truthful STALE state.

After seal, pass the opaque sealed timeline handle into `prepareRevisionActivation`; this is the last fallible operation and consumes the handle without mutating active Hub/replay. Then execute one synchronous no-fail tail in this exact order: assign the prepared `activeRuntime` and `committedCommandGeneration`; call the prepared Hub handle's pure `installPrepared()`; enable the candidate adapter's live publisher; and call `flushPrepared()` to perform isolated sends/closes. Close prior command resources afterward. Different-Revision install still detaches old socket state and installs the new activation before `flushPrepared()` closes detached sockets. A synchronous send/close callback during `flushPrepared()` may reenter candidate publication, but it now reaches the installed live Hub and is queued exactly once after the staged catch-up cut. Because no candidate frame is sent before runtime/generation assignment, every fallible operation precedes this tail, and there is literally no external callout between seal and live enablement, browsers cannot observe an uncommitted higher generation and a sequenced candidate publication cannot fall into a sealed-but-not-live gap. The pre-seal injection test triggers a candidate publication and proves it is either present in the sealed cut or causes activation failure; a separate reentrant send/close test publishes during `flushPrepared()` and proves the frame appears exactly once after staged data. There is intentionally no failure seam inside the no-fail tail.

Required regression cases are: ordinary `BAD/BadNoCommunication` State data is not a lifecycle barrier; zero-retained disconnect; split and coherence batches around a barrier; a blocked send cannot coalesce across a barrier; blocked/staged `connected -> GOOD(true) -> BAD/disconnected` catch-up attempts a Job advance after every physical frame but never exposes actionable GOOD; `GOOD(true) -> BAD -> disconnected` fresh replay retains `true`; accepted `GOOD(true, source=100) -> rejected GOOD(false, source=50)` stays `true` both live and after fresh replay; a pose with `sourceTimestampMs > publishedTimestampMs` is rejected both live and on fresh replay regardless of later browser receipt time; pending barrier-count/byte overflow isolates a slow peer; active cache channel/byte pressure evicts deterministic LRU reconstruction records but never the current lifecycle or substitutes an older copy; sticky candidate overflow and pre-commit failure injection leave generation unchanged, add no candidate replay, and retain only the prior adapter's truthful stop-time disconnect; the three-session sparse A/B clock-reset replay above; replay and catch-up start/end framing under blocked send; same-Revision online replacement, never-connecting replacement, and rollback whose prior never reconnects, each on an existing socket and fresh replay; different-Revision activation closes the old socket and accepts sequence one on its replacement; and two Endpoints where A disconnects while B stays GOOD, tested with Endpoint IDs in both key orders.

- [ ] **Step 6: Add Endpoint-local reset/stale stores and the lifecycle router**

Add `resetEndpointSession(endpointId, atMs)`, `restoreReplayPrefix(batch, receivedTimestampMs)`, and `beginEndpointCatchup(endpointId, atMs)` beside each existing `markEndpointDisconnected` and `resetGatewaySession` method in the Signal, Object, and Robot Frame/status stores. Task 5's Robot Joint store must implement the same operations. Normal live ingestion keeps the wire sequence/receipt fence per Endpoint but keeps source and published PLC-clock fences per effective channel, never per Endpoint, so unrelated sparse channels cannot reject each other. All stores defensively apply the Hub's same immutable admission rule: reject an effective group if its source or published time regresses in the active lifecycle session or `sourceTimestampMs > publishedTimestampMs`; never compare PLC source time with browser receipt time. Endpoint reset preserves the last display payload, changes only channels owned by that Endpoint to `BAD/BadWaitingForInitialData`, clears only that Endpoint's sequence/receipt fences and every owned channel's source/published-time fences, and recreates only that Endpoint's interpolation buffers while retaining the held/display pose. The first accepted live observation after reset replaces that channel's reported source/published timestamp even when the restarted PLC clock is lower; subsequent observations remain monotonic within that channel/session. Endpoint disconnect preserves values/poses, marks only that Endpoint `STALE/BadNoCommunication`, and does not advance or clear PLC clock fences.

`beginEndpointCatchup` creates one opaque single-use, idempotent no-throw `EndpointCatchupGuardV5` for that Endpoint. It snapshots each owned channel's exposed quality/status/receipt metadata plus a touched bit, then overlays `STALE/BadNoCommunication` for reads/samples without changing payloads, PLC fences, or interpolation buffers. Accepted State ingestion marks only its recognized channels touched; Endpoint connected/disconnected transitions mark all owned channels touched. `guard.commit()` restores the snapshotted metadata only for untouched channels and reveals final catch-up state for touched channels, then clears the overlay. `guard.abort()` keeps the overlay as durable Endpoint STALE and clears its bookkeeping. A duplicate-only or sparse A-only catch-up therefore restores untouched B exactly, while a body ending in disconnected leaves all channels STALE. A second active guard for the same Endpoint is rejected before mutation. Project replacement, global session reset/disconnect, stream stop, and store disposal deterministically abort/invalidate outstanding guards. Tests cover sparse A/B, duplicate-only, rejected State, valid lifecycle, abort, and single-use cleanup.

`restoreReplayPrefix` is callable only by the framed V5 stream consumer adapter. It performs the same closed protocol/context/mapping/type validation and immutable `sourceTimestampMs <= publishedTimestampMs` check as `ingest`, but intentionally neither checks nor mutates any normal sequence/receipt/regression/interpolation fence. It applies the prefix record in supplied order: a valid `GOOD` restores held/display payload directly without interpolating, while non-`GOOD` retains that payload and updates only quality/status/diagnostic timestamps. An irrelevant or invalid mapping returns false without mutation. A replay frame cannot select this path unless it occurs before the exactly one retained `connected` inside a fully validated boundary pair.

```ts
export interface EndpointLifecycleTargetV5 {
  markEndpointDisconnected(endpointId: string, atMs: number): void
  resetEndpointSession(endpointId: string, atMs: number): void
}

export interface EndpointLifecycleRouterV5 {
  ingest(event: EndpointLifecycleV1, receivedTimestampMs: number): boolean
  resetSocketSession(): void
}
```

The router reads one atomic `{ project, configRevision, gatewayId }` context for each event. It accepts only the exact active Project/Revision/Gateway and an enabled Endpoint belonging to a Client/Bridge Project. It validates the deterministic Event ID before updating state. Keep exactly one last accepted record per enabled Endpoint, so router memory is bounded by the Project's eight-Endpoint limit. Its semantic key is `(projectId, configRevision, gatewayId, endpointId, originId, eventId)` and explicitly excludes Hub-rewritten `sequence` plus diagnostic `occurredAtMs`; its order tuple is `(publisherGeneration, sessionGeneration, phaseOrdinal)`, where `connected` is zero and `disconnected` is one. A greater tuple replaces the record. An equal tuple with the same semantic key is a duplicate; an equal tuple with another key is a conflict; a lower tuple is stale. All three return false and make no target calls. A replay may begin with either phase. Wrong-context, unknown-Endpoint, and malformed events also make no target calls and do not consume a record. `resetSocketSession()` clears only these per-Endpoint records. Apply accepted `connected` to every target's Endpoint reset and accepted `disconnected` to every target's Endpoint stale transition, always using the browser receipt time rather than `occurredAtMs`.

- [ ] **Step 7: Run lifecycle GREEN and commit**

```powershell
npm run test:run -- src/core/runtime-protocol/v1.test.ts middleware/runtime-gateway/runtime-stream-timeline.test.ts middleware/runtime-gateway/state-batch-hub.test.ts middleware/runtime-gateway/main.test.ts middleware/runtime-gateway/opcua-client-adapter.test.ts src/features/signals/v5/logical-signal-runtime-store.test.ts src/features/scene/v5/object-runtime-state.test.ts src/features/robot/v5/robot-frame-status-runtime-store.test.ts src/features/runtime-gateway/v5/endpoint-lifecycle-router.test.ts
npm run test:run
npm run build:gateway
npm run lint
npm run build
git add src/core/runtime-protocol/v1.ts src/core/runtime-protocol/v1.test.ts middleware/runtime-gateway/runtime-stream-timeline.ts middleware/runtime-gateway/runtime-stream-timeline.test.ts middleware/runtime-gateway/state-batch-hub.ts middleware/runtime-gateway/state-batch-hub.test.ts middleware/runtime-gateway/main.ts middleware/runtime-gateway/main.test.ts middleware/runtime-gateway/opcua-client-adapter.ts middleware/runtime-gateway/opcua-client-adapter.test.ts src/features/signals/v5/logical-signal-runtime-store.ts src/features/signals/v5/logical-signal-runtime-store.test.ts src/features/scene/v5/object-runtime-state.ts src/features/scene/v5/object-runtime-state.test.ts src/features/robot/v5/robot-frame-status-runtime-store.ts src/features/robot/v5/robot-frame-status-runtime-store.test.ts src/features/runtime-gateway/v5/endpoint-lifecycle-router.ts src/features/runtime-gateway/v5/endpoint-lifecycle-router.test.ts
git diff --cached --check
git commit -m "feat: stream opc ua endpoint lifecycle"
```

Expected: lifecycle envelopes, common source/wire ordering, bounded barriers, deterministic replay, same-Revision staging, and Endpoint-local browser transitions PASS before command-client work begins.

- [ ] **Step 8: Write RED Mapping, command-client, and discriminated-stream tests**

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

it('refreshes the lease once after COMMAND_LEASE_STALE and keeps one Command ID', async () => {
  const fetch = staleThenCurrentLeaseHarness()
  const client = createRuntimeGatewayCommandClientV1({ fetch: fetch.call, createCommandId: () => 'stable-id' })
  await client.writeBoolean(writeRequest())
  expect(fetch.postedCommandIds).toEqual(['stable-id', 'stable-id'])
  expect(fetch.writeExecutionCount).toBe(1)
})

it('reads one atomic Project/config snapshot and resolves the same writable Mapping as the Gateway', async () => {
  const readActiveContext = vi.fn(() => ({ project, configRevision: REVISION }))
  const writeBoolean = vi.fn(async () => succeededCommandResult())
  const port = createGatewaySignalWritePortV1({
    readActiveContext,
    commandClient: { writeBoolean, clearLease: vi.fn() },
  })
  await port.writeBoolean('start-output', true)
  expect(readActiveContext).toHaveBeenCalledOnce()
  expect(writeBoolean).toHaveBeenCalledWith({
    projectId: project.projectId,
    configRevision: REVISION,
    targetId: 'mapping-start-output',
    value: true,
  }, undefined)
  expect(REVISION).not.toBe(project.revisionId)
})

it('does not expose replay GOOD before the retained disconnect is applied', () => {
  const harness = framedReplayJobHarness()
  harness.open()
  harness.message(replayStart({ messageCount: 4 }))
  harness.message(prefixState({ value: true }))
  harness.message(connectedLifecycle())
  harness.message(currentState({ value: true }))
  harness.message(disconnectedLifecycle())
  expect(harness.jobAdvanceCount()).toBe(0)
  harness.message(replayEnd({ messageCount: 4 }))
  expect(harness.signal()).toMatchObject({ value: true, quality: 'STALE' })
  expect(harness.jobAdvanceCount()).toBe(0)
})
```

Add command-client tables for cache reuse, expiry refresh, Project/Revision change, explicit `clearLease()`, an in-flight clear that cannot repopulate the cache, stale invalidation that cannot discard a concurrently newer lease, and exactly one stale retry with the same Command ID. Add expiry-horizon cases for `min(nowMs() + 5_000, lease.expiresAt)`. Add invalid-result tables for every mismatched identity field, `IDLE`, `RUNNING`, non-null `attachedObjectId`, malformed JSON, and `ACCEPTED/FAILED COMMAND_LEASE_STALE`; none may retry. Cover already-aborted, mid-GET, mid-POST, and mid-retry caller aborts, one whole-operation timeout, network failures, exact/non-exact error bodies, non-200 responses, and a fresh but already-expired lease. Also cover default/trailing-slash/outer-whitespace/whitespace-only base paths, `redirect: 'error'` on both requests, a defensive `response.redirected` rejection, and closed error guards rejecting spoof objects.

Add Mapping parity tests for a valid Mapping among decoys, disabled Endpoint, `read`, optional Leaf, non-root/structured Leaf, non-Boolean OPC UA type, non-logical target, wrong Signal type/direction, zero candidates, and two candidates. The two local resolver errors must make zero command-client calls. Keep the existing middleware write-plan tests green against the extracted compiler and prove a non-undefined Signal-port `AbortSignal` is forwarded by identity.

For the stream, add a real close -> timer -> second socket -> open sequence; duplicate open; close plus error producing one disconnect callback and one timer; stop cancellation/idempotence; same-origin `ws:`/`wss:` URLs; bounded UTF-8 JSON; malformed/binary input; common per-Endpoint sequence ordering across all four wire kinds; one clamped timestamp and the same validated frozen message for all matching consumers; an injected `nowMs` regression `1000 -> 900` producing `1000` for live, catch-up, and later fresh-replay parity; a throwing first consumer not blocking later consumers; and session-start/disconnect callback failures. Add exact start/count/bytes/end replay and catch-up cases; nested/cross-kind/mismatched/over-budget boundaries; missing end followed by close; partial-buffer disposal; queued live-after-end ordering; State-only catch-up beginning from an already connected phase; full `connected -> GOOD -> disconnected` catch-up; two sorted Endpoint catch-up cuts; and the no-Job-advance assertions above. Test `refreshActiveTarget()` during an active catch-up: the guard aborts once, every handler is detached before close, delayed old message/close/error events are ignored, neither target's disconnect callback runs, and the immediate replacement captures only the new target. An active-context or boundary-protocol failure synchronously runs the one opened-candidate failure path and makes all Endpoint values non-consumable before a queued Job tick or delayed native close; it reconnects without accepting later messages from that socket. Test a different-Revision Gateway replay arriving before a delayed browser Project commit: every early socket/frame is rejected without advancing payload, lifecycle, or wire fences for that mismatched frame (the normal transport open/disconnect callbacks may still reset or stale the old stores), and the first socket opened after the atomic browser commit accepts its first received (possibly higher) Hub wire sequence and restores State.

```powershell
npm run test:run -- src/core/project-v5/opcua-boolean-write-targets.test.ts middleware/runtime-gateway/opcua-client-write-service.test.ts src/features/runtime-gateway/v4/runtime-gateway-stream-v4.test.ts src/features/runtime-gateway/v5/runtime-gateway-command-client.test.ts src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts
```

Expected: FAIL because the shared Mapping compiler, browser command transport, and discriminated V5 stream do not exist.

- [ ] **Step 9: Extract the browser-safe Mapping compiler**

```ts
export interface WritableBooleanSignalMappingV5 {
  readonly mappingId: string
  readonly endpointId: string
  readonly signalId: string
  readonly nodeAddress: OpcUaNodeAddressV1
  readonly dataType: 'Boolean'
}

export function compileWritableBooleanSignalMappingsV5(
  project: WorkcellProjectV5,
): readonly WritableBooleanSignalMappingV5[]
```

Use this one pure compiler from both `compileOpcUaClientWritePlanV1` and the browser Signal port. It first calls `validateWorkcellProjectV5` and does not mutate caller data. It accepts only a Mapping whose referenced Endpoint is enabled, direction is `write` or `readWrite`, and which has exactly one required Leaf with empty `leafPath` and `projectPath`, Boolean OPC UA type, an exact `logical-signal` target, and a referenced Boolean `output` or `bidirectional` Signal. Preserve Mapping order and return frozen records/array. The shared source imports no middleware, `node-opcua`, Node builtin, V4 module, `process`, or `Buffer`.

- [ ] **Step 10: Implement the browser command client and stable Signal resolver**

```ts
export class RuntimeGatewayCommandClientV1Error extends Error {
  readonly code: string
  readonly statusCode: number | null
  readonly cause?: unknown
  constructor(code: string, message: string, options?: {
    readonly statusCode?: number
    readonly cause?: unknown
  })
}

export function isRuntimeGatewayCommandClientV1Error(
  value: unknown,
): value is RuntimeGatewayCommandClientV1Error

export interface RuntimeGatewayCommandClientOptionsV1 {
  readonly createCommandId: () => string
  readonly fetch?: (input: string, init: RequestInit) => Promise<Response>
  readonly nowMs?: () => number
  readonly basePath?: string
}

export interface RuntimeGatewayCommandClientV1 {
  writeBoolean(request: {
    readonly projectId: string
    readonly configRevision: string
    readonly targetId: string
    readonly value: boolean
  }, signal?: AbortSignal): Promise<CommandResultV1>
  clearLease(): void
}

export interface ActiveRuntimeContextV5 {
  readonly project: WorkcellProjectV5
  readonly configRevision: string
}

export class GatewaySignalWriteErrorV1 extends Error {
  readonly code: 'SIGNAL_WRITE_MAPPING_NOT_FOUND' | 'SIGNAL_WRITE_MAPPING_AMBIGUOUS'
  constructor(
    code: 'SIGNAL_WRITE_MAPPING_NOT_FOUND' | 'SIGNAL_WRITE_MAPPING_AMBIGUOUS',
    message: string,
  )
}

export function isGatewaySignalWriteErrorV1(
  value: unknown,
): value is GatewaySignalWriteErrorV1

export function createGatewaySignalWritePortV1(options: {
  readonly readActiveContext: () => ActiveRuntimeContextV5
  readonly commandClient: RuntimeGatewayCommandClientV1
}): GatewaySignalWritePortV1
```

`createRuntimeGatewayCommandClientV1(options: RuntimeGatewayCommandClientOptionsV1)` requires an explicitly injected `createCommandId`; it may default `fetch`, `nowMs`, and `basePath`, but must not silently require a secure-context-only UUID API. Default `basePath` to `/runtime`, trim outer whitespace and trailing slashes, and reject an empty result, including whitespace-only input, with `RUNTIME_GATEWAY_BASE_PATH_INVALID` before any request. The Signal port reads `readActiveContext()` exactly once per call, uses its supplied canonical `configRevision` unchanged, never substitutes `project.revisionId` or recomputes the hash, filters the shared compiler result by `signalId`, and requires exactly one match. It calls `commandClient.writeBoolean(request, signal)` exactly once, including an explicit `undefined` second argument when no signal is supplied and the exact non-undefined caller `AbortSignal` otherwise. Zero or multiple matches throw the exact typed local errors before command-client/network I/O. Both error guards accept only their actual class plus the class's closed code/status invariants; a plain spoof object is false.

The command client keeps one validated lease cache associated with an active `(projectId, configRevision)` key plus a monotonically increasing cache epoch. Switching context or `clearLease()` invalidates the cached value and epoch so an older in-flight GET cannot repopulate it. Discard a cached lease when `expiresAt < nowMs()`. Cache a concurrent candidate only if its epoch/key is still current and it is not older than the current lease: higher generation wins, then later expiry for equal generation. A stale response invalidates only the exact lease instance used; it must not erase a concurrently cached newer lease. A no-store forced refresh is still performed for the sole stale retry. A newly fetched lease that is already expired is `RUNTIME_GATEWAY_RESPONSE_INVALID`, not a loop.

Use this exact logical operation order:

1. If the caller signal is already aborted, throw `AbortError` before fetch or Command ID creation.
2. Create one Command ID and one internal five-second `AbortController` deadline covering GET, POST, and the optional retry. Compose the caller signal with ordinary browser event listeners and remove listeners/timer in `finally`.
3. GET `${basePath}/command-lease` with `Accept: application/json`, `cache: 'no-store'`, and `redirect: 'error'`. Require HTTP 200, reject any `response.redirected`, validate `RuntimePublisherLeaseV1`, require the requested Project/Revision, and require a publisher ending `:client-write`.
4. Set `expiresAt = min(nowMs() + 5_000, lease.expiresAt)`, build the exact value, and pass it through `validateCommandRequestV1` before POST.
5. POST `${basePath}/command` with HTTP 200 required, `Accept: application/json`, `Content-Type: application/json`, `redirect: 'error'`, and the composed signal; reject any `response.redirected`.
6. Validate `CommandResultV1`, then require exact Project/Revision/generation/target/Command identity echo, `attachedObjectId === null`, and exactly one terminal pair: `ACCEPTED/SUCCEEDED`, `ACCEPTED/FAILED`, or `REJECTED/FAILED`. Any mismatch is `RUNTIME_GATEWAY_RESPONSE_INVALID` before retry classification.
7. Retry only exact `REJECTED/FAILED COMMAND_LEASE_STALE`: invalidate only the lease used, recheck abort/deadline, force one no-store lease GET, and POST once more with the same Command ID. Return a second stale result unchanged and never retry any other failure, including `ACCEPTED/FAILED COMMAND_SERVICE_CLOSED`.

Return every valid terminal `CommandResultV1`, including failures, unchanged. Propagate caller cancellation as `AbortError`; map the internal deadline to `RUNTIME_GATEWAY_TIMEOUT`; map fetch/network failure to `RUNTIME_GATEWAY_UNAVAILABLE`; map malformed 200 JSON/envelopes/correlation to `RUNTIME_GATEWAY_RESPONSE_INVALID`. For non-200, preserve an exact closed `{ code, message }` body plus HTTP status in `RuntimeGatewayCommandClientV1Error`; otherwise use `RUNTIME_GATEWAY_HTTP_<status>`. Abort/timeout/network/HTTP/validation failures never trigger an untracked write retry.

- [ ] **Step 11: Implement the isolated discriminated V5 Runtime stream**

```ts
export interface RuntimeGatewayStateConsumerV5 {
  ingest(batch: StateBatchV1, receivedTimestampMs: number): boolean
  restoreReplayPrefix(batch: StateBatchV1, receivedTimestampMs: number): boolean
}

export type RuntimeGatewayLifecycleConsumerV5 = (
  event: EndpointLifecycleV1,
  receivedTimestampMs: number,
) => boolean

export interface RuntimeGatewayStreamContextV5 {
  readonly projectId: string
  readonly configRevision: string
  readonly gatewayId: string
}

export interface RuntimeGatewayStreamTargetV5 extends RuntimeGatewayStreamContextV5 {
  readonly stateConsumers: readonly RuntimeGatewayStateConsumerV5[]
  readonly lifecycleConsumers: readonly RuntimeGatewayLifecycleConsumerV5[]
  readonly onEndpointCatchupStart: (
    endpointId: string,
    receivedTimestampMs: number,
  ) => EndpointCatchupGuardV5
  readonly onSessionStart?: (receivedTimestampMs: number) => void
  readonly onSessionDisconnect?: (receivedTimestampMs: number) => void
}

export interface RuntimeGatewayStateStreamOptionsV5 {
  readonly url?: string
  readonly location?: BrowserLocationV5
  readonly createWebSocket?: (url: string) => BrowserWebSocketV5
  readonly readActiveTarget: () => RuntimeGatewayStreamTargetV5
  readonly nowMs?: () => number
  readonly reconnectDelayMs?: number
}

export interface RuntimeGatewayStateStreamV5 {
  start(): void
  refreshActiveTarget(): void
  stop(): void
}
```

Build this independently of V4 while preserving its same-origin `/runtime/ws`, lifecycle, and reconnect behavior. Accept only string frames whose UTF-8 byte count is at most `MAX_RUNTIME_BATCH_BYTES_V1`; parse and call `validateRuntimeStreamMessageV1` once. On socket open, call `readActiveTarget()` once, retain that immutable object as the socket's `openedTarget`, and invoke only its session-start callback. Before advancing a wire fence or buffering/delivering each live frame, call `readActiveTarget()` exactly once and require object identity with `openedTarget`; a browser graph swap therefore fails/reconnects the old socket before any new-graph delivery, even if a frame happens to carry the new context. The target contains the Project/config Revision/Gateway context and all consumers/callbacks for one published browser runtime graph. Require the frame's exact context; a mismatch closes that candidate and schedules reconnect without consuming the frame. All delivery caused by that physical frame uses only the captured target, never another active-graph lookup. At either boundary start, capture that target object and require every enclosed/end frame to match its context. Immediately before either drain, read the active target again and require object identity with the captured/opened target; any browser Project graph swap discards the buffer and closes/reconnects before invoking a consumer. Maintain one strictly increasing wire-sequence fence per Endpoint across State, lifecycle, and both boundary kinds for the current socket session. Reset one socket-local receipt clock on open; for every open/message/close sample use `max(lastReceiptMs, requireTimestamp(nowMs()))`, store it, and give every matching consumer of that physical frame the same clamped timestamp. A regressing injected browser clock therefore cannot make live stores reject a Hub-accepted frame or diverge from later replay. Pass a live State Batch only to each captured `stateConsumer.ingest` and live lifecycle only to the captured `lifecycleConsumers`. Isolate every consumer exception.

Maintain one socket-local delivered lifecycle record and replay-eligibility bit per Endpoint. Clear all records on every socket open before `onSessionStart`, and reject the candidate before allocating a ninth distinct Endpoint record/fence. Replay is attach-time privileged hydration: only an unseen Endpoint's very first frame may be `EndpointReplayBoundaryV1(start)`, and starting it permanently consumes that Endpoint's eligibility. Any ordinary lifecycle or catch-up first frame also permanently closes eligibility; a completed replay, failed replay, second replay, or replay after live/catch-up is never allowed to reopen it. Use the same deterministic Event-ID and tuple rules as the lifecycle router, plus legal transitions: outside the explicitly recognized first replay-prefix region, State requires a connected record; disconnected must match the current connected publisher/session; a later connected must have a greater publisher/session tuple. Validate against a provisional copy while buffering. Commit the record only after a valid replay/catch-up end; update it for an accepted ordinary live lifecycle before isolated consumer callbacks. An exact semantic duplicate is an idempotent counted no-op and reaches no consumer. A stale, equal-tuple conflict, transition-invalid lifecycle, State while unknown/disconnected, second/later replay, or replay after ordinary traffic routes through `failOpenedCandidate` without partially changing the record. A completed replay ending in connected/disconnected therefore seeds the following catch-up correctly, and an ordinary live connected seeds a later State-only catch-up. Tests cover replay-after-live, second replay, both valid first-frame paths, the eight-Endpoint bound, and prove socket reopen clears the record/eligibility.

An `EndpointReplayBoundaryV1(start)` opens exactly one socket-local replay buffer. Reject and reconnect on nesting, a different Endpoint/context, non-increasing sequence, declared count/bytes above the fixed `8 * MAX_RUNTIME_BATCH_BYTES_V1` limit, more frames/bytes than declared, a non-matching end, any live frame after the declared count but before end, or a body that is not exactly `zero-or-more prefix State -> one connected -> zero-or-more current State -> optional matching disconnected`. Buffer the already validated/frozen enclosed State/lifecycle values and each frame's one receipt timestamp without invoking consumers. A matching end must have the same semantic fields/count/bytes and exact observed totals; then drain the complete buffer synchronously in one JavaScript call stack. Prefix State calls each isolated consumer's `restoreReplayPrefix`; the retained connected and later frames use ordinary lifecycle/`ingest` consumers. No timer, Job advance, render sample, or live frame may interleave this drain. Boundaries themselves are transport-only and never reach State/lifecycle consumers. Discard a partial replay on close, error, stop, or reconnect. A socket that closes after start without end is a failed candidate and follows the one reconnect path.

An `EndpointCatchupBoundaryV1(start)` is mutually exclusive with a replay buffer and opens exactly one socket-local Endpoint catch-up buffer. Apply the same context, Endpoint, strictly increasing per-Endpoint wire sequence, positive declared count/bytes, fixed byte limit, observed count/bytes, matching-end, overflow, partial-close, and single reconnect checks. After validating the start but before retaining the buffer, synchronously call the captured target's required `onEndpointCatchupStart(endpointId, atMs)` and retain its guard; Task 7 composes the four stores' transient Endpoint guards, so a Job tick between physical WebSocket frames cannot consume an old GOOD value without destructively changing untouched channels. A callback failure rejects/closes the candidate. Its body must contain one or more publisher State/lifecycle messages for exactly that Endpoint and no boundary or outside live frame. Validate the body against a provisional copy of the stream's delivered lifecycle record: State is allowed only while connected; disconnected forbids State until a strictly newer valid connected; exact duplicates are counted no-ops, while stale or conflicting lifecycle rejects without mutating delivered state. The first body event may be State only if that Endpoint was already connected before the boundary. At a valid end, recheck that `readActiveTarget()` returns the captured/opened target by identity, then call its ordinary `stateConsumer.ingest` and lifecycle consumers synchronously in wire order, skipping duplicate lifecycle, commit the provisional record, and call `guard.commit()` in the same call stack. Never call `restoreReplayPrefix` for catch-up. Any invalid frame, context or target change, close, error, reconnect, or stop calls `guard.abort()` exactly once before cleanup. Messages received after the Hub's frozen pending cut stay queued after the end and cannot interleave. Regression tests cover malformed/nested/missing-end bodies, callback failure, duplicate-only and sparse A-only/B-unchanged cuts, guard abort/single-use cleanup, two Endpoint cuts emitted in sorted Endpoint order, and invoke a Job/timer callback after every physically received event of `connected -> GOOD(payload) -> BAD/disconnected`; every pre-end tick sees the transient quarantine as non-GOOD, while valid end restores untouched channels and exposes only final touched-channel state.

Centralize every validation/context/target/boundary failure after a socket has opened in one synchronous `failOpenedCandidate(atMs)` path. Before the failing message handler returns, atomically mark the candidate failed, detach/ignore all later events, abort an active catch-up guard, discard buffers, and call the retained `openedTarget.onSessionDisconnect(atMs)` exactly once so the graph that owned that socket becomes STALE. If the published graph was atomically replaced, the callback still cannot mutate the new graph; its detached candidate already begins non-GOOD. Only then request socket close and schedule one reconnect; a later native close/error is a deduplicated no-op. This safety callback also runs for catch-up-start failure and replay/catch-up protocol failure. A connecting socket that never opened has no established values and does not call it. Tests queue a Job tick immediately after malformed input and active-context mismatch and prove every Endpoint is already non-consumable before the native close event; a target-swap test proves the old graph alone receives disconnect while the new graph remains at its initial BAD state.

On each new socket `open`, clear the stream's Endpoint sequence fences, lifecycle records, receipt clock, and replay/catch-up buffers, sample once, capture `openedTarget`, and call only `openedTarget.onSessionStart(atMs)` before changing to open/accepting messages. If it throws, reject/close that candidate and schedule one reconnect; Task 7's callback is constructed no-throw after its own validation. For an unexpected close/error after a successful open, route through `failOpenedCandidate`. Connecting failures do not report an established-session disconnect. `refreshActiveTarget()` is the intentional graph-handoff path: synchronously detach and ignore old socket handlers, abort any catch-up guard, discard buffers/fences, cancel its timer, close the detached socket, and request an immediate replacement that will capture the newly published target; it does not invoke either graph's disconnect callback, and later native close/error is ignored. Intentional `stop()` performs the same bounded cleanup but does not reconnect and remains idempotent. Task 7 uses unexpected disconnect to mark every Endpoint-owned channel in the socket's owning graph `STALE/BadNoCommunication`; reopen globally resets the newly captured graph's stores to `BAD/BadWaitingForInitialData` and calls its `EndpointLifecycleRouterV5.resetSocketSession()` before replay is accepted. Atomic framed replay then restores each Endpoint's retained payload and final connected/disconnected truth without a timer or Job-advance opportunity between frames.

- [ ] **Step 12: Run command/stream GREEN and commit**

```powershell
npm run test:run -- src/core/project-v5/opcua-boolean-write-targets.test.ts middleware/runtime-gateway/opcua-client-write-service.test.ts middleware/runtime-gateway/opcua-client-adapter.test.ts src/features/runtime-gateway/v4/runtime-gateway-stream-v4.test.ts src/features/runtime-gateway/v5/runtime-gateway-command-client.test.ts src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts
npm run test:run
npm run build:gateway
npm run lint
npm run build
git diff --exit-code -- src/features/runtime-gateway/v4
git add src/core/project-v5/opcua-boolean-write-targets.ts src/core/project-v5/opcua-boolean-write-targets.test.ts src/core/project-v5/index.ts middleware/runtime-gateway/opcua-client-write-service.ts middleware/runtime-gateway/opcua-client-write-service.test.ts middleware/runtime-gateway/opcua-client-adapter.ts middleware/runtime-gateway/opcua-client-adapter.test.ts src/features/runtime-gateway/v5/runtime-gateway-command-client.ts src/features/runtime-gateway/v5/runtime-gateway-command-client.test.ts src/features/runtime-gateway/v5/runtime-gateway-state-stream.ts src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts
git diff --cached --check
git commit -m "feat: add browser signal command client"
```

Add a static browser-boundary assertion for all three new V5 runtime-gateway files and the shared compiler: no `project-v4`, `runtime-gateway/v4`, middleware or `node-opcua` import, Node builtin, `process`, or `Buffer`. Expected: Mapping parity, V4/V5 stream lifecycle, command correlation/cache/abort tests, full suite, Gateway/browser builds, and lint PASS; the V4 directory remains byte-for-byte unchanged.

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
  new GatewaySignalWriteErrorV1('SIGNAL_WRITE_MAPPING_NOT_FOUND', 'Missing Mapping.'),
  new GatewaySignalWriteErrorV1('SIGNAL_WRITE_MAPPING_AMBIGUOUS', 'Ambiguous Mapping.'),
  new RuntimeGatewayCommandClientV1Error('RUNTIME_GATEWAY_TIMEOUT', 'Timed out.'),
  new RuntimeGatewayCommandClientV1Error('RUNTIME_GATEWAY_UNAVAILABLE', 'Offline.'),
] as const)('preserves a recognized SetDO rejection once', async (error) => {
  const writeBoolean = vi.fn(async () => { throw error })
  const harness = jobHarness({ instructions: [setDo('set', 'start', true)], writeBoolean })
  harness.executor.startJob('job', 0)
  await harness.executor.advanceAll(0)
  expect(harness.state()).toMatchObject({ state: 'FAILED', failureCode: error.code })
  await harness.executor.advanceAll(1)
  expect(writeBoolean).toHaveBeenCalledOnce()
})

it('normalizes an unknown SetDO rejection without reissuing it', async () => {
  const writeBoolean = vi.fn(async () => { throw new Error('unexpected') })
  const harness = jobHarness({ instructions: [setDo('set', 'start', true)], writeBoolean })
  harness.executor.startJob('job', 0)
  await harness.executor.advanceAll(0)
  await harness.executor.advanceAll(1)
  expect(harness.state()).toMatchObject({ state: 'FAILED', failureCode: 'SIGNAL_WRITE_FAILED' })
  expect(writeBoolean).toHaveBeenCalledOnce()
})

it('aborts a pending SetDO on cancellation and ignores its late settlement', async () => {
  const pending = abortableDeferredCommand()
  const writeBoolean = vi.fn((_signalId, _value, signal) => pending.promise(signal))
  const harness = jobHarness({ instructions: [setDo('set', 'start', true)], writeBoolean })
  harness.executor.startJob('job', 0)
  const advance = harness.executor.advanceAll(0)
  harness.executor.cancelJob()
  expect(pending.signal.aborted).toBe(true)
  pending.reject(new Error('unexpected'))
  await advance
  expect(harness.cancelledState()).toBeUnchanged()
  expect(writeBoolean).toHaveBeenCalledOnce()
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

Create `RobotJointRuntimeStoreV5` with separate `projectRevisionId` and `configRevision`, one exact Joint-ID record per Robot, `replaceProject(project, configRevision)`, `ingest(batch, receivedTimestampMs)`, `restoreReplayPrefix(batch, receivedTimestampMs)`, `beginEndpointCatchup(endpointId, atMs)`, `markEndpointDisconnected`, `resetEndpointSession`, `resetGatewaySession`, `writeJointValues`, and `readRobotPose(robotId, worldBasePose?)`. `readRobotPose` calls `computeSerialRobotPoseV5` with the current values and the supplied mapped Base World pose when present, otherwise the Robot's authored `localBasePose`. Compile one enabled read/readWrite Mapping per Joint target; use the Mapping root/leaf extraction from Task 2, apply increasing endpoint wire/receipt sequences only when `robot.jointSource === opcua:<endpointId>` and the batch `configRevision` matches, keep PLC source/published-time fences per mapped Robot/Joint channel rather than per Endpoint, apply Task 4's immutable `sourceTimestampMs <= publishedTimestampMs` admission, and retain values with STALE quality across disconnect. `restoreReplayPrefix` follows Task 4's fence-free, non-interpolating framed-prefix contract, and `beginEndpointCatchup` follows its transient touched-channel guard contract. `resetEndpointSession` preserves Joint values, marks only Robots owned by that Endpoint `BAD/BadWaitingForInitialData`, and clears only that Endpoint's wire/receipt fences plus its owned channel-clock fences so a reindexed or restarted PLC may resume from a lower source clock. Manual/Simulation writes against an OPC UA owner fail and no automatic takeover occurs. `JobRuntimeStoreV5` also retains both revision fields so an old run cannot survive a same-`revisionId` content replacement.

Adapt the proven V4 one-chain-per-Robot executor without importing V4 Project or Action types. A Job starts only when its Robot's `jointSource === 'simulation'`. `move-joint` retains wrapped/limited interpolation. `set-do` creates one per-instruction `AbortController`, stores one Promise before awaiting it, forwards the signal through `GatewaySignalWritePortV1`, and never reissues during repeated `advanceAll`. Preserve the code from a recognized `GatewaySignalWriteErrorV1` or `RuntimeGatewayCommandClientV1Error`; normalize any other SetDO rejection to `SIGNAL_WRITE_FAILED`. A terminal failed `CommandResultV1` still preserves its Gateway failure code. `wait-di` reads the store without network polling and checks `quality === 'GOOD'`, Boolean value equality, and `simulationMs >= entered + timeoutMs` in that order. `delay` advances at `entered + durationMs`. Attach/Detach call the injected port once. The port rejects with a structurally validated `AttachmentInstructionErrorV1`; the executor preserves its listed stable `code`, while an unknown rejection becomes `ATTACHMENT_INSTRUCTION_FAILED`. Cancellation, failure, replacement, or disposal aborts the active SetDO controller and invalidates the session generation so late SetDO or Attachment Promise settlement cannot advance a replacement run. Abort is control flow for an already-cancelled run, not a new failure overwrite.

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
  const graph = resources.bundle.getState().runtimeGraph
  expect(graph.robots.getState().projectRevisionId).toBe(projectV5.revisionId)
  expect(graph.robotFrames.projectRevisionId).toBe(projectV5.revisionId)
  expect(graph.objects.projectRevisionId).toBe(projectV5.revisionId)
  expect(graph.jobs.getState().projectRevisionId).toBe(projectV5.revisionId)
  expect(graph.signals.getState().projectRevisionId).toBe(projectV5.revisionId)
  expect(graph.attachments.getState().projectRevisionId).toBe(projectV5.revisionId)
  expect([
    graph.robots.getState().configRevision,
    graph.robotFrames.configRevision,
    graph.objects.configRevision,
    graph.jobs.getState().configRevision,
    graph.signals.getState().configRevision,
    graph.attachments.getState().configRevision,
    resources.bundle.getState().configRevision,
  ]).toEqual(Array(7).fill(CONFIG_REVISION))
})

it('distinguishes disconnect retention from reopened-session reset and accepts a fresh sequence', () => {
  const before = resources.bundle.getState().project
  const signals = () => resources.bundle.getState().runtimeGraph.signals.getState()
  gatewaySocket.message(JSON.stringify(signalBatch({ sequence: 10, value: true })))
  gatewaySocket.close()
  expect(signals().read('ready')?.quality).toBe('STALE')
  expect(signals().read('ready')?.statusCode).toBe('BadNoCommunication')
  gatewaySocket.reopen()
  expect(signals().read('ready')?.quality).toBe('BAD')
  expect(signals().read('ready')?.statusCode).toBe('BadWaitingForInitialData')
  gatewaySocket.message(JSON.stringify(signalBatch({ sequence: 1, value: false })))
  expect(signals().read('ready')).toMatchObject({
    value: false, quality: 'GOOD',
  })
  expect(resources.bundle.getState().project).toBe(before)
})

it('marks only the failed OPC UA Endpoint stale while the browser socket stays open', async () => {
  const graph = () => resources.bundle.getState().runtimeGraph
  gatewaySocket.message(JSON.stringify(goodBatchForEndpoint('plc-a')))
  gatewaySocket.message(JSON.stringify(goodBatchForEndpoint('plc-b')))
  await plcA.disconnectSession()
  expect(gatewaySocket.readyState).toBe(OPEN)
  await waitFor(() => expect(graph().signals.getState().read('ready-a')).toMatchObject({
    quality: 'STALE', statusCode: 'BadNoCommunication',
  }))
  expect(graph().signals.getState().read('ready-b')?.quality).toBe('GOOD')
  expect(graph().jobs.getState().waitConditionSatisfied('ready-a', true)).toBe(false)
  await plcA.emitRepeatedDisconnectSignal()
  expect(resources.endpointDisconnectCount('plc-a')).toBe(1)
  await plcA.reconnectAndPublish(false)
  await waitFor(() => expect(graph().signals.getState().read('ready-a')).toMatchObject({
    value: false, quality: 'GOOD',
  }))
})

it('rolls back every local runtime checkpoint when candidate apply fails', async () => {
  const failingResources = createBrowserProjectRuntimeV5(testOptions({ failApplyAfter: 'objects' }))
  const before = snapshotAllRuntimeStores(failingResources)
  const prepared = await failingResources.prepare(projectV5B, CONFIG_REVISION_B)
  await expect(failingResources.apply(prepared)).rejects.toThrow('TEST_APPLY_FAILURE')
  expect(() => failingResources.commit(prepared)).toThrow('BROWSER_RUNTIME_CANDIDATE_APPLY_FAILED')
  await failingResources.rollback(prepared)
  expect(snapshotAllRuntimeStores(failingResources)).toEqual(before)
  expect(() => failingResources.commit(prepared)).toThrow('BROWSER_RUNTIME_CANDIDATE_CONSUMED')
})

it.each(['robots', 'frames', 'objects', 'signals', 'jobs', 'attachments'] as const)(
  'keeps the published graph live while detached apply passes %s',
  async (afterStep) => {
    const raceResources = createBrowserProjectRuntimeV5(testOptions({
      afterDetachedApplyStep: (step) => {
        if (step !== afterStep) return
        gatewaySocket.message(JSON.stringify(oldRevisionSignalBatch({ value: true })))
        expect(raceResources.bundle.getState().runtimeGraph.signals.getState().read('ready')?.value).toBe(true)
      },
    }))
    const prepared = await raceResources.prepare(projectV5B, CONFIG_REVISION_B)
    await raceResources.apply(prepared)
    expect(snapshotPreparedCandidate(prepared).signals.ready).not.toBe(true)
    await raceResources.rollback(prepared)
    expect(raceResources.bundle.getState().runtimeGraph.signals.getState().read('ready')?.value).toBe(true)
  },
)

it('atomically swaps context and graph only at commit', async () => {
  const raceResources = createBrowserProjectRuntimeV5(testOptions({
    afterDetachedApplyStep: () => {
      gatewaySocket.message(JSON.stringify(oldRevisionSignalBatch({ value: true })))
    },
  }))
  const prepared = await raceResources.prepare(projectV5B, CONFIG_REVISION_B)
  await raceResources.apply(prepared)
  expect(readPublishedGraph(raceResources)).toMatchObject({
    projectRevisionId: projectV5.revisionId,
    ready: true,
  })
  raceResources.commit(prepared)
  expect(readPublishedGraph(raceResources)).toMatchObject({
    projectRevisionId: projectV5B.revisionId,
    ready: projectV5BInitialReady,
  })
})

it('rolls the sole bundle subscription to the new graph and exposes no stable old-store facade', async () => {
  const mounted = mountBundleConsumerHarness(resources.bundle)
  const oldGraph = mounted.graph()
  expect('signals' in resources).toBe(false)
  const prepared = await resources.prepare(projectV5B, CONFIG_REVISION_B)
  await resources.apply(prepared)
  resources.commit(prepared)
  expect(mounted.epochs()).toEqual([1, 2])
  expect(mounted.graph()).toBe(resources.bundle.getState().runtimeGraph)
  expect(mounted.graph()).not.toBe(oldGraph)
  expect(mounted.graphSubscriptionCount()).toBe(1)
})

it('finishes publication, rotation, cleanup, and notification despite throwing/reentrant listeners', async () => {
  let nestedPrepare: Promise<PreparedBrowserRuntimeCandidateV5> | undefined
  resources.bundle.subscribe(() => {
    const published = resources.bundle.getState()
    expect(published.runtimeGraph.streamTarget.configRevision).toBe(published.configRevision)
    nestedPrepare = resources.prepare(projectV5C, CONFIG_REVISION_C)
    throw new Error('TEST_SUBSCRIBER_FAILURE')
  })
  const observed: number[] = []
  resources.bundle.subscribe(() => observed.push(resources.bundle.getState().runtimeEpoch))
  const prepared = await resources.prepare(projectV5B, CONFIG_REVISION_B)
  await resources.apply(prepared)
  expect(() => resources.commit(prepared)).not.toThrow()
  expect(observed).toEqual([2])
  expect(streamHarness.rotationCount()).toBe(1)
  expect(oldGraphHarness.disposeCount()).toBe(1)
  expect(diagnostics()).toContain('TEST_SUBSCRIBER_FAILURE')
  const nested = await nestedPrepare!
  expect(preparedBaseEpoch(nested)).toBe(2)
  await resources.rollback(nested)
})

it('synchronously detaches an active catch-up before disposing the old graph', async () => {
  const oldGraph = resources.bundle.getState().runtimeGraph
  oldSocket.message(JSON.stringify(catchupStart('plc')))
  expect(catchupHarness(oldGraph).active()).toBe(true)
  const prepared = await resources.prepare(projectV5B, CONFIG_REVISION_B)
  await resources.apply(prepared)
  resources.commit(prepared)
  expect(catchupHarness(oldGraph).abortCount()).toBe(1)
  expect(oldSocket.handlersDetached()).toBe(true)
  oldSocket.delayedMessage(JSON.stringify(goodStateForOldRevision()))
  oldSocket.delayedClose()
  expect(resources.bundle.getState().runtimeGraph.signals.getState().read('ready')?.quality).toBe('BAD')
  expect(newGraphCallbackCount()).toBe(0)
})

it('enforces candidate state, cancellation/join, and base-epoch ordering', async () => {
  const beforeApply = await resources.prepare(projectV5B, CONFIG_REVISION_B)
  expect(() => resources.commit(beforeApply)).toThrow('BROWSER_RUNTIME_CANDIDATE_NOT_APPLIED')
  await resources.rollback(beforeApply)

  const gate = deferred<void>()
  const busyResources = createBrowserProjectRuntimeV5(testOptions({ detachedApplyGate: gate }))
  const busy = await busyResources.prepare(projectV5B, CONFIG_REVISION_B)
  const applying = busyResources.apply(busy)
  expect(() => busyResources.commit(busy)).toThrow('BROWSER_RUNTIME_CANDIDATE_BUSY')
  await expect(busyResources.apply(busy)).rejects.toThrow('BROWSER_RUNTIME_CANDIDATE_BUSY')
  const rollingBack = busyResources.rollback(busy)
  gate.resolve()
  await expect(applying).rejects.toThrow('AbortError')
  await rollingBack
  await expect(busyResources.apply(busy)).rejects.toThrow('BROWSER_RUNTIME_CANDIDATE_CONSUMED')

  const a = await resources.prepare(projectV5B, CONFIG_REVISION_B)
  const b = await resources.prepare(projectV5C, CONFIG_REVISION_C)
  await Promise.all([resources.apply(a), resources.apply(b)])
  resources.commit(b)
  expect(() => resources.commit(a)).toThrow('BROWSER_RUNTIME_CANDIDATE_STALE')
  expect(disposeCount(a)).toBe(1)
})

it('disposes the owner by detaching transport, aborting/joining candidates, and closing once', async () => {
  const gate = deferred<void>()
  const owned = createBrowserProjectRuntimeV5(testOptions({ detachedApplyGate: gate }))
  owned.startGatewayStream()
  oldSocket.message(JSON.stringify(catchupStart('plc')))
  const applyingCandidate = await owned.prepare(projectV5B, CONFIG_REVISION_B)
  const applying = owned.apply(applyingCandidate)
  const preparedCandidate = await owned.prepare(projectV5C, CONFIG_REVISION_C)

  const firstDispose = owned.dispose()
  const secondDispose = owned.dispose()
  expect(secondDispose).toBe(firstDispose)
  expect(oldSocket.handlersDetached()).toBe(true)
  expect(catchupHarness(owned.bundle.getState().runtimeGraph).abortCount()).toBe(1)
  gate.resolve()
  await expect(applying).rejects.toThrow('AbortError')
  await firstDispose
  expect(disposeCount(applyingCandidate)).toBe(1)
  expect(disposeCount(preparedCandidate)).toBe(1)
  expect(activeGraphDisposeCount()).toBe(1)
  await expect(owned.prepare(projectV5, CONFIG_REVISION)).rejects.toThrow('BROWSER_RUNTIME_DISPOSED')
  await expect(owned.apply(applyingCandidate)).rejects.toThrow('BROWSER_RUNTIME_DISPOSED')
  expect(() => owned.commit(applyingCandidate)).toThrow('BROWSER_RUNTIME_DISPOSED')
  await expect(owned.rollback(applyingCandidate)).rejects.toThrow('BROWSER_RUNTIME_DISPOSED')
  expect(() => owned.startGatewayStream()).toThrow('BROWSER_RUNTIME_DISPOSED')
  expect(() => owned.stopGatewayStream()).not.toThrow()
  await expect(owned.dispose()).resolves.toBeUndefined()
})
```

- [ ] **Step 2: Compose lifecycle ownership and disposal**

```ts
export interface PublishedBrowserRuntimeGraphV5 {
  readonly robots: StoreApi<RobotJointRuntimeStoreV5>
  readonly robotFrames: RobotFrameStatusRuntimeStoreV5
  readonly signals: StoreApi<LogicalSignalRuntimeStoreV1>
  readonly objects: ObjectRuntimeStateV5
  readonly jobs: StoreApi<JobRuntimeStoreV5>
  readonly attachments: StoreApi<AttachmentRuntimeStoreV1>
  readonly signalWrites: GatewaySignalWritePortV1
  readonly jobExecutor: RobotJobExecutorV5
  readonly playback: RobotJobPlaybackControllerV5
  readonly streamTarget: RuntimeGatewayStreamTargetV5
}

export interface BrowserRuntimeBundleStateV5 {
  readonly runtimeEpoch: number
  readonly project: WorkcellProjectV5
  readonly projectRevisionId: string
  readonly configRevision: string
  readonly gatewayId: string
  readonly runtimeGraph: PublishedBrowserRuntimeGraphV5
}

export interface BrowserRuntimeBundleCellV5 {
  getState(): BrowserRuntimeBundleStateV5
  subscribe(listener: () => void): () => void
}

export interface PreparedBrowserRuntimeCandidateV5 {
  readonly projectRevisionId: string
  readonly configRevision: string
}

export interface BrowserProjectResourcesV5 {
  readonly bundle: BrowserRuntimeBundleCellV5
  prepare(project: WorkcellProjectV5, configRevision: string): Promise<PreparedBrowserRuntimeCandidateV5>
  apply(prepared: PreparedBrowserRuntimeCandidateV5): Promise<void>
  commit(prepared: PreparedBrowserRuntimeCandidateV5): void
  rollback(prepared: PreparedBrowserRuntimeCandidateV5): Promise<void>
  startGatewayStream(): void
  stopGatewayStream(): void
  dispose(): Promise<void>
}
```

Create these resources as a V5 runtime candidate using a validated Project, a caller-supplied lowercase 64-hex `configRevision`, and the configured Gateway ID; never recompute the hash and never substitute `revisionId`. Task 7 owns an opaque, single-use local `PreparedBrowserRuntimeCandidateV5` and atomic `prepare/apply/commit/rollback` only for the Robot, Job, Signal, Object, Frame/status, and Attachment resources. `prepare` validates the Project/hash, captures the current bundle object and positive safe-integer `runtimeEpoch`, rejects epoch exhaustion, and constructs a completely detached candidate graph. `apply` may await and perform every fallible per-store initialization, but mutates only that detached graph; the published bundle, old graph, and stream target remain untouched. An injected constructor-only test hook may observe each named detached apply step, but it is not part of the production resource interface.

The prepared handle has an internal closed state machine: `prepared -> applying -> applied -> consumed`, plus `failed` for a rejected apply. Only one `apply` may start; a second/concurrent apply rejects `BROWSER_RUNTIME_CANDIDATE_BUSY`, commit while applying rejects the same code, commit before apply rejects `BROWSER_RUNTIME_CANDIDATE_NOT_APPLIED`, and commit after failure rejects `BROWSER_RUNTIME_CANDIDATE_APPLY_FAILED`. `rollback` is async: from `applying` its first caller marks cancellation, aborts the detached apply through its private signal, joins the one apply Promise, then atomically consumes and disposes the candidate; another rollback while that cancellation is pending returns the same rollback Promise rather than disposing twice. From `prepared`, `applied`, or `failed`, rollback consumes/disposes directly. Any new operation after consumption rejects exact `BROWSER_RUNTIME_CANDIDATE_CONSUMED`. Apply checks cancellation between every detached step and performs no active-cell mutation even when a constructor/test callback reenters. At commit, require the bundle object and `runtimeEpoch` still equal the captured base; an out-of-order candidate becomes consumed/disposed and throws `BROWSER_RUNTIME_CANDIDATE_STALE` without publication.

Do not use Zustand `setState` as the publication primitive because it invokes subscribers synchronously. Back `BrowserRuntimeBundleCellV5` with a module-private split-phase cell. Its fallible, side-effect-free `prepareInstall(next, expectedBaseBundle, expectedEpoch)` validates the exact base identity/Epoch, freezes the complete next bundle, captures the prior graph and listener snapshot, and returns an opaque single-use install token. After that succeeds, commit marks the candidate handle consumed and calls token `installPure()`, which performs only one no-throw/no-callout pointer assignment. A mandatory no-throw finalization tail then calls the stable stream's synchronous `refreshActiveTarget()`; it must detach the old socket, abort/discard old buffers/guards, and prevent every future old-target callback before returning. In `finally`, isolate old playback/executor/graph disposal and call token `flushIsolatedNotifications()`, which invokes the captured listeners individually, catches every exception, and records diagnostics without throwing. The tail must attempt rotation, cleanup, and notification exactly once even if an injected implementation throws despite its no-throw contract; commit never reports failure after `installPure()`. Thus a throwing or reentrant subscriber can neither make a published commit report failure nor skip stream rotation/cleanup. Reentrant preparation observes only the new complete bundle.

The bundle/runtime graph is the only long-lived consumer contract. Do not expose per-store getters or stable-looking `signals`, `robots`, `signalWrites`, `jobExecutor`, or `playback` fields on `BrowserProjectResourcesV5`: an ES getter cannot migrate an existing Zustand/React subscription. React uses `useSyncExternalStore(resources.bundle.subscribe, resources.bundle.getState)` and keys/remounts the graph-owned subtree by `runtimeEpoch`; imperative code reads one bundle snapshot and keeps its graph only for that operation. Cached graph-owned services must not cross an Epoch. The stream reads the published graph's prebuilt `RuntimeGatewayStreamTargetV5`, so no observer can pair old context with candidate stores. `rollback` disposes only the detached candidate and never restores or rewrites the still-published old graph. Its integration harness may stage a Gateway through an injected lifecycle port, but it does not open the Project repository, publish the active Project, compute a canonical hash, or become the production Gateway publication authority. Milestone 5 computes the canonical hash exactly once and coordinates repository, Gateway activation, and these existing runtime lifecycle methods. The detached candidate begins with reset runtime-only Robot Joint, Robot Frame/status, Object, Signal, and Attachment data; the atomic install also advances the command Client lease epoch, so a pre-commit lease cannot survive. An old-context frame injected after every detached apply step must update only the old published graph and remain present after rollback. On successful commit it remains observable until the exact pointer install, then is intentionally replaced by the new Revision's reset candidate state; it is never silently rolled back before commit and never leaks into the candidate.

The owner has its own `ACTIVE -> DISPOSING -> DISPOSED` state and tracks every unconsumed prepared handle in an enumerable private Set in addition to the authenticity WeakMap. The first `dispose()` atomically enters DISPOSING, synchronously calls the stream's idempotent `stop()` so handlers are detached and any catch-up guard is aborted before returning control, marks every applying candidate cancelled and aborts its private signal, joins every apply/rollback Promise, consumes and disposes every prepared/applied/failed candidate exactly once, then disposes the active graph and enters DISPOSED. It returns one shared Promise; concurrent and later `dispose()` calls return/resolve through that same completed operation, while `stopGatewayStream()` remains an idempotent no-op after disposal. From the instant DISPOSING begins, `prepare`, `apply`, `commit`, `rollback`, and `startGatewayStream` reject exact `BROWSER_RUNTIME_DISPOSED` (synchronous methods throw; Promise methods reject), and no gated apply continuation may mutate or publish after its abort. Cleanup failures are isolated/diagnosed while all remaining candidates and the active graph are still attempted; disposal resolves only after all joins and cleanup attempts complete.

`BrowserProjectRuntimeV5.startGatewayStream()` constructs one V5 stream whose required `readActiveTarget` reads the published bundle exactly once and returns that bundle's prebuilt immutable stream target: Project ID, canonical config Revision, Gateway ID, Robot Joint/Frame, Object, and Signal State consumers, plus the same graph's Endpoint lifecycle router and callbacks. A Gateway replay for a not-yet-committed browser Revision is rejected/reconnected rather than consumed, and a physical frame already admitted against an old target can call only that captured old graph even if a reentrant commit swaps the active cell. Its required `onEndpointCatchupStart` begins one transient guard in each of the four stores and returns a composite no-throw guard; partial construction aborts already-created guards before throwing. This makes `WaitDI` non-consumable during buffering, commits final touched-channel state at valid end, and restores untouched channels such as a sparse Endpoint's B channel. An accepted `disconnected` lifecycle event performs a durable Endpoint-local STALE transition while the browser WebSocket remains open. An accepted `connected` event resets only that Endpoint to `BAD/BadWaitingForInitialData` and clears only its sequence/source/interpolation session fences before the first new State data. Ordinary `BAD/BadNoCommunication` State values do not invoke the lifecycle router. Duplicate lifecycle Event IDs are idempotent.

Separately, each graph's stream-target `onSessionDisconnect(atMs)` aborts any active catch-up guard, then marks every Endpoint-owned channel in that graph's four stores `STALE/BadNoCommunication` once for a browser transport gap. Its `onSessionStart(atMs)` calls that graph's four global `resetGatewaySession` functions and `EndpointLifecycleRouterV5.resetSocketSession()` before accepting replay, producing `BAD/BadWaitingForInitialData` with cleared socket-session fences. The framed Hub replay `start -> prefix -> connected -> current -> optional disconnected -> end` is buffered and applied synchronously at end, so WaitDI cannot observe a prefix/current GOOD value before a retained disconnect is applied. A live catch-up overlays transient non-GOOD at start and applies the full pending State/lifecycle cut plus guard commit synchronously at end. Both paths reconstruct the affected Endpoint correctly if the PLC is still down or has reconnected. Expose this runtime for the Milestone 5 V5 UI composition; do not import it into the V4 App.

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
    await first.publish({ signal: true, objectX: 0.2, jointJ1: 10, sourceTimestampMs: 80_000 })
    await waitFor(() => expect(gateway.runtime.snapshot()).toMatchObject({
      signal: { value: true, quality: 'GOOD' },
      object: { x: 0.2, quality: 'GOOD' },
      joint: { value: 10, quality: 'GOOD' },
    }))
    await first.stop()
    await waitFor(() => expect(gateway.runtime.snapshot()).toMatchObject({
      signal: { value: true, quality: 'STALE', statusCode: 'BadNoCommunication' },
      object: { x: 0.2, quality: 'STALE', statusCode: 'BadNoCommunication' },
      joint: { value: 10, quality: 'STALE', statusCode: 'BadNoCommunication' },
    }))
    const second = await startReindexableOpcUaServer({
      endpointUrl: first.endpointUrl,
      namespaceUri,
      namespacesBeforeTarget: 1,
    })
    expect(await second.namespaceIndex(namespaceUri)).toBe(3)
    await second.publish({ signal: false, objectX: 0.4, jointJ1: 20, sourceTimestampMs: 1_000 })
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
- [ ] OPC UA Session lifecycle uses an explicit zero-value-capable Endpoint barrier, never a mapped-value quality heuristic; replay and reconnect affect only the failed Endpoint while ordinary `BAD/BadNoCommunication` data remains channel-local.
- [ ] SetDO resolves one write Mapping, performs one Session.write, and waits for success.
- [ ] Wrong Revision, stale generation, expiry, type, direction, and disconnect fail before write.
- [ ] Identical duplicate Command IDs return one retained result; conflicting reuse does not execute.
- [ ] Client writes and later Server commands share one active-Revision 4,096-record deduplication budget.
- [ ] Delay and WaitDI use nondecreasing Simulation time and exact boundary comparisons.
- [ ] Attach and Detach use explicit IDs, preserve World pose, and never infer from the gripper.
- [ ] Runtime-only Signal quality and attachment state do not change canonical Project V5 JSON.
- [ ] Project replacement, browser WebSocket reconnect, and OPC UA Endpoint reconnect reset their distinct runtime fences deterministically.
- [ ] Local OPC UA integration, full tests, lint, Gateway build, and browser build pass.
