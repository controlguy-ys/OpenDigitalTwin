# Codex MCP Operator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose OpenDigitalTwin as a project-scoped local MCP Server whose tools can inspect Project V5, preview and apply safe Project changes, and run Browser-owned simulation commands.

**Architecture:** A local STDIO MCP adapter translates typed tools into a versioned Gateway Operator HTTP API. The Gateway serves read-only data from its active Project mirror. Mutation and simulation requests are correlated through the existing Browser WebSocket, but are handled by a new Browser operator owner that delegates to the shared Project and simulation command services. The Gateway never becomes Project mutation authority.

**Tech Stack:** Node.js 22.15.1, TypeScript 6, `@modelcontextprotocol/sdk` 1.29.0, Zod 4.4.3, Node HTTP, WebSocket, Project V5, Vitest.

## Global Constraints

- Pin the production MCP TypeScript SDK v1 line; v2 is not used while it remains pre-alpha.
- The MCP process communicates on stdout only through the STDIO transport.
- Logs and diagnostics go to stderr.
- Gateway reads are bounded and return stable schemas.
- Browser command ownership is mandatory for all mutations and simulation commands.
- MCP tools cannot perform external OPC UA writes, PLC writes, file deletion, shell execution, or arbitrary code execution.
- Tool arguments use IDs and typed fields, never JavaScript snippets or JSON Patch.
- Every Project mutation uses preview then apply.
- Stage only files owned by the current task.

---

## File Structure

### Create

- `src/core/operator-protocol-v1/types.ts`
- `src/core/operator-protocol-v1/validate.ts`
- `src/core/operator-protocol-v1/index.ts`
- `src/core/operator-protocol-v1/validate.test.ts`
- `middleware/runtime-gateway/operator-read-model.ts`
- `middleware/runtime-gateway/operator-read-model.test.ts`
- `middleware/runtime-gateway/operator-command-broker.ts`
- `middleware/runtime-gateway/operator-command-broker.test.ts`
- `src/features/runtime-gateway/v5/runtime-gateway-operator-owner.ts`
- `src/features/runtime-gateway/v5/runtime-gateway-operator-owner.test.ts`
- `middleware/runtime-gateway/operator-routes.test.ts`
- `middleware/codex-mcp/main.ts`
- `middleware/codex-mcp/server.ts`
- `middleware/codex-mcp/gateway-client.ts`
- `middleware/codex-mcp/tool-schemas.ts`
- `middleware/codex-mcp/server.test.ts`
- `scripts/codex/mcp-launcher.mjs`
- `scripts/codex/mcp-smoke.mjs`
- `scripts/codex/mcp-smoke.test.ts`
- `scripts/codex/demo-reset.mjs`
- `scripts/codex/demo-reset.test.ts`
- `tsconfig.codex-mcp.json`
- `.codex/config.toml`

### Modify

- `package.json`
- `package-lock.json`
- `src/features/project/v5/browser-project-resources-v5.ts`
- `src/features/project/v5/browser-project-resources-v5.test.ts`
- `src/features/project/v5/browser-project-runtime-v5.ts`
- `src/features/runtime-gateway/v5/runtime-gateway-state-stream.ts`
- `src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts`
- `middleware/runtime-gateway/main.ts`
- `middleware/runtime-gateway/main.test.ts`
- `scripts/codex/verify-codex.mjs`
- `README.md`
- `docs/developer/codex-workflows.md`

---

## Task 1: Define the Operator Protocol

**Files:**
- Create: `src/core/operator-protocol-v1/types.ts`
- Create: `src/core/operator-protocol-v1/validate.ts`
- Create: `src/core/operator-protocol-v1/index.ts`
- Test: `src/core/operator-protocol-v1/validate.test.ts`

- [ ] **Step 1: Write failing contract tests**

Test round trips for read responses, operator requests, operator results, and structured failures. Reject unknown versions, unknown operation names, extra keys, oversized arrays, and request IDs over 128 characters. Every failure test must assert stable `code`, `path`, `correlationId`, expected/actual revision fields, and bounded `recoveryActions`.

```ts
expect(validateOperatorRequestV1({
  type: 'operator-request-v1',
  protocolVersion: 1,
  requestId: 'request-1',
  expectedRevisionId: 'revision-1',
  operation: {
    type: 'project-preview-change',
    commands: [{ type: 'SetEntityVisibility', entityId: 'box-1', visible: false }],
  },
}).operation.type).toBe('project-preview-change')
```

