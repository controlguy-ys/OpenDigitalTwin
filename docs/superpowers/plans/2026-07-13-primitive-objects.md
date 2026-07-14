# Primitive Objects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator create, configure, save, reload, and delete lightweight Box and Cylinder external objects without pretending that generated geometry came from a STEP file.

**Architecture:** Consume the Project v3 `ObjectAssetRecordV3` discriminated union frozen by workstream WS1. Generate one Three.js mesh and one deterministic collision Box from typed primitive parameters; keep dimensions/color on the reusable asset, `graspable` and durable `manualNumericStatus` fallback on the instance, Manual transform/transform source in canonical external-entity state, and OPC UA bindings in the separate frozen Project binding collection. Effective live numeric Status, quality, and timestamp remain runtime-only. Every primitive/Object create, asset edit, instance edit, Manual transform/status edit, and delete is asynchronous and submits exactly one byte-free `ProjectMutationService.replaceFromActive(recipe, [])` call. Creation adds the asset, first instance, and `object:<instanceId>` state inside that one recipe. Only WS1's ordered runtime-bundle publication updates read-only Object stores/selectors; no feature publishes speculative state. Post-publication finalization or post-finalization token-consumption/handle-activation failure keeps the new pointer/cache/runtime/read model together and locks interaction in `recovery-required` until reload rather than rolling back one surface.

**Tech Stack:** React 19, TypeScript 6, Three.js 0.185.1, Zustand 5, Dexie 4, fflate 0.8, Vitest 4, Testing Library 16, Playwright 1.61.

## Global Constraints

