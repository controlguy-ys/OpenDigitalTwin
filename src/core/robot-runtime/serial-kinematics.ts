import { failProjectV4 } from '../project-v4/errors.js'
import {
  MAX_ROBOT_JOINTS_V4,
  MIN_ROBOT_JOINTS_V4,
} from '../project-v4/limits.js'
import {
  composeRigidTransformV4,
  normalizeRigidTransformV4,
  type QuaternionV4,
  type RigidTransformV4,
  type Vector3V4,
} from '../project-v4/rigid-transform.js'
import type {
  FrameDefinitionV4,
  RobotDefinitionV4,
  RobotJointDefinitionV4,
} from '../project-v4/types.js'

export interface SerialRobotPoseV4 {
  readonly jointValues: Readonly<Record<string, number>>
  readonly linkLocalPoses: Readonly<Record<string, RigidTransformV4>>
  readonly linkWorldPoses: Readonly<Record<string, RigidTransformV4>>
  readonly frameWorldPoses: Readonly<Record<string, RigidTransformV4>>
}

function invalidKinematics(code: string, path: string, message: string): never {
  failProjectV4(code, path, message, 'Correct the Robot Definition or Joint values and try again.')
}

function canonicalNumber(value: number): number {
  return value === 0 ? 0 : value
}

function identityTransform(): RigidTransformV4 {
  return { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }
}

function cloneNormalizedTransform(
  value: RigidTransformV4,
  path: string,
): RigidTransformV4 {
  if (
    value.positionM.some((component) => !Number.isFinite(component))
    || value.quaternion.some((component) => !Number.isFinite(component))
  ) {
    invalidKinematics('PROJECT_VALUE_INVALID', path, 'Rigid transform components must be finite.')
  }

  return normalizeRigidTransformV4({
    positionM: [...value.positionM],
    quaternion: [...value.quaternion],
  }, path)
}

function normalizedAxis(joint: RobotJointDefinitionV4): Vector3V4 {
  const magnitude = Math.hypot(...joint.axis)
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    invalidKinematics(
      'JOINT_AXIS_NOT_NORMALIZABLE',
      `$.joints.${joint.id}.axis`,
      'Joint axis must be finite and non-zero.',
    )
  }
  return [
    canonicalNumber(joint.axis[0] / magnitude),
    canonicalNumber(joint.axis[1] / magnitude),
    canonicalNumber(joint.axis[2] / magnitude),
  ]
}

function validateRawJointCommand(
  joint: RobotJointDefinitionV4,
  commandedValue: number,
): void {
  if (!Number.isFinite(commandedValue)) {
    invalidKinematics(
      'ROBOT_JOINT_VALUE_NOT_FINITE',
      `$.jointValues.${joint.id}`,
      'Joint command must be finite.',
    )
  }
  if (!Number.isFinite(joint.min) || !Number.isFinite(joint.max) || joint.min > joint.max) {
    invalidKinematics(
      'ROBOT_JOINT_LIMIT_INVALID',
      `$.joints.${joint.id}`,
      'Joint limits must be finite and ordered.',
    )
  }
  if (commandedValue < joint.min || commandedValue > joint.max) {
    invalidKinematics(
      'ROBOT_JOINT_VALUE_OUT_OF_RANGE',
      `$.jointValues.${joint.id}`,
      `Joint command must be within ${joint.min}..${joint.max}.`,
    )
  }
  if (!Number.isFinite(joint.zeroOffset)) {
    invalidKinematics(
      'ROBOT_JOINT_VALUE_NOT_FINITE',
      `$.joints.${joint.id}.zeroOffset`,
      'Joint zero offset must be finite.',
    )
  }
  if (joint.direction !== 1 && joint.direction !== -1) {
    invalidKinematics(
      'ROBOT_JOINT_DIRECTION_INVALID',
      `$.joints.${joint.id}.direction`,
      'Joint direction must be 1 or -1.',
    )
  }
}

export function jointMotionTransformV4(
  joint: RobotJointDefinitionV4,
  commandedValue: number,
): RigidTransformV4 {
  validateRawJointCommand(joint, commandedValue)
  const axis = normalizedAxis(joint)
  const mechanicalValue = joint.direction * (commandedValue + joint.zeroOffset)
  if (!Number.isFinite(mechanicalValue)) {
    invalidKinematics(
      'ROBOT_JOINT_VALUE_NOT_FINITE',
      `$.jointValues.${joint.id}`,
      'Joint mechanical value must be finite.',
    )
  }

  if (joint.type === 'prismatic') {
    return {
      positionM: [
        canonicalNumber(axis[0] * mechanicalValue),
        canonicalNumber(axis[1] * mechanicalValue),
        canonicalNumber(axis[2] * mechanicalValue),
      ],
      quaternion: [0, 0, 0, 1],
    }
  }
  if (joint.type !== 'revolute') {
    invalidKinematics(
      'ROBOT_JOINT_TYPE_UNSUPPORTED',
      `$.joints.${joint.id}.type`,
      `Joint type ${String(joint.type)} is not supported.`,
    )
  }

  const halfAngleRadians = mechanicalValue * Math.PI / 360
  const sine = Math.sin(halfAngleRadians)
  const quaternion: QuaternionV4 = [
    axis[0] * sine,
    axis[1] * sine,
    axis[2] * sine,
    Math.cos(halfAngleRadians),
  ]
  return normalizeRigidTransformV4({ positionM: [0, 0, 0], quaternion }, '$.jointMotion')
}

