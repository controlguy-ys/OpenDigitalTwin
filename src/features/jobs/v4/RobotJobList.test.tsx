import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  validateWorkcellProjectV4,
  type RobotJobStepV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { createInteractionStoreV4 } from '../../interaction/v4/interaction-store.js'
import type { JobCommandServiceV4 } from './job-command-service.js'
import { createJobRuntimeStoreV4 } from './job-runtime-store.js'
import type { RobotJobPlaybackControllerV4 } from './simulation-clock.js'
import { RobotJobListV4 } from './RobotJobList.js'
import type { JobOperatorServiceV4 } from './job-operator-service.js'
import type { UserPromptPortV4 } from '../../ui/v4/user-prompt-port.js'

function jointPose(speedPercentToNext = 100): RobotJobStepV4 {
  return {
    kind: 'joint-pose',
    jointValues: { 'axis.alpha:α': 0 },
    speedPercentToNext,
  }
}

function twoRobotProject(): WorkcellProjectV4 {
  const source = structuredClone(makeMinimalWorkcellProjectV4())
  const definition = source.robotDefinitions[0]!
  const robotDefinitions = [{
    ...definition,
    joints: definition.joints.map((joint) => ({ ...joint, id: 'axis.alpha:α' })),
  }]
  const template = {
    ...source.robots[0]!,
    initialJointValues: { 'axis.alpha:α': 0 },
  }
  return validateWorkcellProjectV4({
    ...source,
    robotDefinitions,
    robots: [
      { ...template, id: 'robot-A', name: 'Robot Alpha' },
      { ...template, id: 'robot-B', name: 'Robot Beta' },
    ],
    actions: [
      {
        id: 'action:A:open',
        kind: 'set-gripper-state',
        robotId: 'robot-A',
        state: 'OPEN',
      },
    ],
    jobs: [
      { id: 'job-B', name: 'Beta Job', robotId: 'robot-B', steps: [jointPose()] },
      {
        id: 'job-A-main',
        name: 'Alpha Main',
        robotId: 'robot-A',
        steps: [
          jointPose(30),
          { kind: 'action-reference', actionId: 'action:A:open' },
          jointPose(),
        ],
      },
      { id: 'job-A-empty', name: 'Alpha Empty', robotId: 'robot-A', steps: [] },
    ],
  })
}

function commandService(overrides: Partial<JobCommandServiceV4> = {}): JobCommandServiceV4 {
  return {
    createJob: vi.fn(async () => 'job-created'),
    renameJob: vi.fn(async () => undefined),
    duplicateJob: vi.fn(async () => 'job-duplicate'),
    deleteJob: vi.fn(async () => undefined),
    saveJointPose: vi.fn(async () => undefined),
    addActionReference: vi.fn(async () => undefined),
    moveStep: vi.fn(async () => undefined),
    deleteStep: vi.fn(async () => undefined),
    setJointPoseSpeed: vi.fn(async () => undefined),
    ...overrides,
  }
}

function playbackController() {
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
  const project = twoRobotProject()
  const interaction = createInteractionStoreV4()
  const jobs = createJobRuntimeStoreV4()
  interaction.getState().replaceProject(project)
  jobs.getState().replaceProject(project)
  return { project, interaction, jobs }
}

