# OPC UA Settings and Connection Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace blind OPC UA mode switching with a Draft-based, atomically activated Settings workflow, a modeless live Connection Monitor, shared Endpoint/Binding editors, and an operator-safe Docker guide, then make Project V5 the only active browser Project/runtime path.

**Architecture:** Keep canonical configuration in `WorkcellProjectV5`, deployment-owned listener values in `RuntimeGatewayStatusV1`, and unsaved UI edits in a disposable Settings Draft. One V5 publication coordinator owns repository, browser-runtime, and Gateway activation so Settings, New, Import, and every Project mutation have the same rollback boundary. One Project-neutral status poller feeds independent Gateway/OPC UA header state and the modeless Monitor at demand-selected cadences. Object and Robot Binding editors author only shared Endpoint references and Namespace-URI addresses.

**Tech Stack:** TypeScript 6.0.3, React 19.2.7, Zustand 5.0.14, Vitest 4.1.10, Playwright 1.61.1, Dexie 4.4.4, Node.js `>=22.15.1 <23`, npm `>=11.4.2 <12`, Docker Compose v2.

## Global Constraints

- Execute after Milestones 1-4. Consume the exact Milestone 1 `RuntimeGatewayStatusV1` contract, Milestone 2 Project V5 codec/repository/contracts, Milestone 3 browser runtime/Job command result, and Milestone 4 Server diagnostics; do not duplicate them.
- Project V5 is the only active browser contract. Do not add V4 migration, Compatibility Mode, aliases, dual reads/writes, Legacy Adoption, or a hidden fallback to a V4 Project/database/runtime.
- A V4 import must fail at `decodeProjectV5` before repository, browser runtime, Gateway, selection, Job, or Binding state changes. The existing V4 database may remain on disk but the production import graph must never open it.
- `WorkcellProjectV5.opcUa` contains only `mode`, `endpoints`, `mappings`, and `bridgeRoutes`.
- Every persisted Endpoint has exactly `{ endpointId, name, endpointUrl, enabled, publishingIntervalMs, reconnectDelayMs }`. Maximum Endpoints is eight, enforced both in Draft validation and `validateWorkcellProjectV5`.
- Listener bind host/port and advertised host/port are deployment-owned, read-only values from `RuntimeGatewayStatusV1.deployment.opcUaServer`. Never add them to a Project, Draft, Binding, or browser preference.
- Persist every OPC UA address as `OpcUaNodeAddressV1` with Namespace URI, identifier type, and canonical identifier. A pasted `ns=<index>;...` may be converted only through a currently connected Browse Session; it is never persisted directly.
- Object and Robot Binding editors select one shared Endpoint ID. They never re-author Endpoint URL, reconnect delay, or Endpoint publishing defaults.
- `Test Connection` is diagnostic only. It must not mutate the Draft, active Project, repository pointer, Gateway activation, or Binding state.
- `Apply & Activate` validates the complete candidate, stages one revision, activates browser and Gateway resources atomically, and closes only after success. Any validation, preparation, adapter, repository, or finalization failure keeps the Dialog Draft open and leaves the previous active Project/runtime authoritative.
- Use exactly one demand-driven status poller: 10,000 ms with Header-only demand and 2,000 ms while the Monitor is open. Never overlap requests and never create a second timer inside the Header or Monitor.
- The Monitor is modeless: it does not set `aria-modal`, trap focus, pause the Simulation, or cover the entire viewport. The Settings and Binding editors are modal and restore focus on close.
- Docker loopback translation is a warning plus an explicit user action. Never rewrite an Endpoint silently. The Web UI must not use the Docker socket/API, start or stop containers, or claim Project settings change published ports.
- Do not add OPC UA security configuration UI, manufacturer Robot program generation, a physics engine, safety validation claims, or deployment/write actions outside configured Runtime Gateway boundaries.
- Reuse Pretendard and existing tokens in `src/styles/tokens.css`; add only scoped rules to `src/styles/global.css`. Keep comments in English and preserve unrelated user files.
- Every intermediate commit must pass `npm run build`. Before Task 7, a shared generation-v4 shell component may retain a compile-only optional prop/action fallback for the still-active V4 App, but it must not expose a Legacy toggle or data conversion; Task 7 removes the fallback from the production graph.
- Every Task follows RED, focused GREEN, `git diff --check`, and one behavior-oriented commit. Do not stage external CAD directories, local logs, `.pnpm-store`, or unrelated dirty files.

---

## Fixed Cross-Task Interfaces

These interfaces are owned by this plan and consumed verbatim by later Tasks.

```ts
export type OpcUaSettingsDraftPhaseV1 = 'editing' | 'validating' | 'activating' | 'failed'

export interface OpcUaSettingsDraftV1 {
  readonly baseProjectRevisionId: string
  readonly mode: WorkcellProjectV5['opcUa']['mode']
  readonly endpoints: readonly OpcUaEndpointV5[]
  readonly bridgeRoutes: WorkcellProjectV5['opcUa']['bridgeRoutes']
}

export interface OpcUaSettingsValidationIssueV1 {
  readonly code: string
  readonly path: string
  readonly message: string
}

export interface PublishedProjectV5 {
  readonly project: WorkcellProjectV5
  readonly revisionId: string
  readonly configRevision: string
}

export interface ProjectV5AtomicMutationPort {
  readPublished(): PublishedProjectV5 | null
  mutate(request: {
    readonly expectedRevisionId: string
    readonly description: string
    readonly recipe: (active: WorkcellProjectV5) => WorkcellProjectV5
  }): Promise<PublishedProjectV5>
}

export interface OpcUaSettingsActivationServiceV1 {
  apply(draft: OpcUaSettingsDraftV1): Promise<PublishedProjectV5>
}

export interface RuntimeGatewayStatusPollerV1 {
  setDemand(demand: 'stopped' | 'header' | 'monitor'): void
  stop(): void
  status(): {
    readonly demand: 'stopped' | 'header' | 'monitor'
    readonly inFlight: boolean
    readonly nextPollAtMs: number | null
  }
}

export interface RuntimeConnectivitySnapshotV1 {
  readonly status: RuntimeGatewayStatusV1
  readonly integrationDiagnostics: RuntimeIntegrationDiagnosticsV1
}

export type GatewayHeaderStateV1 = 'online' | 'offline' | 'activating' | 'error'
export type OpcUaHeaderStateV1 =
  | 'off'
  | 'client-connected'
  | 'client-degraded'
  | 'server-listening'
  | 'bridge-connected'
  | 'bridge-degraded'
  | 'error'

export interface ConnectivityPresentationStateV1 {
  readonly gateway: { readonly state: GatewayHeaderStateV1; readonly label: string; readonly detail: string }
  readonly opcUa: { readonly state: OpcUaHeaderStateV1; readonly label: string; readonly detail: string }
  readonly status: RuntimeGatewayStatusV1 | null
  readonly transportError: string | null
  readonly lastObservedAtMs: number | null
}

export interface ConnectionMonitorRowV1 {
  readonly id: string
  readonly component: string
  readonly state: string
  readonly endpoint: string | null
  readonly lastUpdateAtMs: number | null
  readonly quality: string | null
  readonly error: { readonly code: string; readonly message: string; readonly occurredAtMs: number } | null
  readonly details: readonly { readonly label: string; readonly value: string }[]
}

export interface NamespaceIndexResolutionPortV1 {
  resolve(endpointId: string, sessionNodeId: string): Promise<OpcUaNodeAddressV1>
}

export type BindingEditorTargetV1 =
  | { readonly kind: 'object'; readonly entityId: string }
  | { readonly kind: 'robot'; readonly robotId: string }

export interface OpcUaConnectionTestPortV1 {
  testEndpoint(endpoint: OpcUaEndpointV5): Promise<{
    readonly phase: 'connected' | 'failed'
    readonly namespaceUris: readonly string[]
    readonly elapsedMs: number
    readonly error: string | null
  }>
}
```

## File Structure

**Create:**