interface SerialChainFacts {
  readonly rootLinkId: string
  readonly jointByParentLinkId: ReadonlyMap<string, RobotJointDefinitionV4>
}

function registerLocalId(ids: Set<string>, id: string, path: string): void {
  if (ids.has(id)) {
    invalidKinematics('PROJECT_ID_DUPLICATE', path, `Definition-local id ${id} is duplicated.`)
  }
  ids.add(id)
}

function inspectSerialChain(definition: RobotDefinitionV4): SerialChainFacts {
  const jointCount = definition.joints.length
  if (jointCount < MIN_ROBOT_JOINTS_V4) {
    invalidKinematics(
      'ROBOT_JOINT_COUNT_TOO_SMALL',
      '$.definition.joints',
      'At least one Joint is required.',
    )
  }
  if (jointCount > MAX_ROBOT_JOINTS_V4) {
    invalidKinematics(
      'ROBOT_JOINT_LIMIT_EXCEEDED',
      '$.definition.joints',
      `At most ${MAX_ROBOT_JOINTS_V4} Joints are supported.`,
    )
  }
  if (definition.links.length !== jointCount + 1) {
    invalidKinematics(
      'ROBOT_JOINT_CHAIN_INVALID',
      '$.definition.links',
      'A serial Robot must have exactly Joints + 1 Links.',
    )
  }

  const localIds = new Set<string>()
  const linkIds = new Set<string>()
  definition.links.forEach((link, index) => {
    registerLocalId(localIds, link.id, `$.definition.links[${index}].id`)
    linkIds.add(link.id)
  })

  const incoming = new Map([...linkIds].map((linkId) => [linkId, 0]))
  const outgoing = new Map([...linkIds].map((linkId) => [linkId, 0]))
  const jointByParentLinkId = new Map<string, RobotJointDefinitionV4>()
  definition.joints.forEach((joint, index) => {
    registerLocalId(localIds, joint.id, `$.definition.joints[${index}].id`)
    if (!linkIds.has(joint.parentLinkId)) {
      invalidKinematics(
        'ROBOT_LINK_NOT_FOUND',
        `$.definition.joints[${index}].parentLinkId`,
        `Link ${joint.parentLinkId} does not exist.`,
      )
    }
    if (!linkIds.has(joint.childLinkId)) {
      invalidKinematics(
        'ROBOT_LINK_NOT_FOUND',
        `$.definition.joints[${index}].childLinkId`,
        `Link ${joint.childLinkId} does not exist.`,
      )
    }
    const nextOutgoing = outgoing.get(joint.parentLinkId)! + 1
    const nextIncoming = incoming.get(joint.childLinkId)! + 1
    if (
      joint.parentLinkId === joint.childLinkId
      || nextOutgoing > 1
      || nextIncoming > 1
    ) {
      invalidKinematics(
        'ROBOT_JOINT_CHAIN_INVALID',
        `$.definition.joints[${index}]`,
        'Robot Joint graph must be an unbranched serial chain.',
      )
    }
    outgoing.set(joint.parentLinkId, nextOutgoing)
    incoming.set(joint.childLinkId, nextIncoming)
    jointByParentLinkId.set(joint.parentLinkId, joint)
  })

  const roots = [...linkIds].filter((linkId) => incoming.get(linkId) === 0)
  const tips = [...linkIds].filter((linkId) => outgoing.get(linkId) === 0)
  if (roots.length !== 1 || tips.length !== 1) {
    invalidKinematics(
      'ROBOT_JOINT_CHAIN_INVALID',
      '$.definition.joints',
      'Robot Joint graph must have exactly one root and one tip.',
    )
  }

  const visitedLinks = new Set<string>()
  let cursor: string | undefined = roots[0]
  while (cursor !== undefined && !visitedLinks.has(cursor)) {
    visitedLinks.add(cursor)
    cursor = jointByParentLinkId.get(cursor)?.childLinkId
  }
  if (visitedLinks.size !== linkIds.size || cursor !== undefined) {
    invalidKinematics(
      'ROBOT_JOINT_CHAIN_INVALID',
      '$.definition.joints',
      'Robot Joint graph must be connected and acyclic.',
    )
  }

  definition.frames.forEach((frame, index) => {
    registerLocalId(localIds, frame.id, `$.definition.frames[${index}].id`)
  })
  return { rootLinkId: roots[0]!, jointByParentLinkId }
}

