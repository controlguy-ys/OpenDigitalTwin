# Deterministic Workcell Next Stage Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute one workstream at a time. After WS1 passes its gate, use superpowers:subagent-driven-development only for workstreams whose file-ownership rows do not overlap.

**Goal:** Complete the lightweight Web Digital Twin vertical slice with deterministic Robot assembly import from one through seven selected STEP Files collapsing to one through seven unique source Assets, Project-owned Simulation Jobs, Box/Cylinder Object creation, OPC UA Object XYZRPY binding with deterministic smoothing, and a four-mode engineering workspace.

**Architecture:** Freeze one Project V3 contract first, then build four independent domain workstreams against that contract. Keep one active fixed six-axis Robot and reusable Object Asset/Instance separation. Accept OPC UA target frames atomically, derive one smoothed effective transform, and make both rendering and geometry collision consume that same transform. Finish with a mode-based UI integration and one release gate.

**Tech Stack:** React 19.2.7, TypeScript 6.0.3, Zustand 5.0.14, Dexie 4.4.4, Three.js 0.185.1, React Three Fiber 9.6.1, occt-import-js 0.0.23, node-opcua 2.175.0, Vitest 4.1.10, Playwright 1.61.1, Vite 8.1.4, Node 22.15.x, npm 11.4.x.

## Global Constraints

- Do not start source implementation until Gate G0 freezes the amended normative design and Project V3 contract.
- Keep exactly one active Robot with the canonical serial chain `LINK00` through `LINK06` and joints J1 through J6.
- Robot Import synchronously accepts one through seven selected STEP/STP `File` objects before any read, and after digest collapse persists one through seven unique source Assets that must resolve exactly seven Links. The selected-file limit applies only to Robot Import.
- Robot source ID equals its exact lowercase SHA-256 digest. WS1 migration alone may use reserved `[-1, linkOrdinal]` whole-source refs; new WS2 imports use only non-negative integer assembly paths. Seven assembly components are not proof of seven Joints: any declared/manual Mechanics count other than exactly six fails pre-commit as `ROBOT_JOINT_COUNT_UNSUPPORTED` without changing the active Project.
- Each imported external Object remains one whole STEP/STP source Asset. Byte-identical Object Assets may share one content-addressed archive blob. Box and Cylinder are generated Assets and never receive fake STEP bytes.
- Use deterministic extraction and explicit operator approval only. AI/API/harness-assisted geometry remapping is Future Roadmap and has no current key, endpoint, UI, schema, or runtime path.
- Job directly owns its ordered Pose Steps. There is no shared Pose library, Job chaining, loop, condition, repeat count, PLC trigger, or multi-Job playback in this stage.
- Pose speed is the motion authority. Required `speedPercentToNext` plus normalized six-Joint Mechanics derives redundant non-terminal `durationMs` by the frozen formula; error above `1e-9 ms` fails validation and terminal duration is exactly 1,000 ms.
- `BUILD`, `SIMULATE`, `CONNECT`, and `VALIDATE` are transient workspace lenses, not Joint/Transform sources and not Project data.
- OPC UA is read-only. Keep the initial Connector polling scheduler; OPC UA Subscription is a future transport optimization, not a prerequisite for the source-neutral frame protocol.
- Accept all six XYZRPY target values atomically. After the one-time baseline snap for a new generation, reconnect, or fresh current-quality-GOOD foreground resume, apply each subsequent changed target to the displayed and collision transform over exactly `2 * samplingIntervalMs`; an absent, stale, BAD, or faulted resume holds the current Pose until a fresh target can establish that baseline.
- Use geometry collision only. Do not add rigid-body dynamics, forces, mass, friction, restitution, or physics-engine collision response.
- Exclude multi-Robot, IK/path planning, controller program upload, PLC writes, authentication, certificates, roles, cloud services, and automatic mesh simplification.
- Preserve existing user changes and the two untracked CAD/backup directories. Do not commit proprietary CAD fixtures unless the user separately authorizes it.
- Keep source comments in English. Use millimetres and degrees in engineering UI, metres and normalized quaternions in runtime math.
- Do not assume `crypto.randomUUID()` exists on trusted-LAN HTTP clients. Route every current and new Project/Object/Job/Pose/Primitive and non-content-addressed Robot-import operation ID through one injectable `createPortableId()` that prefers `randomUUID`, falls back to RFC 4122 v4 formatting from `crypto.getRandomValues`, never uses `Math.random`, and fails before mutation if neither cryptographic API exists. Robot source IDs remain exact SHA-256, and Link/occurrence/proxy IDs remain deterministic derivations rather than UUIDs.

---

## 1. Audited Baseline and Plan Disposition

### Completed baseline

- One fixed six-axis Robot, browser Simulation Joint control, and read-only OPC UA Joint-angle source selection.
- Whole-file STEP Object import, Manual MCP-local XYZRPY placement, canonical Object removal, numeric Status overlay, and reusable industrial red/yellow/green stack light.
- Portable Project V2, `.wdtwin` import/export, reusable Object Asset/Instance records, raw STEP persistence, and browser reload.
- Fixed World/Base/MCP/Flange/Tool0/TCP coordinate frames and manual Robot/Object transforms.
- On-prem Docker build/deployment package.
- Deterministic geometry collision for the current pose and Pose-sequence Worker validation.
- Current verification baseline: 74 Vitest files and 451 tests pass before this next stage.

### Plans retained as completed evidence

- `2026-07-13-portable-workcell-project-core.md`
- `2026-07-13-fixed-coordinate-frames.md`
- `2026-07-13-on-prem-docker-deployment.md`
- `2026-07-13-geometry-collision-core.md`

These documents are not execution queues. Their unchecked boxes do not override source, test, and verification evidence.

### Plans superseded for the current stage

