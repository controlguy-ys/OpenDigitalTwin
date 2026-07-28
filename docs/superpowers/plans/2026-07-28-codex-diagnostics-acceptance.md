# Codex Diagnostics and Runtime Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex-operated failures reproducible with one sanitized diagnostic bundle and prove the complete Browser-Gateway-MCP workflow with an automated Project V5 demo.

**Architecture:** Browser and Gateway errors are normalized into one bounded event contract. Each process retains at most 200 recent events. The Gateway assembles a versioned diagnostic bundle from active authority state, integration status, Browser-reported events, Gateway events, and operator activity. The bundle is available through HTTP, MCP, CLI, and a human copy action. A Playwright acceptance test keeps the Browser command owner active while a real STDIO MCP client performs read, preview, apply, simulation, result, and reset operations.

**Tech Stack:** TypeScript 6, Node.js 22.15.1, React 19, Vitest, Playwright 1.61.1, MCP TypeScript SDK 1.29.0, existing Runtime Gateway.

## Global Constraints

- Diagnostic output must be useful without credentials or raw CAD data.
- Retain at most 200 events per process and 200 merged events in a bundle.
- Do not include stack traces in MCP or HTTP responses.
- Redact credentials, tokens, secrets, cookies, authorization headers, user home paths, and OPC UA endpoint user information.
- Preserve project ID, revision ID, config revision, stable error code, component, correlation ID, and timestamps.
- The acceptance test must use a real Browser owner and real STDIO MCP transport.
- Tests must restore the changed entity visibility and reset simulation state.
- Git hooks are explicitly deferred; deterministic commands remain the enforcement mechanism.
- Stage only files owned by the current task.

---

## File Structure

### Create

- `src/core/diagnostics-v1/types.ts`
- `src/core/diagnostics-v1/validate.ts`
- `src/core/diagnostics-v1/sanitize.ts`
- `src/core/diagnostics-v1/index.ts`
- `src/core/diagnostics-v1/validate.test.ts`
- `src/core/diagnostics-v1/sanitize.test.ts`
- `src/features/diagnostics/v5/diagnostic-event-store-v1.ts`
- `src/features/diagnostics/v5/diagnostic-event-store-v1.test.ts`
- `src/features/diagnostics/v5/diagnostic-bundle-client-v1.ts`
- `src/features/diagnostics/v5/diagnostic-bundle-client-v1.test.ts`
- `middleware/runtime-gateway/diagnostic-event-store.ts`
- `middleware/runtime-gateway/diagnostic-event-store.test.ts`
- `middleware/runtime-gateway/diagnostic-bundle.ts`
- `middleware/runtime-gateway/diagnostic-bundle.test.ts`
- `scripts/codex/diagnostics-bundle.mjs`
- `scripts/codex/diagnostics-bundle.test.ts`
- `tests/codex-operator.spec.ts`

### Modify

- `src/features/project/v5/browser-project-resources-v5.ts`
- `src/features/project/v5/browser-project-resources-v5.test.ts`
- `src/features/runtime-gateway/v5/runtime-gateway-state-stream.ts`
- `src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts`
- `src/features/connectivity/v5/ConnectionMonitorPanel.tsx`
- `src/features/connectivity/v5/ConnectionMonitorPanel.test.tsx`
- `middleware/runtime-gateway/main.ts`
- `middleware/runtime-gateway/operator-routes.test.ts`
- `middleware/codex-mcp/server.ts`
- `middleware/codex-mcp/server.test.ts`
- `scripts/codex/mcp-smoke.mjs`
- `scripts/codex/mcp-smoke.test.ts`
- `scripts/codex/verify-codex.mjs`
- `src/app/v5/AppV5.tsx`
- `src/app/v5/AppV5.test.tsx`
- `package.json`
- `README.md`
- `docs/developer/codex-workflows.md`

---

## Task 1: Define and Sanitize Diagnostic Contracts