- [ ] **Step 2: Run and confirm failure**

```powershell
npx vitest run src/core/operator-protocol-v1/validate.test.ts
```

Expected: FAIL because the operator protocol does not exist.

- [ ] **Step 3: Define bounded read contracts**

```ts
export interface OperatorProjectSummaryV1 {
  readonly projectId: string
  readonly revisionId: string
  readonly runtimeEpoch: number | null
  readonly name: string
  readonly counts: {
    readonly robots: number
    readonly entities: number
    readonly jobs: number
    readonly opcUaMappings: number
  }
  readonly opcUaMode: 'off' | 'client' | 'server' | 'bridge'
  readonly validation: { readonly valid: boolean; readonly errors: readonly string[] }
  readonly warnings: readonly string[]
  readonly observedAt: string
  readonly freshness: 'live' | 'mirrored'
}

export interface OperatorEntitySummaryV1 {
  readonly id: string
  readonly name: string
  readonly kind: 'frame' | 'spatial-entity' | 'robot'
  readonly geometryKind: 'asset' | 'box' | 'cylinder' | null
  readonly parentId: string | null
  readonly visible: boolean
  readonly ownership: string
  readonly groupId: string | null
  readonly freshness: 'live' | 'mirrored'
}

export interface OperatorSceneListQueryV1 {
  readonly cursor: string | null
  readonly limit: number
  readonly kinds: readonly ('frame' | 'spatial-entity' | 'robot')[]
  readonly parentId: string | null
}

export interface OperatorScenePageV1 {
  readonly items: readonly OperatorEntitySummaryV1[]
  readonly nextCursor: string | null
  readonly observedAt: string
  readonly freshness: 'live' | 'mirrored'
}
```

Apply limits:

- Scene page: default 100 and maximum 500 Frames, Objects, and Robots combined;
- diagnostic events: maximum 200 rows;
- Project commands per preview: maximum 100;
- response JSON body: maximum 2 MiB;
- request JSON body: maximum 1 MiB.

- [ ] **Step 4: Define Browser operator request/result messages**

```ts
export type OperatorOperationV1 =
  | {
      readonly type: 'project-preview-change'
      readonly commands: readonly ProjectCommandV1[]
    }
  | {
      readonly type: 'project-apply-change'
      readonly previewId: string
      readonly idempotencyKey: string
    }
  | {
      readonly type: 'simulation-execute'
      readonly request: SimulationExecuteRequestV1
    }
  | {
      readonly type: 'simulation-get-result'
      readonly correlationId: string
    }
  | {
      readonly type: 'demo-reset'
      readonly sampleId: 'codex-operator-v5'
      readonly commandId: string
    }

export interface OperatorRequestV1 {
  readonly type: 'operator-request-v1'
  readonly protocolVersion: 1
  readonly requestId: string
  readonly expectedRevisionId: string | null
  readonly operation: OperatorOperationV1
}

export type OperatorResultV1 =
  | {
      readonly type: 'operator-result-v1'
      readonly protocolVersion: 1
      readonly requestId: string
      readonly ok: true
      readonly result: unknown
    }
  | {
      readonly type: 'operator-result-v1'
      readonly protocolVersion: 1
      readonly requestId: string
      readonly ok: false
      readonly error: {
        readonly status: 'failed'
        readonly code: string
        readonly message: string
        readonly path: string | null
        readonly correlationId: string
        readonly expectedRevisionId: string | null
        readonly actualRevisionId: string | null
        readonly recoveryActions: readonly string[]
      }
    }
```

- [ ] **Step 5: Implement strict validators and run tests**

Use exhaustive switches, exact key checks, Project command validation, and detached frozen returns.
Require a non-null `expectedRevisionId` for preview, apply, simulation execute, and simulation result operations. Only the fixed `demo-reset` lifecycle operation may use `null`.

