import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimulationJointSource } from '../joints/SimulationJointSource'
import type { RobotKeyframe } from '../joints/keyframes'
import { useRobotStore } from '../joints/robot-store'
import { Timeline } from './Timeline'
import type { JobCommandService } from '../jobs/job-command-service'

const START: RobotKeyframe = {
  id: 'start',
  name: 'Pose 1',
  anglesDeg: [0, 0, 0, 0, 0, 0],
  durationMs: 1000,
  easing: 'linear',
}

const END: RobotKeyframe = {
  id: 'end',
  name: 'Pose 2',
  anglesDeg: [100, 20, 0, 0, 0, 0],
  durationMs: 17,
  easing: 'linear',
}

let nextFrameId = 1
let frameCallbacks: Map<number, FrameRequestCallback>

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: hidden,
  })
}

function runNextFrame(timestampMs: number): FrameRequestCallback {
  const entry = frameCallbacks.entries().next().value as
    | [number, FrameRequestCallback]
    | undefined
  if (entry === undefined) {
    throw new Error('Expected one scheduled animation frame')
  }

  const [frameId, callback] = entry
  frameCallbacks.delete(frameId)
  act(() => {
    callback(timestampMs)
  })
  return callback
}

function loadTwoPoses(): void {
  useRobotStore.setState({ keyframes: [START, END] })
}

beforeEach(() => {
  useRobotStore.getState().reset()
  loadTwoPoses()
  nextFrameId = 1
  frameCallbacks = new Map()
  setDocumentHidden(false)
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      const frameId = nextFrameId
      nextFrameId += 1
      frameCallbacks.set(frameId, callback)
      return frameId
    }),
  )
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((frameId: number) => {
      frameCallbacks.delete(frameId)
    }),
  )
  vi.spyOn(Date, 'now').mockReturnValue(10_000)
})

