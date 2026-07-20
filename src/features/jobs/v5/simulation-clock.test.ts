import { describe, expect, it } from 'vitest'

import { createRobotJobPlaybackControllerV5 } from './simulation-clock.js'

describe('RobotJobPlaybackControllerV5', () => {
  it('rejects a stale animation timestamp by retaining the last issued Simulation time', async () => {
    const callbacks: Array<(time: number) => void> = []
    const states = { byRobotId: { robot: { state: 'RUNNING' as const } } }
    const executor = {
      startJob: () => ({ runId: 'run' }), advanceRobot: async (_robotId: string, time: number) => { seen.push(time) }, advanceAll: async () => undefined,
      cancelRobotJob() {}, cancelJob() {}, readState() { throw new Error('unused') }, waitForTerminal() { return Promise.reject(new Error('unused')) }, reset() {}, shutdown() {},
    }
    const seen: number[] = []
    const clock = createRobotJobPlaybackControllerV5({
      executor, jobs: { getState: () => states } as never,
      scheduler: { now: () => 100, request: (callback) => { callbacks.push(callback); return callbacks.length }, cancel() {} },
      onError() {},
    })
    clock.startJob('job')
    callbacks.shift()!(99)
    await Promise.resolve()
    await Promise.resolve()
    expect(seen).toEqual([100])
  })

  it('serializes and coalesces async ticks per Robot and ignores disposed callbacks', async () => {
    const pending = new Map<number, (time: number) => void>()
    let next = 1
    let resolveAdvance!: () => void
    const advance = new Promise<void>((resolve) => { resolveAdvance = resolve })
    const calls: number[] = []
    const states = { byRobotId: { robot: { state: 'RUNNING' as const } } }
    const controller = createRobotJobPlaybackControllerV5({
      executor: {
        startJob: () => ({ runId: 'run' }), advanceRobot: (_robotId: string, time: number) => { calls.push(time); return advance }, advanceAll: async () => undefined,
        cancelRobotJob() {}, cancelJob() {}, readState() { throw new Error('unused') }, waitForTerminal() { return Promise.reject(new Error('unused')) }, reset() {}, shutdown() {},
      },
      jobs: { getState: () => states } as never,
      scheduler: {
        now: () => 0, request: (callback) => { const handle = next++; pending.set(handle, callback); return handle },
        cancel: (handle) => { pending.delete(handle) },
      }, onError() {},
    })
    controller.startJob('job')
    const first = pending.entries().next().value as readonly [number, (time: number) => void]
    pending.delete(first[0]); first[1](1.25)
    await Promise.resolve()
    controller.ensureRunning()
    expect(calls).toEqual([1.25])
    expect(pending.size).toBe(1)
    const latest = pending.entries().next().value as readonly [number, (time: number) => void]
    pending.delete(latest[0]); latest[1](2.5)
    expect(calls).toEqual([1.25])
    resolveAdvance()
    await Promise.resolve(); await Promise.resolve()
    expect(calls).toEqual([1.25, 2.5])
    const stale = pending.entries().next().value as readonly [number, (time: number) => void]
    controller.dispose()
    stale[1](2.5)
    await Promise.resolve()
    expect(calls).toEqual([1.25, 2.5])
  })

  it('suppresses an in-flight rejection after disposal', async () => {
    const pending = new Map<number, (time: number) => void>()
    let rejectAdvance!: (error: unknown) => void
    const advance = new Promise<void>((_resolve, reject) => { rejectAdvance = reject })
    const errors: unknown[] = []
    const controller = createRobotJobPlaybackControllerV5({
      executor: {
        startJob: () => ({ runId: 'run' }), advanceRobot: () => advance, advanceAll: async () => undefined,
        cancelRobotJob() {}, cancelJob() {}, readState() { throw new Error('unused') }, waitForTerminal() { return Promise.reject(new Error('unused')) }, reset() {}, shutdown() {},
      },
      jobs: { getState: () => ({ byRobotId: { robot: { state: 'RUNNING' as const } } }) } as never,
      scheduler: { now: () => 0, request: (callback) => { pending.set(1, callback); return 1 }, cancel: (handle) => { pending.delete(handle) } },
      onError: (error) => { errors.push(error) },
    })
    controller.startJob('job')
    const callback = pending.get(1)!
    pending.delete(1); callback(1)
    await Promise.resolve()
    controller.dispose()
    rejectAdvance(new Error('late'))
    await Promise.resolve(); await Promise.resolve()
    expect(errors).toEqual([])
  })

  it('keeps an idle Robot advancing while another is blocked and bounds a large RAF burst', async () => {
    const pendingFrames = new Map<number, (time: number) => void>()
    let nextHandle = 1
    let resolveA!: () => void
    const blockedA = new Promise<void>((resolve) => { resolveA = resolve })
    const calls = { a: [] as number[], b: [] as number[] }
    const states = { byRobotId: { a: { state: 'RUNNING' as const }, b: { state: 'RUNNING' as const } } }
    const controller = createRobotJobPlaybackControllerV5({
      executor: {
        startJob: () => ({ runId: 'run' }),
        advanceRobot: (robotId: string, time: number) => {
          calls[robotId as 'a' | 'b'].push(time)
          return robotId === 'a' && calls.a.length === 1 ? blockedA : Promise.resolve()
        },
        advanceAll: async () => undefined,
        cancelRobotJob() {}, cancelJob() {}, readState() { throw new Error('unused') }, waitForTerminal() { return Promise.reject(new Error('unused')) }, reset() {}, shutdown() {},
      },
      jobs: { getState: () => states } as never,
      scheduler: {
        now: () => 0,
        request: (callback) => { const handle = nextHandle++; pendingFrames.set(handle, callback); return handle },
        cancel: (handle) => { pendingFrames.delete(handle) },
      },
      onError() {},
    })
    controller.startJob('job')
    for (let time = 1; time <= 50; time += 1) {
      const frame = pendingFrames.entries().next().value as readonly [number, (time: number) => void]
      pendingFrames.delete(frame[0]); frame[1](time)
      await Promise.resolve(); await Promise.resolve()
    }
    expect(calls.a).toEqual([1])
    expect(calls.b.length).toBeGreaterThan(10)
    resolveA()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(calls.a).toEqual([1, 50])
    await controller.quiesce()
    expect(pendingFrames.size).toBe(0)
  })

  it('lets a replacement Robot run before the cancelled non-abortable advance settles', async () => {
    const frames = new Map<number, (time: number) => void>()
    let handle = 0
    let resolveOld!: () => void
    const oldAdvance = new Promise<void>((resolve) => { resolveOld = resolve })
    const calls: number[] = []
    const states = { byRobotId: { robot: { state: 'RUNNING' as const } } }
    const controller = createRobotJobPlaybackControllerV5({
      executor: {
        startJob: () => ({ runId: 'run' }),
        advanceRobot: (_robotId: string, time: number) => { calls.push(time); return calls.length === 1 ? oldAdvance : Promise.resolve() },
        advanceAll: async () => undefined,
        cancelRobotJob() {}, cancelJob() {}, readState() { throw new Error('unused') }, waitForTerminal() { return Promise.reject(new Error('unused')) }, reset() {}, shutdown() {},
      },
      jobs: { getState: () => states } as never,
      scheduler: { now: () => 0, request: (callback) => { handle += 1; frames.set(handle, callback); return handle }, cancel: (id) => { frames.delete(id) } },
      onError() {},
    })
    controller.startJob('old')
    let frame = frames.entries().next().value as readonly [number, (time: number) => void]
    frames.delete(frame[0]); frame[1](1)
    await Promise.resolve()
    controller.cancelRobotJob('robot', 'replace')
    controller.startJob('replacement')
    frame = frames.entries().next().value as readonly [number, (time: number) => void]
    frames.delete(frame[0]); frame[1](2)
    await Promise.resolve(); await Promise.resolve()
    expect(calls).toEqual([1, 2])
    await expect(controller.quiesce()).resolves.toBeUndefined()
    resolveOld()
    await Promise.resolve(); await Promise.resolve()
    expect(calls).toEqual([1, 2])
    controller.dispose()
  })
})