- `2026-07-11-pose-sequence-speed-ordering.md` is superseded by WS3 Simulation Jobs. Reuse only its interpolation, locking, and keyboard-test invariants.
- Tasks 10 through 12 of `2026-07-10-crb15000-web-simulation.md` are superseded by WS6 Mode Workspace and the consolidated release gate.

### Future-only plans that must not be executed in this stage

- `2026-07-11-frame-graph-manual-coordinates.md`
- `2026-07-11-generic-robot-import-mechanical-configuration.md`
- `2026-07-11-opcua-joint-source-gateway.md`

Their full variable-DOF Robot, unrestricted Frame Graph, and broader gateway scopes exceed the approved fixed single-Robot stage.

---

## 2. Gate G0: Normative Design Freeze

**Files:**

- Modify: `docs/superpowers/specs/2026-07-13-single-assembly-robot-opcua-equipment-transform-design.md`

**Interfaces:**

- Produces one approved revision of the existing normative definition for Project V3, Simulation Jobs, generated primitives, Robot assembly sources, external transform ownership, and smoothing; do not create a competing amendment/specification file.
- Resolves the existing conflict between immediate first-GOOD application and two-cycle interpolation.
- Execute Task 1 of `2026-07-13-opcua-transform-smoothing.md` as the detailed smoothing-contract edit procedure during this Wave 0 gate. That task is not repeated when WS5 resumes after WS1 and WS6 Stage A.

- [ ] **Step 1: Amend the V3 aggregate before code changes**

  Freeze `WorkcellProjectSnapshotV3` as one tuple-preserving deeply read-only aggregate containing digest-identified Robot source Assets and Link references, complete six-Joint Mechanics with separate rigid unit-scale MCP/Flange/Tool0/TCP transforms, Simulation Jobs and `activeJobId`, `step | box | cylinder` Object Asset sources, paired built-in/Object configuration and canonical Manual transforms, `manualNumericStatus` fallbacks, canonical built-in/Object numeric Status bindings, and external transform profile bindings. Keep workspace mode and live OPC telemetry outside the archive. Standalone V3 Object Asset/Instance records are readonly too.

- [ ] **Step 2: Replace the conflicting OPC effective-pose rule**

  Use this normative sentence:

  > Six finite values from one Connector cycle are accepted as one atomic target; after a one-time baseline snap, each subsequent changed target reaches the displayed and geometry-collision effective transform over exactly two sampling cycles.

  The first GOOD after binding, source change, generation change, or reconnect snaps to establish a safe baseline. Foreground resume snaps only when the latest same-generation complete target remains current-quality GOOD, no later non-GOOD/fault occurred, and its age is below the stale threshold; otherwise it remains HELD with the baseline snap pending for the first later fresh GOOD. Every later changed GOOD target is interpolated. BAD, missing, non-finite, duplicate, and out-of-order frames do not create a new target.

- [ ] **Step 3: Freeze initial release cardinalities**

  Approving this plan freezes `MAX_JOBS = 32`, `MAX_POSES_PER_JOB = 256`, and `MAX_PROJECT_POSES = 2_048`. Each exact boundary is accepted and boundary plus one is rejected before active-state mutation.

- [ ] **Step 4: Record explicit non-goals and Future Roadmap**

  Record AI-assisted extraction, OPC UA Subscription, arbitrary Frame Graphs, variable-DOF Robots, mesh splitting, and physics collision only under Future Roadmap. Do not add dormant current-version fields for them.

- [ ] **Step 5: Review the amended specification for contradictions**

  Search the amended documents for immediate effective-pose wording, shared Pose-library ownership, mandatory seven-source wording, or AI fallback wording. Approval requires one unambiguous rule for each topic.

**G0 exit criterion:** The detailed WS5 Task 1 smoothing amendment and the remaining V3/Job/Primitive/Robot amendments are present in one reviewed specification revision, and the user approves that amended normative design. No feature branch begins before this approval.

---

## 3. Dependency Graph and Execution Waves

```text
G0 Normative design freeze
             |
             v
WS1 Project V3 foundation and crash-consistent persistence
             |
             v
WS6 Stage A transient Mode shell and integration slots
             |
             +----------------+----------------+----------------+
             |                |                |                |
             v                v                v                v
WS2 Robot assembly     WS3 Simulation   WS4 Primitive    WS5 OPC transform
import                 Jobs             Objects          and smoothing
             |                |                |                |
             +----------------+----------------+----------------+
                              |
                              v
              WS6 Stage B feature integration and release
```

Execution waves:

1. Wave 0: G0 specification amendment and user approval.
2. Wave 1: WS1 Project V3 contracts, migration, codec, revision pointer, and crash consistency.
3. Wave 1A: land WS6 Stage A immediately after WS1, exposing only working baseline features and stable integration slots. This serial landing prevents App/AppShell conflicts with feature branches.
4. Wave 2: WS2, WS3, WS4, and WS5 domain/component work may run in parallel against the landed Stage A shell. Shared Project-runtime integration commits land in the exact order WS2 Task 4 -> WS3 Task 4 -> WS4 Task 3, with each later task rebased on the prior commit. Any remaining shared composition commit is serialized while independent work stays parallel.
5. Wave 3: WS6 Stage B wires all completed features, runs accessibility/performance checks, updates operator docs, and passes the full release gate.

---

## 4. Workstream Index and File Ownership

