import { describe, expect, it } from 'vitest'

import {
  composeRigidTransformV5,
  invertRigidTransformV5,
  normalizeRigidTransformV5,
  quaternionToMatrix3V5,
  quaternionToRpyDegreesV5,
  relativeRigidTransformV5,
  rpyDegreesToQuaternionV5,
  type RigidTransformV5,
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

describe('Project V5 rigid transforms', () => {
  it('normalizes a V5 transform without importing Project V4', () => {
    expect(normalizeRigidTransformV5({
      positionM: [-0, 1, 2],
      quaternion: [0, 0, 0, 2],
    }, '$.pose')).toEqual({ positionM: [0, 1, 2], quaternion: [0, 0, 0, 1] })
  })

  it('preserves the V5 Rz * Ry * Rx convention without platform dependencies', () => {
    const quaternion = rpyDegreesToQuaternionV5([10, 20, 30])

    expectNumbersClose(quaternionToMatrix3V5(quaternion), [
      0.8137976813, -0.4409696105, 0.3785223064,
      0.4698463104, 0.8825641193, 0.0180283112,
      -0.3420201433, 0.1631759112, 0.9254165784,
    ], 1e-9)
  })

  it('reports stable V5 validation errors for unnormalizable quaternions', () => {
    expect(() => normalizeRigidTransformV5({
      positionM: [0, 0, 0], quaternion: [0, 0, 0, 0],
    }, '$.robots[0].localBasePose')).toThrowError(expect.objectContaining({
      code: 'QUATERNION_NOT_NORMALIZABLE',
      path: '$.robots[0].localBasePose',
    }))
  })

  it('composes, inverts, and derives relative V5 transforms', () => {
    const parent: RigidTransformV5 = {
      positionM: [1, 2, 3],
      quaternion: rpyDegreesToQuaternionV5([0, 0, 90]),
    }
    const local: RigidTransformV5 = {
      positionM: [1, 0, 0],
      quaternion: rpyDegreesToQuaternionV5([90, 0, 0]),
    }
    const composed = composeRigidTransformV5(parent, local)

    expectNumbersClose(composed.positionM, [1, 3, 3])
    expectNumbersClose(composed.quaternion, [0.5, 0.5, 0.5, 0.5])
    expectNumbersClose(
      composeRigidTransformV5(composed, invertRigidTransformV5(composed)).positionM,
      [0, 0, 0],
    )
    expectNumbersClose(
      composeRigidTransformV5(parent, relativeRigidTransformV5(parent, composed)).quaternion,
      composed.quaternion,
    )
  })

  it('round-trips RPY and uses a stable gimbal-lock representation', () => {
    expectNumbersClose(
      quaternionToRpyDegreesV5(rpyDegreesToQuaternionV5([10, 20, 30])),
      [10, 20, 30],
    )
    expectNumbersClose(
      quaternionToRpyDegreesV5(rpyDegreesToQuaternionV5([10, 90, 30])),
      [0, 90, 20],
    )
  })
})