- `src/features/connectivity/v5/opcua-settings-draft.ts` and test — pure Draft copy/edit/validation, Endpoint duplication, loopback warning, and complete V5 candidate recipe.
- `src/features/connectivity/v5/opcua-settings-activation.ts` and test — one atomic mutation boundary and failure-preserving Settings controller.
- `src/features/connectivity/v5/connectivity-presentation-store.ts` and test — decoded status/error state and independent Gateway/OPC UA presentation.
- `src/features/runtime-gateway/v5/runtime-integration-diagnostics-client.ts` and test — same-origin closed read of Milestone 4 `/runtime/integration-diagnostics`.
- `src/features/connectivity/v5/OpcUaSettingsDialog.tsx` and test — modal Overview, Client Endpoints, Server, Bridge Routes, and Diagnostics/Docker sections.
- `middleware/runtime-gateway/opcua-connection-test.ts` and test — isolated diagnostic OPC UA Client connect/NamespaceArray/disconnect flow.
- `src/features/runtime-gateway/v5/runtime-gateway-connection-test.ts` and test — same-origin `OpcUaConnectionTestPortV1` implementation.
- `src/features/connectivity/v5/connection-monitor-model.ts` and test — stable Monitor rows from status plus last outgoing command result.
- `src/features/connectivity/v5/ConnectionMonitorPanel.tsx` and test — modeless live diagnostics panel.
- `src/features/connectivity/v5/opcua-node-address-draft.ts` and test — canonical Namespace-URI address editing and live Namespace Index resolution.
- `middleware/runtime-gateway/opcua-node-address-resolver.ts` and test — resolve a connected Session's Namespace Index into a canonical URI address.
- `src/features/runtime-gateway/v5/runtime-gateway-node-address-resolver.ts` and test — same-origin browser port for live Node address resolution.
- `src/features/connectivity/v5/BindingEditorDialog.tsx` and test — Object/Robot shared-Endpoint Mapping editor.
- `src/features/connectivity/v5/BindingOverviewDialog.tsx` and test — read-only, target-addressable Mapping inventory.
- `src/features/connectivity/v5/docker-run-guide.ts` and test — deterministic native/Docker warnings and copyable commands.
- `src/features/connectivity/v5/DockerRunGuideDialog.tsx` and test — operator guide without daemon controls.
- `src/features/project/v5/project-v5-publication.ts` and test — repository/browser/Gateway atomic publication used by every active browser mutation.
- `src/features/project/v5/project-v5-mutation-service.ts` and test — serialized expected-revision V5 mutations.
- `src/features/project/v5/project-store-v5.ts` and test — Hydrate/New/Save/Export/Import V5 store.
- `src/features/project/v5/default-project-v5.ts` and test — minimal valid new Project V5.
- `src/features/project/v5/project-file-command-port-v5.ts` and test — V5 JSON picker/download boundary.
- `src/features/project/v5/browser-project-resources-v5.ts` and test — production V5 repository/runtime/Gateway composition.
- `src/features/runtime-gateway/v5/runtime-gateway-connectivity-client.ts` and test — V5 activation, status, Test Connection, and Namespace-resolution HTTP boundary.
- `middleware/runtime-gateway/connectivity-diagnostics-routes.ts` and test — bounded diagnostic Test/Namespace routes with no Project mutation.
- `src/app/v5/initial-project-bootstrap-v5.ts` and test — V5-only hydrate/new bootstrap.
- `src/app/v5/AppV5.tsx` and test — active browser composition for V5 Scene, Jobs, Bindings, Settings, and Monitor.
- `src/features/scene/v5/V5WorkcellWorkspace.tsx` and test — V5 Scene/selection/Inspector surface used by the active App.
- `src/features/jobs/v5/RobotJobWorkspaceV5.tsx` and test — V5 Job list/operator surface using Milestone 3 runtime.
- `src/app/v5-production-import-graph.test.ts` — proves the `src/main.tsx` graph cannot reach Project/runtime V4.
- `tests/project-v5-browser-cutover.spec.ts` — browser V5 New/Save/Export/Import/reload and V4 rejection.
- `tests/opcua-settings-monitor.spec.ts` — browser Settings, Monitor, Binding, loopback, and rollback acceptance.

**Move and rename:**

- `src/features/runtime-gateway/v4/runtime-gateway-status-poller-v4.ts` to `src/features/runtime-gateway/runtime-gateway-status-poller.ts`.
- `src/features/runtime-gateway/v4/runtime-gateway-status-poller-v4.test.ts` to `src/features/runtime-gateway/runtime-gateway-status-poller.test.ts`.

**Modify:**

- `src/features/ui/v4/app-header-status.ts` and test — consume `ConnectivityPresentationStateV1` and expose split status.
- `src/features/ui/v4/StudioHeaderV4.tsx` and test — separate Gateway and OPC UA controls opening the Monitor.
- `src/features/scene/v4/SceneEntityInspector.tsx` and test — remove the active per-Object URL/raw Node ID editor; the production V5 Inspector uses the shared editor.
- `src/features/scene/v4/SceneContextMenu.tsx` and test — retain `Open Binding` behavior through the shared editor command while the active App cuts over.
- `src/app/v4/app-command-composition.ts` and test — replace direct mode radio actions with Settings, Monitor, Binding Overview, and Docker Guide commands.
- `src/features/ui/v4/app-menu-model.ts` and test, `src/features/ui/v4/AppMenuBarV4.tsx` and test, and `src/features/ui/v4/CompactAppMenuV4.tsx` and test — present the Connectivity commands consistently in wide/compact layouts.
- `src/features/help/v4/local-help-controller.ts` and test and `src/features/help/v4/LocalHelpPanelV4.tsx` and test — add Settings, Monitor, Binding, and Docker help topics.
- `src/app/App.tsx`, `src/app/App.test.tsx`, `src/app/App.runtime-gateway.test.tsx`, and `src/app/App.scene-status.test.tsx` — replace the active implementation with the V5 composition/export and delete V4-only expectations.
- `src/app/AppShell.tsx` and test — mount the modeless Monitor without changing dock geometry or focus ownership.
- `middleware/runtime-gateway/opcua-client-adapter.ts` and test — expose connected-Session Namespace resolution without persisting indexes.
- `middleware/runtime-gateway/main.ts` and test — closed `/runtime/opcua/resolve-node-address` diagnostic route.
- `src/features/project/v5/browser-project-runtime-v5.ts` and test — expose publication prepare/apply/commit/rollback over Milestone 3 resources.
- `middleware/runtime-gateway/main.ts` and test — mount the bounded connectivity diagnostics routes.
- `src/main.tsx` — continue to render `App`, which now resolves only to `AppV5`.
- `src/styles/global.css` — scoped Settings, Monitor, Binding, split status, and run-guide rules.
- `docs/operator/opcua-object-binding.md` and `docs/operator/docker-deployment.md` — shared Endpoint/Namespace-URI workflow and exact topology.
- `README.md` — V5-only browser data boundary and entry points to the operator guides.
- `package.json` — focused `test:connectivity-ui` and V5 Playwright scripts; remove V4 E2E from the default gate.

---

### Task 1: Build the Pure Settings Draft and Atomic Activation Coordinator

**Files:**

- Create: `src/features/connectivity/v5/opcua-settings-draft.ts`
- Test: `src/features/connectivity/v5/opcua-settings-draft.test.ts`
- Create: `src/features/connectivity/v5/opcua-settings-activation.ts`
- Test: `src/features/connectivity/v5/opcua-settings-activation.test.ts`

**Interfaces:**

- Consumes: `WorkcellProjectV5`, `OpcUaEndpointV5`, `validateWorkcellProjectV5`, `MAX_OPC_UA_ENDPOINTS_V5`, and `ProjectV5AtomicMutationPort`.
- Produces: `OpcUaSettingsDraftV1`, pure Draft edit helpers, `validateOpcUaSettingsDraftV1`, `createOpcUaSettingsCandidateRecipeV1`, `OpcUaSettingsActivationServiceV1`, and `OpcUaSettingsControllerV1`.

- [ ] **Step 1: Write RED Draft isolation, limit, loopback, and validation tests**

```ts
it('copies only Project-owned OPC UA fields into a disposable Draft', () => {
  const draft = createOpcUaSettingsDraftV1(project)
  expect(draft).toEqual({
    baseProjectRevisionId: project.revisionId,
    mode: project.opcUa.mode,
    endpoints: project.opcUa.endpoints,
    bridgeRoutes: project.opcUa.bridgeRoutes,
  })
  expect(JSON.stringify(draft)).not.toContain('advertisedHost')
  expect(JSON.stringify(draft)).not.toContain('bindHost')
})

it('accepts exactly eight shared Endpoints and rejects the ninth', () => {
  expect(validateOpcUaSettingsDraftV1(draftWithEndpointCount(8), project)).toEqual([])
  expect(validateOpcUaSettingsDraftV1(draftWithEndpointCount(9), project))
    .toContainEqual(expect.objectContaining({ code: 'OPC_UA_ENDPOINT_LIMIT_EXCEEDED' }))
})

it('warns but does not rewrite a Docker loopback Client URL', () => {
  const source = 'opc.tcp://127.0.0.1:4840'
  expect(dockerLoopbackWarningV1('docker', source)).toMatchObject({
    replacementUrl: 'opc.tcp://host.docker.internal:4840',
  })
  expect(source).toBe('opc.tcp://127.0.0.1:4840')
})
```

- [ ] **Step 2: Write RED atomic Apply failure tests**

```ts
it.each(['validation', 'prepare', 'gateway', 'commit', 'finalize'] as const)(
  'keeps the prior publication and open Draft when %s fails',
  async (failurePoint) => {
    const harness = atomicSettingsHarness({ failurePoint })
    harness.controller.open(harness.active.project)
    harness.controller.update((draft) => ({ ...draft, mode: 'bridge' }))
    await expect(harness.controller.applyAndActivate()).rejects.toThrow()
    expect(harness.publication.readPublished()).toEqual(harness.active)
    expect(harness.gateway.activeRevisionId()).toBe(harness.active.revisionId)
    expect(harness.controller.getState()).toMatchObject({ open: true, phase: 'failed' })
  },
)
```

