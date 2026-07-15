import {
  deriveCanonicalPoseDurationMsV3,
} from '../../domain/project/simulation-duration-v3'
import {
  MAX_JOBS,
  MAX_POSES_PER_JOB,
  MAX_PROJECT_POSES,
  type ProjectPoseStepV3,
  type SimulationJobV1,
} from '../../domain/project/simulation-job-v1'
import { useRobotStore } from '../joints/robot-store'
import type { StoredWorkcellProjectSnapshotProjectionV3 } from '../project/project-db'
import type { ProjectMutationService } from '../project/project-mutation-service'
import { projectMutationService } from '../project/project-store-browser'

export interface JobCommandService {
  createJob(name: string): Promise<string>
  renameJob(jobId: string, name: string): Promise<void>
  duplicateJob(jobId: string): Promise<string>
  deleteJob(jobId: string): Promise<void>
  setActiveJob(jobId: string | null): Promise<void>
  saveCurrentPose(name: string): Promise<string>
  setPoseSpeed(jobId: string, poseId: string, speedPercentToNext: number): Promise<void>
  movePose(jobId: string, poseId: string, nextIndex: number): Promise<void>
  deletePose(jobId: string, poseId: string): Promise<void>
}

export interface JobCommandServiceOptions {
  readonly mutationService: Pick<ProjectMutationService, 'replaceFromActive' | 'readPublished'>
  readonly createId?: () => string
  readonly readAnglesDeg?: () => readonly [number, number, number, number, number, number]
}

function jobName(name: string): string {
  const normalized = name.trim()
  if (normalized.length === 0) throw new Error('JOB_NAME_REQUIRED: Job name must not be empty.')
  return normalized
}

function incrementRevision(job: SimulationJobV1): number {
  if (!Number.isSafeInteger(job.revision) || job.revision < 1 || job.revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error(`JOB_REVISION_EXHAUSTED: ${job.id} revision cannot be safely incremented.`)
  }
  return job.revision + 1
}

function findJob(
  current: StoredWorkcellProjectSnapshotProjectionV3,
  jobId: string,
): SimulationJobV1 {
  const job = current.simulation.jobs.find(({ id }) => id === jobId)
  if (job === undefined) throw new Error(`JOB_MISSING: ${jobId} does not exist.`)
  return job
}

function canonicalPoses(
  current: StoredWorkcellProjectSnapshotProjectionV3,
  poses: readonly ProjectPoseStepV3[],
): readonly ProjectPoseStepV3[] {
  return poses.map((pose, index) => {
    const next = poses[index + 1]
    return {
      ...pose,
      anglesDeg: [...pose.anglesDeg],
      durationMs: next === undefined
        ? 1_000
        : deriveCanonicalPoseDurationMsV3(pose, next, current.robot.mechanics),
    }
  })
}

function replaceJob(
  current: StoredWorkcellProjectSnapshotProjectionV3,
  jobId: string,
  update: (job: SimulationJobV1) => SimulationJobV1,
): StoredWorkcellProjectSnapshotProjectionV3 {
  findJob(current, jobId)
  return {
    ...current,
    simulation: {
      ...current.simulation,
      jobs: current.simulation.jobs.map((job) => job.id === jobId ? update(job) : job),
    },
  }
}

function totalPoseCount(current: StoredWorkcellProjectSnapshotProjectionV3): number {
  return current.simulation.jobs.reduce((total, job) => total + job.poses.length, 0)
}

