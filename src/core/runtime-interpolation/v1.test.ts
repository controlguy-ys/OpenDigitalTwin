import { describe, expect, it } from 'vitest'

import {
  MAX_RUNTIME_POSE_SAMPLES_V1,
  createRuntimePoseBufferV1,
  interpolateRigidTransformV4,
  rpyDegreesToRuntimeQuaternionV1,
} from './v1.js'

function expectNumbersClose(
  actual: readonly number[],
  expected: readonly number[],
  precision = 1e-9,
): void {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index]!, Math.max(0, Math.ceil(-Math.log10(precision))))
  })
}

function poseAt(x: number, quaternion: readonly [number, number, number, number] = [0, 0, 0, 1]) {
  return { positionM: [x, x + 1, x + 2] as const, quaternion }
}

describe('runtime interpolation v1', () => {
  it('converts degrees with intrinsic Z-Y-X Roll/Pitch/Yaw composition', () => {
    const quaternion = rpyDegreesToRuntimeQuaternionV1([90, 0, 90])

    expectNumbersClose(quaternion, [0.5, 0.5, 0.5, 0.5])
    expect(Math.hypot(...quaternion)).toBeCloseTo(1, 12)
  })

  it('interpolates translation linearly and rotation on the shortest quaternion arc', () => {
    const result = interpolateRigidTransformV4(
      poseAt(0, [0, 0, 0, 1]),
      poseAt(10, [0, 0, 1, 0]),
      0.5,
    )

    expectNumbersClose(result.positionM, [5, 6, 7])
    expectNumbersClose(result.quaternion, [0, 0, Math.SQRT1_2, Math.SQRT1_2])
  })

  it('treats antipodal quaternions as the same rotation during interpolation', () => {
    const result = interpolateRigidTransformV4(
      poseAt(0, [0, 0, 0, 1]),
      poseAt(10, [0, 0, 0, -1]),
      0.5,
    )

    expectNumbersClose(result.positionM, [5, 6, 7])
    expectNumbersClose(result.quaternion, [0, 0, 0, 1])
  })

  it('renders two publishing cycles behind the latest accepted source timestamp', () => {
    const buffer = createRuntimePoseBufferV1('box-1', 100)
    expect(buffer.push({ sequence: 1, sourceTimestampMs: 1_000, pose: poseAt(0) })).toBe(true)
    expect(buffer.push({ sequence: 2, sourceTimestampMs: 1_100, pose: poseAt(10) })).toBe(true)
    expect(buffer.push({ sequence: 3, sourceTimestampMs: 1_200, pose: poseAt(20) })).toBe(true)

    const result = buffer.sample(1_200)

    expect(result).toMatchObject({ quality: 'GOOD', sourceTimestampMs: 1_000 })
    expectNumbersClose(result!.pose.positionM, [0, 1, 2])
  })

  it('rejects non-increasing sequences and out-of-order source timestamps', () => {
    const buffer = createRuntimePoseBufferV1('box-1', 100)
    expect(buffer.push({ sequence: 2, sourceTimestampMs: 1_000, pose: poseAt(0) })).toBe(true)
    expect(buffer.push({ sequence: 2, sourceTimestampMs: 1_100, pose: poseAt(10) })).toBe(false)
    expect(buffer.push({ sequence: 3, sourceTimestampMs: 1_000, pose: poseAt(20) })).toBe(false)
    expect(buffer.push({ sequence: 3, sourceTimestampMs: 1_100, pose: poseAt(30) })).toBe(true)

    expect(buffer.size).toBe(2)
  })

  it('retains only the most recent bounded sample history', () => {
    const buffer = createRuntimePoseBufferV1('box-1', 100)
    for (let index = 0; index < MAX_RUNTIME_POSE_SAMPLES_V1 + 3; index += 1) {
      expect(buffer.push({
        sequence: index + 1,
        sourceTimestampMs: 1_000 + index * 100,
        pose: poseAt(index),
      })).toBe(true)
    }

    expect(buffer.size).toBe(MAX_RUNTIME_POSE_SAMPLES_V1)
    expect(buffer.sample(1_000 + (MAX_RUNTIME_POSE_SAMPLES_V1 + 2) * 100))
      .toMatchObject({ sourceTimestampMs: 4_200 })
  })

  it('freezes the most recent pose as STALE after the freshness window elapses', () => {
    const buffer = createRuntimePoseBufferV1('box-1', 100)
    expect(buffer.push({ sequence: 1, sourceTimestampMs: 1_000, pose: poseAt(0) })).toBe(true)
    expect(buffer.push({ sequence: 2, sourceTimestampMs: 1_100, pose: poseAt(10) })).toBe(true)
    expect(buffer.push({ sequence: 3, sourceTimestampMs: 1_200, pose: poseAt(20) })).toBe(true)

    const result = buffer.sample(1_701)

    expect(result).toMatchObject({ quality: 'STALE', sourceTimestampMs: 1_000 })
    expectNumbersClose(result!.pose.positionM, [0, 1, 2])
  })
})
