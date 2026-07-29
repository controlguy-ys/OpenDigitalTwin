import { EMPTY_SOLVER_PARAMETERS_SHA256_V1 } from '../mechanism-runtime-v1/limits.js'
import { MechanismErrorV1 } from '../mechanism-runtime-v1/errors.js'
import type {
  ForwardKinematicsResultV1,
  MechanismDefinitionV1,
  MechanismRuntimeInstanceV1,
  RobotCapabilityV1,
} from '../mechanism-runtime-v1/types.js'
import { failProjectV5, ProjectV5Error } from '../project-v5/errors.js'
import { MAX_ROBOT_JOINTS_V5, MIN_ROBOT_JOINTS_V5 } from '../project-v5/limits.js'
import { normalizeRigidTransformV5, type RigidTransformV5, type Vector3V5 } from '../project-v5/rigid-transform.js'
import type { FrameDefinitionV5, RobotDefinitionV5, RobotInstanceV5, RobotJointDefinitionV5 } from '../project-v5/types.js'
import type { SerialRobotPoseV5 } from './serial-kinematics.js'

export const PROJECT_V5_ROBOT_ADAPTER_KEY = 'open-digital-twin/project-v5-robot'
export const PROJECT_V5_ROBOT_ADAPTER_VERSION = '1'

const DEGREES_TO_RADIANS = Math.PI / 180
const V5_RECOVERY = 'Correct the Robot Definition or Joint values and try again.'

export interface ProjectedRobotMechanismV1 {
  readonly mechanismDefinition: MechanismDefinitionV1
  readonly adapterKey: typeof PROJECT_V5_ROBOT_ADAPTER_KEY
  readonly adapterVersion: typeof PROJECT_V5_ROBOT_ADAPTER_VERSION
}

function invalid(code: string, path: string, message: string): never {
  failProjectV5(code, path, message, V5_RECOVERY)
}

function canonical(value: number): number { return value === 0 ? 0 : value }
function stable(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0 }
function radians(joint: RobotJointDefinitionV5, value: number): number { return joint.type === 'revolute' ? canonical(value * DEGREES_TO_RADIANS) : canonical(value) }

function normalizedPose(value: RigidTransformV5, path: string): RigidTransformV5 {
  if (value.positionM.some((component) => !Number.isFinite(component)) || value.quaternion.some((component) => !Number.isFinite(component))) {
    invalid('PROJECT_VALUE_INVALID', path, 'Rigid transform components must be finite.')
  }
  return normalizeRigidTransformV5({ positionM: [...value.positionM], quaternion: [...value.quaternion] }, path)
}

function normalizedAxis(joint: RobotJointDefinitionV5): Vector3V5 {
  const magnitude = Math.hypot(...joint.axis)
  if (!Number.isFinite(magnitude) || magnitude === 0) invalid('JOINT_AXIS_NOT_NORMALIZABLE', `$.joints.${joint.id}.axis`, 'Joint axis must be finite and non-zero.')
  return [canonical(joint.axis[0] / magnitude), canonical(joint.axis[1] / magnitude), canonical(joint.axis[2] / magnitude)]
}

function validateCommand(joint: RobotJointDefinitionV5, value: number): void {
  if (!Number.isFinite(value)) invalid('ROBOT_JOINT_VALUE_NOT_FINITE', `$.jointValues.${joint.id}`, 'Joint command must be finite.')
  if (!Number.isFinite(joint.min) || !Number.isFinite(joint.max) || joint.min > joint.max) invalid('ROBOT_JOINT_LIMIT_INVALID', `$.joints.${joint.id}`, 'Joint limits must be finite and ordered.')
  if (value < joint.min || value > joint.max) invalid('ROBOT_JOINT_VALUE_OUT_OF_RANGE', `$.jointValues.${joint.id}`, `Joint command must be within ${joint.min}..${joint.max}.`)
  if (!Number.isFinite(joint.zeroOffset)) invalid('ROBOT_JOINT_VALUE_NOT_FINITE', `$.joints.${joint.id}.zeroOffset`, 'Joint zero offset must be finite.')
  if (joint.direction !== 1 && joint.direction !== -1) invalid('ROBOT_JOINT_DIRECTION_INVALID', `$.joints.${joint.id}.direction`, 'Joint direction must be 1 or -1.')
}

