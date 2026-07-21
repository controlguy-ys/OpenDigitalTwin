import { describe, expect, it } from 'vitest'

import type { AnimationFrameSchedulerV4 } from '../../jobs/v4/simulation-clock.js'
import { createJobRuntimeStoreV4 } from '../../jobs/v4/job-runtime-store.js'
import {
  createHackathonHandoverSampleV4,
  HACKATHON_HANDOVER_IDS_V4,
  type HACKATHON_HANDOVER_STEPS_V4,
} from '../../project/v4/hackathon-handover-sample-v4.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import {
  createHandoverDemoCoordinatorV4,
} from './handover-demo-coordinator.js'
import {
  createHandoverDemoRuntimeStoreV4,
  type HandoverDemoRuntimeStateV4,
} from './handover-demo-runtime-store.js'

type HandoverStepV4 = typeof HACKATHON_HANDOVER_STEPS_V4[number]

class ManualAnimationFrameSchedulerV4 implements AnimationFrameSchedulerV4 {
  private simulationMs = 0
  private nextHandle = 1
  private readonly callbacks = new Map<number, (simulationMs: number) => void>()

  now(): number {
    return this.simulationMs
  }

  request(callback: (simulationMs: number) => void): number {
    const handle = this.nextHandle++
    this.callbacks.set(handle, callback)
    return handle
  }

  cancel(handle: number): void {
    this.callbacks.delete(handle)
  }

  pendingCount(): number {
    return this.callbacks.size
  }

  capturePendingCallback(): (simulationMs: number) => void {
    const callback = [...this.callbacks.values()][0]
    if (callback === undefined) throw new Error('No animation callback is pending.')
    return callback
  }

  async advanceBy(elapsedMs: number): Promise<void> {
    this.simulationMs += elapsedMs
    const callbacks = [...this.callbacks.values()]
    this.callbacks.clear()
    callbacks.forEach((callback) => callback(this.simulationMs))
    await Promise.resolve()
  }

  async advanceToStep(
    demo: ReturnType<typeof createHandoverDemoRuntimeStoreV4>,
    step: HandoverStepV4,
  ): Promise<void> {
    for (let frame = 0; frame < 2_000 && demo.getState().step !== step; frame += 1) {
      if (this.callbacks.size === 0) throw new Error(`Coordinator stopped before ${step}.`)
      await this.advanceBy(16)
    }
    if (demo.getState().step !== step) throw new Error(`Coordinator did not reach ${step}.`)
  }

  async advanceUntilIdle(): Promise<void> {
    for (let frame = 0; frame < 4_000 && this.callbacks.size > 0; frame += 1) {
      await this.advanceBy(16)
    }
    if (this.callbacks.size > 0) throw new Error('Coordinator animation did not become idle.')
  }
}

function harness() {
  const project = createHackathonHandoverSampleV4({
    projectId: 'project-handover-coordinator-test',
    revisionId: 'revision-handover-coordinator-test',
    nowIso: '2026-07-21T06:00:00.000Z',
  })
  const robots = createRobotRuntimeRegistryV4()
  const jobs = createJobRuntimeStoreV4()
  const demo = createHandoverDemoRuntimeStoreV4(project)
  const scheduler = new ManualAnimationFrameSchedulerV4()
  let runSequence = 0
  robots.getState().replaceProject(project)
  jobs.getState().replaceProject(project)
  const coordinator = createHandoverDemoCoordinatorV4({
    readProject: () => project,
    robots,
    jobs,
    demo,
    scheduler,
    createRunId: () => `handover-run-${++runSequence}`,
  })
  return { project, robots, jobs, demo, scheduler, coordinator }
}