- Hard precondition: WS1 `project-v3-foundation` must be complete. It is the sole owner of Project schema declarations, v1/v2-to-v3 migration, validation, commit/recovery, and `.wdtwin` codec branching. If `CurrentProjectSnapshot` is not v3 or lacks the frozen types below, stop and complete WS1; this plan must not edit `src/domain/project/project.ts`, any Project migration, or `src/features/project/project-codec.ts`.
- Execute against the landed WS6 Stage A Mode shell. WS4 delivers controlled feature components and a handoff; WS6 Stage B owns final BUILD placement and browser acceptance.
- Tasks 1-2 may run in parallel with WS3 domain work. Before Task 3 edits the shared Project runtime bridge, land WS3 Task 4 first, rebase on that commit, and then add primitive preparation without rewriting Job capture/commit behavior.
- Consume exactly these frozen asset branches: Box `{ sourceKind: 'box', dimensionsM: [x, y, z], color: '#RRGGBB' }`; Cylinder `{ sourceKind: 'cylinder', radiusM, heightM, color: '#RRGGBB', axis: 'z', radialSegments: 32 }`; STEP uses `sourceKind: 'step'`.
- Only the STEP branch owns `sourceFileName`, `sourceBytes`, `importScale`, `originMode`, or an archive path. A generated primitive must never receive dummy STEP bytes, a fabricated filename, a `.step` ZIP entry, or an import scale.
- This creates external Objects only. It does not alter the one-Robot limit or Robot STEP/link/import rules.
- Supported generated shapes are exactly Box and Cylinder. Sphere, cone, CSG, mesh editing, textures, AI generation, and physics simulation are out of scope.
- Domain validation, persistence, Geometry, and collision units are metres. Box X/Y/Z are each within `[0.001, 10]` m; Cylinder radius is within `[0.0005, 5]` m, height within `[0.001, 10]` m, axis is local +Z, and `radialSegments` is exactly 32. Operator dimension fields use millimetres with three decimals: Box/height `[1.000, 10000.000]` mm and radius `[0.500, 5000.000]` mm.
- Colors are stored canonically as uppercase `#RRGGBB`; alpha and per-face materials are out of scope.
- Collision is geometric only. Box uses the exact local proxy; Cylinder uses the conservative local bounding Box `[radius, radius, height / 2]`.
- Generated primitives add zero STEP bytes but their deterministic triangle, mesh, material, visible-instance, and collision-Box counts remain subject to the frozen Project budgets, including `MAX_OBJECT_ASSETS = 256`, `MAX_OBJECT_INSTANCES = 512`, `MAX_VISIBLE_RENDER_ITEMS = 1024`, and `MAX_SCENE_TRIANGLES = 1_500_000`. Creation that would produce Asset 257 or Instance 513 rejects before preparation/commit/publication.
- Asset fields `dimensionsM`, `radiusM`, `heightM`, `color`, `axis`, and `radialSegments` affect every instance referencing that asset. `ObjectInstanceRecordV3.graspable` defaults to `false` and remains instance-owned.
- A newly generated Instance deterministically starts with `manualNumericStatus: 0`, `statusSource: 'manual'`, `statusOverlayVisible: true`, and `visible: true`; live OPC numeric state is absent.
- WS1 migration must already map every legacy instance to `graspable: false`. This plan verifies that frozen result but does not modify migration code.
- `ProjectExternalEntityTransformStateV3` is the only owner of `manualTransform` and `transformSource`; the canonical binding collection is the only owner of OPC UA transform bindings. Neither field may be duplicated onto `ObjectInstanceRecordV3`.
- `ObjectInstanceRecordV3.manualNumericStatus` is the only durable numeric fallback. An effective OPC UA numeric value, quality, or receipt time is never copied into the Project, DB revision, or archive; switching to Manual restores `manualNumericStatus`.
- Manual Object transforms are canonical MCP-local in this stage and expose no per-Object Manual frame selector. Operator XYZ fields use millimetres with three decimals and RPY fields use degrees with two decimals; persistence/runtime use metres plus normalized Quaternion. World/MCP reference selection belongs only to the separate OPC UA binding, whose default is MCP. UI forms retain hidden full-precision values plus touched flags. Apply converts each touched XYZ/dimension field by exact `/1000` and carries each untouched metre component exactly. If no RPY field is touched, carry the original Quaternion components exactly; if any RPY field is touched, combine edited angles with the hidden full-precision untouched RPY angles and run the canonical degree-to-normalized-Quaternion helper once. Display formatting alone never becomes mutation input.
- Primitive Objects use canonical ID `object:<instanceId>` for selection, status, transform ownership, OPC UA binding, interaction, collision, overlay, and deletion. No primitive-only runtime store is allowed.
- New primitive Asset/Instance IDs use WS1 `createPortableId()` as the production default. Tests may inject `createId`; production code never calls `crypto.randomUUID()` or `Math.random()` directly. Crypto/ID allocation failure before both IDs exist discards the detached candidate and submits no Project mutation.
- Creating an asset, first instance, and canonical entity state is one WS1 byte-free `replaceFromActive(recipe, [])` mutation with no prepared-source groups. Primitive creation/edit/delete never imports `ProjectCommitCoordinator`, constructs source handles, stages source bytes, or writes a derived Object store first.
- Every primitive/Object command has one in-flight state. Pending disables the initiating and conflicting controls; a direct rapid second invocation rejects before a second mutation-service call. Validation, cardinality, preparation, stale revision, pre-publication storage failure, cancellation, or runtime-publication failure with successful WS1 compensation clears pending and leaves the prior active revision, runtime bundle, Object read model, selection, form values, Geometry, proxy, and resources unchanged. Finalization or post-finalization prepared-token consumption/handle activation failure after new runtime publication instead keeps the new publishing/stable pointer, cache, runtime, Geometry, proxy, and Object read model together as applicable, exposes `recovery-required`, locks editing/interaction, and requests reload. Failure to dispose the old runtime after stable finalization is success-with-warning: keep the committed new state, resolve the command, emit the bounded WS1 diagnostic, and retry only old resource cleanup.
- OPC UA remains read-only and polling-based. This plan adds no OPC UA write, method call, Subscription, credentials, or security feature.
- Keep feature UI and styles under `src/features/objects/`; WS6 owns final `App.tsx`/`AppShell.tsx` integration. Use TDD and one focused commit per task.

---

### Task 1: Primitive Draft Contract and Deterministic Proxies

**Files:**
- Create: `src/domain/objects/primitive-object.ts`
- Create: `src/domain/objects/primitive-object.test.ts`

**Interfaces:**
- Produces: `PrimitiveObjectDraft`, `normalizePrimitiveDraft`, `buildPrimitiveAssetFields`, `primitiveCollisionBox`, and `primitiveGeometryStatistics`.
- Consumes: frozen WS1 `BoxObjectAssetRecordV3`, `CylinderObjectAssetRecordV3`, `ProjectCollisionBoxV2`, and `GeometryStatistics`; it does not redefine those types.

Use a local creation draft that maps one-to-one to the frozen fields:

```ts
export type PrimitiveObjectDraft =
  | {
      readonly sourceKind: 'box'
      readonly assetName: string
      readonly instanceName: string
      readonly dimensionsM: readonly [number, number, number]
      readonly color: string
    }
  | {
      readonly sourceKind: 'cylinder'
      readonly assetName: string
      readonly instanceName: string
      readonly radiusM: number
      readonly heightM: number
      readonly color: string
    }

export function buildPrimitiveAssetFields(draft: PrimitiveObjectDraft) {
  return draft.sourceKind === 'box'
    ? { name: draft.assetName, sourceKind: 'box' as const, dimensionsM: draft.dimensionsM, color: draft.color }
    : {
        name: draft.assetName,
        sourceKind: 'cylinder' as const,
        radiusM: draft.radiusM,
        heightM: draft.heightM,
        color: draft.color,
        axis: 'z' as const,
        radialSegments: 32 as const,
      }
}
```

