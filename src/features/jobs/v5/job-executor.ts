import {
  failProjectV5,
  validateWorkcellProjectV5,
  type RobotDefinitionV5,
  type RobotJobInstructionV1,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import type { CommandResultV1 } from '../../../core/runtime-protocol/v1.js'
import {
  isAttachmentInstructionErrorV1,
  type AttachmentInstructionFailureCodeV1,
} from '../../../core/action-runtime-v5/attachment-instruction-error.js'
import type { StoreApi } from 'zustand/vanilla'
import type { RobotJointRuntimeStoreV5 } from '../../robot/v5/robot-joint-runtime-store.js'
import type { LogicalSignalRuntimeStoreV1 } from '../../signals/v5/logical-signal-runtime-store.js'
import {
  isGatewaySignalWriteErrorV1,
  isRuntimeGatewayCommandClientV1Error,
  type GatewaySignalWritePortV1,
} from '../../runtime-gateway/v5/runtime-gateway-command-client.js'
import type {
  JobRuntimeStoreV5,
  RobotJobRuntimeStateV5,
  RobotJobTerminalResultV5,
} from './job-runtime-store.js'

export interface JobInstructionContextV1 {
  readonly robotId: string
  readonly jobId: string
  readonly runId: string
  readonly simulationMs: number
}
export interface AttachmentInstructionPortV1 {
  attach(instruction: Extract<RobotJobInstructionV1, { readonly kind: 'attach' }>, context: JobInstructionContextV1): Promise<void>
  detach(instruction: Extract<RobotJobInstructionV1, { readonly kind: 'detach' }>, context: JobInstructionContextV1): Promise<void>
}
export interface RobotJobExecutorDependenciesV5 {
  readonly readProject: () => WorkcellProjectV5
  readonly robots: StoreApi<RobotJointRuntimeStoreV5>
  readonly jobs: StoreApi<JobRuntimeStoreV5>
  readonly signals: StoreApi<LogicalSignalRuntimeStoreV1>
  readonly signalWrites: GatewaySignalWritePortV1
  readonly attachments: AttachmentInstructionPortV1
  readonly createRunId: () => string
}
export interface RobotJobExecutorV5 {
  startJob(jobId: string, simulationMs: number): { readonly runId: string }
  advanceRobot(robotId: string, simulationMs: number): Promise<void>
  advanceAll(simulationMs: number): Promise<void>
  cancelRobotJob(robotId: string, reason: string): void
  cancelJob(robotId?: string, reason?: string): void
  readState(robotId: string): RobotJobRuntimeStateV5
  waitForTerminal(runId: string): Promise<RobotJobTerminalResultV5>
  reset(): void
  shutdown(reason?: string): void
}
export interface RobotJobExecutorLifecycleV5 {
  requestShutdown(reason?: string, onDeferredShutdownError?: (error: unknown) => void): void
}

type MoveInstruction = Extract<RobotJobInstructionV1, { readonly kind: 'move-joint' }>
interface ActiveInstruction {
  readonly instructionId: string
  readonly enteredAtSimulationMs: number
  readonly controller: AbortController | null
  readonly pending: Promise<CommandResultV1 | void> | null
}
interface Session {
  readonly robotId: string
  readonly jobId: string
  readonly runId: string
  readonly startedAtSimulationMs: number
  readonly instructions: readonly RobotJobInstructionV1[]
  readonly definition: RobotDefinitionV5
  cursor: number
  lastMove: MoveInstruction | null
  readyAtSimulationMs: number | null
  active: ActiveInstruction | null
  segment: { readonly from: Readonly<Record<string, number>>; readonly to: Readonly<Record<string, number>>; readonly startedAt: number; readonly durationMs: number } | null
  lastSimulationMs: number
}
interface ChainEntry {
  readonly session: Session
  readonly promise: Promise<void>
}

function failure(code: string, path: string, message: string): never {
  failProjectV5(code, path, message, 'Correct the Job execution request and try again.')
}
function validTime(value: number): void {
  if (!Number.isFinite(value) || value < 0) failure('SIMULATION_TIME_INVALID', '$.simulationMs', 'Simulation time must be finite and nonnegative.')
}
function signalFailure(error: unknown): { readonly code: string; readonly message: string } {
  if (isGatewaySignalWriteErrorV1(error) || isRuntimeGatewayCommandClientV1Error(error)) return { code: error.code, message: error.message }
  return { code: 'SIGNAL_WRITE_FAILED', message: error instanceof Error ? error.message : 'SIGNAL_WRITE_FAILED' }
}
function attachmentFailure(error: unknown): { readonly code: string; readonly message: string } {
  if (isAttachmentInstructionErrorV1(error)) return { code: error.code, message: error.message }
  const fallback = 'ATTACHMENT_INSTRUCTION_FAILED'
  return { code: fallback, message: error instanceof Error ? error.message : fallback }
}
function durationMs(from: Readonly<Record<string, number>>, to: Readonly<Record<string, number>>, speed: number, definition: RobotDefinitionV5): number {
  if (!Number.isSafeInteger(speed) || speed < 1 || speed > 100) failure('JOB_SPEED_INVALID', '$.speedPercent', 'Job speed must be a safe integer within 1..100.')
  const elapsed = definition.joints.reduce((maximum, joint) => {
    const raw = to[joint.id]! - from[joint.id]!
    const candidates = joint.type === 'revolute' ? [raw, raw + 360, raw - 360] : [raw]
    const delta = candidates.filter((candidate) => {
      const ending = from[joint.id]! + candidate
      return ending >= joint.min && ending <= joint.max
    }).sort((a, b) => Math.abs(a) - Math.abs(b))[0] ?? raw
    return Math.max(maximum, Math.abs(delta) / joint.maximumVelocity * 1_000)
  }, 0)
  return elapsed / (speed / 100)
}
function sample(from: Readonly<Record<string, number>>, to: Readonly<Record<string, number>>, elapsed: number, duration: number, definition: RobotDefinitionV5): Readonly<Record<string, number>> {
  const progress = duration === 0 ? 1 : Math.max(0, Math.min(1, elapsed / duration))
  return Object.freeze(Object.fromEntries(definition.joints.map((joint) => {
    const raw = to[joint.id]! - from[joint.id]!
    const candidates = joint.type === 'revolute' ? [raw, raw + 360, raw - 360] : [raw]
    const delta = candidates.filter((candidate) => {
      const ending = from[joint.id]! + candidate
      return ending >= joint.min && ending <= joint.max
    }).sort((a, b) => Math.abs(a) - Math.abs(b))[0] ?? raw
    return [joint.id, from[joint.id]! + delta * progress]
  })))
}

export function createRobotJobExecutorV5(dependencies: RobotJobExecutorDependenciesV5): RobotJobExecutorV5 & RobotJobExecutorLifecycleV5 {
  const sessions = new Map<string, Session>()
  const chains = new Map<string, ChainEntry>()
  const knownRunIds = new Set<string>()
  const reservedRunIds = new Set<string>()
  const terminal = new Map<string, RobotJobTerminalResultV5>()
  const waiters = new Map<string, Array<(result: RobotJobTerminalResultV5) => void>>()
  let latestTime: number | null = null
  let disposed = false
  let resetting = false
  let starting = false
  let requestedShutdownReason: string | null = null
  let requestedShutdownErrorHandler: ((error: unknown) => void) | null = null

  const assertNotStarting = (): void => {
    if (starting) failure('JOB_RUNTIME_START_IN_PROGRESS', '$.jobRuntime', 'A Robot Job start is already being published.')
  }

  const authoritative = (session: Session): boolean => {
    if (disposed || sessions.get(session.robotId) !== session) return false
    const state = dependencies.jobs.getState().byRobotId[session.robotId]
    return state?.state === 'RUNNING' && state.runId === session.runId
  }
  const publishRunning = (session: Session): void => {
    if (!authoritative(session)) return
    dependencies.jobs.getState().setRobotState({ robotId: session.robotId, jobId: session.jobId, runId: session.runId, state: 'RUNNING', stepIndex: session.cursor, startedAtSimulationMs: session.startedAtSimulationMs, completedAtSimulationMs: null, failureCode: null, message: '' })
  }
  const invalidateSession = (session: Session): void => {
    if (sessions.get(session.robotId) === session) sessions.delete(session.robotId)
    const chain = chains.get(session.robotId)
    if (chain?.session === session) chains.delete(session.robotId)
  }
  const recordTerminal = (session: Session, state: RobotJobTerminalResultV5['state'], at: number, failureCode: string | null, message: string): RobotJobTerminalResultV5 | null => {
    if (terminal.has(session.runId)) return null
    const result = Object.freeze({ robotId: session.robotId, jobId: session.jobId, runId: session.runId, state, completedAtSimulationMs: at, failureCode, message })
    terminal.set(session.runId, result)
    for (const resolve of waiters.get(session.runId) ?? []) resolve(result)
    waiters.delete(session.runId)
    return result
  }
  const publishTerminal = (session: Session, state: RobotJobTerminalResultV5['state'], at: number, failureCode: string | null, message: string): void => {
    if (!authoritative(session) || terminal.has(session.runId)) return
    invalidateSession(session)
    session.active?.controller?.abort()
    if (recordTerminal(session, state, at, failureCode, message) === null) return
    const current = dependencies.jobs.getState().byRobotId[session.robotId]
    if (current?.state === 'RUNNING' && current.runId === session.runId) {
      dependencies.jobs.getState().setRobotState({ robotId: session.robotId, jobId: session.jobId, runId: session.runId, state, stepIndex: session.cursor, startedAtSimulationMs: session.startedAtSimulationMs, completedAtSimulationMs: at, failureCode, message })
    }
  }
  const terminateDetached = (session: Session, reason: string): void => {
    invalidateSession(session)
    session.active?.controller?.abort()
    recordTerminal(session, 'CANCELLED', session.lastSimulationMs, null, reason)
  }
  const settleForTeardown = terminateDetached
  const execute = async (session: Session, supplied: number): Promise<void> => {
    while (authoritative(session)) {
      if (session.cursor >= session.instructions.length) {
        publishTerminal(session, 'SUCCEEDED', session.readyAtSimulationMs ?? supplied, null, '')
        return
      }
      session.lastSimulationMs = supplied
      const instruction = session.instructions[session.cursor]!
      const entered = session.active?.instructionId === instruction.id
        ? session.active.enteredAtSimulationMs
        : (session.readyAtSimulationMs ?? session.startedAtSimulationMs)
      if (session.active === null) session.active = { instructionId: instruction.id, enteredAtSimulationMs: entered, controller: null, pending: null }

      if (instruction.kind === 'move-joint') {
        if (session.lastMove === null) {
          dependencies.robots.getState().writeJointValues(session.robotId, instruction.jointValues, 'simulation')
          session.lastMove = instruction; session.cursor += 1; session.readyAtSimulationMs = entered; session.active = null; publishRunning(session); continue
        }
        if (session.segment === null) session.segment = { from: session.lastMove.jointValues, to: instruction.jointValues, startedAt: entered, durationMs: durationMs(session.lastMove.jointValues, instruction.jointValues, session.lastMove.speedPercentToNext, session.definition) }
        const segment = session.segment
        if (supplied < segment.startedAt + segment.durationMs) {
          dependencies.robots.getState().writeJointValues(session.robotId, sample(segment.from, segment.to, supplied - segment.startedAt, segment.durationMs, session.definition), 'simulation')
          publishRunning(session); return
        }
        dependencies.robots.getState().writeJointValues(session.robotId, instruction.jointValues, 'simulation')
        session.lastMove = instruction; session.cursor += 1; session.readyAtSimulationMs = segment.startedAt + segment.durationMs; session.segment = null; session.active = null; publishRunning(session); continue
      }

      if (instruction.kind === 'set-do') {
        if (session.active.pending === null) {
          const controller = new AbortController()
          const active: ActiveInstruction = { ...session.active, controller, pending: null }
          session.active = active
          let pending: Promise<CommandResultV1>
          try { pending = Promise.resolve(dependencies.signalWrites.writeBoolean(instruction.signalId, instruction.value, controller.signal)) } catch (error) { pending = Promise.reject(error) }
          if (session.active === active) session.active = { ...active, pending }
          try {
            const result = await pending
            if (!authoritative(session)) return
            if (!(result.acknowledgement === 'ACCEPTED' && result.executionState === 'SUCCEEDED')) {
              const code = typeof result.failureCode === 'string' && result.failureCode.length > 0 ? result.failureCode : 'SIGNAL_WRITE_FAILED'
              publishTerminal(session, 'FAILED', entered, code, result.message); return
            }
          } catch (error) {
            if (!authoritative(session)) return
            const facts = signalFailure(error)
            publishTerminal(session, 'FAILED', entered, facts.code, facts.message); return
          }
        } else {
          try {
            const result = await session.active.pending as CommandResultV1
            if (!authoritative(session)) return
            if (!(result.acknowledgement === 'ACCEPTED' && result.executionState === 'SUCCEEDED')) {
              const code = typeof result.failureCode === 'string' && result.failureCode.length > 0 ? result.failureCode : 'SIGNAL_WRITE_FAILED'
              publishTerminal(session, 'FAILED', entered, code, result.message); return
            }
          } catch (error) {
            if (!authoritative(session)) return
            const facts = signalFailure(error)
            publishTerminal(session, 'FAILED', entered, facts.code, facts.message); return
          }
        }
        if (!authoritative(session)) return
        session.cursor += 1; session.readyAtSimulationMs = entered; session.active = null; publishRunning(session); continue
      }

      if (instruction.kind === 'wait-di') {
        const value = dependencies.signals.getState().read(instruction.signalId)
        if (value?.quality === 'GOOD' && typeof value.value === 'boolean' && value.value === instruction.expected) {
          session.cursor += 1; session.readyAtSimulationMs = supplied; session.active = null; publishRunning(session); continue
        }
        if (supplied >= entered + instruction.timeoutMs) { publishTerminal(session, 'FAILED', entered + instruction.timeoutMs, 'WAIT_DI_TIMEOUT', `WaitDI instruction ${instruction.id} timed out.`); return }
        publishRunning(session); return
      }

      if (instruction.kind === 'delay') {
        if (supplied < entered + instruction.durationMs) { publishRunning(session); return }
        session.cursor += 1; session.readyAtSimulationMs = entered + instruction.durationMs; session.active = null; publishRunning(session); continue
      }

      if (instruction.kind === 'attach' || instruction.kind === 'detach') {
        if (session.active.pending === null) {
          let action: Promise<void>
          try {
            action = instruction.kind === 'attach'
              ? dependencies.attachments.attach(instruction, { robotId: session.robotId, jobId: session.jobId, runId: session.runId, simulationMs: entered })
              : dependencies.attachments.detach(instruction, { robotId: session.robotId, jobId: session.jobId, runId: session.runId, simulationMs: entered })
          } catch (error) { action = Promise.reject(error) }
          session.active = { ...session.active, pending: action }
        }
        try { await session.active.pending } catch (error) {
          if (!authoritative(session)) return
          const facts = attachmentFailure(error)
          publishTerminal(session, 'FAILED', entered, facts.code as AttachmentInstructionFailureCodeV1 | 'ATTACHMENT_INSTRUCTION_FAILED', facts.message); return
        }
        if (!authoritative(session)) return
        session.cursor += 1; session.readyAtSimulationMs = entered; session.active = null; publishRunning(session); continue
      }
    }
  }
  const executeSafely = async (session: Session, supplied: number): Promise<void> => {
    try {
      await execute(session, supplied)
    } catch (error) {
      if (!authoritative(session)) return
      const message = error instanceof Error && error.message.length > 0 ? error.message : 'Robot Job execution failed.'
      try {
        publishTerminal(session, 'FAILED', supplied, 'JOB_EXECUTION_FAILED', message)
      } catch {
        if (sessions.get(session.robotId) === session) {
          invalidateSession(session)
          session.active?.controller?.abort()
          recordTerminal(session, 'FAILED', supplied, 'JOB_EXECUTION_FAILED', message)
        }
      }
    }
  }
  const enqueue = (session: Session, simulationMs: number): Promise<void> => {
    const prior = chains.get(session.robotId)?.promise
    let resolve!: () => void
    const promise = new Promise<void>((done) => { resolve = done })
    const entry: ChainEntry = { session, promise }
    chains.set(session.robotId, entry)
    const run = (): void => {
      let execution: Promise<void>
      try { execution = executeSafely(session, simulationMs) } catch { execution = Promise.resolve() }
      void execution.then(resolve, resolve)
    }
    if (prior === undefined) run()
    else void prior.then(run, run)
    void promise.then(
      () => { if (chains.get(session.robotId) === entry) chains.delete(session.robotId) },
      () => { if (chains.get(session.robotId) === entry) chains.delete(session.robotId) },
    )
    return promise
  }
  const acceptSimulationTime = (simulationMs: number): void => {
    validTime(simulationMs)
    if (latestTime !== null && simulationMs < latestTime) failure('SIMULATION_CLOCK_DECREASED', '$.simulationMs', 'Simulation time must be globally nondecreasing.')
    latestTime = simulationMs
  }
  const cancelRobotJob = (robotId: string, reason: string): void => {
    assertNotStarting()
    const session = sessions.get(robotId)
    if (session === undefined) return
    if (authoritative(session)) publishTerminal(session, 'CANCELLED', session.lastSimulationMs, null, reason)
    else terminateDetached(session, reason)
  }
  const subscription = dependencies.jobs.subscribe((next) => {
    for (const session of Array.from(sessions.values())) {
      const state = next.byRobotId[session.robotId]
      if (state?.state !== 'RUNNING' || state.runId !== session.runId) terminateDetached(session, 'Job runtime was replaced.')
    }
  })

  const startJob = (jobId: string, simulationMs: number): { readonly runId: string } => {
    if (disposed) failure('JOB_EXECUTOR_DISPOSED', '$.jobRuntime', 'Job executor has been shut down and cannot be used again.')
    if (resetting) failure('JOB_RUNTIME_RESET_IN_PROGRESS', '$.jobRuntime', 'Job runtime mutation is disabled while reset is publishing.')
    assertNotStarting()
    validTime(simulationMs); if (latestTime !== null && simulationMs < latestTime) failure('SIMULATION_CLOCK_DECREASED', '$.simulationMs', 'Simulation time must be globally nondecreasing.')
    const project = validateWorkcellProjectV5(dependencies.readProject())
    const job = project.jobs.find((candidate) => candidate.id === jobId)
    if (job === undefined) failure('ROBOT_JOB_NOT_FOUND', `$.jobs.${jobId}`, `Robot Job ${jobId} does not exist.`)
    const jobRuntime = dependencies.jobs.getState()
    const robotRuntime = dependencies.robots.getState()
    const signalRuntime = dependencies.signals.getState()
    if (jobRuntime.projectRevisionId !== project.revisionId || robotRuntime.projectRevisionId !== project.revisionId || signalRuntime.projectRevisionId !== project.revisionId || jobRuntime.configRevision === null || jobRuntime.configRevision !== robotRuntime.configRevision || jobRuntime.configRevision !== signalRuntime.configRevision) failure('JOB_RUNTIME_PROJECT_MISMATCH', '$.jobRuntime', 'Job runtime does not match the active Project configuration.')
    const robot = dependencies.robots.getState().readRobot(job.robotId)
    if (robot === null) failure('ROBOT_INSTANCE_NOT_FOUND', `$.robots.${job.robotId}`, `Robot ${job.robotId} is not published.`)
    if (robot.jointSource !== 'simulation') failure('ROBOT_JOINT_SOURCE_NOT_SIMULATION', `$.robots.${job.robotId}.jointSource`, 'A Simulation Job requires a Simulation-owned Robot.')
    const definition = project.robotDefinitions.find((candidate) => candidate.id === robot.definitionId)
    if (definition === undefined) failure('ROBOT_DEFINITION_NOT_FOUND', `$.robots.${job.robotId}.definitionId`, 'Robot Definition is unavailable.')
    const runId = dependencies.createRunId()
    if (typeof runId !== 'string' || runId.length === 0) failure('JOB_RUN_ID_INVALID', '$.runId', 'Run ID must be a non-empty string.')
    if (knownRunIds.has(runId) || reservedRunIds.has(runId)) failure('JOB_RUN_ID_DUPLICATE', '$.runId', `Run ID ${runId} was already issued.`)
    const session: Session = { robotId: job.robotId, jobId: job.id, runId, startedAtSimulationMs: simulationMs, instructions: job.instructions, definition, cursor: 0, lastMove: null, readyAtSimulationMs: null, active: null, segment: null, lastSimulationMs: simulationMs }
    const prior = sessions.get(job.robotId)
    const priorState = dependencies.jobs.getState().byRobotId[job.robotId]!
    reservedRunIds.add(runId); starting = true; sessions.set(session.robotId, session)
    try {
      dependencies.jobs.getState().setRobotState({ robotId: session.robotId, jobId: session.jobId, runId: session.runId, state: 'RUNNING', stepIndex: 0, startedAtSimulationMs: session.startedAtSimulationMs, completedAtSimulationMs: null, failureCode: null, message: '' })
      reservedRunIds.delete(runId); knownRunIds.add(runId)
      if (prior !== undefined) terminateDetached(prior, 'Replaced by new Job')
      latestTime = simulationMs
      return Object.freeze({ runId: session.runId })
    } catch (error) {
      reservedRunIds.delete(runId)
      if (sessions.get(session.robotId) === session) {
        if (prior === undefined) sessions.delete(session.robotId)
        else sessions.set(session.robotId, prior)
      }
      const published = dependencies.jobs.getState().byRobotId[session.robotId]
      if (published?.runId === session.runId) {
        try {
          const current = dependencies.jobs.getState()
          dependencies.jobs.setState({ ...current, byRobotId: Object.freeze({ ...current.byRobotId, [session.robotId]: priorState }) }, true)
        } catch { /* preserve original publication error after best-effort direct rollback */ }
      }
      throw error
    } finally {
      starting = false
      if (requestedShutdownReason !== null) {
        const reason = requestedShutdownReason
        const reportError = requestedShutdownErrorHandler
        requestedShutdownReason = null
        requestedShutdownErrorHandler = null
        try {
          finishShutdown(reason, preflightReset())
        } catch (error) {
          try { reportError?.(error) } catch { /* disposal diagnostics are isolated from Job publication */ }
        }
      }
    }
  }
  const advanceRobot = async (robotId: string, simulationMs: number): Promise<void> => {
    assertNotStarting()
    if (disposed) return
    if (resetting) failure('JOB_RUNTIME_RESET_IN_PROGRESS', '$.jobRuntime', 'Job runtime mutation is disabled while reset is publishing.')
    acceptSimulationTime(simulationMs)
    const session = sessions.get(robotId)
    if (session !== undefined) await enqueue(session, simulationMs)
  }
  const advanceAll = async (simulationMs: number): Promise<void> => {
    assertNotStarting()
    if (disposed) return
    if (resetting) failure('JOB_RUNTIME_RESET_IN_PROGRESS', '$.jobRuntime', 'Job runtime mutation is disabled while reset is publishing.')
    acceptSimulationTime(simulationMs)
    await Promise.all([...sessions.values()].map((session) => enqueue(session, simulationMs)))
  }
  const cancelJob = (robotId?: string, reason = 'Cancelled'): void => {
    assertNotStarting()
    if (robotId !== undefined) { cancelRobotJob(robotId, reason); return }
    for (const id of Array.from(sessions.keys())) cancelRobotJob(id, reason)
  }
  const readState = (robotId: string): RobotJobRuntimeStateV5 => {
    const states = dependencies.jobs.getState().byRobotId
    const state = Object.hasOwn(states, robotId) ? states[robotId] : undefined
    if (state === undefined) failure('ROBOT_INSTANCE_NOT_FOUND', `$.robots.${robotId}`, `Robot ${robotId} is not published.`)
    return state
  }
  const waitForTerminal = (runId: string): Promise<RobotJobTerminalResultV5> => {
    const result = terminal.get(runId); if (result !== undefined) return Promise.resolve(result)
    if (!knownRunIds.has(runId)) return Promise.reject(new Error(`Unknown Job run ${runId}.`))
    return new Promise<RobotJobTerminalResultV5>((resolve) => { const entries = waiters.get(runId) ?? []; entries.push(resolve); waiters.set(runId, entries) })
  }
  const preflightReset = (): { readonly project: WorkcellProjectV5; readonly configRevision: string } | null => {
    const configRevision = dependencies.jobs.getState().configRevision
    return configRevision === null ? null : { project: validateWorkcellProjectV5(dependencies.readProject()), configRevision }
  }
  const finishShutdown = (
    reason: string,
    preparedReset: { readonly project: WorkcellProjectV5; readonly configRevision: string } | null,
  ): void => {
    resetting = true
    try {
      for (const session of Array.from(sessions.values())) settleForTeardown(session, reason)
      if (preparedReset !== null) dependencies.jobs.getState().reset(preparedReset.project, preparedReset.configRevision)
      latestTime = null
    } finally { resetting = false; subscription() }
  }
  const reset = (): void => {
    assertNotStarting()
    if (disposed || resetting) return
    const preparedReset = preflightReset()
    resetting = true
    try {
      for (const session of Array.from(sessions.values())) settleForTeardown(session, 'Job runtime reset.')
      if (preparedReset !== null) dependencies.jobs.getState().reset(preparedReset.project, preparedReset.configRevision)
      latestTime = null
    } finally { resetting = false }
  }
  const shutdown = (reason: string = 'Job executor shut down.'): void => {
    assertNotStarting()
    if (disposed) return
    const preparedReset = preflightReset()
    disposed = true
    finishShutdown(reason, preparedReset)
  }

  const requestShutdown = (
    reason: string = 'Job executor shut down.',
    onDeferredShutdownError?: (error: unknown) => void,
  ): void => {
    if (disposed) return
    if (starting) {
      // Graph disposal can be requested by a subscriber during the synchronous
      // start publication. Fence the executor now, then preserve that start
      // transaction until its publication unwinds.
      disposed = true
      requestedShutdownReason = reason
      requestedShutdownErrorHandler = onDeferredShutdownError ?? null
      return
    }
    const preparedReset = preflightReset()
    disposed = true
    finishShutdown(reason, preparedReset)
  }

  return Object.freeze({ startJob, advanceRobot, advanceAll, cancelRobotJob, cancelJob, readState, waitForTerminal, reset, shutdown, requestShutdown })
}
