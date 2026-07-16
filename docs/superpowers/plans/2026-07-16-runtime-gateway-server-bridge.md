# Runtime Gateway Server and Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the P4 Runtime Gateway with a fenced Simulation publisher Lease, an OPC UA Server that separates Actual state from staged Commands and terminal Results, bounded Session-local command deduplication, declared no-echo Bridge routes, and production Docker wiring for Off, Client, Server, and Bridge modes.

**Architecture:** Keep protocol validation, Bridge-cycle analysis, and command identity rules in the dependency-free Core. The Gateway owns a single Lease manager per active Project/Revision, a dynamic `node-opcua` namespace built during Revision staging, Session-scoped field staging, and a global bounded command registry keyed by Revision/Lease/Binding/Command. Server commands are forwarded only to the current browser publisher and results are fenced by Lease generation; Bridge routes reuse accepted raw state and command channels but reject cycles before activation and suppress echo by `(originId, sequence)`.

**Tech Stack:** TypeScript 6.0.3, node-opcua 2.175.0, ws 8.21.0, React 19.2.7, Vitest 4.1.10, Vite 8.1.4, Node 22.15.1, npm 11.4.2, Docker Compose, Nginx.

## Global Constraints

- Execute after P4 Runtime Gateway Client has landed and keep its Project Revision, Endpoint Worker, state Batch, and latest-wins interfaces unchanged unless this plan explicitly extends them.
- Gateway mode is canonical Project configuration: `off`, `client`, `server`, or `bridge`. Deployment environment contains ports and logical Asset mounts, not the active Project mode or Mapping graph.
- `RuntimePublisherLeaseV1` is owned and exported only by P1 `src/core/runtime-protocol/v1.ts`. P5 imports and consumes that shared type; it must not redeclare, shadow, or fork it.
- `RuntimeActionCommandOwnerPortV1` is owned and exported only by P5 `src/features/runtime-gateway/runtime-action-command-owner-port.ts`; P7 imports that port and supplies only its adapter/handler.
- Anonymous OPC UA with SecurityPolicy None is the only short-term profile. Document that it is not production-hardened; do not add credentials, certificates, or authorization in this phase.
- Only one `RuntimePublisherLease` may own one Project/config Revision. Reject every state publish, command result, or upstream write carrying an old generation.
- Lease state is runtime-only and never enters Project JSON, XML, XLSX, save, or revision hashing.
- Server Actual and Command nodes are distinct. A command Variable is never also treated as accepted Actual state.
- Robot remains a dedicated namespace. Generic non-Robot equipment exposes named XYZRPY Moving Frames and numeric Status only.
- Command staging is isolated by OPC UA Session plus Mapping/Action Binding ID. Another Session cannot contribute Command ID, expiry, Value, or Trigger state.
- Only a Boolean `false -> true` Trigger snapshots a complete same-Session staging record. Value writes alone have no runtime effect.
- An external command expiry may be no more than 60 seconds after the Trigger snapshot. A terminal dedup record remains for five minutes; a RUNNING record is never pruned.
- The deduplication key is `(projectId, configRevision, leaseGeneration, targetId, commandId)`, where `targetId` is one configured Mapping or Action Binding ID. Exactly 4,096 active records pass; a 4,097th fails without eviction.
- Identical replay returns the stored acknowledgement and terminal result without execution. Changed immutable payload or expiry fails `COMMAND_ID_CONFLICT`.
- Support exactly 16 concurrent OPC UA Server Client Sessions; a 17th is rejected without disturbing the first 16.
- Acknowledgement `ACCEPTED` means validated and enqueued. Execution `SUCCEEDED` means the Lease owner completed the full command or Job.
- Bridge forwards only declared routes. Reject static cycles before activation and block runtime echo with `originId + sequence`.
- Server publishes the latest accepted raw state. It must not publish browser-interpolated visualization samples.
- Standard Compose starts Web and Runtime Gateway. Gateway liveness uses `/healthz`; readiness may remain false before Project Apply or required Lease acquisition.
- Keep the Gateway at 1 CPU and 512 MiB, keep its root filesystem read-only, and mount external Assets read-only.
- Do not add Legacy connector services, physics, IK, coordinated Robot barriers, or live PLC transfer.
- Keep comments in English, preserve unrelated user changes, and never stage external CAD directories.
- Every task ends with focused tests, lint/build where applicable, and one commit.

---

## File Structure

**Create:**

- `src/core/opcua-v4/bridge-routes.ts` and test - static route validation and cycle detection.
- `src/core/opcua-v4/command-identity.ts` and test - immutable command snapshot and dedup key construction.
- `middleware/runtime-gateway/lease-manager.ts` and test - publisher ownership, renewal, expiry, and generation fencing.
- `middleware/runtime-gateway/opcua-server-adapter.ts` - injected `node-opcua` Server boundary.
- `middleware/runtime-gateway/opcua-server-namespace.ts` and test - Actual/Command/Result/Diagnostics node construction.
- `middleware/runtime-gateway/opcua-command-staging.ts` and test - Session-local staged fields and rising-edge snapshots.
- `middleware/runtime-gateway/command-registry.ts` and test - bounded deduplication and terminal-result retention.
- `middleware/runtime-gateway/command-dispatcher.ts` and test - Lease-owner forwarding and result fencing.
- `middleware/runtime-gateway/bridge-router.ts` and test - declared route forwarding without echo.
- `middleware/runtime-gateway/server.integration.test.ts` - real OPC UA Server namespace/read evidence.
- `middleware/runtime-gateway/command.integration.test.ts` - two-Session, 16/17 Session, and browser-owner command evidence.
- `middleware/runtime-gateway/bridge.integration.test.ts` - Client/Server forwarding evidence.
- `src/features/runtime-gateway/runtime-publisher-controller.ts` and test - Lease acquisition/renewal and raw Simulation publication.
- `src/features/runtime-gateway/runtime-command-executor-port.ts` and test - one command execution boundary consumed by P7.
- `src/features/runtime-gateway/runtime-action-command-owner-port.ts` and test - one registered browser handler seam consumed by P7.
- `scripts/deployment/runtime-gateway-smoke-client.mjs` - Project Apply, Lease, OPC UA read/write, and mode-smoke helper.

