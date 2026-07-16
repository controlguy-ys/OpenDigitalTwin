import { failProjectV4 } from './errors'

export type Vector3V4 = readonly [number, number, number]
export type QuaternionV4 = readonly [number, number, number, number]
export type Matrix3V4 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
]

export interface RigidTransformV4 {
  readonly positionM: Vector3V4
  readonly quaternion: QuaternionV4
}

const DEGREES_TO_RADIANS = Math.PI / 180
const RADIANS_TO_DEGREES = 180 / Math.PI

function canonicalNumber(value: number): number {
  return value === 0 ? 0 : value
}

function shouldFlipQuaternionSign([x, y, z, w]: QuaternionV4): boolean {
  if (w !== 0) return w < 0
  if (z !== 0) return z < 0
  if (y !== 0) return y < 0
  return x < 0
}

function normalizeQuaternionV4(
  quaternion: QuaternionV4,
  path: string,
): QuaternionV4 {
  const magnitude = Math.hypot(...quaternion)
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    failProjectV4(
      'QUATERNION_NOT_NORMALIZABLE',
      path,
      'Quaternion must contain finite values and have non-zero magnitude.',
      'Provide a finite, non-zero quaternion in [x, y, z, w] order.',
    )
  }

  let normalized: QuaternionV4 = [
    quaternion[0] / magnitude,
    quaternion[1] / magnitude,
    quaternion[2] / magnitude,
    quaternion[3] / magnitude,
  ]
  if (shouldFlipQuaternionSign(normalized)) {
    normalized = [
      -normalized[0],
      -normalized[1],
      -normalized[2],
      -normalized[3],
    ]
  }

  return [
    canonicalNumber(normalized[0]),
    canonicalNumber(normalized[1]),
    canonicalNumber(normalized[2]),
    canonicalNumber(normalized[3]),
  ]
}

