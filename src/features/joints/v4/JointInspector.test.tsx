import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  type RobotJointDefinitionV4,
  type RobotJointSourceV4,
  type RobotDefinitionV4,
  type RobotJobV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { type JobCommandServiceV4 } from '../../jobs/v4/job-command-service.js'
import {
  createJobRuntimeStoreV4,
  type RobotJobRuntimeStateV4,
} from '../../jobs/v4/job-runtime-store.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import { JointInspectorV4 } from './JointInspector.js'
import type { RobotOperatorCommandServiceV4 } from './robot-operator-command-service.js'

interface JointSpecV4 {
  readonly id: string
  readonly type?: RobotJointDefinitionV4['type']
  readonly min?: number
  readonly max?: number
  readonly home?: number
}

const PROTOTYPE_JOINT_IDS = ['__proto__', 'constructor', 'toString'] as const

function ownNumberRecord(entries: readonly (readonly [string, number])[]): Record<string, number> {
  const record = Object.create(null) as Record<string, number>
  for (const [key, value] of entries) {
    Object.defineProperty(record, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    })
  }
  return record
}

function makeProject(
  specs: readonly JointSpecV4[],
  options: {
    readonly source?: RobotJointSourceV4
    readonly secondRobot?: boolean
    readonly jobs?: readonly RobotJobV4[]
  } = {},
): WorkcellProjectV4 {
  const base = makeMinimalWorkcellProjectV4()
  const source = options.source ?? 'simulation'
  const links = Array.from({ length: specs.length + 1 }, (_, index) => ({
    id: `link:${index}`,
    name: `Link ${index}`,
    geometryOccurrences: [],
  }))
  const joints = specs.map((spec, index): RobotJointDefinitionV4 => ({
    id: spec.id,
    type: spec.type ?? 'revolute',
    parentLinkId: `link:${index}`,
    childLinkId: `link:${index + 1}`,
    origin: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    axis: [0, 0, 1],
    min: spec.min ?? -180,
    max: spec.max ?? 180,
    home: spec.home ?? 0,
    zeroOffset: 0,
    direction: 1,
    maximumVelocity: spec.type === 'prismatic' ? 0.5 : 90,
  }))
  const definition: RobotDefinitionV4 = {
    ...base.robotDefinitions[0]!,
    id: 'definition:variable',
    links,
    joints,
    frames: [
      {
        id: 'base-frame',
        name: 'Base',
        parentFrameId: links[0]!.id,
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        role: 'base' as const,
      },
      {
        id: 'tool-frame',
        name: 'Tool',
        parentFrameId: links.at(-1)!.id,
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        role: 'tool' as const,
      },
      {
        id: 'tcp-frame',
        name: 'TCP',
        parentFrameId: 'tool-frame',
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        role: 'tcp' as const,
      },
    ],
  }
  const initialJointValues = ownNumberRecord(joints.map((joint) => [joint.id, joint.home]))
  const makeRobot = (id: string, name: string) => ({
    ...base.robots[0]!,
    id,
    name,
    definitionId: definition.id,
    initialJointValues,
    jointSource: source,
    selectedToolFrameId: 'tool-frame',
    selectedTcpFrameId: 'tcp-frame',
  })

  return {
    ...base,
    revisionId: 'revision:joint-inspector',
    robotDefinitions: [definition],
    robots: options.secondRobot === true
      ? [makeRobot('robot-a', 'Robot A'), makeRobot('robot-b', 'Robot B')]
      : [makeRobot('robot-a', 'Robot A')],
    jobs: options.jobs ?? [],
    opcUa: source.startsWith('opcua:')
      ? {
          ...base.opcUa,
          mode: 'client',
          endpoints: [{
            endpointId: source.slice('opcua:'.length),
            name: 'Robot source',
            endpointUrl: 'opc.tcp://127.0.0.1:4840',
            enabled: true,
            publishingIntervalMs: 100,
            reconnectDelayMs: 1_000,
          }],
        }
      : base.opcUa,
  }
}

