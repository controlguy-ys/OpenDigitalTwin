# Runtime Gateway Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed-six polling connector with a compiled Runtime Gateway Client that activates one to eight independent OPC UA Subscription workers, emits revisioned Mapping-ID state batches through a bounded latest-wins WebSocket, and renders Robot and Moving Frame state through deterministic two-cycle interpolation.

**Architecture:** Extend the dependency-free V4 Core with OPC UA budget, coherence, and interpolation algorithms, then keep `node-opcua` and sockets behind injected Gateway adapters. Each Endpoint Worker owns one Client/Session/Subscription lifecycle and sends complete Mapping groups to a supervisor; a state hub assigns Endpoint-local sequences and applies one-transmitting/one-pending backpressure per browser. The browser decodes the shared protocol into non-React runtime buffers sampled by the render loop, while Project Apply stages and atomically activates the matching Gateway Revision.

**Tech Stack:** TypeScript 6.0.3, node-opcua 2.175.0, ws 8.21.0, React 19.2.7, Zustand 5.0.14, Three.js 0.185.1, Vitest 4.1.10, Vite 8.1.4, Node 22.15.1, npm 11.4.2.

## Global Constraints

- Execute after P1 Project V4 Core Contracts, P2 Multi-Robot Runtime, and P3 Robot/Asset Authoring have landed.
- Use `WorkcellProjectV4`, `configRevisionForProjectV4`, and the envelopes in `src/core/runtime-protocol/v1.ts`; do not create parallel Project or wire types.
- Use OPC UA Subscriptions and MonitoredItems. Do not retain the current timer-driven `session.read()` connector.
- Enforce exactly 8/9 Endpoint, 128/129 Structure-root, 1,024/1,025 Leaf, depth 4/5, fixed-array 256/257, 10,240/10,241 leaf-update/second, and 256 KiB/plus-one state-Batch boundaries before activation or publication.
- The effective operation count is `min(applicationLimit, nonZeroServerAdvertisedLimit)`. Missing or zero advertised limits do not reduce the application limit.
- Default a Mapping publishing interval to 100 ms, reject faster than 50 ms/20 Hz, and charge every accepted interval proportionally against the global update-rate budget.
- One Endpoint failure must not restart, disconnect, resequence, or invalidate a healthy Endpoint Worker.
- Address runtime values by stable Mapping, Robot, Joint, Entity, and Frame IDs. Positional six-Joint arrays are invalid.
- A coherent Structure group is accepted atomically; one missing, non-finite, or BAD required Leaf retains the previous complete group and downgrades quality.
- Each browser socket owns one transmitting Batch and at most one newest pending Batch. A slow browser must not accumulate historical state.
- Browser interpolation is visualization-only, samples approximately two publishing cycles behind the latest accepted source timestamp, and never mutates canonical Project state.
- Use linear position/prismatic interpolation, shortest-path quaternion interpolation, wrapped/limited revolute interpolation, out-of-order Sequence rejection, and stale freeze.
- Do not cause a React or Zustand update for every incoming network Batch. Runtime buffers are mutable bounded stores read by the render loop.
- Do not add Legacy Adoption, a fixed-six compatibility adapter, authentication, certificates, physics, IK, or live PLC transfer.
- Keep comments in English, preserve unrelated user files, and never stage the external CAD directories.
- Every task ends with focused tests, lint/build where applicable, and one commit.

---

## File Structure

**Create:**

- `src/core/opcua-v4/mapping-budget.ts` and test - deterministic Mapping expansion and exact resource-budget validation.
- `src/core/opcua-v4/operation-chunking.ts` and test - application/server OperationLimit selection and stable chunking.
- `src/core/runtime-interpolation/v1.ts` and test - dependency-free Joint, position, quaternion, and staleness sampling.
- `middleware/runtime-gateway/runtime-gateway-host.ts` and test - shared HTTP/WebSocket listener that retains the P3 Asset routes.
- `middleware/runtime-gateway/runtime-gateway-service.ts` and test - process-level composition and orderly shutdown.
- `middleware/runtime-gateway/revision-manager.ts` and test - deterministic stage/activate/rollback of Gateway Revisions.
- `middleware/runtime-gateway/endpoint-adapter.ts` - injected `node-opcua` boundary.
- `middleware/runtime-gateway/endpoint-worker.ts` and test - one Endpoint Client/Session/Subscription lifecycle.
- `middleware/runtime-gateway/endpoint-supervisor.ts` and test - one-to-eight isolated workers.
- `middleware/runtime-gateway/state-batch-hub.ts` and test - revisioned batches and bounded latest-wins delivery.
- `middleware/runtime-gateway/client.integration.test.ts` - local OPC UA Server Subscription evidence.
- `src/features/runtime-gateway/runtime-gateway-url.ts` and test - same-origin WebSocket URL resolution.
- `src/features/runtime-gateway/RuntimeGatewayClient.ts` and test - typed browser socket and revision RPC.
- `src/features/runtime-gateway/runtime-state-buffer.ts` and test - bounded per-target sample storage.
- `src/features/runtime-gateway/runtime-state-controller.ts` and test - batch routing and quality/status aggregation.
- `src/features/runtime-gateway/RuntimeGatewayPanel.tsx` and test - mode, Revision, Endpoint, timestamp, and quality read model.