- [ ] **Step 1: Write failing tests** for each inclusive dimension boundary, values outside by `1e-12`, NaN/Infinity, independently empty Asset/Instance names, each name accepting exactly 128 UTF-8 bytes and rejecting 129, lowercase input normalized to uppercase, short/alpha colors rejected, and the exact frozen output fields. Prove `buildPrimitiveAssetFields()` uses only `assetName` while the service maps `instanceName` only to the new Instance.
- [ ] **Step 2: Add proxy tests** proving Box `[2, 4, 6]` yields center `[0, 0, 0]`, half-extents `[1, 2, 3]`, and identity Quaternion; Cylinder radius `0.25`, height `0.8` yields `[0.25, 0.25, 0.4]`, `axis: 'z'`, `radialSegments: 32`, and identity Quaternion.
- [ ] **Step 3: Run** `npm run test:run -- src/domain/objects/primitive-object.test.ts`; expect missing-module RED.
- [ ] **Step 4: Implement** exhaustive draft normalization, collision ID `primitive-body`, Box statistics `{ vertices: 24, triangles: 12, meshes: 1, materials: 1 }`, and 32-segment Cylinder statistics `{ vertices: 196, triangles: 128, meshes: 1, materials: 1 }`.
- [ ] **Step 5: Run** the focused test, `npm run lint`, `npm run build`, and `git diff --check`; expect GREEN.
- [ ] **Step 6: Commit** as `feat: define primitive object creation contract`.

---

### Task 2: Three.js Geometry, Repository Dispatch, and Disposal

**Files:**
- Create: `src/features/objects/primitive-object-geometry.ts`
- Create: `src/features/objects/primitive-object-geometry.test.ts`
- Modify: `src/features/import/imported-geometry-repository.ts`
- Modify: `src/features/import/imported-geometry-repository.test.ts`
- Modify: `src/features/objects/object-equipment-adapter.ts`
- Modify: `src/features/objects/object-equipment-adapter.test.ts`

**Interfaces:**
- Produces: `createPrimitiveImportedAsset(asset): ImportedThreeAsset`, exhaustive `ImportedGeometryRepository.loadObjectAsset(record)` dispatch for all three `sourceKind` values, and adapter propagation of `instance.graspable`.
- Consumes: Task 1 helpers, frozen WS1 records, `BoxGeometry`, `CylinderGeometry`, `MeshStandardMaterial`, and canonical `EquipmentRecord`.

The visual factory must preserve the +Z cylinder convention:

```ts
export function createPrimitiveImportedAsset(
  asset: BoxObjectAssetRecordV3 | CylinderObjectAssetRecordV3,
): ImportedThreeAsset {
  const geometry = asset.sourceKind === 'box'
    ? new BoxGeometry(...asset.dimensionsM)
    : new CylinderGeometry(
        asset.radiusM,
        asset.radiusM,
        asset.heightM,
        asset.radialSegments,
        1,
        false,
      )
  if (asset.sourceKind === 'cylinder') geometry.rotateX(Math.PI / 2)
  // Return one Group/one Mesh and an idempotent disposer.
}
```

- [ ] **Step 1: Write failing geometry tests** asserting one Mesh/material, Box extents within `1e-9`, Cylinder Z extent equals height and X/Y extents equal diameter within `1e-6`, exact canonical material color, persisted proxy equality, and idempotent Geometry/Material disposal.
- [ ] **Step 2: Write failing dispatch tests** proving `sourceKind: 'step'` alone calls OCCT/Worker, Box/Cylinder never do, 100 primitive preparations cause zero parser calls, and disposing a prepared runtime bundle disposes each primitive resource exactly once.
- [ ] **Step 3: Write a failing adapter test** proving both `graspable: false` and `graspable: true` reach the canonical scene/interaction record unchanged and no transform/source field is read from the instance.
- [ ] **Step 4: Run** `npm run test:run -- src/features/objects/primitive-object-geometry.test.ts src/features/import/imported-geometry-repository.test.ts src/features/objects/object-equipment-adapter.test.ts`; expect missing factory/dispatch RED.
- [ ] **Step 5: Implement** exhaustive `switch (asset.sourceKind)` dispatch for WS1 runtime preparation. Return owned, disposable resources without publishing them; only the WS1 bundle-pointer swap may make prepared Geometry active.
- [ ] **Step 6: Run** focused tests, `npm run lint`, and `npm run build`; expect GREEN.
- [ ] **Step 7: Commit** as `feat: render box and cylinder object assets`.

---

### Task 3: Atomic Project Mutation and Failure Recovery

