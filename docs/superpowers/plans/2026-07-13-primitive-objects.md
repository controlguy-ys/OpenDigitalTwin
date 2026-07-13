# Primitive Objects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator create, configure, save, reload, and delete lightweight Box and Cylinder external objects without pretending that generated geometry came from a STEP file.

**Architecture:** Consume the Project v3 `ObjectAssetRecordV3` discriminated union frozen by workstream WS1. Generate one Three.js mesh and one deterministic collision Box from typed primitive parameters; keep dimensions/color on the reusable asset, `graspable` and numeric-status presentation on the instance, Manual fallback/transform source in canonical external-entity state, and OPC UA bindings in the separate frozen Project binding collection. Submit the asset, first instance, and `object:<instanceId>` state as one next-snapshot mutation to the WS1 commit coordinator; its prepare/publish protocol builds and atomically swaps the complete derived runtime bundle.

**Tech Stack:** React 19, TypeScript 6, Three.js 0.185.1, Zustand 5, Dexie 4, fflate 0.8, Vitest 4, Testing Library 16, Playwright 1.61.

## Global Constraints

- Hard precondition: WS1 `project-v3-foundation` must be complete. It is the sole owner of Project schema declarations, v1/v2-to-v3 migration, validation, commit/recovery, and `.wdtwin` codec branching. If `CurrentProjectSnapshot` is not v3 or lacks the frozen types below, stop and complete WS1; this plan must not edit `src/domain/project/project.ts`, any Project migration, or `src/features/project/project-codec.ts`.
- Execute against the landed WS6 Stage A Mode shell. WS4 delivers controlled feature components and a handoff; WS6 Stage B owns final BUILD placement and browser acceptance.
- Tasks 1-2 may run in parallel with WS3 domain work. Before Task 3 edits the shared Project runtime bridge, land WS3 Task 4 first, rebase on that commit, and then add primitive preparation without rewriting Job capture/commit behavior.
- Consume exactly these frozen asset branches: Box `{ sourceKind: 'box', dimensionsM: [x, y, z], color: '#RRGGBB' }`; Cylinder `{ sourceKind: 'cylinder', radiusM, heightM, color: '#RRGGBB', axis: 'z', radialSegments: 32 }`; STEP uses `sourceKind: 'step'`.
- Only the STEP branch owns `sourceFileName`, `sourceBytes`, `importScale`, `originMode`, or an archive path. A generated primitive must never receive dummy STEP bytes, a fabricated filename, a `.step` ZIP entry, or an import scale.
- This creates external Objects only. It does not alter the one-Robot limit or Robot STEP/link/import rules.
- Supported generated shapes are exactly Box and Cylinder. Sphere, cone, CSG, mesh editing, textures, AI generation, and physics simulation are out of scope.
- Units are meters. Box X/Y/Z are each within `[0.001, 10]`; Cylinder radius is within `[0.0005, 5]`, height within `[0.001, 10]`, axis is local +Z, and `radialSegments` is exactly 32.
- Colors are stored canonically as uppercase `#RRGGBB`; alpha and per-face materials are out of scope.
- Collision is geometric only. Box uses the exact local proxy; Cylinder uses the conservative local bounding Box `[radius, radius, height / 2]`.
- Generated primitives add zero STEP bytes but their deterministic triangle, mesh, material, visible-instance, and collision-Box counts remain subject to the frozen Project budgets, including `MAX_SCENE_TRIANGLES = 1_500_000`.
- Asset fields `dimensionsM`, `radiusM`, `heightM`, `color`, `axis`, and `radialSegments` affect every instance referencing that asset. `ObjectInstanceRecordV3.graspable` defaults to `false` and remains instance-owned.
- WS1 migration must already map every legacy instance to `graspable: false`. This plan verifies that frozen result but does not modify migration code.
- `ProjectExternalEntityTransformStateV3` is the only owner of `manualTransform` and `transformSource`; the canonical binding collection is the only owner of OPC UA transform bindings. Neither field may be duplicated onto `ObjectInstanceRecordV3`.
- Manual Object transforms are canonical MCP-local XYZRPY in this stage and expose no per-Object Manual frame selector. World/MCP reference selection belongs only to the separate OPC UA binding, whose default is MCP.
- Primitive Objects use canonical ID `object:<instanceId>` for selection, status, transform ownership, OPC UA binding, interaction, collision, overlay, and deletion. No primitive-only runtime store is allowed.
- Creating an asset, first instance, and canonical entity state is one WS1 Project replacement mutation. Validation, bundle preparation, or commit failure leaves all persistent counts unchanged; the WS1 coordinator retains the old bundle and disposes staged Three.js resources.
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
      readonly name: string
      readonly dimensionsM: readonly [number, number, number]
      readonly color: string
    }
  | {
      readonly sourceKind: 'cylinder'
      readonly name: string
      readonly radiusM: number
      readonly heightM: number
      readonly color: string
    }

