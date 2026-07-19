# OPC UA Connectivity Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Bridge mode start both real OPC UA adapters, expose one explicit backend contract that separates Gateway liveness, Project readiness, Server listener state, and per-Client Endpoint diagnostics, provide demand-driven status polling, and move the Docker Gateway Server endpoint from port 4840 to 4841.

**Architecture:** Keep Project V4 as the inspected activation input for this milestone, while making connectivity status a Project-version-neutral `runtime-gateway-status-v1` contract under Core. The Client adapter owns Endpoint diagnostics, the Gateway composes those diagnostics with deployment and Server state, and a standalone browser-side poller supplies 2-second Monitor and 10-second Header cadences without adding UI. Docker keeps the host PLC Server on 4840 through `host.docker.internal` and publishes the Gateway Server independently on 4841.

**Tech Stack:** TypeScript 6.0.3, Node.js `>=22.15.1 <23`, npm `>=11.4.2 <12`, node-opcua 2.175.0, Vitest 4.1.10, Docker Compose v2, Nginx.

## Global Constraints

- This plan implements only **Milestone 1: Connectivity stabilization** from `docs/superpowers/specs/2026-07-19-opcua-robotics-io-settings-design.md`.
- Do not add Project V5, logical Signals, Client writes, Job instructions, Robotics NodeSets, standard Robotics instances, Settings UI, Connection Monitor UI, or manufacturer Robot program generation.
- Project V4 remains the temporary activation payload; do not add migration, aliases, Compatibility Mode, or Legacy Adoption.
- Modes remain exactly `off`, `client`, `server`, and `bridge`; Bridge starts both adapters but does not imply automatic pass-through.
- Gateway process liveness, active Project readiness, OPC UA Server listener state, and every OPC UA Client Endpoint phase are independent facts.
- Client Endpoint phase is exactly `disabled`, `connecting`, `connected`, `reconnecting`, or `faulted`.
- The future Monitor cadence is 2,000 ms; the persistent Header cadence is 10,000 ms. Polls never overlap.
- A Windows-hosted PLC Server remains `opc.tcp://127.0.0.1:4840` for native use and is reached from Docker as `opc.tcp://host.docker.internal:4840`.
- The Gateway OPC UA Server default listener, advertised, published, and smoke-test port is 4841.
- The Web UI never connects to the Docker daemon and does not start or stop containers.
- Anonymous access, `MessageSecurityMode.None`, and `SecurityPolicy.None` remain the explicit trusted-development-LAN limitation. Do not add security configuration.
- Browser-only Simulation remains usable when the Gateway is unavailable.
- Do not claim OPC UA Robotics conformance, Client writes, or PLC command support in this milestone.
- Keep comments in English, preserve unrelated user changes, and never stage `.pnpm-store`, CAD source directories, backup directories, or generated artifacts.
- Each implementation task follows RED-GREEN-REFACTOR, ends with focused verification, and creates one reviewable commit. Verification-only Task 6 records evidence in the progress ledger without an empty commit.

---

## File Structure

**Create:**

- `src/core/runtime-protocol/gateway-status-v1.ts` — closed Project-version-neutral status types and runtime decoder.
- `src/core/runtime-protocol/gateway-status-v1.test.ts` — closed-shape, consistency, and immutability tests.
- `src/features/runtime-gateway/v4/runtime-gateway-status-poller-v4.ts` — non-visual demand-driven polling controller.
- `src/features/runtime-gateway/v4/runtime-gateway-status-poller-v4.test.ts` — fake-clock cadence, overlap, error, and stop tests.

**Modify:**

- `middleware/runtime-gateway/opcua-server-adapter.ts:125-147` — treat `bridge` as an enabled Server role.
- `middleware/runtime-gateway/opcua-server-adapter.test.ts:32-39,95-213` — real Bridge Server regression.
- `middleware/runtime-gateway/opcua-client-adapter.ts:62-105,413-596` — preserve Endpoint URL, phase, counters, timestamps, quality, retry, and error details.
- `middleware/runtime-gateway/opcua-client-adapter.test.ts:379-575` — diagnostic lifecycle evidence.
- `middleware/runtime-gateway/deployment-config.ts:1-123` — deployment runtime kind and eventual 4841 default.
- `middleware/runtime-gateway/deployment-config.test.ts:10-51,155-194` — native/Docker kind and port defaults.
- `middleware/runtime-gateway/main.ts:44-113,341-429,459-524,737-760` — compose and serve the v1 status snapshot.
- `middleware/runtime-gateway/main.test.ts:82-198,303-448` — independent Project, Server, and Client states over HTTP.
- `src/features/runtime-gateway/v4/runtime-gateway-publisher-v4.ts:3-46,114-210,236-255,392-406` — decode the shared status contract and keep activation fencing.
- `src/features/runtime-gateway/v4/runtime-gateway-publisher-v4.test.ts:11-171` — malformed and complete diagnostics decoding.
- `src/app/App.tsx:245-254,527-558` — non-visual field-path cutover only; no component or layout change.
- `src/app/App.runtime-gateway.test.tsx` — preserve current activation and local-Simulation behavior under the new status shape.
- `compose.yaml` — Docker runtime kind and 4841 listener/publication.
- `middleware/Dockerfile` — document the exposed Gateway Server port as 4841.
- `scripts/deployment/validate-deployment.mjs` and `scripts/deployment/validate-deployment.test.ts` — enforce 4841 and Docker runtime-kind topology.
- `scripts/deployment/smoke-deployment.mjs` and `scripts/deployment/smoke-deployment.test.ts` — use 4841 by default.
- `README.md`, `middleware/README.md`, and `docs/operator/docker-deployment.md` — exact native/Docker topology, diagnostics, and operator commands.

