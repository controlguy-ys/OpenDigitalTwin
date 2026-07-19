export const MAX_RUNTIME_POSE_SAMPLES_V1 = 32

export type RuntimeVector3V1 = readonly [number, number, number]
export type RuntimeQuaternionV1 = readonly [number, number, number, number]

export interface RuntimeRigidTransformV1 {
  readonly positionM: RuntimeVector3V1
  readonly quaternion: RuntimeQuaternionV1
}

export type RuntimePoseQualityV1 = 'GOOD' | 'STALE'

export interface RuntimePoseSampleV1 {
  readonly sequence: number
  readonly sourceTimestampMs: number
  readonly receivedTimestampMs: number
  readonly pose: RuntimeRigidTransformV1
}

export interface RuntimePoseResultV1 {
  readonly targetId: string
  readonly sourceTimestampMs: number
  readonly pose: RuntimeRigidTransformV1
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
  return value === 0 ? 0 : value
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

function normalizeRuntimeQuaternionV1(quaternion: RuntimeQuaternionV1): RuntimeQuaternionV1 {
  quaternion.forEach((component, index) => requireFinite(component, `Quaternion component ${index}`))
  const magnitude = Math.hypot(...quaternion)
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new TypeError('Quaternion must be finite and non-zero.')
  }
  let normalized: RuntimeQuaternionV1 = [
    quaternion[0] / magnitude,
    quaternion[1] / magnitude,
    quaternion[2] / magnitude,
    quaternion[3] / magnitude,
  ]
  if (
    normalized[3] < 0
    || (normalized[3] === 0 && (
      normalized[2] < 0
      || (normalized[2] === 0 && (
        normalized[1] < 0 || (normalized[1] === 0 && normalized[0] < 0)
      ))
    ))
  ) {
    normalized = [-normalized[0], -normalized[1], -normalized[2], -normalized[3]]
  }
  return [
    normalized[0] === 0 ? 0 : normalized[0],
    normalized[1] === 0 ? 0 : normalized[1],
    normalized[2] === 0 ? 0 : normalized[2],
    normalized[3] === 0 ? 0 : normalized[3],
  ]
}

function normalizeRuntimeRigidTransformV1(value: RuntimeRigidTransformV1): RuntimeRigidTransformV1 {
  return {
    positionM: [
      requireFinite(value.positionM[0], 'Position component 0'),
      requireFinite(value.positionM[1], 'Position component 1'),
      requireFinite(value.positionM[2], 'Position component 2'),
    ],
    quaternion: normalizeRuntimeQuaternionV1(value.quaternion),
  }
}

function frozenPose(value: RuntimeRigidTransformV1): RuntimeRigidTransformV1 {
  const normalized = normalizeRuntimeRigidTransformV1(value)
  return Object.freeze({
    positionM: Object.freeze([...normalized.positionM]) as RuntimeVector3V1,
    quaternion: Object.freeze([...normalized.quaternion]) as RuntimeQuaternionV1,
  })
}

function clampUnitInterval(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function dotQuaternion(a: RuntimeQuaternionV1, b: RuntimeQuaternionV1): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
}

