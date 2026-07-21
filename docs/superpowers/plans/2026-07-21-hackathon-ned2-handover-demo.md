# Hackathon NED2 Handover Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one offline-capable, one-click Job demonstration in which two NED2 Runtime Instances pick one Workpiece, transfer it through a Shared Zone by Direct Handover, and place it in an Output Tray, with deterministic Reset and one Grip Confirm Timeout fault.

**Architecture:** Keep Project V4 as the active browser/UI boundary and add one sample-specific Handover Coordinator to the active Job runtime bundle. The Coordinator writes the existing Robot runtime, publishes the representative Job state, and owns a small transient Handover store whose Workpiece World-pose override is consumed by the existing Spatial Entity renderer. One NED2 Definition and its current per-Link GLB set are shared by two Robot Instances.

**Tech Stack:** TypeScript, React 19, Zustand vanilla stores, Three.js/React Three Fiber, Vitest, Testing Library, Playwright, Vite.

## Global Constraints

- The happy path must run with OPC UA and the Runtime Gateway offline.
- Use one built-in NED2 Definition and two Robot Instances; do not duplicate GLB assets or Geometry preparation.
- Keep the current per-Link NED2 GLBs and present them as one reusable Robot asset.
- The operator starts one visible representative Job; no second Robot Start control is added.
- Use fixed Joint Pose keyframes and existing interpolation helpers; do not add IK, path planning, physics, or safety claims.
- Direct Handover must preserve the Workpiece World pose while ownership changes atomically.
- The only fault is `GRIP_CONFIRM_TIMEOUT`, with a deterministic 2,000 ms timeout.
- Fault injection is runtime-only, applies to the next run, and clears on completion or Reset.
- Preserve existing ABB assets and existing Project samples; the Hackathon sample uses only NED2.
- Do not add Legacy Adoption, manufacturer code generation, Project V5 UI promotion, or a generic multi-Robot scheduler.
- Preserve unrelated user files and do not stage `.pnpm-store/`, external STEP folders, backups, or `artifacts/`.

---

## File Structure

### New files

- `src/features/project/v4/hackathon-handover-sample-v4.ts` — IDs, fixed choreography data, two-NED2 Project factory, and exact sample recognition.
- `src/features/project/v4/hackathon-handover-sample-v4.test.ts` — Project topology, one-Definition/two-Instance sharing, generated Scene, and validation tests.
- `src/features/handover/v4/handover-demo-runtime-store.ts` — transient scenario, ownership, attachment offset, pose override, and fault state.
- `src/features/handover/v4/handover-demo-runtime-store.test.ts` — transition, continuity, Reset, and stale-generation tests.
- `src/features/handover/v4/handover-demo-coordinator.ts` — one RAF-driven, deterministic two-Robot state machine.
- `src/features/handover/v4/handover-demo-coordinator.test.ts` — happy path, timeout, cancel, Reset, and offline tests with a fake scheduler.
- `src/features/handover/v4/HandoverDemoSceneLayer.tsx` — visual-only Shared Zone wireframe; it never participates in collision.
- `src/features/handover/v4/HandoverDemoSceneLayer.test.tsx` — layer presence, ownership style, and disposal tests.
- `src/features/handover/v4/HandoverDemoStatusStrip.tsx` — compact Current Step, Part Owner, Shared Zone Owner, and failure presentation.
- `src/features/handover/v4/HandoverDemoStatusStrip.test.tsx` — accessible status copy and fault presentation.
- `tests/hackathon-handover-demo.spec.ts` — browser happy path, timeout, Reset, and OPC UA-off acceptance.

### Modified files

- `src/features/project/v4/browser-runtime-bundle-store-v4.ts` — include the optional Handover runtime/coordinator in the owned Job resources.
- `src/features/project/project-store-browser.ts` — create and dispose the Handover resources with each Project revision.
- `src/features/jobs/v4/job-operator-service.ts` and test — route the recognized representative Job to the Coordinator and expose Reset.
- `src/features/scene/v4/SpatialEntityScene.tsx` and test — consume a bounded World-pose override before the OPC UA/persisted fallback.
- `src/features/scene/v4/Workcell.tsx` and `src/features/scene/v4/SceneCanvas.tsx` — forward the pose override and render the Shared Zone layer.
- `src/features/ui/v4/Timeline.tsx` and test — add Reset and render the status strip only for the recognized sample Job.
- `src/app/v4/app-command-composition.ts` and test — add sample loading, Reset, and one runtime Fault Injection toggle.
- `src/app/App.tsx` and tests — load the sample, wire active Handover resources, and pass Gateway presentation only to the existing Header.
- `src/styles/global.css` — compact status strip and Shared Zone ownership colors without increasing dock minimum height.
- `README.md` and `docs/operator/working-demo-known-limitations.md` — demo runbook and explicit limitations.

