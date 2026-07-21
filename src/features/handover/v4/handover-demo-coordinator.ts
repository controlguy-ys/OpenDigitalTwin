import {
  computeSerialRobotPoseV4,
  sampleJointTransitionV4,
  transitionDurationMsV4,
  type RigidTransformV4,
  type RobotDefinitionV4,
  type RobotInstanceV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { StoreApi } from 'zustand/vanilla'

import type { JobRuntimeStoreV4 } from '../../jobs/v4/job-runtime-store.js'
import type { AnimationFrameSchedulerV4 } from '../../jobs/v4/simulation-clock.js'
import {
  HACKATHON_HANDOVER_IDS_V4,
  HACKATHON_HANDOVER_STEPS_V4,
  isHackathonHandoverSampleV4,
} from '../../project/v4/hackathon-handover-sample-v4.js'
import type { RobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import type { HandoverDemoRuntimeStateV4 } from './handover-demo-runtime-store.js'

export interface HandoverDemoCoordinatorV4 {
  canHandle(jobId: string): boolean
  canStart(jobId: string): boolean
  start(jobId: string): { readonly runId: string }
  canCancel(): boolean
  cancel(reason: string): void
  canReset(jobId: string): boolean
  reset(): void
  setGripConfirmTimeoutInjection(enabled: boolean): void
  dispose(): void
}

export interface HandoverDemoCoordinatorOptionsV4 {
  readonly readProject: () => WorkcellProjectV4
  readonly robots: StoreApi<RobotRuntimeRegistryV4>
  readonly jobs: StoreApi<JobRuntimeStoreV4>
  readonly demo: StoreApi<HandoverDemoRuntimeStateV4>
  readonly scheduler: AnimationFrameSchedulerV4
  readonly createRunId: () => string
}

type HandoverStepV4 = typeof HACKATHON_HANDOVER_STEPS_V4[number]
type JointRecordV4 = Readonly<Record<string, number>>

interface CoordinatorProjectV4 {
  readonly project: WorkcellProjectV4
  readonly robotA: RobotInstanceV4
  readonly robotB: RobotInstanceV4
  readonly definition: RobotDefinitionV4
  readonly outputTrayPose: RigidTransformV4
  readonly poses: {
    readonly home: JointRecordV4
    readonly pick: JointRecordV4
    readonly shared: JointRecordV4
    readonly place: JointRecordV4
  }
  readonly speeds: {
    readonly pick: number
    readonly shared: number
    readonly handoverApproach: number
    readonly place: number
  }
}

interface ActiveRunV4 {
  readonly runId: string
  readonly demoGeneration: number
  readonly lifecycleGeneration: number
  readonly startedAtSimulationMs: number
  readonly injectGripConfirmTimeout: boolean
  readonly context: CoordinatorProjectV4
  step: HandoverStepV4
  stepStartedAtSimulationMs: number
}

const LOCAL_GRIP_CONFIRM_MS_V4 = 250
const GRIP_CONFIRM_TIMEOUT_MS_V4 = 2_000

function coordinatorFailure(message: string): never {
  throw new Error(message)
}

function jointPoseAtV4(
  context: WorkcellProjectV4,
  index: number,
): { readonly jointValues: JointRecordV4; readonly speedPercentToNext: number } {
  const job = context.jobs.find(({ id }) => id === HACKATHON_HANDOVER_IDS_V4.jobId)
  const step = job?.steps[index]
  if (step?.kind !== 'joint-pose') {
    coordinatorFailure(`Handover Job step ${index} must be a Joint Pose.`)
  }
  return step
}

function prepareProjectV4(project: WorkcellProjectV4): CoordinatorProjectV4 {
  if (!isHackathonHandoverSampleV4(project)) {
    coordinatorFailure('The active Project is not the Hackathon handover sample.')
  }
  const ids = HACKATHON_HANDOVER_IDS_V4
  const robotA = project.robots.find(({ id }) => id === ids.robotAId)
  const robotB = project.robots.find(({ id }) => id === ids.robotBId)
  const outputTray = project.spatialEntities.find(({ id }) => id === ids.outputTrayId)
  if (robotA === undefined || robotB === undefined || outputTray === undefined) {
    coordinatorFailure('The Hackathon handover Project topology is incomplete.')
  }
  if (robotA.definitionId !== robotB.definitionId) {
    coordinatorFailure('Both Handover Robots must share one Robot Definition.')
  }
  if (robotA.jointSource !== 'simulation' || robotB.jointSource !== 'simulation') {
    coordinatorFailure('Both Handover Robots must use the simulation Joint source.')
  }
  const definition = project.robotDefinitions.find(({ id }) => id === robotA.definitionId)
  if (definition === undefined) coordinatorFailure('The shared Handover Robot Definition is missing.')

  const home = jointPoseAtV4(project, 0)
  const pick = jointPoseAtV4(project, 1)
  const shared = jointPoseAtV4(project, 3)
  const placeRepresentative = jointPoseAtV4(project, 6)
  const pickJ1 = pick.jointValues.J1
  if (typeof pickJ1 !== 'number' || !Number.isFinite(pickJ1)) {
    coordinatorFailure('The fixed NED2 Pick keyframe must contain J1.')
  }
  const place = Object.freeze({ ...pick.jointValues, J1: -pickJ1 })

  return {
    project,
    robotA,
    robotB,
    definition,
    outputTrayPose: outputTray.localPose,
    poses: {
      home: home.jointValues,
      pick: pick.jointValues,
      shared: shared.jointValues,
      place,
    },
    speeds: {
      pick: home.speedPercentToNext,
      shared: jointPoseAtV4(project, 2).speedPercentToNext,
      handoverApproach: home.speedPercentToNext,
      place: jointPoseAtV4(project, 5).speedPercentToNext
        || placeRepresentative.speedPercentToNext,
    },
  }
}

function stepIndexV4(step: HandoverStepV4): number {
  return HACKATHON_HANDOVER_STEPS_V4.indexOf(step)
}

export function createHandoverDemoCoordinatorV4(
  options: HandoverDemoCoordinatorOptionsV4,
): HandoverDemoCoordinatorV4 {
  let disposed = false
  let active: ActiveRunV4 | null = null
  let scheduledHandle: number | null = null
  let lifecycleGeneration = 0

  const cancelScheduled = (): void => {
    lifecycleGeneration += 1
    if (scheduledHandle === null) return
    const handle = scheduledHandle
    scheduledHandle = null
    options.scheduler.cancel(handle)
  }

  const publishRunning = (run: ActiveRunV4): void => {
    options.jobs.getState().setRobotState({
      robotId: HACKATHON_HANDOVER_IDS_V4.robotAId,
      jobId: HACKATHON_HANDOVER_IDS_V4.jobId,
      runId: run.runId,
      state: 'RUNNING',
      stepIndex: stepIndexV4(run.step),
      startedAtSimulationMs: run.startedAtSimulationMs,
      completedAtSimulationMs: null,
      failureCode: null,
      message: '',
    })
  }

  const publishTerminal = (
    run: ActiveRunV4,
    state: 'SUCCEEDED' | 'FAILED' | 'CANCELLED',
    completedAtSimulationMs: number,
    failureCode: string | null,
    message: string,
  ): void => {
    options.jobs.getState().setRobotState({
      robotId: HACKATHON_HANDOVER_IDS_V4.robotAId,
      jobId: HACKATHON_HANDOVER_IDS_V4.jobId,
      runId: run.runId,
      state,
      stepIndex: stepIndexV4(run.step),
      startedAtSimulationMs: run.startedAtSimulationMs,
      completedAtSimulationMs: Math.max(run.startedAtSimulationMs, completedAtSimulationMs),
      failureCode,
      message,
    })
  }

  const isAuthoritative = (run: ActiveRunV4): boolean => (
    !disposed
    && active === run
    && lifecycleGeneration === run.lifecycleGeneration
    && options.demo.getState().generation === run.demoGeneration
  )

  const selectedTcpWorld = (
    run: ActiveRunV4,
    robot: RobotInstanceV4,
  ): RigidTransformV4 => {
    const runtime = options.robots.getState().robots[robot.id]
    if (runtime === undefined) coordinatorFailure(`Robot runtime ${robot.id} is missing.`)
    const tcp = computeSerialRobotPoseV4(
      run.context.definition,
      runtime.jointValues,
      robot.localBasePose,
    ).frameWorldPoses[runtime.selectedTcpFrameId]
    if (tcp === undefined) {
      coordinatorFailure(`Selected TCP ${runtime.selectedTcpFrameId} is missing on ${robot.id}.`)
    }
    return tcp
  }

  const writeJoints = (
    run: ActiveRunV4,
    robot: RobotInstanceV4,
    values: JointRecordV4,
  ): RigidTransformV4 => {
    options.robots.getState().writeJointValues(robot.id, values, 'simulation')
    const tcpWorld = selectedTcpWorld(run, robot)
    const owner = robot.id === HACKATHON_HANDOVER_IDS_V4.robotAId ? 'NED2-A' : 'NED2-B'
    options.demo.getState().updateAttachedPose(run.demoGeneration, owner, tcpWorld)
    return tcpWorld
  }

  const enterStep = (
    run: ActiveRunV4,
    step: HandoverStepV4,
    simulationMs: number,
  ): boolean => {
    if (!options.demo.getState().setStep(run.demoGeneration, step)) return false
    run.step = step
    run.stepStartedAtSimulationMs = simulationMs
    publishRunning(run)
    return true
  }

  const sampleMotion = (
    run: ActiveRunV4,
    robot: RobotInstanceV4,
    from: JointRecordV4,
    to: JointRecordV4,
    speedPercent: number,
    simulationMs: number,
  ): boolean => {
    const durationMs = transitionDurationMsV4(
      from,
      to,
      speedPercent,
      run.context.definition.joints,
    )
    const elapsedMs = simulationMs - run.stepStartedAtSimulationMs
    writeJoints(run, robot, sampleJointTransitionV4({
      from,
      to,
      elapsedMs,
      durationMs,
      joints: run.context.definition.joints,
    }))
    return elapsedMs >= durationMs
  }

  const tick = (run: ActiveRunV4, simulationMs: number): void => {
    if (!isAuthoritative(run)) return
    const { robotA, robotB, poses, speeds } = run.context

    switch (run.step) {
      case 'READY':
        if (!enterStep(run, 'PICK_APPROACH', simulationMs)) return
        writeJoints(run, robotA, poses.home)
        return

      case 'PICK_APPROACH': {
        if (!sampleMotion(run, robotA, poses.home, poses.pick, speeds.pick, simulationMs)) return
        if (!enterStep(run, 'PICK_GRIP', simulationMs)) return
        options.robots.getState().setGripperState(robotA.id, 'CLOSED')
        const workpieceWorld = options.demo.getState().readWorldPose(
          HACKATHON_HANDOVER_IDS_V4.workpieceId,
        )
        if (workpieceWorld === null) coordinatorFailure('The authored Workpiece pose is missing.')
        options.demo.getState().attach(
          run.demoGeneration,
          'NED2-A',
          selectedTcpWorld(run, robotA),
          workpieceWorld,
        )
        return
      }

      case 'PICK_GRIP':
        enterStep(run, 'MOVE_TO_SHARED_ZONE', simulationMs)
        return

      case 'MOVE_TO_SHARED_ZONE':
        if (!sampleMotion(run, robotA, poses.pick, poses.shared, speeds.shared, simulationMs)) return
        if (!enterStep(run, 'HANDOVER_APPROACH', simulationMs)) return
        writeJoints(run, robotB, poses.home)
        return

      case 'HANDOVER_APPROACH':
        if (!sampleMotion(
          run,
          robotB,
          poses.home,
          poses.shared,
          speeds.handoverApproach,
          simulationMs,
        )) return
        if (!enterStep(run, 'HANDOVER_CONFIRM', simulationMs)) return
        options.robots.getState().setGripperState(robotB.id, 'CLOSED')
        return

      case 'HANDOVER_CONFIRM': {
        const elapsedMs = simulationMs - run.stepStartedAtSimulationMs
        if (run.injectGripConfirmTimeout) {
          if (elapsedMs < GRIP_CONFIRM_TIMEOUT_MS_V4) return
          options.demo.getState().failGripConfirm(run.demoGeneration)
          publishTerminal(
            run,
            'FAILED',
            simulationMs,
            'GRIP_CONFIRM_TIMEOUT',
            'Grip confirmation timed out.',
          )
          active = null
          return
        }
        if (elapsedMs < LOCAL_GRIP_CONFIRM_MS_V4) return
        options.demo.getState().transfer(
          run.demoGeneration,
          'NED2-B',
          selectedTcpWorld(run, robotB),
        )
        options.robots.getState().setGripperState(robotA.id, 'OPEN')
        enterStep(run, 'PLACE', simulationMs)
        return
      }

      case 'PLACE': {
        const elapsedMs = simulationMs - run.stepStartedAtSimulationMs
        const durationA = transitionDurationMsV4(
          poses.shared,
          poses.home,
          speeds.place,
          run.context.definition.joints,
        )
        const durationB = transitionDurationMsV4(
          poses.shared,
          poses.place,
          speeds.place,
          run.context.definition.joints,
        )
        writeJoints(run, robotA, sampleJointTransitionV4({
          from: poses.shared,
          to: poses.home,
          elapsedMs,
          durationMs: durationA,
          joints: run.context.definition.joints,
        }))
        writeJoints(run, robotB, sampleJointTransitionV4({
          from: poses.shared,
          to: poses.place,
          elapsedMs,
          durationMs: durationB,
          joints: run.context.definition.joints,
        }))
        if (elapsedMs < Math.max(durationA, durationB)) return
        options.demo.getState().place(run.demoGeneration, run.context.outputTrayPose)
        options.robots.getState().setGripperState(robotB.id, 'OPEN')
        options.demo.getState().complete(run.demoGeneration)
        run.step = 'COMPLETE'
        publishTerminal(run, 'SUCCEEDED', simulationMs, null, '')
        active = null
        return
      }

      case 'COMPLETE':
        active = null
    }
  }

  const ensureScheduled = (): void => {
    const run = active
    if (run === null || scheduledHandle !== null || !isAuthoritative(run)) return
    let handle = -1
    handle = options.scheduler.request((simulationMs) => {
      if (scheduledHandle !== handle || !isAuthoritative(run)) return
      scheduledHandle = null
      tick(run, simulationMs)
      ensureScheduled()
    })
    scheduledHandle = handle
  }

  const restoreInitialState = (): void => {
    const project = options.readProject()
    options.robots.getState().reset(project)
    options.demo.getState().reset()
    options.jobs.getState().reset(project)
  }

  const coordinator: HandoverDemoCoordinatorV4 = {
    canHandle(jobId) {
      return !disposed
        && jobId === HACKATHON_HANDOVER_IDS_V4.jobId
        && isHackathonHandoverSampleV4(options.readProject())
    },

    canStart(jobId) {
      if (!coordinator.canHandle(jobId) || active !== null) return false
      const demoState = options.demo.getState()
      const jobState = options.jobs.getState().byRobotId[HACKATHON_HANDOVER_IDS_V4.robotAId]
      return demoState.runState === 'IDLE' && jobState?.state === 'IDLE'
    },

    start(jobId) {
      if (disposed) coordinatorFailure('Handover Coordinator is disposed.')
      if (!coordinator.canHandle(jobId)) coordinatorFailure(`Cannot handle Job ${jobId}.`)
      if (!coordinator.canStart(jobId)) coordinatorFailure('Handover demo is already running or requires Reset.')
      const context = prepareProjectV4(options.readProject())
      const runId = options.createRunId()
      if (typeof runId !== 'string' || runId.length === 0) {
        coordinatorFailure('Handover run ID must be a non-empty string.')
      }
      const startedAtSimulationMs = options.scheduler.now()
      if (!Number.isFinite(startedAtSimulationMs) || startedAtSimulationMs < 0) {
        coordinatorFailure('Simulation time must be finite and nonnegative.')
      }
      const demoGeneration = options.demo.getState().begin(runId)
      const run: ActiveRunV4 = {
        runId,
        demoGeneration,
        lifecycleGeneration: ++lifecycleGeneration,
        startedAtSimulationMs,
        injectGripConfirmTimeout: options.demo.getState().injectGripConfirmTimeout,
        context,
        step: 'READY',
        stepStartedAtSimulationMs: startedAtSimulationMs,
      }
      active = run
      publishRunning(run)
      ensureScheduled()
      return Object.freeze({ runId })
    },

    canCancel() {
      return !disposed && active !== null
    },

    cancel(reason) {
      if (!coordinator.canCancel()) return
      const run = active!
      const completedAt = options.scheduler.now()
      const step = run.step
      cancelScheduled()
      active = null
      restoreInitialState()
      run.step = step
      publishTerminal(run, 'CANCELLED', completedAt, null, reason)
    },

    canReset(jobId) {
      return coordinator.canHandle(jobId)
    },

    reset() {
      if (disposed) return
      cancelScheduled()
      active = null
      restoreInitialState()
    },

    setGripConfirmTimeoutInjection(enabled) {
      if (disposed) coordinatorFailure('Handover Coordinator is disposed.')
      options.demo.getState().setFaultInjection(enabled)
    },

    dispose() {
      if (disposed) return
      cancelScheduled()
      active = null
      restoreInitialState()
      disposed = true
    },
  }

  return Object.freeze(coordinator)
}
