# Portable Workcell Project Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first portable-project vertical slice: separate Robot Link Geometry and reusable Object Assets from their scene instances, persist one active project, and export/import the complete state as a `.wdtwin` archive without corrupting the current scene on failure.

**Architecture:** Introduce versioned project-domain records independent from Three.js objects. Raw STEP bytes and JSON state are stored in IndexedDB and encoded in a ZIP-based `.wdtwin` package; derived Three.js geometry remains a disposable cache. Project load is staged, validated, and committed only after all records and source files pass validation.

**Tech Stack:** React 19, TypeScript 6, Zustand 5, Dexie 4, Three.js 0.185, Vitest 4, fake-indexeddb, fflate 0.8.3.

## Global Constraints

- Keep exactly one active six-axis Robot and `LINK00` through `LINK06`.
- `Import New Robot` requires seven mapped STEP links; partial replacement is a separate operation and never silently fills missing links with CRB geometry.
- The seven-file limit applies only to Robot Import.
- One Object STEP file creates one whole reusable Object Asset; Object Instances reference that Asset.
- Robot STEP limits remain 25 MiB per link and 100 MiB total.
- Object STEP limit is 50 MiB per Asset; project raw STEP total is 256 MiB.
- Reject more than 150,000 triangles per Robot Link, 600,000 for the Robot, 250,000 per Object Asset, or 1,500,000 for the visible Scene.
- Geometry local pose is independent from Joint mechanical origin.
- No multi-Robot, IK, dynamics, automatic Robot assembly splitting, automatic mesh simplification, authentication, certificates, or OPC UA writes.
- Preserve existing user changes and keep all source comments in English.

---

### Task 1: Versioned Project and Asset Contracts

**Files:**
- Create: `src/domain/project/project.ts`
- Create: `src/domain/project/project.test.ts`
- Modify: `src/domain/equipment/equipment.ts`

**Interfaces:**
- Produces: `WorkcellProjectManifestV1`, `RobotLinkGeometryRecordV1`, `ObjectAssetRecordV1`, `ObjectInstanceRecordV1`, `WorkcellProjectSnapshotV1`, `validateWorkcellProjectSnapshot()`.
- Consumes: `SerializableTransform`, `EquipmentStatusSource`, `RobotLinkId`, and existing mechanical/Pose state shapes.

- [x] **Step 1: Write the failing contract tests**

```ts
it('accepts seven Robot links and reusable Object Asset references', () => {
  const snapshot = validProjectSnapshot()
  expect(validateWorkcellProjectSnapshot(snapshot)).toBe(snapshot)
})

it('rejects an eighth Robot link, orphan Object Instance, and duplicate Asset id', () => {
  expect(() => validateWorkcellProjectSnapshot(projectWithEightLinks())).toThrow('seven')
  expect(() => validateWorkcellProjectSnapshot(projectWithOrphanInstance())).toThrow('Object Asset')
  expect(() => validateWorkcellProjectSnapshot(projectWithDuplicateAsset())).toThrow('Duplicate')
})
```

- [x] **Step 2: Verify RED**

Run: `npm run test:run -- src/domain/project/project.test.ts`

Expected: FAIL because `src/domain/project/project.ts` does not exist.

- [x] **Step 3: Implement the minimal versioned records and validator**

```ts
export const WORKCELL_PROJECT_FORMAT = 'WebDigitalTwinProject'
export const WORKCELL_PROJECT_SCHEMA_VERSION = 1

export interface RobotLinkGeometryRecordV1 {
  linkId: RobotLinkId
  sourceFileName: string
  sourceBytes: ArrayBuffer
  localTransform: SerializableTransform
  visible: boolean
  collisionHalfExtents: readonly [number, number, number]
  statistics: GeometryStatistics
}

export interface ObjectAssetRecordV1 {
  id: string
  name: string
  sourceFileName: string
  sourceBytes: ArrayBuffer
  importScale: number
  originMode: 'center' | 'source'
  collisionHalfExtents: readonly [number, number, number]
  statistics: GeometryStatistics
}

export interface ObjectInstanceRecordV1 {
  id: string
  assetId: string
  name: string
  transform: SerializableTransform
  numericStatus: number
  statusSource: EquipmentStatusSource
  statusOverlayVisible: boolean
  visible: boolean
}
```

