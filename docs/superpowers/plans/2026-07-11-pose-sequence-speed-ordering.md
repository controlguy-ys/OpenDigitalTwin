# Velocity-Aware Pose Sequence Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Simulation Mode operators save, rename, reorder, and persist named robot Poses while setting each outgoing segment to 1–100% of the effective robot joint velocity limits.

**Architecture:** A pure domain module validates Pose Sequences, calculates velocity-safe segment durations, and samples named-joint interpolation. A Dexie-backed sequence store owns persisted order and speed values. The Timeline snapshots one sequence plus robot/configuration/TCP revisions at Play, while an accessible editor supports native drag-and-drop and keyboard reordering only when Simulation owns the robot and playback is stopped.

**Tech Stack:** TypeScript 6, React 19, Zustand 5, Dexie 4, native HTML Drag and Drop, Vitest 4, Testing Library, Playwright 1.61

## Global Constraints

- Start only after Frame Graph, Generic Robot, and OPC UA Joint Source plans are complete and reviewed.
- Consume the active `EffectiveRobotDefinition`, `RobotInstanceV1`, `RobotJointSource`, `JointSourceCoordinator`, the OPC plan's `RobotPlaybackController`/`RobotPlaybackPauseReason`, and `sceneDb`; do not create duplicate robot, playback, or source state.
- This feature is writable only in Simulation Mode with no active playback
  session. OPC UA ownership or a playing/paused snapshot disables Pose
  add/edit/reorder/delete; Pause retains the snapshot until Resume or Stop.
- UI disabling is advisory: every persisted Pose mutation also acquires the OPC plan's per-instance `RobotSimulationMutationGate`, rechecks Simulation ownership and stopped playback under its commit lock, and publishes no DB or memory change if a source/playback generation invalidates the lease.
- `speedPercentToNext` is an integer from 1 through 100 and moves with its source Pose.
- Segment time is derived from effective joint `maxVelocity`; it is not an independently persisted duration.
- Internal revolute units are radians, prismatic units are metres, and time is milliseconds.
- All joints arrive together without exceeding `maxVelocity * speedPercent / 100`.
- Smoothstep `easeInOut` multiplies base duration by 1.5 to bound its peak derivative.
- Continuous-joint positions are unwrapped; never silently choose a shortest path.
- Collision and BAD/STALE quality pause at the current elapsed position.
- Reordering, speed edits, and sequence mutations persist atomically and survive reload.
- Each sequence belongs to one RobotInstance plus one definition/configuration revision; it is never ambiguously shared by every instance of a definition.
- Any NED2 Poses present in the retiring same-runtime memory store convert by stable joint IDs with exact degree-to-radian conversion, preserving physical joint angles rather than raw numeric units.
- Every bounded commanded joint position is validated against the active effective lower/upper limits during migration, hydration, capture, edit, and the final Play snapshot; playback never relies on downstream clamping.
- The current v1/v2 `scene` table contains selection only and no persisted keyframes. Therefore a cold upgrade has no durable legacy Pose data to recover. The only compatibility source is the retiring same-runtime `useRobotStore.keyframes`; the bridge uses an explicit injected snapshot and marker instead of inventing a nonexistent scene row, and documentation states this baseline limitation.

---

## File Map

```text
src/domain/robot/pose-sequence.ts
src/domain/robot/pose-sequence.test.ts
src/features/sequences/pose-sequence-store.ts
src/features/sequences/pose-sequence-store.test.ts
src/features/sequences/PoseSequenceEditor.tsx
src/features/sequences/PoseSequenceEditor.test.tsx
src/features/sequences/PoseStepRow.tsx
src/features/ui/Timeline.tsx
src/features/ui/Timeline.test.tsx
src/features/joints/JointInspector.tsx
src/features/joints/JointInspector.test.tsx
src/app/App.tsx
src/state/scene-db.ts
src/state/scene-db.test.ts
src/test/debug-bridge.ts
src/test/debug-bridge.test.ts
e2e/pose-sequence.spec.ts
docs/operator/pose-sequences.md
docs/developer/pose-sequence-format.md
```

## Task 1: Implement Velocity-Safe Pose Sequence Math

**Files:**
- Create: `src/domain/robot/pose-sequence.ts`
- Create: `src/domain/robot/pose-sequence.test.ts`
- Modify: `src/features/joints/keyframes.ts`
- Test: `src/features/joints/keyframes.test.ts`

**Interfaces:**
- Consumes: `EffectiveRobotDefinition`, ordered movable joint IDs and limits.
- Produces: `PoseStepV1`, `PoseSequenceV1`, `validatePoseSequence()`,
  `validateSequenceVelocityCoverage()`, `calculateSegmentDurationMs()`, and
  `samplePoseSequence()`.

- [ ] **Step 1: Write failing speed and interpolation tests**

```ts
const definition = effectiveDefinition({
  joints: [
    revoluteJoint('J1', { maxVelocity: 1 }),
    revoluteJoint('J2', { maxVelocity: 2 }),
    prismaticJoint('J3', { maxVelocity: 0.5 }),
  ],
})

it('uses the slowest joint and selected percent for one synchronized duration', () => {
  const from = pose({ J1: 0, J2: 0, J3: 0 }, 50, 'linear')
  const to = pose({ J1: 1, J2: 3, J3: 0.25 }, 100, 'linear')
  expect(calculateSegmentDurationMs(definition, from, to)).toBe(3_000)
})

it('multiplies smoothstep time by 1.5 so peak velocity stays bounded', () => {
  const from = pose({ J1: 0, J2: 0, J3: 0 }, 100, 'easeInOut')
  const to = pose({ J1: 1, J2: 0, J3: 0 }, 100, 'linear')
  expect(calculateSegmentDurationMs(definition, from, to)).toBe(1_500)
})

it('returns zero for an all-zero segment without requiring unused velocity limits', () => {
  const noVelocities = effectiveDefinition({
    joints: [revoluteJoint('J1', { maxVelocity: null }), prismaticJoint('J2', { maxVelocity: 0 })],
  })
  expect(calculateSegmentDurationMs(
    noVelocities,
    pose({ J1: 0, J2: 0 }, 100, 'linear'),
    pose({ J1: 0, J2: 0 }, 100, 'linear'),
  )).toBe(0)
})

it('reports every moving joint whose maximum velocity is invalid', () => {
  const missing = effectiveDefinition({
    joints: [revoluteJoint('J1', { maxVelocity: null }), prismaticJoint('J2', { maxVelocity: -1 })],
  })
  expect(() => calculateSegmentDurationMs(
    missing,
    pose({ J1: 0, J2: 0 }, 100, 'linear'),
    pose({ J1: 1, J2: 0.2 }, 100, 'linear'),
  )).toThrow(/J1.*J2|J2.*J1/)
})

it('preflights missing velocities across every segment before playback', () => {
  const missing = effectiveDefinition({
    joints: [revoluteJoint('J1', { maxVelocity: null }), prismaticJoint('J2', { maxVelocity: 0 })],
  })
  const sequence = sequenceFromSteps([
    pose({ J1: 0, J2: 0 }, 100),
    pose({ J1: 1, J2: 0 }, 100),
    pose({ J1: 1, J2: 0.2 }, 100),
  ])
  expect(() => validateSequenceVelocityCoverage(missing, sequence)).toThrow(/J1.*J2/)
})

it('preserves an unwrapped continuous-joint turn', () => {
  const continuous = effectiveDefinition({ joints: [continuousJoint('C1', 2)] })
  const sample = samplePoseSegment(continuous, pose({ C1: 0 }, 100), pose({ C1: Math.PI * 4 }, 100), 0.5)
  expect(sample.C1).toBeCloseTo(Math.PI * 2)
})

it('converts legacy NED2 degrees to radians without changing the physical angle', () => {
  const converted = legacyKeyframesToPoseSequence(
    [legacyKeyframe({ jointsDeg: [180, -90, 0, 45, 360, -180] })],
    ned2Context,
    1_000,
  )
  expect(converted.steps[0]!.jointPositions).toMatchObject({
    J1: Math.PI, J2: -Math.PI / 2, J3: 0, J4: Math.PI / 4,
    J5: Math.PI * 2, J6: -Math.PI,
  })
  expect(ned2ForwardKinematics(converted.steps[0]!.jointPositions))
    .toEqual(ned2ForwardKinematicsFromLegacyDegrees([180, -90, 0, 45, 360, -180]))
})

it.each([0, 101, 1.5, Number.NaN])('rejects invalid speed %s', (speed) => {
  expect(() => validatePoseSequence(contextFor(definition), sequenceWithSpeed(speed))).toThrow()
})

it('rejects a bounded commanded joint outside the effective limits', () => {
  const invalid = sequenceWithPose(pose({ J1: 2.1, J2: 0, J3: 0 }, 100, 'linear'))
  expect(() => validatePoseSequence(contextFor(definition), invalid)).toThrow(/J1.*limit/i)
})

it.each([
  ['unknown schema', { schemaVersion: 2 }, /schema version/i],
  ['empty sequence id', { id: '   ' }, /sequence id/i],
  ['empty sequence name', { name: '' }, /sequence name/i],
  ['non-finite timestamp', { updatedAtMs: Number.NaN }, /timestamp/i],
] as const)('rejects an invalid %s envelope', (_caseName, patch, message) => {
  expect(() => validatePoseSequence(
    contextFor(definition),
    { ...validSequence(), ...patch } as PoseSequenceV1,
  )).toThrow(message)
})

it.each([
  ['empty Pose id', { id: ' ' }, /Pose id/i],
  ['empty Pose name', { name: '' }, /Pose name/i],
  ['unknown easing', { easing: 'cubic' as PoseEasing }, /easing/i],
] as const)('rejects %s', (_caseName, stepPatch, message) => {
  const base = validSequence()
  const invalid = validSequence({
    steps: [{ ...base.steps[0]!, ...stepPatch }],
  })
  expect(() => validatePoseSequence(contextFor(definition), invalid)).toThrow(message)
})
```