**Modify:**

- `src/core/project-v4/validate.ts`, `src/core/project-v4/validate.test.ts`, and `src/core/project-v4/index.ts`.
- `src/core/runtime-protocol/v1.ts` and `src/core/runtime-protocol/v1.test.ts`.
- `middleware/runtime-gateway/main.ts`, `middleware/runtime-gateway/deployment-config.ts`, and `middleware/runtime-gateway/deployment-config.test.ts`.
- `src/features/project/v4/project-v4-publication.ts` and `src/features/project/v4/project-v4-publication.test.ts`.
- `src/features/project/v4/browser-project-runtime-v4.ts` and `src/features/project/v4/browser-project-runtime-v4.test.ts`.
- `src/features/robot/v4/RobotInstanceModel.tsx`, `src/features/robot/v4/RobotInstanceModel.test.tsx`, `src/features/robot/v4/RobotFleet.tsx`, and `src/features/robot/v4/RobotFleet.test.tsx`.
- `src/features/scene/Workcell.tsx` and `src/features/scene/Workcell.test.tsx`.
- `src/app/App.tsx`, `src/app/AppShell.tsx`, and `src/app/AppShell.test.tsx`.
- `vite.config.ts` for the development/E2E `/runtime/ws` WebSocket proxy.
- `package.json` for Gateway scripts; no dependency change is required because `node-opcua` and `ws` are already pinned.

**Delete after the new Client integration gate is green:**

- `middleware/opcua-connector.mjs`
- `middleware/opcua-config.mjs`
- `middleware/opcua-config.test.ts`
- `middleware/opcua.config.json`

### Task 1: Add Deterministic Mapping Budgets and Operation Chunking

**Files:**
- Create: `src/core/opcua-v4/mapping-budget.ts`
- Test: `src/core/opcua-v4/mapping-budget.test.ts`
- Create: `src/core/opcua-v4/operation-chunking.ts`
- Test: `src/core/opcua-v4/operation-chunking.test.ts`
- Modify: `src/core/project-v4/validate.ts`
- Modify: `src/core/project-v4/index.ts`

**Interfaces:**
- Consumes: `OpcUaProjectConfigurationV4`, `ProjectV4Error`, and V4 OPC UA constants from P1.
- Produces: `expandOpcUaMappingsV4`, `validateOpcUaMappingBudgetV4`, `effectiveOperationLimitV1`, and `chunkStableV1` used by Browser validation and every Endpoint Worker.

- [ ] **Step 1: Write RED exact-limit and chunking tests**

```ts
it.each([
  ['endpoints', 8, 9, 'OPCUA_ENDPOINT_LIMIT_EXCEEDED'],
  ['roots', 128, 129, 'OPCUA_STRUCTURE_ROOT_LIMIT_EXCEEDED'],
  ['leaves', 1_024, 1_025, 'OPCUA_LEAF_LIMIT_EXCEEDED'],
  ['endpointLeaves', 512, 513, 'OPCUA_ENDPOINT_LEAF_LIMIT_EXCEEDED'],
  ['structureLeaves', 32, 33, 'OPCUA_STRUCTURE_LEAF_LIMIT_EXCEEDED'],
  ['depth', 4, 5, 'OPCUA_STRUCTURE_DEPTH_EXCEEDED'],
  ['fixedArray', 256, 257, 'OPCUA_FIXED_ARRAY_LIMIT_EXCEEDED'],
  ['updatesPerSecond', 10_240, 10_241, 'OPCUA_UPDATE_RATE_LIMIT_EXCEEDED'],
])('%s accepts %i and rejects %i', (dimension, exact, plusOne, code) => {
  expect(() => validateOpcUaMappingBudgetV4(mappingFixture(dimension, exact))).not.toThrow()
  expect(() => validateOpcUaMappingBudgetV4(mappingFixture(dimension, plusOne))).toThrow(code)
})

it.each([
  [128, undefined, 128],
  [128, 0, 128],
  [128, 32, 32],
  [128, 256, 128],
])('selects application %i and server %s as %i', (app, server, expected) => {
  expect(effectiveOperationLimitV1(app, server)).toBe(expected)
})

it('defaults to 100 ms and rejects a rate faster than 20 Hz', () => {
  expect(normalizePublishingIntervalMsV4(undefined)).toBe(100)
  expect(normalizePublishingIntervalMsV4(50)).toBe(50)
  expect(() => normalizePublishingIntervalMsV4(49)).toThrow('OPCUA_PUBLISHING_RATE_EXCEEDED')
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/core/opcua-v4
```

Expected: FAIL because the OPC UA Core modules do not exist.

- [ ] **Step 3: Implement stable expansion and exact budget reports**