| Workstream | Executable plan | Primary owned surface | Depends on |
|---|---|---|---|
| WS1 | [Project V3 Foundation](./2026-07-13-project-v3-foundation.md) | Project domain, migrations, codec, DB revisions, shared SHA-256 utility | G0 |
| WS2 | [Deterministic Assembly Robot Import](./2026-07-13-deterministic-assembly-robot-import.md) | STEP tree analysis, Link mapping, localization, Robot wizard | WS1 + WS6 Stage A |
| WS3 | [Simulation Jobs](./2026-07-13-simulation-jobs.md) | Job domain/store, playback, Timeline, Job-scoped reports | WS1 + WS6 Stage A |
| WS4 | [Primitive Objects](./2026-07-13-primitive-objects.md) | Primitive Asset/runtime factory and creation inspector | WS1 + WS6 Stage A |
| WS5 | [OPC UA Transform and Smoothing](./2026-07-13-opcua-transform-smoothing.md) | Connector numeric/transform catalogs, canonical browser binding, ownership, trajectory | WS1 + WS6 Stage A |
| WS6 | [Mode Workspace and Release](./2026-07-13-mode-workspace-release.md) | Stage A App shell; Stage B mode panels, responsive/a11y integration, release docs | WS1 for Stage A; WS2-WS5 for Stage B |

Cross-workstream ownership rules:

- WS1 owns Project V3 types, migrations, and the shared `src/lib/hash/sha256.ts` utility required for revision/source identity. WS2 through WS5 add behavior through the frozen contracts and do not edit schema shape or recreate that utility independently.
- WS2 owns Robot source analysis and canonical Link mapping; it does not infer mechanical axes, origins, limits, or speeds from geometry.
- WS3 owns Job/Pose mutation and playback. Collision consumes immutable Job validation requests and does not own Job state.
- WS4 owns generated geometry and primitive feature behavior. WS1 remains the sole schema/archive codec owner; WS4 consumes that serialization contract and adds only its serialized Project-runtime integration after the WS2/WS3 runtime commits. Existing Object Instance selection, transform, status, grasp, and collision adapters remain shared consumers.
- WS5 owns numeric catalog resolution/routing plus raw/accepted/effective external transforms and source ownership. Rendering and collision read the same effective transform selector; numeric values are converted only once in Middleware.
- WS6 owns navigation and presentation plus the checked-in Windows/Linux Chromium functional matrix and DPR1/DPR2 browser evidence. It must not duplicate domain state or make mode switching mutate source, Job, Project, or scene state.

---

## 5. Locked Product Decisions

### Robot assembly import

- Preflight one through seven selected STEP/STP `File` objects and their selected byte limits before reading; after digest collapse require one through seven unique persisted source Assets and parse each retained source exactly once.
- If byte-identical selections are supplied more than once, retain the first, collapse later selections by SHA-256, and show one non-blocking duplicate-source warning before validating the unique-source count.
- Digest collapse does not preserve filename/selection ordinal as a semantic occurrence. Byte-identical independent flat single-part Files therefore cannot be assigned to two Links: duplicate ownership fails as `ROBOT_LINK_PART_CONFLICT` with guidance to use distinct Link Geometry or one component-preserving assembly. Repeated identical Geometry inside one assembly remains supported when each placement has a distinct non-negative node path.
- Build exactly seven canonical Link slots from an assembly tree or flat mesh set. Names provide deterministic suggestions; the operator confirms ownership before commit.
- Map J1 as `LINK00 -> LINK01` through J6 as `LINK05 -> LINK06`.
- A fused body that cannot assign each mesh to exactly one Link fails with `ROBOT_STEP_FUSED_BODY`; there is no automatic solid splitting.
- Mechanics come from Datasheet, Manifest, or Manual values. Geometry never silently changes kinematic dimensions.
- Datasheet defaults and user-edited Robot name, Base XYZRPY, each Joint origin/axis/limits/maximum velocity, and geometry-local transforms remain independently editable and persist through Project V3.
- Mechanics additionally persists command-space Home/direction/zero offset, separate Link06-to-Flange and Flange-to-Tool0 transforms, and Tool0-to-TCP; MCP/Flange/Tool0/TCP are rigid transforms with exact scale `[1, 1, 1]`. Effective angle is `direction * commandAngleDeg + zeroOffsetDeg`, and maximum velocity must be finite and strictly positive.
- Resolve and persist each source unit before mapping. Different sources may use different resolved units and are normalized to metres independently; an unknown or internally conflicting unit blocks commit until deterministic operator resolution.
- Preserve the existing seven-file Robot path as a regression case.

### Simulation Jobs

- Project contains ordered Jobs; each Job directly owns ordered Pose Steps.
- Save Pose appends to the active Job. With no Job, it atomically creates `Job 1` and appends the Pose.
- Only the active Job can play or validate. Playback snapshots the Job revision; Job switch, Job/Pose mutations, and Joint-source changes are blocked while the session is `playing` or `paused`. Among user actions only explicit Stop returns to `idle` and unlocks editing while retaining the current Pose. Natural completion retains the final Pose and fatal quality/error retains the sampled current Pose; both are explicit non-user terminal paths that return to `idle`.
- OPC UA Joint source makes Job editing and playback read-only without hiding saved Jobs.
- Project snapshot is authoritative. Legacy `robot-sim.pose-sequence.v1` localStorage is one-time recovery input only and is deleted only after matching stable Project finalization, active runtime/verified-handle activation, and successful Project-backed Job hydration; every earlier failure retains it for retry.
- Non-terminal Pose duration is canonically derived from maximum Joint travel, Mechanics maximum velocities, and outgoing speed with a 16 ms minimum. V1/V2 migration recomputes it and warns when legacy timing changed; terminal duration is exactly 1,000 ms.

### Primitive Objects

