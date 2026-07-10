import type { JointAnglesDeg } from '../../domain/robot/joint-frame'

export type RobotKeyframeEasing = 'linear' | 'easeInOut'

export interface RobotKeyframe {
  id: string
  name: string
  anglesDeg: JointAnglesDeg
  durationMs: number
  easing: RobotKeyframeEasing
}

export interface RobotTimelineSample {
  anglesDeg: JointAnglesDeg
}

const JOINT_COUNT = 6

function validateKeyframe(keyframe: RobotKeyframe): void {
  if (
    !Array.isArray(keyframe.anglesDeg) ||
    keyframe.anglesDeg.length !== JOINT_COUNT
  ) {
    throw new Error('Robot keyframe must contain exactly six angles')
  }

  if (keyframe.anglesDeg.some((angleDeg) => !Number.isFinite(angleDeg))) {
    throw new Error('Robot keyframe angles must be finite numbers')
  }

  if (!Number.isFinite(keyframe.durationMs) || keyframe.durationMs <= 0) {
    throw new Error('Robot keyframe duration must be finite positive')
  }

  if (keyframe.easing !== 'linear' && keyframe.easing !== 'easeInOut') {
    throw new Error(`Unsupported robot keyframe easing: ${String(keyframe.easing)}`)
  }
}

function copyAngles(anglesDeg: JointAnglesDeg): JointAnglesDeg {
  return [
    anglesDeg[0],
    anglesDeg[1],
    anglesDeg[2],
    anglesDeg[3],
    anglesDeg[4],
    anglesDeg[5],
  ]
}

function applyEasing(easing: RobotKeyframeEasing, progress: number): number {
  if (easing === 'linear') {
    return progress
  }

  return progress * progress * (3 - 2 * progress)
}

export function getTimelineDurationMs(
  keyframes: readonly RobotKeyframe[],
): number {
  for (const keyframe of keyframes) {
    validateKeyframe(keyframe)
  }

  return keyframes
    .slice(0, -1)
    .reduce((durationMs, keyframe) => durationMs + keyframe.durationMs, 0)
}

export function sampleTimeline(
  keyframes: readonly RobotKeyframe[],
  elapsedMs: number,
): RobotTimelineSample | null {
  if (!Number.isFinite(elapsedMs)) {
    throw new Error('Robot timeline elapsed time must be finite')
  }

  const durationMs = getTimelineDurationMs(keyframes)
  const first = keyframes[0]
  if (first === undefined) {
    return null
  }

  if (keyframes.length === 1 || elapsedMs <= 0) {
    return { anglesDeg: copyAngles(first.anglesDeg) }
  }

  const last = keyframes.at(-1)
  if (last === undefined) {
    return null
  }

  if (elapsedMs >= durationMs) {
    return { anglesDeg: copyAngles(last.anglesDeg) }
  }

  let segmentStartMs = 0
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const from = keyframes[index]
    const to = keyframes[index + 1]
    if (from === undefined || to === undefined) {
      throw new Error('Robot timeline segment is incomplete')
    }

    const segmentEndMs = segmentStartMs + from.durationMs
    if (elapsedMs <= segmentEndMs) {
      const progress = (elapsedMs - segmentStartMs) / from.durationMs
      const easedProgress = applyEasing(from.easing, progress)
      return {
        anglesDeg: [
          from.anglesDeg[0] +
            (to.anglesDeg[0] - from.anglesDeg[0]) * easedProgress,
          from.anglesDeg[1] +
            (to.anglesDeg[1] - from.anglesDeg[1]) * easedProgress,
          from.anglesDeg[2] +
            (to.anglesDeg[2] - from.anglesDeg[2]) * easedProgress,
          from.anglesDeg[3] +
            (to.anglesDeg[3] - from.anglesDeg[3]) * easedProgress,
          from.anglesDeg[4] +
            (to.anglesDeg[4] - from.anglesDeg[4]) * easedProgress,
          from.anglesDeg[5] +
            (to.anglesDeg[5] - from.anglesDeg[5]) * easedProgress,
        ],
      }
    }

    segmentStartMs = segmentEndMs
  }

  return { anglesDeg: copyAngles(last.anglesDeg) }
}