```ts
export interface ExpandedOpcUaLeafV4 {
  readonly mappingId: string
  readonly endpointId: string
  readonly leafPath: readonly (string | number)[]
  readonly nodeId: string
  readonly projectTarget: OpcUaProjectTargetV4
  readonly publishingIntervalMs: number
  readonly required: boolean
  readonly coherenceGroupId: string | null
}

export interface OpcUaMappingBudgetReportV4 {
  readonly endpointCount: number
  readonly structureRootCount: number
  readonly expandedLeafCount: number
  readonly leafUpdatesPerSecond: number
  readonly endpointLeafCounts: Readonly<Record<string, number>>
  readonly leaves: readonly ExpandedOpcUaLeafV4[]
}

export function expandOpcUaMappingsV4(
  configuration: OpcUaProjectConfigurationV4,
): readonly ExpandedOpcUaLeafV4[]

export function validateOpcUaMappingBudgetV4(
  configuration: OpcUaProjectConfigurationV4,
): OpcUaMappingBudgetReportV4

export function effectiveOperationLimitV1(
  applicationLimit: number,
  serverAdvertisedLimit: number | undefined,
): number

export function chunkStableV1<T>(values: readonly T[], limit: number): readonly (readonly T[])[]
export function normalizePublishingIntervalMsV4(value: number | undefined): number
```

Deduplicate one upstream MonitoredItem only at the adapter layer; budget routed Leaves once per Project target. Reject dynamic arrays before expansion. Sort chunks by Endpoint ID, publishing interval, coherence group, Mapping ID, then Leaf path so Browser and Gateway produce identical reports.

- [ ] **Step 4: Wire the budget into Project validation and run GREEN**

```powershell
npm run test:run -- src/core/opcua-v4 src/core/project-v4
npm run lint
npm run build:gateway
npm run build
```

Expected: all exact-limit fixtures pass, every plus-one fixture fails with the named code, and both compiler targets consume the same Core source.

- [ ] **Step 5: Commit**

```powershell
git add src/core/opcua-v4 src/core/project-v4
git diff --cached --check
git commit -m "feat: validate opc ua mapping budgets"
```

### Task 2: Stage and Atomically Activate Client Revisions

**Files:**
- Create: `middleware/runtime-gateway/runtime-gateway-host.ts`
- Test: `middleware/runtime-gateway/runtime-gateway-host.test.ts`
- Create: `middleware/runtime-gateway/runtime-gateway-service.ts`
- Test: `middleware/runtime-gateway/runtime-gateway-service.test.ts`
- Create: `middleware/runtime-gateway/revision-manager.ts`
- Test: `middleware/runtime-gateway/revision-manager.test.ts`
- Modify: `middleware/runtime-gateway/main.ts`
- Modify: `src/core/runtime-protocol/v1.ts`
- Test: `src/core/runtime-protocol/v1.test.ts`

**Interfaces:**
- Consumes: P1 canonical `configRevision`, the P3 `AssetHttpRouterV1`, V4 validation, and the Mapping budget report.
- Produces: `RuntimeGatewayHostV1`, `RuntimeGatewayServiceV1`, `GatewayRevisionManagerV1`, `GatewayRevisionResourcesV1`, and WebSocket RPCs `revision-stage-v1`, `revision-activate-v1`, and `revision-rollback-v1`.

- [ ] **Step 1: Write RED activation and readiness tests**

```ts
// @vitest-environment node
it('keeps the prior revision active when candidate staging fails', async () => {
  const manager = createRevisionManager({ factory })
  await manager.stage(candidateA)
  await manager.activate(candidateA.configRevision)
  factory.stage.mockRejectedValueOnce(new Error('subscription rejected'))

  await expect(manager.stage(candidateB)).rejects.toThrow('subscription rejected')
  expect(manager.status()).toMatchObject({ activeRevision: candidateA.configRevision })
})

it('is live before Apply and ready after a valid Client revision activates', async () => {
  expect(await request('/healthz')).toMatchObject({ status: 200 })
  expect(await request('/readyz')).toMatchObject({ status: 503, body: { code: 'NO_ACTIVE_REVISION' } })
  await stageAndActivate(clientProject)
  expect(await request('/readyz')).toMatchObject({ status: 200, body: { mode: 'client' } })
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- middleware/runtime-gateway/runtime-gateway-host.test.ts middleware/runtime-gateway/runtime-gateway-service.test.ts middleware/runtime-gateway/revision-manager.test.ts src/core/runtime-protocol/v1.test.ts
```

Expected: FAIL because revision RPC and atomic activation do not exist.

- [ ] **Step 3: Implement staged capabilities and one active pointer**

```ts
export interface RuntimeGatewayHostV1 {
  registerHttpHandler(handler: RuntimeGatewayHttpHandlerV1): () => void
  registerWebSocketHandler(path: string, handler: RuntimeGatewayWebSocketHandlerV1): () => void
  listen(): Promise<{ readonly host: string; readonly port: number }>
  close(): Promise<void>
}

export interface RuntimeGatewayServiceV1 {
  start(): Promise<void>
  stop(): Promise<void>
  status(): GatewayRuntimeStatusV1
}

export interface GatewayRevisionResourcesV1 {
  readonly projectId: string
  readonly configRevision: string
  readonly mode: GatewayModeV1
  start(): Promise<void>
  stop(): Promise<void>
}

export interface StagedGatewayRevisionV1 {
  readonly stageToken: string
  readonly projectId: string
  readonly configRevision: string
  readonly resources: GatewayRevisionResourcesV1
}

export interface GatewayRevisionManagerV1 {
  stage(project: WorkcellProjectV4): Promise<StagedGatewayRevisionV1>
  activate(stageToken: string): Promise<GatewayRevisionStatusV1>
  rollback(stageToken: string): Promise<void>
  status(): GatewayRevisionStatusV1
  close(): Promise<void>
}
```

