import { describe, expect, it } from 'vitest'
import { CRB15000_DEFINITION } from './crb15000'
import {
  clampJointAngles,
  initialRobotState,
  reduceJointFrame,
  validateJointFrame,
  type JointAnglesDeg,
  type JointFrame,
} from './joint-frame'

function goodFrame(
  anglesDeg: JointAnglesDeg,
  timestampMs: number,
): JointFrame {
  return { anglesDeg, timestampMs, quality: 'GOOD' }
}

describe('joint frame contract', () => {
  it('rejects malformed joint tuples before state changes', () => {
    const stateBefore = { ...initialRobotState }

    expect(() =>
      validateJointFrame({
        anglesDeg: [0, 0, 0] as never,
        timestampMs: 1,
        quality: 'GOOD',
      }),
    ).toThrow('exactly six')
    expect(() =>
      validateJointFrame({
        anglesDeg: [0, 0, Number.NaN, 0, 0, 0],
        timestampMs: 1,
        quality: 'GOOD',
      }),
    ).toThrow('finite')
    expect(initialRobotState).toEqual(stateBefore)
  })

  it('rejects non-finite timestamps and unsupported quality values', () => {
    expect(() =>
      validateJointFrame({
        ...goodFrame([0, 0, 0, 0, 0, 0], Number.POSITIVE_INFINITY),
      }),
    ).toThrow('timestamp')
    expect(() =>
      validateJointFrame({
        ...goodFrame([0, 0, 0, 0, 0, 0], 1),
        quality: 'UNKNOWN' as never,
      }),
    ).toThrow('quality')
  })

  it('clamps each angle to the exact manifest limit without mutating input', () => {
    const angles: JointAnglesDeg = [999, -999, 999, -999, 999, -999]

    expect(clampJointAngles(angles, CRB15000_DEFINITION)).toEqual([
      270, -180, 85, -180, 180, -270,
    ])
    expect(angles).toEqual([999, -999, 999, -999, 999, -999])
  })

  it('holds the last good pose when a frame is bad or older than 1000 ms', () => {
    const state = reduceJointFrame(
      initialRobotState,
      goodFrame([10, 20, 30, 40, 50, 60], 1000),
      1000,
    )
    const badState = reduceJointFrame(
      { ...state, playing: true },
      { ...goodFrame([0, 0, 0, 0, 0, 0], 1001), quality: 'BAD' },
      1001,
    )
    const staleState = reduceJointFrame(
      { ...state, playing: true },
      goodFrame([0, 0, 0, 0, 0, 0], 1000),
      2001,
    )

    expect(badState.anglesDeg).toEqual(state.anglesDeg)
    expect(badState.sourceQuality).toBe('BAD')
    expect(badState.playing).toBe(false)
    expect(staleState.anglesDeg).toEqual(state.anglesDeg)
    expect(staleState.sourceQuality).toBe('STALE')
    expect(staleState.playing).toBe(false)
  })

  it('accepts a frame exactly 1000 ms old and records uncertain quality', () => {
    const frame: JointFrame = {
      anglesDeg: [300, 20, 30, 40, 50, 60],
      timestampMs: 1000,
      quality: 'UNCERTAIN',
    }

    expect(reduceJointFrame(initialRobotState, frame, 2000)).toEqual({
      anglesDeg: [270, 20, 30, 40, 50, 60],
      sourceQuality: 'UNCERTAIN',
      lastFrameTimestampMs: 1000,
      playing: false,
    })
  })
})
