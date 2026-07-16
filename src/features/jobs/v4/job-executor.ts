import {
  failProjectV4,
  sampleJointTransitionV4,
  transitionDurationMsV4,
  validateWorkcellProjectV4,
  type RobotDefinitionV4,
  type RobotJobStepV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { RobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import type { StoreApi } from 'zustand/vanilla'
import type {
  JobRuntimeStoreV4,
  RobotJobRuntimeStateV4,
  RobotJobTerminalResultV4,
} from './job-runtime-store.js'

export interface JobActionExecutionContextV4 {
  readonly jobId: string
  readonly robotId: string
  readonly runId: string
  readonly simulationMs: number
}

export interface JobActionExecutionPortV4 {
  execute(
    actionId: string,
    context: JobActionExecutionContextV4,
  ): Promise<void>
}

export const unavailableJobActionExecutionPortV4: JobActionExecutionPortV4 = Object.freeze({
  async execute(actionId: string): Promise<void> {
    failProjectV4(
      'ACTION_EXECUTOR_UNAVAILABLE',
      `$.actions.${actionId}`,
      'No Action executor is installed for this Job step.',
      'Install the Action execution boundary before running this Job.',
    )
  },
})

export interface RobotJobExecutorV4 {
  startJob(jobId: string, simulationMs: number): { readonly runId: string }
  advanceAll(simulationMs: number): Promise<void>
  cancelRobotJob(robotId: string, reason: string): void
  readState(robotId: string): RobotJobRuntimeStateV4
  waitForTerminal(runId: string): Promise<RobotJobTerminalResultV4>
  reset(): void
}

export interface RobotJobExecutorDependenciesV4 {
  readonly readProject: () => WorkcellProjectV4
  readonly robots: StoreApi<RobotRuntimeRegistryV4>
  readonly jobs: StoreApi<JobRuntimeStoreV4>
  readonly actionPort: JobActionExecutionPortV4
  readonly createRunId: () => string
}

type JointPoseStepV4 = Extract<RobotJobStepV4, { readonly kind: 'joint-pose' }>

interface ActiveJobSessionV4 {
  readonly robotId: string
  readonly jobId: string
  readonly runId: string
  readonly startedAtSimulationMs: number
  readonly steps: readonly RobotJobStepV4[]
  readonly definition: RobotDefinitionV4
  cursor: number
  lastPose: JointPoseStepV4 | null
  readyAtSimulationMs: number | null
  segment: {
    readonly from: Readonly<Record<string, number>>
    readonly to: Readonly<Record<string, number>>
    readonly startedAtSimulationMs: number
    readonly durationMs: number
  } | null
}

function executorFailure(code: string, path: string, message: string): never {
  failProjectV4(code, path, message, 'Correct the Job execution request and try again.')
}

function errorFacts(error: unknown): { readonly code: string; readonly message: string } {
  if (error !== null && typeof error === 'object') {
    const candidate = error as { readonly code?: unknown; readonly message?: unknown }
    if (typeof candidate.code === 'string' && candidate.code.length > 0) {
      return {
        code: candidate.code,
        message: typeof candidate.message === 'string' ? candidate.message : candidate.code,
      }
    }
  }
  return {
    code: 'ACTION_EXECUTION_FAILED',
    message: error instanceof Error ? error.message : 'Action execution failed.',
  }
}

export function createRobotJobExecutorV4(
  dependencies: RobotJobExecutorDependenciesV4,
): RobotJobExecutorV4 {
  const sessions = new Map<string, ActiveJobSessionV4>()
  const chains = new Map<string, Promise<void>>()
  const knownRunIds = new Set<string>()
  const terminalResults = new Map<string, RobotJobTerminalResultV4>()
  const terminalWaiters = new Map<
    string,
    Array<(result: RobotJobTerminalResultV4) => void>
  >()
  let latestAcceptedSimulationMs: number | null = null

  const assertSimulationTime = (simulationMs: number): void => {
    if (!Number.isFinite(simulationMs) || simulationMs < 0) {
      executorFailure(
        'SIMULATION_TIME_INVALID',
        '$.simulationMs',
        'Simulation time must be finite and nonnegative.',
      )
    }
    if (latestAcceptedSimulationMs !== null && simulationMs < latestAcceptedSimulationMs) {
      executorFailure(
        'SIMULATION_CLOCK_DECREASED',
        '$.simulationMs',
        'Simulation time must be globally nondecreasing.',
      )
    }
  }

  const requireRuntimeState = (robotId: string): RobotJobRuntimeStateV4 => {
    const state = dependencies.jobs.getState().byRobotId[robotId]
    if (state === undefined) {
      executorFailure(
        'ROBOT_INSTANCE_NOT_FOUND',
        `$.robots.${robotId}`,
        `Robot Instance ${robotId} is not published in the Job runtime.`,
      )
    }
    return state
  }

  const isAuthoritative = (session: ActiveJobSessionV4): boolean => {
    if (sessions.get(session.robotId) !== session) return false
    const state = dependencies.jobs.getState().byRobotId[session.robotId]
    return state?.state === 'RUNNING' && state.runId === session.runId
  }

  const publishRunning = (session: ActiveJobSessionV4): void => {
    if (!isAuthoritative(session)) return
    dependencies.jobs.getState().setRobotState({
      robotId: session.robotId,
      jobId: session.jobId,
      runId: session.runId,
      state: 'RUNNING',
      stepIndex: session.cursor,
      startedAtSimulationMs: session.startedAtSimulationMs,
      completedAtSimulationMs: null,
      failureCode: null,
      message: '',
    })
  }

  const publishTerminal = (
    session: ActiveJobSessionV4,
    state: 'SUCCEEDED' | 'FAILED' | 'CANCELLED',
    completedAtSimulationMs: number,
    failureCode: string | null,
    message: string,
  ): RobotJobTerminalResultV4 | null => {
    if (!isAuthoritative(session) || terminalResults.has(session.runId)) return null
    const result: RobotJobTerminalResultV4 = Object.freeze({
      robotId: session.robotId,
      jobId: session.jobId,
      runId: session.runId,
      state,
      completedAtSimulationMs,
      failureCode,
      message,
    })
    dependencies.jobs.getState().setRobotState({
      robotId: session.robotId,
      jobId: session.jobId,
      runId: session.runId,
      state,
      stepIndex: session.cursor,
      startedAtSimulationMs: session.startedAtSimulationMs,
      completedAtSimulationMs,
      failureCode,
      message,
    })
    if (sessions.get(session.robotId) === session) sessions.delete(session.robotId)
    terminalResults.set(session.runId, result)
    const waiters = terminalWaiters.get(session.runId) ?? []
    terminalWaiters.delete(session.runId)
    waiters.forEach((resolve) => resolve(result))
    return result
  }

  const writeJoints = (
    session: ActiveJobSessionV4,
    values: Readonly<Record<string, number>>,
  ): void => {
    dependencies.robots.getState().writeJointValues(
      session.robotId,
      values,
      'simulation',
    )
  }

  const processSession = async (
    session: ActiveJobSessionV4,
    suppliedSimulationMs: number,
  ): Promise<void> => {
    try {
      while (isAuthoritative(session)) {
        if (session.cursor >= session.steps.length) {
          publishTerminal(
            session,
            'SUCCEEDED',
            session.readyAtSimulationMs ?? suppliedSimulationMs,
            null,
            '',
          )
          return
        }

        const step = session.steps[session.cursor]!
        if (step.kind === 'action-reference') {
          const logicalSimulationMs = session.readyAtSimulationMs ?? suppliedSimulationMs
          session.readyAtSimulationMs = logicalSimulationMs
          try {
            await dependencies.actionPort.execute(step.actionId, {
              jobId: session.jobId,
              robotId: session.robotId,
              runId: session.runId,
              simulationMs: logicalSimulationMs,
            })
          } catch (error) {
            if (!isAuthoritative(session)) return
            const failure = errorFacts(error)
            publishTerminal(
              session,
              'FAILED',
              logicalSimulationMs,
              failure.code,
              failure.message,
            )
            return
          }
          if (!isAuthoritative(session)) return
          session.cursor += 1
          publishRunning(session)
          continue
        }

        if (session.lastPose === null) {
          writeJoints(session, step.jointValues)
          if (!isAuthoritative(session)) return
          session.lastPose = step
          session.cursor += 1
          session.readyAtSimulationMs ??= suppliedSimulationMs
          publishRunning(session)
          continue
        }

        if (session.segment === null) {
          const startedAtSimulationMs = session.readyAtSimulationMs ?? suppliedSimulationMs
          session.segment = {
            from: session.lastPose.jointValues,
            to: step.jointValues,
            startedAtSimulationMs,
            durationMs: transitionDurationMsV4(
              session.lastPose.jointValues,
              step.jointValues,
              session.lastPose.speedPercentToNext,
              session.definition.joints,
            ),
          }
        }

        const segment = session.segment
        const elapsedMs = suppliedSimulationMs - segment.startedAtSimulationMs
        if (elapsedMs < segment.durationMs) {
          writeJoints(session, sampleJointTransitionV4({
            from: segment.from,
            to: segment.to,
            elapsedMs,
            durationMs: segment.durationMs,
            joints: session.definition.joints,
          }))
          publishRunning(session)
          return
        }

        writeJoints(session, step.jointValues)
        if (!isAuthoritative(session)) return
        session.lastPose = step
        session.cursor += 1
        session.readyAtSimulationMs = segment.startedAtSimulationMs + segment.durationMs
        session.segment = null
        publishRunning(session)
      }
    } catch (error) {
      if (!isAuthoritative(session)) return
      const failure = errorFacts(error)
      publishTerminal(
        session,
        'FAILED',
        session.readyAtSimulationMs ?? suppliedSimulationMs,
        failure.code,
        failure.message,
      )
    }
  }

  const enqueue = (
    session: ActiveJobSessionV4,
    simulationMs: number,
  ): Promise<void> => {
    const prior = chains.get(session.robotId) ?? Promise.resolve()
    const next = prior.then(async () => {
      if (isAuthoritative(session)) await processSession(session, simulationMs)
    })
    chains.set(session.robotId, next)
    void next.finally(() => {
      if (chains.get(session.robotId) === next) chains.delete(session.robotId)
    })
    return next
  }

  const executor: RobotJobExecutorV4 = {
    startJob(jobId, simulationMs) {
      assertSimulationTime(simulationMs)
      const project = validateWorkcellProjectV4(dependencies.readProject())
      const job = project.jobs.find((candidate) => candidate.id === jobId)
      if (job === undefined) {
        executorFailure('JOB_NOT_FOUND', `$.jobs.${jobId}`, `Job ${jobId} does not exist.`)
      }
      const robot = project.robots.find((candidate) => candidate.id === job.robotId)
      if (robot === undefined) {
        executorFailure(
          'ROBOT_INSTANCE_NOT_FOUND',
          `$.robots.${job.robotId}`,
          `Robot Instance ${job.robotId} does not exist.`,
        )
      }
      const runtimeState = requireRuntimeState(robot.id)
      if (runtimeState.state === 'RUNNING') {
        executorFailure(
          'ROBOT_JOB_ALREADY_RUNNING',
          `$.robots.${robot.id}`,
          `Robot ${robot.id} already has a running Job.`,
        )
      }
      const liveRobot = dependencies.robots.getState().robots[robot.id]
      if (robot.jointSource !== 'simulation' || liveRobot?.jointSource !== 'simulation') {
        executorFailure(
          'ROBOT_JOINT_SOURCE_NOT_SIMULATION',
          `$.robots.${robot.id}.jointSource`,
          `Robot ${robot.id} Joint source must be simulation.`,
        )
      }
      const definition = project.robotDefinitions.find(
        (candidate) => candidate.id === robot.definitionId,
      )
      if (definition === undefined) {
        executorFailure(
          'ROBOT_DEFINITION_NOT_FOUND',
          `$.robotDefinitions.${robot.definitionId}`,
          `Robot Definition ${robot.definitionId} does not exist.`,
        )
      }

      const runId = dependencies.createRunId()
      if (typeof runId !== 'string' || runId.length === 0) {
        executorFailure('JOB_RUN_ID_INVALID', '$.runId', 'Run ID must be a non-empty string.')
      }
      if (knownRunIds.has(runId)) {
        executorFailure('JOB_RUN_ID_COLLISION', '$.runId', `Run ID ${runId} already exists.`)
      }

      const session: ActiveJobSessionV4 = {
        robotId: robot.id,
        jobId: job.id,
        runId,
        startedAtSimulationMs: simulationMs,
        steps: job.steps,
        definition,
        cursor: 0,
        lastPose: null,
        readyAtSimulationMs: null,
        segment: null,
      }
      latestAcceptedSimulationMs = simulationMs
      knownRunIds.add(runId)
      sessions.set(robot.id, session)
      dependencies.jobs.getState().setRobotState({
        robotId: robot.id,
        jobId: job.id,
        runId,
        state: 'RUNNING',
        stepIndex: 0,
        startedAtSimulationMs: simulationMs,
        completedAtSimulationMs: null,
        failureCode: null,
        message: '',
      })
      return Object.freeze({ runId })
    },

    async advanceAll(simulationMs) {
      assertSimulationTime(simulationMs)
      latestAcceptedSimulationMs = simulationMs
      const active = [...sessions.values()]
      await Promise.all(active.map((session) => enqueue(session, simulationMs)))
    },

    cancelRobotJob(robotId, reason) {
      const session = sessions.get(robotId)
      if (session === undefined || !isAuthoritative(session)) return
      const priorChain = chains.get(robotId)
      const completedAt = latestAcceptedSimulationMs ?? session.startedAtSimulationMs
      publishTerminal(session, 'CANCELLED', completedAt, null, reason)
      if (chains.get(robotId) === priorChain) chains.delete(robotId)
    },

    readState(robotId) {
      return requireRuntimeState(robotId)
    },

    waitForTerminal(runId) {
      const result = terminalResults.get(runId)
      if (result !== undefined) return Promise.resolve(result)
      if (!knownRunIds.has(runId)) {
        return Promise.reject(new Error(`JOB_RUN_NOT_FOUND: ${runId}`))
      }
      return new Promise<RobotJobTerminalResultV4>((resolve) => {
        const waiters = terminalWaiters.get(runId) ?? []
        waiters.push(resolve)
        terminalWaiters.set(runId, waiters)
      })
    },

    reset() {
      const project = validateWorkcellProjectV4(dependencies.readProject())
      const active = [...sessions.values()]
      for (const session of active) {
        const completedAt = latestAcceptedSimulationMs ?? session.startedAtSimulationMs
        publishTerminal(session, 'CANCELLED', completedAt, null, 'Job runtime reset.')
      }
      sessions.clear()
      chains.clear()
      dependencies.jobs.getState().reset(project)
      latestAcceptedSimulationMs = null
    },
  }

  return Object.freeze(executor)
}