function runningState(robotId: string, jobId = `job:${robotId}`): RobotJobRuntimeStateV4 {
  return {
    robotId,
    jobId,
    runId: `run:${robotId}`,
    state: 'RUNNING',
    stepIndex: 0,
    startedAtSimulationMs: 10,
    completedAtSimulationMs: null,
    failureCode: null,
    message: 'Running',
  }
}

function makeCommands() {
  const saveJointPose = vi.fn<JobCommandServiceV4['saveJointPose']>(async () => {})
  const commands: JobCommandServiceV4 = {
    createJob: vi.fn(async () => 'new-job'),
    renameJob: vi.fn(async () => {}),
    duplicateJob: vi.fn(async () => 'duplicate-job'),
    deleteJob: vi.fn(async () => {}),
    saveJointPose,
    addActionReference: vi.fn(async () => {}),
    moveStep: vi.fn(async () => {}),
    deleteStep: vi.fn(async () => {}),
    setJointPoseSpeed: vi.fn(async () => {}),
  }
  return { commands, saveJointPose }
}

function makeHarness(
  project: WorkcellProjectV4,
  selectedJobId: string | null = null,
  robotOperator?: RobotOperatorCommandServiceV4,
) {
  const robots = createRobotRuntimeRegistryV4()
  const jobs = createJobRuntimeStoreV4()
  robots.getState().replaceProject(project)
  jobs.getState().replaceProject(project)
  const { commands, saveJointPose } = makeCommands()
  const view = render(
    <JointInspectorV4
      commands={commands}
      jobs={jobs}
      project={project}
      robotId="robot-a"
      robots={robots}
      {...(robotOperator === undefined ? {} : { robotOperator })}
      selectedJobId={selectedJobId}
    />,
  )
  return { commands, jobs, project, robots, saveJointPose, view }
}

function inspectorRow(jointId: string): HTMLElement {
  return screen.getByRole('spinbutton', { name: jointId }).closest('[data-joint-id]')!
}

