# Project V4 Delivery Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Project V4 as eight reviewable, independently gated workstreams ending in the heterogeneous NED2/MRb05 OPC UA Pick/Place browser demonstration.

**Architecture:** Build the dependency-free deterministic Core first, cut the browser over to keyed multi-Robot V4 runtime second, and then add Asset authoring, Runtime Gateway transports, interchange, explicit Pick/Place, and the final release fixture. The browser remains the Project author and Simulation owner; one compiled TypeScript Runtime Gateway owns filesystem Asset resolution and all `node-opcua` Client/Server/Bridge behavior.

**Tech Stack:** React 19.2.7, TypeScript 6.0.3, Zustand 5.0.14, Three.js 0.185.1, React Three Fiber 9.6.1, Dexie 4.4.4, occt-import-js 0.0.23, node-opcua 2.175.0, fflate 0.8.3, Vitest 4.1.10, Playwright 1.61.1, Vite 8.1.4, Node 22.15.1, npm 11.4.2, Docker Compose.

## Global Constraints

- Implement the approved design in `../specs/2026-07-16-project-v4-multi-robot-runtime-gateway-design.md`; do not silently weaken a success criterion.
- Project V4 is breaking. Reject V1, V2, and V3 as `PROJECT_SCHEMA_UNSUPPORTED`; do not add Legacy Adoption, migration, compatibility modes, or `Legacy*` APIs.
- The deterministic Core must import no React, Three.js, WebSocket, filesystem, browser DOM, or `node-opcua` module.
- Use right-handed Robot-domain coordinates, Z-up, metres, normalized quaternion `[x, y, z, w]`, and UI/interchange RPY degrees composed as `Rz * Ry * Rx`.
- Keep Robot dedicated and articulated. Non-Robot equipment uses `SpatialEntityV4` plus named `MovingFrameV4` records.
- Enforce 8 Robots, 1-16 Joints/Definition, 1-7 Robot STEP sources/Definition, 128 unique non-Robot STEP Assets, 256 non-Robot instances, and 1.5M visible triangles.
- Enforce 8 upstream Endpoints, 128 Structure roots, 1,024 Leaves, depth 4, 10,240 leaf-updates/second, 16 Server Client Sessions, and 4,096 active Command deduplication records.
- Keep JSON canonical. XML must be lossless; XLSX edits only bounded mapping/configuration sheets and applies atomically after semantic preview.
- Persist only `asset://` and versioned `builtin://` references. Physical mount paths and raw MRb05 STEP bytes stay outside the Project and Git.
- Do not infer Joint mechanics or orientation through AI, filenames, or topology. Geometry suggestions remain operator-confirmed.
- Do not add authentication, certificates, physics, IK, Cartesian planning, coordinated multi-Robot barriers, or live PLC transfer.
- Comments in source code remain English. Preserve unrelated user work and never stage the untracked CAD/backup directories.
- Every task follows RED -> focused GREEN -> `npm run lint` -> `npm run build` -> focused commit. The release workstream runs the full suite and browser/Docker gates.

---

## Planning-Time Determinism Locks

The approved design already fixes the main product limits. The implementation plans additionally lock the following previously implicit details so independent workers produce one compatible schema and exact/+1 tests:

| Detail | Locked implementation rule |
|---|---|
| Joint units | revolute values and velocity in degree/degree-per-second; prismatic in metre/metre-per-second |
| Joint origin | complete `RigidTransformV4` |
| Job Action step | `{ kind: 'action-reference', actionId }` |
| Project metadata | `name`, `createdAt`, and `updatedAt` |
| Referenced Robot Definitions | 8, because every Definition must be referenced and the Project permits 8 Robot Instances |
| Scene Groups | 256 |
| Moving Frames | 32 per Spatial Entity and 1,024 total Project Frames |
| Action Definitions | 256 |

These bounds are validation/resource locks, not new product features. Changing one requires updating P1 constants, exact/+1 tests, P6 workbook row bounds, and the release fixture in the same change.

## 1. Baseline Boundary

The current product is a stable Project V3 single-Robot application. The V4 work must split responsibilities instead of extending these already-large files:

| Current file | Current size | V4 disposition |
|---|---:|---|
| `src/domain/project/project-v3.ts` | 4,324 lines | replace with focused `src/core/project-v4/*` contracts; delete after V4 cutover |
| `src/features/project/browser-project-runtime.ts` | 832 lines | replace with V4 repository/runtime coordinators and feature adapters |
| `src/features/scene/Workcell.tsx` | 660 lines | retain viewport composition; move Robot iteration and bounds to focused components/selectors |
| `src/features/robot/RobotModel.tsx` | 444 lines | replace fixed NED2 component with definition-driven `RobotInstanceModel` |
| `src/features/interaction/GraspController.tsx` | 392 lines | remove automatic-nearest behavior; replace with explicit Action Executor |
| `middleware/opcua-connector.mjs` | 160 lines | replace polling script with compiled TypeScript Runtime Gateway modules |

The current Project revision pointer/atomic publication behavior is useful evidence, but V4 persistence starts in a new `robot-sim-project-v4` Dexie database and stores no STEP bytes. The prior V3 database remains untouched and unreferenced; that is rejection, not migration.

## 2. Dependency Graph

```text
P1 Core Contracts and V4 Persistence
                 |
                 v
P2 Multi-Robot Runtime and V4 Browser Cutover
                 |
                 +--------------------+
                 |                    |
                 v                    v
P3 Robot/Asset Authoring      P6 JSON/XML/XLSX Interchange
                 |
                 v
P4 Gateway Client and Browser Interpolation
                 |
                 v
P5 Gateway Server, Commands, Lease, and Bridge
                 |
                 v
P7 Explicit Pick/Place Actions
                 |
                 v
P8 Heterogeneous Release Demo and Verification
```

P6 Tasks 1-3 may begin after P1 because they own isolated document codecs, but P6 Task 4 and later wait for P4 Task 1's Mapping-expansion contract; its Project-menu integration also waits for P2. P3 and only those isolated P6 codec tasks may run in parallel. P4 waits for P3's `AssetResolverV1`/`AssetHttpRouterV1` contracts, while P4 itself owns the shared HTTP/WebSocket host that composes the Asset and runtime routes. P7 waits for P5 because its external Action acceptance uses the finished Command transport.

## 3. Executable Plan Index

| Order | Plan | Independently testable exit |
|---:|---|---|
| 1 | [Project V4 Core Contracts](./2026-07-16-project-v4-core-contracts.md) | shared Core, compiled Gateway scaffold, canonical V4 JSON, atomic V4 repository |
| 2 | [Multi-Robot Runtime](./2026-07-16-multi-robot-runtime.md) | V4 browser cutover, 1-8 keyed Robots, Frames, Jobs, collision IDs, no automatic grasp |
| 3 | [Robot and Asset Authoring](./2026-07-16-robot-asset-authoring.md) | logical Assets, assembly hierarchy, and a 1-7 source Wizard proven with redistributable fixtures; real MRb05 approval remains P8 |
| 4 | [Runtime Gateway Client](./2026-07-16-runtime-gateway-client.md) | 1-8 Subscription workers, state batches, latest-wins WS, browser interpolation |
| 5 | [Runtime Gateway Server and Bridge](./2026-07-16-runtime-gateway-server-bridge.md) | Off/Client/Server/Bridge, Lease, namespace, Session staging, dedup, no echo |
| 6 | [Project V4 Interchange](./2026-07-16-project-v4-interchange.md) | canonical JSON, lossless XML, bounded XLSX preview and atomic apply |
| 7 | [Explicit Pick and Place](./2026-07-16-explicit-pick-place.md) | shared UI/Job/OPC UA Action Executor and deterministic Attachment constraints |
| 8 | [Heterogeneous Release Demo](./2026-07-16-heterogeneous-release-demo.md) | NED2 + MRb05, OPC UA TCP assertions, Docker/performance/browser evidence |

## 4. File Ownership and Merge Serialization

