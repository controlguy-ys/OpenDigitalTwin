import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  validateWorkcellProjectV4,
  type RobotJobStepV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import type { JobCommandServiceV4 } from '../../jobs/v4/job-command-service.js'
import { createJobRuntimeStoreV4 } from '../../jobs/v4/job-runtime-store.js'
import type { RobotJobPlaybackControllerV4 } from '../../jobs/v4/simulation-clock.js'
import { TimelineV4 } from './Timeline.js'
import type { JobOperatorServiceV4 } from '../../jobs/v4/job-operator-service.js'

function pose(speedPercentToNext: number): RobotJobStepV4 {
  return {
    kind: 'joint-pose',
    jointValues: { 'prismatic:Z': 0.2 },
    speedPercentToNext,
  }
}

function projectFixture(): WorkcellProjectV4 {
  const source = structuredClone(makeMinimalWorkcellProjectV4())
  const definition = source.robotDefinitions[0]!
  const robotDefinitions = [{
    ...definition,
    joints: definition.joints.map((joint) => ({ ...joint, id: 'prismatic:Z' })),
  }]
  const template = {
    ...source.robots[0]!,
    initialJointValues: { 'prismatic:Z': 0 },
  }
  return validateWorkcellProjectV4({
    ...source,
    robotDefinitions,
    robots: [
      { ...template, id: 'robot-A', name: 'Robot Alpha' },
      { ...template, id: 'robot-B', name: 'Robot Beta' },
    ],
    actions: [{
      id: 'action:open:α',
      kind: 'set-gripper-state',
      robotId: 'robot-A',
      state: 'OPEN',
    }],
    jobs: [
      {
        id: 'job-A',
        name: 'Alpha Sequence',
        robotId: 'robot-A',
        steps: [pose(35), { kind: 'action-reference', actionId: 'action:open:α' }, pose(100)],
      },
      { id: 'job-B', name: 'Beta Sequence', robotId: 'robot-B', steps: [pose(100)] },
    ],
  })
}

function commands(): JobCommandServiceV4 {
  return {
    createJob: vi.fn(async () => 'unused'),
    renameJob: vi.fn(async () => undefined),
    duplicateJob: vi.fn(async () => 'unused'),
    deleteJob: vi.fn(async () => undefined),
    saveJointPose: vi.fn(async () => undefined),
    addActionReference: vi.fn(async () => undefined),
    moveStep: vi.fn(async () => undefined),
    deleteStep: vi.fn(async () => undefined),
    setJointPoseSpeed: vi.fn(async () => undefined),
  }
}

function playback() {
  return {
    startJob: vi.fn((_jobId: string) => ({ runId: 'run-new' })),
    cancelRobotJob: vi.fn((_robotId: string, _reason: string) => undefined),
    ensureRunning: vi.fn(),
    quiesce: vi.fn(async () => undefined),
    resume: vi.fn(),
    dispose: vi.fn(),
  } satisfies RobotJobPlaybackControllerV4
}

function harness() {
  const project = projectFixture()
  const jobs = createJobRuntimeStoreV4()
  jobs.getState().replaceProject(project)
  return { project, jobs, commands: commands(), playback: playback() }
}