Refactor the P3 process listener behind `RuntimeGatewayHostV1`, preserve its Asset handlers in registration order, and add one exact `/runtime/ws` upgrade handler without creating a second HTTP listener. Hash and validate the candidate again inside the Gateway. Stage resources without publishing them, start the candidate before swapping the active pointer, and stop the prior resources only after the swap. On any failure, stop the candidate and retain the prior pointer/resources. Permit a valid offline Endpoint to activate as `CONNECTING` or `DEGRADED`.

- [ ] **Step 4: Run failure-injection GREEN**

```powershell
npm run test:run -- middleware/runtime-gateway/runtime-gateway-host.test.ts middleware/runtime-gateway/runtime-gateway-service.test.ts middleware/runtime-gateway/revision-manager.test.ts src/core/runtime-protocol/v1.test.ts
npm run build:gateway
```

Expected: stage, start, swap, prior-stop, rollback, duplicate-token, and stale-token cases pass without leaking resources.

- [ ] **Step 5: Commit**

```powershell
git add middleware/runtime-gateway src/core/runtime-protocol
git diff --cached --check
git commit -m "feat: activate runtime gateway revisions"
```

### Task 3: Implement One Subscription Endpoint Worker

**Files:**
- Create: `middleware/runtime-gateway/endpoint-adapter.ts`
- Create: `middleware/runtime-gateway/endpoint-worker.ts`
- Test: `middleware/runtime-gateway/endpoint-worker.test.ts`
- Create: `middleware/runtime-gateway/test-support/opcua-test-server.ts`
- Create: `middleware/runtime-gateway/client.integration.test.ts`

**Interfaces:**
- Consumes: expanded Leaves, stable chunking, `node-opcua`, and `RuntimeMappedValueV1`.
- Produces: `OpcUaEndpointAdapterV1`, `EndpointWorkerV1`, Endpoint diagnostics, and complete accepted Mapping groups.

- [ ] **Step 1: Write RED adapter-level lifecycle and coherence tests**

```ts
// @vitest-environment node
it('uses a Subscription and emits one complete coherent group', async () => {
  const adapter = new FakeEndpointAdapter({ operationLimits: { maxMonitoredItemsPerCall: 2 } })
  const worker = createEndpointWorker(endpointFixture(), adapter, accepted)
  await worker.start()
  expect(adapter.createdSubscriptions).toHaveLength(1)
  expect(adapter.monitoredItemChunks.map((chunk) => chunk.length)).toEqual([2, 2, 1])

  adapter.change('pose.x', 1, 'Good', 100)
  adapter.change('pose.y', 2, 'Good', 100)
  expect(accepted).not.toHaveBeenCalled()
  adapter.change('pose.z', 3, 'Good', 100)
  expect(accepted).toHaveBeenCalledWith(expect.objectContaining({ complete: true }))
})

it('retains the previous complete group when one required Leaf is BAD', () => {
  worker.accept(previousCompleteGroup)
  adapter.change('pose.x', 9, 'BadCommunicationError', 200)
  adapter.change('pose.y', 8, 'Good', 200)
  adapter.change('pose.z', 7, 'Good', 200)
  expect(worker.snapshot('pose')).toEqual(expect.objectContaining({ values: previousCompleteGroup.values, quality: 'BAD' }))
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- middleware/runtime-gateway/endpoint-worker.test.ts middleware/runtime-gateway/client.integration.test.ts
```

Expected: FAIL because no Subscription worker exists.

- [ ] **Step 3: Implement the injected node-opcua boundary**

```ts
export interface OpcUaEndpointAdapterV1 {
  connect(endpoint: OpcUaEndpointV4): Promise<void>
  readOperationLimits(): Promise<OpcUaOperationLimitsV1>
  createSubscription(options: SubscriptionOptionsV1): Promise<string>
  monitor(
    subscriptionId: string,
    leaves: readonly ExpandedOpcUaLeafV4[],
    onChange: (change: MonitoredLeafChangeV1) => void,
  ): Promise<void>
  write(values: readonly OpcUaWriteValueV1[]): Promise<readonly OpcUaWriteResultV1[]>
  close(): Promise<void>
}

export interface EndpointWorkerV1 {
  start(): Promise<void>
  stop(): Promise<void>
  write(values: readonly OpcUaWriteValueV1[]): Promise<readonly OpcUaWriteResultV1[]>
  diagnostics(): EndpointDiagnosticsV1
}
```

The production adapter must use `OPCUAClient`, `ClientSubscription`, and grouped MonitoredItems with source timestamps and StatusCodes. It must not call a periodic full `session.read()`. Deduplicate identical upstream Node IDs within one Endpoint, route values to every target Mapping, and chunk create/write operations with the effective limits.

- [ ] **Step 4: Prove the real Subscription path**

Start the test Server on an ephemeral port, expose scalar and coherent Structure fixtures, mutate Variables, and assert quality, source timestamp, Mapping ID, and reconnect behavior through the production adapter.

```powershell
npm run test:run -- middleware/runtime-gateway/endpoint-worker.test.ts middleware/runtime-gateway/client.integration.test.ts
npm run lint
npm run build:gateway
```