---

### Task 1: Deterministic Two-NED2 Sample Project

**Files:**
- Create: `src/features/project/v4/hackathon-handover-sample-v4.ts`
- Create: `src/features/project/v4/hackathon-handover-sample-v4.test.ts`

**Interfaces:**
- Consumes: `createBuiltinNed2DefinitionV4()`, `createBuiltinNed2AssetReferencesV4()`, `computeSerialRobotPoseV4()`, and `validateWorkcellProjectV4()`.
- Produces: `HACKATHON_HANDOVER_IDS_V4`, `HACKATHON_HANDOVER_STEPS_V4`, `createHackathonHandoverSampleV4(options)`, and `isHackathonHandoverSampleV4(project)`.

- [ ] **Step 1: Write the failing topology tests**

```ts
it('shares one NED2 Definition across two independent Robot Instances', () => {
  const project = sample()
  expect(project.robotDefinitions).toHaveLength(1)
  expect(project.robots.map(({ definitionId }) => definitionId)).toEqual([
    BUILTIN_NED2_DEFINITION_ID_V4,
    BUILTIN_NED2_DEFINITION_ID_V4,
  ])
  expect(project.robots.map(({ id }) => id)).toEqual([
    HACKATHON_HANDOVER_IDS_V4.robotAId,
    HACKATHON_HANDOVER_IDS_V4.robotBId,
  ])
})

it('creates one representative Job and the three solid Scene primitives', () => {
  const project = sample()
  expect(project.jobs).toHaveLength(1)
  expect(project.jobs[0]?.id).toBe(HACKATHON_HANDOVER_IDS_V4.jobId)
  expect(project.spatialEntities.map(({ id }) => id)).toEqual([
    HACKATHON_HANDOVER_IDS_V4.tableId,
    HACKATHON_HANDOVER_IDS_V4.workpieceId,
    HACKATHON_HANDOVER_IDS_V4.outputTrayId,
  ])
})
```

- [ ] **Step 2: Run the sample test and prove it fails**

Run: `npx vitest run src/features/project/v4/hackathon-handover-sample-v4.test.ts`

Expected: FAIL because the sample module and exports do not exist.

- [ ] **Step 3: Implement exact IDs, poses, and the Project factory**

```ts
export const HACKATHON_HANDOVER_IDS_V4 = Object.freeze({
  robotAId: 'robot-hackathon-ned2-a',
  robotBId: 'robot-hackathon-ned2-b',
  jobId: 'job-hackathon-direct-handover',
  tableId: 'entity-hackathon-table',
  workpieceId: 'entity-hackathon-workpiece',
  outputTrayId: 'entity-hackathon-output-tray',
  sharedZoneId: 'runtime-hackathon-shared-zone',
})

export const HACKATHON_HANDOVER_STEPS_V4 = Object.freeze([
  'READY', 'PICK_APPROACH', 'PICK_GRIP', 'MOVE_TO_SHARED_ZONE',
  'HANDOVER_APPROACH', 'HANDOVER_CONFIRM', 'PLACE', 'COMPLETE',
] as const)

export function isHackathonHandoverSampleV4(project: WorkcellProjectV4): boolean {
  const ids = HACKATHON_HANDOVER_IDS_V4
  return project.jobs.some(({ id }) => id === ids.jobId)
    && project.robots.some(({ id }) => id === ids.robotAId)
    && project.robots.some(({ id }) => id === ids.robotBId)
    && project.spatialEntities.some(({ id }) => id === ids.workpieceId)
}
```

Use these Joint records, all within the checked-in NED2 limits:

```ts
const POSES = Object.freeze({
  home:   { J1: 0, J2: 0, J3: 0, J4: 0, J5: 0, J6: 0 },
  pick:   { J1: -35, J2: -38, J3: -52, J4: 0, J5: 58, J6: 0 },
  shared: { J1: 0, J2: -32, J3: -44, J4: 0, J5: 52, J6: 0 },
  place:  { J1: 35, J2: -38, J3: -52, J4: 0, J5: 58, J6: 0 },
})
```

