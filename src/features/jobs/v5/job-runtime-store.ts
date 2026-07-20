import {
  failProjectV5,
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import { createStore, type StoreApi } from 'zustand/vanilla'

export interface RobotJobRuntimeStateV5 {
  readonly robotId: string
  readonly jobId: string | null
  readonly runId: string | null
  readonly state: 'IDLE' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  readonly stepIndex: number | null
  readonly startedAtSimulationMs: number | null
  readonly completedAtSimulationMs: number | null
  readonly failureCode: string | null
  readonly message: string
}

export interface RobotJobTerminalResultV5 {
  readonly robotId: string
  readonly jobId: string
  readonly runId: string
  readonly state: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  readonly completedAtSimulationMs: number
  readonly failureCode: string | null
  readonly message: string
}

export interface JobRuntimeStoreV5 {
  readonly projectRevisionId: string | null
  readonly configRevision: string | null
  readonly byRobotId: Readonly<Record<string, RobotJobRuntimeStateV5>>
  replaceProject(project: WorkcellProjectV5, configRevision: string): void
  reset(project: WorkcellProjectV5, configRevision: string): void
  setRobotState(state: RobotJobRuntimeStateV5): void
}

const CONFIG_REVISION = /^[0-9a-f]{64}$/u
const EMPTY = Object.freeze({}) as Readonly<Record<string, RobotJobRuntimeStateV5>>

function runtimeFailure(code: string, path: string, message: string): never {
  failProjectV5(code, path, message, 'Correct the Job runtime state and try again.')
}
function requireConfigRevision(value: string): string {
  if (!CONFIG_REVISION.test(value)) throw new TypeError('Config revision must be a lowercase 64-character hexadecimal digest.')
  return value
}
function idle(robotId: string): RobotJobRuntimeStateV5 {
  return Object.freeze({ robotId, jobId: null, runId: null, state: 'IDLE', stepIndex: null, startedAtSimulationMs: null, completedAtSimulationMs: null, failureCode: null, message: '' })
}
function prepare(projectInput: WorkcellProjectV5, config: string): Pick<JobRuntimeStoreV5, 'projectRevisionId' | 'configRevision' | 'byRobotId'> {
  const project = validateWorkcellProjectV5(projectInput)
  return Object.freeze({ projectRevisionId: project.revisionId, configRevision: requireConfigRevision(config), byRobotId: Object.freeze(Object.fromEntries(project.robots.map((robot) => [robot.id, idle(robot.id)]))) })
}
function finite(value: number | null): value is number { return value !== null && Number.isFinite(value) && value >= 0 }
function inspect(state: RobotJobRuntimeStateV5): RobotJobRuntimeStateV5 {
  if (state === null || typeof state !== 'object' || Array.isArray(state) || typeof state.robotId !== 'string' || state.robotId.length === 0 || typeof state.message !== 'string') {
    runtimeFailure('JOB_RUNTIME_STATE_INVALID', '$.state', 'Robot Job state must be a valid object.')
  }
  if (state.state === 'IDLE') {
    if (state.jobId !== null || state.runId !== null || state.stepIndex !== null || state.startedAtSimulationMs !== null || state.completedAtSimulationMs !== null || state.failureCode !== null) runtimeFailure('JOB_RUNTIME_STATE_INVALID', '$.state', 'IDLE state cannot retain run data.')
  } else if (state.state === 'RUNNING' || state.state === 'SUCCEEDED' || state.state === 'FAILED' || state.state === 'CANCELLED') {
    if (typeof state.jobId !== 'string' || state.jobId.length === 0 || typeof state.runId !== 'string' || state.runId.length === 0 || state.stepIndex === null || !Number.isSafeInteger(state.stepIndex) || state.stepIndex < 0 || !finite(state.startedAtSimulationMs)) runtimeFailure('JOB_RUNTIME_STATE_INVALID', '$.state', 'Active states require Job, run, step, and start data.')
    if (state.state === 'RUNNING') {
      if (state.completedAtSimulationMs !== null || state.failureCode !== null) runtimeFailure('JOB_RUNTIME_STATE_INVALID', '$.state', 'RUNNING state cannot contain completion or failure data.')
    } else {
      if (!finite(state.completedAtSimulationMs) || state.completedAtSimulationMs < state.startedAtSimulationMs) runtimeFailure('JOB_RUNTIME_STATE_INVALID', '$.state.completedAtSimulationMs', 'Terminal completion must not precede start.')
      if (state.state === 'FAILED' ? typeof state.failureCode !== 'string' || state.failureCode.length === 0 : state.failureCode !== null) runtimeFailure('JOB_RUNTIME_STATE_INVALID', '$.state.failureCode', 'Terminal failure data is invalid.')
    }
  } else runtimeFailure('JOB_RUNTIME_STATE_INVALID', '$.state.state', 'Job state is invalid.')
  return Object.freeze({ ...state })
}

export function createJobRuntimeStoreV5(): StoreApi<JobRuntimeStoreV5>
export function createJobRuntimeStoreV5(project: WorkcellProjectV5, configRevision: string): StoreApi<JobRuntimeStoreV5>
export function createJobRuntimeStoreV5(project?: WorkcellProjectV5, configRevision?: string): StoreApi<JobRuntimeStoreV5> {
  if ((project === undefined) !== (configRevision === undefined)) {
    throw new TypeError('Project and config revision must either both be supplied or both be omitted.')
  }
  const initial = project === undefined ? null : prepare(project, configRevision!)
  return createStore<JobRuntimeStoreV5>()((set, get) => {
  const replaceProject = (nextProject: WorkcellProjectV5, nextConfig: string): void => set({ ...get(), ...prepare(nextProject, nextConfig) }, true)
    return {
      projectRevisionId: initial?.projectRevisionId ?? null,
      configRevision: initial?.configRevision ?? null,
      byRobotId: initial?.byRobotId ?? EMPTY,
      replaceProject,
      reset: replaceProject,
      setRobotState: (candidate) => {
        const next = inspect(candidate)
        const current = get()
        if (!Object.hasOwn(current.byRobotId, next.robotId)) runtimeFailure('ROBOT_INSTANCE_NOT_FOUND', `$.robots.${next.robotId}`, `Robot Instance ${next.robotId} is not published in the Job runtime.`)
        set({ ...current, byRobotId: Object.freeze({ ...current.byRobotId, [next.robotId]: next }) }, true)
      },
    }
  })
}
