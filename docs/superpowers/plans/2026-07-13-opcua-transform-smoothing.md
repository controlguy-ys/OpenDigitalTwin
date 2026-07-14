# OPC UA Equipment Transform Smoothing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move built-in Equipment and imported Objects from read-only six-node OPC UA Pose targets with deterministic quality handling and 200 ms default visual smoothing, while rendering and geometric collision always consume the same current interpolated Pose.

**Architecture:** The Middleware validates bounded catalogs for existing numeric Status mappings and six-node transform Profiles, computes immutable transform revisions, and performs one polling Read per cycle for Joints, numeric Status, and transforms. The browser validates bounded catalog/frame messages, resolves numeric mapping tuples and transform Profiles to canonical v3 external entities, and reduces accepted transform targets through a generation-gated smoothing state machine. Each accepted changed target invalidates collision reports once; animation-frame render revisions update both scene and live collision without repeatedly invalidating reports.

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
- The Gateway accepts at most `MAX_GATEWAY_CLIENTS = 8` concurrent browser WebSockets. The ninth is closed with code `1013`. Before every per-client send, `bufferedAmount === 1_048_576` bytes may proceed; `bufferedAmount > 1_048_576` closes only that slow client with `1013` and enqueues nothing. One slow client may never delay polling or another client.
- `samplingIntervalMs` is within `[10, 1000]`; checked-in default is `100`. Interpolation duration is always `D = 2 * T`, so the default is `200 ms` and the allowed duration range is `[20, 2000] ms`.
- Translation uses component-wise linear interpolation. Rotation converts `Euler(roll, pitch, yaw, 'ZYX')` to normalized Quaternion and uses shortest-arc slerp. Persisted Manual Geometry scale is never controlled by OPC UA.
- The first complete GOOD after a Binding/source/generation change or WebSocket reconnect snaps once to establish the baseline. A foreground resume snaps only when the retained frame is the latest same-generation complete sample, current quality is still GOOD, no later BAD/STALE/protocol fault/disconnect occurred, and its age is below the stale threshold; otherwise the Pose remains HELD with the baseline pending. Only subsequent changed GOOD targets interpolate from the sampled current render Pose.
- BAD, STALE, malformed input, and disconnect evaluate the active segment at the transition time, freeze that effective render Pose, cancel the segment, and expose separate motion/presentation state `HELD`; they never move to zero. A mismatch uses Manual fallback only when that generation has no prior GOOD, otherwise it retains the held render Pose.
- A bounded string payload that is invalid JSON or fails the closed message schema emits one current-generation protocol fault: do not refresh sequence, receipt, or last-GOOD clocks; transition every active transform Binding on that connection to BAD/HELD and every active numeric consumer to BAD with immediate `manualNumericStatus` fallback; preserve the current six Robot Joint angles plus last accepted `JointQuality`/timestamp and expose effective Joint BAD only through a transport-fault overlay without emitting a timestamped JointFrame; and keep the socket open. Binary or oversized payload closes the socket, transitions Transform Bindings/numeric consumers to DISCONNECTED with their HELD/Manual fallbacks, preserves accepted Joint angles/quality/time, keeps the effective transport overlay BAD, and exposes DISCONNECTED only as separate shared-connection state. A later valid generation clears the overlay without a zero-angle transition. Freshness, interpolation, visibility sampling, and Joint receipt use one injected browser-local clock, default `Date.now()`; Connector timestamps are diagnostic only and `performance.now()` is never mixed into this state machine.
- On `visibilitychange` to hidden at browser-local time `th`, sample the active segment at `th`, set both `renderPose` and `targetPose` to that held Pose, and clear `activeSegment`. Background tabs do not advance, extrapolate, or replay a backlog; retain only the latest accepted target plus current quality. On foreground resume, keep the pre-background held Pose and cleared segment, then snap only when that same-generation complete target remains current-quality GOOD with no later non-GOOD/fault and is younger than `max(3 * T, 1000 ms)`. Otherwise expose HELD, retain `baselineRequired: true`, and let the first later fresh complete GOOD target perform the one baseline snap. Hidden elapsed time never completes the discarded segment.
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

On each subsequent accepted changed GOOD target at browser-local `Date.now()` t0:
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

On visibility hidden at th:
  held = sample(renderPose, th)
  renderPose = held
  targetPose = held
  activeSegment = none
  motionState = HELD

On foreground resume:
  keep the pre-background held renderPose
  targetPose = renderPose
  activeSegment = none
  baselineRequired = true
  if latest same-generation complete target is fresh, current quality is GOOD,
     and no later non-GOOD or protocol fault occurred:
    snap once to that target
  else:
    keep renderPose unchanged and expose the current non-GOOD/STALE state with HELD
    until a fresh GOOD arrives