Persist eight representative NED2-A steps so the existing Timeline has the
same index count as the Coordinator state machine:

```ts
const REPRESENTATIVE_POSES = [
  POSES.home, POSES.pick, POSES.pick, POSES.shared,
  POSES.shared, POSES.shared, POSES.home, POSES.home,
] as const
const steps = REPRESENTATIVE_POSES.map((jointValues, index) => ({
  kind: 'joint-pose' as const,
  jointValues,
  speedPercentToNext: index === REPRESENTATIVE_POSES.length - 1 ? 100 : 35,
}))
```

Compute the local Shared TCP pose from `POSES.shared`. Place NED2-A and a Z-rotated NED2-B so their Shared TCP World positions coincide, rather than hand-authoring a second approximate base. Derive the Workpiece initial pose from NED2-A's Pick TCP and the Output Tray center from NED2-B's Place TCP. Set both Robots' `intentionalMountEntityId` to the Table to suppress intentional Base/Table collision pairs.

- [ ] **Step 4: Run the sample tests**

Run: `npx vitest run src/features/project/v4/hackathon-handover-sample-v4.test.ts`

Expected: PASS, including `validateWorkcellProjectV4(project)` and exact TCP coincidence within `1e-6 m`.

- [ ] **Step 5: Commit the sample factory**

```powershell
git add src/features/project/v4/hackathon-handover-sample-v4.ts src/features/project/v4/hackathon-handover-sample-v4.test.ts
git commit -m "feat: add two-NED2 handover sample"
```

---

### Task 2: Transient Handover State and Pose Continuity

**Files:**
- Create: `src/features/handover/v4/handover-demo-runtime-store.ts`
- Create: `src/features/handover/v4/handover-demo-runtime-store.test.ts`

**Interfaces:**
- Consumes: `RigidTransformV4`, `composeRigidTransformV4()`, and `relativeRigidTransformV4()`.
- Produces: `HandoverDemoRuntimeStateV4`, `HandoverPoseOverrideV4`, and `createHandoverDemoRuntimeStoreV4(project)`.

- [ ] **Step 1: Write failing state, continuity, and stale-run tests**

```ts
it('changes attachment owner without moving the Workpiece in World space', () => {
  const store = runtime()
  const generation = store.getState().begin('run-1')
  store.getState().attach(generation, 'NED2-A', toolA, objectWorld)
  const before = store.getState().readWorldPose(HACKATHON_HANDOVER_IDS_V4.workpieceId)
  store.getState().transfer(generation, 'NED2-B', toolB)
  expect(store.getState().readWorldPose(HACKATHON_HANDOVER_IDS_V4.workpieceId)).toEqual(before)
})

it('ignores a transition from a reset generation', () => {
  const store = runtime()
  const stale = store.getState().begin('run-1')
  store.getState().reset()
  expect(store.getState().setStep(stale, 'PICK_GRIP')).toBe(false)
  expect(store.getState().step).toBe('READY')
})
```

- [ ] **Step 2: Run the store test and prove it fails**

Run: `npx vitest run src/features/handover/v4/handover-demo-runtime-store.test.ts`

Expected: FAIL because the runtime store does not exist.

- [ ] **Step 3: Implement the bounded runtime store**

```ts
export type HandoverPartOwnerV4 = 'TABLE' | 'NED2-A' | 'NED2-B' | 'OUTPUT_TRAY'
export type HandoverZoneOwnerV4 = 'NONE' | 'NED2-A' | 'NED2-B'
export type HandoverRunStateV4 = 'IDLE' | 'RUNNING' | 'SUCCEEDED' | 'FAULTED'

export interface HandoverPoseOverrideV4 {
  readWorldPose(entityId: string): RigidTransformV4 | null
}

export interface HandoverDemoRuntimeStateV4 extends HandoverPoseOverrideV4 {
  readonly runState: HandoverRunStateV4
  readonly step: typeof HACKATHON_HANDOVER_STEPS_V4[number]
  readonly partOwner: HandoverPartOwnerV4
  readonly sharedZoneOwner: HandoverZoneOwnerV4
  readonly failureCode: 'GRIP_CONFIRM_TIMEOUT' | null
  readonly injectGripConfirmTimeout: boolean
  readonly generation: number
  setFaultInjection(enabled: boolean): void
  begin(runId: string): number
  setStep(generation: number, step: HandoverDemoRuntimeStateV4['step']): boolean
  attach(generation: number, owner: 'NED2-A' | 'NED2-B', toolWorld: RigidTransformV4, objectWorld: RigidTransformV4): boolean
  updateAttachedPose(generation: number, owner: 'NED2-A' | 'NED2-B', toolWorld: RigidTransformV4): boolean
  transfer(generation: number, owner: 'NED2-A' | 'NED2-B', newToolWorld: RigidTransformV4): boolean
  place(generation: number, worldPose: RigidTransformV4): boolean
  complete(generation: number): boolean
  failGripConfirm(generation: number): boolean
  reset(): void
}
```