- [ ] **Step 3: Run the focused tests and confirm RED**

```powershell
npm run test:run -- src/features/connectivity/v5/opcua-settings-draft.test.ts src/features/connectivity/v5/opcua-settings-activation.test.ts
```

Expected: FAIL because the Draft and activation modules do not exist.

- [ ] **Step 4: Implement pure Draft operations and complete-candidate validation**

Implement immutable `addEndpoint`, `duplicateEndpoint`, `updateEndpoint`, `deleteEndpoint`, `replaceLoopbackHost`, and Bridge-route helpers. Duplicate creates a caller-supplied stable ID, appends ` Copy` to the Name, copies only the six Endpoint fields, and never duplicates Mappings. Delete returns `OPC_UA_ENDPOINT_IN_USE` while any Mapping references the Endpoint. Disable Add at eight, but still reject nine at the pure validation boundary.

`validateOpcUaSettingsDraftV1(draft, active)` must build one candidate by replacing only `active.opcUa.mode/endpoints/bridgeRoutes` while retaining `active.opcUa.mappings`, then call `validateWorkcellProjectV5`. Convert stable validator errors, including endpoint, aggregate update-budget, Mapping-reference, Bridge self-reference, and Bridge-cycle errors, to ordered `OpcUaSettingsValidationIssueV1[]`. It must not generate a revision or mutate `active`.

- [ ] **Step 5: Implement the atomic service and state controller**

```ts
export interface OpcUaSettingsControllerV1 {
  getState(): {
    readonly open: boolean
    readonly phase: OpcUaSettingsDraftPhaseV1
    readonly draft: OpcUaSettingsDraftV1 | null
    readonly issues: readonly OpcUaSettingsValidationIssueV1[]
    readonly error: string | null
  }
  subscribe(listener: () => void): () => void
  open(project: WorkcellProjectV5): void
  update(recipe: (draft: OpcUaSettingsDraftV1) => OpcUaSettingsDraftV1): void
  cancel(): void
  applyAndActivate(): Promise<PublishedProjectV5>
}
```

`OpcUaSettingsActivationServiceV1.apply` checks the Draft base revision against `readPublished`, validates before calling the port, and invokes exactly one `ProjectV5AtomicMutationPort.mutate` with description `Apply OPC UA Settings`. The recipe replaces only `opcUa.mode/endpoints/bridgeRoutes`; the shared V5 mutation service creates metadata/revision values and validates the full candidate. Close and clear the Draft only after the returned publication is authoritative. Preserve the Draft and surface stable issues/errors on every failure.

- [ ] **Step 6: Run GREEN and commit**

```powershell
npm run test:run -- src/features/connectivity/v5/opcua-settings-draft.test.ts src/features/connectivity/v5/opcua-settings-activation.test.ts
npm run lint
npm run build
git add src/features/connectivity/v5/opcua-settings-draft.ts src/features/connectivity/v5/opcua-settings-draft.test.ts src/features/connectivity/v5/opcua-settings-activation.ts src/features/connectivity/v5/opcua-settings-activation.test.ts
git diff --cached --check
git commit -m "feat: add atomic opc ua settings draft"
```

Expected: exact-eight/plus-one, in-use deletion, cycle, update budget, stale revision, every publication failure point, Cancel, and successful close tests PASS.

### Task 2: Rehome the Poller and Split Gateway from OPC UA Header State

**Files:**

- Move: `src/features/runtime-gateway/v4/runtime-gateway-status-poller-v4.ts` to `src/features/runtime-gateway/runtime-gateway-status-poller.ts`
- Move test: `src/features/runtime-gateway/v4/runtime-gateway-status-poller-v4.test.ts` to `src/features/runtime-gateway/runtime-gateway-status-poller.test.ts`
- Create: `src/features/connectivity/v5/connectivity-presentation-store.ts`
- Test: `src/features/connectivity/v5/connectivity-presentation-store.test.ts`
- Create: `src/features/runtime-gateway/v5/runtime-integration-diagnostics-client.ts`
- Test: `src/features/runtime-gateway/v5/runtime-integration-diagnostics-client.test.ts`
- Modify: `src/features/ui/v4/app-header-status.ts`
- Test: `src/features/ui/v4/app-header-status.test.ts`
- Modify: `src/features/ui/v4/StudioHeaderV4.tsx`
- Test: `src/features/ui/v4/StudioHeaderV4.test.tsx`

**Interfaces:**

- Consumes: Milestone 1 `RuntimeGatewayStatusV1`, Milestone 4 `RuntimeIntegrationDiagnosticsV1`, both decoders/HTTP routes, and exact 2,000/10,000 ms behavior.
- Produces: Project-neutral `RuntimeGatewayStatusPollerV1`, one `RuntimeConnectivitySnapshotV1` read per cadence, `ConnectivityPresentationStoreV1`, split Header read model, and Monitor-open command callback.

- [ ] **Step 1: Write RED poll-demand and independent-status tests**

```ts
it('uses one immediate poll then 10s Header and 2s Monitor demands without overlap', async () => {
  const harness = statusPresentationHarness()
  harness.store.startHeader()
  expect(harness.fetchStatus).toHaveBeenCalledTimes(1)
  await harness.advance(9_999)
  expect(harness.fetchStatus).toHaveBeenCalledTimes(1)
  await harness.advance(1)
  expect(harness.fetchStatus).toHaveBeenCalledTimes(2)
  harness.store.setMonitorOpen(true)
  await harness.advance(2_000)
  expect(harness.maxConcurrentRequests()).toBe(1)
})

it('never presents Off and Ready as one state', () => {
  const state = deriveConnectivityPresentationV1(statusWith({ mode: 'off', projectPhase: 'ready' }))
  expect(state.gateway.label).toBe('Online')
  expect(state.opcUa.label).toBe('Off')
  expect(`${state.opcUa.label} ${state.gateway.label}`).not.toContain('Off · Ready')
})
```

Add table tests for offline transport, activating local publication, Server disabled/listening/faulted, Client all-connected/degraded/faulted, and Bridge listener plus Endpoint combinations.

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
npm run test:run -- src/features/runtime-gateway/runtime-gateway-status-poller.test.ts src/features/runtime-gateway/v5/runtime-integration-diagnostics-client.test.ts src/features/connectivity/v5/connectivity-presentation-store.test.ts src/features/ui/v4/app-header-status.test.ts src/features/ui/v4/StudioHeaderV4.test.tsx
```

Expected: FAIL because the neutral poller/store and split Header model do not exist.

- [ ] **Step 3: Rehome, rename, and preserve the one poller implementation**

Move the Milestone 1 implementation; rename its public suffixes from `V4` to `V1`, keep `RUNTIME_GATEWAY_HEADER_POLL_MS_V1 = 10_000` and `RUNTIME_GATEWAY_MONITOR_POLL_MS_V1 = 2_000`, and update imports. Delete the old source path after the move. Replace its injected status-only read with one `readConnectivitySnapshot(signal)` operation that fetches and validates `/runtime/status` and `/runtime/integration-diagnostics` under the same AbortSignal and returns only when both belong to the same non-null `configRevision` (or both report no active Project); a mismatch is a retained-detail transport error, not a mixed snapshot. Activation polls immediately; next scheduling begins only after the current request settles; `stop` aborts and clears scheduling.

`ConnectivityPresentationStoreV1` owns this one poller, the latest decoded status and integration diagnostics, transport error, and a local publication phase override. `startHeader()` selects Header demand, `setMonitorOpen(true)` selects Monitor demand, closing returns to Header demand, and `dispose()` stops it. A transport failure changes Gateway to Offline within one active cadence while retaining the last decoded details for diagnostics only.

- [ ] **Step 4: Derive and render independent Header states**

Gateway is Online only from a successfully decoded status, Offline on fetch failure, Activating during a local atomic publication, and Error after a local publication error. OPC UA is Off only in mode `off`; Client Connected requires every enabled required Endpoint connected; Server Listening requires listener phase `listening`; healthy Bridge requires both; partial Bridge is degraded; adapter faults are Error. Project readiness appears as detail, never as the OPC UA role label.

Add a compile-compatible optional `connectivity` read model to the shared Header while the V4 App remains active. When supplied, replace the one `Gateway details` disclosure with two status buttons named `Gateway: <label>` and `OPC UA: <label>`; both invoke `onConnectionMonitorOpen`, neither owns a second disclosure/dialog, and narrow layout uses compact text with full accessible names. The temporary absent-prop path keeps the current App buildable only until Task 7; it is not a selectable compatibility mode.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/runtime-gateway/runtime-gateway-status-poller.test.ts src/features/runtime-gateway/v5/runtime-integration-diagnostics-client.test.ts src/features/connectivity/v5/connectivity-presentation-store.test.ts src/features/ui/v4/app-header-status.test.ts src/features/ui/v4/StudioHeaderV4.test.tsx
npm run lint
npm run build
git add src/features/runtime-gateway/v4/runtime-gateway-status-poller-v4.ts src/features/runtime-gateway/v4/runtime-gateway-status-poller-v4.test.ts src/features/runtime-gateway/runtime-gateway-status-poller.ts src/features/runtime-gateway/runtime-gateway-status-poller.test.ts src/features/runtime-gateway/v5/runtime-integration-diagnostics-client.ts src/features/runtime-gateway/v5/runtime-integration-diagnostics-client.test.ts src/features/connectivity/v5/connectivity-presentation-store.ts src/features/connectivity/v5/connectivity-presentation-store.test.ts src/features/ui/v4/app-header-status.ts src/features/ui/v4/app-header-status.test.ts src/features/ui/v4/StudioHeaderV4.tsx src/features/ui/v4/StudioHeaderV4.test.tsx
git diff --cached --check
git commit -m "feat: split gateway and opc ua status"
```