Expected: unit and real `node-opcua` Subscription tests pass; no polling timer appears in `endpoint-worker.ts`.

- [ ] **Step 5: Commit**

```powershell
git add middleware/runtime-gateway
git diff --cached --check
git commit -m "feat: subscribe to opc ua endpoint state"
```

### Task 4: Supervise Eight Independent Endpoint Workers

**Files:**
- Create: `middleware/runtime-gateway/endpoint-supervisor.ts`
- Test: `middleware/runtime-gateway/endpoint-supervisor.test.ts`
- Modify: `middleware/runtime-gateway/revision-manager.ts`
- Modify: `middleware/runtime-gateway/revision-manager.test.ts`

**Interfaces:**
- Consumes: `EndpointWorkerV1` and the validated one-to-eight Endpoint configuration.
- Produces: `EndpointSupervisorV1`, Endpoint-local sequence ownership, isolated reconnect, and aggregated diagnostics.

- [ ] **Step 1: Write RED eight-worker isolation tests**

```ts
it('runs eight workers and keeps seven healthy when one reconnects', async () => {
  const workers = eightFakeWorkers()
  const supervisor = createEndpointSupervisor(workers)
  await supervisor.start()
  workers[3].disconnect('BadConnectionClosed')

  for (const index of [0, 1, 2, 4, 5, 6, 7]) workers[index].emit(valueFor(index))
  expect(supervisor.diagnostics().filter((item) => item.state === 'CONNECTED')).toHaveLength(7)
  expect(acceptedEndpointIds()).toEqual(['ep-0', 'ep-1', 'ep-2', 'ep-4', 'ep-5', 'ep-6', 'ep-7'])
  expect(workers.filter((worker) => worker.reconnectCount === 1)).toEqual([workers[3]])
})

it('does not share sequence counters across Endpoints', () => {
  epA.emit(valueA)
  epB.emit(valueB)
  epA.emit(valueA2)
  expect(sequences()).toEqual([['ep-a', 1], ['ep-b', 1], ['ep-a', 2]])
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- middleware/runtime-gateway/endpoint-supervisor.test.ts
```

Expected: FAIL because only an individual worker exists.

- [ ] **Step 3: Implement isolated worker ownership**

```ts
export interface EndpointSupervisorV1 {
  start(): Promise<void>
  stop(): Promise<void>
  write(endpointId: string, values: readonly OpcUaWriteValueV1[]): Promise<readonly OpcUaWriteResultV1[]>
  diagnostics(): readonly EndpointDiagnosticsV1[]
}
```

Use one worker and reconnect state machine per Endpoint ID. A worker failure updates only its diagnostics. `start()` stages every valid worker and resolves after each is either connected or in its allowed `CONNECTING/DEGRADED` state. `stop()` awaits every worker and aggregates shutdown errors without abandoning remaining workers.

- [ ] **Step 4: Run GREEN and activate through the Revision manager**

```powershell
npm run test:run -- middleware/runtime-gateway/endpoint-supervisor.test.ts middleware/runtime-gateway/revision-manager.test.ts
npm run build:gateway
```

Expected: 8 workers pass, a 9th is rejected by Core validation, and one failure leaves seven streams and writes operational.

- [ ] **Step 5: Commit**

```powershell
git add middleware/runtime-gateway
git diff --cached --check
git commit -m "feat: isolate opc ua endpoint workers"
```

### Task 5: Add Revisioned State Batches and Latest-Wins Backpressure

**Files:**
- Create: `middleware/runtime-gateway/state-batch-hub.ts`
- Test: `middleware/runtime-gateway/state-batch-hub.test.ts`
- Modify: `middleware/runtime-gateway/runtime-gateway-service.ts`
- Modify: `src/core/runtime-protocol/v1.ts`
- Test: `src/core/runtime-protocol/v1.test.ts`

**Interfaces:**
- Consumes: complete worker groups and `StateBatchV1` validation.
- Produces: `splitStateBatchesV1`, `StateBatchHubV1`, and the `/runtime/ws` `state-batch-v1` stream with at most 128 values and 256 KiB per Batch plus one transmitting and one newest pending Batch per socket.

- [ ] **Step 1: Write RED slow-socket and stale-revision tests**

```ts
it('keeps only the newest pending Batch while a send is in flight', () => {
  const socket = new ControlledSocket()
  hub.attach(socket)
  hub.publish(batch(1))
  hub.publish(batch(2))
  hub.publish(batch(3))
  expect(socket.sentSequences()).toEqual([1])
  socket.completeSend()
  expect(socket.sentSequences()).toEqual([1, 3])
  expect(hub.queueDepth(socket)).toBeLessThanOrEqual(2)
})

it('drops values from a no-longer-active Revision', () => {
  hub.activateRevision('revision-b')
  hub.publish(batchFor('revision-a', 9))
  expect(socket.sentSequences()).toEqual([])
})

it('splits at 128 values and rejects one value larger than 256 KiB', () => {
  expect(splitStateBatchesV1(batchWithValueCount(129)).map((batch) => batch.values.length)).toEqual([128, 1])
  expect(() => splitStateBatchesV1(batchWithOneEncodedValue(256 * 1024 + 1)))
    .toThrow('RUNTIME_STATE_BATCH_SIZE_EXCEEDED')
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- middleware/runtime-gateway/state-batch-hub.test.ts
```