**Modify:**

- `src/core/runtime-protocol/v1.ts` and `src/core/runtime-protocol/v1.test.ts`.
- `src/core/project-v4/types.ts`, `src/core/project-v4/validate.ts`, and `src/core/project-v4/validate.test.ts`.
- `middleware/runtime-gateway/revision-manager.ts`, `middleware/runtime-gateway/revision-manager.test.ts`, `middleware/runtime-gateway/runtime-gateway-service.ts`, `middleware/runtime-gateway/runtime-gateway-service.test.ts`, `middleware/runtime-gateway/runtime-gateway-host.ts`, `middleware/runtime-gateway/runtime-gateway-host.test.ts`, `middleware/runtime-gateway/state-batch-hub.ts`, and `middleware/runtime-gateway/state-batch-hub.test.ts`.
- `src/features/runtime-gateway/RuntimeGatewayClient.ts`, `src/features/runtime-gateway/RuntimeGatewayClient.test.ts`, `src/features/runtime-gateway/runtime-state-controller.ts`, `src/features/runtime-gateway/runtime-state-controller.test.ts`, `src/features/runtime-gateway/RuntimeGatewayPanel.tsx`, and `src/features/runtime-gateway/RuntimeGatewayPanel.test.tsx`.
- `src/features/robot/v4/robot-runtime-registry.ts` and `src/features/robot/v4/robot-runtime-registry.test.ts` for one-shot Joint Commands. P2 `src/features/jobs/v4/job-executor.ts` is consumed through the P7 registration seam and is not modified here.
- `middleware/runtime-gateway/main.ts`, `middleware/runtime-gateway/deployment-config.ts`, and `middleware/runtime-gateway/deployment-config.test.ts`.
- `middleware/Dockerfile`, `compose.yaml`, `deploy/nginx.conf`.
- `scripts/deployment/validate-deployment.mjs` and test.
- `scripts/deployment/smoke-deployment.mjs` and test.
- `middleware/README.md`, root `README.md`, and `package.json`; no dependency change is required.

**Delete during Docker cutover:**

- Any remaining `opcua-connector` service/profile, config mount, script, image name, Nginx upstream, and documentation reference.

### Task 1: Define Command Identity, Result, and Lease Protocol Contracts

**Files:**
- Create: `src/core/opcua-v4/command-identity.ts`
- Test: `src/core/opcua-v4/command-identity.test.ts`
- Modify: `src/core/runtime-protocol/v1.ts`
- Test: `src/core/runtime-protocol/v1.test.ts`
- Modify: `src/core/project-v4/types.ts`
- Modify: `src/core/project-v4/validate.ts`

**Interfaces:**
- Consumes: P1 stable IDs, P1 shared `RuntimePublisherLeaseV1`, and P4 protocol envelopes from `src/core/runtime-protocol/v1.ts`.
- Produces: `CommandDedupKeyV1`, immutable snapshot comparison, Lease RPCs, publisher state/result envelopes, and closed Mapping/Action Binding configuration.

- [ ] **Step 1: Write RED command identity and protocol tests**

```ts
it('builds the full deduplication key without Session identity', () => {
  expect(commandDedupKeyV1({
    projectId: 'cell-a', configRevision: 'a'.repeat(64), leaseGeneration: 7,
    targetId: 'job-start-a', commandId: 'cmd-001',
  })).toBe(`cell-a/${'a'.repeat(64)}/7/job-start-a/cmd-001`)
})

it('treats expiry and typed payload as immutable replay fields', () => {
  expect(commandSnapshotsEqualV1(snapshot({ expiresAt: 1_000 }), snapshot({ expiresAt: 1_001 }))).toBe(false)
  expect(commandSnapshotsEqualV1(snapshot({ value: 1 }), snapshot({ value: 2 }))).toBe(false)
})

it('rejects one implicitly bidirectional Actual/Command mapping', () => {
  expect(() => validateWorkcellProjectV4(projectWithSharedActualCommandNode()))
    .toThrow('OPCUA_STATE_COMMAND_NODE_ALIAS')
})

it('accepts a 256 KiB command Batch and rejects plus one byte', () => {
  expect(() => validateCommandBatchV1(commandBatchWithEncodedBytes(256 * 1024))).not.toThrow()
  expect(() => validateCommandBatchV1(commandBatchWithEncodedBytes(256 * 1024 + 1)))
    .toThrow('RUNTIME_COMMAND_BATCH_SIZE_EXCEEDED')
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/core/opcua-v4/command-identity.test.ts src/core/runtime-protocol/v1.test.ts src/core/project-v4
```

Expected: FAIL because Lease and Server command contracts are incomplete.

- [ ] **Step 3: Implement the closed protocol unions**

```ts
export type CommandAcknowledgementV1 = 'IDLE' | 'ACCEPTED' | 'REJECTED'
export type CommandExecutionStateV1 = 'IDLE' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'

export interface CommandResultV1 {
  readonly protocolVersion: 1
  readonly projectId: string
  readonly configRevision: string
  readonly leaseGeneration: number
  readonly targetId: string
  readonly commandId: string
  readonly acknowledgement: CommandAcknowledgementV1
  readonly executionState: CommandExecutionStateV1
  readonly failureCode: string | null
  readonly message: string
  readonly attachedObjectId: string | null
  readonly completedAt: number | null
}
```