```

- [x] **Step 1: Establish historical RED.** The pre-amendment revision contained both conflicting immediate-application rules; this evidence is historical and must not be re-run against the amended file.
- [x] **Step 2: Amend sections 6.4 and 8.1** with the `[10, 1000] ms` sampling limit, `100 ms` default, and Profile-derived `D = 2 * T` contract.
- [x] **Step 3: Replace sections 8.3/8.4 behavior** so first GOOD after Binding/source/generation change or reconnect snaps once as a baseline; foreground resume snaps only to a fresh same-generation complete target that remains current-quality GOOD with no later non-GOOD/fault, and otherwise remains HELD with the baseline pending; subsequent changed GOOD targets interpolate from current render Pose; hold events expose `HELD`; rendering and collision share render Pose; `targetRevision` invalidates reports once; `renderRevision` updates live collision without new report invalidations.
- [x] **Step 4: Amend success criteria 11.2** with first/reconnect/fresh-resume baseline snap, stale-resume hold, exact 0/100/200 ms samples for the next changed target, shortest-arc rotation, malformed protocol-fault HELD behavior, no fallback-to-Manual after a prior GOOD, and one target invalidation across multiple render revisions.
- [x] **Step 5: Verify GREEN** with `rg -n "D = 2|targetRevision|renderRevision|shortest-arc|held Pose" docs/superpowers/specs/2026-07-13-single-assembly-robot-opcua-equipment-transform-design.md`; every term is present in normative and acceptance sections and the obsolete rules are absent.
- [x] **Step 6: Run** `git diff --check` and `git diff --name-only -- src middleware`; expect GREEN and no source/Middleware changes before the spec commit.
- [x] **Step 7: Commit** as `docs: specify OPC UA transform smoothing semantics`.

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
- Produces: validated `gatewayId`, unchanged numeric `equipment` mappings plus a read-only numeric Status catalog carrying global `samplingIntervalMs`, `equipmentTransformProfiles`, deterministic Profile revisions/catalog, `buildReadPlan(config)`, `readConnectorCycle(session, plan, sequence, nowMs)`, `MAX_GATEWAY_CLIENTS = 8`, and isolated per-client backpressure enforcement.
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

- [ ] **Step 1: Write failing config tests** for empty/duplicate IDs, duplicate numeric `nodeId`/`scale`/`offset` tuples, missing six transform mappings, non-finite scale/offset, T at `9`, `10`, `1000`, and `1001`, 32/33 Profiles, total Node count 256/257, UTF-8 byte boundaries 128/129 and 1,024/1,025, and deterministic revision changes for every normalized transform input field. Assert the numeric Status catalog is an exact read-only projection of the unchanged `equipment` configuration plus global T, including zero Transform Profiles.
- [ ] **Step 2: Write failing poll tests** with a read-only fake session. Assert one `session.read` receives every Joint/Status/transform Node in deterministic order; raw `[1000, -250, 800, 10, 20, 30]` with XYZ scale `0.001` maps to `[1, -0.25, 0.8]` m and `[10, 20, 30]` deg ZYX; one bad/missing/non-finite coordinate makes only that Profile BAD; no partial Pose exists; and read failure produces BAD for every Profile within one cycle. For numeric mappings, require GOOD DataValue StatusCode plus finite converted output to emit a number; finite raw with BAD StatusCode, missing/non-finite raw, non-finite output, and read failure emit `null`, with read failure producing `null` for every numeric mapping.
- [ ] **Step 3: Add protocol/server tests** proving both numeric and transform catalogs carry the same `gatewayId` and are sent before their frames on each WebSocket, numeric values remain keyed by Connector mapping ID, numeric and transform frames carry the same sequence for one cycle, sequence increments once per cycle, reconnect/disconnect never emits a GOOD zero Pose, and encoded catalog/frame sizes at 65,536 bytes pass while 65,537 fail before broadcast. Open eight clients and prove all receive the same current catalogs/frame; the ninth closes with `1013` and does not disturb the first eight. Set one client's `bufferedAmount` to exactly 1,048,576 and prove its next message may send; set it to 1,048,577 and prove only that client closes `1013`, no message is queued for it, polling continues, and a healthy client receives the same-cycle frame. Closed/errored sockets decrement capacity exactly once.
- [ ] **Step 4: Run** `npm run test:middleware`; expect missing profile/read-plan RED.
- [ ] **Step 5: Implement** normalized SHA-256 revisions, catalog creation, one flattened read plan, slice-based atomic decoding, bounded JSON encoding, cached latest frames, an eight-client connection registry, and nonblocking per-client send guards. On upstream failure broadcast BAD samples; never reuse stale values under GOOD. Close over-capacity/backpressured clients with `1013`, do not queue after the cutoff, and iterate healthy clients independently so a slow client cannot block the poll loop or another send.
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
- Produces: `parseGatewayMessage(raw)`, `OpcUaGatewayClient.subscribeCatalog`, `subscribeNumericStatusCatalog`, `subscribeJointFrames`, `subscribeJointPresentation`, `subscribeNumericStatus`, and `subscribeEquipmentTransforms` over one shared WebSocket. `subscribeJointPresentation` returns `{ acceptedQuality: JointQuality, transportOverlay: 'BAD' | 'STALE' | null, effectiveQuality: JointQuality, connectionState: 'CONNECTED' | 'DISCONNECTED', fault: 'protocol' | 'transport' | null, lastAcceptedReceivedAtMs: number | null }` without owning angles, with the invariant `effectiveQuality === (transportOverlay ?? acceptedQuality)`. `acceptedQuality` is the current Robot store's last accepted quality and is never rewritten by transport state. `lastAcceptedReceivedAtMs` is `null` before the first accepted Joint frame and otherwise retains the last accepted browser-local receipt time across a transport fault/reconnect; the separate socket-open time owns the current-generation 1,000 ms silence watchdog.
- Consumes: Task 2 catalog/frame wire types, WS1 `ProjectOpcUaNumericStatusBindingV3`, existing gateway URL resolver, one injected browser-local `nowMs` clock defaulting to `Date.now()`, and existing Joint source callbacks. The same clock domain is passed to freshness and interpolation reducers.

```ts
export const MAX_GATEWAY_PAYLOAD_BYTES = 65_536

