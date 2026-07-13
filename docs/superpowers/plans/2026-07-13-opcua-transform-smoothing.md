# OPC UA Equipment Transform Smoothing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move built-in Equipment and imported Objects from read-only six-node OPC UA Pose targets with deterministic quality handling and 200 ms default visual smoothing, while rendering and geometric collision always consume the same current interpolated Pose.

**Architecture:** The Middleware validates a bounded catalog of six-node transform Profiles, computes immutable revisions, and performs one polling Read per cycle for Joints, numeric Status, and transforms. The browser validates bounded catalog/frame messages, maps Profiles to canonical v3 external entities, and reduces accepted targets through a generation-gated smoothing state machine. Each accepted changed target invalidates collision reports once; animation-frame render revisions update both scene and live collision without repeatedly invalidating reports.

**Tech Stack:** Node.js 22, node-opcua 2.175, ws 8.21, React 19, TypeScript 6, Three.js 0.185.1, Zustand 5, Vitest 4, Playwright 1.61.

## Global Constraints

- Task 1 is the detailed Wave 0/G0 edit procedure referenced by the master roadmap. Execute and approve it before WS1; when WS5 resumes after WS1 and WS6 Stage A, verify that commit and start at Task 2. Never amend the frozen contract a second time inside WS5.
- If this document is opened standalone after G0, verify that the approved specification no longer contains the two RED phrases and does contain the Step 5 GREEN terms, mark Task 1 complete from that evidence, and start at Task 2; do not rerun the original RED expectation.
- Source implementation requires the WS1 Project v3/canonical external-entity foundation. This plan consumes its frozen transform state and binding types; it does not create another Project schema, migration, codec, or source-of-truth store.
- Execute against the landed WS6 Stage A Mode shell. WS5 owns Connector/client/reducer/controlled Binding UI behavior; WS6 Stage B owns final CONNECT placement and cross-feature browser acceptance.
- Consume the frozen persisted policy exactly as `smoothing: { mode: 'two-cycle', cycles: 2 }`. Derive milliseconds from the accepted Gateway Profile interval; do not persist a duration, expose a duration editor, or accept any other smoothing policy.
- The current stage is read-only polling. The Connector may call `session.read` only; OPC UA writes, method calls, commands, MonitoredItems, and Subscriptions are forbidden.
- No AI/ML Pose generation, prediction, extrapolation, filtering, or path planning.
- A Profile contains exactly six scalar mappings: X, Y, Z, Roll, Pitch, Yaw. A target is GOOD only when all six DataValues in the same Connector read cycle are GOOD and map to finite numbers.
- Connector/server limits are fixed: at most 32 transform Profiles, at most 256 total read Nodes per cycle, Gateway/Profile/name fields of 1-128 UTF-8 bytes, NodeIds of 1-1,024 UTF-8 bytes, and catalog/frame JSON payloads of at most 65,536 UTF-8 bytes.
- `samplingIntervalMs` is within `[10, 1000]`; checked-in default is `100`. Interpolation duration is always `D = 2 * T`, so the default is `200 ms` and the allowed duration range is `[20, 2000] ms`.
- Translation uses component-wise linear interpolation. Rotation converts `Euler(roll, pitch, yaw, 'ZYX')` to normalized Quaternion and uses shortest-arc slerp. Persisted Manual Geometry scale is never controlled by OPC UA.
- The first complete GOOD after a Binding/source/generation change or WebSocket reconnect snaps once to establish the baseline. A foreground resume snaps only when the retained frame is the latest same-generation complete sample, current quality is still GOOD, no later BAD/STALE/protocol fault/disconnect occurred, and its age is below the stale threshold; otherwise the Pose remains HELD with the baseline pending. Only subsequent changed GOOD targets interpolate from the sampled current render Pose.
- BAD, STALE, malformed input, and disconnect evaluate the active segment at the transition time, freeze that effective render Pose, cancel the segment, and expose separate motion/presentation state `HELD`; they never move to zero. A mismatch uses Manual fallback only when that generation has no prior GOOD, otherwise it retains the held render Pose.
- A bounded string payload that is invalid JSON or fails the closed message schema emits one current-generation protocol fault: do not refresh sequence, receipt, or last-GOOD clocks; transition every active transform Binding on that connection to BAD/HELD immediately; and keep the socket open. Binary or oversized payload closes the socket and transitions those Bindings to DISCONNECTED/HELD.
- Background tabs do not extrapolate or replay a backlog. Retain only the latest accepted target plus current quality. On foreground resume, snap only when that same-generation complete target remains current-quality GOOD with no later non-GOOD/fault and is younger than `max(3 * T, 1000 ms)`. Otherwise keep the current render Pose, expose the current non-GOOD/STALE state with HELD, retain `baselineRequired: true`, and let the first later fresh complete GOOD target perform the one baseline snap.
- Current render Pose is the one input to rendering, overlays, selection, interaction eligibility, Geometry registry, and live geometric collision. Target Pose must never be rendered or collided directly.
- A matrix difference is changed only when any 4x4 element differs by more than `1e-9`. An accepted changed target increments `targetRevision` and invalidates reports exactly once. Interpolated movement increments `renderRevision` but does not repeatedly invalidate reports.
- Target equality is measured in the selected reference-frame coordinates. Independent Manual entity or MCP/World frame edits retain their existing collision invalidation path; they must not masquerade as a new OPC UA target revision.
- Authority is serialized per canonical entity. Binding/source changes, Manual preview/apply, grasp begin/release, delete, Project replacement, and gateway application all capture a monotonic generation; late work from an older generation is ignored.
- One Project may assign a transform Profile to at most one entity. `referenceFrameId` is exactly `world | mcp`, mode is exactly `absolute`, and the default is `mcp`.
- Use TDD and one focused commit per task. Preserve existing Joint simulation and numeric Equipment Status behavior.

