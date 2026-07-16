import { describe, expect, it } from 'vitest'
import {
  ProjectV4Error,
  type FrameDefinitionV4,
  type RobotJointSourceV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  makeMinimalWorkcellProjectV4,
  projectAtLimit,
} from '../../../core/project-v4/test-support.js'
import {
  buildInitialRobotRuntimeStatesV4,
  createRobotRuntimeRegistryV4,
  type RobotRuntimeRegistryV4,
} from './robot-runtime-registry.js'
import type { StoreApi } from 'zustand/vanilla'

type Registry = StoreApi<RobotRuntimeRegistryV4>

interface VariableJointOptions {
  readonly jointSource?: RobotJointSourceV4
  readonly statusSource?: RobotJointSourceV4
  readonly initialValues?: Readonly<Record<string, number>>
  readonly visible?: boolean
  readonly revisionId?: string
}

function withVariableJointIds(
  source: WorkcellProjectV4,
  jointIds: readonly string[],
  options: VariableJointOptions = {},
): WorkcellProjectV4 {
  const project = structuredClone(source)
  const originalDefinition = project.robotDefinitions[0]!
  const originalLink = originalDefinition.links[0]!
  const originalJoint = originalDefinition.joints[0]!
  const links = Array.from({ length: jointIds.length + 1 }, (_, index) => ({
    ...originalLink,
    id: `link-${index}`,
    name: `Link ${index}`,
    geometryOccurrences: index === 0 ? originalLink.geometryOccurrences : [],
  }))
  const joints = jointIds.map((id, index) => ({
    ...originalJoint,
    id,
    parentLinkId: links[index]!.id,
    childLinkId: links[index + 1]!.id,
  }))
  const frames = originalDefinition.frames.map((frame) => {
    if (frame.role === 'base') return { ...frame, parentFrameId: links[0]!.id }
    if (frame.role === 'tool') return { ...frame, parentFrameId: links.at(-1)!.id }
    return frame
  })
  const defaultJointValues = Object.fromEntries(jointIds.map((id) => [id, 0]))
  const initialJointValues = options.initialValues ?? defaultJointValues

  return {
    ...project,
    revisionId: options.revisionId ?? project.revisionId,
    robotDefinitions: [{
      ...originalDefinition,
      links,
      joints,
      frames,
    }],
    robots: project.robots.map((robot) => ({
      ...robot,
      initialJointValues: { ...initialJointValues },
      jointSource: options.jointSource ?? robot.jointSource,
      visible: options.visible ?? robot.visible,
      numericStatus: {
        ...robot.numericStatus,
        sourceOwnership: options.statusSource ?? robot.numericStatus.sourceOwnership,
      },
    })),
  }
}

function withExtraDefinitionFrames(
  source: WorkcellProjectV4,
  selected = false,
): WorkcellProjectV4 {
  const project = structuredClone(source)
  const definition = project.robotDefinitions[0]!
  const tipLinkId = definition.links.at(-1)!.id
  const extraFrames: readonly FrameDefinitionV4[] = [
    {
      id: 'ToolAlt',
      name: 'Alternate Tool',
      parentFrameId: tipLinkId,
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      role: 'tool',
    },
    {
      id: 'TCPAlt',
      name: 'Alternate TCP',
      parentFrameId: 'ToolAlt',
      localPose: { positionM: [0, 0, 0.1], quaternion: [0, 0, 0, 1] },
      role: 'tcp',
    },
    {
      id: 'InspectionFrame',
      name: 'Inspection Frame',
      parentFrameId: tipLinkId,
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      role: 'custom',
    },
  ]

  return {
    ...project,
    robotDefinitions: [{
      ...definition,
      frames: [...definition.frames, ...extraFrames],
    }],
    robots: project.robots.map((robot) => selected
      ? { ...robot, selectedToolFrameId: 'ToolAlt', selectedTcpFrameId: 'TCPAlt' }
      : robot),
  }
}