**Files:**
- Create: `src/core/diagnostics-v1/types.ts`
- Create: `src/core/diagnostics-v1/validate.ts`
- Create: `src/core/diagnostics-v1/sanitize.ts`
- Create: `src/core/diagnostics-v1/index.ts`
- Create: `src/core/diagnostics-v1/validate.test.ts`
- Create: `src/core/diagnostics-v1/sanitize.test.ts`

- [ ] **Step 1: Write failing contract tests**

Cover exact keys, all severity levels, nullable authority fields, stable timestamps, maximum message length, maximum detail depth, and detached output.

```ts
expect(validateDiagnosticEventV1({
  type: 'diagnostic-event-v1',
  protocolVersion: 1,
  eventId: 'event-1',
  occurredAtMs: 1_000,
  source: 'browser',
  component: 'project-command-service',
  severity: 'error',
  code: 'PROJECT_REVISION_CONFLICT',
  message: 'The active Project changed.',
  correlationId: 'request-1',
  projectId: 'project-1',
  revisionId: 'revision-1',
  configRevision: 'a'.repeat(64),
  details: {},
}).code).toBe('PROJECT_REVISION_CONFLICT')
```

- [ ] **Step 2: Write failing redaction tests**

The sanitizer must redact:

```ts
{
  password: 'secret-value',
  token: 'bearer-value',
  authorization: 'Basic value',
  cookie: 'session=value',
  endpointUrl: 'opc.tcp://user:password@127.0.0.1:4840',
  path: 'C:\\Users\\operator\\private\\asset.step',
}
```

Expected:

```ts
{
  password: '[REDACTED]',
  token: '[REDACTED]',
  authorization: '[REDACTED]',
  cookie: '[REDACTED]',
  endpointUrl: 'opc.tcp://127.0.0.1:4840',
  path: '[USER_HOME]\\private\\asset.step',
}
```

Also prove circular data, functions, symbols, and objects deeper than four levels are replaced with bounded strings.

- [ ] **Step 3: Run and confirm failure**

```powershell
npx vitest run src/core/diagnostics-v1
```

Expected: FAIL because diagnostic modules do not exist.

- [ ] **Step 4: Define the event and bundle types**

```ts
export type DiagnosticSeverityV1 = 'info' | 'warning' | 'error'
export type DiagnosticSourceV1 = 'browser' | 'gateway' | 'mcp'

export interface DiagnosticEventV1 {
  readonly type: 'diagnostic-event-v1'
  readonly protocolVersion: 1
  readonly eventId: string
  readonly occurredAtMs: number
  readonly source: DiagnosticSourceV1
  readonly component: string
  readonly severity: DiagnosticSeverityV1
  readonly code: string
  readonly message: string
  readonly correlationId: string | null
  readonly projectId: string | null
  readonly revisionId: string | null
  readonly configRevision: string | null
  readonly details: Readonly<Record<string, unknown>>
}

export interface DiagnosticBundleV1 {
  readonly type: 'diagnostic-bundle-v1'
  readonly protocolVersion: 1
  readonly generatedAt: string
  readonly application: {
    readonly name: 'OpenDigitalTwin'
    readonly version: string
    readonly build: string
    readonly environment: 'local-browser-gateway'
  }
  readonly project: {
    readonly projectId: string | null
    readonly revisionId: string | null
    readonly validation: { readonly valid: boolean; readonly errors: readonly string[] }
    readonly assetWarnings: readonly string[]
  }
  readonly commandOwner: {
    readonly browserPublisherId: string | null
    readonly leaseGeneration: number | null
    readonly leaseExpiry: number | null
  }
  readonly gateway: {
    readonly runtimeEpoch: number | null
    readonly readiness: string
    readonly lastError: { readonly code: string; readonly message: string } | null
  }
  readonly opcua: {
    readonly endpointPhases: readonly Readonly<Record<string, unknown>>[]
    readonly subscriptions: readonly Readonly<Record<string, unknown>>[]
    readonly mappingQuality: readonly Readonly<Record<string, unknown>>[]
    readonly retryState: readonly Readonly<Record<string, unknown>>[]
  }
  readonly commands: {
    readonly recentEvents: readonly DiagnosticEventV1[]
  }
  readonly verification: {
    readonly latest: Readonly<Record<string, unknown>> | null
  }
}
```

