import type { FixedSixAxisRobotMechanicsV3 } from './robot-source-v3'
import type {
  ProjectPoseStepV3,
  ProjectSimulationStateV3,
  SimulationJobV1,
} from './simulation-job-v1'

export interface ProjectPoseLimitViolationV3 {
  readonly jobId: string
  readonly poseId: string
  readonly jointId: string
  readonly angleDeg: number
  readonly minDeg: number
  readonly maxDeg: number
}

export class ProjectJobPoseOutOfLimitsErrorV3 extends Error {
  readonly code = 'PROJECT_JOB_POSE_OUT_OF_LIMITS'
  readonly totalCount: number
  readonly details: readonly ProjectPoseLimitViolationV3[]

  constructor(
    totalCount: number,
    details: readonly ProjectPoseLimitViolationV3[],
  ) {
    super(`PROJECT_JOB_POSE_OUT_OF_LIMITS: ${totalCount} saved Pose angle(s) are outside the proposed Mechanics limits.`)
    this.name = 'ProjectJobPoseOutOfLimitsErrorV3'
    this.totalCount = totalCount
    this.details = details
  }
}

export class ProjectPoseDurationDerivedNonFiniteErrorV3 extends Error {
  readonly code = 'PROJECT_POSE_DURATION_DERIVED_NON_FINITE'

  constructor() {
    super('PROJECT_POSE_DURATION_DERIVED_NON_FINITE: canonical Pose duration must be finite.')
    this.name = 'ProjectPoseDurationDerivedNonFiniteErrorV3'
  }
}

export function deriveCanonicalPoseDurationMsV3(
  from: Readonly<Pick<ProjectPoseStepV3, 'anglesDeg' | 'speedPercentToNext'>>,
  to: Readonly<Pick<ProjectPoseStepV3, 'anglesDeg'>>,
  mechanics: Readonly<Pick<FixedSixAxisRobotMechanicsV3, 'joints'>>,
): number {
  if (
    !Number.isFinite(from.speedPercentToNext) ||
    from.speedPercentToNext < 1 ||
    from.speedPercentToNext > 100
  ) {
    throw new Error('speedPercentToNext must be within [1, 100].')
  }
  const jointDurationsMs = from.anglesDeg.map((fromDeg, index) => {
    const toDeg = to.anglesDeg[index]!
    const maxVelocity = mechanics.joints[index]!.maxVelocityDegPerSec
    if (
      !Number.isFinite(fromDeg) ||
      !Number.isFinite(toDeg) ||
      !Number.isFinite(maxVelocity) ||
      maxVelocity <= 0
    ) {
      throw new Error(
        'Pose angles must be finite and maximum velocity must be positive.',
      )
    }
    const directDelta = Math.abs(toDeg - fromDeg)
    let velocityRatio: number
    if (Number.isFinite(directDelta)) {
      velocityRatio = directDelta / maxVelocity
    } else {
      const scale = Math.max(Math.abs(fromDeg), Math.abs(toDeg))
      const scaledDelta = Math.abs(toDeg / scale - fromDeg / scale)
      velocityRatio = scaledDelta / (maxVelocity / scale)
    }
    let durationMs = velocityRatio * 1_000 * 100 / from.speedPercentToNext
    if (!Number.isFinite(durationMs)) {
      durationMs = velocityRatio * (100_000 / from.speedPercentToNext)
    }
    if (!Number.isFinite(durationMs)) {
      throw new ProjectPoseDurationDerivedNonFiniteErrorV3()
    }
    return durationMs
  })
  const durationMs = Math.max(16, ...jointDurationsMs)
  if (!Number.isFinite(durationMs)) {
    throw new ProjectPoseDurationDerivedNonFiniteErrorV3()
  }
  return durationMs
}

export function validateSimulationPoseLimitsV3(
  simulation: ProjectSimulationStateV3,
  mechanics: Readonly<Pick<FixedSixAxisRobotMechanicsV3, 'joints'>>,
): void {
  const details: ProjectPoseLimitViolationV3[] = []
  let totalCount = 0
  for (const job of simulation.jobs) {
    for (const pose of job.poses) {
      pose.anglesDeg.forEach((angleDeg, index) => {
        const joint = mechanics.joints[index]!
        if (
          !Number.isFinite(angleDeg) ||
          angleDeg < joint.minDeg ||
          angleDeg > joint.maxDeg
        ) {
          totalCount += 1
          if (details.length < 64) {
            details.push({
              jobId: job.id,
              poseId: pose.id,
              jointId: joint.id,
              angleDeg,
              minDeg: joint.minDeg,
              maxDeg: joint.maxDeg,
            })
          }
        }
      })
    }
  }
  if (totalCount > 0) {
    throw new ProjectJobPoseOutOfLimitsErrorV3(totalCount, details)
  }
}

function canonicalizeJobDurations(
  job: SimulationJobV1,
  mechanics: Readonly<Pick<FixedSixAxisRobotMechanicsV3, 'joints'>>,
): SimulationJobV1 {
  let changed = false
  const poses = job.poses.map((pose, index) => {
    const next = job.poses[index + 1]
    const canonicalDuration = next === undefined
      ? 1_000
      : deriveCanonicalPoseDurationMsV3(pose, next, mechanics)
    if (!Number.isFinite(pose.durationMs)) {
      throw new Error(`Pose ${pose.id} duration must be finite.`)
    }
    if (next === undefined) {
      if (pose.durationMs !== 1_000) {
        throw new Error(`Terminal Pose ${pose.id} duration must be exactly 1000 ms.`)
      }
    } else if (Math.abs(pose.durationMs - canonicalDuration) > 1e-9) {
      throw new Error(`Pose ${pose.id} duration does not match the canonical duration.`)
    }
    if (pose.durationMs === canonicalDuration) return pose
    changed = true
    return { ...pose, durationMs: canonicalDuration }
  })
  return changed ? { ...job, poses } : job
}

export function canonicalizeSimulationDurationsV3(
  simulation: ProjectSimulationStateV3,
  mechanics: Readonly<Pick<FixedSixAxisRobotMechanicsV3, 'joints'>>,
): ProjectSimulationStateV3 {
  validateSimulationPoseLimitsV3(simulation, mechanics)
  let changed = false
  const jobs = simulation.jobs.map((job) => {
    const canonical = canonicalizeJobDurations(job, mechanics)
    changed ||= canonical !== job
    return canonical
  })
  return changed ? { ...simulation, jobs } : simulation
}

export function reconcileSimulationForMechanicsChange(
  simulation: ProjectSimulationStateV3,
  mechanics: Readonly<Pick<FixedSixAxisRobotMechanicsV3, 'joints'>>,
): ProjectSimulationStateV3 {
  validateSimulationPoseLimitsV3(simulation, mechanics)
  let simulationChanged = false
  const jobs = simulation.jobs.map((job) => {
    let jobChanged = false
    const poses = job.poses.map((pose, index) => {
      const next = job.poses[index + 1]
      if (next === undefined) return pose
      const durationMs = deriveCanonicalPoseDurationMsV3(pose, next, mechanics)
      if (durationMs === pose.durationMs) return pose
      jobChanged = true
      return { ...pose, durationMs }
    })
    if (!jobChanged) return job
    if (
      !Number.isSafeInteger(job.revision) ||
      job.revision <= 0 ||
      job.revision === Number.MAX_SAFE_INTEGER
    ) {
      throw new Error(`Job ${job.id} revision cannot be safely incremented.`)
    }
    simulationChanged = true
    return { ...job, revision: job.revision + 1, poses }
  })
  return simulationChanged ? { ...simulation, jobs } : simulation
}
