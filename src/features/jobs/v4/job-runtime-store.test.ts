import { describe, expect, it } from 'vitest'
import {
  ProjectV4Error,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  makeMinimalWorkcellProjectV4,
  projectAtLimit,
} from '../../../core/project-v4/test-support.js'
import {
  createJobRuntimeStoreV4,
  type RobotJobRuntimeStateV4,
} from './job-runtime-store.js'

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

describe('JobRuntimeStoreV4', () => {
  it('publishes one distinct frozen IDLE state per Robot and exact Project revision', () => {
    const project = { ...projectAtLimit('robots', 2), revisionId: 'revision-jobs-2' }
    const store = createJobRuntimeStoreV4()
    let notifications = 0
    const unsubscribe = store.subscribe(() => { notifications += 1 })

    store.getState().replaceProject(project)
    unsubscribe()

    const state = store.getState()
    const robot1 = state.byRobotId['robot-1']!
    const robot2 = state.byRobotId['robot-2']!
    expect(notifications).toBe(1)
    expect(state.projectRevisionId).toBe('revision-jobs-2')
    expect(robot1).toEqual({
      robotId: 'robot-1',
      jobId: null,
      runId: null,
      state: 'IDLE',
      stepIndex: null,
      startedAtSimulationMs: null,
      completedAtSimulationMs: null,
      failureCode: null,
      message: '',
    })
    expect(robot2).toEqual({ ...robot1, robotId: 'robot-2' })
    expect(robot1).not.toBe(robot2)
    expect(Object.isFrozen(robot1)).toBe(true)
    expect(Object.isFrozen(robot2)).toBe(true)
    expect(Object.isFrozen(state.byRobotId)).toBe(true)
  })

  it('reset replaces all Robot states once without aliasing prior state', () => {
    const store = createJobRuntimeStoreV4()
    const first = projectAtLimit('robots', 2)
    store.getState().replaceProject(first)
    const before = store.getState()
    const running: RobotJobRuntimeStateV4 = {
      robotId: 'robot-1',
      jobId: 'job-1',
      runId: 'run-1',
      state: 'RUNNING',
      stepIndex: 0,
      startedAtSimulationMs: 0,
      completedAtSimulationMs: null,
      failureCode: null,
      message: '',
    }
    store.getState().setRobotState(running)
    let notifications = 0
    const unsubscribe = store.subscribe(() => { notifications += 1 })

    store.getState().reset({ ...first, revisionId: 'revision-reset' })
    unsubscribe()

    expect(notifications).toBe(1)
    expect(store.getState().projectRevisionId).toBe('revision-reset')
    expect(store.getState().byRobotId['robot-1']?.state).toBe('IDLE')
    expect(store.getState()).not.toBe(before)
  })

  it('rejects an invalid Project without notification or reference change', () => {
    const store = createJobRuntimeStoreV4()
    store.getState().replaceProject(makeMinimalWorkcellProjectV4())
    const before = store.getState()
    const beforeRobots = before.byRobotId
    let notifications = 0
    const unsubscribe = store.subscribe(() => { notifications += 1 })
    const invalid = {
      ...makeMinimalWorkcellProjectV4(),
      unexpected: true,
    } as unknown as WorkcellProjectV4

    expectProjectError(() => store.getState().replaceProject(invalid), 'PROJECT_RECORD_NOT_CLOSED')
    unsubscribe()

    expect(store.getState()).toBe(before)
    expect(store.getState().byRobotId).toBe(beforeRobots)
    expect(notifications).toBe(0)
  })

  it('rejects unknown or internally inconsistent Robot state without publication', () => {
    const store = createJobRuntimeStoreV4()
    store.getState().replaceProject(makeMinimalWorkcellProjectV4())
    const before = store.getState()
    let notifications = 0
    const unsubscribe = store.subscribe(() => { notifications += 1 })

    expectProjectError(
      () => store.getState().setRobotState({
        ...before.byRobotId['robot-1']!,
        robotId: 'missing-robot',
      }),
      'ROBOT_INSTANCE_NOT_FOUND',
    )
    expectProjectError(
      () => store.getState().setRobotState({
        ...before.byRobotId['robot-1']!,
        state: 'RUNNING',
      }),
      'JOB_RUNTIME_STATE_INVALID',
    )
    unsubscribe()

    expect(store.getState()).toBe(before)
    expect(notifications).toBe(0)
  })

  it('rejects a non-object state through the stable Project error boundary', () => {
    const store = createJobRuntimeStoreV4()
    store.getState().replaceProject(makeMinimalWorkcellProjectV4())
    const before = store.getState()
    let notifications = 0
    const unsubscribe = store.subscribe(() => { notifications += 1 })

    expectProjectError(
      () => store.getState().setRobotState(null as unknown as RobotJobRuntimeStateV4),
      'JOB_RUNTIME_STATE_INVALID',
    )
    unsubscribe()

    expect(store.getState()).toBe(before)
    expect(notifications).toBe(0)
  })

  it('clones only the addressed Robot and top-level Robot record', () => {
    const store = createJobRuntimeStoreV4()
    store.getState().replaceProject(projectAtLimit('robots', 2))
    const before = store.getState()
    const robot2 = before.byRobotId['robot-2']
    const running: RobotJobRuntimeStateV4 = {
      robotId: 'robot-1',
      jobId: 'job-1',
      runId: 'run-1',
      state: 'RUNNING',
      stepIndex: 0,
      startedAtSimulationMs: 10,
      completedAtSimulationMs: null,
      failureCode: null,
      message: '',
    }

    store.getState().setRobotState(running)

    const after = store.getState()
    expect(after).not.toBe(before)
    expect(after.byRobotId).not.toBe(before.byRobotId)
    expect(after.byRobotId['robot-2']).toBe(robot2)
    expect(after.byRobotId['robot-1']).toEqual(running)
    expect(after.byRobotId['robot-1']).not.toBe(running)
    expect(Object.isFrozen(after.byRobotId['robot-1'])).toBe(true)
  })

  it('keeps all action methods callable across Project replacement and reset', () => {
    const store = createJobRuntimeStoreV4()
    const initial = store.getState()
    const methods = {
      replaceProject: initial.replaceProject,
      setRobotState: initial.setRobotState,
      reset: initial.reset,
    }

    initial.replaceProject(makeMinimalWorkcellProjectV4())
    expect(store.getState()).toMatchObject(methods)
    store.getState().reset({
      ...makeMinimalWorkcellProjectV4(),
      revisionId: 'revision-methods',
    })
    expect(store.getState()).toMatchObject(methods)
  })
})