---

### Task 1 (Wave 0 / G0): Amend the Normative Smoothing and Collision Contract

**Files:**
- Modify: `docs/superpowers/specs/2026-07-13-single-assembly-robot-opcua-equipment-transform-design.md`

**Interfaces:**
- Produces: normative definitions of `targetPose`, `renderPose`, `targetRevision`, `renderRevision`, hold behavior, and `D = 2 * samplingIntervalMs`.
- Consumes: existing sections 6.4, 8.1, 8.3, 8.4, and success criteria 11.2; source work in Tasks 2-6 must cite this amended contract.

Add this rule before implementation:

```text
When baselineRequired and a complete GOOD target arrives:
  renderPose = target
  targetPose = target
  activeSegment = none
  motionState = SETTLED
  baselineRequired = false

On each subsequent accepted changed GOOD target at monotonic time t0:
  from = sample(renderPose, t0)
  to = accepted target Pose
  durationMs = 2 * samplingIntervalMs
  renderPose(t) = lerp/slerp(from, to, clamp((t - t0) / durationMs, 0, 1))

On BAD, STALE, malformed input, or disconnect at time th:
  held = sample(renderPose, th)
  renderPose = held
  targetPose = held
  activeSegment = none
  motionState = HELD

On reconnect:
  baselineRequired = true
  snap once to the first complete GOOD target

On foreground resume:
  baselineRequired = true
  if latest same-generation complete target is fresh, current quality is GOOD,
     and no later non-GOOD or protocol fault occurred:
    snap once to that target
  else:
    keep renderPose unchanged and expose the current non-GOOD/STALE state with HELD
    until a fresh GOOD arrives
```

- [ ] **Step 1: Establish RED** with `rg -n "first GOOD frame becomes effective atomically|reconnect applies the first new complete GOOD Pose without" docs/superpowers/specs/2026-07-13-single-assembly-robot-opcua-equipment-transform-design.md`; expect both ambiguous baseline phrases to be present.
- [ ] **Step 2: Amend sections 6.4 and 8.1** with the `[10, 1000] ms` sampling limit, `100 ms` default, and Profile-derived `D = 2 * T` contract.
- [ ] **Step 3: Replace sections 8.3/8.4 behavior** so first GOOD after Binding/source/generation change or reconnect snaps once as a baseline; foreground resume snaps only to a fresh same-generation complete target that remains current-quality GOOD with no later non-GOOD/fault, and otherwise remains HELD with the baseline pending; subsequent changed GOOD targets interpolate from current render Pose; hold events expose `HELD`; rendering and collision share render Pose; `targetRevision` invalidates reports once; `renderRevision` updates live collision without new report invalidations.
- [ ] **Step 4: Amend success criteria 11.2** with first/reconnect/fresh-resume baseline snap, stale-resume hold, exact 0/100/200 ms samples for the next changed target, shortest-arc rotation, malformed protocol-fault HELD behavior, no fallback-to-Manual after a prior GOOD, and one target invalidation across multiple render revisions.
- [ ] **Step 5: Verify GREEN** with the RED command expecting no matches, then `rg -n "D = 2|targetRevision|renderRevision|shortest-arc|held Pose" docs/superpowers/specs/2026-07-13-single-assembly-robot-opcua-equipment-transform-design.md`; expect every term in normative and acceptance sections.
- [ ] **Step 6: Run** `git diff --check` and `git diff --name-only -- src middleware`; expect GREEN and no source/Middleware changes before the spec commit.
- [ ] **Step 7: Commit** as `docs: specify OPC UA transform smoothing semantics`.

