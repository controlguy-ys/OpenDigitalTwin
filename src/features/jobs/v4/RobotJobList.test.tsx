import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MAX_JOBS_V4,
  validateWorkcellProjectV4,
  type RobotJobStepV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import {
  createAppCommandBindingsV4,
  createAppCommandRuntimeV4,
  type AppCommandBindingsV4,
} from '../../commands/v4/app-command-runtime.js'
import type { AppCommandV4 } from '../../commands/v4/app-command.js'
import { createAppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'
import { createInteractionStoreV4 } from '../../interaction/v4/interaction-store.js'
import type { UserPromptPortV4 } from '../../ui/v4/user-prompt-port.js'
import { createJobRuntimeStoreV4 } from './job-runtime-store.js'
import { RobotJobListV4 } from './RobotJobList.js'

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
    jointSource: 'simulation' as const,
  }
  return validateWorkcellProjectV4({
    ...source,
    robotDefinitions,
    robots: [
      { ...template, id: 'robot-A', name: 'Robot Alpha' },
      { ...template, id: 'robot-B', name: 'Robot Beta' },
    ],
    actions: [{ id: 'action:A:open', kind: 'set-gripper-state', robotId: 'robot-A', state: 'OPEN' }],
    jobs: [
      { id: 'job-B', name: 'Beta Job', robotId: 'robot-B', steps: [jointPose()] },
      { id: 'job-A-main', name: 'Alpha Main', robotId: 'robot-A', steps: [jointPose(30), { kind: 'action-reference', actionId: 'action:A:open' }, jointPose()] },
      { id: 'job-A-empty', name: 'Alpha Empty', robotId: 'robot-A', steps: [] },
    ],
  })
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
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

type CommandId = 'job.new' | 'job.start' | 'job.cancel' | 'job.rename' | 'job.duplicate' | 'job.delete'

interface Harness {
  readonly project: WorkcellProjectV4
  readonly interaction: ReturnType<typeof createInteractionStoreV4>
  readonly jobs: ReturnType<typeof createJobRuntimeStoreV4>
  readonly commandBindings: AppCommandBindingsV4
  readonly calls: Record<'create' | 'start' | 'cancel' | 'rename' | 'duplicate' | 'delete', ReturnType<typeof vi.fn>>
  readonly prompt: { requestText: ReturnType<typeof vi.fn<UserPromptPortV4['requestText']>> }
  replaceCommands(overrides?: Partial<Record<CommandId, Partial<Pick<AppCommandV4, 'visible' | 'enabled' | 'execute'>>>>): void
}

