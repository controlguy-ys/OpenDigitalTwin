import { describe, expect, it } from 'vitest'
import type { JointAnglesDeg } from '../../domain/robot/joint-frame'
import {
  getTimelineDurationMs,
  sampleTimeline,
  type RobotKeyframe,
} from './keyframes'

function keyframe(
  id: string,
  anglesDeg: JointAnglesDeg,
  durationMs = 1000,
  easing: RobotKeyframe['easing'] = 'linear',
): RobotKeyframe {
  return {
    id,
    name: `Pose ${id}`,
    anglesDeg,
    durationMs,
    easing,
  }
}

describe('robot keyframe timeline', () => {
  it('linearly interpolates joint angles in degrees', () => {
    const sample = sampleTimeline(
      [
        keyframe('a', [0, 0, 0, 0, 0, 0]),
        keyframe('b', [100, 20, 0, 0, 0, 0]),
      ],
      500,
    )

    expect(sample?.anglesDeg).toEqual([50, 10, 0, 0, 0, 0])
  })

  it('sums outgoing transition durations and ignores the final duration', () => {
    expect(
      getTimelineDurationMs([
        keyframe('a', [0, 0, 0, 0, 0, 0], 250),
        keyframe('b', [10, 0, 0, 0, 0, 0], 750),
      ]),
    ).toBe(250)
  })

  it('rejects malformed angles and non-finite or non-positive durations', () => {
    for (const durationMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        getTimelineDurationMs([
          keyframe('invalid', [0, 0, 0, 0, 0, 0], durationMs),
        ]),
      ).toThrow('finite positive')
    }

    expect(() =>
      sampleTimeline(
        [keyframe('invalid', [0, 0, Number.NaN, 0, 0, 0])],
        0,
      ),
    ).toThrow('finite')
    expect(() =>
      sampleTimeline(
        [keyframe('invalid', [0, 0, 0] as never)],
        0,
      ),
    ).toThrow('exactly six')
    expect(() =>
      sampleTimeline([keyframe('a', [0, 0, 0, 0, 0, 0])], Number.NaN),
    ).toThrow('elapsed')
    expect(() =>
      sampleTimeline(
        [
          {
            ...keyframe('invalid', [0, 0, 0, 0, 0, 0]),
            easing: 'overshoot' as never,
          },
        ],
        0,
      ),
    ).toThrow('easing')
  })

  it('handles empty, single, start, and end boundaries exactly', () => {
    const first = keyframe('a', [10, 20, 30, 40, 50, 60], 250)
    const last = keyframe('b', [-10, -20, -30, -40, -50, -60], 750)

    expect(getTimelineDurationMs([])).toBe(0)
    expect(sampleTimeline([], 0)).toBeNull()
    expect(sampleTimeline([first], -50)?.anglesDeg).toEqual(first.anglesDeg)
    expect(sampleTimeline([first], 10_000)?.anglesDeg).toEqual(first.anglesDeg)
    expect(sampleTimeline([first, last], -50)?.anglesDeg).toEqual(first.anglesDeg)
    expect(sampleTimeline([first, last], 250)?.anglesDeg).toEqual(last.anglesDeg)
    expect(sampleTimeline([first, last], 251)?.anglesDeg).toEqual(last.anglesDeg)
    expect(sampleTimeline([first, last], 10_000)?.anglesDeg).toEqual(last.anglesDeg)
  })

  it('applies easeInOut without converting the degree values', () => {
    const sample = sampleTimeline(
      [
        keyframe('a', [0, 0, 0, 0, 0, 0], 1000, 'easeInOut'),
        keyframe('b', [80, 0, 0, 0, 0, 0]),
      ],
      250,
    )

    expect(sample?.anglesDeg[0]).toBeCloseTo(12.5)
  })
})