Expected: FAIL because the current connector broadcasts without bounded pending state.

- [ ] **Step 3: Implement the bounded hub**

```ts
export interface StateBatchHubV1 {
  attach(socket: GatewayWebSocketV1): () => void
  activateRevision(projectId: string, configRevision: string): void
  publish(batch: StateBatchV1): void
  close(): Promise<void>
}

export function splitStateBatchesV1(batch: StateBatchV1): readonly StateBatchV1[]
```

Keep every coherence group intact, split between groups at 128 values or before the encoded envelope would exceed 256 KiB, and reject one group that cannot fit. Serialize once per published Batch. Mark a socket transmitting until its `send` callback completes; replace its single pending reference on every newer Batch. On send failure, detach and release both references. Never append to an array or retain a Batch after every socket has either sent or replaced it.

- [ ] **Step 4: Run GREEN and bounded-load test**

```powershell
npm run test:run -- middleware/runtime-gateway/state-batch-hub.test.ts src/core/runtime-protocol/v1.test.ts
npm run build:gateway
```

Expected: 100,000 publications to a blocked fake socket leave queue depth 2 and deliver only first plus newest sequence.

- [ ] **Step 5: Commit**

```powershell
git add middleware/runtime-gateway src/core/runtime-protocol
git diff --cached --check
git commit -m "feat: bound runtime state transport"
```

### Task 6: Add Browser Runtime Buffers and Deterministic Interpolation

**Files:**
- Create: `src/core/runtime-interpolation/v1.ts`
- Test: `src/core/runtime-interpolation/v1.test.ts`
- Create: `src/features/runtime-gateway/runtime-state-buffer.ts`
- Test: `src/features/runtime-gateway/runtime-state-buffer.test.ts`
- Create: `src/features/runtime-gateway/runtime-state-controller.ts`
- Test: `src/features/runtime-gateway/runtime-state-controller.test.ts`
- Modify: `src/core/project-v4/index.ts`

**Interfaces:**
- Consumes: `RigidTransformV4`, keyed Joint metadata, `StateBatchV1`.
- Produces: `interpolateRuntimeValueV1`, `RuntimeStateBufferV1`, and `RuntimeStateControllerV1` sampled without React updates.

- [ ] **Step 1: Write RED interpolation and buffer tests**

```ts
it('uses the shortest quaternion path', () => {
  const before = quaternionFromRpy([0, 0, 170])
  const after = quaternionFromRpy([0, 0, -170])
  expect(quaternionToRpy(interpolateQuaternionShortestV1(before, after, 0.5))[2]).toBeCloseTo(180, 6)
})

it('wraps a revolute Joint and linearly interpolates a prismatic Joint', () => {
  expect(interpolateJointV1({ type: 'revolute', min: -180, max: 180 }, 170, -170, 0.5)).toBeCloseTo(180)
  expect(interpolateJointV1({ type: 'prismatic', min: 0, max: 2 }, 0.2, 1.2, 0.5)).toBeCloseTo(0.7)
})

it('drops old sequences and freezes stale state', () => {
  const buffer = createRuntimeStateBuffer({ capacity: 32, staleAfterMs: 500 })
  expect(buffer.accept(sample({ sequence: 2, sourceTimestampMs: 200 }))).toBe(true)
  expect(buffer.accept(sample({ sequence: 1, sourceTimestampMs: 100 }))).toBe(false)
  expect(buffer.sample(800)).toMatchObject({ quality: 'STALE', frozen: true })
  expect(buffer.size()).toBeLessThanOrEqual(32)
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/core/runtime-interpolation src/features/runtime-gateway/runtime-state-buffer.test.ts
```

Expected: FAIL because the fixed-six keyframe helper is not a general runtime interpolator.

- [ ] **Step 3: Implement pure interpolation and bounded keyed buffers**

```ts
export interface RuntimeInterpolationPolicyV1 {
  readonly publishingIntervalMs: number
  readonly delayCycles: 2
  readonly staleAfterMs: number
}

export interface RuntimeStateBufferV1<T> {
  accept(sample: RuntimeSampleV1<T>): boolean
  sample(renderTimestampMs: number): InterpolatedRuntimeSampleV1<T> | null
  latestRaw(): RuntimeSampleV1<T> | null
  clear(): void
  size(): number
}

export interface RuntimeStateControllerV1 {
  accept(batch: StateBatchV1): void
  sampleRobot(robotId: string, renderTimestampMs: number): RobotRuntimeSampleV1 | null
  sampleMovingFrame(entityId: string, frameId: string, renderTimestampMs: number): FrameRuntimeSampleV1 | null
  endpointStatus(): readonly EndpointRuntimeStatusV1[]
  clearRevision(configRevision: string): void
}
```

Use 32 samples per keyed channel. Sample at `latestAcceptedSourceTimestamp - 2 * publishingIntervalMs`; bracket that timestamp, clamp interpolation ratio, and freeze the latest complete value after `max(500, 5 * publishingIntervalMs)` without a fresh sample. Keep `latestRaw()` separate for diagnostics and future Server publication.

- [ ] **Step 4: Run GREEN and dependency scan**