### Task 1: Fix Real Bridge Server Activation

**Files:**
- Modify: `middleware/runtime-gateway/opcua-server-adapter.ts:125-147`
- Test: `middleware/runtime-gateway/opcua-server-adapter.test.ts:32-39,95-213`

**Interfaces:**
- Consumes: validated `WorkcellProjectV4['opcUa']['mode']`.
- Produces: unchanged `OpcUaServerAdapterV1`; `server` and `bridge` Projects both activate its Server role, while `off` and `client` remain off.

- [ ] **Step 1: Extend the existing test Project helper and write the failing Bridge regression**

```ts
function sampleProject(mode: 'off' | 'server' | 'bridge') {
  const source = createDualRobotSampleV4({
    projectId: `project-opcua-${mode}`,
    revisionId: `revision-opcua-${mode}`,
    nowIso: '2026-07-17T00:00:00.000Z',
    opcUaMode: mode === 'bridge' ? 'server' : mode,
  })
  return mode === 'bridge'
    ? validateWorkcellProjectV4({ ...source, opcUa: { ...source.opcUa, mode } })
    : source
}

it('starts the Server role for a validated Bridge Project', async () => {
  const adapter = createOpcUaServerAdapterV1(sampleProject('bridge'), {
    host: '127.0.0.1', advertisedHost: '127.0.0.1',
    advertisedPort: 0, port: 0, pkiRootDir: TEST_PKI_ROOT,
  })
  adapters.push(adapter)

  await adapter.start()

  expect(adapter.status()).toMatchObject({
    mode: 'server', started: true,
    endpointUrl: expect.stringMatching(/^opc\.tcp:\/\/127\.0\.0\.1:\d+$/u),
  })
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- middleware/runtime-gateway/opcua-server-adapter.test.ts -t "Bridge Project"`

Expected: FAIL because line 131 maps every non-`server` Project, including `bridge`, to `off`.

- [ ] **Step 3: Enable the Server role for exactly Server and Bridge modes**

```ts
const serverEnabled = project.opcUa.mode === 'server' || project.opcUa.mode === 'bridge'
const mode: OpcUaServerAdapterStatusV1['mode'] = serverEnabled ? 'server' : 'off'
```

Keep `startTransition()` and `publishRobotJointState()` guarded by this adapter-role `mode`; do not add `bridge` to `OpcUaServerAdapterStatusV1` because the adapter reports its Server role, not the whole Gateway mode.

- [ ] **Step 4: Run GREEN and the existing Gateway Bridge composition test**

Run: `npm run test:run -- middleware/runtime-gateway/opcua-server-adapter.test.ts middleware/runtime-gateway/main.test.ts -t "Bridge"`

Expected: PASS; a real Server adapter listens for Bridge, and `main.ts` still starts one Server and one Client adapter.

- [ ] **Step 5: Commit**

```powershell
git add middleware/runtime-gateway/opcua-server-adapter.ts middleware/runtime-gateway/opcua-server-adapter.test.ts
git diff --cached --check
git commit -m "fix: activate opc ua server in bridge mode"
```

### Task 2: Preserve Per-Endpoint OPC UA Client Diagnostics

**Files:**
- Create: `src/core/runtime-protocol/gateway-status-v1.ts` (Endpoint diagnostic types only; Task 3 adds the enclosing snapshot and decoder)
- Modify: `middleware/runtime-gateway/opcua-client-adapter.ts:62-105,413-596`
- Test: `middleware/runtime-gateway/opcua-client-adapter.test.ts:379-575`

**Interfaces:**
- Consumes: `OpcUaEndpointV4`, compiled read plans, OPC UA lifecycle events, injected `nowMs()`.
- Produces: `OpcUaClientAdapterV1.status(): readonly RuntimeGatewayOpcUaClientEndpointStatusV1[]`; Task 3 consumes this shared Core type without redeclaring it.

- [ ] **Step 1: Write failing lifecycle assertions using the existing fake connection helper**