Expected: one-poller cadence, abort/no-overlap, every derivation table case, wide/narrow accessible Header controls, and Monitor-open callback tests PASS.

### Task 3: Build the Draft-Based OPC UA Settings Modal

**Files:**

- Create: `middleware/runtime-gateway/opcua-connection-test.ts`
- Test: `middleware/runtime-gateway/opcua-connection-test.test.ts`
- Create: `src/features/runtime-gateway/v5/runtime-gateway-connection-test.ts`
- Test: `src/features/runtime-gateway/v5/runtime-gateway-connection-test.test.ts`
- Create: `src/features/connectivity/v5/OpcUaSettingsDialog.tsx`
- Test: `src/features/connectivity/v5/OpcUaSettingsDialog.test.tsx`
- Modify: `middleware/runtime-gateway/main.ts`
- Test: `middleware/runtime-gateway/main.test.ts`
- Modify: `src/styles/global.css`

**Interfaces:**

- Consumes: Task 1 controller, `OpcUaConnectionTestPortV1`, Task 2 presentation state, V5 Mapping counts, and deployment status.
- Produces: Gateway-backed diagnostic-only `OpcUaConnectionTestPortV1` and one modal Settings surface with Overview, Client Endpoints, Server, Bridge Routes, and Diagnostics/Docker sections.

- [ ] **Step 1: Write RED accessibility, Draft, and Endpoint behavior tests**

```tsx
it('cancels without mutation and restores focus', async () => {
  renderSettingsHarness()
  await user.click(screen.getByRole('button', { name: 'OPC UA Settings' }))
  await user.selectOptions(screen.getByLabelText('OPC UA role'), 'bridge')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(mutationPort.mutate).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'OPC UA Settings' })).toHaveFocus()
})

it('shows read-only deployment Server values outside the Draft', () => {
  renderSettingsHarness({ status: dockerListeningStatus() })
  expect(screen.getByLabelText('Listener port')).toHaveValue('4841')
  expect(screen.getByLabelText('Listener port')).toHaveAttribute('readonly')
  expect(screen.getByLabelText('Advertised host')).toHaveAttribute('readonly')
})

it('disables Add at eight and reports an imported plus-one Draft', () => {
  renderSettingsHarness({ draft: draftWithEndpointCount(8) })
  expect(screen.getByRole('button', { name: 'Add Endpoint' })).toBeDisabled()
})
```

Also test Duplicate, in-use Delete, Binding count/Open Overview, diagnostic-only Test Connection, Docker loopback warning with explicit replacement, Bridge immediate cycle errors, Apply busy state, failed Apply preserving fields, Escape/overlay Cancel, and successful close.

Add a real local diagnostic test proving the temporary Client reads `Server_NamespaceArray`, closes its Session/connection in `finally`, and leaves the active Gateway Project/adapters unchanged. Timeout, malformed URL, connect failure, and cleanup failure return stable diagnostic errors without saving the Draft.

- [ ] **Step 2: Run the component test and confirm RED**

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-connection-test.test.ts middleware/runtime-gateway/main.test.ts src/features/runtime-gateway/v5/runtime-gateway-connection-test.test.ts src/features/connectivity/v5/OpcUaSettingsDialog.test.tsx
```

Expected: FAIL because the isolated diagnostic service/route/browser port and Dialog do not exist.

- [ ] **Step 3: Implement diagnostic-only Test Connection**

Create a temporary anonymous None/None `OPCUAClient` with `maxRetry: 0` and a five-second total timeout. Connect, create one Session, read `Server_NamespaceArray`, and close Session/Client in `finally`; never reuse or modify an active subscription adapter. Expose a closed `POST /runtime/opcua/test-connection` request containing exactly one Draft `OpcUaEndpointV5` and a response matching `OpcUaConnectionTestPortV1`. Cap the request at 64 KiB and allow one in-flight test per browser request. The browser port uses the same-origin route and an AbortSignal.

- [ ] **Step 4: Implement modal structure and focus lifecycle**

Use `role="dialog"`, `aria-modal="true"`, labelled title, initial focus on the role selector, Escape handling when not applying, focus containment, and trigger focus return. Keep the footer visible while the body scrolls. Do not close on invalid or failed Apply.

Overview shows active/Draft revision, Off/Client/Server/Bridge selection, direction explanation, and changed-section count. Client Endpoints uses a selected-profile list plus the exact six fields and Test/Duplicate/Delete actions. Display Mapping count and Open Binding Overview. Test results stay runtime-only.

Server displays listener phase and endpoint from `RuntimeGatewayStatusV1`, standard Robotics/product branches from the Milestone 4 diagnostics read model, and deployment host/port values as read-only. Bridge Routes edit explicit source/destination Mapping IDs, scale, offset, and unit and show pure validator issues. Diagnostics shows runtime kind, health paths, loopback warning, and an Open Docker Run Guide action; it does not expose container controls.

- [ ] **Step 5: Wire Apply and deterministic issue focus**

Apply calls the Task 1 controller once. On validation failure, focus the first issue by stable `path`; on async failure show one alert and retain all Draft inputs; on success close and return focus. Disable Cancel, Apply, Endpoint actions, and role editing only during `validating/activating`.

- [ ] **Step 6: Run GREEN and commit**

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-connection-test.test.ts middleware/runtime-gateway/main.test.ts src/features/runtime-gateway/v5/runtime-gateway-connection-test.test.ts src/features/connectivity/v5/OpcUaSettingsDialog.test.tsx src/features/connectivity/v5/opcua-settings-draft.test.ts src/features/connectivity/v5/opcua-settings-activation.test.ts
npm run lint
npm run build:gateway
npm run build
git add middleware/runtime-gateway/opcua-connection-test.ts middleware/runtime-gateway/opcua-connection-test.test.ts middleware/runtime-gateway/main.ts middleware/runtime-gateway/main.test.ts src/features/runtime-gateway/v5/runtime-gateway-connection-test.ts src/features/runtime-gateway/v5/runtime-gateway-connection-test.test.ts src/features/connectivity/v5/OpcUaSettingsDialog.tsx src/features/connectivity/v5/OpcUaSettingsDialog.test.tsx src/styles/global.css
git diff --cached --check
git commit -m "feat: add opc ua settings dialog"
```

Expected: all modal, section, exact-eight, read-only deployment, diagnostic-only Test, rollback, issue-focus, and responsive scroll tests PASS.

### Task 4: Add the Modeless Connection Monitor

**Files:**

