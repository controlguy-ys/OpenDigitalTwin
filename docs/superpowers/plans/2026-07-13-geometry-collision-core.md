# Geometry Collision Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Rapier runtime collision with deterministic Box/Compound-Box geometry queries for current Robot poses and complete joint Pose sequences, including near-miss policy, reporting, and `.wdtwin` persistence.

**Architecture:** Pure collision-domain modules transform local Boxes into World OBBs, run sweep-and-prune broad phase and SAT narrow phase, then return stable findings without changing scene state. A runtime Entity Registry adapts Robot Links, Tool, held Objects, the Workbench Environment, legacy Equipment, and imported Object Instances into the same contract. Current-pose queries run at a revision-driven 10 Hz cap; sequence validation runs in a cancellable Worker and persists policy/proxies through project schema V2 with V1 migration.

**Tech Stack:** React 19, TypeScript 6, Three.js 0.185, React Three Fiber 9, Zustand 5, Vitest 4, Web Workers, Playwright 1.61, fflate 0.8.

## Global Constraints

- No production source may import `@react-three/rapier` after Task 3.
- Collision is geometry query only: no forces, gravity, mass, friction, impulse, rebound, or rigid-body response.
- Internal units remain metres/radians and normalized `[x,y,z,w]` quaternions.
- Render Geometry and Collision Geometry remain separate.
- This slice supports Box and Compound Box proxies only; convex and Triangle BVH validation are deferred.
- One rendered six-axis Robot remains the runtime limit.
- Current-pose queries are capped at 10 Hz and are revision-driven, not render-frame-driven.
- Sequence validation runs in a Worker, caps at 20,000 samples and 10,000 findings, and is independent of FPS.
- V1 `.wdtwin` import must preserve visible placement; V2 export/import must preserve all collision data.
- UI and reports use `Geometry Proxy Collision` and `Approximate Clearance`; no safety-rated claims.
- Preserve unrelated user changes and use TDD with one focused commit per task.

---

### Task 1: Pure Geometry Collision Domain

**Files:**
- Create: `src/domain/collision/collision.ts`
- Create: `src/domain/collision/obb.ts`
- Create: `src/domain/collision/broad-phase.ts`
- Create: `src/domain/collision/query-collision.ts`
- Create: `src/domain/collision/obb.test.ts`
- Create: `src/domain/collision/broad-phase.test.ts`
- Create: `src/domain/collision/query-collision.test.ts`
- Create: `src/features/collision/collision-store.ts`
- Create: `src/features/collision/collision-store.test.ts`

**Interfaces:**
- Produces: `CollisionBox`, `GeometryCollisionEntity`, `WorldObb`, `CollisionPolicy`, `CollisionFinding`, `pairKey()`, `worldObbFromBox()`, `broadPhasePairs()`, `queryObbPair()`, `queryGeometryCollisions()`, and the minimal `useCollisionStore` policy/current-findings slice required by Tasks 3-4.
- Consumes: pure domain modules accept numeric arrays only; the feature store consumes cloned domain values through Zustand. Neither layer depends on React components, R3F, DOM, or Rapier.

- [ ] **Step 1: Write failing tests** for finite/positive Box validation, namespaced Entity identity including `workcell:workbench`, order-independent `pairKey`, rotated/scaled OBB transforms, all 15 SAT axes, collision, clear, near-miss, warning-expanded broad-phase retention, ignored pairs, stable ordering, Compound Box de-duplication, and atomic store replacement.

```ts
it('classifies separated proxy boxes inside the warning distance as near miss', () => {
  const finding = queryObbPair(obbAt(0), obbAt(1.05), 0.1)
  expect(finding).toMatchObject({ kind: 'near-miss' })
  expect(finding?.separationM).toBeCloseTo(0.05)
})
```

- [ ] **Step 2: Verify RED** with `npm run test:run -- src/domain/collision src/features/collision/collision-store.test.ts`; expect missing-module failures.
- [ ] **Step 3: Implement immutable domain types** and validation. `pairKey()` lexically sorts IDs. `worldObbFromBox()` composes Entity matrix, Box center/quaternion, and non-uniform scale. SAT tests the three axes from each OBB plus nine cross axes, skipping cross axes with squared length below `1e-12`.

```ts
export interface CollisionFinding {
  readonly pairKey: string
  readonly firstEntityId: string
  readonly secondEntityId: string
  readonly firstBoxId: string
  readonly secondBoxId: string
  readonly kind: 'collision' | 'near-miss'
  readonly separationM: number
  readonly sampleIndex: number | null
  readonly timeMs: number | null
}
```

