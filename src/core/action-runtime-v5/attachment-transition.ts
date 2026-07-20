import {
  composeRigidTransformV5,
  normalizeRigidTransformV5,
  relativeRigidTransformV5,
  type RigidTransformV5,
  type RobotJobInstructionV1,
  type SpatialEntityV5,
} from '../project-v5/index.js'
import { deepFreezeV5 } from '../project-v5/validation-support.js'
import { createAttachmentInstructionErrorV1 } from './attachment-instruction-error.js'

const MAXIMUM_POSITION_DISCONTINUITY_M = 0.0005
const MAXIMUM_ORIENTATION_DISCONTINUITY_DEG = 0.1
const RADIANS_TO_DEGREES = 180 / Math.PI

type AttachInstructionV1 = Extract<RobotJobInstructionV1, { readonly kind: 'attach' }>
type DetachInstructionV1 = Extract<RobotJobInstructionV1, { readonly kind: 'detach' }>

export interface AttachmentRuntimeRecordV1 {
  readonly objectId: string
  readonly robotId: string
  readonly toolFrameId: string
  readonly objectGraspFrameId: string | null
  readonly toolFromObject: RigidTransformV5
  readonly toolWorldPoseAtAttach: RigidTransformV5
  readonly objectWorldPoseAtAttach: RigidTransformV5
  readonly attachedAtSimulationMs: number
}

export interface DetachedPoseOverrideV1 {
  readonly objectId: string
  readonly parentFrameId: string
  readonly localPose: RigidTransformV5
  readonly objectWorldPoseAtDetach: RigidTransformV5
  readonly detachedAtSimulationMs: number
}

export interface PoseDiscontinuityV1 {
  readonly positionM: number
  readonly orientationDeg: number
}

export interface AttachTransitionContextV1 {
  readonly robotId: string
  readonly objectTransformOwner: SpatialEntityV5['transformOwner']
  readonly existingAttachment: AttachmentRuntimeRecordV1 | null
  readonly objectWorldPose: RigidTransformV5
  readonly toolWorldPose: RigidTransformV5
  readonly objectGraspLocalPose: RigidTransformV5 | null
  readonly simulationMs: number
}

export interface AttachTransitionV1 {
  readonly record: AttachmentRuntimeRecordV1
  readonly objectGraspWorldPose: RigidTransformV5
  readonly toolToGraspDistanceM: number
  readonly discontinuity: PoseDiscontinuityV1
}

export interface DetachTransitionContextV1 {
  readonly robotId: string
  readonly attachment: AttachmentRuntimeRecordV1 | null
  readonly currentToolWorldPose: RigidTransformV5
  readonly targetParentFrameId: string
  readonly targetParentWorldPose: RigidTransformV5
  readonly simulationMs: number
}

export interface DetachTransitionV1 {
  readonly override: DetachedPoseOverrideV1
  readonly expectedAttachment: AttachmentRuntimeRecordV1
  readonly objectWorldBefore: RigidTransformV5
  readonly targetParentWorldPose: RigidTransformV5
  readonly nextLocalPose: RigidTransformV5
  readonly discontinuity: PoseDiscontinuityV1
}

function frozenPose(value: RigidTransformV5, path: string): RigidTransformV5 {
  return deepFreezeV5(normalizeRigidTransformV5(value, path))
}

function requireSimulationMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError('Attachment simulation time must be finite and nonnegative.')
  }
  return value === 0 ? 0 : value
}

function requireDistance(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError('Attachment maximum distance must be finite and nonnegative.')
  }
  return value === 0 ? 0 : value
}

function ensureContinuous(discontinuity: PoseDiscontinuityV1): void {
  if (
    discontinuity.positionM > MAXIMUM_POSITION_DISCONTINUITY_M
    || discontinuity.orientationDeg > MAXIMUM_ORIENTATION_DISCONTINUITY_DEG
  ) {
    throw createAttachmentInstructionErrorV1(
      'ATTACHMENT_FRAME_UNAVAILABLE',
      'The Attachment transition would introduce a pose discontinuity.',
    )
  }
}

export function poseDiscontinuityV1(
  beforeInput: RigidTransformV5,
  afterInput: RigidTransformV5,
): PoseDiscontinuityV1 {
  const before = normalizeRigidTransformV5(beforeInput, '$.before')
  const after = normalizeRigidTransformV5(afterInput, '$.after')
  const positionM = Math.hypot(
    before.positionM[0] - after.positionM[0],
    before.positionM[1] - after.positionM[1],
    before.positionM[2] - after.positionM[2],
  )
  const dot = Math.abs(
    before.quaternion[0] * after.quaternion[0]
    + before.quaternion[1] * after.quaternion[1]
    + before.quaternion[2] * after.quaternion[2]
    + before.quaternion[3] * after.quaternion[3],
  )
  const orientationDeg = 2 * Math.acos(Math.max(0, Math.min(1, dot))) * RADIANS_TO_DEGREES
  return deepFreezeV5({
    positionM: positionM === 0 ? 0 : positionM,
    orientationDeg: orientationDeg === 0 ? 0 : orientationDeg,
  })
}

