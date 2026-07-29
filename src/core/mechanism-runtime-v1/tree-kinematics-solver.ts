import { composeRigidTransformV5 } from '../project-v5/rigid-transform.js'
import { failMechanismV1, MechanismErrorV1 } from './errors.js'
import { frozenNullPrototypeRecordV1, normalizeMechanismRigidTransformV1 } from './validation-support.js'
import { compileTreeMechanismDefinitionV1, type CompiledTreeMechanismV1 } from './validate-tree-definition.js'
import type {
  ForwardKinematicsRequestV1,
  ForwardKinematicsResultV1,
  KinematicsSolverV1,
  MechanismDefinitionV1,
  MechanismJointV1,
  RigidTransformV1,
  SolverCapabilitiesV1,
  ValidationReportV1,
} from './types.js'

export const TREE_KINEMATICS_SOLVER_KEY_V1 = 'open-digital-twin/tree-fk'
export const TREE_KINEMATICS_SOLVER_CONTRACT_VERSION_V1 = '1'

const IDENTITY_POSE_V1: RigidTransformV1 = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
}

const CAPABILITIES_V1: SolverCapabilitiesV1 = Object.freeze({
  topologyKinds: Object.freeze(['tree'] as const),
  jointTypes: Object.freeze(['fixed', 'revolute', 'prismatic'] as const),
  deterministicForward: true,
  inverse: false,
  jacobian: false,
  constraintProjection: false,
})

function compareStableIds(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function canonicalNumber(value: number): number {
  return value === 0 ? 0 : value
}

function frozenPose(value: RigidTransformV1, path: string): RigidTransformV1 {
  const normalized = normalizeMechanismRigidTransformV1(value, path)
  return Object.freeze({
    positionM: Object.freeze(normalized.positionM.map(canonicalNumber) as [number, number, number]),
    quaternion: Object.freeze(normalized.quaternion.map(canonicalNumber) as [number, number, number, number]),
  })
}

function deeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return true
  if (!Object.isFrozen(value)) return false
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !('value' in descriptor) || !deeplyFrozen(descriptor.value, seen)) return false
  }
  return true
}

function invalidCoordinateRecord(): never {
  return failMechanismV1(
    'MECHANISM_VALUE_INVALID',
    '$.coordinatesByStableId',
    'Coordinates must be a plain record with enumerable data properties.',
  )
}

function normalizeCoordinates(
  compiled: CompiledTreeMechanismV1,
  coordinates: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  if (coordinates === null || typeof coordinates !== 'object' || Array.isArray(coordinates)) invalidCoordinateRecord()
  const prototype = Object.getPrototypeOf(coordinates)
  if (prototype !== Object.prototype && prototype !== null) invalidCoordinateRecord()

  const suppliedIds: string[] = []
  for (const key of Reflect.ownKeys(coordinates)) {
    if (typeof key !== 'string') invalidCoordinateRecord()
    const descriptor = Object.getOwnPropertyDescriptor(coordinates, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) invalidCoordinateRecord()
    suppliedIds.push(key)
  }
  const expectedIds = compiled.movableJointIds
  if (suppliedIds.length !== expectedIds.length || suppliedIds.some((jointId) => !expectedIds.includes(jointId))) {
    failMechanismV1('COORDINATE_SET_MISMATCH', '$.coordinatesByStableId', 'Coordinates must name exactly every movable Joint.')
  }

  const jointsById = new Map(compiled.definition.joints.map((joint) => [joint.jointId, joint] as const))
  const entries: [string, number][] = []
  for (const jointId of expectedIds) {
    const coordinate = coordinates[jointId]
    if (typeof coordinate !== 'number' || !Number.isFinite(coordinate)) {
      failMechanismV1('COORDINATE_VALUE_NOT_FINITE', `$.coordinatesByStableId.${jointId}`, 'Coordinate must be finite.')
    }
    const joint = jointsById.get(jointId)!
    if (joint.jointType === 'fixed') {
      failMechanismV1('COORDINATE_SET_MISMATCH', '$.coordinatesByStableId', 'Fixed Joints do not accept coordinates.')
    }
    if (coordinate < joint.minimum || coordinate > joint.maximum) {
      failMechanismV1('JOINT_LIMIT_EXCEEDED', `$.coordinatesByStableId.${jointId}`, 'Commanded coordinate exceeds Joint limits.')
    }
    entries.push([jointId, canonicalNumber(coordinate)])
  }
  return frozenNullPrototypeRecordV1(entries)
}