```powershell
npm run test:run -- src/core/runtime-interpolation src/features/runtime-gateway
rg -n "from ['\"](react|three|node:|ws|node-opcua)|window|document" src/core/runtime-interpolation
npm run lint
npm run build
```

Expected: tests pass, the Core dependency scan returns no matches, and 100,000 accepted samples leave each keyed buffer at 32 entries.

- [ ] **Step 5: Commit**

```powershell
git add src/core/runtime-interpolation src/features/runtime-gateway/runtime-state-buffer* src/features/runtime-gateway/runtime-state-controller* src/core/project-v4/index.ts
git diff --cached --check
git commit -m "feat: interpolate keyed runtime state"
```

### Task 7: Integrate the Browser Client with Atomic Project Publication

**Files:**
- Create: `src/features/runtime-gateway/runtime-gateway-url.ts`
- Test: `src/features/runtime-gateway/runtime-gateway-url.test.ts`
- Create: `src/features/runtime-gateway/RuntimeGatewayClient.ts`
- Test: `src/features/runtime-gateway/RuntimeGatewayClient.test.ts`
- Modify: `src/features/project/v4/project-v4-publication.ts`
- Modify: `src/features/project/v4/project-v4-publication.test.ts`
- Modify: `src/features/project/v4/browser-project-runtime-v4.ts`
- Modify: `src/features/project/v4/browser-project-runtime-v4.test.ts`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: revision RPC, state envelopes, `ProjectRuntimeV4`, and the runtime state controller.
- Produces: `RuntimeGatewayClientV1` and a Browser Project runtime that stages remotely before apply and rolls back both local and Gateway resources on failure.

- [ ] **Step 1: Write RED socket and publication compensation tests**

```ts
it('resolves the production socket from the page origin', () => {
  expect(resolveRuntimeGatewayUrl(undefined, { protocol: 'https:', host: 'cell.local' }))
    .toBe('wss://cell.local/runtime/ws')
})

it('preserves the old local and Gateway revisions when remote activation fails', async () => {
  gateway.stageRevision.mockResolvedValue(stagedB)
  gateway.activateRevision.mockRejectedValue(new Error('activate failed'))
  await expect(coordinator.replace({
    candidate: projectB,
    expectedRevisionId: projectA.revisionId,
  })).rejects.toThrow('activate failed')
  expect(coordinator.readPublished()?.project.revisionId).toBe('revision-a')
  expect(gateway.rollbackRevision).toHaveBeenCalledWith(stagedB.stageToken)
  expect(localRuntime.activeRevision()).toBe('revision-a')
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/runtime-gateway/RuntimeGatewayClient.test.ts src/features/project/v4
```

Expected: FAIL because P2 has removed the fixed source, but no `RuntimeGatewayClient` or asynchronous Gateway publication path exists yet.

- [ ] **Step 3: Implement typed request/response correlation**

```ts
export interface RuntimeGatewayClientV1 {
  connect(): Promise<void>
  disconnect(): Promise<void>
  stageRevision(project: WorkcellProjectV4): Promise<StagedGatewayRevisionResponseV1>
  activateRevision(stageToken: string): Promise<GatewayRevisionStatusV1>
  rollbackRevision(stageToken: string): Promise<void>
  subscribeState(listener: (batch: StateBatchV1) => void): () => void
  subscribeStatus(listener: (status: GatewayRuntimeStatusV1) => void): () => void
}
```

Allocate a unique request ID for every RPC, resolve it only with the matching validated response, reject all pending calls on disconnect, reconnect with one bounded timer, and drop state with an inactive Project ID or config Revision. Extend P3's Vite development/E2E proxy with `/runtime/ws -> ws://127.0.0.1:8081/runtime/ws` and `ws: true`; production keeps the same URL and is wired by P5 Nginx.

- [ ] **Step 4: Extend the existing async `ProjectRuntimeV4.apply` transaction**

Keep P1's async `ProjectRuntimeV4` and `AppliedProjectRuntimePublicationV4` signatures unchanged. Extend the prepared browser bundle with the Gateway stage token. `apply()` activates Gateway and local resources, then returns the existing async `commit/rollback/cleanup` publication. The coordinator continues to await each phase. Test failures at remote stage, local preparation, remote activation, local apply, repository finalization, commit, rollback, and cleanup.

```powershell
npm run test:run -- src/features/runtime-gateway src/features/project/v4
npm run lint
npm run build
```

Expected: every failure preserves one authoritative old Revision or enters the existing explicit recovery-required state; no split-brain published Revision is reported as ready.

- [ ] **Step 5: Commit**

```powershell
git add src/features/runtime-gateway src/features/project/v4 vite.config.ts
git diff --cached --check
git commit -m "feat: publish project revisions to gateway"
```

### Task 8: Render Keyed Runtime State and Remove the Fixed Connector

**Files:**
- Create: `src/features/runtime-gateway/RuntimeGatewayPanel.tsx`
- Test: `src/features/runtime-gateway/RuntimeGatewayPanel.test.tsx`
- Modify: `src/features/robot/v4/RobotInstanceModel.tsx`
- Test: `src/features/robot/v4/RobotInstanceModel.test.tsx`
- Modify: `src/features/robot/v4/RobotFleet.tsx`
- Modify: `src/features/scene/Workcell.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.test.tsx`
- Modify: `package.json`
- Delete: the fixed middleware connector/config files listed in File Structure.