export function prepareAttachTransitionV1(
  instruction: AttachInstructionV1,
  context: AttachTransitionContextV1,
): AttachTransitionV1 {
  if (context.existingAttachment !== null) {
    throw createAttachmentInstructionErrorV1('ALREADY_ATTACHED', `Object ${instruction.objectId} is already attached.`)
  }
  if (context.objectTransformOwner === 'attachment' || context.objectTransformOwner.startsWith('opcua:')) {
    throw createAttachmentInstructionErrorV1(
      'SOURCE_OWNERSHIP_CONFLICT',
      `Object ${instruction.objectId} is owned by ${context.objectTransformOwner}.`,
    )
  }

  const maximumDistanceM = requireDistance(instruction.maximumDistanceM)
  const simulationMs = requireSimulationMs(context.simulationMs)
  const objectWorldPose = frozenPose(context.objectWorldPose, '$.objectWorldPose')
  const toolWorldPose = frozenPose(context.toolWorldPose, '$.toolWorldPose')
  const graspLocalPose = context.objectGraspLocalPose === null
    ? frozenPose({ positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, '$.objectGraspLocalPose')
    : frozenPose(context.objectGraspLocalPose, '$.objectGraspLocalPose')
  const objectGraspWorldPose = frozenPose(
    composeRigidTransformV5(objectWorldPose, graspLocalPose),
    '$.objectGraspWorldPose',
  )
  const toolToGraspDistanceM = Math.hypot(
    toolWorldPose.positionM[0] - objectGraspWorldPose.positionM[0],
    toolWorldPose.positionM[1] - objectGraspWorldPose.positionM[1],
    toolWorldPose.positionM[2] - objectGraspWorldPose.positionM[2],
  )
  if (toolToGraspDistanceM > maximumDistanceM) {
    throw createAttachmentInstructionErrorV1(
      'OUT_OF_RANGE',
      `Tool Frame ${instruction.toolFrameId} is outside the Attach range for Object ${instruction.objectId}.`,
    )
  }

  const toolFromObject = frozenPose(
    relativeRigidTransformV5(toolWorldPose, objectWorldPose),
    '$.toolFromObject',
  )
  const record = deepFreezeV5<AttachmentRuntimeRecordV1>({
    objectId: instruction.objectId,
    robotId: context.robotId,
    toolFrameId: instruction.toolFrameId,
    objectGraspFrameId: instruction.objectGraspFrameId,
    toolFromObject,
    toolWorldPoseAtAttach: toolWorldPose,
    objectWorldPoseAtAttach: objectWorldPose,
    attachedAtSimulationMs: simulationMs,
  })
  const reconstructed = frozenPose(
    composeRigidTransformV5(record.toolWorldPoseAtAttach, record.toolFromObject),
    '$.reconstructedObjectWorldPose',
  )
  const discontinuity = poseDiscontinuityV1(objectWorldPose, reconstructed)
  ensureContinuous(discontinuity)
  return deepFreezeV5({ record, objectGraspWorldPose, toolToGraspDistanceM, discontinuity })
}

export function prepareDetachTransitionV1(
  instruction: DetachInstructionV1,
  context: DetachTransitionContextV1,
): DetachTransitionV1 {
  const attachment = context.attachment
  if (attachment === null) {
    throw createAttachmentInstructionErrorV1('NOT_ATTACHED', `Object ${instruction.objectId} is not attached.`)
  }
  if (attachment.objectId !== instruction.objectId || attachment.robotId !== context.robotId) {
    throw createAttachmentInstructionErrorV1(
      'SOURCE_OWNERSHIP_CONFLICT',
      `Object ${instruction.objectId} is attached by another runtime owner.`,
    )
  }
  if (context.targetParentFrameId !== (instruction.targetParentFrameId ?? context.targetParentFrameId)) {
    throw createAttachmentInstructionErrorV1(
      'ATTACHMENT_TARGET_NOT_FOUND',
      `Detach target ${String(instruction.targetParentFrameId)} does not match the resolved parent.`,
    )
  }

  const simulationMs = requireSimulationMs(context.simulationMs)
  const currentToolWorldPose = frozenPose(context.currentToolWorldPose, '$.currentToolWorldPose')
  const targetParentWorldPose = frozenPose(context.targetParentWorldPose, '$.targetParentWorldPose')
  const objectWorldBefore = frozenPose(
    composeRigidTransformV5(currentToolWorldPose, attachment.toolFromObject),
    '$.objectWorldBefore',
  )
  const nextLocalPose = frozenPose(
    relativeRigidTransformV5(targetParentWorldPose, objectWorldBefore),
    '$.nextLocalPose',
  )
  const reconstructed = frozenPose(
    composeRigidTransformV5(targetParentWorldPose, nextLocalPose),
    '$.reconstructedObjectWorldPose',
  )
  const discontinuity = poseDiscontinuityV1(objectWorldBefore, reconstructed)
  ensureContinuous(discontinuity)
  const override = deepFreezeV5<DetachedPoseOverrideV1>({
    objectId: instruction.objectId,
    parentFrameId: context.targetParentFrameId,
    localPose: nextLocalPose,
    objectWorldPoseAtDetach: objectWorldBefore,
    detachedAtSimulationMs: simulationMs,
  })
  return deepFreezeV5({
    override,
    expectedAttachment: attachment,
    objectWorldBefore,
    targetParentWorldPose,
    nextLocalPose,
    discontinuity,
  })
}