- [ ] **Step 4: Implement broad phase, query orchestration, and the minimal store.** Build World AABBs from OBB corners, expand each AABB by `warningDistanceM`, sort by minimum X, maintain an active interval list, reject expanded Y/Z separation, apply category/pair policy before SAT, collapse multiple Box findings to the most severe Entity-pair row, and stable-sort results. The initial store owns validated policy, current findings, diagnostics, and one atomic replacement action; report/navigation state is added in Task 5.
- [ ] **Step 5: Verify and commit.** Run `npm run test:run -- src/domain/collision src/features/collision/collision-store.test.ts && npm run lint && npm run build && git diff --check`; commit as `feat: add pure geometry collision queries`.

---

### Task 2: Unified Runtime Collision Entity Registry

**Files:**
- Create: `src/features/collision/geometry-entity-registry.ts`
- Create: `src/features/collision/geometry-entity-registry.test.ts`
- Create: `src/features/collision/scene-entity-adapter.ts`
- Create: `src/features/collision/scene-entity-adapter.test.ts`
- Modify: `src/features/interaction/equipment-object-registry.ts`
- Modify: `src/features/equipment/EquipmentScene.tsx`
- Modify: `src/features/robot/RobotModel.tsx`
- Modify: `src/features/robot/RobotGripper.tsx`
- Modify: `src/features/objects/object-equipment-adapter.ts`
- Modify: `src/features/objects/object-equipment-adapter.test.ts`
- Modify: `src/features/scene/Workcell.tsx`

**Interfaces:**
- Produces: `GeometryEntityRegistration`, `geometryEntityRegistry`, `registerGeometryEntity()`, `snapshotGeometryEntities()`, `equipmentRecordToGeometryEntity()`, `objectInstanceToGeometryEntity()`, `robotLinkToGeometryEntity()`, and `workbenchToGeometryEntity()`.
- Consumes: existing `EquipmentRecord`, Object Asset/Instance records, Robot geometry records, and live `Object3D.matrixWorld` references.

- [ ] **Step 1: Write failing tests** proving stable IDs across grasp/release, defensive tuple ownership, registration replacement/cleanup, legacy Equipment/imported Object equivalence, held-object category-only switching, custom Robot Link collider use, the `environment` category and `workcell:workbench` pair behavior, missing Object3D diagnostics, and snapshot immutability.

```ts
expect(objectInstanceToGeometryEntity(asset, instance, object3D)).toMatchObject({
  id: `object:${instance.id}`,
  category: 'object',
  boxes: [{ center: asset.colliderCenter, halfExtents: asset.collisionHalfExtents }],
})
```

- [ ] **Step 2: Verify RED** with focused collision, Object, Equipment, and Robot tests.
- [ ] **Step 3: Implement a vanilla registry** that stores Entity metadata, a live Object3D reference, collider revision, and lifecycle token. `snapshotGeometryEntities()` updates matrixWorld once, serializes 16 matrix numbers, and returns diagnostics separately from active Entities.
- [ ] **Step 4: Register all runtime participants.** Workcell registers the existing Workbench proxy as `workcell:workbench`/`environment` and preserves the current allowed Link-pair behavior. EquipmentScene registers both legacy Equipment and imported Object Instances. RobotModel registers seven Link model objects using active Robot Geometry records. RobotGripper registers `tool:default`. Grasp state changes only the external Entity category to `held-object`; the canonical `object:*` or `equipment:*` ID never changes and no rigid body is created.
- [ ] **Step 5: Verify and commit.** Run `npm run test:run -- src/features/collision src/features/equipment src/features/objects src/features/robot && npm run build`; commit as `feat: unify collision scene entities`.

---

### Task 3: Replace Rapier Runtime and Grasp Sensor

