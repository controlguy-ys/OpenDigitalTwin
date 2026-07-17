import {
  computeSerialRobotPoseV4,
  failProjectV4,
  validateWorkcellProjectV4,
  type RobotDefinitionV4,
  type RobotIdV4,
  type RobotJointSourceV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { createStore, type StoreApi } from 'zustand/vanilla'

export type RobotJointWriterV4 = RobotJointSourceV4
export type RobotGripperStateV4 = 'OPEN' | 'CLOSED'

export interface RobotRuntimeStateV4 {
  readonly robotId: RobotIdV4
  readonly definitionId: string
  readonly jointValues: Readonly<Record<string, number>>
  readonly jointSource: RobotJointWriterV4
  readonly gripperState: RobotGripperStateV4
  readonly selectedToolFrameId: string
  readonly selectedTcpFrameId: string
  readonly numericStatus: number
  readonly visible: boolean
  readonly revision: number
}

export interface RobotRuntimeCheckpointV4 {
  readonly kind: 'robot-runtime-checkpoint-v4'
}

export interface RobotRuntimeRegistryV4 {
  readonly projectRevisionId: string | null
  readonly robots: Readonly<Record<RobotIdV4, RobotRuntimeStateV4>>

  replaceProject(project: WorkcellProjectV4): void
  reset(project: WorkcellProjectV4): void

  writeJointValues(
    robotId: RobotIdV4,
    values: Readonly<Record<string, number>>,
    writer: RobotJointWriterV4,
  ): void
  setGripperState(robotId: RobotIdV4, state: RobotGripperStateV4): void
  selectToolFrames(
    robotId: RobotIdV4,
    toolFrameId: string,
    tcpFrameId: string,
  ): void
  setNumericStatus(
    robotId: RobotIdV4,
    value: number,
    writer: RobotJointWriterV4,
  ): void

  captureCheckpoint(): RobotRuntimeCheckpointV4
  restoreCheckpoint(checkpoint: RobotRuntimeCheckpointV4): void
}

interface PreparedRobotRuntimeRegistryV4 {
  readonly projectRevisionId: string
  readonly robots: Readonly<Record<RobotIdV4, RobotRuntimeStateV4>>
  readonly definitionsByRobotId: ReadonlyMap<RobotIdV4, RobotDefinitionV4>
  readonly statusSourcesByRobotId: ReadonlyMap<RobotIdV4, RobotJointWriterV4>
}

interface RobotRuntimeRegistryContextV4 {
  readonly definitionsByRobotId: ReadonlyMap<RobotIdV4, RobotDefinitionV4>
  readonly statusSourcesByRobotId: ReadonlyMap<RobotIdV4, RobotJointWriterV4>
}

interface CapturedRobotRuntimeRegistryV4 {
  readonly state: RobotRuntimeRegistryV4
  readonly context: RobotRuntimeRegistryContextV4
}

const EMPTY_ROBOTS_V4 = Object.freeze({}) as Readonly<
  Record<RobotIdV4, RobotRuntimeStateV4>
>

const EMPTY_CONTEXT_V4: RobotRuntimeRegistryContextV4 = {
  definitionsByRobotId: new Map(),
  statusSourcesByRobotId: new Map(),
}

function runtimeFailure(code: string, path: string, message: string): never {
  failProjectV4(code, path, message, 'Correct the Robot runtime command and try again.')
}

function nextRobotRevisionV4(revision: number): number {
  if (
    !Number.isSafeInteger(revision)
    || revision < 0
    || revision >= Number.MAX_SAFE_INTEGER
  ) {
    failProjectV4(
      'ROBOT_RUNTIME_REVISION_EXHAUSTED',
      '$.revision',
      'Robot runtime revision cannot be safely incremented.',
    )
  }
  return revision + 1
}

function inspectPartialJointRecord(
  value: unknown,
  path: string,
): readonly [string, number][] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    runtimeFailure('PROJECT_VALUE_INVALID', path, 'Joint update must be a plain record.')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    runtimeFailure(
      'PROJECT_VALUE_INVALID',
      path,
      'Joint update must be a plain record without a custom prototype.',
    )
  }

  const entries: Array<[string, number]> = []
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      runtimeFailure('PROJECT_VALUE_INVALID', path, 'Joint update keys must be strings.')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      runtimeFailure(
        'PROJECT_VALUE_INVALID',
        path,
        'Joint updates must use enumerable own data properties.',
      )
    }
    entries.push([key, descriptor.value as number])
  }

  if (entries.length === 0) {
    runtimeFailure(
      'ROBOT_JOINT_UPDATE_EMPTY',
      path,
      'At least one Joint value is required.',
    )
  }
  return entries
}