```powershell
npx vitest run src/core/operator-protocol-v1/validate.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit the protocol**

```powershell
git add -- src/core/operator-protocol-v1
git commit -m "feat: define Codex operator protocol"
```

---

## Task 2: Build the Gateway Read Model

**Files:**
- Create: `middleware/runtime-gateway/operator-read-model.ts`
- Test: `middleware/runtime-gateway/operator-read-model.test.ts`

- [ ] **Step 1: Write failing read-model tests**

Use a validated Project V5 fixture and prove:

- summary counts and revision are correct;
- the Scene list includes Frames, Spatial Entities, and Robots and is deterministic by `(kind, id)`;
- cursor, limit, kind, and parent filters return stable non-overlapping pages;
- entity detail includes transform, parent, status, ownership, freshness, and OPC UA binding summary for each supported kind;
- robot definition detail includes links, joints, frames, mechanics metadata, and asset references;
- Job detail includes ordered instructions and the latest mirrored runtime state;
- missing IDs return `OPERATOR_RESOURCE_NOT_FOUND`;
- all returned objects are detached.

- [ ] **Step 2: Run and confirm failure**

```powershell
npx vitest run middleware/runtime-gateway/operator-read-model.test.ts
```

Expected: FAIL because the read model is absent.

- [ ] **Step 3: Implement the read interface**

```ts
export interface OperatorReadModelV1 {
  getProjectSummary(): OperatorProjectSummaryV1
  listSceneEntities(query: OperatorSceneListQueryV1): OperatorScenePageV1
  getEntity(entityId: string): OperatorEntityDetailV1
  getRobotDefinition(definitionId: string): RobotDefinitionV5
  getJob(jobId: string): OperatorJobDetailV1
  validateProject(): OperatorProjectValidationResultV1
}
```

Construct durable fields from the Gateway's active, validated `WorkcellProjectV5` and runtime fields from the existing bounded Gateway mirror. Mark runtime data as `live` or `mirrored` with `observedAt`. Do not read Browser IndexedDB or use a second persistence layer.

- [ ] **Step 4: Run tests and commit**

```powershell
npx vitest run middleware/runtime-gateway/operator-read-model.test.ts
git add -- middleware/runtime-gateway/operator-read-model.ts middleware/runtime-gateway/operator-read-model.test.ts
git commit -m "feat: add Gateway operator read model"
```

---

## Task 3: Add a Correlated Browser Operator Channel

**Files:**
- Create: `middleware/runtime-gateway/operator-command-broker.ts`
- Create: `middleware/runtime-gateway/operator-command-broker.test.ts`
- Create: `src/features/runtime-gateway/v5/runtime-gateway-operator-owner.ts`
- Create: `src/features/runtime-gateway/v5/runtime-gateway-operator-owner.test.ts`
- Modify: `src/features/runtime-gateway/v5/runtime-gateway-state-stream.ts`
- Modify: `src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts`
- Modify: `src/features/project/v5/browser-project-runtime-v5.ts`
- Modify: `src/features/project/v5/browser-project-resources-v5.ts`
- Modify: `src/features/project/v5/browser-project-resources-v5.test.ts`

- [ ] **Step 1: Write failing broker tests**

Prove:

- one active Browser operator owner receives a request;
- result correlation uses `requestId`;
- duplicate pending request IDs are rejected;
- timeout after 10 seconds returns `OPERATOR_BROWSER_TIMEOUT`;
- socket close settles pending requests with `OPERATOR_BROWSER_DISCONNECTED`;
- stale or unsolicited results are ignored and diagnosed;
- maximum pending requests is 32.

- [ ] **Step 2: Define the broker interface**

```ts
export interface OperatorCommandBrokerV1 {
  setOwner(socket: WebSocket | null): void
  request(message: OperatorRequestV1): Promise<OperatorResultV1>
  acceptResult(socket: WebSocket, message: OperatorResultV1): boolean
  dispose(): void
}
```

The Browser publisher lease remains the fence for selecting the owner socket. Do not create a second unfenced WebSocket owner.

- [ ] **Step 3: Write failing Browser owner tests**

Construct the owner with mocked shared services and verify exact routing:

```ts
const owner = createRuntimeGatewayOperatorOwnerV5({
  commands,
  simulation,
  samples,
})
const result = await owner.execute(request)
expect(commands.previewChange).toHaveBeenCalledWith({
  expectedRevisionId: 'revision-1',
  commands: request.operation.commands,
})
```

Map known service errors into stable error envelopes without exposing stack traces.

- [ ] **Step 4: Implement the Browser owner**

```ts
export interface RuntimeGatewayOperatorOwnerV5 {
  execute(request: OperatorRequestV1): Promise<OperatorResultV1>
}
```

Routes:

- `project-preview-change` -> `ProjectCommandServiceV5.previewChange`;
- `project-apply-change` -> `ProjectCommandServiceV5.applyChange`;
- `simulation-execute` -> `SimulationCommandServiceV5.execute`.
- `simulation-get-result` -> `SimulationCommandServiceV5.getResult`.
- `demo-reset` -> `ProjectSampleServiceV5.load`, followed by `SimulationCommandServiceV5.execute` with `reset-simulation` against the newly published revision.

- [ ] **Step 5: Extend the state stream**

Add `onOperatorRequest` to `RuntimeGatewayStreamTargetV5`. On a validated `operator-request-v1` WebSocket message:

1. verify it arrived after the Browser lease was accepted;
2. call the Browser operator owner;
3. validate the result;
4. send one `operator-result-v1`.

Keep runtime command batches and operator requests as separate discriminated protocols.

- [ ] **Step 6: Wire the owner into Browser resources**

Create the owner after `commands` and `simulation`, then expose its handler through the active runtime stream target. Ensure replacement of the active Project changes the revision fence seen by the handler.

- [ ] **Step 7: Run focused tests and commit**

```powershell
npx vitest run middleware/runtime-gateway/operator-command-broker.test.ts src/features/runtime-gateway/v5/runtime-gateway-operator-owner.test.ts src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts src/features/project/v5/browser-project-resources-v5.test.ts
git add -- middleware/runtime-gateway/operator-command-broker.ts middleware/runtime-gateway/operator-command-broker.test.ts src/features/runtime-gateway/v5/runtime-gateway-operator-owner.ts src/features/runtime-gateway/v5/runtime-gateway-operator-owner.test.ts src/features/runtime-gateway/v5/runtime-gateway-state-stream.ts src/features/runtime-gateway/v5/runtime-gateway-state-stream.test.ts src/features/project/v5/browser-project-runtime-v5.ts src/features/project/v5/browser-project-resources-v5.ts src/features/project/v5/browser-project-resources-v5.test.ts
git commit -m "feat: route operator commands to Browser authority"
```

---

## Task 4: Add the Versioned Gateway Operator HTTP API

**Files:**
- Modify: `middleware/runtime-gateway/main.ts`
- Modify: `middleware/runtime-gateway/main.test.ts`
- Create: `middleware/runtime-gateway/operator-routes.test.ts`

- [ ] **Step 1: Write failing HTTP route tests**

Cover:

```text
GET  /operator/v1/project/summary
GET  /operator/v1/entities
GET  /operator/v1/entities/:entityId
GET  /operator/v1/robot-definitions/:definitionId
GET  /operator/v1/jobs/:jobId
GET  /operator/v1/runtime/diagnostics
GET  /operator/v1/project/validate
GET  /operator/v1/simulation/results/:correlationId
POST /operator/v1/project/previews
POST /operator/v1/project/apply
POST /operator/v1/simulation/execute
POST /operator/v1/demo/reset
```

Assertions:

- no active Project -> HTTP 409 `OPERATOR_PROJECT_NOT_ACTIVE`;
- no Browser owner for mutation -> HTTP 503 `BROWSER_COMMAND_OWNER_UNAVAILABLE`;
- malformed JSON -> HTTP 400;
- body too large -> HTTP 413;
- missing resource -> HTTP 404;
- stale revision -> HTTP 409;
- Scene pagination and filters preserve deterministic `(kind, id)` order;
- success schemas contain `protocolVersion: 1`.

- [ ] **Step 2: Run and confirm failure**

```powershell
npx vitest run middleware/runtime-gateway/operator-routes.test.ts
```

Expected: FAIL with route 404 responses.

- [ ] **Step 3: Add route helpers**

Create private helpers in `main.ts`:

```ts
function operatorPathSegment(url: string, prefix: string): string | null
async function readBoundedJson(request: IncomingMessage, maximumBytes: number): Promise<unknown>
function writeOperatorError(response: ServerResponse, error: unknown): void
```

Reuse `canonicalizeRuntimeGatewayErrorEnvelopeV1` for the HTTP failure body. Do not include stack, environment variables, filesystem paths, or endpoint credentials.

- [ ] **Step 4: Route reads and commands**

- Project and Scene reads use `OperatorReadModelV1` plus existing Gateway status and integration diagnostics.
- `simulation/results/:correlationId` sends a read-only `simulation-get-result` request to the active Browser owner; it never advances simulation.
- Preview, apply, and simulation execute construct a validated `OperatorRequestV1` and call the broker.
- Demo reset accepts only `sampleId: "codex-operator-v5"` and a `commandId`; it cannot accept Project JSON or a file path.
- Return 202 for accepted Job starts and 200 for completed cancel/reset.

- [ ] **Step 5: Run Gateway verification and commit**

```powershell
npx vitest run middleware/runtime-gateway/operator-routes.test.ts middleware/runtime-gateway/main.test.ts
npm run build:gateway
node dist-gateway/middleware/runtime-gateway/main.js --check-config
git add -- middleware/runtime-gateway/main.ts middleware/runtime-gateway/main.test.ts middleware/runtime-gateway/operator-routes.test.ts
git commit -m "feat: expose Gateway operator API"
```

---

## Task 5: Implement the Local STDIO MCP Server

**Files:**
- Create: `middleware/codex-mcp/main.ts`
- Create: `middleware/codex-mcp/server.ts`
- Create: `middleware/codex-mcp/gateway-client.ts`
- Create: `middleware/codex-mcp/tool-schemas.ts`
- Create: `middleware/codex-mcp/server.test.ts`
- Create: `tsconfig.codex-mcp.json`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install pinned production dependencies**

```powershell
npm install --save-exact @modelcontextprotocol/sdk@1.29.0 zod@4.4.3
```

Expected: `package.json` and `package-lock.json` record exact versions.

- [ ] **Step 2: Add the compiler**

`tsconfig.codex-mcp.json`:

```json
{
  "extends": "./tsconfig.gateway.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.codex-mcp.tsbuildinfo",
    "outDir": "dist-codex-mcp"
  },
  "include": [
    "src/core/**/*.ts",
    "middleware/codex-mcp/**/*.ts"
  ],
  "exclude": [
    "**/*.test.ts",
    "src/core/**/test-support.ts"
  ]
}
```

Add:

```json
"build:mcp": "tsc -p tsconfig.codex-mcp.json",
"runtime:mcp": "node dist-codex-mcp/middleware/codex-mcp/main.js"
```

- [ ] **Step 3: Write failing MCP registration tests**

Create an in-memory transport test and assert exactly these tools:

```text
project_get_summary
scene_list_entities
entity_get
robot_get_definition
job_get
runtime_get_diagnostics
project_validate
simulation_get_result
project_preview_change
project_apply_change
simulation_execute
```

Assert mutation tools reject missing revision/preview/idempotency fields before any HTTP request.
Assert `simulation_execute` requires `projectId`, `revisionId`, `commandId`, and a closed action. Assert `simulation_get_result` requires `projectId`, `revisionId`, and `correlationId`.

- [ ] **Step 4: Implement the bounded Gateway client**

```ts
export interface OperatorGatewayClientV1 {
  get(path: string): Promise<unknown>
  post(path: string, body: unknown): Promise<unknown>
}
```

Defaults:

- base URL: `http://127.0.0.1:8081`;
- request timeout: 10 seconds;
- maximum response: 2 MiB;
- `Accept` and `Content-Type`: `application/json`;
- gateway errors are surfaced as `{code, message, details}`.