function jointMotion(joint: MechanismJointV1, coordinate: number | undefined): RigidTransformV1 {
  if (joint.jointType === 'fixed') return IDENTITY_POSE_V1
  const qMechanical = joint.direction * (coordinate! + joint.zeroOffset)
  if (joint.jointType === 'prismatic') {
    return {
      positionM: [joint.axis[0] * qMechanical, joint.axis[1] * qMechanical, joint.axis[2] * qMechanical],
      quaternion: [0, 0, 0, 1],
    }
  }
  const halfAngle = qMechanical / 2
  const sine = Math.sin(halfAngle)
  return {
    positionM: [0, 0, 0],
    quaternion: [joint.axis[0] * sine, joint.axis[1] * sine, joint.axis[2] * sine, Math.cos(halfAngle)],
  }
}

function requestFrameIds(value: ForwardKinematicsRequestV1['requestedFrameIds']): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    failMechanismV1('MECHANISM_VALUE_INVALID', '$.requestedFrameIds', 'Requested Frame IDs must be a dense string array.')
  }
  const ids: string[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor) || typeof descriptor.value !== 'string') {
      failMechanismV1('MECHANISM_VALUE_INVALID', `$.requestedFrameIds[${index}]`, 'Requested Frame IDs must be strings.')
    }
    ids.push(descriptor.value)
  }
  return ids
}

function compiledFor(
  definition: MechanismDefinitionV1,
  cache: WeakMap<MechanismDefinitionV1, CompiledTreeMechanismV1>,
): CompiledTreeMechanismV1 {
  if (deeplyFrozen(definition)) {
    const cached = cache.get(definition)
    if (cached !== undefined) return cached
    const compiled = compileTreeMechanismDefinitionV1(definition)
    cache.set(definition, compiled)
    return compiled
  }
  return compileTreeMechanismDefinitionV1(definition)
}

function validationReport(definition: MechanismDefinitionV1): ValidationReportV1 {
  try {
    compileTreeMechanismDefinitionV1(definition)
    return Object.freeze({ valid: true, errors: Object.freeze([]), warnings: Object.freeze([]) })
  } catch (error) {
    if (!(error instanceof MechanismErrorV1)) throw error
    return Object.freeze({
      valid: false,
      errors: Object.freeze([Object.freeze({
        code: error.code,
        path: error.path,
        message: error.message,
        ...(error.recovery === undefined ? {} : { recovery: error.recovery }),
      })]),
      warnings: Object.freeze([]),
    })
  }
}

