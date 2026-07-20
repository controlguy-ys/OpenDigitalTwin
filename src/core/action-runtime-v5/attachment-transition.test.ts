import { describe, expect, it } from 'vitest'

import {
  composeRigidTransformV5,
  rpyDegreesToQuaternionV5,
  type RigidTransformV5,
} from '../project-v5/index.js'
import { isAttachmentInstructionErrorV1 } from './attachment-instruction-error.js'
import {
  poseDiscontinuityV1,
  prepareAttachTransitionV1,
  prepareDetachTransitionV1,
  type AttachmentRuntimeRecordV1,
} from './attachment-transition.js'

type AttachInstruction = Extract<import('../project-v5/index.js').RobotJobInstructionV1, { readonly kind: 'attach' }>
type DetachInstruction = Extract<import('../project-v5/index.js').RobotJobInstructionV1, { readonly kind: 'detach' }>

function pose(positionM: readonly [number, number, number] = [0, 0, 0], rpy: readonly [number, number, number] = [0, 0, 0]): RigidTransformV5 {
  return { positionM, quaternion: rpyDegreesToQuaternionV5(rpy) }
}
function attachInstruction(overrides: Partial<AttachInstruction> = {}): AttachInstruction {
  return { id: 'attach-1', kind: 'attach', objectId: 'cup', toolFrameId: 'Tool', objectGraspFrameId: 'cup-grasp', maximumDistanceM: 0.05, ...overrides }
}
function detachInstruction(overrides: Partial<DetachInstruction> = {}): DetachInstruction {
  return { id: 'detach-1', kind: 'detach', objectId: 'cup', targetParentFrameId: 'fixture', ...overrides }
}
function attachment(): AttachmentRuntimeRecordV1 {
  const objectWorld = pose([0.4, 0.1, 0.2], [10, 20, 30])
  const toolWorld = pose([0.4, 0.1, 0.25], [20, -10, 45])
  return prepareAttachTransitionV1(attachInstruction({ objectGraspFrameId: null, maximumDistanceM: 1 }), {
    robotId: 'robot-1', objectTransformOwner: 'simulation', existingAttachment: null,
    objectWorldPose: objectWorld, toolWorldPose: toolWorld, objectGraspLocalPose: null, simulationMs: 10,
  }).record satisfies AttachmentRuntimeRecordV1
}

