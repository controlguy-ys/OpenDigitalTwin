import type {
  RobotIdV4,
  RobotJobIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { StoreApi } from 'zustand/vanilla'
import type { HandoverDemoCoordinatorV4 } from '../../handover/v4/handover-demo-coordinator.js'
import type { JobRuntimeStoreV4 } from './job-runtime-store.js'
import type { RobotJobPlaybackControllerV4 } from './simulation-clock.js'

export interface JobOperatorServiceV4 {
  /** Allows Job authoring only for the current, idle runtime owner. */
  canAuthor(robotId: RobotIdV4): boolean
  canStart(robotId: RobotIdV4, jobId: RobotJobIdV4 | null): boolean
  start(robotId: RobotIdV4, jobId: RobotJobIdV4): Promise<void>
  canCancel(robotId: RobotIdV4): boolean
  cancel(robotId: RobotIdV4): Promise<void>
  canReset(jobId: RobotJobIdV4 | null): boolean
  reset(jobId: RobotJobIdV4): Promise<void>
}

export interface CreateJobOperatorServiceOptionsV4 {
  readonly readProject: () => WorkcellProjectV4
  readonly jobs: StoreApi<JobRuntimeStoreV4>
  readonly playback: RobotJobPlaybackControllerV4
  readonly handover?: HandoverDemoCoordinatorV4 | null
}

function handoverForJob(
  options: CreateJobOperatorServiceOptionsV4,
  jobId: RobotJobIdV4,
): HandoverDemoCoordinatorV4 | null {
  const handover = options.handover ?? null
  return handover?.canHandle(jobId) === true ? handover : null
}

function startable(
  options: CreateJobOperatorServiceOptionsV4,
  project: WorkcellProjectV4,
  robotId: RobotIdV4,
  jobId: RobotJobIdV4 | null,
): boolean {
  if (jobId === null) return false
  const robot = project.robots.find((candidate) => candidate.id === robotId)
  const job = project.jobs.find((candidate) => candidate.id === jobId)
  const valid = authorable(options, project, robotId)
    && robot !== undefined
    && robot.jointSource === 'simulation'
    && job !== undefined
    && job.robotId === robotId
  if (!valid) return false
  const handover = handoverForJob(options, jobId)
  return handover === null || handover.canStart(jobId)
}

function authorable(
  options: CreateJobOperatorServiceOptionsV4,
  project: WorkcellProjectV4,
  robotId: RobotIdV4,
): boolean {
  const runtime = options.jobs.getState()
  const robot = project.robots.find((candidate) => candidate.id === robotId)
  return runtime.projectRevisionId === project.revisionId
    && robot !== undefined
    && Object.hasOwn(runtime.byRobotId, robotId)
    && runtime.byRobotId[robotId]?.robotId === robotId
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
    canAuthor(robotId: RobotIdV4) {
      try { return authorable(options, options.readProject(), robotId) } catch { return false }
    },
    canStart(robotId: RobotIdV4, jobId: RobotJobIdV4 | null) {
      try { return startable(options, options.readProject(), robotId, jobId) } catch { return false }
    },
    async start(robotId: RobotIdV4, jobId: RobotJobIdV4) {
      if (!startable(options, options.readProject(), robotId, jobId)) {
        throw new Error('Job Start is unavailable because the runtime is stale or no longer permitted.')
      }
      const handover = handoverForJob(options, jobId)
      if (handover !== null) {
        handover.start(jobId)
        return
      }
      options.playback.startJob(jobId)
    },
    canCancel(robotId: RobotIdV4) {
      try {
        const project = options.readProject()
        if (!cancellable(options, project, robotId)) return false
        const jobId = options.jobs.getState().byRobotId[robotId]?.jobId
        if (jobId === null || jobId === undefined) return false
        const handover = handoverForJob(options, jobId)
        return handover === null || handover.canCancel()
      } catch { return false }
    },
    async cancel(robotId: RobotIdV4) {
      const project = options.readProject()
      if (!cancellable(options, project, robotId)) {
        throw new Error('Job Cancel is unavailable because the runtime is stale or no longer running.')
      }
      const jobId = options.jobs.getState().byRobotId[robotId]?.jobId
      if (jobId !== null && jobId !== undefined) {
        const handover = handoverForJob(options, jobId)
        if (handover !== null) {
          if (!handover.canCancel()) {
            throw new Error('Job Cancel is unavailable because the runtime is stale or no longer running.')
          }
          handover.cancel('Operator cancelled Job.')
          return
        }
      }
      options.playback.cancelRobotJob(robotId, 'Operator cancelled Job.')
    },
    canReset(jobId: RobotJobIdV4 | null) {
      if (jobId === null) return false
      try {
        return handoverForJob(options, jobId)?.canReset(jobId) === true
      } catch { return false }
    },
    async reset(jobId: RobotJobIdV4) {
      const handover = handoverForJob(options, jobId)
      if (handover === null || !handover.canReset(jobId)) {
        throw new Error('Job Reset is unavailable for this Job.')
      }
      handover.reset()
    },
  })
}