interface ChainFacts { readonly rootLinkId: string; readonly byParent: ReadonlyMap<string, RobotJointDefinitionV5> }

/** This intentionally preserves the V5 serial validator's original order and paths. */
function chain(definition: RobotDefinitionV5): ChainFacts {
  if (definition.joints.length < MIN_ROBOT_JOINTS_V5) invalid('ROBOT_JOINT_COUNT_TOO_SMALL', '$.definition.joints', 'At least one Joint is required.')
  if (definition.joints.length > MAX_ROBOT_JOINTS_V5) invalid('ROBOT_JOINT_LIMIT_EXCEEDED', '$.definition.joints', `At most ${MAX_ROBOT_JOINTS_V5} Joints are supported.`)
  if (definition.links.length !== definition.joints.length + 1) invalid('ROBOT_JOINT_CHAIN_INVALID', '$.definition.links', 'A serial Robot must have exactly Joints + 1 Links.')
  const ids = new Set<string>(); const links = new Set<string>()
  definition.links.forEach((link, index) => {
    if (ids.has(link.id)) invalid('PROJECT_ID_DUPLICATE', `$.definition.links[${index}].id`, `Definition-local id ${link.id} is duplicated.`)
    ids.add(link.id); links.add(link.id)
  })
  const incoming = new Map([...links].map((id) => [id, 0])); const outgoing = new Map([...links].map((id) => [id, 0])); const byParent = new Map<string, RobotJointDefinitionV5>()
  definition.joints.forEach((joint, index) => {
    if (ids.has(joint.id)) invalid('PROJECT_ID_DUPLICATE', `$.definition.joints[${index}].id`, `Definition-local id ${joint.id} is duplicated.`)
    ids.add(joint.id)
    if (!links.has(joint.parentLinkId) || !links.has(joint.childLinkId)) invalid('ROBOT_LINK_NOT_FOUND', `$.definition.joints[${index}]`, 'Joint Link does not exist.')
    const nextOut = outgoing.get(joint.parentLinkId)! + 1; const nextIn = incoming.get(joint.childLinkId)! + 1
    if (joint.parentLinkId === joint.childLinkId || nextOut > 1 || nextIn > 1) invalid('ROBOT_JOINT_CHAIN_INVALID', `$.definition.joints[${index}]`, 'Robot Joint graph must be an unbranched serial chain.')
    outgoing.set(joint.parentLinkId, nextOut); incoming.set(joint.childLinkId, nextIn); byParent.set(joint.parentLinkId, joint)
  })
  const roots = [...links].filter((id) => incoming.get(id) === 0); const tips = [...links].filter((id) => outgoing.get(id) === 0)
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
  const expected = new Set(definition.joints.map((joint) => joint.id)); const descriptors = new Map<string, number>()
  for (const key of Reflect.ownKeys(values)) {
    if (typeof key !== 'string') invalid('PROJECT_VALUE_INVALID', '$.jointValues', 'Joint value keys must be strings.')
    const descriptor = Object.getOwnPropertyDescriptor(values, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) invalid('PROJECT_VALUE_INVALID', '$.jointValues', 'Joint values must use enumerable own data properties.')
    descriptors.set(key, descriptor.value as number)
  }
  const keys = [...descriptors.keys()]
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) invalid('ROBOT_JOINT_KEY_SET_MISMATCH', '$.jointValues', 'Joint value keys must exactly match the Robot Definition.')
  return frozenObjectRecord(definition.joints.map((joint) => {
    const value = descriptors.get(joint.id)!; validateCommand(joint, value); return [joint.id, value] as const
  }))
}

function validateFrames(definitionFrames: readonly FrameDefinitionV5[], linkIds: ReadonlySet<string>): void {
  const entries = new Map(definitionFrames.map((frame, index) => [frame.id, { frame, index }]))
  for (const { frame, index } of entries.values()) {
    if (frame.parentFrameId === null || (!linkIds.has(frame.parentFrameId) && !entries.has(frame.parentFrameId))) invalid('FRAME_PARENT_NOT_FOUND', `$.definition.frames[${index}].parentFrameId`, `Definition Frame parent ${String(frame.parentFrameId)} does not exist.`)
  }
  const resolving = new Set<string>(); const resolved = new Set<string>()
  const resolve = (frameId: string): void => {
    if (resolved.has(frameId)) return
    if (resolving.has(frameId)) invalid('FRAME_CYCLE', '$.definition.frames', `Frame ${frameId} participates in a cycle.`)
    resolving.add(frameId)
    const { frame, index } = entries.get(frameId)!
    if (!linkIds.has(frame.parentFrameId!)) resolve(frame.parentFrameId!)
    normalizedPose(frame.localPose, `$.definition.frames[${index}].localPose`)
    resolving.delete(frameId); resolved.add(frameId)
  }
  definitionFrames.forEach((frame) => resolve(frame.id))
}

