import type { JointAnglesDeg } from '../../domain/robot/joint-frame'
import type {
  RobotKeyframe,
  RobotKeyframeEasing,
} from '../joints/keyframes'

export type CollisionValidationMode = 'preview' | 'validate'

export interface JointSequenceSample {
  readonly sampleIndex: number
  readonly timeMs: number
  readonly anglesDeg: JointAnglesDeg
}

export interface JointSequenceSamples {
  readonly samples: readonly JointSequenceSample[]
  readonly totalDurationMs: number
  readonly truncated: boolean
}

export const MAX_COLLISION_VALIDATION_SAMPLES = 20_000

const MAX_JOINT_STEP_DEG = Object.freeze({
  preview: 2,
  validate: 0.5,
}) satisfies Record<CollisionValidationMode, number>

function copyAngles(anglesDeg: readonly number[]): JointAnglesDeg {
  if (
    anglesDeg.length !== 6 ||
    anglesDeg.some((angleDeg) => !Number.isFinite(angleDeg))
  ) {
    throw new Error('Collision validation Pose must contain six finite Joint angles.')
  }
  return [
    anglesDeg[0]!,
    anglesDeg[1]!,
    anglesDeg[2]!,
    anglesDeg[3]!,
    anglesDeg[4]!,
    anglesDeg[5]!,
  ]
}

function validateSequence(sequence: readonly RobotKeyframe[]): void {
  const ids = new Set<string>()
  for (const pose of sequence) {
    if (pose.id.trim().length === 0 || ids.has(pose.id)) {
      throw new Error('Collision validation Pose ids must be non-empty and unique.')
    }
    ids.add(pose.id)
    copyAngles(pose.anglesDeg)
    if (!Number.isFinite(pose.durationMs) || pose.durationMs <= 0) {
      throw new Error('Collision validation segment duration must be finite and positive.')
    }
    if (pose.easing !== 'linear' && pose.easing !== 'easeInOut') {
      throw new Error(`Unsupported collision validation easing: ${String(pose.easing)}`)
    }
  }
}

function ease(easing: RobotKeyframeEasing, progress: number): number {
  return easing === 'linear'
    ? progress
    : progress * progress * (3 - 2 * progress)
}

function maximumEasingIncrement(
  easing: RobotKeyframeEasing,
  stepCount: number,
): number {
  if (easing === 'linear') return 1 / stepCount
  const centerInterval = Math.floor((stepCount - 1) / 2)
  return (
    ease(easing, (centerInterval + 1) / stepCount) -
    ease(easing, centerInterval / stepCount)
  )
}

function segmentStepCount(
  maximumDeltaDeg: number,
  easing: RobotKeyframeEasing,
  maximumStepDeg: number,
): number {
  if (maximumDeltaDeg === 0) return 1
  const minimum = Math.max(1, Math.ceil(maximumDeltaDeg / maximumStepDeg))
  if (easing === 'linear') return minimum

  let low = minimum
  let high = Math.max(
    minimum,
    Math.ceil((maximumDeltaDeg * 1.5) / maximumStepDeg),
  )
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (
      maximumEasingIncrement(easing, middle) * maximumDeltaDeg <=
      maximumStepDeg + Number.EPSILON
    ) {
      high = middle
    } else {
      low = middle + 1
    }
  }
  return low
}

function maximumJointDelta(
  from: JointAnglesDeg,
  to: JointAnglesDeg,
): number {
  let maximum = 0
  for (let index = 0; index < 6; index += 1) {
    maximum = Math.max(maximum, Math.abs(to[index]! - from[index]!))
  }
  return maximum
}

function interpolate(
  from: JointAnglesDeg,
  to: JointAnglesDeg,
  progress: number,
): JointAnglesDeg {
  return [
    from[0] + (to[0] - from[0]) * progress,
    from[1] + (to[1] - from[1]) * progress,
    from[2] + (to[2] - from[2]) * progress,
    from[3] + (to[3] - from[3]) * progress,
    from[4] + (to[4] - from[4]) * progress,
    from[5] + (to[5] - from[5]) * progress,
  ]
}

export function sampleJointSequence(
  sequence: readonly RobotKeyframe[],
  mode: CollisionValidationMode,
): JointSequenceSamples {
  if (mode !== 'preview' && mode !== 'validate') {
    throw new Error(`Unsupported collision validation mode: ${String(mode)}`)
  }
  validateSequence(sequence)
  if (sequence.length === 0) {
    return Object.freeze({ samples: Object.freeze([]), totalDurationMs: 0, truncated: false })
  }

  const totalDurationMs = sequence
    .slice(0, -1)
    .reduce((sum, pose) => sum + pose.durationMs, 0)
  if (!Number.isFinite(totalDurationMs)) {
    throw new Error('Collision validation sequence duration must be finite.')
  }

  const samples: JointSequenceSample[] = [
    Object.freeze({
      sampleIndex: 0,
      timeMs: 0,
      anglesDeg: Object.freeze(copyAngles(sequence[0]!.anglesDeg)),
    }),
  ]
  let segmentStartMs = 0

  for (let segmentIndex = 0; segmentIndex < sequence.length - 1; segmentIndex += 1) {
    const fromPose = sequence[segmentIndex]!
    const toPose = sequence[segmentIndex + 1]!
    const fromAngles = copyAngles(fromPose.anglesDeg)
    const toAngles = copyAngles(toPose.anglesDeg)
    const stepCount = segmentStepCount(
      maximumJointDelta(fromAngles, toAngles),
      fromPose.easing,
      MAX_JOINT_STEP_DEG[mode],
    )

    for (let step = 1; step <= stepCount; step += 1) {
      if (samples.length === MAX_COLLISION_VALIDATION_SAMPLES) {
        return Object.freeze({
          samples: Object.freeze(samples),
          totalDurationMs,
          truncated: true,
        })
      }
      const linearProgress = step / stepCount
      samples.push(
        Object.freeze({
          sampleIndex: samples.length,
          timeMs: segmentStartMs + fromPose.durationMs * linearProgress,
          anglesDeg: Object.freeze(
            interpolate(
              fromAngles,
              toAngles,
              ease(fromPose.easing, linearProgress),
            ),
          ),
        }),
      )
    }
    segmentStartMs += fromPose.durationMs
  }

  return Object.freeze({
    samples: Object.freeze(samples),
    totalDurationMs,
    truncated: false,
  })
}