---

### Task 2: Bounded Connector Profiles and One Atomic Read Cycle

**Files:**
- Create: `middleware/opcua-transform-protocol.mjs`
- Create: `middleware/opcua-transform-protocol.test.ts`
- Create: `middleware/opcua-poll-cycle.mjs`
- Create: `middleware/opcua-poll-cycle.test.ts`
- Modify: `middleware/opcua-config.mjs`
- Modify: `middleware/opcua-config.test.ts`
- Modify: `middleware/opcua-connector.mjs`
- Modify: `middleware/opcua.config.json`
- Modify: `middleware/README.md`

**Interfaces:**
- Produces: validated `gatewayId`, `equipmentTransformProfiles`, deterministic Profile revisions/catalog, `buildReadPlan(config)`, and `readConnectorCycle(session, plan, sequence, nowMs)`.
- Consumes: existing six Joint mappings, numeric `equipment` Status mappings, global `samplingIntervalMs`, `AttributeIds.Value`, `StatusCode.isGood()`, and one `session.read` call.

The checked-in configuration shape is:

```json
{
  "gatewayId": "plant-gateway-01",
  "samplingIntervalMs": 100,
  "equipmentTransformProfiles": [
    {
      "id": "cup-transfer-01",
      "name": "Cup transfer pose",
      "x": { "nodeId": "ns=2;s=Cup.X", "scale": 0.001, "offset": 0 },
      "y": { "nodeId": "ns=2;s=Cup.Y", "scale": 0.001, "offset": 0 },
      "z": { "nodeId": "ns=2;s=Cup.Z", "scale": 0.001, "offset": 0 },
      "roll": { "nodeId": "ns=2;s=Cup.Roll", "scale": 1, "offset": 0 },
      "pitch": { "nodeId": "ns=2;s=Cup.Pitch", "scale": 1, "offset": 0 },
      "yaw": { "nodeId": "ns=2;s=Cup.Yaw", "scale": 1, "offset": 0 }
    }
  ]
}
```

The Connector must emit:

```ts
interface GatewayEquipmentTransformProfileV1 {
  readonly id: string
  readonly revision: string // SHA-256 of normalized six mappings, T, and units
  readonly name: string
  readonly samplingIntervalMs: number
}

type EquipmentTransformSample =
  | { readonly quality: 'GOOD'; readonly positionM: readonly [number, number, number]; readonly rotationDegZYX: readonly [number, number, number] }
  | { readonly quality: 'BAD' }
```

- [ ] **Step 1: Write failing config tests** for empty/duplicate IDs, missing six mappings, non-finite scale/offset, T at `9`, `10`, `1000`, and `1001`, 32/33 Profiles, total Node count 256/257, UTF-8 byte boundaries 128/129 and 1,024/1,025, and deterministic revision changes for every normalized input field.
- [ ] **Step 2: Write failing poll tests** with a read-only fake session. Assert one `session.read` receives every Joint/Status/transform Node in deterministic order; raw `[1000, -250, 800, 10, 20, 30]` with XYZ scale `0.001` maps to `[1, -0.25, 0.8]` m and `[10, 20, 30]` deg ZYX; one bad/missing/non-finite coordinate makes only that Profile BAD; no partial Pose exists; and read failure produces BAD for every Profile within one cycle.
- [ ] **Step 3: Add protocol tests** proving catalog is sent first on each WebSocket, sequence increments once per cycle, reconnect/disconnect never emits a GOOD zero Pose, and encoded catalog/frame sizes at 65,536 bytes pass while 65,537 fail before broadcast.
- [ ] **Step 4: Run** `npm run test:middleware`; expect missing profile/read-plan RED.
- [ ] **Step 5: Implement** normalized SHA-256 revisions, catalog creation, one flattened read plan, slice-based atomic decoding, bounded JSON encoding, and cached latest frames. On upstream failure broadcast BAD samples; never reuse stale values under GOOD.
- [ ] **Step 6: Prove read-only scope** with spies that expose `read` but no write/subscription API, plus `rg -n --glob '*.mjs' "\.write\(|call\(|createSubscription|createMonitoredItem|monitor\(" middleware`; expect zero Connector source hits.
- [ ] **Step 7: Run** `npm run test:middleware`, `npm run lint`, `npm run build`, and `git diff --check`; expect GREEN.
- [ ] **Step 8: Commit** as `feat: publish atomic OPC UA transform profiles`.

