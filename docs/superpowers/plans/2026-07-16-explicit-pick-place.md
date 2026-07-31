# Project V4 Explicit Pick and Place Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic kinematic Pick/Place in which UI, Robot Jobs, and OPC UA Action Bindings execute the same explicit Gripper, Attach, and Detach definitions through one `ActionExecutorV4`.

**Architecture:** Keep Attachment validation and transform transitions in dependency-free Core code. Store live Attachment constraints and detached pose overrides outside canonical Project JSON, project them into the P2 Frame graph and collision policy, and expose one browser-owned executor through small UI, Job, and Runtime Gateway adapters. Gripper state never implies Attachment state, and no adapter may search for or select a nearest Object.

**Tech Stack:** TypeScript 6.0.3, Zustand 5.0.14, React 19.2.7, Three.js 0.185.1, React Three Fiber 9.6.1, Vitest 4.1.10, Playwright 1.61.1, Node 22.15.1, npm 11.4.2, P5 Runtime Gateway command transport.

## Global Constraints

- Begin from landed P1-P5. In particular, consume P2 `RobotRuntimeRegistryV4`, `RobotJobExecutorV4`, `JobActionExecutionPortV4`, Frame graph, and collision policy plus P5 `command-request-v1`, Runtime Publisher Lease, Action Binding, acknowledgement, terminal result, and deduplication boundaries.
- Import P5 `RuntimeActionCommandOwnerPortV1` from `src/features/runtime-gateway/runtime-action-command-owner-port.ts`; P7 must not redeclare or re-export that port.
- Use only explicit `set-gripper-state`, `attach-object`, and `detach-object` actions. Do not reintroduce `GraspController`, held-object state, grasp sensors, overlap scans, automatic nearest selection, Gripper-triggered reparenting, or release-on-open behavior.
- UI context actions may preselect only the Object on which the operator explicitly opened the menu. Robot, Tool Frame, optional Object Grasp Frame, maximum distance, and Detach target are visible inputs or a named persisted Action.
- Jobs and OPC UA execute persisted `RobotActionDefinitionV4` records by stable Action ID. An OPC UA client supplies only the configured Action Binding ID and command envelope; it cannot supply Robot, Tool, Object, or target Frame IDs.
- `ActionExecutorV4` is the only code allowed to change Gripper state, create/remove an `AttachmentConstraintV4`, or commit an Attachment pose transition.
- `AttachmentConstraintV4` and live Action results are runtime-only and absent from canonical JSON, XML, XLSX, and Project Revision hashing.
- Attach preserves Object World pose and follows the Tool through `relativePose`. Detach preserves Object World pose and reparents to the explicit target Frame or World.
- Attach and Detach discontinuity must be at most 0.0005 m and 0.1 degree.
- Reject OPC UA-owned Objects as `SOURCE_OWNERSHIP_CONFLICT`, duplicate ownership as `ALREADY_ATTACHED`, missing references with the approved stable codes, out-of-range Attach as `OUT_OF_RANGE`, and cycles as `FRAME_CYCLE`.
- Opening a Gripper never Detaches. Closing a Gripper never Attaches.
- Deleting an attached Robot, Tool, Object, or parent remains blocked until the operator confirms an explicit Detach; deletion code never silently Detaches.
- Ignore only the exact active Tool/Object grasp-contact collision pair. The Object remains eligible against other Links, Robots, Objects, and Scene Geometry.
- Simulation Reset clears Attachment/runtime Action state and restores Project initial parents, poses, Joint values, OPEN Grippers, and idle Jobs. Gateway command deduplication records remain under P5 retention rules.
- Keep Core free of React, Three.js, Zustand, browser DOM, WebSocket, filesystem, and `node-opcua`.
- Keep source comments in English and preserve unrelated/untracked CAD directories.
- Every task follows RED, focused GREEN, `npm run lint`, `npm run build`, and one commit.

---

## File Structure

**Create:**

- `src/core/action-runtime/types.ts` — invocation/result/Attachment transition contracts.
- `src/core/action-runtime/attachment-transition.ts` and test — explicit validation and pose-preserving Attach/Detach calculations.
- `src/core/action-runtime/action-executor.ts` and test — the single action dispatch boundary.
- `src/core/action-runtime/index.ts` — public P7 Core exports.
- `src/features/actions/v4/attachment-runtime-store.ts` and test — live constraints and Entity pose overrides.
- `src/features/actions/v4/action-result-store.ts` and test — local invocation result read model.
- `src/features/actions/v4/browser-action-runtime.ts` and test — one executor wired to P2 stores.
- `src/features/actions/v4/runtime-action-command-adapter.ts` and test — P7 adapter that consumes the P5-owned command owner port.
- `src/features/actions/v4/ExplicitAttachmentDialog.tsx` and test — explicit UI Attach/Detach input.
- `src/features/actions/v4/RobotActionPanel.tsx` and test — persisted Action execution and Job step authoring.
- `tests/explicit-pick-place.spec.ts` — browser-level explicit action and reset acceptance.

**Modify:**

- `src/core/project-v4/index.ts`
- `src/core/robot-runtime/index.ts`
- `src/features/scene/v4/scene-runtime-selector.ts`
- `src/features/scene/v4/scene-runtime-selector.test.ts`
- `src/features/robot/v4/RobotInstanceModel.tsx`
- `src/features/robot/v4/RobotInstanceModel.test.tsx`
- `src/features/jobs/v4/job-executor.ts`
- `src/features/jobs/v4/job-executor.test.ts`
- `src/features/collision/current-pose-collision.ts`
- `src/features/collision/current-pose-collision.test.ts`
- `src/features/collision/CurrentPoseCollisionSystem.tsx`
- `src/features/collision/collision-validation-protocol.ts`
- `src/features/collision/collision-validation-protocol.test.ts`
- `src/features/collision/collision-validation.worker.ts`
- `src/features/collision/CollisionPanel.tsx`
- `src/features/collision/CollisionPanel.test.tsx`
- `src/features/scene/SceneContextMenu.tsx`
- `src/features/scene/SceneContextMenu.test.tsx`
- `src/features/scene/scene-command-service.ts`
- `src/features/scene/scene-command-service.test.ts`
- `src/features/jobs/RobotJobList.tsx`
- `src/features/jobs/RobotJobList.test.tsx`
- `src/features/ui/Timeline.tsx`
- `src/features/ui/Timeline.test.tsx`
- `src/features/scene/Workcell.tsx`
- `src/features/scene/Workcell.test.tsx`
- `src/features/project/v4/browser-project-runtime-v4.ts`
- `src/features/project/v4/browser-project-runtime-v4.test.ts`
- `src/app/safe-scene-deletion.ts`
- `src/app/safe-scene-deletion.test.ts`
- `src/app/App.tsx`
- `src/app/App.test.tsx`
- `package.json`

**Forbidden re-creations:**

