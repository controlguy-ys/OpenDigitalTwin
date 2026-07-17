import {
  failProjectV4,
  validateWorkcellProjectV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { createStore, type StoreApi } from 'zustand/vanilla'

export interface RobotJobRuntimeStateV4 {
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

export interface RobotJobTerminalResultV4 {
  readonly robotId: string
  readonly jobId: string
  readonly runId: string
  readonly state: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  readonly completedAtSimulationMs: number
  readonly failureCode: string | null
  readonly message: string
}

export interface JobRuntimeCheckpointV4 {
  readonly kind: 'job-runtime-checkpoint-v4'
}

export interface JobRuntimeStoreV4 {
  readonly projectRevisionId: string | null
  readonly byRobotId: Readonly<Record<string, RobotJobRuntimeStateV4>>
  replaceProject(project: WorkcellProjectV4): void
  setRobotState(state: RobotJobRuntimeStateV4): void
  reset(project: WorkcellProjectV4): void
  captureCheckpoint(): JobRuntimeCheckpointV4
  restoreCheckpoint(checkpoint: JobRuntimeCheckpointV4): void
}

const EMPTY_JOB_RUNTIME_STATES_V4 = Object.freeze({}) as Readonly<
  Record<string, RobotJobRuntimeStateV4>
>

function runtimeFailure(code: string, path: string, message: string): never {
  failProjectV4(code, path, message, 'Correct the Job runtime state and try again.')
}

function idleRobotState(robotId: string): RobotJobRuntimeStateV4 {
  return Object.freeze({
    robotId,
    jobId: null,
    runId: null,
    state: 'IDLE',
    stepIndex: null,
    startedAtSimulationMs: null,
    completedAtSimulationMs: null,
    failureCode: null,
    message: '',
  })
}

function prepareProjectState(project: WorkcellProjectV4): {
  readonly projectRevisionId: string
  readonly byRobotId: Readonly<Record<string, RobotJobRuntimeStateV4>>
} {
  const validated = validateWorkcellProjectV4(project)
  return {
    projectRevisionId: validated.revisionId,
    byRobotId: Object.freeze(Object.fromEntries(
      validated.robots.map((robot) => [robot.id, idleRobotState(robot.id)]),
    )),
  }
}

export function buildInitialJobRuntimeStatesV4(
  project: WorkcellProjectV4,
): Readonly<Record<string, RobotJobRuntimeStateV4>> {
  return prepareProjectState(project).byRobotId
}

function isFiniteNonnegative(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0
}

function inspectRobotState(state: RobotJobRuntimeStateV4): RobotJobRuntimeStateV4 {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    runtimeFailure('JOB_RUNTIME_STATE_INVALID', '$.state', 'Robot Job state must be an object.')
  }
  if (typeof state.robotId !== 'string' || state.robotId.length === 0) {
    runtimeFailure('JOB_RUNTIME_STATE_INVALID', '$.state.robotId', 'Robot ID is required.')
  }
  if (typeof state.message !== 'string') {
    runtimeFailure('JOB_RUNTIME_STATE_INVALID', '$.state.message', 'Message must be a string.')
  }

  const terminal = state.state === 'SUCCEEDED' || state.state === 'FAILED' || state.state === 'CANCELLED'
  if (state.state === 'IDLE') {
    if (
      state.jobId !== null
      || state.runId !== null
      || state.stepIndex !== null
      || state.startedAtSimulationMs !== null
      || state.completedAtSimulationMs !== null
      || state.failureCode !== null
    ) {
      runtimeFailure(
        'JOB_RUNTIME_STATE_INVALID',
        '$.state',
        'IDLE state cannot retain Job, run, step, time, or failure data.',
      )
    }
  } else if (state.state === 'RUNNING' || terminal) {
    if (
      typeof state.jobId !== 'string'
      || state.jobId.length === 0
      || typeof state.runId !== 'string'
      || state.runId.length === 0
      || !Number.isSafeInteger(state.stepIndex)
      || state.stepIndex! < 0
      || !isFiniteNonnegative(state.startedAtSimulationMs)
    ) {
      runtimeFailure(
        'JOB_RUNTIME_STATE_INVALID',
        '$.state',
        'Active and terminal states require Job, run, step, and finite start data.',
      )
    }
    if (state.state === 'RUNNING') {
      if (state.completedAtSimulationMs !== null || state.failureCode !== null) {
        runtimeFailure(
          'JOB_RUNTIME_STATE_INVALID',
          '$.state',
          'RUNNING state cannot contain completion or failure data.',
        )
      }
    } else {
      if (
        !isFiniteNonnegative(state.completedAtSimulationMs)
        || state.completedAtSimulationMs < state.startedAtSimulationMs
      ) {
        runtimeFailure(
          'JOB_RUNTIME_STATE_INVALID',
          '$.state.completedAtSimulationMs',
          'Terminal completion time must be finite and not precede the start.',
        )
      }
      if (state.state === 'FAILED') {
        if (typeof state.failureCode !== 'string' || state.failureCode.length === 0) {
          runtimeFailure(
            'JOB_RUNTIME_STATE_INVALID',
            '$.state.failureCode',
            'FAILED state requires a failure code.',
          )
        }
      } else if (state.failureCode !== null) {
        runtimeFailure(
          'JOB_RUNTIME_STATE_INVALID',
          '$.state.failureCode',
          'Successful and cancelled states cannot contain a failure code.',
        )
      }
    }
  } else {
    runtimeFailure('JOB_RUNTIME_STATE_INVALID', '$.state.state', 'Job state is invalid.')
  }

  return Object.freeze({ ...state })
}

export function createJobRuntimeStoreV4(): StoreApi<JobRuntimeStoreV4> {
  const checkpoints = new WeakMap<object, JobRuntimeStoreV4>()
  return createStore<JobRuntimeStoreV4>()((set, get) => {
    const replaceProject = (project: WorkcellProjectV4): void => {
      const candidate = prepareProjectState(project)
      set((state) => ({ ...state, ...candidate }), true)
    }

    return {
      projectRevisionId: null,
      byRobotId: EMPTY_JOB_RUNTIME_STATES_V4,
      replaceProject,
      reset: replaceProject,
      setRobotState: (state) => {
        const candidate = inspectRobotState(state)
        const current = get()
        if (!Object.hasOwn(current.byRobotId, candidate.robotId)) {
          runtimeFailure(
            'ROBOT_INSTANCE_NOT_FOUND',
            `$.robots.${candidate.robotId}`,
            `Robot Instance ${candidate.robotId} is not published in the Job runtime.`,
          )
        }
        set({
          ...current,
          byRobotId: Object.freeze({ ...current.byRobotId, [candidate.robotId]: candidate }),
        }, true)
      },
      captureCheckpoint: () => {
        const checkpoint = Object.freeze({
          kind: 'job-runtime-checkpoint-v4' as const,
        })
        checkpoints.set(checkpoint, get())
        return checkpoint
      },
      restoreCheckpoint: (checkpoint) => {
        if (checkpoint === null || typeof checkpoint !== 'object') {
          runtimeFailure(
            'JOB_RUNTIME_CHECKPOINT_INVALID',
            '$.checkpoint',
            'Job runtime checkpoint is not owned by this store.',
          )
        }
        const captured = checkpoints.get(checkpoint)
        if (captured === undefined) {
          runtimeFailure(
            'JOB_RUNTIME_CHECKPOINT_INVALID',
            '$.checkpoint',
            'Job runtime checkpoint is not owned by this store.',
          )
        }
        set(captured, true)
      },
    }
  })
}