- [ ] **Step 5: Implement validation and sanitization limits**

- message maximum: 1,000 UTF-8 bytes;
- component/code/correlation ID maximum: 128 UTF-8 bytes;
- details maximum serialized size: 32 KiB;
- detail arrays maximum: 50 entries;
- detail depth maximum: 4;
- bundle event history maximum: 200.

- [ ] **Step 6: Run tests and commit**

```powershell
npx vitest run src/core/diagnostics-v1
git add -- src/core/diagnostics-v1
git commit -m "feat: define sanitized diagnostic contracts"
```

---

## Task 2: Capture Browser Diagnostic Events

**Files:**
- Create: `src/features/diagnostics/v5/diagnostic-event-store-v1.ts`
- Create: `src/features/diagnostics/v5/diagnostic-event-store-v1.test.ts`
- Modify: `src/features/project/v5/browser-project-resources-v5.ts`
- Modify: `src/features/project/v5/browser-project-resources-v5.test.ts`
- Modify: `src/features/runtime-gateway/v5/runtime-gateway-state-stream.ts`
- Modify: `src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts`

- [ ] **Step 1: Write failing ring-store tests**

Prove insertion order, 200-event eviction, detached reads, sanitization, and listener isolation.

- [ ] **Step 2: Implement the Browser store**

```ts
export interface DiagnosticEventStoreV1 {
  append(input: DiagnosticEventInputV1): DiagnosticEventV1
  readRecent(limit?: number): readonly DiagnosticEventV1[]
  subscribe(listener: () => void): () => void
}
```

Inject `nowMs` and `createEventId`. Default limit is 200 and requested read limit cannot exceed 200.

- [ ] **Step 3: Route existing Browser diagnostics into the store**

In `createBrowserProjectApplicationResourcesV5`:

1. create one diagnostic store;
2. make the internal `onDiagnostic` append a normalized event;
3. still call the optional caller `onDiagnostic` inside a protected `try/catch`;
4. expose `diagnostics` on `BrowserProjectApplicationResourcesV5`.

Tag errors by the closest known component; fall back to `browser-runtime`.

- [ ] **Step 4: Forward bounded Browser events over WebSocket**

Add:

```ts
export interface BrowserDiagnosticBatchV1 {
  readonly type: 'browser-diagnostic-batch-v1'
  readonly protocolVersion: 1
  readonly projectId: string
  readonly revisionId: string
  readonly configRevision: string
  readonly events: readonly DiagnosticEventV1[]
}
```

Send at most 50 new events per batch after lease acceptance. The Gateway acknowledges the highest event ID received so reconnect does not duplicate an unbounded history.

- [ ] **Step 5: Run tests and commit**

```powershell
npx vitest run src/features/diagnostics/v5/diagnostic-event-store-v1.test.ts src/features/project/v5/browser-project-resources-v5.test.ts src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts
git add -- src/features/diagnostics/v5 src/features/project/v5/browser-project-resources-v5.ts src/features/project/v5/browser-project-resources-v5.test.ts src/features/runtime-gateway/v5/runtime-gateway-state-stream.ts src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts
git commit -m "feat: capture Browser diagnostic events"
```

---

## Task 3: Assemble the Gateway Diagnostic Bundle

**Files:**
- Create: `middleware/runtime-gateway/diagnostic-event-store.ts`
- Create: `middleware/runtime-gateway/diagnostic-event-store.test.ts`
- Create: `middleware/runtime-gateway/diagnostic-bundle.ts`
- Create: `middleware/runtime-gateway/diagnostic-bundle.test.ts`
- Modify: `middleware/runtime-gateway/main.ts`
- Modify: `middleware/runtime-gateway/operator-routes.test.ts`