**Files:**
- Create: `src/features/collision/current-pose-collision.ts`
- Create: `src/features/collision/current-pose-collision.test.ts`
- Create: `src/features/collision/CurrentPoseCollisionSystem.tsx`
- Create: `src/features/interaction/geometry-grasp-sensor.ts`
- Create: `src/features/interaction/geometry-grasp-sensor.test.ts`
- Modify: `src/features/interaction/GraspController.tsx`
- Modify: `src/features/interaction/GraspController.test.tsx`
- Modify: `src/features/interaction/collision-events.ts`
- Modify: `src/features/interaction/collision-events.test.ts`
- Modify: `src/features/scene/SceneCanvas.tsx`
- Modify: `src/features/scene/Workcell.tsx`
- Delete: `src/features/interaction/CollisionSystem.tsx`
- Delete: `src/features/interaction/interaction-rapier.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `CurrentPoseCollisionScheduler`, `CurrentPoseCollisionSystem`, `findGraspCandidates(sensorEntity, candidates)`, and edge-triggered geometry collision events.
- Consumes: the registry snapshot/query API and existing interaction/Robot stores.

- [ ] **Step 1: Write failing tests** for the 100 ms scheduler cap, immediate revision-triggered first query, no duplicate enter events, one exit event, optional playback pause, no transform mutation, OBB grasp selection by distance/tie-break ID, and release World-pose preservation.
- [ ] **Step 2: Verify RED**, then remove `<Physics>` from SceneCanvas and run focused tests to confirm Rapier-dependent tests fail for the intended reason.
- [ ] **Step 3: Implement the scheduler and R3F adapter.** Use `useFrame` only to observe elapsed time and revisions; execute at most once per 100 ms. Findings update one Zustand collision store action per query, not per pair/render frame.
- [ ] **Step 4: Replace grasp overlap and remove Rapier.** GraspController derives a Tool-local sensor Box, queries candidate Entity OBBs, attaches the nearest deterministic candidate under TCP, and keeps the existing MCP-local release conversion. Run `npm uninstall @react-three/rapier` and verify `rg -n "rapier|RigidBody|CuboidCollider|useBeforePhysicsStep" src package.json` returns no production hits.
- [ ] **Step 5: Verify and commit.** Run interaction/scene/collision tests, full build, and `git diff --check`; commit as `refactor: replace physics collision with geometry queries`.

---

### Task 4: Project Schema V2 and Collision Persistence

**Files:**
- Modify: `src/domain/project/project.ts`
- Modify: `src/domain/project/project.test.ts`
- Create: `src/domain/project/project-v1-migration.ts`
- Create: `src/domain/project/project-v1-migration.test.ts`
- Modify: `src/features/project/project-codec.ts`
- Modify: `src/features/project/project-codec.test.ts`
- Modify: `src/features/project/browser-project-runtime.ts`
- Modify: `src/features/project/project-store.ts`
- Modify: `src/features/project/project-db.ts`
- Modify: `src/features/project/ProjectMenu.test.tsx`
- Modify: `src/features/frames/coordinate-frame-store.ts`
- Modify: `src/features/robot/robot-geometry-store.ts`
- Modify: `src/features/robot/robot-geometry-store.test.ts`
- Modify: `src/features/objects/object-asset-store.ts`
- Modify: `src/features/objects/object-asset-store.test.ts`
- Modify: `src/features/project/project-store.test.ts`
- Modify: `tests/project-roundtrip.spec.ts`

**Interfaces:**
- Produces: literal `WORKCELL_PROJECT_SCHEMA_VERSION_V1 = 1`, `WORKCELL_PROJECT_SCHEMA_VERSION = 2`, `WorkcellProjectSnapshotV2`, `CurrentProjectSnapshot`, `ProjectCollisionBoxV2`, `ProjectCollisionPolicyV2`, `migrateV1ToV2()`, V1/V2 decode, and V2-only encode.
- Consumes: current V1 snapshot, project store staging/rollback, collision registry policy and Box metadata.

- [ ] **Step 1: Write failing schema/store tests** for unique Box IDs, finite normalized quaternion, positive half extents, 16-Box Entity cap, 1,024-Box project cap, sorted unique pair keys, non-negative warning distance, Compound Box clone/replace/capture preservation in Robot Geometry and Object Asset stores, and invalid-data atomic rejection.
- [ ] **Step 2: Write failing migration tests** proving every V1 Link/Asset collider becomes one identity-rotation `default` Box, the default policy is enabled with `0.02 m` warning distance, visible transforms are unchanged, and migration owns all arrays.
- [ ] **Step 3: Implement V2 types, migration, and canonical collider rules.** Give every V1 manifest/snapshot a literal `schemaVersion: 1` independent of the current-version constant. Keep legacy center/half-extents fields during one compatibility cycle, add `collisionBoxes` and snapshot `collisionPolicy`, set the current schema version to 2, define `CurrentProjectSnapshot = WorkcellProjectSnapshotV2`, and make the project validator return a normalized owned V2 snapshot. A non-empty V2 `collisionBoxes` array is canonical and invalid arrays are rejected instead of falling back; legacy fields mirror its first Box. Existing `setCollision` updates the first Box center/extents while preserving its ID/quaternion and all additional Boxes.

```ts
export interface ProjectCollisionPolicyV2 {
  enabled: boolean
  warningDistanceM: number
  ignoredPairKeys: string[]
  enabledRobotSelfPairs: string[]
}
```

- [ ] **Step 4: Update every snapshot consumer plus codec/runtime.** Convert ProjectRuntime, ProjectStore, ProjectDB, browser runtime, coordinate-frame aliases, menu/tests, and codec encode paths from V1 to `CurrentProjectSnapshot`. Extend Robot Geometry and Object Asset record clone/replace/capture paths to own and preserve every canonical Box. Decode the manifest version first, validate V1 with V1 rules, migrate before current validation, encode `collision/policy.json`, include `collisionBoxes` in Robot/Object JSON, and commit collision state only after all geometry restoration succeeds.
- [ ] **Step 5: Verify and commit.** Run project/domain/codec tests plus Playwright semantic round-trip; commit as `feat: persist geometry collision projects`.

---

### Task 5: Collision Policy, Findings, and Report UI

**Files:**
- Modify: `src/features/collision/collision-store.ts`
- Modify: `src/features/collision/collision-store.test.ts`
- Create: `src/features/collision/CollisionPanel.tsx`
- Create: `src/features/collision/CollisionPanel.test.tsx`
- Create: `src/features/collision/collision-report.ts`
- Create: `src/features/collision/collision-report.test.ts`
- Modify: `src/features/interaction/outline-state.ts`
- Modify: `src/features/interaction/outline-state.test.ts`
- Modify: `src/features/robot/RobotModel.tsx`
- Modify: `src/features/equipment/EquipmentScene.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces: report/navigation extensions to `useCollisionStore`, `ignorePair()`, `restorePair()`, `setValidationReport()`, `CollisionPanel`, `encodeCollisionReportJson()`, and `encodeCollisionReportCsv()`; Task 1 already provides policy/current findings/diagnostics.
- Consumes: current-pose findings, future Worker report, Entity diagnostics, Project V2 runtime bridge, and outline rendering.