function withOpcUaOwner(
  source: WorkcellProjectV4,
  owner: `opcua:${string}`,
): WorkcellProjectV4 {
  const endpointId = owner.slice('opcua:'.length)
  const project = structuredClone(source)
  return {
    ...project,
    robots: project.robots.map((robot) => ({ ...robot, jointSource: owner })),
    opcUa: {
      ...project.opcUa,
      mode: 'client',
      endpoints: [{
        endpointId,
        name: 'Test endpoint',
        endpointUrl: 'opc.tcp://127.0.0.1:4840',
        enabled: true,
        publishingIntervalMs: 100,
        reconnectDelayMs: 1_000,
      }],
    },
  }
}

function expectRejectedWithoutPublication(
  registry: Registry,
  command: () => void,
  expectedCode: string,
): ProjectV4Error {
  const beforeState = registry.getState()
  const beforeRobots = beforeState.robots
  let notifications = 0
  const unsubscribe = registry.subscribe(() => { notifications += 1 })

  let error: unknown
  try {
    command()
  } catch (caught) {
    error = caught
  }

  unsubscribe()
  expect(error).toBeInstanceOf(ProjectV4Error)
  expect((error as ProjectV4Error).code).toBe(expectedCode)
  expect(registry.getState()).toBe(beforeState)
  expect(registry.getState().robots).toBe(beforeRobots)
  expect(notifications).toBe(0)
  return error as ProjectV4Error
}

