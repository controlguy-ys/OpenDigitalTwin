import { describe, expect, it, vi } from 'vitest'
import {
  validateWorkcellProjectV4,
  type RobotJointSourceV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import type { HandoverDemoCoordinatorV4 } from '../../handover/v4/handover-demo-coordinator.js'
import {
  createHackathonHandoverSampleV4,
  HACKATHON_HANDOVER_IDS_V4,
} from '../../project/v4/hackathon-handover-sample-v4.js'
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

function handoverCoordinator(): HandoverDemoCoordinatorV4 {
  return {
    canHandle: vi.fn((jobId: string) => jobId === HACKATHON_HANDOVER_IDS_V4.jobId),
    canStart: vi.fn((jobId: string) => jobId === HACKATHON_HANDOVER_IDS_V4.jobId),
    start: vi.fn(() => ({ runId: 'handover-run' })),
    canCancel: vi.fn(() => true),
    cancel: vi.fn(),
    canReset: vi.fn((jobId: string) => jobId === HACKATHON_HANDOVER_IDS_V4.jobId),
    reset: vi.fn(),
    setGripConfirmTimeoutInjection: vi.fn(),
    dispose: vi.fn(),
  }
}

function handoverProject(): WorkcellProjectV4 {
  const sample = createHackathonHandoverSampleV4({
    projectId: 'project-job-operator-handover',
    revisionId: 'revision-job-operator-handover',
    nowIso: '2026-07-21T06:00:00.000Z',
  })
  return validateWorkcellProjectV4({
    ...sample,
    jobs: [
      ...sample.jobs,
      {
        id: 'ordinary-job',
        name: 'Ordinary Job',
        robotId: HACKATHON_HANDOVER_IDS_V4.robotBId,
        steps: [],
      },
    ],
  })
}

function harness(
  project = projectFixture(),
  handover: HandoverDemoCoordinatorV4 | null = null,
) {
  const jobs = createJobRuntimeStoreV4()
  jobs.getState().replaceProject(project)
  const playback = {
    startJob: vi.fn((_jobId: string) => ({ runId: 'run-new' })),
    cancelRobotJob: vi.fn((_robotId: string, _reason: string) => undefined),
    ensureRunning: vi.fn(), quiesce: vi.fn(async () => undefined), resume: vi.fn(), dispose: vi.fn(),
  } satisfies RobotJobPlaybackControllerV4
  return {
    jobs,
    playback,
    handover,
    service: createJobOperatorServiceV4({
      readProject: () => project,
      jobs,
      playback,
      handover,
    }),
  }
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

  it('routes only the representative Job through the Handover Coordinator', async () => {
    const project = handoverProject()
    const handover = handoverCoordinator()
    const state = harness(project, handover)

    expect(state.service.canStart(
      HACKATHON_HANDOVER_IDS_V4.robotAId,
      HACKATHON_HANDOVER_IDS_V4.jobId,
    )).toBe(true)
    await state.service.start(
      HACKATHON_HANDOVER_IDS_V4.robotAId,
      HACKATHON_HANDOVER_IDS_V4.jobId,
    )

    expect(handover.start).toHaveBeenCalledWith(HACKATHON_HANDOVER_IDS_V4.jobId)
    expect(state.playback.startJob).not.toHaveBeenCalled()

    await state.service.start(HACKATHON_HANDOVER_IDS_V4.robotBId, 'ordinary-job')
    expect(state.playback.startJob).toHaveBeenCalledWith('ordinary-job')
  })

  it('delegates representative Cancel and Reset without changing ordinary paths', async () => {
    const project = handoverProject()
    const handover = handoverCoordinator()
    const state = harness(project, handover)
    state.jobs.getState().setRobotState(running(
      HACKATHON_HANDOVER_IDS_V4.robotAId,
      HACKATHON_HANDOVER_IDS_V4.jobId,
    ))

    expect(state.service.canCancel(HACKATHON_HANDOVER_IDS_V4.robotAId)).toBe(true)
    await state.service.cancel(HACKATHON_HANDOVER_IDS_V4.robotAId)
    expect(handover.cancel).toHaveBeenCalledWith('Operator cancelled Job.')
    expect(state.playback.cancelRobotJob).not.toHaveBeenCalled()

    expect(state.service.canReset(HACKATHON_HANDOVER_IDS_V4.jobId)).toBe(true)
    await state.service.reset(HACKATHON_HANDOVER_IDS_V4.jobId)
    expect(handover.reset).toHaveBeenCalledOnce()
    expect(state.service.canReset('ordinary-job')).toBe(false)
    await expect(state.service.reset('ordinary-job')).rejects.toThrow(/Reset is unavailable/)

    state.jobs.getState().setRobotState(running(
      HACKATHON_HANDOVER_IDS_V4.robotBId,
      'ordinary-job',
    ))
    await state.service.cancel(HACKATHON_HANDOVER_IDS_V4.robotBId)
    expect(state.playback.cancelRobotJob).toHaveBeenCalledWith(
      HACKATHON_HANDOVER_IDS_V4.robotBId,
      'Operator cancelled Job.',
    )
  })
})
