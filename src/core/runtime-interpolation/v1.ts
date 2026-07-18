import {
  normalizeRigidTransformV4,
  rpyDegreesToQuaternionV4,
  type QuaternionV4,
  type RigidTransformV4,
  type Vector3V4,
} from '../project-v4/rigid-transform.js'

export const MAX_RUNTIME_POSE_SAMPLES_V1 = 32

export type RuntimePoseQualityV1 = 'GOOD' | 'STALE'

export interface RuntimePoseSampleV1 {
  readonly sequence: number
  readonly sourceTimestampMs: number
  readonly receivedTimestampMs: number
  readonly pose: RigidTransformV4
}

export interface RuntimePoseResultV1 {
  readonly targetId: string
  readonly sourceTimestampMs: number
  readonly pose: RigidTransformV4
  readonly quality: RuntimePoseQualityV1
}

export interface RuntimePoseBufferV1 {
  readonly targetId: string
  readonly size: number
  push(sample: RuntimePoseSampleV1): boolean
  sample(nowMs: number): RuntimePoseResultV1 | null
}

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`)
  return value
}

function requirePositiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`)
  }
  return value
}

function requireNonNegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`)
  }
  return value
}

function frozenPose(value: RigidTransformV4, path: string): RigidTransformV4 {
  value.positionM.forEach((component, index) => {
    requireFinite(component, `Position component ${index}`)
  })
  value.quaternion.forEach((component, index) => {
    requireFinite(component, `Quaternion component ${index}`)
  })
  const normalized = normalizeRigidTransformV4(value, path)
  return Object.freeze({
    positionM: Object.freeze([...normalized.positionM]) as Vector3V4,
    quaternion: Object.freeze([...normalized.quaternion]) as QuaternionV4,
  })
}

function clampUnitInterval(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function dotQuaternion(a: QuaternionV4, b: QuaternionV4): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
}

function normalizeQuaternion(quaternion: QuaternionV4): QuaternionV4 {
  return normalizeRigidTransformV4({ positionM: [0, 0, 0], quaternion }, '$.quaternion').quaternion
}

function slerpQuaternionV4(
  from: QuaternionV4,
  to: QuaternionV4,
  fraction: number,
): QuaternionV4 {
  const start = normalizeQuaternion(from)
  let end = normalizeQuaternion(to)
  let dot = dotQuaternion(start, end)
  if (dot < 0) {
    end = [-end[0], -end[1], -end[2], -end[3]]
    dot = -dot
  }
  dot = Math.min(1, Math.max(-1, dot))

  if (dot > 0.9995) {
    return normalizeQuaternion([
      start[0] + fraction * (end[0] - start[0]),
      start[1] + fraction * (end[1] - start[1]),
      start[2] + fraction * (end[2] - start[2]),
      start[3] + fraction * (end[3] - start[3]),
    ])
  }

  const angle = Math.acos(dot)
  const sinAngle = Math.sin(angle)
  const startWeight = Math.sin((1 - fraction) * angle) / sinAngle
  const endWeight = Math.sin(fraction * angle) / sinAngle
  return normalizeQuaternion([
    startWeight * start[0] + endWeight * end[0],
    startWeight * start[1] + endWeight * end[1],
    startWeight * start[2] + endWeight * end[2],
    startWeight * start[3] + endWeight * end[3],
  ])
}

export function rpyDegreesToRuntimeQuaternionV1(rpyDeg: Vector3V4): QuaternionV4 {
  return rpyDegreesToQuaternionV4(rpyDeg)
}

export function interpolateRigidTransformV4(
  from: RigidTransformV4,
  to: RigidTransformV4,
  fraction: number,
): RigidTransformV4 {
  const progress = clampUnitInterval(requireFinite(fraction, 'Interpolation fraction'))
  const start = normalizeRigidTransformV4(from, '$.from')
  const end = normalizeRigidTransformV4(to, '$.to')
  return {
    positionM: [
      start.positionM[0] + (end.positionM[0] - start.positionM[0]) * progress,
      start.positionM[1] + (end.positionM[1] - start.positionM[1]) * progress,
      start.positionM[2] + (end.positionM[2] - start.positionM[2]) * progress,
    ],
    quaternion: slerpQuaternionV4(start.quaternion, end.quaternion, progress),
  }
}

class BoundedRuntimePoseBufferV1 implements RuntimePoseBufferV1 {
  readonly targetId: string
  readonly #publishingIntervalMs: number
  readonly #samples: RuntimePoseSampleV1[] = []

  constructor(targetId: string, publishingIntervalMs: number) {
    if (targetId.trim().length === 0) throw new TypeError('Target ID must not be empty.')
    this.targetId = targetId
    this.#publishingIntervalMs = requirePositiveSafeInteger(
      publishingIntervalMs,
      'Publishing interval',
    )
  }

  get size(): number {
    return this.#samples.length
  }

  push(sample: RuntimePoseSampleV1): boolean {
    requirePositiveSafeInteger(sample.sequence, 'Sample sequence')
    requireNonNegativeSafeInteger(sample.sourceTimestampMs, 'Source timestamp')
    requireNonNegativeSafeInteger(sample.receivedTimestampMs, 'Receipt timestamp')
    const storedSample: RuntimePoseSampleV1 = Object.freeze({
      sequence: sample.sequence,
      sourceTimestampMs: sample.sourceTimestampMs,
      receivedTimestampMs: sample.receivedTimestampMs,
      pose: frozenPose(sample.pose, '$.sample.pose'),
    })
    const latest = this.#samples.at(-1)
    if (
      latest !== undefined
      && (sample.sequence <= latest.sequence || sample.sourceTimestampMs < latest.sourceTimestampMs)
    ) {
      return false
    }

    if (latest !== undefined && sample.sourceTimestampMs === latest.sourceTimestampMs) {
      this.#samples[this.#samples.length - 1] = storedSample
      return true
    }

    this.#samples.push(storedSample)
    if (this.#samples.length > MAX_RUNTIME_POSE_SAMPLES_V1) this.#samples.shift()
    return true
  }

  sample(nowMs: number): RuntimePoseResultV1 | null {
    requireNonNegativeSafeInteger(nowMs, 'Current time')
    const latest = this.#samples.at(-1)
    if (latest === undefined) return null

    const staleAfterMs = Math.max(500, 5 * this.#publishingIntervalMs)
    if (nowMs - latest.receivedTimestampMs > staleAfterMs) {
      return Object.freeze({
        targetId: this.targetId,
        sourceTimestampMs: latest.sourceTimestampMs,
        pose: latest.pose,
        quality: 'STALE',
      })
    }

    const first = this.#samples[0]!
    const targetTimestampMs = Math.max(
      first.sourceTimestampMs,
      Math.min(
        latest.sourceTimestampMs,
        latest.sourceTimestampMs
          + (nowMs - latest.receivedTimestampMs)
          - 2 * this.#publishingIntervalMs,
      ),
    )
    const pose = this.#poseAt(targetTimestampMs)
    return Object.freeze({
      targetId: this.targetId,
      sourceTimestampMs: targetTimestampMs,
      pose,
      quality: 'GOOD',
    })
  }

  #poseAt(targetTimestampMs: number): RigidTransformV4 {
    const first = this.#samples[0]!
    if (targetTimestampMs <= first.sourceTimestampMs) return first.pose

    for (let index = 1; index < this.#samples.length; index += 1) {
      const next = this.#samples[index]!
      if (targetTimestampMs > next.sourceTimestampMs) continue
      const previous = this.#samples[index - 1]!
      const fraction = (targetTimestampMs - previous.sourceTimestampMs)
        / (next.sourceTimestampMs - previous.sourceTimestampMs)
      return frozenPose(
        interpolateRigidTransformV4(previous.pose, next.pose, fraction),
        '$.interpolatedPose',
      )
    }
    return this.#samples.at(-1)!.pose
  }
}

export function createRuntimePoseBufferV1(
  targetId: string,
  publishingIntervalMs: number,
): RuntimePoseBufferV1 {
  return new BoundedRuntimePoseBufferV1(targetId, publishingIntervalMs)
}