Define the test-local helpers in the same test file as complete object factories
returning valid `EffectiveRobotDefinition` and `PoseStepV1` records; do not mock
the calculation under test.

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/domain/robot/pose-sequence.test.ts src/features/joints/keyframes.test.ts`

Expected: FAIL because the generic sequence module does not exist.

- [ ] **Step 3: Implement exact sequence types and validation**

```ts
export type PoseEasing = 'linear' | 'easeInOut'

export interface PoseStepV1 {
  readonly id: string
  readonly name: string
  readonly jointPositions: Readonly<Record<string, number>>
  readonly speedPercentToNext: number
  readonly easing: PoseEasing
}

export interface PoseSequenceV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly robotInstanceId: string
  readonly robotDefinitionId: string
  readonly robotDefinitionRevision: string
  readonly mechanicalConfigurationId: string
  readonly mechanicalConfigurationRevision: string
  readonly name: string
  readonly steps: readonly PoseStepV1[]
  readonly updatedAtMs: number
}

export interface PoseSequenceRobotContext {
  readonly robotInstanceId: string
  readonly robotDefinitionId: string
  readonly robotDefinitionRevision: string
  readonly mechanicalConfigurationId: string
  readonly mechanicalConfigurationRevision: string
  readonly definition: EffectiveRobotDefinition
}

export function validatePoseSequence(
  context: PoseSequenceRobotContext,
  sequence: PoseSequenceV1,
): PoseSequenceV1 {
  const requireText = (value: unknown, label: string, maxLength = 128): string => {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
      throw new Error(`${label} must be a non-empty string of at most ${maxLength} characters`)
    }
    return value
  }
  if (sequence.schemaVersion !== 1) throw new Error('Unsupported Pose Sequence schema version')
  requireText(sequence.id, 'Pose Sequence id')
  requireText(sequence.name, 'Pose Sequence name', 256)
  requireText(sequence.robotInstanceId, 'RobotInstance id')
  requireText(sequence.robotDefinitionId, 'RobotDefinition id')
  requireText(sequence.robotDefinitionRevision, 'RobotDefinition revision')
  requireText(sequence.mechanicalConfigurationId, 'Mechanical configuration id')
  requireText(sequence.mechanicalConfigurationRevision, 'Mechanical configuration revision')
  if (!Number.isFinite(sequence.updatedAtMs) || sequence.updatedAtMs < 0) {
    throw new Error('Pose Sequence timestamp must be a finite non-negative number')
  }
  if (!Array.isArray(sequence.steps)) throw new Error('Pose Sequence steps must be an array')
  if (
    sequence.robotInstanceId !== context.robotInstanceId ||
    sequence.robotDefinitionId !== context.robotDefinitionId ||
    sequence.robotDefinitionRevision !== context.robotDefinitionRevision ||
    sequence.mechanicalConfigurationId !== context.mechanicalConfigurationId ||
    sequence.mechanicalConfigurationRevision !== context.mechanicalConfigurationRevision
  ) {
    throw new Error('Pose Sequence robot instance or revision does not match')
  }
  const definition = context.definition
  const movableJoints = orderedMovableJoints(definition)
  const expected = new Set(movableJoints.map(({ id }) => id))
  const stepIds = new Set<string>()
  for (const step of sequence.steps) {
    requireText(step.id, 'Pose id')
    requireText(step.name, 'Pose name', 256)
    if (stepIds.has(step.id)) throw new Error(`Duplicate Pose id: ${step.id}`)
    stepIds.add(step.id)
    if (step.easing !== 'linear' && step.easing !== 'easeInOut') {
      throw new Error(`Pose ${step.id} easing is invalid`)
    }
    if (!Number.isInteger(step.speedPercentToNext) || step.speedPercentToNext < 1 || step.speedPercentToNext > 100) {
      throw new Error('Pose speed must be an integer from 1 through 100')
    }
    const received = Object.keys(step.jointPositions)
    if (received.length !== expected.size || received.some((id) => !expected.has(id))) {
      throw new Error(`Pose ${step.id} joint set does not match the robot`)
    }
    if (Object.values(step.jointPositions).some((value) => !Number.isFinite(value))) {
      throw new Error(`Pose ${step.id} contains a non-finite joint`)
    }
    for (const joint of movableJoints) {
      const value = step.jointPositions[joint.id]!
      if (joint.type !== 'continuous' && (
        (joint.limits.lower !== null && value < joint.limits.lower) ||
        (joint.limits.upper !== null && value > joint.limits.upper)
      )) {
        throw new Error(`Pose ${step.id} joint ${joint.id} is outside its commanded limits`)
      }
    }
  }
  return sequence
}
```

- [ ] **Step 4: Implement duration and sampling**

```ts
export function calculateSegmentDurationMs(
  definition: EffectiveRobotDefinition,
  from: PoseStepV1,
  to: PoseStepV1,
): number {
  const speedScale = from.speedPercentToNext / 100
  let seconds = 0
  const missingVelocityJointIds: string[] = []
  for (const joint of orderedMovableJoints(definition)) {
    const delta = Math.abs(to.jointPositions[joint.id]! - from.jointPositions[joint.id]!)
    if (delta === 0) continue
    const maxVelocity = joint.limits.maxVelocity
    if (maxVelocity === null || !Number.isFinite(maxVelocity) || maxVelocity <= 0) {
      missingVelocityJointIds.push(joint.id)
      continue
    }
    seconds = Math.max(seconds, delta / (maxVelocity * speedScale))
  }
  if (missingVelocityJointIds.length > 0) {
    throw new Error(`Moving joints require positive maximum velocity: ${missingVelocityJointIds.join(', ')}`)
  }
  const peakFactor = from.easing === 'easeInOut' ? 1.5 : 1
  const durationMs = seconds * peakFactor * 1_000
  if (!Number.isFinite(durationMs)) throw new Error('Pose segment duration is invalid')
  return durationMs
}
```

Before calculating any durations, `validateSequenceVelocityCoverage()` scans
all adjacent Pose pairs, collects every joint that moves at least once, and
reports in effective-definition order every such joint with null/non-finite/
non-positive `maxVelocity`. Timeline calls this once before publishing a sample;
it cannot stop at the first failing segment. `calculateSegmentDurationMs()`
keeps its segment-local guard for direct callers. Stationary joints and an
all-zero sequence do not require an unused velocity limit.

`samplePoseSegment()` applies linear progress or `p*p*(3-2*p)` and interpolates
the exact saved displacement by joint ID. `samplePoseSequence()` walks derived
durations, handles zero-duration segments without division, and returns the last
Pose after total duration.

- [ ] **Step 5: Retire duration-owned fixed-six math behind compatibility conversion**

Keep `RobotKeyframe` readable only for migration. Add:

```ts
export function legacyKeyframesToPoseSequence(
  keyframes: readonly RobotKeyframe[],
  context: PoseSequenceRobotContext,
  nowMs: number,
): PoseSequenceV1
```

Map the NED2 ordered IDs J1–J6 to existing degree values converted to radians.
Use `speedPercentToNext=100`; do not infer speed from `durationMs`. Preserve IDs,
names, order, and easing.

- [ ] **Step 6: Run tests and commit**

Run: `npm run test:run -- src/domain/robot/pose-sequence.test.ts src/features/joints/keyframes.test.ts`

Expected: PASS for linear, smoothstep, revolute, continuous, prismatic, zero-
distance, invalid schema/envelope/easing/speed, bounded-position rejection,
unwrapped continuous positions, missing velocity, revision mismatch, and legacy
migration cases.

```powershell
git add src/domain/robot/pose-sequence.ts src/domain/robot/pose-sequence.test.ts src/features/joints/keyframes.ts src/features/joints/keyframes.test.ts
git diff --cached --check
git commit -m "feat: calculate velocity-safe pose segments"
```

## Task 2: Persist Ordered Pose Sequences and Bridge Legacy NED2 Poses

**Files:**
- Create: `src/features/sequences/pose-sequence-store.ts`
- Create: `src/features/sequences/pose-sequence-store.test.ts`
- Modify: `src/state/scene-db.ts`
- Test: `src/state/scene-db.test.ts`
- Modify: `src/features/joints/robot-store.ts`
- Test: `src/features/joints/robot-store.test.ts`
- Modify: `src/app/App.tsx`
- Test: `src/app/AppShell.test.tsx`
- Modify: `src/features/robots/robot-instance-lifecycle.ts`
- Modify: `src/features/robots/robot-instance-lifecycle.test.ts`

**Interfaces:**
- Consumes: `PoseSequenceV1`, active effective definition, `sceneDb`, and the
  OPC plan's `RobotSimulationMutationGate`.
- Produces: one StrictMode-safe sequence store with per-instance active selection, atomic add/update/reorder/delete, and an idempotent same-runtime legacy bridge.

- [ ] **Step 1: Write persistence and ordering RED tests**

```ts
it('moves a Pose with its outgoing speed and commits one ordered record', async () => {
  const put = vi.spyOn(db.poseSequences, 'put')
  await store.getState().hydrate()
  await store.getState().moveStep('sequence-1', 'pose-a', 2)
  const steps = store.getState().sequences[0]!.steps
  expect(steps.map(({ id }) => id)).toEqual(['pose-b', 'pose-c', 'pose-a'])
  expect(steps[2]!.speedPercentToNext).toBe(40)
  expect(put).toHaveBeenCalledOnce()
})