export function validateSerialRobotCompatibilityInputV5(definition: RobotDefinitionV5, jointValues: Readonly<Record<string, number>>, worldBasePose: RigidTransformV5): void {
  const facts = chain(definition)
  exactJointValues(definition, jointValues)
  normalizedPose(worldBasePose, '$.worldBasePose')
  let parent = facts.rootLinkId; let joint = facts.byParent.get(parent)
  while (joint !== undefined) {
    normalizedPose(joint.origin, `$.definition.joints.${joint.id}.origin`)
    validateCommand(joint, jointValues[joint.id]!)
    normalizedAxis(joint)
    if (joint.type !== 'revolute' && joint.type !== 'prismatic') invalid('ROBOT_JOINT_TYPE_UNSUPPORTED', `$.joints.${joint.id}.type`, `Joint type ${String(joint.type)} is not supported.`)
    parent = joint.childLinkId; joint = facts.byParent.get(parent)
  }
  validateFrames(definition.frames, new Set(definition.links.map((link) => link.id)))
}

function frozenRecord<T>(entries: readonly (readonly [string, T])[]): Readonly<Record<string, T>> {
  const record: Record<string, T> = Object.create(null) as Record<string, T>
  for (const [key, value] of entries) Object.defineProperty(record, key, { configurable: false, enumerable: true, value, writable: false })
  return Object.freeze(record)
}

function frozenObjectRecord<T>(entries: readonly (readonly [string, T])[]): Readonly<Record<string, T>> {
  return Object.freeze(Object.fromEntries(entries))
}

function freezeValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) { for (const entry of value) freezeValue(entry); return Object.freeze(value) as T }
  for (const entry of Object.values(value as Record<string, unknown>)) freezeValue(entry)
  return Object.freeze(value)
}

function cloneFrozenPose(value: RigidTransformV5): RigidTransformV5 {
  return freezeValue({
    positionM: [value.positionM[0], value.positionM[1], value.positionM[2]] as const,
    quaternion: [value.quaternion[0], value.quaternion[1], value.quaternion[2], value.quaternion[3]] as const,
  })
}

function cloneFrozenPoseRecord(value: Readonly<Record<string, RigidTransformV5>>): Readonly<Record<string, RigidTransformV5>> {
  return frozenObjectRecord(Object.keys(value).sort(stable).map((id) => [id, cloneFrozenPose(value[id]!)] as const))
}

function validateDefinitionForProjection(definition: RobotDefinitionV5): void {
  const facts = chain(definition)
  for (const joint of definition.joints) {
    validateCommand(joint, joint.home)
    normalizedAxis(joint)
    normalizedPose(joint.origin, `$.definition.joints.${joint.id}.origin`)
    if (joint.type !== 'revolute' && joint.type !== 'prismatic') invalid('ROBOT_JOINT_TYPE_UNSUPPORTED', `$.joints.${joint.id}.type`, `Joint type ${String(joint.type)} is not supported.`)
  }
  validateFrames(definition.frames, new Set(definition.links.map((link) => link.id)))
  void facts
}