**Files:**
- Create: `src/features/objects/create-primitive-object.ts`
- Create: `src/features/objects/create-primitive-object.test.ts`
- Modify: `src/features/objects/object-asset-store.ts`
- Modify: `src/features/objects/object-asset-store.test.ts`
- Modify: `src/features/project/project-store.ts`
- Modify: `src/features/project/project-store.test.ts`
- Modify: `src/features/project/browser-project-runtime.ts`
- Modify: `src/features/project/browser-project-runtime.test.ts`

**Interfaces:**
- Produces: async `createPrimitiveObject(draft, initialManualState, dependencies)` and one byte-free active-projection recipe containing `asset`, `instance`, and `externalEntityState`.
- Consumes: WS1 `ProjectMutationService.replaceFromActive()`, frozen `ByteFreeWorkcellProjectProjectionV3`, `createPortableId()`, `ObjectAssetRecordV3`, `ObjectInstanceRecordV3`, `ProjectExternalEntityTransformStateV3`, `ProjectOpcUaNumericStatusBindingV3`, `MAX_OBJECT_ASSETS`, `MAX_OBJECT_INSTANCES`, Task 1 normalization, and Task 2 Geometry during WS1 bundle preparation. No WS4 module imports internal `ProjectCommitCoordinator`.

The mutation boundary must be injected and indivisible:

```ts
interface PrimitiveCreationMutation {
  readonly asset: BoxObjectAssetRecordV3 | CylinderObjectAssetRecordV3
  readonly instance: ObjectInstanceRecordV3
  readonly externalEntityState: ProjectExternalEntityTransformStateV3
}

interface PrimitiveInitialManualState {
  readonly manualTransform: SerializableTransform
}

interface PrimitiveCreationDependencies {
  readonly createId?: () => string
  readonly projectMutations: Pick<ProjectMutationService, 'replaceFromActive'>
}
```

`initialManualState` contains only `manualTransform`; it cannot override instance status, source, overlay, visibility, or grasp defaults. The instance starts exactly with `graspable: false`, `manualNumericStatus: 0`, `statusSource: 'manual'`, `statusOverlayVisible: true`, and `visible: true`. `externalEntityState.entityId` is `object:<instance.id>`, owns that initial `manualTransform`, and starts with `transformSource: 'manual'`. Do not copy those transform fields or any effective live numeric value into the instance.

- [ ] **Step 1: Write failing service tests** for validate-before-mutation ordering, exact `asset.name = draft.assetName` and `instance.name = draft.instanceName` mapping, deterministic asset/instance/entity IDs, `graspable: false`, canonical Manual state, exact defaults `manualNumericStatus: 0`, `statusSource: 'manual'`, `statusOverlayVisible: true`, and `visible: true`, absence of effective live numeric Status/quality/time, no binding creation, and exactly one `replaceFromActive()` call. Independently prove Asset/Instance names accept exactly 128 UTF-8 bytes and either 129-byte value rejects before ID allocation or mutation. Inspect the callback result and prove asset, instance, and external entity appear together in one byte-free projection, source groups are exactly `[]`, and the active Project input remains immutable. Run the production default with a `getRandomValues`-only crypto source and assert unique RFC-v4 Asset/Instance IDs. With no portable crypto API, require `PORTABLE_ID_CRYPTO_UNAVAILABLE` before mutation; with an injected `createId` that succeeds for Asset then throws for Instance, require zero mutation-service calls and unchanged Project counts. Starting from 255 Assets/511 Instances accepts one creation at exactly 256/512; starting at either 256 Assets or 512 Instances rejects before recipe/preparation/publication.
- [ ] **Step 2: Add mutation-service integration fault tests** at primitive Geometry preparation, revision write, atomic publishing-pointer write, bundle publication, finalization, post-finalization token consumption/handle activation, and old-bundle disposal. For every pre-publication failure and runtime-publication failure with successful compensation, assert Project asset/instance/entity deltas `[0, 0, 0]`, no read-model update, staged resources disposed once, and the prior active revision/bundle/selection remains. For finalization or token-consumption/handle-activation failure after publication, assert deltas `[+1, +1, +1]` remain together in the new pointer/cache/runtime/read model, interaction enters `recovery-required`, and reload is requested with zero feature-local rollback. For old-bundle disposal failure, assert the command resolves success, keeps the new committed/runtime state, emits one bounded cleanup diagnostic, and queues only old resource disposal. Hold preparation and double-submit Create; prove pending is visible, only one service call occurs, and no provisional Asset/Instance/Geometry appears.
- [ ] **Step 3: Add store contract tests** proving the derived Object cache accepts every frozen `sourceKind`, exposes no public create/edit/delete actions, never reads `sourceBytes` from a primitive, changes only from WS1's ordered runtime-bundle publication, and emits exactly one notification per publication. If finalization later fails, it retains that new projection under the shared recovery lock rather than reverting locally.
- [ ] **Step 4: Run** `npm run test:run -- src/features/objects/create-primitive-object.test.ts src/features/objects/object-asset-store.test.ts src/features/project/project-store.test.ts src/features/project/browser-project-runtime.test.ts`; expect missing atomic service/runtime dispatch RED.
- [ ] **Step 5: Implement** the service as validate dimensions/count budgets -> allocate both IDs into a detached candidate -> construct all three records -> call `dependencies.projectMutations.replaceFromActive(recipe, [])` exactly once. The recipe rechecks `MAX_OBJECT_ASSETS`/`MAX_OBJECT_INSTANCES` against its current projection, appends asset/instance/entity atomically, and contains no source bytes or handles. Default omitted `dependencies.createId` to WS1 `createPortableId`; never publish the Asset after only one ID succeeds. Wire Task 2 into WS1 `prepare()`; leave durable commit, publication, compensation, and disposal inside WS1. Object stores remain published read models.
- [ ] **Step 6: Run** focused tests, `npm run lint`, `npm run build`, and `git diff --check`; expect GREEN.
- [ ] **Step 7: Commit** as `feat: create primitive objects atomically`.

