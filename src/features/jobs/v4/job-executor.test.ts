import { describe, expect, it } from 'vitest'
import {
  ProjectV4Error,
  type RobotActionDefinitionV4,
  type RobotDefinitionV4,
  type RobotJobStepV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import {
  createRobotJobExecutorV4,
  unavailableJobActionExecutionPortV4,
  type JobActionExecutionContextV4,
  type JobActionExecutionPortV4,
  type RobotJobExecutorV4,
} from './job-executor.js'
import { createJobRuntimeStoreV4 } from './job-runtime-store.js'

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T | PromiseLike<T>): void
  reject(reason?: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function renameSingleJoint(
  definition: RobotDefinitionV4,
  id: string,
  type: 'revolute' | 'prismatic',
  min: number,
  max: number,
  maximumVelocity: number,
): RobotDefinitionV4 {
  const original = definition.joints[0]!
  return {
    ...definition,
    joints: [{
      ...original,
      id,
      type,
      min,
      max,
      home: 0,
      maximumVelocity,
    }],
  }
}

function pose(jointId: string, value: number, speedPercentToNext = 100): RobotJobStepV4 {
  return {
    kind: 'joint-pose',
    jointValues: { [jointId]: value },
    speedPercentToNext,
  }
}

function action(actionId: string): RobotJobStepV4 {
  return { kind: 'action-reference', actionId }
}

interface JobFixture {
  readonly id: string
  readonly robotId: 'robot-A' | 'robot-B'
  readonly steps: readonly RobotJobStepV4[]
}

function projectForJobs(
  jobs: readonly JobFixture[],
  actions: readonly RobotActionDefinitionV4[] = [],
): WorkcellProjectV4 {
  const source = structuredClone(makeMinimalWorkcellProjectV4())
  const definitionA = renameSingleJoint(
    { ...source.robotDefinitions[0]!, id: 'definition-A', name: 'Robot A' },
    'axis.A',
    'revolute',
    -200,
    200,
    20,
  )
  const definitionB = renameSingleJoint(
    { ...source.robotDefinitions[0]!, id: 'definition-B', name: 'Robot B' },
    'slide:B',
    'prismatic',
    -1,
    1,
    0.2,
  )
  const sourceRobot = source.robots[0]!
  return {
    ...source,
    robotDefinitions: [definitionA, definitionB],
    robots: [
      {
        ...sourceRobot,
        id: 'robot-A',
        name: 'Robot A',
        definitionId: definitionA.id,
        initialJointValues: { 'axis.A': 33 },
      },
      {
        ...sourceRobot,
        id: 'robot-B',
        name: 'Robot B',
        definitionId: definitionB.id,
        initialJointValues: { 'slide:B': -0.5 },
      },
    ],
    jobs: jobs.map((job) => ({ ...job, name: job.id })),
    actions: [...actions],
  }
}

function robotAction(id: string, robotId: 'robot-A' | 'robot-B'): RobotActionDefinitionV4 {
  return { id, kind: 'set-gripper-state', robotId, state: 'OPEN' }
}

interface Harness {
  readonly project: WorkcellProjectV4
  readonly robots: ReturnType<typeof createRobotRuntimeRegistryV4>
  readonly jobs: ReturnType<typeof createJobRuntimeStoreV4>
  readonly executor: RobotJobExecutorV4
}

function harness(
  project: WorkcellProjectV4,
  actionPort: JobActionExecutionPortV4 = { execute: async () => undefined },
  runIds: readonly string[] = ['run-1', 'run-2', 'run-3', 'run-4'],
): Harness {
  const robots = createRobotRuntimeRegistryV4()
  const jobs = createJobRuntimeStoreV4()
  robots.getState().replaceProject(project)
  jobs.getState().replaceProject(project)
  let runIndex = 0
  const executor = createRobotJobExecutorV4({
    readProject: () => project,
    robots,
    jobs,
    actionPort,
    createRunId: () => runIds[runIndex++] ?? `run-${runIndex}`,
  })
  return { project, robots, jobs, executor }
}

function expectProjectError(action: () => unknown, code: string): void {
  let error: unknown
  try {
    action()
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(ProjectV4Error)
  expect((error as ProjectV4Error).code).toBe(code)
}

describe('RobotJobExecutorV4', () => {
  it('succeeds an empty Job on its first advance and reuses one terminal result', async () => {
    const { executor } = harness(projectForJobs([{ id: 'empty', robotId: 'robot-A', steps: [] }]))
    const { runId } = executor.startJob('empty', 0)
    const waiting = executor.waitForTerminal(runId)
    const secondWaiting = executor.waitForTerminal(runId)

    await executor.advanceAll(25)

    const before = await waiting
    const concurrent = await secondWaiting
    const after = await executor.waitForTerminal(runId)
    expect(before).toBe(concurrent)
    expect(before).toBe(after)
    expect(before).toMatchObject({
      robotId: 'robot-A',
      jobId: 'empty',
      runId,
      state: 'SUCCEEDED',
      completedAtSimulationMs: 25,
    })
    expect(Object.isFrozen(before)).toBe(true)
  })

  it('does not apply the first Pose before advance, then snaps and succeeds', async () => {
    const project = projectForJobs([{ id: 'single', robotId: 'robot-A', steps: [pose('axis.A', 10)] }])
    const { executor, robots } = harness(project)
    executor.startJob('single', 0)

    expect(robots.getState().robots['robot-A']?.jointValues).toEqual({ 'axis.A': 33 })
    await executor.advanceAll(100)

    expect(robots.getState().robots['robot-A']?.jointValues).toEqual({ 'axis.A': 10 })
    expect(executor.readState('robot-A').state).toBe('SUCCEEDED')
  })

  it('uses the reached Pose speed for limit-safe wrapped transitions', async () => {
    const project = projectForJobs([{
      id: 'wrap',
      robotId: 'robot-A',
      steps: [pose('axis.A', 170, 100), pose('axis.A', -170)],
    }])
    const { executor, robots } = harness(project)
    executor.startJob('wrap', 0)

    await executor.advanceAll(0)
    expect(robots.getState().robots['robot-A']?.jointValues).toEqual({ 'axis.A': 170 })
    await executor.advanceAll(500)
    expect(robots.getState().robots['robot-A']?.jointValues).toEqual({ 'axis.A': 180 })
    await executor.advanceAll(1_000)
    expect(robots.getState().robots['robot-A']?.jointValues).toEqual({ 'axis.A': -170 })
    expect(executor.readState('robot-A').state).toBe('SUCCEEDED')
  })

  it('interpolates prismatic motion at speed 100 and speed 1', async () => {
    const project = projectForJobs([
      { id: 'fast', robotId: 'robot-B', steps: [pose('slide:B', 0, 100), pose('slide:B', 0.4)] },
      { id: 'slow', robotId: 'robot-B', steps: [pose('slide:B', 0, 1), pose('slide:B', 0.4)] },
    ])
    const { executor, robots } = harness(project)
    executor.startJob('fast', 0)
    await executor.advanceAll(0)
    await executor.advanceAll(1_000)
    expect(robots.getState().robots['robot-B']?.jointValues['slide:B']).toBeCloseTo(0.2)
    await executor.advanceAll(2_000)
    expect(executor.readState('robot-B').state).toBe('SUCCEEDED')

    executor.startJob('slow', 2_000)
    await executor.advanceAll(2_000)
    await executor.advanceAll(3_000)
    expect(robots.getState().robots['robot-B']?.jointValues['slide:B']).toBeCloseTo(0.002)
  })

  it('completes zero-duration Pose boundaries in one advancement', async () => {
    const project = projectForJobs([{
      id: 'zero',
      robotId: 'robot-A',
      steps: [pose('axis.A', 5), pose('axis.A', 5), pose('axis.A', 5)],
    }])
    const { executor, robots } = harness(project)
    executor.startJob('zero', 10)

    await executor.advanceAll(10)

    expect(robots.getState().robots['robot-A']?.jointValues).toEqual({ 'axis.A': 5 })
    expect(executor.readState('robot-A').state).toBe('SUCCEEDED')
  })

  it('executes Action-first ordering and preserves the earlier Pose speed across Actions', async () => {
    const calls: Array<{ readonly actionId: string; readonly joint: number }> = []
    let robotsForAction: ReturnType<typeof createRobotRuntimeRegistryV4> | undefined
    const actionPort: JobActionExecutionPortV4 = {
      execute: async (actionId) => {
        calls.push({
          actionId,
          joint: robotsForAction!.getState().robots['robot-A']!.jointValues['axis.A']!,
        })
      },
    }
    const actions = [robotAction('before', 'robot-A'), robotAction('between', 'robot-A')]
    const project = projectForJobs([
      {
        id: 'action-first',
        robotId: 'robot-A',
        steps: [action('before'), pose('axis.A', 10)],
      },
      {
        id: 'action-between',
        robotId: 'robot-A',
        steps: [pose('axis.A', 0, 50), action('between'), pose('axis.A', 20)],
      },
    ], actions)
    const first = harness(project, actionPort)
    robotsForAction = first.robots
    first.executor.startJob('action-first', 0)
    await first.executor.advanceAll(10)
    expect(calls[0]).toEqual({ actionId: 'before', joint: 33 })
    expect(first.robots.getState().robots['robot-A']?.jointValues).toEqual({ 'axis.A': 10 })

    first.executor.startJob('action-between', 10)
    await first.executor.advanceAll(10)
    expect(calls[1]).toEqual({ actionId: 'between', joint: 0 })
    await first.executor.advanceAll(510)
    expect(first.robots.getState().robots['robot-A']?.jointValues['axis.A']).toBeCloseTo(5)
  })

  it('fails unavailable Actions without writing later Poses and preserves failure terminal data', async () => {
    const project = projectForJobs([{
      id: 'unavailable',
      robotId: 'robot-A',
      steps: [action('missing-port'), pose('axis.A', 99)],
    }], [robotAction('missing-port', 'robot-A')])
    const { executor, robots } = harness(project, unavailableJobActionExecutionPortV4)
    const { runId } = executor.startJob('unavailable', 0)
    const waiting = executor.waitForTerminal(runId)

    await executor.advanceAll(1)

    const before = await waiting
    const after = await executor.waitForTerminal(runId)
    expect(before).toBe(after)
    expect(before).toMatchObject({ state: 'FAILED', failureCode: 'ACTION_EXECUTOR_UNAVAILABLE' })
    expect(robots.getState().robots['robot-A']?.jointValues).toEqual({ 'axis.A': 33 })
  })

  it('serializes overlapping advances so one in-flight Action executes exactly once', async () => {
    const gate = deferred<void>()
    const calls: JobActionExecutionContextV4[] = []
    const project = projectForJobs([{
      id: 'deferred', robotId: 'robot-A', steps: [action('hold')],
    }], [robotAction('hold', 'robot-A')])
    const { executor } = harness(project, {
      execute: async (_actionId, context) => {
        calls.push(context)
        await gate.promise
      },
    })
    executor.startJob('deferred', 0)

    const firstAdvance = executor.advanceAll(1)
    await Promise.resolve()
    const secondAdvance = executor.advanceAll(2)
    await Promise.resolve()
    expect(calls).toHaveLength(1)

    gate.resolve(undefined)
    await Promise.all([firstAdvance, secondAdvance])
    expect(calls).toHaveLength(1)
    expect(executor.readState('robot-A').state).toBe('SUCCEEDED')
  })

  it('runs different Robots independently and rejects a second Job on one Robot', async () => {
    const gate = deferred<void>()
    const project = projectForJobs([
      { id: 'robot-a-hold', robotId: 'robot-A', steps: [action('hold-a')] },
      { id: 'robot-a-second', robotId: 'robot-A', steps: [] },
      {
        id: 'robot-b-pose',
        robotId: 'robot-B',
        steps: [pose('slide:B', 0, 100), pose('slide:B', 0.4)],
      },
    ], [robotAction('hold-a', 'robot-A')])
    const { executor, robots } = harness(project, {
      execute: async () => gate.promise,
    })
    executor.startJob('robot-a-hold', 0)
    executor.startJob('robot-b-pose', 0)
    expectProjectError(
      () => executor.startJob('robot-a-second', 0),
      'ROBOT_JOB_ALREADY_RUNNING',
    )

    const advancing = executor.advanceAll(10)
    await Promise.resolve()
    await Promise.resolve()
    const overlapping = executor.advanceAll(20)
    await Promise.resolve()
    await Promise.resolve()

    expect(executor.readState('robot-A').state).toBe('RUNNING')
    expect(executor.readState('robot-B').state).toBe('RUNNING')
    expect(robots.getState().robots['robot-B']?.jointValues['slide:B']).toBeGreaterThan(0)
    gate.resolve(undefined)
    await Promise.all([advancing, overlapping])
  })

  it('establishes one global clock even with no active session', async () => {
    const project = projectForJobs([{ id: 'later', robotId: 'robot-B', steps: [] }])
    const { executor } = harness(project)

    await executor.advanceAll(100)

    expectProjectError(() => executor.startJob('later', 99), 'SIMULATION_CLOCK_DECREASED')
    executor.startJob('later', 100)
    expect(executor.readState('robot-B').state).toBe('RUNNING')
  })

  it('rejects decreasing and non-finite clocks before any state, Joint, or Action change', async () => {
    let actionCalls = 0
    const project = projectForJobs([{
      id: 'clock', robotId: 'robot-A', steps: [action('clock-action')],
    }], [robotAction('clock-action', 'robot-A')])
    const { executor, robots, jobs } = harness(project, {
      execute: async () => { actionCalls += 1 },
    })
    executor.startJob('clock', 10)
    const jobBefore = jobs.getState()
    const robotBefore = robots.getState()

    await expect(executor.advanceAll(9)).rejects.toMatchObject({ code: 'SIMULATION_CLOCK_DECREASED' })
    await expect(executor.advanceAll(Number.NaN)).rejects.toMatchObject({ code: 'SIMULATION_TIME_INVALID' })
    expect(() => executor.startJob('clock', Number.POSITIVE_INFINITY)).toThrowError(ProjectV4Error)

    expect(jobs.getState()).toBe(jobBefore)
    expect(robots.getState()).toBe(robotBefore)
    expect(actionCalls).toBe(0)

    await executor.advanceAll(10)
    expect(actionCalls).toBe(1)
  })

  it('cancels idempotently and ignores a late Action completion without touching another Robot', async () => {
    const gate = deferred<void>()
    const project = projectForJobs([
      { id: 'cancel-a', robotId: 'robot-A', steps: [action('hold-a'), pose('axis.A', 100)] },
      { id: 'new-a', robotId: 'robot-A', steps: [] },
      { id: 'idle-b', robotId: 'robot-B', steps: [] },
    ], [robotAction('hold-a', 'robot-A')])
    const { executor } = harness(project, { execute: async () => gate.promise })
    const { runId } = executor.startJob('cancel-a', 5)
    const waiter = executor.waitForTerminal(runId)
    const advancing = executor.advanceAll(10)
    await Promise.resolve()

    executor.cancelRobotJob('robot-A', 'operator cancel')
    const afterCancel = executor.readState('robot-A')
    executor.cancelRobotJob('robot-A', 'duplicate cancel')
    expect(executor.readState('robot-A')).toBe(afterCancel)
    expect(executor.readState('robot-B').state).toBe('IDLE')
    expect(await waiter).toMatchObject({
      state: 'CANCELLED',
      completedAtSimulationMs: 10,
      message: 'operator cancel',
    })

    executor.startJob('new-a', 10)
    const newState = executor.readState('robot-A')
    expect(newState).toMatchObject({ state: 'RUNNING', jobId: 'new-a' })

    gate.resolve(undefined)
    await advancing
    expect(executor.readState('robot-A')).toBe(newState)
    await executor.advanceAll(10)
    expect(executor.readState('robot-A').state).toBe('SUCCEEDED')
  })

  it('detaches a blocked old Action before a cancellation subscriber advances its replacement run', async () => {
    const oldGate = deferred<void>()
    let oldActionCalls = 0
    let newActionCalls = 0
    const project = projectForJobs([
      { id: 'old-job', robotId: 'robot-A', steps: [action('old-action')] },
      { id: 'new-job', robotId: 'robot-A', steps: [action('new-action')] },
    ], [
      robotAction('old-action', 'robot-A'),
      robotAction('new-action', 'robot-A'),
    ])
    const { executor, jobs } = harness(project, {
      execute: async (actionId) => {
        if (actionId === 'old-action') {
          oldActionCalls += 1
          await oldGate.promise
        } else {
          newActionCalls += 1
        }
      },
    }, ['old-run', 'new-run'])
    const { runId: oldRunId } = executor.startJob('old-job', 0)
    const oldWaiter = executor.waitForTerminal(oldRunId)
    const oldAdvance = executor.advanceAll(10)
    await Promise.resolve()
    expect(oldActionCalls).toBe(1)

    let replacementAdvance: Promise<void> | undefined
    let startedReplacement = false
    const unsubscribe = jobs.subscribe((state) => {
      const robot = state.byRobotId['robot-A']
      if (!startedReplacement && robot?.runId === oldRunId && robot.state === 'CANCELLED') {
        startedReplacement = true
        executor.startJob('new-job', 10)
        replacementAdvance = executor.advanceAll(10)
      }
    })

    executor.cancelRobotJob('robot-A', 'replace blocked run')
    await Promise.resolve()
    await Promise.resolve()

    expect(newActionCalls).toBe(1)
    await replacementAdvance
    expect(await oldWaiter).toMatchObject({ runId: oldRunId, state: 'CANCELLED' })
    expect(executor.readState('robot-A')).toMatchObject({
      runId: 'new-run',
      state: 'SUCCEEDED',
    })

    oldGate.resolve(undefined)
    await oldAdvance
    unsubscribe()
    expect(executor.readState('robot-A')).toMatchObject({
      runId: 'new-run',
      state: 'SUCCEEDED',
    })
  })

  it('reset settles active runs, resets the store, clears the clock, and makes late work inert', async () => {
    const gate = deferred<void>()
    const project = projectForJobs([{
      id: 'reset-a', robotId: 'robot-A', steps: [action('hold-a'), pose('axis.A', 100)],
    }], [robotAction('hold-a', 'robot-A')])
    const { executor, robots } = harness(project, { execute: async () => gate.promise })
    const { runId } = executor.startJob('reset-a', 50)
    const waiter = executor.waitForTerminal(runId)
    const advancing = executor.advanceAll(60)
    await Promise.resolve()

    executor.reset()

    expect(await waiter).toMatchObject({ state: 'CANCELLED', completedAtSimulationMs: 60 })
    expect(executor.readState('robot-A').state).toBe('IDLE')
    executor.startJob('reset-a', 1)
    expect(executor.readState('robot-A').state).toBe('RUNNING')

    gate.resolve(undefined)
    await advancing
    expect(robots.getState().robots['robot-A']?.jointValues).toEqual({ 'axis.A': 33 })
  })

  it('guards the whole reset transaction and publishes one completion time before notifications', async () => {
    const gateA = deferred<void>()
    const gateB = deferred<void>()
    const project = projectForJobs([
      { id: 'old-a', robotId: 'robot-A', steps: [action('hold-a')] },
      { id: 'old-b', robotId: 'robot-B', steps: [action('hold-b')] },
      { id: 'new-a', robotId: 'robot-A', steps: [] },
    ], [
      robotAction('hold-a', 'robot-A'),
      robotAction('hold-b', 'robot-B'),
    ])
    const { executor, jobs } = harness(project, {
      execute: async (actionId) => actionId === 'hold-a' ? gateA.promise : gateB.promise,
    }, ['old-run-a', 'old-run-b', 'new-run-a'])
    const { runId: runA } = executor.startJob('old-a', 0)
    const { runId: runB } = executor.startJob('old-b', 0)
    const waiterA = executor.waitForTerminal(runA)
    const waiterB = executor.waitForTerminal(runB)
    const oldAdvance = executor.advanceAll(10)
    await Promise.resolve()

    let attemptedStart = false
    let reentrantAdvance: Promise<void> | undefined
    let reentrantCancelCode: string | undefined
    const unsubscribe = jobs.subscribe((state) => {
      const robot = state.byRobotId['robot-A']
      if (!attemptedStart && robot?.runId === runA && robot.state === 'CANCELLED') {
        attemptedStart = true
        expectProjectError(
          () => executor.startJob('new-a', 10),
          'JOB_RUNTIME_RESET_IN_PROGRESS',
        )
        reentrantAdvance = executor.advanceAll(20)
        try {
          executor.cancelRobotJob('robot-B', 'reentrant cancel')
        } catch (error) {
          reentrantCancelCode = (error as ProjectV4Error).code
        }
      }
    })

    executor.reset()

    await expect(reentrantAdvance).rejects.toMatchObject({
      code: 'JOB_RUNTIME_RESET_IN_PROGRESS',
    })
    expect(reentrantCancelCode).toBe('JOB_RUNTIME_RESET_IN_PROGRESS')
    expect(await waiterA).toMatchObject({ state: 'CANCELLED', completedAtSimulationMs: 10 })
    expect(await waiterB).toMatchObject({ state: 'CANCELLED', completedAtSimulationMs: 10 })
    expect(executor.readState('robot-A').state).toBe('IDLE')
    expect(executor.readState('robot-B').state).toBe('IDLE')

    executor.startJob('new-a', 1)
    await executor.advanceAll(1)
    expect(executor.readState('robot-A')).toMatchObject({
      runId: 'new-run-a',
      state: 'SUCCEEDED',
    })

    gateA.resolve(undefined)
    gateB.resolve(undefined)
    await oldAdvance
    unsubscribe()
    expect(executor.readState('robot-A')).toMatchObject({
      runId: 'new-run-a',
      state: 'SUCCEEDED',
    })
  })

  it('finishes reset when a terminal subscriber does not catch the reset guard', async () => {
    const project = projectForJobs([
      { id: 'old-a', robotId: 'robot-A', steps: [] },
      { id: 'old-b', robotId: 'robot-B', steps: [] },
      { id: 'new-a', robotId: 'robot-A', steps: [] },
    ])
    const { executor, jobs } = harness(project, undefined, [
      'old-run-a',
      'old-run-b',
      'new-run-a',
    ])
    const { runId: runA } = executor.startJob('old-a', 0)
    const { runId: runB } = executor.startJob('old-b', 0)
    const waiterA = executor.waitForTerminal(runA)
    const waiterB = executor.waitForTerminal(runB)
    let attemptedStart = false
    const unsubscribe = jobs.subscribe((state) => {
      const robot = state.byRobotId['robot-A']
      if (!attemptedStart && robot?.runId === runA && robot.state === 'CANCELLED') {
        attemptedStart = true
        executor.startJob('new-a', 0)
      }
    })

    expect(() => executor.reset()).not.toThrow()

    expect(await waiterA).toMatchObject({ runId: runA, state: 'CANCELLED' })
    expect(await waiterB).toMatchObject({ runId: runB, state: 'CANCELLED' })
    expect(executor.readState('robot-A').state).toBe('IDLE')
    expect(executor.readState('robot-B').state).toBe('IDLE')
    unsubscribe()
  })

  it('rejects a run-ID collision before changing Robot state', () => {
    const project = projectForJobs([
      { id: 'first', robotId: 'robot-A', steps: [] },
      { id: 'second', robotId: 'robot-B', steps: [] },
    ])
    const { executor } = harness(project, undefined, ['same-run', 'same-run'])
    executor.startJob('first', 0)
    const before = executor.readState('robot-B')

    expectProjectError(() => executor.startJob('second', 0), 'JOB_RUN_ID_COLLISION')
    expect(executor.readState('robot-B')).toBe(before)
  })

  it('retains run-ID collision protection across reset', () => {
    const project = projectForJobs([{ id: 'same-job', robotId: 'robot-A', steps: [] }])
    const { executor } = harness(project, undefined, ['same-run', 'same-run'])
    executor.startJob('same-job', 0)
    executor.reset()

    expectProjectError(() => executor.startJob('same-job', 0), 'JOB_RUN_ID_COLLISION')
  })

  it.each(['toString', 'constructor', '__proto__'])(
    'rejects absent prototype-looking Robot ID %s at the runtime read boundary',
    (robotId) => {
      const { executor } = harness(projectForJobs([]))

      expectProjectError(() => executor.readState(robotId), 'ROBOT_INSTANCE_NOT_FOUND')
    },
  )

  it('does not let an old terminal notification delete a reentrantly started run', async () => {
    const project = projectForJobs([
      { id: 'old-job', robotId: 'robot-A', steps: [] },
      { id: 'new-job', robotId: 'robot-A', steps: [] },
    ])
    const { executor, jobs } = harness(project, undefined, ['old-run', 'new-run'])
    let startedNewRun = false
    const unsubscribe = jobs.subscribe((state) => {
      const robot = state.byRobotId['robot-A']
      if (!startedNewRun && robot?.jobId === 'old-job' && robot.state === 'SUCCEEDED') {
        startedNewRun = true
        executor.startJob('new-job', 1)
      }
    })
    executor.startJob('old-job', 0)

    await executor.advanceAll(1)
    expect(executor.readState('robot-A')).toMatchObject({
      jobId: 'new-job',
      runId: 'new-run',
      state: 'RUNNING',
    })
    await executor.advanceAll(1)
    unsubscribe()

    expect(executor.readState('robot-A')).toMatchObject({
      jobId: 'new-job',
      runId: 'new-run',
      state: 'SUCCEEDED',
    })
  })

  it('preserves a new serialized chain started during cancellation notification', async () => {
    const gate = deferred<void>()
    let actionCalls = 0
    const project = projectForJobs([
      { id: 'old-job', robotId: 'robot-A', steps: [] },
      { id: 'new-job', robotId: 'robot-A', steps: [action('new-action')] },
    ], [robotAction('new-action', 'robot-A')])
    const { executor, jobs } = harness(project, {
      execute: async () => {
        actionCalls += 1
        await gate.promise
      },
    }, ['old-run', 'new-run'])
    const advances: Promise<void>[] = []
    let startedNewRun = false
    const unsubscribe = jobs.subscribe((state) => {
      const robot = state.byRobotId['robot-A']
      if (!startedNewRun && robot?.jobId === 'old-job' && robot.state === 'CANCELLED') {
        startedNewRun = true
        executor.startJob('new-job', 0)
        advances.push(executor.advanceAll(0))
      }
    })
    executor.startJob('old-job', 0)

    executor.cancelRobotJob('robot-A', 'replace run')
    advances.push(executor.advanceAll(0))
    await Promise.resolve()
    await Promise.resolve()
    expect(actionCalls).toBe(1)

    gate.resolve(undefined)
    await Promise.all(advances)
    unsubscribe()
    expect(executor.readState('robot-A').state).toBe('SUCCEEDED')
  })
})