- The Add menu exposes `Import STEP Object`, `Create Box`, and `Create Cylinder`.
- Project V3 uses the exact discriminator `sourceKind: 'step' | 'box' | 'cylinder'`. Box stores `dimensionsM` and uppercase `color`; Cylinder stores `radiusM`, `heightM`, uppercase `color`, `axis: 'z'`, and `radialSegments: 32`.
- Box uses exact visual bounds and one Box collision proxy. Cylinder uses a 32-segment closed visual mesh and one conservative local Box proxy with half-extents `[radius, radius, height / 2]`; the existing world transform makes that proxy an OBB in collision queries.
- Generated triangles count toward the visible-scene triangle budget but not STEP byte or ZIP STEP-entry budgets.
- Generated Objects support name, dimensions, color, Graspable default OFF, manual MCP-local XYZRPY, durable `manualNumericStatus` fallback, transient OPC numeric overlay value, OPC binding, persistence, and deletion. This stage has no separate per-Object Manual frame selector; only OPC bindings select World or MCP, with MCP as the default. V1/V2 instances also migrate with Graspable OFF because that choice was not durable in the legacy Project format.

### OPC UA Object transforms

- Connector profile owns six scalar Node mappings for X/Y/Z/R/P/Y, scale, offset, sampling interval, and identity/revision metadata.
- Browser Project stores `gatewayId`, `gatewayProfileId`, `gatewayProfileRevision`, reference `world | mcp` (default `mcp`), manual fallback, and smoothing policy; it never stores raw NodeIds.
- Numeric Status source and Transform source are independent. Changing or deleting one binding never rewrites the other.
- Either OPC UA source requires exactly one matching Binding in the same valid Project candidate. Removing an active Binding atomically returns only that source to Manual, restores its durable fallback, clears its transient runtime state, and removes the Binding; no invalid intermediate snapshot is published.
- V3 numeric Status Binding is exactly `{ entityId, nodeId, scale, offset }`, where `entityId` is canonical `equipment:* | object:*`. It replaces the V2 Object-only `instanceId`; native V3 rejects legacy/duplicate/orphan targets, while migration maps `instanceId` to `object:${instanceId}` without changing NodeId/scale/offset.
- Middleware projects the unchanged numeric `equipment` configuration plus global T as a read-only catalog, including numeric-only connections with zero Transform Profiles. The browser resolves an exact unique NodeId/scale/offset tuple, routes values keyed by Connector mapping ID to the canonical target, and never applies scale/offset twice; zero/multiple matches are BAD and hold the Manual fallback. Numeric silence becomes STALE at exactly `max(3*T, 1000 ms)`.
- Numeric and Transform catalogs carry the same Gateway ID, precede their frame kinds, and are immutable within one connection. Reconnect clears both catalogs, mappings, sequences, and generation-owned frames; mismatched replacements close the socket.
- Middleware emits a numeric value only for GOOD OPC UA StatusCode plus finite converted output. BAD/missing/non-finite/read-failure values are `null`; the browser shows `manualNumericStatus` with non-GOOD quality and refreshes no live clock.
- Convert `output = raw * scale + offset`, XYZ to metres, RPY degrees with ZYX order to a normalized quaternion.
- For default `samplingIntervalMs = 100`, interpolation duration is exactly 200 ms. Translation uses lerp; rotation uses normalized shortest-arc quaternion slerp.
- On a new changed GOOD received before the prior trajectory ends, rebase from the effective pose at receipt time. Do not extrapolate.
- BAD (including a valid cycle with missing/non-finite values), STALE, disconnect, and bounded malformed-string protocol faults sample the current `renderPose` at transition time, assign that held Pose to target/render, cancel the active segment, and never apply a zero or partial Pose. Duplicate and out-of-order frames are ignored completely: they refresh no clock and change no quality, Pose, revision, or active segment.
- Wire `GOOD | BAD` quality and browser runtime `WAITING | STALE | DISCONNECTED` state remain separate. Accepted frames, age checks, interpolation, and visibility sampling use one injected browser-local clock whose production default is `Date.now()`; Connector epoch timestamps are diagnostic, and the reducer never mixes them or `performance.now()` into its arithmetic. A negative elapsed value after a backward wall-clock jump holds the current value/Pose as non-fresh and requires the next valid current-generation GOOD baseline; a forward jump may make it STALE. Binding/source/generation changes clear old samples, and an entity generation token rejects late frames after rebinding or deletion.
- Transform OPC ownership blocks Manual XYZRPY, drag, and grasp only. Numeric Status ownership is independent: numeric fallback editing is blocked only while numeric `statusSource` is OPC UA. Returning either source to Manual restores its corresponding saved transform or `manualNumericStatus` fallback.
- An accepted changed target increments `targetRevision` and invalidates collision/report content exactly once. Per-frame interpolation increments `renderRevision` for scene/live collision but causes no additional report-target invalidations.

### Mode workspace

- `BUILD`: Robot/Object import, primitive creation, scene hierarchy, manual transforms, and coordinate frames.
- `SIMULATE`: Joint controls, Simulation Jobs, Timeline, playback, speed/easing, and gripper.
- `CONNECT`: Connector/profile catalog, entity bindings, ownership, quality, stale/held state, and diagnostics.
- `VALIDATE`: Current-pose collision, active-Job validation, progress, findings, stale-report state, and exportable report.
- The initial workspace mode is `BUILD`; mode remains unchanged only for the current browser session and is excluded from `.wdtwin`.
- The left rail remains scene hierarchy, the centre remains the 3D viewport, the right rail is contextual inspection, and the bottom dock switches among Timeline, Collision, and Events.

---

## 6. Quantitative Success Criteria

### SC-PROJECT: V3 and persistence

