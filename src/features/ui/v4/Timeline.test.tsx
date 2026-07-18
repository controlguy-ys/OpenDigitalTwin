import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { validateWorkcellProjectV4, type RobotJobStepV4, type WorkcellProjectV4 } from '../../../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { createAppCommandBindingsV4, createAppCommandRuntimeV4 } from '../../commands/v4/app-command-runtime.js'
import { createAppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'
import type { JobCommandServiceV4 } from '../../jobs/v4/job-command-service.js'
import { createJobRuntimeStoreV4 } from '../../jobs/v4/job-runtime-store.js'
import { TimelineV4 } from './Timeline.js'

function pose(speedPercentToNext: number): RobotJobStepV4 { return { kind: 'joint-pose', jointValues: { 'prismatic:Z': 0.2 }, speedPercentToNext } }

function projectFixture(): WorkcellProjectV4 {
  const source = structuredClone(makeMinimalWorkcellProjectV4())
  const definition = source.robotDefinitions[0]!
  const template = { ...source.robots[0]!, initialJointValues: { 'prismatic:Z': 0 }, jointSource: 'simulation' as const }
  return validateWorkcellProjectV4({
    ...source,
    robotDefinitions: [{ ...definition, joints: definition.joints.map((joint) => ({ ...joint, id: 'prismatic:Z' })) }],
    robots: [{ ...template, id: 'robot-A', name: 'Robot Alpha' }, { ...template, id: 'robot-B', name: 'Robot Beta' }],
    actions: [{ id: 'action:open', kind: 'set-gripper-state', robotId: 'robot-A', state: 'OPEN' }],
    jobs: [{ id: 'job-A', name: 'Alpha Sequence', robotId: 'robot-A', steps: [pose(35), { kind: 'action-reference', actionId: 'action:open' }, pose(100)] }, { id: 'job-B', name: 'Beta Sequence', robotId: 'robot-B', steps: [pose(100)] }],
  })
}

function localCommands(): JobCommandServiceV4 {
  return { createJob: vi.fn(async () => 'unused'), renameJob: vi.fn(async () => undefined), duplicateJob: vi.fn(async () => 'unused'), deleteJob: vi.fn(async () => undefined), saveJointPose: vi.fn(async () => undefined), addActionReference: vi.fn(async () => undefined), moveStep: vi.fn(async () => undefined), deleteStep: vi.fn(async () => undefined), setJointPoseSpeed: vi.fn(async () => undefined) }
}

function running(robotId = 'robot-A', jobId = 'job-A') {
  return { robotId, jobId, runId: `run-${robotId}`, state: 'RUNNING' as const, stepIndex: 0, startedAtSimulationMs: 0, completedAtSimulationMs: null, failureCode: null, message: '' }
}

function harness() {
  const project = projectFixture()
  const jobs = createJobRuntimeStoreV4(); jobs.getState().replaceProject(project)
  const commands = localCommands()
  const calls = {
    start: vi.fn<(robotId: string, jobId: string) => Promise<void>>(async (): Promise<void> => {}),
    cancel: vi.fn<(robotId: string) => Promise<void>>(async (): Promise<void> => {}),
  }
  let target = { robotId: 'robot-A', jobId: 'job-A' }
  const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4([
    { id: 'job.start', label: 'Start Job', section: 'job', kind: 'action', visible: true, get enabled() { return jobs.getState().projectRevisionId === project.revisionId && jobs.getState().byRobotId[target.robotId]?.state !== 'RUNNING' }, execute: () => calls.start(target.robotId, target.jobId) },
    { id: 'job.cancel', label: 'Cancel Active Robot Job', section: 'job', kind: 'action', visible: true, get enabled() { return jobs.getState().projectRevisionId === project.revisionId && jobs.getState().byRobotId[target.robotId]?.state === 'RUNNING' }, execute: () => calls.cancel(target.robotId) },
  ]))
  return { project, jobs, commands, calls, commandBindings: createAppCommandBindingsV4(runtime), setTarget: (robotId: 'robot-A' | 'robot-B', jobId: 'job-A' | 'job-B') => { target = { robotId, jobId } }, runtime }
}