- [ ] **Step 1: Write failing store/report tests** for finite policy validation, canonical pair keys, ignored-pair persistence, finding replacement as one state transition, stale report marking, deterministic CSV escaping/order, JSON schema version, and 10,000-row export cap.
- [ ] **Step 2: Write failing UI tests** for enabled toggle, millimetre warning distance, live Collision/Near-miss counts, diagnostics, ignore/restore, finding navigation, optional pause toggle, JSON/CSV download, and the non-safety disclaimer.
- [ ] **Step 3: Extend the store and implement report encoders.** Add report/navigation state without changing Task 1 policy/current-findings semantics, keep policy/current/report/diagnostics as separate slices, clone all incoming rows, and expose selectors that avoid rerendering the 3D canvas when only panel navigation changes.
- [ ] **Step 4: Implement UI/highlights.** Mount CollisionPanel alongside Timeline in the bottom rail, color collision red and near-miss yellow, focus the selected finding without changing transforms, and label distances as `Approximate Clearance`.
- [ ] **Step 5: Verify and commit.** Run collision/App/outline tests, accessibility queries, lint, and build; commit as `feat: inspect geometry collision findings`.

---

### Task 6: Deterministic Pose-Sequence Collision Worker

**Files:**
- Create: `src/features/collision/collision-validation-protocol.ts`
- Create: `src/features/collision/collision-validation-protocol.test.ts`
- Create: `src/features/collision/collision-validation.worker.ts`
- Create: `src/features/collision/collision-validation-client.ts`
- Create: `src/features/collision/collision-validation-client.test.ts`
- Create: `src/features/collision/validate-pose-sequence.ts`
- Create: `src/features/collision/validate-pose-sequence.test.ts`
- Modify: `src/features/collision/CollisionPanel.tsx`
- Modify: `src/domain/robot/kinematics.ts`
- Modify: `src/domain/robot/kinematics.test.ts`

**Interfaces:**
- Produces: `CollisionValidationRequest`, `CollisionValidationProgress`, `CollisionValidationResult`, `CollisionValidationClient`, `sampleJointSequence()`, and the Worker command `validate`/`cancel`.
- Consumes: Robot mechanics, MCP/Base/mount transforms, per-Link geometry local transform/scale, flange/tool/TCP transforms, Link/Tool proxy Boxes, optional held-Object TCP-local attachment, static Environment/external Entity Boxes, current Pose records, and collision policy.