- V1 to V2 to V3 and V2 to V3 migrations are deterministic and preserve Pose order/id/angles/speed/easing, STEP bytes, Object transforms/status, Robot mechanics, and current bindings.
- A migrated flat Pose array becomes one `job-default` / `Default Job`, including the empty-array case.
- V3 save, browser reload, export, and import are semantically equal. Deterministic JSON entries are byte-stable.
- Public raw ingress synchronously clones the non-binary graph and owns every Robot/Object source before its first await, then hashes each untrusted/new source exactly once into opaque prepared tokens. Revision identity separately hashes the canonical byte-free projection; metadata-only mutations preserve repository handles and perform zero source copies, source-digest calls, parser/Geometry rebuilds, or Blob writes. A prepared token is consumed once and owner-bound verified handles are minted only after matching stable-pointer finalization and active runtime publication; preparation, pointer publication, and runtime publication alone mint no handle. Robot results equal both declared `id` and `sha256`; different STEP bytes cannot alias one immutable revision, byte-identical sources plus identical configuration reuse identity, and caller/public-read mutation cannot alter stored bytes.
- Content addressing is namespace-local: the Robot namespace stores exactly one `robot/sources/<sha>.step` per unique Robot source hash, including a one-source seven-Link Robot; the Object namespace stores exactly one `objects/assets/<sha>.step` per unique STEP Object content hash. Identical bytes used once as Robot source and once as Object Asset still produce one entry in each namespace; cross-namespace de-duplication is not required.
- Native and decoded V3 Projects enforce one through seven unique Robot STEP source records; zero/eight and unreferenced source records fail before runtime preparation.
- ProjectDB stores byte-free immutable revisions plus namespace-local source Blobs and a stable/publishing pointer. It interns one resident buffer per namespace/digest; same-digest semantic owners share that buffer and one digest/config parse cache, while each public read clones a unique Blob at most once. One hundred metadata edits retain one revision after atomic pointer-derived GC. Cross-tab commit/GC, quota preflight/`QuotaExceededError`, and publishing crash recovery are deterministic.
- Corrupt input, missing references, parser failure, or pre-publication budget/commit failure leaves the active revision, scene, selection, repositories, and collision registry unchanged. Post-publication finalization or post-finalization token-consumption/handle-activation failure keeps the coherent new pointer/runtime locked for recovery with no observer/edit access; old-runtime disposal is success-with-warning. Obsolete legacy Project/Object/Equipment rows are removed only after the same revision has a stable pointer, active runtime plus verified owner handles, and a fresh DB-only reopen-equivalent integrity proof. No path exposes a mixed revision.
- Exact Job limits 32/256/2,048 pass; plus one fails before mutation.
- Exact Object Asset/Instance/render-item limits 256/512/1,024, runtime mounted Status-overlay cap 128, general ID/name 128 UTF-8 bytes, and STEP/Manifest filename 255 UTF-8 bytes pass. Asset/Instance/render-item and text limits reject plus one before publication; overlay candidate 129 is deterministically culled without changing Project configuration.
- Canonical numeric Status bindings round-trip for both built-in and Object targets; V2 Object bindings migrate without changing NodeId/scale/offset, and no effective live Status/quality/time enters the revision or archive.
- CONNECT exposes tested numeric mapping create/replace/delete for both canonical entity kinds independently from Transform binding controls.
- New Project, current whole-STEP Object import, and all new Robot/Job/Pose/Primitive creation paths use the central portable ID factory. Unit tests cover both crypto branches and a non-secure-origin Chromium gate completes creation workflows with `randomUUID` absent and `getRandomValues` present; production feature sources contain zero direct `crypto.randomUUID()` calls.

### SC-ROBOT: deterministic assembly import

- One through seven selected Robot `File` objects and, independently, one through seven unique post-digest source Assets resolve exactly `LINK00` through `LINK06`, with no missing or duplicate mesh ownership. Selection 0/8, including eight duplicates, rejects before read/copy/hash/Worker allocation; 25 MiB/File and 100 MiB selected-size exact boundaries pass.
- Each source is read, hashed, parsed, and stored once. Reused source references do not duplicate bytes.
- Two byte-identical independent flat single-part Files collapse to one ordinary occurrence and cannot manufacture two Link placements; duplicate ownership rejects as `ROBOT_LINK_PART_CONFLICT` with explicit distinct-Geometry/component-assembly guidance. One assembly may assign repeated identical raw Geometry to different Links only through distinct node paths.
- Every source `id` equals its exact lowercase 64-hex SHA-256. New Import emits only non-negative integer node paths; exact WS1 reserved legacy refs restore only through the isolated adapter. A declared/manual Mechanics count other than six fails with `ROBOT_JOINT_COUNT_UNSUPPORTED`, reports declared/required counts, and mutates nothing.
- New one-source local acceptance fixture: 13,093,130 bytes, SHA-256 `4130e05b6287fa47a49d376b6ab3cde3c98306155118d6f6e06751d1067b9ef1`, 38,299 triangles, seven named Link meshes, and occt-import-js 0.0.23. Keep that new assembly local; preserve the repository's existing tracked seven-Link ABB production baseline, while new CI coverage uses generated self-contained fixtures.
- At Zero Pose, each localized Link source-subset AABB differs by at most 0.5 mm and each expected world-matrix element by at most `1e-6`.
- Moving Jn changes only `LINK0n` and descendants through `LINK06`.
- Self-contained separable AP203/AP214/AP242 Geometry is supported when OCCT exposes seven finite triangulatable occurrences. Unresolved external references, unsupported tessellated/PMI-only input, and fused bodies fail deterministically; AP242 kinematic metadata never supplies Mechanics.
- Datasheet mechanics load as the default; optional Manifest size is at most 1,048,576 bytes with pre-read boundary/error tests, one original-byte digest, fatal UTF-8/JSON/closed-schema validation, cancellation, and no raw-byte persistence. Finite user edits to Robot name, Base pose, every Joint origin/axis/command-space limit/Home/direction/offset/strictly-positive maximum velocity, all seven Geometry-local transforms, and separate rigid MCP/Flange/Tool0/TCP round-trip exactly. UI uses mm/deg and preserves untouched full precision; invalid edits, derived non-finite results, non-unit frame scale, and Geometry remapping leave prior Mechanics unchanged.
- Cancel becomes visible within 250 ms; Worker watchdog is exactly 60,000 ms; every pre-commit failure leaks zero staged Three.js resources.
- Robot limits: 25 MiB/source, 100 MiB unique total, 600,000 triangles total, 150,000 triangles/Link, 448 meshes, 2,048 assembly nodes, depth 64, 448 part references, 224 materials total, 64 meshes/Link, 32 materials/Link, and 256 MiB Worker typed-array payload. Exact boundary passes; plus one fails.