function timeline(state: ReturnType<typeof harness>, robotId: 'robot-A' | 'robot-B' = 'robot-A', jobId: 'job-A' | 'job-B' = robotId === 'robot-A' ? 'job-A' : 'job-B') { return <TimelineV4 {...state} jobId={jobId} robotId={robotId} /> }

describe('TimelineV4', () => {
  it('renders stored Joint-Pose/Action order and terminal runtime state', () => {
    const state = harness(); state.jobs.getState().setRobotState({ ...running(), state: 'FAILED', stepIndex: 1, completedAtSimulationMs: 90, failureCode: 'ACTION_FAILED', message: 'Gripper unavailable' })
    render(timeline(state))
    const steps = within(screen.getByRole('list', { name: 'Job steps' })).getAllByRole('listitem')
    expect(steps).toHaveLength(3); expect(steps[1]).toHaveTextContent('Action action:open'); expect(steps[1]).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('status', { name: 'Timeline runtime' })).toHaveTextContent('FAILED')
    expect(screen.getByRole('status', { name: 'Timeline runtime' })).toHaveTextContent('Gripper unavailable')
  })

  it('keeps local speed, move, and delete authoring mapped to exact stored steps', async () => {
    const user = userEvent.setup(); const state = harness(); render(timeline(state))
    const speed = screen.getByRole('spinbutton', { name: 'Step 1 speed to next Joint Pose' })
    expect(speed).toHaveValue(35); expect(screen.getByRole('spinbutton', { name: 'Step 3 speed to next Joint Pose' })).toBeDisabled()
    fireEvent.change(speed, { target: { value: '67' } })
    await user.click(screen.getByRole('button', { name: 'Move step 2 up' })); await user.click(screen.getByRole('button', { name: 'Delete step 2' }))
    expect(state.commands.setJointPoseSpeed).toHaveBeenCalledWith('job-A', 0, 67)
    expect(state.commands.moveStep).toHaveBeenCalledWith('job-A', 1, -1); expect(state.commands.deleteStep).toHaveBeenCalledWith('job-A', 1)
  })

  it('routes Start and Stop only through exact shared command IDs', async () => {
    const user = userEvent.setup(); const state = harness(); render(timeline(state))
    await user.click(screen.getByRole('button', { name: 'Start Job' })); expect(state.calls.start).toHaveBeenCalledWith('robot-A', 'job-A')
    act(() => state.jobs.getState().setRobotState(running()))
    await user.click(screen.getByRole('button', { name: 'Stop Job' })); expect(state.calls.cancel).toHaveBeenCalledWith('robot-A')
  })

  it('holds shared Start until an in-flight local authoring edit settles', async () => {
    const state = harness()
    let resolveEdit!: () => void
    vi.mocked(state.commands.setJointPoseSpeed).mockImplementationOnce(() => (
      new Promise<void>((resolve) => { resolveEdit = resolve })
    ))
    render(timeline(state))

    fireEvent.change(screen.getByRole('spinbutton', {
      name: 'Step 1 speed to next Joint Pose',
    }), { target: { value: '55' } })
    const start = screen.getByRole('button', { name: 'Start Job' })
    expect(start).toBeDisabled()
    fireEvent.click(start)
    expect(state.calls.start).not.toHaveBeenCalled()

    resolveEdit()
    await waitFor(() => expect(start).toBeEnabled())
    fireEvent.click(start)
    await waitFor(() => expect(state.calls.start).toHaveBeenCalledWith('robot-A', 'job-A'))
  })

  it('honors shared enabled, visible, pending, and error state', async () => {
    const user = userEvent.setup(); const state = harness(); let reject!: (reason: Error) => void
    state.calls.start.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail }))
    render(timeline(state)); await user.click(screen.getByRole('button', { name: 'Start Job' }))
    expect(screen.getByRole('button', { name: 'Start Job' })).toBeDisabled(); reject(new Error('start rejected'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('start rejected'))
    state.runtime.replaceRegistry(createAppCommandRegistryV4([{ id: 'job.start', label: 'Start Job', section: 'job', kind: 'action', visible: false, enabled: true, execute() {} }, { id: 'job.cancel', label: 'Cancel Active Robot Job', section: 'job', kind: 'action', visible: true, enabled: false, execute() {} }]))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start Job' })).toBeDisabled())
  })

  it('shares pending/error and one execution across simultaneous Timeline surfaces bound to one runtime', async () => {
    const user = userEvent.setup(); const state = harness(); let reject!: (reason: Error) => void
    state.calls.start.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail }))
    render(<><section aria-label="first">{timeline(state)}</section><section aria-label="second">{timeline(state)}</section></>)
    const first = within(screen.getByRole('region', { name: 'first' })); const second = within(screen.getByRole('region', { name: 'second' }))
    await user.click(first.getByRole('button', { name: 'Start Job' })); await user.click(second.getByRole('button', { name: 'Start Job' }))
    expect(state.calls.start).toHaveBeenCalledTimes(1); expect(second.getByRole('button', { name: 'Start Job' })).toBeDisabled()
    reject(new Error('shared start failure')); await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
  })

  it('keeps a RUNNING Robot local timeline locked while a second active target can start', async () => {
    const user = userEvent.setup(); const state = harness(); act(() => state.jobs.getState().setRobotState(running()))
    state.setTarget('robot-B', 'job-B')
    render(<><section aria-label="Alpha timeline">{timeline(state, 'robot-A')}</section><section aria-label="Beta timeline">{timeline(state, 'robot-B', 'job-B')}</section></>)
    const alpha = within(screen.getByRole('region', { name: 'Alpha timeline' })); const beta = within(screen.getByRole('region', { name: 'Beta timeline' }))
    expect(alpha.getByRole('button', { name: 'Delete step 1' })).toBeDisabled(); expect(beta.getByRole('button', { name: 'Delete step 1' })).toBeEnabled()
    await user.click(beta.getByRole('button', { name: 'Start Job' })); expect(state.calls.start).toHaveBeenCalledWith('robot-B', 'job-B')
  })

  it('blocks synchronous same-ID Start reentry and stale local authoring events', async () => {
    const state = harness(); let start: HTMLElement
    state.calls.start.mockImplementationOnce(async () => { fireEvent.click(start) })
    render(timeline(state)); start = screen.getByRole('button', { name: 'Start Job' }); fireEvent.click(start)
    expect(state.calls.start).toHaveBeenCalledTimes(1)
    const move = screen.getByRole('button', { name: 'Move step 2 up' })
    move.addEventListener('click', () => state.jobs.getState().setRobotState(running()), { capture: true, once: true }); fireEvent.click(move)
    expect(state.commands.moveStep).not.toHaveBeenCalled()
  })

  it('blocks a same-tick Start reentry launched from local authoring', async () => {
    const state = harness()
    let start: HTMLElement
    vi.mocked(state.commands.setJointPoseSpeed).mockImplementationOnce(async () => {
      fireEvent.click(start)
    })
    render(timeline(state))
    start = screen.getByRole('button', { name: 'Start Job' })
    fireEvent.change(screen.getByRole('spinbutton', {
      name: 'Step 1 speed to next Joint Pose',
    }), { target: { value: '55' } })

    expect(state.calls.start).not.toHaveBeenCalled()
  })

  it('rejects a Job owned by another Robot without rendering its steps', () => {
    const state = harness(); render(<TimelineV4 {...state} jobId="job-B" robotId="robot-A" />)
    expect(screen.getByText('No Job selected for this Robot.')).toBeVisible(); expect(screen.queryByRole('list', { name: 'Job steps' })).not.toBeInTheDocument()
  })

  it('does not schedule browser interpolation when a shared Start command executes', async () => {
    const user = userEvent.setup(); const state = harness(); const frame = vi.fn(); vi.stubGlobal('requestAnimationFrame', frame); render(timeline(state))
    await user.click(screen.getByRole('button', { name: 'Start Job' })); expect(state.calls.start).toHaveBeenCalledOnce(); expect(frame).not.toHaveBeenCalled()
  })

  it.each(['speed', 'move', 'delete', 'start'] as const)('rechecks latest Robot runtime before stale %s events', (operation) => {
    const state = harness(); render(timeline(state)); const target = operation === 'speed' ? screen.getByRole('spinbutton', { name: 'Step 1 speed to next Joint Pose' }) : screen.getByRole('button', { name: operation === 'move' ? 'Move step 2 up' : operation === 'delete' ? 'Delete step 2' : 'Start Job' })
    target.addEventListener(operation === 'speed' ? 'change' : 'click', () => state.jobs.getState().setRobotState(running()), { capture: true, once: true })
    if (operation === 'speed') fireEvent.change(target, { target: { value: '55' } }); else fireEvent.click(target)
    expect(state.commands.setJointPoseSpeed).not.toHaveBeenCalled(); expect(state.commands.moveStep).not.toHaveBeenCalled(); expect(state.commands.deleteStep).not.toHaveBeenCalled(); expect(state.calls.start).not.toHaveBeenCalled()
  })

  it('rechecks terminal runtime before stale Stop and project revision before stale Start', () => {
    const state = harness(); state.jobs.getState().setRobotState(running()); render(timeline(state)); const stop = screen.getByRole('button', { name: 'Stop Job' })
    stop.addEventListener('click', () => state.jobs.getState().setRobotState({ ...running(), state: 'SUCCEEDED', completedAtSimulationMs: 1 }), { capture: true, once: true }); fireEvent.click(stop); expect(state.calls.cancel).not.toHaveBeenCalled()
    state.jobs.getState().replaceProject({ ...state.project, revisionId: 'advanced' }); fireEvent.click(screen.getByRole('button', { name: 'Start Job' })); expect(state.calls.start).not.toHaveBeenCalled()
  })

  it.each(['speed', 'move', 'delete'] as const)('blocks synchronous local %s reentry before pending renders', async (operation) => {
    const state = harness(); let target: HTMLElement; const local = operation === 'speed' ? state.commands.setJointPoseSpeed : operation === 'move' ? state.commands.moveStep : state.commands.deleteStep
    vi.mocked(local).mockImplementationOnce(async () => { if (operation === 'speed') fireEvent.change(target, { target: { value: '55' } }); else fireEvent.click(target) })
    render(timeline(state)); target = operation === 'speed' ? screen.getByRole('spinbutton', { name: 'Step 1 speed to next Joint Pose' }) : screen.getByRole('button', { name: operation === 'move' ? 'Move step 2 up' : 'Delete step 2' })
    if (operation === 'speed') fireEvent.change(target, { target: { value: '55' } }); else fireEvent.click(target); await waitFor(() => expect(local).toHaveBeenCalledTimes(1))
  })

  it('releases local authoring after an asynchronous speed failure and permits a retry', async () => {
    const state = harness(); vi.mocked(state.commands.setJointPoseSpeed).mockRejectedValueOnce(new Error('speed rejected')); render(timeline(state))
    const speed = screen.getByRole('spinbutton', { name: 'Step 1 speed to next Joint Pose' }); fireEvent.change(speed, { target: { value: '55' } })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('speed rejected')); fireEvent.change(speed, { target: { value: '56' } }); await waitFor(() => expect(state.commands.setJointPoseSpeed).toHaveBeenCalledTimes(2))
  })
})