Validate finite transforms, unique ids, exactly seven unique Robot links for a custom Robot, Asset references, byte totals, and geometry budgets before returning the original snapshot.

- [x] **Step 4: Verify GREEN**

Run: `npm run test:run -- src/domain/project/project.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add src/domain/project src/domain/equipment/equipment.ts
git commit -m "feat: define portable workcell project contracts"
```

### Task 2: Reusable Object Asset Persistence

**Files:**
- Create: `src/features/objects/object-asset-db.ts`
- Create: `src/features/objects/object-asset-store.ts`
- Create: `src/features/objects/object-asset-store.test.ts`
- Modify: `src/features/equipment/equipment-store.ts`
- Modify: `src/features/import/ImportStepDialog.tsx`
- Modify: `src/features/equipment/EquipmentScene.tsx`

**Interfaces:**
- Consumes: `ObjectAssetRecordV1`, `ObjectInstanceRecordV1`, `ImportedGeometryRepository`.
- Produces: `useObjectAssetStore`, `upsertAsset()`, `createInstance()`, `removeInstance()`, `removeAsset()`, `hydrate()`.

- [x] **Step 1: Write failing persistence and sharing tests**

```ts
it('stores one STEP Asset and restores two Instances that reference it', async () => {
  await store.getState().upsertAsset(machineAsset())
  await store.getState().createInstance(machineInstance('machine-01'))
  await store.getState().createInstance(machineInstance('machine-02'))
  await reopened.getState().hydrate()
  expect(reopened.getState().assets).toHaveLength(1)
  expect(reopened.getState().instances).toHaveLength(2)
})

it('refuses to delete an Asset while Instances still reference it', async () => {
  await expect(store.getState().removeAsset('machine')).rejects.toThrow('Instances')
})
```

- [x] **Step 2: Verify RED**

Run: `npm run test:run -- src/features/objects/object-asset-store.test.ts`

Expected: FAIL because the store does not exist.

- [x] **Step 3: Implement Dexie Asset/Instance tables and Zustand actions**

Use a single transaction for Asset and Instance mutations. Clone all `ArrayBuffer` and transform tuples at the store boundary. Keep legacy Equipment records readable through the compatibility path; all new imports use one Asset plus one Instance.

- [x] **Step 4: Route Object Import through Asset creation**

`ImportStepDialog` commits one `ObjectAssetRecordV1`, creates one `ObjectInstanceRecordV1`, and caches geometry by Asset id. `EquipmentScene` renders Instances while resolving their shared Asset geometry.

- [x] **Step 5: Verify GREEN and regression**

Run: `npm run test:run -- src/features/objects src/features/equipment src/features/import`

Expected: all targeted tests PASS.

- [x] **Step 6: Commit**

```powershell
git add src/features/objects src/features/equipment src/features/import
git commit -m "feat: separate reusable object assets and instances"
```

### Task 3: Persistent Robot Link Geometry Configuration

**Files:**
- Create: `src/features/robot/robot-geometry-db.ts`
- Create: `src/features/robot/robot-geometry-store.ts`
- Create: `src/features/robot/robot-geometry-store.test.ts`
- Create: `src/features/robot/RobotGeometryDialog.tsx`
- Create: `src/features/robot/RobotGeometryDialog.test.tsx`
- Modify: `src/features/robot/RobotImportDialog.tsx`
- Modify: `src/features/robot/RobotModel.tsx`
- Modify: `src/features/robot/robot-step-import.ts`

**Interfaces:**
- Consumes: `RobotLinkGeometryRecordV1`, STEP parser, `RobotGeometryRepository`.
- Produces: `useRobotGeometryStore`, seven persisted Link records, geometry-local XYZ/RPY editor.

- [x] **Step 1: Write failing independence and persistence tests**

