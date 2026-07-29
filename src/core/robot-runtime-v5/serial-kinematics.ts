import { failProjectV5 } from '../project-v5/errors.js'
import {
  normalizeRigidTransformV5,
  type QuaternionV5,
  type RigidTransformV5,
  type Vector3V5,
} from '../project-v5/rigid-transform.js'
import type {
  RobotDefinitionV5,
  RobotJointDefinitionV5,
} from '../project-v5/types.js'
import {
  createDefaultApplicationKinematicsServiceV1,
  type ApplicationKinematicsServiceV1,
} from '../mechanism-runtime-v1/application-kinematics-service.js'
import {
  canonicalCoordinatesFromRobotV5,
  projectRobotDefinitionV5ToMechanismV1,
  rethrowSerialRobotCompatibilityErrorV5,
  serialRobotPoseFromMechanismV1,
  validateSerialRobotCompatibilityInputV5,
} from './robot-mechanism-adapter.js'

export interface SerialRobotPoseV5 {
  readonly jointValues: Readonly<Record<string, number>>
  readonly linkLocalPoses: Readonly<Record<string, RigidTransformV5>>
  readonly linkWorldPoses: Readonly<Record<string, RigidTransformV5>>
  readonly frameWorldPoses: Readonly<Record<string, RigidTransformV5>>
}

export interface SerialRobotKinematicsV5 {
  evaluate(
    definition: RobotDefinitionV5,
    jointValues: Readonly<Record<string, number>>,
    worldBasePose?: RigidTransformV5,
  ): SerialRobotPoseV5
}

function invalid(code: string, path: string, message: string): never {
  failProjectV5(code, path, message, 'Correct the Robot Definition or Joint values and try again.')
}

function canonical(value: number): number { return value === 0 ? 0 : value }
function identity(): RigidTransformV5 { return { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] } }

function detachedPose(value: RigidTransformV5): RigidTransformV5 {
  return {
    positionM: [value.positionM[0], value.positionM[1], value.positionM[2]],
    quaternion: [value.quaternion[0], value.quaternion[1], value.quaternion[2], value.quaternion[3]],
  }
}

/**
 * Serial FK never consumed home, maximum velocity, or geometry occurrence
 * transforms. Normalize only those projection-only fields in a detached copy
 * so the stricter general adapter cannot change this compatibility API.
 */
function serialProjectionDefinitionV5(definition: RobotDefinitionV5): RobotDefinitionV5 {
  return {
    ...definition,
    links: definition.links.map((link) => ({ ...link, geometryOccurrences: [] })),
    joints: definition.joints.map((joint) => ({
      ...joint,
      origin: detachedPose(joint.origin),
      axis: [joint.axis[0], joint.axis[1], joint.axis[2]],
      home: joint.min,
      maximumVelocity: 0,
    })),
    frames: definition.frames.map((frame) => ({ ...frame, localPose: detachedPose(frame.localPose) })),
  }
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

export function createSerialRobotKinematicsV5(
  applicationService: ApplicationKinematicsServiceV1 = createDefaultApplicationKinematicsServiceV1(),
): SerialRobotKinematicsV5 {
  return Object.freeze({
    evaluate(
      definition: RobotDefinitionV5,
      jointValues: Readonly<Record<string, number>>,
      worldBasePose: RigidTransformV5 = identity(),
    ): SerialRobotPoseV5 {
      try {
        validateSerialRobotCompatibilityInputV5(definition, jointValues, worldBasePose)
        const projected = projectRobotDefinitionV5ToMechanismV1(serialProjectionDefinitionV5(definition))
        const compiled = applicationService.compile(projected.mechanismDefinition)
        const result = compiled.evaluateForward({
          rootWorldPose: worldBasePose,
          coordinatesByStableId: canonicalCoordinatesFromRobotV5(definition, jointValues),
        })
        return serialRobotPoseFromMechanismV1(definition, jointValues, result)
      } catch (error) {
        return rethrowSerialRobotCompatibilityErrorV5(error)
      }
    },
  })
}

const defaultSerialRobotKinematicsV5 = createSerialRobotKinematicsV5()

export function computeSerialRobotPoseV5(
  definition: RobotDefinitionV5,
  jointValues: Readonly<Record<string, number>>,
  worldBasePose: RigidTransformV5 = identity(),
): SerialRobotPoseV5 {
  return defaultSerialRobotKinematicsV5.evaluate(definition, jointValues, worldBasePose)
}
