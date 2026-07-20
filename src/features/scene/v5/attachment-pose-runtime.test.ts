import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  composeRigidTransformV5,
  rpyDegreesToQuaternionV5,
  type RigidTransformV5,
} from '../../../core/project-v5/index.js'
import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import {
  prepareAttachTransitionV1,
  prepareDetachTransitionV1,
  poseDiscontinuityV1,
  type AttachmentRuntimeRecordV1,
} from '../../../core/action-runtime-v5/attachment-transition.js'
import { createAttachmentRuntimeStoreV1 } from '../../actions/v5/attachment-runtime-store.js'
import { createAttachmentPoseRuntimeV1 } from './attachment-pose-runtime.js'

const CONFIG_REVISION = 'a'.repeat(64)

function pose(
  positionM: readonly [number, number, number] = [0, 0, 0],
  rpy: readonly [number, number, number] = [0, 0, 0],
): RigidTransformV5 {
  return { positionM, quaternion: rpyDegreesToQuaternionV5(rpy) }
}

function attachment(objectId = 'cup'): AttachmentRuntimeRecordV1 {
  return prepareAttachTransitionV1({
    id: 'attach-1',
    kind: 'attach',
    objectId,
    toolFrameId: 'Tool',
    objectGraspFrameId: null,
    maximumDistanceM: 1,
  }, {
    robotId: 'robot-1',
    objectTransformOwner: 'simulation',
    existingAttachment: null,
    objectWorldPose: pose([0.4, 0.1, 0.2], [5, 10, 15]),
    toolWorldPose: pose([0.4, 0.1, 0.25], [15, 20, 25]),
    objectGraspLocalPose: null,
    simulationMs: 10,
  }).record
}

function projectWithObject(objectId = 'cup') {
  const project = makeMinimalWorkcellProjectV5()
  return {
    ...project,
    spatialEntities: [{
      id: objectId,
      name: 'Cup',
      geometry: { kind: 'box' as const, dimensionsM: [0.1, 0.1, 0.1] as const, color: '#4488cc' as const },
      parentFrameId: 'mcp',
      localPose: pose(),
      visible: true,
      groupId: null,
      removable: true,
      transformOwner: 'simulation' as const,
      numericStatus: { value: 0, sourceOwnership: 'simulation' as const, overlay: { visible: false, frameId: null } },
      graspable: true,
      graspFrames: [],
      movingFrames: [],
    }],
  }
}

describe('V5 Attachment pose projection', () => {
  it('follows the live stored Robot Tool and returns a normalized deeply frozen pose', () => {
    const store = createAttachmentRuntimeStoreV1(projectWithObject(), CONFIG_REVISION)
    const active = attachment()
    store.getState().commitAttach(active)
    const runtime = createAttachmentPoseRuntimeV1(store)
    const currentTool = pose([0.8, -0.3, 0.6], [30, -20, 70])
    const robotReader = vi.fn(() => currentTool)
    const result = runtime.readObjectWorldPose('cup', robotReader, vi.fn(() => null))

    expect(robotReader).toHaveBeenCalledTimes(1)
    expect(robotReader).toHaveBeenCalledWith('robot-1', 'Tool')
    expect(result).toEqual(composeRigidTransformV5(currentTool, active.toolFromObject))
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result!.positionM)).toBe(true)
    expect(Object.isFrozen(result!.quaternion)).toBe(true)
  })

  it('holds objectWorldPoseAtAttach when the active Tool reader is unavailable', () => {
    const store = createAttachmentRuntimeStoreV1(projectWithObject(), CONFIG_REVISION)
    const active = attachment()
    store.getState().commitAttach(active)
    const result = createAttachmentPoseRuntimeV1(store)
      .readObjectWorldPose('cup', () => null, () => pose([9, 9, 9]))
    expect(result).toEqual(active.objectWorldPoseAtAttach)
  })

  it('follows a detached override parent and holds objectWorldPoseAtDetach if it is unavailable', () => {
    const store = createAttachmentRuntimeStoreV1(projectWithObject(), CONFIG_REVISION)
    const active = attachment()
    store.getState().commitAttach(active)
    const storedActive = store.getState().attachmentsByObjectId.cup!
    const parentAtDetach = pose([0.1, 0.2, 0.3], [10, 20, 30])
    const detached = prepareDetachTransitionV1({
      id: 'detach-1', kind: 'detach', objectId: 'cup', targetParentFrameId: 'mcp',
    }, {
      robotId: 'robot-1',
      attachment: storedActive,
      currentToolWorldPose: pose([0.7, 0.4, 0.8], [-20, 5, 90]),
      targetParentFrameId: 'mcp',
      targetParentWorldPose: parentAtDetach,
      simulationMs: 20,
    })
    store.getState().commitDetach(detached.override, storedActive)
    const runtime = createAttachmentPoseRuntimeV1(store)
    const movedParent = pose([0.4, -0.2, 0.6], [0, 30, 45])

    const liveProjection = runtime.readObjectWorldPose('cup', () => null, () => movedParent)!
    const expectedProjection = composeRigidTransformV5(movedParent, detached.override.localPose)
    const discontinuity = poseDiscontinuityV1(liveProjection, expectedProjection)
    expect(discontinuity.positionM).toBeLessThanOrEqual(1e-12)
    expect(discontinuity.orientationDeg).toBeLessThanOrEqual(0.00001)
    expect(runtime.readObjectWorldPose('cup', () => null, () => null))
      .toEqual(detached.override.objectWorldPoseAtDetach)
  })

  it('gives an active Attachment precedence over a detached override in adversarial state', () => {
    const store = createAttachmentRuntimeStoreV1(projectWithObject('__proto__'), CONFIG_REVISION)
    const active = attachment('__proto__')
    store.getState().commitAttach(active)
    const originalGetState = store.getState
    const detached = {
      objectId: '__proto__',
      parentFrameId: 'mcp',
      localPose: pose([5, 5, 5]),
      objectWorldPoseAtDetach: pose([6, 6, 6]),
      detachedAtSimulationMs: 30,
    }
    const adversarialStore = {
      ...store,
      getState: () => ({
        ...originalGetState(),
        detachedOverridesByObjectId: Object.freeze(Object.assign(Object.create(null), { __proto__: detached })),
      }),
    } as typeof store
    const tool = pose([1, 2, 3])
    const sceneReader = vi.fn(() => pose([9, 9, 9]))

    const result = createAttachmentPoseRuntimeV1(adversarialStore)
      .readObjectWorldPose('__proto__', () => tool, sceneReader)

    expect(result).toEqual(composeRigidTransformV5(tool, active.toolFromObject))
    expect(sceneReader).not.toHaveBeenCalled()
  })

  it('returns null only when neither runtime override exists', () => {
    const store = createAttachmentRuntimeStoreV1(projectWithObject(), CONFIG_REVISION)
    const robotReader = vi.fn(() => pose())
    const sceneReader = vi.fn(() => pose())
    expect(createAttachmentPoseRuntimeV1(store).readObjectWorldPose('cup', robotReader, sceneReader)).toBeNull()
    expect(robotReader).not.toHaveBeenCalled()
    expect(sceneReader).not.toHaveBeenCalled()
  })

  it('keeps the projection boundary free of V4 and rendering imports', () => {
    const source = readFileSync(resolve('src/features/scene/v5/attachment-pose-runtime.ts'), 'utf8')
    expect(source).not.toMatch(/project-v4|features\/.*\/v4|from ['"]three|@react-three/u)
  })
})