```ts
it('persists Geometry local pose independently from Joint origin', async () => {
  await store.getState().replaceRobot(sevenRobotLinks())
  await store.getState().setLocalTransform('LINK03', poseAt(0.01, 0, 0))
  useRobotConfigurationStore.getState().updateJoint(2, { origin: [0, 0, 0.8] })
  expect(store.getState().links[3]?.localTransform.position).toEqual([0.01, 0, 0])
})
```

- [x] **Step 2: Verify RED**

Run: `npm run test:run -- src/features/robot/robot-geometry-store.test.ts`

Expected: FAIL because the store does not exist.

- [x] **Step 3: Implement staged seven-link replacement**

Remove the fixed `LINK_WORLD_ORIGINS` subtraction from generic Robot Import. Store each converted mesh under its Link slot and apply the persisted geometry-local transform inside that slot. Reject incomplete new-Robot imports; expose a separate partial replacement action.

- [x] **Step 4: Add the Geometry editor**

Render Link mapping, source filename, XYZ millimetres, RPY degrees, visibility, Box collision half extents, and geometry statistics. Apply changes only after finite-value validation.

- [x] **Step 5: Verify GREEN and Robot regression**

Run: `npm run test:run -- src/features/robot src/domain/robot`

Expected: all targeted tests PASS.

- [x] **Step 6: Commit**

```powershell
git add src/features/robot
git commit -m "feat: persist configurable robot link geometry"
```

### Task 4: `.wdtwin` Archive Codec

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/features/project/project-codec.ts`
- Create: `src/features/project/project-codec.test.ts`

**Interfaces:**
- Consumes: `WorkcellProjectSnapshotV1`.
- Produces: `encodeWorkcellProject(snapshot): Promise<Uint8Array>` and `decodeWorkcellProject(bytes): Promise<WorkcellProjectSnapshotV1>`.

- [x] **Step 1: Install the pinned browser ZIP dependency**

Run: `npm install --save-exact fflate@0.8.3`

- [x] **Step 2: Write failing round-trip and corruption tests**

```ts
it('round-trips JSON records and raw STEP bytes', async () => {
  const encoded = await encodeWorkcellProject(validProjectSnapshot())
  const decoded = await decodeWorkcellProject(encoded)
  expect(semanticSnapshot(decoded)).toEqual(semanticSnapshot(validProjectSnapshot()))
})

it('rejects a corrupt archive without returning partial state', async () => {
  await expect(decodeWorkcellProject(new Uint8Array([1, 2, 3]))).rejects.toThrow('archive')
})
```

- [x] **Step 3: Verify RED**

Run: `npm run test:run -- src/features/project/project-codec.test.ts`

Expected: FAIL because the codec does not exist.

- [x] **Step 4: Implement deterministic ZIP layout**

Encode `manifest.json`, `robot/configuration.json`, `robot/links/LINKxx.step`, `objects/assets.json`, `objects/assets/<id>.step`, `objects/instances.json`, `poses/sequences.json`, and `opcua/bindings.json`. Decode into a temporary snapshot, enforce entry/path/size limits, then call `validateWorkcellProjectSnapshot()`.

- [x] **Step 5: Verify GREEN**

Run: `npm run test:run -- src/features/project/project-codec.test.ts`

Expected: PASS.

- [x] **Step 6: Commit**

```powershell
git add package.json package-lock.json src/features/project
git commit -m "feat: encode portable wdtwin project archives"
```

### Task 5: Atomic Active Project Store

**Files:**
- Create: `src/features/project/project-db.ts`
- Create: `src/features/project/project-store.ts`
- Create: `src/features/project/project-store.test.ts`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: Robot geometry/configuration, Object Asset/Instance, Pose, OPC UA binding snapshots.
- Produces: `useProjectStore`, `newProject()`, `saveActiveProject()`, `exportActiveProject()`, `importProject()`.

- [x] **Step 1: Write failing atomic-load tests**

```ts
it('keeps the active project unchanged when imported geometry staging fails', async () => {
  await store.getState().saveActiveProject(currentProject())
  await expect(store.getState().importProject(brokenProjectBytes())).rejects.toThrow()
  expect(store.getState().activeProjectId).toBe(currentProject().manifest.projectId)
})
```

- [x] **Step 2: Verify RED**

Run: `npm run test:run -- src/features/project/project-store.test.ts`

Expected: FAIL because the store does not exist.

- [x] **Step 3: Implement staged validation and one-transaction commit**

Decode and validate into memory, convert every STEP Asset into temporary repositories, and replace the active IndexedDB project only after all conversions succeed. Dispose staged geometry on failure; dispose old geometry only after commit.

- [x] **Step 4: Verify GREEN**

Run: `npm run test:run -- src/features/project/project-store.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add src/features/project src/app/App.tsx
git commit -m "feat: load and save active projects atomically"
```

### Task 6: Project UI

**Files:**
- Create: `src/features/project/ProjectMenu.tsx`
- Create: `src/features/project/ProjectMenu.test.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: `useProjectStore` actions and dirty/persistence state.
- Produces: New, Save, Export `.wdtwin`, Import `.wdtwin`, and Saved/Unsaved UI.