afterEach(() => {
  setDocumentHidden(false)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Timeline', () => {
  it('plays, pauses, resumes, and stops without moving the pose on Stop', async () => {
    const user = userEvent.setup()
    const source = new SimulationJointSource()
    const receivedFrames = vi.fn()
    source.subscribe((frame) => {
      receivedFrames(frame)
      useRobotStore.getState().applyFrame(frame)
    })
    render(
      <StrictMode>
        <Timeline source={source} />
      </StrictMode>,
    )

    for (const name of ['Play', 'Pause', 'Stop']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('title', name)
    }

    await user.click(screen.getByRole('button', { name: 'Play' }))
    expect(useRobotStore.getState().playing).toBe(true)
    expect(frameCallbacks.size).toBe(1)

    runNextFrame(100)
    runNextFrame(600)
    expect(useRobotStore.getState().anglesDeg).toEqual([50, 10, 0, 0, 0, 0])
    expect(receivedFrames).toHaveBeenLastCalledWith({
      anglesDeg: [50, 10, 0, 0, 0, 0],
      quality: 'GOOD',
      timestampMs: 10_000,
    })

    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(useRobotStore.getState().playing).toBe(false)
    expect(frameCallbacks.size).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Play' }))
    runNextFrame(1000)
    runNextFrame(1250)
    expect(useRobotStore.getState().anglesDeg).toEqual([75, 15, 0, 0, 0, 0])

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(useRobotStore.getState().playing).toBe(false)
    expect(useRobotStore.getState().anglesDeg).toEqual([75, 15, 0, 0, 0, 0])
    expect(frameCallbacks.size).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Play' }))
    runNextFrame(2000)
    expect(useRobotStore.getState().anglesDeg).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('snapshots poses at Play and publishes the final pose exactly once', async () => {
    const user = userEvent.setup()
    const source = new SimulationJointSource()
    const setAngles = vi.spyOn(source, 'setAngles')
    source.subscribe((frame) => {
      useRobotStore.getState().applyFrame(frame)
    })
    render(<Timeline source={source} />)

    await user.click(screen.getByRole('button', { name: 'Play' }))
    useRobotStore.setState({
      keyframes: [
        { ...START, anglesDeg: [200, 0, 0, 0, 0, 0] },
        { ...END, anglesDeg: [250, 0, 0, 0, 0, 0] },
      ],
    })

    runNextFrame(0)
    const finalCallback = runNextFrame(1500)
    expect(useRobotStore.getState().anglesDeg).toEqual([100, 20, 0, 0, 0, 0])
    expect(useRobotStore.getState().playing).toBe(false)
    expect(frameCallbacks.size).toBe(0)
    expect(setAngles).toHaveBeenCalledTimes(2)

    act(() => {
      finalCallback(1600)
    })
    expect(setAngles).toHaveBeenCalledTimes(2)
  })

  it('continues the Play-time snapshot when live keyframes are cleared', async () => {
    const user = userEvent.setup()
    const source = new SimulationJointSource()
    const setAngles = vi.spyOn(source, 'setAngles')
    source.subscribe((frame) => {
      useRobotStore.getState().applyFrame(frame)
    })
    render(<Timeline source={source} />)

    await user.click(screen.getByRole('button', { name: 'Play' }))
    runNextFrame(0)
    act(() => {
      useRobotStore.setState({ keyframes: [] })
    })

    expect(useRobotStore.getState().playing).toBe(true)
    expect(frameCallbacks.size).toBe(1)
    runNextFrame(500)
    expect(useRobotStore.getState().anglesDeg).toEqual([50, 10, 0, 0, 0, 0])

    runNextFrame(1000)
    expect(useRobotStore.getState().anglesDeg).toEqual([100, 20, 0, 0, 0, 0])
    expect(useRobotStore.getState().playing).toBe(false)
    expect(frameCallbacks.size).toBe(0)
    expect(setAngles).toHaveBeenCalledTimes(3)
  })

  it('cancels for external setPlaying(false), bad quality, and a hidden document', async () => {
    const user = userEvent.setup()
    const source = new SimulationJointSource()
    render(<Timeline source={source} />)
    const play = screen.getByRole('button', { name: 'Play' })

    await user.click(play)
    act(() => {
      useRobotStore.getState().setPlaying(false)
    })
    expect(frameCallbacks.size).toBe(0)

    await user.click(play)
    act(() => {
      useRobotStore.getState().applyFrame({
        anglesDeg: [0, 0, 0, 0, 0, 0],
        quality: 'BAD',
        timestampMs: 10_000,
      })
    })
    expect(useRobotStore.getState().playing).toBe(false)
    expect(frameCallbacks.size).toBe(0)
    expect(play).toBeDisabled()

    act(() => {
      useRobotStore.getState().reset()
      loadTwoPoses()
    })
    await user.click(play)
    setDocumentHidden(true)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(useRobotStore.getState().playing).toBe(false)
    expect(frameCallbacks.size).toBe(0)
  })

  it('disables playback until two good, ready poses exist', () => {
    const source = new SimulationJointSource()
    useRobotStore.setState({ keyframes: [START] })
    const { rerender } = render(<Timeline source={source} />)

    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()

    loadTwoPoses()
    rerender(<Timeline disabled source={source} />)
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()
  })

  it('submits durable pose order, outgoing speed, and deletion commands', async () => {
    const user = userEvent.setup()
    const commands = {
      movePose: vi.fn(async () => undefined),
      setPoseSpeed: vi.fn(async () => undefined),
      deletePose: vi.fn(async () => undefined),
    } as unknown as JobCommandService
    render(
      <Timeline
        activeJobId="job-a"
        commands={commands}
        source={new SimulationJointSource()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Move Pose 2 up' }))
    expect(commands.movePose).toHaveBeenCalledWith('job-a', 'end', 0)

    const speed = screen.getByRole('spinbutton', {
      name: 'Pose 1 speed to next pose',
    })
    fireEvent.change(speed, { target: { value: '40' } })
    expect(commands.setPoseSpeed).toHaveBeenCalledWith('job-a', 'start', 40)

    await user.click(screen.getByRole('button', { name: 'Delete Pose 2' }))
    expect(commands.deletePose).toHaveBeenCalledWith('job-a', 'end')
  })

  it('resets a partial playback cursor when a nonempty Job publication replaces it', async () => {
    const user = userEvent.setup()
    const source = new SimulationJointSource()
    source.subscribe((frame) => useRobotStore.getState().applyFrame(frame))
    render(<Timeline activeJobId="job-a" source={source} />)

    await user.click(screen.getByRole('button', { name: 'Play' }))
    runNextFrame(0)
    runNextFrame(500)
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(useRobotStore.getState().anglesDeg[0]).toBe(50)

    act(() => {
      useRobotStore.getState().replacePublishedKeyframes([START, END])
    })
    await user.click(screen.getByRole('button', { name: 'Play' }))
    runNextFrame(1_000)

    expect(useRobotStore.getState().anglesDeg[0]).toBe(0)
  })

  it('awaits pose commands, prevents duplicate actions, and announces rejections', async () => {
    const user = userEvent.setup()
    let rejectDelete!: (error: Error) => void
    const commands = {
      movePose: vi.fn(async () => undefined),
      setPoseSpeed: vi.fn(async () => undefined),
      deletePose: vi.fn(() => new Promise<void>((_resolve, reject) => {
        rejectDelete = reject
      })),
    } as unknown as JobCommandService
    render(<Timeline activeJobId="job-a" commands={commands} />)

    const deletePose = screen.getByRole('button', { name: 'Delete Pose 2' })
    await user.click(deletePose)
    expect(deletePose).toBeDisabled()
    await user.click(deletePose)
    expect(commands.deletePose).toHaveBeenCalledTimes(1)

    rejectDelete(new Error('PROJECT_CONFLICT: Refresh and retry.'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'PROJECT_CONFLICT: Refresh and retry.',
    )
    await waitFor(() => expect(deletePose).toBeEnabled())
  })
})