---

### Task 3: Bounded Browser Protocol and Shared Gateway Client

**Files:**
- Create: `src/features/opcua/gateway-protocol.ts`
- Create: `src/features/opcua/gateway-protocol.test.ts`
- Create: `src/features/opcua/OpcUaGatewayClient.ts`
- Create: `src/features/opcua/OpcUaGatewayClient.test.ts`
- Modify: `src/features/joints/OpcUaJointSource.ts`
- Modify: `src/features/joints/OpcUaJointSource.test.ts`

**Interfaces:**
- Produces: `parseGatewayMessage(raw)`, `OpcUaGatewayClient.subscribeCatalog`, `subscribeJointFrames`, `subscribeNumericStatus`, and `subscribeEquipmentTransforms` over one shared WebSocket.
- Consumes: Task 2 catalog/frame wire types, existing gateway URL resolver, browser monotonic clock, and existing Joint source callbacks.

```ts
export const MAX_GATEWAY_PAYLOAD_BYTES = 65_536

export interface AcceptedTransformFrame {
  readonly connectionGeneration: number
  readonly sequence: number
  readonly receivedAtMs: number
  readonly values: Readonly<Record<string, EquipmentTransformSample>>
}
```

- [ ] **Step 1: Write failing parser tests** for every catalog/frame field, finite tuple values, 32/33 Profiles and values, unique IDs, 128/129-byte Gateway/Profile/name boundaries, lowercase 64-hex revisions, T bounds, exact UTF-8 payload size at 65,536/65,537, invalid JSON, non-string/binary WebSocket data, unknown/uncatalogued Profile keys, and forbidden extra/partial Pose fields.
- [ ] **Step 2: Write failing client tests** proving catalog must precede transform frames, Gateway/Profile revisions remain immutable per connection, duplicate/lower sequences are ignored without refreshing clocks, and reconnect increments `connectionGeneration` and resets sequence acceptance. A bounded malformed string must emit exactly one current-generation protocol fault, refresh none of sequence/receipt/last-GOOD clocks, keep the socket open, and make active transform consumers BAD; binary/oversized input must close the socket as DISCONNECTED before JSON reduction. Assert the client retains only the latest accepted catalog/frame per connection and no message-history array.
- [ ] **Step 3: Add Joint regression tests** proving the shared client preserves current six-Joint GOOD/BAD behavior and keeps the WebSocket connected while any Joint, numeric Status, or transform consumer remains enabled.
- [ ] **Step 4: Run** `npm run test:run -- src/features/opcua src/features/joints/OpcUaJointSource.test.ts`; expect missing protocol/client RED.
- [ ] **Step 5: Implement** synchronous string-only byte-before-parse validation, exact runtime narrowing, a typed `protocol-fault` callback for bounded malformed strings, catalog handshake deadline `max(3 * T, 1000 ms)`, per-connection sequence state, latest-only retained state, and reference-counted shared WebSocket ownership. Protocol faults never advance clocks; reject rather than decode binary or truncate over-limit values.
- [ ] **Step 6: Run** focused tests, `npm run lint`, `npm run build`, and `git diff --check`; expect GREEN.
- [ ] **Step 7: Commit** as `feat: validate OPC UA gateway transform frames`.

---

### Task 4: Pure Pose Interpolation and Quality/Hold Reducer

**Files:**
- Create: `src/features/equipment/opcua-transform-smoothing.ts`
- Create: `src/features/equipment/opcua-transform-smoothing.test.ts`

**Interfaces:**
- Produces: `gatewaySampleToPose`, `startPoseSegment`, `samplePoseSegment`, `acceptGoodTarget`, `holdCurrentPose`, `advanceTransformClock`, and `matrixChanged`.
- Consumes: Task 3 accepted frames, `Euler(..., 'ZYX')`, normalized `Quaternion`, browser monotonic time, canonical Manual fallback, and Matrix4 comparison epsilon `1e-9`.