function prepareRobotRuntimeRegistryV4(
  project: WorkcellProjectV4,
): PreparedRobotRuntimeRegistryV4 {
  const validatedProject = validateWorkcellProjectV4(project)
  const definitionsById = new Map(
    validatedProject.robotDefinitions.map((definition) => [definition.id, definition]),
  )
  const definitionsByRobotId = new Map<RobotIdV4, RobotDefinitionV4>()
  const statusSourcesByRobotId = new Map<RobotIdV4, RobotJointWriterV4>()
  const robotEntries = validatedProject.robots.map((robot): [RobotIdV4, RobotRuntimeStateV4] => {
    const definition = definitionsById.get(robot.definitionId)!
    const jointValues = Object.freeze(Object.fromEntries(
      definition.joints.map((joint) => [joint.id, robot.initialJointValues[joint.id]!]),
    ))
    computeSerialRobotPoseV4(definition, jointValues)
    definitionsByRobotId.set(robot.id, definition)
    statusSourcesByRobotId.set(robot.id, robot.numericStatus.sourceOwnership)

    return [robot.id, Object.freeze({
      robotId: robot.id,
      definitionId: robot.definitionId,
      jointValues,
      jointSource: robot.jointSource,
      gripperState: 'OPEN',
      selectedToolFrameId: robot.selectedToolFrameId,
      selectedTcpFrameId: robot.selectedTcpFrameId,
      numericStatus: robot.numericStatus.value,
      visible: robot.visible,
      revision: 0,
    })]
  })

  return {
    projectRevisionId: validatedProject.revisionId,
    robots: Object.freeze(Object.fromEntries(robotEntries)),
    definitionsByRobotId,
    statusSourcesByRobotId,
  }
}

export function buildInitialRobotRuntimeStatesV4(
  project: WorkcellProjectV4,
): Readonly<Record<RobotIdV4, RobotRuntimeStateV4>> {
  return prepareRobotRuntimeRegistryV4(project).robots
}