export function projectRobotDefinitionV5ToMechanismV1(definition: RobotDefinitionV5): ProjectedRobotMechanismV1 {
  validateDefinitionForProjection(definition)
  const bodyIds = new Set(definition.links.map((link) => link.id))
  const frames = definition.frames.map((frame) => ({
    frameId: frame.id, name: frame.name, role: frame.role,
    parent: bodyIds.has(frame.parentFrameId!) ? { type: 'body' as const, bodyId: frame.parentFrameId! } : { type: 'frame' as const, frameId: frame.parentFrameId! },
    localPose: normalizedPose(frame.localPose, `$.definition.frames.${frame.id}.localPose`),
  })).sort((left, right) => stable(left.frameId, right.frameId))
  const movable = definition.joints.slice().sort((left, right) => stable(left.id, right.id))
  const definitionValue: MechanismDefinitionV1 = {
    mechanismId: definition.id, name: definition.name, topologyKind: 'tree',
    solverRef: { solverKey: 'open-digital-twin/tree-fk', contractVersion: '1', parameters: {}, normalizedParametersHash: EMPTY_SOLVER_PARAMETERS_SHA256_V1 },
    bodies: definition.links.map((link) => ({ bodyId: link.id, name: link.name })).sort((left, right) => stable(left.bodyId, right.bodyId)),
    joints: movable.map((joint) => ({
      jointId: joint.id, jointType: joint.type, parentBodyId: joint.parentLinkId, childBodyId: joint.childLinkId,
      origin: normalizedPose(joint.origin, `$.definition.joints.${joint.id}.origin`), axis: normalizedAxis(joint),
      minimum: radians(joint, joint.min), maximum: radians(joint, joint.max), home: radians(joint, joint.home), zeroOffset: radians(joint, joint.zeroOffset), direction: joint.direction, maximumVelocity: radians(joint, joint.maximumVelocity),
    })),
    frames,
    motionGroups: [{ motionGroupId: 'primary', name: 'Primary', coordinateJointIds: movable.map((joint) => joint.id), endFrameIds: frames.map((frame) => frame.frameId) }],
    constraints: [],
    geometryBindings: definition.links.flatMap((link) => link.geometryOccurrences.map((occurrence) => ({
      geometryBindingId: occurrence.occurrenceKey, bodyId: link.id, assetReferenceId: occurrence.assetReferenceId, occurrenceKey: occurrence.occurrenceKey,
      bodyLocalPose: normalizedPose(occurrence.linkLocalPose, `$.definition.links.${link.id}.geometryOccurrences.${occurrence.occurrenceKey}.linkLocalPose`),
    }))).sort((left, right) => stable(left.geometryBindingId, right.geometryBindingId)),
    sourceProvenance: {
      sourceKind: 'project-v5-robot', sourceDetail: definition.mechanics.sourceKind, sourceName: definition.mechanics.sourceName,
      sourceRevision: definition.mechanics.calibrationRevision, adapterKey: PROJECT_V5_ROBOT_ADAPTER_KEY, adapterVersion: PROJECT_V5_ROBOT_ADAPTER_VERSION,
    },
  }
  return freezeValue({ mechanismDefinition: definitionValue, adapterKey: PROJECT_V5_ROBOT_ADAPTER_KEY, adapterVersion: PROJECT_V5_ROBOT_ADAPTER_VERSION })
}

export function projectRobotInstanceV5ToMechanismInstanceV1(robot: RobotInstanceV5): MechanismRuntimeInstanceV1 {
  return freezeValue({
    instanceId: robot.id, definitionId: robot.definitionId, parentFrameId: robot.baseParentFrameId, localPose: normalizedPose(robot.localBasePose, '$.robot.localBasePose'),
    activeToolFrameId: robot.selectedToolFrameId, activeTcpFrameId: robot.selectedTcpFrameId, visible: robot.visible,
    declaredValueOwners: { coordinates: robot.jointSource, frames: frozenRecord(Object.entries(robot.frameSources).sort(([left], [right]) => stable(left, right))) },
  })
}

export function projectRobotCapabilityV5(definition: RobotDefinitionV5, robot: RobotInstanceV5): RobotCapabilityV1 {
  const framesByRole = (role: string): readonly string[] => Object.freeze(definition.frames.filter((frame) => frame.role === role).map((frame) => frame.id).sort(stable))
  const coordinateJointIds = definition.joints.map((joint) => joint.id).sort(stable)
  const baseFrameId = framesByRole('base')[0] ?? null
  const flangeFrameIds = framesByRole('flange'); const toolFrameIds = framesByRole('tool'); const tcpFrameIds = framesByRole('tcp')
  return freezeValue({
    robotCapabilityId: robot.id, mechanismId: definition.id, motionGroupIds: ['primary'], baseFrameId, flangeFrameIds, toolFrameIds, tcpFrameIds,
    homeCoordinateSets: [{ coordinateSetId: 'home', name: 'Home', coordinatesByStableId: frozenRecord(definition.joints.slice().sort((left, right) => stable(left.id, right.id)).map((joint) => [joint.id, radians(joint, joint.home)] as const)) }],
    robotStatusSemantics: { numericStatusSupported: true, motionStateSupported: false, safetyStateSupported: false },
    roboticsOpcUaView: { axisJointIds: coordinateJointIds, baseFrameId, flangeFrameIds, toolFrameIds, tcpFrameIds },
  })
}

