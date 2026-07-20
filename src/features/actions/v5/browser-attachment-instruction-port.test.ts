import { describe, expect, it, vi } from 'vitest'

import {
  composeRigidTransformV5,
  rpyDegreesToQuaternionV5,
  type RigidTransformV5,
  type RobotJobInstructionV1,
  type SpatialEntityV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import {
  isAttachmentInstructionErrorV1,
} from '../../../core/action-runtime-v5/attachment-instruction-error.js'
import {
  prepareAttachTransitionV1,
  type AttachmentRuntimeRecordV1,
  type DetachedPoseOverrideV1,
} from '../../../core/action-runtime-v5/attachment-transition.js'
import { createAttachmentRuntimeStoreV1 } from './attachment-runtime-store.js'
import type { AttachmentRuntimeStoreV1 } from './attachment-runtime-store.js'
import { createBrowserAttachmentInstructionPortV1 } from './browser-attachment-instruction-port.js'
import type { StoreApi } from 'zustand/vanilla'

const CONFIG_REVISION = 'a'.repeat(64)
const NEXT_CONFIG_REVISION = 'b'.repeat(64)
type AttachInstruction = Extract<RobotJobInstructionV1, { readonly kind: 'attach' }>
type DetachInstruction = Extract<RobotJobInstructionV1, { readonly kind: 'detach' }>

function pose(
  positionM: readonly [number, number, number] = [0, 0, 0],
  rpy: readonly [number, number, number] = [0, 0, 0],
): RigidTransformV5 {
  return { positionM, quaternion: rpyDegreesToQuaternionV5(rpy) }
}

function entity(overrides: Partial<SpatialEntityV5> = {}): SpatialEntityV5 {
  return {
    id: 'cup',
    name: 'Cup',
    geometry: { kind: 'box', dimensionsM: [0.08, 0.08, 0.12], color: '#4488cc' },
    parentFrameId: 'mcp',
    localPose: pose([0.4, 0.1, 0.2]),
    visible: true,
    groupId: null,
    removable: true,
    transformOwner: 'simulation',
    numericStatus: {
      value: 0,
      sourceOwnership: 'simulation',
      overlay: { visible: false, frameId: null },
    },
    graspable: true,
    graspFrames: [{ frameId: 'cup-grasp', name: 'Cup grasp', localPose: pose([0, 0, 0.05]) }],
    movingFrames: [],
    ...overrides,
  }
}

function projectWithEntity(object: SpatialEntityV5 = entity()): WorkcellProjectV5 {
  const project = makeMinimalWorkcellProjectV5()
  return { ...project, spatialEntities: [object] }
}

function attach(overrides: Partial<AttachInstruction> = {}): AttachInstruction {
  return {
    id: 'attach-1',
    kind: 'attach',
    objectId: 'cup',
    toolFrameId: 'Tool',
    objectGraspFrameId: 'cup-grasp',
    maximumDistanceM: 0.05,
    ...overrides,
  }
}

function detach(overrides: Partial<DetachInstruction> = {}): DetachInstruction {
  return {
    id: 'detach-1',
    kind: 'detach',
    objectId: 'cup',
    targetParentFrameId: null,
    ...overrides,
  }
}

function record(overrides: Partial<AttachmentRuntimeRecordV1> = {}): AttachmentRuntimeRecordV1 {
  const prepared = prepareAttachTransitionV1(attach({ objectGraspFrameId: null, maximumDistanceM: 1 }), {
    robotId: 'robot-1',
    objectTransformOwner: 'simulation',
    existingAttachment: null,
    objectWorldPose: pose([0.4, 0.1, 0.2]),
    toolWorldPose: pose([0.4, 0.1, 0.25]),
    objectGraspLocalPose: null,
    simulationMs: 1,
  }).record
  return Object.freeze({ ...prepared, ...overrides }) satisfies AttachmentRuntimeRecordV1
}

function overrideFor(attachment: AttachmentRuntimeRecordV1): DetachedPoseOverrideV1 {
  const objectWorld = composeRigidTransformV5(pose(), attachment.toolFromObject)
  return Object.freeze({
    objectId: attachment.objectId,
    parentFrameId: 'mcp',
    localPose: objectWorld,
    objectWorldPoseAtDetach: objectWorld,
    detachedAtSimulationMs: 2,
  })
}

function context(robotId = 'robot-1', simulationMs = 100) {
  return { robotId, jobId: 'job-1', runId: 'run-1', simulationMs }
}

function expectBranded(error: unknown, code: string): void {
  expect(isAttachmentInstructionErrorV1(error)).toBe(true)
  expect(error).toMatchObject({ name: 'AttachmentInstructionErrorV1', code })
}

function createFixture(project = projectWithEntity()) {
  const attachments = createAttachmentRuntimeStoreV1(project, CONFIG_REVISION)
  const objectWorld = pose([0.4, 0.1, 0.2], [10, 20, 30])
  const graspWorld = composeRigidTransformV5(objectWorld, project.spatialEntities[0]!.graspFrames[0]!.localPose)
  const readProject = vi.fn(() => project)
  const readConfigRevision = vi.fn(() => CONFIG_REVISION)
  const readRobotFrameWorldPose = vi.fn<(robotId: string, frameId: string) => RigidTransformV5 | null>(
    (_robotId, _frameId) => graspWorld,
  )
  const readSceneFrameWorldPose = vi.fn<(frameId: string) => RigidTransformV5 | null>(
    (_frameId) => pose(),
  )
  const readObjectWorldPose = vi.fn<(objectId: string) => RigidTransformV5 | null>(
    (_objectId) => objectWorld,
  )
  const port = createBrowserAttachmentInstructionPortV1({
    readProject,
    readConfigRevision,
    attachments,
    readRobotFrameWorldPose,
    readSceneFrameWorldPose,
    readObjectWorldPose,
  })
  return {
    attachments,
    port,
    readProject,
    readConfigRevision,
    readRobotFrameWorldPose,
    readSceneFrameWorldPose,
    readObjectWorldPose,
    objectWorld,
    graspWorld,
  }
}

function portUsing(
  fixture: ReturnType<typeof createFixture>,
  attachments: StoreApi<AttachmentRuntimeStoreV1>,
) {
  return createBrowserAttachmentInstructionPortV1({
    readProject: fixture.readProject,
    readConfigRevision: fixture.readConfigRevision,
    attachments,
    readRobotFrameWorldPose: fixture.readRobotFrameWorldPose,
    readSceneFrameWorldPose: fixture.readSceneFrameWorldPose,
    readObjectWorldPose: fixture.readObjectWorldPose,
  })
}

function wrapActions(
  store: StoreApi<AttachmentRuntimeStoreV1>,
  wrap: (state: AttachmentRuntimeStoreV1) => Partial<Pick<
    AttachmentRuntimeStoreV1,
    'commitAttach' | 'commitDetach'
  >>,
): StoreApi<AttachmentRuntimeStoreV1> {
  return {
    ...store,
    getState: () => {
      const state = store.getState()
      return Object.freeze({ ...state, ...wrap(state) })
    },
  }
}

describe('V5 Browser Attachment instruction port', () => {
  it('resolves only exact persisted IDs and commits the named Object without reader search', async () => {
    const project = projectWithEntity(entity({ id: 'constructor' }))
    const fixture = createFixture(project)
    fixture.readObjectWorldPose.mockReturnValue(pose())
    fixture.readRobotFrameWorldPose.mockReturnValue(pose())

    await fixture.port.attach(attach({ objectId: 'constructor', objectGraspFrameId: 'cup-grasp' }), context())

    expect(fixture.attachments.getState().attachmentsByObjectId['constructor']?.objectId).toBe('constructor')
    expect(Object.hasOwn(fixture.attachments.getState().attachmentsByObjectId, 'toString')).toBe(false)
    expect(fixture.readObjectWorldPose).toHaveBeenCalledTimes(1)
    expect(fixture.readObjectWorldPose).toHaveBeenCalledWith('constructor')
    expect(fixture.readRobotFrameWorldPose).toHaveBeenCalledTimes(1)
    expect(fixture.readRobotFrameWorldPose).toHaveBeenCalledWith('robot-1', 'Tool')
  })

  it('keeps same-named Tool Frames scoped to the context Robot', async () => {
    const project = projectWithEntity()
    const secondRobot = {
      ...structuredClone(project.robots[0]!),
      id: 'robot-2',
      name: 'Robot 2',
      serialNumber: 'ROBOT-SAMPLE-002',
    }
    const withTwoRobots = { ...project, robots: [...project.robots, secondRobot] }
    const fixture = createFixture(withTwoRobots)

    await fixture.port.attach(attach(), context('robot-2'))

    expect(fixture.readRobotFrameWorldPose).toHaveBeenCalledWith('robot-2', 'Tool')
    expect(fixture.attachments.getState().attachmentsByObjectId.cup?.robotId).toBe('robot-2')
  })

  it.each([
    ['missing Object', attach({ objectId: 'missing' }), 'ATTACHMENT_TARGET_NOT_FOUND'],
    ['missing Tool', attach({ toolFrameId: 'missing' }), 'ATTACHMENT_TARGET_NOT_FOUND'],
    ['foreign Grasp', attach({ objectGraspFrameId: 'missing' }), 'ATTACHMENT_TARGET_NOT_FOUND'],
  ] as const)('brands %s before invoking pose readers', async (_name, instruction, code) => {
    const fixture = createFixture()
    let error: unknown
    try { await fixture.port.attach(instruction, context()) } catch (candidate) { error = candidate }
    expectBranded(error, code)
    expect(fixture.readObjectWorldPose).not.toHaveBeenCalled()
    expect(fixture.readRobotFrameWorldPose).not.toHaveBeenCalled()
  })

  it('brands unavailable live Frames and does not fall back or commit', async () => {
    const fixture = createFixture()
    fixture.readRobotFrameWorldPose.mockReturnValue(null)
    let error: unknown
    try { await fixture.port.attach(attach(), context()) } catch (candidate) { error = candidate }
    expectBranded(error, 'ATTACHMENT_FRAME_UNAVAILABLE')
    expect(fixture.readObjectWorldPose).toHaveBeenCalledTimes(1)
    expect(fixture.readRobotFrameWorldPose).toHaveBeenCalledTimes(1)
    expect(Object.keys(fixture.attachments.getState().attachmentsByObjectId)).toHaveLength(0)
  })

  it.each([
    ['opcua:endpoint-1', 'SOURCE_OWNERSHIP_CONFLICT'],
    ['attachment', 'SOURCE_OWNERSHIP_CONFLICT'],
  ] as const)('rejects an orphaned %s owner before pose reads', async (transformOwner, code) => {
    const fixture = createFixture(projectWithEntity(entity({ transformOwner })))
    let error: unknown
    try { await fixture.port.attach(attach(), context()) } catch (candidate) { error = candidate }
    expectBranded(error, code)
    expect(fixture.readObjectWorldPose).not.toHaveBeenCalled()
    expect(fixture.readRobotFrameWorldPose).not.toHaveBeenCalled()
  })

  it('gives an active runtime Attachment ALREADY_ATTACHED precedence over authored ownership', async () => {
    const fixture = createFixture(projectWithEntity(entity({ transformOwner: 'attachment' })))
    fixture.attachments.getState().commitAttach(record())
    let error: unknown
    try { await fixture.port.attach(attach(), context()) } catch (candidate) { error = candidate }
    expectBranded(error, 'ALREADY_ATTACHED')
  })

  it('detaches using the stored Robot and Tool and resolves a null target to the authored parent', async () => {
    const fixture = createFixture()
    await fixture.port.attach(attach(), context())
    fixture.readRobotFrameWorldPose.mockClear()
    fixture.readSceneFrameWorldPose.mockClear()
    const movedTool = pose([0.8, -0.2, 0.5], [20, 40, 60])
    fixture.readRobotFrameWorldPose.mockReturnValue(movedTool)
    fixture.readSceneFrameWorldPose.mockReturnValue(pose([0.1, 0.2, 0.3], [5, 10, 15]))

    await fixture.port.detach(detach(), context('robot-1', 200))

    expect(fixture.readRobotFrameWorldPose).toHaveBeenCalledWith('robot-1', 'Tool')
    expect(fixture.readSceneFrameWorldPose).toHaveBeenCalledWith('mcp')
    expect(Object.keys(fixture.attachments.getState().attachmentsByObjectId)).toHaveLength(0)
    expect(fixture.attachments.getState().detachedOverridesByObjectId.cup).toMatchObject({
      parentFrameId: 'mcp',
      detachedAtSimulationMs: 200,
    })
  })

  it('rejects Project/config replacement performed by an injected reader before commit', async () => {
    const fixture = createFixture()
    const nextProject = { ...projectWithEntity(), revisionId: 'revision-2' }
    fixture.readObjectWorldPose.mockImplementation(() => {
      fixture.attachments.getState().replaceProject(nextProject, NEXT_CONFIG_REVISION)
      return fixture.objectWorld
    })
    let error: unknown
    try { await fixture.port.attach(attach(), context()) } catch (candidate) { error = candidate }
    expectBranded(error, 'SOURCE_OWNERSHIP_CONFLICT')
    expect(fixture.readRobotFrameWorldPose).not.toHaveBeenCalled()
    expect(Object.keys(fixture.attachments.getState().attachmentsByObjectId)).toHaveLength(0)
  })

  it('uses CAS so a stale Detach cannot delete a replacement Attachment installed by a reader', async () => {
    const fixture = createFixture()
    const original = record()
    fixture.attachments.getState().commitAttach(original)
    const storedOriginal = fixture.attachments.getState().attachmentsByObjectId.cup!
    const replacement = record({ attachedAtSimulationMs: 999 })
    fixture.readRobotFrameWorldPose.mockImplementation(() => {
      fixture.attachments.getState().commitDetach(overrideFor(storedOriginal), storedOriginal)
      fixture.attachments.getState().commitAttach(replacement)
      return pose([0.5, 0.5, 0.5])
    })

    let error: unknown
    try { await fixture.port.detach(detach(), context()) } catch (candidate) { error = candidate }

    expectBranded(error, 'SOURCE_OWNERSHIP_CONFLICT')
    expect(fixture.attachments.getState().attachmentsByObjectId.cup).toEqual(replacement)
    expect(fixture.attachments.getState().attachmentsByObjectId.cup).not.toBe(replacement)
  })

  it('isolates a throwing subscriber so an already committed Attach still resolves', async () => {
    const fixture = createFixture()
    const later = vi.fn()
    fixture.attachments.subscribe(() => { throw new Error('listener failed') })
    fixture.attachments.subscribe(later)

    await expect(fixture.port.attach(attach(), context())).resolves.toBeUndefined()
    expect(fixture.attachments.getState().attachmentsByObjectId.cup).toBeDefined()
    expect(later).toHaveBeenCalledTimes(1)
  })

  it('treats a full canonical Attach commit as success even if a wrapper throws after publication', async () => {
    const fixture = createFixture()
    const wrapped = wrapActions(fixture.attachments, (state) => ({
      commitAttach: (prepared) => {
        state.commitAttach(prepared)
        throw new Error('after attach publication')
      },
    }))

    await expect(portUsing(fixture, wrapped).attach(attach(), context())).resolves.toBeUndefined()
    expect(fixture.attachments.getState().attachmentsByObjectId.cup).toBeDefined()
  })

  it('treats a full canonical Detach commit as success even if a wrapper throws after publication', async () => {
    const fixture = createFixture()
    await fixture.port.attach(attach(), context())
    const wrapped = wrapActions(fixture.attachments, (state) => ({
      commitDetach: (prepared, expected) => {
        state.commitDetach(prepared, expected)
        throw new Error('after detach publication')
      },
    }))

    await expect(portUsing(fixture, wrapped).detach(detach(), context())).resolves.toBeUndefined()
    expect(fixture.attachments.getState().detachedOverridesByObjectId.cup).toBeDefined()
  })

  it('rejects a different committed Attachment that only shares partial identity fields', async () => {
    const fixture = createFixture()
    const wrapped = wrapActions(fixture.attachments, (state) => ({
      commitAttach: (prepared) => state.commitAttach({
        ...prepared,
        objectGraspFrameId: null,
        toolFromObject: pose([0.2, 0, 0]),
      }),
    }))
    let error: unknown
    try { await portUsing(fixture, wrapped).attach(attach(), context()) } catch (candidate) { error = candidate }
    expectBranded(error, 'SOURCE_OWNERSHIP_CONFLICT')
  })

  it('uses the detached override World pose for reattach and never calls the stale base reader', async () => {
    const fixture = createFixture()
    fixture.readRobotFrameWorldPose.mockReturnValue(fixture.objectWorld)
    await fixture.port.attach(attach({ objectGraspFrameId: null, maximumDistanceM: 0.001 }), context())
    const movedTool = pose([0.8, -0.2, 0.5], [20, 40, 60])
    fixture.readRobotFrameWorldPose.mockReturnValue(movedTool)
    fixture.readSceneFrameWorldPose.mockReturnValue(pose())
    await fixture.port.detach(detach(), context('robot-1', 200))
    fixture.readObjectWorldPose.mockClear()
    fixture.readSceneFrameWorldPose.mockReturnValue(null)
    fixture.readRobotFrameWorldPose.mockReturnValue(
      fixture.attachments.getState().detachedOverridesByObjectId.cup!.objectWorldPoseAtDetach,
    )

    await expect(fixture.port.attach(
      attach({ objectGraspFrameId: null, maximumDistanceM: 0.001 }),
      context('robot-1', 300),
    )).resolves.toBeUndefined()
    expect(fixture.readObjectWorldPose).not.toHaveBeenCalled()
  })

  it('follows a moved detached parent when calculating the reattach World pose', async () => {
    const fixture = createFixture()
    fixture.readRobotFrameWorldPose.mockReturnValue(fixture.objectWorld)
    await fixture.port.attach(attach({ objectGraspFrameId: null, maximumDistanceM: 0.001 }), context())
    fixture.readRobotFrameWorldPose.mockReturnValue(pose([0.7, 0.1, 0.3]))
    fixture.readSceneFrameWorldPose.mockReturnValue(pose())
    await fixture.port.detach(detach(), context('robot-1', 200))
    const override = fixture.attachments.getState().detachedOverridesByObjectId.cup!
    const movedParent = pose([0.2, -0.1, 0.4], [0, 0, 30])
    const effectiveObjectWorld = composeRigidTransformV5(movedParent, override.localPose)
    fixture.readObjectWorldPose.mockClear()
    fixture.readSceneFrameWorldPose.mockReturnValue(movedParent)
    fixture.readRobotFrameWorldPose.mockReturnValue(effectiveObjectWorld)

    await expect(fixture.port.attach(
      attach({ objectGraspFrameId: null, maximumDistanceM: 0.001 }),
      context('robot-1', 300),
    )).resolves.toBeUndefined()
    expect(fixture.readObjectWorldPose).not.toHaveBeenCalled()
    expect(fixture.attachments.getState().attachmentsByObjectId.cup?.objectWorldPoseAtAttach)
      .toEqual(effectiveObjectWorld)
  })

  it('rejects same-revision Project/config replacement during readProject', async () => {
    const fixture = createFixture()
    const replacement = projectWithEntity(entity({ name: 'Replacement Cup' }))
    fixture.readProject.mockImplementation(() => {
      fixture.attachments.getState().replaceProject(replacement, NEXT_CONFIG_REVISION)
      return projectWithEntity()
    })
    fixture.readConfigRevision.mockReturnValue(NEXT_CONFIG_REVISION)
    let error: unknown
    try { await fixture.port.attach(attach(), context()) } catch (candidate) { error = candidate }
    expectBranded(error, 'SOURCE_OWNERSHIP_CONFLICT')
    expect(fixture.readObjectWorldPose).not.toHaveBeenCalled()
  })

  it('rejects detached override replacement reentry from the parent reader', async () => {
    const fixture = createFixture()
    fixture.readRobotFrameWorldPose.mockReturnValue(fixture.objectWorld)
    await fixture.port.attach(attach({ objectGraspFrameId: null, maximumDistanceM: 0.001 }), context())
    fixture.readSceneFrameWorldPose.mockReturnValue(pose())
    await fixture.port.detach(detach(), context('robot-1', 200))
    const oldOverride = fixture.attachments.getState().detachedOverridesByObjectId.cup!
    fixture.readSceneFrameWorldPose.mockImplementation(() => {
      fixture.attachments.getState().commitAttach(record({ attachedAtSimulationMs: 210 }))
      const replacementAttachment = fixture.attachments.getState().attachmentsByObjectId.cup!
      fixture.attachments.getState().commitDetach({
        ...oldOverride,
        localPose: pose([9, 9, 9]),
        objectWorldPoseAtDetach: pose([9, 9, 9]),
        detachedAtSimulationMs: 220,
      }, replacementAttachment)
      return pose()
    })
    fixture.readObjectWorldPose.mockClear()

    let error: unknown
    try {
      await fixture.port.attach(
        attach({ objectGraspFrameId: null, maximumDistanceM: 100 }),
        context('robot-1', 300),
      )
    } catch (candidate) { error = candidate }
    expectBranded(error, 'SOURCE_OWNERSHIP_CONFLICT')
    expect(fixture.readObjectWorldPose).not.toHaveBeenCalled()
    expect(fixture.attachments.getState().detachedOverridesByObjectId.cup).not.toBe(oldOverride)
  })

  it('rejects a Detach target whose ancestry reaches the same Object Grasp Frame', async () => {
    const cycleEntity = entity({
      movingFrames: [{
        frameId: 'cup-descendant',
        name: 'Cup descendant',
        parentFrameId: 'cup-grasp',
        localPose: pose(),
        sourceOwnership: 'simulation',
      }],
    })
    const fixture = createFixture(projectWithEntity(cycleEntity))
    fixture.attachments.getState().commitAttach(record())

    let error: unknown
    try {
      await fixture.port.detach(detach({ targetParentFrameId: 'cup-descendant' }), context())
    } catch (candidate) { error = candidate }

    expectBranded(error, 'ATTACHMENT_TARGET_NOT_FOUND')
    expect(fixture.readRobotFrameWorldPose).not.toHaveBeenCalled()
    expect(fixture.attachments.getState().attachmentsByObjectId.cup).toBeDefined()
  })

  it('rejects Attach when Robot Base ancestry reaches the same Object Grasp Frame', async () => {
    const cycleEntity = entity({
      movingFrames: [{
        frameId: 'cup-descendant',
        name: 'Cup descendant',
        parentFrameId: 'cup-grasp',
        localPose: pose(),
        sourceOwnership: 'simulation',
      }],
    })
    const project = projectWithEntity(cycleEntity)
    const cycleProject = {
      ...project,
      robots: project.robots.map((robot) => ({
        ...robot,
        baseParentFrameId: 'cup-descendant',
        intentionalMountEntityId: 'cup',
      })),
    }
    const fixture = createFixture(cycleProject)

    let error: unknown
    try { await fixture.port.attach(attach(), context()) } catch (candidate) { error = candidate }

    expectBranded(error, 'ATTACHMENT_TARGET_NOT_FOUND')
    expect(fixture.readObjectWorldPose).not.toHaveBeenCalled()
    expect(fixture.readRobotFrameWorldPose).not.toHaveBeenCalled()
  })
})
