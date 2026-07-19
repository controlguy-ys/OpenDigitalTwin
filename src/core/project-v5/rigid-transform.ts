import { failProjectV5 } from './errors.js'

export type Vector3V5 = readonly [number, number, number]
export type QuaternionV5 = readonly [number, number, number, number]
export type Matrix3V5 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
]

export interface RigidTransformV5 {
  readonly positionM: Vector3V5
  readonly quaternion: QuaternionV5
}

const DEGREES_TO_RADIANS = Math.PI / 180
const RADIANS_TO_DEGREES = 180 / Math.PI

function canonicalNumber(value: number): number {
  return value === 0 ? 0 : value
}

function shouldFlipQuaternionSign([x, y, z, w]: QuaternionV5): boolean {
  if (w !== 0) return w < 0
  if (z !== 0) return z < 0
  if (y !== 0) return y < 0
  return x < 0
}

function normalizeQuaternionV5(quaternion: QuaternionV5, path: string): QuaternionV5 {
  const magnitude = Math.hypot(...quaternion)
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    failProjectV5(
      'QUATERNION_NOT_NORMALIZABLE',
      path,
      'Quaternion must contain finite values and have non-zero magnitude.',
      'Provide a finite, non-zero quaternion in [x, y, z, w] order.',
    )
  }

  let normalized: QuaternionV5 = [
    quaternion[0] / magnitude,
    quaternion[1] / magnitude,
    quaternion[2] / magnitude,
    quaternion[3] / magnitude,
  ]
  if (shouldFlipQuaternionSign(normalized)) {
    normalized = [-normalized[0], -normalized[1], -normalized[2], -normalized[3]]
  }
  return [
    canonicalNumber(normalized[0]),
    canonicalNumber(normalized[1]),
    canonicalNumber(normalized[2]),
    canonicalNumber(normalized[3]),
  ]
}