- [x] **Step 1: Write failing interaction tests**

```tsx
it('exports .wdtwin and imports one selected archive', async () => {
  render(<ProjectMenu store={store} />)
  await user.click(screen.getByRole('button', { name: 'Export project' }))
  expect(exportProject).toHaveBeenCalledOnce()
  await user.upload(screen.getByLabelText('Import project'), projectFile())
  expect(importProject).toHaveBeenCalledOnce()
})
```

- [x] **Step 2: Verify RED**

Run: `npm run test:run -- src/features/project/ProjectMenu.test.tsx`

Expected: FAIL because the component does not exist.

- [x] **Step 3: Implement the compact top-bar Project menu**

Show project name, Saved/Unsaved, New, Save, Export, and Import. Use a hidden file input with `.wdtwin` accept filter and a Blob download for export. Disable mutations during import staging.

- [x] **Step 4: Verify GREEN and App regression**

Run: `npm run test:run -- src/features/project src/app/AppShell.test.tsx`

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add src/features/project src/app src/styles/global.css
git commit -m "feat: add portable project controls"
```

### Task 7: End-to-End Verification and Documentation

**Files:**
- Create: `tests/project-roundtrip.spec.ts`
- Modify: `README.md`
- Modify: `docs/progress/2026-07-13-short-term-mvp-implementation.md`

**Interfaces:**
- Consumes: all project-core features.
- Produces: browser round-trip evidence and operator instructions.

- [x] **Step 1: Add Project round-trip E2E**

The test imports seven deterministic Robot fixtures and one Object Asset, creates two Object Instances, edits one Geometry local pose, exports `.wdtwin`, clears IndexedDB/localStorage, imports the archive, and asserts semantic equality.

- [x] **Step 2: Run full verification**

Run: `npm run verify && npm run test:e2e && npm audit --audit-level=high`

Expected: all tests PASS, CAD reports seven valid links with zero errors and warnings, build exits 0, and audit reports zero high-severity vulnerabilities.

- [x] **Step 3: Update operator documentation**

Document Robot New vs Link Replacement, one-file Object Assets, Geometry vs Mechanical configuration, `.wdtwin` contents, size budgets, atomic rollback, and known exclusions.

- [x] **Step 4: Commit**

```powershell
git add tests README.md docs
git commit -m "test: verify portable project round trips"
```

## Self-Review

- Spec coverage: Robot-only seven-file limit, whole Object STEP Assets, Geometry/Mechanical separation, persistence, `.wdtwin`, atomic rollback, and resource budgets are covered.
- Deliberately separate plans are required for the fixed MCP/Base/Flange/TCP Frame hierarchy and the Docker Compose On-Prem deployment package.
- Placeholder scan: the plan contains no TBD/TODO placeholders.
- Type consistency: project records use V1 suffixes; all stores and the codec consume the same snapshot types.
