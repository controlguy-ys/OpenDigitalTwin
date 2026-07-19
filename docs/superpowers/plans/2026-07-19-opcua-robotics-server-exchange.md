# OPC UA Robotics Server and Product Exchange Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom joint-only OPC UA Server tree with an official OPC UA Robotics v1.02 Motion Device model for read-only Robot Actual telemetry and a separate OpenWebDigitalTwin product model for Scene, Signal, Job, attachment, command, result, and diagnostic exchange.

**Architecture:** Compile a pure Project V5-to-server projection first, then instantiate standard Robotics types from the packaged Standard/DI/IA/Robotics NodeSets with instance NodeIds owned by the product instance namespace. Build product Actual and staged Command trees separately. A single browser publisher lease carries raw Simulation state to the Gateway and carries accepted external commands back to the V5 runtime; Session-local OPC UA staging never mutates browser or Three.js state directly.

**Tech Stack:** TypeScript 6.0.3, node-opcua 2.175.0, node-opcua-nodesets 2.174.0, Vitest 4.1.10, Node 22.15.1, npm 11.4.2.

## Global Constraints

- Execute after Milestones 1-3. Consume `WorkcellProjectV5`, the M3 runtime command/result envelope, and the active V5 browser runtime; do not reopen the Project aggregate.
- Load the official Standard, DI, IA, and Robotics v1.02 NodeSets from `node-opcua-nodesets@2.174.0` in dependency order. Do not copy standard XML or recreate standard types.
- The standard Namespace URI is exactly `http://opcfoundation.org/UA/Robotics/`. Product model and instance Namespace URIs are exactly `urn:open-web-digital-twin:model:v1` and `urn:open-web-digital-twin:instances:v1`.
- No OpenWebDigitalTwin-created NodeId may use Standard, DI, IA, or Robotics namespace indexes. Standard BrowseNames and TypeDefinitions do not change NodeId ownership.
- Every Robot instance is a standard `MotionDeviceType`; each configured Joint is one `AxisType`. Do not pad or truncate the Axis list to six.
- Independently modelled linear tracks and positioners are separate Motion Devices in the same system, not hidden Robot Joints.
- Controllers are `ControllerType` instances linked to controlled Motion Devices through the standard `Controls` reference. Power Trains use the standard model.
- Publish revolute Actual Position in degrees and prismatic Actual Position in millimetres. Project V5 runtime values are degrees/metres; conversion occurs once at the Server boundary.
- Standard Actual Position is read-only and returns `BadNotWritable`. Do not use it as a command target.
- Safety State is informational Simulation data only. Generic Object numeric status never becomes a Robotics Safety State.
- Product Object pose commands stage all XYZ/RPY components atomically; internal pose remains quaternion and no partial write leaks to the Scene.
- Staging is isolated by OPC UA Session and target. A false-to-true Execute edge snapshots only one complete same-Session request.
- A command requires RequestId, ExpiresAt, typed target/payload, and Execute. Results expose Acknowledgement, ExecutionState, FailureCode, Message, and completion time.
- Repeated identical RequestIds return the retained terminal result without a second browser mutation. Conflicting reuse fails deterministically.
- The Gateway accepts external commands only while the current V5 browser publisher lease and Project Revision are valid. It never writes React or Three.js state directly.
- Maximum active Server Sessions is 16; maximum retained command records is 4,096.
- Do not expose incomplete standard program operation methods, claim Robotics conformance, add security configuration, manufacturer code generation, Legacy behavior, physics, or safety claims.
- Keep comments in English, preserve unrelated user changes, and stage only files listed by each Task.

---

## File Structure

**Create:**

