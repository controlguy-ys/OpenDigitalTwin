import { describe, expect, it } from 'vitest'
import {
  ProjectV4Error,
  type FrameDefinitionV4,
  type RigidTransformV4,
  type RobotDefinitionV4,
  type RobotInstanceV4,
  type SpatialEntityV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  makeMinimalWorkcellProjectV4,
  projectAtLimit,
} from '../../../core/project-v4/test-support.js'
import {
  createRobotRuntimeRegistryV4,
  type RobotRuntimeRegistryV4,
  type RobotRuntimeStateV4,
} from '../../robot/v4/robot-runtime-registry.js'
import { selectSceneRuntimeV4 } from './scene-runtime-selector.js'

const IDENTITY: RigidTransformV4 = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
}

function pose(x = 0, y = 0, z = 0): RigidTransformV4 {
  return { positionM: [x, y, z], quaternion: [0, 0, 0, 1] }
}

function errorCode(action: () => unknown): string | undefined {
  let error: unknown
  try {
    action()
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(ProjectV4Error)
  return (error as ProjectV4Error).code
}

function runtimeFor(project: WorkcellProjectV4): Pick<
  RobotRuntimeRegistryV4,
  'projectRevisionId' | 'robots'
> {
  const registry = createRobotRuntimeRegistryV4()
  registry.getState().replaceProject(project)
  return registry.getState()
}

function boxEntity(
  id: string,
  overrides: Partial<SpatialEntityV4> = {},
): SpatialEntityV4 {
  return {
    id,
    name: id,
    geometry: { kind: 'box', dimensionsM: [1, 1, 1], color: '#808080' },
    parentFrameId: 'world',
    localPose: IDENTITY,
    visible: true,
    groupId: null,
    removable: true,
    transformOwner: 'manual',
    numericStatus: {
      value: 0,
      sourceOwnership: 'manual',
      overlay: { visible: false, frameId: null },
    },
    graspable: false,
    graspFrames: [],
    movingFrames: [],
    ...overrides,
  }
}

function withSceneOffsets(source: WorkcellProjectV4): WorkcellProjectV4 {
  const project = structuredClone(source)
  return {
    ...project,
    scene: {
      frames: project.scene.frames.map((frame) => frame.role === 'world'
        ? { ...frame, localPose: pose(10, 0, 0) }
        : { ...frame, localPose: pose(0, 20, 0) }),
    },
    robots: project.robots.map((robot, index) => ({
      ...robot,
      localBasePose: pose(index + 1, 0, 0),
    })),
  }
}

function ownRecord<T>(entries: readonly (readonly [string, T])[]): Readonly<Record<string, T>> {
  return Object.freeze(Object.fromEntries(entries))
}

function runtimeState(
  robot: RobotInstanceV4,
  jointValues: Readonly<Record<string, number>>,
): RobotRuntimeStateV4 {
  return Object.freeze({
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
  })
}

describe('selectSceneRuntimeV4', () => {
  it('keeps equal Definition-local Frame IDs separate and composes each Base exactly once', () => {
    const project = withSceneOffsets(projectAtLimit('robots', 2))
    const projection = selectSceneRuntimeV4(project, runtimeFor(project))

    const robotAFrames = projection.robotFramesByRobotId.get('robot-1')!
    const robotBFrames = projection.robotFramesByRobotId.get('robot-2')!
    expect(robotAFrames).not.toBe(robotBFrames)
    expect(robotAFrames.get('Base')?.worldPose.positionM).toEqual([11, 20, 0])
    expect(robotBFrames.get('Base')?.worldPose.positionM).toEqual([12, 20, 0])
    expect(robotAFrames.get('Tool')).not.toBe(robotBFrames.get('Tool'))
    expect(robotAFrames.get('TCP')).not.toBe(robotBFrames.get('TCP'))
    expect(projection.entities.get('robot-1')).toMatchObject({
      kind: 'robot',
      worldBasePose: { positionM: [11, 20, 0] },
    })
  })

  it('moves two mounted Robots with one changed Moving Frame without reparenting', () => {
    const initial = projectAtLimit('robots', 2)
    const entity = boxEntity('track', {
      movingFrames: [{
        frameId: 'carriage',
        name: 'Carriage',
        parentFrameId: 'mcp',
        localPose: pose(5, 0, 0),
        sourceOwnership: 'simulation',
      }],
    })
    const projectA: WorkcellProjectV4 = {
      ...initial,
      spatialEntities: [entity],
      robots: initial.robots.map((robot, index) => ({
        ...robot,
        baseParentFrameId: 'carriage',
        localBasePose: pose(index + 1, 0, 0),
        intentionalMountEntityId: 'track',
      })),
    }
    const before = selectSceneRuntimeV4(projectA, runtimeFor(projectA))
    const projectB: WorkcellProjectV4 = {
      ...projectA,
      revisionId: 'revision-carriage-2',
      spatialEntities: [{
        ...entity,
        movingFrames: [{ ...entity.movingFrames[0]!, localPose: pose(8, 0, 0) }],
      }],
    }
    const after = selectSceneRuntimeV4(projectB, runtimeFor(projectB))

    expect(before.entities.get('robot-1')).toMatchObject({
      worldBasePose: { positionM: [6, 0, 0] },
    })
    expect(before.entities.get('robot-2')).toMatchObject({
      worldBasePose: { positionM: [7, 0, 0] },
    })
    expect(after.entities.get('robot-1')).toMatchObject({
      worldBasePose: { positionM: [9, 0, 0] },
    })
    expect(after.entities.get('robot-2')).toMatchObject({
      worldBasePose: { positionM: [10, 0, 0] },
    })
    expect(after.globalFrames.get('carriage')?.parent).toEqual({
      kind: 'global-frame',
      frameId: 'mcp',
    })
  })

  it('includes the private Entity root once in Grasp World composition', () => {
    const base = makeMinimalWorkcellProjectV4()
    const entity = boxEntity('part', {
      parentFrameId: 'mcp',
      localPose: pose(1, 2, 0),
      graspable: true,
      graspFrames: [{ frameId: 'pick', name: 'Pick', localPose: pose(0, 0, 3) }],
    })
    const project = { ...base, spatialEntities: [entity] }

    const projection = selectSceneRuntimeV4(project, runtimeFor(project))

    expect(projection.entities.get('part')).toMatchObject({
      worldPose: { positionM: [1, 2, 0] },
    })
    expect(projection.globalFrames.get('pick')).toMatchObject({
      frameKind: 'grasp',
      ownerEntityId: 'part',
      parent: { kind: 'spatial-entity-root', entityId: 'part' },
      worldPose: { positionM: [1, 2, 3] },
    })
  })

  it('composes a Moving Frame from its explicit parent rather than its owning Entity root', () => {
    const base = makeMinimalWorkcellProjectV4()
    const entity = boxEntity('track', {
      localPose: pose(100, 0, 0),
      movingFrames: [{
        frameId: 'carriage',
        name: 'Carriage',
        parentFrameId: 'mcp',
        localPose: pose(4, 0, 0),
        sourceOwnership: 'simulation',
      }],
    })
    const project = { ...base, spatialEntities: [entity] }

    const projection = selectSceneRuntimeV4(project, runtimeFor(project))

    const track = projection.entities.get('track')
    expect(track?.kind).toBe('spatial-entity')
    expect(track?.kind === 'spatial-entity' ? track.worldPose.positionM : undefined)
      .toEqual([100, 0, 0])
    expect(projection.globalFrames.get('carriage')).toMatchObject({
      ownerEntityId: 'track',
      frameKind: 'moving',
      worldPose: { positionM: [4, 0, 0] },
    })
  })

  it('derives nested Group visibility without changing transforms, status, or ownership', () => {
    const base = makeMinimalWorkcellProjectV4()
    const entity = boxEntity('hidden-part', {
      groupId: 'child-group',
      localPose: pose(3, 4, 5),
      transformOwner: 'simulation',
      numericStatus: {
        value: 73,
        sourceOwnership: 'simulation',
        overlay: { visible: true, frameId: 'world' },
      },
    })
    const project: WorkcellProjectV4 = {
      ...base,
      sceneGroups: [
        { id: 'parent-group', name: 'Parent', parentGroupId: null, visible: false },
        { id: 'child-group', name: 'Child', parentGroupId: 'parent-group', visible: true },
      ],
      spatialEntities: [entity],
    }

    const projection = selectSceneRuntimeV4(project, runtimeFor(project))

    expect(projection.groups.get('parent-group')).toMatchObject({
      persistedVisible: false,
      effectiveVisible: false,
    })
    expect(projection.groups.get('child-group')).toMatchObject({
      persistedVisible: true,
      effectiveVisible: false,
    })
    expect(projection.entities.get('hidden-part')).toMatchObject({
      persistedVisible: true,
      effectiveVisible: false,
      worldPose: { positionM: [3, 4, 5] },
      transformOwner: 'simulation',
      numericStatus: 73,
    })
    expect(projection.visibleSpatialEntityIds).toEqual([])
  })

  it('namespaces separator, percent, Unicode, and virtual-root-looking raw IDs without collision', () => {
    const base = makeMinimalWorkcellProjectV4()
    const worldId = 'runtime-entity-root:%|世界'
    const mcpId = 'mcp:%|雪'
    const entityId = 'scene-frame:%|부품'
    const graspId = 'grasp:%|손'
    const movingId = 'moving:%|台'
    const project: WorkcellProjectV4 = {
      ...base,
      scene: {
        frames: [
          { ...base.scene.frames[0]!, id: worldId },
          { ...base.scene.frames[1]!, id: mcpId, parentFrameId: worldId, localPose: pose(1, 0, 0) },
        ],
      },
      robots: base.robots.map((robot) => ({ ...robot, baseParentFrameId: movingId })),
      spatialEntities: [boxEntity(entityId, {
        parentFrameId: mcpId,
        localPose: pose(2, 0, 0),
        graspable: true,
        graspFrames: [{ frameId: graspId, name: 'Grasp', localPose: pose(3, 0, 0) }],
        movingFrames: [{
          frameId: movingId,
          name: 'Moving',
          parentFrameId: mcpId,
          localPose: pose(4, 0, 0),
          sourceOwnership: 'simulation',
        }],
      })],
    }
    const robot = project.robots[0]!
    const runtime = {
      projectRevisionId: project.revisionId,
      robots: ownRecord([[robot.id, runtimeState(robot, ownRecord([['J1', 0]]))]]),
    }

    const projection = selectSceneRuntimeV4(project, runtime)

    expect([...projection.globalFrames.keys()]).toEqual([
      worldId,
      mcpId,
      graspId,
      movingId,
    ])
    expect(projection.globalFrames.get(graspId)?.worldPose.positionM).toEqual([6, 0, 0])
    expect(projection.globalFrames.get(movingId)?.worldPose.positionM).toEqual([5, 0, 0])
    const spatialEntity = projection.entities.get(entityId)
    expect(spatialEntity?.kind).toBe('spatial-entity')
    expect(spatialEntity?.kind === 'spatial-entity' ? spatialEntity.worldPose.positionM : undefined)
      .toEqual([3, 0, 0])
    expect(projection.entities.get(robot.id)).toMatchObject({
      worldBasePose: { positionM: [5, 0, 0] },
    })
  })

  it('reads prototype-shaped Robot and Joint IDs only through own data properties', () => {
    const base = makeMinimalWorkcellProjectV4()
    const sourceDefinition = base.robotDefinitions[0]!
    const jointIds = ['__proto__', 'constructor', 'toString'] as const
    const links = Array.from({ length: 4 }, (_, index) => ({
      ...sourceDefinition.links[0]!,
      id: `link-${index}`,
      geometryOccurrences: index === 0 ? sourceDefinition.links[0]!.geometryOccurrences : [],
    }))
    const joints = jointIds.map((id, index) => ({
      ...sourceDefinition.joints[0]!,
      id,
      parentLinkId: links[index]!.id,
      childLinkId: links[index + 1]!.id,
    }))
    const frames: readonly FrameDefinitionV4[] = sourceDefinition.frames.map((frame) => ({
      ...frame,
      parentFrameId: frame.role === 'base'
        ? links[0]!.id
        : frame.role === 'tool'
          ? links.at(-1)!.id
          : frame.parentFrameId,
    }))
    const definition: RobotDefinitionV4 = { ...sourceDefinition, links, joints, frames }
    const robotIds = ['__proto__', 'constructor', 'toString'] as const
    const jointValues = ownRecord(jointIds.map((id) => [id, 0] as const))
    const robots = robotIds.map((id): RobotInstanceV4 => ({
      ...base.robots[0]!,
      id,
      initialJointValues: jointValues,
    }))
    const project: WorkcellProjectV4 = {
      ...base,
      robotDefinitions: [definition],
      robots,
    }
    const inheritedReads: string[] = []
    const prototype = Object.defineProperties({}, Object.fromEntries(
      robotIds.map((id) => [id, {
        enumerable: true,
        get: () => {
          inheritedReads.push(id)
          throw new Error(`prototype getter read: ${id}`)
        },
      }]),
    ))
    const runtimeRobots = Object.create(prototype) as Record<string, RobotRuntimeStateV4>
    robots.forEach((robot) => {
      Object.defineProperty(runtimeRobots, robot.id, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: runtimeState(robot, jointValues),
      })
    })
    const runtime = { projectRevisionId: project.revisionId, robots: runtimeRobots }

    const projection = selectSceneRuntimeV4(project, runtime)

    expect(inheritedReads).toEqual([])
    expect([...projection.entities.keys()]).toEqual(robotIds)
    for (const id of robotIds) {
      const entity = projection.entities.get(id)
      expect(entity?.kind).toBe('robot')
      if (entity?.kind === 'robot') {
        expect(Object.keys(entity.serialPose.jointValues)).toEqual(jointIds)
        expect(Object.hasOwn(entity.serialPose.jointValues, '__proto__')).toBe(true)
      }
    }
  })

  it.each([
    [null, 'SCENE_RUNTIME_REVISION_MISMATCH'],
    ['stale-revision', 'SCENE_RUNTIME_REVISION_MISMATCH'],
  ])('rejects a %s registry revision before touching projection data', (revision, code) => {
    const project = makeMinimalWorkcellProjectV4()
    const robots = Object.create(null) as Record<string, RobotRuntimeStateV4>
    Object.defineProperty(robots, project.robots[0]!.id, {
      enumerable: true,
      get: () => { throw new Error('projection should not start') },
    })

    expect(errorCode(() => selectSceneRuntimeV4(project, {
      projectRevisionId: revision,
      robots,
    }))).toBe(code)
  })

  it.each([
    ['missing Robot', (_project: WorkcellProjectV4, _state: RobotRuntimeStateV4) => ownRecord<RobotRuntimeStateV4>([])],
    ['extra Robot', (project: WorkcellProjectV4, state: RobotRuntimeStateV4) => ownRecord([
      [project.robots[0]!.id, state],
      ['extra', { ...state, robotId: 'extra' }],
    ])],
    ['mismatched Robot ID', (project: WorkcellProjectV4, state: RobotRuntimeStateV4) => ownRecord([
      [project.robots[0]!.id, { ...state, robotId: 'other' }],
    ])],
    ['mismatched Definition ID', (project: WorkcellProjectV4, state: RobotRuntimeStateV4) => ownRecord([
      [project.robots[0]!.id, { ...state, definitionId: 'other-definition' }],
    ])],
  ])('rejects an inconsistent runtime Robot set: %s', (_label, makeRobots) => {
    const project = makeMinimalWorkcellProjectV4()
    const robot = project.robots[0]!
    const state = runtimeState(robot, ownRecord([['J1', 0]]))

    expect(errorCode(() => selectSceneRuntimeV4(project, {
      projectRevisionId: project.revisionId,
      robots: makeRobots(project, state),
    }))).toBe('SCENE_RUNTIME_ROBOT_SET_MISMATCH')
  })

  it('keeps Scene and Moving Frames visible while Grasp follows Group visibility and mounted Robot does not', () => {
    const base = makeMinimalWorkcellProjectV4()
    const hiddenTrack = boxEntity('track', {
      groupId: 'hidden-group',
      visible: true,
      localPose: pose(50, 0, 0),
      graspable: true,
      graspFrames: [{ frameId: 'grasp', name: 'Grasp', localPose: pose(1, 0, 0) }],
      movingFrames: [{
        frameId: 'carriage',
        name: 'Carriage',
        parentFrameId: 'mcp',
        localPose: pose(7, 0, 0),
        sourceOwnership: 'simulation',
      }],
    })
    const project: WorkcellProjectV4 = {
      ...base,
      sceneGroups: [{ id: 'hidden-group', name: 'Hidden', parentGroupId: null, visible: false }],
      spatialEntities: [hiddenTrack],
      robots: base.robots.map((robot) => ({
        ...robot,
        baseParentFrameId: 'carriage',
        localBasePose: pose(2, 0, 0),
        intentionalMountEntityId: 'track',
      })),
    }

    const projection = selectSceneRuntimeV4(project, runtimeFor(project))

    expect(projection.globalFrames.get('world')?.effectiveVisible).toBe(true)
    expect(projection.globalFrames.get('mcp')?.effectiveVisible).toBe(true)
    expect(projection.globalFrames.get('grasp')?.effectiveVisible).toBe(false)
    expect(projection.globalFrames.get('carriage')?.effectiveVisible).toBe(true)
    expect(projection.entities.get('track')?.effectiveVisible).toBe(false)
    expect(projection.entities.get('robot-1')).toMatchObject({
      effectiveVisible: true,
      worldBasePose: { positionM: [9, 0, 0] },
    })
    expect(projection.visibleRobotIds).toEqual(['robot-1'])
  })

  it('publishes only Robot and Spatial Entity kinds in deterministic Project order', () => {
    const base = projectAtLimit('robots', 2)
    const project = {
      ...base,
      spatialEntities: [
        boxEntity('entity-b'),
        boxEntity('entity-hidden', { visible: false }),
        boxEntity('entity-a'),
      ],
    }
    const projection = selectSceneRuntimeV4(project, runtimeFor(project))

    expect([...projection.entities.values()].map(({ kind }) => kind)).toEqual([
      'robot',
      'robot',
      'spatial-entity',
      'spatial-entity',
      'spatial-entity',
    ])
    expect(projection.visibleRobotIds).toEqual(['robot-1', 'robot-2'])
    expect(projection.visibleSpatialEntityIds).toEqual(['entity-b', 'entity-a'])
  })

  it('rejects a raw Entity ID shared by a Robot and Spatial Entity before projection', () => {
    const base = makeMinimalWorkcellProjectV4()
    const robotId = base.robots[0]!.id
    const project: WorkcellProjectV4 = {
      ...base,
      spatialEntities: [boxEntity(robotId)],
    }
    const runtime = runtimeFor(base)

    expect(errorCode(() => selectSceneRuntimeV4(project, runtime)))
      .toBe('PROJECT_ID_DUPLICATE')
  })

  it('owns frozen projection snapshots instead of retaining caller poses or arrays', () => {
    const base = makeMinimalWorkcellProjectV4()
    const entity = boxEntity('mutable', { localPose: pose(3, 0, 0) })
    const project: WorkcellProjectV4 = { ...base, spatialEntities: [entity] }
    const publishedRuntime = runtimeFor(project)
    const publishedRobot = publishedRuntime.robots['robot-1']!
    const runtime = {
      projectRevisionId: publishedRuntime.projectRevisionId,
      robots: {
        'robot-1': {
          ...publishedRobot,
          jointValues: { ...publishedRobot.jointValues },
        },
      },
    }
    const projection = selectSceneRuntimeV4(project, runtime)

    ;(entity.localPose.positionM as unknown as number[])[0] = 99
    ;(project.spatialEntities as SpatialEntityV4[]).push(boxEntity('later'))
    ;(runtime.robots['robot-1']!.jointValues as Record<string, number>).J1 = 45

    const mutable = projection.entities.get('mutable')
    expect(mutable?.kind).toBe('spatial-entity')
    expect(mutable?.kind === 'spatial-entity' ? mutable.worldPose.positionM : undefined)
      .toEqual([3, 0, 0])
    expect(projection.entities.has('later')).toBe(false)
    const robot = projection.entities.get('robot-1')
    expect(robot?.kind === 'robot' ? robot.serialPose.jointValues.J1 : undefined).toBe(0)
    expect(Object.isFrozen(projection)).toBe(true)
    expect(Object.isFrozen(projection.visibleRobotIds)).toBe(true)
    expect(Object.isFrozen(projection.entities.get('mutable'))).toBe(true)
    expect('set' in projection.entities).toBe(false)
  })
})