```ts
it('reports connected Session, Subscription, counts, timestamps, quality, and no retry', async () => {
  const project = projectWithEntityPoseMapping()
  const connection = fakeOpcUaClientConnection()
  let now = 5_000
  const adapter = createOpcUaClientAdapterV1(project, {
    gatewayId: 'gateway-local', originId: 'gateway-local:client',
    configRevision: REVISION, publish: () => undefined,
    nowMs: () => now, createClient: () => connection.client as never,
  })
  await adapter.start()
  await eventually(() => adapter.status()[0]?.phase === 'connected')
  connection.group.emit('changed', {}, fakeDataValue(1), 0)

  expect(adapter.status()[0]).toMatchObject({
    endpointId: 'endpoint-live', endpointUrl: 'opc.tcp://127.0.0.1:4840',
    phase: 'connected', sessionActive: true, subscriptionActive: true,
    monitoredItemCount: 6, mappingCount: 1, lastValueQuality: 'GOOD',
    lastNotificationAtMs: 5_000, lastGoodValueAtMs: 5_000,
    reconnectAttempt: 0, nextRetryAtMs: null, lastError: null,
  })
  await adapter.stop()
})

it('retains a timed error and retry deadline after connection loss', async () => {
  const project = projectWithEntityPoseMapping()
  const connection = fakeOpcUaClientConnection()
  let now = 8_000
  const adapter = createOpcUaClientAdapterV1(project, {
    gatewayId: 'gateway-local', originId: 'gateway-local:client',
    configRevision: REVISION, publish: () => undefined,
    nowMs: () => now, createClient: () => connection.client as never,
  })
  await adapter.start()
  await eventually(() => adapter.status()[0]?.phase === 'connected')
  connection.client.emit('connection_lost')
  await eventually(() => adapter.status()[0]?.phase === 'reconnecting')

  expect(adapter.status()[0]).toMatchObject({
    phase: 'reconnecting', sessionActive: false, subscriptionActive: false,
    reconnectAttempt: 1, nextRetryAtMs: 8_100,
    lastError: {
      code: 'OPC_UA_CONNECTION_LOST',
      message: 'OPC_UA_CONNECTION_LOST',
      occurredAtMs: 8_000,
    },
  })
  await adapter.stop()
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- middleware/runtime-gateway/opcua-client-adapter.test.ts -t "reports connected|retains a timed error"`

Expected: FAIL because status currently exposes only `endpointId`, `connected`, and an un-timed error string.

- [ ] **Step 3: Add the exact mutable diagnostic state and deterministic phase derivation**

Create the shared type-only boundary first:

```ts
export type RuntimeGatewayOpcUaClientEndpointPhaseV1 =
  | 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'faulted'

export interface RuntimeGatewayDiagnosticErrorV1 {
  readonly code: string
  readonly message: string
  readonly occurredAtMs: number
}

export interface RuntimeGatewayOpcUaClientEndpointStatusV1 {
  readonly endpointId: string
  readonly endpointUrl: string
  readonly phase: RuntimeGatewayOpcUaClientEndpointPhaseV1
  readonly sessionActive: boolean
  readonly subscriptionActive: boolean
  readonly monitoredItemCount: number
  readonly mappingCount: number
  readonly lastValueQuality: 'GOOD' | 'UNCERTAIN' | 'BAD' | null
  readonly lastNotificationAtMs: number | null
  readonly lastGoodValueAtMs: number | null
  readonly reconnectAttempt: number
  readonly nextRetryAtMs: number | null
  readonly lastError: RuntimeGatewayDiagnosticErrorV1 | null
}
```

Import those types into the Client adapter, then add its mutable diagnostic state:

```ts
interface EndpointRuntimeDiagnosticsV1 {
  lastValueQuality: 'GOOD' | 'UNCERTAIN' | 'BAD' | null
  lastNotificationAtMs: number | null
  lastGoodValueAtMs: number | null
  reconnectAttempt: number
  nextRetryAtMs: number | null
  lastError: RuntimeGatewayDiagnosticErrorV1 | null
}

function endpointPhase(runtime: EndpointRuntimeV1): RuntimeGatewayOpcUaClientEndpointPhaseV1 {
  if (runtime.stopped) return 'disabled'
  if (runtime.connected) return 'connected'
  if (runtime.connecting) return 'connecting'
  if (runtime.recovery !== null || runtime.reconnectTimer !== null) return 'reconnecting'
  return runtime.lastError === null ? 'connecting' : 'faulted'
}
```

Initialize one diagnostic record for every configured `project.opcUa.endpoints` item. Start a connection runtime only when an enabled Endpoint has a compiled read plan; report disabled Endpoints and enabled Endpoints with zero read mappings as `disabled` with zero active Session/Subscription flags. Return status rows in Project Endpoint order.

On every `changed` event, set `lastNotificationAtMs = nowMs()`, derive `lastValueQuality` from the StatusCode, and update `lastGoodValueAtMs` only for `GOOD`. On recovery, retain prior sample timestamps, set `{ code, message, occurredAtMs }`, increment `reconnectAttempt`, and set `nextRetryAtMs = nowMs() + reconnectDelayMs`. Clear retry fields and reset `reconnectAttempt` after a successful connection. `stop()` clears timers and active Session/Subscription flags but retains the last error and sample timestamps for inspection.

- [ ] **Step 4: Run GREEN and the complete Client adapter suite**