- `middleware/runtime-gateway/opcua-nodeset-contract.ts` and test - pinned NodeSet dependency order and v1.02 metadata checks.
- `middleware/runtime-gateway/opcua-robotics-projection.ts` and test - pure Motion Device/Axis/Controller projection and unit conversion.
- `middleware/runtime-gateway/opcua-robotics-model.ts` and test - official standard instance construction and read-only Actual publication handles.
- `middleware/runtime-gateway/opcua-openweb-model.ts` and test - product Actual/Command/Result/Diagnostics address-space construction.
- `middleware/runtime-gateway/opcua-command-staging.ts` and test - Session-local atomic staging and rising-edge snapshots.
- `middleware/runtime-gateway/browser-publisher-lease.ts` and test - one browser owner, renewal, expiry, Revision/generation fencing.
- `middleware/runtime-gateway/browser-command-dispatch.ts` and test - WebSocket command/result routing through M3's shared bounded dedupe registry.
- `src/core/runtime-protocol/integration-diagnostics-v1.ts` and test - closed browser-readable Robotics/product-model, Session, lease, and last-command diagnostics contract.
- `middleware/runtime-gateway/integration-diagnostics.ts` and test - one snapshot builder shared by HTTP diagnostics and product Diagnostics Variables.
- `src/features/runtime-gateway/v5/runtime-gateway-command-owner.ts` and test - V5 Simulation command dispatch for Robot, Object, Signal, and Job targets.
- `middleware/runtime-gateway/opcua-server-model.integration.test.ts` - real node-opcua browse/read/write/Session-isolation evidence.

**Modify:**

- `package.json` and lockfile - direct `node-opcua-nodesets@2.174.0` dependency and focused test script.
- `src/core/runtime-protocol/v1.ts` and test - lease acquire/renew/release, raw Simulation publication, product command batch, and result envelopes using V5 IDs.
- `middleware/runtime-gateway/opcua-server-adapter.ts` and test - V5 Project input, NodeSet loading, model composition, status, publication, and 16-Session cap.
- `middleware/runtime-gateway/main.ts` and test - browser lease/routes/WebSocket wiring, staged Server activation, and command-result forwarding.
- `src/features/runtime-gateway/v5/runtime-gateway-state-stream.ts` and test - lease lifecycle, outgoing raw state, incoming product commands, terminal results.
- `src/features/project/v5/browser-project-runtime-v5.ts` and test - register exactly one V5 command owner and raw Simulation publisher.
- `middleware/README.md` - compatible-mapping boundary, namespaces, units, commands, and limitations.

### Task 1: Pin and Prove the Official Robotics NodeSets

**Files:**
- Create: `middleware/runtime-gateway/opcua-nodeset-contract.ts`
- Test: `middleware/runtime-gateway/opcua-nodeset-contract.test.ts`
- Modify: `package.json`
- Modify: lockfile

**Interfaces:**
- Produces: `OPC_UA_ROBOTICS_NAMESPACE_URI_V1`, `ROBOTICS_NODESET_FILES_V1`, and `assertRoboticsNodeSetContractV1()`.

- [ ] **Step 1: Write the failing package and metadata tests**

```ts
it('loads Standard, DI, IA, and Robotics in dependency order', () => {
  expect(ROBOTICS_NODESET_FILES_V1).toEqual([
    nodesets.standard,
    nodesets.di,
    nodesets.ia,
    nodesets.robotics,
  ])
})

it('pins the published Robotics v1.02 namespace', async () => {
  await expect(assertRoboticsNodeSetContractV1()).resolves.toMatchObject({
    namespaceUri: 'http://opcfoundation.org/UA/Robotics/',
    version: '1.02',
    publicationDate: '2025-09-08',
  })
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-nodeset-contract.test.ts
```

Expected: FAIL because the direct dependency and contract module do not exist.

- [ ] **Step 3: Add the exact dependency and closed contract**

```ts
import { nodesets } from 'node-opcua-nodesets'

export const OPC_UA_ROBOTICS_NAMESPACE_URI_V1 =
  'http://opcfoundation.org/UA/Robotics/' as const
export const ROBOTICS_NODESET_FILES_V1 = Object.freeze([
  nodesets.standard,
  nodesets.di,
  nodesets.ia,
  nodesets.robotics,
])
```

