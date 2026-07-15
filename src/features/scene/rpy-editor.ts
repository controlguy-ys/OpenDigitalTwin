import { Euler, MathUtils, Quaternion } from 'three'

export interface IntrinsicZyxRpyDeg {
  readonly rollDeg: number
  readonly pitchDeg: number
  readonly yawDeg: number
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`)
  return value
}

function clean(value: number): number {
  if (Object.is(value, -0) || Math.abs(value) < 1e-12) return 0
  const integer = Math.round(value)
  return Math.abs(value - integer) < 1e-12 ? integer : value
}

export function normalizeDegrees(value: number): number {
  finite(value, 'Angle')
  let normalized = ((value + 180) % 360 + 360) % 360 - 180
  if (Math.abs(normalized + 180) < 1e-12 && value > 0) normalized = 180
  return clean(normalized)
}

export function normalizeRpyDegrees(rpy: IntrinsicZyxRpyDeg): IntrinsicZyxRpyDeg {
  return Object.freeze({
    rollDeg: normalizeDegrees(rpy.rollDeg),
    pitchDeg: normalizeDegrees(rpy.pitchDeg),
    yawDeg: normalizeDegrees(rpy.yawDeg),
  })
}

export function quaternionFromIntrinsicZyxDeg(
  rollDeg: number,
  pitchDeg: number,
  yawDeg: number,
): readonly [number, number, number, number] {
  const normalized = normalizeRpyDegrees({ rollDeg, pitchDeg, yawDeg })
  const quaternion = new Quaternion().setFromEuler(new Euler(
    MathUtils.degToRad(normalized.rollDeg),
    MathUtils.degToRad(normalized.pitchDeg),
    MathUtils.degToRad(normalized.yawDeg),
    'ZYX',
  )).normalize()
  return Object.freeze(quaternion.toArray().map(clean)) as readonly [number, number, number, number]
}

export function intrinsicZyxDegFromQuaternion(
  quaternion: readonly [number, number, number, number],
): IntrinsicZyxRpyDeg {
  quaternion.forEach((value, index) => finite(value, `Quaternion component ${index}`))
  const scale = Math.max(...quaternion.map(Math.abs))
  if (scale === 0) throw new Error('Quaternion must be non-zero.')
  const normalized = new Quaternion(
    quaternion[0] / scale,
    quaternion[1] / scale,
    quaternion[2] / scale,
    quaternion[3] / scale,
  ).normalize()
  const euler = new Euler().setFromQuaternion(normalized, 'ZYX')
  return normalizeRpyDegrees({
    rollDeg: MathUtils.radToDeg(euler.x),
    pitchDeg: MathUtils.radToDeg(euler.y),
    yawDeg: MathUtils.radToDeg(euler.z),
  })
}