Run: `npm run test:run -- middleware/runtime-gateway/opcua-client-adapter.test.ts`

Expected: PASS, including reconnect isolation and real local OPC UA subscription tests.

- [ ] **Step 5: Commit**

```powershell
git add src/core/runtime-protocol/gateway-status-v1.ts middleware/runtime-gateway/opcua-client-adapter.ts middleware/runtime-gateway/opcua-client-adapter.test.ts
git diff --cached --check
git commit -m "feat: retain opc ua client diagnostics"
```

### Task 3: Introduce the Separated Gateway Status Contract

**Files:**
- Modify: `src/core/runtime-protocol/gateway-status-v1.ts`
- Test: `src/core/runtime-protocol/gateway-status-v1.test.ts`
- Modify: `middleware/runtime-gateway/deployment-config.ts`
- Test: `middleware/runtime-gateway/deployment-config.test.ts`
- Modify: `middleware/runtime-gateway/main.ts`
- Test: `middleware/runtime-gateway/main.test.ts`
- Modify: `src/features/runtime-gateway/v4/runtime-gateway-publisher-v4.ts`
- Test: `src/features/runtime-gateway/v4/runtime-gateway-publisher-v4.test.ts`
- Modify: `src/app/App.tsx`
- Test: `src/app/App.runtime-gateway.test.tsx`

**Interfaces:**
- Consumes: Task 2 Endpoint diagnostics, `OpcUaServerAdapterV1.status()`, deployment config, active Project/revision.
- Produces: `validateRuntimeGatewayStatusV1(value: unknown): RuntimeGatewayStatusV1`; `RuntimeGatewayPublisherV4` returns this snapshot from activation, state publication, and status reads.

- [ ] **Step 1: Write RED closed-contract and consistency tests**

```ts
function bridgeStatusFixtureV1() {
  return {
    type: 'runtime-gateway-status-v1' as const,
    protocolVersion: 1 as const,
    observedAtMs: 9_000,
    gateway: { gatewayId: 'gateway-test', phase: 'online' as const, runtimeKind: 'docker' as const },
    deployment: {
      http: { bindHost: '0.0.0.0', port: 8081 },
      opcUaServer: {
        bindHost: '0.0.0.0', port: 4841,
        advertisedHost: '127.0.0.1', advertisedPort: 4841,
      },
    },
    project: {
      phase: 'ready' as const, projectId: 'project-a', revisionId: 'revision-a',
      configRevision: 'a'.repeat(64),
      readinessCode: 'READY' as const,
    },
    opcUa: {
      mode: 'bridge' as const,
      server: {
        phase: 'listening' as const,
        endpointUrl: 'opc.tcp://127.0.0.1:4841', lastError: null,
      },
      clientEndpoints: [{
        endpointId: 'plc-a', endpointUrl: 'opc.tcp://host.docker.internal:4840',
        phase: 'reconnecting' as const, sessionActive: false, subscriptionActive: false,
        monitoredItemCount: 6, mappingCount: 1, lastValueQuality: 'GOOD' as const,
        lastNotificationAtMs: 8_000, lastGoodValueAtMs: 8_000,
        reconnectAttempt: 1, nextRetryAtMs: 9_100,
        lastError: {
          code: 'OPC_UA_CONNECTION_LOST', message: 'OPC_UA_CONNECTION_LOST', occurredAtMs: 9_000,
        },
      }],
    },
  }
}

it('accepts independent Project-ready, Server-listening, and reconnecting Client state', () => {
  const status = validateRuntimeGatewayStatusV1(bridgeStatusFixtureV1())
  expect(status.project.phase).toBe('ready')
  expect(status.opcUa.server.phase).toBe('listening')
  expect(status.opcUa.clientEndpoints[0]?.phase).toBe('reconnecting')
  expect(Object.isFrozen(status)).toBe(true)
})

it('rejects a connected Client without an active Session and Subscription', () => {
  const source = bridgeStatusFixtureV1()
  expect(() => validateRuntimeGatewayStatusV1({
    ...source,
    opcUa: {
      ...source.opcUa,
      clientEndpoints: [{
        ...source.opcUa.clientEndpoints[0], phase: 'connected',
        sessionActive: false, subscriptionActive: false,
      }],
    },
  })).toThrow('RUNTIME_GATEWAY_STATUS_INVALID')
})

it('rejects unknown fields and a listening Server without an endpoint URL', () => {
  expect(() => validateRuntimeGatewayStatusV1({
    ...bridgeStatusFixtureV1(), unexpected: true,
  })).toThrow('RUNTIME_GATEWAY_STATUS_INVALID')
  const source = bridgeStatusFixtureV1()
  expect(() => validateRuntimeGatewayStatusV1({
    ...source,
    opcUa: { ...source.opcUa, server: { ...source.opcUa.server, endpointUrl: null } },
  })).toThrow('RUNTIME_GATEWAY_STATUS_INVALID')
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/core/runtime-protocol/gateway-status-v1.test.ts`