- [ ] **Step 1: Write failing Gateway store tests**

Test separate Browser and Gateway ring buffers, deduplication by event ID, authority tuple rejection, 200-event eviction per source, and deterministic merged order by `(occurredAtMs, eventId)`.

- [ ] **Step 2: Write failing bundle tests**

Use status and integration diagnostic fixtures. Prove:

- current authority tuple appears once;
- events are sanitized again at assembly boundary;
- at most 200 merged events are returned;
- secrets and local user paths never appear in serialized JSON;
- a missing active Project still produces a valid diagnostic bundle.

- [ ] **Step 3: Implement the assembler**

```ts
export interface DiagnosticBundleAssemblerV1 {
  build(): Promise<DiagnosticBundleV1>
}
```

Dependencies:

```ts
{
  nowIso: () => string
  readGatewayStatus: () => RuntimeGatewayStatusV1
  readIntegrationDiagnostics: () => RuntimeIntegrationDiagnosticsV1
  readBrowserOwnerState: () => {
    readonly browserPublisherId: string | null
    readonly leaseGeneration: number | null
    readonly leaseExpiry: number | null
  }
  readProjectValidation: () => { readonly valid: boolean; readonly errors: readonly string[] }
  readAssetWarnings: () => readonly string[]
  readLatestVerification: () => Promise<Readonly<Record<string, unknown>> | null>
  events: GatewayDiagnosticEventStoreV1
  applicationVersion: string
  applicationBuild: string
}
```

Read `artifacts/codex/latest-verification.json` with a 256 KiB ceiling. Missing or malformed evidence yields `verification.latest: null` plus a warning diagnostic; it never prevents the rest of the bundle from being returned.

- [ ] **Step 4: Add the HTTP endpoint**

Add:

```text
GET /operator/v1/diagnostics/bundle
```

Return HTTP 200 whether Project is active or not. The bundle explains availability through its Project and command-owner fields.

Accept `browser-diagnostic-batch-v1` only from the active Browser owner socket and current authority tuple.

- [ ] **Step 5: Run tests and commit**

```powershell
npx vitest run middleware/runtime-gateway/diagnostic-event-store.test.ts middleware/runtime-gateway/diagnostic-bundle.test.ts middleware/runtime-gateway/operator-routes.test.ts
npm run build:gateway
git add -- middleware/runtime-gateway/diagnostic-event-store.ts middleware/runtime-gateway/diagnostic-event-store.test.ts middleware/runtime-gateway/diagnostic-bundle.ts middleware/runtime-gateway/diagnostic-bundle.test.ts middleware/runtime-gateway/main.ts middleware/runtime-gateway/operator-routes.test.ts
git commit -m "feat: assemble Gateway diagnostic bundles"
```

---

## Task 4: Expose the Bundle to MCP, CLI, and Human UI

**Files:**
- Create: `src/features/diagnostics/v5/diagnostic-bundle-client-v1.ts`
- Create: `src/features/diagnostics/v5/diagnostic-bundle-client-v1.test.ts`
- Create: `scripts/codex/diagnostics-bundle.mjs`
- Create: `scripts/codex/diagnostics-bundle.test.ts`
- Modify: `src/features/connectivity/v5/ConnectionMonitorPanel.tsx`
- Modify: `src/features/connectivity/v5/ConnectionMonitorPanel.test.tsx`
- Modify: `middleware/codex-mcp/server.ts`
- Modify: `middleware/codex-mcp/server.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing client and UI tests**

Test:

- client validates the bundle before returning it;
- monitor shows `Copy Diagnostic Bundle`;
- copy writes pretty-printed JSON to the Clipboard;
- copy success is announced in a live region;
- copy failure stays in the panel and does not close it.

- [ ] **Step 2: Implement the Browser client**

```ts
export interface DiagnosticBundleClientV1 {
  read(signal?: AbortSignal): Promise<DiagnosticBundleV1>
}
```

Fetch `/operator/v1/diagnostics/bundle`, enforce a 2 MiB response ceiling, and validate the body.

- [ ] **Step 3: Add the Connection Monitor action**

Add one button in the existing Diagnostics area:

```tsx
<button type="button" onClick={copyDiagnosticBundle}>
  Copy Diagnostic Bundle
