import { describe, expect, it } from 'vitest'
import {
  intrinsicZyxDegFromQuaternion,
  normalizeRpyDegrees,
  quaternionFromIntrinsicZyxDeg,
} from './rpy-editor'

function expectEquivalentQuaternion(
  actual: readonly number[],
  expected: readonly number[],
) {
  const dot = actual.reduce((sum, value, index) => sum + value * expected[index]!, 0)
  expect(Math.abs(dot)).toBeCloseTo(1, 10)
}

describe('intrinsic ZYX RPY editor', () => {
  it('normalizes degree input and persists a unit quaternion', () => {
    const quaternion = quaternionFromIntrinsicZyxDeg(450, -360, 720)
    expect(Math.hypot(...quaternion)).toBeCloseTo(1, 12)
    expect(intrinsicZyxDegFromQuaternion(quaternion)).toEqual({
      rollDeg: 90,
      pitchDeg: 0,
      yawDeg: 0,
    })
    expect(normalizeRpyDegrees({ rollDeg: 540, pitchDeg: -540, yawDeg: 181 }))
      .toEqual({ rollDeg: 180, pitchDeg: -180, yawDeg: -179 })
  })

  it('round-trips orientations across the wrap boundary without depending on quaternion sign', () => {
    const quaternion = quaternionFromIntrinsicZyxDeg(179.999, -42.5, -179.999)
    const display = intrinsicZyxDegFromQuaternion(quaternion)
    expect(Object.values(display).every((value) => value >= -180 && value <= 180)).toBe(true)
    expectEquivalentQuaternion(
      quaternionFromIntrinsicZyxDeg(display.rollDeg, display.pitchDeg, display.yawDeg),
      quaternion,
    )
  })

  it('returns one finite normalized representation at a gimbal singularity', () => {
    const quaternion = quaternionFromIntrinsicZyxDeg(35, 90, -20)
    const display = intrinsicZyxDegFromQuaternion(quaternion)
    expect(Object.values(display).every(Number.isFinite)).toBe(true)
    expect(Object.values(display).every((value) => value >= -180 && value <= 180)).toBe(true)
    expectEquivalentQuaternion(
      quaternionFromIntrinsicZyxDeg(display.rollDeg, display.pitchDeg, display.yawDeg),
      quaternion,
    )
  })

  it('rejects non-finite angles and a zero quaternion', () => {
    expect(() => quaternionFromIntrinsicZyxDeg(Number.NaN, 0, 0)).toThrow('finite')
    expect(() => intrinsicZyxDegFromQuaternion([0, 0, 0, 0])).toThrow('non-zero')
  })
})