export function createTreeKinematicsSolverV1(): KinematicsSolverV1 {
  const compiledByDefinition = new WeakMap<MechanismDefinitionV1, CompiledTreeMechanismV1>()

  const solver: KinematicsSolverV1 = {
    solverKey: TREE_KINEMATICS_SOLVER_KEY_V1,
    contractVersion: TREE_KINEMATICS_SOLVER_CONTRACT_VERSION_V1,
    describeCapabilities: () => CAPABILITIES_V1,
    validateDefinition: validationReport,
    normalizeCoordinates: (definition, coordinates) => normalizeCoordinates(compiledFor(definition, compiledByDefinition), coordinates),
    evaluateForward: (request): ForwardKinematicsResultV1 => {
      const compiled = compiledFor(request.mechanismDefinition, compiledByDefinition)
      const coordinates = normalizeCoordinates(compiled, request.coordinatesByStableId)
      const rootWorldPose = frozenPose(request.rootWorldPose, '$.rootWorldPose')
      const jointsById = new Map(compiled.definition.joints.map((joint) => [joint.jointId, joint] as const))
      const bodyLocalById = new Map<string, RigidTransformV1>([[compiled.rootBodyId, frozenPose(IDENTITY_POSE_V1, '$.identity')]])
      const bodyWorldById = new Map<string, RigidTransformV1>([[compiled.rootBodyId, rootWorldPose]])

      for (const traversal of compiled.traversal) {
        const joint = jointsById.get(traversal.jointId)!
        const childLocal = frozenPose(composeRigidTransformV5(joint.origin, jointMotion(joint, coordinates[joint.jointId])), '$.childLocal')
        const childWorld = frozenPose(composeRigidTransformV5(bodyWorldById.get(traversal.parentBodyId)!, childLocal), '$.childWorld')
        bodyLocalById.set(traversal.childBodyId, childLocal)
        bodyWorldById.set(traversal.childBodyId, childWorld)
      }

      const framesById = new Map(compiled.definition.frames.map((frame) => [frame.frameId, frame] as const))
      const frameWorldById = new Map<string, RigidTransformV1>()
      const resolveFrame = (frameId: string): RigidTransformV1 => {
        const cached = frameWorldById.get(frameId)
        if (cached !== undefined) return cached
        const frame = framesById.get(frameId)!
        const parentWorld = frame.parent.type === 'body'
          ? bodyWorldById.get(frame.parent.bodyId)!
          : resolveFrame(frame.parent.frameId)
        const resolved = frozenPose(composeRigidTransformV5(parentWorld, frame.localPose), '$.frameWorldPose')
        frameWorldById.set(frameId, resolved)
        return resolved
      }
      for (const frame of compiled.definition.frames) resolveFrame(frame.frameId)

      const requestedFrameIds = requestFrameIds(request.requestedFrameIds)
      if (requestedFrameIds !== undefined) {
        for (const [index, frameId] of requestedFrameIds.entries()) {
          if (!framesById.has(frameId)) failMechanismV1('FRAME_NOT_FOUND', `$.requestedFrameIds[${index}]`, 'Requested Frame does not exist.')
        }
      }
      const selectedFrameIds = [...new Set(requestedFrameIds ?? compiled.definition.frames.map(({ frameId }) => frameId))]
        .sort(compareStableIds)
      const frameWorldPoses = frozenNullPrototypeRecordV1(selectedFrameIds.map((frameId) => [frameId, resolveFrame(frameId)] as const))

      const groupsById = new Map(compiled.definition.motionGroups.map((group) => [group.motionGroupId, group] as const))
      if (request.requestedMotionGroupId !== undefined && !groupsById.has(request.requestedMotionGroupId)) {
        failMechanismV1('MOTION_GROUP_NOT_FOUND', '$.requestedMotionGroupId', 'Requested Motion Group does not exist.')
      }
      const selectedGroups = request.requestedMotionGroupId === undefined
        ? compiled.definition.motionGroups
        : [groupsById.get(request.requestedMotionGroupId)!]
      const motionGroupEndFramePoses = frozenNullPrototypeRecordV1(selectedGroups
        .slice()
        .sort((left, right) => compareStableIds(left.motionGroupId, right.motionGroupId))
        .map((group) => [
          group.motionGroupId,
          frozenNullPrototypeRecordV1(group.endFrameIds
            .slice()
            .sort(compareStableIds)
            .map((frameId) => [frameId, resolveFrame(frameId)] as const)),
        ] as const))

      const bodyEntries = compiled.definition.bodies.map(({ bodyId }) => bodyId).sort(compareStableIds)
      return Object.freeze({
        solverKey: TREE_KINEMATICS_SOLVER_KEY_V1,
        solverContractVersion: TREE_KINEMATICS_SOLVER_CONTRACT_VERSION_V1,
        normalizedCoordinates: coordinates,
        bodyLocalPoses: frozenNullPrototypeRecordV1(bodyEntries.map((bodyId) => [bodyId, bodyLocalById.get(bodyId)!] as const)),
        bodyWorldPoses: frozenNullPrototypeRecordV1(bodyEntries.map((bodyId) => [bodyId, bodyWorldById.get(bodyId)!] as const)),
        frameWorldPoses,
        motionGroupEndFramePoses,
        warnings: Object.freeze([]),
      })
    },
  }
  return Object.freeze(solver)
}
