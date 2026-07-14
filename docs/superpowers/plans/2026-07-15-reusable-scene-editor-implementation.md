# Reusable Scene Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current single-robot viewer into a reusable, project-persisted scene editor with grouped imported Objects, visibility controls, Robot placement on one optional Linear Axis, discoverable Robot Jobs, explicit mount-contact collision handling, and a minimal set of coordinate-aware viewport controls.

**Architecture:** Finish the Project V3 publication authority first, then store all durable scene edits in one validated `ProjectSceneStateV1` inside the V3 snapshot. Zustand stores become published read models plus transient editor state; every durable command is one atomic `ProjectMutationService.replaceFromActive()` recipe. Scene transforms use MCP as the root, persisted quaternions, and UI-only Z-Y-X Roll/Pitch/Yaw. Rendering, collision, jobs, and viewport overlays derive from the same published scene graph.

**Tech Stack:** React 19, TypeScript 6, Zustand 5, Three.js 0.185, React Three Fiber 9, Dexie 4, Vitest 4, Testing Library, Playwright 1.61, Vite 8.

## Global Constraints

- Implement one reviewable task at a time and keep the worktree green between tasks.
- Do not add a second Robot, variable-DOF Robot, physics engine, Cartesian jog, Follow TCP, target/path editing, or OPC UA control of the Linear Axis in this milestone.
- Do not introduce new `Legacy*` adapters, migrations, or compatibility feature names. Task 0 removes the current V1/V2 browser/archive paths rather than extending them; superseded project formats return a clear unsupported-schema error.
- Persist position in metres and rotation as normalized quaternion `[x, y, z, w]`. Convert UI Roll/Pitch/Yaw using intrinsic Z-Y-X and degrees only at the editor boundary.
- MCP is the root of the scene graph. `parentId: null` means MCP-level placement.
- Scale is not editable and is never inherited through the scene graph.
- Imported Object STEP limits are 64 unique STEP Assets and 256 Object Instances. Primitive Assets remain inside the existing total Asset budget. Warn at 80% but reject only above the hard boundary.
- A Robot may be parented only to MCP or the single Linear Axis. A Group may be MCP-level or the Axis carriage. An Object may be parented to MCP, one Group, or the Axis when it is the direct carriage. Nested Groups and cycles are invalid.
- An Object whose transform source is OPC UA must remain MCP-level. Reparenting is rejected until the user switches it to Manual.
- Reparenting preserves the current World pose. Hide is durable; Isolate is session-only.
- A configured Robot mount contact is distinct from user-managed ignored collision pairs and may identify only the selected base Link plus one selected mount surface.
- Keep existing user changes and avoid broad stylesheet or store rewrites unrelated to the approved design.
- Before claiming a task complete, run its focused tests, `npm run lint`, and `npm run build`. Task 8 runs the full verification suite.

---

### Task 0: Complete the Project V3 Browser Authority Gate

**Files:**
- Create: `src/features/project/project-mutation-service.ts`
- Create: `src/features/project/project-mutation-service.test.ts`
- Create: `src/features/project/project-publication-coordinator.ts`
- Create: `src/features/project/project-publication-coordinator.test.ts`
- Modify: `src/features/project/browser-project-runtime.ts`
- Modify: `src/features/project/browser-project-runtime.test.ts`
- Modify: `src/features/project/project-store-browser.ts`
- Modify: `src/features/project/project-store.ts`
- Test: `src/features/project/project-store.test.ts`
- Modify: `src/features/project/ProjectMenu.tsx`
- Test: `src/features/project/ProjectMenu.test.tsx`
- Modify: `src/features/project/project-codec.ts`
- Test: `src/features/project/project-codec.test.ts`
- Modify: `src/features/project/project-v3-archive.ts`
- Test: `src/features/project/project-v3-archive.test.ts`
- Modify: `src/domain/project/project.ts`
- Test: `src/domain/project/project.test.ts`
- Delete: `src/domain/project/project-v1-migration.ts`
- Delete: `src/domain/project/project-v1-migration.test.ts`
- Delete: `src/domain/project/project-v2-migration.ts`
- Delete: `src/domain/project/project-v2-migration.test.ts`
- Create: `tests/project-v3-roundtrip.spec.ts`
- Modify: `docs/superpowers/plans/2026-07-13-project-v3-foundation.md`

**Interfaces:**
- Consumes: `ProjectRevisionRepository`, `ProjectSourceStagingService`, `WorkcellProjectSnapshotV3`, and prepared Project V3 archive decode results.
- Produces: the only durable mutation boundary, a published runtime bundle, V3 New/Save/Import/Export, recovery-required locking, and an accurate completion ledger for V3 Foundation Tasks 4 through 6.

- [ ] **Step 1: Write publication and mutation RED tests**

```ts
it('publishes one validated V3 candidate before observers see it', async () => {
  const pending = service.replaceFromActive((current) => ({
    ...current,
    manifest: { ...current.manifest, name: 'Cell B' },
  }))
  expect(selectPublishedProject().manifest.name).toBe('Cell A')
  await publicationBarrier.release()
  await pending
  expect(selectPublishedProject().manifest.name).toBe('Cell B')
})

it('keeps the previous bundle when runtime preparation fails', async () => {
  runtime.prepare.mockRejectedValueOnce(new Error('prepare failed'))
  await expect(service.replaceFromActive(renameTo('Cell B'))).rejects.toThrow('prepare failed')
  expect(selectPublishedProject()).toEqual(PROJECT_A)
  expect(await repository.readPointer()).toMatchObject({ state: 'stable' })
})

it('exports the active V3 revision without recapturing feature stores', async () => {
  await projectStore.getState().exportActiveProject()
  expect(browserProjectRuntime.capture).not.toHaveBeenCalled()
  expect(encodeProjectV3).toHaveBeenCalledWith(activePublishedSnapshot())
})

it.each([1, 2])('rejects superseded schema version %s without migration', async (schemaVersion) => {
  await expect(projectStore.getState().importProject(projectArchive(schemaVersion)))
    .rejects.toMatchObject({ code: 'PROJECT_SCHEMA_UNSUPPORTED' })
  expect(mutationService.replacePreparedUntrusted).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run RED**

Run:

```powershell
npm run test:run -- src/features/project/project-mutation-service.test.ts src/features/project/project-publication-coordinator.test.ts src/features/project/browser-project-runtime.test.ts src/features/project/ProjectMenu.test.tsx
```

Expected: FAIL because `project-store-browser.ts` still constructs the V2 codec/runtime lane and no `ProjectMutationService` exists.

- [ ] **Step 3: Implement one V3 mutation and publication boundary**

```ts
export type ActiveProjectMutationRecipeV1 = (
  current: StoredWorkcellProjectSnapshotProjectionV3,
) => StoredWorkcellProjectSnapshotProjectionV3