function runningRobotState(robotId = 'robot-A', jobId = 'job-A-main') {
  return {
    robotId,
    jobId,
    runId: `run-${robotId}`,
    state: 'RUNNING' as const,
    stepIndex: 0,
    startedAtSimulationMs: 5,
    completedAtSimulationMs: null,
    failureCode: null,
    message: '',
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RobotJobListV4', () => {
  it('offers explicit Active Robot activation when no Robot is available to the Job list', async () => {
    const user = userEvent.setup()
    const state = harness()
    render(
      <RobotJobListV4
        {...state}
        commands={commandService()}
        playback={playbackController()}
        selectedRobotId={null}
      />,
    )

    expect(screen.getByText('Select a Robot to view its Jobs.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Control Robot Beta' }))

    expect(state.interaction.getState().activeRobotId).toBe('robot-B')
  })

  it('activates a Job owner before opening its Job commands', async () => {
    const user = userEvent.setup()
    const state = harness()
    render(
      <RobotJobListV4
        {...state}
        commands={commandService()}
        playback={playbackController()}
        selectedRobotId="robot-B"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Beta Job commands' }))

    expect(state.interaction.getState().activeRobotId).toBe('robot-B')
    expect(state.interaction.getState().selectedJobIdsByRobotId.get('robot-B')).toBe('job-B')
    expect(screen.getByRole('menu', { name: 'Beta Job commands' })).toBeVisible()
  })

  it('shows only the selected Robot Jobs with total-step and Joint-Pose counts', () => {
    const state = harness()
    render(
      <RobotJobListV4
        {...state}
        commands={commandService()}
        playback={playbackController()}
        selectedRobotId="robot-A"
      />,
    )

    expect(screen.getByRole('treeitem', {
      name: 'Alpha Main, 3 steps, 2 Joint Poses',
    })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('treeitem', {
      name: 'Alpha Empty, 0 steps, 0 Joint Poses',
    })).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByText('Beta Job')).not.toBeInTheDocument()
  })

  it('creates for the selected Robot and selects the published Job ephemerally', async () => {
    const user = userEvent.setup()
    const state = harness()
    const projectBefore = state.project
    const published = validateWorkcellProjectV4({
      ...state.project,
      revisionId: 'revision-created',
      jobs: [...state.project.jobs, {
        id: 'job-created',
        name: 'Job 3',
        robotId: 'robot-A',
        steps: [],
      }],
    })
    const commands = commandService({
      createJob: vi.fn(async () => {
        state.interaction.getState().replaceProject(published)
        return 'job-created'
      }),
    })
    render(
      <RobotJobListV4
        {...state}
        commands={commands}
        playback={playbackController()}
        selectedRobotId="robot-A"
      />,
    )

    await user.click(screen.getByRole('button', { name: '+ New Job' }))

    expect(commands.createJob).toHaveBeenCalledWith('robot-A', 'Job 3')
    await waitFor(() => {
      expect(state.interaction.getState().selectedJobIdsByRobotId.get('robot-A'))
        .toBe('job-created')
    })
    expect(state.project).toBe(projectBefore)
    expect(state.project.jobs).toHaveLength(3)
  })

  it('preserves tree navigation and exact context rename, duplicate, and delete commands', async () => {
    const user = userEvent.setup()
    const state = harness()
    const commands = commandService()
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('Renamed Alpha')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <RobotJobListV4
        {...state}
        commands={commands}
        playback={playbackController()}
        selectedRobotId="robot-A"
      />,
    )
    const first = screen.getByRole('treeitem', {
      name: 'Alpha Main, 3 steps, 2 Joint Poses',
    })
    const second = screen.getByRole('treeitem', {
      name: 'Alpha Empty, 0 steps, 0 Joint Poses',
    })

    first.focus()
    await user.keyboard('{ArrowDown}')
    expect(second).toHaveFocus()
    await user.keyboard('{Home}')
    expect(first).toHaveFocus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus()
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(prompt).toHaveBeenCalledWith('Job name', 'Alpha Main')
    expect(commands.renameJob).toHaveBeenCalledWith('job-A-main', 'Renamed Alpha')

    await user.pointer({ keys: '[MouseRight]', target: first })
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
    expect(commands.duplicateJob).toHaveBeenCalledWith('job-A-main')

    await user.pointer({ keys: '[MouseRight]', target: first })
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(confirm).toHaveBeenCalledWith('Delete Job "Alpha Main"?')
    expect(commands.deleteJob).toHaveBeenCalledWith('job-A-main')
  })

  it('returns focus to a surviving Job after a context launcher is deleted', async () => {
    const user = userEvent.setup()
    const state = harness()
    const commands = commandService()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const view = render(
      <RobotJobListV4
        {...state}
        commands={commands}
        playback={playbackController()}
        selectedRobotId="robot-A"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Alpha Empty commands' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    const replacement = validateWorkcellProjectV4({
      ...state.project,
      revisionId: 'revision-job-removed',
      jobs: state.project.jobs.filter((job) => job.id !== 'job-A-empty'),
    })
    act(() => { state.interaction.getState().replaceProject(replacement) })
    view.rerender(
      <RobotJobListV4
        {...state}
        project={replacement}
        commands={commands}
        playback={playbackController()}
        selectedRobotId="robot-A"
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('treeitem', {
        name: 'Alpha Main, 3 steps, 2 Joint Poses',
      })).toHaveFocus()
    })
  })

  it('locks only the RUNNING Robot while another Robot can author and start concurrently', async () => {
    const user = userEvent.setup()
    const state = harness()
    const playback = playbackController()
    act(() => {
      state.jobs.getState().setRobotState({
        robotId: 'robot-A',
        jobId: 'job-A-main',
        runId: 'run-A',
        state: 'RUNNING',
        stepIndex: 0,
        startedAtSimulationMs: 5,
        completedAtSimulationMs: null,
        failureCode: null,
        message: '',
      })
    })
    render(
      <>
        <section aria-label="Alpha workspace">
          <RobotJobListV4
            {...state}
            commands={commandService()}
            playback={playback}
            selectedRobotId="robot-A"
          />
        </section>
        <section aria-label="Beta workspace">
          <RobotJobListV4
            {...state}
            commands={commandService()}
            playback={playback}
            selectedRobotId="robot-B"
          />
        </section>
      </>,
    )
    const alpha = within(screen.getByRole('region', { name: 'Alpha workspace' }))
    const beta = within(screen.getByRole('region', { name: 'Beta workspace' }))

    expect(alpha.getByRole('button', { name: '+ New Job' })).toBeDisabled()
    expect(alpha.getByRole('button', { name: 'Start Job' })).toBeDisabled()
    expect(alpha.getByRole('button', { name: 'Cancel Job' })).toBeEnabled()
    expect(beta.getByRole('button', { name: '+ New Job' })).toBeEnabled()
    expect(beta.getByRole('button', { name: 'Start Job' })).toBeEnabled()
    expect(beta.getByRole('button', { name: 'Cancel Job' })).toBeDisabled()

    await user.click(alpha.getByRole('button', { name: 'Alpha Main commands' }))
    const lockedMenu = alpha.getByRole('menu')
    expect(lockedMenu).toHaveFocus()
    for (const item of alpha.getAllByRole('menuitem')) expect(item).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(alpha.queryByRole('menu')).not.toBeInTheDocument()

    act(() => {
      state.interaction.getState().select({ kind: 'robot', robotId: 'robot-B' })
    })
    await user.click(beta.getByRole('button', { name: 'Start Job' }))
    expect(playback.startJob).toHaveBeenCalledWith('job-B')
    act(() => {
      state.interaction.getState().select({ kind: 'robot', robotId: 'robot-A' })
    })
    await user.click(alpha.getByRole('button', { name: 'Cancel Job' }))
    expect(playback.cancelRobotJob).toHaveBeenCalledWith('robot-A', expect.any(String))
  })

  it('publishes terminal runtime state and contains playback failures as an alert', async () => {
    const user = userEvent.setup()
    const state = harness()
    const failure = new Error('Start rejected')
    const playback = playbackController()
    playback.startJob.mockImplementation(() => { throw failure })
    render(
      <RobotJobListV4
        {...state}
        commands={commandService()}
        playback={playback}
        selectedRobotId="robot-A"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Start Job' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Start rejected')

    act(() => {
      state.jobs.getState().setRobotState({
        robotId: 'robot-A',
        jobId: 'job-A-main',
        runId: 'run-terminal',
        state: 'SUCCEEDED',
        stepIndex: 2,
        startedAtSimulationMs: 0,
        completedAtSimulationMs: 100,
        failureCode: null,
        message: 'Complete',
      })
    })
    expect(screen.getByRole('status', { name: 'Robot Job state' }))
      .toHaveTextContent('SUCCEEDED')
    expect(screen.getByRole('status', { name: 'Robot Job state' }))
      .toHaveTextContent('Complete')
  })

  it.each([
    'create',
    'rename',
    'duplicate',
    'delete',
    'start',
  ] as const)(
    'rechecks latest Robot runtime before a stale IDLE-render %s event',
    async (operation) => {
      const state = harness()
      const commands = commandService()
      const playback = playbackController()
      const prompt = vi.spyOn(window, 'prompt').mockReturnValue('Should Not Rename')
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
      render(
        <RobotJobListV4
          {...state}
          commands={commands}
          playback={playback}
          selectedRobotId="robot-A"
        />,
      )

      let target: HTMLElement
      if (operation === 'create') {
        target = screen.getByRole('button', { name: '+ New Job' })
      } else if (operation === 'start') {
        target = screen.getByRole('button', { name: 'Start Job' })
      } else {
        await userEvent.setup().click(screen.getByRole('button', {
          name: 'Alpha Main commands',
        }))
        target = screen.getByRole('menuitem', {
          name: operation === 'rename'
            ? 'Rename'
            : operation === 'duplicate'
              ? 'Duplicate'
              : 'Delete',
        })
      }
      target.addEventListener('click', () => {
        state.jobs.getState().setRobotState(runningRobotState())
      }, { capture: true, once: true })

      fireEvent.click(target)

      expect(commands.createJob).not.toHaveBeenCalled()
      expect(commands.renameJob).not.toHaveBeenCalled()
      expect(commands.duplicateJob).not.toHaveBeenCalled()
      expect(commands.deleteJob).not.toHaveBeenCalled()
      expect(playback.startJob).not.toHaveBeenCalled()
      expect(prompt).not.toHaveBeenCalled()
      expect(confirm).not.toHaveBeenCalled()
    },
  )

  it('uses the exact latest selected Job and blocks a stale selected-Robot Start event', () => {
    const state = harness()
    const playback = playbackController()
    const view = render(
      <RobotJobListV4
        {...state}
        commands={commandService()}
        playback={playback}
        selectedRobotId="robot-A"
      />,
    )
    const start = screen.getByRole('button', { name: 'Start Job' })
    start.addEventListener('click', () => {
      state.interaction.getState().selectJob('robot-A', 'job-A-empty')
    }, { capture: true, once: true })

    fireEvent.click(start)
    expect(playback.startJob).toHaveBeenCalledWith('job-A-empty')

    playback.startJob.mockClear()
    view.rerender(
      <RobotJobListV4
        {...state}
        commands={commandService()}
        playback={playback}
        selectedRobotId="robot-A"
      />,
    )
    const currentStart = screen.getByRole('button', { name: 'Start Job' })
    currentStart.addEventListener('click', () => {
      state.interaction.getState().select({ kind: 'robot', robotId: 'robot-B' })
    }, { capture: true, once: true })

    fireEvent.click(currentStart)
    expect(playback.startJob).not.toHaveBeenCalled()
  })

  it('rechecks terminal runtime before a stale RUNNING-render Cancel event', () => {
    const state = harness()
    const playback = playbackController()
    state.jobs.getState().setRobotState(runningRobotState())
    render(
      <RobotJobListV4
        {...state}
        commands={commandService()}
        playback={playback}
        selectedRobotId="robot-A"
      />,
    )
    const cancel = screen.getByRole('button', { name: 'Cancel Job' })
    cancel.addEventListener('click', () => {
      state.jobs.getState().setRobotState({
        ...runningRobotState(),
        state: 'SUCCEEDED',
        completedAtSimulationMs: 10,
      })
    }, { capture: true, once: true })

    fireEvent.click(cancel)

    expect(playback.cancelRobotJob).not.toHaveBeenCalled()
  })

  it.each(['create', 'rename', 'duplicate', 'delete'] as const)(
    'blocks synchronous %s reentry before React publishes pending authoring state',
    async (operation) => {
      const state = harness()
      let target: HTMLElement
      const createJob = vi.fn(async () => {
        if (operation === 'create' && createJob.mock.calls.length === 1) {
          fireEvent.click(target)
        }
        return 'job-A-empty'
      })
      const renameJob = vi.fn(async () => {
        if (operation === 'rename' && renameJob.mock.calls.length === 1) {
          fireEvent.click(target)
        }
      })
      const duplicateJob = vi.fn(async () => {
        if (operation === 'duplicate' && duplicateJob.mock.calls.length === 1) {
          fireEvent.click(target)
        }
        return 'job-A-empty'
      })
      const deleteJob = vi.fn(async () => {
        if (operation === 'delete' && deleteJob.mock.calls.length === 1) {
          fireEvent.click(target)
        }
      })
      const commands = commandService({ createJob, renameJob, duplicateJob, deleteJob })
      vi.spyOn(window, 'prompt').mockReturnValue('Renamed once')
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      render(
        <RobotJobListV4
          {...state}
          commands={commands}
          playback={playbackController()}
          selectedRobotId="robot-A"
        />,
      )

      if (operation === 'create') {
        target = screen.getByRole('button', { name: '+ New Job' })
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Alpha Main commands' }))
        target = screen.getByRole('menuitem', {
          name: operation === 'rename'
            ? 'Rename'
            : operation === 'duplicate'
              ? 'Duplicate'
              : 'Delete',
        })
      }
      fireEvent.click(target)

      const selectedCommand = operation === 'create'
        ? createJob
        : operation === 'rename'
          ? renameJob
          : operation === 'duplicate'
            ? duplicateJob
            : deleteJob
      await waitFor(() => expect(selectedCommand).toHaveBeenCalledTimes(1))
    },
  )

  it.each(['start', 'cancel'] as const)(
    'blocks synchronous %s playback reentry before runtime publication',
    (operation) => {
      const state = harness()
      if (operation === 'cancel') state.jobs.getState().setRobotState(runningRobotState())
      let target: HTMLElement
      const playback = playbackController()
      playback.startJob.mockImplementation((_jobId: string) => {
        if (playback.startJob.mock.calls.length === 1) fireEvent.click(target)
        return { runId: 'run-new' }
      })
      playback.cancelRobotJob.mockImplementation((_robotId: string, _reason: string) => {
        if (playback.cancelRobotJob.mock.calls.length === 1) fireEvent.click(target)
      })
      render(
        <RobotJobListV4
          {...state}
          commands={commandService()}
          playback={playback}
          selectedRobotId="robot-A"
        />,
      )
      target = screen.getByRole('button', {
        name: operation === 'start' ? 'Start Job' : 'Cancel Job',
      })

      fireEvent.click(target)

      const selectedPlayback = operation === 'start'
        ? playback.startJob
        : playback.cancelRobotJob
      expect(selectedPlayback).toHaveBeenCalledTimes(1)
    },
  )

  it('blocks Start during same-batch authoring and releases after async failure', async () => {
    const state = harness()
    const playback = playbackController()
    let startButton: HTMLElement
    const duplicateJob = vi.fn(async () => {
      if (duplicateJob.mock.calls.length === 1) {
        fireEvent.click(startButton)
        throw new Error('Duplicate rejected')
      }
      return 'job-copy'
    })
    const commands = commandService({ duplicateJob })
    render(
      <RobotJobListV4
        {...state}
        commands={commands}
        playback={playback}
        selectedRobotId="robot-A"
      />,
    )
    startButton = screen.getByRole('button', { name: 'Start Job' })
    fireEvent.click(screen.getByRole('button', { name: 'Alpha Main commands' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }))

    expect(playback.startJob).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Duplicate rejected'))

    fireEvent.click(screen.getByRole('button', { name: 'Alpha Main commands' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
    await waitFor(() => expect(duplicateJob).toHaveBeenCalledTimes(2))
  })

  it('releases authoring after prompt and confirm cancellation', async () => {
    const state = harness()
    const commands = commandService()
    const prompt = vi.spyOn(window, 'prompt')
      .mockReturnValueOnce(null)
      .mockReturnValueOnce('Renamed after cancel')
    const confirm = vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
    render(
      <RobotJobListV4
        {...state}
        commands={commands}
        playback={playbackController()}
        selectedRobotId="robot-A"
      />,
    )

    for (let attempt = 0; attempt < 2; attempt += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Alpha Main commands' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    }
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(commands.renameJob).toHaveBeenCalledOnce()

    for (let attempt = 0; attempt < 2; attempt += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Alpha Main commands' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    }
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(commands.deleteJob).toHaveBeenCalledOnce()
  })

  it('uses injected Job operator and prompt ports without retargeting the selected Robot', async () => {
    const user = userEvent.setup()
    const state = harness()
    const operator: JobOperatorServiceV4 = {
      canStart: vi.fn(() => true), start: vi.fn(async () => undefined),
      canCancel: vi.fn(() => false), cancel: vi.fn(async () => undefined),
    }
    const promptPort: UserPromptPortV4 = { requestText: vi.fn(async () => null) }
    const commands = commandService()
    render(
      <RobotJobListV4
        {...state}
        commands={commands}
        jobOperator={operator}
        playback={playbackController()}
        promptPort={promptPort}
        selectedRobotId="robot-A"
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Start Job' }))
    expect(operator.start).toHaveBeenCalledWith('robot-A', 'job-A-main')
    await user.click(screen.getByRole('button', { name: 'Alpha Main commands' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    await waitFor(() => expect(promptPort.requestText).toHaveBeenCalledOnce())
    expect(commands.renameJob).not.toHaveBeenCalled()
  })

  it('renders required-name prompt rejection locally without invoking Job rename', async () => {
    const user = userEvent.setup()
    const state = harness()
    const commands = commandService()
    const promptPort: UserPromptPortV4 = {
      requestText: vi.fn(async () => { throw new Error('Job name is required.') }),
    }
    render(
      <RobotJobListV4
        {...state}
        commands={commands}
        playback={playbackController()}
        promptPort={promptPort}
        selectedRobotId="robot-A"
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Alpha Main commands' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Job name is required.'))
    expect(commands.renameJob).not.toHaveBeenCalled()
  })
})
