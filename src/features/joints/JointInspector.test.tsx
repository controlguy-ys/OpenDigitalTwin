import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CRB15000_DEFINITION } from '../../domain/robot/crb15000'
import { SimulationJointSource } from './SimulationJointSource'
import { JointInspector } from './JointInspector'
import { useRobotStore } from './robot-store'

describe('JointInspector', () => {
  beforeEach(() => {
    useRobotStore.getState().reset()
  })

  it('clamps J3 numeric editing to the manifest and stops playback', () => {
    const source = new SimulationJointSource()
    const setAngles = vi.spyOn(source, 'setAngles')
    const unsubscribe = source.subscribe((frame) => {
      useRobotStore.getState().applyFrame(frame)
    })
    useRobotStore.getState().setPlaying(true)
    const initialRevision = useRobotStore.getState().playbackResetRevision
    render(<JointInspector source={source} />)

    const j3Input = screen.getByRole('spinbutton', { name: 'J3' })
    fireEvent.change(j3Input, { target: { value: '-226' } })

    expect(j3Input).toHaveValue(-226)
    expect(useRobotStore.getState().anglesDeg).toEqual([0, 0, 0, 0, 0, 0])

    fireEvent.blur(j3Input)

    expect(j3Input).toHaveValue(-225)
    expect(useRobotStore.getState().anglesDeg).toEqual([
      0, 0, -225, 0, 0, 0,
    ])
    expect(useRobotStore.getState().playing).toBe(false)
    expect(useRobotStore.getState().playbackResetRevision).toBe(
      initialRevision + 1,
    )
    expect(setAngles).toHaveBeenLastCalledWith([0, 0, -225, 0, 0, 0])
    unsubscribe()
  })

  it('uses the exact manifest limits for all six range and number controls', () => {
    render(<JointInspector />)

    const ranges = screen.getAllByRole('slider')
    const numbers = screen.getAllByRole('spinbutton')
    expect(ranges).toHaveLength(6)
    expect(numbers).toHaveLength(6)

    for (const [index, definition] of CRB15000_DEFINITION.joints.entries()) {
      expect(ranges[index]).toHaveAttribute('min', String(definition.minDeg))
      expect(ranges[index]).toHaveAttribute('max', String(definition.maxDeg))
      expect(numbers[index]).toHaveAttribute('min', String(definition.minDeg))
      expect(numbers[index]).toHaveAttribute('max', String(definition.maxDeg))
    }
  })

  it('publishes a numeric draft only once when Enter commits it', async () => {
    const user = userEvent.setup()
    const source = new SimulationJointSource()
    const setAngles = vi.spyOn(source, 'setAngles')
    const unsubscribe = source.subscribe((frame) => {
      useRobotStore.getState().applyFrame(frame)
    })
    render(<JointInspector source={source} />)

    const j1Input = screen.getByRole('spinbutton', { name: 'J1' })
    await user.click(j1Input)
    expect(j1Input).toHaveFocus()
    fireEvent.change(j1Input, { target: { value: '42' } })
    await user.keyboard('{Enter}')

    expect(setAngles).toHaveBeenCalledTimes(1)
    expect(useRobotStore.getState().anglesDeg[0]).toBe(42)
    unsubscribe()
  })

  it('publishes Home and Reset through the simulation source', async () => {
    const user = userEvent.setup()
    const source = new SimulationJointSource()
    const receivedFrames = vi.fn()
    const qualitiesAtPublish: string[] = []
    const publishAngles = source.setAngles.bind(source)
    vi.spyOn(source, 'setAngles').mockImplementation((anglesDeg, timestampMs) => {
      qualitiesAtPublish.push(useRobotStore.getState().sourceQuality)
      return publishAngles(anglesDeg, timestampMs)
    })
    const unsubscribe = source.subscribe((frame) => {
      receivedFrames(frame)
      useRobotStore.getState().applyFrame(frame)
    })
    vi.spyOn(Date, 'now').mockReturnValue(1234)
    useRobotStore.getState().setJoint(0, 90)
    useRobotStore.getState().setPlaying(true)
    useRobotStore.getState().setGripperOpen(false)
    useRobotStore.getState().savePose()

    render(<JointInspector source={source} />)
    await user.click(screen.getByRole('button', { name: 'Home' }))

    expect(receivedFrames).toHaveBeenLastCalledWith({
      anglesDeg: [0, 0, 0, 0, 0, 0],
      quality: 'GOOD',
      timestampMs: 1234,
    })
    expect(useRobotStore.getState()).toMatchObject({
      anglesDeg: [0, 0, 0, 0, 0, 0],
      playing: false,
      gripperOpen: false,
    })

    useRobotStore.getState().setJoint(0, 45)
    useRobotStore.getState().setPlaying(true)
    useRobotStore.setState({ sourceQuality: 'BAD' })
    await user.click(screen.getByRole('button', { name: 'Reset' }))

    expect(receivedFrames).toHaveBeenCalledTimes(2)
    expect(qualitiesAtPublish).toEqual(['GOOD', 'BAD'])
    expect(useRobotStore.getState()).toMatchObject({
      anglesDeg: [0, 0, 0, 0, 0, 0],
      playing: false,
      gripperOpen: true,
      keyframes: [],
    })
    unsubscribe()
  })

  it('saves poses and opens or closes the gripper', async () => {
    const user = userEvent.setup()
    useRobotStore.getState().setJoint(5, 30)
    render(<JointInspector />)

    await user.click(screen.getByRole('button', { name: 'Save Pose' }))
    expect(useRobotStore.getState().keyframes).toHaveLength(1)
    expect(useRobotStore.getState().keyframes[0]?.anglesDeg).toEqual([
      0, 0, 0, 0, 0, 30,
    ])

    await user.click(screen.getByRole('button', { name: 'Close Gripper' }))
    expect(useRobotStore.getState().gripperOpen).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Open Gripper' }))
    expect(useRobotStore.getState().gripperOpen).toBe(true)
  })

  it('disables every scene-dependent inspector control', () => {
    render(<JointInspector disabled />)

    for (const control of [
      ...screen.getAllByRole('slider'),
      ...screen.getAllByRole('spinbutton'),
      screen.getByRole('button', { name: 'Home' }),
      screen.getByRole('button', { name: 'Reset' }),
      screen.getByRole('button', { name: 'Save Pose' }),
      screen.getByRole('button', { name: 'Open Gripper' }),
      screen.getByRole('button', { name: 'Close Gripper' }),
    ]) {
      expect(control).toBeDisabled()
    }
  })
})
