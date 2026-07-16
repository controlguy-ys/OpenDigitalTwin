import { failProjectV4 } from '../project-v4/errors.js'
import {
  MAX_JOB_SPEED_PERCENT_V4,
  MIN_JOB_SPEED_PERCENT_V4,
} from '../project-v4/limits.js'
import type { RobotJointDefinitionV4 } from '../project-v4/types.js'

export interface JointTransitionSampleInputV4 {
  readonly from: Readonly<Record<string, number>>
  readonly to: Readonly<Record<string, number>>
  readonly elapsedMs: number
  readonly durationMs: number
  readonly joints: readonly RobotJointDefinitionV4[]
}

function timelineFailure(code: string, path: string, message: string): never {
  failProjectV4(code, path, message, 'Correct the Job timeline input and try again.')
}

function validateJointDefinitions(
  joints: readonly RobotJointDefinitionV4[],
): ReadonlyMap<string, RobotJointDefinitionV4> {
  if (!Array.isArray(joints)) {
    timelineFailure('JOINT_DEFINITIONS_INVALID', '$.joints', 'Joints must be an ordered array.')
  }

  const byId = new Map<string, RobotJointDefinitionV4>()
  joints.forEach((joint, index) => {
    const path = `$.joints[${index}]`
    if (joint === null || typeof joint !== 'object') {
      timelineFailure('JOINT_DEFINITIONS_INVALID', path, 'Joint Definition must be an object.')
    }
    if (typeof joint.id !== 'string' || joint.id.length === 0 || byId.has(joint.id)) {
      timelineFailure(
        'JOINT_DEFINITIONS_INVALID',
        `${path}.id`,
        'Joint IDs must be non-empty and unique.',
      )
    }
    if (joint.type !== 'revolute' && joint.type !== 'prismatic') {
      timelineFailure('JOINT_DEFINITIONS_INVALID', `${path}.type`, 'Joint type is invalid.')
    }
    if (
      !Number.isFinite(joint.min)
      || !Number.isFinite(joint.max)
      || joint.min > joint.max
      || !Number.isFinite(joint.maximumVelocity)
      || joint.maximumVelocity <= 0
    ) {
      timelineFailure(
        'JOINT_DEFINITIONS_INVALID',
        path,
        'Joint limits and maximum velocity must be finite and valid.',
      )
    }
    byId.set(joint.id, joint)
  })
  return byId
}

function inspectExactJointValues(
  value: Readonly<Record<string, number>>,
  joints: readonly RobotJointDefinitionV4[],
  path: string,
): Readonly<Record<string, number>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    timelineFailure('JOINT_VALUE_KEYS_INVALID', path, 'Joint values must be a plain record.')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    timelineFailure(
      'JOINT_VALUE_KEYS_INVALID',
      path,
      'Joint values must not use a custom prototype.',
    )
  }

  const expectedIds = new Set(joints.map((joint) => joint.id))
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== expectedIds.size) {
    timelineFailure(
      'JOINT_VALUE_KEYS_INVALID',
      path,
      'Joint values must contain exactly the Definition Joint IDs.',
    )
  }

  for (const key of ownKeys) {
    if (typeof key !== 'string' || !expectedIds.has(key)) {
      timelineFailure(
        'JOINT_VALUE_KEYS_INVALID',
        path,
        'Joint values must contain exactly the Definition Joint IDs.',
      )
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      timelineFailure(
        'JOINT_VALUE_KEYS_INVALID',
        `${path}.${key}`,
        'Joint values must be enumerable own data properties.',
      )
    }
  }

  const result = Object.create(null) as Record<string, number>
  joints.forEach((joint) => {
    const jointPath = `${path}.${joint.id}`
    if (!Object.hasOwn(value, joint.id)) {
      timelineFailure(
        'JOINT_VALUE_KEYS_INVALID',
        jointPath,
        'Joint value is missing.',
      )
    }
    const jointValue = value[joint.id]
    if (typeof jointValue !== 'number' || !Number.isFinite(jointValue)) {
      timelineFailure('JOINT_VALUE_NOT_FINITE', jointPath, 'Joint value must be finite.')
    }
    if (jointValue < joint.min || jointValue > joint.max) {
      timelineFailure(
        'JOINT_VALUE_OUT_OF_RANGE',
        jointPath,
        `Joint value must be within ${joint.min}..${joint.max}.`,
      )
    }
    result[joint.id] = jointValue
  })
  return result
}