Add and validate `lease-acquire-v1`, `lease-renew-v1`, `lease-release-v1`, `simulation-state-publish-v1`, `command-request-v1`, `command-result-v1`, and their responses around P1's existing `RuntimePublisherLeaseV1`. Restrict Mapping and Action Binding targets to stable configured IDs; remotely supplied Robot/Object IDs are invalid. Do not add a second Lease interface anywhere under `middleware` or `src/features`.

Encode every `command-batch-v1` before dispatch and reject an envelope over 256 KiB. Expand a declared `readWrite` Mapping into distinct State and Command channels during validation; never expose one implicitly bidirectional node.

- [ ] **Step 4: Run GREEN and dependency scan**

```powershell
npm run test:run -- src/core/opcua-v4 src/core/runtime-protocol src/core/project-v4
rg -n "from ['\"](react|three|node:|ws|node-opcua)|window|document" src/core
npm run lint
npm run build:gateway
npm run build
```

Expected: tests pass and the Core dependency scan returns no matches.

- [ ] **Step 5: Commit**

```powershell
git add src/core
git diff --cached --check
git commit -m "feat: define gateway command contracts"
```

### Task 2: Implement the Runtime Publisher Lease

**Files:**
- Create: `middleware/runtime-gateway/lease-manager.ts`
- Test: `middleware/runtime-gateway/lease-manager.test.ts`
- Modify: `middleware/runtime-gateway/runtime-gateway-service.ts`
- Modify: `middleware/runtime-gateway/revision-manager.ts`
- Modify: `middleware/runtime-gateway/revision-manager.test.ts`

**Interfaces:**
- Consumes: P1 `RuntimePublisherLeaseV1` imported from `src/core/runtime-protocol/v1.ts`, validated Lease RPCs, active Project/config Revision, and an injected monotonic/wall clock.
- Produces: `RuntimePublisherLeaseManagerV1` with one owner, observer status, renewal, expiry, takeover, and generation fencing.

- [ ] **Step 1: Write RED ownership and fake-clock tests**

```ts
// @vitest-environment node
it('fences an old owner after takeover', () => {
  const clock = new FakeClock(1_000)
  const leases = createLeaseManager({ clock, ttlMs: 5_000 })
  const first = leases.acquire(request('browser-a'))
  clock.advance(5_001)
  const second = leases.acquire(request('browser-b'))
  expect(second.generation).toBe(first.generation + 1)
  expect(() => leases.assertOwner(first)).toThrow('LEASE_GENERATION_STALE')
  expect(() => leases.assertOwner(second)).not.toThrow()
})

it('does not let an observer publish or write', () => {
  const owner = leases.acquire(request('browser-a'))
  const nonOwnerLease = { ...owner, publisherId: 'browser-b' }
  expect(() => leases.assertOwner(nonOwnerLease)).toThrow('LEASE_NOT_OWNER')
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- middleware/runtime-gateway/lease-manager.test.ts
```

Expected: FAIL because Gateway ownership is not fenced.

- [ ] **Step 3: Implement the Lease state machine**

```ts
import type { RuntimePublisherLeaseV1 } from '../../src/core/runtime-protocol/v1.js'

export interface RuntimePublisherLeaseManagerV1 {
  activateRevision(projectId: string, configRevision: string): void
  acquire(request: LeaseAcquireRequestV1): RuntimePublisherLeaseV1
  renew(request: LeaseRenewRequestV1): RuntimePublisherLeaseV1
  release(request: LeaseReleaseRequestV1): void
  assertOwner(lease: RuntimePublisherLeaseV1): void
  current(): RuntimePublisherLeaseV1 | null
  status(publisherId: string): PublisherLeaseStatusV1
  expireNow(): void
}
```

Use a 5-second Lease TTL and renew at 2 seconds from the browser. Increment generation on every new acquisition, including acquisition after expiry. A Revision activation clears the prior owner and starts a new generation space. Lease loss retains last published state but marks Server-published Simulation quality `UNCERTAIN_LAST_USABLE_VALUE`.

- [ ] **Step 4: Wire readiness and run GREEN**

For a Server/Bridge Revision containing command bindings, `/readyz` remains 503 with `NO_ACTIVE_PUBLISHER` until a Lease exists. Off/Client and Server without Simulation command ownership do not require a Lease for readiness.

```powershell
npm run test:run -- middleware/runtime-gateway/lease-manager.test.ts middleware/runtime-gateway/revision-manager.test.ts
npm run build:gateway
```

Expected: acquisition, contention, renewal, explicit release, expiry, takeover, stale generation, Revision change, and readiness tests pass.

- [ ] **Step 5: Commit**

```powershell
git add middleware/runtime-gateway
git diff --cached --check
git commit -m "feat: fence runtime publisher ownership"
```

### Task 3: Publish Browser Simulation State Through the Lease

**Files:**
- Create: `src/features/runtime-gateway/runtime-publisher-controller.ts`
- Test: `src/features/runtime-gateway/runtime-publisher-controller.test.ts`
- Modify: `src/features/runtime-gateway/RuntimeGatewayClient.ts`
- Modify: `src/features/runtime-gateway/RuntimeGatewayClient.test.ts`
- Modify: `src/features/runtime-gateway/RuntimeGatewayPanel.tsx`
- Modify: `src/features/runtime-gateway/RuntimeGatewayPanel.test.tsx`