- `src/features/interaction/GraspController.tsx`
- `src/features/interaction/grasp-actions.ts`
- `src/features/interaction/grasp-participants.ts`
- `src/features/interaction/geometry-grasp-sensor.ts`
- Any state or function named `heldEntityId`, `graspCandidateIds`, `attemptGrasp`, `chooseNearestGraspCandidate`, `holdEquipment`, or `releaseHeldEquipment`.

### Task 1: Add Pure Attachment Transition Contracts

**Files:**
- Create: `src/core/action-runtime/types.ts`
- Create: `src/core/action-runtime/attachment-transition.ts`
- Test: `src/core/action-runtime/attachment-transition.test.ts`
- Create: `src/core/action-runtime/index.ts`
- Modify: `src/core/project-v4/index.ts`

**Interfaces:**
- Consumes: `RigidTransformV4`, `RobotActionDefinitionV4`, `WorkcellProjectV4`, `composeRigidTransformV4`, `relativeRigidTransformV4`, and P2 `FrameGraphNodeV4`.
- Produces: `AttachmentConstraintV4`, `AttachmentRuntimeRecordV4`, `AttachmentTransitionV4`, `prepareAttachTransitionV4`, `prepareDetachTransitionV4`, and approved Attachment error codes.

- [ ] **Step 1: Write RED explicit validation and continuity tests**

```ts
it('attaches only the Object named by the action and preserves its World pose', () => {
  const before = pose([0.4, 0.1, 0.2])
  const transition = prepareAttachTransitionV4(
    attachAction({
      robotId: 'robot-a',
      toolFrameId: 'robot-a:tcp',
      objectId: 'cup-1',
      maximumDistanceM: 0.05,
    }),
    attachmentContext({
      frameWorld: {
        'robot-a:tcp': pose([0.4, 0.1, 0.25]),
        'cup-1:root': before,
      },
    }),
  )
  const after = composeRigidTransformV4(
    transition.record.toolWorldPoseAtAttach,
    transition.record.constraint.relativePose,
  )
  const discontinuity = poseDiscontinuityV4(after, before)
  expect(discontinuity.positionM).toBeLessThanOrEqual(0.0005)
  expect(discontinuity.orientationDeg).toBeLessThanOrEqual(0.1)
  expect(transition.record.constraint.objectId).toBe('cup-1')
})

it('rejects an OPC UA-owned Object without changing runtime state', () => {
  expect(() => prepareAttachTransitionV4(
    attachAction({ objectId: 'cup-1' }),
    attachmentContext({ objectOwner: 'opcua' }),
  )).toThrow('SOURCE_OWNERSHIP_CONFLICT')
})

it('detaches to the explicit parent while preserving World pose', () => {
  const transition = prepareDetachTransitionV4(
    detachAction({ objectId: 'cup-1', targetParentFrameId: 'place-table' }),
    attachedContext(),
  )
  const reconstructed = composeRigidTransformV4(
    transition.targetParentWorldPose,
    transition.nextObjectLocalPose,
  )
  const discontinuity = poseDiscontinuityV4(
    reconstructed,
    transition.objectWorldPoseBefore,
  )
  expect(discontinuity.positionM).toBeLessThanOrEqual(0.0005)
  expect(discontinuity.orientationDeg).toBeLessThanOrEqual(0.1)
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/core/action-runtime/attachment-transition.test.ts
```

Expected: FAIL because the Attachment Core is absent.

- [ ] **Step 3: Define immutable runtime contracts**

```ts
export interface AttachmentConstraintV4 {
  readonly robotId: string
  readonly toolFrameId: string
  readonly objectId: string
  readonly relativePose: RigidTransformV4
  readonly attachedAtSimulationMs: number
}

export interface AttachmentRuntimeRecordV4 {
  readonly constraint: AttachmentConstraintV4
  readonly toolWorldPoseAtAttach: RigidTransformV4
  readonly objectWorldPoseAtAttach: RigidTransformV4
  readonly configuredTransformOwner: 'manual' | 'simulation'
}

export type AttachmentTransitionV4 =
  | {
      readonly kind: 'attach'
      readonly record: AttachmentRuntimeRecordV4
      readonly objectParentFrameId: string
      readonly objectLocalPose: RigidTransformV4
    }
  | {
      readonly kind: 'detach'
      readonly objectId: string
      readonly targetParentFrameId: string | null
      readonly targetParentWorldPose: RigidTransformV4
      readonly objectWorldPoseBefore: RigidTransformV4
      readonly nextObjectLocalPose: RigidTransformV4
    }

export interface AttachmentEvaluationContextV4 {
  readonly project: WorkcellProjectV4
  readonly frameWorldPoses: ReadonlyMap<string, RigidTransformV4>
  readonly attachmentsByObjectId:
    Readonly<Record<string, AttachmentRuntimeRecordV4>>
  readonly simulationMs: number
}

export interface PoseDiscontinuityV4 {
  readonly positionM: number
  readonly orientationDeg: number
}

export interface ActionRuntimeResultV4 {
  readonly invocationId: string
  readonly actionId: string
  readonly source: 'ui' | 'job' | 'opcua'
  readonly state: 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  readonly startedAtSimulationMs: number
  readonly completedAtSimulationMs?: number
  readonly failureCode?: string
  readonly message: string
}

export function poseDiscontinuityV4(
  before: RigidTransformV4,
  after: RigidTransformV4,
): PoseDiscontinuityV4
```

Keep `AttachmentConstraintV4` exactly equal to the approved persisted-free runtime shape. The extra audit poses and configured owner live only in `AttachmentRuntimeRecordV4`.

- [ ] **Step 4: Implement explicit Attach and Detach preparation**

```ts
export function prepareAttachTransitionV4(
  action: Extract<RobotActionDefinitionV4, { readonly kind: 'attach-object' }>,
  context: AttachmentEvaluationContextV4,
): Extract<AttachmentTransitionV4, { readonly kind: 'attach' }>

export function prepareDetachTransitionV4(
  action: Extract<RobotActionDefinitionV4, { readonly kind: 'detach-object' }>,
  context: AttachmentEvaluationContextV4,
): Extract<AttachmentTransitionV4, { readonly kind: 'detach' }>
```

Attach looks up exactly `action.robotId`, `action.toolFrameId`, and `action.objectId`. Validate Robot, Tool, Object, optional Object Grasp Frame, `graspable`, current owner, existing Attachment ownership, Frame ancestry, and Euclidean Tool-to-grasp distance. Calculate `relativePose = relativeRigidTransformV4(toolWorld, objectWorld)`. Detach uses the action's `targetParentFrameId` or World and calculates `relativeRigidTransformV4(targetParentWorld, objectWorld)`. Neither function searches geometry, collision candidates, selection, names, or distances to any other Object.

`poseDiscontinuityV4` uses Euclidean position distance and `2 * acos(clamp(abs(dot(qBefore, qAfter)), 0, 1)) * 180 / Math.PI`; quaternion sign cannot change the reported angle.