function transitionDelta(
  joint: RobotJointDefinitionV4,
  from: number,
  to: number,
): number {
  const rawDelta = to - from
  if (joint.type === 'prismatic') return rawDelta

  const candidates = [rawDelta, rawDelta + 360, rawDelta - 360]
  let selected: number | undefined
  for (const candidate of candidates) {
    const candidateEnd = from + candidate
    if (from < joint.min || from > joint.max || candidateEnd < joint.min || candidateEnd > joint.max) {
      continue
    }
    if (selected === undefined || Math.abs(candidate) < Math.abs(selected)) {
      selected = candidate
    }
  }
  return selected ?? rawDelta
}

function inspectTransition(
  from: Readonly<Record<string, number>>,
  to: Readonly<Record<string, number>>,
  joints: readonly RobotJointDefinitionV4[],
): {
  readonly from: Readonly<Record<string, number>>
  readonly to: Readonly<Record<string, number>>
  readonly deltas: Readonly<Record<string, number>>
} {
  validateJointDefinitions(joints)
  const inspectedFrom = inspectExactJointValues(from, joints, '$.from')
  const inspectedTo = inspectExactJointValues(to, joints, '$.to')
  const deltas = Object.fromEntries(joints.map((joint) => [
    joint.id,
    transitionDelta(joint, inspectedFrom[joint.id]!, inspectedTo[joint.id]!),
  ]))
  return { from: inspectedFrom, to: inspectedTo, deltas }
}

function validateTime(value: number, path: string): void {
  if (!Number.isFinite(value) || value < 0) {
    timelineFailure(
      'JOB_TIMELINE_TIME_INVALID',
      path,
      'Timeline time must be finite and nonnegative.',
    )
  }
}

export function transitionDurationMsV4(
  from: Readonly<Record<string, number>>,
  to: Readonly<Record<string, number>>,
  speedPercent: number,
  joints: readonly RobotJointDefinitionV4[],
): number {
  if (
    !Number.isSafeInteger(speedPercent)
    || speedPercent < MIN_JOB_SPEED_PERCENT_V4
    || speedPercent > MAX_JOB_SPEED_PERCENT_V4
  ) {
    timelineFailure(
      'JOB_SPEED_INVALID',
      '$.speedPercent',
      `Job speed must be a safe integer within ${MIN_JOB_SPEED_PERCENT_V4}..${MAX_JOB_SPEED_PERCENT_V4}.`,
    )
  }

  const transition = inspectTransition(from, to, joints)
  const maximumJointTimeMs = joints.reduce((maximum, joint) => Math.max(
    maximum,
    Math.abs(transition.deltas[joint.id]!) / joint.maximumVelocity * 1_000,
  ), 0)
  return maximumJointTimeMs / (speedPercent / 100)
}

export function sampleJointTransitionV4(
  input: JointTransitionSampleInputV4,
): Readonly<Record<string, number>> {
  validateTime(input.elapsedMs, '$.elapsedMs')
  validateTime(input.durationMs, '$.durationMs')
  const transition = inspectTransition(input.from, input.to, input.joints)

  if (input.durationMs === 0 || input.elapsedMs >= input.durationMs) {
    return Object.freeze(Object.fromEntries(
      input.joints.map((joint) => [joint.id, transition.to[joint.id]!]),
    ))
  }

  const progress = Math.min(1, Math.max(0, input.elapsedMs / input.durationMs))
  return Object.freeze(Object.fromEntries(input.joints.map((joint) => [
    joint.id,
    transition.from[joint.id]! + transition.deltas[joint.id]! * progress,
  ])))
}