Allow `OPEN_DIGITAL_TWIN_GATEWAY_URL` only when it is an `http:` or `https:` URL. Never echo it in tool output.

- [ ] **Step 5: Implement the MCP Server**

Use stable v1 imports:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
```

Register every tool with:

- a neutral, explicit description;
- a Zod input schema and bounded output schema;
- `readOnlyHint: true`, `destructiveHint: false` for the eight read tools;
- `readOnlyHint: false`, `destructiveHint: false` for `project_preview_change`;
- `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: true` for `project_apply_change`;
- `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: true` for `simulation_execute`, whose `commandId` fences retries;
- one JSON text content result plus `structuredContent`.

The MCP Server instructions must state within the first 512 characters: the Browser owns Project changes, preview is required before apply, simulation tools never issue external OPC UA writes, and recovery starts with `project_get_summary` plus `runtime_get_diagnostics`.

`main.ts` must only construct the server, connect `StdioServerTransport`, set process signal handlers, and write fatal errors to stderr.

- [ ] **Step 6: Run MCP unit and compiler tests**

```powershell
npx vitest run middleware/codex-mcp/server.test.ts
npm run build:mcp
```

Expected: PASS and emitted entrypoint at `dist-codex-mcp/middleware/codex-mcp/main.js`.

- [ ] **Step 7: Commit the MCP adapter**

```powershell
git add -- package.json package-lock.json tsconfig.codex-mcp.json middleware/codex-mcp
git commit -m "feat: add local Codex MCP operator"
```

---

## Task 6: Add Project-Scoped Codex Configuration and Smoke Commands

**Files:**
- Create: `.codex/config.toml`
- Create: `scripts/codex/mcp-launcher.mjs`
- Create: `scripts/codex/mcp-smoke.mjs`
- Create: `scripts/codex/mcp-smoke.test.ts`
- Create: `scripts/codex/demo-reset.mjs`
- Create: `scripts/codex/demo-reset.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing launcher and smoke tests**