export function buildPrimitiveAssetFields(draft: PrimitiveObjectDraft) {
  return draft.sourceKind === 'box'
    ? { sourceKind: 'box' as const, dimensionsM: draft.dimensionsM, color: draft.color }
    : {
        sourceKind: 'cylinder' as const,
        radiusM: draft.radiusM,
        heightM: draft.heightM,
        color: draft.color,
        axis: 'z' as const,
        radialSegments: 32 as const,
      }
}
```

- [ ] **Step 1: Write failing tests** for each inclusive dimension boundary, values outside by `1e-12`, NaN/Infinity, empty names, lowercase input normalized to uppercase, short/alpha colors rejected, and the exact frozen output fields.
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
- Produces: `createPrimitiveObject(draft, initialState, dependencies)` and one next-snapshot mutation containing `asset`, `instance`, and `externalEntityState`.
- Consumes: WS1 `ProjectCommitCoordinator.replace(nextSnapshot)`, `ObjectAssetRecordV3`, `ObjectInstanceRecordV3`, `ProjectExternalEntityTransformStateV3`, Task 1 normalization, and Task 2 Geometry during WS1 bundle preparation.

The mutation boundary must be injected and indivisible:

```ts
interface PrimitiveCreationMutation {
  readonly asset: BoxObjectAssetRecordV3 | CylinderObjectAssetRecordV3
  readonly instance: ObjectInstanceRecordV3
  readonly externalEntityState: ProjectExternalEntityTransformStateV3
}