export interface ProjectMutationService {
  replaceFromActive(
    recipe: ActiveProjectMutationRecipeV1,
    preparedSources?: readonly PreparedProjectSourceGroupV1[],
  ): Promise<void>
  replacePreparedUntrusted(result: ProjectDecodeResultV3): Promise<void>
  readPublished(): PublishedProjectBundleV1 | null
}

export interface PublishedProjectBundleV1 {
  readonly revisionId: string
  readonly snapshot: WorkcellProjectSnapshotV3
  readonly generation: number
}
```

The coordinator must serialize commits, validate before preparing runtime resources, publish the new runtime and read models exactly once, finalize the matching pointer, and discard the previous runtime only after successful publication. A failure before publication leaves the old bundle untouched. A failure after pointer publication follows the existing V3 recovery matrix and disables durable edits until reload.

- [ ] **Step 4: Replace the V2 browser lane without adding a compatibility authority**

Remove `decodeLegacyRuntimeProjectV2`, `encodeLegacyRuntimeProjectV2`, `LegacyProjectSnapshotV2`, the V1/V2 migration modules, and migration branches in the archive decoder. Import accepts Project V3 only. An older archive fails before staging, mutation, cache replacement, or scene publication and tells the user that the schema is unsupported.

- [ ] **Step 5: Prove the V3 gate**

Run:

```powershell
npm run test:run -- src/features/project src/domain/project
npm run test:e2e -- tests/project-v3-roundtrip.spec.ts
```

Expected: PASS; New, Save, Export, Import, reload, stale commit, and fake-crash recovery all use V3. If `tests/project-v3-roundtrip.spec.ts` does not yet exist, complete Project V3 Foundation Task 6 before proceeding to Task 1.

- [ ] **Step 6: Update the V3 plan ledger and commit**

Mark only evidence-backed V3 Foundation steps complete. Record exact test commands and results beside the completed Task 4 through 6 entries.

```powershell
git add -A src/features/project src/domain/project docs/superpowers/plans/2026-07-13-project-v3-foundation.md
git diff --cached --check
git commit -m "feat: publish project v3 in the browser"
```

---

### Task 1: Add the Validated Scene Graph and Import Limits

**Files:**
- Create: `src/domain/project/scene-state-v1.ts`
- Create: `src/domain/project/scene-state-v1.test.ts`
- Create: `src/domain/scene/scene-transform.ts`
- Create: `src/domain/scene/scene-transform.test.ts`
- Modify: `src/domain/project/project-v3.ts`
- Test: `src/domain/project/project-v3.test.ts`
- Modify: `src/domain/project/object-asset-v3.ts`
- Modify: `src/features/project/project-v3-archive.ts`
- Test: `src/features/project/project-v3-archive.test.ts`

**Interfaces:**
- Produces: `ProjectSceneStateV1`, four discriminated Scene Entity records, transform-source ownership for Objects, `worldPoseForEntity()`, `reparentSceneEntityPreservingWorld()`, and the 64/256 limits.

- [ ] **Step 1: Write graph, transform, and limit RED tests**

```ts
it('rejects nested groups, cycles, a second robot, and a second linear axis', () => {
  expect(() => validateProjectSceneState(sceneWithNestedGroups())).toThrow('SCENE_GROUP_NESTING')
  expect(() => validateProjectSceneState(sceneWithCycle())).toThrow('SCENE_PARENT_CYCLE')
  expect(() => validateProjectSceneState(sceneWithTwoRobots())).toThrow('SCENE_ROBOT_LIMIT')
  expect(() => validateProjectSceneState(sceneWithTwoAxes())).toThrow('SCENE_LINEAR_AXIS_LIMIT')
})

it('preserves world pose when a manual object is grouped', () => {
  const next = reparentSceneEntityPreservingWorld(SCENE, 'object:cup-1', 'group:fixture')
  expect(worldPoseForEntity(next, 'object:cup-1')).toEqualPose(
    worldPoseForEntity(SCENE, 'object:cup-1'),
  )
})

it('rejects grouping an OPC UA owned object', () => {
  expect(() => reparentSceneEntityPreservingWorld(OPC_SCENE, 'object:cup-1', 'group:fixture'))
    .toThrow('SCENE_OPCUA_OBJECT_REQUIRES_MCP_PARENT')
})

it('accepts 64 STEP assets and 256 instances and rejects one above each', () => {
  expect(() => validateWorkcellProjectSnapshotV3(projectCounts(64, 256))).not.toThrow()
  expect(() => validateWorkcellProjectSnapshotV3(projectCounts(65, 256))).toThrow('MAX_STEP_OBJECT_ASSETS')
  expect(() => validateWorkcellProjectSnapshotV3(projectCounts(64, 257))).toThrow('MAX_OBJECT_INSTANCES')
})
```

- [ ] **Step 2: Run RED**

Run:

```powershell
npm run test:run -- src/domain/project/scene-state-v1.test.ts src/domain/scene/scene-transform.test.ts src/domain/project/project-v3.test.ts src/features/project/project-v3-archive.test.ts
```

Expected: FAIL because the V3 snapshot has no `scene` field and the existing limits are 256 Assets/512 Instances.

- [ ] **Step 3: Add the durable scene contracts**

```ts
export type SceneEntityIdV1 =
  | 'robot:active'
  | 'linear-axis:active'
  | `group:${string}`
  | `object:${string}`
  | `equipment:${string}`