Expected: FAIL because the versioned separated status contract does not exist.

- [ ] **Step 3: Define and validate the exact wire interfaces**

```ts
export type RuntimeGatewayModeV1 = 'off' | 'client' | 'server' | 'bridge'
export type RuntimeGatewayRuntimeKindV1 = 'native' | 'docker'

export interface RuntimeGatewayStatusV1 {
  readonly type: 'runtime-gateway-status-v1'
  readonly protocolVersion: 1
  readonly observedAtMs: number
  readonly gateway: {
    readonly gatewayId: string
    readonly phase: 'online'
    readonly runtimeKind: RuntimeGatewayRuntimeKindV1
  }
  readonly deployment: {
    readonly http: { readonly bindHost: string; readonly port: number }
    readonly opcUaServer: {
      readonly bindHost: string
      readonly port: number
      readonly advertisedHost: string
      readonly advertisedPort: number
    }
  }
  readonly project: {
    readonly phase: 'not-applied' | 'ready'
    readonly projectId: string | null
    readonly revisionId: string | null
    readonly configRevision: string | null
    readonly readinessCode: 'NO_ACTIVE_REVISION' | 'READY'
  }
  readonly opcUa: {
    readonly mode: RuntimeGatewayModeV1
    readonly server: {
      readonly phase: 'disabled' | 'listening' | 'faulted'
      readonly endpointUrl: string | null
      readonly lastError: RuntimeGatewayDiagnosticErrorV1 | null
    }
    readonly clientEndpoints: readonly RuntimeGatewayOpcUaClientEndpointStatusV1[]
  }
}

export function validateRuntimeGatewayStatusV1(value: unknown): RuntimeGatewayStatusV1
```

The decoder accepts only exact keys, finite non-negative safe-integer timestamps/counters, non-empty IDs/URLs/error text, a lowercase 64-hex `configRevision`, and the listed enums. Enforce these consistency groups: `not-applied/null projectId/null revisionId/null configRevision/NO_ACTIVE_REVISION`; `ready/string projectId/string revisionId/64-hex configRevision/READY`; `listening/non-null endpoint/null error`; `disabled/null endpoint`; and `connected/true session/true subscription/null nextRetryAtMs`. Return a recursively frozen clone.

- [ ] **Step 4: Add deployment runtime kind and compose the status in the Gateway**

```ts
export interface RuntimeGatewayDeploymentConfigV1 {
  readonly gatewayId: string
  readonly runtimeKind: RuntimeGatewayRuntimeKindV1
  readonly host: string
  readonly httpPort: number
  readonly opcUaAdvertisedHost: string
  readonly opcUaAdvertisedPort: number
  readonly opcUaPort: number
}
```

Read `ROBOTSIM_RUNTIME_KIND` as exactly `native` or `docker`, defaulting to `native`. Inject `nowMs?: () => number` through `RuntimeGatewayEntrypointDependenciesV1`, replace `browserStatus()` with one `status()` builder returning `RuntimeGatewayStatusV1`, and return that same shape from `PUT /runtime/project`, `POST /runtime/state`, `GET /runtime/status`, and successful `GET /readyz`. Keep `/healthz` process-only and keep pre-apply `/readyz` at HTTP 503.

Add `runtimeKind: 'native'` to the existing `createTestConfig()` helper in `middleware/runtime-gateway/main.test.ts`; do not let test-only configs omit a deployment fact that production status exposes.

Use these derivations:

```ts
const projectStatus = active === null
  ? { phase: 'not-applied', projectId: null, revisionId: null, configRevision: null,
      readinessCode: 'NO_ACTIVE_REVISION' }
  : { phase: 'ready', projectId: active.project.projectId,
      revisionId: active.project.revisionId, configRevision: active.configRevision,
      readinessCode: 'READY' }

const serverStatus = active?.serverAdapter?.status()
const server = serverStatus?.started === true
  ? { phase: 'listening', endpointUrl: serverStatus.endpointUrl, lastError: null }
  : { phase: 'disabled', endpointUrl: null, lastError: null }
```

- [ ] **Step 5: Cut the browser transport and non-visual App field access to the shared contract**

Replace the private `decodeStatusV4` implementation with `validateRuntimeGatewayStatusV1`. Update activation checks to use `status.project.projectId`, `status.project.revisionId`, `status.project.phase === 'ready'`, and `status.opcUa.mode`. Update only `readyGatewayPresentationV4()` and `isCurrentStatus()` in `App.tsx`:

```ts
return Object.freeze({
  phase: 'ready',
  projectRevisionId: status.project.revisionId,
  mode: status.opcUa.mode,
  endpointUrl: status.opcUa.server.endpointUrl,
  message: null,
})
```

Do not change Header labels, dialogs, menu entries, or layout in this milestone.

- [ ] **Step 6: Run GREEN across Core, Gateway HTTP, publisher, and App integration**