---

### Task 4: Feature UI for Creation and Editing

**Files:**
- Create: `src/features/objects/PrimitiveObjectDialog.tsx`
- Create: `src/features/objects/PrimitiveObjectDialog.test.tsx`
- Create: `src/features/objects/PrimitiveObjectDialog.css`
- Create: `src/features/objects/PrimitiveObjectInspector.tsx`
- Create: `src/features/objects/PrimitiveObjectInspector.test.tsx`
- Create: `src/features/objects/primitive-object-integration.ts`
- Create: `src/features/objects/primitive-object-integration.test.ts`

**Interfaces:**
- Produces: controlled `PrimitiveObjectDialog`, millimetre/degree form drafts, asset-level geometry/color editor, instance-level `graspable` editor, and async `PrimitiveObjectIntegration` callbacks for WS6 shell wiring.
- Consumes: Task 3 service, canonical external-entity Manual pose/status/OPC UA command/selector interfaces, WS1 `ProjectMutationService`, published Object read-model selectors, and affected-instance counts from the Object Asset store. Every Apply/Delete path is one byte-free `replaceFromActive(recipe, [])`; no component mutates the read model directly.

```ts
export interface PrimitiveObjectIntegration {
  readonly openCreateDialog: () => void
  readonly closeCreateDialog: () => void
  readonly createDialogOpen: boolean
  readonly pendingCommand: 'create' | 'asset-edit' | 'instance-edit' | 'transform-edit' | 'delete' | null
  readonly create: (draft: PrimitiveObjectFormDraft) => Promise<void>
  readonly updateAsset: (assetId: string, draft: PrimitiveAssetFormDraft) => Promise<void>
  readonly updateInstance: (instanceId: string, patch: PrimitiveInstanceFormPatch) => Promise<void>
  readonly updateManualTransform: (entityId: string, draft: ManualTransformFormDraft) => Promise<void>
  readonly deleteObject: (instanceId: string) => Promise<void>
}
```