export interface ScenePoseV1 {
  readonly positionM: readonly [number, number, number]
  readonly quaternion: readonly [number, number, number, number]
}

interface SceneEntityBaseV1 {
  readonly id: SceneEntityIdV1
  readonly name: string
  readonly parentId: SceneEntityIdV1 | null
  readonly localPose: ScenePoseV1
  readonly visible: boolean
}

export interface LinearAxisConfigurationV1 {
  readonly direction: 'x' | 'y' | 'z'
  readonly minPositionM: number
  readonly maxPositionM: number
  readonly homePositionM: number
  readonly currentPositionM: number
  readonly carriageEntityId: `object:${string}` | `equipment:${string}` | `group:${string}` | null
  readonly robotEntityId: 'robot:active' | null
}

export type SceneEntityV1 =
  | (SceneEntityBaseV1 & { readonly kind: 'robot'; readonly id: 'robot:active' })
  | (SceneEntityBaseV1 & { readonly kind: 'group'; readonly id: `group:${string}` })
  | (SceneEntityBaseV1 & {
      readonly kind: 'object'
      readonly id: `object:${string}` | `equipment:${string}`
      readonly target:
        | Readonly<{ kind: 'object-instance'; id: string }>
        | Readonly<{ kind: 'built-in-equipment'; id: string }>
      readonly transformSource: 'manual' | 'opcua'
    })
  | (SceneEntityBaseV1 & LinearAxisConfigurationV1 & {
      readonly kind: 'linear-axis'
      readonly id: 'linear-axis:active'
    })

export interface RobotMountContactV1 {
  readonly baseLinkId: RobotLinkId
  readonly mountSurfaceCollisionEntityId: string | null
}

export interface ProjectSceneStateV1 {
  readonly entities: readonly SceneEntityV1[]
  readonly robotMountContact: RobotMountContactV1 | null
}
```

Remove the duplicate Robot base position/rotation fields from the V3 Robot record while V3 is still behind Task 0's gate. The V3 New Project factory creates `robot:active`; the V3 archive requires explicit Scene Entities. Each imported Object Instance and built-in Equipment record has exactly one matching Scene Object, which owns its persisted Manual fallback pose and transform source.

- [ ] **Step 4: Implement deterministic transform helpers**

`worldPoseForEntity()` composes MCP-to-parent matrices and the entity local pose. For a Linear Axis, insert a translation of `currentPositionM` along `direction` before the configured carriage and Robot transforms. `reparentSceneEntityPreservingWorld()` computes `inverse(newParentWorld) * oldWorld`, decomposes once, normalizes the quaternion, and rejects scale drift above `1e-9`. Validation requires the Axis attachment IDs and child `parentId` values to agree.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/domain/project src/domain/scene src/features/project/project-v3-archive.test.ts
npm run lint
npm run build
git add src/domain/project src/domain/scene src/features/project/project-v3-archive.ts src/features/project/project-v3-archive.test.ts
git diff --cached --check
git commit -m "feat: define the project scene graph"
```

Expected: all commands PASS; archives and migrations produce exactly one Robot Scene Entity and valid Object entity references.

---

### Task 2: Route Scene Commands Through Project V3

**Files:**
- Create: `src/features/scene/scene-command-service.ts`
- Create: `src/features/scene/scene-command-service.test.ts`
- Create: `src/features/scene/scene-editor-store.ts`
- Create: `src/features/scene/scene-editor-store.test.ts`
- Create: `src/features/scene/scene-runtime-selector.ts`
- Create: `src/features/scene/scene-runtime-selector.test.ts`
- Modify: `src/features/import/ImportStepDialog.tsx`
- Test: `src/features/import/ImportStepDialog.test.tsx`
- Modify: `src/features/objects/object-asset-store.ts`
- Test: `src/features/objects/object-asset-store.test.ts`
- Modify: `src/features/scene/Workcell.tsx`
- Create: `src/features/scene/Workcell.test.tsx`
- Modify: `src/features/robot/RobotModel.tsx`
- Test: `src/features/robot/RobotModel.test.ts`

**Interfaces:**
- Consumes: Task 0 `ProjectMutationService` and Task 1 scene graph.
- Produces: atomic create/delete/reparent/rename/visibility/transform commands, transient selection/isolation/draft state, and one render projection for Robot, imported Objects, Groups, and Linear Axis.

- [ ] **Step 1: Write command atomicity RED tests**

```ts
it('imports Asset, Instance, Scene Entity, transform state, and binding references atomically', async () => {
  await commands.importStepObject(FILE, IMPORT_OPTIONS)
  expect(mutationService.replaceFromActive).toHaveBeenCalledTimes(1)
  expect(activeProject()).toMatchObject({
    objectAssets: [expect.objectContaining({ sourceKind: 'step' })],
    objectInstances: [expect.anything()],
    scene: { entities: expect.arrayContaining([expect.objectContaining({ kind: 'object' })]) },
  })
})

it('deletes an object and all of its durable references in one recipe', async () => {
  await commands.deleteEntity('object:cup-1')
  expect(orphanReferences(activeProject(), 'object:cup-1')).toEqual([])
  expect(mutationService.replaceFromActive).toHaveBeenCalledTimes(1)
})

it('keeps isolate session-only across save and reload', async () => {
  editor.isolate('group:fixture')
  expect(effectiveVisible('object:cup-1')).toBe(false)
  expect(JSON.stringify(activeProject())).not.toContain('isolatedEntityId')
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/scene/scene-command-service.test.ts src/features/scene/scene-editor-store.test.ts src/features/scene/scene-runtime-selector.test.ts src/features/import/ImportStepDialog.test.tsx src/features/objects/object-asset-store.test.ts
```