- [ ] **Step 5: Add every approved failure test**

```ts
it.each([
  ['missing Object', missingObjectContext(), 'OBJECT_NOT_FOUND'],
  ['missing Tool', missingToolContext(), 'TOOL_FRAME_NOT_FOUND'],
  ['not graspable', nonGraspableContext(), 'OBJECT_NOT_GRASPABLE'],
  ['already attached', alreadyAttachedContext(), 'ALREADY_ATTACHED'],
  ['other Tool owns Object', otherOwnerContext(), 'ALREADY_ATTACHED'],
  ['out of range', outOfRangeContext(), 'OUT_OF_RANGE'],
  ['Frame cycle', cycleContext(), 'FRAME_CYCLE'],
])('%s fails atomically', (_name, context, code) => {
  expect(() => prepareAttachTransitionV4(attachAction(), context)).toThrow(code)
  expect(context.commitCount()).toBe(0)
})

it('accepts the configured distance and rejects the next micrometre', () => {
  expect(() => prepareAttachTransitionV4(
    attachAction({ maximumDistanceM: 0.05 }),
    attachmentContext({ toolToGraspDistanceM: 0.05 }),
  )).not.toThrow()
  expect(() => prepareAttachTransitionV4(
    attachAction({ maximumDistanceM: 0.05 }),
    attachmentContext({ toolToGraspDistanceM: 0.050001 }),
  )).toThrow('OUT_OF_RANGE')
})
```

- [ ] **Step 6: Run GREEN and the Core boundary scan**

```powershell
npm run test:run -- src/core/action-runtime
rg -n 'from .(react|three|zustand|node:|ws|node-opcua)' src/core
rg -n '\b(window|document)\b' src/core
npm run lint
npm run build
```

Expected: all transition tests PASS and the dependency scan returns no matches.

- [ ] **Step 7: Commit**

```powershell
git add src/core/action-runtime src/core/project-v4/index.ts
git diff --cached --check
git commit -m "feat: add explicit attachment transitions"
```

### Task 2: Store Runtime Attachments and Project Them Through the Frame Graph

**Files:**
- Create: `src/features/actions/v4/attachment-runtime-store.ts`
- Test: `src/features/actions/v4/attachment-runtime-store.test.ts`
- Create: `src/features/actions/v4/action-result-store.ts`
- Test: `src/features/actions/v4/action-result-store.test.ts`
- Modify: `src/features/scene/v4/scene-runtime-selector.ts`
- Test: `src/features/scene/v4/scene-runtime-selector.test.ts`

**Interfaces:**
- Consumes: `AttachmentTransitionV4`, P2 Frame graph and `SceneRuntimeProjectionV4`.
- Produces: `AttachmentRuntimeStoreV4`, `ActionResultStoreV4`, `applyAttachmentTransition`, and an Attachment-aware Scene projection without Three.js portals or duplicate Entity renderers.

- [ ] **Step 1: Write RED store and following tests**

```ts
it('commits one Attachment transition atomically', () => {
  const store = createAttachmentRuntimeStoreV4()
  store.getState().applyTransition(attachTransitionForCup())
  expect(store.getState().attachmentsByObjectId['cup-1']?.constraint).toMatchObject({
    robotId: 'robot-a',
    toolFrameId: 'robot-a:tcp',
    objectId: 'cup-1',
  })
  expect(store.getState().entityOverridesById['cup-1']).toMatchObject({
    parentFrameId: 'robot-a:tcp',
    transformOwner: 'attachment',
  })
})

it('projects an attached Object from the current Tool pose', () => {
  const selector = createSceneRuntimeSelectorV4(sceneDependencies())
  attachmentStore.getState().applyTransition(attachTransitionForCup())
  robotRegistry.getState().writeJointValues('robot-a', { j1: 30 }, 'simulation')
  const projection = selector.read()
  expect(projection.entities['cup-1']?.worldPose).toEqual(
    composeRigidTransformV4(
      projection.frames['robot-a:tcp']!.worldPose,
      attachmentStore.getState()
        .attachmentsByObjectId['cup-1']!.constraint.relativePose,
    ),
  )
})

it('rejects an OPC UA transform update while the Object is attached', () => {
  attachmentStore.getState().applyTransition(attachTransitionForCup())
  expect(() => attachmentStore.getState().assertTransformUpdateAllowed(
    'cup-1',
    'opcua:endpoint-a',
  )).toThrow('SOURCE_OWNERSHIP_CONFLICT')
  expect(createSceneRuntimeSelectorV4(sceneDependencies()).read()
    .entities['cup-1']?.worldPose).toEqual(attachedCupWorldPose())
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/actions/v4/attachment-runtime-store.test.ts src/features/actions/v4/action-result-store.test.ts src/features/scene/v4/scene-runtime-selector.test.ts
```

Expected: FAIL because live Attachments are not represented.

- [ ] **Step 3: Implement atomic runtime stores**

```ts
export interface AttachedEntityOverrideV4 {
  readonly parentFrameId: string
  readonly localPose: RigidTransformV4
  readonly transformOwner: 'attachment'
}

export interface DetachedEntityOverrideV4 {
  readonly parentFrameId: string | null
  readonly localPose: RigidTransformV4
  readonly transformOwner: 'manual' | 'simulation'
}

export interface AttachmentRuntimeSnapshotV4 {
  readonly projectRevisionId: string | null
  readonly attachmentsByObjectId:
    Readonly<Record<string, AttachmentRuntimeRecordV4>>
  readonly entityOverridesById:
    Readonly<Record<string, AttachedEntityOverrideV4 | DetachedEntityOverrideV4>>
}

export interface AttachmentRuntimeStoreV4 {
  readonly projectRevisionId: string | null
  readonly attachmentsByObjectId:
    Readonly<Record<string, AttachmentRuntimeRecordV4>>
  readonly entityOverridesById:
    Readonly<Record<string, AttachedEntityOverrideV4 | DetachedEntityOverrideV4>>
  applyTransition(transition: AttachmentTransitionV4): void
  readByObjectId(objectId: string): AttachmentRuntimeRecordV4 | null
  assertTransformUpdateAllowed(
    entityId: string,
    writer: 'manual' | 'simulation' | `opcua:${string}`,
  ): void
  snapshot(): AttachmentRuntimeSnapshotV4
  restore(snapshot: AttachmentRuntimeSnapshotV4): void
  reset(project: WorkcellProjectV4): void
}
```

An Attach transition inserts one record and one `attachment` override in the same Zustand `set`. A Detach transition removes the record and writes the explicit detached parent/local pose. Reject stale Project Revision transitions before `set`.

