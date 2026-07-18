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

function runtimeSample(
  sequence: number,
  sourceTimestampMs: number,
  x: number,
  receivedTimestampMs = sourceTimestampMs,
) {
  return { sequence, sourceTimestampMs, receivedTimestampMs, pose: poseAt(x) }
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

  it('uses the shorter arc when the endpoint quaternion has a negative dot product', () => {
    const result = interpolateRigidTransformV4(
      poseAt(0, [0, 0, 0, 1]),
      poseAt(10, [0, 0, Math.sin(100 * Math.PI / 180), Math.cos(100 * Math.PI / 180)]),
      0.5,
    )

    expectNumbersClose(result.quaternion, [0, 0, -Math.sin(40 * Math.PI / 180), Math.cos(40 * Math.PI / 180)])
  })

  it('rejects non-finite direct interpolation poses and returns a deeply frozen result', () => {
    expect(() => interpolateRigidTransformV4(
      { positionM: [Number.NaN, 0, 0], quaternion: [0, 0, 0, 1] },
      poseAt(1),
      0.5,
    )).toThrow(/position/i)
    expect(() => interpolateRigidTransformV4(
      poseAt(0),
      { positionM: [1, 2, 3], quaternion: [0, 0, Number.POSITIVE_INFINITY, 1] },
      0.5,
    )).toThrow(/quaternion/i)

    const result = interpolateRigidTransformV4(poseAt(0), poseAt(1), 0.5)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.positionM)).toBe(true)
    expect(Object.isFrozen(result.quaternion)).toBe(true)
  })

  it('renders two publishing cycles behind the latest accepted source timestamp', () => {
    const buffer = createRuntimePoseBufferV1('box-1', 100)
    expect(buffer.push(runtimeSample(1, 1_000, 0))).toBe(true)
    expect(buffer.push(runtimeSample(2, 1_100, 10))).toBe(true)
    expect(buffer.push(runtimeSample(3, 1_200, 20))).toBe(true)

    const result = buffer.sample(1_200)

    expect(result).toMatchObject({ quality: 'GOOD', sourceTimestampMs: 1_000 })
    expectNumbersClose(result!.pose.positionM, [0, 1, 2])
  })

  it('advances the delayed render target smoothly between pushes using receipt-clock elapsed time', () => {
    const buffer = createRuntimePoseBufferV1('box-1', 100)
    expect(buffer.push(runtimeSample(1, 1_000, 0, 5_000))).toBe(true)
    expect(buffer.push(runtimeSample(2, 1_100, 10, 5_100))).toBe(true)
    expect(buffer.push(runtimeSample(3, 1_200, 20, 5_200))).toBe(true)

    expectNumbersClose(buffer.sample(5_200)!.pose.positionM, [0, 1, 2])
    expectNumbersClose(buffer.sample(5_250)!.pose.positionM, [5, 6, 7])
    expectNumbersClose(buffer.sample(5_400)!.pose.positionM, [20, 21, 22])
  })

  it('never rewinds an emitted target when a newer source sample arrives late', () => {
    const buffer = createRuntimePoseBufferV1('box-1', 100)
    expect(buffer.push(runtimeSample(1, 1_000, 0, 5_000))).toBe(true)
    expect(buffer.push(runtimeSample(2, 1_100, 10, 5_100))).toBe(true)
    expect(buffer.push(runtimeSample(3, 1_200, 20, 5_200))).toBe(true)
    expect(buffer.sample(5_400)).toMatchObject({ sourceTimestampMs: 1_200 })

    expect(buffer.push(runtimeSample(4, 1_300, 30, 5_600))).toBe(true)

    const delayed = buffer.sample(5_600)!
    expect(delayed).toMatchObject({ quality: 'GOOD', sourceTimestampMs: 1_200 })
    expectNumbersClose(delayed.pose.positionM, [20, 21, 22])
    expect(buffer.sample(5_750)).toMatchObject({ sourceTimestampMs: 1_250 })
  })

  it('preserves the stale freeze position when fresh data resumes on the same buffer', () => {
    const buffer = createRuntimePoseBufferV1('box-1', 100)
    expect(buffer.push(runtimeSample(1, 1_000, 0, 5_000))).toBe(true)
    expect(buffer.push(runtimeSample(2, 1_100, 10, 5_100))).toBe(true)
    expect(buffer.push(runtimeSample(3, 1_200, 20, 5_200))).toBe(true)
    expect(buffer.sample(5_701)).toMatchObject({
      quality: 'STALE',
      sourceTimestampMs: 1_200,
    })

    expect(buffer.push(runtimeSample(4, 1_300, 30, 5_800))).toBe(true)

    const resumed = buffer.sample(5_800)!
    expect(resumed).toMatchObject({ quality: 'GOOD', sourceTimestampMs: 1_200 })
    expectNumbersClose(resumed.pose.positionM, [20, 21, 22])
  })

  it('accepts increasing sequences at an equal source timestamp and rejects older timestamps', () => {
    const buffer = createRuntimePoseBufferV1('box-1', 100)
    expect(buffer.push(runtimeSample(2, 1_000, 0))).toBe(true)
    expect(buffer.push(runtimeSample(3, 1_000, 10, 1_001))).toBe(true)
    expect(buffer.push(runtimeSample(4, 999, 20, 1_002))).toBe(false)
    expect(buffer.push(runtimeSample(3, 1_100, 30, 1_003))).toBe(false)

    expect(buffer.size).toBe(1)
    expectNumbersClose(buffer.sample(1_001)!.pose.positionM, [10, 11, 12])
  })

  it('retains only the most recent bounded sample history', () => {
    const buffer = createRuntimePoseBufferV1('box-1', 100)
    for (let index = 0; index < MAX_RUNTIME_POSE_SAMPLES_V1 + 3; index += 1) {
      expect(buffer.push({
        sequence: index + 1,
        sourceTimestampMs: 1_000 + index * 100,
        receivedTimestampMs: 1_000 + index * 100,
        pose: poseAt(index),
      })).toBe(true)
    }

    expect(buffer.size).toBe(MAX_RUNTIME_POSE_SAMPLES_V1)
    expect(buffer.sample(1_000 + (MAX_RUNTIME_POSE_SAMPLES_V1 + 2) * 100))
      .toMatchObject({ sourceTimestampMs: 4_200 })
  })

  it('freezes the most recent pose as STALE after the freshness window elapses', () => {
    const buffer = createRuntimePoseBufferV1('box-1', 100)
    expect(buffer.push(runtimeSample(1, 1_000, 0, 5_000))).toBe(true)
    expect(buffer.push(runtimeSample(2, 1_100, 10, 5_100))).toBe(true)
    expect(buffer.push(runtimeSample(3, 1_200, 20, 5_200))).toBe(true)

    const result = buffer.sample(5_701)

    expect(result).toMatchObject({ quality: 'STALE', sourceTimestampMs: 1_200 })
    expectNumbersClose(result!.pose.positionM, [20, 21, 22])
  })

  it('uses five publishing cycles when that exceeds the 500ms freshness minimum', () => {
    const buffer = createRuntimePoseBufferV1('box-1', 200)
    expect(buffer.push(runtimeSample(1, 1_000, 0, 5_000))).toBe(true)
    expect(buffer.push(runtimeSample(2, 1_200, 10, 5_200))).toBe(true)
    expect(buffer.push(runtimeSample(3, 1_400, 20, 5_400))).toBe(true)

    expect(buffer.sample(6_400)).toMatchObject({ quality: 'GOOD' })
    expect(buffer.sample(6_401)).toMatchObject({ quality: 'STALE', sourceTimestampMs: 1_400 })
  })

  it('isolates stored poses from callers and exposes deeply frozen results', () => {
    const positionM: [number, number, number] = [1, 2, 3]
    const quaternion: [number, number, number, number] = [0, 0, 0, 1]
    const buffer = createRuntimePoseBufferV1('box-1', 100)
    expect(buffer.push({
      sequence: 1,
      sourceTimestampMs: 1_000,
      receivedTimestampMs: 5_000,
      pose: { positionM, quaternion },
    })).toBe(true)
    positionM[0] = 99
    quaternion[3] = -1

    const result = buffer.sample(5_000)!

    expect(result.pose).toEqual({ positionM: [1, 2, 3], quaternion: [0, 0, 0, 1] })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.pose)).toBe(true)
    expect(Object.isFrozen(result.pose.positionM)).toBe(true)
    expect(Object.isFrozen(result.pose.quaternion)).toBe(true)
    expect(() => ((result.pose.positionM as unknown as number[])[0] = 77)).toThrow()
    expect(buffer.sample(5_000)!.pose.positionM[0]).toBe(1)
  })

  it('rejects invalid protocol sequence, timestamps, and pose components before storing', () => {
    const buffer = createRuntimePoseBufferV1('box-1', 100)

    expect(() => buffer.push(runtimeSample(0, 1_000, 0))).toThrow(/sequence/i)
    expect(() => buffer.push(runtimeSample(1, -1, 0))).toThrow(/source timestamp/i)
    expect(() => buffer.push(runtimeSample(1, Number.MAX_SAFE_INTEGER + 1, 0))).toThrow(/source timestamp/i)
    expect(() => buffer.push(runtimeSample(1, 1_000, 0, Number.NaN))).toThrow(/receipt timestamp/i)
    expect(() => buffer.push({
      ...runtimeSample(1, 1_000, 0),
      pose: { positionM: [0, Number.POSITIVE_INFINITY, 0], quaternion: [0, 0, 0, 1] },
    })).toThrow(/position/i)
    expect(() => buffer.push({
      ...runtimeSample(1, 1_000, 0),
      pose: { positionM: [0, 0, 0], quaternion: [0, Number.NaN, 0, 1] },
    })).toThrow(/quaternion/i)
    expect(buffer.size).toBe(0)
  })
})
