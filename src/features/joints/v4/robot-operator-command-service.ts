import type {
  RobotIdV4,
  RobotJobIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { StoreApi } from 'zustand/vanilla'
import type { JobCommandServiceV4 } from '../../jobs/v4/job-command-service.js'
import type { JobRuntimeStoreV4 } from '../../jobs/v4/job-runtime-store.js'
import type {
  RobotRuntimeRegistryV4,
  RobotRuntimeStateV4,
} from '../../robot/v4/robot-runtime-registry.js'

export interface RobotOperatorCommandServiceV4 {
  canHome(robotId: RobotIdV4): boolean
  home(robotId: RobotIdV4): void
  setGripper(robotId: RobotIdV4, state: 'OPEN' | 'CLOSED'): void
  canSavePose(robotId: RobotIdV4, jobId: RobotJobIdV4 | null): boolean
  savePose(robotId: RobotIdV4, jobId: RobotJobIdV4): Promise<void>
}

export interface CreateRobotOperatorCommandServiceOptionsV4 {
  readonly readProject: () => WorkcellProjectV4
  readonly robots: StoreApi<RobotRuntimeRegistryV4>
  readonly jobs: StoreApi<JobRuntimeStoreV4>
  readonly jobCommands: Pick<JobCommandServiceV4, 'saveJointPose'>
}

function ownNumberRecordV4(): Record<string, number> {
  return Object.create(null) as Record<string, number>
}

function defineValueV4(record: Record<string, number>, key: string, value: number): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}

function currentRobotV4(
  options: CreateRobotOperatorCommandServiceOptionsV4,
  project: WorkcellProjectV4,
  robotId: RobotIdV4,
): { readonly runtime: RobotRuntimeStateV4; readonly definition: WorkcellProjectV4['robotDefinitions'][number] } | null {
  const robot = project.robots.find((candidate) => candidate.id === robotId)
  const registry = options.robots.getState()
  const jobs = options.jobs.getState()
  if (
    robot === undefined
    || registry.projectRevisionId !== project.revisionId
    || jobs.projectRevisionId !== project.revisionId
    || !Object.hasOwn(registry.robots, robotId)
    || !Object.hasOwn(jobs.byRobotId, robotId)
  ) return null
  const runtime = registry.robots[robotId]
  const definition = project.robotDefinitions.find((candidate) => candidate.id === robot.definitionId)
  return runtime === undefined || definition === undefined ? null : { runtime, definition }
}

function homeWriterV4(
  options: CreateRobotOperatorCommandServiceOptionsV4,
  project: WorkcellProjectV4,
  robotId: RobotIdV4,
): 'manual' | 'simulation' | null {
  const current = currentRobotV4(options, project, robotId)
  if (current === null) return null
  if (current.runtime.jointSource === 'manual') return 'manual'
  const running = options.jobs.getState().byRobotId[robotId]?.state === 'RUNNING'
  return current.runtime.jointSource === 'simulation' && !running ? 'simulation' : null
}

function unavailable(action: string): Error {
  return new Error(`Robot ${action} is unavailable because the runtime is stale or no longer permitted.`)
}

export function createRobotOperatorCommandServiceV4(
  options: CreateRobotOperatorCommandServiceOptionsV4,
): RobotOperatorCommandServiceV4 {
  return Object.freeze({
    canHome(robotId: RobotIdV4) {
      try {
        return homeWriterV4(options, options.readProject(), robotId) !== null
      } catch {
        return false
      }
    },
    home(robotId: RobotIdV4) {
      const project = options.readProject()
      const writer = homeWriterV4(options, project, robotId)
      const current = currentRobotV4(options, project, robotId)
      if (writer === null || current === null) throw unavailable('Home')
      const homes = ownNumberRecordV4()
      for (const joint of current.definition.joints) defineValueV4(homes, joint.id, joint.home)
      options.robots.getState().writeJointValues(robotId, homes, writer)
    },
    setGripper(robotId: RobotIdV4, state: 'OPEN' | 'CLOSED') {
      const project = options.readProject()
      if (currentRobotV4(options, project, robotId) === null) throw unavailable('Gripper command')
      options.robots.getState().setGripperState(robotId, state)
    },
    canSavePose(robotId: RobotIdV4, jobId: RobotJobIdV4 | null) {
      try {
        if (jobId === null) return false
        const project = options.readProject()
        const current = currentRobotV4(options, project, robotId)
        const job = project.jobs.find((candidate) => candidate.id === jobId)
        return current !== null
          && job !== undefined
          && job.robotId === robotId
          && options.jobs.getState().byRobotId[robotId]?.state !== 'RUNNING'
      } catch {
        return false
      }
    },
    async savePose(robotId: RobotIdV4, jobId: RobotJobIdV4) {
      const project = options.readProject()
      const current = currentRobotV4(options, project, robotId)
      const job = project.jobs.find((candidate) => candidate.id === jobId)
      if (
        current === null
        || job === undefined
        || job.robotId !== robotId
        || options.jobs.getState().byRobotId[robotId]?.state === 'RUNNING'
      ) throw unavailable('Save Pose')
      const snapshot = ownNumberRecordV4()
      for (const joint of current.definition.joints) {
        defineValueV4(snapshot, joint.id, current.runtime.jointValues[joint.id] ?? 0)
      }
      await options.jobCommands.saveJointPose(jobId, snapshot, 100)
    },
  })
}