function runningRobotState() {
  return {
    robotId: 'robot-A',
    jobId: 'job-A',
    runId: 'run-A',
    state: 'RUNNING' as const,
    stepIndex: 0,
    startedAtSimulationMs: 0,
    completedAtSimulationMs: null,
    failureCode: null,
    message: '',
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TimelineV4', () => {
  it('renders stored Joint-Pose and Action-reference order with runtime cursor and state', () => {
    const state = harness()
    state.jobs.getState().setRobotState({
      robotId: 'robot-A',
      jobId: 'job-A',
      runId: 'run-A',
      state: 'RUNNING',
      stepIndex: 1,
      startedAtSimulationMs: 10,
      completedAtSimulationMs: null,
      failureCode: null,
      message: 'Executing Action',
    })
    render(<TimelineV4 {...state} jobId="job-A" robotId="robot-A" />)

    const steps = within(screen.getByRole('list', { name: 'Job steps' })).getAllByRole('listitem')
    expect(steps).toHaveLength(3)
    expect(steps[0]).toHaveTextContent('Step 1')
    expect(steps[0]).toHaveTextContent('Joint Pose')
    expect(steps[1]).toHaveTextContent('Step 2')
    expect(steps[1]).toHaveTextContent('Action action:open:α')
    expect(steps[1]).toHaveAttribute('aria-current', 'step')
    expect(steps[2]).toHaveTextContent('Step 3')
    expect(screen.getByRole('status', { name: 'Timeline runtime' }))
      .toHaveTextContent('RUNNING')
    expect(screen.getByRole('status', { name: 'Timeline runtime' }))
      .toHaveTextContent('Step 2 of 3')
  })

  it('routes move and delete commands by the exact stored step index', async () => {
    const user = userEvent.setup()
    const state = harness()
    render(<TimelineV4 {...state} jobId="job-A" robotId="robot-A" />)

    await user.click(screen.getByRole('button', { name: 'Move step 2 up' }))
    expect(state.commands.moveStep).toHaveBeenCalledWith('job-A', 1, -1)

    await user.click(screen.getByRole('button', { name: 'Move step 2 down' }))
    expect(state.commands.moveStep).toHaveBeenCalledWith('job-A', 1, 1)

    await user.click(screen.getByRole('button', { name: 'Delete step 2' }))
    expect(state.commands.deleteStep).toHaveBeenCalledWith('job-A', 1)
  })

  it('edits speed only when a later Joint Pose exists across intervening Actions', () => {
    const state = harness()
    render(<TimelineV4 {...state} jobId="job-A" robotId="robot-A" />)

    const firstSpeed = screen.getByRole('spinbutton', {
      name: 'Step 1 speed to next Joint Pose',
    })
    expect(firstSpeed).toBeEnabled()
    expect(firstSpeed).toHaveValue(35)
    expect(screen.queryByRole('spinbutton', {
      name: 'Step 2 speed to next Joint Pose',
    })).not.toBeInTheDocument()
    expect(screen.getByRole('spinbutton', {
      name: 'Step 3 speed to next Joint Pose',
    })).toBeDisabled()

    fireEvent.change(firstSpeed, { target: { value: '67' } })
    expect(state.commands.setJointPoseSpeed).toHaveBeenCalledWith('job-A', 0, 67)
  })

  it('locks the running Robot but leaves an unrelated Robot Timeline authorable and startable', async () => {
    const user = userEvent.setup()
    const state = harness()
    act(() => {
      state.jobs.getState().setRobotState({
        robotId: 'robot-A',
        jobId: 'job-A',
        runId: 'run-A',
        state: 'RUNNING',
        stepIndex: 0,
        startedAtSimulationMs: 0,
        completedAtSimulationMs: null,
        failureCode: null,
        message: '',
      })
    })
    render(
      <>
        <section aria-label="Alpha timeline">
          <TimelineV4 {...state} jobId="job-A" robotId="robot-A" />
        </section>
        <section aria-label="Beta timeline">
          <TimelineV4 {...state} jobId="job-B" robotId="robot-B" />
        </section>
      </>,
    )
    const alpha = within(screen.getByRole('region', { name: 'Alpha timeline' }))
    const beta = within(screen.getByRole('region', { name: 'Beta timeline' }))

    expect(alpha.getByRole('button', { name: 'Start Job' })).toBeDisabled()
    expect(alpha.getByRole('button', { name: 'Stop Job' })).toBeEnabled()
    expect(alpha.getByRole('button', { name: 'Delete step 1' })).toBeDisabled()
    expect(beta.getByRole('button', { name: 'Start Job' })).toBeEnabled()
    expect(beta.getByRole('button', { name: 'Delete step 1' })).toBeEnabled()

    await user.click(beta.getByRole('button', { name: 'Start Job' }))
    expect(state.playback.startJob).toHaveBeenCalledWith('job-B')
    await user.click(alpha.getByRole('button', { name: 'Stop Job' }))
    expect(state.playback.cancelRobotJob).toHaveBeenCalledWith('robot-A', expect.any(String))
  })

  it('shows terminal state and safely rejects a Job owned by another Robot', () => {
    const state = harness()
    const view = render(<TimelineV4 {...state} jobId="job-A" robotId="robot-A" />)
    act(() => {
      state.jobs.getState().setRobotState({
        robotId: 'robot-A',
        jobId: 'job-A',
        runId: 'run-A',
        state: 'FAILED',
        stepIndex: 2,
        startedAtSimulationMs: 0,
        completedAtSimulationMs: 90,
        failureCode: 'ACTION_FAILED',
        message: 'Gripper unavailable',
      })
    })
    expect(screen.getByRole('status', { name: 'Timeline runtime' }))
      .toHaveTextContent('FAILED')
    expect(screen.getByRole('status', { name: 'Timeline runtime' }))
      .toHaveTextContent('Gripper unavailable')

    view.rerender(<TimelineV4 {...state} jobId="job-B" robotId="robot-A" />)
    expect(screen.getByText('No Job selected for this Robot.')).toBeVisible()
    expect(screen.queryByRole('list', { name: 'Job steps' })).not.toBeInTheDocument()
  })

  it('uses the injected playback boundary without browser frame scheduling or interpolation', async () => {
    const user = userEvent.setup()
    const state = harness()
    const requestFrame = vi.fn()
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    render(<TimelineV4 {...state} jobId="job-A" robotId="robot-A" />)

    await user.click(screen.getByRole('button', { name: 'Start Job' }))
    expect(state.playback.startJob).toHaveBeenCalledWith('job-A')
    expect(requestFrame).not.toHaveBeenCalled()
  })

  it.each(['speed', 'move', 'delete', 'start'] as const)(
    'rechecks latest Robot runtime before a stale IDLE-render %s event',
    (operation) => {
      const state = harness()
      render(<TimelineV4 {...state} jobId="job-A" robotId="robot-A" />)

      let target: HTMLElement
      if (operation === 'speed') {
        target = screen.getByRole('spinbutton', {
          name: 'Step 1 speed to next Joint Pose',
        })
        target.addEventListener('change', () => {
          state.jobs.getState().setRobotState(runningRobotState())
        }, { capture: true, once: true })
        fireEvent.change(target, { target: { value: '55' } })
      } else {
        target = screen.getByRole('button', {
          name: operation === 'move'
            ? 'Move step 2 up'
            : operation === 'delete'
              ? 'Delete step 2'
              : 'Start Job',
        })
        target.addEventListener('click', () => {
          state.jobs.getState().setRobotState(runningRobotState())
        }, { capture: true, once: true })
        fireEvent.click(target)
      }

      expect(state.commands.setJointPoseSpeed).not.toHaveBeenCalled()
      expect(state.commands.moveStep).not.toHaveBeenCalled()
      expect(state.commands.deleteStep).not.toHaveBeenCalled()
      expect(state.playback.startJob).not.toHaveBeenCalled()
    },
  )

  it('rechecks terminal runtime before a stale RUNNING-render Stop event', () => {
    const state = harness()
    state.jobs.getState().setRobotState(runningRobotState())
    render(<TimelineV4 {...state} jobId="job-A" robotId="robot-A" />)
    const stop = screen.getByRole('button', { name: 'Stop Job' })
    stop.addEventListener('click', () => {
      state.jobs.getState().setRobotState({
        ...runningRobotState(),
        state: 'SUCCEEDED',
        completedAtSimulationMs: 10,
      })
    }, { capture: true, once: true })

    fireEvent.click(stop)

    expect(state.playback.cancelRobotJob).not.toHaveBeenCalled()
  })

  it('blocks stale selected Job handlers after the runtime Project revision advances', () => {
    const state = harness()
    render(<TimelineV4 {...state} jobId="job-A" robotId="robot-A" />)
    const start = screen.getByRole('button', { name: 'Start Job' })
    start.addEventListener('click', () => {
      state.jobs.getState().replaceProject({
        ...state.project,
        revisionId: 'revision-after-render',
      })
    }, { capture: true, once: true })

    fireEvent.click(start)

    expect(state.playback.startJob).not.toHaveBeenCalled()
  })

  it('blocks synchronous authoring reentry before pending state renders', async () => {
    const state = harness()
    let moveButton: HTMLElement
    const moveStep = vi.fn(async () => {
      if (moveStep.mock.calls.length === 1) fireEvent.click(moveButton)
    })
    state.commands.moveStep = moveStep
    render(<TimelineV4 {...state} jobId="job-A" robotId="robot-A" />)
    moveButton = screen.getByRole('button', { name: 'Move step 2 up' })

    fireEvent.click(moveButton)

    await waitFor(() => expect(moveStep).toHaveBeenCalledTimes(1))
  })

  it.each(['speed', 'delete'] as const)(
    'blocks synchronous %s authoring reentry before pending state renders',
    async (operation) => {
      const state = harness()
      let target: HTMLElement
      const setJointPoseSpeed = vi.fn(async () => {
        if (operation === 'speed' && setJointPoseSpeed.mock.calls.length === 1) {
          fireEvent.change(target, { target: { value: '55' } })
        }
      })
      const deleteStep = vi.fn(async () => {
        if (operation === 'delete' && deleteStep.mock.calls.length === 1) {
          fireEvent.click(target)
        }
      })
      state.commands.setJointPoseSpeed = setJointPoseSpeed
      state.commands.deleteStep = deleteStep
      render(<TimelineV4 {...state} jobId="job-A" robotId="robot-A" />)

      if (operation === 'speed') {
        target = screen.getByRole('spinbutton', {
          name: 'Step 1 speed to next Joint Pose',
        })
        fireEvent.change(target, { target: { value: '55' } })
      } else {
        target = screen.getByRole('button', { name: 'Delete step 2' })
        fireEvent.click(target)
      }

      const selectedCommand = operation === 'speed' ? setJointPoseSpeed : deleteStep
      await waitFor(() => expect(selectedCommand).toHaveBeenCalledTimes(1))
    },
  )

  it.each(['start', 'stop'] as const)(
    'blocks synchronous %s playback reentry before runtime publication',
    (operation) => {
      const state = harness()
      if (operation === 'stop') state.jobs.getState().setRobotState(runningRobotState())
      let target: HTMLElement
      state.playback.startJob.mockImplementation((_jobId: string) => {
        if (state.playback.startJob.mock.calls.length === 1) fireEvent.click(target)
        return { runId: 'run-new' }
      })
      state.playback.cancelRobotJob.mockImplementation((_robotId: string, _reason: string) => {
        if (state.playback.cancelRobotJob.mock.calls.length === 1) fireEvent.click(target)
      })
      render(<TimelineV4 {...state} jobId="job-A" robotId="robot-A" />)
      target = screen.getByRole('button', {
        name: operation === 'start' ? 'Start Job' : 'Stop Job',
      })

      fireEvent.click(target)

      const selectedPlayback = operation === 'start'
        ? state.playback.startJob
        : state.playback.cancelRobotJob
      expect(selectedPlayback).toHaveBeenCalledTimes(1)
    },
  )

  it('blocks Start during same-batch authoring', async () => {
    const state = harness()
    let startButton: HTMLElement
    const setJointPoseSpeed = vi.fn(async () => {
      fireEvent.click(startButton)
    })
    state.commands.setJointPoseSpeed = setJointPoseSpeed
    render(<TimelineV4 {...state} jobId="job-A" robotId="robot-A" />)
    startButton = screen.getByRole('button', { name: 'Start Job' })

    fireEvent.change(screen.getByRole('spinbutton', {
      name: 'Step 1 speed to next Joint Pose',
    }), { target: { value: '55' } })

    await waitFor(() => expect(setJointPoseSpeed).toHaveBeenCalledOnce())
    expect(state.playback.startJob).not.toHaveBeenCalled()
  })

  it('delegates explicit Start and Stop actions through an injected Job operator', async () => {
    const user = userEvent.setup()
    const state = harness()
    const operator: JobOperatorServiceV4 = {
      canStart: vi.fn(() => true),
      start: vi.fn(async () => undefined),
      canCancel: vi.fn(() => false),
      cancel: vi.fn(async () => undefined),
    }
    render(<TimelineV4 {...state} jobId="job-A" jobOperator={operator} robotId="robot-A" />)
    await user.click(screen.getByRole('button', { name: 'Start Job' }))
    expect(operator.start).toHaveBeenCalledWith('robot-A', 'job-A')
  })
})