**Interfaces:**
- Consumes: `RuntimeStateControllerV1`, P2 keyed Robot runtime, and Gateway status.
- Produces: render-loop sampling, per-Robot/Endpoint operator diagnostics, and no remaining fixed-six Client path.

- [ ] **Step 1: Write RED UI and render-isolation tests**

```tsx
it('shows Endpoint state without a global Joint Source selector', () => {
  render(<RuntimeGatewayPanel status={statusWithEightEndpoints()} />)
  expect(screen.getByText('CLIENT')).toBeVisible()
  expect(screen.getByText('revision-b')).toBeVisible()
  expect(screen.getAllByTestId('endpoint-status')).toHaveLength(8)
  expect(screen.queryByRole('combobox', { name: /joint source/i })).not.toBeInTheDocument()
})

it('updates only the Robot addressed by stable IDs', () => {
  controller.accept(batchForJoint('robot-a', 'j1', 20))
  expect(controller.sampleRobot('robot-a', renderTimestamp())?.jointValues.j1).toBe(20)
  expect(controller.sampleRobot('robot-b', renderTimestamp())).toBeNull()
  expect(runtimeRegistry.setState).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/runtime-gateway src/features/robot/v4/RobotInstanceModel.test.tsx src/app/AppShell.test.tsx
```

Expected: FAIL because P2 rendering is not connected to `RuntimeStateControllerV1` and the shell has no Gateway diagnostics panel.

- [ ] **Step 3: Integrate render-loop sampling and status UI**

Add a render-only keyed pose override to `RobotInstanceModelPropsV4` and call `runtimeStateController.sampleRobot(robotId, clock.now())` from the existing frame loop only when that Robot's configured ownership is `opcua:<endpointId>`. Apply the returned Joint values to that Robot Instance's link transforms without writing the Zustand Robot registry. Sample OPC UA Moving Frames by `(entityId, frameId)` through the same render projection. Simulation-owned Robots continue to use P2 registry values. Publish status UI changes at a throttled 4 Hz and on discrete connection/quality transitions; do not subscribe React or Zustand to every state Batch.

- [ ] **Step 4: Remove the old connector without a compatibility layer**

Delete the old `.mjs` polling connector and fixed config/test. P2 has already removed `OpcUaJointSource` and its URL helper at the V4 browser cutover. Replace `middleware:opcua` with:

```json
{
  "runtime:gateway": "node dist-gateway/middleware/runtime-gateway/main.js",
  "test:gateway:client": "vitest run src/core/opcua-v4 src/core/runtime-interpolation src/features/runtime-gateway middleware/runtime-gateway"
}
```

Do not edit Compose/Nginx yet; P5 owns the deployment cutover after Server/Bridge are present.

- [ ] **Step 5: Run the P4 gate**

```powershell
npm run test:gateway:client
npm run lint
npm run build:gateway
npm run build
rg -n "OpcUaJointSource|opcua-connector|anglesDeg.{0,20}\[" src middleware package.json
```

Expected: tests and builds pass; `rg` returns no fixed connector or positional six-Joint runtime path.

- [ ] **Step 6: Commit**

```powershell
git add src middleware package.json
git diff --cached --check
git commit -m "feat: cut over to runtime gateway client"
```

### Task 9: Prove the Eight-Endpoint Client Exit Gate

**Files:**
- Modify: `middleware/runtime-gateway/client.integration.test.ts`
- Create: `middleware/runtime-gateway/client-load.test.ts`
- Modify: `docs/superpowers/plans/2026-07-16-runtime-gateway-client.md`

**Interfaces:**
- Produces: the independently testable P4 exit required by P5.

- [ ] **Step 1: Add the final real-client fixture**

Start eight local OPC UA Servers on ephemeral ports. Each exposes one Robot or Moving Frame target, source timestamps, one coherent Structure, and one writable scalar. Apply one Client Revision, disconnect Endpoint 4, update/read/write the other seven, reconnect Endpoint 4, and assert its sequence resumes only in that Endpoint's stream.

- [ ] **Step 2: Add the bounded state-load assertion**

Feed 10,240 mapped Leaf updates/second for 60 seconds under fake time, hold one WebSocket send callback, and assert queue depth 2, per-channel Browser buffer size 32, no out-of-order mutation, and processing p95 measurement output. The 15-minute release performance gate remains owned by P8.

- [ ] **Step 3: Run the complete P4 gate**

```powershell
npm run test:gateway:client
npm run test:run -- middleware/runtime-gateway/client.integration.test.ts middleware/runtime-gateway/client-load.test.ts
npm run lint
npm run build:gateway
npm run build
git status --short
```

Expected: eight Endpoints subscribe concurrently; one failure does not stop seven; latest-wins and interpolation buffers remain bounded; only intentional plan evidence and unrelated CAD directories remain.

- [ ] **Step 4: Record evidence and commit**

Record exact test counts and p95 measurements in this plan, then:

```powershell
git add middleware/runtime-gateway/client.integration.test.ts middleware/runtime-gateway/client-load.test.ts docs/superpowers/plans/2026-07-16-runtime-gateway-client.md
git diff --cached --check
git commit -m "test: prove runtime gateway client isolation"
```