```ts
interface SmoothedTransformState {
  readonly quality: 'WAITING' | 'GOOD' | 'BAD' | 'STALE' | 'DISCONNECTED'
  readonly motionState: 'WAITING_BASELINE' | 'HELD' | 'INTERPOLATING' | 'SETTLED'
  readonly baselineRequired: boolean
  readonly hasAcceptedGood: boolean
  readonly renderPose: TransformPose
  readonly targetPose: TransformPose
  readonly segment: {
    readonly from: TransformPose
    readonly to: TransformPose
    readonly startedAtMs: number
    readonly durationMs: number
  } | null
  readonly lastGoodReceivedAtMs: number | null
  readonly targetRevision: number
  readonly renderRevision: number
}
```

Shortest-arc slerp must be explicit:

```ts
const destination = dot(from.quaternion, to.quaternion) < 0
  ? negate(to.quaternion)
  : to.quaternion
const quaternion = normalize(slerp(from.quaternion, destination, alpha))
```

- [ ] **Step 1: Write failing timing tests** for T `100`: a translation from 0 to 1 is exactly 0, 0.5, and 1 at elapsed 0, 100, and 200 ms; elapsed below/above clamps; T `10` and `1000` produce durations 20 and 2000 ms.
- [ ] **Step 2: Write failing rotation tests** proving `[10, 20, 30]` deg uses `Euler(10 deg, 20 deg, 30 deg, 'ZYX')` within Quaternion absolute-component error `1e-6`; yaw `350 deg -> 10 deg` travels +20 deg rather than -340 deg; `179 deg -> -179 deg` travels +2 deg; midpoint and Quaternion norm are within `1e-6` and `1e-9`; and inputs remain unmodified.
- [ ] **Step 3: Write failing baseline/retarget tests**: first GOOD after Binding/source/generation change snaps exactly once; first GOOD after reconnect snaps once; foreground resume snaps only to a same-generation complete target whose current quality remains GOOD and whose age is below the stale threshold; the next changed GOOD uses a 200 ms segment; a retarget at 100 ms causes zero acceptance-time matrix jump and rebases from the sampled render Pose.
- [ ] **Step 4: Write failing HELD tests**: BAD at 75 ms freezes the sampled Pose and sets `motionState: 'HELD'` for ten future advances; STALE, bounded malformed-string protocol fault, and DISCONNECTED do the same without refreshing last-GOOD time; BAD/STALE recovery on the same generation interpolates the next changed GOOD from held Pose; reconnect requires the one new baseline snap. GOOD at 0 ms followed by BAD or protocol fault at 100 ms and foreground resume at 200 ms must not reuse the still-young GOOD target; it remains BAD/HELD with `baselineRequired: true`, and the first later fresh GOOD snaps once. An absent/stale latest target follows the same hold rule. A mismatch before the generation's first GOOD holds Manual fallback with `motionState: 'HELD'` and `baselineRequired: true`; after a GOOD it holds render Pose instead.
- [ ] **Step 5: Write failing revision/jitter tests**: a changed baseline snap increments `targetRevision` and `renderRevision` once, while an identical baseline only clears `baselineRequired`; a subsequent target matrix changed by `>1e-9` increments `targetRevision` once; `<=1e-9` changes only quality/receipt clock; interpolation changes only `renderRevision`; controlled target arrivals at `100 ms +/- 40 ms` rebase from sampled render Pose with acceptance-time matrix jump `<=1e-9` and no extrapolation.
- [ ] **Step 6: Run** `npm run test:run -- src/features/equipment/opcua-transform-smoothing.test.ts`; expect missing reducer RED.
- [ ] **Step 7: Implement** pure immutable functions, one baseline-snap flag, separate HELD motion state, local monotonic-age stale transition `max(3 * T, 1000 ms)`, fresh-only foreground baseline selection, latest-target-only background handling, protocol-fault hold transition, and no extrapolation.
- [ ] **Step 8: Run** focused tests, `npm run lint`, `npm run build`, and `git diff --check`; expect GREEN.
- [ ] **Step 9: Commit** as `feat: smooth OPC UA equipment transform targets`.

---

### Task 5: Generation-Gated Ownership and Shared Render/Collision Pose

