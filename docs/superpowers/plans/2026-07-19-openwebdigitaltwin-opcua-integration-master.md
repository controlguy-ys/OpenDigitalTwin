# OpenWebDigitalTwin OPC UA Robotics and I/O Delivery Master Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one Project V5-only OpenWebDigitalTwin that exchanges logical PLC I/O and Object/Robot state through a real OPC UA Client and optional OPC UA Server, publishes Robot telemetry through the official OPC UA Robotics v1.02 model, executes explicit I/O and pick/place Job instructions, and exposes understandable Settings and diagnostics in the browser.

**Architecture:** Stabilize the existing Runtime Gateway before introducing a standalone Project V5 contract. Build Client writes and deterministic Job I/O on that contract, then load the official Robotics NodeSets and add a separate product exchange model for commands. Cut the browser atomically to V5 through one Settings/activation workflow, and finish with a two-Robot, real-OPC-UA technical demonstration. The browser owns Project authoring and Simulation; the TypeScript Runtime Gateway exclusively owns OPC UA Sessions, Subscriptions, writes, Server namespaces, command staging, and transport diagnostics.

**Tech Stack:** React 19.2.7, TypeScript 6.0.3, Zustand 5.0.14, Three.js 0.185.1, React Three Fiber 9.6.1, Dexie 4.4.4, node-opcua 2.175.0, node-opcua-nodesets 2.174.0, Vitest 4.1.10, Playwright 1.61.1, Vite 8.1.4, Node 22.15.1, npm 11.4.2, Docker Compose v2, and Nginx.

## Global Constraints

- Implement the approved design in `docs/superpowers/specs/2026-07-19-opcua-robotics-io-settings-design.md`; do not silently weaken its twenty success criteria.
- Project V5 is a breaking boundary. Reject V1-V4; do not add migration, aliases, Compatibility Mode, Legacy Adoption, dual-write persistence, or hidden fallback parsing.
- Robot is a dedicated articulated domain object. Generic equipment remains a Scene Object with pose/status; a linear track or positioner is represented as its own Motion Device when independently modelled.
- Use the official Standard, DI, IA, and Robotics v1.02 NodeSets. Do not hand-copy OPC Foundation types or create product NodeIds in an OPC Foundation namespace.
- Standard Robotics Actual telemetry is read-only. Joint/Object/Signal/Job commands use the separate OpenWebDigitalTwin product namespace and enter the browser through its Simulation command boundary.
- Persist OPC UA Node addresses by Namespace URI plus identifier type/value. Never persist a session-local Namespace Index.
- Jobs contain only `move-joint`, `set-do`, `wait-di`, `delay`, `attach`, and `detach`; every instruction has a stable ID and executes in authored order.
- Keep Project transforms right-handed, Z-up, metres, normalized quaternion `[x,y,z,w]`, with RPY degrees composed `Rz * Ry * Rx`. Publish revolute Axis values in degrees and prismatic Axis values in millimetres.
- Bridge means both OPC UA adapters are active; it never implies an undeclared automatic pass-through route.
- A Windows-hosted PLC Server remains `opc.tcp://127.0.0.1:4840`; Docker reaches it as `opc.tcp://host.docker.internal:4840`. Gateway Server uses port 4841.
- The Web UI does not connect to the Docker daemon and does not start or stop containers.
- Anonymous, no-security OPC UA remains a documented trusted-development-LAN limitation. Do not add security settings in this stage.
- Browser-only Simulation remains usable while Gateway or OPC UA is unavailable.
- Do not add manufacturer Robot program generation, URDF automation, AI geometry inference, a physics engine, Cartesian planning, safety-rated claims, or PLC deployment.
- Use only deterministic transforms and mappings. Manual takeover is explicit; disconnect never silently changes an OPC UA-owned target to Manual.
- Keep comments in English, preserve unrelated user changes, and never stage `.pnpm-store`, CAD source directories, backup directories, or generated `artifacts`.
- Each subordinate implementation task follows RED-GREEN-REFACTOR, focused verification, `git diff --check`, and a reviewable commit. Explicit verification-only tasks record evidence in the progress ledger without creating empty commits. The final milestone runs every full gate.

---

## Planning-Time Contract Locks