describe('V5 Attachment transitions', () => {
  it('preserves a rotated Object World pose across Attach and Detach', () => {
    const objectWorld = pose([0.4, 0.1, 0.2], [25, -15, 80])
    const graspLocal = pose([0.02, -0.01, 0.03], [0, 30, 10])
    const graspWorld = composeRigidTransformV5(objectWorld, graspLocal)
    const attached = prepareAttachTransitionV1(attachInstruction(), {
      robotId: 'robot-1', objectTransformOwner: 'simulation', existingAttachment: null,
      objectWorldPose: objectWorld, toolWorldPose: graspWorld, objectGraspLocalPose: graspLocal, simulationMs: 100,
    })
    const reconstructed = composeRigidTransformV5(attached.record.toolWorldPoseAtAttach, attached.record.toolFromObject)
    expect(poseDiscontinuityV1(objectWorld, reconstructed)).toMatchObject({ positionM: expect.closeTo(0, 12), orientationDeg: expect.closeTo(0, 10) })

    const currentTool = pose([0.9, -0.2, 0.7], [-30, 5, 120])
    const parentWorld = pose([0.2, 0.3, 0.1], [15, 25, -40])
    const detached = prepareDetachTransitionV1(detachInstruction(), {
      robotId: 'robot-1', attachment: attached.record, currentToolWorldPose: currentTool,
      targetParentFrameId: 'fixture', targetParentWorldPose: parentWorld, simulationMs: 200,
    })
    const detachedDiscontinuity = poseDiscontinuityV1(
      composeRigidTransformV5(detached.targetParentWorldPose, detached.nextLocalPose),
      detached.objectWorldBefore,
    )
    expect(detachedDiscontinuity.positionM).toBeLessThanOrEqual(0.0005)
    expect(detachedDiscontinuity.orientationDeg).toBeLessThanOrEqual(0.1)
    expect(detached.override.objectWorldPoseAtDetach).toEqual(detached.objectWorldBefore)
  })

  it('uses the Object root as the Grasp fallback and accepts the exact range boundary', () => {
    const objectWorld = pose()
    const atBoundary = prepareAttachTransitionV1(attachInstruction({ objectGraspFrameId: null }), {
      robotId: 'robot-1', objectTransformOwner: 'manual', existingAttachment: null,
      objectWorldPose: objectWorld, toolWorldPose: pose([0.05, 0, 0]), objectGraspLocalPose: null, simulationMs: 0,
    })
    expect(atBoundary.objectGraspWorldPose).toEqual(objectWorld)
    expect(atBoundary.toolToGraspDistanceM).toBeCloseTo(0.05, 12)

    expect(() => prepareAttachTransitionV1(attachInstruction({ objectGraspFrameId: null }), {
      robotId: 'robot-1', objectTransformOwner: 'simulation', existingAttachment: null,
      objectWorldPose: objectWorld, toolWorldPose: pose([0.050001, 0, 0]), objectGraspLocalPose: null, simulationMs: 0,
    })).toThrowError(expect.objectContaining({ name: 'AttachmentInstructionErrorV1', code: 'OUT_OF_RANGE' }))
  })

  it('treats q and -q as the same orientation', () => {
    const positive = pose([1, 2, 3], [30, 40, 50])
    const negative: RigidTransformV5 = { positionM: positive.positionM, quaternion: positive.quaternion.map((value) => -value) as unknown as RigidTransformV5['quaternion'] }
    expect(poseDiscontinuityV1(positive, negative)).toEqual({ positionM: 0, orientationDeg: 0 })
  })

  it.each([
    ['opcua owner', () => prepareAttachTransitionV1(attachInstruction(), {
      robotId: 'robot-1', objectTransformOwner: 'opcua:endpoint-1' as const, existingAttachment: null,
      objectWorldPose: pose(), toolWorldPose: pose(), objectGraspLocalPose: pose(), simulationMs: 0,
    }), 'SOURCE_OWNERSHIP_CONFLICT'],
    ['already attached', () => prepareAttachTransitionV1(attachInstruction(), {
      robotId: 'robot-1', objectTransformOwner: 'simulation' as const, existingAttachment: attachment(),
      objectWorldPose: pose(), toolWorldPose: pose(), objectGraspLocalPose: pose(), simulationMs: 0,
    }), 'ALREADY_ATTACHED'],
    ['wrong Robot detach', () => prepareDetachTransitionV1(detachInstruction(), {
      robotId: 'robot-2', attachment: attachment(), currentToolWorldPose: pose(),
      targetParentFrameId: 'fixture', targetParentWorldPose: pose(), simulationMs: 0,
    }), 'SOURCE_OWNERSHIP_CONFLICT'],
    ['not attached', () => prepareDetachTransitionV1(detachInstruction(), {
      robotId: 'robot-1', attachment: null, currentToolWorldPose: pose(),
      targetParentFrameId: 'fixture', targetParentWorldPose: pose(), simulationMs: 0,
    }), 'NOT_ATTACHED'],
  ] as const)('brands the %s failure', (_name, operation, code) => {
    let error: unknown
    try { operation() } catch (candidate) { error = candidate }
    expect(isAttachmentInstructionErrorV1(error)).toBe(true)
    expect(error).toMatchObject({ code })
  })

  it('deep-freezes transition records, pose tuples, and results', () => {
    const result = prepareAttachTransitionV1(attachInstruction({ objectGraspFrameId: null, maximumDistanceM: 1 }), {
      robotId: 'robot-1', objectTransformOwner: 'simulation', existingAttachment: null,
      objectWorldPose: pose(), toolWorldPose: pose(), objectGraspLocalPose: null, simulationMs: 0,
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.record)).toBe(true)
    expect(Object.isFrozen(result.record.toolFromObject)).toBe(true)
    expect(Object.isFrozen(result.record.toolFromObject.positionM)).toBe(true)
    expect(Object.isFrozen(result.record.toolFromObject.quaternion)).toBe(true)
  })
})