</button>
```

Do not add a new permanent sidebar or toolbar.

- [ ] **Step 4: Update the MCP diagnostic tool**

Keep the existing tool name `runtime_get_diagnostics`. Change its structured result to:

```ts
{
  readonly status: RuntimeGatewayStatusV1
  readonly bundle: DiagnosticBundleV1
}
```

Do not register a second overlapping diagnostic tool.

- [ ] **Step 5: Implement the CLI command**

`diagnostics-bundle.mjs`:

- GET the bundle from `http://127.0.0.1:8081`;
- print valid pretty JSON to stdout;
- print errors to stderr;
- accept `--sanitize` as the explicit safe mode and reject `--raw`;
- accept `--out <path>` only when the resolved path is within the repository;
- write using an atomic temporary-file rename.

Add:

```json
"diagnostics:bundle": "node scripts/codex/diagnostics-bundle.mjs"
```

- [ ] **Step 6: Run tests and commit**

```powershell
npx vitest run src/features/diagnostics/v5/diagnostic-bundle-client-v1.test.ts src/features/connectivity/v5/ConnectionMonitorPanel.test.tsx middleware/codex-mcp/server.test.ts scripts/codex/diagnostics-bundle.test.ts
git add -- src/features/diagnostics/v5/diagnostic-bundle-client-v1.ts src/features/diagnostics/v5/diagnostic-bundle-client-v1.test.ts src/features/connectivity/v5/ConnectionMonitorPanel.tsx src/features/connectivity/v5/ConnectionMonitorPanel.test.tsx middleware/codex-mcp/server.ts middleware/codex-mcp/server.test.ts scripts/codex/diagnostics-bundle.mjs scripts/codex/diagnostics-bundle.test.ts package.json
git commit -m "feat: expose sanitized diagnostic bundles"
```

---

## Task 5: Add the Complete MCP Acceptance Scenario

**Files:**
- Modify: `scripts/codex/mcp-smoke.mjs`
- Modify: `scripts/codex/mcp-smoke.test.ts`
- Create: `tests/codex-operator.spec.ts`

- [ ] **Step 1: Add a failing full-scenario smoke test**

Add `--scenario acceptance` to `mcp-smoke.mjs`. With a fake MCP client, verify this exact tool sequence:

```text
project_get_summary
scene_list_entities
entity_get
project_preview_change
project_apply_change
entity_get
project_validate
job_get
simulation_execute (start-job)
simulation_get_result
simulation_execute (reset-simulation)
project_preview_change
project_apply_change
runtime_get_diagnostics
```

The last preview/apply restores the entity's original visibility.

- [ ] **Step 2: Implement the real scenario**

Rules:

1. Read the current revision before every mutation boundary.
2. Select `entity-part` and `job-codex-operator-motion` by exact IDs from the V5 Codex Operator Demo.
3. Toggle entity visibility through preview/apply.
4. Immediately after preview, re-read summary and entity and assert revision and visibility are unchanged.
5. Apply the preview and assert the revision changes exactly once.
6. Validate the new Project.
7. Start the Job and poll `simulation_get_result` every 100 ms for at most 15 seconds.
8. Accept only terminal `SUCCEEDED`; surface `FAILED` with its stable failure code.
9. Reset simulation.
10. Restore original visibility through a second preview/apply.
11. Read diagnostics and require zero error-severity entries in `commands.recentEvents` created by this scenario.

- [ ] **Step 3: Write the Playwright acceptance test**

First expose the active Project revision as a non-interactive diagnostic attribute:

```tsx
<div
  className="v5-app-shell"
  data-project-revision={activeProject?.revisionId ?? ''}
>
```

Add a component test proving the attribute updates after publication.