export interface AcceptedTransformFrame {
  readonly connectionGeneration: number
  readonly sequence: number
  readonly receivedAtMs: number
  readonly values: Readonly<Record<string, EquipmentTransformSample>>
}
```

- [ ] **Step 1: Write failing parser tests** for every numeric/transform catalog and frame field, finite tuple values, 32/33 Profiles and values, unique IDs/unique numeric mapping tuples, 128/129-byte Gateway/Profile/name boundaries, lowercase 64-hex revisions, T bounds, exact UTF-8 payload size at 65,536/65,537, invalid JSON, non-string/binary WebSocket data, unknown/uncatalogued keys, and forbidden extra/partial Pose fields.
- [ ] **Step 2: Write failing client tests** proving each numeric/transform catalog must precede its frame kind; pre-catalog numeric frames are ignored with no clock refresh and Manual WAITING fallback until 2,999 ms, then BAD at exactly 3,000 ms. Require both catalogs to carry the same Gateway ID and remain connection-scoped immutable: an exact semantic duplicate is ignored, while a different replacement or cross-catalog Gateway mismatch closes the socket as a protocol fault. Track `lastNumericSequence` and `lastTransformSequence` independently so same-cycle frames with the same sequence both apply; prove duplicate/lower values within either frame kind are ignored without refreshing clocks. Reconnect increments `connectionGeneration`, clears both catalogs/mapping resolutions/latest frames/sequences, and rejects every old-generation catalog/frame. After a transform catalog is accepted, assert the per-Profile stale deadline is `max(3 * T, 1000 ms)`. After a numeric catalog is accepted—even with zero Transform Profiles—assert the numeric first-sample/silence deadline uses its global T: T `100` is fresh at 999 ms and STALE at 1,000 ms; T `1000` is fresh at 2,999 ms and STALE at 3,000 ms. Explicit `null` remains BAD by precedence and refreshes no clock until a later finite GOOD. Seed current Joint angles plus numeric/transform GOOD and accepted JointQuality GOOD. A bounded malformed string emits exactly one current-generation protocol fault, refreshes none of their sequence/receipt/last-GOOD clocks, keeps the socket open, makes transform/numeric consumers BAD, immediately shows numeric Manual fallback, preserves all six Joint angles plus accepted JointQuality GOOD, and publishes `{ acceptedQuality: 'GOOD', transportOverlay: 'BAD', effectiveQuality: 'BAD', connectionState: 'CONNECTED' }` without a synthetic JointFrame. Binary/oversized input closes the socket before JSON reduction, preserves those accepted Joint data, keeps the same accepted/overlay/effective tuple, and changes only shared `connectionState` plus transform/numeric consumers to DISCONNECTED. A later valid current-generation frame/reconnect clears the old-generation overlay without a zero-angle sample. Assert the client retains only the latest accepted catalogs/frames per connection and no message-history array.
- [ ] **Step 3: Add Joint/numeric regression tests** proving one shared client fans the same connection-generation fault to Joint, numeric Status, and transform consumers while preserving the existing `JointQuality = GOOD | UNCERTAIN | BAD | STALE` type. Every `subscribeJointPresentation` emission exposes accepted quality, overlay, derived effective quality, and connection separately. The header/source panel shows effective BAD immediately instead of the Robot store's prior accepted GOOD, while the projection still reports `acceptedQuality: 'GOOD'` and `transportOverlay: 'BAD'`; close changes only connection to DISCONNECTED and retains that distinction. It never owns or changes angles/accepted quality. Before any accepted Joint frame, assert `lastAcceptedReceivedAtMs === null`; the initial `acceptedQuality` mirrors the current Robot accepted quality, `transportOverlay` is null, and `effectiveQuality` equals it. At 999 ms after socket open the receipt remains null/overlay null, and at exactly 1,000 ms only `transportOverlay` becomes STALE so effective quality is STALE. Resolve each Project numeric Binding by exact `nodeId`/`scale`/`offset` to one current-generation catalog mapping ID, route a finite already-scaled GOOD value to canonical built-in/Object `entityId` without reapplying scale/offset, and treat `null`, missing mapping value, read failure, bounded malformed-string protocol fault, disconnect, or zero/multiple catalog matches as non-GOOD Manual fallback without refreshing last-GOOD/stale clocks. Seed numeric GOOD `42`, nonzero Joint angles, and accepted JointQuality GOOD; inject one bounded malformed string and assert numeric BAD plus durable Manual fallback, effective Joint BAD overlay plus unchanged accepted angles/GOOD/timestamp, and no socket close; inject binary/oversized input and assert connection DISCONNECTED, effective Joint BAD, and unchanged accepted angles/GOOD/timestamp. Feed otherwise identical GOOD Joint frames whose upstream timestamps are one day past/future; both become fresh GOOD after stamping the accepted frame with injected browser-local receipt `nowMs`, while upstream timestamps remain diagnostic. With fake time and an accepted frame, require accepted/effective Joint GOOD with null overlay at 999 ms of silence, accepted GOOD plus STALE overlay/effective at exactly 1,000 ms with angles/accepted receipt retained, and GOOD/null/GOOD again on one fresh current-generation frame. Keep the WebSocket connected while any Joint, numeric Status, or transform consumer remains enabled.
- [ ] **Step 4: Run** `npm run test:run -- src/features/opcua src/features/joints/OpcUaJointSource.test.ts`; expect missing protocol/client RED.
- [ ] **Step 5: Implement** synchronous string-only byte-before-parse validation, exact runtime narrowing, typed numeric `number | null` quality reduction, and one typed current-generation fault fan-out across Joint, numeric, and transform subscribers. `OpcUaJointSource` owns `subscribeJointPresentation` as a transport/silence overlay separate from `JointFrame`: each emission reads the Robot's last accepted `acceptedQuality`, maintains `transportOverlay`, derives `effectiveQuality = transportOverlay ?? acceptedQuality`, and reports connection independently. Bounded malformed sets overlay/effective BAD; binary/oversized sets connection DISCONNECTED plus overlay/effective BAD; neither changes angles, accepted quality, or accepted-frame/last-GOOD time. An open connection with no accepted Joint frame for exactly 1,000 ms sets only overlay/effective STALE; one valid current-generation Joint frame clears fault/silence overlay. For accepted Joint frames, retain upstream `timestampMs` only in diagnostics and stamp the reducer-facing frame with injected browser-local receipt `nowMs` in the same clock domain as the current reducer; never subtract cross-host clocks. `WorkspaceActivitySnapshot` and `JointSourcePanel` consume effective presentation plus connection state, so prior raw GOOD is never displayed during a fault, while diagnostics retain the accepted/overlay split. Use a fixed per-catalog handshake deadline of 3,000 ms from socket open, then `max(3 * T, 1000 ms)` deadlines from Transform Profile T and independently from numeric catalog global T, per-connection catalog identity/generation/sequence state, latest-only retained state, and reference-counted shared WebSocket ownership. Protocol faults never advance any consumer clock; later valid current-generation work can recover.
- [ ] **Step 6: Run** focused tests, `npm run lint`, `npm run build`, and `git diff --check`; expect GREEN.
- [ ] **Step 7: Commit** as `feat: validate OPC UA gateway transform frames`.

---

### Task 4: Pure Pose Interpolation and Quality/Hold Reducer

**Files:**
- Create: `src/features/equipment/opcua-transform-smoothing.ts`
- Create: `src/features/equipment/opcua-transform-smoothing.test.ts`

**Interfaces:**
- Produces: `gatewaySampleToPose`, `startPoseSegment`, `samplePoseSegment`, `acceptGoodTarget`, `holdCurrentPose`, `advanceTransformClock`, and `matrixChanged`.
- Consumes: Task 3 accepted frames, `Euler(..., 'ZYX')`, normalized `Quaternion`, one injected browser-local `nowMs` defaulting to `Date.now()` for receipt age/interpolation/visibility sampling, canonical Manual fallback, and Matrix4 comparison epsilon `1e-9`. Connector timestamps and `performance.now()` never enter reducer arithmetic.

```ts
interface SmoothedTransformState {
  readonly quality: 'WAITING' | 'GOOD' | 'BAD' | 'STALE' | 'DISCONNECTED'
  readonly motionState: 'WAITING_BASELINE' | 'HELD' | 'INTERPOLATING' | 'SETTLED'
  readonly baselineRequired: boolean
  readonly hasAcceptedGood: boolean
  readonly renderPose: TransformPose
  readonly targetPose: TransformPose
  readonly activeSegment: {
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
- [ ] **Step 5: Write failing visibility tests**: hide at 75 ms of a 200 ms segment samples exactly 37.5%, assigns that Pose to both render and target, clears `activeSegment`, and produces zero later render revision while hidden. Resume at 10,000 ms keeps the exact 37.5% held Pose rather than completing from hidden elapsed time. A fresh retained current-quality GOOD target may perform exactly one baseline snap; absent/stale/BAD/faulted retained state stays HELD until the first later fresh GOOD snap.
- [ ] **Step 6: Write failing revision/jitter tests**: a changed baseline snap increments `targetRevision` and `renderRevision` once, while an identical baseline only clears `baselineRequired`; a subsequent target matrix changed by `>1e-9` increments `targetRevision` once; `<=1e-9` changes only quality/receipt clock; interpolation changes only `renderRevision`; controlled target arrivals at `100 ms +/- 40 ms` rebase from sampled render Pose with acceptance-time matrix jump `<=1e-9` and no extrapolation.
- [ ] **Step 7: Run** `npm run test:run -- src/features/equipment/opcua-transform-smoothing.test.ts`; expect missing reducer RED.
- [ ] **Step 8: Implement** pure immutable functions, one baseline-snap flag, separate HELD motion state, exact `activeSegment` and `lastGoodReceivedAtMs` transient state fields, browser-local same-domain receipt-age stale transition `max(3 * T, 1000 ms)`, hide sampling/segment clearing, fresh-only foreground baseline selection, latest-target-only background handling, protocol-fault hold transition, and no extrapolation. Inject one fake `nowMs` clock in tests. A negative elapsed value from a backward wall-clock jump makes the retained sample non-fresh/HELD with `baselineRequired: true`; the next valid current-generation GOOD stamps the new clock and establishes one baseline. A forward jump may make the sample STALE. Neither jump permits extrapolation or backlog replay.
- [ ] **Step 9: Run** focused tests, `npm run lint`, `npm run build`, and `git diff --check`; expect GREEN.
- [ ] **Step 10: Commit** as `feat: smooth OPC UA equipment transform targets`.

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
- Consumes: WS1 canonical transform state plus `ProjectOpcUaNumericStatusBindingV3`/Transform bindings, Task 3 gateway client, Task 4 reducer, existing grasp/manual mutation paths, Equipment scene, Geometry registry, current-pose collision, and validation report store.

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
- [ ] **Step 2: Add quality/race tests** proving Profile/Gateway/revision mismatch is BAD with Manual transform fallback before any GOOD and HELD render Pose after a prior GOOD, numeric catalog tuple mismatch is BAD with `manualNumericStatus` fallback, source change clears prior target/clock and requires one baseline snap, BAD/STALE/bounded protocol fault/disconnect freeze current render Pose, a stale foreground target does not snap, switching a held entity to OPC UA is rejected, and Transform-OPC-owned entities cannot drag/apply/grasp. Split restoration ownership into two tests: changing/removing active Transform ownership restores only `manualTransform`, clears the transform runtime generation/segment, and leaves numeric source/Binding/effective value unchanged; changing/removing active numeric ownership restores only `manualNumericStatus` and leaves Transform source/Binding/render Pose unchanged. Each active Binding removal submits one valid candidate with source Manual plus Binding absent and exposes no source-without-Binding snapshot. After live transform/numeric frames, Project capture and archive remain byte-for-byte unchanged in both Manual fallbacks and contain no effective live value, quality, or receipt time.
- [ ] **Step 3: Write failing scene/collision tests** proving the same effective render Matrix4 reaches `EquipmentScene` and Geometry registry on each coalesced animation frame; target Pose is never registered; live collision sees the intermediate pose within 100 ms plus one render frame. Move MCP during both `mcp` and `world` bindings and assert reference conversion changes the effective matrix without creating an OPC target revision; the existing frame-mutation path remains the sole report invalidator for that frame edit.
- [ ] **Step 4: Write failing revision/report tests** proving one accepted changed target calls `noteAcceptedMotionTarget` once, 2-12 interpolation frames call only `noteRenderedTransform`, an identical target calls neither target invalidation nor a new segment, and sequence validation cannot publish a current report while any external interpolation is active.
- [ ] **Step 5: Add deterministic performance tests** retaining latest catalog/frame/reducer state only for 32 Profiles over 10,000 jittered frames. Assert serialized retained protocol/reducer state is below 1 MiB and p95 `advance` cost over 5,000 post-warmup frames is below 2 ms/frame on the test runner.
- [ ] **Step 6: Run** `npm run test:run -- src/features/equipment/equipment-transform-runtime.test.ts src/features/equipment/equipment-transform-store.test.ts src/app/external-entity-mutations.test.ts src/features/interaction/grasp-actions.test.ts src/features/equipment/EquipmentScene.test.ts src/features/collision`; expect missing authority/revision split RED.
- [ ] **Step 7: Implement** one generation gate per entity, RAF-coalesced sampling, hidden-transition sampling/segment clearing, visibility-resume baseline handling without hidden-time playback, current render Pose publication, World/MCP conversion after interpolation in reference coordinates, fixed-size latest-only state, and collision revision separation. Keep active reports stale during motion and allow a new current report only after all segments settle.
- [ ] **Step 8: Run** focused tests, `npm run lint`, `npm run build`, and `git diff --check`; expect GREEN.
- [ ] **Step 9: Commit** as `feat: gate OPC UA transform ownership and collision`.

---

### Task 6: Feature Binding Surface, WS6 Handoff, and WS5 Release Gate

**Files:**
- Create: `src/features/equipment/OpcUaNumericStatusBindingPanel.tsx`
- Create: `src/features/equipment/OpcUaNumericStatusBindingPanel.test.tsx`
- Create: `src/features/equipment/OpcUaNumericStatusBindingPanel.css`
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
- Produces: controlled numeric mapping and Transform Profile binding panels for canonical built-in/Object targets, Project mutation commands `setNumericStatusBinding(entityId, binding)`, `removeNumericStatusBinding(entityId)`, `setTransformBinding(entityId, binding)`, and `removeTransformBinding(entityId)`, an exact `onBindingOutcome` accessibility handoff, deterministic fake-gateway integration evidence, and a frozen WS6 presentation handoff.
- Consumes: Tasks 2-5, WS1 public Project mutation/persistence interfaces including canonical numeric Status bindings, and canonical external-entity IDs. It does not own App shell placement, Workspace Mode routing, Equipment Inspector composition, or Playwright.

The mutation commands preserve the WS1 source invariant. Switching either
Manual source to OPC UA requires the matching Binding in the same candidate.
Removing an active numeric Binding atomically switches `statusSource` to Manual,
restores `manualNumericStatus`, and deletes only that Binding. Removing an active
Transform Binding atomically switches `transformSource` to Manual, restores
`manualTransform`, clears its runtime generation/segment, and deletes only that
Binding. No command publishes a source-without-Binding intermediate snapshot.
Each command is async and calls `ProjectMutationService.replaceFromActive()`
exactly once with a byte-free recipe and no source groups. Panels retain their
published read model while pending; duplicate submit is disabled, and rejection
shows an error without local Binding/source mutation.

- [ ] **Step 1: Write failing panel tests** for both canonical `equipment:*` and `object:*` targets. Numeric tests cover catalog loading, exact NodeId/scale/offset display, keyboard create/replace/delete through the named Project mutation commands, one target binding maximum, unavailable/ambiguous mapping BAD state, Manual fallback, and zero mutation of Transform Binding. Transform tests cover exact Gateway/Profile/revision display, unique Profile assignment, `world | mcp`, default MCP, keyboard create/replace/delete, Manual controls disabled in OPC UA mode, quality precedence, last-update age, separate HELD motion state, missing/mismatched Profile fallback rules, and source independence from Robot Joint mode/numeric Status. Live XYZ values convert runtime metres to millimetres with three decimals; RPY stays degrees with two decimals. Prove Manual-to-OPC source change without a same-candidate Binding is rejected. Deleting an active numeric/Transform Binding publishes exactly one candidate that restores only its corresponding Manual source/fallback and removes only that Binding; no invalid intermediate snapshot is submitted. Assert smoothing is read-only text `2 cycles · 200 ms` at T `100`, and no smoothing spinbutton exists. Both panels emit `onBindingOutcome({ message, focusTarget })` for the WS6 shell's persistent polite live region: Apply success is exactly `Binding applied.` and requests `binding-summary`; Delete success is `Binding removed.` and requests `binding-source-control`; Cancel makes no mutation, emits `Binding changes canceled.`, and requests `binding-edit-trigger`; invalid Apply associates field errors, emits `Binding could not be applied. Review the highlighted fields.`, and requests `first-invalid-field`. Test Tab/Shift+Tab plus Enter/Space flows, pending/double-submit disabling, and focus restoration for Apply/Delete/Cancel.
- [ ] **Step 2: Write a fake-gateway integration test** with fake timers and injected RAF. Assert first GOOD baseline snaps once, the next changed target samples 0/50/100% at 0/100/200 ms and settles by 250 ms, `350 deg -> 10 deg` takes the short arc, `100 ms +/- 40 ms` jittered retargets have no acceptance-time jump, and BAD/STALE/bounded malformed-string protocol fault/disconnect show HELD at the same scene/collision Pose without refreshing last-GOOD time.
- [ ] **Step 3: Add race/integration coverage** for an old-generation frame after Binding change, delete during motion, Project replacement during motion, reconnect sequence reset/baseline snap, hide-time mid-segment freeze plus zero hidden-time progression, fresh foreground-resume snap, stale foreground-resume hold followed by one fresh-GOOD snap, identical periodic targets, Simulation Joint mode with moving Equipment, World-bound stability across MCP motion, unchanged Project `manualNumericStatus` under live Status, transform-only Manual restoration with numeric source unchanged, and numeric-only Manual restoration with transform source/render Pose unchanged.
- [ ] **Step 4: Run** `npm run test:run -- src/features/opcua src/features/equipment src/features/collision src/app/external-entity-mutations.test.ts`; expect missing panel/integration RED, then implement only WS5-owned gaps until GREEN.
- [ ] **Step 5: Write** `docs/integration/opcua-transform-ws6-handoff.md` with exact numeric/Transform panel props, selectors, four mutation commands, CONNECT-mode mount points, selected canonical entity handoff, numeric quality and transform quality/HELD badges, live XYZ mm/RPY degree formatting, exact `2 cycles · derived milliseconds` text, visibility-resume notification, pending/error states, and browser scenarios WS6 must own. Freeze the four messages/focus targets above and require WS6 to mount one persistent `role="status" aria-live="polite" aria-atomic="true"` region outside panel remount boundaries, consume every `onBindingOutcome`, announce once, then focus the requested stable element. Do not edit `App.tsx`, Workspace/Inspector composition, global shell CSS, or Playwright specs here.
- [ ] **Step 6: Document** Middleware numeric mapping and Transform Profile catalogs, units/scales, limits, revisions, polling-only/read-only boundary, numeric GOOD/`null` quality, one-snap baseline rules, two-cycle smoothing, HELD semantics, fallback rules, reference frames, source ownership, collision behavior, background resume, binding create/update/delete, troubleshooting, and the lack of security in this stage.
- [ ] **Step 7: Run final WS5 gates:** `npm run test:middleware`, `npm run verify`, `npm audit --audit-level=high`, `git diff --check`, and `rg -n "T[B]D|T[O]DO|F[I]XME|place[h]older" middleware src/features/opcua src/features/equipment docs/integration/opcua-transform-ws6-handoff.md docs/operator/opcua-equipment-transforms.md`; then run `rg -n --glob '*.mjs' "\.write\(|createSubscription|createMonitoredItem" middleware`. Resolve every unfinished marker and expect zero Connector source hits.
- [ ] **Step 8: Record** exact commands/pass counts, baseline-snap counts, 0/100/200 ms timing table, jitter/short-arc/HELD evidence, server/client boundaries, revision counts, memory/p95 measurements, and the exact WS6 handoff revision in `docs/verification/opcua-transform-smoothing-verification.md`.
- [ ] **Step 9: Commit** as `docs: verify OPC UA transform smoothing`.

## Quantitative Acceptance Criteria

1. Connector validation accepts 32 Profiles and 256 total read Nodes, rejects 33/257, accepts 128-byte IDs and 1,024-byte NodeIds, and rejects 129/1,025 bytes using UTF-8 byte counts.
2. One polling cycle makes exactly one `session.read` call. Each GOOD transform contains all six values from that result; any one BAD/missing/non-finite value emits only `{ quality: 'BAD' }` for that Profile. A numeric mapping emits a number only for GOOD StatusCode plus finite converted output; finite raw with BAD StatusCode and every missing/non-finite/read-failure case emit `null`, with a read failure making all numeric mappings `null`.
3. Raw `[1000, -250, 800, 10, 20, 30]` with XYZ scale `0.001` maps to position `[1, -0.25, 0.8]` m and the normalized Quaternion from `Euler(10 deg, 20 deg, 30 deg, 'ZYX')` within absolute-component error `1e-6`.
4. Server and browser accept 65,536-byte UTF-8 catalog/frame payloads and reject 65,537 bytes before broadcast/reduction.
5. First complete GOOD after Binding/source/generation change or reconnect snaps exactly once to establish the baseline. Foreground resume snaps only when the retained same-generation target is current-quality GOOD, has no later non-GOOD/fault, and is younger than the stale threshold; an absent/stale/BAD/faulted target holds and leaves the snap pending for the first later fresh GOOD. The next changed target at T `100 ms` uses D `200 ms`, is at 0%, 50%, and 100% at elapsed 0, 100, and 200 ms, and settles within one render frame without exceeding 250 ms in the jitter reference. T `10`/`1000` yields D `20`/`2000 ms`.
6. Every persisted transform binding contains exactly `smoothing: { mode: 'two-cycle', cycles: 2 }`; the UI derives `200 ms` at T `100` and exposes zero duration editors.
7. Quaternion interpolation `350 deg -> 10 deg` follows the 20 deg shortest arc and `179 deg -> -179 deg` follows the 2 deg shortest arc; midpoint error is within `1e-6` and norm within `1e-9`.
8. Subsequent changed targets arriving at `100 ms +/- 40 ms` and mid-motion retargets produce no acceptance-time render-matrix discontinuity greater than `1e-9`; no state extrapolates beyond its target.
9. BAD, STALE, malformed input, and disconnect preserve the sampled current render Pose, expose `HELD` for at least ten subsequent animation advances, and never emit a zero or partial Pose. A bounded malformed string emits one BAD protocol fault while keeping the socket open, preserves all six current Robot Joint angles plus last accepted `JointQuality`/time, and publishes accepted GOOD / overlay BAD / effective BAD separately; binary/oversized input changes shared connection to DISCONNECTED while preserving those accepted Joint data and the same overlay/effective values. Silence at exactly 1,000 ms similarly preserves accepted quality while setting overlay/effective STALE. `JointQuality` is not widened or synthetically rewritten, and every projection satisfies `effectiveQuality === (transportOverlay ?? acceptedQuality)`. A later valid generation recovers without a zero-angle transition. Connector timestamp skew of plus/minus one day cannot alter receipt-based Joint freshness. A mismatch falls back to Manual only before the first GOOD of that generation.
10. Before a catalog exists, the handshake remains WAITING at 2,999 ms after socket open and becomes BAD at exactly 3,000 ms. After catalog acceptance, stale time is exactly `max(3 * T, 1000 ms)` using same-domain browser-local `Date.now()` receipt age; duplicate/lower sequences and malformed-string protocol faults refresh no clock. Connector/upstream timestamp skew of plus/minus one day and `performance.now()` origin never affect freshness. A backward/invalid wall-clock delta is conservatively non-fresh until a later accepted sample. A stale foreground target or a still-young GOOD followed by BAD/fault causes zero snap, and the first later fresh complete GOOD causes exactly one snap.
11. One accepted changed target increments `targetRevision` and invalidates reports exactly once; interpolation frames increment only `renderRevision`; after settling, 100 identical targets add zero target revisions, zero render/Geometry mutations, and zero report invalidations.
12. Scene and live collision matrices match element-for-element within `1e-9` at every sampled frame, and collision reacts within 100 ms plus one render frame.
13. Hiding at time `th` samples and holds the current render Pose, assigns it to target Pose, and clears `activeSegment`; no hidden elapsed time changes the Pose. Resume keeps that held Pose unless the exact fresh retained-GOOD baseline rule permits one snap.
14. All tested old-generation samples and late Manual/grasp/delete/Project operations cause zero unauthorized mutations. Live numeric Status never changes archived `manualNumericStatus`; Transform-to-Manual restores only `manualTransform`, numeric-to-Manual restores only `manualNumericStatus`, the other source/effective state remains unchanged in each case, and archives contain no effective live value/quality/time.
15. Retained protocol/reducer state for 32 Profiles remains below 1 MiB after 10,000 jittered frames, and p95 transform advance cost is below 2 ms/frame over 5,000 measured frames after warmup.
16. Middleware executes zero OPC UA writes, method calls, MonitoredItems, or Subscriptions; `npm run test:middleware`, `npm run verify`, the focused WS5 integration suite, audit, and diff gates pass. Final CONNECT/Inspector composition and Playwright workflow are explicit WS6 acceptance work.
17. The Connector publishes one unique numeric mapping catalog entry per unchanged `equipment` mapping plus global T even with zero Transform Profiles. Browser resolution requires an exact unique `nodeId`/`scale`/`offset` match, routes only a finite GOOD Middleware-converted value keyed by mapping ID to both canonical `equipment:*` and `object:*` targets, applies scale/offset exactly once, and holds the Manual fallback with BAD quality for null/missing values, zero/multiple matches, and bounded malformed-string protocol faults without refreshing last-GOOD/stale clocks. One shared client fans bounded-string BAD to all subscribers; binary/oversized produces transform/numeric plus connection DISCONNECTED while the Joint overlay remains BAD, with the retention rules in criterion 9. A protocol fault after numeric GOOD replaces the displayed live value with `manualNumericStatus` immediately; it never leaves the prior GOOD value visible. T `100`/`1000` reaches STALE on silence at exactly `1000`/`3000 ms`; explicit `null` stays BAD by precedence.
18. Numeric and transform catalogs carry one matching Gateway ID and precede their respective frame kinds. A pre-catalog numeric frame changes no state; an identical duplicate catalog changes no state; a different replacement or Gateway mismatch closes the socket. Reconnect increments generation and clears both catalogs, mapping resolutions, frames, and sequences before any new-generation value is accepted.
19. WS5 exposes tested controlled numeric and Transform binding panels plus four explicit Project mutation commands. An operator can create, replace, and delete a numeric Status Binding for either a built-in or Object canonical target; each operation persists through WS1, changes no Transform Binding, and WS6 receives an exact mount contract.
20. Manual-to-OPC source activation without its matching Binding is rejected. Removing an active numeric or Transform Binding makes one atomic Project replacement that sets only the corresponding source to Manual, restores its durable fallback, removes that Binding, and publishes no invalid intermediate state; the other source/Binding remains byte-for-byte unchanged.
21. Both Binding panels support keyboard create/replace/delete for built-in and Object targets, expose field-associated errors plus one summary, and emit the exact Apply/Delete/Cancel/invalid messages and focus targets in Task 6. WS6 announces each outcome once through its persistent polite live region and restores focus. CONNECT live XYZ is displayed in mm to three decimals, RPY in degrees to two, and smoothing text is exactly `2 cycles · derived milliseconds` in the handoff.
22. Eight concurrent Gateway WebSocket clients remain healthy and receive current catalogs/frames; the ninth closes `1013`. A client at exactly 1,048,576 buffered bytes may send, while 1,048,577 closes only that client `1013` without queuing, delaying polling, or dropping another client's same-cycle frame.

## Self-Review

- Spec coverage: ambiguous immediate-first-GOOD wording is replaced before code by one explicit baseline snap followed by two-cycle smoothing; connector numeric mapping/transform Profile catalogs, canonical numeric routing, atomic six-node reads, limits, quality, HELD behavior, shortest arc, races, shared render/collision Pose, and one-time report invalidation each have tests.
- Scope: OPC UA security, authentication, writes, methods, Subscriptions, prediction, physics, and public-internet deployment remain excluded.
- Placeholder scan: every step provides concrete paths, interfaces, limits, commands, race outcomes, and timing expectations; the final scan detects unfinished markers without matching this sentence.
- Type consistency: the Middleware wire contract, browser parser, reducer, authority store, scene, and collision paths preserve one Profile/sample/Pose model with explicit target/render revisions.
- Temporal consistency: freshness, interpolation, visibility sampling, and Joint receipt use one injected browser-local clock, default `Date.now()`, end-to-end. Connector/upstream timestamps and `performance.now()` remain outside reducer arithmetic; backward/forward wall-clock jumps follow the conservative hold/stale rule in Task 4.
- Workstream ownership: WS1 owns persisted types/codec; WS5 owns Middleware, protocol, smoothing, authority, feature panel, and runtime/collision integration; the separate WS6 plan owns App/Workspace/Inspector composition and browser-level release coverage.
