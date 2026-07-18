import { describe, expect, it, vi } from 'vitest'
import {
  validateWorkcellProjectV4,
  type RobotJointSourceV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { createJobRuntimeStoreV4 } from '../../jobs/v4/job-runtime-store.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import { createRobotOperatorCommandServiceV4 } from './robot-operator-command-service.js'

function ownRecord(entries: readonly (readonly [string, number])[]): Record<string, number> {
  const record = Object.create(null) as Record<string, number>
  for (const [key, value] of entries) {
    Object.defineProperty(record, key, { configurable: true, enumerable: true, value, writable: true })
  }
  return record
}

function projectFixture(input: {
  readonly sourceA?: RobotJointSourceV4
  readonly sourceB?: RobotJointSourceV4
  readonly prototypeJoints?: boolean
} = {}): WorkcellProjectV4 {
  const base = structuredClone(makeMinimalWorkcellProjectV4())
  const sourceA = input.sourceA ?? 'simulation'
  const sourceB = input.sourceB ?? 'simulation'
  const jointIds = input.prototypeJoints === true ? ['__proto__', 'constructor', 'toString'] : ['J1']
  const links = Array.from({ length: jointIds.length + 1 }, (_, index) => ({
    id: `L${index}`, name: `L${index}`, geometryOccurrences: [],
  }))
  const definition = {
    ...base.robotDefinitions[0]!,
    links,
    joints: jointIds.map((id, index) => ({
      ...base.robotDefinitions[0]!.joints[0]!, id, parentLinkId: `L${index}`,
      childLinkId: `L${index + 1}`, home: index + 1,
    })),
    frames: [
      { ...base.robotDefinitions[0]!.frames[0]!, parentFrameId: 'L0' },
      { ...base.robotDefinitions[0]!.frames[1]!, parentFrameId: `L${jointIds.length}` },
      { ...base.robotDefinitions[0]!.frames[2]!, parentFrameId: base.robotDefinitions[0]!.frames[1]!.id },
    ],
  }
  const values = ownRecord(jointIds.map((id, index) => [id, index + 10]))
  const robot = (id: string, source: RobotJointSourceV4) => ({
    ...base.robots[0]!, id, name: id, definitionId: definition.id, jointSource: source,
    initialJointValues: values,
  })
  return validateWorkcellProjectV4({
    ...base,
    revisionId: 'revision-operator',
    robotDefinitions: [definition],
    robots: [robot('robot-a', sourceA), robot('robot-b', sourceB)],
    jobs: [
      { id: 'job-a', name: 'A', robotId: 'robot-a', steps: [] },
      { id: 'job-b', name: 'B', robotId: 'robot-b', steps: [] },
    ],
    opcUa: sourceA.startsWith('opcua:') || sourceB.startsWith('opcua:') ? {
      ...base.opcUa,
      mode: 'client',
      endpoints: [{
        endpointId: 'endpoint-a', name: 'Endpoint', endpointUrl: 'opc.tcp://127.0.0.1:4840',
        enabled: true, publishingIntervalMs: 100, reconnectDelayMs: 1_000,
      }],
    } : base.opcUa,
  })
}

function running(robotId: string, jobId: string) {
  return {
    robotId, jobId, runId: `run-${robotId}`, state: 'RUNNING' as const, stepIndex: 0,
    startedAtSimulationMs: 0, completedAtSimulationMs: null, failureCode: null, message: '',
  }
}

function harness(project = projectFixture()) {
  const robots = createRobotRuntimeRegistryV4()
  const jobs = createJobRuntimeStoreV4()
  robots.getState().replaceProject(project)
  jobs.getState().replaceProject(project)
  const saveJointPose = vi.fn(async (): Promise<void> => {})
  const service = createRobotOperatorCommandServiceV4({
    readProject: () => project, robots, jobs, jobCommands: { saveJointPose },
  })
  return { jobs, robots, saveJointPose, service }
}

describe('createRobotOperatorCommandServiceV4', () => {
  it('keeps manual Home available while running and rejects a stale simulation Home race', () => {
    const manual = harness(projectFixture({ sourceA: 'manual' }))
    manual.jobs.getState().setRobotState(running('robot-a', 'job-a'))
    expect(manual.service.canHome('robot-a')).toBe(true)
    const manualWrite = vi.spyOn(manual.robots.getState(), 'writeJointValues')
    manual.service.home('robot-a')
    expect(manualWrite).toHaveBeenLastCalledWith('robot-a', expect.any(Object), 'manual')

    const simulation = harness()
    expect(simulation.service.canHome('robot-a')).toBe(true)
    simulation.jobs.getState().setRobotState(running('robot-a', 'job-a'))
    expect(() => simulation.service.home('robot-a')).toThrow(/Robot Home is unavailable/)
    expect(harness(projectFixture({ sourceA: 'opcua:endpoint-a' })).service.canHome('robot-a')).toBe(false)
  })

  it('homes definition-order own properties and targets only the requested Robot gripper', () => {
    const state = harness(projectFixture({ prototypeJoints: true }))
    const write = vi.spyOn(state.robots.getState(), 'writeJointValues')
    state.service.home('robot-a')
    const [, values] = write.mock.calls[0]!
    expect(Object.getPrototypeOf(values)).toBeNull()
    expect(Reflect.ownKeys(values)).toEqual(['__proto__', 'constructor', 'toString'])
    expect(values).toEqual(expect.objectContaining({ __proto__: 1, constructor: 2, toString: 3 }))
    state.service.setGripper('robot-a', 'CLOSED')
    expect(state.robots.getState().robots['robot-a']!.gripperState).toBe('CLOSED')
    expect(state.robots.getState().robots['robot-b']!.gripperState).toBe('OPEN')
  })

  it('requires an owned non-running Job and captures live values before the first await', async () => {
    const state = harness()
    expect(state.service.canSavePose('robot-a', null)).toBe(false)
    await expect(state.service.savePose('robot-a', 'job-b')).rejects.toThrow(/Save Pose is unavailable/)
    await expect(state.service.savePose('robot-a', 'missing')).rejects.toThrow(/Save Pose is unavailable/)
    state.jobs.getState().setRobotState(running('robot-a', 'job-a'))
    expect(state.service.canSavePose('robot-a', 'job-a')).toBe(false)
    await expect(state.service.savePose('robot-a', 'job-a')).rejects.toThrow(/Save Pose is unavailable/)
    state.jobs.getState().replaceProject(projectFixture())
    state.robots.getState().replaceProject(projectFixture())

    let release: () => void = () => {}
    state.saveJointPose.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
    state.robots.getState().writeJointValues('robot-a', { J1: 21 }, 'simulation')
    const pending = state.service.savePose('robot-a', 'job-a')
    state.robots.getState().writeJointValues('robot-a', { J1: 45 }, 'simulation')
    expect(state.saveJointPose).toHaveBeenCalledWith('job-a', expect.objectContaining({ J1: 21 }), 100)
    release()
    await pending
  })

  it('treats an unrelated running Robot independently and returns false for revision mismatches', async () => {
    const state = harness()
    state.jobs.getState().setRobotState(running('robot-b', 'job-b'))
    expect(state.service.canSavePose('robot-a', 'job-a')).toBe(true)
    state.robots.getState().replaceProject({ ...projectFixture(), revisionId: 'revision-new' })
    expect(state.service.canHome('robot-a')).toBe(false)
    expect(state.service.canSavePose('robot-a', 'job-a')).toBe(false)
    expect(() => state.service.home('robot-a')).toThrow(/unavailable/)
    await expect(state.service.savePose('robot-a', 'job-a')).rejects.toThrow(/unavailable/)
  })
})
