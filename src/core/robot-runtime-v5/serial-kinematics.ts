import { failProjectV5 } from '../project-v5/errors.js'
import { MAX_ROBOT_JOINTS_V5, MIN_ROBOT_JOINTS_V5 } from '../project-v5/limits.js'
import {
  composeRigidTransformV5,
  normalizeRigidTransformV5,
  type QuaternionV5,
  type RigidTransformV5,
  type Vector3V5,
} from '../project-v5/rigid-transform.js'
import type {
  FrameDefinitionV5,
  RobotDefinitionV5,
  RobotJointDefinitionV5,
} from '../project-v5/types.js'

export interface SerialRobotPoseV5 {
  readonly jointValues: Readonly<Record<string, number>>
  readonly linkLocalPoses: Readonly<Record<string, RigidTransformV5>>
  readonly linkWorldPoses: Readonly<Record<string, RigidTransformV5>>
  readonly frameWorldPoses: Readonly<Record<string, RigidTransformV5>>
}

function invalid(code: string, path: string, message: string): never {
  failProjectV5(code, path, message, 'Correct the Robot Definition or Joint values and try again.')
}

function canonical(value: number): number { return value === 0 ? 0 : value }
function identity(): RigidTransformV5 { return { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] } }

function normalizedPose(value: RigidTransformV5, path: string): RigidTransformV5 {
  if (value.positionM.some((v) => !Number.isFinite(v)) || value.quaternion.some((v) => !Number.isFinite(v))) {
    invalid('PROJECT_VALUE_INVALID', path, 'Rigid transform components must be finite.')
  }
  return normalizeRigidTransformV5({ positionM: [...value.positionM], quaternion: [...value.quaternion] }, path)
}

function normalizedAxis(joint: RobotJointDefinitionV5): Vector3V5 {
  const magnitude = Math.hypot(...joint.axis)
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    invalid('JOINT_AXIS_NOT_NORMALIZABLE', `$.joints.${joint.id}.axis`, 'Joint axis must be finite and non-zero.')
  }
  return [canonical(joint.axis[0] / magnitude), canonical(joint.axis[1] / magnitude), canonical(joint.axis[2] / magnitude)]
}

function validateCommand(joint: RobotJointDefinitionV5, value: number): void {
  if (!Number.isFinite(value)) invalid('ROBOT_JOINT_VALUE_NOT_FINITE', `$.jointValues.${joint.id}`, 'Joint command must be finite.')
  if (!Number.isFinite(joint.min) || !Number.isFinite(joint.max) || joint.min > joint.max) {
    invalid('ROBOT_JOINT_LIMIT_INVALID', `$.joints.${joint.id}`, 'Joint limits must be finite and ordered.')
  }
  if (value < joint.min || value > joint.max) {
    invalid('ROBOT_JOINT_VALUE_OUT_OF_RANGE', `$.jointValues.${joint.id}`, `Joint command must be within ${joint.min}..${joint.max}.`)
  }
  if (!Number.isFinite(joint.zeroOffset)) invalid('ROBOT_JOINT_VALUE_NOT_FINITE', `$.joints.${joint.id}.zeroOffset`, 'Joint zero offset must be finite.')
  if (joint.direction !== 1 && joint.direction !== -1) invalid('ROBOT_JOINT_DIRECTION_INVALID', `$.joints.${joint.id}.direction`, 'Joint direction must be 1 or -1.')
}

export function jointMotionTransformV5(joint: RobotJointDefinitionV5, commandedValue: number): RigidTransformV5 {
  validateCommand(joint, commandedValue)
  const axis = normalizedAxis(joint)
  const mechanical = joint.direction * (commandedValue + joint.zeroOffset)
  if (!Number.isFinite(mechanical)) invalid('ROBOT_JOINT_VALUE_NOT_FINITE', `$.jointValues.${joint.id}`, 'Joint mechanical value must be finite.')
  if (joint.type === 'prismatic') {
    return { positionM: [canonical(axis[0] * mechanical), canonical(axis[1] * mechanical), canonical(axis[2] * mechanical)], quaternion: [0, 0, 0, 1] }
  }
  if (joint.type !== 'revolute') invalid('ROBOT_JOINT_TYPE_UNSUPPORTED', `$.joints.${joint.id}.type`, `Joint type ${String(joint.type)} is not supported.`)
  const half = mechanical * Math.PI / 360
  const quaternion: QuaternionV5 = [axis[0] * Math.sin(half), axis[1] * Math.sin(half), axis[2] * Math.sin(half), Math.cos(half)]
  return normalizeRigidTransformV5({ positionM: [0, 0, 0], quaternion }, '$.jointMotion')
}

