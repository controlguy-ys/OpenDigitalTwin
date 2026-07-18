import type {
  RobotIdV4,
  RobotJobIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { StoreApi } from 'zustand/vanilla'
import type { JobRuntimeStoreV4 } from './job-runtime-store.js'
import type { RobotJobPlaybackControllerV4 } from './simulation-clock.js'

export interface JobOperatorServiceV4 {
  canStart(robotId: RobotIdV4, jobId: RobotJobIdV4 | null): boolean
  start(robotId: RobotIdV4, jobId: RobotJobIdV4): Promise<void>
  canCancel(robotId: RobotIdV4): boolean
  cancel(robotId: RobotIdV4): Promise<void>
}

export interface CreateJobOperatorServiceOptionsV4 {
  readonly readProject: () => WorkcellProjectV4
  readonly jobs: StoreApi<JobRuntimeStoreV4>
  readonly playback: RobotJobPlaybackControllerV4
}

function startable(
  options: CreateJobOperatorServiceOptionsV4,
  project: WorkcellProjectV4,
  robotId: RobotIdV4,
  jobId: RobotJobIdV4 | null,
): boolean {
  if (jobId === null) return false
  const runtime = options.jobs.getState()
  const robot = project.robots.find((candidate) => candidate.id === robotId)
  const job = project.jobs.find((candidate) => candidate.id === jobId)
  return runtime.projectRevisionId === project.revisionId
    && robot !== undefined
    && robot.jointSource === 'simulation'
    && job !== undefined
    && job.robotId === robotId
    && Object.hasOwn(runtime.byRobotId, robotId)
    && runtime.byRobotId[robotId]?.state !== 'RUNNING'
}

function cancellable(
  options: CreateJobOperatorServiceOptionsV4,
  project: WorkcellProjectV4,
  robotId: RobotIdV4,
): boolean {
  const runtime = options.jobs.getState()
  return runtime.projectRevisionId === project.revisionId
    && Object.hasOwn(runtime.byRobotId, robotId)
    && runtime.byRobotId[robotId]?.robotId === robotId
    && runtime.byRobotId[robotId]?.state === 'RUNNING'
}

export function createJobOperatorServiceV4(
  options: CreateJobOperatorServiceOptionsV4,
): JobOperatorServiceV4 {
  return Object.freeze({
    canStart(robotId: RobotIdV4, jobId: RobotJobIdV4 | null) {
      try { return startable(options, options.readProject(), robotId, jobId) } catch { return false }
    },
    async start(robotId: RobotIdV4, jobId: RobotJobIdV4) {
      if (!startable(options, options.readProject(), robotId, jobId)) {
        throw new Error('Job Start is unavailable because the runtime is stale or no longer permitted.')
      }
      options.playback.startJob(jobId)
    },
    canCancel(robotId: RobotIdV4) {
      try { return cancellable(options, options.readProject(), robotId) } catch { return false }
    },
    async cancel(robotId: RobotIdV4) {
      if (!cancellable(options, options.readProject(), robotId)) {
        throw new Error('Job Cancel is unavailable because the runtime is stale or no longer running.')
      }
      options.playback.cancelRobotJob(robotId, 'Operator cancelled Job.')
    },
  })
}
