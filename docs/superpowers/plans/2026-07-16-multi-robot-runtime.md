# Project V4 Multi-Robot Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the browser from Project V3 to Project V4 and provide a deterministic, instance-keyed runtime for one through eight articulated Robots, arbitrary one-through-sixteen-Joint serial chains, moving Base Frames, Robot-owned Jobs, and collision-safe heterogeneous rendering.

**Architecture:** Keep transform, serial-kinematics, Job timeline, and collision-identity rules in dependency-free `src/core` modules. Build browser runtime registries keyed by stable Robot ID, render each Instance from a reusable Robot Definition geometry bundle, and publish the whole V4 runtime atomically through the P1 repository/coordinator. The final cutover removes the fixed-six/single-Robot and automatic-nearest-grasp paths; explicit Attachment behavior is added only by P7 through its shared `ActionExecutorV4`.

**Tech Stack:** React 19.2.7, TypeScript 6.0.3, Zustand 5.0.14, Three.js 0.185.1, React Three Fiber 9.6.1, Dexie 4.4.4, Vitest 4.1.10, Playwright 1.61.1, Vite 8.1.4, Node 22.15.1, npm 11.4.2.

## Global Constraints

- Begin from the landed P1 plan `docs/superpowers/plans/2026-07-16-project-v4-core-contracts.md`.
- Tasks 1-6 may add dark V4 named exports while the landed P1 browser still uses V3. Task 7 switches every production import to V4 atomically; Task 8 deletes the now-unreferenced V3/fixed runtime. No browser session may combine a V3 Project with V4 runtime state.
- Project V4 is the only browser Project format after this plan. Reject V1, V2, and V3 as `PROJECT_SCHEMA_UNSUPPORTED`; add no migration, Legacy Adoption, compatibility mode, or `Legacy*` API.
- `src/core` imports no React, Three.js, Zustand, WebSocket, filesystem, browser DOM, or `node-opcua` module.
- Use metres, right-handed Z-up coordinates, normalized quaternion `[x, y, z, w]`, and RPY degrees composed as `Rz * Ry * Rx`.
- Revolute Joint values are degrees and prismatic Joint values are metres. Never pad, truncate, or index a Robot as a fixed six-angle tuple.
- Support exactly 1-8 Robot Instances, 1-16 Joints and 2-17 Links per Definition, and independent state for Instances that share a Definition.
- Compute a Robot Base only as `world(baseParentFrameId) * localBasePose`; Mechanics and Scene state do not contain a second Base transform.
- A Job belongs to exactly one Robot. Different Robots may execute concurrently; one Robot may have at most one running Job.
- P2 does not execute `action-reference` Job steps. Its explicit `JobActionExecutionPortV4` fails with `ACTION_EXECUTOR_UNAVAILABLE` until P7 injects `ActionExecutorV4`.
- Remove and disable automatic nearest-Object grasp at the V4 cutover. Closing or opening a Gripper changes only Gripper state and cannot attach, release, reparent, or choose an Object.
- Namespace Robot collision proxies as `robot-link:<robotId>:<linkId>` and Tool proxies as `tool:<robotId>:<toolFrameId>`. Adjacency exclusions apply only within one Robot Instance.
- Geometry collision remains geometric validation, not a physics response.
- Preserve logical `asset://` and versioned `builtin://` references; never persist physical paths or STEP bytes.
- Keep source comments in English and preserve unrelated/untracked CAD directories.
- Every task ends with focused tests, `npm run lint`, `npm run build`, and one commit.

---

## File Structure

**Create:**

- `src/core/robot-runtime/frame-graph.ts` and test — dependency-free parent resolution and World transforms.
- `src/core/robot-runtime/serial-kinematics.ts` and test — variable revolute/prismatic serial-chain evaluation.
- `src/core/robot-runtime/job-timeline.ts` and test — ID-keyed interpolation and transition durations.
- `src/core/robot-runtime/collision-identity.ts` and test — namespaced IDs and definition-derived adjacency.
- `src/core/robot-runtime/index.ts` — public P2 Core boundary.
- `src/features/robot/v4/robot-runtime-registry.ts` and test — keyed Robot live state.
- `src/features/robot/v4/builtin-ned2-definition.ts` and test — checked-in NED2 Definition/geometry bridge used before P3 authoring.
- `src/features/robot/v4/robot-definition-geometry-repository.ts` and test — reusable Definition geometry bundles.
- `src/features/robot/v4/RobotInstanceModel.tsx` and test — one articulated Instance renderer.
- `src/features/robot/v4/RobotFleet.tsx` and test — project Robot iteration and registration.
- `src/features/jobs/v4/job-runtime-store.ts` and test — per-Robot Job session state.
- `src/features/jobs/v4/job-command-service.ts` and test — V4 Job authoring mutations.
- `src/features/jobs/v4/job-executor.ts` and test — deterministic multi-Robot execution.
- `src/features/project/v4/project-mutation-port.ts` — narrow mutation seam used before the concrete Task 7 service exists.
- `src/features/scene/v4/scene-runtime-selector.ts` and test — V4 Frames, visibility, and render projection.
- `src/features/scene/v4/scene-runtime-store.ts` and test — atomic published Scene projection consumed by React.
- `src/features/scene/v4/MovingFrameInspector.tsx` and test — generic named Moving Frame editing without a dedicated linear-axis model.
- `src/features/project/v4/project-v4-mutation-service.ts` and test — serialized V4 recipes.
- `src/features/project/v4/default-project-v4.ts` and test — valid builtin NED2 V4 Project.
- `src/features/project/v4/browser-project-runtime-v4.ts` and test — atomic browser resource preparation.
- `src/features/project/v4/project-store-v4.ts` and test — V4 New/Save/Import/Export state.
- `tests/project-v4-multi-robot.spec.ts` — browser cutover and independent Robot acceptance.

**Modify:**

- `src/core/project-v4/index.ts`
- `src/domain/collision/collision.ts`
- `src/domain/collision/query-collision.ts`
- `src/domain/collision/mount-contact.ts`
- `src/features/collision/scene-entity-adapter.ts`
- `src/features/collision/current-pose-collision.ts`
- `src/features/collision/CurrentPoseCollisionSystem.tsx`
- `src/features/collision/collision-validation-protocol.ts`
- `src/features/collision/collision-validation.worker.ts`
- `src/features/collision/validate-pose-sequence.ts`
- `src/features/collision/CollisionPanel.tsx`
- `src/features/interaction/interaction-store.ts`
- `src/features/interaction/interaction-math.ts`
- `src/features/interaction/outline-state.ts`
- `src/features/equipment/EquipmentScene.tsx`
- `src/features/import/imported-equipment-actions.ts`
- `src/features/scene/Workcell.tsx`
- `src/features/scene/SceneCanvas.tsx`
- `src/features/scene/SceneExplorer.tsx`
- `src/features/scene/SceneEntityInspector.tsx`
- `src/features/scene/RobotMountContactEditor.tsx`
- `src/features/scene/scene-command-service.ts`
- `src/features/scene/scene-context-request.ts`
- `src/features/scene/scene-editor-store.ts`
- `src/features/scene/scene-ui-test-fixtures.ts`
- `src/features/frames/coordinate-frame-store.ts`
- `src/features/frames/CoordinateFramesDialog.tsx`
- `src/features/jobs/RobotJobList.tsx`
- `src/features/joints/JointInspector.tsx`
- `src/features/ui/Timeline.tsx`
- `src/features/project/ProjectMenu.tsx`
- `src/features/project/project-store-browser.ts`
- `src/app/initial-project-bootstrap.ts`
- `src/app/safe-scene-deletion.ts`
- `src/app/App.tsx`
- `src/app/AppShell.tsx`
- `src/domain/project/project.ts`
- `package.json`

**Delete at the Task 8 cutover:**

