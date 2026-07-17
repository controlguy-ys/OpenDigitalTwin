import { describe, expect, it } from 'vitest'
import type {
  RobotJobIdV4,
  RobotIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import type { RobotJobExecutorV4 } from './job-executor.js'
import { createJobRuntimeStoreV4 } from './job-runtime-store.js'
import {
  createRobotJobPlaybackControllerV4,
  type AnimationFrameSchedulerV4,
} from './simulation-clock.js'

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(reason: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function settleController(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

class FakeAnimationFrameSchedulerV4 implements AnimationFrameSchedulerV4 {
  currentTime = 0
  requestCount = 0
  cancelCount = 0
  private nextHandle = 1
  private readonly pending = new Map<number, (simulationMs: number) => void>()

  now(): number {
    return this.currentTime
  }

  request(callback: (simulationMs: number) => void): number {
    const handle = this.nextHandle++
    this.requestCount += 1
    this.pending.set(handle, callback)
    return handle
  }

  cancel(handle: number): void {
    this.cancelCount += 1
    this.pending.delete(handle)
  }

  pendingCount(): number {
    return this.pending.size
  }

  takeNextCallback(): (simulationMs: number) => void {
    const entry = this.pending.entries().next().value as
      | readonly [number, (simulationMs: number) => void]
      | undefined
    if (entry === undefined) throw new Error('No scheduled animation callback.')
    this.pending.delete(entry[0])
    return entry[1]
  }

  peekNextCallback(): (simulationMs: number) => void {
    const callback = this.pending.values().next().value as
      | ((simulationMs: number) => void)
      | undefined
    if (callback === undefined) throw new Error('No scheduled animation callback.')
    return callback
  }

  fireNext(simulationMs: number): void {
    this.takeNextCallback()(simulationMs)
  }
}

function twoRobotJobProject(): WorkcellProjectV4 {
  const source = structuredClone(makeMinimalWorkcellProjectV4())
  const firstRobot = source.robots[0]!
  return {
    ...source,
    robots: [firstRobot, { ...firstRobot, id: 'robot-2', name: 'Robot 2' }],
    jobs: [
      { id: 'job-1', name: 'Job 1', robotId: firstRobot.id, steps: [] },
      { id: 'job-2', name: 'Job 2', robotId: 'robot-2', steps: [] },
    ],
  }
}

interface FakeExecutorHarnessV4 {
  executor: RobotJobExecutorV4
  readonly starts: Array<{ readonly jobId: string; readonly simulationMs: number }>
  readonly advances: number[]
  readonly cancellations: Array<{ readonly robotId: string; readonly reason: string }>
  failStart: unknown
  advance: (simulationMs: number) => Promise<void>
  succeedRunning(simulationMs: number): void
}

function fakeExecutorHarnessV4(
  project: WorkcellProjectV4,
  jobs: ReturnType<typeof createJobRuntimeStoreV4>,
): FakeExecutorHarnessV4 {
  const starts: Array<{ readonly jobId: string; readonly simulationMs: number }> = []
  const advances: number[] = []
  const cancellations: Array<{ readonly robotId: string; readonly reason: string }> = []
  const jobOwners = Object.fromEntries(project.jobs.map((job) => [job.id, job.robotId]))
  let nextRun = 1

  const harness: FakeExecutorHarnessV4 = {
    starts,
    advances,
    cancellations,
    failStart: null,
    advance: async () => undefined,
    succeedRunning(simulationMs) {
      for (const state of Object.values(jobs.getState().byRobotId)) {
        if (state.state !== 'RUNNING') continue
        jobs.getState().setRobotState({
          ...state,
          state: 'SUCCEEDED',
          completedAtSimulationMs: simulationMs,
          failureCode: null,
        })
      }
    },
    executor: undefined as never,
  }

  harness.executor = Object.freeze({
    startJob(jobId: RobotJobIdV4, simulationMs: number) {
      if (harness.failStart !== null) throw harness.failStart
      const robotId = jobOwners[jobId]
      if (robotId === undefined) throw new Error(`Unknown Job ${jobId}`)
      const runId = `run-${nextRun++}`
      starts.push({ jobId, simulationMs })
      jobs.getState().setRobotState({
        robotId,
        jobId,
        runId,
        state: 'RUNNING',
        stepIndex: 0,
        startedAtSimulationMs: simulationMs,
        completedAtSimulationMs: null,
        failureCode: null,
        message: '',
      })
      return { runId }
    },
    async advanceAll(simulationMs: number) {
      advances.push(simulationMs)
      await harness.advance(simulationMs)
    },
    cancelRobotJob(robotId: RobotIdV4, reason: string) {
      cancellations.push({ robotId, reason })
      const state = jobs.getState().byRobotId[robotId]
      if (state?.state !== 'RUNNING') return
      jobs.getState().setRobotState({
        ...state,
        state: 'CANCELLED',
        completedAtSimulationMs: Math.max(state.startedAtSimulationMs ?? 0, 0),
        failureCode: null,
        message: reason,
      })
    },
    readState(robotId: RobotIdV4) {
      const state = jobs.getState().byRobotId[robotId]
      if (state === undefined) throw new Error(`Unknown Robot ${robotId}`)
      return state
    },
    waitForTerminal() {
      return Promise.reject(new Error('Unused fake waitForTerminal.'))
    },
    reset() {},
    shutdown() {},
  })

  return harness
}

function playbackHarness(notify?: (error: unknown) => void) {
  const project = twoRobotJobProject()
  const jobs = createJobRuntimeStoreV4()
  jobs.getState().replaceProject(project)
  const scheduler = new FakeAnimationFrameSchedulerV4()
  const fake = fakeExecutorHarnessV4(project, jobs)
  const errors: unknown[] = []
  const playback = createRobotJobPlaybackControllerV4({
    executor: fake.executor,
    jobs,
    scheduler,
    onError: (error) => {
      errors.push(error)
      notify?.(error)
    },
  })
  return { jobs, scheduler, fake, errors, playback }
}

describe('RobotJobPlaybackControllerV4', () => {
  it('quiesces a scheduled loop and resumes it only for retained running state', async () => {
    const { scheduler, playback } = playbackHarness()
    playback.startJob('job-1')
    expect(scheduler.pendingCount()).toBe(1)

    await playback.quiesce()
    playback.ensureRunning()

    expect(scheduler.cancelCount).toBe(1)
    expect(scheduler.pendingCount()).toBe(0)

    playback.resume()
    playback.resume()
    expect(scheduler.pendingCount()).toBe(1)
  })

  it('waits for the current advance to settle before quiesce resolves', async () => {
    const { scheduler, fake, playback } = playbackHarness()
    const advancing = deferred<void>()
    fake.advance = () => advancing.promise
    playback.startJob('job-1')
    scheduler.fireNext(10)

    let settled = false
    const quiesced = playback.quiesce().then(() => { settled = true })
    await settleController()
    expect(settled).toBe(false)
    expect(scheduler.pendingCount()).toBe(0)

    advancing.resolve(undefined)
    await quiesced
    expect(scheduler.pendingCount()).toBe(0)

    playback.resume()
    expect(scheduler.pendingCount()).toBe(1)
  })

  it('runs two Robots through one loop with exact nondecreasing Simulation timestamps', async () => {
    const { scheduler, fake, playback } = playbackHarness()
    scheduler.currentTime = 5
    expect(playback.startJob('job-1')).toEqual({ runId: 'run-1' })
    scheduler.currentTime = 7
    expect(playback.startJob('job-2')).toEqual({ runId: 'run-2' })
    expect(fake.starts).toEqual([
      { jobId: 'job-1', simulationMs: 5 },
      { jobId: 'job-2', simulationMs: 7 },
    ])
    expect(scheduler.pendingCount()).toBe(1)
    expect(scheduler.requestCount).toBe(1)

    scheduler.fireNext(10)
    await settleController()
    expect(fake.advances).toEqual([10])
    expect(scheduler.pendingCount()).toBe(1)

    scheduler.fireNext(10)
    await settleController()
    expect(fake.advances).toEqual([10, 10])
    expect(scheduler.pendingCount()).toBe(1)
    playback.dispose()
  })

  it('does not let the first animation-frame timestamp precede the Job start timestamp', async () => {
    const { scheduler, fake, playback } = playbackHarness()
    scheduler.currentTime = 100
    playback.startJob('job-1')

    scheduler.fireNext(99)
    await settleController()

    expect(fake.starts).toEqual([{ jobId: 'job-1', simulationMs: 100 }])
    expect(fake.advances).toEqual([100])
    playback.dispose()
  })

  it('serializes async ticks and does not queue another frame while advanceAll is pending', async () => {
    const { scheduler, fake, playback } = playbackHarness()
    const firstAdvance = deferred<void>()
    let inFlight = 0
    let maximumInFlight = 0
    fake.advance = async () => {
      inFlight += 1
      maximumInFlight = Math.max(maximumInFlight, inFlight)
      await firstAdvance.promise
      inFlight -= 1
    }
    playback.startJob('job-1')
    scheduler.fireNext(20)
    await settleController()

    playback.ensureRunning()
    playback.startJob('job-2')
    expect(fake.advances).toEqual([20])
    expect(scheduler.pendingCount()).toBe(0)

    firstAdvance.resolve()
    await settleController()
    expect(scheduler.pendingCount()).toBe(1)
    scheduler.fireNext(30)
    await settleController()
    expect(fake.advances).toEqual([20, 30])
    expect(maximumInFlight).toBe(1)
    playback.dispose()
  })

  it('stops scheduling when an advance makes every Robot terminal', async () => {
    const { scheduler, fake, playback } = playbackHarness()
    fake.advance = async (simulationMs) => fake.succeedRunning(simulationMs)
    playback.startJob('job-1')

    scheduler.fireNext(50)
    await settleController()

    expect(fake.advances).toEqual([50])
    expect(scheduler.pendingCount()).toBe(0)
    expect(scheduler.requestCount).toBe(1)
  })

  it('delegates cancellation and cancels the pending frame after the last running Robot stops', async () => {
    const { scheduler, fake, playback } = playbackHarness()
    playback.startJob('job-1')
    const staleCallback = scheduler.peekNextCallback()
    expect(scheduler.pendingCount()).toBe(1)

    playback.cancelRobotJob('robot-1', 'Operator stop')
    expect(fake.cancellations).toEqual([{ robotId: 'robot-1', reason: 'Operator stop' }])
    expect(scheduler.pendingCount()).toBe(0)
    expect(scheduler.cancelCount).toBe(1)

    staleCallback(60)
    await settleController()
    expect(fake.advances).toEqual([])
  })

  it('does not schedule when executor startJob fails', () => {
    const { scheduler, fake, errors, playback } = playbackHarness()
    const failure = new Error('Start failed')
    fake.failStart = failure

    expect(() => playback.startJob('job-1')).toThrow(failure)
    expect(scheduler.pendingCount()).toBe(0)
    expect(scheduler.requestCount).toBe(0)
    expect(errors).toEqual([])
  })

  it('reports an advanceAll rejection once and stops the loop', async () => {
    const { scheduler, fake, errors, playback } = playbackHarness()
    const failure = new Error('Advance failed')
    fake.advance = () => Promise.reject(failure)
    playback.startJob('job-1')

    scheduler.fireNext(70)
    await settleController()

    expect(errors).toEqual([failure])
    expect(scheduler.pendingCount()).toBe(0)
    expect(scheduler.requestCount).toBe(1)
  })

  it('contains a throwing error callback after notifying the first advance failure once', async () => {
    const callbackFailure = new Error('Error callback failed')
    const notifications: unknown[] = []
    const { scheduler, fake, errors, playback } = playbackHarness((error) => {
      notifications.push(error)
      throw callbackFailure
    })
    const advanceFailure = new Error('Advance failed first')
    fake.advance = () => Promise.reject(advanceFailure)
    playback.startJob('job-1')

    scheduler.fireNext(75)
    await settleController()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(errors).toEqual([advanceFailure])
    expect(notifications).toEqual([advanceFailure])
    expect(scheduler.pendingCount()).toBe(0)
    expect(scheduler.requestCount).toBe(1)

    playback.dispose()
    playback.ensureRunning()
    await settleController()
    expect(notifications).toHaveLength(1)
    expect(scheduler.requestCount).toBe(1)
  })

  it('disposes idempotently and ignores a cancelled callback after disposal', async () => {
    const { scheduler, fake, playback } = playbackHarness()
    playback.startJob('job-1')
    const staleCallback = scheduler.peekNextCallback()

    playback.dispose()
    playback.dispose()
    expect(scheduler.cancelCount).toBe(1)
    expect(scheduler.pendingCount()).toBe(0)

    staleCallback(80)
    playback.ensureRunning()
    await settleController()
    expect(fake.advances).toEqual([])
    expect(scheduler.requestCount).toBe(1)
    expect(() => playback.startJob('job-2')).toThrow(/disposed/i)
  })

  it('suppresses post-dispose error and scheduling callbacks from an in-flight tick', async () => {
    const { scheduler, fake, errors, playback } = playbackHarness()
    const pendingAdvance = deferred<void>()
    fake.advance = () => pendingAdvance.promise
    playback.startJob('job-1')
    scheduler.fireNext(90)
    await settleController()
    expect(fake.advances).toEqual([90])

    playback.dispose()
    pendingAdvance.reject(new Error('Late failure'))
    await settleController()

    expect(errors).toEqual([])
    expect(scheduler.pendingCount()).toBe(0)
  })
})