export function createJobCommandService(options: JobCommandServiceOptions): JobCommandService {
  const createId = options.createId ?? (() => crypto.randomUUID())
  const readAnglesDeg = options.readAnglesDeg ?? (() => useRobotStore.getState().anglesDeg)
  const mutate = options.mutationService.replaceFromActive.bind(options.mutationService)

  const service: JobCommandService = {
    async createJob(name) {
      const id = createId()
      const normalizedName = jobName(name)
      await mutate((current) => {
        if (current.simulation.jobs.length >= MAX_JOBS) {
          throw new Error(`JOB_LIMIT_EXCEEDED: A Project cannot exceed ${MAX_JOBS} Jobs.`)
        }
        if (current.simulation.jobs.some((job) => job.id === id)) {
          throw new Error(`JOB_DUPLICATE: ${id} already exists.`)
        }
        return {
          ...current,
          simulation: {
            activeJobId: current.simulation.activeJobId ?? id,
            jobs: [...current.simulation.jobs, {
              id,
              name: normalizedName,
              revision: 1,
              poses: [],
            }],
          },
        }
      })
      return id
    },

    async renameJob(jobId, name) {
      const normalizedName = jobName(name)
      await mutate((current) => replaceJob(current, jobId, (job) => ({
        ...job,
        name: normalizedName,
        revision: incrementRevision(job),
      })))
    },

    async duplicateJob(jobId) {
      const nextJobId = createId()
      await mutate((current) => {
        const source = findJob(current, jobId)
        if (current.simulation.jobs.length >= MAX_JOBS) {
          throw new Error(`JOB_LIMIT_EXCEEDED: A Project cannot exceed ${MAX_JOBS} Jobs.`)
        }
        if (totalPoseCount(current) + source.poses.length > MAX_PROJECT_POSES) {
          throw new Error(`PROJECT_POSE_LIMIT_EXCEEDED: A Project cannot exceed ${MAX_PROJECT_POSES} Poses.`)
        }
        const poses = source.poses.map((pose) => ({
          ...pose,
          id: createId(),
          anglesDeg: [...pose.anglesDeg] as [number, number, number, number, number, number],
        }))
        return {
          ...current,
          simulation: {
            ...current.simulation,
            jobs: [...current.simulation.jobs, {
              id: nextJobId,
              name: `${source.name} Copy`,
              revision: 1,
              poses,
            }],
          },
        }
      })
      return nextJobId
    },

    async deleteJob(jobId) {
      await mutate((current) => {
        const deleteIndex = current.simulation.jobs.findIndex(({ id }) => id === jobId)
        if (deleteIndex < 0) throw new Error(`JOB_MISSING: ${jobId} does not exist.`)
        const jobs = current.simulation.jobs.filter(({ id }) => id !== jobId)
        const activeJobId = current.simulation.activeJobId === jobId
          ? jobs[Math.min(deleteIndex, jobs.length - 1)]?.id ?? null
          : current.simulation.activeJobId
        return { ...current, simulation: { activeJobId, jobs } }
      })
    },

    async setActiveJob(jobId) {
      await mutate((current) => {
        if (jobId !== null) findJob(current, jobId)
        return {
          ...current,
          simulation: { ...current.simulation, activeJobId: jobId },
        }
      })
    },

    async saveCurrentPose(name) {
      const poseId = createId()
      const normalizedName = jobName(name)
      const anglesDeg = [...readAnglesDeg()] as [number, number, number, number, number, number]
      if (anglesDeg.some((angle) => !Number.isFinite(angle))) {
        throw new Error('POSE_ANGLES_INVALID: Current Joint angles must be finite.')
      }
      await mutate((current) => {
        const activeJobId = current.simulation.activeJobId
        if (activeJobId === null) {
          throw new Error('ACTIVE_JOB_REQUIRED: Create and select a Job before saving a Pose.')
        }
        if (totalPoseCount(current) >= MAX_PROJECT_POSES) {
          throw new Error(`PROJECT_POSE_LIMIT_EXCEEDED: A Project cannot exceed ${MAX_PROJECT_POSES} Poses.`)
        }
        return replaceJob(current, activeJobId, (job) => {
          if (job.poses.length >= MAX_POSES_PER_JOB) {
            throw new Error(`JOB_POSE_LIMIT_EXCEEDED: A Job cannot exceed ${MAX_POSES_PER_JOB} Poses.`)
          }
          const poses = canonicalPoses(current, [...job.poses, {
            id: poseId,
            name: normalizedName,
            anglesDeg,
            durationMs: 1_000,
            easing: 'easeInOut',
            speedPercentToNext: 100,
          }])
          return { ...job, poses, revision: incrementRevision(job) }
        })
      })
      return poseId
    },

    async setPoseSpeed(jobId, poseId, speedPercentToNext) {
      if (
        !Number.isFinite(speedPercentToNext) ||
        speedPercentToNext < 1 ||
        speedPercentToNext > 100
      ) {
        throw new Error('POSE_SPEED_INVALID: speedPercentToNext must be within [1, 100].')
      }
      await mutate((current) => replaceJob(current, jobId, (job) => {
        if (!job.poses.some(({ id }) => id === poseId)) {
          throw new Error(`POSE_MISSING: ${poseId} does not exist in ${jobId}.`)
        }
        const poses = canonicalPoses(current, job.poses.map((pose) =>
          pose.id === poseId ? { ...pose, speedPercentToNext } : pose,
        ))
        return { ...job, poses, revision: incrementRevision(job) }
      }))
    },

    async movePose(jobId, poseId, nextIndex) {
      if (!Number.isInteger(nextIndex)) {
        throw new Error('POSE_INDEX_INVALID: Pose index must be an integer.')
      }
      await mutate((current) => replaceJob(current, jobId, (job) => {
        const fromIndex = job.poses.findIndex(({ id }) => id === poseId)
        if (fromIndex < 0) throw new Error(`POSE_MISSING: ${poseId} does not exist in ${jobId}.`)
        if (nextIndex < 0 || nextIndex >= job.poses.length) {
          throw new Error(`POSE_INDEX_INVALID: Pose index must be within [0, ${job.poses.length - 1}].`)
        }
        const poses = [...job.poses]
        const [moved] = poses.splice(fromIndex, 1)
        poses.splice(nextIndex, 0, moved!)
        return {
          ...job,
          poses: canonicalPoses(current, poses),
          revision: incrementRevision(job),
        }
      }))
    },

    async deletePose(jobId, poseId) {
      await mutate((current) => replaceJob(current, jobId, (job) => {
        if (!job.poses.some(({ id }) => id === poseId)) {
          throw new Error(`POSE_MISSING: ${poseId} does not exist in ${jobId}.`)
        }
        return {
          ...job,
          poses: canonicalPoses(current, job.poses.filter(({ id }) => id !== poseId)),
          revision: incrementRevision(job),
        }
      }))
    },
  }

  return Object.freeze(service)
}

export const jobCommandService = createJobCommandService({
  mutationService: projectMutationService,
})