export function canonicalCoordinatesFromRobotV5(definition: RobotDefinitionV5, jointValues: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  const copied = exactJointValues(definition, jointValues)
  return frozenRecord(definition.joints.slice().sort((left, right) => stable(left.id, right.id)).map((joint) => [joint.id, radians(joint, copied[joint.id]!)] as const))
}

export function serialRobotPoseFromMechanismV1(definition: RobotDefinitionV5, originalJointValues: Readonly<Record<string, number>>, result: ForwardKinematicsResultV1): SerialRobotPoseV5 {
  const copied = exactJointValues(definition, originalJointValues)
  return freezeValue({
    jointValues: copied,
    linkLocalPoses: cloneFrozenPoseRecord(result.bodyLocalPoses),
    linkWorldPoses: cloneFrozenPoseRecord(result.bodyWorldPoses),
    frameWorldPoses: cloneFrozenPoseRecord(result.frameWorldPoses),
  })
}

/**
 * Task 7 uses this only after V5 prevalidation, so any mapped failure is a
 * fail-closed guard rather than a replacement for the legacy first-error API.
 */
export function rethrowSerialRobotCompatibilityErrorV5(error: unknown): never {
  if (error instanceof ProjectV5Error) throw error
  if (error instanceof MechanismErrorV1 && error.code === 'TRANSFORM_INVALID' && error.cause instanceof ProjectV5Error) throw error.cause
  if (!(error instanceof MechanismErrorV1)) throw error
  const code: Record<MechanismErrorV1['code'], string | undefined> = {
    COORDINATE_SET_MISMATCH: 'ROBOT_JOINT_KEY_SET_MISMATCH', COORDINATE_VALUE_NOT_FINITE: 'ROBOT_JOINT_VALUE_NOT_FINITE', JOINT_LIMIT_EXCEEDED: 'ROBOT_JOINT_VALUE_OUT_OF_RANGE', JOINT_LIMIT_INVALID: 'ROBOT_JOINT_LIMIT_INVALID', JOINT_AXIS_NOT_NORMALIZABLE: 'JOINT_AXIS_NOT_NORMALIZABLE', JOINT_DIRECTION_INVALID: 'ROBOT_JOINT_DIRECTION_INVALID', MECHANISM_VALUE_INVALID: 'PROJECT_VALUE_INVALID', MECHANISM_ID_DUPLICATE: 'PROJECT_ID_DUPLICATE', BODY_NOT_FOUND: 'ROBOT_LINK_NOT_FOUND', FRAME_PARENT_NOT_FOUND: 'FRAME_PARENT_NOT_FOUND', FRAME_CYCLE: 'FRAME_CYCLE', MECHANISM_TOPOLOGY_INVALID: 'ROBOT_JOINT_CHAIN_INVALID', TOPOLOGY_UNSUPPORTED: 'ROBOT_JOINT_CHAIN_INVALID', TRANSFORM_INVALID: 'PROJECT_VALUE_INVALID',
    SOLVER_REGISTRATION_DUPLICATE: undefined, SOLVER_UNAVAILABLE: undefined, SOLVER_CAPABILITY_UNAVAILABLE: undefined, SOLVER_PARAMETERS_INVALID: undefined, SOLVER_RESULT_INVALID: undefined, MECHANISM_RESOURCE_LIMIT_EXCEEDED: undefined, FRAME_NOT_FOUND: undefined, MOTION_GROUP_NOT_FOUND: undefined, MOTION_GROUP_INVALID: undefined, CONSTRAINT_UNSATISFIED: undefined,
  }
  const mapped = code[error.code]
  if (mapped !== undefined) {
    const prefix = `${error.code} at ${error.path}: `
    failProjectV5(mapped, error.path, error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message, V5_RECOVERY)
  }
  failProjectV5('PROJECT_VALUE_INVALID', '$.result', 'Serial kinematics evaluation failed.', V5_RECOVERY)
}
