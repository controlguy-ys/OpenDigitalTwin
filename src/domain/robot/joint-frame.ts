import {
  CRB15000_DEFINITION,
  type RobotJointDefinition,
} from './crb15000'

export type JointAnglesDeg = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
]

export type JointQuality = 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE'

export interface JointFrame {
  anglesDeg: JointAnglesDeg
  timestampMs: number
  quality: JointQuality
}

export interface JointAngleSource {
  readonly mode: 'simulation' | 'opcua'
  connect(): Promise<void>
  disconnect(): Promise<void>
  subscribe(listener: (frame: JointFrame) => void): () => void
}

export interface RobotFrameState {
  anglesDeg: JointAnglesDeg
  sourceQuality: JointQuality
  lastFrameTimestampMs: number | null
  playing: boolean
}

export interface RobotLimitDefinition {
  readonly joints: readonly Pick<RobotJointDefinition, 'minDeg' | 'maxDeg'>[]
}

export const ZERO_JOINT_ANGLES: JointAnglesDeg = [0, 0, 0, 0, 0, 0]

export const initialRobotState: RobotFrameState = {
  anglesDeg: ZERO_JOINT_ANGLES,
  sourceQuality: 'GOOD',
  lastFrameTimestampMs: null,
  playing: false,
}

const JOINT_COUNT = 6
const MAX_FRAME_AGE_MS = 1000
const JOINT_QUALITIES: readonly JointQuality[] = [
  'GOOD',
  'UNCERTAIN',
  'BAD',
  'STALE',
]

function assertJointAngles(
  anglesDeg: JointAnglesDeg,
): asserts anglesDeg is JointAnglesDeg {
  if (!Array.isArray(anglesDeg) || anglesDeg.length !== JOINT_COUNT) {
    throw new Error('Joint frame must contain exactly six angles')
  }

  if (anglesDeg.some((angleDeg) => !Number.isFinite(angleDeg))) {
    throw new Error('Joint angles must be finite numbers')
  }
}

export function validateJointFrame(frame: JointFrame): JointFrame {
  if (frame === null || typeof frame !== 'object') {
    throw new Error('Joint frame must be an object')
  }

  assertJointAngles(frame.anglesDeg)

  if (!Number.isFinite(frame.timestampMs)) {
    throw new Error('Joint frame timestamp must be finite')
  }

  if (!JOINT_QUALITIES.includes(frame.quality)) {
    throw new Error(`Unsupported joint frame quality: ${String(frame.quality)}`)
  }

  return frame
}

export function clampJointAngles(
  anglesDeg: JointAnglesDeg,
  definition: RobotLimitDefinition = CRB15000_DEFINITION,
): JointAnglesDeg {
  assertJointAngles(anglesDeg)

  if (definition.joints.length !== JOINT_COUNT) {
    throw new Error('Robot definition must contain exactly six joints')
  }

  return [
    Math.min(Math.max(anglesDeg[0], definition.joints[0]!.minDeg), definition.joints[0]!.maxDeg),
    Math.min(Math.max(anglesDeg[1], definition.joints[1]!.minDeg), definition.joints[1]!.maxDeg),
    Math.min(Math.max(anglesDeg[2], definition.joints[2]!.minDeg), definition.joints[2]!.maxDeg),
    Math.min(Math.max(anglesDeg[3], definition.joints[3]!.minDeg), definition.joints[3]!.maxDeg),
    Math.min(Math.max(anglesDeg[4], definition.joints[4]!.minDeg), definition.joints[4]!.maxDeg),
    Math.min(Math.max(anglesDeg[5], definition.joints[5]!.minDeg), definition.joints[5]!.maxDeg),
  ]
}

export function reduceJointFrame<TState extends RobotFrameState>(
  state: TState,
  frame: JointFrame,
  nowMs: number,
  definition: RobotLimitDefinition = CRB15000_DEFINITION,
): TState {
  validateJointFrame(frame)
  if (!Number.isFinite(nowMs)) {
    throw new Error('Current timestamp must be finite')
  }

  const sourceQuality: JointQuality =
    nowMs - frame.timestampMs > MAX_FRAME_AGE_MS ? 'STALE' : frame.quality

  if (sourceQuality === 'BAD' || sourceQuality === 'STALE') {
    return {
      ...state,
      sourceQuality,
      lastFrameTimestampMs: frame.timestampMs,
      playing: false,
    }
  }

  return {
    ...state,
    anglesDeg: clampJointAngles(frame.anglesDeg, definition),
    sourceQuality,
    lastFrameTimestampMs: frame.timestampMs,
  }
}