- Create: `src/features/connectivity/v5/connection-monitor-model.ts`
- Test: `src/features/connectivity/v5/connection-monitor-model.test.ts`
- Create: `src/features/connectivity/v5/ConnectionMonitorPanel.tsx`
- Test: `src/features/connectivity/v5/ConnectionMonitorPanel.test.tsx`
- Modify: `src/app/AppShell.tsx`
- Test: `src/app/AppShell.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**

- Consumes: Task 2 `ConnectivityPresentationStateV1` plus `RuntimeConnectivitySnapshotV1`, including proxy transport failure, decoded `RuntimeGatewayStatusV1`, Milestone 4 model/Session/lease diagnostics, and the retained last `CommandResultV1`.
- Produces: stable `ConnectionMonitorRowV1[]` and one modeless panel whose open state drives Monitor poll demand.

- [ ] **Step 1: Write RED row-projection tests**

```ts
it('projects proxy, Gateway, Project, Server, and every Client Endpoint in stable order', () => {
  const rows = connectionMonitorRowsV1(
    presentationWithSnapshot(connectivitySnapshotWithTwoEndpoints()),
  )
  expect(rows.map(({ id }) => id)).toEqual([
    'web-proxy', 'gateway', 'project', 'opcua-server', 'server-model',
    'browser-publisher', 'opcua-client:plc-a', 'opcua-client:plc-b', 'outgoing-command',
  ])
  expect(rows[4]).toMatchObject({
    state: 'Reconnecting',
    details: expect.arrayContaining([
      { label: 'Session', value: 'Inactive' },
      { label: 'Subscription', value: 'Inactive' },
    ]),
  })
})
```

Cover standard NodeSet/Robotics/product readiness, active/maximum Server Sessions, browser publisher phase/generation/expiry, monitored item/Mapping counts, last notification/GOOD timestamps, reconnect attempt/next retry, quality, error code/message/time, no-command state, proxy failure, cross-revision snapshot rejection, and retained details marked stale.

- [ ] **Step 2: Write RED modeless/poll-demand tests**

```tsx
it('stays modeless and changes the one poller demand', async () => {
  renderMonitorHarness()
  await user.click(screen.getByRole('button', { name: 'Connection Monitor' }))
  const panel = screen.getByRole('complementary', { name: 'Connection Monitor' })
  expect(panel).not.toHaveAttribute('aria-modal')
  expect(statusStore.getState().demand).toBe('monitor')
  await user.click(screen.getByRole('button', { name: 'Close Connection Monitor' }))
  expect(statusStore.getState().demand).toBe('header')
  expect(viewportCanvas).not.toHaveAttribute('aria-hidden', 'true')
})
```

- [ ] **Step 3: Run focused tests and confirm RED**

```powershell
npm run test:run -- src/features/connectivity/v5/connection-monitor-model.test.ts src/features/connectivity/v5/ConnectionMonitorPanel.test.tsx src/app/AppShell.test.tsx
```

Expected: FAIL because the model and panel do not exist.

- [ ] **Step 4: Implement stable rows and the modeless panel**

Render `Component | State | Endpoint | Last update | Quality | Error` at desktop width and labelled term/value cards at compact width. Expanding a row reveals only the fixed `details` array. Use absolute/docked shell placement that leaves the 3D viewport interactive, `role="complementary"`, no backdrop, no focus trap, and no Simulation pause. Closing restores focus only when its opener still exists.

On open call `setMonitorOpen(true)` before render; on close/unmount call `setMonitorOpen(false)`. Show fetch errors without deleting last good diagnostic fields. Timestamps use one injected formatter for deterministic tests. Until Task 7 mounts V5 resources, `AppShell` accepts the Monitor node/port as an optional shell slot whose absent path renders nothing and keeps the current App buildable; it is not a user-selectable compatibility path.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/connectivity/v5/connection-monitor-model.test.ts src/features/connectivity/v5/ConnectionMonitorPanel.test.tsx src/app/AppShell.test.tsx
npm run lint
npm run build
git add src/features/connectivity/v5/connection-monitor-model.ts src/features/connectivity/v5/connection-monitor-model.test.ts src/features/connectivity/v5/ConnectionMonitorPanel.tsx src/features/connectivity/v5/ConnectionMonitorPanel.test.tsx src/app/AppShell.tsx src/app/AppShell.test.tsx src/styles/global.css
git diff --cached --check
git commit -m "feat: add live connection monitor"
```

Expected: every status field is visible, disconnect appears within one 2-second cadence, closing returns to 10 seconds, viewport interaction remains enabled, and all accessibility tests PASS.

### Task 5: Centralize Object and Robot Binding Editing

**Files:**

- Create: `src/features/connectivity/v5/opcua-node-address-draft.ts`
- Test: `src/features/connectivity/v5/opcua-node-address-draft.test.ts`
- Create: `middleware/runtime-gateway/opcua-node-address-resolver.ts`
- Test: `middleware/runtime-gateway/opcua-node-address-resolver.test.ts`
- Create: `src/features/runtime-gateway/v5/runtime-gateway-node-address-resolver.ts`
- Test: `src/features/runtime-gateway/v5/runtime-gateway-node-address-resolver.test.ts`
- Create: `src/features/connectivity/v5/BindingEditorDialog.tsx`
- Test: `src/features/connectivity/v5/BindingEditorDialog.test.tsx`
- Create: `src/features/connectivity/v5/BindingOverviewDialog.tsx`
- Test: `src/features/connectivity/v5/BindingOverviewDialog.test.tsx`
- Modify: `src/features/scene/v4/SceneEntityInspector.tsx`
- Test: `src/features/scene/v4/SceneEntityInspector.test.tsx`
- Modify: `src/features/scene/v4/SceneContextMenu.tsx`
- Test: `src/features/scene/v4/SceneContextMenu.test.tsx`
- Modify: `middleware/runtime-gateway/opcua-client-adapter.ts`
- Test: `middleware/runtime-gateway/opcua-client-adapter.test.ts`
- Modify: `middleware/runtime-gateway/main.ts`
- Test: `middleware/runtime-gateway/main.test.ts`

**Interfaces:**

- Consumes: shared V5 Endpoints/Mappings, `OpcUaNodeAddressV1`, active Gateway Client Sessions, and the Task 1 atomic mutation port.
- Produces: Gateway-backed `NamespaceIndexResolutionPortV1`, one Binding editor for Object and Robot targets, `Open Binding` context behavior, and one Mapping inventory.

- [ ] **Step 1: Write RED stable-address and disconnected-resolution tests**

```ts
it('persists Namespace URI rather than the live Namespace Index', async () => {
  resolver.resolve.mockResolvedValue({
    namespaceUri: 'urn:virtual-plc', identifierType: 'string', identifier: 'ObjectPos',
  })
  const address = await resolveSessionNodeIdDraftV1('plc-a', 'ns=2;s=ObjectPos', resolver)
  expect(address).toEqual({
    namespaceUri: 'urn:virtual-plc', identifierType: 'string', identifier: 'ObjectPos',
  })
  expect(JSON.stringify(address)).not.toContain('ns=2')
})

it('rejects a Namespace Index paste while no Browse Session exists', async () => {
  resolver.resolve.mockRejectedValue(new Error('OPC_UA_BROWSE_SESSION_UNAVAILABLE'))
  await expect(resolveSessionNodeIdDraftV1('plc-a', 'ns=2;s=ObjectPos', resolver))
    .rejects.toThrow('OPC_UA_BROWSE_SESSION_UNAVAILABLE')
})

it('resolves the current Session index to a stable URI without persisting ns=', async () => {
  const address = await resolver.resolve('plc-a', 'ns=2;s=ObjectPos')
  expect(address).toEqual({
    namespaceUri: 'urn:virtual-plc', identifierType: 'string', identifier: 'ObjectPos',
  })
  expect(JSON.stringify(address)).not.toContain('ns=2')
})
```

- [ ] **Step 2: Write RED shared-Endpoint Object/Robot editor tests**

Assert Object Pose/Status and Robot Joint/Frame/Status target options, Endpoint select populated only from `project.opcUa.endpoints`, no URL/reconnect fields, fixed coordinate convention, independent OPC UA source `leafPath` and Project destination `projectPath`, Mapping count updates, atomic Save failure preservation, and the Overview opening the selected target editor.