Read the Robotics XML with fatal UTF-8 decoding and assert its `ModelUri`, `Version`, and `PublicationDate`; assert DI and IA appear in its required-model chain. Fail startup with `OPC_UA_ROBOTICS_NODESET_MISMATCH` instead of falling back to copied types.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm install --save-exact node-opcua-nodesets@2.174.0
npm run test:run -- middleware/runtime-gateway/opcua-nodeset-contract.test.ts
npm run build:gateway
git add package.json package-lock.json middleware/runtime-gateway/opcua-nodeset-contract.ts middleware/runtime-gateway/opcua-nodeset-contract.test.ts
git diff --cached --check
git commit -m "build: pin robotics nodeset contract"
```

### Task 2: Compile the Pure Robotics Projection

**Files:**
- Create: `middleware/runtime-gateway/opcua-robotics-projection.ts`
- Test: `middleware/runtime-gateway/opcua-robotics-projection.test.ts`

**Interfaces:**
- Consumes: validated `WorkcellProjectV5`.
- Produces: `RoboticsSystemProjectionV1`, `projectJointActualForOpcUaV1()`, and `projectJointRangeForOpcUaV1()`.

- [ ] **Step 1: Write exact-count, identity, relation, and unit tests**

```ts
it.each([2, 7, 16])('projects exactly %i configured Axes', (jointCount) => {
  const projection = projectRoboticsSystemV1(projectWithJointCount(jointCount))
  expect(projection.motionDevices[0]!.axes).toHaveLength(jointCount)
})

it('converts only prismatic metres to millimetres', () => {
  expect(projectJointActualForOpcUaV1('revolute', 12.5)).toEqual({ value: 12.5, unit: 'degree' })
  expect(projectJointActualForOpcUaV1('prismatic', 0.125)).toEqual({ value: 125, unit: 'millimetre' })
  expect(projectJointRangeForOpcUaV1('revolute', -270, 270)).toEqual({ low: -270, high: 270 })
  expect(projectJointRangeForOpcUaV1('prismatic', -0.2, 1.5)).toEqual({ low: -200, high: 1_500 })
})