| Surface | Locked contract |
|---|---|
| Project root | `WorkcellProjectV5`, exactly `schemaVersion: 5` |
| Core exports | `src/core/project-v5/index.ts` |
| Robot identity | Definition identity plus Instance serial number and Controller reference |
| Client Endpoints | Shared Project profiles, maximum 8 |
| Logical Signals | Boolean, Int32, UInt32, Double, String; direction input/output/bidirectional/internal |
| OPC UA address | Namespace URI + string/numeric/guid/byteString identifier |
| Mapping budget | 128 roots, 1,024 leaves, 32 leaves/root, depth 4, 256 fixed-array elements, 10,240 leaf updates/s |
| Server sessions | Maximum 16 |
| Command deduplication | Maximum 4,096 retained records |
| Job instruction kinds | `move-joint`, `set-do`, `wait-di`, `delay`, `attach`, `detach` |
| Gateway status | Project-neutral `RuntimeGatewayStatusV1` |
| Endpoint phases | disabled, connecting, connected, reconnecting, faulted |
| Monitor/Header cadence | 2,000 ms / 10,000 ms, non-overlapping polls |
| OPC UA namespaces | Robotics definitions; product model; product instances |
| Product namespace URIs | `urn:open-web-digital-twin:model:v1`, `urn:open-web-digital-twin:instances:v1` |
| Gateway Server port | 4841 |
| Host PLC Server port | 4840 |

Any implementation need that conflicts with this table stops the current milestone and returns to the approved design. It is not resolved by adding a compatibility branch.

## Dependency Graph

```text
M1 Connectivity Stabilization
              |
              v
M2 Project V5 Core Contracts
              |
              v
M3 Client Writes and Job I/O
              |
              v
M4 Robotics Server and Product Exchange
              |
              v
M5 Settings, Monitor, and V5 Browser Cutover
              |
              v
M6 Two-Robot Technical Demo and Release Evidence
```

M4 may prepare pure NodeSet/model tests while M3 is being completed, but its command dispatch integration waits for M3's lease-fenced command service. M5 may prepare isolated presentation components after M1, but the atomic V5 browser cutover waits for M2-M4. M6 adds no new domain semantics; a missing prerequisite returns to its owning milestone.

## Executable Plan Index

| Order | Plan | Independently testable exit |
|---:|---|---|
| 1 | [OPC UA Connectivity Stabilization](./2026-07-19-opcua-connectivity-stabilization.md) | Bridge starts both roles; status facts are separate; Docker Gateway port is 4841 |
| 2 | [Project V5 Logical Signals and Jobs](./2026-07-19-project-v5-logical-signals-jobs.md) | closed V5 schema, validation, canonical codec/repository, and complete sample |
| 3 | [OPC UA Client Write and Job I/O](./2026-07-19-opcua-client-write-job-io.md) | one-write SetDO, GOOD-only WaitDI, Delay, explicit Attach/Detach, dedupe |
| 4 | [OPC UA Robotics Server and Product Exchange](./2026-07-19-opcua-robotics-server-exchange.md) | official Robotics model plus read-only Actual and staged product commands |
| 5 | [OPC UA Settings and Connection Monitor](./2026-07-19-opcua-settings-connection-monitor.md) | atomic Settings activation, modeless diagnostics, shared Endpoints, V5 App cutover |
| 6 | [OPC UA Technical Demo and Release](./2026-07-19-opcua-technical-demo-release.md) | two Robots, 10+ poses, complete I/O/pick-place flow, native/Docker/browser evidence |

## File Ownership and Serialization

| Surface | Primary owner | Later consumers |
|---|---|---|
| `src/core/runtime-protocol/gateway-status-v1.ts` | M1 | M3, M5, M6 |
| `src/core/project-v5/*` | M2 | M3-M6; later plans must not reopen the aggregate |
| `src/features/project/v5/*` persistence | M2, then M5 integration | M3 runtime, M6 demo |
| `middleware/runtime-gateway/opcua-client-adapter.ts` | M1 diagnostics, then M3 V5/write cutover | M5-M6 |
| command lease/result transport | M3 | M4 external commands, M5 monitor, M6 demo |
| Robotics/product address space | M4 | M5 binding overview, M6 external Client |
| `src/app/App.tsx`, header, menus, inspectors, global CSS | M5 | M6 acceptance only |
| `compose.yaml`, deployment validation/smoke | M1 port topology, then M4/M6 assertions | M6 final gate |
| sample projects and demo scripts | M2 contract sample, M6 release fixture | no later semantic owner |

`package.json`, `middleware/runtime-gateway/main.ts`, `src/app/App.tsx`, `compose.yaml`, and operator documentation are serialized integration files. Before editing one, rebase or update from every earlier completed milestone and rerun its focused tests.

## Cross-Plan Interface Review

Before starting an implementation milestone, compare its plan against the current exports and resolve documentation drift first:

```powershell
rg -n "export (interface|type|function|class)" src/core/project-v5 src/core/runtime-protocol
rg -n -g "2026-07-19-*.md" "WorkcellProjectV5|LogicalSignalV1|RobotJobInstructionV1|OpcUaMappingV5|RuntimeGatewayStatusV1" docs/superpowers/plans
git diff --check
```

Expected: later plans consume names defined by M1/M2 instead of adding parallel definitions. After M5, the active App/Gateway import graph contains no Project V4 dependency. Inactive V4 source may remain as unreachable implementation history for a separate cleanup, but no Legacy command, menu, migration, fallback parser, or runtime branch may expose it.

### Task 1: Land Connectivity Stabilization

**Files:**
- Execute: `docs/superpowers/plans/2026-07-19-opcua-connectivity-stabilization.md`

**Interfaces:**
- Produces: `RuntimeGatewayStatusV1`, Endpoint diagnostics, 2s/10s status poller, working Bridge Server role, and the 4840/4841 topology.

- [ ] **Step 1: Execute every subordinate checkbox in order**

Use a fresh task worker per subordinate Task and require its focused RED/GREEN evidence before continuing.

- [ ] **Step 2: Run the milestone exit gate**

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

Expected: Bridge's Server role listens, Client connection state remains independent of Project readiness, and every deployment default/reference assigns Gateway Server 4841.

- [ ] **Step 3: Review and checkpoint**

Do not begin M2 with an unstaged partial M1 diff. Review intended files, commit the final M1 integration Task, and preserve unrelated untracked assets.

### Task 2: Land Project V5 Core Contracts

**Files:**
- Execute: `docs/superpowers/plans/2026-07-19-project-v5-logical-signals-jobs.md`

**Interfaces:**
- Consumes: the approved design limits.
- Produces: standalone V5 Core, canonical codec, IndexedDB repository, and V5 all-instruction sample.

- [ ] **Step 1: Execute the V5 plan without importing V4**

Every schema version other than 5 must fail before a repository write. Do not add a browser compatibility UI.

- [ ] **Step 2: Run the milestone exit gate**

```powershell
npm run verify:v5-core
npm run test:run
rg -n "project-v4|WorkcellProjectV4|Legacy|migration" src/core/project-v5 src/features/project/v5 -g "!*.test.ts"
git diff --check
```

Expected: focused and full checks pass; the boundary scan has no production imports or compatibility surface; canonical re-encoding preserves the revision.

- [ ] **Step 3: Freeze the contract**

Record the exported V5 names and exact sample revision. M3-M6 consume them; they do not redefine them.

### Task 3: Land Client Writes and Job I/O

**Files:**
- Execute: `docs/superpowers/plans/2026-07-19-opcua-client-write-job-io.md`

**Interfaces:**
- Consumes: M1 status/protocol and M2 Project types.
- Produces: logical-Signal runtime state, one-write Client command service, Job executor, attachment runtime, and V5 browser runtime bundle.

- [ ] **Step 1: Execute every subordinate Task in order**

Do not connect the V5 runtime to the current App until its atomic cutover in M5. Real OPC UA writes belong only to the Gateway.

- [ ] **Step 2: Run the milestone exit gate**

```powershell
npm run test:job-io
npm run test:run
npm run lint
npm run build:gateway
node dist-gateway/middleware/runtime-gateway/main.js --check-config
npm run build
git diff --check
```

Expected: SetDO causes exactly one `Session.write`; stale WaitDI cannot pass; Delay/Attach/Detach preserve order and pose; duplicate commands do not execute twice.

- [ ] **Step 3: Record failure semantics**

Capture the stable error codes for ownership conflict, timeout, stale lease/revision, type/direction mismatch, disconnect, expiry, and duplicate-ID conflict for M5 Help and M6 evidence.

### Task 4: Land Robotics Server and Product Exchange

**Files:**
- Execute: `docs/superpowers/plans/2026-07-19-opcua-robotics-server-exchange.md`

**Interfaces:**
- Consumes: V5 Robot/Controller/Joint records, M3 command dispatch/result service, and runtime Actual state.
- Produces: standard Robotics instances, OpenWebDigitalTwin Actual/Command/Result/Diagnostics branches, and external Client acceptance tests.

- [ ] **Step 1: Execute the NodeSet and model plan**

Pin and load Standard, DI, IA, and Robotics v1.02 in dependency order. Product instances use only product/instance namespaces.

- [ ] **Step 2: Run the milestone exit gate**

```powershell
npm run test:opcua-server-model
npm run test:gateway
npm run test:run
npm run lint
npm run build:gateway
npm run build
git diff --check
```