Run: `npm run test:run -- src/core/runtime-protocol/gateway-status-v1.test.ts middleware/runtime-gateway/deployment-config.test.ts middleware/runtime-gateway/main.test.ts src/features/runtime-gateway/v4/runtime-gateway-publisher-v4.test.ts src/app/App.runtime-gateway.test.tsx`

Expected: PASS; Client disconnect does not change `project.phase` from `ready`, Bridge reports Server `listening` and the Client's independent phase/error, and malformed status JSON is rejected.

- [ ] **Step 7: Commit**

```powershell
git add src/core/runtime-protocol/gateway-status-v1.ts src/core/runtime-protocol/gateway-status-v1.test.ts middleware/runtime-gateway/deployment-config.ts middleware/runtime-gateway/deployment-config.test.ts middleware/runtime-gateway/main.ts middleware/runtime-gateway/main.test.ts src/features/runtime-gateway/v4/runtime-gateway-publisher-v4.ts src/features/runtime-gateway/v4/runtime-gateway-publisher-v4.test.ts src/app/App.tsx src/app/App.runtime-gateway.test.tsx
git diff --cached --check
git commit -m "feat: separate gateway connectivity status"
```

### Task 4: Add the Non-Visual Status Polling Backend

**Files:**
- Create: `src/features/runtime-gateway/v4/runtime-gateway-status-poller-v4.ts`
- Test: `src/features/runtime-gateway/v4/runtime-gateway-status-poller-v4.test.ts`

**Interfaces:**
- Consumes: `Pick<RuntimeGatewayPublisherV4, 'readStatus'>` from Task 3.
- Produces: an unmounted polling controller for the later Header and Connection Monitor UI.

- [ ] **Step 1: Write failing fake-timer cadence, overlap, and stop tests**

```ts
function statusFixtureV1(): RuntimeGatewayStatusV1 {
  return validateRuntimeGatewayStatusV1({
    type: 'runtime-gateway-status-v1', protocolVersion: 1, observedAtMs: 1_000,
    gateway: { gatewayId: 'gateway-test', phase: 'online', runtimeKind: 'native' },
    deployment: {
      http: { bindHost: '127.0.0.1', port: 8081 },
      opcUaServer: {
        bindHost: '127.0.0.1', port: 4841,
        advertisedHost: '127.0.0.1', advertisedPort: 4841,
      },
    },
    project: {
      phase: 'not-applied', projectId: null, revisionId: null,
      configRevision: null,
      readinessCode: 'NO_ACTIVE_REVISION',
    },
    opcUa: {
      mode: 'off',
      server: { phase: 'disabled', endpointUrl: null, lastError: null },
      clientEndpoints: [],
    },
  })
}

it('polls immediately, every ten seconds for Header, and every two seconds for Monitor', async () => {
  vi.useFakeTimers()
  const readStatus = vi.fn().mockResolvedValue(statusFixtureV1())
  const onStatus = vi.fn()
  const poller = createRuntimeGatewayStatusPollerV4({ readStatus, onStatus, onError: vi.fn() })

  poller.setDemand('header')
  await Promise.resolve()
  expect(readStatus).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(9_999)
  expect(readStatus).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(readStatus).toHaveBeenCalledTimes(2)

  poller.setDemand('monitor')
  await vi.advanceTimersByTimeAsync(2_000)
  expect(readStatus).toHaveBeenCalledTimes(3)
  poller.stop()
  vi.useRealTimers()
})

it('allows only one read in flight and aborts it without reporting an error on stop', async () => {
  vi.useFakeTimers()
  let resolve!: (value: RuntimeGatewayStatusV1) => void
  const readStatus = vi.fn((_signal?: AbortSignal) => new Promise<RuntimeGatewayStatusV1>((done) => { resolve = done }))
  const onError = vi.fn()
  const poller = createRuntimeGatewayStatusPollerV4({ readStatus, onStatus: vi.fn(), onError })
  poller.setDemand('monitor')
  await vi.runOnlyPendingTimersAsync()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(readStatus).toHaveBeenCalledTimes(1)
  poller.stop()
  resolve(statusFixtureV1())
  await Promise.resolve()
  expect(onError).not.toHaveBeenCalled()
  vi.useRealTimers()
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/runtime-gateway/v4/runtime-gateway-status-poller-v4.test.ts`

Expected: FAIL because no polling controller exists.

- [ ] **Step 3: Implement the exact controller contract**

```ts
export const RUNTIME_GATEWAY_HEADER_POLL_MS_V4 = 10_000
export const RUNTIME_GATEWAY_MONITOR_POLL_MS_V4 = 2_000
export type RuntimeGatewayStatusPollDemandV4 = 'stopped' | 'header' | 'monitor'

export interface RuntimeGatewayStatusPollerV4 {
  setDemand(demand: RuntimeGatewayStatusPollDemandV4): void
  stop(): void
  status(): Readonly<{
    demand: RuntimeGatewayStatusPollDemandV4
    inFlight: boolean
    nextPollAtMs: number | null
  }>
}

export interface RuntimeGatewayStatusPollerOptionsV4 {
  readonly readStatus: (signal?: AbortSignal) => Promise<RuntimeGatewayStatusV1>
  readonly onStatus: (status: RuntimeGatewayStatusV1) => void
  readonly onError: (error: unknown) => void
  readonly nowMs?: () => number
}

export function createRuntimeGatewayStatusPollerV4(
  options: RuntimeGatewayStatusPollerOptionsV4,
): RuntimeGatewayStatusPollerV4
```