interface ChainFacts {
  readonly rootLinkId: string
  readonly byParent: ReadonlyMap<string, RobotJointDefinitionV5>
}

function chain(definition: RobotDefinitionV5): ChainFacts {
  if (definition.joints.length < MIN_ROBOT_JOINTS_V5) invalid('ROBOT_JOINT_COUNT_TOO_SMALL', '$.definition.joints', 'At least one Joint is required.')
  if (definition.joints.length > MAX_ROBOT_JOINTS_V5) invalid('ROBOT_JOINT_LIMIT_EXCEEDED', '$.definition.joints', `At most ${MAX_ROBOT_JOINTS_V5} Joints are supported.`)
  if (definition.links.length !== definition.joints.length + 1) invalid('ROBOT_JOINT_CHAIN_INVALID', '$.definition.links', 'A serial Robot must have exactly Joints + 1 Links.')
  const ids = new Set<string>()
  const links = new Set<string>()
  definition.links.forEach((link, index) => {
    if (ids.has(link.id)) invalid('PROJECT_ID_DUPLICATE', `$.definition.links[${index}].id`, `Definition-local id ${link.id} is duplicated.`)
    ids.add(link.id); links.add(link.id)
  })
  const incoming = new Map([...links].map((id) => [id, 0]))
  const outgoing = new Map([...links].map((id) => [id, 0]))
  const byParent = new Map<string, RobotJointDefinitionV5>()
  definition.joints.forEach((joint, index) => {
    if (ids.has(joint.id)) invalid('PROJECT_ID_DUPLICATE', `$.definition.joints[${index}].id`, `Definition-local id ${joint.id} is duplicated.`)
    ids.add(joint.id)
    if (!links.has(joint.parentLinkId) || !links.has(joint.childLinkId)) invalid('ROBOT_LINK_NOT_FOUND', `$.definition.joints[${index}]`, 'Joint Link does not exist.')
    const nextOut = outgoing.get(joint.parentLinkId)! + 1
    const nextIn = incoming.get(joint.childLinkId)! + 1
    if (joint.parentLinkId === joint.childLinkId || nextOut > 1 || nextIn > 1) invalid('ROBOT_JOINT_CHAIN_INVALID', `$.definition.joints[${index}]`, 'Robot Joint graph must be an unbranched serial chain.')
    outgoing.set(joint.parentLinkId, nextOut); incoming.set(joint.childLinkId, nextIn); byParent.set(joint.parentLinkId, joint)
  })
  const roots = [...links].filter((id) => incoming.get(id) === 0)
  const tips = [...links].filter((id) => outgoing.get(id) === 0)
  if (roots.length !== 1 || tips.length !== 1) invalid('ROBOT_JOINT_CHAIN_INVALID', '$.definition.joints', 'Robot Joint graph must have exactly one root and one tip.')
  const visited = new Set<string>(); let cursor: string | undefined = roots[0]
  while (cursor !== undefined && !visited.has(cursor)) { visited.add(cursor); cursor = byParent.get(cursor)?.childLinkId }
  if (visited.size !== links.size || cursor !== undefined) invalid('ROBOT_JOINT_CHAIN_INVALID', '$.definition.joints', 'Robot Joint graph must be connected and acyclic.')
  definition.frames.forEach((frame, index) => {
    if (ids.has(frame.id)) invalid('PROJECT_ID_DUPLICATE', `$.definition.frames[${index}].id`, `Definition-local id ${frame.id} is duplicated.`)
    ids.add(frame.id)
  })
  return { rootLinkId: roots[0]!, byParent }
}