**Files:**
- Create: `src/features/equipment/equipment-transform-runtime.ts`
- Create: `src/features/equipment/equipment-transform-runtime.test.ts`
- Create: `src/features/equipment/equipment-transform-store.ts`
- Create: `src/features/equipment/equipment-transform-store.test.ts`
- Modify: `src/app/external-entity-mutations.ts`
- Modify: `src/app/external-entity-mutations.test.ts`
- Modify: `src/features/interaction/grasp-actions.ts`
- Modify: `src/features/interaction/grasp-actions.test.ts`
- Modify: `src/features/equipment/EquipmentScene.tsx`
- Modify: `src/features/equipment/EquipmentScene.test.ts`
- Modify: `src/features/collision/geometry-entity-registry.ts`
- Modify: `src/features/collision/geometry-entity-registry.test.ts`
- Modify: `src/features/collision/collision-store.ts`
- Modify: `src/features/collision/collision-store.test.ts`
- Modify: `src/features/collision/CurrentPoseCollisionSystem.tsx`

**Interfaces:**
- Produces: per-entity `TransformAuthorityGeneration`, serialized mutation gate, animation-frame `sampleRenderPose`, and split `noteAcceptedMotionTarget`/`noteRenderedTransform` collision updates.
- Consumes: WS1 canonical transform/binding state, Task 3 gateway client, Task 4 reducer, existing grasp/manual mutation paths, Equipment scene, Geometry registry, current-pose collision, and validation report store.

```ts
interface TransformMotionUpdate {
  readonly entityId: ExternalEntityId
  readonly authorityGeneration: number
  readonly targetChanged: boolean
  readonly targetRevision: number
  readonly renderChanged: boolean
  readonly renderRevision: number
  readonly renderPose: TransformPose
}
```

- [ ] **Step 1: Write failing ownership tests** covering `Manual -> OPC UA`, Binding tuple change, reference-frame change, Project replacement, delete, grasp begin/release, and late Manual Apply. Use deferred Promises to prove every old-generation completion/sample is ignored and at most one writer mutates an entity.
- [ ] **Step 2: Add quality/race tests** proving Profile/Gateway/revision mismatch is BAD with Manual fallback before any GOOD and HELD render Pose after a prior GOOD, source change clears prior target/clock and requires one baseline snap, BAD/STALE/bounded protocol fault/disconnect freeze current render Pose, a stale foreground target does not snap, switching a held entity to OPC UA is rejected, OPC UA-owned entities cannot drag/apply/grasp, and switching to Manual restores the exact persisted fallback.
- [ ] **Step 3: Write failing scene/collision tests** proving the same effective render Matrix4 reaches `EquipmentScene` and Geometry registry on each coalesced animation frame; target Pose is never registered; live collision sees the intermediate pose within 100 ms plus one render frame. Move MCP during both `mcp` and `world` bindings and assert reference conversion changes the effective matrix without creating an OPC target revision; the existing frame-mutation path remains the sole report invalidator for that frame edit.
- [ ] **Step 4: Write failing revision/report tests** proving one accepted changed target calls `noteAcceptedMotionTarget` once, 2-12 interpolation frames call only `noteRenderedTransform`, an identical target calls neither target invalidation nor a new segment, and sequence validation cannot publish a current report while any external interpolation is active.
- [ ] **Step 5: Add deterministic performance tests** retaining latest catalog/frame/reducer state only for 32 Profiles over 10,000 jittered frames. Assert serialized retained protocol/reducer state is below 1 MiB and p95 `advance` cost over 5,000 post-warmup frames is below 2 ms/frame on the test runner.
- [ ] **Step 6: Run** `npm run test:run -- src/features/equipment/equipment-transform-runtime.test.ts src/features/equipment/equipment-transform-store.test.ts src/app/external-entity-mutations.test.ts src/features/interaction/grasp-actions.test.ts src/features/equipment/EquipmentScene.test.ts src/features/collision`; expect missing authority/revision split RED.
- [ ] **Step 7: Implement** one generation gate per entity, RAF-coalesced sampling, visibility-resume baseline handling, current render Pose publication, World/MCP conversion after interpolation in reference coordinates, fixed-size latest-only state, and collision revision separation. Keep active reports stale during motion and allow a new current report only after all segments settle.
- [ ] **Step 8: Run** focused tests, `npm run lint`, `npm run build`, and `git diff --check`; expect GREEN.
- [ ] **Step 9: Commit** as `feat: gate OPC UA transform ownership and collision`.

---

### Task 6: Feature Binding Surface, WS6 Handoff, and WS5 Release Gate

