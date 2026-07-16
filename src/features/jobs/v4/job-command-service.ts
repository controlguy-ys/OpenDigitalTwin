import {
  MAX_JOBS_V4,
  MAX_JOB_STEPS_PER_JOB_V4,
  MAX_TOTAL_JOB_STEPS_V4,
  failProjectV4,
  validateWorkcellProjectV4,
  type RobotJobStepV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { ProjectMutationPortV4 } from '../../project/v4/project-mutation-port.js'
import type { StoreApi } from 'zustand/vanilla'
import type { JobRuntimeStoreV4 } from './job-runtime-store.js'

export interface JobCommandServiceV4 {
  createJob(robotId: string, name: string): Promise<string>
  renameJob(jobId: string, name: string): Promise<void>
  duplicateJob(jobId: string): Promise<string>
  deleteJob(jobId: string): Promise<void>
  saveJointPose(
    jobId: string,
    jointValues: Readonly<Record<string, number>>,
    speedPercentToNext: number,
  ): Promise<void>
  addActionReference(jobId: string, actionId: string): Promise<void>
  moveStep(jobId: string, stepIndex: number, direction: -1 | 1): Promise<void>
  deleteStep(jobId: string, stepIndex: number): Promise<void>
}

export interface JobCommandServiceOptionsV4 {
  readonly mutations: ProjectMutationPortV4
  readonly readProject: () => WorkcellProjectV4
  readonly jobs: StoreApi<JobRuntimeStoreV4>
  readonly createId: () => string
}

function commandFailure(code: string, path: string, message: string): never {
  failProjectV4(code, path, message, 'Correct the Job authoring command and try again.')
}

function requireRobot(project: WorkcellProjectV4, robotId: string): WorkcellProjectV4['robots'][number] {
  const robot = project.robots.find((candidate) => candidate.id === robotId)
  if (robot === undefined) {
    commandFailure(
      'ROBOT_INSTANCE_NOT_FOUND',
      `$.robots.${robotId}`,
      `Robot Instance ${robotId} does not exist.`,
    )
  }
  return robot
}

function requireJob(project: WorkcellProjectV4, jobId: string): WorkcellProjectV4['jobs'][number] {
  const job = project.jobs.find((candidate) => candidate.id === jobId)
  if (job === undefined) {
    commandFailure('JOB_NOT_FOUND', `$.jobs.${jobId}`, `Job ${jobId} does not exist.`)
  }
  return job
}

function totalStepCount(project: WorkcellProjectV4): number {
  return project.jobs.reduce((total, job) => total + job.steps.length, 0)
}

function snapshotRecord(
  values: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const prototype = Object.getPrototypeOf(values)
  return Object.defineProperties(
    Object.create(prototype) as Record<string, number>,
    Object.getOwnPropertyDescriptors(values),
  )
}

function cloneStep(step: RobotJobStepV4): RobotJobStepV4 {
  return step.kind === 'joint-pose'
    ? {
        kind: 'joint-pose',
        jointValues: snapshotRecord(step.jointValues),
        speedPercentToNext: step.speedPercentToNext,
      }
    : { kind: 'action-reference', actionId: step.actionId }
}

function replaceJob(
  project: WorkcellProjectV4,
  jobId: string,
  replacement: WorkcellProjectV4['jobs'][number],
): WorkcellProjectV4 {
  return {
    ...project,
    jobs: project.jobs.map((job) => job.id === jobId ? replacement : job),
  }
}

function validateCandidate(project: WorkcellProjectV4): WorkcellProjectV4 {
  return validateWorkcellProjectV4(project)
}

export function createJobCommandServiceV4(
  options: JobCommandServiceOptionsV4,
): JobCommandServiceV4 {
  const assertEditable = (project: WorkcellProjectV4, robotId: string): void => {
    requireRobot(project, robotId)
    const runtime = options.jobs.getState().byRobotId[robotId]
    if (runtime === undefined) {
      commandFailure(
        'ROBOT_INSTANCE_NOT_FOUND',
        `$.robots.${robotId}`,
        `Robot Instance ${robotId} is not published in the Job runtime.`,
      )
    }
    if (runtime.state === 'RUNNING') {
      commandFailure(
        'ROBOT_JOB_EDIT_WHILE_RUNNING',
        `$.robots.${robotId}`,
        `Robot ${robotId} Job authoring is disabled while its Job is running.`,
      )
    }
  }

  const appendStep = (
    active: WorkcellProjectV4,
    jobId: string,
    step: RobotJobStepV4,
  ): WorkcellProjectV4 => {
    const job = requireJob(active, jobId)
    assertEditable(active, job.robotId)
    if (job.steps.length >= MAX_JOB_STEPS_PER_JOB_V4) {
      commandFailure(
        'JOB_STEP_LIMIT_EXCEEDED',
        `$.jobs.${jobId}.steps`,
        `A Job cannot exceed ${MAX_JOB_STEPS_PER_JOB_V4} steps.`,
      )
    }
    if (totalStepCount(active) >= MAX_TOTAL_JOB_STEPS_V4) {
      commandFailure(
        'TOTAL_JOB_STEP_LIMIT_EXCEEDED',
        '$.jobs',
        `A Project cannot exceed ${MAX_TOTAL_JOB_STEPS_V4} total Job steps.`,
      )
    }
    return validateCandidate(replaceJob(active, jobId, {
      ...job,
      steps: [...job.steps, step],
    }))
  }

  const service: JobCommandServiceV4 = {
    async createJob(robotId, name) {
      const jobId = options.createId()
      await options.mutations.replaceFromActive({
        description: `Create Job ${jobId}`,
        mutate(active) {
          requireRobot(active, robotId)
          assertEditable(active, robotId)
          if (active.jobs.length >= MAX_JOBS_V4) {
            commandFailure(
              'JOB_LIMIT_EXCEEDED',
              '$.jobs',
              `A Project cannot exceed ${MAX_JOBS_V4} Jobs.`,
            )
          }
          return validateCandidate({
            ...active,
            jobs: [...active.jobs, { id: jobId, name, robotId, steps: [] }],
          })
        },
      })
      return jobId
    },

    async renameJob(jobId, name) {
      await options.mutations.replaceFromActive({
        description: `Rename Job ${jobId}`,
        mutate(active) {
          const job = requireJob(active, jobId)
          assertEditable(active, job.robotId)
          return validateCandidate(replaceJob(active, jobId, { ...job, name }))
        },
      })
    },

    async duplicateJob(jobId) {
      const duplicateId = options.createId()
      await options.mutations.replaceFromActive({
        description: `Duplicate Job ${jobId}`,
        mutate(active) {
          const source = requireJob(active, jobId)
          assertEditable(active, source.robotId)
          if (active.jobs.length >= MAX_JOBS_V4) {
            commandFailure(
              'JOB_LIMIT_EXCEEDED',
              '$.jobs',
              `A Project cannot exceed ${MAX_JOBS_V4} Jobs.`,
            )
          }
          if (totalStepCount(active) + source.steps.length > MAX_TOTAL_JOB_STEPS_V4) {
            commandFailure(
              'TOTAL_JOB_STEP_LIMIT_EXCEEDED',
              '$.jobs',
              `A Project cannot exceed ${MAX_TOTAL_JOB_STEPS_V4} total Job steps.`,
            )
          }
          return validateCandidate({
            ...active,
            jobs: [...active.jobs, {
              id: duplicateId,
              name: source.name,
              robotId: source.robotId,
              steps: source.steps.map(cloneStep),
            }],
          })
        },
      })
      return duplicateId
    },

    async deleteJob(jobId) {
      await options.mutations.replaceFromActive({
        description: `Delete Job ${jobId}`,
        mutate(active) {
          const job = requireJob(active, jobId)
          assertEditable(active, job.robotId)
          return validateCandidate({
            ...active,
            jobs: active.jobs.filter((candidate) => candidate.id !== jobId),
          })
        },
      })
    },

    async saveJointPose(jobId, jointValues, speedPercentToNext) {
      const snapshot = snapshotRecord(jointValues)
      await options.mutations.replaceFromActive({
        description: `Save Joint Pose to Job ${jobId}`,
        mutate(active) {
          return appendStep(active, jobId, {
            kind: 'joint-pose',
            jointValues: snapshot,
            speedPercentToNext,
          })
        },
      })
    },

    async addActionReference(jobId, actionId) {
      await options.mutations.replaceFromActive({
        description: `Add Action ${actionId} to Job ${jobId}`,
        mutate(active) {
          if (!active.actions.some((candidate) => candidate.id === actionId)) {
            commandFailure(
              'ACTION_NOT_FOUND',
              `$.actions.${actionId}`,
              `Action ${actionId} does not exist.`,
            )
          }
          return appendStep(active, jobId, { kind: 'action-reference', actionId })
        },
      })
    },

    async moveStep(jobId, stepIndex, direction) {
      await options.mutations.replaceFromActive({
        description: `Move step ${stepIndex} in Job ${jobId}`,
        mutate(active) {
          const job = requireJob(active, jobId)
          assertEditable(active, job.robotId)
          if (direction !== -1 && direction !== 1) {
            commandFailure(
              'JOB_STEP_INDEX_INVALID',
              '$.direction',
              'Step direction must be exactly -1 or 1.',
            )
          }
          const destination = stepIndex + direction
          if (
            !Number.isSafeInteger(stepIndex)
            || stepIndex < 0
            || stepIndex >= job.steps.length
            || destination < 0
            || destination >= job.steps.length
          ) {
            commandFailure(
              'JOB_STEP_INDEX_INVALID',
              '$.stepIndex',
              'Step index and destination must stay within the same Job.',
            )
          }
          const steps = [...job.steps]
          const [moved] = steps.splice(stepIndex, 1)
          steps.splice(destination, 0, moved!)
          return validateCandidate(replaceJob(active, jobId, { ...job, steps }))
        },
      })
    },

    async deleteStep(jobId, stepIndex) {
      await options.mutations.replaceFromActive({
        description: `Delete step ${stepIndex} from Job ${jobId}`,
        mutate(active) {
          const job = requireJob(active, jobId)
          assertEditable(active, job.robotId)
          if (!Number.isSafeInteger(stepIndex) || stepIndex < 0 || stepIndex >= job.steps.length) {
            commandFailure(
              'JOB_STEP_INDEX_INVALID',
              '$.stepIndex',
              'Step index must address an existing Job step.',
            )
          }
          return validateCandidate(replaceJob(active, jobId, {
            ...job,
            steps: job.steps.filter((_step, index) => index !== stepIndex),
          }))
        },
      })
    },
  }

  return Object.freeze(service)
}