- [ ] **Step 3: Run focused tests and confirm RED**

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-node-address-resolver.test.ts middleware/runtime-gateway/opcua-client-adapter.test.ts middleware/runtime-gateway/main.test.ts src/features/runtime-gateway/v5/runtime-gateway-node-address-resolver.test.ts src/features/connectivity/v5/opcua-node-address-draft.test.ts src/features/connectivity/v5/BindingEditorDialog.test.tsx src/features/connectivity/v5/BindingOverviewDialog.test.tsx src/features/scene/v4/SceneEntityInspector.test.tsx src/features/scene/v4/SceneContextMenu.test.tsx
```

Expected: FAIL because the shared V5 Binding surfaces do not exist and the current Inspector still owns URL/raw Node fields.

- [ ] **Step 4: Implement live Gateway Namespace resolution**

`opcua-node-address-resolver.ts` parses the supplied session NodeId, reads the selected active Session's current NamespaceArray, rejects out-of-range/empty Namespace URIs, and returns `validateOpcUaNodeAddressV1({ namespaceUri, identifierType, identifier })`. Resolve on every request; never cache Namespace Indexes across reconnect. Support numeric, string, GUID, and ByteString identifiers. The Client adapter returns `OPC_UA_BROWSE_SESSION_UNAVAILABLE` unless the selected Endpoint is connected with an active Session.

Expose a closed `POST /runtime/opcua/resolve-node-address` body `{ endpointId, sessionNodeId }` and response `{ nodeAddress }`, capped at 64 KiB. The browser `createRuntimeGatewayNodeAddressResolverV1` implements `NamespaceIndexResolutionPortV1` through the same-origin route and preserves stable Gateway error codes. The route is diagnostic and never changes Project, Draft, Mapping, or adapter state.

- [ ] **Step 5: Implement canonical address and Mapping Drafts**

The primary editor exposes Namespace URI, identifier type (`string|numeric|guid|byteString`), and identifier. Canonicalize with `validateOpcUaNodeAddressV1`. A secondary Paste Session Node ID action is enabled only when the selected Endpoint has a connected Browse Session and always resolves before Save.

Object Pose uses one structured Mapping root. Each leaf independently selects its OPC UA source `leafPath` and one unique destination `projectPath` from `positionM[0..2]` or `rpyDegrees[0..2]`; runtime conversion produces the V5 quaternion only after all six coherent components arrive. Object Status uses `entity-status` with `projectPath: []`. Robot editor exposes one selected Joint, one selected Robot Frame, or Robot Status target per Mapping. Creating/removing a read Mapping updates the corresponding `jointSource`, `frameSources[frameId]`, or numeric-status owner in the same `ProjectV5AtomicMutationPort.mutate` recipe; Cancel or failed Apply updates neither side. Persist target IDs, Endpoint ID, root address, one of `read | write | readWrite`, optional publishing-interval override, coherence group, interpolation mode, coordinate convention, and leaves exactly as `OpcUaMappingV5`; never persist UI labels, a `publish` direction, or raw Namespace Indexes.

- [ ] **Step 6: Implement editor/overview and remove duplicate Endpoint authoring**

`BindingEditorDialog` uses a local Mapping Draft and commits through `ProjectV5AtomicMutationPort.mutate` with the active revision. Failure keeps the editor open and previous Mapping active. `BindingOverviewDialog` groups mappings by Endpoint then Object/Robot target, displays direction/address/leaf count, and opens the selected editor.

The same atomic recipe updates authored ownership with the Mapping: Object pose sets `SpatialEntityV5.transformOwner` and the targeted Moving Frame to `opcua:<endpointId>`; Object/Robot status sets its `NumericStatusV5.sourceOwnership`; Robot Joint binding sets `RobotInstanceV5.jointSource`. Removing or disabling a Mapping does not silently restore Manual ownership; the editor offers a separate explicit `Take Manual Ownership` confirmation that updates ownership and disables/removes conflicting read Mappings in one validated mutation.

Add a compile-only optional `onOpenBinding` callback to the shared Inspector/context shell. When the V5 editor port is supplied, replace URL, interval, unit, and raw Node ID inputs with one summary and `Open Binding`; the Object/Robot context command opens the same Dialog for its stable target. The current V4 App supplies no V5 adapter and remains buildable until Task 7 removes it from the production graph. Do not add an old-editor toggle or data conversion.

- [ ] **Step 7: Run GREEN and commit**

```powershell
npm run test:run -- middleware/runtime-gateway/opcua-node-address-resolver.test.ts middleware/runtime-gateway/opcua-client-adapter.test.ts middleware/runtime-gateway/main.test.ts src/features/runtime-gateway/v5/runtime-gateway-node-address-resolver.test.ts src/features/connectivity/v5/opcua-node-address-draft.test.ts src/features/connectivity/v5/BindingEditorDialog.test.tsx src/features/connectivity/v5/BindingOverviewDialog.test.tsx src/features/scene/v4/SceneEntityInspector.test.tsx src/features/scene/v4/SceneContextMenu.test.tsx
npm run lint
npm run build:gateway
npm run build
git add middleware/runtime-gateway/opcua-node-address-resolver.ts middleware/runtime-gateway/opcua-node-address-resolver.test.ts middleware/runtime-gateway/opcua-client-adapter.ts middleware/runtime-gateway/opcua-client-adapter.test.ts middleware/runtime-gateway/main.ts middleware/runtime-gateway/main.test.ts src/features/runtime-gateway/v5/runtime-gateway-node-address-resolver.ts src/features/runtime-gateway/v5/runtime-gateway-node-address-resolver.test.ts src/features/connectivity/v5/opcua-node-address-draft.ts src/features/connectivity/v5/opcua-node-address-draft.test.ts src/features/connectivity/v5/BindingEditorDialog.tsx src/features/connectivity/v5/BindingEditorDialog.test.tsx src/features/connectivity/v5/BindingOverviewDialog.tsx src/features/connectivity/v5/BindingOverviewDialog.test.tsx src/features/scene/v4/SceneEntityInspector.tsx src/features/scene/v4/SceneEntityInspector.test.tsx src/features/scene/v4/SceneContextMenu.tsx src/features/scene/v4/SceneContextMenu.test.tsx
git diff --cached --check
git commit -m "feat: centralize object and robot bindings"
```

Expected: Namespace Index reassignment remains correct through URI persistence, disconnected paste fails, Object/Robot Mapping variants validate, duplicate Endpoint fields are absent, and atomic Save/Overview/context tests PASS.

### Task 6: Add Connectivity Commands, Docker Run Guide, and Local Help

**Files:**

- Create: `src/features/connectivity/v5/docker-run-guide.ts`
- Test: `src/features/connectivity/v5/docker-run-guide.test.ts`
- Create: `src/features/connectivity/v5/DockerRunGuideDialog.tsx`
- Test: `src/features/connectivity/v5/DockerRunGuideDialog.test.tsx`
- Modify: `src/app/v4/app-command-composition.ts`
- Test: `src/app/v4/app-command-composition.test.ts`
- Modify: `src/features/ui/v4/app-menu-model.ts`
- Test: `src/features/ui/v4/app-menu-model.test.ts`
- Modify: `src/features/ui/v4/AppMenuBarV4.tsx`
- Test: `src/features/ui/v4/AppMenuBarV4.test.tsx`
- Modify: `src/features/ui/v4/CompactAppMenuV4.tsx`
- Test: `src/features/ui/v4/CompactAppMenuV4.test.tsx`
- Modify: `src/features/help/v4/local-help-controller.ts`
- Test: `src/features/help/v4/local-help-controller.test.ts`
- Modify: `src/features/help/v4/LocalHelpPanelV4.tsx`
- Test: `src/features/help/v4/LocalHelpPanelV4.test.tsx`
- Modify: `docs/operator/opcua-object-binding.md`
- Modify: `docs/operator/docker-deployment.md`
- Modify: `README.md`
- Modify: `src/styles/global.css`

**Interfaces:**

- Consumes: effective deployment/runtime status and the Settings/Monitor/Binding open callbacks.
- Produces: the approved Connectivity menu, deterministic copy-only Docker guide, and matching local/operator help.

- [ ] **Step 1: Write RED menu and guide tests**

```ts
expect(connectivityCommandIds()).toEqual([
  'connectivity.settings.open',
  'connectivity.monitor.open',
  'connectivity.bindings.open',
  'connectivity.docker.open',
])

it('generates host PLC 4840 and Gateway Server 4841 commands without daemon actions', () => {
  const guide = dockerRunGuideV1(dockerStatus())
  expect(guide.text).toContain("$env:ROBOTSIM_OPCUA_PORT = '4841'")
  expect(guide.text).toContain('host.docker.internal:4840')
  expect(guide.text).toContain('docker compose up -d --build --wait')
  expect(guide.actions).toEqual(['copy'])
})
```

Also assert wide/compact menu parity, direct `connectivity.mode.*` commands absent, guide values derived from status, environment restart warning, health commands, clipboard success/error, and no Start/Stop/Restart Container button.

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
npm run test:run -- src/features/connectivity/v5/docker-run-guide.test.ts src/features/connectivity/v5/DockerRunGuideDialog.test.tsx src/app/v4/app-command-composition.test.ts src/features/ui/v4/app-menu-model.test.ts src/features/ui/v4/AppMenuBarV4.test.tsx src/features/ui/v4/CompactAppMenuV4.test.tsx src/features/help/v4
```

Expected: FAIL because the approved commands/guide/topics do not exist and direct mode controls remain.

- [ ] **Step 3: Replace the Connectivity command model**

Replace the four immediate mode radio commands and Gateway Details with exactly `OPC UA Settings…`, `Connection Monitor…`, `Binding Overview…`, and `Docker Run Guide…`. Each command opens its surface; role changes occur only inside Settings. Keep the same ordered menu in wide and compact layouts. Until Task 7 supplies V5 surface callbacks, the shared command composition keeps those new callbacks optional and reports the commands disabled with `Project V5 browser cutover pending`; it retains no immediate mode command or Legacy switch.

- [ ] **Step 4: Implement the deterministic Docker guide**

Generate the approved PowerShell command block:

```powershell
$env:ROBOTSIM_OPCUA_PORT = '4841'
$env:ROBOTSIM_OPCUA_ADVERTISE_HOST = '127.0.0.1'
docker compose up -d --build --wait
docker compose ps
Invoke-WebRequest http://127.0.0.1:8080/runtime/healthz
Invoke-WebRequest http://127.0.0.1:8080/runtime/readyz
Invoke-WebRequest http://127.0.0.1:8080/runtime/status
```

Explain native `opc.tcp://127.0.0.1:4840`, Docker Client `opc.tcp://host.docker.internal:4840`, and independent Gateway Server `opc.tcp://127.0.0.1:4841`. Effective listener/advertised values come from status and remain read-only. The only interactive operation is Copy; users run commands themselves.