function cloneJointValues(
  definition: RobotDefinitionV4,
  jointValues: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const jointIds = new Set(definition.joints.map(({ id }) => id))
  const keys = Object.keys(jointValues)
  if (keys.length !== jointIds.size || keys.some((key) => !jointIds.has(key))) {
    invalidKinematics(
      'ROBOT_JOINT_KEY_SET_MISMATCH',
      '$.jointValues',
      'Joint value keys must exactly match the Robot Definition.',
    )
  }
  return Object.fromEntries(definition.joints.map((joint) => {
    const commandedValue = jointValues[joint.id]!
    validateRawJointCommand(joint, commandedValue)
    return [joint.id, commandedValue]
  }))
}

function resolveDefinitionFrames(
  frames: readonly FrameDefinitionV4[],
  linkWorldPoses: ReadonlyMap<string, RigidTransformV4>,
): ReadonlyMap<string, RigidTransformV4> {
  const framesById = new Map<string, { readonly frame: FrameDefinitionV4; readonly index: number }>()
  frames.forEach((frame, index) => framesById.set(frame.id, { frame, index }))
  for (const { frame, index } of framesById.values()) {
    if (
      frame.parentFrameId === null
      || (!linkWorldPoses.has(frame.parentFrameId) && !framesById.has(frame.parentFrameId))
    ) {
      invalidKinematics(
        'FRAME_PARENT_NOT_FOUND',
        `$.definition.frames[${index}].parentFrameId`,
        `Definition Frame parent ${String(frame.parentFrameId)} does not exist.`,
      )
    }
  }

  const gray = new Set<string>()
  const resolved = new Map<string, RigidTransformV4>()
  const resolve = (frameId: string): RigidTransformV4 => {
    const existing = resolved.get(frameId)
    if (existing !== undefined) return existing
    if (gray.has(frameId)) {
      invalidKinematics('FRAME_CYCLE', '$.definition.frames', `Frame ${frameId} participates in a cycle.`)
    }
    gray.add(frameId)
    const entry = framesById.get(frameId)!
    const parentFrameId = entry.frame.parentFrameId!
    const parentWorld = linkWorldPoses.get(parentFrameId) ?? resolve(parentFrameId)
    const localPose = cloneNormalizedTransform(
      entry.frame.localPose,
      `$.definition.frames[${entry.index}].localPose`,
    )
    const worldPose = composeRigidTransformV4(parentWorld, localPose)
    gray.delete(frameId)
    resolved.set(frameId, worldPose)
    return worldPose
  }
  frames.forEach(({ id }) => resolve(id))
  return resolved
}

export function computeSerialRobotPoseV4(
  definition: RobotDefinitionV4,
  jointValues: Readonly<Record<string, number>>,
  worldBasePose: RigidTransformV4 = identityTransform(),
): SerialRobotPoseV4 {
  const chain = inspectSerialChain(definition)
  const copiedJointValues = cloneJointValues(definition, jointValues)
  const linkLocalPoses = new Map<string, RigidTransformV4>()
  const linkWorldPoses = new Map<string, RigidTransformV4>()
  const rootLocalPose = identityTransform()
  linkLocalPoses.set(chain.rootLinkId, rootLocalPose)
  linkWorldPoses.set(
    chain.rootLinkId,
    cloneNormalizedTransform(worldBasePose, '$.worldBasePose'),
  )

  let parentLinkId = chain.rootLinkId
  let joint = chain.jointByParentLinkId.get(parentLinkId)
  while (joint !== undefined) {
    const origin = cloneNormalizedTransform(joint.origin, `$.definition.joints.${joint.id}.origin`)
    const motion = jointMotionTransformV4(joint, copiedJointValues[joint.id]!)
    const childLocalPose = composeRigidTransformV4(origin, motion)
    const childWorldPose = composeRigidTransformV4(
      linkWorldPoses.get(parentLinkId)!,
      childLocalPose,
    )
    linkLocalPoses.set(joint.childLinkId, childLocalPose)
    linkWorldPoses.set(joint.childLinkId, childWorldPose)
    parentLinkId = joint.childLinkId
    joint = chain.jointByParentLinkId.get(parentLinkId)
  }

  const frameWorldPoses = resolveDefinitionFrames(definition.frames, linkWorldPoses)
  return {
    jointValues: copiedJointValues,
    linkLocalPoses: Object.fromEntries(linkLocalPoses),
    linkWorldPoses: Object.fromEntries(linkWorldPoses),
    frameWorldPoses: Object.fromEntries(frameWorldPoses),
  }
}