```ts
test('operates Project V5 through the real local MCP Server', async ({ page }) => {
  await page.goto('/')
  await runDemoReset()
  await expect(page.getByText('Project V5 Codex Operator Demo', { exact: true })).toBeVisible()

  const result = await runMcpAcceptanceScenario()
  expect(result).toMatchObject({
    projectValidated: true,
    jobState: 'SUCCEEDED',
    simulationReset: true,
    visibilityRestored: true,
  })

  const uiRevision = await page.locator('.v5-app-shell').getAttribute('data-project-revision')
  const exportedRevision = await exportActiveProjectRevision(page)
  const gatewayRevision = await readGatewayProjectRevision()
  expect({ uiRevision, exportedRevision, gatewayRevision }).toEqual({
    uiRevision: result.finalRevisionId,
    exportedRevision: result.finalRevisionId,
    gatewayRevision: result.finalRevisionId,
  })
})
```

Implement `runDemoReset` and `runMcpAcceptanceScenario` with Node `execFile`, no shell, and a 60-second timeout:

```text
node scripts/codex/demo-reset.mjs --json
node scripts/codex/mcp-smoke.mjs --scenario acceptance --json
```

- [ ] **Step 4: Run the acceptance test**

```powershell
npm run build:mcp
npx playwright test tests/codex-operator.spec.ts
```

Expected: PASS with one connected Browser owner and terminal Job state `SUCCEEDED`.

- [ ] **Step 5: Commit the acceptance scenario**

```powershell
git add -- scripts/codex/mcp-smoke.mjs scripts/codex/mcp-smoke.test.ts src/app/v5/AppV5.tsx src/app/v5/AppV5.test.tsx tests/codex-operator.spec.ts
git commit -m "test: verify the Codex operator end to end"
```

---

## Task 6: Finish Deterministic Verification and Documentation

**Files:**
- Modify: `scripts/codex/verify-codex.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/developer/codex-workflows.md`

- [ ] **Step 1: Add the acceptance profile**

Add:

```json
"test:e2e:codex": "playwright test tests/codex-operator.spec.ts"
```

The `full` Codex verification profile runs:

```text
npm run verify:guidance
npm run lint
npm run test:run
npm run build:gateway
npm run build:mcp
npm run build
npm run test:e2e:codex
```

- [ ] **Step 2: Document diagnostic recovery**

Document this exact sequence:

```powershell
npm run dev:stack
npm run mcp:smoke
npm run diagnostics:bundle -- --sanitize --out artifacts/codex-diagnostic-bundle.json
npm run demo:reset
```

State that the diagnostic file is sanitized but should still be reviewed before external sharing.

- [ ] **Step 3: Document the deferred hook decision**

Add a short `Enforcement` section:

```md
Codex verification is command-driven in this phase. No pre-commit or pre-push hook is installed. CI or hook enforcement can be added after the command contracts stabilize.
```

- [ ] **Step 4: Run the final gate**

```powershell
npm run verify:codex -- --scope full --json
npm run diagnostics:bundle -- --sanitize
git diff --check
```

Expected:

- full profile PASS;
- the bundle is valid JSON and contains no redaction-test secrets;
- no diff whitespace errors.

- [ ] **Step 5: Commit the completion changes**

```powershell
git add -- scripts/codex/verify-codex.mjs package.json README.md docs/developer/codex-workflows.md
git commit -m "docs: complete Codex operator verification"
```

## Plan Completion Gate

This plan is complete only when:

- Browser and Gateway each retain bounded diagnostic events;
- the merged bundle is schema-valid and redacts known secret classes;
- HTTP, MCP, CLI, and human UI expose the same bundle;
- the real STDIO MCP acceptance scenario reads, previews, applies, validates, runs, polls, resets, and restores Project state;
- the V5 Demo Job ends in `SUCCEEDED`;
- `verify:codex -- --scope full --json` passes;
- no Git hook, external OPC UA write, PLC write, or CAD payload is added.