- [ ] **Step 5: Add matching local Help and operator documentation**

Add local topics `opcUaSettings`, `connectionMonitor`, `opcUaBinding`, and `dockerRunGuide`. Document ownership, shared Endpoint workflow, stable Namespace URI addresses, quality/stale behavior, 2s/10s polling, loopback replacement, port topology, restart requirement, and failure diagnostics. Remove instructions for the old per-Object URL editor and blind mode radio actions.

- [ ] **Step 6: Run GREEN and commit**

```powershell
npm run test:run -- src/features/connectivity/v5/docker-run-guide.test.ts src/features/connectivity/v5/DockerRunGuideDialog.test.tsx src/app/v4/app-command-composition.test.ts src/features/ui/v4/app-menu-model.test.ts src/features/ui/v4/AppMenuBarV4.test.tsx src/features/ui/v4/CompactAppMenuV4.test.tsx src/features/help/v4
npm run lint
npm run build
git add src/features/connectivity/v5/docker-run-guide.ts src/features/connectivity/v5/docker-run-guide.test.ts src/features/connectivity/v5/DockerRunGuideDialog.tsx src/features/connectivity/v5/DockerRunGuideDialog.test.tsx src/app/v4/app-command-composition.ts src/app/v4/app-command-composition.test.ts src/features/ui/v4/app-menu-model.ts src/features/ui/v4/app-menu-model.test.ts src/features/ui/v4/AppMenuBarV4.tsx src/features/ui/v4/AppMenuBarV4.test.tsx src/features/ui/v4/CompactAppMenuV4.tsx src/features/ui/v4/CompactAppMenuV4.test.tsx src/features/help/v4/local-help-controller.ts src/features/help/v4/local-help-controller.test.ts src/features/help/v4/LocalHelpPanelV4.tsx src/features/help/v4/LocalHelpPanelV4.test.tsx docs/operator/opcua-object-binding.md docs/operator/docker-deployment.md README.md src/styles/global.css
git diff --cached --check
git commit -m "feat: add connectivity guidance and commands"
```

Expected: approved menu order, copy-only guide, responsive dialog, all Help topics, and stale text-removal checks PASS.

### Task 7: Atomically Cut the Active Browser App and Gateway to Project V5

**Files:**

- Create: `src/features/project/v5/project-v5-publication.ts`
- Test: `src/features/project/v5/project-v5-publication.test.ts`
- Create: `src/features/project/v5/project-v5-mutation-service.ts`
- Test: `src/features/project/v5/project-v5-mutation-service.test.ts`
- Create: `src/features/project/v5/project-store-v5.ts`
- Test: `src/features/project/v5/project-store-v5.test.ts`
- Create: `src/features/project/v5/default-project-v5.ts`
- Test: `src/features/project/v5/default-project-v5.test.ts`
- Create: `src/features/project/v5/project-file-command-port-v5.ts`
- Test: `src/features/project/v5/project-file-command-port-v5.test.ts`
- Create: `src/features/project/v5/browser-project-resources-v5.ts`
- Test: `src/features/project/v5/browser-project-resources-v5.test.ts`
- Modify: `src/features/project/v5/browser-project-runtime-v5.ts`
- Test: `src/features/project/v5/browser-project-runtime-v5.test.ts`
- Create: `src/features/runtime-gateway/v5/runtime-gateway-connectivity-client.ts`
- Test: `src/features/runtime-gateway/v5/runtime-gateway-connectivity-client.test.ts`
- Create: `middleware/runtime-gateway/connectivity-diagnostics-routes.ts`
- Test: `middleware/runtime-gateway/connectivity-diagnostics-routes.test.ts`
- Modify: `middleware/runtime-gateway/main.ts`
- Test: `middleware/runtime-gateway/main.test.ts`
- Create: `src/app/v5/initial-project-bootstrap-v5.ts`
- Test: `src/app/v5/initial-project-bootstrap-v5.test.ts`
- Create: `src/app/v5/AppV5.tsx`
- Test: `src/app/v5/AppV5.test.tsx`
- Create: `src/features/scene/v5/V5WorkcellWorkspace.tsx`
- Test: `src/features/scene/v5/V5WorkcellWorkspace.test.tsx`
- Create: `src/features/jobs/v5/RobotJobWorkspaceV5.tsx`
- Test: `src/features/jobs/v5/RobotJobWorkspaceV5.test.tsx`
- Create: `src/app/v5-production-import-graph.test.ts`
- Create: `tests/project-v5-browser-cutover.spec.ts`
- Create: `tests/opcua-settings-monitor.spec.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/app/App.runtime-gateway.test.tsx`
- Modify: `src/app/App.scene-status.test.tsx`
- Modify: `src/main.tsx`
- Modify: `package.json`

**Interfaces:**

- Consumes: Milestone 2 `ProjectRepositoryV5`/codec/sample, Milestone 3 `BrowserProjectRuntimeV5`/Jobs/Signals/Attachments/command result, Milestone 4 Gateway activation, and Tasks 1-6 UI services.
- Produces: the only production `App`, `ProjectV5AtomicMutationPort`, V5 Gateway activation/diagnostics Client, V5 New/Save/Export/Import/hydrate, active Settings/Monitor/Binding/Job surfaces, and browser acceptance evidence.

- [ ] **Step 1: Write RED publication rollback and V5 Project-store tests**