export function createRobotRuntimeRegistryV4(): StoreApi<RobotRuntimeRegistryV4> {
  let context = EMPTY_CONTEXT_V4
  const checkpoints = new WeakMap<object, CapturedRobotRuntimeRegistryV4>()

  return createStore<RobotRuntimeRegistryV4>()((set, get) => {
    const requireRobot = (
      robotId: RobotIdV4,
    ): { readonly registry: RobotRuntimeRegistryV4; readonly robot: RobotRuntimeStateV4 } => {
      const registry = get()
      if (!Object.hasOwn(registry.robots, robotId)) {
        runtimeFailure(
          'ROBOT_INSTANCE_NOT_FOUND',
          `$.robots.${robotId}`,
          `Robot Instance ${robotId} does not exist.`,
        )
      }
      return { registry, robot: registry.robots[robotId]! }
    }

    const requireDefinition = (
      robotId: RobotIdV4,
    ): RobotDefinitionV4 => {
      const definition = context.definitionsByRobotId.get(robotId)
      if (definition === undefined) {
        runtimeFailure(
          'ROBOT_INSTANCE_NOT_FOUND',
          `$.robots.${robotId}`,
          `Robot Instance ${robotId} does not have a published Definition.`,
        )
      }
      return definition
    }

    const publishRobot = (
      registry: RobotRuntimeRegistryV4,
      robotId: RobotIdV4,
      robot: RobotRuntimeStateV4,
    ): void => {
      const robots = Object.freeze({ ...registry.robots, [robotId]: robot })
      set({ ...registry, robots }, true)
    }

    const publishCandidate = (candidate: PreparedRobotRuntimeRegistryV4): void => {
      context = {
        definitionsByRobotId: candidate.definitionsByRobotId,
        statusSourcesByRobotId: candidate.statusSourcesByRobotId,
      }
      set((state) => ({
        ...state,
        projectRevisionId: candidate.projectRevisionId,
        robots: candidate.robots,
      }), true)
    }

    const replaceProject = (project: WorkcellProjectV4): void => {
      const candidate = prepareRobotRuntimeRegistryV4(project)
      publishCandidate(candidate)
    }

    return {
      projectRevisionId: null,
      robots: EMPTY_ROBOTS_V4,
      replaceProject,
      reset: replaceProject,
      writeJointValues: (robotId, values, writer) => {
        const { registry, robot } = requireRobot(robotId)
        if (writer !== robot.jointSource) {
          runtimeFailure(
            'ROBOT_JOINT_SOURCE_OWNERSHIP_CONFLICT',
            `$.robots.${robotId}.jointSource`,
            `Writer ${writer} does not own Robot ${robotId} Joint state.`,
          )
        }
        const definition = requireDefinition(robotId)
        const path = `$.robots.${robotId}.jointValues`
        const entries = inspectPartialJointRecord(values, path)
        const jointsById = new Map(definition.joints.map((joint) => [joint.id, joint]))
        const updates = new Map<string, number>()
        for (const [jointId, value] of entries) {
          const joint = jointsById.get(jointId)
          if (joint === undefined) {
            runtimeFailure(
              'ROBOT_JOINT_NOT_FOUND',
              `${path}.${jointId}`,
              `Joint ${jointId} does not exist in Robot ${robotId}.`,
            )
          }
          if (!Number.isFinite(value)) {
            runtimeFailure(
              'ROBOT_JOINT_VALUE_NOT_FINITE',
              `${path}.${jointId}`,
              'Joint command must be finite.',
            )
          }
          if (value < joint.min || value > joint.max) {
            runtimeFailure(
              'ROBOT_JOINT_VALUE_OUT_OF_RANGE',
              `${path}.${jointId}`,
              `Joint command must be within ${joint.min}..${joint.max}.`,
            )
          }
          updates.set(jointId, value)
        }

        const mergedJointValues = Object.fromEntries(definition.joints.map((joint) => [
          joint.id,
          updates.has(joint.id) ? updates.get(joint.id)! : robot.jointValues[joint.id]!,
        ]))
        computeSerialRobotPoseV4(definition, mergedJointValues)
        const nextRobot = Object.freeze({
          ...robot,
          jointValues: Object.freeze(mergedJointValues),
          revision: nextRobotRevisionV4(robot.revision),
        })
        publishRobot(registry, robotId, nextRobot)
      },
      setGripperState: (robotId, state) => {
        const { registry, robot } = requireRobot(robotId)
        if (state !== 'OPEN' && state !== 'CLOSED') {
          runtimeFailure(
            'PROJECT_VALUE_INVALID',
            `$.robots.${robotId}.gripperState`,
            'Gripper state must be OPEN or CLOSED.',
          )
        }
        publishRobot(registry, robotId, Object.freeze({
          ...robot,
          gripperState: state,
          revision: nextRobotRevisionV4(robot.revision),
        }))
      },
      selectToolFrames: (robotId, toolFrameId, tcpFrameId) => {
        const { registry, robot } = requireRobot(robotId)
        const definition = requireDefinition(robotId)
        const framesById = new Map(definition.frames.map((frame) => [frame.id, frame]))
        if (!framesById.has(toolFrameId)) {
          runtimeFailure(
            'ROBOT_FRAME_NOT_FOUND',
            `$.robots.${robotId}.selectedToolFrameId`,
            `Tool Frame ${toolFrameId} does not exist in Robot ${robotId}.`,
          )
        }
        const tcpFrame = framesById.get(tcpFrameId)
        if (tcpFrame === undefined || tcpFrame.role !== 'tcp') {
          runtimeFailure(
            'ROBOT_FRAME_NOT_FOUND',
            `$.robots.${robotId}.selectedTcpFrameId`,
            `TCP Frame ${tcpFrameId} is not a valid TCP in Robot ${robotId}.`,
          )
        }
        publishRobot(registry, robotId, Object.freeze({
          ...robot,
          selectedToolFrameId: toolFrameId,
          selectedTcpFrameId: tcpFrameId,
          revision: nextRobotRevisionV4(robot.revision),
        }))
      },
      setNumericStatus: (robotId, value, writer) => {
        const { registry, robot } = requireRobot(robotId)
        const owner = context.statusSourcesByRobotId.get(robotId)
        if (owner === undefined) {
          runtimeFailure(
            'ROBOT_INSTANCE_NOT_FOUND',
            `$.robots.${robotId}`,
            `Robot Instance ${robotId} does not have a published Status owner.`,
          )
        }
        if (writer !== owner) {
          runtimeFailure(
            'ROBOT_STATUS_SOURCE_OWNERSHIP_CONFLICT',
            `$.robots.${robotId}.numericStatus.sourceOwnership`,
            `Writer ${writer} does not own Robot ${robotId} numeric Status.`,
          )
        }
        if (!Number.isFinite(value)) {
          runtimeFailure(
            'ROBOT_STATUS_VALUE_NOT_FINITE',
            `$.robots.${robotId}.numericStatus.value`,
            'Numeric Status must be finite.',
          )
        }
        publishRobot(registry, robotId, Object.freeze({
          ...robot,
          numericStatus: value,
          revision: nextRobotRevisionV4(robot.revision),
        }))
      },
      captureCheckpoint: () => {
        const checkpoint = Object.freeze({
          kind: 'robot-runtime-checkpoint-v4' as const,
        })
        checkpoints.set(checkpoint, { state: get(), context })
        return checkpoint
      },
      restoreCheckpoint: (checkpoint) => {
        if (checkpoint === null || typeof checkpoint !== 'object') {
          runtimeFailure(
            'ROBOT_RUNTIME_CHECKPOINT_INVALID',
            '$.checkpoint',
            'Robot runtime checkpoint is not owned by this registry.',
          )
        }
        const captured = checkpoints.get(checkpoint)
        if (captured === undefined) {
          runtimeFailure(
            'ROBOT_RUNTIME_CHECKPOINT_INVALID',
            '$.checkpoint',
            'Robot runtime checkpoint is not owned by this registry.',
          )
        }
        context = captured.context
        set(captured.state, true)
      },
    }
  })
}