function slerpRuntimeQuaternionV1(
  from: RuntimeQuaternionV1,
  to: RuntimeQuaternionV1,
  fraction: number,
): RuntimeQuaternionV1 {
  const start = normalizeRuntimeQuaternionV1(from)
  let end = normalizeRuntimeQuaternionV1(to)
  let dot = dotQuaternion(start, end)
  if (dot < 0) {
    end = [-end[0], -end[1], -end[2], -end[3]]
    dot = -dot
  }
  dot = Math.min(1, Math.max(-1, dot))

  if (dot > 0.9995) {
    return normalizeRuntimeQuaternionV1([
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
  return normalizeRuntimeQuaternionV1([
    startWeight * start[0] + endWeight * end[0],
    startWeight * start[1] + endWeight * end[1],
    startWeight * start[2] + endWeight * end[2],
    startWeight * start[3] + endWeight * end[3],
  ])
}

export function rpyDegreesToRuntimeQuaternionV1(rpyDeg: RuntimeVector3V1): RuntimeQuaternionV1 {
  const rollDeg = requireFinite(rpyDeg[0], 'RPY component 0')
  const pitchDeg = requireFinite(rpyDeg[1], 'RPY component 1')
  const yawDeg = requireFinite(rpyDeg[2], 'RPY component 2')
  const halfRoll = rollDeg * Math.PI / 360
  const halfPitch = pitchDeg * Math.PI / 360
  const halfYaw = yawDeg * Math.PI / 360
  const sinRoll = Math.sin(halfRoll)
  const cosRoll = Math.cos(halfRoll)
  const sinPitch = Math.sin(halfPitch)
  const cosPitch = Math.cos(halfPitch)
  const sinYaw = Math.sin(halfYaw)
  const cosYaw = Math.cos(halfYaw)
  return normalizeRuntimeQuaternionV1([
    sinRoll * cosPitch * cosYaw - cosRoll * sinPitch * sinYaw,
    cosRoll * sinPitch * cosYaw + sinRoll * cosPitch * sinYaw,
    cosRoll * cosPitch * sinYaw - sinRoll * sinPitch * cosYaw,
    cosRoll * cosPitch * cosYaw + sinRoll * sinPitch * sinYaw,
  ])
}

export function interpolateRuntimeRigidTransformV1(
  from: RuntimeRigidTransformV1,
  to: RuntimeRigidTransformV1,
  fraction: number,
): RuntimeRigidTransformV1 {
  const progress = clampUnitInterval(requireFinite(fraction, 'Interpolation fraction'))
  const start = frozenPose(from)
  const end = frozenPose(to)
  return frozenPose({
    positionM: [
      start.positionM[0] + (end.positionM[0] - start.positionM[0]) * progress,
      start.positionM[1] + (end.positionM[1] - start.positionM[1]) * progress,
      start.positionM[2] + (end.positionM[2] - start.positionM[2]) * progress,
    ],
    quaternion: slerpRuntimeQuaternionV1(start.quaternion, end.quaternion, progress),
  })
}

class BoundedRuntimePoseBufferV1 implements RuntimePoseBufferV1 {
  readonly targetId: string
  readonly #publishingIntervalMs: number
  readonly #samples: RuntimePoseSampleV1[] = []
  #lastEmittedTargetTimestampMs: number | null = null

  constructor(targetId: string, publishingIntervalMs: number) {
    if (targetId.trim().length === 0) throw new TypeError('Target ID must not be empty.')
    this.targetId = targetId
    this.#publishingIntervalMs = requirePositiveSafeInteger(publishingIntervalMs, 'Publishing interval')
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
      pose: frozenPose(sample.pose),
    })
    const latest = this.#samples.at(-1)
    if (
      latest !== undefined
      && (sample.sequence <= latest.sequence || sample.sourceTimestampMs < latest.sourceTimestampMs)
    ) return false

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
      this.#lastEmittedTargetTimestampMs = latest.sourceTimestampMs
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
      this.#lastEmittedTargetTimestampMs ?? first.sourceTimestampMs,
      Math.min(
        latest.sourceTimestampMs,
        latest.sourceTimestampMs + (nowMs - latest.receivedTimestampMs) - 2 * this.#publishingIntervalMs,
      ),
    )
    const pose = this.#poseAt(targetTimestampMs)
    this.#lastEmittedTargetTimestampMs = targetTimestampMs
    return Object.freeze({ targetId: this.targetId, sourceTimestampMs: targetTimestampMs, pose, quality: 'GOOD' })
  }

  #poseAt(targetTimestampMs: number): RuntimeRigidTransformV1 {
    const first = this.#samples[0]!
    if (targetTimestampMs <= first.sourceTimestampMs) return first.pose

    for (let index = 1; index < this.#samples.length; index += 1) {
      const next = this.#samples[index]!
      if (targetTimestampMs > next.sourceTimestampMs) continue
      const previous = this.#samples[index - 1]!
      const fraction = (targetTimestampMs - previous.sourceTimestampMs)
        / (next.sourceTimestampMs - previous.sourceTimestampMs)
      return frozenPose(interpolateRuntimeRigidTransformV1(previous.pose, next.pose, fraction))
    }
    return this.#samples.at(-1)!.pose
  }
}

export function createRuntimePoseBufferV1(targetId: string, publishingIntervalMs: number): RuntimePoseBufferV1 {
  return new BoundedRuntimePoseBufferV1(targetId, publishingIntervalMs)
}
