import { describe, expect, it } from 'vitest'

import {
  composeRigidTransformV4,
  invertRigidTransformV4,
  normalizeRigidTransformV4,
  quaternionToMatrix3V4,
  quaternionToRpyDegreesV4,
  relativeRigidTransformV4,
  rpyDegreesToQuaternionV4,
  type RigidTransformV4,
} from './rigid-transform'

function expectNumbersClose(
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 1e-12,
): void {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((value, index) => {
    expect(Math.abs(value - (expected[index] ?? Number.NaN))).toBeLessThanOrEqual(tolerance)
  })
}

function quaternionOrientationErrorDegrees(
  actual: readonly number[],
  expected: readonly number[],
): number {
  const dot = Math.abs(actual.reduce(
    (sum, value, index) => sum + value * (expected[index] ?? Number.NaN),
    0,
  ))
  return 2 * Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI
}

describe('Project V4 rigid transforms', () => {
  it('composes RPY degrees as Rz * Ry * Rx without Three.js', () => {
    const q = rpyDegreesToQuaternionV4([10, 20, 30])

    expectNumbersClose(quaternionToMatrix3V4(q), [
      0.8137976813, -0.4409696105, 0.3785223064,
      0.4698463104, 0.8825641193, 0.0180283112,
      -0.3420201433, 0.1631759112, 0.9254165784,
    ], 1e-9)
  })

  it('reports a stable code and JSON path', () => {
    expect(() => normalizeRigidTransformV4({
      positionM: [0, 0, 0], quaternion: [0, 0, 0, 0],
    }, '$.robots[0].localBasePose')).toThrowError(
      expect.objectContaining({
        code: 'QUATERNION_NOT_NORMALIZABLE',
        path: '$.robots[0].localBasePose',
      }),
    )
  })

  it('normalizes scale, canonicalizes negative zero, and selects the W/Z/Y/X sign', () => {
    expect(normalizeRigidTransformV4({
      positionM: [-0, 2, -0],
      quaternion: [0, 0, 0, -2],
    }, '$.pose')).toEqual({
      positionM: [0, 2, 0],
      quaternion: [0, 0, 0, 1],
    })
    expect(normalizeRigidTransformV4({
      positionM: [0, 0, 0],
      quaternion: [0, 0, -4, 0],
    }, '$.pose').quaternion).toEqual([0, 0, 1, 0])
    expect(normalizeRigidTransformV4({
      positionM: [0, 0, 0],
      quaternion: [-3, 0, 0, 0],
    }, '$.pose').quaternion).toEqual([1, 0, 0, 0])
  })

  it('composes parent and local translation and rotation with Hamilton multiplication', () => {
    const parent: RigidTransformV4 = {
      positionM: [1, 2, 3],
      quaternion: rpyDegreesToQuaternionV4([0, 0, 90]),
    }
    const local: RigidTransformV4 = {
      positionM: [1, 0, 0],
      quaternion: rpyDegreesToQuaternionV4([90, 0, 0]),
    }

    const result = composeRigidTransformV4(parent, local)

    expectNumbersClose(result.positionM, [1, 3, 3])
    expectNumbersClose(result.quaternion, [0.5, 0.5, 0.5, 0.5])
  })

  it('inverts a transform so composition produces canonical identity', () => {
    const value: RigidTransformV4 = {
      positionM: [1.25, -2.5, 4],
      quaternion: rpyDegreesToQuaternionV4([25, -40, 80]),
    }

    const identity = composeRigidTransformV4(value, invertRigidTransformV4(value))

    expectNumbersClose(identity.positionM, [0, 0, 0])
    expectNumbersClose(identity.quaternion, [0, 0, 0, 1])
    expect(identity.positionM.some((component) => Object.is(component, -0))).toBe(false)
    expect(identity.quaternion.some((component) => Object.is(component, -0))).toBe(false)
  })

  it('derives a relative transform that reconstructs the target world transform', () => {
    const reference: RigidTransformV4 = {
      positionM: [2, -1, 0.5],
      quaternion: rpyDegreesToQuaternionV4([5, 10, 15]),
    }
    const target: RigidTransformV4 = {
      positionM: [-3, 4, 2],
      quaternion: rpyDegreesToQuaternionV4([-35, 20, 70]),
    }

    const reconstructed = composeRigidTransformV4(
      reference,
      relativeRigidTransformV4(reference, target),
    )

    expectNumbersClose(reconstructed.positionM, target.positionM)
    expectNumbersClose(reconstructed.quaternion, target.quaternion)
  })

  it('round-trips nonsingular RPY degrees and canonicalizes identity zeros', () => {
    const input = [10, 20, 30] as const

    expectNumbersClose(
      quaternionToRpyDegreesV4(rpyDegreesToQuaternionV4(input)),
      input,
    )
    expect(rpyDegreesToQuaternionV4([-0, -0, -0])).toEqual([0, 0, 0, 1])
    expect(quaternionToRpyDegreesV4([0, 0, 0, 1])).toEqual([0, 0, 0])
  })

  it.each([
    [[10, 90, 30], [0, 90, 20]],
    [[10, -90, 30], [0, -90, 40]],
  ] as const)('uses a stable representation at RPY gimbal lock for %j', (input, expected) => {
    const quaternion = rpyDegreesToQuaternionV4(input)
    const rpy = quaternionToRpyDegreesV4(quaternion)

    expectNumbersClose(rpy, expected)
    expectNumbersClose(rpyDegreesToQuaternionV4(rpy), quaternion)
  })

  it.each([
    [[10, 89.99995, 30]],
    [[10, -89.99995, 30]],
  ] as const)('preserves nonsingular near-gimbal orientation for %j', (input) => {
    const quaternion = rpyDegreesToQuaternionV4(input)
    const recoveredQuaternion = rpyDegreesToQuaternionV4(
      quaternionToRpyDegreesV4(quaternion),
    )

    expect(quaternionOrientationErrorDegrees(
      recoveredQuaternion,
      quaternion,
    )).toBeLessThanOrEqual(1e-8)
  })
})