Expected: FAIL because Object import and transforms still write directly to feature stores.

- [ ] **Step 3: Implement durable commands and transient editor state**

```ts
export interface SceneCommandService {
  createGroup(name: string): Promise<SceneEntityIdV1>
  createBox(input: CreateBoxObjectInputV1): Promise<SceneEntityIdV1>
  createCylinder(input: CreateCylinderObjectInputV1): Promise<SceneEntityIdV1>
  duplicateObject(entityId: SceneEntityIdV1): Promise<SceneEntityIdV1>
  rename(entityId: SceneEntityIdV1, name: string): Promise<void>
  setVisible(entityId: SceneEntityIdV1, visible: boolean): Promise<void>
  setLocalPose(entityId: SceneEntityIdV1, pose: ScenePoseV1): Promise<void>
  reparent(entityId: SceneEntityIdV1, parentId: SceneEntityIdV1 | null): Promise<void>
  ungroup(groupId: `group:${string}`): Promise<void>
  deleteGroupAndContents(groupId: `group:${string}`): Promise<void>
  deleteEntity(entityId: SceneEntityIdV1): Promise<void>
}

export interface SceneEditorState {
  readonly selectedEntityId: SceneEntityIdV1 | null
  readonly isolatedEntityId: SceneEntityIdV1 | null
  readonly draftPose: { readonly entityId: SceneEntityIdV1; readonly pose: ScenePoseV1 } | null
}
```

`effectiveVisible` is `entity.visible && everyAncestor.visible && isolateAllows(entity)`. Hiding a Group does not mutate child flags. `ungroup()` reparents direct members to MCP while preserving World poses; `deleteGroupAndContents()` removes the Group and its members after confirmation. Neither action is valid while the Group is the Axis carriage. Deleting the Robot is not offered. Duplicate reuses the Asset and creates only an Instance plus Scene Entity. A 52nd STEP Asset and 205th Instance show the non-blocking 80% warning; Asset count warning applies only to unique STEP Assets.

- [ ] **Step 4: Replace direct render/store authority**

`Workcell` and `RobotModel` consume the published scene runtime selector. Feature stores may cache geometry by digest but cannot persist transforms, visibility, hierarchy, or deletion independently. Apply commits a draft; Cancel discards it; a project generation change discards stale drafts.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/scene src/features/import src/features/objects src/features/robot
npm run lint
npm run build
git add src/features/scene src/features/import/ImportStepDialog.tsx src/features/import/ImportStepDialog.test.tsx src/features/objects src/features/robot/RobotModel.tsx src/features/robot/RobotModel.test.ts
git diff --cached --check
git commit -m "feat: route scene edits through project v3"
```

---

### Task 3: Build the Scene Explorer, Common Inspector, and Context Menu

**Files:**
- Create: `src/features/scene/SceneExplorer.tsx`
- Create: `src/features/scene/SceneExplorer.test.tsx`
- Create: `src/features/scene/SceneEntityInspector.tsx`
- Create: `src/features/scene/SceneEntityInspector.test.tsx`
- Create: `src/features/scene/SceneContextMenu.tsx`
- Create: `src/features/scene/SceneContextMenu.test.tsx`
- Create: `src/features/scene/rpy-editor.ts`
- Create: `src/features/scene/rpy-editor.test.ts`
- Modify: `src/app/App.tsx`
- Create: `src/app/App.test.tsx`
- Modify: `src/features/interaction/EquipmentTransformControls.tsx`
- Test: `src/features/interaction/EquipmentTransformControls.test.tsx`

**Interfaces:**
- Produces: one Scene tree, common Local transform editor, read-only World pose, Entity-specific context commands, Hide/Show/Isolate, Group/Ungroup, and explicit Manual/OPC UA ownership behavior.

- [ ] **Step 1: Write interaction RED tests**

```tsx
it('shows hierarchy, visibility, and selection without document scrolling', async () => {
  render(<SceneExplorer />)
  expect(screen.getByRole('treeitem', { name: /Fixture Group/ })).toHaveAttribute('aria-expanded', 'true')
  await user.click(screen.getByRole('button', { name: 'Hide Fixture Group' }))
  expect(sceneCommands.setVisible).toHaveBeenCalledWith('group:fixture', false)
})

it('edits Local XYZ/RPY and displays World pose read-only', async () => {
  render(<SceneEntityInspector entityId="object:cup-1" />)
  await user.clear(screen.getByLabelText('Roll (deg)'))
  await user.type(screen.getByLabelText('Roll (deg)'), '90')
  await user.click(screen.getByRole('button', { name: 'Apply transform' }))
  expect(sceneCommands.setLocalPose).toHaveBeenCalledWith('object:cup-1', expectedQuaternionPose())
  expect(screen.getByLabelText('World X (mm)')).toHaveAttribute('readonly')
})