it('keeps an independent linear track as a second Motion Device', () => {
  expect(projectRoboticsSystemV1(robotAndTrackProject()).motionDevices.map(({ id }) => id))
    .toEqual(['robot-a', 'track-a'])
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-robotics-projection.test.ts
```

- [ ] **Step 3: Implement immutable projection records**

```ts
export interface RoboticsAxisProjectionV1 {
  readonly jointId: string
  readonly browseName: string
  readonly kind: 'revolute' | 'prismatic'
  readonly actualPosition: number
  readonly minimum: number
  readonly maximum: number
  readonly engineeringUnit: 'degree' | 'millimetre'
}

export interface RoboticsMotionDeviceProjectionV1 {
  readonly id: string
  readonly browseName: string
  readonly serialNumber: string
  readonly category: RobotIdentificationV1['motionDeviceCategory']
  readonly controllerId: string
  readonly axes: readonly RoboticsAxisProjectionV1[]
}

export interface RoboticsSystemProjectionV1 {
  readonly projectId: string
  readonly revisionId: string
  readonly motionDevices: readonly RoboticsMotionDeviceProjectionV1[]
  readonly controllers: readonly RobotControllerV5[]
}
```

Reject missing Controller/Definition/Joint values before address-space creation. Freeze output; preserve Project order; derive Axis count only from each Definition. Include Power Train projection per Motion Device and an explicitly informational safety value.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-robotics-projection.test.ts
npm run build:gateway
git add middleware/runtime-gateway/opcua-robotics-projection.ts middleware/runtime-gateway/opcua-robotics-projection.test.ts
git diff --cached --check
git commit -m "feat: project robotics motion devices"
```

### Task 3: Instantiate Standard Robotics Types and Read-Only Actuals

**Files:**
- Create: `middleware/runtime-gateway/opcua-robotics-model.ts`
- Test: `middleware/runtime-gateway/opcua-robotics-model.test.ts`
- Modify: `middleware/runtime-gateway/opcua-server-adapter.ts`
- Test: `middleware/runtime-gateway/opcua-server-adapter.test.ts`

**Interfaces:**
- Consumes: Task 1 NodeSets, Task 2 projection, initialized `AddressSpace`.
- Produces: `OpcUaRoboticsModelV1` with deterministic read-only Axis publication handles.

- [ ] **Step 1: Write RED model/type/namespace tests**

```ts
it('uses standard TypeDefinitions but product-owned instance NodeIds', async () => {
  const model = await startRoboticsModel(projectWithJointCount(7))
  expect(model.typeDefinitions()).toMatchObject({
    system: 'MotionDeviceSystemType', motionDevice: 'MotionDeviceType', axis: 'AxisType',
  })
  expect(model.productNodeIds().every(({ namespaceUri }) => (
    namespaceUri === 'urn:open-web-digital-twin:instances:v1'
  ))).toBe(true)
})

it('keeps ActualPosition non-writable', async () => {
  const result = await clientWriteActual(await startRoboticsModel(projectWithJointCount(2)))
  expect(result.statusCode).toBe('BadNotWritable')
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-robotics-model.test.ts middleware/runtime-gateway/opcua-server-adapter.test.ts
```

- [ ] **Step 3: Instantiate through official ObjectTypes**

```ts
export interface OpcUaRoboticsModelV1 {
  readonly motionSystemNodeId: string
  readonly axisActualNodeIds: Readonly<Record<string, Readonly<Record<string, string>>>>
  publishJointActual(robotId: string, jointId: string, projectValue: number): void
  dispose(): void
}

export function instantiateOpcUaRoboticsModelV1(options: Readonly<{
  addressSpace: AddressSpace
  projection: RoboticsSystemProjectionV1
  instancesNamespace: Namespace
}>): OpcUaRoboticsModelV1
```

Resolve `MotionDeviceSystemType`, `MotionDeviceType`, `AxisType`, and `ControllerType` by the Robotics namespace URI. Instantiate under `Objects/DeviceSet`; create every instance NodeId through the instances namespace. Materialize mandatory children, Controllers, standard `Controls` references, Power Trains, and informational Safety State. Configure `ActualPosition` with `CurrentRead`, correct `EngineeringUnits`/`EURange`, and no setter. Build `EURange` only through `projectJointRangeForOpcUaV1`: revolute limits remain degrees and prismatic metre limits are multiplied by 1,000 exactly once.

Create `OPCUAServer` with `nodeset_filename: ROBOTICS_NODESET_FILES_V1` and `maxConnectionsPerEndpoint: 16`. Replace the V4 adapter input with validated V5 and keep Bridge Server activation from M1.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-robotics-model.test.ts middleware/runtime-gateway/opcua-server-adapter.test.ts
npm run build:gateway
git add middleware/runtime-gateway/opcua-robotics-model.ts middleware/runtime-gateway/opcua-robotics-model.test.ts middleware/runtime-gateway/opcua-server-adapter.ts middleware/runtime-gateway/opcua-server-adapter.test.ts
git diff --cached --check
git commit -m "feat: publish standard robotics actuals"
```

### Task 4: Build the OpenWebDigitalTwin Product Model

**Files:**
- Create: `middleware/runtime-gateway/opcua-openweb-model.ts`
- Test: `middleware/runtime-gateway/opcua-openweb-model.test.ts`
- Modify: `middleware/runtime-gateway/opcua-server-adapter.ts`
- Test: `middleware/runtime-gateway/opcua-server-adapter.test.ts`

**Interfaces:**
- Produces: `OpcUaOpenWebModelV1`, product model/instance namespace constants, Actual publication, staged Command field handles, Result and Diagnostics updates.

- [ ] **Step 1: Write RED tree, ownership, and atomic-pose tests**

```ts
it('creates separate Actual, Command, Result, and Diagnostics branches', () => {
  expect(model.rootChildren()).toEqual(['Actual', 'Command', 'Result', 'Diagnostics'])
})

it('does not create a product NodeId in an OPC Foundation namespace', () => {
  expect(model.productNodeIds().every(({ namespaceUri }) => (
    namespaceUri === OPENWEB_MODEL_NAMESPACE_URI_V1
    || namespaceUri === OPENWEB_INSTANCES_NAMESPACE_URI_V1
  ))).toBe(true)
})

it('publishes Object Actual pose as one coherent snapshot', () => {
  model.publishSnapshot(snapshot({ objectPose: poseA }))
  expect(model.readActualObjectPose('box')).toEqual(poseA)
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-openweb-model.test.ts
```

- [ ] **Step 3: Implement the exact product branches**

```ts
export const OPENWEB_MODEL_NAMESPACE_URI_V1 =
  'urn:open-web-digital-twin:model:v1' as const
export const OPENWEB_INSTANCES_NAMESPACE_URI_V1 =
  'urn:open-web-digital-twin:instances:v1' as const

export interface ObjectActualV1 {
  readonly pose: RigidTransformV5
  readonly status: number
  readonly color: string
  readonly quality: 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE'
  readonly sourceTimestampMs: number
  readonly publishedTimestampMs: number
}

export interface LogicalSignalActualV1 {
  readonly value: boolean | number | string
  readonly quality: 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE'
  readonly statusCode: string
  readonly sourceTimestampMs: number
  readonly publishedTimestampMs: number
}

export interface JobActualV1 {
  readonly state: string
  readonly stepIndex: number
  readonly failureCode: string | null
}

export interface AttachmentActualV1 {
  readonly state: 'attached' | 'detached'
  readonly parentFrameId: string | null
}

export interface ServerActualSnapshotV1 {
  readonly projectId: string
  readonly revisionId: string
  readonly configRevision: string
  readonly robots: Readonly<Record<string, Readonly<Record<string, number>>>>
  readonly sceneObjects: Readonly<Record<string, ObjectActualV1>>
  readonly logicalSignals: Readonly<Record<string, LogicalSignalActualV1>>
  readonly jobs: Readonly<Record<string, JobActualV1>>
  readonly attachments: Readonly<Record<string, AttachmentActualV1>>
}
```

Under `Objects/OpenWebDigitalTwin/Projects/<projectId>`, create the exact approved Actual branches for Scene Objects, logical Signals, Jobs, and Attachments. Command branches are Robot Joint Targets, Scene Objects, logical Signals, and Jobs. Use OPC UA `String` for RequestId, `DateTime` for ExpiresAt/completion time, and `Boolean` for Execute; convert DateTime to epoch milliseconds only at the Runtime Protocol boundary. Result is keyed by RequestId; Diagnostics exposes both immutable Project identity `revisionId` and replace-on-configuration-change `configRevision`, plus lease generation/expiry, last command, and Gateway/Endpoint facts. RPY variables are exchange-only; convert a complete staged payload to one quaternion when dispatching.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-openweb-model.test.ts middleware/runtime-gateway/opcua-server-adapter.test.ts
npm run build:gateway
git add middleware/runtime-gateway/opcua-openweb-model.ts middleware/runtime-gateway/opcua-openweb-model.test.ts middleware/runtime-gateway/opcua-server-adapter.ts middleware/runtime-gateway/opcua-server-adapter.test.ts
git diff --cached --check
git commit -m "feat: add openweb opc ua exchange model"
```

### Task 5: Stage Commands per Session and Dispatch through One Browser Lease

**Files:**
- Create: `middleware/runtime-gateway/opcua-command-staging.ts`
- Test: `middleware/runtime-gateway/opcua-command-staging.test.ts`
- Create: `middleware/runtime-gateway/browser-publisher-lease.ts`
- Test: `middleware/runtime-gateway/browser-publisher-lease.test.ts`
- Create: `middleware/runtime-gateway/browser-command-dispatch.ts`
- Test: `middleware/runtime-gateway/browser-command-dispatch.test.ts`
- Create: `src/core/runtime-protocol/integration-diagnostics-v1.ts`
- Test: `src/core/runtime-protocol/integration-diagnostics-v1.test.ts`
- Create: `middleware/runtime-gateway/integration-diagnostics.ts`
- Test: `middleware/runtime-gateway/integration-diagnostics.test.ts`
- Create: `src/features/runtime-gateway/v5/runtime-gateway-command-owner.ts`
- Test: `src/features/runtime-gateway/v5/runtime-gateway-command-owner.test.ts`
- Modify: `src/core/runtime-protocol/v1.ts`
- Test: `src/core/runtime-protocol/v1.test.ts`
- Modify: `middleware/runtime-gateway/main.ts`
- Test: `middleware/runtime-gateway/main.test.ts`
- Modify: `src/features/runtime-gateway/v5/runtime-gateway-state-stream.ts`
- Test: `src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts`
- Modify: `src/features/project/v5/browser-project-runtime-v5.ts`
- Test: `src/features/project/v5/browser-project-runtime-v5.test.ts`

**Interfaces:**
- Consumes: M3 `RuntimeCommandDedupeRegistryV1`, shared with Client-write commands for one 4,096-record active-Revision budget.
- Produces: per-Session `ProductCommandStagingV1`, `BrowserPublisherLeaseManagerV1`, `BrowserCommandDispatchV1`, and `RuntimeGatewayCommandOwnerV5`.

- [ ] **Step 1: Write RED Session isolation, rising-edge, lease, and dedupe tests**

```ts
it('never combines staged fields from two Sessions', () => {
  staging.write('session-a', target, 'RequestId', 'request-a')
  staging.write('session-a', target, 'ExpiresAt', 2_000)
  staging.write('session-b', target, 'X', 1)
  expect(() => staging.write('session-a', target, 'Execute', true, 1_000))
    .toThrow('COMMAND_STAGE_INCOMPLETE')
})

it('dispatches one snapshot only on a false-to-true Execute edge', async () => {
  stageCompleteObjectPose(staging, 'session-a', 'request-a')
  await staging.write('session-a', target, 'Execute', false, 1_000)
  await staging.write('session-a', target, 'Execute', true, 1_001)
  await staging.write('session-a', target, 'Execute', true, 1_002)
  expect(dispatch).toHaveBeenCalledOnce()
})

it('rejects an external command after browser lease expiry', async () => {
  clock.set(lease.expiresAt + 1)
  await expect(dispatch.execute(command)).resolves.toMatchObject({
    acknowledgement: 'REJECTED', failureCode: 'BROWSER_PUBLISHER_UNAVAILABLE',
  })
})

it('publishes ACCEPTED/RUNNING before the deferred browser result becomes terminal', async () => {
  const pending = deferred<CommandResultV1>()
  const results = createProductResultRecorder()
  const dispatch = commandDispatchHarness({ send: () => pending.promise, publishResult: results.publish })
  const execution = dispatch.execute(completeProductCommand({ requestId: 'request-running' }))
  expect(results.read('request-running')).toMatchObject({
    acknowledgement: 'ACCEPTED', executionState: 'RUNNING', completedAt: null,
  })
  pending.resolve(succeededCommandResult({ commandId: 'request-running', completedAt: 1_250 }))
  await execution
  expect(results.read('request-running')).toMatchObject({
    acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED', completedAt: 1_250,
  })
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-command-staging.test.ts middleware/runtime-gateway/browser-publisher-lease.test.ts middleware/runtime-gateway/browser-command-dispatch.test.ts src/features/runtime-gateway/v5/runtime-gateway-command-owner.test.ts src/core/runtime-protocol/v1.test.ts
```

- [ ] **Step 3: Implement the fixed command and lease contracts**

```ts
export type ProductCommandPayloadV1 =
  | { readonly kind: 'robot-joint-target'; readonly robotId: string; readonly jointValues: Readonly<Record<string, number>> }
  | { readonly kind: 'scene-object-pose'; readonly objectId: string; readonly pose: Readonly<{ x: number; y: number; z: number; roll: number; pitch: number; yaw: number }> }
  | { readonly kind: 'logical-signal'; readonly signalId: string; readonly value: boolean | number | string }
  | { readonly kind: 'job'; readonly jobId: string; readonly operation: 'start' | 'cancel' }

export interface ProductCommandSnapshotV1 {
  readonly requestId: string
  readonly expiresAt: number
  readonly projectId: string
  readonly revisionId: string
  readonly configRevision: string
  readonly sessionId: string
  readonly targetId: string
  readonly payload: ProductCommandPayloadV1
}

export interface RuntimeIntegrationDiagnosticsV1 {
  readonly type: 'runtime-integration-diagnostics-v1'
  readonly protocolVersion: 1
  readonly observedAtMs: number
  readonly projectId: string | null
  readonly revisionId: string | null
  readonly configRevision: string | null
  readonly serverModel: {
    readonly standardNodeSets: 'disabled' | 'loaded' | 'faulted'
    readonly roboticsModel: 'disabled' | 'ready' | 'faulted'
    readonly productModel: 'disabled' | 'ready' | 'faulted'
    readonly activeSessionCount: number
    readonly maximumSessionCount: 16
    readonly lastError: string | null
  }
  readonly browserPublisher: {
    readonly phase: 'absent' | 'active' | 'expired'
    readonly publisherId: string | null
    readonly generation: number | null
    readonly expiresAt: number | null
  }
  readonly lastCommandResult: CommandResultV1 | null
}

export function createBrowserCommandDispatchV1(options: Readonly<{
  lease: BrowserPublisherLeaseManagerV1
  dedupe: RuntimeCommandDedupeRegistryV1
  send: (batch: CommandBatchV1) => Promise<CommandResultV1>
  publishResult: (result: CommandResultV1) => void
  nowMs: () => number
}>): BrowserCommandDispatchV1
```

Store staged values in `Map<sessionId, Map<targetId, Stage>>`; clear on Session close, successful snapshot, or 60-second staging timeout. Reject expiry at/before now or more than 60 seconds in the future. The lease TTL is 5 seconds and browser renewal interval is 2 seconds. Every acquisition/replacement increments generation. Revision replacement invalidates the old owner and every pending command.

Map a product snapshot to Runtime Protocol exactly: `CommandBatchV1.projectId = snapshot.projectId`, `configRevision = snapshot.configRevision`, `leaseGeneration = active browser lease generation`, and its one item uses `commandId = snapshot.requestId`, `expiresAt = snapshot.expiresAt`, `targetId = snapshot.targetId`, and `value = snapshot.payload`. Session ID is staging-isolation metadata only and never enters the Runtime command or dedupe fingerprint.

Use the exact `RuntimeCommandDedupeRegistryV1` instance created by M3 for the active Revision; do not create a Server-only registry. The Server-command key is `(projectId, configRevision, leaseGeneration, requestId)` and the channel is `server-command`. Fingerprint exactly `[projectId, configRevision, leaseGeneration, expiresAt, targetId, payload]`, explicitly excluding `sessionId`, so the same RequestId retried from a new OPC UA Session returns the retained result. The shared registry inserts the in-flight Promise before WebSocket dispatch. After all pre-dispatch checks pass and before calling `send`, publish `ACCEPTED/RUNNING` with null completion time to the product Result branch and integration diagnostics; publish the exact terminal `ACCEPTED/SUCCEEDED|FAILED` result after settlement. A pre-dispatch rejection publishes `REJECTED/FAILED` directly and never emits RUNNING. An identical duplicate joins/returns the same in-flight or terminal record and a different fingerprint returns `COMMAND_ID_CONFLICT`; Client-write plus Server-command terminal records never exceed 4,096 total.

Build and validate `RuntimeIntegrationDiagnosticsV1` from the active adapter/model handles, live Server Session count, browser lease manager, and retained last command result. Expose `GET /runtime/integration-diagnostics` with this exact closed JSON shape, a 64 KiB response cap, and no mutations. The same snapshot feeds product Diagnostics Variables so browser and OPC UA views cannot disagree. Off/Client-only mode reports disabled Server models and zero Sessions; Server/Bridge reports loaded/ready only after all model construction succeeds. Never append these fields to the closed `RuntimeGatewayStatusV1` contract.

The browser command owner validates stable IDs against `WorkcellProjectV5` and invokes only V5 Simulation ports. Object pose is committed once after complete RPY-to-quaternion conversion; Robot targets use exact Joint IDs; Signal/Job targets use existing M3 runtime services. Return terminal results through the same generation/revision fence.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-command-staging.test.ts middleware/runtime-gateway/browser-publisher-lease.test.ts middleware/runtime-gateway/browser-command-dispatch.test.ts middleware/runtime-gateway/integration-diagnostics.test.ts src/core/runtime-protocol/integration-diagnostics-v1.test.ts src/features/runtime-gateway/v5/runtime-gateway-command-owner.test.ts src/core/runtime-protocol/v1.test.ts middleware/runtime-gateway/main.test.ts src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts src/features/project/v5/browser-project-runtime-v5.test.ts
npm run build:gateway
npm run build
git add src/core/runtime-protocol/v1.ts src/core/runtime-protocol/v1.test.ts src/core/runtime-protocol/integration-diagnostics-v1.ts src/core/runtime-protocol/integration-diagnostics-v1.test.ts middleware/runtime-gateway/opcua-command-staging.ts middleware/runtime-gateway/opcua-command-staging.test.ts middleware/runtime-gateway/browser-publisher-lease.ts middleware/runtime-gateway/browser-publisher-lease.test.ts middleware/runtime-gateway/browser-command-dispatch.ts middleware/runtime-gateway/browser-command-dispatch.test.ts middleware/runtime-gateway/integration-diagnostics.ts middleware/runtime-gateway/integration-diagnostics.test.ts middleware/runtime-gateway/main.ts middleware/runtime-gateway/main.test.ts src/features/runtime-gateway/v5/runtime-gateway-command-owner.ts src/features/runtime-gateway/v5/runtime-gateway-command-owner.test.ts src/features/runtime-gateway/v5/runtime-gateway-state-stream.ts src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts src/features/project/v5/browser-project-runtime-v5.ts src/features/project/v5/browser-project-runtime-v5.test.ts
git diff --cached --check
git commit -m "feat: route staged opc ua commands"
```

### Task 6: Prove the Real Server Model and Complete the Milestone Gate

**Files:**
- Create: `middleware/runtime-gateway/opcua-server-model.integration.test.ts`
- Modify: `package.json`
- Modify: `middleware/README.md`

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: real OPC UA Client evidence without a conformance claim.

- [ ] **Step 1: Write the black-box integration suite**

Use ephemeral test ports and real node-opcua Sessions to assert:

```text
- Standard, DI, IA, Robotics Namespace URIs are present.
- 2-, 7-, and 16-Joint Projects expose exact Axis counts.
- Motion Devices, Axes, Controllers, Controls, and Power Trains use standard TypeDefinitions.
- Every product-created NodeId belongs to the model or instances namespace.
- Revolute Actual is degree; prismatic Actual is millimetre.
- A real Client reads revolute `EURange` unchanged and prismatic `EURange` converted from metres to millimetres.
- ActualPosition write returns BadNotWritable.
- Session A and Session B staged fields never mix.
- incomplete/expired/stale-generation commands fail without browser mutation.
- a deferred complete Object command is externally readable as Accepted/Running before its terminal Succeeded/Failed result.
- complete Object pose executes atomically and reports a terminal result.
- identical RequestId executes once; conflicting reuse fails.
- a seventeenth concurrent Session is rejected by the configured limit.
```

- [ ] **Step 2: Add the focused script**

```json
{
  "scripts": {
    "test:opcua-server-model": "vitest run middleware/runtime-gateway/opcua-nodeset-contract.test.ts middleware/runtime-gateway/opcua-robotics-projection.test.ts middleware/runtime-gateway/opcua-robotics-model.test.ts middleware/runtime-gateway/opcua-openweb-model.test.ts middleware/runtime-gateway/opcua-command-staging.test.ts middleware/runtime-gateway/browser-publisher-lease.test.ts middleware/runtime-gateway/browser-command-dispatch.test.ts middleware/runtime-gateway/integration-diagnostics.test.ts middleware/runtime-gateway/opcua-server-model.integration.test.ts src/core/runtime-protocol/integration-diagnostics-v1.test.ts src/features/runtime-gateway/v5/runtime-gateway-command-owner.test.ts"
  }
}
```

- [ ] **Step 3: Run focused and full gates**

```powershell
npm run test:opcua-server-model
npm run test:gateway
npm run test:run
npm run lint
npm run build:gateway
node dist-gateway/middleware/runtime-gateway/main.js --check-config
npm run build
git diff --check
```

Expected: every command exits 0; standard Actual remains read-only; all namespace/session/lease/dedupe assertions pass. Documentation says “Robotics-compatible mapping” and explicitly says conformance is not claimed.

- [ ] **Step 4: Commit integration evidence**

```powershell
git add package.json middleware/runtime-gateway/opcua-server-model.integration.test.ts middleware/README.md
git diff --cached --check
git commit -m "test: verify robotics opc ua exchange"
```

## Completion Checklist

- [ ] Official Standard, DI, IA, and Robotics v1.02 NodeSets load from the pinned package.
- [ ] Every Robot/independent linear device, Axis, Controller, Controls relation, and Power Train uses the standard model.
- [ ] Two-, seven-, and sixteen-Joint fixtures expose exact Axis counts.
- [ ] Revolute/prismatic Actuals publish degree/millimetre units and valid ranges.
- [ ] Standard Actual Position returns `BadNotWritable` on write.
- [ ] No product-created NodeId uses an OPC Foundation namespace.
- [ ] Product Actual contains Scene Objects, Signals, Jobs, and Attachments.
- [ ] Product Command stages Robot, Object, Signal, and Job requests per Session.
- [ ] Object XYZ/RPY commits atomically through the V5 Simulation boundary.
- [ ] Lease expiry, wrong Revision/generation, incomplete/expired request, and conflict fail deterministically.
- [ ] Identical duplicate RequestId executes once and returns the retained result.
- [ ] Client writes and Server commands share one active-Revision 4,096-record deduplication budget.
- [ ] Sixteen Sessions are accepted and a seventeenth is rejected.
- [ ] Focused/full tests, lint, Gateway build, config check, and browser build pass.
- [ ] Documentation makes no Robotics conformance, security, safety, or manufacturer-code claim.