An inactive-to-active demand transition polls immediately. Schedule the next timer only after the current Promise settles, using the latest demand. `monitor` uses 2,000 ms and `header` uses 10,000 ms. A rejected read calls `onError` once and continues at the active cadence. `stop()` clears the timer, aborts the current fetch, prevents late callbacks, and is idempotent. Do not mount the poller from React yet.

- [ ] **Step 4: Run GREEN and check for accidental UI coupling**

```powershell
npm run test:run -- src/features/runtime-gateway/v4/runtime-gateway-status-poller-v4.test.ts
rg -n "react|tsx|document|window" src/features/runtime-gateway/v4/runtime-gateway-status-poller-v4.ts
```

Expected: tests PASS and the dependency scan returns no matches.

- [ ] **Step 5: Commit**

```powershell
git add src/features/runtime-gateway/v4/runtime-gateway-status-poller-v4.ts src/features/runtime-gateway/v4/runtime-gateway-status-poller-v4.test.ts
git diff --cached --check
git commit -m "feat: add gateway status polling backend"
```

### Task 5: Move Docker Gateway Server to 4841 and Correct Operator Guidance

**Files:**
- Modify: `middleware/runtime-gateway/deployment-config.ts:25-30,105-123`
- Test: `middleware/runtime-gateway/deployment-config.test.ts:10-51`
- Modify: `compose.yaml`
- Modify: `middleware/Dockerfile`
- Modify: `scripts/deployment/validate-deployment.mjs:25-30`
- Test: `scripts/deployment/validate-deployment.test.ts:8-78`
- Modify: `scripts/deployment/smoke-deployment.mjs:45-67,128-143`
- Test: `scripts/deployment/smoke-deployment.test.ts`
- Modify: `README.md:33-40,59-68,121-147`
- Modify: `middleware/README.md:7-35`
- Modify: `docs/operator/docker-deployment.md:12-118,120-160`

**Interfaces:**
- Consumes: Task 3 deployment status and existing Compose Web-to-Gateway proxy.
- Produces: native/Docker default Gateway Server endpoint `opc.tcp://127.0.0.1:4841`; Docker Gateway Client route to host PLC `opc.tcp://host.docker.internal:4840` remains Project configuration.

- [ ] **Step 1: Change test expectations first**

```ts
import { readFile } from 'node:fs/promises'

const DEFAULT_CONFIG = {
  gatewayId: 'runtime-gateway',
  runtimeKind: 'native',
  host: '0.0.0.0',
  httpPort: 8081,
  opcUaAdvertisedHost: 'localhost',
  opcUaAdvertisedPort: 4841,
  opcUaPort: 4841,
}

it('requires a Docker runtime kind and the independent 4841 Gateway Server port', async () => {
  await expect(validateDeploymentFiles(resolve('.'))).resolves.toEqual([])
  const compose = await readFile(resolve('compose.yaml'), 'utf8')
  expect(compose).toContain('ROBOTSIM_RUNTIME_KIND: "docker"')
  expect(compose).toContain('${ROBOTSIM_OPCUA_PORT:-4841}:${ROBOTSIM_OPCUA_PORT:-4841}')
  expect(compose).not.toContain('${ROBOTSIM_OPCUA_PORT:-4840}')
})
```

Update smoke assertions so the omitted `opcUaPort` produces `ROBOTSIM_OPCUA_PORT=4841` and the supplied probe receives `opc.tcp://127.0.0.1:4841`.

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- middleware/runtime-gateway/deployment-config.test.ts scripts/deployment/validate-deployment.test.ts scripts/deployment/smoke-deployment.test.ts`

Expected: FAIL because native defaults, Compose, deployment regexes, and smoke orchestration still use 4840 and Compose does not declare Docker runtime kind.

- [ ] **Step 3: Apply the exact deployment topology**

Set `DEFAULT_OPC_UA_PORT = 4841`, `ROBOTSIM_RUNTIME_KIND: "docker"`, every Compose fallback to 4841, `EXPOSE 8081 4841`, every deployment validation regex/message to 4841, and both smoke defaults (`opcUaPort` and `SMOKE_OPCUA_PORT`) to 4841. Keep the container listener and host publication equal; do not add host networking, privileged mode, the Docker socket, or a third service.

The effective Compose lines must be:

```yaml
environment:
  ROBOTSIM_RUNTIME_KIND: "docker"
  ROBOTSIM_GATEWAY_HOST: "0.0.0.0"
  ROBOTSIM_GATEWAY_HTTP_PORT: "8081"
  ROBOTSIM_OPCUA_ADVERTISE_HOST: "${ROBOTSIM_OPCUA_ADVERTISE_HOST:-127.0.0.1}"
  ROBOTSIM_OPCUA_ADVERTISE_PORT: "${ROBOTSIM_OPCUA_PORT:-4841}"
  ROBOTSIM_OPCUA_PORT: "${ROBOTSIM_OPCUA_PORT:-4841}"