it('asks before switching an OPC UA object to Manual for grouping', async () => {
  render(<SceneContextMenu entityId="object:live-part" />)
  await user.click(screen.getByRole('menuitem', { name: 'Move to group' }))
  expect(screen.getByRole('dialog', { name: 'Switch transform source?' })).toBeVisible()
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/scene/SceneExplorer.test.tsx src/features/scene/SceneEntityInspector.test.tsx src/features/scene/SceneContextMenu.test.tsx src/features/scene/rpy-editor.test.ts src/app/App.test.tsx
```

Expected: FAIL because the current asset list is flat and the inspector is Equipment-specific.

- [ ] **Step 3: Implement the minimal context command matrix**

| Entity | Commands |
|---|---|
| Robot | Focus, Copy/Paste/Reset Base Transform, Attach/Detach Linear Axis, Hide/Show, Isolate, Open Mechanics/Geometry/Collision |
| Object | Focus, Rename, Duplicate, Copy/Paste/Reset Transform, Move to Group, Set as Carriage, Hide/Show, Isolate, Delete |
| Group | Focus Children, Rename, Copy/Paste/Reset Transform, Ungroup, Set as Carriage, Hide/Show, Isolate, Delete Group and Contents |
| Linear Axis | Focus, Rename, Open Axis Settings, Move Home, Set/Clear Carriage, Attach/Detach Robot, Hide/Show, Isolate, Delete when detached |

Use a confirmation dialog only for destructive delete, Ungroup with children, and OPC UA-to-Manual ownership switch. Right-click on empty viewport opens only `Create Group`, `Create Box`, `Create Cylinder`, and `Fit All` after Task 7 supplies camera actions.

- [ ] **Step 4: Implement quaternion-safe RPY editing**

```ts
export function quaternionFromIntrinsicZyxDeg(
  rollDeg: number,
  pitchDeg: number,
  yawDeg: number,
): readonly [number, number, number, number]

export function intrinsicZyxDegFromQuaternion(
  quaternion: readonly [number, number, number, number],
): Readonly<{ rollDeg: number; pitchDeg: number; yawDeg: number }>
```

Normalize displayed angles to `[-180, 180]` and persist only the resulting normalized quaternion. The UI does not attempt to preserve a unique Euler representation at a gimbal singularity.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/scene src/features/interaction src/app
npm run lint
npm run build
git add src/features/scene src/features/interaction/EquipmentTransformControls.tsx src/features/interaction/EquipmentTransformControls.test.tsx src/app/App.tsx src/app/App.test.tsx
git diff --cached --check
git commit -m "feat: add scene hierarchy editing"
```

---

### Task 4: Make Robot Jobs Discoverable and Fix the Desktop Shell

**Files:**
- Create: `src/features/jobs/RobotJobList.tsx`
- Create: `src/features/jobs/RobotJobList.test.tsx`
- Create: `src/features/jobs/job-command-service.ts`
- Create: `src/features/jobs/job-command-service.test.ts`
- Create: `src/features/ui/BottomWorkspace.tsx`
- Create: `src/features/ui/BottomWorkspace.test.tsx`
- Create: `src/features/ui/theme-preference.ts`
- Create: `src/features/ui/theme-preference.test.ts`
- Modify: `src/features/ui/Timeline.tsx`
- Test: `src/features/ui/Timeline.test.tsx`
- Modify: `src/app/AppShell.tsx`
- Test: `src/app/AppShell.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces: upper Scene Objects/lower Robot Jobs sidebar split, active Job selection, Job/Pose CRUD and ordering, Timeline/Collision bottom tabs, fixed desktop sizing, and Light/Dark browser preference.

- [ ] **Step 1: Write layout and Job RED tests**

```tsx
it('renders Scene Objects above Robot Jobs and selects a Job', async () => {
  render(<AppShell assetTree={<SceneExplorer />} jobTree={<RobotJobList />} viewport={<div />} />)
  expect(screen.getByRole('region', { name: 'Scene Objects' })).toBeVisible()
  expect(screen.getByRole('region', { name: 'Robot Jobs' })).toBeVisible()
  await user.click(screen.getByRole('treeitem', { name: 'Pick Cups' }))
  expect(jobCommands.setActiveJob).toHaveBeenCalledWith('job-pick-cups')
})

it('persists the draggable 60/40 split only in browser preferences', async () => {
  await dragSidebarDividerTo(55)
  expect(localStorage.getItem('robotsim.sidebarSplitPercent')).toBe('55')
  expect(JSON.stringify(activeProject())).not.toContain('sidebarSplitPercent')
})

it('moves and deletes poses inside the active Job atomically', async () => {
  await jobCommands.movePose('job-a', 'pose-3', 0)
  await jobCommands.deletePose('job-a', 'pose-2')
  expect(activeJob().poses.map(({ id }) => id)).toEqual(['pose-3', 'pose-1'])
})

it('shows only one bottom workspace panel at a time', async () => {
  render(<BottomWorkspace />)
  await user.click(screen.getByRole('tab', { name: 'Collision' }))
  expect(screen.getByRole('tabpanel', { name: 'Collision' })).toBeVisible()
  expect(screen.queryByRole('tabpanel', { name: 'Timeline' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/jobs src/features/ui src/app/AppShell.test.tsx
```

Expected: FAIL because Jobs have no sidebar surface and Timeline/Collision render side-by-side.

- [ ] **Step 3: Implement Job commands through V3**

```ts
export interface JobCommandService {
  createJob(name: string): Promise<string>
  renameJob(jobId: string, name: string): Promise<void>
  duplicateJob(jobId: string): Promise<string>
  deleteJob(jobId: string): Promise<void>
  setActiveJob(jobId: string | null): Promise<void>
  saveCurrentPose(name: string): Promise<string>
  setPoseSpeed(jobId: string, poseId: string, speedPercentToNext: number): Promise<void>
  movePose(jobId: string, poseId: string, nextIndex: number): Promise<void>
  deletePose(jobId: string, poseId: string): Promise<void>
}
```

Every command submits one Project recipe. Speed accepts 1–100%. Moving or deleting a Pose recomputes canonical outgoing durations in the same recipe and increments the Job revision once.

- [ ] **Step 4: Implement the fixed shell and theme preference**

Set `html`, `body`, and `#root` to `height: 100%; overflow: hidden`. The shell owns `100dvh`; only Scene Objects, Robot Jobs, Inspector, Timeline, and Collision content areas scroll internally. The Sidebar starts at 60/40 and its draggable divider is clamped to 35–75%. Persist the split, active bottom tab, drawer state, and `'light' | 'dark' | 'system'` theme in browser storage; Project archives do not include them. Replace the permanent STEP/Robot/primitive/Group buttons with one **Add** menu, and move Robot Mechanics/Geometry/Frames to the selected target Inspector.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/jobs src/features/ui src/app
npm run lint
npm run build
git add src/features/jobs src/features/ui src/app src/styles/tokens.css src/styles/global.css
git diff --cached --check
git commit -m "feat: expose jobs in the desktop shell"
```

---

### Task 5: Add One Manual Linear Axis and Robot Mounting

**Files:**
- Create: `src/features/scene/LinearAxisRuntime.tsx`
- Create: `src/features/scene/LinearAxisRuntime.test.tsx`
- Create: `src/features/scene/LinearAxisInspector.tsx`
- Create: `src/features/scene/LinearAxisInspector.test.tsx`
- Create: `src/features/scene/linear-axis-source.ts`
- Create: `src/features/scene/linear-axis-source.test.ts`
- Modify: `src/features/scene/scene-command-service.ts`
- Test: `src/features/scene/scene-command-service.test.ts`
- Modify: `src/features/scene/Workcell.tsx`
- Modify: `src/features/robot/RobotModel.tsx`

**Interfaces:**
- Produces: a single axis-aligned moving Frame, one Object-or-Group carriage, bounded Manual position, Home command, Robot attach/detach while preserving World pose, and a source interface that can later accept OPC UA without changing the renderer.

- [ ] **Step 1: Write Linear Axis RED tests**

```ts
it('moves the robot with the carriage along the configured local axis', () => {
  const scene = sceneWithAxis({ direction: 'x', currentPositionM: 1.25 })
  expect(worldPoseForEntity(scene, 'robot:active').positionM).toEqual([1.25, 0, 0])
})

it('rejects out-of-range position without clamping', async () => {
  await expect(commands.setLinearAxisPosition(2.1)).rejects.toThrow('LINEAR_AXIS_OUT_OF_RANGE')
  expect(activeAxis().currentPositionM).toBe(0.5)
})

it('attaches and detaches the robot without a world-pose jump', async () => {
  const before = robotWorldPose()
  await commands.attachRobotToLinearAxis()
  expect(robotWorldPose()).toEqualPose(before)
  await commands.detachRobotFromLinearAxis()
  expect(robotWorldPose()).toEqualPose(before)
})

it('sets one Object or Group as carriage and preserves its world pose', async () => {
  const before = worldPose('group:carriage')
  await commands.setLinearAxisCarriage('group:carriage')
  expect(activeAxis().carriageEntityId).toBe('group:carriage')
  expect(worldPose('group:carriage')).toEqualPose(before)
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/scene/LinearAxisRuntime.test.tsx src/features/scene/LinearAxisInspector.test.tsx src/features/scene/linear-axis-source.test.ts src/features/scene/scene-command-service.test.ts
```

Expected: FAIL because no Linear Axis runtime or commands exist.

- [ ] **Step 3: Implement the narrow source boundary**

```ts
export interface LinearAxisFrameV1 {
  readonly positionM: number
  readonly timestampMs: number
  readonly quality: 'GOOD' | 'STALE' | 'BAD'
}

export interface LinearAxisSourceV1 {
  readonly kind: 'manual'
  subscribe(listener: (frame: LinearAxisFrameV1) => void): () => void
  setPositionM(positionM: number): Promise<void>
  home(): Promise<void>
}
```

This task ships only `ManualLinearAxisSource`. Do not add middleware nodes, interpolation settings, or OPC UA UI for the axis.

The durable command surface is limited to:

```ts
createLinearAxis(input: LinearAxisConfigurationV1): Promise<void>
setLinearAxisPosition(positionM: number): Promise<void>
moveLinearAxisHome(): Promise<void>
setLinearAxisCarriage(entityId: SceneEntityIdV1 | null): Promise<void>
attachRobotToLinearAxis(): Promise<void>
detachRobotFromLinearAxis(): Promise<void>
deleteLinearAxis(): Promise<void>
```

`setLinearAxisCarriage()` accepts only an Object or Group, rejects an OPC UA-owned Object, and clears the previous carriage while preserving both entities' World poses. `deleteLinearAxis()` is allowed only when carriage and Robot attachments are null.

- [ ] **Step 4: Render the carriage and wire Robot parenting**

The axis entity's `localPose` places the moving Frame; imported fixed-rail geometry remains an ordinary MCP-level Object. `currentPositionM` translates the selected Object-or-Group carriage and the attached Robot. `RobotModel` receives the computed Robot World matrix from the scene runtime rather than reading base coordinates from Robot configuration. A carriage Group keeps its member Objects Group-local. Axis motion invalidates collision matrices in the same animation update.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/scene src/features/robot
npm run lint
npm run build
git add src/features/scene src/features/robot/RobotModel.tsx
git diff --cached --check
git commit -m "feat: mount the robot on one linear axis"
```

---

### Task 6: Replace the Hardcoded Base Collision Exemption with Mount Contact

**Files:**
- Create: `src/domain/collision/mount-contact.ts`
- Create: `src/domain/collision/mount-contact.test.ts`
- Modify: `src/domain/collision/query-collision.ts`
- Test: `src/domain/collision/query-collision.test.ts`
- Modify: `src/features/collision/collision-validation-protocol.ts`
- Test: `src/features/collision/collision-validation-protocol.test.ts`
- Modify: `src/features/collision/collision-validation.worker.ts`
- Modify: `src/features/collision/current-pose-collision.ts`
- Test: `src/features/collision/current-pose-collision.test.ts`
- Modify: `src/features/collision/CollisionPanel.tsx`
- Test: `src/features/collision/CollisionPanel.test.tsx`
- Modify: `src/features/collision/scene-entity-adapter.ts`
- Test: `src/features/collision/scene-entity-adapter.test.ts`
- Modify: `tests/geometry-collision.spec.ts`

**Interfaces:**
- Produces: a derived mount pair key passed through current-pose and sequence validation, separate mount-contact reporting, and no implicit `LINK00|workbench` exemption.

- [ ] **Step 1: Write collision-policy RED tests**

```ts
it('does not exempt LINK00 and workbench without explicit mount contact', () => {
  expect(findPair(query(DEFAULT_SCENE, DEFAULT_POLICY), 'robot-link:LINK00|workcell:workbench'))
    .toMatchObject({ kind: 'collision' })
})

it('classifies only the configured base-link and surface as mount contact', () => {
  const result = query(DEFAULT_SCENE, DEFAULT_POLICY, {
    mountContactPairKey: pairKey('robot-link:LINK00', 'workcell:workbench'),
  })
  expect(result.findings).not.toContainEqual(expect.objectContaining({ pairKey: MOUNT_PAIR }))
  expect(result.mountContact).toEqual({ pairKey: MOUNT_PAIR, state: 'contact' })
})

it('keeps a user ignored pair separate from mount contact', () => {
  expect(collisionReport().ignoredPairKeys).not.toContain(MOUNT_PAIR)
  expect(collisionReport().mountContactPairKey).toBe(MOUNT_PAIR)
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/domain/collision src/features/collision
```

Expected: FAIL because `pairEnabledByCategory()` currently hardcodes `workcell:workbench` with `robot-link:LINK00` as disabled.

- [ ] **Step 3: Introduce explicit query options**

```ts
export interface GeometryCollisionQueryOptionsV1 {
  readonly mountContactPairKey: string | null
  readonly metadata?: CollisionQueryMetadata
}

export interface CollisionQueryResult {
  readonly findings: readonly CollisionFinding[]
  readonly mountContact: Readonly<{ pairKey: string; state: 'clear' | 'near' | 'contact' }> | null
  readonly telemetry: CollisionQueryTelemetry
}
```

Remove the special-case pair from `pairEnabledByCategory()`. Evaluate the configured pair normally, then move only its result to `mountContact`. Missing or invalid configuration exempts nothing. Validate that the base Link exists in the active Robot geometry and that the surface exists in the collision registry before publication.

- [ ] **Step 4: Update the panel and sequence validator**

Show `Mount Contact: Configured/Incomplete` separately from Collision and Near-miss counts. Do not add Restore/Ignore controls for the derived mount pair. Sequence validation passes the same pair key to its Worker so current-pose and Job results agree.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/domain/collision src/features/collision
npm run test:e2e -- tests/geometry-collision.spec.ts
npm run lint
npm run build
git add src/domain/collision src/features/collision tests/geometry-collision.spec.ts
git diff --cached --check
git commit -m "fix: model robot mount contact explicitly"
```

---

### Task 7: Add Minimal Coordinate-Aware Viewport Controls

**Files:**
- Create: `src/features/viewport/viewport-preference-store.ts`
- Create: `src/features/viewport/viewport-preference-store.test.ts`
- Create: `src/features/viewport/camera-actions.ts`
- Create: `src/features/viewport/camera-actions.test.ts`
- Create: `src/features/viewport/ViewportOverlay.tsx`
- Create: `src/features/viewport/ViewportOverlay.test.tsx`
- Create: `src/features/viewport/TcpFrameMarker.tsx`
- Create: `src/features/viewport/TcpFrameMarker.test.tsx`
- Create: `src/features/viewport/ViewCube.tsx`
- Create: `src/features/viewport/ViewCube.test.tsx`
- Create: `src/features/viewport/CoordinateStatusBar.tsx`
- Create: `src/features/viewport/CoordinateStatusBar.test.tsx`
- Modify: `src/features/scene/SceneCanvas.tsx`
- Create: `src/features/scene/SceneCanvas.test.tsx`
- Modify: `src/features/scene/Workcell.tsx`
- Modify: `src/app/App.tsx`
- Create: `tests/viewport-spatial-controls.spec.ts`

**Interfaces:**
- Produces: Actual TCP XYZ triad, Home View, Fit All, Focus Selection, World View Cube, Grid/World/Base/TCP layer toggles, and a compact Pose/Gizmo frame status.

- [ ] **Step 1: Write camera, marker, and persistence RED tests**

```tsx
it('Home View changes only camera state', async () => {
  const before = semanticProjectState()
  await user.click(screen.getByRole('button', { name: 'Home View' }))
  expect(cameraPose()).toEqual(HOME_CAMERA)
  expect(semanticProjectState()).toEqual(before)
})

it('renders a labelled depth-aware Actual TCP triad', () => {
  render(<TcpFrameMarker pose={TCP_POSE} visible />)
  expect(sceneObjectByName('actual-tcp-x')).toHaveUserData({ label: 'X' })
  expect(sceneMaterial('actual-tcp-x').depthTest).toBe(true)
})

it('keeps the View Cube referenced to World while the Robot moves', async () => {
  const before = cubeOrientation()
  moveRobotAndTcp()
  expect(cubeOrientation()).toEqual(before)
  await user.click(screen.getByRole('button', { name: 'Top view' }))
  expect(cameraDirection()).toEqual([0, 0, -1])
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/viewport src/features/scene/SceneCanvas.test.tsx
```

Expected: FAIL because no viewport preference store or overlay controls exist.

- [ ] **Step 3: Implement camera actions with explicit boundaries**

```ts
export interface ViewportCameraActions {
  home(): void
  fitAll(bounds: Box3): void
  focusSelection(bounds: Box3): void
  setStandardView(view: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric'): void
}
```

Home restores camera position, orientation, orbit pivot, and zoom only. Fit All includes only effectively visible render entities. Focus Selection is disabled when nothing is selected. The View Cube supports face/corner clicks but not dragging. It is always World-referenced.

- [ ] **Step 4: Implement minimal coordinate display state**

Persist `grid`, `worldFrame`, `baseFrame`, `tcpFrame`, Pose Frame, Gizmo Frame, and the last camera state in browser-local preferences, not Project V3. `Home View` always returns to the fixed application Home constant and does not overwrite it. Display `Pose Frame: World | MCP | Base` and `Gizmo Frame: World | Parent`; these selectors change display/interaction interpretation but do not rewrite entity poses. The TCP marker represents Actual TCP only and uses normal depth testing.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/viewport src/features/scene src/app
npm run test:e2e -- tests/viewport-spatial-controls.spec.ts
npm run lint
npm run build
git add src/features/viewport src/features/scene src/app/App.tsx tests/viewport-spatial-controls.spec.ts
git diff --cached --check
git commit -m "feat: add minimal spatial viewport controls"
```

---

### Task 8: Prove Project Round-Trip, Limits, Layout, and Regression Safety

**Files:**
- Create: `tests/reusable-scene-editor.spec.ts`
- Modify: `tests/project-v3-roundtrip.spec.ts`
- Create: `tests/project-resource-performance.spec.ts`
- Modify: `README.md`
- Create: `docs/developer/reusable-scene-editor.md`
- Modify: `docs/progress/2026-07-13-project-status.md`

**Interfaces:**
- Produces: browser evidence for the approved success criteria, documented Project fields and limits, and a final independent review gate.

- [ ] **Step 1: Add the end-to-end success path**

```ts
test('builds, saves, reloads, and edits a reusable workcell', async ({ page }) => {
  await importStepObject(page, 'cup.step')
  await createGroup(page, 'Fixture A')
  await moveObjectToGroup(page, 'cup', 'Fixture A')
  await setObjectPose(page, { x: 0.4, y: 0.2, z: 0.1, roll: 0, pitch: 0, yaw: 90 })
  await createJobWithThreePoses(page, [25, 60, 20])
  await addLinearAxisAndAttachRobot(page, { direction: 'x', currentPositionM: 0.5 })
  await configureMountContact(page, 'LINK00', 'workcell:workbench')
  await saveAndReload(page)
  await expectReusableSceneState(page)
})
```

- [ ] **Step 2: Add boundary and failure-path evidence**

Cover these exact cases:

- 64 STEP Assets accepted; 65th rejected before parsing or source commit.
- 256 Object Instances accepted; 257th rejected without changing active revision.
- 80% warnings do not block import or creation.
- Hidden Group remains hidden after reload; Isolate clears after reload.
- Object World pose remains unchanged after group/reparent/ungroup.
- OPC UA-owned Object cannot be grouped until switched to Manual.
- Robot remains visually stationary while attaching/detaching from the Linear Axis.
- Mount contact is not counted as Collision; incomplete mount configuration exempts nothing.
- Scene Objects and Robot Jobs remain usable at 1366x768 with no document scrollbar.
- Light/Dark preference survives reload but does not alter the Project archive.
- Home View never changes Robot, Object, Job, collision, or Project state.

- [ ] **Step 3: Run the complete verification matrix**

```powershell
npm run lint
npm run test:run
npm run cad:validate
npm run build
npm run test:e2e -- tests/project-v3-roundtrip.spec.ts tests/reusable-scene-editor.spec.ts tests/viewport-spatial-controls.spec.ts tests/geometry-collision.spec.ts
npm run test:e2e:hash
npm run test:e2e:archive
```

Expected: all commands PASS with zero TypeScript, lint, unit, CAD validation, build, Playwright, hash-route, or archive-route failures.

- [ ] **Step 4: Perform an independent review**

Review against `docs/superpowers/specs/2026-07-15-reusable-scene-editor-design.md`. Confirm that every durable UI action reaches `ProjectMutationService`, no V2 browser authority or newly introduced `Legacy*` symbol remains, transforms have one owner, and no excluded feature was implemented accidentally.

Run:

```powershell
rg -n "Legacy|decodeLegacyRuntimeProjectV2|encodeLegacyRuntimeProjectV2" src/features/project/project-store-browser.ts src/features/project/browser-project-runtime.ts src/features/scene src/features/jobs src/features/viewport src/app
rg -n "TODO|TBD|FIXME|placeholder" docs/developer/reusable-scene-editor.md src/features/scene src/features/viewport src/features/jobs
git diff --check
```

Expected: first command exits 1 because no active browser/runtime compatibility symbol is found, second command exits 1 because no unfinished implementation marker is found, and `git diff --check` exits 0.

- [ ] **Step 5: Document and commit**

Document the Scene Entity hierarchy rules, MCP/Local/World transform convention, intrinsic Z-Y-X UI convention, Object import limits, Linear Axis limitation, mount-contact semantics, browser-local viewport/theme preferences, and excluded features.

```powershell
git add tests README.md docs/developer/reusable-scene-editor.md docs/progress/2026-07-13-project-status.md
git diff --cached --check
git commit -m "docs: verify the reusable scene editor"
```

---

## Final Success Criteria

- One active six-axis Robot is positioned at MCP level or mounted to one manual X/Y/Z Linear Axis.
- Imported Objects can be grouped one level deep, hidden, isolated, renamed, transformed with XYZ/RPY, reparented without a World-pose jump, and deleted without orphan records.
- Robot and Object placement, Group hierarchy, Hide state, Jobs, Poses, Pose order/speed, Linear Axis configuration/position, and mount contact survive V3 Save/Export/Import/reload atomically.
- The left sidebar clearly separates Scene Objects and Robot Jobs; the bottom workspace shows Timeline or Collision, never both overlaid.
- Collision validation has no hardcoded Robot-base/workbench exemption and reports explicit mount contact separately.
- Actual TCP and essential World/Base/TCP spatial controls are visible without adding advanced path, jog, or physics scope.
- The browser document does not scroll at 1366×768; panels scroll internally and Light/Dark preference is browser-local.
- Limits, recovery, and failure paths preserve the previous published revision and never expose half-applied scene state.
- The full verification matrix passes before the branch is offered for merge.