Store both the relative `toolToObject` transform and the current Workpiece World pose while attached. The Coordinator calls `updateAttachedPose()` after each owning-Robot Joint update. `transfer()` derives a new relative transform from the already captured Workpiece World pose and the new Tool pose, so `readWorldPose()` is continuous without requiring a callback. Every mutator compares the supplied generation before publishing.

- [ ] **Step 4: Run the store tests**

Run: `npx vitest run src/features/handover/v4/handover-demo-runtime-store.test.ts`

Expected: PASS for World-pose continuity, exact Reset, one-shot fault clearing, and stale-generation rejection.

- [ ] **Step 5: Commit the runtime store**

```powershell
git add src/features/handover/v4/handover-demo-runtime-store.ts src/features/handover/v4/handover-demo-runtime-store.test.ts
git commit -m "feat: add handover runtime state"
```

---

### Task 3: Two-Robot Handover Coordinator

**Files:**
- Create: `src/features/handover/v4/handover-demo-coordinator.ts`
- Create: `src/features/handover/v4/handover-demo-coordinator.test.ts`

**Interfaces:**
- Consumes: Task 1 sample IDs/keyframes, Task 2 runtime store, `RobotRuntimeRegistryV4`, `JobRuntimeStoreV4`, and `AnimationFrameSchedulerV4`.
- Produces: `HandoverDemoCoordinatorV4` and `createHandoverDemoCoordinatorV4(options)`.

- [ ] **Step 1: Write failing happy-path and timeout tests with a manual scheduler**

```ts
it('runs both Robots from one Job and completes offline', async () => {
  const h = harness({ gateway: null })
  h.coordinator.start(HACKATHON_HANDOVER_IDS_V4.jobId)
  await h.scheduler.advanceUntilIdle()
  expect(h.demo.getState()).toMatchObject({
    runState: 'SUCCEEDED', step: 'COMPLETE',
    partOwner: 'OUTPUT_TRAY', sharedZoneOwner: 'NONE',
  })
  expect(h.jobs.getState().byRobotId[HACKATHON_HANDOVER_IDS_V4.robotAId]).toMatchObject({ state: 'SUCCEEDED' })
})

it('fails after 2000 ms without transferring ownership', async () => {
  const h = harness()
  h.demo.getState().setFaultInjection(true)
  h.coordinator.start(HACKATHON_HANDOVER_IDS_V4.jobId)
  await h.scheduler.advanceToStep('HANDOVER_CONFIRM')
  await h.scheduler.advanceBy(1_999)
  expect(h.demo.getState().runState).toBe('RUNNING')
  await h.scheduler.advanceBy(1)
  expect(h.demo.getState()).toMatchObject({
    runState: 'FAULTED', failureCode: 'GRIP_CONFIRM_TIMEOUT',
    partOwner: 'NED2-A', sharedZoneOwner: 'NED2-A',
  })
})
```

- [ ] **Step 2: Run the coordinator test and prove it fails**

Run: `npx vitest run src/features/handover/v4/handover-demo-coordinator.test.ts`

Expected: FAIL because the Coordinator does not exist.

- [ ] **Step 3: Implement the Coordinator contract and fixed state machine**

```ts
export interface HandoverDemoCoordinatorV4 {
  canHandle(jobId: string): boolean
  canStart(jobId: string): boolean
  start(jobId: string): { readonly runId: string }
  canCancel(): boolean
  cancel(reason: string): void
  canReset(jobId: string): boolean
  reset(): void
  setGripConfirmTimeoutInjection(enabled: boolean): void
  dispose(): void
}
```

