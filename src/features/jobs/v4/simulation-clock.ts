import type { RobotIdV4, RobotJobIdV4 } from '../../../core/project-v4/index.js'
import type { StoreApi } from 'zustand/vanilla'
import type { RobotJobExecutorV4 } from './job-executor.js'
import type { JobRuntimeStoreV4 } from './job-runtime-store.js'

export interface AnimationFrameSchedulerV4 {
  now(): number
  request(callback: (simulationMs: number) => void): number
  cancel(handle: number): void
}

export interface RobotJobPlaybackControllerV4 {
  startJob(jobId: RobotJobIdV4): { readonly runId: string }
  cancelRobotJob(robotId: RobotIdV4, reason: string): void
  ensureRunning(): void
  quiesce(): Promise<void>
  resume(): void
  dispose(): void
}

export interface RobotJobPlaybackControllerOptionsV4 {
  readonly executor: RobotJobExecutorV4
  readonly jobs: StoreApi<JobRuntimeStoreV4>
  readonly scheduler: AnimationFrameSchedulerV4
  readonly onError: (error: unknown) => void
}

export function createRobotJobPlaybackControllerV4(
  options: RobotJobPlaybackControllerOptionsV4,
): RobotJobPlaybackControllerV4 {
  let disposed = false
  let quiesced = false
  let scheduledHandle: number | null = null
  let scheduleGeneration = 0
  let inFlight: Promise<void> | null = null
  let lastIssuedSimulationMs: number | null = null

  const nondecreasingSimulationMs = (candidate: number): number => (
    lastIssuedSimulationMs === null
      ? candidate
      : Math.max(lastIssuedSimulationMs, candidate)
  )

  const hasRunningRobot = (): boolean => Object.values(
    options.jobs.getState().byRobotId,
  ).some((state) => state.state === 'RUNNING')

  const cancelScheduled = (): void => {
    scheduleGeneration += 1
    if (scheduledHandle === null) return
    const handle = scheduledHandle
    scheduledHandle = null
    options.scheduler.cancel(handle)
  }

  const notifyError = (error: unknown): void => {
    if (disposed) return
    try {
      options.onError(error)
    } catch {
      // Error notification is an injected UI boundary and must not reject the clock chain.
    }
  }

  const ensureRunning = (): void => {
    if (
      disposed
      || quiesced
      || scheduledHandle !== null
      || inFlight !== null
      || !hasRunningRobot()
    ) return
    const generation = ++scheduleGeneration
    let handle = -1
    handle = options.scheduler.request((simulationMs) => {
      if (disposed || generation !== scheduleGeneration || scheduledHandle !== handle) return
      scheduledHandle = null
      let advancing: Promise<void>
      try {
        const issuedSimulationMs = nondecreasingSimulationMs(simulationMs)
        advancing = Promise.resolve(options.executor.advanceAll(issuedSimulationMs))
        lastIssuedSimulationMs = issuedSimulationMs
      } catch (error) {
        advancing = Promise.reject(error)
      }
      inFlight = advancing
      void advancing.then(
        () => {
          if (inFlight === advancing) inFlight = null
          if (!disposed) ensureRunning()
        },
        (error: unknown) => {
          if (inFlight === advancing) inFlight = null
          notifyError(error)
        },
      )
    })
    scheduledHandle = handle
  }

  const controller: RobotJobPlaybackControllerV4 = {
    startJob(jobId) {
      if (disposed) throw new Error('Robot Job playback controller is disposed.')
      const simulationMs = nondecreasingSimulationMs(options.scheduler.now())
      const started = options.executor.startJob(jobId, simulationMs)
      lastIssuedSimulationMs = simulationMs
      ensureRunning()
      return started
    },

    cancelRobotJob(robotId, reason) {
      if (disposed) return
      options.executor.cancelRobotJob(robotId, reason)
      if (!hasRunningRobot()) cancelScheduled()
    },

    ensureRunning,

    quiesce() {
      if (disposed) return Promise.resolve()
      quiesced = true
      cancelScheduled()
      const pending = inFlight
      return pending === null
        ? Promise.resolve()
        : pending.then(() => undefined, () => undefined)
    },

    resume() {
      if (disposed) return
      quiesced = false
      ensureRunning()
    },

    dispose() {
      if (disposed) return
      disposed = true
      quiesced = true
      cancelScheduled()
    },
  }

  return Object.freeze(controller)
}