- [ ] **Step 1: Write failing dialog tests** for separate `Asset name` and `Instance name` fields, Instance name initially mirroring Asset name until the operator first touches Instance name and then remaining independent, Box/Cylinder switching, exact engineering-field boundaries Box/height `1.000..10000.000` mm and radius `0.500..5000.000` mm, three-decimal formatting, exact mm-to-m conversion on touched values, uppercase color preview, Cylinder +Z/32-segment read-only labels, Create disabled while pending, rapid double Create producing one command call, Cancel with zero mutations, and one successful Create call carrying both explicit names. Assert no file chooser, source filename, or import-scale field appears. Open an asset containing metre precision beyond three displayed decimals and Apply without touching dimensions; assert the exact original `dimensionsM`/`radiusM`/`heightM` values survive rather than being reconstructed from formatted text.
- [ ] **Step 1a: Prove UTF-8 name boundaries before mutation.** Use `TextEncoder` multibyte fixtures to prove generated Asset and Instance names each accept exactly 128 UTF-8 bytes and reject 129 before ID allocation, Geometry preparation, or `ProjectMutationService` invocation. Associate each error with its field, restore focus from the summary, and never truncate; WS1 domain validation remains final authority.
- [ ] **Step 2: Write failing Inspector tests** proving `assetName`/dimensions/color update the shared asset and show the exact affected-instance count; `instanceName`/`graspable` change only the selected instance; default graspability is false; and every edit awaits exactly one byte-free mutation-service call with empty source groups. Hold a command and prove pending disables Apply/Delete and a second invoke makes no second call. For validation/pre-publication/compensated runtime-publication failure, the previous asset/instance/read model/proxy/visual/form values remain visible and focus/error recovery is deterministic. For post-publication finalization or post-finalization token-consumption/handle-activation failure, the new read model/proxy/visual remain consistent, a recovery/reload message is shown, and editing stays locked. Old-bundle disposal failure resolves success with the new values and a bounded cleanup warning.
- [ ] **Step 3: Add ownership and engineering-unit tests** proving Manual MCP-local XYZ/RPY reads/writes only canonical external-entity state and renders no Manual frame selector. XYZ displays millimetres to three decimals, RPY degrees to two decimals, and touched XYZ uses exact `/1000`. Opening and applying with no touched XYZ/dimension field preserves each exact stored metre component; with no touched RPY field it preserves the exact original Quaternion. If one RPY field is touched, combine it with hidden full-precision values for the two untouched angles and run the shared degree-to-normalized-Quaternion conversion once, proving rounded display text was never reparsed. `manualNumericStatus`, status source, and overlay visibility edit the instance through one async byte-free Project recipe; an effective OPC UA numeric Status never mutates that fallback; switching numeric source to Manual restores it; `transformSource: 'opcua'` makes Manual/grasp controls read-only; and the integration contract emits canonical `object:<instanceId>` for the shared WS5/WS6 binding panel without implementing that panel in WS4.
- [ ] **Step 4: Run** `npm run test:run -- src/features/objects/PrimitiveObjectDialog.test.tsx src/features/objects/PrimitiveObjectInspector.test.tsx src/features/objects/primitive-object-integration.test.ts`; expect missing feature components RED.
- [ ] **Step 5: Implement** feature-local components/styles and the integration contract. Define form-only `PrimitiveObjectFormDraft` (`assetName`, `instanceName`, `instanceNameTouched`, `dimensionsMm`, `radiusMm`, `heightMm`), asset-edit-only `PrimitiveAssetFormDraft` (`assetName` plus geometry/color fields), and `ManualTransformFormDraft` (`xMm`, `yMm`, `zMm`, `rollDeg`, `pitchDeg`, `yawDeg`) separately from metre/Quaternion domain records, with hidden full-precision values and touched-field tracking. Before the Instance-name field is touched, mirror Asset-name edits into it; after first touch, never overwrite it. Submission always carries two strings and maps them exactly to Asset and Instance names. Carry untouched metre fields exactly; carry the original Quaternion exactly when rotation is untouched, otherwise recompute it once from the edited angle plus full-precision untouched angles. Route create/edit/status/transform/delete through async Project mutation commands; never optimistically patch a Zustand Object store. Do not modify `App.tsx`, `AppShell.tsx`, or global shell CSS in this task.
- [ ] **Step 6: Run** focused tests, `npm run lint`, and `npm run build`; expect GREEN.
- [ ] **Step 7: Commit** as `feat: add primitive object feature controls`.

---

### Task 5: Feature Handoff, Round-Trip Proof, and WS4 Release Gate

**Files:**
- Create: `src/features/objects/primitive-object-roundtrip.test.ts`
- Create: `src/features/objects/primitive-object-scene-integration.test.ts`
- Create: `docs/integration/primitive-objects-ws6-handoff.md`
- Create: `docs/operator/primitive-objects.md`
- Create: `docs/verification/primitive-objects-verification.md`
- Modify: `src/features/objects/primitive-object-integration.test.ts`
- Modify: `src/features/objects/object-equipment-adapter.test.ts`
- Modify: `docs/superpowers/plans/2026-07-13-primitive-objects.md`

**Interfaces:**
- Produces: a frozen WS6 integration handoff plus unit/component/runtime proof that primitives share Project save/load, canonical Manual transform and `manualNumericStatus` fallback, transient OPC Status state, interaction eligibility, deletion, overlay data, and geometric collision adapters.
- Consumes: Tasks 1-4 public integration contract, WS1 public codec/runtime, canonical external-entity removal, and in-memory Geometry/collision registries. It does not own shell wiring or a browser workflow.