Expected: 2-, 7-, and 16-Joint fixtures expose exact Axis counts; standard Actual writes return `BadNotWritable`; complete staged product commands are lease-fenced and deduplicated.

- [ ] **Step 3: Audit namespace ownership**

Use a real node-opcua Client test to enumerate NodeIds and fail if a product-created NodeId uses an OPC Foundation namespace. Do not claim Base Server Facet conformance.

### Task 5: Cut the Browser to V5 and Add Connectivity UX

**Files:**
- Execute: `docs/superpowers/plans/2026-07-19-opcua-settings-connection-monitor.md`

**Interfaces:**
- Consumes: M1 status poller, M2 repository/codec, M3 runtime, and M4 model diagnostics.
- Produces: V5-only App composition, Settings modal, modeless Monitor, Endpoint selection binding editors, Binding Overview, and Docker Run Guide.

- [ ] **Step 1: Execute presentation Tasks before the serialized App cutover**

Keep Draft settings isolated from the active Project. `Test Connection` is diagnostic and never saves; `Apply & Activate` is the only atomic commit path.

- [ ] **Step 2: Perform the V5 cutover once**

New/Save/Export/Import/activation/Jobs/bindings must all use V5. Remove the active V4 App wiring and reject a V4 import without partial mutation or Legacy UI.

- [ ] **Step 3: Run the milestone exit gate**

```powershell
npm run test:connectivity-ui
npm run test:run
npm run lint
npm run build:gateway
npm run build
npm run test:e2e
git diff --check
```

Expected: invalid Settings leave the active runtime unchanged; Monitor reports a disconnect within one 2-second interval; header distinguishes Gateway from OPC UA state; Object/Robot bindings use shared Endpoint profiles.

### Task 6: Prove the Technical Demo and Release Gate

**Files:**
- Execute: `docs/superpowers/plans/2026-07-19-opcua-technical-demo-release.md`

**Interfaces:**
- Consumes: only public interfaces and operator entrypoints from M1-M5.
- Produces: deterministic two-Robot fixture, virtual PLC, external Client check, browser demo, runbook, build log, and release evidence.

- [ ] **Step 1: Run the native technical flow**

Start the virtual PLC Server on 4840, Gateway HTTP/WS plus Gateway OPC UA Server on 4841, and the Web app. Run the complete 10+ MoveJoint plus I/O/pick-place Job through the browser.

- [ ] **Step 2: Run an independent OPC UA Client check**

Read standard Robot Actual telemetry, prove it is not writable, issue one complete expiring product command, and observe its retained terminal result. Repeat its RequestId and prove no second execution.

- [ ] **Step 3: Run the complete repository and deployment gates**

```powershell
npm run lint
npm run test:run
npm run cad:validate
npm run deploy:validate
npm run build:gateway
node dist-gateway/middleware/runtime-gateway/main.js --check-config
npm run build
npm run test:e2e
npm run verify:opcua-demo
npm run demo:smoke:native
npm run deploy:build
npm run deploy:smoke:technical-demo
git diff --check
```

Expected: every available command exits 0. If Docker Desktop is not running, `deploy:build`/smoke remain explicitly BLOCKED and the milestone is incomplete; a native pass must not be relabelled as Docker evidence.

- [ ] **Step 4: Complete the release checklist**

Record exact test counts, build warning/error counts, Project revision, Job instruction count/order, native endpoints, Docker evidence, save/reload result, reconnect latency, dedupe result, working browser flow, known limitations, human decisions, and all recovery steps in the implementation build log.

## Final Acceptance Matrix

| Criterion group | Owning evidence |
|---|---|
| Official NodeSets, standard instances, exact Axis counts/units/read-only Actual | M4 model and external Client tests |
| Namespace-URI binding and no product NodeIds in OPC namespaces | M2 validator plus M4 enumeration test |
| V5 persistence/import/reload and V4 rejection | M2 codec/repository plus M5 browser acceptance |
| Bridge, upstream Object flow, ports 4840/4841 | M1 integration plus M6 native/Docker smoke |
| SetDO, WaitDI, Delay, Attach, Detach, ownership and dedupe | M3 unit/integration plus M6 Job |
| Expiring per-Session product commands and results | M4 command staging plus M6 external Client |
| Atomic Settings, distinct diagnostics, Docker translation warning | M5 component/integration/Playwright tests |
| Two Robots, 10+ poses, complete browser flow | M6 release fixture and Playwright evidence |
| No out-of-scope features or claims | final source/help/documentation scan |

The delivery is complete only when all twenty criteria in the approved design have current evidence. A plan file, a local-only native run, or a UI screenshot is not by itself completion.