### SC-JOB: authoring, playback, and validation

- Create, rename, duplicate, delete, and select Job are deterministic. Duplicate creates new Job/Pose IDs while preserving Pose content exactly.
- Pose add/delete/reorder and speed 1 through 100 percent plus supported easing are isolated to the active Job.
- Save current Pose defaults to 100 percent, `easeInOut`, and a 1,000 ms terminal placeholder; the placeholder contributes zero elapsed playback time and is recalculated when it gains an outgoing successor.
- Every non-terminal stored duration matches the frozen speed/Mechanics formula within `1e-9 ms` and is at least 16 ms; terminal is exactly 1,000 ms. Every Job/Pose command is one async byte-free `ProjectMutationService.replaceFromActive()` recipe; published Job stores remain read-only while pending/rejected. Angle/order/speed edits recalculate affected values atomically. A Mechanics edit or Robot replacement includes new Mechanics plus all affected Job durations/revisions in that same recipe and one publication, with no post-commit repair.
- Deleting the active Job selects the next Job, otherwise the previous Job, otherwise `null`.
- Job switch does not move the Robot. Playback snapshots one active Job and blocks Job/Pose mutation plus Joint-source change until Stop or a defined non-user terminal path. Natural completion publishes the final Pose once; fatal quality/error holds the current interpolated Pose and reports the reason.
- Validation request/progress/result/report carries `jobId` and `jobRevision`; relevant Job, Pose, speed/easing, or Robot-mechanics changes cancel running work and mark completed reports stale.
- OPC UA Joint mode is view-only for Jobs and exposes the ownership reason.

### SC-PRIMITIVE: generated Objects

- Box validates each dimension in `[0.001, 10]` metres, renders 12 triangles, and uses exact half-extents `[width/2, height/2, depth/2]`.
- Closed 32-segment Cylinder validates radius in `[0.0005, 5]` metres and height in `[0.001, 10]` metres, renders 128 triangles, and uses conservative Box-proxy half-extents `[radius, radius, height/2]`.
- Primitive color normalizes to uppercase `#RRGGBB`; alpha, textures, and per-face materials remain excluded.
- Creation of one Asset, one Instance, and its canonical external state is one async byte-free Project recipe with no source groups. Object stores are published read models; invalid input and compensated/pre-publication failure leave state unchanged, while later failure follows the frozen recovery matrix.
- Save/reload/export/import preserves source kind, dimensions, color, Graspable, canonical MCP-local Manual transform, overlay configuration, `manualNumericStatus`, collision proxy, and OPC binding/reference exactly; effective live Status/quality/time is absent and Manual restores the fallback.
- Visible in-frustum Status-overlay candidates rank by selected canonical entity first, then camera-space distance, then canonical ID. Runtime mounts at most 128 overlay roots, recomputes at most once per animation frame, and culls the rest without mutating `statusOverlayVisible` or numeric runtime state.
- Generated Objects add no STEP bytes or STEP archive entry, while their triangle counts contribute to the 1,500,000 visible-scene limit.
- Primitive forms display/edit Box dimensions and Cylinder radius/height in mm to three decimals and Manual XYZ in mm/RPY in degrees; domain/archive values remain metres/quaternions and untouched rounded fields do not drift.

### SC-OPC: transform, ownership, and smoothing

- Six values from one Connector sampling cycle form one frame. Partial, non-finite, BAD, duplicate, or out-of-order input produces zero accepted target.
- Example raw `[1000, -250, 800, 10, 20, 30]` with XYZ scale `0.001` yields position `[1, -0.25, 0.8]`; ZYX quaternion absolute component error is at most `1e-6`.
- The first complete GOOD after Binding/source/generation change or reconnect snaps exactly once to establish the baseline. Foreground resume snaps only when the retained same-generation target remains current-quality GOOD, no later non-GOOD/fault occurred, and it is fresh; an absent/stale/BAD/faulted target remains HELD and the first later fresh GOOD performs the one pending snap. The next changed target interpolates with `D = 2 * samplingIntervalMs`, reaching the mathematically correct midpoint at `D/2` and target at `D`, within one render frame.
- Yaw `179 deg -> -179 deg` follows the 2-degree shortest arc. Re-targeting mid-trajectory changes no effective matrix element by more than `1e-9` at the receipt instant.
- One hundred identical frames cause zero geometry mutation and zero collision content-revision increments.
- STALE is `max(3 * samplingIntervalMs, 1000 ms)`. BAD/STALE/bounded malformed-string protocol fault/disconnect samples and freezes the current effective Pose, marks motion `HELD`, and never applies a zero or partial Pose. Joint presentation keeps last accepted `JointQuality`, transport overlay `BAD | STALE | null`, and shared connection state separately, and exposes derived `effectiveQuality = transportOverlay ?? acceptedQuality`. A bounded malformed string keeps the socket CONNECTED, refreshes no clocks, preserves accepted Joint angles/quality/time, sets only its transport overlay BAD, and fans numeric/transform BAD. Binary/oversized input closes the connection, preserves that accepted Joint data, keeps overlay BAD, and exposes DISCONNECTED only as connection state. Reconnect clears the old-generation overlay and starts a 1,000 ms silence watchdog; a valid current-generation frame clears its overlay, and recovery never passes through zero angles.
- With no catalog, handshake quality remains WAITING at 2,999 ms after socket open and becomes BAD at exactly 3,000 ms; only an accepted catalog supplies T for later stale deadlines.
- Hiding samples and holds the current render Pose and clears the active segment. Background-tab resume discards all hidden trajectory time and snaps once only to a fresh same-generation target that remains current-quality GOOD with no later non-GOOD/fault; an absent/stale/BAD/faulted target keeps the pre-background Pose HELD until the first later fresh complete GOOD establishes the baseline.
- With the checked-in 100 ms sampling profile, non-baseline target latency is 200 ms plus at most one render frame and never exceeds 250 ms in the jittered reference test.
- Connector limits: 32 transform profiles, 256 total read Nodes, 65,536 UTF-8 bytes per catalog/frame payload, 128 UTF-8 bytes per gateway/profile/display id, 1,024 UTF-8 bytes per NodeId, and `MAX_GATEWAY_CLIENTS = 8`. Clients one through eight share one poll result; a ninth closes only itself with WebSocket code `1013`. Before broadcast, `bufferedAmount === 1_048_576` remains accepted while any value greater than 1,048,576 (exact test: 1,048,577) closes only that slow client with code `1013`; it cannot delay polling or other clients. Other exact boundaries pass and plus one fails before startup or state reduction.
- Render and collision observe the same effective pose. Collision reflects it within the existing 100 ms poll plus one render frame.

