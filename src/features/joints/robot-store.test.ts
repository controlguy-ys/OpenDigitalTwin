import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JointFrame } from '../../domain/robot/joint-frame'
import { SimulationJointSource } from './SimulationJointSource'
import { jointAngleSelectors, useRobotStore } from './robot-store'

const GOOD_ZERO_FRAME: JointFrame = {
  anglesDeg: [0, 0, 0, 0, 0, 0],
  timestampMs: 1,
  quality: 'GOOD',
}

describe('robot store', () => {
  beforeEach(() => {
    localStorage.clear()
    useRobotStore.getState().reset()
  })

  it('clamps a single joint command while preserving the other joints', () => {
    useRobotStore.getState().setJoint(2, -999)
    useRobotStore.getState().setJoint(0, 10)

    expect(useRobotStore.getState().anglesDeg).toEqual([10, 0, -225, 0, 0, 0])
  })

  it('applies valid frames and holds the pose while stopping on bad data', () => {
    const store = useRobotStore.getState()
    store.applyFrame(
      { anglesDeg: [999, 20, 30, 40, 50, 60], timestampMs: 1000, quality: 'GOOD' },
      1000,
    )
    store.setPlaying(true)
    useRobotStore.getState().applyFrame(
      { anglesDeg: [0, 0, 0, 0, 0, 0], timestampMs: 1001, quality: 'BAD' },
      1001,
    )

    expect(useRobotStore.getState()).toMatchObject({
      anglesDeg: [270, 20, 30, 40, 50, 60],
      sourceQuality: 'BAD',
      playing: false,
    })
  })

  it('rejects an invalid frame without changing state', () => {
    const before = useRobotStore.getState()
    const invalid = {
      ...GOOD_ZERO_FRAME,
      anglesDeg: [0, 0, Number.NaN, 0, 0, 0],
    } as JointFrame

    expect(() => before.applyFrame(invalid, 1)).toThrow('finite')
    expect(useRobotStore.getState()).toBe(before)
  })

  it('homes only the pose and reset restores transient controls', () => {
    const store = useRobotStore.getState()
    store.setJoint(0, 90)
    store.setPlaying(true)
    store.setGripperOpen(false)
    store.home()

    expect(useRobotStore.getState()).toMatchObject({
      anglesDeg: [0, 0, 0, 0, 0, 0],
      playing: true,
      gripperOpen: false,
    })

    useRobotStore.getState().reset()
    expect(useRobotStore.getState()).toMatchObject({
      anglesDeg: [0, 0, 0, 0, 0, 0],
      sourceQuality: 'GOOD',
      lastFrameTimestampMs: null,
      playing: false,
      gripperOpen: true,
    })
  })

  it('provides stable scalar selectors and action references', () => {
    const setJoint = useRobotStore.getState().setJoint
    useRobotStore.getState().setJoint(5, 45)

    expect(jointAngleSelectors.map((selector) => selector(useRobotStore.getState()))).toEqual([
      0, 0, 0, 0, 0, 45,
    ])
    expect(useRobotStore.getState().setJoint).toBe(setJoint)
  })

  it('saves immutable pose snapshots and clears them on reset', () => {
    const store = useRobotStore.getState()
    store.setJoint(0, 45)
    store.savePose()
    useRobotStore.getState().setJoint(0, 90)
    useRobotStore.getState().savePose()

    expect(useRobotStore.getState().keyframes).toEqual([
      {
        id: 'pose-1',
        name: 'Pose 1',
        anglesDeg: [45, 0, 0, 0, 0, 0],
        durationMs: 250,
        easing: 'easeInOut',
        speedPercentToNext: 100,
      },
      {
        id: 'pose-2',
        name: 'Pose 2',
        anglesDeg: [90, 0, 0, 0, 0, 0],
        durationMs: 1000,
        easing: 'easeInOut',
        speedPercentToNext: 100,
      },
    ])

    useRobotStore.getState().reset()
    expect(useRobotStore.getState().keyframes).toEqual([])
  })

  it('reorders and deletes poses by stable id', () => {
    const store = useRobotStore.getState()
    store.savePose()
    store.setJoint(0, 10)
    useRobotStore.getState().savePose()
    useRobotStore.getState().setJoint(0, 20)
    useRobotStore.getState().savePose()

    useRobotStore.getState().moveKeyframe('pose-3', -1)
    expect(useRobotStore.getState().keyframes.map((pose) => pose.id)).toEqual([
      'pose-1',
      'pose-3',
      'pose-2',
    ])

    useRobotStore.getState().deleteKeyframe('pose-1')
    expect(useRobotStore.getState().keyframes.map((pose) => pose.id)).toEqual([
      'pose-3',
      'pose-2',
    ])
  })

  it('clamps pose speed and updates its outgoing transition duration', () => {
    useRobotStore.getState().savePose()
    useRobotStore.getState().setJoint(0, 90)
    useRobotStore.getState().savePose()

    useRobotStore.getState().setKeyframeSpeed('pose-1', 50)
    expect(useRobotStore.getState().keyframes[0]).toMatchObject({
      speedPercentToNext: 50,
      durationMs: 1000,
    })

    useRobotStore.getState().setKeyframeSpeed('pose-1', 0)
    expect(useRobotStore.getState().keyframes[0]).toMatchObject({
      speedPercentToNext: 1,
      durationMs: 50000,
    })
  })

  it('hydrates the edited pose order and speed from browser storage', () => {
    useRobotStore.getState().savePose()
    useRobotStore.getState().setJoint(0, 20)
    useRobotStore.getState().savePose()
    useRobotStore.getState().setKeyframeSpeed('pose-1', 25)
    useRobotStore.getState().moveKeyframe('pose-2', -1)

    useRobotStore.getState().reset()
    useRobotStore.getState().hydrateKeyframes()

    expect(useRobotStore.getState().keyframes.map((pose) => pose.id)).toEqual([
      'pose-2',
      'pose-1',
    ])
    expect(useRobotStore.getState().keyframes[1]).toMatchObject({
      speedPercentToNext: 25,
    })
    expect(useRobotStore.getState().keyframes[1]?.durationMs).toBeCloseTo(
      444.444,
      2,
    )
  })

  it('projects published Project Job poses without creating legacy browser durability', () => {
    useRobotStore.getState().replacePublishedKeyframes([{
      id: 'project-pose',
      name: 'Project Pose',
      anglesDeg: [1, 2, 3, 4, 5, 6],
      durationMs: 1_000,
      easing: 'linear',
      speedPercentToNext: 100,
    }])

    expect(useRobotStore.getState().keyframes.map(({ id }) => id)).toEqual(['project-pose'])
    expect(localStorage.getItem('robot-sim.pose-sequence.v1')).toBeNull()
  })

  it('distinguishes a stop-time reset from a resumable pause', () => {
    const initialRevision = useRobotStore.getState().playbackResetRevision
    useRobotStore.getState().setPlaying(true)
    useRobotStore.getState().setPlaying(false)
    expect(useRobotStore.getState().playbackResetRevision).toBe(initialRevision)

    useRobotStore.getState().stopPlayback()
    expect(useRobotStore.getState()).toMatchObject({
      playing: false,
      playbackResetRevision: initialRevision + 1,
    })
  })
})