- [ ] **Step 1: Write failing sampling tests** proving Preview `2 deg` and Validate `0.5 deg` maximum Joint deltas, easing/duration-derived timestamps, exact endpoints, deterministic sample counts, truncation at 20,000 samples with `truncated: true`, and zero-length segment handling.
- [ ] **Step 2: Write failing protocol/client tests** for request/result guards, progress monotonicity, cancellation, stale revision result rejection, Worker error recovery, and finding cap/truncation.
- [ ] **Step 3: Extract serializable FK and rendered-hierarchy composition.** Add a pure `computeRobotWorldMatrices(definition, geometryTransforms, toolFrames, angles, rootPose)` API that returns the seven Joint-slot matrices plus per-Link geometry, flange, Tool, and TCP World matrices without Object3D allocation. Cross-check every output against `createRobotRig()/setRigAngles()` and the rendered local-transform/scale hierarchy for zero and non-zero poses.
- [ ] **Step 4: Implement Worker and client.** Sample joints, compute Link geometry, flange, Tool, and TCP matrices, recompute an optional held Object from its TCP-local transform at every sample, instantiate World OBBs, query policy-selected pairs including the static Workbench Environment, add sample/time metadata, cap findings, post progress every 250 samples, and cancel at those boundaries. CollisionPanel starts/cancels validation and marks results stale on relevant revision changes.
- [ ] **Step 5: Verify and commit.** Run Worker protocol, FK parity, sequence validation, UI integration, lint, and build; commit as `feat: validate pose sequence geometry collisions`.

---

### Task 7: Browser Acceptance, Performance Evidence, and Documentation

**Files:**
- Create: `tests/geometry-collision.spec.ts`
- Create: `src/features/collision/collision-performance.test.ts`
- Create: `docs/operator/geometry-collision.md`
- Create: `docs/verification/geometry-collision-verification.md`
- Modify: `README.md`
- Modify: `docs/progress/2026-07-13-short-term-mvp-implementation.md`
- Modify: `docs/superpowers/plans/2026-07-13-geometry-collision-core.md`

**Interfaces:**
- Produces: repeatable acceptance evidence for current pose, near miss, ignored pair, sequence scan, V1 migration, V2 round-trip, runtime telemetry, and Docker deployment compatibility.
- Consumes: completed UI, project codec/store, collision Worker, and existing Playwright/Docker gates.

- [ ] **Step 1: Add browser acceptance** that positions an imported Object into collision and near-miss, confirms no pose response, verifies the pre-existing Workbench collision pair, ignores/restores a pair, validates a two-Pose sequence with a TCP-held Object, navigates to the first finding, exports reports, saves/exports/imports V2, and verifies the same policy/findings inputs after reload.
- [ ] **Step 2: Add deterministic performance fixtures** for 7 Link Boxes, 1 Tool Box, 50 external Boxes, and 1,000 sequence samples. Assert broad-phase candidate count is below unconstrained all-pairs, result caps hold, current scheduler never exceeds 10 Hz, and Worker progress keeps a browser animation counter advancing.
- [ ] **Step 3: Document operator workflow** for proxy editing, collision vs near miss, Collision Pair ignore, current/sequence validation, approximate clearance, reports, and limitations. Document migration, Worker/resource caps, and the absence of physics/safety validation for developers.
- [ ] **Step 4: Run final gates:** `npm run verify`, `npm run test:e2e`, `npm run deploy:validate`, `npm run deploy:smoke`, `npm run deploy:smoke:opcua`, `npm audit --audit-level=high`, placeholder scan, and `git diff --check`.
- [ ] **Step 5: Commit** browser/docs/evidence as `docs: verify geometry collision workflows`.

## Delivery Success Criteria

- All 21 success criteria in `docs/superpowers/specs/2026-07-13-geometry-collision-core-design.md` pass.
- Production dependency and source scans contain no Rapier runtime usage.
- Imported Object and custom Robot colliders demonstrably affect findings.
- Current-pose and sequence results are deterministic and never move scene Objects.
- V1 migration and V2 semantic project round-trip pass in a real browser.
- Worker limits, scheduler cap, telemetry, report caps, and Docker smoke evidence are recorded.

## Self-Review

- Spec coverage: pure query, Entity unification, physics removal, grasp, current runtime, persistence, UI, Worker scan, performance, browser acceptance, and safety language each have an explicit task.
- Scope: Cartesian Target/IK/MoveL, automatic avoidance, convex/BVH, dynamics, Multi-Robot, and safety validation are absent from implementation tasks.
- Placeholder scan: tasks name concrete files, APIs, limits, commands, failure expectations, and commit boundaries.
- Type consistency: Entity/Box/Policy/Finding types originate in Task 1 and are reused unchanged by registry, runtime, persistence, UI, Worker, and report tasks.