describe('JointInspectorV4', () => {
  it('derives one control from Definition order with persisted revolute limits and degrees', () => {
    const project = makeProject([{ id: 'waist-axis', min: -95, max: 125, home: 12 }])
    makeHarness(project)

    const slider = screen.getByRole('slider', { name: 'waist-axis' })
    const number = screen.getByRole('spinbutton', { name: 'waist-axis' })
    expect(screen.getAllByRole('slider')).toHaveLength(1)
    expect(slider).toHaveAttribute('min', '-95')
    expect(slider).toHaveAttribute('max', '125')
    expect(slider).toHaveAttribute('step', '1')
    expect(number).toHaveValue(12)
    expect(inspectorRow('waist-axis')).toHaveTextContent('deg')
  })

  it('renders sixteen literal IDs in Definition order and uses metres for prismatic Joints', () => {
    const ids = [
      'axis-alpha',
      'slide-z',
      ...PROTOTYPE_JOINT_IDS,
      'wrist-a',
      'wrist-b',
      'elbow',
      'pitch',
      'roll',
      'yaw',
      'axis-12',
      'axis-13',
      'axis-14',
      'axis-15',
      'axis-16',
    ]
    const project = makeProject(ids.map((id, index) => index === 1
      ? { id, type: 'prismatic', min: -0.125, max: 0.75, home: 0.025 }
      : { id }))
    makeHarness(project)

    expect(screen.getAllByRole('spinbutton').map((input) => input.getAttribute('aria-label')))
      .toEqual(ids)
    const slide = screen.getByRole('spinbutton', { name: 'slide-z' })
    expect(slide).toHaveAttribute('min', '-0.125')
    expect(slide).toHaveAttribute('max', '0.75')
    expect(slide).toHaveAttribute('step', '0.001')
    expect(slide).toHaveValue(0.025)
    expect(inspectorRow('slide-z')).toHaveTextContent('m')
    expect(inspectorRow('axis-alpha')).toHaveTextContent('deg')
  })

  it('writes one own-property-safe partial record using the selected Robot writer', () => {
    const project = makeProject([
      { id: '__proto__', min: -10, max: 10 },
      { id: 'constructor', min: -10, max: 10 },
      { id: 'toString', min: -10, max: 10 },
    ])
    const harness = makeHarness(project)
    const write = vi.spyOn(harness.robots.getState(), 'writeJointValues')

    fireEvent.change(screen.getByRole('slider', { name: '__proto__' }), {
      target: { value: '7' },
    })

    expect(write).toHaveBeenCalledTimes(1)
    const [robotId, values, writer] = write.mock.calls[0]!
    expect(robotId).toBe('robot-a')
    expect(writer).toBe('simulation')
    expect(Object.getPrototypeOf(values)).toBeNull()
    expect(Reflect.ownKeys(values)).toEqual(['__proto__'])
    expect(Object.getOwnPropertyDescriptor(values, '__proto__')).toMatchObject({
      enumerable: true,
      value: 7,
    })
  })

  it('writes exact Definition homes through the same allowed manual writer', async () => {
    const user = userEvent.setup()
    const project = makeProject([
      { id: '__proto__', min: -10, max: 10, home: 1 },
      { id: 'constructor', min: -10, max: 10, home: 2 },
      { id: 'toString', min: -10, max: 10, home: 3 },
    ], { source: 'manual' })
    const harness = makeHarness(project)
    const write = vi.spyOn(harness.robots.getState(), 'writeJointValues')

    await user.click(screen.getByRole('button', { name: 'Robot Home' }))

    expect(write).toHaveBeenCalledTimes(1)
    const [robotId, values, writer] = write.mock.calls[0]!
    expect(robotId).toBe('robot-a')
    expect(writer).toBe('manual')
    expect(Object.getPrototypeOf(values)).toBeNull()
    expect(Reflect.ownKeys(values)).toEqual(PROTOTYPE_JOINT_IDS)
    expect(PROTOTYPE_JOINT_IDS.map((id) => values[id])).toEqual([1, 2, 3])
  })

  it('keeps manual Jog enabled while running but locks a running simulation Robot only', () => {
    const manualProject = makeProject([{ id: 'axis-a' }], { source: 'manual' })
    const manual = makeHarness(manualProject)
    act(() => manual.jobs.getState().setRobotState(runningState('robot-a')))
    expect(screen.getByRole('slider', { name: 'axis-a' })).toBeEnabled()
    expect(screen.getByText('Source: manual')).toBeVisible()
    manual.view.unmount()

    const simulationProject = makeProject([{ id: 'axis-a' }])
    const simulation = makeHarness(simulationProject)
    act(() => simulation.jobs.getState().setRobotState(runningState('robot-a')))
    expect(screen.getByRole('slider', { name: 'axis-a' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Robot Home' })).toBeDisabled()
    expect(screen.getByText(/running Job owns Robot robot-a/i)).toBeVisible()
  })

  it('rechecks a newly RUNNING simulation Robot inside stale Jog, Home, and Save handlers', async () => {
    const project = makeProject([{ id: 'axis-a', home: 5 }], {
      jobs: [{ id: 'job-a', name: 'Job A', robotId: 'robot-a', steps: [] }],
    })
    const harness = makeHarness(project, 'job-a')
    const write = vi.spyOn(harness.robots.getState(), 'writeJointValues')
    const slider = screen.getByRole('slider', { name: 'axis-a' })
    const home = screen.getByRole('button', { name: 'Robot Home' })
    const save = screen.getByRole('button', { name: 'Save Pose' })

    act(() => {
      harness.jobs.getState().setRobotState(runningState('robot-a', 'job-a'))
      fireEvent.change(slider, { target: { value: '25' } })
      fireEvent.click(home)
      fireEvent.click(save)
    })
    await Promise.resolve()

    expect(write).not.toHaveBeenCalled()
    expect(harness.saveJointPose).not.toHaveBeenCalled()
    expect(harness.robots.getState().robots['robot-a']?.jointValues['axis-a']).toBe(5)
  })

  it('treats an unrelated running Robot independently', () => {
    const project = makeProject([{ id: 'axis-a' }], { secondRobot: true })
    const harness = makeHarness(project)

    act(() => harness.jobs.getState().setRobotState(runningState('robot-b')))

    expect(screen.getByRole('slider', { name: 'axis-a' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Robot Home' })).toBeEnabled()
  })

  it('renders OPC UA ownership as read-only without impersonating its writer', () => {
    const project = makeProject([{ id: 'axis-a' }], { source: 'opcua:endpoint-a' })
    const harness = makeHarness(project)
    const write = vi.spyOn(harness.robots.getState(), 'writeJointValues')

    expect(screen.getByText('Source: OPC UA (endpoint-a)')).toBeVisible()
    expect(screen.getByRole('slider', { name: 'axis-a' })).toBeDisabled()
    expect(screen.getByRole('spinbutton', { name: 'axis-a' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Robot Home' })).toBeDisabled()
    fireEvent.change(screen.getByRole('slider', { name: 'axis-a' }), {
      target: { value: '20' },
    })
    expect(write).not.toHaveBeenCalled()
  })

  it('preserves a dirty draft through unrelated Robot updates and resynchronizes on commit', async () => {
    const user = userEvent.setup()
    const project = makeProject([
      { id: 'axis-a', min: -100, max: 100 },
      { id: 'axis-b', min: -100, max: 100 },
    ], { secondRobot: true })
    const harness = makeHarness(project)
    const draft = screen.getByRole('spinbutton', { name: 'axis-a' })

    await user.click(draft)
    fireEvent.change(draft, { target: { value: '42' } })
    act(() => {
      harness.robots.getState().writeJointValues('robot-b', { 'axis-a': 30 }, 'simulation')
    })
    expect(draft).toHaveValue(42)

    await user.keyboard('{Enter}')
    expect(harness.robots.getState().robots['robot-a']!.jointValues['axis-a']).toBe(42)
    expect(draft).toHaveValue(42)
  })

  it('resynchronizes a rejected selected-Joint draft from authoritative runtime', async () => {
    const user = userEvent.setup()
    const project = makeProject([{ id: 'axis-a', min: -10, max: 10, home: 3 }])
    makeHarness(project)
    const draft = screen.getByRole('spinbutton', { name: 'axis-a' })

    await user.click(draft)
    fireEvent.change(draft, { target: { value: '999' } })
    await user.keyboard('{Enter}')

    expect(draft).toHaveValue(3)
    expect(screen.getByRole('alert')).toHaveTextContent('Joint command must be within -10..10.')
  })

  it('opens and closes only the selected Robot gripper', async () => {
    const user = userEvent.setup()
    const project = makeProject([{ id: 'axis-a' }], { secondRobot: true })
    const harness = makeHarness(project)
    const setGripperState = vi.spyOn(harness.robots.getState(), 'setGripperState')

    await user.click(screen.getByRole('button', { name: 'Close Gripper' }))
    await user.click(screen.getByRole('button', { name: 'Open Gripper' }))

    expect(setGripperState.mock.calls).toEqual([
      ['robot-a', 'CLOSED'],
      ['robot-a', 'OPEN'],
    ])
    expect(harness.robots.getState().robots['robot-b']!.gripperState).toBe('OPEN')
  })

  it('saves every exact live Joint key to the selected owned Job at speed 100', async () => {
    const user = userEvent.setup()
    const jobs: readonly RobotJobV4[] = [
      { id: 'job-a', name: 'Job A', robotId: 'robot-a', steps: [] },
      { id: 'job-b', name: 'Job B', robotId: 'robot-b', steps: [] },
    ]
    const project = makeProject(PROTOTYPE_JOINT_IDS.map((id) => ({ id, min: -10, max: 10 })), {
      jobs,
      secondRobot: true,
    })
    const harness = makeHarness(project, 'job-a')
    act(() => {
      harness.robots.getState().writeJointValues(
        'robot-a',
        ownNumberRecord([['__proto__', 1], ['constructor', 2], ['toString', 3]]),
        'simulation',
      )
    })

    await user.click(screen.getByRole('button', { name: 'Save Pose' }))

    await waitFor(() => expect(harness.saveJointPose).toHaveBeenCalledTimes(1))
    const [jobId, values, speed] = harness.saveJointPose.mock.calls[0]!
    expect(jobId).toBe('job-a')
    expect(speed).toBe(100)
    expect(Object.getPrototypeOf(values)).toBeNull()
    expect(Reflect.ownKeys(values)).toEqual(PROTOTYPE_JOINT_IDS)
    expect(PROTOTYPE_JOINT_IDS.map((id) => values[id])).toEqual([1, 2, 3])
  })

  it('disables Save Pose for foreign, absent, or selected-Robot-running Jobs only', () => {
    const jobs: readonly RobotJobV4[] = [
      { id: 'job-a', name: 'Job A', robotId: 'robot-a', steps: [] },
      { id: 'job-b', name: 'Job B', robotId: 'robot-b', steps: [] },
    ]
    const project = makeProject([{ id: 'axis-a' }], { jobs, secondRobot: true })
    const harness = makeHarness(project, 'job-b')
    expect(screen.getByRole('button', { name: 'Save Pose' })).toBeDisabled()

    harness.view.rerender(
      <JointInspectorV4
        commands={harness.commands}
        jobs={harness.jobs}
        project={project}
        robotId="robot-a"
        robots={harness.robots}
        selectedJobId={null}
      />,
    )
    expect(screen.getByRole('button', { name: 'Save Pose' })).toBeDisabled()

    harness.view.rerender(
      <JointInspectorV4
        commands={harness.commands}
        jobs={harness.jobs}
        project={project}
        robotId="robot-a"
        robots={harness.robots}
        selectedJobId="job-a"
      />,
    )
    expect(screen.getByRole('button', { name: 'Save Pose' })).toBeEnabled()
    act(() => harness.jobs.getState().setRobotState(runningState('robot-b', 'job-b')))
    expect(screen.getByRole('button', { name: 'Save Pose' })).toBeEnabled()
    act(() => harness.jobs.getState().setRobotState(runningState('robot-a', 'job-a')))
    expect(screen.getByRole('button', { name: 'Save Pose' })).toBeDisabled()
  })

  it('shows only the selected Robot controls when robotId changes', () => {
    const project = makeProject([{ id: 'axis-a' }], { secondRobot: true })
    const harness = makeHarness(project)
    const setGripperState = vi.spyOn(harness.robots.getState(), 'setGripperState')

    harness.view.rerender(
      <JointInspectorV4
        commands={harness.commands}
        jobs={harness.jobs}
        project={project}
        robotId="robot-b"
        robots={harness.robots}
        selectedJobId={null}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open Gripper' }))
    expect(setGripperState).toHaveBeenCalledWith('robot-b', 'OPEN')
    expect(within(screen.getByRole('group', { name: 'Robot B Joint controls' }))
      .getAllByRole('spinbutton')).toHaveLength(1)
  })

  it('delegates Robot Home, Gripper, and Save Pose through an injected operator', async () => {
    const user = userEvent.setup()
    const project = makeProject([{ id: 'axis-a' }], {
      jobs: [{ id: 'job-a', name: 'Job A', robotId: 'robot-a', steps: [] }],
    })
    const operator: RobotOperatorCommandServiceV4 = {
      canHome: vi.fn(() => true),
      home: vi.fn(),
      setGripper: vi.fn(),
      canSavePose: vi.fn(() => true),
      savePose: vi.fn(async () => undefined),
    }
    makeHarness(project, 'job-a', operator)
    await user.click(screen.getByRole('button', { name: 'Robot Home' }))
    await user.click(screen.getByRole('button', { name: 'Close Gripper' }))
    await user.click(screen.getByRole('button', { name: 'Save Pose' }))
    await waitFor(() => expect(operator.savePose).toHaveBeenCalledWith('robot-a', 'job-a'))
    expect(operator.home).toHaveBeenCalledWith('robot-a')
    expect(operator.setGripper).toHaveBeenCalledWith('robot-a', 'CLOSED')
  })
})