- Fixed Robot runtime: `src/domain/robot/joint-frame.ts`, `src/domain/robot/joint-frame.test.ts`, `src/domain/robot/kinematics.ts`, `src/domain/robot/kinematics.test.ts`, `src/features/joints/robot-store.ts`, `src/features/joints/robot-store.test.ts`, `src/features/joints/keyframes.ts`, `src/features/joints/keyframes.test.ts`, `src/features/joints/SimulationJointSource.ts`, `src/features/robot/RobotModel.tsx`, `src/features/robot/RobotModel.test.ts`, and `src/features/robot/RobotGripper.tsx`.
- Fixed NED2/authoring lane: `src/domain/robot/NED2.ts`, `src/features/interaction/robot-collision-bounds.ts`, `src/features/robot/default-robot-geometry.ts`, `src/features/robot/default-robot-geometry.test.ts`, `src/features/robot/RobotConfigurationDialog.tsx`, `src/features/robot/RobotConfigurationDialog.test.tsx`, `src/features/robot/robot-configuration-store.ts`, `src/features/robot/robot-configuration-store.test.ts`, `src/features/robot/robot-geometry-db.ts`, `src/features/robot/RobotGeometryDialog.tsx`, `src/features/robot/RobotGeometryDialog.test.tsx`, `src/features/robot/robot-geometry-repository.ts`, `src/features/robot/robot-geometry-repository.test.ts`, `src/features/robot/robot-geometry-store.ts`, `src/features/robot/robot-geometry-store.test.ts`, `src/features/robot/RobotImportDialog.tsx`, `src/features/robot/RobotImportDialog.test.tsx`, `src/features/robot/robot-step-import.ts`, and `src/features/robot/robot-step-import.test.ts`. P3 replaces authoring with Definition-driven Assembly mapping.
- Fixed Job/OPC UA source lane: `src/features/jobs/job-command-service.ts`, `src/features/jobs/job-command-service.test.ts`, `src/features/joints/OpcUaJointSource.ts`, `src/features/joints/OpcUaJointSource.test.ts`, `src/features/joints/opcua-gateway-url.ts`, and `src/features/joints/opcua-gateway-url.test.ts`. P4 provides the V4 Runtime Gateway source.
- Fixed Scene transform/linear-axis lane: `src/domain/scene/scene-transform.ts`, `src/domain/scene/scene-transform.test.ts`, `src/features/scene/scene-runtime-selector.ts`, `src/features/scene/scene-runtime-selector.test.ts`, `src/features/scene/LinearAxisInspector.tsx`, `src/features/scene/LinearAxisInspector.test.tsx`, `src/features/scene/LinearAxisRuntime.tsx`, `src/features/scene/LinearAxisRuntime.test.tsx`, `src/features/scene/linear-axis-source.ts`, and `src/features/scene/linear-axis-source.test.ts`.
- Automatic grasp: `src/features/interaction/GraspController.tsx`, `src/features/interaction/GraspController.test.tsx`, `src/features/interaction/grasp-actions.ts`, `src/features/interaction/grasp-actions.test.ts`, `src/features/interaction/grasp-participants.ts`, `src/features/interaction/grasp-participants.test.ts`, `src/features/interaction/geometry-grasp-sensor.ts`, and `src/features/interaction/geometry-grasp-sensor.test.ts`.
- V3 Project lane: `src/domain/project/project-v3.ts`, `src/domain/project/project-v3.test.ts`, `src/domain/project/project-source-staging.test-support.ts`, `src/domain/project/robot-source-v3.ts`, `src/domain/project/external-entity-v3.ts`, `src/domain/project/object-asset-v3.ts`, `src/domain/project/opcua-numeric-status-binding-v3.ts`, `src/domain/project/opcua-transform-binding-v3.ts`, `src/domain/project/scene-state-v1.ts`, `src/domain/project/scene-state-v1.test.ts`, `src/domain/project/simulation-duration-v3.ts`, `src/domain/project/simulation-duration-v3.test.ts`, and `src/domain/project/simulation-job-v1.ts`.
- V3 browser persistence/archive: `src/features/project/browser-project-runtime.ts`, `src/features/project/browser-project-runtime.test.ts`, `src/features/project/project-archive-worker.ts`, `src/features/project/project-archive-worker.test.ts`, `src/features/project/project-codec.ts`, `src/features/project/project-codec.test.ts`, `src/features/project/project-db.ts`, `src/features/project/project-db.test.ts`, `src/features/project/project-mutation-service.ts`, `src/features/project/project-mutation-service.test.ts`, `src/features/project/project-publication-coordinator.ts`, `src/features/project/project-publication-coordinator.test.ts`, `src/features/project/project-revision-canonical.ts`, `src/features/project/project-revision-hydration.ts`, `src/features/project/project-revision-hydration.test.ts`, `src/features/project/project-revision-repository.ts`, `src/features/project/project-revision-repository.test.ts`, `src/features/project/project-revision-repository.test-support.ts`, `src/features/project/project-revision-storage.ts`, `src/features/project/project-revision-storage.test.ts`, `src/features/project/project-source-staging.ts`, `src/features/project/project-source-staging.test.ts`, `src/features/project/project-store.ts`, `src/features/project/project-store.test.ts`, `src/features/project/project-v3-archive.ts`, and `src/features/project/project-v3-archive.test.ts`.
- V3 browser fixtures: `tests/project-v3-roundtrip.spec.ts`, `tests/project-archive-worker.browser.ts`, `tests/project-archive-worker.html`, `tests/project-archive-worker.spec.ts`, `tests/project-hash-worker.browser.ts`, `tests/project-hash-worker.html`, and `tests/project-hash-worker.spec.ts`.

### Task 1: Add the Pure Frame Graph and Variable Serial Kinematics

**Files:**
- Create: `src/core/robot-runtime/frame-graph.ts`
- Test: `src/core/robot-runtime/frame-graph.test.ts`
- Create: `src/core/robot-runtime/serial-kinematics.ts`
- Test: `src/core/robot-runtime/serial-kinematics.test.ts`
- Create: `src/core/robot-runtime/index.ts`
- Modify: `src/core/project-v4/index.ts`

**Interfaces:**
- Consumes: `RigidTransformV4`, `RobotDefinitionV4`, `RobotInstanceV4`, `composeRigidTransformV4`, `invertRigidTransformV4`, and `relativeRigidTransformV4` from P1.
- Produces: `FrameGraphNodeV4`, `resolveWorldFrameMapV4`, `reparentFramePreservingWorldV4`, `SerialRobotPoseV4`, `computeSerialRobotPoseV4`, and `jointMotionTransformV4`.

- [ ] **Step 1: Write RED Frame graph and serial-chain tests**

```ts
it('resolves a Robot Base through one moving parent without a duplicate Base pose', () => {
  const world = resolveWorldFrameMapV4([
    node('world', null, pose()),
    node('carriage', 'world', pose([1, 0, 0])),
    node('robot-a:base', 'carriage', pose([0, 0, 0.5])),
  ])
  expect(world.get('robot-a:base')?.positionM).toEqual([1, 0, 0.5])
})

it('moves only the configured child subtree for mixed Joint types', () => {
  const definition = serialDefinition([
    revolute('j1', 'l0', 'l1', [0, 0, 1]),
    prismatic('j2', 'l1', 'l2', [1, 0, 0]),
  ])
  const home = computeSerialRobotPoseV4(definition, { j1: 0, j2: 0 })
  const moved = computeSerialRobotPoseV4(definition, { j1: 90, j2: 0.2 })
  expect(moved.linkLocalPoses.l0).toEqual(home.linkLocalPoses.l0)
  expect(moved.linkWorldPoses.l2.positionM).not.toEqual(home.linkWorldPoses.l2.positionM)
})

it.each([0, 17])('rejects a %i-Joint runtime definition', (jointCount) => {
  expect(() => computeSerialRobotPoseV4(
    serialDefinitionWithJointCount(jointCount),
    {},
  )).toThrow(jointCount === 0 ? 'ROBOT_JOINT_COUNT_TOO_SMALL' : 'ROBOT_JOINT_LIMIT_EXCEEDED')
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/core/robot-runtime/frame-graph.test.ts src/core/robot-runtime/serial-kinematics.test.ts
```

Expected: FAIL because `src/core/robot-runtime` does not exist.

- [ ] **Step 3: Implement the dependency-free Frame graph**

```ts
export interface FrameGraphNodeV4 {
  readonly frameId: string
  readonly parentFrameId: string | null
  readonly localPose: RigidTransformV4
}

export function resolveWorldFrameMapV4(
  nodes: readonly FrameGraphNodeV4[],
): ReadonlyMap<string, RigidTransformV4>

export function reparentFramePreservingWorldV4(
  nodes: readonly FrameGraphNodeV4[],
  frameId: string,
  nextParentFrameId: string | null,
): readonly FrameGraphNodeV4[]
```

Index every Frame once, reject duplicate IDs as `FRAME_ID_DUPLICATE`, reject missing parents as `FRAME_PARENT_NOT_FOUND`, and use white/gray/black visitation to reject cycles as `FRAME_CYCLE`. Reparent by capturing the current World pose and calculating `relativeRigidTransformV4(nextParentWorld, currentWorld)`.

- [ ] **Step 4: Implement definition-driven serial kinematics**

```ts
export interface SerialRobotPoseV4 {
  readonly jointValues: Readonly<Record<string, number>>
  readonly linkLocalPoses: Readonly<Record<string, RigidTransformV4>>
  readonly linkWorldPoses: Readonly<Record<string, RigidTransformV4>>
  readonly frameWorldPoses: Readonly<Record<string, RigidTransformV4>>
}

export function jointMotionTransformV4(
  joint: RobotJointDefinitionV4,
  commandedValue: number,
): RigidTransformV4

export function computeSerialRobotPoseV4(
  definition: RobotDefinitionV4,
  jointValues: Readonly<Record<string, number>>,
  worldBasePose?: RigidTransformV4,
): SerialRobotPoseV4
```

Apply `direction * (commandedValue + zeroOffset)` after range validation. Convert revolute degrees to a quaternion around the normalized axis; translate prismatic metres along that axis. Compose each Joint as `parentLinkWorld * joint.origin * jointMotion`, assign only its child Link and descendants, and derive Definition Frames from their configured owner Link. Do not branch on Joint names or array positions.