function harness(): Harness {
  const project = twoRobotProject()
  const interaction = createInteractionStoreV4()
  const jobs = createJobRuntimeStoreV4()
  interaction.getState().replaceProject(project)
  jobs.getState().replaceProject(project)
  interaction.getState().activateRobot('robot-A')
  const calls = {
    create: vi.fn(async (_robotId: string, _name: string) => 'job-created'),
    start: vi.fn(async (_robotId: string, _jobId: string) => undefined),
    cancel: vi.fn(async (_robotId: string) => undefined),
    rename: vi.fn(async (_jobId: string, _name: string) => undefined),
    duplicate: vi.fn(async (_jobId: string) => 'job-duplicate'),
    delete: vi.fn(async (_jobId: string) => undefined),
  }
  const prompt = { requestText: vi.fn<UserPromptPortV4['requestText']>(async () => 'Job') }

  const activeTarget = () => {
    const state = interaction.getState()
    const robotId = state.activeRobotId
    return robotId === null ? null : {
      robotId,
      jobId: state.selectedJobIdsByRobotId.get(robotId) ?? null,
    }
  }
  const authorable = (robotId: string) => jobs.getState().byRobotId[robotId]?.state !== 'RUNNING'
  const command = (id: CommandId, label: string, execute: AppCommandV4['execute']): AppCommandV4 => ({
    id, label, section: 'job', kind: 'action', visible: true,
    get enabled() {
      const target = activeTarget()
      if (id === 'job.cancel') return target !== null && jobs.getState().byRobotId[target.robotId]?.state === 'RUNNING'
      if (target === null || !authorable(target.robotId)) return false
      return id === 'job.new' || target.jobId !== null
    },
    execute,
  })
  const commands = (): AppCommandV4[] => [
    command('job.new', 'New Job', async () => {
      const target = activeTarget()
      if (target === null) throw new Error('No active Robot.')
      const name = await prompt.requestText({ title: 'Job name', initialValue: 'Job', required: true })
      if (name === null) return 'cancelled'
      const id = await calls.create(target.robotId, name.trim())
      interaction.getState().selectJob(target.robotId, id)
    }),
    command('job.start', 'Start Job', async () => {
      const target = activeTarget()
      if (target === null || target.jobId === null) throw new Error('No active Job for the active Robot.')
      await calls.start(target.robotId, target.jobId)
    }),
    command('job.cancel', 'Cancel Active Robot Job', async () => {
      const target = activeTarget()
      if (target === null) throw new Error('No active Robot.')
      await calls.cancel(target.robotId)
    }),
    command('job.rename', 'Rename Job', async () => {
      const target = activeTarget()
      if (target === null || target.jobId === null) throw new Error('No active Job for the active Robot.')
      const name = await prompt.requestText({ title: 'Job name', initialValue: target.jobId, required: true })
      if (name === null) return 'cancelled'
      await calls.rename(target.jobId, name.trim())
    }),
    command('job.duplicate', 'Duplicate Job', async () => {
      const target = activeTarget()
      if (target === null || target.jobId === null) throw new Error('No active Job for the active Robot.')
      const duplicate = await calls.duplicate(target.jobId)
      interaction.getState().selectJob(target.robotId, duplicate)
    }),
    command('job.delete', 'Delete Job', async () => {
      const target = activeTarget()
      if (target === null || target.jobId === null) throw new Error('No active Job for the active Robot.')
      await calls.delete(target.jobId)
    }),
  ]
  const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4(commands()))
  return {
    project, interaction, jobs, commandBindings: createAppCommandBindingsV4(runtime), calls, prompt,
    replaceCommands(overrides = {}) {
      runtime.replaceRegistry(createAppCommandRegistryV4(commands().map((entry) => ({ ...entry, ...overrides[entry.id as CommandId] }))))
    },
  }
}

function list(state: Harness, selectedRobotId: 'robot-A' | 'robot-B' | null, onExplicitJobSelection?: (robotId: string, jobId: string) => void) {
  return onExplicitJobSelection === undefined
    ? <RobotJobListV4 {...state} selectedRobotId={selectedRobotId} />
    : <RobotJobListV4 {...state} onExplicitJobSelection={onExplicitJobSelection} selectedRobotId={selectedRobotId} />
}

afterEach(() => vi.restoreAllMocks())