Use `transitionDurationMsV4()` and `sampleJointTransitionV4()` for each motion segment. After every Joint write, compute the selected TCP World pose from the NED2 Definition, current Joint record, and authored Base pose. The fixed state machine is:

```ts
READY -> PICK_APPROACH -> PICK_GRIP -> MOVE_TO_SHARED_ZONE
  -> HANDOVER_APPROACH -> HANDOVER_CONFIRM -> PLACE -> COMPLETE
```

Normal Grip Confirm resolves after 250 ms. When injection is enabled, do not resolve it; fail exactly at 2,000 ms. Publish only NED2-A's representative Job state, leave NED2-B's Job state IDLE, and still write both Robot registries. On `dispose()` or `reset()`, cancel the RAF, increment the generation, restore both Robots from the Project, restore the Workpiece, and prevent old callbacks from publishing.

- [ ] **Step 4: Run the coordinator tests**

Run: `npx vitest run src/features/handover/v4/handover-demo-coordinator.test.ts`

Expected: PASS for happy path, exact timeout boundary, cancel, Reset, double-Start rejection, and disposed-callback rejection.

- [ ] **Step 5: Commit the Coordinator**

```powershell
git add src/features/handover/v4/handover-demo-coordinator.ts src/features/handover/v4/handover-demo-coordinator.test.ts
git commit -m "feat: coordinate NED2 direct handover"
```

---

### Task 4: Own the Coordinator in the Project Runtime Bundle

**Files:**
- Modify: `src/features/project/v4/browser-runtime-bundle-store-v4.ts`
- Modify: `src/features/project/v4/browser-runtime-bundle-store-v4.test.ts`
- Modify: `src/features/project/project-store-browser.ts`
- Modify: `src/features/project/v4/browser-project-runtime-v4.test.ts`
- Modify: `src/features/jobs/v4/job-operator-service.ts`
- Modify: `src/features/jobs/v4/job-operator-service.test.ts`

**Interfaces:**
- Consumes: Task 2 store and Task 3 Coordinator.
- Produces: optional `handover` resources on `BrowserJobRuntimeResourcesV4`; `JobOperatorServiceV4.canReset()` and `reset()`.

- [ ] **Step 1: Write failing routing and lifecycle tests**

```ts
it('routes only the representative Job through the Handover Coordinator', async () => {
  await service.start(ids.robotAId, ids.jobId)
  expect(handover.start).toHaveBeenCalledWith(ids.jobId)
  expect(playback.startJob).not.toHaveBeenCalled()
  await service.start('ordinary-robot', 'ordinary-job')
  expect(playback.startJob).toHaveBeenCalledWith('ordinary-job')
})

it('disposes handover resources with a rejected or replaced runtime bundle', async () => {
  const prepared = await runtime.prepare(sample, sample.revisionId)
  await runtime.dispose(prepared)
  expect(prepared.resources.activeBundle.jobs.handover?.coordinator.dispose).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run focused lifecycle tests and prove they fail**

Run: `npx vitest run src/features/jobs/v4/job-operator-service.test.ts src/features/project/v4/browser-project-runtime-v4.test.ts`

Expected: FAIL because Job resources have no Handover boundary.

- [ ] **Step 3: Extend the resource and operator interfaces**

```ts
export interface BrowserHandoverRuntimeResourcesV4 {
  readonly store: StoreApi<HandoverDemoRuntimeStateV4>
  readonly coordinator: HandoverDemoCoordinatorV4
}