- [ ] **Step 5: Run GREEN and the Core dependency scan**

```powershell
npm run test:run -- src/core/robot-runtime
rg -n 'from .(react|three|zustand|node:|ws|node-opcua)' src/core
rg -n '\b(window|document)\b' src/core
npm run lint
npm run build
```

Expected: all Frame/kinematic tests PASS and `rg` returns no matches.

- [ ] **Step 6: Commit**

```powershell
git add src/core/robot-runtime src/core/project-v4/index.ts
git diff --cached --check
git commit -m "feat: add variable robot kinematics core"
```

### Task 2: Add the Robot-ID-Keyed Runtime Registry

**Files:**
- Create: `src/features/robot/v4/robot-runtime-registry.ts`
- Test: `src/features/robot/v4/robot-runtime-registry.test.ts`

**Interfaces:**
- Consumes: `WorkcellProjectV4`, `RobotDefinitionV4`, `RobotInstanceV4`, and `computeSerialRobotPoseV4`.
- Produces: `RobotRuntimeStateV4`, `RobotRuntimeRegistryV4`, `createRobotRuntimeRegistryV4`, and one atomic `replaceProject` boundary used by rendering, Jobs, collision, and later Gateway adapters.

- [ ] **Step 1: Write RED independence and ownership tests**

```ts
it('keeps two Instances sharing one Definition independent', () => {
  const registry = createRobotRuntimeRegistryV4()
  registry.getState().replaceProject(projectWithTwoSharedDefinitionRobots())
  registry.getState().writeJointValues('robot-a', { j1: 45 }, 'simulation')
  expect(registry.getState().robots['robot-a']?.jointValues.j1).toBe(45)
  expect(registry.getState().robots['robot-b']?.jointValues.j1).toBe(0)
})

it('rejects a write from a non-owner without changing state', () => {
  const registry = createRobotRuntimeRegistryV4()
  registry.getState().replaceProject(projectWithRobotSource('robot-a', 'manual'))
  expect(() => registry.getState().writeJointValues(
    'robot-a', { j1: 5 }, 'simulation',
  )).toThrow('ROBOT_JOINT_SOURCE_OWNERSHIP_CONFLICT')
  expect(registry.getState().robots['robot-a']?.jointValues.j1).toBe(0)
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/robot/v4/robot-runtime-registry.test.ts
```

Expected: FAIL because the keyed registry is missing.

- [ ] **Step 3: Implement a vanilla Zustand registry**

```ts
export type RobotJointWriterV4 = 'simulation' | 'manual' | `opcua:${string}`

export interface RobotRuntimeStateV4 {
  readonly robotId: string
  readonly definitionId: string
  readonly jointValues: Readonly<Record<string, number>>
  readonly jointSource: RobotJointWriterV4
  readonly gripperState: 'OPEN' | 'CLOSED'
  readonly selectedToolFrameId: string
  readonly selectedTcpFrameId: string
  readonly numericStatus: number
  readonly visible: boolean
  readonly revision: number
}

export interface RobotRuntimeRegistryV4 {
  readonly projectRevisionId: string | null
  readonly robots: Readonly<Record<string, RobotRuntimeStateV4>>
  replaceProject(project: WorkcellProjectV4): void
  writeJointValues(
    robotId: string,
    values: Readonly<Record<string, number>>,
    writer: RobotJointWriterV4,
  ): void
  setGripperState(robotId: string, state: 'OPEN' | 'CLOSED'): void
  selectToolFrames(
    robotId: string,
    toolFrameId: string,
    tcpFrameId: string,
  ): void
  setNumericStatus(robotId: string, value: number): void
  reset(project: WorkcellProjectV4): void
}

export function createRobotRuntimeRegistryV4(
): StoreApi<RobotRuntimeRegistryV4>
```

`replaceProject` builds a fresh record keyed by `robot.id`, validates exact Joint IDs and limits through P1, initializes the configured Tool/TCP and an OPEN Gripper, and publishes it with one `set` call. `reset` rebuilds that same initial state. Each command clones only the addressed Robot record. A rejected command performs no `set`.

- [ ] **Step 4: Add one/eight/nine and variable-Joint tests**

```ts
it.each([1, 8])('publishes %i Robot Instances atomically', (count) => {
  const registry = createRobotRuntimeRegistryV4()
  registry.getState().replaceProject(projectWithRobotCount(count))
  expect(Object.keys(registry.getState().robots)).toHaveLength(count)
})

it('keeps string Joint IDs instead of positional tuples', () => {
  const registry = createRobotRuntimeRegistryV4()
  registry.getState().replaceProject(projectWithJointIds(['axis-a', 'slide-z']))
  expect(registry.getState().robots['robot-a']?.jointValues).toEqual({
    'axis-a': 0,
    'slide-z': 0.25,
  })
})
```

The ninth Robot must fail in the Project validator before `replaceProject` and leave the old registry unchanged.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/robot/v4/robot-runtime-registry.test.ts
npm run lint
npm run build
git add src/features/robot/v4/robot-runtime-registry*
git diff --cached --check
git commit -m "feat: add keyed robot runtime registry"
```

### Task 3: Add Per-Robot Job Authoring and Headless Execution

**Files:**
- Create: `src/core/robot-runtime/job-timeline.ts`
- Test: `src/core/robot-runtime/job-timeline.test.ts`
- Create: `src/features/jobs/v4/job-runtime-store.ts`
- Test: `src/features/jobs/v4/job-runtime-store.test.ts`
- Create: `src/features/jobs/v4/job-command-service.ts`
- Test: `src/features/jobs/v4/job-command-service.test.ts`
- Create: `src/features/jobs/v4/job-executor.ts`
- Test: `src/features/jobs/v4/job-executor.test.ts`
- Create: `src/features/project/v4/project-mutation-port.ts`
- Modify: `src/core/robot-runtime/index.ts`

**Interfaces:**
- Consumes: `RobotJobV4`, `RobotJobStepV4`, `WorkcellProjectV4`, `RobotRuntimeRegistryV4`, and P1 Job budgets.
- Produces: `sampleJointTransitionV4`, `ProjectMutationPortV4`, `JobActionExecutionPortV4`, `RobotJobExecutorV4`, `JobRuntimeStoreV4`, and `createJobCommandServiceV4`.
- P7 consumes `JobActionExecutionPortV4.execute(actionId, context)` and replaces the rejecting port with `ActionExecutorV4`.

- [ ] **Step 1: Write RED timeline and per-Robot execution tests**

```ts
it('interpolates only Definition Joint IDs and supports a prismatic Joint', () => {
  expect(sampleJointTransitionV4({
    from: { shoulder: 0, carriage: 0 },
    to: { shoulder: 90, carriage: 0.4 },
    elapsedMs: 500,
    durationMs: 1000,
    joints: mixedJointDefinitions(),
  })).toEqual({ shoulder: 45, carriage: 0.2 })
})

it('runs Jobs for different Robots concurrently and rejects a second run on one Robot', () => {
  const executor = createRobotJobExecutorV4(dependenciesForTwoRobots())
  executor.startJob('job-a', 0)
  executor.startJob('job-b', 0)
  expect(() => executor.startJob('job-a-2', 0)).toThrow('ROBOT_JOB_ALREADY_RUNNING')
  expect(executor.readState('robot-a').state).toBe('RUNNING')
  expect(executor.readState('robot-b').state).toBe('RUNNING')
})