```ts
it.each(['runtime-prepare', 'gateway-activate', 'repository-commit', 'runtime-commit', 'finalize'] as const)(
  'keeps the previous durable, browser, and Gateway revision when %s fails',
  async (failurePoint) => {
    const harness = projectV5PublicationHarness({ failurePoint })
    await expect(harness.publication.replace({
      candidate: harness.nextProject,
      expectedRevisionId: harness.active.revisionId,
    })).rejects.toThrow()
    expect(await harness.repository.readActive()).toEqual(harness.active.project)
    expect(harness.runtime.activeRevisionId()).toBe(harness.active.revisionId)
    expect(harness.gateway.activeRevisionId()).toBe(harness.active.revisionId)
  },
)

it('rejects V4 import before any active mutation', async () => {
  const before = store.getState().activeProject
  await expect(store.getState().importProject(v4Blob)).rejects.toMatchObject({
    code: 'PROJECT_SCHEMA_UNSUPPORTED',
  })
  expect(store.getState().activeProject).toBe(before)
  expect(mutations.replace).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Write the RED production import-graph and browser cutover tests**

The graph test starts at `src/main.tsx` and fails if reachable source imports `src/core/project-v4/**`, `src/features/project/v4/**`, `src/features/jobs/v4/**`, `computeSerialRobotPoseV4`, V4 Gateway publisher/stream, or a V4 Project adapter. UI generation-v4 shell files may remain reachable only when they import Project-neutral/V5 contracts; they are not permitted to import or cast a V4 Project.

`AppV5` tests must prove hydrate/new uses V5, Header starts one status poller, Settings uses the same mutation service, Monitor is modeless, Binding editor targets current selection, Job workspace uses Milestone 3 Job runtime, App unmount disposes poller/stream/runtime, and no `as WorkcellProjectV4` or JSON conversion adapter exists.

- [ ] **Step 3: Run the focused suite and confirm RED**

```powershell
npm run test:run -- src/features/project/v5/project-v5-publication.test.ts src/features/project/v5/project-v5-mutation-service.test.ts src/features/project/v5/project-store-v5.test.ts src/features/project/v5/default-project-v5.test.ts src/features/project/v5/project-file-command-port-v5.test.ts src/features/project/v5/browser-project-resources-v5.test.ts src/app/v5 src/features/scene/v5/V5WorkcellWorkspace.test.tsx src/features/jobs/v5/RobotJobWorkspaceV5.test.tsx src/app/v5-production-import-graph.test.ts
```

Expected: FAIL because the active App still composes V4 Project/runtime resources and the V5 publication/store/App do not exist.

- [ ] **Step 4: Implement one V5 publication and mutation authority**

Port the proven prepare/apply/commit/rollback shape to V5 without importing V4. Sequence one replacement as: validate/canonicalize candidate; call `configRevisionForProjectV5(candidate)` exactly once; pass that hash to repository preparation, browser runtime preparation, and Gateway staging; repository `prepareRevision`; browser runtime `prepare`; Gateway prepare/activate; repository `commitPreparedRevision`; browser runtime commit; repository `finalizePublication`; cleanup previous resources. Assert the committed `PublishedProjectV5.configRevision`, `RuntimeGatewayStatusV1.project.configRevision`, staged Runtime Protocol request, and every Robot/Object/Signal/Job/Attachment store contain that same hash, while `project.revisionId` remains the human/project revision identifier. On every failure, compensate the publishing pointer, rollback browser resources, reactivate the previous Gateway revision when activation changed, and retain a recovery-required state only if compensation itself fails.

The serialized mutation service generates revision/metadata once, enforces `expectedRevisionId`, and implements `ProjectV5AtomicMutationPort`. Settings, Binding, Scene, Job authoring, New, and Import all use this service. There is no direct `setState` Project mutation in React.

- [ ] **Step 5: Implement V5-only store, files, bootstrap, and resources**

`project-store-v5.ts` exposes `hydrate`, `newProject`, `saveActiveProject`, `exportActiveProject`, and `importProject` with the same operator semantics but only V5 types. Use `ProjectDatabaseV5`, `createProjectRepositoryV5`, `encodeProjectV5`, and `decodeProjectV5`. `saveActiveProject` returns the active canonical Project; Export downloads canonical V5; Import decodes fully before replacement. `default-project-v5.ts` creates one minimal valid V5 Project with no deprecated actions or raw Node IDs.

`browser-project-resources-v5.ts` composes the repository, publication/mutation/store, Milestone 3 browser runtime, Gateway activation/stream, status presentation store, Settings controller, and shared UI ports once. No production module constructs V4 resources or opens `robot-sim-project-v4`.

Extend `browser-project-runtime-v5.ts` with the publication coordinator's prepare/apply/commit/rollback lifecycle while retaining Milestone 3 revision-aligned Robot, Job, Signal, and Attachment checkpoints. Implement `runtime-gateway-connectivity-client.ts` as the sole browser HTTP boundary for V5 activation, decoded status, diagnostic Test Connection, and connected-Session Namespace Index resolution. Add strictly validated Gateway routes for the latter two operations: Test Connection opens and closes a temporary diagnostic Client without changing active adapters; Namespace resolution accepts only an active Endpoint ID and live Session. Neither route writes Project state, and both return versioned, bounded JSON. Wire them in `middleware/runtime-gateway/main.ts`; do not expose arbitrary browse/write or security-setting endpoints.

- [ ] **Step 6: Implement the active V5 App and workspaces**

`AppV5` owns V5 Project, selection, Scene, Job, Settings, Monitor, Binding, and Docker-guide presentation. `V5WorkcellWorkspace` projects V5 geometry/Robot Joint/Robot Frame-status/Object/attachment runtime data into the existing Three.js visual behavior without a V4 cast or a second renderer. It samples an OPC UA-owned Base Frame before calling Milestone 3 `computeSerialRobotPoseV5`, so a mapped Base moves the whole Robot; it uses mapped non-Base Frame Actual values for coordinate markers, readouts, and attachment lookup while link geometry remains Joint-kinematic. Every unmapped Robot link and Tool/TCP Frame pose comes from `computeSerialRobotPoseV5`, never from `computeSerialRobotPoseV4` or a structural cast. Robot numeric status uses the runtime status store with retained quality/owner. It exposes Object/Robot `Open Binding`. `RobotJobWorkspaceV5` lists/selects/starts/cancels V5 Jobs and renders Milestone 3 instruction progress/results, including SetDO/WaitDI/Delay/Attach/Detach. Make the split connectivity read model, Monitor port, and `Open Binding` port required in the active V5 composition and remove the compile-only absent-prop/disabled-command branches introduced for Tasks 2, 4, 5, and 6.

Replace `src/app/App.tsx` with the narrow production export/composition for `AppV5`; update the current tests rather than preserving a V4 branch. `src/main.tsx` still renders `App`. Keep inactive V4 files unreferenced for history only; do not expose a Legacy menu, import option, feature flag, query parameter, local-storage switch, or fallback.

- [ ] **Step 7: Add browser acceptance and focused scripts**

Add:

```json
{
  "scripts": {
    "test:connectivity-ui": "vitest run src/features/connectivity/v5 src/features/runtime-gateway/runtime-gateway-status-poller.test.ts src/features/runtime-gateway/v5/runtime-integration-diagnostics-client.test.ts src/features/ui/v4/StudioHeaderV4.test.tsx",
    "test:e2e:v5": "playwright test tests/project-v5-browser-cutover.spec.ts tests/opcua-settings-monitor.spec.ts"
  }
}
```

Update `test:e2e` to include `test:e2e:v5` and remove `test:e2e:v4` from the default chain. Browser acceptance must: create a V5 Project; add/edit eight Endpoints; reject ninth; cancel Draft; fail and roll back one Apply; Apply successfully; bind an Object and Robot through stable Namespace URIs; export/import/reload to the same canonical revision; reject a V4 file without mutation; open the modeless Monitor; observe disconnect within 2 seconds and Header-only refresh at 10 seconds; display read-only Server 4841 values; show Docker loopback replacement; and start a V5 Job far enough to prove the active Job runtime is wired.

- [ ] **Step 8: Run the complete GREEN gate**

```powershell
npm run test:connectivity-ui
npm run test:job-io
npm run test:run
npm run lint
npm run build:gateway
node dist-gateway/middleware/runtime-gateway/main.js --check-config
npm run deploy:validate
npm run build
npm run test:e2e:v5
git diff --check
git status --short
```

Expected: focused and full Vitest suites PASS; lint is clean; Gateway and browser builds succeed; config/deployment validation exits 0; Playwright proves the V5 browser flow; diff check prints nothing. If live PLC/Docker infrastructure is unavailable, unit/browser mocked acceptance still must pass and the exact external blocker is recorded for Milestone 6 rather than reported as a live pass.

- [ ] **Step 9: Commit the V5 browser cutover**

```powershell
git add src/features/project/v5/project-v5-publication.ts src/features/project/v5/project-v5-publication.test.ts src/features/project/v5/project-v5-mutation-service.ts src/features/project/v5/project-v5-mutation-service.test.ts src/features/project/v5/project-store-v5.ts src/features/project/v5/project-store-v5.test.ts src/features/project/v5/default-project-v5.ts src/features/project/v5/default-project-v5.test.ts src/features/project/v5/project-file-command-port-v5.ts src/features/project/v5/project-file-command-port-v5.test.ts src/features/project/v5/browser-project-resources-v5.ts src/features/project/v5/browser-project-resources-v5.test.ts src/features/project/v5/browser-project-runtime-v5.ts src/features/project/v5/browser-project-runtime-v5.test.ts src/features/runtime-gateway/v5/runtime-gateway-connectivity-client.ts src/features/runtime-gateway/v5/runtime-gateway-connectivity-client.test.ts middleware/runtime-gateway/connectivity-diagnostics-routes.ts middleware/runtime-gateway/connectivity-diagnostics-routes.test.ts middleware/runtime-gateway/main.ts middleware/runtime-gateway/main.test.ts src/app/v5/initial-project-bootstrap-v5.ts src/app/v5/initial-project-bootstrap-v5.test.ts src/app/v5/AppV5.tsx src/app/v5/AppV5.test.tsx src/app/App.tsx src/app/App.test.tsx src/app/App.runtime-gateway.test.tsx src/app/App.scene-status.test.tsx src/app/v5-production-import-graph.test.ts src/features/scene/v5/V5WorkcellWorkspace.tsx src/features/scene/v5/V5WorkcellWorkspace.test.tsx src/features/jobs/v5/RobotJobWorkspaceV5.tsx src/features/jobs/v5/RobotJobWorkspaceV5.test.tsx src/main.tsx tests/project-v5-browser-cutover.spec.ts tests/opcua-settings-monitor.spec.ts package.json
git diff --cached --check
git commit -m "feat: cut browser runtime over to project v5"
```

Expected: the staged graph contains only V5 production Project/runtime wiring plus the approved UI, no inactive V4 data/runtime import, and no unrelated files.

## Completion Checklist

- [ ] Settings Draft contains only Project-owned mode, shared Endpoints, and Bridge Routes; deployment Server values remain read-only status.
- [ ] Exactly eight Endpoints pass and a ninth fails before activation.
- [ ] Test Connection never saves or activates.
- [ ] Invalid Endpoint, budget, Mapping reference, or Bridge cycle leaves the prior browser/Gateway/repository revision unchanged.
- [ ] Header separately reports Gateway and OPC UA state and never displays `Off · Ready`.
- [ ] One poller uses 10 seconds for Header-only demand, 2 seconds for Monitor demand, and never overlaps.
- [ ] Connection Monitor is modeless and shows proxy, Gateway, Project, Server, Client Session/Subscription, counts, timestamps, retry, quality/error, and last command result.
- [ ] Object and Robot editors use shared Endpoint IDs and canonical Namespace-URI addresses; per-Object Endpoint URL/timing inputs are absent.
- [ ] Docker loopback shows an explicit `host.docker.internal` replacement; the guide uses host PLC 4840 and Gateway Server 4841 and exposes no daemon controls.
- [ ] New, Save, Export, Import, hydrate/reload, Settings, Bindings, Scene, and Jobs all use one V5 publication/mutation authority.
- [ ] V4 import fails before mutation; no production entry path opens V4 persistence/runtime or exposes Legacy UI.
- [ ] Focused tests, full tests, lint, both builds, deployment validation, V5 browser acceptance, and diff checks pass.