export interface BrowserJobRuntimeResourcesV4 {
  readonly executor: RobotJobExecutorV4
  readonly playback: RobotJobPlaybackControllerV4
  readonly handover: BrowserHandoverRuntimeResourcesV4 | null
  dispose(): void
}
```

Create these resources only when `isHackathonHandoverSampleV4(project)` is true. Dispose the Coordinator before shutting down the normal executor. In `JobOperatorServiceV4`, delegate Start/Cancel/Reset to Handover only when `handover.coordinator.canHandle(jobId)` is true; keep every ordinary Job path unchanged.

- [ ] **Step 4: Run lifecycle and existing Job tests**

Run: `npx vitest run src/features/jobs/v4 src/features/project/v4/browser-project-runtime-v4.test.ts src/features/project/v4/browser-runtime-bundle-store-v4.test.ts`

Expected: PASS with no change to ordinary Job behavior and no stale runtime publication.

- [ ] **Step 5: Commit runtime ownership wiring**

```powershell
git add src/features/project/v4/browser-runtime-bundle-store-v4.ts src/features/project/v4/browser-runtime-bundle-store-v4.test.ts src/features/project/project-store-browser.ts src/features/project/v4/browser-project-runtime-v4.test.ts src/features/jobs/v4/job-operator-service.ts src/features/jobs/v4/job-operator-service.test.ts
git commit -m "feat: publish handover runtime resources"
```

---

### Task 5: Render the Attached Workpiece and Visual-Only Shared Zone

**Files:**
- Create: `src/features/handover/v4/HandoverDemoSceneLayer.tsx`
- Create: `src/features/handover/v4/HandoverDemoSceneLayer.test.tsx`
- Modify: `src/features/scene/v4/SpatialEntityScene.tsx`
- Modify: `src/features/scene/v4/SpatialEntityScene.test.tsx`
- Modify: `src/features/scene/v4/Workcell.tsx`
- Modify: `src/features/scene/v4/SceneCanvas.tsx`

**Interfaces:**
- Consumes: Task 2 `HandoverPoseOverrideV4` and runtime owner state.
- Produces: `poseOverride?: HandoverPoseOverrideV4 | null` through SceneCanvas -> Workcell -> SpatialEntityScene, plus `HandoverDemoSceneLayerV4`.

- [ ] **Step 1: Write failing pose-priority and Shared Zone tests**

```ts
it('uses a Handover World-pose override for the Workpiece', () => {
  const overridePose = pose([0.2, 0.1, 1.0])
  const effective = createSpatialEntityEffectiveTransformRuntimeV4(
    project, sceneRuntime, null,
    { readWorldPose: (id) => id === ids.workpieceId ? overridePose : null },
  )
  effective.update(0)
  expect(effective.readEntityWorldPose(ids.workpieceId)).toEqual(overridePose)
  expect(effective.isEntityDynamicallyDriven(ids.workpieceId)).toBe(true)
})

it('renders one visual-only Shared Zone and no collision proxy', () => {
  const view = renderSceneLayer({ owner: 'NED2-A' })
  expect(view.sharedZone.userData.sharedZoneOwner).toBe('NED2-A')
  expect(sceneRegistration.collisionProxies).toHaveLength(0)
})
```

- [ ] **Step 2: Run renderer tests and prove they fail**

Run: `npx vitest run src/features/scene/v4/SpatialEntityScene.test.tsx src/features/handover/v4/HandoverDemoSceneLayer.test.tsx`

Expected: FAIL because the pose override and Shared Zone layer are absent.

- [ ] **Step 3: Add the bounded override and Scene layer**

Extend `createSpatialEntityEffectiveTransformRuntimeV4()` with a fourth optional argument. Resolve in this order:

```ts
const override = poseOverride?.readWorldPose(entityId) ?? null
if (override !== null) return { pose: override, dynamic: true }
// existing OPC UA moving-frame graph follows
// persisted Project pose remains the final fallback
```

Render the Shared Zone as one transparent `BoxGeometry` with a wireframe material. Its owner changes only its color: neutral gray, NED2-A cyan, NED2-B amber. Store inspection metadata in `Object3D.userData.sharedZoneOwner`; never pass DOM-only `data-*` props into an R3F Three Object. Create and dispose its Geometry and Material inside the component. Do not register it as a Spatial Entity and do not create a collision proxy.

- [ ] **Step 4: Run renderer and collision tests**

Run: `npx vitest run src/features/scene/v4/SpatialEntityScene.test.tsx src/features/handover/v4/HandoverDemoSceneLayer.test.tsx src/features/collision/v4`

Expected: PASS; Workpiece collision follows the dynamic World pose, while Shared Zone adds zero collision candidates.

- [ ] **Step 5: Commit Scene integration**

```powershell
git add src/features/handover/v4/HandoverDemoSceneLayer.tsx src/features/handover/v4/HandoverDemoSceneLayer.test.tsx src/features/scene/v4/SpatialEntityScene.tsx src/features/scene/v4/SpatialEntityScene.test.tsx src/features/scene/v4/Workcell.tsx src/features/scene/v4/SceneCanvas.tsx
git commit -m "feat: render direct handover ownership"
```

---

### Task 6: Minimal Job UI, Reset, Sample Command, and Fault Toggle

**Files:**
- Create: `src/features/handover/v4/HandoverDemoStatusStrip.tsx`
- Create: `src/features/handover/v4/HandoverDemoStatusStrip.test.tsx`
- Modify: `src/features/ui/v4/Timeline.tsx`
- Modify: `src/features/ui/v4/Timeline.test.tsx`
- Modify: `src/app/v4/app-command-composition.ts`
- Modify: `src/app/v4/app-command-composition.test.ts`
- Modify: `src/features/ui/v4/app-menu-model.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: active runtime bundle `jobs.handover`, `JobOperatorServiceV4.reset()`, and Task 1 sample factory.
- Produces: `project.sample.handover`, `job.reset`, and `simulation.fault.gripConfirmTimeout` commands.