### SC-UI: mode workspace and accessibility

- Mode round-trips preserve scene, selection, active Job, source ownership, and dirty state. Mode switching never performs implicit Stop, Apply, source change, or Robot movement.
- Scene Explorer deletion removes either a STEP or generated Object through the canonical atomic removal path, including selection, overlay, bindings, interaction, and collision state; a failed removal preserves all of them.
- Existing status semantics remain a regression gate: `OFF` lights no lens, `RUNNING` lights green, `WARNING` lights yellow, and `FAULT` lights red. Numeric Status overlay and Transform Binding stay independent through mode switches and Project round-trip.
- The top bar shows one workspace mode and separate source/ownership/quality. It never displays contradictory `SIMULATION` and `GOOD` semantics.
- `MANUAL`, `SIMULATION`, `OPC UA`, `GOOD`, `UNCERTAIN` (Robot Joint quality only), `BAD`, `WAITING`, `STALE`, `DISCONNECTED`, and `HELD` use text plus icon, never color alone. Accepted Robot `JointQuality` preserves `UNCERTAIN`; numeric Status and Transform OPC UA `Uncertain` StatusCodes reduce to BAD.
- Keyboard-only operation completes mode switch, Add/import, Job CRUD, Pose reorder/playback, binding, and validation with no keyboard trap and correct dialog focus return.
- Target WCAG 2.2 AA: normal text contrast at least 4.5:1, large text 3:1, and UI/focus contrast 3:1. Desktop icon-only targets are at least 32 by 32 CSS pixels; narrow targets are at least 44 by 44 CSS pixels. Automated keyboard, focus, contrast, target-size, and non-color-state checks pass for all four modes and their primary dialogs.
- At 200% zoom for 1440x900 and at 768x1024, there is no page-level horizontal scroll and no lost primary action; side rails become drawers/sheets where required.
- Engineering numeric defaults display millimetres to three decimals and degrees to two decimals without changing stored precision.
- Numeric/Transform Binding Apply/Delete/Cancel/invalid outcomes use the frozen exact messages, one persistent polite live region, and deterministic focus return; smoothing copy is `2 cycles · derived milliseconds` (or the concrete `2 cycles · ${2*T} ms` when T is known).

### SC-PERF: retained system budgets

- Object STEP limits remain 50 MiB, 250,000 triangles, 64 meshes, and 32 materials per Asset.
- Project raw STEP limit remains 256 MiB; archive limit remains 300 MiB compressed, 1,024 entries, and 8 MiB per JSON entry.
- Archive hashing/codec run in Workers with 4 MiB chunks, exact 60/120 s watchdogs, cancel within 250 ms, less than 8 MiB hash auxiliary and at most 64 MiB codec auxiliary workspace; the main thread has no whole-source hash or synchronous ZIP loop.
- Visible scene remains at most 1,500,000 triangles; collision remains at most 16 Boxes/entity and 1,024 Boxes/project.
- Restore byte-verifies but does not parse uninstantiated/exclusively hidden Object Assets. Showing an Asset lazily prepares it and enforces actual parser totals, visible triangles, and 1,024 Mesh/material groups before publication.
- Current-pose collision remains 10 Hz. Job validation remains at most 20,000 samples and 10,000 findings.
- The 1,000-sample Worker test emits progress `[250, 500, 750, 1000]`, and browser animation advances more than 10 frames while validation runs.
- Smoothing supports 32 profiles with constant-size current/target/segment state, uses less than 1 MiB for all reducer/protocol sample state, and has p95 update cost below 2 ms/frame in the reference test.
- On each declared Windows and Linux production-Chromium reference run, the controlled quantitative lane fixes viewport 1440x900 and `deviceScaleFactor: 1`. Its exact 1,024-group/at-most-1,500,000-triangle fixture exposes 512 eligible numeric Status overlays but mounts at most the deterministically ranked 128; after a 5 s warm-up plus 10 s orbit it has p95 frame interval at most 33.4 ms, no Long Task above 200 ms, no WebGL context loss, and peak `JSHeapUsedSize` at most 768 MiB. The 1,025th group rejects before publication, while overlay candidate 129 is culled rather than rejected.
- A separate production-Chromium `deviceScaleFactor: 2` smoke on both declared operating systems proves initial WebGL render, one camera orbit, the same 128-overlay cap, and zero `webglcontextlost`; DPR2 does not inherit the DPR1 frame-interval or heap threshold.