describe('SimulationJointSource', () => {
  it('publishes a validated frame for each explicit setAngles call', async () => {
    const listener = vi.fn()
    const source = new SimulationJointSource()
    const unsubscribe = source.subscribe(listener)

    await source.connect()
    source.setAngles([10, 20, 30, 40, 50, 60], 1234)

    expect(source.mode).toBe('simulation')
    expect(listener).toHaveBeenCalledWith({
      anglesDeg: [10, 20, 30, 40, 50, 60],
      timestampMs: 1234,
      quality: 'GOOD',
    })

    unsubscribe()
    source.setAngles([0, 0, 0, 0, 0, 0], 1235)
    await source.disconnect()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('rejects non-finite simulation angles without publishing', () => {
    const listener = vi.fn()
    const source = new SimulationJointSource()
    source.subscribe(listener)

    expect(() => source.setAngles([0, 0, Number.NaN, 0, 0, 0], 1)).toThrow(
      'finite',
    )
    expect(listener).not.toHaveBeenCalled()
  })

  it('reports a malformed simulation tuple before attempting to publish it', () => {
    const listener = vi.fn()
    const source = new SimulationJointSource()
    source.subscribe(listener)

    expect(() => source.setAngles([0, 0, 0] as never, 1)).toThrow(
      'exactly six',
    )
    expect(listener).not.toHaveBeenCalled()
  })
})