- [ ] **Step 1: Write failing UI and command tests**

```tsx
expect(screen.getByRole('button', { name: 'Reset Handover Demo' })).toBeEnabled()
expect(screen.getByRole('status', { name: 'Handover demo status' })).toHaveTextContent(
  'HANDOVER_CONFIRM Part NED2-A Shared Zone NED2-A',
)

expect(registry.get('simulation.fault.gripConfirmTimeout')).toMatchObject({
  kind: 'toggle', visible: true, enabled: true,
})
await registry.get('project.sample.handover')!.execute()
expect(actions.project.loadHackathonHandoverSample).toHaveBeenCalledOnce()
```

- [ ] **Step 2: Run UI tests and prove they fail**

Run: `npx vitest run src/features/handover/v4/HandoverDemoStatusStrip.test.tsx src/features/ui/v4/Timeline.test.tsx src/app/v4/app-command-composition.test.ts src/app/App.test.tsx`

Expected: FAIL because the controls and status presentation do not exist.

- [ ] **Step 3: Implement the minimal UI and command wiring**

Add these placements:

```ts
project: ['project.sample.handover', 'project.samples', 'Samples']
job: ['job.start', null, null], ['job.cancel', null, null], ['job.reset', null, null]
simulation: ['simulation.fault.gripConfirmTimeout', 'simulation.faults', 'Fault Injection']
```

The Timeline renders Reset and `HandoverDemoStatusStripV4` only when the active Job is the representative Handover Job and active Handover resources match the current Project revision. The strip renders:

```text
Step <STEP> | Part <OWNER> | Shared Zone <OWNER> | <FAILURE when present>
```

Do not duplicate OPC UA status in the strip. Continue using `StudioHeaderV4` and `composeAppHeaderStatusV4()` as the single Gateway/OPC UA presentation. Add one `loadHackathonHandoverSample()` action beside the existing dual-Robot sample loader.

- [ ] **Step 4: Run all UI and menu tests**

Run: `npx vitest run src/features/handover/v4/HandoverDemoStatusStrip.test.tsx src/features/ui/v4/Timeline.test.tsx src/app/v4/app-command-composition.test.ts src/features/ui/v4/app-menu-model.test.ts src/app/App.test.tsx`

Expected: PASS with no additional permanent viewport overlay and no Bottom dock overflow.

- [ ] **Step 5: Commit the UI**

```powershell
git add src/features/handover/v4/HandoverDemoStatusStrip.tsx src/features/handover/v4/HandoverDemoStatusStrip.test.tsx src/features/ui/v4/Timeline.tsx src/features/ui/v4/Timeline.test.tsx src/app/v4/app-command-composition.ts src/app/v4/app-command-composition.test.ts src/features/ui/v4/app-menu-model.test.ts src/app/App.tsx src/app/App.test.tsx src/styles/global.css
git commit -m "feat: add minimal handover demo controls"
```

---

### Task 7: Browser Acceptance, Visual Pose Check, and Operator Documentation

**Files:**
- Create: `tests/hackathon-handover-demo.spec.ts`
- Modify: `README.md`
- Modify: `docs/operator/working-demo-known-limitations.md`
- Modify only if visual evidence requires it: `src/features/project/v4/hackathon-handover-sample-v4.ts`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: browser-verifiable happy/fault/reset flow and the Hackathon runbook.

- [ ] **Step 1: Write the browser acceptance test before final visual tuning**