describe('RobotJobListV4', () => {
  it('offers explicit Robot activation, scopes rows, preserves counts, and publishes exact row selection', async () => {
    const user = userEvent.setup()
    const state = harness()
    const selected = vi.fn()
    const view = render(list(state, null, selected))
    await user.click(screen.getByRole('button', { name: 'Control Robot Beta' }))
    expect(state.interaction.getState().activeRobotId).toBe('robot-B')

    view.rerender(list(state, 'robot-A', selected))
    const alpha = screen.getByRole('treeitem', { name: 'Alpha Main, 3 steps, 2 Joint Poses' })
    expect(screen.queryByText('Beta Job')).not.toBeInTheDocument()
    await user.click(alpha)
    expect(state.interaction.getState().selectedJobIdsByRobotId.get('robot-A')).toBe('job-A-main')
    expect(selected).toHaveBeenLastCalledWith('robot-A', 'job-A-main')
  })

  it('keeps two Robot surfaces isolated while a different Robot is RUNNING and can start the active second Robot', async () => {
    const user = userEvent.setup()
    const state = harness()
    act(() => {
      state.jobs.getState().setRobotState(runningRobotState('robot-A', 'job-A-main'))
      state.interaction.getState().activateRobot('robot-B')
    })
    render(<><section aria-label="Alpha workspace">{list(state, 'robot-A')}</section><section aria-label="Beta workspace">{list(state, 'robot-B')}</section></>)
    const alpha = within(screen.getByRole('region', { name: 'Alpha workspace' }))
    const beta = within(screen.getByRole('region', { name: 'Beta workspace' }))
    expect(alpha.getByRole('button', { name: '+ New Job' })).toBeDisabled()
    expect(alpha.getByRole('button', { name: 'Start Job' })).toBeDisabled()
    expect(beta.getByRole('button', { name: '+ New Job' })).toBeEnabled()
    expect(beta.getByRole('button', { name: 'Start Job' })).toBeEnabled()
    await user.click(beta.getByRole('button', { name: 'Start Job' }))
    expect(state.calls.start).toHaveBeenCalledWith('robot-B', 'job-B')
  })

  it('shares one pending/error state and one underlying execution across two surfaces bound to one runtime', async () => {
    const user = userEvent.setup()
    const state = harness()
    const pending = deferred<string>()
    state.calls.create.mockImplementationOnce(() => pending.promise)
    render(<><section aria-label="first">{list(state, 'robot-A')}</section><section aria-label="second">{list(state, 'robot-A')}</section></>)
    const first = within(screen.getByRole('region', { name: 'first' }))
    const second = within(screen.getByRole('region', { name: 'second' }))
    await user.click(first.getByRole('button', { name: '+ New Job' }))
    expect(first.getByRole('button', { name: '+ New Job' })).toBeDisabled()
    expect(second.getByRole('button', { name: '+ New Job' })).toBeDisabled()
    await user.click(second.getByRole('button', { name: '+ New Job' }))
    expect(state.calls.create).toHaveBeenCalledTimes(1)
    act(() => pending.reject(new Error('Create rejected')))
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    expect(screen.getAllByRole('alert').every((alert) => alert.textContent === 'Create rejected')).toBe(true)
    expect(second.getByRole('button', { name: '+ New Job' })).toBeEnabled()
  })

  it('honors visible state from the shared registry for header and context commands', async () => {
    const user = userEvent.setup()
    const state = harness()
    state.replaceCommands({ 'job.new': { visible: false }, 'job.rename': { visible: false } })
    render(list(state, 'robot-A'))
    expect(screen.getByRole('button', { name: '+ New Job' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Alpha Main commands' }))
    expect(screen.getByRole('menuitem', { name: 'Rename Job' })).toBeDisabled()
  })

  it.each(['new', 'rename', 'duplicate', 'delete', 'start'] as const)(
    'rechecks the latest exact target before a stale IDLE-render %s event',
    async (operation) => {
      const state = harness()
      render(list(state, 'robot-A'))
      let target: HTMLElement
      if (operation === 'new') target = screen.getByRole('button', { name: '+ New Job' })
      else if (operation === 'start') target = screen.getByRole('button', { name: 'Start Job' })
      else {
        fireEvent.click(screen.getByRole('button', { name: 'Alpha Main commands' }))
        target = screen.getByRole('menuitem', { name: operation === 'rename' ? 'Rename Job' : operation === 'duplicate' ? 'Duplicate Job' : 'Delete Job' })
      }
      target.addEventListener('click', () => state.jobs.getState().setRobotState(runningRobotState()), { capture: true, once: true })
      fireEvent.click(target)
      expect(state.calls.create).not.toHaveBeenCalled()
      expect(state.calls.rename).not.toHaveBeenCalled()
      expect(state.calls.duplicate).not.toHaveBeenCalled()
      expect(state.calls.delete).not.toHaveBeenCalled()
      expect(state.calls.start).not.toHaveBeenCalled()
      expect(state.prompt.requestText).not.toHaveBeenCalled()
    },
  )

  it('uses the latest selected Job but blocks a stale selected-Robot Start event', () => {
    const state = harness()
    render(list(state, 'robot-A'))
    const start = screen.getByRole('button', { name: 'Start Job' })
    start.addEventListener('click', () => state.interaction.getState().selectJob('robot-A', 'job-A-empty'), { capture: true, once: true })
    fireEvent.click(start)
    expect(state.calls.start).toHaveBeenCalledWith('robot-A', 'job-A-empty')
    state.calls.start.mockClear()
    start.addEventListener('click', () => state.interaction.getState().activateRobot('robot-B'), { capture: true, once: true })
    fireEvent.click(start)
    expect(state.calls.start).not.toHaveBeenCalled()
  })

  it('does not retarget Job context when a same-tick registry replacement disables Start', () => {
    const state = harness()
    const selected = vi.fn()
    render(list(state, 'robot-A', selected))
    const before = state.interaction.getState().selectedJobIdsByRobotId.get('robot-A')
    const start = screen.getByRole('button', { name: 'Start Job' })
    start.addEventListener('click', () => {
      state.replaceCommands({ 'job.start': { visible: false, enabled: false } })
    }, { capture: true, once: true })

    fireEvent.click(start)

    expect(state.calls.start).not.toHaveBeenCalled()
    expect(selected).not.toHaveBeenCalled()
    expect(state.interaction.getState().selectedJobIdsByRobotId.get('robot-A')).toBe(before)
  })

  it('rechecks terminal runtime before a stale RUNNING-render Cancel event and publishes terminal runtime state', () => {
    const state = harness()
    state.jobs.getState().setRobotState(runningRobotState())
    render(list(state, 'robot-A'))
    const cancel = screen.getByRole('button', { name: 'Cancel Job' })
    cancel.addEventListener('click', () => state.jobs.getState().setRobotState({ ...runningRobotState(), state: 'SUCCEEDED', completedAtSimulationMs: 10, message: 'Complete' }), { capture: true, once: true })
    fireEvent.click(cancel)
    expect(state.calls.cancel).not.toHaveBeenCalled()
    expect(screen.getByRole('status', { name: 'Robot Job state' })).toHaveTextContent('SUCCEEDED')
    expect(screen.getByRole('status', { name: 'Robot Job state' })).toHaveTextContent('Complete')
  })

  it.each(['new', 'rename', 'duplicate', 'delete'] as const)(
    'blocks synchronous shared-command %s reentry before React publishes pending state',
    async (operation) => {
      const state = harness()
      let target: HTMLElement
      const call = operation === 'new' ? state.calls.create : operation === 'rename' ? state.calls.rename : operation === 'duplicate' ? state.calls.duplicate : state.calls.delete
      call.mockImplementationOnce(async () => { fireEvent.click(target); return operation === 'new' || operation === 'duplicate' ? 'job-A-empty' : undefined })
      render(list(state, 'robot-A'))
      if (operation === 'new') target = screen.getByRole('button', { name: '+ New Job' })
      else {
        fireEvent.click(screen.getByRole('button', { name: 'Alpha Main commands' }))
        target = screen.getByRole('menuitem', { name: operation === 'rename' ? 'Rename Job' : operation === 'duplicate' ? 'Duplicate Job' : 'Delete Job' })
      }
      fireEvent.click(target)
      await waitFor(() => expect(call).toHaveBeenCalledTimes(1))
    },
  )

  it('releases a failed shared duplicate command without poisoning a different command ID', async () => {
    const state = harness()
    let start: HTMLElement
    state.calls.duplicate.mockImplementationOnce(async () => { fireEvent.click(start); throw new Error('Duplicate rejected') })
    render(list(state, 'robot-A'))
    start = screen.getByRole('button', { name: 'Start Job' })
    fireEvent.click(screen.getByRole('button', { name: 'Alpha Main commands' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate Job' }))
    // The runtime serializes command IDs independently: a pending duplicate
    // deliberately does not suppress a distinct job.start command.
    expect(state.calls.start).toHaveBeenCalledWith('robot-A', 'job-A-main')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Duplicate rejected'))
    fireEvent.click(screen.getByRole('button', { name: 'Alpha Main commands' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate Job' }))
    await waitFor(() => expect(state.calls.duplicate).toHaveBeenCalledTimes(2))
  })

  it('blocks synchronous same-ID Start reentry before React publishes shared pending state', () => {
    const state = harness()
    let start: HTMLElement
    state.calls.start.mockImplementationOnce(async () => {
      fireEvent.click(start)
    })
    render(list(state, 'robot-A'))
    start = screen.getByRole('button', { name: 'Start Job' })
    fireEvent.click(start)
    expect(state.calls.start).toHaveBeenCalledTimes(1)
  })

  it('routes cancellation and prompt errors through injected shared commands without window.confirm or window.prompt', async () => {
    const user = userEvent.setup()
    const state = harness()
    const nativePrompt = vi.spyOn(window, 'prompt')
    const nativeConfirm = vi.spyOn(window, 'confirm')
    state.prompt.requestText.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Job name is required.'))
    render(list(state, 'robot-A'))
    await user.click(screen.getByRole('button', { name: 'Alpha Main commands' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename Job' }))
    expect(state.calls.rename).not.toHaveBeenCalled()
    await user.click(screen.getByRole('menuitem', { name: 'Rename Job' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Job name is required.'))
    expect(state.calls.rename).not.toHaveBeenCalled()
    expect(nativePrompt).not.toHaveBeenCalled()
    expect(nativeConfirm).not.toHaveBeenCalled()
  })

  it('surfaces MAX_JOBS rejection from the injected shared command and releases New for retry', async () => {
    const user = userEvent.setup()
    const state = harness()
    state.calls.create.mockRejectedValueOnce(new Error(`A Project cannot exceed ${MAX_JOBS_V4} Jobs.`))
    render(list(state, 'robot-A'))
    await user.click(screen.getByRole('button', { name: '+ New Job' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(`A Project cannot exceed ${MAX_JOBS_V4} Jobs.`))
    expect(screen.getByRole('button', { name: '+ New Job' })).toBeEnabled()
  })

  it('publishes completed New through the exact explicit Job source selected by the shared command', async () => {
    const user = userEvent.setup()
    const state = harness()
    const selected = vi.fn()
    state.calls.create.mockResolvedValueOnce('job-A-empty')
    render(list(state, 'robot-A', selected))
    await user.click(screen.getByRole('button', { name: '+ New Job' }))
    await waitFor(() => expect(selected).toHaveBeenCalledWith('robot-A', 'job-A-empty'))
  })

  it('returns focus to a surviving Job only after a completed delete publishes removal', async () => {
    const user = userEvent.setup()
    const state = harness()
    const deletePending = deferred<void>()
    state.calls.delete.mockImplementationOnce(() => deletePending.promise)
    const view = render(list(state, 'robot-A'))
    await user.click(screen.getByRole('button', { name: 'Alpha Empty commands' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete Job' }))
    expect(screen.getByRole('menu')).toBeVisible()
    act(() => deletePending.resolve())
    const replacement = validateWorkcellProjectV4({ ...state.project, revisionId: 'revision-job-removed', jobs: state.project.jobs.filter((job) => job.id !== 'job-A-empty') })
    act(() => state.interaction.getState().replaceProject(replacement))
    view.rerender(list({ ...state, project: replacement }, 'robot-A'))
    await waitFor(() => expect(screen.getByRole('treeitem', { name: 'Alpha Main, 3 steps, 2 Joint Poses' })).toHaveFocus())
  })

  it('preserves tree and context-menu keyboard focus', async () => {
    const user = userEvent.setup()
    const state = harness()
    render(list(state, 'robot-A'))
    const first = screen.getByRole('treeitem', { name: 'Alpha Main, 3 steps, 2 Joint Poses' })
    const second = screen.getByRole('treeitem', { name: 'Alpha Empty, 0 steps, 0 Joint Poses' })
    first.focus()
    await user.keyboard('{ArrowDown}')
    expect(second).toHaveFocus()
    await user.keyboard('{Home}')
    expect(first).toHaveFocus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(screen.getByRole('menuitem', { name: 'Rename Job' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(first).toHaveFocus()
  })
})