- [ ] **Step 1: Write a failing round-trip test** that creates a Box and Cylinder through Task 3, supplies a live OPC UA numeric sample, captures/encodes/decodes/rebuilds through WS1 public APIs, and checks every frozen primitive field, `graspable`, unchanged `manualNumericStatus`, canonical Manual state, source ownership, binding, proxy, visibility, and overlay configuration. Assert the effective live value/quality/time are absent after reload and Manual mode restores the fallback. Inspect the ZIP with `unzipSync` and assert the two primitives add zero `objects/assets/*.step` entries. Add two semantic STEP Object Assets with identical bytes plus one with different bytes and assert exactly two unique-hash STEP blobs.
- [ ] **Step 2: Write a failing scene-integration test** proving both proxies enter the Geometry registry, `graspable: false` blocks participation while `true` enables it, durable `manualNumericStatus` plus transient effective OPC state reach the correct overlay/adapter selectors without cross-writing, and primitive Geometry never enters OCCT.
- [ ] **Step 3: Add deletion proof** through one canonical byte-free `replaceFromActive(recipe, [])`: instance, unreferenced asset, external-entity state, status/transform bindings, live telemetry, selection, interaction participant, overlay data, and collision registry entry all disappear in one committed revision and one runtime publication. While pending the old published object remains intact. Inject revision-write and compensated bundle-publication failures and assert the complete pre-delete revision/snapshot/bundle/read model remains active, with zero partial removal and no second call on rapid double Delete. Inject finalization failure after delete publication and prove the complete new deleted-state pointer/cache/runtime/read model remains under `recovery-required` with no partial feature rollback.
- [ ] **Step 4: Write** `docs/integration/primitive-objects-ws6-handoff.md` with the exact `PrimitiveObjectIntegration` import, controlled dialog mount, Add-menu labels `Import STEP Object`, `Create Box`, and `Create Cylinder`, preselection of the matching primitive branch for the last two actions, selected-entity Inspector slot, engineering-display units (XYZ/dimensions mm with three decimals, RPY degrees with two), pending/error/focus propagation, one-command/one-publication semantics, and the browser scenarios WS6 must own. Include exact 256/512 boundary, commit failure, double-submit, untouched-precision, and save/reload cases. Do not edit `App.tsx`, `AppShell.tsx`, global shell CSS, or Playwright specs here.
- [ ] **Step 5: Run** `npm run test:run -- src/features/objects src/features/project src/features/collision src/features/interaction`; expect RED before final feature integration, then implement only WS4-owned gaps until GREEN.
- [ ] **Step 6: Document** metre/Quaternion domain units, mm/degree engineering display and exact touched-field conversions, untouched-precision preservation, shared-asset edits, +Z Cylinder axis, 32 segments, conservative proxy, default `graspable: false`, canonical MCP-local Manual coordinates with no Manual frame selector, durable `manualNumericStatus` versus transient effective OPC Status, OPC World/MCP reference ownership, unique-hash STEP blob sharing, one byte-free mutation per command, pending/failure behavior, round-trip behavior, deletion, and the absence of generated STEP data.
- [ ] **Step 7: Run final WS4 gates:** `npm run verify`, `npm audit --audit-level=high`, `git diff --check`, and `rg -n "T[B]D|T[O]DO|F[I]XME|place[h]older" src/features/objects src/domain/objects docs/integration/primitive-objects-ws6-handoff.md docs/operator/primitive-objects.md`. Resolve every feature/doc hit.
- [ ] **Step 8: Record** commands, test counts, build result, archive entry listing, proxy values, disposal counts, and the exact WS6 handoff revision in `docs/verification/primitive-objects-verification.md`.
- [ ] **Step 9: Commit** as `docs: verify primitive object workflow`.

## Quantitative Acceptance Criteria