it('restores valid rows and isolates a corrupt sequence', async () => {
  await db.poseSequences.bulkPut([validSequence, corruptSequence as never])
  await Promise.all([store.getState().hydrate(), store.getState().hydrate()])
  expect(store.getState().sequences).toEqual([validSequence])
  expect(store.getState().warnings).toContain(POSE_SEQUENCE_CORRUPT_ROW_WARNING)
})

it('persists per-instance selection, sequence rename, and Pose easing', async () => {
  await store.getState().renameSequence('sequence-1', 'Cell cycle')
  await store.getState().selectSequence('robot-1', 'sequence-1')
  await store.getState().setEasing('sequence-1', 'pose-a', 'easeInOut')
  await reopenStore()
  expect(store.getState().activeSequenceIdByRobotInstanceId['robot-1']).toBe('sequence-1')
  expect(store.getState().sequences[0]).toMatchObject({
    name: 'Cell cycle', steps: [expect.objectContaining({ id: 'pose-a', easing: 'easeInOut' })],
  })
})

it('isolates a sequence whose instance/configuration identity no longer matches', async () => {
  await db.poseSequences.put(sequenceFor('robot-1', 'config-a', 'rev-a'))
  definitions.setActiveConfiguration('robot-1', 'config-b', 'rev-b')
  await store.getState().hydrate()
  expect(store.getState().sequences).toHaveLength(0)
  expect(store.getState().staleSequences).toEqual([
    expect.objectContaining({ sequence: expect.objectContaining({ id: 'sequence-1' }), reason: 'configuration-revision' }),
  ])
  expect(store.getState().warnings).toContain(POSE_SEQUENCE_REVISION_MISMATCH_WARNING)
  await store.getState().rebaseSequenceToActiveConfiguration('sequence-1')
  expect(store.getState().staleSequences).toHaveLength(0)
  expect(store.getState().sequences[0]).toMatchObject({
    id: 'sequence-1', mechanicalConfigurationId: 'config-b', mechanicalConfigurationRevision: 'rev-b',
  })
})

it('deletes instance-owned sequences and selection in the robot deletion transaction', async () => {
  await db.poseSequences.bulkPut([
    sequenceFor('robot-a', 'config-a', '1'),
    sequenceFor('robot-b', 'config-b', '1'),
  ])
  await db.poseSequenceSelections.bulkPut([
    { robotInstanceId: 'robot-a', sequenceId: 'sequence-robot-a' },
    { robotInstanceId: 'robot-b', sequenceId: 'sequence-robot-b' },
  ])
  await robotLifecycle.deleteRobotInstance('robot-a')
  expect(await db.poseSequences.where('robotInstanceId').equals('robot-a').count()).toBe(0)
  expect(await db.poseSequenceSelections.get('robot-a')).toBeUndefined()
  expect(await db.poseSequences.where('robotInstanceId').equals('robot-b').count()).toBe(1)
})

it('invalidates a queued Pose edit before deleting the instance and all Pose rows', async () => {
  mutationGate.deferBeforeCommit('robot-a')
  const edit = store.getState().renamePose('sequence-robot-a', 'pose-a', 'Late edit')
  await mutationGate.waitUntilCommitBoundary('robot-a')
  const deletion = robotLifecycle.deleteRobotInstance('robot-a')
  mutationGate.releaseCommitBoundary('robot-a')
  await expect(edit).rejects.toThrow(/ownership changed|deletion pending/i)
  await deletion
  expect(await db.robotInstances.get('robot-a')).toBeUndefined()
  expect(await db.poseSequences.where('robotInstanceId').equals('robot-a').count()).toBe(0)
  expect(await db.poseSequenceSelections.get('robot-a')).toBeUndefined()
})

it('waits for an edit already inside the gate, then deletes its committed result', async () => {
  mutationGate.deferInsideCommit('robot-a')
  const edit = store.getState().capturePose('sequence-robot-a', 'Last pre-delete Pose')
  await mutationGate.waitUntilInsideCommit('robot-a')
  const deletion = robotLifecycle.deleteRobotInstance('robot-a')
  expect(await db.robotInstances.get('robot-a')).toBeDefined()
  mutationGate.releaseInsideCommit('robot-a')
  await edit
  await deletion
  expect(await db.robotInstances.get('robot-a')).toBeUndefined()
  expect(await db.poseSequences.where('robotInstanceId').equals('robot-a').count()).toBe(0)
  expect(await db.poseSequenceSelections.get('robot-a')).toBeUndefined()
})

it('migrates the retiring in-memory fixed-six snapshot once across two reopen cycles', async () => {
  const legacySource = legacyPoseSnapshotSource(legacyKeyframes)
  await createPoseSequenceStore(db, definitions, legacySource).getState().hydrate()
  db.close()
  const reopened = reopenDatabase(db.name)
  await createPoseSequenceStore(reopened, definitions, legacySource).getState().hydrate()
  expect(await reopened.poseSequences.toArray()).toHaveLength(1)
  expect(await reopened.migrationMarkers.get('legacy-pose-memory-v1:NED2-01')).toMatchObject({
    sourceKind: 'robot-store-memory-v1', sourceCount: legacyKeyframes.length,
  })
  expect(legacySource.read).toHaveBeenCalledOnce()
})

it('does not fabricate a legacy row from the v1/v2 scene selection record', async () => {
  await db.scene.put({
    key: 'scene', selectedEquipmentId: 'cup-01', activeTcpByRobotOwnerId: {},
  })
  await createPoseSequenceStore(db, definitions, legacyPoseSnapshotSource([])).getState().hydrate()
  expect(await db.poseSequences.count()).toBe(0)
})

it.each([
  ['OPC UA owns the instance', { sourceMode: 'opcua', playbackPhase: 'stopped' }],
  ['playback is running', { sourceMode: 'simulation', playbackPhase: 'playing' }],
  ['a playback snapshot is paused', { sourceMode: 'simulation', playbackPhase: 'paused' }],
] as const)('rejects direct store mutation when %s', async (_caseName, ownership) => {
  setRobotMutationState('robot-a', ownership)
  const dbBefore = await db.poseSequences.get('sequence-1')
  const memoryBefore = store.getState().sequences
  await expect(store.getState().renamePose('sequence-1', 'pose-a', 'Unsafe edit'))
    .rejects.toThrow(/Simulation.*stopped/i)
  expect(await db.poseSequences.get('sequence-1')).toEqual(dbBefore)
  expect(store.getState().sequences).toBe(memoryBefore)
})

it('aborts an in-flight mutation when an OPC UA switch invalidates its lease', async () => {
  mutationGate.deferBeforeCommit('robot-a')
  const dbBefore = await db.poseSequences.get('sequence-1')
  const memoryBefore = store.getState().sequences
  const pending = store.getState().moveStep('sequence-1', 'pose-a', 1)
  await mutationGate.waitUntilCommitBoundary('robot-a')
  requestOpcUaOwnership('robot-a')
  mutationGate.releaseCommitBoundary('robot-a')
  await expect(pending).rejects.toThrow(/ownership changed/i)
  expect(await db.poseSequences.get('sequence-1')).toEqual(dbBefore)
  expect(store.getState().sequences).toBe(memoryBefore)
})