function multiplyQuaternionsV4(
  [ax, ay, az, aw]: QuaternionV4,
  [bx, by, bz, bw]: QuaternionV4,
): QuaternionV4 {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

function rotateVectorV4(
  vector: Vector3V4,
  quaternion: QuaternionV4,
): Vector3V4 {
  const conjugate: QuaternionV4 = [
    -quaternion[0],
    -quaternion[1],
    -quaternion[2],
    quaternion[3],
  ]
  const rotated = multiplyQuaternionsV4(
    multiplyQuaternionsV4(quaternion, [...vector, 0]),
    conjugate,
  )
  return [
    canonicalNumber(rotated[0]),
    canonicalNumber(rotated[1]),
    canonicalNumber(rotated[2]),
  ]
}

export function normalizeRigidTransformV4(
  value: RigidTransformV4,
  path: string,
): RigidTransformV4 {
  return {
    positionM: [
      canonicalNumber(value.positionM[0]),
      canonicalNumber(value.positionM[1]),
      canonicalNumber(value.positionM[2]),
    ],
    quaternion: normalizeQuaternionV4(value.quaternion, path),
  }
}

export function composeRigidTransformV4(
  parent: RigidTransformV4,
  local: RigidTransformV4,
): RigidTransformV4 {
  const normalizedParent = normalizeRigidTransformV4(parent, '$.parent')
  const normalizedLocal = normalizeRigidTransformV4(local, '$.local')
  const rotatedLocalPosition = rotateVectorV4(
    normalizedLocal.positionM,
    normalizedParent.quaternion,
  )

  return normalizeRigidTransformV4({
    positionM: [
      normalizedParent.positionM[0] + rotatedLocalPosition[0],
      normalizedParent.positionM[1] + rotatedLocalPosition[1],
      normalizedParent.positionM[2] + rotatedLocalPosition[2],
    ],
    quaternion: multiplyQuaternionsV4(
      normalizedParent.quaternion,
      normalizedLocal.quaternion,
    ),
  }, '$.result')
}

export function invertRigidTransformV4(
  value: RigidTransformV4,
): RigidTransformV4 {
  const normalized = normalizeRigidTransformV4(value, '$.transform')
  const inverseQuaternion: QuaternionV4 = [
    -normalized.quaternion[0],
    -normalized.quaternion[1],
    -normalized.quaternion[2],
    normalized.quaternion[3],
  ]

  return normalizeRigidTransformV4({
    positionM: rotateVectorV4([
      -normalized.positionM[0],
      -normalized.positionM[1],
      -normalized.positionM[2],
    ], inverseQuaternion),
    quaternion: inverseQuaternion,
  }, '$.result')
}

export function relativeRigidTransformV4(
  referenceWorld: RigidTransformV4,
  targetWorld: RigidTransformV4,
): RigidTransformV4 {
  return composeRigidTransformV4(
    invertRigidTransformV4(referenceWorld),
    targetWorld,
  )
}

export function rpyDegreesToQuaternionV4(
  [rollDeg, pitchDeg, yawDeg]: Vector3V4,
): QuaternionV4 {
  const halfRoll = rollDeg * DEGREES_TO_RADIANS / 2
  const halfPitch = pitchDeg * DEGREES_TO_RADIANS / 2
  const halfYaw = yawDeg * DEGREES_TO_RADIANS / 2
  const sinRoll = Math.sin(halfRoll)
  const cosRoll = Math.cos(halfRoll)
  const sinPitch = Math.sin(halfPitch)
  const cosPitch = Math.cos(halfPitch)
  const sinYaw = Math.sin(halfYaw)
  const cosYaw = Math.cos(halfYaw)

  return normalizeQuaternionV4([
    sinRoll * cosPitch * cosYaw - cosRoll * sinPitch * sinYaw,
    cosRoll * sinPitch * cosYaw + sinRoll * cosPitch * sinYaw,
    cosRoll * cosPitch * sinYaw - sinRoll * sinPitch * cosYaw,
    cosRoll * cosPitch * cosYaw + sinRoll * sinPitch * sinYaw,
  ], '$.rpyDeg')
}

export function quaternionToRpyDegreesV4(
  quaternion: QuaternionV4,
): Vector3V4 {
  const [x, y, z, w] = normalizeQuaternionV4(quaternion, '$.quaternion')
  const sinPitch = Math.max(-1, Math.min(1, 2 * (w * y - z * x)))

  if (Math.abs(sinPitch) >= 1 - 1e-12) {
    const yaw = Math.atan2(
      -2 * (x * y - w * z),
      1 - 2 * (x * x + z * z),
    ) * RADIANS_TO_DEGREES
    return [
      0,
      sinPitch < 0 ? -90 : 90,
      canonicalNumber(yaw),
    ]
  }

  return [
    canonicalNumber(Math.atan2(
      2 * (w * x + y * z),
      1 - 2 * (x * x + y * y),
    ) * RADIANS_TO_DEGREES),
    canonicalNumber(Math.asin(sinPitch) * RADIANS_TO_DEGREES),
    canonicalNumber(Math.atan2(
      2 * (w * z + x * y),
      1 - 2 * (y * y + z * z),
    ) * RADIANS_TO_DEGREES),
  ]
}

export function quaternionToMatrix3V4(
  quaternion: QuaternionV4,
): Matrix3V4 {
  const [x, y, z, w] = normalizeQuaternionV4(quaternion, '$.quaternion')
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
    canonicalNumber(1 - 2 * (yy + zz)),
    canonicalNumber(2 * (xy - wz)),
    canonicalNumber(2 * (xz + wy)),
    canonicalNumber(2 * (xy + wz)),
    canonicalNumber(1 - 2 * (xx + zz)),
    canonicalNumber(2 * (yz - wx)),
    canonicalNumber(2 * (xz - wy)),
    canonicalNumber(2 * (yz + wx)),
    canonicalNumber(1 - 2 * (xx + yy)),
  ]
}