it('fails an action-reference deterministically before P7', async () => {
  const executor = createRobotJobExecutorV4({
    ...dependenciesForActionJob(),
    actionPort: unavailableJobActionExecutionPortV4,
  })
  executor.startJob('job-with-action', 0)
  await executor.advanceAll(1)
  expect(executor.readState('robot-a')).toMatchObject({
    state: 'FAILED',
    failureCode: 'ACTION_EXECUTOR_UNAVAILABLE',
  })
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/core/robot-runtime/job-timeline.test.ts src/features/jobs/v4
```

Expected: FAIL because the V4 Job modules are absent.

- [ ] **Step 3: Implement ID-keyed timeline math**

```ts
export interface JointTransitionSampleInputV4 {
  readonly from: Readonly<Record<string, number>>
  readonly to: Readonly<Record<string, number>>
  readonly elapsedMs: number
  readonly durationMs: number
  readonly joints: readonly RobotJointDefinitionV4[]
}

export function transitionDurationMsV4(
  from: Readonly<Record<string, number>>,
  to: Readonly<Record<string, number>>,
  speedPercent: number,
  joints: readonly RobotJointDefinitionV4[],
): number

export function sampleJointTransitionV4(
  input: JointTransitionSampleInputV4,
): Readonly<Record<string, number>>
```

Calculate each Joint's required time from distance and `maximumVelocity`, divide by `speedPercent / 100`, and use the maximum as the synchronized segment duration. For a revolute Joint, evaluate `to - from`, `to - from + 360`, and `to - from - 360`, discard candidates whose sampled path crosses the Joint limits, then choose the smallest absolute valid delta with the unwrapped delta as the stable tie break. Prismatic interpolation is linear. Reject missing or additional Joint keys.

- [ ] **Step 4: Implement the Job state machine and action seam**

```ts
export interface JobActionExecutionContextV4 {
  readonly jobId: string
  readonly robotId: string
  readonly runId: string
  readonly simulationMs: number
}

export interface JobActionExecutionPortV4 {
  execute(
    actionId: string,
    context: JobActionExecutionContextV4,
  ): Promise<void>
}

export const unavailableJobActionExecutionPortV4: JobActionExecutionPortV4

export interface RobotJobRuntimeStateV4 {
  readonly robotId: string
  readonly jobId: string | null
  readonly runId: string | null
  readonly state: 'IDLE' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  readonly stepIndex: number | null
  readonly startedAtSimulationMs: number | null
  readonly completedAtSimulationMs: number | null
  readonly failureCode: string | null
  readonly message: string
}

export interface RobotJobTerminalResultV4 {
  readonly robotId: string
  readonly jobId: string
  readonly runId: string
  readonly state: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  readonly completedAtSimulationMs: number
  readonly failureCode: string | null
  readonly message: string
}

export interface JobRuntimeStoreV4 {
  readonly projectRevisionId: string | null
  readonly byRobotId: Readonly<Record<string, RobotJobRuntimeStateV4>>
  replaceProject(project: WorkcellProjectV4): void
  setRobotState(state: RobotJobRuntimeStateV4): void
  reset(project: WorkcellProjectV4): void
}

export interface RobotJobExecutorV4 {
  startJob(jobId: string, simulationMs: number): { readonly runId: string }
  advanceAll(simulationMs: number): Promise<void>
  cancelRobotJob(robotId: string, reason: string): void
  readState(robotId: string): RobotJobRuntimeStateV4
  waitForTerminal(runId: string): Promise<RobotJobTerminalResultV4>
  reset(): void
}

export function createJobRuntimeStoreV4(
): StoreApi<JobRuntimeStoreV4>

export interface RobotJobExecutorDependenciesV4 {
  readonly readProject: () => WorkcellProjectV4
  readonly robots: StoreApi<RobotRuntimeRegistryV4>
  readonly jobs: StoreApi<JobRuntimeStoreV4>
  readonly actionPort: JobActionExecutionPortV4
  readonly createRunId: () => string
}

export function createRobotJobExecutorV4(
  dependencies: RobotJobExecutorDependenciesV4,
): RobotJobExecutorV4
```

`startJob` validates that the Job's Robot exists and is under `simulation` ownership. `advanceAll` samples all active Robot sessions from one supplied Simulation clock; it never calls `requestAnimationFrame`. Pose steps write through `RobotRuntimeRegistryV4`; action steps await the injected port before advancing. Resolve `waitForTerminal` only on `SUCCEEDED`, `FAILED`, or `CANCELLED`.

- [ ] **Step 5: Implement V4 Job authoring commands**

Place `ProjectMutationPortV4` in `src/features/project/v4/project-mutation-port.ts`; Job and Scene code import that neutral interface rather than the concrete Task 7 service.

```ts
export interface JobCommandServiceV4 {
  createJob(robotId: string, name: string): Promise<string>
  renameJob(jobId: string, name: string): Promise<void>
  duplicateJob(jobId: string): Promise<string>
  deleteJob(jobId: string): Promise<void>
  saveJointPose(
    jobId: string,
    jointValues: Readonly<Record<string, number>>,
    speedPercentToNext: number,
  ): Promise<void>
  addActionReference(jobId: string, actionId: string): Promise<void>
  moveStep(jobId: string, stepIndex: number, direction: -1 | 1): Promise<void>
  deleteStep(jobId: string, stepIndex: number): Promise<void>
}

export interface ProjectMutationPortV4 {
  replaceFromActive(
    recipe: {
      readonly description: string
      mutate(active: WorkcellProjectV4): WorkcellProjectV4
    },
  ): Promise<{ readonly project: WorkcellProjectV4 }>
}

export function createJobCommandServiceV4(
  options: {
    readonly mutations: ProjectMutationPortV4
    readonly readProject: () => WorkcellProjectV4
  },
): JobCommandServiceV4
```

Each method uses one `ProjectMutationPortV4.replaceFromActive` recipe. Task 7's `ProjectMutationServiceV4` satisfies this port structurally. Enforce 32 Jobs, 256 steps per Job, 2,048 total steps, Robot ownership, exact Joint ID sets, Joint limits, speed `1..100`, and Action reference Robot compatibility before publication.

- [ ] **Step 6: Run GREEN and commit**

```powershell
npm run test:run -- src/core/robot-runtime/job-timeline.test.ts src/features/jobs/v4
npm run lint
npm run build
git add src/core/robot-runtime src/features/jobs/v4 src/features/project/v4/project-mutation-port.ts
git diff --cached --check
git commit -m "feat: add per-robot job runtime"
```

### Task 4: Namespace Multi-Robot Collision Identity and Policy

**Files:**
- Create: `src/core/robot-runtime/collision-identity.ts`
- Test: `src/core/robot-runtime/collision-identity.test.ts`
- Modify: `src/core/robot-runtime/index.ts`
- Modify: `src/domain/collision/collision.ts`
- Modify: `src/domain/collision/query-collision.ts`
- Test: `src/domain/collision/query-collision.test.ts`
- Modify: `src/domain/collision/mount-contact.ts`
- Test: `src/domain/collision/mount-contact.test.ts`
- Modify: `src/features/collision/scene-entity-adapter.ts`
- Test: `src/features/collision/scene-entity-adapter.test.ts`
- Modify: `src/features/collision/current-pose-collision.ts`
- Test: `src/features/collision/current-pose-collision.test.ts`
- Modify: `src/features/collision/CurrentPoseCollisionSystem.tsx`
- Modify: `src/features/collision/collision-validation-protocol.ts`
- Test: `src/features/collision/collision-validation-protocol.test.ts`
- Modify: `src/features/collision/collision-validation.worker.ts`
- Modify: `src/features/collision/validate-pose-sequence.ts`
- Test: `src/features/collision/validate-pose-sequence.test.ts`
- Modify: `src/features/scene/RobotMountContactEditor.tsx`
- Test: `src/features/scene/RobotMountContactEditor.test.tsx`
- Modify: `src/features/interaction/outline-state.ts`
- Test: `src/features/interaction/outline-state.test.ts`

**Interfaces:**
- Consumes: `RobotDefinitionV4`, `RobotInstanceV4`, current OBB/broad-phase query implementation.
- Produces: `CollisionEntityIdV4`, `CollisionPairKeyV4`, `canonicalCollisionPairKeyV4`, `RobotLinkCollisionEntityIdV4`, `ToolCollisionEntityIdV4`, `robotLinkCollisionIdV4`, `toolCollisionIdV4`, `parseRobotLinkCollisionIdV4`, `robotAdjacencyPairKeysV4`, and `CollisionPolicyV4` with per-Robot mount contacts.
- P7 extends `ignoredContactPairKeys` with only the exact active Tool/Object pair.

- [ ] **Step 1: Write RED identity and policy tests**

```ts
it('does not alias equal Link IDs from different Robot Instances', () => {
  expect(robotLinkCollisionIdV4('robot-a', 'base')).toBe('robot-link:robot-a:base')
  expect(robotLinkCollisionIdV4('robot-b', 'base')).toBe('robot-link:robot-b:base')
})

it('excludes adjacency only inside the same Robot', () => {
  const policy = collisionPolicyForTwoRobotsSharingDefinition()
  expect(policy.excludedPairKeys).toContain(
    canonicalCollisionPairKeyV4('robot-link:robot-a:l0', 'robot-link:robot-a:l1'),
  )
  expect(policy.excludedPairKeys).not.toContain(
    canonicalCollisionPairKeyV4('robot-link:robot-a:l0', 'robot-link:robot-b:l1'),
  )
})

it('retains cross-Robot collision candidates', () => {
  const result = queryGeometryCollisions(
    overlappingRobotAAndRobotBEntities(),
    collisionPolicyForTwoRobotsSharingDefinition(),
  )
  expect(result.findings).toContainEqual(expect.objectContaining({
    pairKey: canonicalCollisionPairKeyV4(
      'robot-link:robot-a:l2',
      'robot-link:robot-b:l2',
    ),
  }))
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/core/robot-runtime/collision-identity.test.ts src/domain/collision/query-collision.test.ts
```

Expected: FAIL because current IDs are `robot-link:LINK0x` and the policy assumes one Robot.

- [ ] **Step 3: Implement stable IDs and definition-derived adjacency**

```ts
export type RobotLinkCollisionEntityIdV4 =
  `robot-link:${string}:${string}`
export type ToolCollisionEntityIdV4 =
  `tool:${string}:${string}`
export type CollisionEntityIdV4 =
  | RobotLinkCollisionEntityIdV4
  | ToolCollisionEntityIdV4
  | `object:${string}`
  | `equipment:${string}`
  | `environment:${string}`
export type CollisionPairKeyV4 = `${string}|${string}`

export function canonicalCollisionPairKeyV4(
  first: CollisionEntityIdV4,
  second: CollisionEntityIdV4,
): CollisionPairKeyV4

export function robotLinkCollisionIdV4(
  robotId: string,
  linkId: string,
): RobotLinkCollisionEntityIdV4

export function toolCollisionIdV4(
  robotId: string,
  toolFrameId: string,
): ToolCollisionEntityIdV4

export function parseRobotLinkCollisionIdV4(
  value: string,
): { readonly robotId: string; readonly linkId: string } | null

export function robotAdjacencyPairKeysV4(
  robot: RobotInstanceV4,
  definition: RobotDefinitionV4,
): ReadonlySet<CollisionPairKeyV4>
```

Derive adjacency from each Joint's `parentLinkId` and `childLinkId`. Never parse Link digits or assume `LINK00..LINK06`.

- [ ] **Step 4: Generalize collision policy and worker payloads**

```ts
export interface CollisionPolicyV4 {
  readonly enabled: boolean
  readonly nearMissMarginM: number
  readonly excludedPairKeys: ReadonlySet<CollisionPairKeyV4>
  readonly intentionalMountPairKeys: ReadonlySet<CollisionPairKeyV4>
  readonly ignoredContactPairKeys: ReadonlySet<CollisionPairKeyV4>
}
```

Change `queryGeometryCollisions` to skip only explicit policy sets. Change current-pose and sequence payloads to carry `{ robotId, definitionId, jointValues }[]`, definition records, and per-Robot mount pairs. A hidden Robot or Group removes all descendant proxies before broad phase; it does not alter Robot state.

`RobotMountContactEditor` selects one Robot Instance and one external mount entity, then stores that Instance's intentional pair. `outline-state.ts` accepts `(robotId, linkId)` and resolves `robot-link:<robotId>:<linkId>`; it no longer imports `RobotLinkId`.

- [ ] **Step 5: Run all collision GREEN tests**

```powershell
npm run test:run -- src/core/robot-runtime/collision-identity.test.ts src/domain/collision src/features/collision
npm run lint
npm run build
```

Expected: same-Robot adjacency and configured mount pairs are excluded, cross-Robot/external pairs remain eligible, and fixed Link regexes are absent.

- [ ] **Step 6: Commit**

```powershell
git add src/core/robot-runtime src/domain/collision src/features/collision
git diff --cached --check
git commit -m "feat: namespace multi-robot collision geometry"
```

### Task 5: Render Reusable Definitions as Independent Robot Instances

**Files:**
- Create: `src/features/robot/v4/robot-definition-geometry-repository.ts`
- Test: `src/features/robot/v4/robot-definition-geometry-repository.test.ts`
- Create: `src/features/robot/v4/builtin-ned2-definition.ts`
- Test: `src/features/robot/v4/builtin-ned2-definition.test.ts`
- Create: `src/features/robot/v4/RobotInstanceModel.tsx`
- Test: `src/features/robot/v4/RobotInstanceModel.test.tsx`
- Create: `src/features/robot/v4/RobotFleet.tsx`
- Test: `src/features/robot/v4/RobotFleet.test.tsx`
- Create: `src/features/scene/v4/scene-runtime-selector.ts`
- Test: `src/features/scene/v4/scene-runtime-selector.test.ts`
- Create: `src/features/scene/v4/scene-runtime-store.ts`
- Test: `src/features/scene/v4/scene-runtime-store.test.ts`
- Modify: `src/features/scene/Workcell.tsx`
- Test: `src/features/scene/Workcell.test.tsx`

**Interfaces:**
- Consumes: P1 Project types, `resolveWorldFrameMapV4`, `computeSerialRobotPoseV4`, `RobotRuntimeRegistryV4`, namespaced collision IDs, and current checked-in NED2 geometry.
- Produces: `createBuiltinNed2DefinitionV4`, `prepareBuiltinNed2GeometryV4`, `PreparedRobotDefinitionGeometryV4`, `RobotDefinitionGeometryRepositoryV4`, `RobotInstanceRegistrationV4`, `RobotFleetRegistrationV4`, `SceneRuntimeProjectionV4`, and `SceneRuntimeStoreV4`.
- P3 later registers imported Definition geometry through the same repository; P2 does not add a STEP authoring wizard.

- [ ] **Step 1: Write RED sharing and independent-root tests**

```tsx
it('reuses one prepared Definition bundle but creates distinct Instance roots', () => {
  const repository = createRobotDefinitionGeometryRepositoryV4()
  const prepared = preparedNed2Geometry()
  repository.publish('def-ned2', prepared)
  const a = repository.acquire('def-ned2', 'robot-a')
  const b = repository.acquire('def-ned2', 'robot-b')
  expect(a.sharedGeometry).toBe(b.sharedGeometry)
  expect(a.instanceRoot).not.toBe(b.instanceRoot)
  a.release()
  expect(prepared.dispose).not.toHaveBeenCalled()
  repository.revoke('def-ned2')
  expect(prepared.dispose).not.toHaveBeenCalled()
  b.release()
  expect(prepared.dispose).toHaveBeenCalledTimes(1)
})

it('renders two Robot IDs with independent World transforms', () => {
  render(<RobotFleet project={twoRobotProject()} />)
  expect(sceneObject('robot:robot-a').position.toArray()).toEqual([0, 0, 0])
  expect(sceneObject('robot:robot-b').position.toArray()).toEqual([1.5, 0, 0])
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/robot/v4 src/features/scene/Workcell.test.tsx
```

Expected: FAIL because Workcell renders one fixed `RobotModel`.

- [ ] **Step 3: Implement reusable prepared geometry**

Move the checked-in NED2 mechanics, Link IDs, Frame ownership, asset URLs, and collision metadata into `builtin-ned2-definition.ts` as one valid `RobotDefinitionV4`. Its six Joint values remain keyed by the Definition's stable Joint IDs; the adapter does not expose `RobotLinkId`, `JointAnglesDeg`, or a fixed-tuple API.

```ts
export function createBuiltinNed2DefinitionV4(): RobotDefinitionV4
export async function prepareBuiltinNed2GeometryV4(
  definition: RobotDefinitionV4,
): Promise<PreparedRobotDefinitionGeometryV4>

export interface PreparedRobotDefinitionGeometryV4 {
  readonly definitionId: string
  readonly linkObjects: Readonly<Record<string, Object3D>>
  readonly triangleCount: number
  dispose(): void
}

export interface AcquiredRobotDefinitionGeometryV4 {
  readonly definitionId: string
  readonly robotId: string
  readonly instanceRoot: Group
  readonly linkObjects: Readonly<Record<string, Object3D>>
  readonly sharedGeometry: ReadonlySet<BufferGeometry>
  release(): void
}

export interface RobotDefinitionGeometryRepositoryV4 {
  publish(definitionId: string, geometry: PreparedRobotDefinitionGeometryV4): void
  acquire(
    definitionId: string,
    robotId: string,
  ): AcquiredRobotDefinitionGeometryV4
  revoke(definitionId: string): void
}

export function createRobotDefinitionGeometryRepositoryV4(
): RobotDefinitionGeometryRepositoryV4
```

Clone Object3D hierarchy and materials per Instance where mutation requires it, share immutable `BufferGeometry`, and dispose shared resources only after the last Instance lease and Definition publication are gone.

- [ ] **Step 4: Implement Instance and Fleet renderers**

```ts
export interface RobotInstanceRegistrationV4 {
  readonly robotId: string
  readonly definitionId: string
  readonly root: Group
  readonly linkObjects: Readonly<Record<string, Object3D>>
  readonly frameObjects: Readonly<Record<string, Object3D>>
}

export interface RobotInstanceModelPropsV4 {
  readonly robot: RobotInstanceV4
  readonly definition: RobotDefinitionV4
  readonly runtime: RobotRuntimeStateV4
  readonly worldBasePose: RigidTransformV4
  readonly onRegister: (
    registration: RobotInstanceRegistrationV4 | null,
  ) => void
}

export interface RobotFleetPropsV4 {
  readonly project: WorkcellProjectV4
  readonly sceneRuntime: SceneRuntimeProjectionV4
  readonly robotRuntime: Readonly<Record<string, RobotRuntimeStateV4>>
  readonly onRegister: (
    registration: RobotFleetRegistrationV4 | null,
  ) => void
}

export interface RobotFleetRegistrationV4 {
  readonly robots:
    ReadonlyMap<string, RobotInstanceRegistrationV4>
}
```

`RobotFleet` looks up each Definition by ID, resolves its Base parent Frame, and renders one keyed `RobotInstanceModel`. Each render applies `computeSerialRobotPoseV4` to link groups, registers `robot-link:<robotId>:<linkId>` proxies, and renders that Instance's numeric status overlay at its configured status/Tool Frame. `EquipmentScene` retains the existing numeric `EquipmentStatusOverlay` behavior for every visible `SpatialEntityV4`, using its configured overlay Frame or bounds center; hiding an Entity or Group hides the overlay without deleting status. Missing geometry renders the P3-compatible `UNRESOLVED` indicator while retaining Robot or Entity state.

- [ ] **Step 5: Stage the V4 Workcell composition**

Add a named `WorkcellV4` export while leaving the active V3 `Workcell` export unchanged until Task 7. `WorkcellV4` uses `Map<robotId, RobotInstanceRegistrationV4>` for viewport bounds, focus, Base/TCP markers, collision registration, and external-axis following. `RobotFleet` receives all visible Robots; moving a carriage Frame updates every mounted Robot through the Frame graph without imperative reparenting. No adapter converts a V3 snapshot into this component's props.

Publish derived Scene state through one vanilla store:

```ts
export interface SceneRuntimeFrameV4 {
  readonly frameId: string
  readonly parentFrameId: string | null
  readonly localPose: RigidTransformV4
  readonly worldPose: RigidTransformV4
  readonly effectiveVisible: boolean
}

export interface SceneRuntimeEntityV4 {
  readonly entityId: string
  readonly kind: 'robot' | 'spatial-entity' | 'group' | 'environment'
  readonly parentFrameId: string | null
  readonly worldPose: RigidTransformV4
  readonly effectiveVisible: boolean
  readonly transformOwner:
    'manual' | 'simulation' | 'opcua' | 'attachment'
}

export interface SceneRuntimeProjectionV4 {
  readonly projectRevisionId: string
  readonly frames: Readonly<Record<string, SceneRuntimeFrameV4>>
  readonly entities: Readonly<Record<string, SceneRuntimeEntityV4>>
  readonly visibleRobotIds: readonly string[]
  readonly visibleSpatialEntityIds: readonly string[]
}

export function selectSceneRuntimeV4(
  project: WorkcellProjectV4,
  robotRuntime: Readonly<Record<string, RobotRuntimeStateV4>>,
): SceneRuntimeProjectionV4

export interface SceneRuntimeStoreSnapshotV4 {
  readonly projectRevisionId: string | null
  readonly projection: SceneRuntimeProjectionV4 | null
}

export interface SceneRuntimeStoreV4 {
  readonly projectRevisionId: string | null
  readonly projection: SceneRuntimeProjectionV4 | null
  replaceProjection(
    projectRevisionId: string,
    projection: SceneRuntimeProjectionV4,
  ): void
  snapshot(): SceneRuntimeStoreSnapshotV4
  restore(snapshot: SceneRuntimeStoreSnapshotV4): void
  reset(project: WorkcellProjectV4): void
}

export function createSceneRuntimeStoreV4(
): StoreApi<SceneRuntimeStoreV4>
```

React reads this store; selectors remain pure and can be recomputed from Robot/Moving Frame revisions.

- [ ] **Step 6: Run GREEN and commit**

```powershell
npm run test:run -- src/features/robot/v4 src/features/scene/v4 src/features/scene/Workcell.test.tsx
npm run lint
npm run build
git add src/features/robot/v4 src/features/scene/v4 src/features/scene/Workcell.tsx src/features/scene/Workcell.test.tsx
git diff --cached --check
git commit -m "feat: render independent robot instances"
```

### Task 6: Route Selection, Inspectors, Jobs, and Timeline by Robot ID

**Files:**
- Modify: `src/features/interaction/interaction-store.ts`
- Test: `src/features/interaction/interaction-store.test.ts`
- Modify: `src/features/scene/SceneExplorer.tsx`
- Test: `src/features/scene/SceneExplorer.test.tsx`
- Modify: `src/features/scene/SceneEntityInspector.tsx`
- Test: `src/features/scene/SceneEntityInspector.test.tsx`
- Modify: `src/features/joints/JointInspector.tsx`
- Test: `src/features/joints/JointInspector.test.tsx`
- Modify: `src/features/jobs/RobotJobList.tsx`
- Test: `src/features/jobs/RobotJobList.test.tsx`
- Modify: `src/features/ui/Timeline.tsx`
- Test: `src/features/ui/Timeline.test.tsx`
- Modify: `src/features/scene/SceneCanvas.tsx`
- Test: `src/features/scene/SceneCanvas.test.tsx`
- Create: `src/features/scene/v4/MovingFrameInspector.tsx`
- Test: `src/features/scene/v4/MovingFrameInspector.test.tsx`
- Modify: `src/features/frames/coordinate-frame-store.ts`
- Test: `src/features/frames/coordinate-frame-store.test.ts`
- Modify: `src/features/frames/CoordinateFramesDialog.tsx`
- Test: `src/features/frames/CoordinateFramesDialog.test.tsx`
- Modify: `src/features/scene/scene-editor-store.ts`
- Test: `src/features/scene/scene-editor-store.test.ts`
- Modify: `src/features/scene/scene-context-request.ts`
- Modify: `src/features/scene/scene-ui-test-fixtures.ts`

**Interfaces:**
- Consumes: `SceneRuntimeProjectionV4`, `RobotRuntimeRegistryV4`, `RobotJobExecutorV4`, `JobRuntimeStoreV4`, and `ProjectMutationPortV4`.
- Produces: `SceneSelectionV4`, selected-Robot-scoped inspector/Job selectors, and one Simulation clock that calls `advanceAll`.

- [ ] **Step 1: Write RED selection and UI routing tests**

```ts
it('stores Robot and Link selection with Robot identity', () => {
  const store = createInteractionStoreV4()
  store.getState().selectRobotLink('robot-b', 'wrist')
  expect(store.getState().selection).toEqual({
    kind: 'robot-link',
    robotId: 'robot-b',
    linkId: 'wrist',
  })
})

it('filters Jobs and Joint controls to the selected Robot', async () => {
  renderRobotWorkspaceV4(twoHeterogeneousRobotProject())
  await user.click(screen.getByText('Robot B'))
  expect(screen.getByRole('heading', { name: 'Robot B Joints' })).toBeVisible()
  expect(screen.getByText('Job B')).toBeVisible()
  expect(screen.queryByText('Job A')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/interaction/interaction-store.test.ts src/features/scene/SceneExplorer.test.tsx src/features/joints/JointInspector.test.tsx src/features/jobs/RobotJobList.test.tsx src/features/ui/Timeline.test.tsx
```

Expected: FAIL because selection and controls target one implicit Robot.

- [ ] **Step 3: Replace selection identity**

```ts
export type SceneSelectionV4 =
  | { readonly kind: 'robot'; readonly robotId: string }
  | {
      readonly kind: 'robot-link'
      readonly robotId: string
      readonly linkId: string
    }
  | { readonly kind: 'spatial-entity'; readonly entityId: string }
  | { readonly kind: 'frame'; readonly frameId: string }
  | null

export interface InteractionStoreStateV4 {
  readonly selection: SceneSelectionV4
  readonly hiddenEntityIds: readonly string[]
  readonly activeCollisionPairKeys: readonly CollisionPairKeyV4[]
  selectRobot(robotId: string): void
  selectRobotLink(robotId: string, linkId: string): void
  selectSpatialEntity(entityId: string): void
  selectFrame(frameId: string): void
  clearSelection(): void
  setEntityVisible(entityId: string, visible: boolean): void
  replaceCollisionPairKeys(keys: readonly CollisionPairKeyV4[]): void
  reset(): void
}

export function createInteractionStoreV4(
): StoreApi<InteractionStoreStateV4>
```

The V4 store contains no implicit `'robot'` or `'robot:active'` mapping. Hiding one Robot clears only that Robot or its Link selection. Keep the active V3 factory untouched in this task; Task 7 switches App to `createInteractionStoreV4`, and Task 8 removes the old factory and fields.

- [ ] **Step 4: Scope inspector and Job selectors**

Add named `SceneExplorerV4`, `SceneEntityInspectorV4`, `JointInspectorV4`, `RobotJobListV4`, `TimelineV4`, and `SceneCanvasV4` exports beside the still-active V3 components. `SceneExplorerV4` lists every Robot, Spatial Entity, Group, and Moving Frame. `JointInspectorV4` derives controls from the selected Robot's Definition Joint list and writes by Joint ID. `RobotJobListV4` and `TimelineV4` show only Jobs whose `robotId` equals the selected Robot ID. Definition editing copy states that a shared Definition change affects every referencing Instance. Task 7 switches production imports and Task 8 removes the superseded exports.

`MovingFrameInspector` edits any selected named Moving Frame as XYZRPY through `ProjectMutationPortV4`; it contains no `linear-axis:active` branch. Convert `CoordinateFramesDialog` and its store from localStorage-owned MCP/TCP transforms into selection/display state over Project Frames. `scene-editor-store` drafts one V4 Frame or Spatial Entity local pose and publishes through the same port; it cannot own a second Robot Base pose.

- [ ] **Step 5: Move playback ticking to the headless executor**

Keep one UI `requestAnimationFrame` only as a Simulation clock source:

```ts
function onSimulationFrame(simulationMs: number): void {
  void jobExecutor.advanceAll(simulationMs)
}
```

Do not interpolate Joint arrays inside `Timeline.tsx`. The Timeline reads `JobRuntimeStoreV4` and sends `startJob`, `cancelRobotJob`, reorder, speed, and delete commands through P2 services.

- [ ] **Step 6: Run GREEN and commit**

```powershell
npm run test:run -- src/features/interaction/interaction-store.test.ts src/features/scene src/features/joints src/features/jobs src/features/ui/Timeline.test.tsx
npm run lint
npm run build
git add src/features/interaction/interaction-store* src/features/scene src/features/joints/JointInspector* src/features/jobs src/features/ui/Timeline*
git diff --cached --check
git commit -m "feat: route robot ui by instance id"
```

### Task 7: Publish V4 Browser Resources Atomically and Switch Project Commands

**Files:**
- Create: `src/features/project/v4/project-v4-mutation-service.ts`
- Test: `src/features/project/v4/project-v4-mutation-service.test.ts`
- Create: `src/features/project/v4/default-project-v4.ts`
- Test: `src/features/project/v4/default-project-v4.test.ts`
- Create: `src/features/project/v4/browser-project-runtime-v4.ts`
- Test: `src/features/project/v4/browser-project-runtime-v4.test.ts`
- Create: `src/features/project/v4/project-store-v4.ts`
- Test: `src/features/project/v4/project-store-v4.test.ts`
- Modify: `src/features/project/project-store-browser.ts`
- Modify: `src/features/project/ProjectMenu.tsx`
- Test: `src/features/project/ProjectMenu.test.tsx`
- Modify: `src/features/scene/Workcell.tsx`
- Modify: `src/features/scene/SceneCanvas.tsx`
- Modify: `src/features/interaction/interaction-store.ts`
- Modify: `src/features/scene/SceneExplorer.tsx`
- Modify: `src/features/scene/SceneEntityInspector.tsx`
- Modify: `src/features/joints/JointInspector.tsx`
- Modify: `src/features/jobs/RobotJobList.tsx`
- Modify: `src/features/ui/Timeline.tsx`
- Modify: `src/app/App.tsx`
- Test: `src/app/App.test.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/initial-project-bootstrap.ts`
- Test: `src/app/initial-project-bootstrap.test.ts`
- Modify: `src/domain/project/project.ts`

**Interfaces:**
- Consumes: P1 `ProjectRepositoryV4`, `ProjectPublicationCoordinatorV4`, `ProjectRuntimeV4<R>`, canonical V4 codec, P2 Robot/Job/Scene registries.
- Produces: `ProjectMutationServiceV4`, `BrowserProjectRuntimeResourcesV4`, `createDefaultProjectV4`, `ProjectStoreV4`, and V4-only browser singleton exports.
- Ownership: P2 is the sole defining module for `ProjectMutationServiceV4`; P3 and later plans import it from `src/features/project/v4/project-v4-mutation-service.ts`.

- [ ] **Step 1: Write RED atomic publication and unsupported-schema tests**

```ts
it('rolls back every browser registry when one prepared resource fails to apply', async () => {
  const dependencies = testRuntimeDependencies()
  const runtime = createBrowserProjectRuntimeV4(dependencies)
  await runtime.apply(await runtime.prepare(projectA, projectA.revisionId))
  vi.spyOn(dependencies.sceneStore.getState(), 'replaceProjection')
    .mockImplementationOnce(() => { throw new Error('scene failed') })
  await expect(runtime.apply(
    await runtime.prepare(projectB, projectB.revisionId),
  )).rejects.toThrow('scene failed')
  expect(dependencies.robotRegistry.getState().projectRevisionId).toBe(projectA.revisionId)
  expect(dependencies.jobStore.getState().projectRevisionId).toBe(projectA.revisionId)
})

it.each([1, 2, 3])('rejects schema %i before active mutation', async (schemaVersion) => {
  const store = createProjectStoreV4(testStoreDependencies(projectA))
  await expect(store.getState().importProject(
    new Blob([JSON.stringify({ schemaVersion })]),
  )).rejects.toThrow('PROJECT_SCHEMA_UNSUPPORTED')
  expect(store.getState().activeProject?.revisionId).toBe(projectA.revisionId)
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/project/v4 src/features/project/ProjectMenu.test.tsx src/app/initial-project-bootstrap.test.ts
```

Expected: FAIL because P1's V4 repository is not connected to the browser.

- [ ] **Step 3: Implement serialized V4 recipes**

```ts
export interface ProjectMutationRecipeV4 {
  readonly description: string
  mutate(active: WorkcellProjectV4): WorkcellProjectV4
}

export interface ProjectMutationServiceV4 {
  hydrate(): Promise<void>
  readPublished(): PublishedProjectBundleV4 | null
  subscribe(listener: () => void): () => void
  replace(candidate: WorkcellProjectV4): Promise<PublishedProjectBundleV4>
  replacePrepared(
    candidate: WorkcellProjectV4,
    expectedRevisionId: string | null,
  ): Promise<PublishedProjectBundleV4>
  replaceFromActive(
    recipe: ProjectMutationRecipeV4,
  ): Promise<PublishedProjectBundleV4>
  isRecoveryRequired(): boolean
}

export interface ProjectMutationServiceDependenciesV4 {
  readonly publication: ProjectPublicationCoordinatorV4
  readonly nowIso: () => string
  readonly createRevisionId: () => string
}

export function createProjectMutationServiceV4(
  dependencies: ProjectMutationServiceDependenciesV4,
): ProjectMutationServiceV4
```

Serialize mutations through one promise queue. `replacePrepared(candidate, expectedRevisionId)` validates the already-built candidate and forwards that caller-supplied expected Revision unchanged to the P1 coordinator. `replaceFromActive` clones the active immutable Project, applies the recipe, sets `metadata.updatedAt`, validates, calculates the Revision, and calls the same coordinator with the active Revision. A failed recipe, validation, durable write, or runtime apply leaves the published Project and all registries unchanged.

- [ ] **Step 4: Implement browser prepare/apply/rollback**

```ts
export interface BrowserProjectRuntimeResourcesV4 {
  readonly project: WorkcellProjectV4
  readonly frameNodes: readonly FrameGraphNodeV4[]
  readonly robotStates: Readonly<Record<string, RobotRuntimeStateV4>>
  readonly sceneProjection: SceneRuntimeProjectionV4
  readonly jobStates: Readonly<Record<string, RobotJobRuntimeStateV4>>
}

export interface BrowserProjectRuntimeDependenciesV4 {
  readonly robotRegistry: StoreApi<RobotRuntimeRegistryV4>
  readonly sceneStore: StoreApi<SceneRuntimeStoreV4>
  readonly jobStore: StoreApi<JobRuntimeStoreV4>
  readonly geometryRepository: RobotDefinitionGeometryRepositoryV4
  readonly prepareScene: (
    project: WorkcellProjectV4,
    robotStates: Readonly<Record<string, RobotRuntimeStateV4>>,
  ) => SceneRuntimeProjectionV4
}

export function createBrowserProjectRuntimeV4(
  dependencies: BrowserProjectRuntimeDependenciesV4,
): ProjectRuntimeV4<BrowserProjectRuntimeResourcesV4>
```

`prepare` is side-effect free and validates every referenced Definition, Frame, Geometry bundle, Job, and collision policy. Sum visible prepared Robot and Spatial Entity triangle counts; 1,500,000 passes and 1,500,001 fails as `VISIBLE_TRIANGLE_LIMIT_EXCEEDED` before apply. `apply` snapshots all live registries, replaces them inside one notification transaction, and returns `commit`, `rollback`, and `cleanup` callbacks. Rollback restores every snapshot in reverse order.

- [ ] **Step 5: Implement V4 New/Save/Import/Export**

```ts
export interface ProjectStoreStateV4 {
  readonly activeProject: WorkcellProjectV4 | null
  readonly status:
    | 'idle'
    | 'loading'
    | 'saving'
    | 'importing'
    | 'ready'
    | 'error'
    | 'recovery-required'
  readonly error: string | null
  hydrate(): Promise<void>
  newProject(): Promise<void>
  saveActiveProject(): Promise<WorkcellProjectV4>
  exportActiveProject(): Promise<Blob>
  importProject(source: Blob | Uint8Array | ArrayBuffer): Promise<void>
}

export type ProjectStoreV4 = StoreApi<ProjectStoreStateV4>

export interface ProjectStoreDependenciesV4 {
  readonly mutations: ProjectMutationServiceV4
  readonly createDefaultProject: () => WorkcellProjectV4
  readonly encodeProject: (project: WorkcellProjectV4) => Blob
  readonly decodeProject: (
    source: Blob | Uint8Array | ArrayBuffer,
  ) => Promise<WorkcellProjectV4>
}

export function createDefaultProjectV4(options: {
  readonly revisionId: string
  readonly nowIso: string
}): WorkcellProjectV4

export function createProjectStoreV4(
  dependencies: ProjectStoreDependenciesV4,
): ProjectStoreV4
```

`createDefaultProjectV4` returns one valid NED2 Definition/Instance with builtin logical Asset references, World/MCP/Base/Flange/TCP Frames, Simulation ownership, one empty Robot Job, and no Attachments. Switch `App`, `AppShell`, `SceneCanvas`, `Workcell`, selection, inspectors, Job list, and Timeline to the V4 named exports in the same change that switches `ProjectMenu` and initial bootstrap. Remove the V3 Robot Config, Robot Geometry, and Robot STEP Import buttons in this switch; P3 installs the Definition-driven authoring surfaces. `ProjectMenu` imports/exports canonical `.json` only and reports `PROJECT_SCHEMA_UNSUPPORTED` without mutating the active Revision.

- [ ] **Step 6: Run GREEN and commit**

```powershell
npm run test:run -- src/features/project/v4 src/features/project/ProjectMenu.test.tsx src/features/scene src/features/joints src/features/jobs src/features/ui/Timeline.test.tsx src/app
npm run lint
npm run build
git add src/features/project/v4 src/features/project/project-store-browser.ts src/features/project/ProjectMenu* src/features/scene src/features/interaction/interaction-store* src/features/joints/JointInspector* src/features/jobs src/features/ui/Timeline* src/app src/domain/project/project.ts
git diff --cached --check
git commit -m "feat: cut browser publication to project v4"
```

### Task 8: Remove V3, Fixed-Six Runtime, and Automatic-Nearest Grasp

**Files:**
- Delete: every file listed under **Delete at the Task 8 cutover**.
- Modify: `src/features/interaction/interaction-store.ts`
- Modify: `src/features/interaction/interaction-math.ts`
- Modify: `src/features/equipment/EquipmentScene.tsx`
- Test: `src/features/equipment/EquipmentScene.test.ts`
- Modify: `src/features/import/imported-equipment-actions.ts`
- Modify: `src/features/collision/CollisionPanel.tsx`
- Modify: `src/features/interaction/collision-events.ts`
- Modify: `src/features/scene/scene-command-service.ts`
- Modify: `src/features/scene/SceneCanvas.tsx`
- Modify: `src/features/scene/Workcell.tsx`
- Modify: `src/features/scene/SceneExplorer.tsx`
- Modify: `src/features/scene/SceneEntityInspector.tsx`
- Modify: `src/features/scene/scene-editor-store.ts`
- Modify: `src/features/scene/scene-context-request.ts`
- Modify: `src/features/scene/scene-ui-test-fixtures.ts`
- Modify: `src/features/joints/JointInspector.tsx`
- Modify: `src/features/jobs/RobotJobList.tsx`
- Modify: `src/features/ui/Timeline.tsx`
- Modify: `src/features/frames/coordinate-frame-store.ts`
- Modify: `src/features/frames/CoordinateFramesDialog.tsx`
- Modify: `src/app/safe-scene-deletion.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `package.json`
- Create: `tests/project-v4-multi-robot.spec.ts`

**Interfaces:**
- Consumes: all P2 V4 services.
- Produces: a V4-only browser with no automatic grasp surface and a passing P2 gate ready for P3/P4/P6.
- P7 later adds explicit Attach/Detach without restoring any file or API deleted here.

- [ ] **Step 1: Write the RED no-implicit-grasp regression tests**

```ts
it('changes Gripper state without changing any Object parent or pose', () => {
  const before = sceneRuntimeStore.getState().entities['cup-1']
  robotRuntimeRegistry.getState().setGripperState('robot-a', 'CLOSED')
  const afterClose = sceneRuntimeStore.getState().entities['cup-1']
  robotRuntimeRegistry.getState().setGripperState('robot-a', 'OPEN')
  const afterOpen = sceneRuntimeStore.getState().entities['cup-1']
  expect(afterClose).toEqual(before)
  expect(afterOpen).toEqual(before)
})

it('removes held-object state from the V4 interaction store', () => {
  const state = createInteractionStoreV4().getState()
  expect(state).not.toHaveProperty('heldEntityId')
  expect(state).not.toHaveProperty('graspCandidateIds')
  expect(state).not.toHaveProperty('holdEquipment')
  expect(state).not.toHaveProperty('releaseHeldEquipment')
})

it('keeps the numeric status overlay for a visible Spatial Entity', () => {
  render(<EquipmentScene projection={sceneWithNumericStatus('fixture-1', 42)} />)
  expect(screen.getByText('42')).toBeVisible()
  rerender(<EquipmentScene projection={sceneWithHiddenGroup('fixture-1', 42)} />)
  expect(screen.queryByText('42')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run RED before cleanup**

```powershell
npm run test:run -- src/features/interaction/interaction-store.test.ts src/features/equipment/EquipmentScene.test.ts src/features/scene/Workcell.test.tsx src/app/App.test.tsx
```

Expected: FAIL because V3 held/grasp state and `GraspController` still exist.

- [ ] **Step 3: Remove the automatic-grasp implementation**

Delete `GraspController`, grasp sensor, grasp participant, and grasp action files and tests. Remove `heldEntityId`, `heldEquipmentId`, `gripOffset`, `graspCandidateIds`, `holdEquipment`, `releaseHeldEquipment`, candidate entry/exit, and held-object rendering branches. `EquipmentScene` always renders visible Entities from `SceneRuntimeProjectionV4` and preserves the existing text/icon numeric status overlay; effective visibility controls both Geometry and overlay. `CollisionPanel` reports registered geometry only. `safe-scene-deletion` and imported-equipment deletion no longer release an Object as a side effect. P7 adds an explicit attached-deletion block through `ActionExecutorV4`.

- [ ] **Step 4: Delete the V3 and fixed-six lanes**

Delete every superseded file listed in this plan. Point all remaining imports at `src/core/project-v4`, `src/core/robot-runtime`, and `src/features/project/v4`. Do not retain disabled legacy dialogs or compatibility exports. Remove `test:e2e:archive` and `test:e2e:hash` from `package.json`; set the intermediate verification script to:

```json
{
  "scripts": {
    "test:e2e:v4": "playwright test tests/project-v4-multi-robot.spec.ts",
    "verify": "npm run lint && npm run test:run && npm run cad:validate && npm run build && npm run test:e2e:v4"
  }
}
```

Retain all other current package scripts unchanged.

- [ ] **Step 5: Add the browser P2 acceptance**

```ts
test('V4 renders and controls two independent Robot Instances', async ({ page }) => {
  await page.goto('/')
  await loadProjectV4(page, twoRobotBrowserFixture())
  await expect(page.getByText('Robot A')).toBeVisible()
  await expect(page.getByText('Robot B')).toBeVisible()
  await expectRobotDefinition(page, 'Robot A', 'NED2 Test Definition')
  await expectRobotDefinition(page, 'Robot B', 'Variable Slide Definition')
  await selectRobot(page, 'Robot B')
  await setJoint(page, 'slide-z', 0.2)
  await expectRobotJoint(page, 'Robot B', 'slide-z', 0.2)
  await expectRobotJoint(page, 'Robot A', 'slide-z', 0)
  await startJob(page, 'Robot A', 'Job A')
  await startJob(page, 'Robot B', 'Job B')
  await expectJobState(page, 'Robot A', 'RUNNING')
  await expectJobState(page, 'Robot B', 'RUNNING')
})
```

Use a checked-in source-only fixture with builtin/primitive geometry; MRb05 external STEP acceptance belongs to P3 and P8.

- [ ] **Step 6: Prove forbidden paths are absent**

```powershell
rg -n "attemptGrasp|chooseNearestGraspCandidate|graspCandidateIds|heldEntityId|holdEquipment|releaseHeldEquipment|createGeometryGraspSensorEntity|GraspController" src
rg -n "WorkcellProjectSnapshotV3|ProjectDecodeResultV3|RobotLinkId|JointAnglesDeg|JOINT_COUNT|robot:active|robot-link:LINK0" src tests
```

Expected: both commands return no matches. A retained compatibility wrapper fails this gate.

- [ ] **Step 7: Run the complete P2 GREEN gate**

```powershell
npm run test:run -- src/core src/domain src/features/project src/features/robot src/features/joints src/features/jobs src/features/scene src/features/collision src/features/interaction src/app
npm run lint
npm run build
npm run test:e2e:v4
git status --short
```

Expected: all tests PASS; one through eight Robots and one through sixteen Joints are covered; the ninth Robot and zero/seventeen Joints fail before publication; two Jobs run concurrently on different Robots; V1-V3 imports preserve the active Revision; no automatic grasp code remains; unrelated CAD directories remain unstaged.

- [ ] **Step 8: Commit**

```powershell
git add -A src tests package.json package-lock.json
git diff --cached --check
git status --short
git commit -m "feat: complete project v4 multi-robot cutover"
```

Before committing, confirm `git status --short` does not stage `Savvy/`, `NED2_10kg-152_retired-controller_rev00_STEP_C/`, or `NED2_12kg-127_retired-controller_rev00_STEP_J.premerge-backup-20260713/`.