| Surface | Owning plan | Other plans consume through |
|---|---|---|
| Base `src/core/project-v4/*` and `src/core/runtime-protocol/*` contracts | P1, then serialized P4/P5 extensions | P1 owns the base schema/canonical protocol; P4 adds Mapping/state contracts; P5 adds Lease/Command/Bridge contracts after P4 lands |
| V4 Dexie/repository/publication | P1 | `ProjectRepositoryV4`, `ProjectPublicationCoordinatorV4`, `PublishedProjectBundleV4` |
| Browser mutation/store, Robot runtime registry, Frame runtime, multi-Robot rendering and Job session | P2 | `ProjectMutationServiceV4`, stable Robot/Frame selectors and commands |
| OCCT hierarchy, Geometry mappings, Asset client/resolver and authoring UI | P3 | `ResolvedAssetV1`, `AssetHttpRouterV1`, prepared Geometry repositories |
| Endpoint workers, state WS and interpolation | P4 | `StateBatchHubV1`, `RuntimeStateControllerV1`, `RuntimeGatewayClientV1` |
| Lease, Server namespace, Command staging/dedup and Bridge | P5 | `command-request-v1`, Action executor port |
| XML/XLSX codecs and semantic Diff | P6 | `InterchangePreviewV4`, atomic Project recipe |
| Action runtime, Attachments and Job action steps | P7 | `ActionExecutorV4`, attachment read model |
| standard Web+Gateway Compose/Nginx cutover | P5 | one production route and mode-independent container topology |
| sample fixture mount, release runner, docs and evidence | P8 | public interfaces only; no new domain semantics or alternate Compose topology |

`src/app/App.tsx`, `src/app/AppShell.tsx`, `src/features/project/ProjectMenu.tsx`, `package.json`, `compose.yaml`, and `deploy/nginx.conf` are serialized integration files. A workstream may edit one only in its named integration task after rebasing on the previous landed plan.

## 5. Execution Waves

### Task 1: Land P1 and P2 serially

**Files:**
- Execute: `docs/superpowers/plans/2026-07-16-project-v4-core-contracts.md`
- Execute: `docs/superpowers/plans/2026-07-16-multi-robot-runtime.md`

**Interfaces:**
- Produces: the V4-only browser authority and all stable IDs/types required by later workstreams.

- [ ] **Step 1: Execute P1 with a fresh task worker**

```powershell
npm run test:run -- src/core src/features/project middleware
npm run lint
npm run build
```

Expected: PASS; the current browser remains functional while the new V4 Core is dark to authoring.

- [ ] **Step 2: Review P1 against the Core plan and merge its commits**

Expected: no React/Three/Node imports below `src/core`, no V1-V3 acceptance, and no STEP bytes in V4 revision storage.

- [ ] **Step 3: Execute P2 on the landed P1 commit**

```powershell
npm run test:run -- src/core src/domain src/features/project src/features/robot src/features/joints src/features/jobs src/features/scene src/features/collision
npm run lint
npm run build
```

Expected: PASS; the browser now authors and runs V4 only, and old Project payloads fail before mutation.

### Task 2: Land P3 and isolated P6 codec work

**Files:**
- Execute: `docs/superpowers/plans/2026-07-16-robot-asset-authoring.md`
- Execute: `docs/superpowers/plans/2026-07-16-project-v4-interchange.md`

**Interfaces:**
- Consumes: P1 Core and P2 browser mutation boundary.
- Produces: logical Asset authoring plus isolated XML/XLSX codecs.

- [ ] **Step 1: Run P3 and P6 codec tasks in separate worktrees**

Do not edit `ProjectMenu.tsx` from P6 until P3 has landed. P6 codec/test files under `src/features/interchange` have no ownership overlap with P3.

- [ ] **Step 2: Land P3, rebase P6, then land P6 UI integration**

```powershell
npm run test:run -- src/features/import src/features/robot src/features/assets src/features/interchange
npm run lint
npm run build
```

Expected: PASS; missing external Assets show `UNRESOLVED`, and interchange never embeds physical paths or STEP bytes.

### Task 3: Land P4, P5, and P7 serially

**Files:**
- Execute: `docs/superpowers/plans/2026-07-16-runtime-gateway-client.md`
- Execute: `docs/superpowers/plans/2026-07-16-runtime-gateway-server-bridge.md`
- Execute: `docs/superpowers/plans/2026-07-16-explicit-pick-place.md`