---

## 7. Consolidated Release Gate

- [ ] **Gate R1: Contract and migration suites**

  Run: `npm run test:run -- src/domain/project src/features/project`

  Expected: all V1/V2/V3 contract, migration, codec, rollback, and fault-injection tests pass.

- [ ] **Gate R2: Feature suites**

  Run: `npm run test:run -- src/features/robot src/features/joints src/features/ui src/features/objects src/features/equipment src/features/collision src/features/interaction`

  Expected: all assembly, Job, primitive, transform, smoothing, ownership, collision, and UI component tests pass.

- [ ] **Gate R3: Middleware protocol**

  Run: `npm run test:middleware`

  Expected: joint, numeric-status, transform-profile, atomic-frame, size-limit, reconnect, stale-quality, exact 8/9 client admission, and 1,048,576/1,048,577 per-client backpressure tests pass without creating a per-client OPC UA poller.

- [ ] **Gate R4: Full static/unit/CAD/build verification**

  Run: `npm run verify`

  Expected: lint exits 0, all existing 451 tests plus new tests pass, CAD validation reports seven valid links with zero errors/warnings, and production build exits 0.

- [ ] **Gate R5: Browser workflows and trusted-LAN HTTP origin**

  Run each command in order:

  ```powershell
  npm run test:e2e
  npm run test:e2e:insecure
  npm run test:perf:reference
  ```

  Expected: existing Project round-trip and geometry-collision tests plus new assembly import, Simulation Job, primitive Object, OPC transform/smoothing, zoom/reflow, and four-mode workspace tests pass with no timeout waiver. The second run uses a mapped non-local hostname, confirms a non-secure context without `randomUUID`, and still creates unique Project/Object/Job/Pose/Primitive IDs through `getRandomValues`. The checked-in functional workflow has an explicit `windows-latest`/`ubuntu-latest` production-Chromium matrix for WebGL, OCCT WASM Worker one-source Robot import, Project round-trip, and same-origin `/opcua` catalog/frame receipt. The controlled performance project fixes DPR1; a separate DPR2 smoke proves render/orbit/128-overlay cap/context stability. macOS/Safari is explicitly not part of this stage.

- [ ] **Gate R6: Deployment compatibility**

  Run each command in order and stop at the first non-zero exit:

  ```powershell
  npm run deploy:validate
  npm run deploy:build
  npm run deploy:smoke
  npm run deploy:smoke:opcua
  ```

  Expected: deployment config validates, images build, and web health smoke passes. WebSocket open alone cannot pass the Connector smoke: through same-origin `/opcua` it must decode a schema-valid Profile catalog, then receive the configured unavailable-upstream complete all-BAD frame and assert that no GOOD sample of any Pose, zero Pose, or partial Pose was emitted; the Connector retains no OPC write capability.

- [ ] **Gate R7: Dependency audit and clean diff**

  Run: `npm audit --audit-level=high`

  Expected: zero high-severity findings. `git status --short` contains only approved source/docs/test changes and retains the pre-existing untracked CAD/backup directories untouched.

---

## 8. Delivery Milestones

| Milestone | Deliverable | Demo | Completion rule |
|---|---|---|---|
| M0 | Approved V3 amendment | Contract walkthrough | G0 approved |
| M1 | Crash-consistent Project V3 | V2 import -> V3 save -> reload -> export/import | WS1 tests and R1 pass |
| M2 | Robot assembly import | One-file assembly plus seven-file regression | WS2 criteria pass |
| M3 | Simulation Jobs | Job create/duplicate, Pose reorder, play/validate/reload | WS3 criteria pass |
| M4 | Generated Objects | Create Box/Cylinder, transform, bind, collide, reload | WS4 criteria pass |
| M5 | Live transform smoothing | Jittered XYZRPY stream, quality hold, shared collision pose | WS5 and R3 pass |
| M6 | Engineering workspace release | BUILD -> SIMULATE -> CONNECT -> VALIDATE workflow | R1 through R7 pass |

No milestone is complete from UI appearance alone. Its domain tests, persistence round-trip, failure atomicity, and relevant performance boundary must also pass.

---

## 9. Future Roadmap, Not Current Implementation

- AI/API/harness-assisted STEP semantic remapping after deterministic analysis fails, with an explicit preview/approval gate and no raw API key in Project files.
- OPC UA Subscription transport with sequence/timestamp normalization behind the same accepted-target protocol.
- Arbitrary user Frame Graphs beyond World/MCP references.
- Variable-DOF, branched, parallel, or multi-Robot cells.
- Automatic solid/body splitting, mesh decimation, LOD generation, and server-side CAD conversion.
- IK, path planning, dynamics, physics response, PLC program execution, and controller write-back.
- Security hardening, certificates, authentication, roles, audit logging, and multi-tenant/cloud deployment.

---

## Self-Review

- Coverage: every requested current-stage capability maps to one workstream and one measurable success section.
- Dependency safety: all feature work consumes one frozen Project V3 contract; final UI integration waits for WS2 through WS5.
- Collision consistency: raw OPC targets never bypass the shared effective transform used by rendering and geometry collision.
- Determinism: Robot extraction has no AI fallback, Jobs have fixed ownership, primitives have fixed tessellation/proxies, and migration/cardinality rules are explicit.
- Failure behavior: import, migration, delete, Connector reduction, and persistence failures specify no partial active-state mutation.
- Scope control: Future Roadmap items have no current schema, UI, credential, or dormant implementation requirement.
- Placeholder review: every gate has an exact file, command, threshold, or normative decision.