Prove:

- launcher resolves the compiled MCP entry relative to the repository, not the caller working directory;
- launcher fails on stderr with exact build guidance when output is missing;
- smoke initializes MCP, lists the eleven tools, calls `project_get_summary`, and closes cleanly;
- demo reset POSTs the fixed sample ID and command ID to `/operator/v1/demo/reset`, then verifies the returned Project summary names `Project V5 Codex Operator Demo`.

- [ ] **Step 2: Implement the launcher**

Use `spawn` with:

```js
{
  cwd: repositoryRoot,
  stdio: ['inherit', 'inherit', 'inherit'],
  windowsHide: true,
}
```

Forward `SIGINT` and `SIGTERM`. Do not invoke a shell.

- [ ] **Step 3: Add project MCP configuration**

`.codex/config.toml`:

```toml
[mcp_servers.opendigitaltwin]
command = "node"
args = ["scripts/codex/mcp-launcher.mjs"]
startup_timeout_sec = 15
tool_timeout_sec = 30
```

- [ ] **Step 4: Add package commands**

```json
"mcp:smoke": "node scripts/codex/mcp-smoke.mjs",
"demo:reset": "node scripts/codex/demo-reset.mjs"
```

- [ ] **Step 5: Run tests with an active local stack**

Terminal 1:

```powershell
npm run dev:stack
```

Terminal 2:

```powershell
npm run build:mcp
npm run mcp:smoke
npm run demo:reset
```

Expected:

- smoke reports eleven tools and a Project summary;
- demo reset loads the fixed sample, resets its simulation, and reports the new active revision;
- Gateway remains ready;
- no OPC UA value is written.

- [ ] **Step 6: Commit configuration and scripts**

```powershell
git add -- .codex/config.toml package.json scripts/codex/mcp-launcher.mjs scripts/codex/mcp-smoke.mjs scripts/codex/mcp-smoke.test.ts scripts/codex/demo-reset.mjs scripts/codex/demo-reset.test.ts
git commit -m "chore: configure project Codex operator"
```

---

## Task 7: Document and Integrate Verification

**Files:**
- Modify: `scripts/codex/verify-codex.mjs`
- Modify: `README.md`
- Modify: `docs/developer/codex-workflows.md`

- [ ] **Step 1: Extend the Gateway verification scope**

Make the `gateway` profile run:

```text
npm run build:gateway
npm run build:mcp
npx vitest run middleware/runtime-gateway/operator-routes.test.ts middleware/codex-mcp/server.test.ts
```

Add `--require-running-stack` to optionally run `npm run mcp:smoke`.

- [ ] **Step 2: Document the operator path**

README must state:

- Browser and Gateway must be running for live tools;
- Project V5 remains Browser-owned;
- Project changes require preview then apply;
- external OPC UA/PLC writes are excluded;
- exact commands: `npm run dev:stack`, `npm run build:mcp`, `npm run mcp:smoke`.

- [ ] **Step 3: Run the complete operator verification**

```powershell
npm run --silent verify:codex -- --scope gateway --json
npm run dev:stack
npm run mcp:smoke
npm run demo:reset
git diff --check
```

Expected:

- structured verification reports PASS;
- MCP smoke passes against the live stack;
- reset completes through Browser authority;
- diff check emits no output.

- [ ] **Step 4: Commit documentation and verification**

```powershell
git add -- scripts/codex/verify-codex.mjs README.md docs/developer/codex-workflows.md
git commit -m "docs: add Codex operator workflow"
```

## Plan Completion Gate

This plan is complete only when:

- a project-scoped Codex MCP Server starts through `.codex/config.toml`;
- all eleven tools are discoverable with typed schemas;
- read tools use the Gateway mirror;
- preview, apply, and simulation tools are handled by the Browser command owner;
- stale revision, missing Browser, timeout, and malformed input failures are structured;
- `mcp:smoke` and `demo:reset` pass against a live local stack;
- no external OPC UA, PLC, shell, or arbitrary file-write tool exists.