```ts
test('runs and resets the offline direct-handover demonstration', async ({ page }) => {
  await page.goto('/')
  await loadProjectSample(page, 'NED2 Direct Handover Demo')
  await expect(page.getByText('NED2-A')).toBeVisible()
  await expect(page.getByText('NED2-B')).toBeVisible()
  await page.getByRole('button', { name: 'Start Job' }).click()
  await expect(page.getByRole('status', { name: 'Handover demo status' }))
    .toContainText('COMPLETE Part OUTPUT_TRAY Shared Zone NONE')
  await expect(page.getByRole('button', { name: /Gateway details:.*Offline/ })).toBeVisible()
  await page.getByRole('button', { name: 'Reset Handover Demo' }).click()
  await expect(page.getByRole('status', { name: 'Handover demo status' }))
    .toContainText('READY Part TABLE Shared Zone NONE')
})
```

Add a second test that toggles `Grip Confirm Timeout`, starts the Job, asserts `GRIP_CONFIRM_TIMEOUT`, asserts Part/Zone ownership stays at NED2-A, then Reset returns READY and clears the toggle.

- [ ] **Step 2: Run the new browser test and capture the initial failure**

Run: `npx playwright test tests/hackathon-handover-demo.spec.ts`

Expected: FAIL only for visual/selector issues not already covered by unit tests. A functional failure returns to the owning task instead of being patched in the E2E test.

- [ ] **Step 3: Inspect the live browser at the four visual checkpoints**

Capture screenshots at `READY`, `PICK_GRIP`, `HANDOVER_CONFIRM`, and `COMPLETE`. Verify both Robot meshes render, the Workpiece is visibly at the active TCP, both Shared TCPs coincide during handover, the Shared Zone does not obscure the Robots, and the Output Tray contains the placed Workpiece. If a keyframe needs correction, edit only the four `POSES` constants in the sample factory and retain the exact TCP-coincidence test.

- [ ] **Step 4: Document the runbook and limitations**

Add this operator flow to README and the limitations document:

```text
Project > Samples > NED2 Direct Handover Demo
Select NED2 Direct Handover Job
Start Job
Observe Current Step, Part Owner, Shared Zone Owner, and Header OPC UA Status
Reset Handover Demo

Fault test:
Simulation > Fault Injection > Grip Confirm Timeout
Start Job
Observe GRIP_CONFIRM_TIMEOUT at HANDOVER_CONFIRM
Reset Handover Demo
```

State explicitly that the demo uses fixed Joint keyframes, no physics/IK, a local simulated Grip Confirm, and no safety-rated validation.

- [ ] **Step 5: Run the full verification gate**

Run in order:

```powershell
npm run lint
npm run test:run
npm run build
npm run test:e2e:v4
npm run test:e2e:viewport
npm run test:e2e:layout
npx playwright test tests/hackathon-handover-demo.spec.ts
git diff --check
```

Expected: lint passes; all unit tests pass; production build passes; all existing and new Playwright tests pass; `git diff --check` emits no errors. Gateway `ECONNREFUSED 127.0.0.1:8081` is acceptable only when the UI reports Offline and the Handover happy path still succeeds.

- [ ] **Step 6: Commit the acceptance proof and documentation**

```powershell
git add tests/hackathon-handover-demo.spec.ts README.md docs/operator/working-demo-known-limitations.md src/features/project/v4/hackathon-handover-sample-v4.ts
git commit -m "test: verify offline NED2 handover demo"
```

- [ ] **Step 7: Push only after confirming the intended branch and staged scope**

```powershell
git status -sb
git log --oneline --decorate -8
git push origin HEAD
```

Expected: the selected branch is synchronized with its remote and the user-owned external STEP, backup, package-store, and artifact directories remain untracked.

---

## Plan Self-Review Result

- Spec coverage: one shared NED2 asset, two Runtime Instances, four code-created visual elements, one-click Job, ownership transitions, offline OPC UA status, Reset, timeout fault, and verification all map to explicit tasks.
- Scope: Project V4 remains the UI boundary; V5 promotion and generic orchestration are excluded.
- Type consistency: the same `HandoverDemoCoordinatorV4`, `HandoverDemoRuntimeStateV4`, and `HandoverPoseOverrideV4` names are used from creation through bundle, renderer, and UI wiring.
- Completeness scan: every implementation step has an exact file, interface, command, and expected result.