**Interfaces:**
- Consumes: P2 authoritative Robot/Frame/Job read models and P5 Lease RPC.
- Produces: `RuntimePublisherControllerV1`, raw `simulation-state-publish-v1` batches, and explicit owner/observer UI.

- [ ] **Step 1: Write RED publisher fencing tests**

```ts
it('publishes raw authoritative state only while it owns the current generation', async () => {
  gateway.acquirePublisherLease.mockResolvedValue(lease({ generation: 4 }))
  const controller = createPublisherController({ gateway, runtime, clock })
  await controller.start(activeRevision)
  runtime.emit(authoritativeRobotState('robot-a', { j1: 20 }))
  expect(gateway.publishSimulationState).toHaveBeenCalledWith(expect.objectContaining({
    leaseGeneration: 4, robotId: 'robot-a', jointId: 'j1', value: 20,
  }))
  gateway.emitLeaseLost()
  runtime.emit(authoritativeRobotState('robot-a', { j1: 30 }))
  expect(gateway.publishSimulationState).toHaveBeenCalledTimes(1)
})

it('does not republish an upstream-owned Robot through the browser Lease', async () => {
  await controller.start(activeBridgeRevision)
  runtime.emit(authoritativeRobotState('robot-upstream', { j1: 20 }, 'opcua:endpoint-a'))
  expect(gateway.publishSimulationState).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/runtime-gateway/runtime-publisher-controller.test.ts src/features/runtime-gateway/RuntimeGatewayClient.test.ts
```

Expected: FAIL because the browser has no Simulation publisher role.

- [ ] **Step 3: Implement acquire/renew/release and raw publication**

```ts
export interface RuntimePublisherControllerV1 {
  start(revision: PublishedProjectBundleV4): Promise<void>
  stop(): Promise<void>
  status(): PublisherLeaseStatusV1
  subscribe(listener: () => void): () => void
}
```

Acquire after a Server/Bridge Revision activates, renew every 2 seconds, stop immediately on old-generation/revision response, and release during clean shutdown. Batch only Simulation-owned authoritative state at the configured publishing interval. Read Simulation Joint values and Frames directly from P2 runtime authority, never from P4 interpolated buffers. In Bridge mode, upstream-owned raw state remains inside the Gateway P4 state path and is published/routed by the Server/Bridge adapters without a browser round trip.

- [ ] **Step 4: Run GREEN and UI tests**

```powershell
npm run test:run -- src/features/runtime-gateway
npm run lint
npm run build
```

Expected: owner, observer, renewal-failure, takeover, Revision replacement, and raw-versus-interpolated tests pass; UI labels owner/observer explicitly.

- [ ] **Step 5: Commit**

```powershell
git add src/features/runtime-gateway
git diff --cached --check
git commit -m "feat: publish leased simulation state"
```

### Task 4: Build the OPC UA Server Actual Namespace

**Files:**
- Create: `middleware/runtime-gateway/opcua-server-adapter.ts`
- Create: `middleware/runtime-gateway/opcua-server-namespace.ts`
- Test: `middleware/runtime-gateway/opcua-server-namespace.test.ts`
- Create: `middleware/runtime-gateway/server.integration.test.ts`
- Modify: `middleware/runtime-gateway/revision-manager.ts`
- Modify: `src/features/runtime-gateway/RuntimeGatewayPanel.tsx`
- Modify: `src/features/runtime-gateway/RuntimeGatewayPanel.test.tsx`

**Interfaces:**
- Consumes: active Server/Bridge Project configuration and accepted raw state.
- Produces: staged `OpcUaServerRevisionV1`, the stable `WebDigitalTwin/Projects/<projectId>` namespace, and browser-visible advertised endpoint/readiness diagnostics.

- [ ] **Step 1: Write RED namespace shape and raw-state tests**

```ts
// @vitest-environment node
it('separates Robot Actual, Command, Result, and Diagnostics nodes', async () => {
  const model = buildServerNamespaceModel(serverProject())
  expect(model.paths).toContain('WebDigitalTwin/Projects/cell-a/Actual/Robots/robot-a/Joints/j1')
  expect(model.paths).toContain('WebDigitalTwin/Projects/cell-a/Command/Mappings/joint-command/Value')
  expect(model.paths).toContain('WebDigitalTwin/Projects/cell-a/Result/Mappings/joint-command/State')
  expect(model.paths).not.toContain('WebDigitalTwin/Projects/cell-a/Actual/Mappings/joint-command/Value')
})

it('publishes latest raw state rather than browser interpolation', () => {
  publisher.acceptRaw(rawSample({ value: 20, sourceTimestampMs: 100 }))
  publisher.acceptVisualization(interpolatedSample({ value: 15 }))
  expect(server.read(actualJointNode)).toBe(20)
})

it('shows the advertised Server endpoint and readiness in the Gateway panel', () => {
  render(<RuntimeGatewayPanel status={serverStatus({
    endpointUrl: 'opc.tcp://cell.local:4840',
    readiness: 'ready',
  })} />)
  expect(screen.getByText('opc.tcp://cell.local:4840')).toBeVisible()
  expect(screen.getByText('READY')).toBeVisible()
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-server-namespace.test.ts middleware/runtime-gateway/server.integration.test.ts
```

Expected: FAIL because Gateway creates no OPC UA Server.

- [ ] **Step 3: Implement the staged Server adapter**

```ts
export interface OpcUaServerRevisionV1 {
  start(): Promise<void>
  stop(): Promise<void>
  publish(values: readonly RuntimeMappedValueV1[]): void
  setLeaseStatus(status: PublisherLeaseStatusV1): void
  endpointUrl(): string
}

export interface OpcUaServerAdapterV1 {
  stage(project: WorkcellProjectV4, configRevision: string): Promise<OpcUaServerRevisionV1>
}
```