**Files:**
- Create: `src/features/equipment/OpcUaTransformBindingPanel.tsx`
- Create: `src/features/equipment/OpcUaTransformBindingPanel.test.tsx`
- Create: `src/features/equipment/OpcUaTransformBindingPanel.css`
- Create: `src/features/equipment/opcua-transform-feature.integration.test.ts`
- Create: `docs/integration/opcua-transform-ws6-handoff.md`
- Create: `docs/operator/opcua-equipment-transforms.md`
- Create: `docs/verification/opcua-transform-smoothing-verification.md`
- Modify: `middleware/README.md`
- Modify: `docs/superpowers/plans/2026-07-13-opcua-transform-smoothing.md`

**Interfaces:**
- Produces: a controlled feature panel for catalog/Profile selection and diagnostics, deterministic fake-gateway integration evidence, and a frozen WS6 presentation handoff.
- Consumes: Tasks 2-5, WS1 public Project mutation/persistence interfaces, and canonical external-entity IDs. It does not own App shell placement, Workspace Mode routing, Equipment Inspector composition, or Playwright.

- [ ] **Step 1: Write failing panel tests** for catalog loading, exact Gateway/Profile/revision display, unique Profile assignment, `world | mcp`, default MCP, Manual controls disabled in OPC UA mode, quality precedence, last-update age, separate HELD motion state, missing/mismatched Profile fallback rules, and source independence from Robot Joint mode/numeric Status. Assert smoothing is read-only text `2 cycles · 200 ms` at T `100`, and no smoothing spinbutton exists.
- [ ] **Step 2: Write a fake-gateway integration test** with fake timers and injected RAF. Assert first GOOD baseline snaps once, the next changed target samples 0/50/100% at 0/100/200 ms and settles by 250 ms, `350 deg -> 10 deg` takes the short arc, `100 ms +/- 40 ms` jittered retargets have no acceptance-time jump, and BAD/STALE/bounded malformed-string protocol fault/disconnect show HELD at the same scene/collision Pose without refreshing last-GOOD time.
- [ ] **Step 3: Add race/integration coverage** for an old-generation frame after Binding change, delete during motion, Project replacement during motion, reconnect sequence reset/baseline snap, fresh foreground-resume snap, stale foreground-resume hold followed by one fresh-GOOD snap, identical periodic targets, Simulation Joint mode with moving Equipment, World-bound stability across MCP motion, and exact Manual restoration.
- [ ] **Step 4: Run** `npm run test:run -- src/features/opcua src/features/equipment src/features/collision src/app/external-entity-mutations.test.ts`; expect missing panel/integration RED, then implement only WS5-owned gaps until GREEN.
- [ ] **Step 5: Write** `docs/integration/opcua-transform-ws6-handoff.md` with the exact panel props/selectors/commands, CONNECT-mode mount point, selected-entity handoff, quality and HELD badges, `2 cycles · derived milliseconds` text, visibility-resume notification, pending/error states, and browser scenarios WS6 must own. Do not edit `App.tsx`, Workspace/Inspector composition, global shell CSS, or Playwright specs here.
- [ ] **Step 6: Document** Middleware Profile configuration, units/scales, limits, revisions, polling-only/read-only boundary, one-snap baseline rules, two-cycle smoothing, HELD semantics, fallback rules, reference frames, source ownership, collision behavior, background resume, troubleshooting, and the lack of security in this stage.
- [ ] **Step 7: Run final WS5 gates:** `npm run test:middleware`, `npm run verify`, `npm audit --audit-level=high`, `git diff --check`, and `rg -n "T[B]D|T[O]DO|F[I]XME|place[h]older" middleware src/features/opcua src/features/equipment docs/integration/opcua-transform-ws6-handoff.md docs/operator/opcua-equipment-transforms.md`; then run `rg -n --glob '*.mjs' "\.write\(|createSubscription|createMonitoredItem" middleware`. Resolve every unfinished marker and expect zero Connector source hits.
- [ ] **Step 8: Record** exact commands/pass counts, baseline-snap counts, 0/100/200 ms timing table, jitter/short-arc/HELD evidence, server/client boundaries, revision counts, memory/p95 measurements, and the exact WS6 handoff revision in `docs/verification/opcua-transform-smoothing-verification.md`.
- [ ] **Step 9: Commit** as `docs: verify OPC UA transform smoothing`.

## Quantitative Acceptance Criteria

