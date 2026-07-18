import { describe, expect, it, vi } from 'vitest'
import {
  validateWorkcellProjectV4,
  type RobotJointSourceV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { createJobRuntimeStoreV4 } from './job-runtime-store.js'
import { createJobOperatorServiceV4 } from './job-operator-service.js'
import type { RobotJobPlaybackControllerV4 } from './simulation-clock.js'

function projectFixture(sourceA: RobotJointSourceV4 = 'simulation'): WorkcellProjectV4 {
  const base = structuredClone(makeMinimalWorkcellProjectV4())
  const robot = (id: string, source: RobotJointSourceV4) => ({
    ...base.robots[0]!, id, name: id, jointSource: source,
  })
  return validateWorkcellProjectV4({
    ...base,
    revisionId: 'revision-job-operator',
    robots: [robot('robot-a', sourceA), robot('robot-b', 'simulation')],
    jobs: [
      { id: 'job-a', name: 'A', robotId: 'robot-a', steps: [] },
      { id: 'job-b', name: 'B', robotId: 'robot-b', steps: [] },
    ],
  })
}

function running(robotId: string, jobId: string) {
  return {
    robotId, jobId, runId: `run-${robotId}`, state: 'RUNNING' as const, stepIndex: 0,
    startedAtSimulationMs: 0, completedAtSimulationMs: null, failureCode: null, message: '',
  }
}

function harness(project = projectFixture()) {
  const jobs = createJobRuntimeStoreV4()
  jobs.getState().replaceProject(project)
  const playback = {
    startJob: vi.fn((_jobId: string) => ({ runId: 'run-new' })),
    cancelRobotJob: vi.fn((_robotId: string, _reason: string) => undefined),
    ensureRunning: vi.fn(), quiesce: vi.fn(async () => undefined), resume: vi.fn(), dispose: vi.fn(),
  } satisfies RobotJobPlaybackControllerV4
  return { jobs, playback, service: createJobOperatorServiceV4({ readProject: () => project, jobs, playback }) }
}

describe('createJobOperatorServiceV4', () => {
  it('starts only a non-running simulation Robot with an explicitly owned Job', async () => {
    const state = harness()
    expect(state.service.canAuthor('robot-a')).toBe(true)
    expect(state.service.canStart('robot-a', 'job-a')).toBe(true)
    expect(state.service.canStart('robot-a', null)).toBe(false)
    expect(state.service.canStart('robot-a', 'job-b')).toBe(false)
    await expect(state.service.start('robot-a', 'job-b')).rejects.toThrow(/Start is unavailable/)
    await state.service.start('robot-a', 'job-a')
    expect(state.playback.startJob).toHaveBeenCalledTimes(1)
    expect(state.playback.startJob).toHaveBeenCalledWith('job-a')
  })

  it('rejects non-simulation, stale, and newly-running Start races', async () => {
    const nonSimulation = harness(projectFixture('manual'))
    expect(nonSimulation.service.canStart('robot-a', 'job-a')).toBe(false)
    await expect(nonSimulation.service.start('robot-a', 'job-a')).rejects.toThrow(/Start is unavailable/)

    const stale = harness()
    stale.jobs.getState().replaceProject({ ...projectFixture(), revisionId: 'revision-new' })
    expect(stale.service.canStart('robot-a', 'job-a')).toBe(false)
    await expect(stale.service.start('robot-a', 'job-a')).rejects.toThrow(/Start is unavailable/)

    const race = harness()
    expect(race.service.canStart('robot-a', 'job-a')).toBe(true)
    race.jobs.getState().setRobotState(running('robot-a', 'job-a'))
    expect(race.service.canAuthor('robot-a')).toBe(false)
    await expect(race.service.start('robot-a', 'job-a')).rejects.toThrow(/Start is unavailable/)
  })

  it('keeps synchronous playback errors and independent Robot startability intact', async () => {
    const state = harness()
    const failure = new Error('executor unavailable')
    state.playback.startJob.mockImplementationOnce(() => { throw failure })
    await expect(state.service.start('robot-a', 'job-a')).rejects.toBe(failure)
    state.jobs.getState().setRobotState(running('robot-a', 'job-a'))
    expect(state.service.canStart('robot-b', 'job-b')).toBe(true)
    await state.service.start('robot-b', 'job-b')
    expect(state.playback.startJob).toHaveBeenLastCalledWith('job-b')
  })

  it('cancels exactly the requested current running Robot', async () => {
    const state = harness()
    state.jobs.getState().setRobotState(running('robot-a', 'job-a'))
    state.jobs.getState().setRobotState(running('robot-b', 'job-b'))
    expect(state.service.canCancel('robot-a')).toBe(true)
    await state.service.cancel('robot-a')
    expect(state.playback.cancelRobotJob).toHaveBeenCalledTimes(1)
    expect(state.playback.cancelRobotJob).toHaveBeenCalledWith('robot-a', 'Operator cancelled Job.')
    state.jobs.getState().replaceProject({ ...projectFixture(), revisionId: 'revision-new' })
    expect(state.service.canCancel('robot-a')).toBe(false)
  })
})