**Interfaces:**
- Consumes: logical Asset host, V4 protocol contracts, Robot runtime registry.
- Produces: complete Gateway modes and the shared explicit Action path.

- [ ] **Step 1: Execute and land P4**

```powershell
npm run test:gateway:client
npm run lint
npm run build:gateway
npm run build
```

Expected: PASS; eight mock Endpoint workers remain isolated and browser interpolation is visualization-only.

- [ ] **Step 2: Execute and land P5**

```powershell
npm run test:gateway
npm run lint
npm run build:gateway
npm run build
```

Expected: actual OPC UA Server tests prove Session isolation, Lease fencing, 4,096/4,097 dedup boundaries, and Bridge no-echo.

- [ ] **Step 3: Execute and land P7**

Expected: automatic nearest-Object grasp code is absent; UI, Job, and OPC UA invoke one Action Executor.

### Task 4: Run the non-optional P8 release gate

**Files:**
- Execute: `docs/superpowers/plans/2026-07-16-heterogeneous-release-demo.md`

**Interfaces:**
- Consumes: all prior public interfaces.
- Produces: release Project, automated evidence, operator documentation, and final browser verification.

- [ ] **Step 1: Configure the external fixture without staging it**

```powershell
$env:ROBOTSIM_ASSET_MOUNT_LOCAL_SAMPLES = (Get-Location).Path
npm run verify:mrb05:asset
```

Expected: preflight reports SHA-256 `8bce1c031ec9301ce8e66d01c82560a7bb0c881e0455871b6d5f2c38afe567fa`, 49 Meshes, 117,708 vertices, and 140,689 triangles.

- [ ] **Step 2: Run the complete release gate**

```powershell
npm run verify
npm run deploy:validate
npm run deploy:smoke:modes
npm run test:release:mrb05
```

Expected: all commands PASS; skipped MRb05 tests do not count as completion.

- [ ] **Step 3: Perform the 20-step browser acceptance procedure**

Use the Codex in-app browser and the P8 `node-opcua` smoke client. Capture the exact health/readiness, OPC UA Read/Write, Job/Action, deduplication, Attach/Detach tolerance, Save/Reload, and Reset assertions named in the approved specification.

## 6. Success-Criterion Coverage

| Approved success criteria | Owning plan | Required evidence |
|---|---|---|
| 1: Robot/Joint exact limits | P1, P2 | Core exact/plus-one tests and eight keyed runtime Instances |
| 2-3: one-to-seven STEP authoring and exact MRb05 | P3, P8 | deterministic hierarchy/mapping tests plus the non-skipped external fixture suite |
| 4-6: shared Definition independence, heterogeneous Robots, Moving Frame mount | P2, P8 | multi-Robot runtime tests and browser fixture evidence |
| 7: Object STEP/primitive accounting | P1, P3 | 128/129 preflight and primitive exclusion tests |
| 8-12: Endpoint/Session/mapping/dedup limits, modes, Lease, Bridge | P4, P5 | real `node-opcua` integration tests and exact/plus-one resource gates |
| 13: JSON/XML/XLSX equivalence | P1, P6 | canonical hash equality and semantic mapping round-trip |
| 14: logical Asset mounts and recovery | P3, P8 | Windows/Linux/Docker resolver tests, digest mismatch, and missing-Asset recovery |
| 15-16: shared Action semantics and Pick/Place | P5, P7, P8 | UI/Job/OPC UA shared-executor tests, pose tolerance, Reset, and result-state evidence |
| 17: collision identity and contact exclusions | P2, P7 | qualified IDs, exact-pair exclusions, and unrelated-finding retention tests |
| 18-19: heterogeneous demo and full release gate | P8 | browser acceptance, OPC UA client assertions, Docker/performance gates, and no skipped MRb05 suite |

No workstream may mark a shared criterion complete from its local tests alone. The last owning plan in each row assembles the cross-plan evidence.

## 7. Global Completion Gate

Project V4 is complete only when every linked plan is checked off, every focused commit is present, `npm run verify` and Docker smoke tests pass, the MRb05 external fixture suite did not skip, and the browser evidence proves the approved heterogeneous scenario. A branch-local or static-only result is not completion.