```ts
export interface ActionResultRuntimeSnapshotV4 {
  readonly projectRevisionId: string | null
  readonly resultsByInvocationId:
    Readonly<Record<string, ActionRuntimeResultV4>>
}

export interface ActionResultStoreV4 {
  readonly projectRevisionId: string | null
  readonly resultsByInvocationId:
    Readonly<Record<string, ActionRuntimeResultV4>>
  setResult(result: ActionRuntimeResultV4): void
  snapshot(): ActionResultRuntimeSnapshotV4
  restore(snapshot: ActionResultRuntimeSnapshotV4): void
  reset(project: WorkcellProjectV4): void
}

export function createActionResultStoreV4(
): StoreApi<ActionResultStoreV4>
```

`ActionResultStoreV4` imports the Core `ActionRuntimeResultV4`, stores browser-local invocation status by invocation ID, and resets without modifying P5 deduplication records.

- [ ] **Step 4: Make Scene projection Attachment-aware**

Build Frame graph nodes from Project state plus `entityOverridesById`. For an attached Object, use Tool Frame as parent and the constraint's `relativePose`; for a detached override, use the explicit target parent/local pose. Recompute the Object World pose whenever Robot Joint or Moving Frame revision changes. Render one Object instance through the existing Spatial Entity renderer; do not create a second portal copy.

P4 keeps incoming samples in render-only buffers rather than mutating Scene state. The Attachment-aware selector therefore gives the `attachment` override absolute precedence, ignores an OPC UA/Simulation/Manual pose sample targeting that attached Object, and reports `SOURCE_OWNERSHIP_CONFLICT` through its diagnostics. Every actual transform mutation port added in Task 6 calls `assertTransformUpdateAllowed` before writing. Tool motion remains valid because it changes the parent Frame, not the attached Object's local pose.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/actions/v4/attachment-runtime-store.test.ts src/features/actions/v4/action-result-store.test.ts src/features/scene/v4/scene-runtime-selector.test.ts
npm run lint
npm run build
git add src/features/actions/v4/attachment-runtime-store* src/features/actions/v4/action-result-store* src/features/scene/v4/scene-runtime-selector*
git diff --cached --check
git commit -m "feat: project live attachments into scene frames"
```

### Task 3: Implement the One Shared ActionExecutorV4

**Files:**
- Create: `src/core/action-runtime/action-executor.ts`
- Test: `src/core/action-runtime/action-executor.test.ts`
- Modify: `src/core/action-runtime/index.ts`
- Create: `src/features/actions/v4/browser-action-runtime.ts`
- Test: `src/features/actions/v4/browser-action-runtime.test.ts`
- Modify: `src/features/project/v4/browser-project-runtime-v4.ts`
- Test: `src/features/project/v4/browser-project-runtime-v4.test.ts`

**Interfaces:**
- Consumes: `RobotActionDefinitionV4`, Attachment preparation, P2 Robot/Scene registries, P7 runtime stores.
- Produces: `ActionExecutorV4`, `ActionExecutorPortsV4`, `ActionInvocationV4`, `ActionExecutionResultV4`, and the single `browserActionExecutorV4` used by UI, Job, and OPC UA adapters.

- [ ] **Step 1: Write RED single-path and Gripper-independence tests**

```ts
it('executes set-gripper-state without creating or removing an Attachment', async () => {
  const executor = createActionExecutorV4(actionExecutorPorts())
  await executor.executeDefinition(
    setGripperAction('robot-a', 'CLOSED'),
    invocation('ui'),
  )
  expect(ports.setGripperState).toHaveBeenCalledWith('robot-a', 'CLOSED')
  expect(ports.commitAttachmentTransition).not.toHaveBeenCalled()
})