it('deletes only a confirmed missing-instance recovery row without a robot gate', async () => {
  await db.poseSequences.put(sequenceForMissingInstance('deleted-robot'))
  await db.poseSequenceSelections.put({
    robotInstanceId: 'deleted-robot', sequenceId: 'orphan-sequence',
  })
  await store.getState().hydrate()
  await store.getState().deleteMissingInstanceSequence('orphan-sequence', 'orphan-sequence')
  expect(await db.poseSequences.get('orphan-sequence')).toBeUndefined()
  expect(await db.poseSequenceSelections.get('deleted-robot')).toBeUndefined()
  await expect(store.getState().deleteMissingInstanceSequence(
    configurationMismatchSequence.id,
    configurationMismatchSequence.id,
  )).rejects.toThrow(/missing-instance only/i)
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/sequences/pose-sequence-store.test.ts src/state/scene-db.test.ts src/features/robots/robot-instance-lifecycle.test.ts`

Expected: FAIL because the table and store do not exist.

- [ ] **Step 3: Add exact Dexie tables and an idempotent in-memory bridge**

Add `poseSequences: '&id, robotInstanceId, [robotDefinitionId+robotDefinitionRevision], [mechanicalConfigurationId+mechanicalConfigurationRevision], name, updatedAtMs'`,
`poseSequenceSelections: '&robotInstanceId, sequenceId'`, and
`migrationMarkers: '&id, sourceKind, robotInstanceId'` to the next DB version
after the OPC plan (expected schema v5). The schema upgrade only
creates tables; it does not read `scene`, because the actual v1/v2
`SceneDatabaseRecord` contains only `key`, `selectedEquipmentId`, and the Frame
plan's later active-TCP adapter.

Use these exact bridge contracts in `pose-sequence-store.ts`:

```ts
export const LEGACY_POSE_MIGRATION_ID = 'legacy-pose-memory-v1:NED2-01'
export const LEGACY_POSE_SEQUENCE_ID = 'legacy-NED2-sequence-v1'

export interface MigrationMarkerRecord {
  readonly id: string
  readonly sourceKind: 'robot-store-memory-v1'
  readonly robotInstanceId: 'NED2-01'
  readonly sourceCount: number
  readonly completedAtMs: number
}

export interface PoseSequenceSelectionRecord {
  readonly robotInstanceId: string
  readonly sequenceId: string
}

export interface LegacyPoseSnapshotSource {
  read(): readonly RobotKeyframe[]
  clearAfterCommit(): void
}
```

The App constructs this adapter from the retiring
`useRobotStore.getState().keyframes` before routing Save Pose to the new store.
On first hydration, after definitions and the NED2 instance are ready, run one
Dexie transaction over `poseSequences` and `migrationMarkers`: if the marker is
absent, read exactly one immutable snapshot; validate and convert a non-empty
snapshot to the deterministic sequence ID; then write the marker with the exact
source count. Clear old memory only after commit. An empty snapshot writes a
zero-count marker and no sequence. A conversion/write failure writes no marker,
does not clear memory, and exposes retry. Reopen sees the marker and never reads
or duplicates the legacy snapshot. Treat this as a same-runtime compatibility
bridge, not durable cold-upgrade recovery: no earlier release persisted
keyframes, so a fresh page load has nothing to reconstruct and must not invent
Pose records. Record that source-truth limitation in Luna migration docs.

- [ ] **Step 4: Implement store ownership**

```ts
export interface PoseSequenceStoreState {
  readonly sequences: readonly PoseSequenceV1[]
  readonly staleSequences: readonly {
    readonly sequence: PoseSequenceV1
    readonly reason: 'missing-instance' | 'definition-revision' | 'configuration-revision' | 'joint-limit'
  }[]
  readonly activeSequenceIdByRobotInstanceId: Readonly<Record<string, string>>
  readonly status: 'idle' | 'loading' | 'persistent' | 'memory-only'
  readonly warnings: readonly string[]
  hydrate(): Promise<void>
  createSequence(robotInstanceId: string, name: string): Promise<string>
  renameSequence(sequenceId: string, name: string): Promise<void>
  selectSequence(robotInstanceId: string, sequenceId: string): Promise<void>
  capturePose(sequenceId: string, name: string): Promise<string>
  renamePose(sequenceId: string, poseId: string, name: string): Promise<void>
  setOutgoingSpeed(sequenceId: string, poseId: string, percent: number): Promise<void>
  setEasing(sequenceId: string, poseId: string, easing: PoseEasing): Promise<void>
  rebaseSequenceToActiveConfiguration(sequenceId: string): Promise<void>
  moveStep(sequenceId: string, poseId: string, toIndex: number): Promise<void>
  deletePose(sequenceId: string, poseId: string): Promise<void>
  deleteSequence(sequenceId: string): Promise<void>
  deleteMissingInstanceSequence(sequenceId: string, confirmationId: string): Promise<void>
}
```

Hydration resolves the exact owning RobotInstance and matching
`EffectiveRobotDefinition`/configuration revision before accepting each row and
keeps missing-instance, revision-mismatch, or out-of-limit rows out of active
`sequences` while retaining their validated envelope and reason in read-only
`staleSequences` recovery state. It
restores only selection rows whose sequence and RobotInstance agree. All
mutation methods await single-flight hydration, resolve the owning instance,
acquire a `RobotSimulationMutationLease`, clone records, and validate the
complete sequence (including limits). The gate's `runIfCurrent()` serializes
the final commit against source switching and playback start, then rechecks the
same instance is still in Simulation Mode, playback has no active playing or
paused snapshot (`sessionActive=false` after Stop), and the lease
generation is current immediately before invoking the one Dexie transaction.
Source-switch and Play requests invalidate the generation synchronously before
they queue their own transition. A stale or denied lease rejects without
publishing the candidate to DB or memory; a storage transaction failure keeps
the documented memory-only recovery behavior. UI locks are never the authority.
Creating a sequence selects it for that
RobotInstance; selecting rejects cross-instance/revision sequences; deleting an
active sequence deletes its selection row in the same transaction and leaves
that instance with no active sequence until explicitly selected. `capturePose()`
validates the current named joint snapshot before persistence; rename, speed,
easing, and reorder actions revalidate the entire record. On persistence failure
retain memory state, enter memory-only mode, and show the existing export/retry
warning. IDs use `crypto.randomUUID()` injected in tests.

`rebaseSequenceToActiveConfiguration()` is an explicit operator action. It
can load an ID from `staleSequences`, requires the owning instance to exist,
validates every unchanged commanded value against that instance's current
effective definition and only then updates definition/configuration identity in
one put, moves it to active `sequences`, and clears its stale warning; failure
leaves the DB row and recovery entry untouched. Extend the Generic Robot
`deleteRobotInstance()` transaction at schema v5 to delete every
`poseSequences` row with that `robotInstanceId` plus its single selection row
before the instance row commits. This is not a post-commit cleanup hook, so a
rollback cannot leave orphan or partially deleted Pose data.
The lifecycle invokes that transaction only through the OPC plan's
`withDeletionBarrier()`: deletion synchronously invalidates queued Pose leases,
waits for an edit already inside the mutex, and then deletes any row that edit
committed. The pending deletion token rejects every new Pose mutation until
rollback resume or final gate-slot removal.

Apply the gate to every public persisted operator mutation in
`PoseSequenceStoreState`, including create, rename, select, capture, speed,
easing, rebase, reorder, and delete. Hydration migration and the robot
lifecycle's transactional cascade deletion are separate system operations with
their own idempotency/deletion locks; they do not bypass the gate for operator
edits.
The sole no-gate recovery exception is
`deleteMissingInstanceSequence(sequenceId, confirmationId)`: it requires an
exact ID confirmation, re-reads a validated `staleSequences` entry whose reason
is exactly `missing-instance`, verifies the RobotInstance is still absent inside
the Dexie transaction, and deletes only that sequence plus its orphan selection
row before updating memory. Configuration/definition/joint-limit stale rows and
all live-instance deletes must use the normal instance gate. Export remains
available before recovery deletion.

- [ ] **Step 5: Route Save Pose and Reset correctly**

Replace the legacy robot-store `savePose()` implementation with a call to the
active sequence store. Home changes only current joints. Reset stops transient
playback and interaction state but never deletes persisted Poses. Clear/Delete
remain explicit sequence actions.

- [ ] **Step 6: Run tests and commit**

Run: `npm run test:run -- src/features/sequences/pose-sequence-store.test.ts src/state/scene-db.test.ts src/features/joints/robot-store.test.ts src/features/robots/robot-instance-lifecycle.test.ts`

Expected: PASS, including concurrent hydration, corrupt/out-of-limit isolation,
per-instance/config revision ownership, transactional instance-deletion cleanup,
selection, rename/easing/rebase persistence, exact memory-source bridge and
marker, empty cold-upgrade source, write failure, reopen, mutation cloning,
direct-store OPC/playing/paused denial, in-flight source-switch invalidation,
confirmed missing-instance recovery deletion, and Reset preservation.

```powershell
git add src/features/sequences src/state/scene-db.ts src/state/scene-db.test.ts src/features/joints/robot-store.ts src/features/joints/robot-store.test.ts src/features/robots/robot-instance-lifecycle.ts src/features/robots/robot-instance-lifecycle.test.ts src/app/App.tsx src/app/AppShell.test.tsx
git diff --cached --check
git commit -m "feat: persist ordered robot pose sequences"
```

## Task 3: Refactor Timeline Playback to Derived Segment Timing

**Files:**
- Modify: `src/features/ui/Timeline.tsx`
- Modify: `src/features/ui/Timeline.test.tsx`
- Modify: `src/features/joints/robot-playback-control.ts`
- Modify: `src/features/joints/robot-playback-control.test.ts`
- Modify: `src/features/joints/robot-simulation-mutation-gate.ts`
- Modify: `src/features/joints/robot-simulation-mutation-gate.test.ts`
- Modify: `src/features/frames/frame-store.ts`
- Modify: `src/features/frames/frame-store.test.ts`
- Modify: `src/features/frames/FrameInspector.tsx`
- Modify: `src/features/frames/FrameInspector.test.tsx`
- Modify: `src/state/event-store.ts`
- Create: `src/state/event-store.test.ts`
- Create: `src/features/interaction/collision-playback-adapter.ts`
- Create: `src/features/interaction/collision-playback-adapter.test.ts`
- Modify: `src/features/interaction/CollisionSystem.tsx`
- Create: `src/features/interaction/CollisionSystem.test.tsx`

**Interfaces:**
- Consumes: selected `PoseSequenceV1`, effective definition/configuration
  revision, active TCP, source owner, Simulation source, and the preceding
  plan's per-instance `RobotPlaybackController` plus
  `RobotSimulationMutationGate`, together with the Frame plan's
  `getCommittedFrameRecord()`/`subscribeCommittedFrames()` APIs and injected
  `FramePreviewCleanupService`, plus Generic plan's
  `subscribeCommittedConfigurationChanges()` API.
- Produces: velocity-aware snapshot playback, pause/resume/stop, and a canonical collision-enter to owning-RobotInstance pause adapter.

- [ ] **Step 1: Write playback snapshot and pause RED tests**

```tsx
it('snapshots order, speeds, definition/config revision, and TCP at Play', async () => {
  renderTimeline(sequence({ speeds: [40, 80] }))
  await user.click(screen.getByRole('button', { name: 'Play' }))
  mutateLiveSequence({ order: ['pose-c', 'pose-a', 'pose-b'], speeds: [10, 10] })
  advanceAnimationFrame(1_000)
  expect(readPublishedJoints()).toEqual(sampleOriginalSnapshotAt(1_000))
})

it('pauses at the current elapsed position for collision and resumes from it', async () => {
  startPlayback()
  advanceAnimationFrame(500)
  enterCollision('robot-link:J2', 'equipment:cup-01')
  expect(readTimelinePosition()).toBe(500)
  await user.click(screen.getByRole('button', { name: 'Resume' }))
  expect(screen.getByRole('alert')).toHaveTextContent(/collision.*still active/i)
  expect(readTimelinePosition()).toBe(500)
  exitCollision('robot-link:J2', 'equipment:cup-01')
  expect(readPlayback().playing).toBe(false) // exit never auto-resumes
  await user.click(screen.getByRole('button', { name: 'Resume' }))
  advanceAnimationFrame(100)
  expect(readTimelinePosition()).toBe(600)
})

it('locks edits while paused, resumes the original snapshot, then uses edits after Stop', async () => {
  startPlayback(sequence({ order: ['pose-a', 'pose-b', 'pose-c'] }))
  advanceAnimationFrame(500)
  playback.pausePlayback('robot-1', 'collision')
  await expect(sequenceStore.getState().moveStep('sequence-1', 'pose-c', 0))
    .rejects.toThrow(/active playback session/i)
  expect(screen.getByRole('button', { name: 'Move Pose C up' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Resume' }))
  advanceAnimationFrame(100)
  expect(readPublishedJoints()).toEqual(sampleOriginalSnapshotAt(600))
  await user.click(screen.getByRole('button', { name: 'Stop' }))
  await sequenceStore.getState().moveStep('sequence-1', 'pose-c', 0)
  await user.click(screen.getByRole('button', { name: 'Play' }))
  expect(readPlaybackSnapshot('robot-1').sequence.steps.map(({ id }) => id))
    .toEqual(['pose-c', 'pose-a', 'pose-b'])
})

it('refuses Play when a bounded Pose became invalid under the active configuration', async () => {
  renderTimeline(sequenceWithPoseValue('J1', 2.1), definitionWithLimits('J1', -1, 1))
  await user.click(screen.getByRole('button', { name: 'Play' }))
  expect(screen.getByRole('alert')).toHaveTextContent(/J1.*limit/i)
  expect(readPublishedJoints()).toHaveLength(0)
})

it('rejects fresh Play while Simulation is disconnected, then allows it after initial readiness', async () => {
  await coordinatorFor('robot-1').disconnect()
  const samplesBefore = readPublishedJoints('robot-1').length
  await user.click(screen.getByRole('button', { name: 'Play' }))
  expect(screen.getByRole('alert')).toHaveTextContent(/Simulation.*not ready/i)
  expect(readPlayback('robot-1')).toMatchObject({ sessionActive: false, elapsedMs: 0 })
  expect(readPublishedJoints('robot-1')).toHaveLength(samplesBefore)
  await coordinatorFor('robot-1').switchSource(simulationSourceFor('robot-1'))
  expect(coordinatorFor('robot-1').snapshot()).toMatchObject({
    mode: 'simulation', ready: true, status: 'GOOD',
  })
  await user.click(screen.getByRole('button', { name: 'Play' }))
  expect(readPlayback('robot-1')).toMatchObject({ sessionActive: true, playing: true })
})

it('keeps elapsed time on quality Pause but resets it on source-switch Stop', () => {
  startPlayback('robot-1')
  advanceAnimationFrame(500)
  playback.pausePlayback('robot-1', 'source-quality')
  expect(readTimelinePosition('robot-1')).toBe(500)
  playback.stopPlayback('robot-1')
  expect(readTimelinePosition('robot-1')).toBe(0)
})

it('pauses when the active TCP keeps its ID but its committed local pose changes', () => {
  startPlayback('robot-1')
  advanceAnimationFrame(500)
  commitTcpEdit('robot:robot-1:tcp:gripper', { position: [0, 0, 0.2] })
  expect(readTimelinePosition('robot-1')).toBe(500)
  expect(readPauseReason('robot-1')).toBe('revision-change')
  expect(readPublishedJointsAfter(500)).toHaveLength(0)
})

it('does not pause for a TCP rename that preserves its transform revision', async () => {
  startPlayback('robot-1')
  await frameStore.getState().renameFrame('robot:robot-1:tcp:gripper', 'Welder TCP')
  expect(readPlayback('robot-1').playing).toBe(true)
})

it('invalidates a paused snapshot when its committed TCP revision changes', async () => {
  startPlayback('robot-1')
  playback.pausePlayback('robot-1', 'collision')
  commitTcpEdit('robot:robot-1:tcp:gripper', { position: [0, 0, 0.2] })
  expect(readPlayback('robot-1')).toMatchObject({
    sessionActive: true, playing: false, invalidated: true, pauseReason: 'revision-change',
  })
  expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled()
  expect(screen.getByText(/Stop.*Play again/i)).toBeVisible()
})

it('pauses only the robot whose committed mechanical revision changes', () => {
  startPlayback('robot-1')
  startPlayback('robot-2')
  const samplesBefore = readPublishedJoints('robot-1').length
  emitCommittedConfigurationChange({
    robotInstanceId: 'robot-1', previousRevision: 'config-1', revision: 'config-2',
  })
  expect(readPlayback('robot-1')).toMatchObject({ playing: false, pauseReason: 'revision-change' })
  expect(readPlayback('robot-2').playing).toBe(true)
  advanceAnimationFrame(100)
  expect(readPublishedJoints('robot-1')).toHaveLength(samplesBefore)
})

it('maps a canonical robot-link collision enter to only that RobotInstance pause slot', () => {
  collisionPlayback.onEnter(canonicalPair('robot-link:robot-1:J2', 'equipment:cup-01'))
  expect(playback.pausePlayback).toHaveBeenCalledOnceWith('robot-1', 'collision')
  expect(playback.pausePlayback).not.toHaveBeenCalledWith('robot-2', expect.anything())
})

it('routes an accepted CollisionSystem enter through the production adapter once', () => {
  renderCollisionSystemWithPair('robot-link:robot-1:J2', 'equipment:cup-01')
  emitRapierEnter()
  emitDuplicateRapierEnter()
  expect(playback.pausePlayback).toHaveBeenCalledOnceWith('robot-1', 'collision')
})

it('Play invalidates a Pose mutation that is waiting for the commit lock', async () => {
  mutationGate.deferBeforeCommit('robot-1')
  const edit = sequenceStore.getState().renamePose('sequence-1', 'pose-a', 'Queued edit')
  await mutationGate.waitUntilCommitBoundary('robot-1')
  const play = clickPlay()
  mutationGate.releaseCommitBoundary('robot-1')
  await expect(edit).rejects.toThrow(/ownership changed/i)
  await play
  expect(readPlayback('robot-1').playing).toBe(true)
  expect(readSequence('sequence-1').steps[0]!.name).not.toBe('Queued edit')
})

it('Play waits behind an edit already inside the commit lock and snapshots its result', async () => {
  mutationGate.deferInsideCommit('robot-1')
  const edit = sequenceStore.getState().setOutgoingSpeed('sequence-1', 'pose-a', 40)
  await mutationGate.waitUntilInsideCommit('robot-1')
  const play = clickPlay()
  expect(readPlayback('robot-1').playing).toBe(false)
  mutationGate.releaseInsideCommit('robot-1')
  await edit
  await play
  expect(readPlaybackSnapshot('robot-1').sequence.steps[0]!.speedPercentToNext).toBe(40)
})

it('starts a fresh run at zero after natural completion and later sequence edits', async () => {
  startPlayback(shortSequence())
  advanceAnimationFrame(totalDurationMs(shortSequence()))
  expect(readPlayback('robot-1')).toMatchObject({ sessionActive: false, playing: false })
  await sequenceStore.getState().capturePose('sequence-1', 'Longer final Pose')
  await user.click(screen.getByRole('button', { name: 'Play' }))
  expect(readPlayback('robot-1').elapsedMs).toBe(0)
  expect(readPublishedJoints('robot-1').at(-1)).toEqual(firstPoseJoints())
})

it('closes a pre-Play Inspector draft and invalidates the run on a new coordinate preview', async () => {
  const tcpId = 'robot:robot-1:tcp:gripper'
  const committed = frameStore.getState().getCommittedFrameRecord(tcpId)!
  render(<FrameInspector frameId={tcpId} />)
  await user.clear(screen.getByLabelText('Z (mm)'))
  await user.type(screen.getByLabelText('Z (mm)'), '400')
  expect(readRuntimeFrame(tcpId).localPose).not.toEqual(committed.localPose)
  await user.click(screen.getByRole('button', { name: 'Play' }))
  expect(frameStore.getState().previews).not.toHaveProperty(tcpId)
  expect(readRuntimeFrame(tcpId).localPose).toEqual(committed.localPose)
  expect(readPlaybackSnapshot('robot-1').tcpFrame?.revision).toBe(committed.revision)
  expect(screen.getByLabelText('Z (mm)'))
    .toHaveValue(committed.localPose.position[2] * 1_000)
  expect(screen.getByRole('button', { name: 'Apply frame' })).toBeDisabled()
  frameStore.getState().previewFrame(
    tcpId, poseAt(0, 0, 0.5), 'frame-inspector:during-play',
  )
  expect(readPlayback('robot-1')).toMatchObject({
    sessionActive: true, playing: false, invalidated: true, pauseReason: 'revision-change',
  })
  expect(readRuntimeFrame(tcpId).localPose).toEqual(poseAt(0, 0, 0.5))
  expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled()
})

it('keeps robot coordinate preview available in OPC when no Pose session exists', async () => {
  await coordinatorFor('robot-1').switchSource(opcUaSourceFor('robot-1'))
  const tcpId = 'robot:robot-1:tcp:gripper'
  expect(() => frameStore.getState().previewFrame(
    tcpId, poseAt(0, 0, 0.4), 'frame-inspector:opc-coordinate-edit',
  )).not.toThrow()
  expect(readRuntimeFrame(tcpId).localPose).toEqual(poseAt(0, 0, 0.4))
  frameStore.getState().cancelFrame(tcpId, 'frame-inspector:opc-coordinate-edit')
})

it('invalidates only the owning playback session after a committed Base coordinate edit', async () => {
  startPlayback('robot-1')
  startPlayback('robot-2')
  const baseId = 'robot:robot-1:base'
  const base = frameStore.getState().getCommittedFrameRecord(baseId)!
  await frameStore.getState().commitFrameEdit(baseId, {
    parentId: base.parentId!,
    localPose: poseAt(0.1, 0, 0),
    expectedRevision: base.revision,
  })
  expect(readPlayback('robot-1')).toMatchObject({
    playing: false, invalidated: true, pauseReason: 'revision-change',
  })
  expect(readPlayback('robot-2').playing).toBe(true)
})

it('invalidates every active robot below a shared MCP but not a separate MCP', async () => {
  attachRobotBase('robot-1', 'mcp:shared')
  attachRobotBase('robot-2', 'mcp:shared')
  attachRobotBase('robot-3', 'mcp:separate')
  startPlayback('robot-1')
  startPlayback('robot-2')
  startPlayback('robot-3')
  frameStore.getState().previewFrame(
    'mcp:shared', poseAt(0.1, 0, 0), 'frame-inspector:shared-mcp',
  )
  expect(readPlayback('robot-1')).toMatchObject({ invalidated: true, pauseReason: 'revision-change' })
  expect(readPlayback('robot-2')).toMatchObject({ invalidated: true, pauseReason: 'revision-change' })
  expect(readPlayback('robot-3').playing).toBe(true)
})

```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/ui/Timeline.test.tsx src/features/sequences/pose-sequence-store.test.ts src/features/joints/robot-simulation-mutation-gate.test.ts src/features/frames/frame-store.test.ts src/features/frames/FrameInspector.test.tsx src/state/event-store.test.ts src/features/interaction/collision-playback-adapter.test.ts src/features/interaction/CollisionSystem.test.tsx`

Expected: FAIL because Timeline still samples fixed durations and fixed-six arrays.

- [ ] **Step 3: Implement immutable playback snapshots**

```ts
import type {
  RobotPlaybackController,
  RobotPlaybackPauseReason,
} from '../joints/robot-playback-control'

interface PlaybackSnapshot {
  readonly sequence: PoseSequenceV1
  readonly definition: EffectiveRobotDefinition
  readonly configurationRevision: string
  readonly baseAncestorChain: readonly {
    readonly id: string
    readonly parentId: string | null
    readonly localPose: Pose3D
    readonly revision: number
  }[]
  readonly tcpFrame: {
    readonly id: string
    readonly parentId: string
    readonly localPose: Pose3D
    readonly revision: number
  } | null
  readonly segmentDurationsMs: readonly number[]
  readonly totalDurationMs: number
  readonly jointSourceGeneration: number
}
```

On a fresh Play command (`sessionActive=false`), synchronously call
`mutationGate.requestTransition(robotInstanceId, 'playback-start')` before any
await, then use `runTransition()` to recheck Simulation ownership, no active
session, and that the same instance coordinator snapshot is
`{mode:'simulation', ready:true, status:'GOOD'|'UNCERTAIN'}` at its current
source generation while resolving, validating, and installing the immutable snapshot and
atomically setting that instance's elapsed time to zero and playback slot to
`sessionActive=true, playing=true, invalidated=false`. Call `completeTransition()`
from the outer Play operation's `finally`. If a Pose mutation is waiting for the
gate, Play's request invalidates it; if that mutation already owns the lock,
Play waits and snapshots its committed result. A source transition pending at
any point rejects Play without publishing a sample or changing elapsed state.
Disconnected/not-ready Simulation rejects with an actionable alert, no snapshot,
no elapsed change, and no sample. Store the accepted source generation in the
snapshot; Resume requires the same still-ready Simulation generation.

Pause keeps `sessionActive=true`, the exact `PlaybackSnapshot`, and elapsed
position. The control is labeled Resume, not Play. Resume uses a
`playback-start` transition to recheck Simulation ownership and that the same
session is paused and valid, but it never reads the mutable sequence store or
installs a new snapshot. Sequence mutations remain locked while either playing
or paused. Stop is the only operator action that clears the snapshot, sets
`sessionActive=false`, resets elapsed, and allows edits; the next fresh Play
then snapshots those edits from elapsed zero. Natural completion clears the
active snapshot and unlocks editing after publishing the final Pose; it may
retain terminal elapsed for display, but every later fresh Play resets it to
zero atomically. A revision-change event while
already paused marks the retained snapshot `invalidated`, changes the pause
reason to `revision-change`, disables Resume, and requires Stop followed by a
fresh Play.

At Play, resolve the current effective definition and revalidate the entire
snapshot, including every bounded commanded position, before calculating any
segment. Reject Play with a specific list of out-of-limit joints or joints
missing positive velocity limits; never clamp an endpoint. Publish samples by
named joint ID through `SimulationJointSource.setPositions()`. If the live
definition/configuration revision changes, pause/invalidates the session and
requires Stop plus a fresh Play rather than applying incompatible data.
Subscribe to Generic Robot's typed per-instance committed-configuration event;
do not poll React render state. Resolve the active persisted
TCP through `getCommittedFrameRecord()` and copy its ID, parent, normalized
local pose, and committed transform revision. Subscribe through
`subscribeCommittedFrames()` plus the active-TCP selection adapter; changing
active TCP, reparenting it, or editing the same TCP ID to a new local
pose/revision pauses with `revision-change`. A rename-only commit preserves the
Frame plan's transform revision and does not pause. Compare local manual TCP
state, not its FK-changing world pose, so ordinary joint motion does not
self-pause.

Register a synchronous playback-start transition cleanup for Frame Store that
resolves the prospective persisted Base-to-World ancestor chain and active TCP,
cancels previews on any of those frames plus robot-owned tool descendants, and
republishes committed runtime frames before fresh Play proceeds. A
cleanup cancellation uses the Frame plan's owner-scoped invalidation event and
preview epoch, so the matching FrameInspector/FrameAxisGizmos React-local draft
is closed, fields return to committed values, Apply is disabled, and a stale
session command is rejected even if retained by a closure. A
`previewFrame()` whose frame is the Base or a persisted ancestor of any robot
with a playing/paused session first pauses/invalidates every affected session
with `revision-change`, then applies the preview; a robot-owned active TCP
preview follows the same rule. The operator may finish/cancel the coordinate
edit, but Resume is disabled until Stop plus fresh Play. Coordinate preview remains
available during OPC ownership when no Pose session exists because coordinate
editing is a separate policy from joint-source ownership. Unrelated
equipment/object/camera navigation remains unaffected. Fresh Play snapshots only
after cleanup, so the rendered tool/collision chain and committed TCP record
cannot disagree. A direct external committed frame edit is still caught by the
post-commit revision subscription and invalidates the session.
Frame Inspector commits remain permitted during OPC ownership. During an active
Pose session, the first relevant preview has already paused/invalidated every
affected snapshot, after which Frame Inspector may Apply or Cancel the
coordinate draft; Resume stays disabled until Stop plus fresh Play. A direct or
external `commitFrameEdit()` without preview remains conflict-checked, and its
post-commit Base/TCP/ancestor revision event performs the same invalidation
before any later animation sample. This preserves coordinate-edit scope without
creating a joint-source ownership bypass.

Snapshot every persisted frame from the RobotInstance Base through its parent
chain to immutable World as ordered ID/parent/local-pose/revision records.
Committed-frame events invalidate every active session whose saved chain
contains that frame ID, so one shared MCP pauses all descendant robots while a
separate MCP does not. This chain comparison uses committed local state rather
than changing world matrices, avoiding self-invalidation from ordinary joints.

- [ ] **Step 4: Preserve existing time-control guarantees**

Keep generation tokens, hidden-document pause, external `setPlaying(false)`,
no state publication after Pause/Stop, and Stop resetting elapsed time. Zero-
duration segments advance in the same animation tick with a bounded loop of at
most `steps.length` so identical Poses cannot hang.
Extend the preceding plan's controller-backed per-instance playback slot with
velocity-aware sampling; keep its API and ownership unchanged for the OPC
coordinator and collision system. Pause retains snapshot/elapsed position and
records its reason; Stop invalidates the generation, clears the session, and
resets elapsed to zero. Source switching and
instance deletion use Stop, while BAD/STALE use `source-quality` Pause.
Consume the controller exported by the preceding OPC plan; do not redeclare it.
`collision-playback-adapter.ts` parses only canonical Generic-plan
`robot-link:<robotInstanceId>:<linkId>` entities on collision enter, deduplicates
the pair using Task 9 semantics, and calls `pausePlayback(instanceId,
'collision')` once for each involved robot. It also owns a canonical active-pair
set and derived active-collision count per RobotInstance. Duplicate enter/exit
events cannot skew the count. Resume requires count zero; if a pair remains,
retain the snapshot/elapsed and report the blocking entities. Collision exit
removes the pair but never auto-resumes;
non-robot equipment/equipment pairs do not affect playback. CollisionSystem
publishes the adapter only after its canonical pair enter/exit is accepted.

- [ ] **Step 5: Surface pause reason in event history**

Append one event for collision, BAD/STALE quality, revision change, or missing
velocity. Duplicate collision enters remain deduplicated by Task 9. Resume does
not delete history.

- [ ] **Step 6: Test and commit**

Run: `npm run test:run -- src/features/ui/Timeline.test.tsx src/features/sequences/pose-sequence-store.test.ts src/features/joints/robot-simulation-mutation-gate.test.ts src/features/frames/frame-store.test.ts src/features/frames/FrameInspector.test.tsx src/state/event-store.test.ts src/domain/robot/pose-sequence.test.ts src/features/interaction/collision-playback-adapter.test.ts src/features/interaction/CollisionSystem.test.tsx`

Expected: PASS for speed timing, snapshot isolation, collision/quality pause,
resume, stop, hidden document, zero segments, and dynamic joint counts.

```powershell
git add src/features/ui/Timeline.tsx src/features/ui/Timeline.test.tsx src/features/joints/robot-playback-control.ts src/features/joints/robot-playback-control.test.ts src/features/joints/robot-simulation-mutation-gate.ts src/features/joints/robot-simulation-mutation-gate.test.ts src/features/frames/frame-store.ts src/features/frames/frame-store.test.ts src/features/frames/FrameInspector.tsx src/features/frames/FrameInspector.test.tsx src/state/event-store.ts src/state/event-store.test.ts src/features/interaction/collision-playback-adapter.ts src/features/interaction/collision-playback-adapter.test.ts src/features/interaction/CollisionSystem.tsx src/features/interaction/CollisionSystem.test.tsx
git diff --cached --check
git commit -m "feat: play velocity-aware pose sequences"
```

## Task 4: Build the Accessible Pose Sequence Editor

**Files:**
- Create: `src/features/sequences/PoseStepRow.tsx`
- Create: `src/features/sequences/PoseSequenceEditor.tsx`
- Create: `src/features/sequences/PoseSequenceEditor.test.tsx`
- Modify: `src/features/joints/JointInspector.tsx`
- Modify: `src/features/joints/JointInspector.test.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: sequence store, active definition, source mode, playback status.
- Produces: Pose create/rename/delete, speed edit, drag reorder, keyboard reorder, computed-duration display.

- [ ] **Step 1: Write editor RED tests**

```tsx
it('reorders by keyboard and keeps focus on the moved Pose', async () => {
  renderEditor(sequenceWithThreePoses())
  await user.click(screen.getByRole('button', { name: 'Move Pose 2 up' }))
  expect(readPoseOrder()).toEqual(['Pose 2', 'Pose 1', 'Pose 3'])
  expect(screen.getByRole('button', { name: 'Move Pose 2 up' })).toHaveFocus()
})

it('validates speed drafts and persists one integer on blur or Enter', async () => {
  renderEditor(sequenceWithThreePoses())
  const input = screen.getByLabelText('Pose 1 speed to next')
  await user.clear(input)
  await user.type(input, '40{Enter}')
  expect(saveSpeed).toHaveBeenCalledOnceWith('sequence-1', 'pose-1', 40)
  expect(screen.getByText(/calculated duration/i)).toHaveTextContent('2.35 s')
})

it('renames/selects sequences and persists the Pose easing control', async () => {
  renderEditor(twoSequences(), 'simulation')
  await user.selectOptions(screen.getByLabelText('Active sequence'), 'sequence-2')
  await user.click(screen.getByRole('button', { name: 'Rename sequence' }))
  await completeRenameDialog(user, 'Cell cycle')
  await user.selectOptions(screen.getByLabelText('Pose 1 easing'), 'easeInOut')
  expect(selectSequence).toHaveBeenCalledWith('robot-1', 'sequence-2')
  expect(renameSequence).toHaveBeenCalledWith('sequence-2', 'Cell cycle')
  expect(setEasing).toHaveBeenCalledWith('sequence-2', 'pose-1', 'easeInOut')
})

it.each(['playing', 'paused', 'opcua'])('locks every mutation while %s', (state) => {
  renderEditor(sequenceWithThreePoses(), state)
  expect(screen.getByLabelText('Pose 1 speed to next')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Delete Pose 1' })).toBeDisabled()
})

it('blocks Capture Current when a bounded joint is outside the effective limits', async () => {
  renderEditor(sequenceWithThreePoses(), 'simulation', { current: { J1: 2.1 }, limits: { J1: [-1, 1] } })
  await user.click(screen.getByRole('button', { name: 'Save current Pose' }))
  expect(screen.getByRole('alert')).toHaveTextContent(/J1.*limit/i)
  expect(capturePose).not.toHaveBeenCalled()
})

it('requires explicit validated rebase after the instance configuration changes', async () => {
  renderEditor(sequenceForConfiguration('config-a', '1'), 'simulation', activeConfiguration('config-b', '2'))
  expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Revalidate for current configuration' }))
  expect(rebaseSequenceToActiveConfiguration).toHaveBeenCalledWith('sequence-1')
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/sequences/PoseSequenceEditor.test.tsx src/features/joints/JointInspector.test.tsx`

Expected: FAIL because the editor does not exist.

- [ ] **Step 3: Implement row behavior**

Each row renders a drag handle, Pose name, outgoing speed, calculated duration,
easing, Move Up, Move Down, Capture Current, and Delete. The last row displays
`End` instead of a duration but retains its stored outgoing speed. Numeric draft
state does not mutate persistence until valid blur or Enter; Escape restores the
committed value.

Use native `draggable`, `onDragStart`, `onDragOver`, and `onDrop`. Store only the
dragged Pose ID in React state; never serialize a DOM object. Drop calls the same
`moveStep()` action as keyboard buttons. Add `aria-grabbed`, an instruction
description, and a live announcement such as “Pose 2 moved to position 1 of 3.”

- [ ] **Step 4: Implement sequence-level actions and confirmation**

The per-RobotInstance Active sequence selector calls `selectSequence()` and is
the single owner consumed by Timeline. Create/rename/delete sequence, Save
Current Pose, and Delete Pose use validated dialogs with focus return. Deletion
is explicit and never triggered by Reset.
Capture validates the current named values against effective limits before the
store action. While a playback snapshot is playing or paused, lock every
sequence mutation and show Resume/Stop from Timeline; only Stop unlocks
editing. When fewer than two Poses exist, Play is disabled with “Add at
least two Poses.” When velocity limits are missing or a Pose is out of range,
list the exact joint names and link to the Mechanical Inspector.
When the owning instance's definition/configuration revision differs, disable
Play/edit and show `Revalidate for current configuration`; this calls the one
explicit rebase action and never silently rewrites Pose values.
Render `staleSequences` in a read-only Recovery group so a mismatch discovered
after reload still exposes its ID/name/reason and rebase action; missing-instance
rows offer Export and a separately confirmed recovery delete that requires
typing the exact sequence ID and calls `deleteMissingInstanceSequence()`; other
stale reasons never use this no-gate path.

- [ ] **Step 5: Integrate responsive layout**

Desktop renders the editor in the Sequence Inspector/bottom rail without
shrinking the 3D viewport below its approved minimum. Narrow screens use the
existing mutually exclusive drawer. Avoid duplicate Play or gripper controls.
Use CSS dimension tokens from the industrial HMI plan.

- [ ] **Step 6: Test and commit**

Run: `npm run test:run -- src/features/sequences src/features/joints/JointInspector.test.tsx src/app/AppShell.test.tsx`

Expected: PASS for mouse drop, keyboard move, focus, live announcements, speed
drafts, calculated duration, source/playback locks, dialogs, and narrow layout.

```powershell
git add src/features/sequences/PoseStepRow.tsx src/features/sequences/PoseSequenceEditor.tsx src/features/sequences/PoseSequenceEditor.test.tsx src/features/joints/JointInspector.tsx src/features/joints/JointInspector.test.tsx src/app/AppShell.tsx src/styles/global.css
git diff --cached --check
git commit -m "feat: edit and reorder robot pose sequences"
```

## Task 5: Add End-to-End Acceptance and Luna Documentation

**Files:**
- Create: `e2e/pose-sequence.spec.ts`
- Modify: `src/test/debug-bridge.ts`
- Modify: `src/test/debug-bridge.test.ts`
- Create: `docs/operator/pose-sequences.md`
- Create: `docs/developer/pose-sequence-format.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: built app, read-only E2E debug snapshot, NED2 and one prismatic fixture definition.
- Produces: deterministic Simulation Mode acceptance and format/operator documentation.

- [ ] **Step 1: Write failing browser acceptance**

```ts
test('reorders and plays persisted percentage-speed Poses', async ({ page }) => {
  await resetBrowserStorageBeforeAppLoad(page)
  await page.goto('/')
  await selectSourceMode(page, 'SIMULATION')
  await savePose(page, 'Pose A', [0, 0, 0, 0, 0, 0])
  await savePose(page, 'Pose B', [20, 10, 0, 0, 0, 0])
  await savePose(page, 'Pose C', [40, 0, 5, 0, 0, 0])
  await page.getByRole('button', { name: 'Move Pose C up' }).click()
  await page.getByLabel('Pose A speed to next').fill('40')
  await page.getByLabel('Pose A speed to next').press('Enter')
  await expect.poll(() => readSequenceSnapshot(page)).toMatchObject({ speeds: [40, 100, 100] })
  const durationAt40 = (await readSequenceSnapshot(page)).derivedDurationsMs[0]!
  await page.getByLabel('Pose A speed to next').fill('80')
  await page.getByLabel('Pose A speed to next').press('Enter')
  await expect.poll(() => readSequenceSnapshot(page).then(({ derivedDurationsMs }) => derivedDurationsMs[0]))
    .toBeCloseTo(durationAt40 / 2, 6)
  await page.getByLabel('Pose A speed to next').fill('40')
  await page.getByLabel('Pose A speed to next').press('Enter')
  await page.getByLabel('Pose C speed to next').fill('80')
  await page.getByLabel('Pose C speed to next').press('Enter')
  await expect.poll(() => readSequenceSnapshot(page)).toMatchObject({ speeds: [40, 80, 100] })
  const beforeReload = await readSequenceSnapshot(page)
  expect(beforeReload).toMatchObject({
    order: ['Pose A', 'Pose C', 'Pose B'],
    speeds: [40, 80, 100],
  })
  expect(beforeReload.derivedDurationsMs).toHaveLength(2)
  expect(beforeReload.derivedDurationsMs.every((value) => value > 0)).toBe(true)
  await page.reload()
  await expect.poll(() => readSequenceSnapshot(page)).toEqual(beforeReload)
  await page.getByRole('button', { name: 'Play' }).click()
  await expect.poll(() => readSequenceSnapshot(page).then(({ playback }) => playback.elapsedMs))
    .toBeGreaterThan(0)
})

test('keeps keyboard focus on the moved Pose', async ({ page }) => {
  await resetBrowserStorageBeforeAppLoad(page)
  await page.goto('/')
  await createThreePoseSequence(page)
  const move = page.getByRole('button', { name: 'Move Pose C up' })
  await move.focus()
  await page.keyboard.press('Enter')
  await expect(move).toBeFocused()
  await expect.poll(() => readSequenceSnapshot(page)).toMatchObject({
    order: ['Pose A', 'Pose C', 'Pose B'],
  })
})

test('blocks Resume while collision remains active and resumes only after exit', async ({ page }) => {
  await resetBrowserStorageBeforeAppLoad(page)
  await page.goto('/')
  await createThreePoseSequence(page)
  await page.getByRole('button', { name: 'Play' }).click()
  await expect.poll(() => readPlaybackSnapshot(page).then(({ elapsedMs }) => elapsedMs))
    .toBeGreaterThan(0)
  await moveEquipmentFrameThroughUi(page, 'Cup 01', deterministicRobotLinkCollisionPose)
  const paused = await readPlaybackSnapshot(page)
  expect(paused).toMatchObject({ playing: false, pauseReason: 'collision', activeCollisionCount: 1 })
  await page.getByRole('button', { name: 'Resume' }).click()
  await expect(page.getByRole('alert')).toContainText('collision is still active')
  expect((await readPlaybackSnapshot(page)).elapsedMs).toBe(paused.elapsedMs)
  await moveEquipmentFrameThroughUi(page, 'Cup 01', clearOfRobotPose)
  await expect.poll(() => readPlaybackSnapshot(page).then(({ activeCollisionCount }) => activeCollisionCount))
    .toBe(0)
  expect((await readPlaybackSnapshot(page)).playing).toBe(false)
  await page.getByRole('button', { name: 'Resume' }).click()
  await expect.poll(() => readPlaybackSnapshot(page).then(({ elapsedMs }) => elapsedMs))
    .toBeGreaterThan(paused.elapsedMs)
})

test('locks Pose mutation and Play while OPC UA owns the robot', async ({ page }) => {
  await resetBrowserStorageBeforeAppLoad(page)
  await page.goto('/')
  await createThreePoseSequence(page)
  await assignMockOpcUaProfileAndSwitch(page, 'ned2-profile')
  await expect(page.getByRole('status')).toContainText('GOOD')
  await expect(page.getByRole('button', { name: 'Save current Pose' })).toBeDisabled()
  await expect(page.getByLabel('Pose A speed to next')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Move Pose C up' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Play' })).toBeDisabled()
})
```

Extend the Task 11/Frame-plan E2E-only snapshot with plain-JSON selected
sequence ID, ordered Pose names/IDs, outgoing speeds, derived durations,
playback elapsed/paused reason/session state, active collision count/pairs, and
owning RobotInstance ID. Add guard and
serialization tests; expose no mutation method or Zustand reference.

- [ ] **Step 2: Run RED, wire fixtures, then run GREEN**

Run: `npm run test:e2e -- e2e/pose-sequence.spec.ts`

Expected before editor wiring: FAIL at reorder/speed controls. Expected after
wiring: PASS for order, 40/80% derived durations, collision pause/resume,
OPC UA lock, reload persistence, and keyboard ordering.

- [ ] **Step 3: Write Luna documentation**

The operator guide documents creating Poses, outgoing-speed meaning, derived
time, easing, reorder, Play/Pause/Stop, collision and quality pauses, Simulation
ownership, reload, and deletion. The developer reference documents schema v1,
units, duration formula, smoothstep factor, continuous joints, migration,
validation, and revision snapshots. Its migration section explicitly records
that the baseline never persisted legacy keyframes: only a non-empty retiring
same-runtime snapshot can be converted, while a cold upgrade correctly creates
no synthetic Poses.

- [ ] **Step 4: Run final gates**

This is the final cross-plan integration gate. Run each gate separately and
stop on the first nonzero exit:

1. `npm run lint`
2. `npm run test:run`
3. `npm run gateway:test`
4. `npm run gateway:build`
5. `npm run fixtures:robot:verify`
6. `npm run cad:validate`
7. `npm run build`
8. `npm run test:e2e`
9. `npm audit --omit=dev --audit-level=high`
10. `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify/scan-credentials.ps1`
11. `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify/scan-opcua-readonly.ps1`
12. `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify/scan-opcua-readonly.test.ps1`
13. Run this PowerShell 5.1-safe inverted placeholder scan:

```powershell
$placeholderHits = & rg -n -i "T[B]D|T[O]DO|F[I]XME" docs/operator/pose-sequences.md docs/developer/pose-sequence-format.md
if ($LASTEXITCODE -eq 0) { $placeholderHits; throw 'Documentation placeholders remain' }
if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
```

14. `git diff --check`

Expected: all PASS, including every configured Playwright spec for the original
robot workflow, Frame Graph, generic import/mechanics, OPC UA, and Pose
Sequence; deterministic robot fixtures match; CAD reports 7 assets, 0 errors,
0 warnings; audit has no high/critical production vulnerability; both security
scans and their self-test pass; placeholder scan prints nothing; no console
errors beyond the exact existing upstream allowlist.

- [ ] **Step 5: Commit**

```powershell
git add e2e/pose-sequence.spec.ts src/test/debug-bridge.ts src/test/debug-bridge.test.ts docs/operator/pose-sequences.md docs/developer/pose-sequence-format.md README.md
git diff --cached --check
git commit -m "test: verify persisted pose sequence playback"
```

## Completion Gate

A fresh reviewer must confirm that every segment respects effective velocity
limits, ease-in-out peak speed is bounded, Pose order and speeds persist, edits
are locked while a playback snapshot is active (playing or paused) or under
OPC UA ownership, continuous/prismatic joints
use correct units, collision and quality pauses retain elapsed position, and
Reset never deletes persisted sequences.