1. Connector validation accepts 32 Profiles and 256 total read Nodes, rejects 33/257, accepts 128-byte IDs and 1,024-byte NodeIds, and rejects 129/1,025 bytes using UTF-8 byte counts.
2. One polling cycle makes exactly one `session.read` call. Each GOOD transform contains all six values from that result; any one BAD/missing/non-finite value emits only `{ quality: 'BAD' }` for that Profile.
3. Raw `[1000, -250, 800, 10, 20, 30]` with XYZ scale `0.001` maps to position `[1, -0.25, 0.8]` m and the normalized Quaternion from `Euler(10 deg, 20 deg, 30 deg, 'ZYX')` within absolute-component error `1e-6`.
4. Server and browser accept 65,536-byte UTF-8 catalog/frame payloads and reject 65,537 bytes before broadcast/reduction.
5. First complete GOOD after Binding/source/generation change or reconnect snaps exactly once to establish the baseline. Foreground resume snaps only when the retained same-generation target is current-quality GOOD, has no later non-GOOD/fault, and is younger than the stale threshold; an absent/stale/BAD/faulted target holds and leaves the snap pending for the first later fresh GOOD. The next changed target at T `100 ms` uses D `200 ms`, is at 0%, 50%, and 100% at elapsed 0, 100, and 200 ms, and settles within one render frame without exceeding 250 ms in the jitter reference. T `10`/`1000` yields D `20`/`2000 ms`.
6. Every persisted transform binding contains exactly `smoothing: { mode: 'two-cycle', cycles: 2 }`; the UI derives `200 ms` at T `100` and exposes zero duration editors.
7. Quaternion interpolation `350 deg -> 10 deg` follows the 20 deg shortest arc and `179 deg -> -179 deg` follows the 2 deg shortest arc; midpoint error is within `1e-6` and norm within `1e-9`.
8. Subsequent changed targets arriving at `100 ms +/- 40 ms` and mid-motion retargets produce no acceptance-time render-matrix discontinuity greater than `1e-9`; no state extrapolates beyond its target.
9. BAD, STALE, malformed input, and disconnect preserve the sampled current render Pose, expose `HELD` for at least ten subsequent animation advances, and never emit a zero or partial Pose. A bounded malformed string emits one BAD protocol fault while keeping the socket open; binary/oversized input closes it as DISCONNECTED. A mismatch falls back to Manual only before the first GOOD of that generation.
10. Stale time is exactly `max(3 * T, 1000 ms)` using browser monotonic receipt age; duplicate/lower sequences and malformed-string protocol faults refresh no clock. A stale foreground target or a still-young GOOD followed by BAD/fault causes zero snap, and the first later fresh complete GOOD causes exactly one snap.
11. One accepted changed target increments `targetRevision` and invalidates reports exactly once; interpolation frames increment only `renderRevision`; after settling, 100 identical targets add zero target revisions, zero render/Geometry mutations, and zero report invalidations.
12. Scene and live collision matrices match element-for-element within `1e-9` at every sampled frame, and collision reacts within 100 ms plus one render frame.
13. All tested old-generation samples and late Manual/grasp/delete/Project operations cause zero unauthorized mutations.
14. Retained protocol/reducer state for 32 Profiles remains below 1 MiB after 10,000 jittered frames, and p95 transform advance cost is below 2 ms/frame over 5,000 measured frames after warmup.
15. Middleware executes zero OPC UA writes, method calls, MonitoredItems, or Subscriptions; `npm run test:middleware`, `npm run verify`, the focused WS5 integration suite, audit, and diff gates pass. Final CONNECT/Inspector composition and Playwright workflow are explicit WS6 acceptance work.

## Self-Review

- Spec coverage: ambiguous immediate-first-GOOD wording is replaced before code by one explicit baseline snap followed by two-cycle smoothing; connector Profiles, atomic six-node reads, limits, quality, HELD behavior, shortest arc, races, shared render/collision Pose, and one-time report invalidation each have tests.
- Scope: OPC UA security, authentication, writes, methods, Subscriptions, prediction, physics, and public-internet deployment remain excluded.
- Placeholder scan: every step provides concrete paths, interfaces, limits, commands, race outcomes, and timing expectations; the final scan detects unfinished markers without matching this sentence.
- Type consistency: the Middleware wire contract, browser parser, reducer, authority store, scene, and collision paths preserve one Profile/sample/Pose model with explicit target/render revisions.
- Temporal consistency: all freshness and interpolation calculations use the browser monotonic clock; Connector wall-clock timestamps remain diagnostic only.
- Workstream ownership: WS1 owns persisted types/codec; WS5 owns Middleware, protocol, smoothing, authority, feature panel, and runtime/collision integration; the separate WS6 plan owns App/Workspace/Inspector composition and browser-level release coverage.