describe('Handover demo Coordinator V4', () => {
  it('runs both Robots from one representative Job and completes offline', async () => {
    const h = harness()
    const owners: HandoverDemoRuntimeStateV4['partOwner'][] = []
    h.demo.subscribe((state, prior) => {
      if (state.partOwner !== prior.partOwner) owners.push(state.partOwner)
    })

    h.coordinator.start(HACKATHON_HANDOVER_IDS_V4.jobId)
    await h.scheduler.advanceUntilIdle()

    expect(h.demo.getState()).toMatchObject({
      runState: 'SUCCEEDED',
      step: 'COMPLETE',
      partOwner: 'OUTPUT_TRAY',
      sharedZoneOwner: 'NONE',
    })
    expect(owners).toEqual(['NED2-A', 'NED2-B', 'OUTPUT_TRAY'])
    expect(h.jobs.getState().byRobotId[HACKATHON_HANDOVER_IDS_V4.robotAId]).toMatchObject({
      state: 'SUCCEEDED',
      stepIndex: 7,
      failureCode: null,
    })
    expect(h.jobs.getState().byRobotId[HACKATHON_HANDOVER_IDS_V4.robotBId]).toMatchObject({
      state: 'IDLE',
    })
    expect(h.robots.getState().robots[HACKATHON_HANDOVER_IDS_V4.robotAId]!.revision).toBeGreaterThan(0)
    expect(h.robots.getState().robots[HACKATHON_HANDOVER_IDS_V4.robotBId]!.revision).toBeGreaterThan(0)
  })

  it('fails at exactly 2000 ms without transferring ownership', async () => {
    const h = harness()
    h.coordinator.setGripConfirmTimeoutInjection(true)
    h.coordinator.start(HACKATHON_HANDOVER_IDS_V4.jobId)
    await h.scheduler.advanceToStep(h.demo, 'HANDOVER_CONFIRM')

    await h.scheduler.advanceBy(1_999)
    expect(h.demo.getState().runState).toBe('RUNNING')

    await h.scheduler.advanceBy(1)
    expect(h.demo.getState()).toMatchObject({
      runState: 'FAULTED',
      step: 'HANDOVER_CONFIRM',
      failureCode: 'GRIP_CONFIRM_TIMEOUT',
      partOwner: 'NED2-A',
      sharedZoneOwner: 'NED2-A',
    })
    expect(h.jobs.getState().byRobotId[HACKATHON_HANDOVER_IDS_V4.robotAId]).toMatchObject({
      state: 'FAILED',
      failureCode: 'GRIP_CONFIRM_TIMEOUT',
    })
    expect(h.scheduler.pendingCount()).toBe(0)
  })

  it('preserves the Workpiece World pose across local confirmation and transfer', async () => {
    const h = harness()
    h.coordinator.start(HACKATHON_HANDOVER_IDS_V4.jobId)
    await h.scheduler.advanceToStep(h.demo, 'HANDOVER_CONFIRM')
    const before = h.demo.getState().readWorldPose(HACKATHON_HANDOVER_IDS_V4.workpieceId)

    await h.scheduler.advanceBy(249)
    expect(h.demo.getState().partOwner).toBe('NED2-A')
    await h.scheduler.advanceBy(1)

    expect(h.demo.getState().step).toBe('PLACE')
    expect(h.demo.getState().partOwner).toBe('NED2-B')
    expect(h.demo.getState().readWorldPose(HACKATHON_HANDOVER_IDS_V4.workpieceId)).toEqual(before)
  })

  it('rejects a second Start while the run is active and supports Cancel', async () => {
    const h = harness()
    h.coordinator.start(HACKATHON_HANDOVER_IDS_V4.jobId)

    expect(h.coordinator.canStart(HACKATHON_HANDOVER_IDS_V4.jobId)).toBe(false)
    expect(() => h.coordinator.start(HACKATHON_HANDOVER_IDS_V4.jobId)).toThrow(
      /already running/i,
    )
    expect(h.coordinator.canCancel()).toBe(true)

    await h.scheduler.advanceToStep(h.demo, 'MOVE_TO_SHARED_ZONE')
    h.coordinator.cancel('Operator cancelled the demo.')

    expect(h.demo.getState()).toMatchObject({ runState: 'IDLE', step: 'READY' })
    expect(h.jobs.getState().byRobotId[HACKATHON_HANDOVER_IDS_V4.robotAId]).toMatchObject({
      state: 'CANCELLED',
      message: 'Operator cancelled the demo.',
    })
    expect(h.jobs.getState().byRobotId[HACKATHON_HANDOVER_IDS_V4.robotBId]!.state).toBe('IDLE')
    expect(h.scheduler.pendingCount()).toBe(0)
  })

  it('Reset restores both Robots, Workpiece, Job, and fault state', async () => {
    const h = harness()
    const initialRobots = h.robots.getState().robots
    const initialWorkpiece = h.demo.getState().readWorldPose(HACKATHON_HANDOVER_IDS_V4.workpieceId)
    h.coordinator.setGripConfirmTimeoutInjection(true)
    h.coordinator.start(HACKATHON_HANDOVER_IDS_V4.jobId)
    await h.scheduler.advanceToStep(h.demo, 'MOVE_TO_SHARED_ZONE')

    h.coordinator.reset()

    expect(h.robots.getState().robots).toEqual(initialRobots)
    expect(h.demo.getState()).toMatchObject({
      runState: 'IDLE',
      step: 'READY',
      partOwner: 'TABLE',
      sharedZoneOwner: 'NONE',
      injectGripConfirmTimeout: false,
    })
    expect(h.demo.getState().readWorldPose(HACKATHON_HANDOVER_IDS_V4.workpieceId)).toEqual(initialWorkpiece)
    expect(h.jobs.getState().byRobotId[HACKATHON_HANDOVER_IDS_V4.robotAId]!.state).toBe('IDLE')
    expect(h.jobs.getState().byRobotId[HACKATHON_HANDOVER_IDS_V4.robotBId]!.state).toBe('IDLE')
    expect(h.scheduler.pendingCount()).toBe(0)
  })

  it('rejects a callback captured before dispose', () => {
    const h = harness()
    h.coordinator.start(HACKATHON_HANDOVER_IDS_V4.jobId)
    const staleCallback = h.scheduler.capturePendingCallback()

    h.coordinator.dispose()
    const resetState = h.demo.getState()
    staleCallback(h.scheduler.now() + 10_000)

    expect(h.demo.getState()).toBe(resetState)
    expect(h.demo.getState()).toMatchObject({ runState: 'IDLE', step: 'READY' })
    expect(h.jobs.getState().byRobotId[HACKATHON_HANDOVER_IDS_V4.robotAId]!.state).toBe('IDLE')
    expect(h.scheduler.pendingCount()).toBe(0)
    expect(() => h.coordinator.start(HACKATHON_HANDOVER_IDS_V4.jobId)).toThrow(/disposed/i)
  })
})