function exactJointValues(definition: RobotDefinitionV5, values: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) invalid('PROJECT_VALUE_INVALID', '$.jointValues', 'Joint values must be a plain record.')
  const prototype = Object.getPrototypeOf(values)
  if (prototype !== Object.prototype && prototype !== null) invalid('PROJECT_VALUE_INVALID', '$.jointValues', 'Joint values must not use a custom prototype.')
  const expected = new Set(definition.joints.map((joint) => joint.id))
  const descriptors = new Map<string, number>()
  for (const key of Reflect.ownKeys(values)) {
    if (typeof key !== 'string') invalid('PROJECT_VALUE_INVALID', '$.jointValues', 'Joint value keys must be strings.')
    const descriptor = Object.getOwnPropertyDescriptor(values, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) invalid('PROJECT_VALUE_INVALID', '$.jointValues', 'Joint values must use enumerable own data properties.')
    descriptors.set(key, descriptor.value as number)
  }
  const keys = [...descriptors.keys()]
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) invalid('ROBOT_JOINT_KEY_SET_MISMATCH', '$.jointValues', 'Joint value keys must exactly match the Robot Definition.')
  return Object.freeze(Object.fromEntries(definition.joints.map((joint) => {
    const value = descriptors.get(joint.id)!
    validateCommand(joint, value)
    return [joint.id, value]
  })))
}

function frames(
  definitionFrames: readonly FrameDefinitionV5[],
  links: ReadonlyMap<string, RigidTransformV5>,
): Readonly<Record<string, RigidTransformV5>> {
  const entries = new Map(definitionFrames.map((frame, index) => [frame.id, { frame, index }]))
  for (const { frame, index } of entries.values()) {
    if (frame.parentFrameId === null || (!links.has(frame.parentFrameId) && !entries.has(frame.parentFrameId))) {
      invalid('FRAME_PARENT_NOT_FOUND', `$.definition.frames[${index}].parentFrameId`, `Definition Frame parent ${String(frame.parentFrameId)} does not exist.`)
    }
  }
  const resolving = new Set<string>(); const resolved = new Map<string, RigidTransformV5>()
  const resolve = (frameId: string): RigidTransformV5 => {
    const prior = resolved.get(frameId); if (prior !== undefined) return prior
    if (resolving.has(frameId)) invalid('FRAME_CYCLE', '$.definition.frames', `Frame ${frameId} participates in a cycle.`)
    resolving.add(frameId)
    const entry = entries.get(frameId)!
    const parent = links.get(entry.frame.parentFrameId!) ?? resolve(entry.frame.parentFrameId!)
    const output = composeRigidTransformV5(parent, normalizedPose(entry.frame.localPose, `$.definition.frames[${entry.index}].localPose`))
    resolving.delete(frameId); resolved.set(frameId, output); return output
  }
  definitionFrames.forEach((frame) => resolve(frame.id))
  return Object.freeze(Object.fromEntries(resolved))
}

export function computeSerialRobotPoseV5(
  definition: RobotDefinitionV5,
  jointValues: Readonly<Record<string, number>>,
  worldBasePose: RigidTransformV5 = identity(),
): SerialRobotPoseV5 {
  const facts = chain(definition)
  const copied = exactJointValues(definition, jointValues)
  const local = new Map<string, RigidTransformV5>([[facts.rootLinkId, identity()]])
  const world = new Map<string, RigidTransformV5>([[facts.rootLinkId, normalizedPose(worldBasePose, '$.worldBasePose')]])
  let parent = facts.rootLinkId; let joint = facts.byParent.get(parent)
  while (joint !== undefined) {
    const childLocal = composeRigidTransformV5(normalizedPose(joint.origin, `$.definition.joints.${joint.id}.origin`), jointMotionTransformV5(joint, copied[joint.id]!))
    local.set(joint.childLinkId, childLocal)
    world.set(joint.childLinkId, composeRigidTransformV5(world.get(parent)!, childLocal))
    parent = joint.childLinkId; joint = facts.byParent.get(parent)
  }
  return Object.freeze({ jointValues: copied, linkLocalPoses: Object.freeze(Object.fromEntries(local)), linkWorldPoses: Object.freeze(Object.fromEntries(world)), frameWorldPoses: frames(definition.frames, world) })
}