ports:
  - "${ROBOTSIM_OPCUA_PORT:-4841}:${ROBOTSIM_OPCUA_PORT:-4841}"
```

- [ ] **Step 4: Rewrite the three operator documents with runnable commands**

Document this exact topology and warning:

```text
Browser                    http://127.0.0.1:8080
Gateway HTTP               runtime-gateway:8081
Gateway OPC UA Client  --> opc.tcp://host.docker.internal:4840  (host PLC Server)
Gateway OPC UA Server  <-- opc.tcp://127.0.0.1:4841             (external PLC Client)
```

```powershell
$env:ROBOTSIM_OPCUA_PORT = '4841'
$env:ROBOTSIM_OPCUA_ADVERTISE_HOST = '127.0.0.1'
docker compose up -d --build --wait
docker compose ps
Invoke-WebRequest http://127.0.0.1:8080/healthz
Invoke-WebRequest http://127.0.0.1:8080/runtime/healthz
Invoke-WebRequest http://127.0.0.1:8080/runtime/readyz
Invoke-WebRequest http://127.0.0.1:8080/runtime/status
```

State explicitly that `opc.tcp://127.0.0.1:4840` inside the Gateway container points back to that container, not to the Windows PLC; Docker Project Endpoints must use `host.docker.internal:4840`. State that changing listener/advertised environment values requires a container restart. Do not describe automatic URL replacement, Settings UI, Client writes, standard Robotics nodes, or Docker-daemon control as implemented.

- [ ] **Step 5: Run deployment GREEN without requiring a live Docker engine**

```powershell
npm run test:run -- middleware/runtime-gateway/deployment-config.test.ts scripts/deployment/validate-deployment.test.ts scripts/deployment/smoke-deployment.test.ts
npm run deploy:validate
docker compose config --quiet
rg -n "OPCUA_PORT:-4840|default.*4840|Server.*4840|host:4840 -> runtime-gateway:4840" compose.yaml middleware/Dockerfile README.md middleware/README.md docs/operator/docker-deployment.md scripts/deployment
```

Expected: tests PASS, deployment validation prints `[deploy] static deployment contract valid`, Compose config exits 0, and the stale-4840 scan returns no matches. References to the external host PLC at `host.docker.internal:4840` are expected and must remain.

- [ ] **Step 6: Run the optional live Docker smoke when Docker Engine is available**

Run: `npm run deploy:smoke:opcua`

Expected: Compose becomes healthy, the browser activates Server mode, and a real `node-opcua` Client reads the Gateway at `opc.tcp://127.0.0.1:4841`. If Docker Engine is unavailable, record that exact external blocker; do not report the live smoke as passed.

- [ ] **Step 7: Commit**

```powershell
git add middleware/runtime-gateway/deployment-config.ts middleware/runtime-gateway/deployment-config.test.ts compose.yaml middleware/Dockerfile scripts/deployment/validate-deployment.mjs scripts/deployment/validate-deployment.test.ts scripts/deployment/smoke-deployment.mjs scripts/deployment/smoke-deployment.test.ts README.md middleware/README.md docs/operator/docker-deployment.md
git diff --cached --check
git commit -m "deploy: separate plc and gateway opc ua ports"
```

### Task 6: Run the Connectivity Stabilization Exit Gate

**Files:**
- Verify only; no production file is modified.

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: review evidence that Milestone 1 is complete without claiming later OPC UA features.

- [ ] **Step 1: Run focused and full repository gates**

```powershell
npm run test:gateway
npm run test:run -- src/core/runtime-protocol/gateway-status-v1.test.ts src/features/runtime-gateway/v4/runtime-gateway-status-poller-v4.test.ts scripts/deployment
npm run lint
npm run build:gateway
node dist-gateway/middleware/runtime-gateway/main.js --check-config
npm run build
npm run deploy:validate
docker compose config --quiet
git diff --check
```

Expected: every command exits 0; `--check-config` reports the native default Server port 4841; no test count is hard-coded.

- [ ] **Step 2: Review the four required state combinations**

Use `middleware/runtime-gateway/main.test.ts` to assert these exact combinations:

```text
No Project: project=not-applied, server=disabled, clients=[]
Off:        project=ready,       server=disabled, clients=[]
Client:     project=ready,       server=disabled, client phase independent
Bridge:     project=ready,       server=listening, client phase independent
```

Expected: a disconnected or reconnecting Client never changes Project readiness, and Bridge's Server remains listening.

- [ ] **Step 3: Inspect only intended changes before handoff**

```powershell
git status --short
git diff --stat
git log -6 --oneline
```

Expected: the five implementation-task commits are visible and Task 6 is recorded as a verification-only ledger entry; unrelated CAD, backup, store, and artifact paths are not staged.