it('executes only the explicit Attach Object', async () => {
  const executor = createActionExecutorV4(actionExecutorPorts({
    objects: ['near-cup', 'explicit-cup'],
  }))
  const result = await executor.executeDefinition(
    attachAction({ objectId: 'explicit-cup' }),
    invocation('ui'),
  )
  expect(result.state).toBe('SUCCEEDED')
  expect(ports.commitAttachmentTransition).toHaveBeenCalledWith(
    expect.objectContaining({
      record: expect.objectContaining({
        constraint: expect.objectContaining({ objectId: 'explicit-cup' }),
      }),
    }),
  )
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/core/action-runtime/action-executor.test.ts src/features/actions/v4/browser-action-runtime.test.ts
```

Expected: FAIL because no shared executor exists.

- [ ] **Step 3: Define the executor contract**

```ts
export interface ActionInvocationV4 {
  readonly invocationId: string
  readonly source: 'ui' | 'job' | 'opcua'
  readonly simulationMs: number
  readonly expectedRobotId?: string
}

export type ActionExecutionResultV4 =
  | {
      readonly invocationId: string
      readonly actionId: string
      readonly state: 'SUCCEEDED'
      readonly message: string
      readonly attachedObjectId?: string
    }
  | {
      readonly invocationId: string
      readonly actionId: string
      readonly state: 'FAILED'
      readonly failureCode: string
      readonly message: string
    }

export interface ActionExecutorV4 {
  executeById(
    actionId: string,
    invocation: ActionInvocationV4,
  ): Promise<ActionExecutionResultV4>
  executeDefinition(
    action: RobotActionDefinitionV4,
    invocation: ActionInvocationV4,
  ): Promise<ActionExecutionResultV4>
}
```

`executeById` resolves one active Project Action and delegates to `executeDefinition`. Inline UI actions use `executeDefinition` with an explicit generated `ui-action:<invocationId>` ID. Jobs and OPC UA use `executeById`.

- [ ] **Step 4: Implement one port-based dispatcher**

```ts
export interface ActionExecutorPortsV4 {
  readProject(): WorkcellProjectV4
  readAttachmentContext(): AttachmentEvaluationContextV4
  setGripperState(robotId: string, state: 'OPEN' | 'CLOSED'): void
  commitAttachmentTransition(transition: AttachmentTransitionV4): void
  setResult(result: ActionRuntimeResultV4): void
}

export function createActionExecutorV4(
  ports: ActionExecutorPortsV4,
): ActionExecutorV4
```

Start one `RUNNING` result, dispatch on the three allowed `kind` values, and publish one terminal result. Convert `ProjectV4Error` into a stable `FAILED` result without mutating state. Unexpected errors become `ACTION_EXECUTION_FAILED`; raw stacks remain diagnostic-only. Reject an `expectedRobotId` mismatch as `ACTION_ROBOT_MISMATCH`.

For `set-gripper-state` and `attach-object`, compare `expectedRobotId` with the Action's `robotId`. For `detach-object`, compare it with the active Attachment record's `constraint.robotId`; a detached Object fails as `OBJECT_NOT_ATTACHED` and an Attachment owned by another Robot fails as `ACTION_ROBOT_MISMATCH`.

- [ ] **Step 5: Wire exactly one browser executor**

```ts
export interface BrowserActionRuntimeV4 {
  readonly executor: ActionExecutorV4
  readonly attachmentStore: StoreApi<AttachmentRuntimeStoreV4>
  readonly resultStore: StoreApi<ActionResultStoreV4>
  reset(project: WorkcellProjectV4): void
}

export interface BrowserActionRuntimeDependenciesV4 {
  readonly readProject: () => WorkcellProjectV4
  readonly readAttachmentContext: () => AttachmentEvaluationContextV4
  readonly robotRegistry: StoreApi<RobotRuntimeRegistryV4>
  readonly attachmentStore: StoreApi<AttachmentRuntimeStoreV4>
  readonly resultStore: StoreApi<ActionResultStoreV4>
}

export function createBrowserActionRuntimeV4(
  dependencies: BrowserActionRuntimeDependenciesV4,
): BrowserActionRuntimeV4
```

Instantiate this once in browser composition. Add its prepared/reset snapshots to `browser-project-runtime-v4`; Project Apply clears live Attachments and Action results only after all other candidate resources prepare successfully. Rollback restores the prior runtime snapshot.

- [ ] **Step 6: Run GREEN and commit**

```powershell
npm run test:run -- src/core/action-runtime src/features/actions/v4/browser-action-runtime.test.ts src/features/project/v4/browser-project-runtime-v4.test.ts
npm run lint
npm run build
git add src/core/action-runtime src/features/actions/v4/browser-action-runtime* src/features/project/v4/browser-project-runtime-v4*
git diff --cached --check
git commit -m "feat: add shared robot action executor"
```

### Task 4: Apply Exact Attachment Collision Exclusions

**Files:**
- Modify: `src/features/robot/v4/RobotInstanceModel.tsx`
- Test: `src/features/robot/v4/RobotInstanceModel.test.tsx`
- Modify: `src/features/collision/current-pose-collision.ts`
- Test: `src/features/collision/current-pose-collision.test.ts`
- Modify: `src/features/collision/CurrentPoseCollisionSystem.tsx`
- Modify: `src/features/collision/collision-validation-protocol.ts`
- Test: `src/features/collision/collision-validation-protocol.test.ts`
- Modify: `src/features/collision/collision-validation.worker.ts`
- Modify: `src/features/collision/CollisionPanel.tsx`
- Test: `src/features/collision/CollisionPanel.test.tsx`

**Interfaces:**
- Consumes: P2 `CollisionPolicyV4`, `toolCollisionIdV4`, `canonicalCollisionPairKeyV4`, and `AttachmentRuntimeStoreV4`.
- Produces: `attachmentIgnoredContactPairsV4` and Tool proxy registration for active Tool Frames.

- [ ] **Step 1: Write RED exact-pair tests**

```ts
it('ignores only the attached Tool/Object contact pair', () => {
  const policy = buildCurrentCollisionPolicyV4({
    ...basePolicyInputs(),
    attachments: [attachment('robot-a', 'robot-a:tcp', 'cup-1')],
  })
  expect(policy.ignoredContactPairKeys).toEqual(new Set([
    canonicalCollisionPairKeyV4('tool:robot-a:robot-a:tcp', 'object:cup-1'),
  ]))
  expect(policy.ignoredContactPairKeys).not.toContain(
    canonicalCollisionPairKeyV4('robot-link:robot-a:forearm', 'object:cup-1'),
  )
})

it('still reports an attached Object against another Robot', () => {
  const result = queryGeometryCollisions(
    attachedCupOverlappingRobotB(),
    policyForAttachedCup(),
  )
  expect(result.findings).toContainEqual(expect.objectContaining({
    pairKey: canonicalCollisionPairKeyV4('robot-link:robot-b:wrist', 'object:cup-1'),
  }))
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/robot/v4/RobotInstanceModel.test.tsx src/features/collision
```

Expected: FAIL because Attachment policy input and Tool proxy identity are not connected.

- [ ] **Step 3: Register Tool contact geometry**

For each active Tool Frame, register one explicit collision entity with ID `tool:<robotId>:<toolFrameId>`. Bind its Object3D to the configured Tool collision geometry or Gripper proxy; do not reuse a global `tool:default` ID.

```ts
export function attachmentIgnoredContactPairsV4(
  attachments: readonly AttachmentRuntimeRecordV4[],
): ReadonlySet<CollisionPairKeyV4>
```

Return exactly one canonical Tool/Object pair per active Attachment.

- [ ] **Step 4: Extend current and worker policy snapshots**

Add active Attachment records to collision snapshots and worker messages as immutable IDs only. Build `ignoredContactPairKeys` at query time. Hidden Robot/Group descendants remain excluded; hiding never deletes an Attachment. Detach removes the ignored pair on the next snapshot.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/robot/v4/RobotInstanceModel.test.tsx src/domain/collision src/features/collision
npm run lint
npm run build
git add src/features/robot/v4/RobotInstanceModel* src/features/collision
git diff --cached --check
git commit -m "feat: scope collision exclusions to attached pairs"
```

### Task 5: Execute Job Action Steps Through ActionExecutorV4

**Files:**
- Modify: `src/features/jobs/v4/job-executor.ts`
- Test: `src/features/jobs/v4/job-executor.test.ts`
- Modify: `src/features/jobs/RobotJobList.tsx`
- Test: `src/features/jobs/RobotJobList.test.tsx`
- Modify: `src/features/ui/Timeline.tsx`
- Test: `src/features/ui/Timeline.test.tsx`

**Interfaces:**
- Consumes: P2 `JobActionExecutionPortV4`, `RobotJobExecutorV4`, P7 `ActionExecutorV4`.
- Produces: `createActionExecutorJobPortV4` and ordered Pose/Action Job execution.

- [ ] **Step 1: Write RED action ordering and Gripper-independence tests**

```ts
it('executes Close, Attach, motion, Open, and Detach in declared order', async () => {
  const calls: string[] = []
  const executor = createRobotJobExecutorV4(jobDependencies({
    actionPort: createActionExecutorJobPortV4(recordingActionExecutor(calls)),
  }))
  const run = executor.startJob('pick-place', 0)
  await advanceUntilTerminal(executor, run.runId)
  expect(calls).toEqual([
    'action-close',
    'action-attach-cup',
    'action-open',
    'action-detach-cup',
  ])
})

it('does not Detach when an Open action has no Detach step after it', async () => {
  const runtime = pickPlaceRuntime()
  await runJob(runtime, 'open-without-detach')
  expect(runtime.attachments.readByObjectId('cup-1')).not.toBeNull()
  expect(runtime.robots.getState().robots['robot-a']?.gripperState).toBe('OPEN')
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/jobs/v4/job-executor.test.ts src/features/jobs/RobotJobList.test.tsx src/features/ui/Timeline.test.tsx
```

Expected: the Job fails with `ACTION_EXECUTOR_UNAVAILABLE`.

- [ ] **Step 3: Adapt the shared executor to the Job port**

```ts
export function createActionExecutorJobPortV4(
  executor: ActionExecutorV4,
): JobActionExecutionPortV4 {
  return {
    async execute(actionId, context) {
      const result = await executor.executeById(actionId, {
        invocationId: `${context.runId}:${actionId}`,
        source: 'job',
        simulationMs: context.simulationMs,
        expectedRobotId: context.robotId,
      })
      if (result.state === 'FAILED') {
        throw new ProjectV4Error(
          result.failureCode,
          `$.jobs.${context.jobId}`,
          result.message,
        )
      }
    },
  }
}
```

Inject this port into the existing P2 Job executor singleton. Do not add a second action dispatcher inside Job code.

- [ ] **Step 4: Add Action steps to Job editing**

`RobotJobList` lists persisted Actions compatible with the selected Job Robot. `Timeline` renders Action steps with stable Action name/kind and supports reorder/delete using P2 commands. It does not expose remotely supplied Object IDs and does not interpret Gripper transitions.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/jobs/v4/job-executor.test.ts src/features/jobs/RobotJobList.test.tsx src/features/ui/Timeline.test.tsx
npm run lint
npm run build
git add src/features/jobs src/features/ui/Timeline*
git diff --cached --check
git commit -m "feat: run job actions through shared executor"
```

### Task 6: Add Explicit UI Actions and Attached-Deletion Confirmation

**Files:**
- Create: `src/features/actions/v4/ExplicitAttachmentDialog.tsx`
- Test: `src/features/actions/v4/ExplicitAttachmentDialog.test.tsx`
- Create: `src/features/actions/v4/RobotActionPanel.tsx`
- Test: `src/features/actions/v4/RobotActionPanel.test.tsx`
- Modify: `src/features/scene/SceneContextMenu.tsx`
- Test: `src/features/scene/SceneContextMenu.test.tsx`
- Modify: `src/app/safe-scene-deletion.ts`
- Test: `src/app/safe-scene-deletion.test.ts`
- Modify: `src/features/scene/scene-command-service.ts`
- Test: `src/features/scene/scene-command-service.test.ts`
- Modify: `src/app/App.tsx`
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Consumes: the singleton `ActionExecutorV4`, active Project Actions, Frame/Robot/Spatial Entity selectors, `AttachmentRuntimeStoreV4`.
- Produces: explicit Attach/Detach dialogs, persisted Action execution UI, and `AttachedDeletionGuardV4`.

- [ ] **Step 1: Write RED explicit-input and deletion tests**

```tsx
it('requires visible Robot, Tool, Object, and distance inputs before Attach', async () => {
  render(<ExplicitAttachmentDialog mode="attach" explicitObjectId="cup-1" />)
  expect(screen.getByLabelText('Object')).toHaveValue('cup-1')
  expect(screen.getByLabelText('Robot')).toHaveValue('')
  expect(screen.getByLabelText('Tool frame')).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Attach' })).toBeDisabled()
  await user.selectOptions(screen.getByLabelText('Robot'), 'robot-a')
  await user.selectOptions(screen.getByLabelText('Tool frame'), 'robot-a:tcp')
  await user.type(screen.getByLabelText('Maximum distance (m)'), '0.05')
  expect(screen.getByRole('button', { name: 'Attach' })).toBeEnabled()
})

it('blocks deleting an attached Object until explicit Detach succeeds', async () => {
  const guard = createAttachedDeletionGuardV4(deletionDependencies())
  await expect(guard.deleteEntity('cup-1')).rejects.toMatchObject({
    code: 'ATTACHED_ENTITY_DETACH_REQUIRED',
    objectIds: ['cup-1'],
  })
  expect(dependencies.deleteEntity).not.toHaveBeenCalled()
  await guard.confirmDetachAndDelete('cup-1', { targetParentFrameId: 'world' })
  expect(dependencies.actionExecutor.executeDefinition).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'detach-object', objectId: 'cup-1' }),
    expect.objectContaining({ source: 'ui' }),
  )
  expect(dependencies.deleteEntity).toHaveBeenCalledWith('cup-1')
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/actions/v4/ExplicitAttachmentDialog.test.tsx src/features/actions/v4/RobotActionPanel.test.tsx src/features/scene/SceneContextMenu.test.tsx src/features/scene/scene-command-service.test.ts src/app/safe-scene-deletion.test.ts
```

Expected: FAIL because no explicit action UI or Attachment deletion guard exists.

- [ ] **Step 3: Implement explicit context actions**

`Attach...` opens only for an explicitly selected graspable Object and requires Robot, Tool Frame, optional Object Grasp Frame, and maximum distance. `Detach...` opens only for that Object's active Attachment and requires World or a named target Frame. Submit creates an inline `RobotActionDefinitionV4` whose ID is `ui-action:<invocationId>` and calls `browserActionExecutorV4.executeDefinition`. The dialog never requests collision candidates or computes nearest distance.

- [ ] **Step 4: Implement persisted Action UI**

`RobotActionPanel` lists the Project's Action ID, name, kind, Robot, Tool, Object, and target. Execute calls `executeById` on the same singleton. Add-to-Job creates one `action-reference` step through `JobCommandServiceV4`.

Replace every Open/Close Gripper button in `App.tsx` or Robot inspectors with an inline explicit `set-gripper-state` call to `ActionExecutorV4.executeDefinition`. UI code must not call `RobotRuntimeRegistryV4.setGripperState` directly.

- [ ] **Step 5: Implement transform and deletion guards**

Before `SceneCommandServiceV4` changes an Entity pose or parent, call `AttachmentRuntimeStoreV4.assertTransformUpdateAllowed` with the command's explicit `manual` or `simulation` writer. If the Entity is attached, fail with `SOURCE_OWNERSHIP_CONFLICT` before the Project mutation recipe. The P4 attachment-aware render selector independently ignores buffered OPC UA pose samples for that Entity, so none of the three owners can override the Tool-relative constraint.

```ts
export interface AttachedDeletionBlockV4 {
  readonly code: 'ATTACHED_ENTITY_DETACH_REQUIRED'
  readonly requestedEntityId: string
  readonly objectIds: readonly string[]
}

export interface AttachedDeletionGuardV4 {
  deleteEntity(entityId: string): Promise<void>
  confirmDetachAndDelete(
    entityId: string,
    target: { readonly targetParentFrameId: string | null },
  ): Promise<void>
}

export interface AttachedDeletionGuardDependenciesV4 {
  readonly attachments: StoreApi<AttachmentRuntimeStoreV4>
  readonly actionExecutor: ActionExecutorV4
  readonly deleteEntity: (entityId: string) => Promise<void>
  readonly descendantFrameIds: (entityId: string) => ReadonlySet<string>
  readonly createInvocationId: () => string
  readonly readSimulationMs: () => number
}

export function createAttachedDeletionGuardV4(
  dependencies: AttachedDeletionGuardDependenciesV4,
): AttachedDeletionGuardV4
```

Detect Attachments that reference the requested Object, Robot, Tool Frame, or a parent Frame below the requested entity. `deleteEntity` returns the block without mutation. `confirmDetachAndDelete` executes one explicit Detach action per listed Object, verifies every result is `SUCCEEDED`, then retries deletion. A failed Detach leaves the entity and all remaining Attachments intact.

- [ ] **Step 6: Run GREEN and commit**

```powershell
npm run test:run -- src/features/actions/v4 src/features/scene/SceneContextMenu.test.tsx src/features/scene/scene-command-service.test.ts src/app/safe-scene-deletion.test.ts src/app/App.test.tsx
npm run lint
npm run build
git add src/features/actions/v4 src/features/scene/SceneContextMenu* src/features/scene/scene-command-service* src/app/safe-scene-deletion* src/app/App*
git diff --cached --check
git commit -m "feat: add explicit attachment controls"
```

### Task 7: Route OPC UA Action Bindings Through the Same Executor

**Files:**
- Create: `src/features/actions/v4/runtime-action-command-adapter.ts`
- Test: `src/features/actions/v4/runtime-action-command-adapter.test.ts`
- Modify: `src/app/App.tsx`
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Consumes: P1 `CommandRequestV1`/`CommandResultV1`, P5-owned `RuntimeActionCommandOwnerPortV1` imported from `src/features/runtime-gateway/runtime-action-command-owner-port.ts`, `OpcUaActionBindingV4`, `ActionExecutorV4`, and `RobotJobExecutorV4`.
- Produces: `RuntimeActionCommandAdapterV4` with handlers for `action-execute` and `job-start`; P7 does not define or export the owner port.

- [ ] **Step 1: Write RED routing, terminal-state, and explicit-target tests**

```ts
it('routes action-execute to the same ActionExecutor instance used by UI', async () => {
  const adapter = createRuntimeActionCommandAdapterV4(commandDependencies())
  await adapter.handle(commandRequest({ targetId: 'binding-close' }))
  expect(dependencies.actionExecutor.executeById).toHaveBeenCalledWith(
    'action-close',
    expect.objectContaining({ source: 'opcua' }),
  )
  expect(dependencies.secondExecutorFactory).not.toHaveBeenCalled()
})

it('does not accept remotely supplied Robot or Object IDs', async () => {
  const result = await adapter.handle(commandRequest({
    targetId: 'binding-attach-cup-1',
    value: { robotId: 'robot-b', objectId: 'cup-2' },
  }))
  expect(result).toMatchObject({
    executionState: 'FAILED',
    failureCode: 'ACTION_BINDING_PAYLOAD_FORBIDDEN',
  })
  expect(dependencies.actionExecutor.executeById).not.toHaveBeenCalled()
})

it('keeps job-start RUNNING until the Job terminates', async () => {
  const pending = adapter.handle(commandRequest({ targetId: 'binding-job-a' }))
  expect(dependencies.commandResults.latest()).toMatchObject({
    acknowledgement: 'ACCEPTED',
    executionState: 'RUNNING',
  })
  dependencies.jobExecutor.complete('run-a', 'SUCCEEDED')
  await expect(pending).resolves.toMatchObject({
    executionState: 'SUCCEEDED',
  })
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/actions/v4/runtime-action-command-adapter.test.ts src/app/App.test.tsx
```

Expected: FAIL because the P5 owner port exists but P7 has not implemented its Action command adapter.

- [ ] **Step 3: Import the P5 registration seam and define only the P7 adapter**

```ts
import type { RuntimeActionCommandOwnerPortV1 } from '../../runtime-gateway/runtime-action-command-owner-port'

export interface RuntimeActionCommandAdapterV4 {
  handle(request: CommandRequestV1): Promise<CommandResultV1>
  register(port: RuntimeActionCommandOwnerPortV1): () => void
}

export interface RuntimeActionCommandAdapterDependenciesV4 {
  readonly readProject: () => WorkcellProjectV4
  readonly actionExecutor: ActionExecutorV4
  readonly jobExecutor: RobotJobExecutorV4
  readonly publishRunning: (
    request: CommandRequestV1,
    attachedObjectId?: string,
  ) => void
}

export function createRuntimeActionCommandAdapterV4(
  dependencies: RuntimeActionCommandAdapterDependenciesV4,
): RuntimeActionCommandAdapterV4
```

P5 validates Project/config Revision, Lease generation, expiry, direction, trigger staging, immutable command fields, and deduplication before invoking this handler. P7 resolves `request.targetId` only against the active Project's preconfigured `OpcUaActionBindingV4`.

- [ ] **Step 4: Implement action-execute and job-start**

For `action-execute`, reject a typed value payload, call `ActionExecutorV4.executeById`, and translate its terminal result to `CommandResultV1`. For `job-start`, validate Simulation ownership, call `startJob`, then await `waitForTerminal`. Return `ACCEPTED` independently from terminal state through the P5 result publisher. Do not complete `job-start` when enqueueing succeeds.

Use one invocation identity:

```ts
const invocationId =
  `${request.configRevision}:${request.leaseGeneration}:` +
  `${request.targetId}:${request.commandId}`
```

This identity is diagnostic; P5 remains the sole deduplication owner.

- [ ] **Step 5: Prove UI, Job, and OPC UA share one executor**

```ts
it('observes all three origins on one executor spy', async () => {
  await uiActions.execute('action-close')
  await jobActionPort.execute('action-close', jobContext())
  await opcAdapter.handle(commandRequest({ targetId: 'binding-close' }))
  expect(sharedExecutor.executeById.mock.calls.map(([, call]) => call.source))
    .toEqual(['ui', 'job', 'opcua'])
})
```

- [ ] **Step 6: Run GREEN and commit**

```powershell
npm run test:run -- src/features/actions/v4/runtime-action-command-adapter.test.ts src/features/actions/v4/browser-action-runtime.test.ts src/features/jobs/v4/job-executor.test.ts src/app/App.test.tsx
npm run lint
npm run build
git add src/features/actions/v4/runtime-action-command-adapter* src/app/App*
git diff --cached --check
git commit -m "feat: route opc ua actions through shared executor"
```

### Task 8: Reset and Prove Explicit Pick/Place End to End

**Files:**
- Modify: `src/features/scene/Workcell.tsx`
- Test: `src/features/scene/Workcell.test.tsx`
- Modify: `src/features/project/v4/browser-project-runtime-v4.ts`
- Test: `src/features/project/v4/browser-project-runtime-v4.test.ts`
- Modify: `src/app/App.tsx`
- Test: `src/app/App.test.tsx`
- Create: `tests/explicit-pick-place.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the P7 browser action runtime, P2 Project/Robot/Scene/Job reset APIs, and P5 runtime command adapter.
- Produces: deterministic Simulation Reset and the complete P7 gate consumed by P8.

- [ ] **Step 1: Write RED reset and world-continuity tests**

```ts
it('restores initial state after an attached transport and detach', async () => {
  const runtime = explicitPickPlaceRuntime()
  const initial = runtime.snapshot()
  await runtime.actions.executeById('action-attach-cup', invocation('ui'))
  runtime.robots.getState().writeJointValues('robot-a', { j1: 40 }, 'simulation')
  await runtime.actions.executeById('action-detach-cup', invocation('ui'))
  runtime.resetSimulation()
  expect(runtime.snapshot()).toMatchObject({
    robots: initial.robots,
    entities: initial.entities,
    attachments: {},
    jobs: initial.jobs,
    actionResults: {},
  })
  expect(runtime.robots.getState().robots['robot-a']?.gripperState).toBe('OPEN')
})

it('keeps Attach and Detach discontinuity inside tolerance', async () => {
  const beforeAttach = runtime.objectWorldPose('cup-1')
  await runtime.actions.executeById('action-attach-cup', invocation('ui'))
  const afterAttach = runtime.objectWorldPose('cup-1')
  const attachDelta = poseDiscontinuityV4(beforeAttach, afterAttach)
  expect(attachDelta.positionM).toBeLessThanOrEqual(0.0005)
  expect(attachDelta.orientationDeg).toBeLessThanOrEqual(0.1)
  const beforeDetach = runtime.objectWorldPose('cup-1')
  await runtime.actions.executeById('action-detach-cup', invocation('ui'))
  const detachDelta = poseDiscontinuityV4(
    beforeDetach,
    runtime.objectWorldPose('cup-1'),
  )
  expect(detachDelta.positionM).toBeLessThanOrEqual(0.0005)
  expect(detachDelta.orientationDeg).toBeLessThanOrEqual(0.1)
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/project/v4/browser-project-runtime-v4.test.ts src/features/scene/Workcell.test.tsx src/app/App.test.tsx
```

Expected: FAIL because Reset does not yet coordinate P7 runtime state.

- [ ] **Step 3: Implement ordered Simulation Reset**

Run Reset in this order:

```ts
export interface SimulationResetDependenciesV4 {
  readonly jobs: RobotJobExecutorV4
  readonly actions: BrowserActionRuntimeV4
  readonly robots: StoreApi<RobotRuntimeRegistryV4>
  readonly scene: StoreApi<SceneRuntimeStoreV4>
  readonly clearCollisionFindings: () => void
}

export function resetSimulationV4(
  project: WorkcellProjectV4,
  dependencies: SimulationResetDependenciesV4,
): void {
  dependencies.jobs.reset()
  dependencies.actions.reset(project)
  dependencies.robots.getState().reset(project)
  dependencies.scene.getState().reset(project)
  dependencies.clearCollisionFindings()
}
```

`browserActionRuntimeV4.reset` clears Attachments, detached pose overrides, and local Action results. Robot reset restores initial Joint values, OPEN Grippers, numeric status, visibility, selected Tool/TCP, and source ownership. Scene reset restores Project parent/local poses. Do not delete P5 command deduplication records.

- [ ] **Step 4: Add browser explicit Pick/Place acceptance**

```ts
test('explicit Job Attach and Detach follows the Tool and resets', async ({ page }) => {
  await page.goto('/')
  await loadProjectV4(page, explicitPickPlaceFixture())
  const before = await readObjectWorldPose(page, 'Cup 01')
  await startJob(page, 'Robot A', 'Pick Place')
  await expectJobState(page, 'Robot A', 'RUNNING')
  await expectAttachment(page, 'Cup 01', 'Robot A / TCP')
  await expectObjectToFollowTool(page, 'Cup 01', 'Robot A / TCP')
  await expectJobState(page, 'Robot A', 'SUCCEEDED')
  await expectAttachment(page, 'Cup 01', 'Detached')
  const discontinuity = await readAttachmentDiscontinuity(page, 'Cup 01')
  expect(discontinuity.positionM).toBeLessThanOrEqual(0.0005)
  expect(discontinuity.orientationDeg).toBeLessThanOrEqual(0.1)
  await page.getByRole('button', { name: 'Reset Simulation' }).click()
  await expectObjectWorldPose(page, 'Cup 01', before)
  await expectGripperState(page, 'Robot A', 'OPEN')
})
```

Use source-only primitive/builtin geometry. The external MRb05 and real OPC UA TCP acceptance remains P8, but this test must exercise the same browser executor and command adapter with a mocked P5 owner port.

- [ ] **Step 5: Prove automatic-nearest behavior remains absent**

```powershell
rg -n "attemptGrasp|chooseNearestGraspCandidate|nearest.*grasp|graspCandidateIds|heldEntityId|holdEquipment|releaseHeldEquipment|createGeometryGraspSensorEntity|GraspController" src tests
rg -n "setGripperState.*attach|gripperOpen.*attach|gripperState.*detach" src
rg -n "setGripperState\\(" src | rg -v "robot-runtime-registry|action-executor|browser-action-runtime"
```

Expected: all three commands return no matches. Tests must prove CLOSE without Attach and OPEN without Detach.

- [ ] **Step 6: Run the complete P7 GREEN gate**

```powershell
npm run test:run -- src/core/action-runtime src/features/actions src/features/jobs src/features/scene src/features/collision src/features/project/v4 src/app
npm run test:middleware
npm run lint
npm run build:gateway
npm run build
npm run test:e2e:v4
npx playwright test tests/explicit-pick-place.spec.ts
git status --short
```

Expected: all tests PASS; UI, Job, and OPC UA adapters call one executor; only an explicit Object is attached; Attach/Detach preserve pose; exact grasp contact is ignored while unrelated collision pairs remain; duplicate ownership/OPC UA ownership/range/cycle failures are stable and atomic; Reset restores initial runtime state; no automatic grasp code exists.

- [ ] **Step 7: Add the P7 verification script**

Add without changing the P5/P8 scripts:

```json
{
  "scripts": {
    "test:e2e:pick-place": "playwright test tests/explicit-pick-place.spec.ts",
    "verify:pick-place": "npm run test:run -- src/core/action-runtime src/features/actions src/features/jobs src/features/scene src/features/collision src/features/project/v4 src/app && npm run test:middleware && npm run lint && npm run build:gateway && npm run build && npm run test:e2e:pick-place"
  }
}
```

- [ ] **Step 8: Commit**

```powershell
git add src/core/action-runtime src/features/actions src/features/jobs src/features/scene src/features/robot/v4 src/features/collision src/features/project/v4 src/app tests/explicit-pick-place.spec.ts package.json package-lock.json
git diff --cached --check
git status --short
git commit -m "feat: complete explicit pick and place actions"
```

Before committing, confirm `git status --short` does not stage `Savvy/`, `NED2_10kg-152_retired-controller_rev00_STEP_C/`, or `NED2_12kg-127_retired-controller_rev00_STEP_J.premerge-backup-20260713/`.