describe('RobotRuntimeRegistryV4', () => {
  it('keeps two Instances sharing one Definition independent by Robot ID', () => {
    const project = projectAtLimit('robots', 2)
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(project)

    const before = registry.getState().robots
    const robotB = before['robot-2']
    expect(before['robot-1']?.jointValues).not.toBe(robotB?.jointValues)

    registry.getState().writeJointValues('robot-1', { J1: 45 }, 'simulation')
    expect(registry.getState().robots['robot-1']?.jointValues.J1).toBe(45)
    expect(registry.getState().robots['robot-2']?.jointValues.J1).toBe(0)
    expect(registry.getState().robots['robot-2']).toBe(robotB)
  })

  it('accepts only the persisted owner for a nonempty partial Joint write', () => {
    const project = withVariableJointIds(
      makeMinimalWorkcellProjectV4(),
      ['axis-a', 'slide-z'],
      { jointSource: 'manual' },
    )
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(project)

    registry.getState().writeJointValues('robot-1', { 'slide-z': 0.25 }, 'manual')
    expect(registry.getState().robots['robot-1']?.jointValues).toEqual({
      'axis-a': 0,
      'slide-z': 0.25,
    })

    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().writeJointValues('robot-1', { 'axis-a': 5 }, 'simulation'),
      'ROBOT_JOINT_SOURCE_OWNERSHIP_CONFLICT',
    )
  })

  it.each([1, 8])('publishes %i Robot Instances atomically', (count) => {
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(projectAtLimit('robots', count))
    expect(Object.keys(registry.getState().robots)).toHaveLength(count)
  })

  it('rejects a ninth Robot before replacing or notifying the prior registry', () => {
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(makeMinimalWorkcellProjectV4())
    const priorRevision = registry.getState().projectRevisionId

    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().replaceProject(projectAtLimit('robots', 9)),
      'ROBOT_INSTANCE_LIMIT_EXCEEDED',
    )
    expect(registry.getState().projectRevisionId).toBe(priorRevision)
  })

  it.each([1, 16])('initializes exact literal IDs for a %i-Joint Definition', (count) => {
    const ids = Array.from({ length: count }, (_, index) => (
      index === 0 ? 'axis-a' : index === 1 ? 'slide-z' : `joint-${index + 1}`
    ))
    const project = withVariableJointIds(projectAtLimit('joints', count), ids)
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(project)

    const jointValues = registry.getState().robots['robot-1']!.jointValues
    expect(Object.keys(jointValues)).toEqual(ids)
    expect(Array.isArray(jointValues)).toBe(false)
    expect(Object.hasOwn(jointValues, '0')).toBe(false)
  })

  it('copies persisted initialization fields and freezes owned snapshots', () => {
    let project = withVariableJointIds(
      makeMinimalWorkcellProjectV4(),
      ['axis-a', 'slide-z'],
      {
        jointSource: 'manual',
        statusSource: 'manual',
        initialValues: { 'axis-a': 12, 'slide-z': -4 },
        visible: false,
      },
    )
    project = withExtraDefinitionFrames(project, true)
    project = {
      ...project,
      robots: project.robots.map((robot) => ({
        ...robot,
        numericStatus: { ...robot.numericStatus, value: 42 },
      })),
    }
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(project)
    const robot = registry.getState().robots['robot-1']!

    expect(robot).toMatchObject({
      robotId: 'robot-1',
      definitionId: 'definition-1',
      jointValues: { 'axis-a': 12, 'slide-z': -4 },
      jointSource: 'manual',
      gripperState: 'OPEN',
      selectedToolFrameId: 'ToolAlt',
      selectedTcpFrameId: 'TCPAlt',
      numericStatus: 42,
      visible: false,
      revision: 0,
    })
    expect(Object.isFrozen(registry.getState().robots)).toBe(true)
    expect(Object.isFrozen(robot)).toBe(true)
    expect(Object.isFrozen(robot.jointValues)).toBe(true)

    ;(project.robots[0]!.initialJointValues as Record<string, number>)['axis-a'] = 99
    expect(registry.getState().robots['robot-1']!.jointValues['axis-a']).toBe(12)
  })

  it('accepts one-key and multi-key partial Joint writes', () => {
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(withVariableJointIds(
      makeMinimalWorkcellProjectV4(),
      ['axis-a', 'slide-z', 'wrist'],
    ))

    registry.getState().writeJointValues('robot-1', { 'axis-a': 10 }, 'simulation')
    registry.getState().writeJointValues('robot-1', { 'slide-z': 20, wrist: -30 }, 'simulation')
    expect(registry.getState().robots['robot-1']!.jointValues).toEqual({
      'axis-a': 10,
      'slide-z': 20,
      wrist: -30,
    })
  })

  it('rejects invalid partial Joint writes without partial application', () => {
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(withVariableJointIds(
      makeMinimalWorkcellProjectV4(),
      ['axis-a', 'slide-z'],
    ))

    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().writeJointValues('robot-1', {}, 'simulation'),
      'ROBOT_JOINT_UPDATE_EMPTY',
    )
    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().writeJointValues('missing-robot', { 'axis-a': 1 }, 'simulation'),
      'ROBOT_INSTANCE_NOT_FOUND',
    )
    const unknownError = expectRejectedWithoutPublication(
      registry,
      () => registry.getState().writeJointValues('robot-1', { 'missing-axis': 1 }, 'simulation'),
      'ROBOT_JOINT_NOT_FOUND',
    )
    expect(unknownError.path).toBe('$.robots.robot-1.jointValues.missing-axis')
    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().writeJointValues('robot-1', { 'axis-a': Number.NaN }, 'simulation'),
      'ROBOT_JOINT_VALUE_NOT_FINITE',
    )
    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().writeJointValues('robot-1', { 'axis-a': 181 }, 'simulation'),
      'ROBOT_JOINT_VALUE_OUT_OF_RANGE',
    )
    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().writeJointValues(
        'robot-1',
        { 'axis-a': 50, 'missing-axis': 1 },
        'simulation',
      ),
      'ROBOT_JOINT_NOT_FOUND',
    )
    expect(registry.getState().robots['robot-1']!.jointValues['axis-a']).toBe(0)
  })

  it('rejects non-plain partial Joint records before reading them', () => {
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(makeMinimalWorkcellProjectV4())
    const inherited = Object.create({ J1: 1 }) as Record<string, number>
    const accessor = {} as Record<string, number>
    Object.defineProperty(accessor, 'J1', {
      enumerable: true,
      get: () => { throw new Error('must not invoke accessor') },
    })
    const symbolKeyed = { J1: 1 } as Record<string, number>
    Object.defineProperty(symbolKeyed, Symbol('hidden'), {
      enumerable: true,
      value: 2,
    })

    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().writeJointValues('robot-1', inherited, 'simulation'),
      'PROJECT_VALUE_INVALID',
    )
    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().writeJointValues('robot-1', accessor, 'simulation'),
      'PROJECT_VALUE_INVALID',
    )
    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().writeJointValues(
        'robot-1',
        [] as unknown as Record<string, number>,
        'simulation',
      ),
      'PROJECT_VALUE_INVALID',
    )
    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().writeJointValues('robot-1', symbolKeyed, 'simulation'),
      'PROJECT_VALUE_INVALID',
    )
  })

  it('publishes prototype-looking Robot and Joint IDs as literal own keys', () => {
    let project = withVariableJointIds(
      makeMinimalWorkcellProjectV4(),
      ['__proto__', 'constructor', 'toString'],
    )
    project = {
      ...project,
      robots: project.robots.map((robot) => ({ ...robot, id: '__proto__' })),
    }
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(project)

    const robots = registry.getState().robots
    const jointValues = robots['__proto__']!.jointValues
    expect(Object.hasOwn(robots, '__proto__')).toBe(true)
    expect(Object.hasOwn(jointValues, '__proto__')).toBe(true)
    expect(Object.hasOwn(jointValues, 'constructor')).toBe(true)
    expect(Object.hasOwn(jointValues, 'toString')).toBe(true)
    registry.getState().writeJointValues(
      '__proto__',
      Object.fromEntries([['__proto__', 4]]),
      'simulation',
    )
    registry.getState().writeJointValues('__proto__', { constructor: 5 }, 'simulation')
    expect(registry.getState().robots['__proto__']!.jointValues['__proto__']).toBe(4)
    expect(registry.getState().robots['__proto__']!.jointValues.constructor).toBe(5)
  })

  it.each<RobotJointSourceV4>(['simulation', 'manual', 'opcua:endpoint-a'])(
    'enforces the exact persisted %s Joint owner',
    (owner) => {
      const base = withVariableJointIds(
        makeMinimalWorkcellProjectV4(),
        ['axis-a'],
        { jointSource: owner },
      )
      const project = owner.startsWith('opcua:')
        ? withOpcUaOwner(base, owner as `opcua:${string}`)
        : base
      const registry = createRobotRuntimeRegistryV4()
      registry.getState().replaceProject(project)

      registry.getState().writeJointValues('robot-1', { 'axis-a': 5 }, owner)
      expect(registry.getState().robots['robot-1']!.jointValues['axis-a']).toBe(5)
      const wrongOwner: RobotJointSourceV4 = owner === 'manual' ? 'simulation' : 'manual'
      expectRejectedWithoutPublication(
        registry,
        () => registry.getState().writeJointValues('robot-1', { 'axis-a': 6 }, wrongOwner),
        'ROBOT_JOINT_SOURCE_OWNERSHIP_CONFLICT',
      )
    },
  )

  it('enforces numeric Status ownership independently from Joint ownership', () => {
    const project = withVariableJointIds(
      makeMinimalWorkcellProjectV4(),
      ['axis-a'],
      { jointSource: 'simulation', statusSource: 'manual' },
    )
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(project)

    registry.getState().setNumericStatus('robot-1', 7, 'manual')
    expect(registry.getState().robots['robot-1']!.numericStatus).toBe(7)
    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().setNumericStatus('robot-1', 8, 'simulation'),
      'ROBOT_STATUS_SOURCE_OWNERSHIP_CONFLICT',
    )
    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().setNumericStatus('robot-1', Number.POSITIVE_INFINITY, 'manual'),
      'ROBOT_STATUS_VALUE_NOT_FINITE',
    )
  })

  it('selects Tool and TCP Frames only within the addressed Robot Definition', () => {
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(withExtraDefinitionFrames(projectAtLimit('robots', 2)))
    const robotBBefore = registry.getState().robots['robot-2']

    registry.getState().selectToolFrames('robot-1', 'ToolAlt', 'TCPAlt')
    expect(registry.getState().robots['robot-1']).toMatchObject({
      selectedToolFrameId: 'ToolAlt',
      selectedTcpFrameId: 'TCPAlt',
    })
    expect(registry.getState().robots['robot-2']).toBe(robotBBefore)
    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().selectToolFrames('robot-1', 'MissingTool', 'TCPAlt'),
      'ROBOT_FRAME_NOT_FOUND',
    )
    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().selectToolFrames('robot-1', 'ToolAlt', 'MissingTcp'),
      'ROBOT_FRAME_NOT_FOUND',
    )
    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().selectToolFrames('robot-1', 'ToolAlt', 'InspectionFrame'),
      'ROBOT_FRAME_NOT_FOUND',
    )
  })

  it('validates runtime Gripper states without changing Project-owned data', () => {
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(makeMinimalWorkcellProjectV4())
    registry.getState().setGripperState('robot-1', 'CLOSED')
    expect(registry.getState().robots['robot-1']!.gripperState).toBe('CLOSED')

    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().setGripperState('robot-1', 'INVALID' as 'OPEN'),
      'PROJECT_VALUE_INVALID',
    )
  })

  it('increments only the addressed Robot revision and preserves clone boundaries', () => {
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(projectAtLimit('robots', 2))
    const robotsBefore = registry.getState().robots
    const robotABefore = robotsBefore['robot-1']
    const robotBBefore = robotsBefore['robot-2']

    registry.getState().writeJointValues('robot-1', { J1: 1 }, 'simulation')
    const afterFirst = registry.getState().robots
    registry.getState().setGripperState('robot-1', 'OPEN')
    const afterSecond = registry.getState().robots

    expect(afterFirst).not.toBe(robotsBefore)
    expect(afterFirst['robot-1']).not.toBe(robotABefore)
    expect(afterFirst['robot-2']).toBe(robotBBefore)
    expect(afterSecond['robot-1']!.revision).toBe(2)
    expect(afterSecond['robot-2']!.revision).toBe(0)
    expect(Number.isSafeInteger(afterSecond['robot-1']!.revision)).toBe(true)
  })

  it('rejects a Robot revision that cannot be safely incremented', () => {
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(makeMinimalWorkcellProjectV4())
    const current = registry.getState()
    const robot = current.robots['robot-1']!
    registry.setState({
      ...current,
      robots: Object.freeze({
        ...current.robots,
        'robot-1': Object.freeze({ ...robot, revision: Number.MAX_SAFE_INTEGER }),
      }),
    }, true)

    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().setGripperState('robot-1', 'CLOSED'),
      'ROBOT_RUNTIME_REVISION_EXHAUSTED',
    )
  })

  it('resets every live field from persisted data in one notification', () => {
    let project = withVariableJointIds(
      makeMinimalWorkcellProjectV4(),
      ['axis-a', 'slide-z'],
      {
        jointSource: 'manual',
        statusSource: 'manual',
        initialValues: { 'axis-a': 3, 'slide-z': 4 },
        visible: false,
      },
    )
    project = withExtraDefinitionFrames(project, true)
    project = {
      ...project,
      robots: project.robots.map((robot) => ({
        ...robot,
        numericStatus: { ...robot.numericStatus, value: 9 },
      })),
    }
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(project)
    registry.getState().writeJointValues('robot-1', { 'axis-a': 10 }, 'manual')
    registry.getState().setNumericStatus('robot-1', 11, 'manual')
    registry.getState().setGripperState('robot-1', 'CLOSED')
    registry.getState().selectToolFrames('robot-1', 'Tool', 'TCP')

    let notifications = 0
    const unsubscribe = registry.subscribe(() => { notifications += 1 })
    registry.getState().reset(project)
    unsubscribe()

    expect(notifications).toBe(1)
    expect(registry.getState().robots['robot-1']).toMatchObject({
      jointValues: { 'axis-a': 3, 'slide-z': 4 },
      numericStatus: 9,
      visible: false,
      selectedToolFrameId: 'ToolAlt',
      selectedTcpFrameId: 'TCPAlt',
      gripperState: 'OPEN',
      revision: 0,
    })
  })

  it('builds pure frozen preflight state without touching a registry', () => {
    const registry = createRobotRuntimeRegistryV4()
    const before = registry.getState()
    let notifications = 0
    const unsubscribe = registry.subscribe(() => { notifications += 1 })
    const project = projectAtLimit('robots', 2)

    const robots = buildInitialRobotRuntimeStatesV4(project)
    unsubscribe()

    expect(Object.keys(robots)).toEqual(['robot-1', 'robot-2'])
    expect(Object.isFrozen(robots)).toBe(true)
    expect(registry.getState()).toBe(before)
    expect(notifications).toBe(0)
    ;(project.robots[0]!.initialJointValues as Record<string, number>).J1 = 99
    expect(robots['robot-1']!.jointValues.J1).toBe(0)
  })

  it('retains validated limits, Frames, and both owners after caller mutation', () => {
    const project = withExtraDefinitionFrames(makeMinimalWorkcellProjectV4())
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(project)

    ;(project.robotDefinitions[0]!.joints[0] as { max: number }).max = 0
    ;(project.robotDefinitions[0]!.frames.find(({ id }) => id === 'TCPAlt') as {
      role: string
    }).role = 'custom'
    ;(project.robots[0] as { jointSource: RobotJointSourceV4 }).jointSource = 'manual'
    ;(project.robots[0]!.numericStatus as {
      sourceOwnership: RobotJointSourceV4
    }).sourceOwnership = 'manual'

    registry.getState().writeJointValues('robot-1', { J1: 10 }, 'simulation')
    registry.getState().selectToolFrames('robot-1', 'ToolAlt', 'TCPAlt')
    registry.getState().setNumericStatus('robot-1', 12, 'simulation')
    expect(registry.getState().robots['robot-1']).toMatchObject({
      jointValues: { J1: 10 },
      selectedToolFrameId: 'ToolAlt',
      selectedTcpFrameId: 'TCPAlt',
      numericStatus: 12,
    })
  })

  it('keeps action methods callable across replace, reset, and restore', () => {
    const registry = createRobotRuntimeRegistryV4()
    const initial = registry.getState()
    const methods = {
      replaceProject: initial.replaceProject,
      reset: initial.reset,
      writeJointValues: initial.writeJointValues,
      setGripperState: initial.setGripperState,
      selectToolFrames: initial.selectToolFrames,
      setNumericStatus: initial.setNumericStatus,
      captureCheckpoint: initial.captureCheckpoint,
      restoreCheckpoint: initial.restoreCheckpoint,
    }
    const project = makeMinimalWorkcellProjectV4()

    registry.getState().replaceProject(project)
    expect(registry.getState()).toMatchObject(methods)
    const checkpoint = registry.getState().captureCheckpoint()
    registry.getState().reset({ ...project, revisionId: 'revision-reset' })
    expect(registry.getState()).toMatchObject(methods)
    registry.getState().restoreCheckpoint(checkpoint)
    expect(registry.getState()).toMatchObject(methods)
    registry.getState().writeJointValues('robot-1', { J1: 1 }, 'simulation')
    expect(registry.getState().robots['robot-1']!.jointValues.J1).toBe(1)
  })

  it('restores an exact checkpoint state and its private validation context once', () => {
    let projectA = withVariableJointIds(
      makeMinimalWorkcellProjectV4(),
      ['axis-a'],
      {
        jointSource: 'manual',
        statusSource: 'manual',
        revisionId: 'revision-a',
      },
    )
    projectA = withExtraDefinitionFrames(projectA)
    projectA = {
      ...projectA,
      robotDefinitions: projectA.robotDefinitions.map((definition) => ({
        ...definition,
        joints: definition.joints.map((joint) => ({ ...joint, max: 10 })),
      })),
    }
    const projectB = {
      ...makeMinimalWorkcellProjectV4(),
      revisionId: 'revision-b',
    }
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(projectA)
    const capturedState = registry.getState()
    const capturedRobots = capturedState.robots
    const checkpoint = registry.getState().captureCheckpoint()
    registry.getState().replaceProject(projectB)

    let notifications = 0
    const unsubscribe = registry.subscribe(() => { notifications += 1 })
    registry.getState().restoreCheckpoint(checkpoint)
    unsubscribe()

    expect(notifications).toBe(1)
    expect(registry.getState()).toBe(capturedState)
    expect(registry.getState().robots).toBe(capturedRobots)
    registry.getState().writeJointValues('robot-1', { 'axis-a': 7 }, 'manual')
    registry.getState().setNumericStatus('robot-1', 8, 'manual')
    registry.getState().selectToolFrames('robot-1', 'ToolAlt', 'TCPAlt')
    expect(registry.getState().robots['robot-1']!.jointValues['axis-a']).toBe(7)
    expect(registry.getState().robots['robot-1']).toMatchObject({
      numericStatus: 8,
      selectedToolFrameId: 'ToolAlt',
      selectedTcpFrameId: 'TCPAlt',
    })
    expectRejectedWithoutPublication(
      registry,
      () => registry.getState().writeJointValues('robot-1', { 'axis-a': 11 }, 'manual'),
      'ROBOT_JOINT_VALUE_OUT_OF_RANGE',
    )
  })

  it('rejects forged and cross-registry checkpoints without publication', () => {
    const registryA = createRobotRuntimeRegistryV4()
    const registryB = createRobotRuntimeRegistryV4()
    registryA.getState().replaceProject(makeMinimalWorkcellProjectV4())
    registryB.getState().replaceProject(makeMinimalWorkcellProjectV4())
    const checkpointB = registryB.getState().captureCheckpoint()

    expectRejectedWithoutPublication(
      registryA,
      () => registryA.getState().restoreCheckpoint({ kind: 'robot-runtime-checkpoint-v4' }),
      'ROBOT_RUNTIME_CHECKPOINT_INVALID',
    )
    expectRejectedWithoutPublication(
      registryA,
      () => registryA.getState().restoreCheckpoint(checkpointB),
      'ROBOT_RUNTIME_CHECKPOINT_INVALID',
    )
  })

  it('replaces a valid Project atomically with one complete new revision', () => {
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject({
      ...makeMinimalWorkcellProjectV4(),
      revisionId: 'revision-a',
    })
    const projectB = {
      ...projectAtLimit('robots', 2),
      revisionId: 'revision-b',
    }
    const observations: Array<{ revision: string | null; robotIds: string[] }> = []
    const unsubscribe = registry.subscribe((state) => {
      observations.push({
        revision: state.projectRevisionId,
        robotIds: Object.keys(state.robots),
      })
    })

    registry.getState().replaceProject(projectB)
    unsubscribe()

    expect(observations).toEqual([{
      revision: 'revision-b',
      robotIds: ['robot-1', 'robot-2'],
    }])
  })
})
