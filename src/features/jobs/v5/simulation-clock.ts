import type { StoreApi } from 'zustand/vanilla'
import type { JobRuntimeStoreV5 } from './job-runtime-store.js'
import type { RobotJobExecutorV5 } from './job-executor.js'

export interface AnimationFrameSchedulerV5 {
  now(): number
  request(callback: (simulationMs: number) => void): number
  cancel(handle: number): void
}
export interface RobotJobPlaybackControllerV5 {
  startJob(jobId: string): { readonly runId: string }
  cancelRobotJob(robotId: string, reason: string): void
  ensureRunning(): void
  quiesce(): Promise<void>
  resume(): void
  dispose(): void
}
export interface RobotJobPlaybackControllerOptionsV5 {
  readonly executor: RobotJobExecutorV5
  readonly jobs: StoreApi<JobRuntimeStoreV5>
  readonly scheduler: AnimationFrameSchedulerV5
  readonly onError: (error: unknown) => void
}

export function createRobotJobPlaybackControllerV5(options: RobotJobPlaybackControllerOptionsV5): RobotJobPlaybackControllerV5 {
  let disposed = false
  let quiesced = false
  let handle: number | null = null
  let generation = 0
  let last: number | null = null
  const advances = new Map<string, { active: Promise<void> | null; latest: number | null }>()
  const activeAdvances = new Set<Promise<void>>()
  const time = (value: number): number => last === null ? value : Math.max(last, value)
  const runningRobotIds = (): readonly string[] => Object.entries(options.jobs.getState().byRobotId)
    .filter(([, state]) => state.state === 'RUNNING')
    .map(([robotId]) => robotId)
  const running = (): boolean => runningRobotIds().length > 0
  const cancel = (): void => {
    generation += 1
    if (handle === null) return
    options.scheduler.cancel(handle); handle = null
  }
  const report = (error: unknown): void => { if (!disposed) { try { options.onError(error) } catch { /* UI boundary */ } } }
  const invalidateSlot = (robotId: string): void => {
    const slot = advances.get(robotId)
    if (slot === undefined) return
    slot.latest = null
    if (slot.active !== null) activeAdvances.delete(slot.active)
    if (advances.get(robotId) === slot) advances.delete(robotId)
  }
  const launch = (robotId: string, simulationMs: number): void => {
    if (disposed || quiesced) return
    const slot = advances.get(robotId) ?? { active: null, latest: null }
    advances.set(robotId, slot)
    if (slot.active !== null) {
      slot.latest = slot.latest === null ? simulationMs : Math.max(slot.latest, simulationMs)
      return
    }
    let active: Promise<void>
    try { active = Promise.resolve(options.executor.advanceRobot(robotId, simulationMs)) } catch (error) { active = Promise.reject(error) }
    slot.active = active
    activeAdvances.add(active)
    void active.then(
      () => {
        activeAdvances.delete(active)
        if (advances.get(robotId) !== slot || slot.active !== active) return
        slot.active = null
        if (disposed || quiesced) { slot.latest = null; advances.delete(robotId); return }
        const latest = slot.latest
        slot.latest = null
        if (latest !== null && options.jobs.getState().byRobotId[robotId]?.state === 'RUNNING') launch(robotId, latest)
        else advances.delete(robotId)
        ensureRunning()
      },
      (error: unknown) => {
        activeAdvances.delete(active)
        if (advances.get(robotId) !== slot || slot.active !== active) return
        slot.active = null; slot.latest = null; advances.delete(robotId)
        report(error); ensureRunning()
      },
    )
  }
  const ensureRunning = (): void => {
    if (disposed || quiesced || handle !== null || !running()) return
    const current = ++generation
    let nextHandle = -1
    nextHandle = options.scheduler.request((candidate) => {
      if (disposed || current !== generation || handle !== nextHandle) return
      handle = null
      const simulationMs = time(candidate)
      last = simulationMs
      for (const robotId of runningRobotIds()) launch(robotId, simulationMs)
      ensureRunning()
    })
    handle = nextHandle
  }
  return Object.freeze({
    startJob(jobId: string) {
      if (disposed) throw new Error('Robot Job playback controller is disposed.')
      const simulationMs = time(options.scheduler.now())
      const started = options.executor.startJob(jobId, simulationMs)
      const robotId = Object.entries(options.jobs.getState().byRobotId).find(([, state]) => state.runId === started.runId)?.[0]
      if (robotId !== undefined) invalidateSlot(robotId)
      last = simulationMs; ensureRunning(); return started
    },
    cancelRobotJob(robotId: string, reason: string) {
      if (disposed) return
      options.executor.cancelRobotJob(robotId, reason)
      invalidateSlot(robotId)
      if (!running()) cancel()
    },
    ensureRunning,
    quiesce() {
      if (disposed) return Promise.resolve()
      quiesced = true; cancel()
      for (const slot of advances.values()) slot.latest = null
      return Promise.allSettled(activeAdvances).then(() => undefined)
    },
    resume() { if (!disposed) { quiesced = false; ensureRunning() } },
    dispose() { if (!disposed) { disposed = true; quiesced = true; cancel(); for (const slot of advances.values()) slot.latest = null; activeAdvances.clear() } },
  })
}
