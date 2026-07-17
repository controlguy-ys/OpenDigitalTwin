import { describe, expect, it } from 'vitest'
import {
  rpyDegreesToQuaternionV4,
  type RigidTransformV4,
} from '../../../core/project-v4/index.js'
import {
  rigidTransformFromTransformDraftV4,
  transformDraftFromRigidTransformV4,
  type TransformDraftV4,
} from './transform-draft.js'

function expectNumbersClose(
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 1e-10,
): void {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((value, index) => {
    expect(Math.abs(value - (expected[index] ?? Number.NaN))).toBeLessThanOrEqual(tolerance)
  })
}

function draft(overrides: Partial<TransformDraftV4> = {}): TransformDraftV4 {
  return {
    xMm: '0',
    yMm: '0',
    zMm: '0',
    rollDeg: '0',
    pitchDeg: '0',
    yawDeg: '0',
    ...overrides,
  }
}

describe('TransformDraftV4', () => {
  it('converts display millimetres to internal metres and back', () => {
    const pose = rigidTransformFromTransformDraftV4(draft({
      xMm: '1250',
      yMm: '-25.5',
      zMm: '0.125',
    }))

    expect(pose.positionM).toEqual([1.25, -0.0255, 0.000125])
    expect(transformDraftFromRigidTransformV4(pose)).toMatchObject({
      xMm: '1250',
      yMm: '-25.5',
      zMm: '0.125',
    })
  })

  it('round-trips intrinsic Z-Y-X RPY degrees through a normalized quaternion', () => {
    const result = rigidTransformFromTransformDraftV4(draft({
      rollDeg: '10',
      pitchDeg: '20',
      yawDeg: '30',
    }))
    const displayed = transformDraftFromRigidTransformV4({
      positionM: [0, 0, 0],
      quaternion: result.quaternion.map((value) => value * 7) as unknown as RigidTransformV4['quaternion'],
    })

    expectNumbersClose(result.quaternion, rpyDegreesToQuaternionV4([10, 20, 30]))
    expectNumbersClose([
      Number(displayed.rollDeg),
      Number(displayed.pitchDeg),
      Number(displayed.yawDeg),
    ], [10, 20, 30])
    expectNumbersClose(
      rigidTransformFromTransformDraftV4(displayed).quaternion,
      result.quaternion,
    )
  })

  it.each([
    [[10, 90, 30], [0, 90, 20]],
    [[10, -90, 30], [0, -90, 40]],
  ] as const)('uses the stable core representation at gimbal lock for %j', (input, expected) => {
    const displayed = transformDraftFromRigidTransformV4({
      positionM: [0, 0, 0],
      quaternion: rpyDegreesToQuaternionV4(input),
    })

    expectNumbersClose([
      Number(displayed.rollDeg),
      Number(displayed.pitchDeg),
      Number(displayed.yawDeg),
    ], expected)
    expectNumbersClose(
      rigidTransformFromTransformDraftV4(displayed).quaternion,
      rpyDegreesToQuaternionV4(input),
    )
  })

  it.each([
    ['xMm', ''],
    ['yMm', '   '],
    ['zMm', 'Infinity'],
    ['rollDeg', '-Infinity'],
    ['pitchDeg', 'NaN'],
    ['yawDeg', '1e999'],
  ] as const)('rejects blank or non-finite %s input', (field, value) => {
    expect(() => rigidTransformFromTransformDraftV4(draft({ [field]: value })))
      .toThrowError(expect.objectContaining({ code: 'TRANSFORM_DRAFT_INVALID' }))
  })

  it('normalizes quaternion sign and magnitude on the display boundary', () => {
    const displayed = transformDraftFromRigidTransformV4({
      positionM: [1, 2, 3],
      quaternion: [0, 0, 0, -5],
    })

    expect(rigidTransformFromTransformDraftV4(displayed)).toEqual({
      positionM: [1, 2, 3],
      quaternion: [0, 0, 0, 1],
    })
  })

  it('never exposes negative zero in position or angle strings', () => {
    const displayed = transformDraftFromRigidTransformV4({
      positionM: [-0, -0, -0],
      quaternion: rpyDegreesToQuaternionV4([-0, -0, -0]),
    })

    expect(displayed).toEqual({
      xMm: '0',
      yMm: '0',
      zMm: '0',
      rollDeg: '0',
      pitchDeg: '0',
      yawDeg: '0',
    })
    expect(Object.values(displayed).some((value) => value === '-0')).toBe(false)
  })
})