1. The UI exposes exactly two generated geometry types: Box and Cylinder.
2. Domain values Box dimensions `0.001` and `10` m, Cylinder radius `0.0005` and `5` m, and height `0.001` and `10` m are accepted; each minimum minus `1e-12` and each maximum plus `1e-12` is rejected. UI fields expose the equivalent `[1.000, 10000.000]` mm / `[0.500, 5000.000]` mm ranges and convert touched values by exact `/1000`.
3. A `[2, 4, 6]` m Box persists proxy half-extents `[1, 2, 3]`; a radius `0.25` m, height `0.8` m Cylinder persists `[0.25, 0.25, 0.4]`, `axis: 'z'`, and `radialSegments: 32`.
4. One successful creation submits exactly one byte-free `replaceFromActive(recipe, [])`, changes committed Project counts by exactly `[+1 asset, +1 instance, +1 canonical entity state]`, creates one durable revision, and publishes one runtime/read-model update. Validation, preparation, pre-publication storage, stale-revision, cancellation, or runtime-publication failure with successful compensation changes no active revision, snapshot count, runtime bundle pointer, read model, selection, form value, or Geometry resource. Post-publication finalization or post-finalization token-consumption/handle-activation failure keeps all new surfaces consistent under `recovery-required`; old-bundle disposal failure keeps the new state and resolves success with a warning.
5. New and migrated instances default to `graspable: false`; a new generated Instance also starts with Manual numeric fallback `0`, Manual status source, visible overlay, and visible Geometry. Changing one instance never changes another instance of the same asset.
6. A Project with two primitives and no imported Object STEP has zero `objects/assets/*.step` ZIP entries. In a mixed Project, STEP Object Assets with byte-identical source content share one blob and different content produces a different blob: the archive has exactly one entry per unique STEP content hash, while each Asset remains one semantic whole-source record.
7. Export/import preserves primitive parameters, color, exact derived proxy/statistics, instance fields, canonical MCP-local Manual state, `manualNumericStatus`, source ownership, canonical `object:<instanceId>` numeric Status Binding, and Transform binding/reference exactly; effective live numeric value/quality/time are absent, Manual mode restores the fallback, transform components are within `1e-9`, and no Manual frame field exists. XYZ/dimensions display as mm with three decimals and RPY as degrees with two. Untouched metre fields survive exactly; an entirely untouched rotation preserves its original Quaternion exactly, while a touched RPY field is combined with hidden full-precision untouched angles rather than rounded display text.
8. Loading/deleting 100 primitives invokes OCCT zero times and leaves zero undisposed primitive Geometry/Material resources.
9. Primitive statistics contribute 12 Box triangles and 128 Cylinder triangles per visible instance to the 1,500,000-triangle scene limit; generated source bytes contribute exactly zero to the STEP byte budget.
10. Primitive OPC UA behavior uses the canonical read-only entity path and introduces zero write, method-call, or Subscription calls.
11. `npm run verify`, the focused WS4 feature/runtime suites, the high-severity audit gate, and `git diff --check` pass; final Add-menu/Inspector browser workflow and Playwright coverage are explicit WS6 acceptance work.
12. Box/Cylinder production creation defaults to WS1 `createPortableId`; a getRandomValues-only source creates unique RFC-v4 Asset/Instance IDs, while unavailable crypto or a throw between allocations causes zero Project mutation-service calls. No direct `crypto.randomUUID()` or `Math.random()` ID path exists.
13. Exactly 256 Object Assets and 512 Object Instances pass validation. A creation that would produce Asset 257 or Instance 513 rejects before preparation/commit/publication, with unchanged active Project/runtime/read model and zero Geometry allocation.
14. Every primitive/Object create, asset edit, instance edit, Manual transform/status edit, and delete is an async byte-free Project recipe with empty prepared-source groups. Success yields one durable revision and one runtime publication; pending blocks a rapid/conflicting second call. Pre-publication or compensated runtime-publication failure restores controls while preserving the old UI/runtime byte-for-byte. Post-publication finalization or post-finalization token-consumption/handle-activation failure preserves the new pointer/cache/runtime/read model, locks controls under `recovery-required`, and requests reload. Old-bundle disposal failure resolves success with one bounded warning/retry.
15. Derived Object Zustand stores expose zero public mutation commands and update only from WS1's ordered runtime-bundle publication. A later finalization failure keeps that new projection aligned with the recovery-locked runtime. No WS4 module imports or calls `ProjectCommitCoordinator`.
16. `PrimitiveObjectDraft` and the creation UI carry separate `assetName` and `instanceName`; success maps them exactly to `asset.name` and `instance.name`. The Instance name mirrors Asset name only until its field is first touched. Each name independently accepts exactly 128 UTF-8 bytes and rejects 129 before ID allocation, Geometry preparation, or Project mutation, with no truncation and deterministic field focus.

## Self-Review

- Spec coverage: frozen source tags, exact/conservative proxies, atomic Project mutation, dimensions, color, default graspability, canonical Manual state, durable `manualNumericStatus` versus transient OPC Status, OPC UA binding, persistence, deletion, and unique-hash honest archives each have an owning task and test.
- Workstream ownership: WS1 alone owns schema/migration/codec; WS4 owns the primitive domain, Geometry, service, feature UI, round-trip contract tests, and handoff document; the separate WS6 plan owns shell wiring and cross-feature browser/E2E integration.
- Scope: Robot import, additional shapes, physics, CSG, textures, AI, OPC UA writes, and subscriptions remain excluded.
- Placeholder scan: steps provide concrete paths, commands, limits, failure behavior, and expected results; the final scan catches unfinished markers without matching this sentence.
- Type consistency: every layer consumes WS1 `createPortableId`, `ProjectMutationService`, the same deeply readonly `ObjectAssetRecordV3.sourceKind` union, `ObjectInstanceRecordV3.graspable`, `ObjectInstanceRecordV3.manualNumericStatus`, `ProjectOpcUaNumericStatusBindingV3`, and canonical external-entity transform state without duplicating ownership. UI mm/degree form drafts remain separate from metre/Quaternion domain records.
- Data honesty: only `sourceKind: 'step'` can own bytes or an archive path; generated branches reconstruct exclusively from frozen typed parameters.