function multiplyQuaternionsV5(
  [ax, ay, az, aw]: QuaternionV5,
  [bx, by, bz, bw]: QuaternionV5,
): QuaternionV5 {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

function rotateVectorV5(vector: Vector3V5, quaternion: QuaternionV5): Vector3V5 {
  const conjugate: QuaternionV5 = [-quaternion[0], -quaternion[1], -quaternion[2], quaternion[3]]
  const rotated = multiplyQuaternionsV5(
    multiplyQuaternionsV5(quaternion, [...vector, 0]),
    conjugate,
  )
  return [canonicalNumber(rotated[0]), canonicalNumber(rotated[1]), canonicalNumber(rotated[2])]
}

export function normalizeRigidTransformV5(value: RigidTransformV5, path: string): RigidTransformV5 {
  return {
    positionM: [
      canonicalNumber(value.positionM[0]),
      canonicalNumber(value.positionM[1]),
      canonicalNumber(value.positionM[2]),
    ],
    quaternion: normalizeQuaternionV5(value.quaternion, path),
  }
}

export function composeRigidTransformV5(parent: RigidTransformV5, local: RigidTransformV5): RigidTransformV5 {
  const normalizedParent = normalizeRigidTransformV5(parent, '$.parent')
  const normalizedLocal = normalizeRigidTransformV5(local, '$.local')
  const rotatedLocalPosition = rotateVectorV5(normalizedLocal.positionM, normalizedParent.quaternion)
  return normalizeRigidTransformV5({
    positionM: [
      normalizedParent.positionM[0] + rotatedLocalPosition[0],
      normalizedParent.positionM[1] + rotatedLocalPosition[1],
      normalizedParent.positionM[2] + rotatedLocalPosition[2],
    ],
    quaternion: multiplyQuaternionsV5(normalizedParent.quaternion, normalizedLocal.quaternion),
  }, '$.result')
}

export function invertRigidTransformV5(value: RigidTransformV5): RigidTransformV5 {
  const normalized = normalizeRigidTransformV5(value, '$.transform')
  const inverseQuaternion: QuaternionV5 = [
    -normalized.quaternion[0], -normalized.quaternion[1], -normalized.quaternion[2], normalized.quaternion[3],
  ]
  return normalizeRigidTransformV5({
    positionM: rotateVectorV5([
      -normalized.positionM[0], -normalized.positionM[1], -normalized.positionM[2],
    ], inverseQuaternion),
    quaternion: inverseQuaternion,
  }, '$.result')
}

export function relativeRigidTransformV5(
  referenceWorld: RigidTransformV5,
  targetWorld: RigidTransformV5,
): RigidTransformV5 {
  return composeRigidTransformV5(invertRigidTransformV5(referenceWorld), targetWorld)
}

export function rpyDegreesToQuaternionV5([rollDeg, pitchDeg, yawDeg]: Vector3V5): QuaternionV5 {
  const halfRoll = rollDeg * DEGREES_TO_RADIANS / 2
  const halfPitch = pitchDeg * DEGREES_TO_RADIANS / 2
  const halfYaw = yawDeg * DEGREES_TO_RADIANS / 2
  const sinRoll = Math.sin(halfRoll)
  const cosRoll = Math.cos(halfRoll)
  const sinPitch = Math.sin(halfPitch)
  const cosPitch = Math.cos(halfPitch)
  const sinYaw = Math.sin(halfYaw)
  const cosYaw = Math.cos(halfYaw)
  return normalizeQuaternionV5([
    sinRoll * cosPitch * cosYaw - cosRoll * sinPitch * sinYaw,
    cosRoll * sinPitch * cosYaw + sinRoll * cosPitch * sinYaw,
    cosRoll * cosPitch * sinYaw - sinRoll * sinPitch * cosYaw,
    cosRoll * cosPitch * cosYaw + sinRoll * sinPitch * sinYaw,
  ], '$.rpyDeg')
}

export function quaternionToRpyDegreesV5(quaternion: QuaternionV5): Vector3V5 {
  const [x, y, z, w] = normalizeQuaternionV5(quaternion, '$.quaternion')
  const sinPitch = Math.max(-1, Math.min(1, 2 * (w * y - z * x)))
  const matrix00 = 1 - 2 * (y * y + z * z)
  const matrix10 = 2 * (x * y + w * z)
  const cosPitchMagnitude = Math.hypot(matrix00, matrix10)
  if (cosPitchMagnitude <= 8 * Number.EPSILON) {
    const yaw = Math.atan2(-2 * (x * y - w * z), 1 - 2 * (x * x + z * z)) * RADIANS_TO_DEGREES
    return [0, sinPitch < 0 ? -90 : 90, canonicalNumber(yaw)]
  }
  return [
    canonicalNumber(Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * RADIANS_TO_DEGREES),
    canonicalNumber(Math.asin(sinPitch) * RADIANS_TO_DEGREES),
    canonicalNumber(Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * RADIANS_TO_DEGREES),
  ]
}

export function quaternionToMatrix3V5(quaternion: QuaternionV5): Matrix3V5 {
  const [x, y, z, w] = normalizeQuaternionV5(quaternion, '$.quaternion')
  const xx = x * x
  const yy = y * y
  const zz = z * z
  const xy = x * y
  const xz = x * z
  const yz = y * z
  const wx = w * x
  const wy = w * y
  const wz = w * z
  return [
    canonicalNumber(1 - 2 * (yy + zz)), canonicalNumber(2 * (xy - wz)), canonicalNumber(2 * (xz + wy)),
    canonicalNumber(2 * (xy + wz)), canonicalNumber(1 - 2 * (xx + zz)), canonicalNumber(2 * (yz - wx)),
    canonicalNumber(2 * (xz - wy)), canonicalNumber(2 * (yz + wx)), canonicalNumber(1 - 2 * (xx + yy)),
  ]
}
