import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { type RobotDefinitionV4, type RobotJobV4, type RobotJointDefinitionV4, type RobotJointSourceV4, type WorkcellProjectV4 } from '../../../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { createAppCommandBindingsV4, createAppCommandRuntimeV4 } from '../../commands/v4/app-command-runtime.js'
import { createAppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'
import { createJobRuntimeStoreV4, type RobotJobRuntimeStateV4 } from '../../jobs/v4/job-runtime-store.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import { JointInspectorV4 } from './JointInspector.js'

function own(entries: readonly (readonly [string, number])[]) { const record = Object.create(null) as Record<string, number>; for (const [key, value] of entries) Object.defineProperty(record, key, { configurable: true, enumerable: true, value, writable: true }); return record }
function project(specs: readonly { readonly id: string; readonly type?: RobotJointDefinitionV4['type']; readonly min?: number; readonly max?: number; readonly home?: number }[], options: { readonly source?: RobotJointSourceV4; readonly secondRobot?: boolean; readonly jobs?: readonly RobotJobV4[] } = {}): WorkcellProjectV4 {
  const base = makeMinimalWorkcellProjectV4(); const source = options.source ?? 'simulation'
  const links = Array.from({ length: specs.length + 1 }, (_, index) => ({ id: `link:${index}`, name: `Link ${index}`, geometryOccurrences: [] }))
  const joints = specs.map((spec, index): RobotJointDefinitionV4 => ({ id: spec.id, type: spec.type ?? 'revolute', parentLinkId: `link:${index}`, childLinkId: `link:${index + 1}`, origin: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, axis: [0, 0, 1], min: spec.min ?? -180, max: spec.max ?? 180, home: spec.home ?? 0, zeroOffset: 0, direction: 1, maximumVelocity: spec.type === 'prismatic' ? 0.5 : 90 }))
  const definition: RobotDefinitionV4 = { ...base.robotDefinitions[0]!, id: 'definition:test', links, joints, frames: [{ id: 'base-frame', name: 'Base', parentFrameId: links[0]!.id, localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, role: 'base' }, { id: 'tool-frame', name: 'Tool', parentFrameId: links.at(-1)!.id, localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, role: 'tool' }, { id: 'tcp-frame', name: 'TCP', parentFrameId: 'tool-frame', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, role: 'tcp' }] }
  const makeRobot = (id: string, name: string) => ({ ...base.robots[0]!, id, name, definitionId: definition.id, initialJointValues: own(joints.map((joint) => [joint.id, joint.home])), jointSource: source, selectedToolFrameId: 'tool-frame', selectedTcpFrameId: 'tcp-frame' })
  return { ...base, revisionId: 'joint-test-revision', robotDefinitions: [definition], robots: options.secondRobot ? [makeRobot('robot-a', 'Robot A'), makeRobot('robot-b', 'Robot B')] : [makeRobot('robot-a', 'Robot A')], jobs: options.jobs ?? [], opcUa: source.startsWith('opcua:') ? { ...base.opcUa, mode: 'client', endpoints: [{ endpointId: source.slice('opcua:'.length), name: 'Robot source', endpointUrl: 'opc.tcp://127.0.0.1:4840', enabled: true, publishingIntervalMs: 100, reconnectDelayMs: 1_000 }] } : base.opcUa }
}
function running(robotId: string, jobId = `job-${robotId}`): RobotJobRuntimeStateV4 { return { robotId, jobId, runId: `run-${robotId}`, state: 'RUNNING', stepIndex: 0, startedAtSimulationMs: 0, completedAtSimulationMs: null, failureCode: null, message: 'Running' } }

function harness(workcell = project([{ id: 'axis-a' }])) {
  const robots = createRobotRuntimeRegistryV4(); const jobs = createJobRuntimeStoreV4(); robots.getState().replaceProject(workcell); jobs.getState().replaceProject(workcell)
  let robotId = 'robot-a'; let jobId = workcell.jobs.find((job) => job.robotId === robotId)?.id ?? null
  const calls = {
    home: vi.fn<(robotId: string) => void>(),
    gripper: vi.fn<(robotId: string, state: 'OPEN' | 'CLOSED') => void>(),
    save: vi.fn<(robotId: string, jobId: string | null) => Promise<void>>(async (): Promise<void> => {}),
  }
  const registry = () => createAppCommandRegistryV4([
    { id: 'robot.home', label: 'Robot Home', section: 'home', kind: 'action', visible: true, get enabled() { return robots.getState().robots[robotId]?.jointSource !== undefined && jobs.getState().byRobotId[robotId]?.state !== 'RUNNING' }, execute: () => { const definition = workcell.robotDefinitions[0]!; robots.getState().writeJointValues(robotId, own(definition.joints.map((joint) => [joint.id, joint.home])), robots.getState().robots[robotId]!.jointSource); calls.home(robotId) } },
    { id: 'robot.gripper.open', label: 'Open Gripper', section: 'home', kind: 'action', visible: true, enabled: true, execute: () => { robots.getState().setGripperState(robotId, 'OPEN'); calls.gripper(robotId, 'OPEN') } },
    { id: 'robot.gripper.close', label: 'Close Gripper', section: 'home', kind: 'action', visible: true, enabled: true, execute: () => { robots.getState().setGripperState(robotId, 'CLOSED'); calls.gripper(robotId, 'CLOSED') } },
    { id: 'job.pose.save', label: 'Save Pose', section: 'job', kind: 'action', visible: true, get enabled() { return jobId !== null && workcell.jobs.some((job) => job.id === jobId && job.robotId === robotId) && jobs.getState().byRobotId[robotId]?.state !== 'RUNNING' }, execute: () => calls.save(robotId, jobId) },
  ])
  const runtime = createAppCommandRuntimeV4(registry()); const commandBindings = createAppCommandBindingsV4(runtime)
  const renderInspector = (nextRobotId = robotId, nextJobId = jobId) => { robotId = nextRobotId; jobId = nextJobId; runtime.replaceRegistry(registry()); return <JointInspectorV4 commandBindings={commandBindings} jobs={jobs} project={workcell} robotId={robotId} robots={robots} /> }
  const view = render(renderInspector())
  return { workcell, robots, jobs, calls, runtime, commandBindings, view, renderInspector }
}

describe('JointInspectorV4', () => {
  it('derives Definition-order controls, units, limits, and own-property-safe local joint writes', () => {
    const state = harness(project([{ id: '__proto__', min: -10, max: 10, home: 1 }, { id: 'slide-z', type: 'prismatic', min: -0.1, max: 0.5, home: 0.025 }, { id: 'constructor', home: 3 }]))
    const slider = screen.getByRole('slider', { name: '__proto__' }); const slide = screen.getByRole('spinbutton', { name: 'slide-z' })
    expect(slider).toHaveAttribute('min', '-10'); expect(slide).toHaveAttribute('step', '0.001'); expect(slide).toHaveValue(0.025)
    const write = vi.spyOn(state.robots.getState(), 'writeJointValues')
    fireEvent.change(slider, { target: { value: '7' } }); const [, values, writer] = write.mock.calls[0]!
    expect(Object.getPrototypeOf(values)).toBeNull(); expect(values['__proto__']).toBe(7); expect(writer).toBe('simulation')
  })

  it('keeps local drafts through unrelated Robot updates and rejects invalid draft commits authoritatively', async () => {
    const user = userEvent.setup(); const state = harness(project([{ id: 'axis-a', min: -10, max: 10, home: 3 }, { id: 'axis-b' }], { secondRobot: true }))
    const draft = screen.getByRole('spinbutton', { name: 'axis-a' }); await user.click(draft); fireEvent.change(draft, { target: { value: '7' } })
    act(() => state.robots.getState().writeJointValues('robot-b', { 'axis-a': 4 }, 'simulation')); expect(draft).toHaveValue(7)
    await user.keyboard('{Enter}'); expect(draft).toHaveValue(7)
    fireEvent.change(draft, { target: { value: '999' } }); fireEvent.blur(draft); await waitFor(() => expect(draft).toHaveValue(7)); expect(screen.getByRole('alert')).toHaveTextContent('Joint command must be within -10..10.')
  })

  it('keeps manual local Jog enabled while a selected simulation Robot is running, without affecting another Robot', () => {
    const manual = harness(project([{ id: 'axis-a' }], { source: 'manual' })); act(() => manual.jobs.getState().setRobotState(running('robot-a'))); expect(screen.getByRole('slider', { name: 'axis-a' })).toBeEnabled(); manual.view.unmount()
    const state = harness(project([{ id: 'axis-a' }], { secondRobot: true })); act(() => state.jobs.getState().setRobotState(running('robot-b'))); expect(screen.getByRole('slider', { name: 'axis-a' })).toBeEnabled()
    act(() => state.jobs.getState().setRobotState(running('robot-a'))); expect(screen.getByRole('slider', { name: 'axis-a' })).toBeDisabled(); expect(screen.getByText(/running Job owns Robot robot-a/i)).toBeVisible()
  })

  it('uses exact shared Robot Home and gripper IDs rather than a local operator', async () => {
    const user = userEvent.setup(); const state = harness(project([{ id: '__proto__', home: 1 }, { id: 'constructor', home: 2 }], { secondRobot: true }))
    await user.click(screen.getByRole('button', { name: 'Robot Home' })); await user.click(screen.getByRole('button', { name: 'Close Gripper' })); await user.click(screen.getByRole('button', { name: 'Open Gripper' }))
    expect(state.calls.home).toHaveBeenCalledWith('robot-a'); expect(state.calls.gripper.mock.calls).toEqual([['robot-a', 'CLOSED'], ['robot-a', 'OPEN']]); expect(state.robots.getState().robots['robot-b']!.gripperState).toBe('OPEN')
  })

  it('uses shared Save Pose with exact enabled, pending, error, and same-ID single-flight semantics', async () => {
    const user = userEvent.setup(); const state = harness(project([{ id: 'axis-a' }], { jobs: [{ id: 'job-a', name: 'Job A', robotId: 'robot-a', steps: [] }] }))
    let reject!: (reason: Error) => void; state.calls.save.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail }))
    await user.click(screen.getByRole('button', { name: 'Save Pose' })); expect(screen.getByText('Saving Pose')).toBeDisabled(); await user.click(screen.getByText('Saving Pose')); expect(state.calls.save).toHaveBeenCalledTimes(1)
    reject(new Error('save rejected')); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('save rejected'))
  })

  it('shares one pending/error state and execution across two bound inspector surfaces', async () => {
    const user = userEvent.setup(); const state = harness(project([{ id: 'axis-a' }], { jobs: [{ id: 'job-a', name: 'Job A', robotId: 'robot-a', steps: [] }] }))
    let reject!: (reason: Error) => void; state.calls.save.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail })); state.view.unmount()
    render(<><section aria-label="first">{state.renderInspector()}</section><section aria-label="second">{state.renderInspector()}</section></>)
    const first = within(screen.getByRole('region', { name: 'first' })); const second = within(screen.getByRole('region', { name: 'second' }))
    await user.click(first.getByRole('button', { name: 'Save Pose' })); await user.click(second.getByText('Saving Pose')); expect(state.calls.save).toHaveBeenCalledTimes(1)
    reject(new Error('shared save rejected')); await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
  })

  it('hides unavailable bound actions and retargets shared controls when the active Robot changes', async () => {
    const user = userEvent.setup(); const state = harness(project([{ id: 'axis-a' }], { secondRobot: true })); state.runtime.replaceRegistry(createAppCommandRegistryV4([])); await waitFor(() => expect(screen.queryByRole('button', { name: 'Robot Home' })).not.toBeInTheDocument())
    state.view.rerender(state.renderInspector('robot-b', null)); await user.click(screen.getByRole('button', { name: 'Open Gripper' })); expect(state.calls.gripper).toHaveBeenLastCalledWith('robot-b', 'OPEN'); expect(within(screen.getByRole('group', { name: 'Robot B Joint controls' })).getAllByRole('spinbutton')).toHaveLength(1)
  })

  it('renders the complete literal Definition order and uses metres for prismatic Joints', () => {
    const ids = ['axis-alpha', 'slide-z', '__proto__', 'constructor', 'toString', 'wrist-a', 'wrist-b', 'elbow', 'pitch', 'roll', 'yaw', 'axis-12', 'axis-13', 'axis-14', 'axis-15', 'axis-16']
    harness(project(ids.map((id, index) => index === 1 ? { id, type: 'prismatic', min: -0.125, max: 0.75, home: 0.025 } : { id })))
    expect(screen.getAllByRole('spinbutton').map((input) => input.getAttribute('aria-label'))).toEqual(ids)
    expect(screen.getByRole('spinbutton', { name: 'slide-z' })).toHaveAttribute('step', '0.001')
  })

  it('uses manual Home source ownership and blocks OPC UA local writers', async () => {
    const user = userEvent.setup(); const manual = harness(project([{ id: 'axis-a', home: 4 }], { source: 'manual' })); const write = vi.spyOn(manual.robots.getState(), 'writeJointValues')
    await user.click(screen.getByRole('button', { name: 'Robot Home' })); expect(write).toHaveBeenCalledWith('robot-a', expect.objectContaining({ 'axis-a': 4 }), 'manual'); manual.view.unmount()
    harness(project([{ id: 'axis-a' }], { source: 'opcua:endpoint-a' })); expect(screen.getByText('Source: OPC UA (endpoint-a)')).toBeVisible(); expect(screen.getByRole('slider', { name: 'axis-a' })).toBeDisabled()
  })

  it('rechecks stale RUNNING ownership for local Jog while retaining unrelated Robot isolation', () => {
    const state = harness(project([{ id: 'axis-a' }], { secondRobot: true })); const write = vi.spyOn(state.robots.getState(), 'writeJointValues'); const slider = screen.getByRole('slider', { name: 'axis-a' })
    slider.addEventListener('change', () => state.jobs.getState().setRobotState(running('robot-a')), { capture: true, once: true }); fireEvent.change(slider, { target: { value: '25' } })
    expect(write).not.toHaveBeenCalled(); expect(screen.getByRole('slider', { name: 'axis-a' })).toBeDisabled()
  })

  it('gates shared Save Pose for foreign, absent, and selected-Robot-running Jobs only', () => {
    const workcell = project([{ id: 'axis-a' }], { secondRobot: true, jobs: [{ id: 'job-a', name: 'Job A', robotId: 'robot-a', steps: [] }, { id: 'job-b', name: 'Job B', robotId: 'robot-b', steps: [] }] })
    const state = harness(workcell); state.view.rerender(state.renderInspector('robot-a', 'job-b')); expect(screen.getByRole('button', { name: 'Save Pose' })).toBeDisabled()
    state.view.rerender(state.renderInspector('robot-a', 'job-a')); expect(screen.getByRole('button', { name: 'Save Pose' })).toBeEnabled()
    act(() => state.jobs.getState().setRobotState(running('robot-a', 'job-a'))); expect(screen.getByRole('button', { name: 'Save Pose' })).toBeDisabled()
  })

  it('rechecks stale Home and Save events against the latest running Robot and preserves exact live target', () => {
    const state = harness(project([{ id: 'axis-a', home: 5 }], { jobs: [{ id: 'job-a', name: 'Job A', robotId: 'robot-a', steps: [] }] }))
    const home = screen.getByRole('button', { name: 'Robot Home' }); const save = screen.getByRole('button', { name: 'Save Pose' })
    for (const target of [home, save]) target.addEventListener('click', () => state.jobs.getState().setRobotState(running('robot-a', 'job-a')), { capture: true, once: true })
    fireEvent.click(home); fireEvent.click(save); expect(state.calls.home).not.toHaveBeenCalled(); expect(state.calls.save).not.toHaveBeenCalled()
  })

  it('releases shared Save Pose after failure so the exact active Job target can retry', async () => {
    const user = userEvent.setup(); const state = harness(project([{ id: 'axis-a' }], { jobs: [{ id: 'job-a', name: 'Job A', robotId: 'robot-a', steps: [] }] }))
    state.calls.save.mockRejectedValueOnce(new Error('pose rejected')); await user.click(screen.getByRole('button', { name: 'Save Pose' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('pose rejected')); await user.click(screen.getByRole('button', { name: 'Save Pose' })); await waitFor(() => expect(state.calls.save).toHaveBeenCalledTimes(2))
  })
})