Build nodes during Revision staging and start the Server before active-pointer swap. Configure anonymous SecurityPolicy None, port 4840, deterministic namespace URI, and maximum 16 Sessions. Map numeric types explicitly; publish Robot Base/Flange/TCP, keyed Joints, generic Entity Frames in XYZRPY, numeric Status, Attachments, Job state, config Revision, Lease, and Endpoint diagnostics.

Expose the staged Server's advertised `endpointUrl()` and readiness through the existing Gateway status envelope. `RuntimeGatewayPanel` displays the URL plus `READY` or `NOT READY`; it does not synthesize an address in the browser. Off/Client modes omit this Server-only row.

- [ ] **Step 4: Prove actual OPC UA TCP reads**

Start the production adapter on an ephemeral port, connect a real `node-opcua` Client, browse the namespace, read two Robot Joints and one Moving Frame, update raw state, and verify source timestamp/quality. Assert a server Revision swap removes old nodes only after the new namespace is live.

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-server-namespace.test.ts middleware/runtime-gateway/server.integration.test.ts
npm run test:run -- src/features/runtime-gateway/RuntimeGatewayPanel.test.tsx
npm run build:gateway
npm run build
```

Expected: model and real TCP tests pass with Actual/Command separation, and the browser shows the advertised endpoint URL with current readiness.

- [ ] **Step 5: Commit**

```powershell
git add middleware/runtime-gateway src/features/runtime-gateway
git diff --cached --check
git commit -m "feat: publish opc ua server actual state"
```

### Task 5: Isolate OPC UA Command Staging by Session

**Files:**
- Create: `middleware/runtime-gateway/opcua-command-staging.ts`
- Test: `middleware/runtime-gateway/opcua-command-staging.test.ts`
- Modify: `middleware/runtime-gateway/opcua-server-namespace.ts`
- Modify: `middleware/runtime-gateway/opcua-server-namespace.test.ts`

**Interfaces:**
- Consumes: Server Command node writes and configured Mapping/Action Binding IDs.
- Produces: `OpcUaCommandStagingV1` and complete immutable `ExternalCommandSnapshotV1` values only on same-Session rising edges.

- [ ] **Step 1: Write RED same-Session and cross-Session tests**

```ts
it('does not execute a Value write without a rising Trigger', () => {
  staging.writeValue('session-a', 'map-a', 10)
  expect(snapshots).toEqual([])
})

it('rejects fields split across Sessions', () => {
  staging.writeCommandId('session-a', 'map-a', 'cmd-1')
  staging.writeExpiresAt('session-a', 'map-a', 10_000)
  staging.writeValue('session-b', 'map-a', 10)
  expect(() => staging.writeTrigger('session-a', 'map-a', true, 1_000))
    .toThrow('COMMAND_STAGING_INCOMPLETE')
})