interface PrimitiveCreationDependencies {
  readonly createId: () => string
  readonly commitProjectMutation: (mutation: PrimitiveCreationMutation) => Promise<void>
}
```

The instance starts with `graspable: false`; `externalEntityState.entityId` is `object:<instance.id>`, owns the initial `manualTransform`, and starts with `transformSource: 'manual'`. Do not copy those transform fields into the instance.

- [ ] **Step 1: Write failing service tests** for validate-before-commit ordering, deterministic asset/instance/entity IDs, `graspable: false`, canonical Manual state, default numeric status/overlay/visibility, no binding creation, and exactly one submitted Project mutation.
- [ ] **Step 2: Add coordinator integration failures** at primitive Geometry preparation, revision write, active-pointer compare-and-swap, and bundle publication. Assert each changes Project asset/instance/entity counts by `[0, 0, 0]`; the coordinator disposes staged resources once and retains the prior active revision/bundle.
- [ ] **Step 3: Add store contract tests** proving the derived Object cache accepts every frozen `sourceKind`, never reads `sourceBytes` from a primitive, and rebuilds solely from the committed WS1 Project revision.
- [ ] **Step 4: Run** `npm run test:run -- src/features/objects/create-primitive-object.test.ts src/features/objects/object-asset-store.test.ts src/features/project/project-store.test.ts src/features/project/browser-project-runtime.test.ts`; expect missing atomic service/runtime dispatch RED.
- [ ] **Step 5: Implement** the service as validate -> construct records -> submit one next-snapshot mutation. Wire Task 2 into WS1 `prepare()`; leave staging, pointer replacement, publication, compensation, and disposal exclusively to the coordinator.
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
- Produces: controlled `PrimitiveObjectDialog`, asset-level geometry/color editor, instance-level `graspable` editor, and `PrimitiveObjectIntegration` callbacks for WS6 shell wiring.
- Consumes: Task 3 service, canonical external-entity Manual pose/status/OPC UA command/selector interfaces, WS1 mutation gate, and affected-instance counts from the Object Asset store.

```ts
export interface PrimitiveObjectIntegration {
  readonly openCreateDialog: () => void
  readonly closeCreateDialog: () => void
  readonly createDialogOpen: boolean
  readonly create: (draft: PrimitiveObjectDraft) => Promise<void>
}
```

- [ ] **Step 1: Write failing dialog tests** for Box/Cylinder switching, exact boundary errors, uppercase color preview, Cylinder +Z/32-segment read-only labels, Create disabled during commit, Cancel with zero mutations, and one successful Create call. Assert no file chooser, source filename, or import-scale field appears.
- [ ] **Step 2: Write failing Inspector tests** proving dimensions/color update the shared asset and show the exact affected-instance count; `graspable` changes only the selected instance; default is false; geometry edits submit one next-snapshot mutation; and failed WS1 preparation/commit preserves the previous asset, proxy, and visual.
- [ ] **Step 3: Add ownership tests** proving Manual MCP-local XYZ/RPY reads/writes only canonical external-entity state and renders no Manual frame selector; numeric status, status source, and overlay visibility edit the instance through one Project mutation; `transformSource: 'opcua'` makes Manual/grasp controls read-only; and the integration contract emits canonical `object:<instanceId>` for the shared WS5/WS6 binding panel without implementing that panel in WS4.
- [ ] **Step 4: Run** `npm run test:run -- src/features/objects/PrimitiveObjectDialog.test.tsx src/features/objects/PrimitiveObjectInspector.test.tsx src/features/objects/primitive-object-integration.test.ts`; expect missing feature components RED.
- [ ] **Step 5: Implement** feature-local components/styles and the integration contract. Do not modify `App.tsx`, `AppShell.tsx`, or global shell CSS in this task.
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
- Produces: a frozen WS6 integration handoff plus unit/component/runtime proof that primitives share Project save/load, canonical Manual/status/OPC state, interaction eligibility, deletion, overlay data, and geometric collision adapters.
- Consumes: Tasks 1-4 public integration contract, WS1 public codec/runtime, canonical external-entity removal, and in-memory Geometry/collision registries. It does not own shell wiring or a browser workflow.

- [ ] **Step 1: Write a failing round-trip test** that creates a Box and Cylinder through Task 3, captures/encodes/decodes/rebuilds through WS1 public APIs, and checks every frozen primitive field, `graspable`, numeric status, canonical Manual state, source ownership, binding, proxy, visibility, and overlay. Inspect the ZIP with `unzipSync` and assert the two primitives add zero `objects/assets/*.step` entries.
- [ ] **Step 2: Write a failing scene-integration test** proving both proxies enter the Geometry registry, `graspable: false` blocks participation while `true` enables it, canonical numeric/OPC state reaches overlay/adapter selectors, and primitive Geometry never enters OCCT.
- [ ] **Step 3: Add deletion proof** through the canonical removal function: instance, unreferenced asset, external-entity state, status/transform bindings, live telemetry, selection, interaction participant, overlay data, and collision registry entry all disappear in one committed revision. Inject revision-write and bundle-publication failures and assert the complete pre-delete snapshot/bundle remains active.
- [ ] **Step 4: Write** `docs/integration/primitive-objects-ws6-handoff.md` with the exact `PrimitiveObjectIntegration` import, controlled dialog mount, Add-menu labels `Import STEP Object`, `Create Box`, and `Create Cylinder`, preselection of the matching primitive branch for the last two actions, selected-entity Inspector slot, pending/error propagation, and the browser scenarios WS6 must own. Do not edit `App.tsx`, `AppShell.tsx`, global shell CSS, or Playwright specs here.
- [ ] **Step 5: Run** `npm run test:run -- src/features/objects src/features/project src/features/collision src/features/interaction`; expect RED before final feature integration, then implement only WS4-owned gaps until GREEN.
- [ ] **Step 6: Document** dimensions, units, shared-asset edits, +Z Cylinder axis, 32 segments, conservative proxy, default `graspable: false`, canonical MCP-local Manual coordinates with no Manual frame selector, OPC World/MCP reference ownership, round-trip behavior, deletion, and the absence of generated STEP data.
- [ ] **Step 7: Run final WS4 gates:** `npm run verify`, `npm audit --audit-level=high`, `git diff --check`, and `rg -n "T[B]D|T[O]DO|F[I]XME|place[h]older" src/features/objects src/domain/objects docs/integration/primitive-objects-ws6-handoff.md docs/operator/primitive-objects.md`. Resolve every feature/doc hit.
- [ ] **Step 8: Record** commands, test counts, build result, archive entry listing, proxy values, disposal counts, and the exact WS6 handoff revision in `docs/verification/primitive-objects-verification.md`.
- [ ] **Step 9: Commit** as `docs: verify primitive object workflow`.

## Quantitative Acceptance Criteria

1. The UI exposes exactly two generated geometry types: Box and Cylinder.
2. Box dimensions `0.001` and `10` m, Cylinder radius `0.0005` and `5` m, and height `0.001` and `10` m are accepted; each minimum minus `1e-12` and each maximum plus `1e-12` is rejected.
3. A `[2, 4, 6]` m Box persists proxy half-extents `[1, 2, 3]`; a radius `0.25` m, height `0.8` m Cylinder persists `[0.25, 0.25, 0.4]`, `axis: 'z'`, and `radialSegments: 32`.
4. One successful creation changes committed Project counts by exactly `[+1 asset, +1 instance, +1 canonical entity state]`; every injected create/delete failure changes no active snapshot count or runtime bundle pointer and publishes zero partial Geometry resources.
5. New and migrated instances default to `graspable: false`; changing one instance never changes another instance of the same asset.
6. A Project with two primitives and no imported Object STEP has zero `objects/assets/*.step` ZIP entries; a mixed Project has exactly one entry per `sourceKind: 'step'` asset.
7. Export/import preserves primitive parameters, color, proxy, instance fields, canonical MCP-local Manual state, status, source ownership, and OPC binding/reference exactly; transform components are within `1e-9`, and no Manual frame field exists.
8. Loading/deleting 100 primitives invokes OCCT zero times and leaves zero undisposed primitive Geometry/Material resources.
9. Primitive statistics contribute 12 Box triangles and 128 Cylinder triangles per visible instance to the 1,500,000-triangle scene limit; generated source bytes contribute exactly zero to the STEP byte budget.
10. Primitive OPC UA behavior uses the canonical read-only entity path and introduces zero write, method-call, or Subscription calls.
11. `npm run verify`, the focused WS4 feature/runtime suites, the high-severity audit gate, and `git diff --check` pass; final Add-menu/Inspector browser workflow and Playwright coverage are explicit WS6 acceptance work.

## Self-Review

- Spec coverage: frozen source tags, exact/conservative proxies, atomic Project mutation, dimensions, color, default graspability, canonical Manual state, status, OPC UA binding, persistence, deletion, and honest archives each have an owning task and test.
- Workstream ownership: WS1 alone owns schema/migration/codec; WS4 owns the primitive domain, Geometry, service, feature UI, round-trip contract tests, and handoff document; the separate WS6 plan owns shell wiring and cross-feature browser/E2E integration.
- Scope: Robot import, additional shapes, physics, CSG, textures, AI, OPC UA writes, and subscriptions remain excluded.
- Placeholder scan: steps provide concrete paths, commands, limits, failure behavior, and expected results; the final scan catches unfinished markers without matching this sentence.
- Type consistency: every layer consumes the same WS1 `ObjectAssetRecordV3.sourceKind` union, `ObjectInstanceRecordV3.graspable`, and canonical external-entity transform state without duplicating ownership.
- Data honesty: only `sourceKind: 'step'` can own bytes or an archive path; generated branches reconstruct exclusively from frozen typed parameters.
