import { describe, expect, it } from 'vitest'
import {
  composePose3D,
  IDENTITY_POSE,
  invertPose3D,
  normalizePose3D,
  pose3DApproximatelyEquals,
  pose3DToSerializableTransform,
  quaternionToRpy,
  relativePose3D,
  rpyToQuaternion,
  serializableTransformToPose3D,
  type Pose3D,
} from './pose3d'

const PARENT: Pose3D = {
  position: [1, 2, 3],
  quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
}

const CHILD: Pose3D = {
  position: [0.25, 0, 0.5],
  quaternion: [0, 0, 0, 1],
}

describe('Pose3D', () => {
  it('normalizes and owns caller tuples', () => {
    const source: Pose3D = {
      position: [1, 2, 3],
      quaternion: [0, 0, 0, 2],
    }
    const normalized = normalizePose3D(source)

    expect(normalized).toEqual({
      position: [1, 2, 3],
      quaternion: [0, 0, 0, 1],
    })
    expect(normalized.position).not.toBe(source.position)
    expect(normalized.quaternion).not.toBe(source.quaternion)
  })

  it.each([
    { position: [Number.NaN, 0, 0], quaternion: [0, 0, 0, 1] },
    { position: [0, 0, 0], quaternion: [0, 0, 0, 0] },
    { position: [0, 0, 0], quaternion: [0, Infinity, 0, 1] },
  ])('rejects invalid transforms before matrix math', (pose) => {
    expect(() => normalizePose3D(pose as unknown as Pose3D)).toThrow(
      /finite|quaternion/i,
    )
  })

  it('composes a parent and child and recovers the relative pose', () => {
    const world = composePose3D(PARENT, CHILD)

    expect(world.position[0]).toBeCloseTo(1)
    expect(world.position[1]).toBeCloseTo(2.25)
    expect(world.position[2]).toBeCloseTo(3.5)
    expect(pose3DApproximatelyEquals(relativePose3D(PARENT, world), CHILD)).toBe(
      true,
    )
    expect(
      pose3DApproximatelyEquals(
        composePose3D(world, invertPose3D(world)),
        IDENTITY_POSE,
      ),
    ).toBe(true)
  })

  it('uses non-commuting ZYX Roll/Pitch/Yaw and round-trips it', () => {
    const input = [0.2, -0.35, 0.8] as const
    const quaternion = rpyToQuaternion(input)
    const [roll, pitch, yaw] = input
    const [sr, cr] = [Math.sin(roll / 2), Math.cos(roll / 2)]
    const [sp, cp] = [Math.sin(pitch / 2), Math.cos(pitch / 2)]
    const [sy, cy] = [Math.sin(yaw / 2), Math.cos(yaw / 2)]
    const expected = [
      sr * cp * cy - cr * sp * sy,
      cr * sp * cy + sr * cp * sy,
      cr * cp * sy - sr * sp * cy,
      cr * cp * cy + sr * sp * sy,
    ]

    quaternion.forEach((entry, index) => {
      expect(entry).toBeCloseTo(expected[index]!, 12)
    })
    const output = quaternionToRpy(quaternion)
    expect(output[0]).toBeCloseTo(input[0], 10)
    expect(output[1]).toBeCloseTo(input[1], 10)
    expect(output[2]).toBeCloseTo(input[2], 10)
  })

  it('rejects scale-bearing frame transforms and emits identity scale', () => {
    expect(() =>
      serializableTransformToPose3D({
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        scale: [1, 2, 1],
      }),
    ).toThrow(/scale/i)

    expect(pose3DToSerializableTransform(PARENT).scale).toEqual([1, 1, 1])
  })
})