it('snapshots on false to true and clears successful staging', () => {
  stageComplete('session-a', 'map-a', command)
  staging.writeTrigger('session-a', 'map-a', false, 1_000)
  expect(staging.writeTrigger('session-a', 'map-a', true, 1_001)).toEqual(command)
  expect(staging.inspect('session-a', 'map-a')).toBeNull()
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-command-staging.test.ts
```

Expected: FAIL because Server Variables have no Session-local transaction semantics.

- [ ] **Step 3: Implement closed staged fields and rising-edge state**

```ts
export interface OpcUaCommandStagingV1 {
  writeCommandId(sessionId: string, bindingId: string, commandId: string): void
  writeExpiresAt(sessionId: string, bindingId: string, expiresAt: number): void
  writeValue(sessionId: string, mappingId: string, value: RuntimeScalarOrStructureV1): void
  writeTrigger(sessionId: string, bindingId: string, trigger: boolean, now: number): ExternalCommandSnapshotV1 | null
  closeSession(sessionId: string): void
  expireSessions(now: number): void
}
```

Keep state in `Map<sessionId, Map<bindingId, StagedCommand>>`. A rising edge requires Command ID, expiry, and Mapping Value when the configured target requires Value. Reject expiry more than 60 seconds after Trigger, non-finite or wrong typed Value, and inactive Mapping/Binding. Clear on successful snapshot, Session close, or 60-second Session staging timeout.

- [ ] **Step 4: Bind writes to real Session IDs and run GREEN**

Use the `node-opcua` write context's Session ID for every setter and register Session close/timeout cleanup. Do not use remote address or user identity as the key.

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-command-staging.test.ts middleware/runtime-gateway/opcua-server-namespace.test.ts
npm run build:gateway
```

Expected: incomplete, cross-Session, expiry, repeated-true, false-to-true, successful-clear, close, and timeout tests pass.

- [ ] **Step 5: Commit**

```powershell
git add middleware/runtime-gateway
git diff --cached --check
git commit -m "feat: stage opc ua commands by session"
```

### Task 6: Add Bounded Command Deduplication and Lease-Owner Dispatch

**Files:**
- Create: `middleware/runtime-gateway/command-registry.ts`
- Test: `middleware/runtime-gateway/command-registry.test.ts`
- Create: `middleware/runtime-gateway/command-dispatcher.ts`
- Test: `middleware/runtime-gateway/command-dispatcher.test.ts`
- Create: `src/features/runtime-gateway/runtime-command-executor-port.ts`
- Test: `src/features/runtime-gateway/runtime-command-executor-port.test.ts`
- Create: `src/features/runtime-gateway/runtime-action-command-owner-port.ts`
- Test: `src/features/runtime-gateway/runtime-action-command-owner-port.test.ts`
- Modify: `src/features/runtime-gateway/RuntimeGatewayClient.ts`
- Modify: `src/features/runtime-gateway/runtime-publisher-controller.ts`

**Interfaces:**
- Consumes: complete external snapshots, active Lease, current Revision, P2 keyed Robot Joint commands, and one optional registered P7 Job/Action handler.
- Produces: `CommandRegistryV1`, `CommandDispatcherV1`, `RuntimeCommandExecutorPortV1`, and P7-compatible `RuntimeActionCommandOwnerPortV1`.

- [ ] **Step 1: Write RED replay/capacity/retention tests**

```ts
it('replays an identical active command without executing twice', async () => {
  const first = await registry.execute(snapshot, executor)
  const replay = await registry.execute(snapshot, executor)
  expect(replay).toEqual(first)
  expect(executor).toHaveBeenCalledTimes(1)
})

it('rejects changed immutable fields for the same active key', async () => {
  await registry.execute(snapshot, executor)
  await expect(registry.execute({ ...snapshot, expiresAt: snapshot.expiresAt + 1 }, executor))
    .rejects.toThrow('COMMAND_ID_CONFLICT')
})

it('accepts 4096 active records, rejects 4097, then accepts after terminal retention', async () => {
  for (let index = 0; index < 4_096; index += 1) await registry.execute(snapshotFor(index), runningExecutor)
  await expect(registry.execute(snapshotFor(4_096), runningExecutor))
    .rejects.toThrow('COMMAND_DEDUP_CAPACITY_EXCEEDED')
  completeCommand(0)
  clock.advance(5 * 60_000 + 1)
  registry.prune()
  await expect(registry.execute(snapshotFor(4_096), runningExecutor)).resolves.toBeDefined()
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- middleware/runtime-gateway/command-registry.test.ts middleware/runtime-gateway/command-dispatcher.test.ts
```

Expected: FAIL because Gateway has no bounded command lifecycle.

- [ ] **Step 3: Implement registry and dispatcher interfaces**

```ts
export interface CommandRegistryV1 {
  execute(
    snapshot: ExternalCommandSnapshotV1,
    executor: (request: CommandRequestV1) => Promise<CommandResultV1>,
  ): Promise<CommandResultV1>
  complete(result: CommandResultV1): void
  read(key: CommandDedupKeyV1): StoredCommandRecordV1 | null
  prune(now?: number): void
  size(): number
}

export interface CommandDispatcherV1 {
  dispatch(snapshot: ExternalCommandSnapshotV1): Promise<CommandResultV1>
  acceptOwnerResult(result: CommandResultV1): void
}

export interface RuntimeCommandExecutorPortV1 {
  execute(request: CommandRequestV1): Promise<CommandResultV1>
}

export interface RuntimeActionCommandOwnerPortV1 {
  registerHandler(
    handler: (request: CommandRequestV1) => Promise<CommandResultV1>,
  ): () => void
}
```

Perform duplicate lookup before first-execution expiry validation. Do not evict a valid record. Keep RUNNING indefinitely, retain terminal records for five minutes, and prune only eligible terminal records. Dispatcher requires a live Lease, captures its generation, emits `ACCEPTED/RUNNING`, forwards only to that socket, and rejects stale-generation results. A missing owner returns `NO_ACTIVE_PUBLISHER`.

The browser port executes configured `joint-command` directly through the P2 Robot registry. It delegates `job-start` and `action-execute` to the single handler registered through `RuntimeActionCommandOwnerPortV1`; before P7 registration those commands return `ACTION_EXECUTOR_UNAVAILABLE`. Tests register one fake handler to prove acknowledgement and terminal forwarding without creating duplicate Job or Action semantics here. P7 registers the shared `RuntimeActionCommandAdapterV4`, which owns `job-start` until Job termination and `action-execute` until Action completion.

A one-shot `joint-command` addressed to a Simulation-owned Robot writes through `RobotRuntimeRegistryV4.writeJointValues` but does not change its configured `jointSourceOwnership`. P7's registered Job handler rejects `job-start` with `ROBOT_JOB_SOURCE_NOT_SIMULATION` when that Robot is owned by an upstream OPC UA Mapping.

- [ ] **Step 4: Run GREEN and prove acknowledgement separation**

```powershell
npm run test:run -- middleware/runtime-gateway/command-registry.test.ts middleware/runtime-gateway/command-dispatcher.test.ts src/features/runtime-gateway
npm run lint
npm run build:gateway
npm run build
```

Expected: expiry, identical replay, conflict, 4,096/4,097, five-minute prune, Lease loss, stale result, Job acknowledgement, and Job terminal-state tests pass.

- [ ] **Step 5: Commit**

```powershell
git add middleware/runtime-gateway src/features/runtime-gateway
git diff --cached --check
git commit -m "feat: dispatch deduplicated runtime commands"
```

### Task 7: Implement Declared Bridge Routes Without Echo

**Files:**
- Create: `src/core/opcua-v4/bridge-routes.ts`
- Test: `src/core/opcua-v4/bridge-routes.test.ts`
- Create: `middleware/runtime-gateway/bridge-router.ts`
- Test: `middleware/runtime-gateway/bridge-router.test.ts`
- Create: `middleware/runtime-gateway/bridge.integration.test.ts`
- Modify: `middleware/runtime-gateway/revision-manager.ts`

**Interfaces:**
- Consumes: validated Client state/write paths, Server publish/command paths, and Bridge Route configuration.
- Produces: `validateBridgeRoutesV4`, `BridgeRouterV1`, static cycle rejection, and `(originId, sequence)` echo suppression.

- [ ] **Step 1: Write RED cycle and no-echo tests**

```ts
it('rejects a static route cycle before activation', () => {
  expect(() => validateBridgeRoutesV4([
    route('upstream-a/state', 'server-a/actual'),
    route('server-a/actual', 'upstream-a/state'),
  ])).toThrow('BRIDGE_ROUTE_CYCLE')
})

it('forwards one origin sequence once', async () => {
  await router.forward(event({ originId: 'upstream-a', sequence: 7 }))
  await router.forward(event({ originId: 'upstream-a', sequence: 7 }))
  expect(destination.write).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/core/opcua-v4/bridge-routes.test.ts middleware/runtime-gateway/bridge-router.test.ts
```

Expected: FAIL because Bridge mode has no route graph or echo memory.

- [ ] **Step 3: Implement closed route validation and bounded echo keys**

```ts
export interface BridgeRouterV1 {
  activate(routes: readonly BridgeRouteV4[], configRevision: string): void
  forward(event: BridgeRouteEventV1): Promise<BridgeRouteResultV1>
  clear(): void
}
```

Validate source, destination, direction, datatype conversion, unit conversion, and ownership. Detect cycles over concrete channel IDs before resource staging. Retain only the latest sequence per `(routeId, originId)` for the active Revision; reject equal/older sequences and clear memory on Revision swap.

- [ ] **Step 4: Prove real Client-to-Server forwarding**

Start one test upstream OPC UA Server plus the Gateway Bridge Server. Change an upstream Variable, read the Gateway Actual node, write one declared Gateway Command, observe one upstream write, and assert no second write after the destination reflects the value.

```powershell
npm run test:run -- src/core/opcua-v4/bridge-routes.test.ts middleware/runtime-gateway/bridge-router.test.ts middleware/runtime-gateway/bridge.integration.test.ts
npm run build:gateway
```

Expected: cycle rejection, allowed conversions, undeclared-route rejection, stale sequence, Revision reset, and real no-echo tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/core/opcua-v4 middleware/runtime-gateway
git diff --cached --check
git commit -m "feat: route declared opc ua bridge paths"
```

### Task 8: Prove Session Isolation and Server Command Execution

**Files:**
- Create: `middleware/runtime-gateway/command.integration.test.ts`
- Modify: `middleware/runtime-gateway/server.integration.test.ts`
- Modify: `middleware/runtime-gateway/opcua-server-adapter.ts`
- Modify: `middleware/runtime-gateway/opcua-server-namespace.ts`

**Interfaces:**
- Consumes: production Server, staging, registry, Lease, browser executor port.
- Produces: real TCP evidence for 2 interleaved Sessions, 16/17 Sessions, acknowledgement, terminal state, and deduplication.

- [ ] **Step 1: Write the two-Session RED scenario**

Connect two real `node-opcua` Clients. Session A writes CommandId/ExpiresAt; Session B writes Value. Session A Trigger must set Result failure `COMMAND_STAGING_INCOMPLETE` and execute zero times. Then each Session stages a complete different command for the same Mapping; each rising edge must execute its own Value and Result CommandId.

- [ ] **Step 2: Write the 16/17 Session RED scenario**

Open 16 Client Sessions and browse/read Diagnostics through all of them. Attempt a 17th Session and require rejection. Re-read from all first 16 and require success. Close one, open a replacement, and require success.

- [ ] **Step 3: Write the real replay and terminal-state RED scenario**

Acquire a browser Lease, stage one `job-start`, trigger it, and assert `Acknowledgement=ACCEPTED` while `State=RUNNING`. Complete the fake Job and assert `State=SUCCEEDED`. Replay identical fields and assert the stored result returns without a second browser request. Replay changed expiry and assert `COMMAND_ID_CONFLICT`.

- [ ] **Step 4: Run GREEN**

```powershell
npm run test:run -- middleware/runtime-gateway/server.integration.test.ts middleware/runtime-gateway/command.integration.test.ts
npm run lint
npm run build:gateway
```

Expected: actual TCP Server, two-Session isolation, 16/17 boundary, Lease forwarding, acknowledgement/terminal separation, replay, and conflict cases pass.

- [ ] **Step 5: Commit**

```powershell
git add middleware/runtime-gateway
git diff --cached --check
git commit -m "test: prove opc ua server command isolation"
```

### Task 9: Cut Docker and Nginx Over to the Runtime Gateway

**Files:**
- Modify: `compose.yaml`
- Modify: `middleware/Dockerfile`
- Modify: `deploy/nginx.conf`
- Modify: `scripts/deployment/validate-deployment.mjs`
- Modify: `scripts/deployment/validate-deployment.test.ts`
- Modify: `scripts/deployment/smoke-deployment.mjs`
- Modify: `scripts/deployment/smoke-deployment.test.ts`
- Create: `scripts/deployment/runtime-gateway-smoke-client.mjs`
- Modify: `middleware/README.md`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: compiled Gateway entrypoint, P3 logical Asset mounts, all four modes, and health/readiness endpoints.
- Produces: standard Web + Gateway Compose, `/runtime/*` proxying, OPC UA port 4840, and mode-aware deployment scripts.

- [ ] **Step 1: Write RED deployment contract tests**

```ts
it('requires the runtime gateway in the standard Compose graph', async () => {
  const result = await validateDeploymentFiles()
  expect(result.services).toEqual(expect.arrayContaining(['web', 'runtime-gateway']))
  expect(result.runtimeGateway).toMatchObject({ cpu: 1, memoryMiB: 512, readOnly: true, opcUaPort: 4840 })
  expect(result.assetMounts).toMatchObject({ externalReadOnly: true, managedProjectAssetsWritable: true })
  expect(result.legacyConnectorReferences).toEqual([])
})

it('requires separate web liveness and gateway readiness routes', async () => {
  expect(await readNginxContract()).toMatchObject({
    webHealth: '/healthz', gatewayHealth: '/runtime/healthz',
    gatewayReady: '/runtime/readyz', gatewayWebSocket: '/runtime/ws',
    assetApi: '/runtime/assets/v1/',
  })
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- scripts/deployment
npm run deploy:validate
```

Expected: FAIL because Compose and Nginx still reference `opcua-connector` and the optional `opcua` profile.

- [ ] **Step 3: Replace the deployment graph**

Confirm deployment configuration has no `mode` field or mode environment variable. Before first Apply the service reports runtime mode `off`; after Apply it uses only `project.opcUa.mode`. Keep deployment configuration limited to host/HTTP/OPC UA ports, WebSocket path, Gateway ID, and logical Asset mounts.

Define `runtime-gateway` without a profile so standard `docker compose up` starts Web and Gateway. Run `node dist-gateway/middleware/runtime-gateway/main.js`, map `${ROBOTSIM_OPCUA_PORT:-4840}:4840`, expose internal HTTP 8081 and WS path, set `cpus: 1.0`, `mem_limit: 512m`, `read_only: true`, and `tmpfs: /tmp`. Mount deployment-owned external Asset roots, including `local-samples`, read-only. Mount the dedicated `project-assets` named volume read-write at its configured managed root so browser imports work without making the container root writable. Use Gateway `/healthz` for its container healthcheck.

Nginx must keep `/healthz` for Web, add the P3 `/runtime/assets/v1/` proxy, proxy Gateway liveness/readiness at `/runtime/healthz` and `/runtime/readyz`, and upgrade `/runtime/ws`. Keep the global request-body limit at 1 MiB and set `client_max_body_size 101m` only on `/runtime/assets/v1/import`. Do not use Gateway readiness as a Compose startup dependency because `NO_ACTIVE_REVISION` before browser Apply is valid.

- [ ] **Step 4: Rewrite smoke orchestration around Project mode**

```ts
export async function smokeDeployment(options: {
  readonly mode: 'off' | 'client' | 'server' | 'bridge'
  readonly composeFile?: string
  readonly projectFixture?: string
  readonly keepRunning?: boolean
}): Promise<DeploymentSmokeReportV1>
```

For each mode, start standard Compose, assert Web and Gateway `/healthz`, assert pre-Apply `/runtime/readyz` returns `NO_ACTIVE_REVISION`, apply a canonical fixture through the WebSocket helper, acquire a Lease when required, assert ready Revision/mode, perform WebSocket Upgrade, resolve one read-only logical Asset, register and resolve one managed Asset through `project-assets`, connect to port 4840 in Server/Bridge, and shut down cleanly.

Replace scripts with:

```json
{
  "deploy:build": "docker compose build",
  "deploy:smoke": "node scripts/deployment/smoke-deployment.mjs --mode off",
  "deploy:smoke:modes": "node scripts/deployment/smoke-deployment.mjs --all-modes",
  "test:gateway": "vitest run middleware/runtime-gateway src/features/runtime-gateway src/core/opcua-v4",
  "verify": "npm run lint && npm run test:run && npm run test:gateway && npm run cad:validate && npm run build:gateway && npm run build && npm run test:e2e:v4"
}
```

- [ ] **Step 5: Run deployment GREEN**

```powershell
npm run test:run -- scripts/deployment
npm run deploy:validate
npm run deploy:build
npm run deploy:smoke:modes
```

Expected: Off, Client, Server, and Bridge smokes pass; pre/post Apply readiness ordering is explicit; port 4840 accepts a real Client in Server/Bridge; no `opcua-connector` service/profile remains.

- [ ] **Step 6: Commit**

```powershell
git add compose.yaml middleware deploy scripts/deployment README.md package.json
git diff --cached --check
git commit -m "deploy: run runtime gateway in all modes"
```

### Task 10: Run the P5 Server and Bridge Exit Gate

**Files:**
- Modify: `middleware/runtime-gateway/server.integration.test.ts`
- Modify: `middleware/runtime-gateway/command.integration.test.ts`
- Modify: `middleware/runtime-gateway/bridge.integration.test.ts`
- Modify: `docs/superpowers/plans/2026-07-16-runtime-gateway-server-bridge.md`

**Interfaces:**
- Produces: a complete P5 boundary ready for P7 Action Executor integration and P8 browser release evidence.

- [ ] **Step 1: Run the focused Gateway gate**

```powershell
npm run test:gateway
npm run test:run -- middleware/runtime-gateway/server.integration.test.ts middleware/runtime-gateway/command.integration.test.ts middleware/runtime-gateway/bridge.integration.test.ts
npm run lint
npm run build:gateway
npm run build
```

Expected: Client state remains green; Server Actual/Command separation, Lease fencing, two-Session isolation, 16/17 Session boundary, 4,096/4,097 registry boundary, terminal replay, and Bridge no-echo all pass.

- [ ] **Step 2: Run the deployment gate**

```powershell
npm run deploy:validate
npm run deploy:build
npm run deploy:smoke:modes
git status --short
```

Expected: four-mode smoke passes within the 1 CPU/512 MiB Gateway allocation; only intentional plan evidence and unrelated CAD directories remain.

- [ ] **Step 3: Record evidence and commit**

Record exact test counts, all four readiness transitions, and the OPC UA TCP endpoint used by the smoke in this plan, then:

```powershell
git add docs/superpowers/plans/2026-07-16-runtime-gateway-server-bridge.md
git diff --cached --check
git commit -m "test: prove gateway server and bridge modes"
```
