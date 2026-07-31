import type { RigidTransformV4 } from './rigid-transform'
import { MAX_ROBOT_DEFINITION_TRIANGLES_V4 } from './limits'
import type {
  AssetReferenceV4,
  FrameDefinitionV4,
  GeometryStatisticsV4,
  RobotActionDefinitionV4,
  RobotDefinitionV4,
  RobotInstanceV4,
  RobotJointDefinitionV4,
  RobotLinkDefinitionV4,
  SceneGroupV4,
  SpatialEntityV4,
  WorkcellProjectV4,
} from './types'

export type ProjectLimitFieldV4 =
  | 'robots'
  | 'robotDefinitions'
  | 'joints'
  | 'robotSources'
  | 'spatialEntities'
  | 'sceneGroups'
  | 'movingFramesPerEntity'
  | 'totalFrames'
  | 'actions'

interface MinimalProjectOptionsV4 {
  readonly scaledTransforms?: boolean
}

const ZERO_STATISTICS: GeometryStatisticsV4 = {
  vertices: 0,
  triangles: 0,
  meshes: 0,
  materials: 0,
}

function identityPose(quaternionScale = 1): RigidTransformV4 {
  return {
    positionM: [0, 0, 0],
    quaternion: [0, 0, 0, quaternionScale],
  }
}

function makeAssetReference(id = 'asset-robot'): AssetReferenceV4 {
  return {
    id,
    uri: `asset://local/${id}.step`,
    sha256: '0'.repeat(64),
    byteLength: 1,
    sourceFileName: `${id}.step`,
    mediaType: 'model/step',
  }
}

function makeDefinition(
  index = 1,
  jointCount = 1,
  triangleCount = 0,
  quaternionScale = 1,
  assetReferenceIds: readonly string[] = ['asset-robot'],
): RobotDefinitionV4 {
  const links: RobotLinkDefinitionV4[] = Array.from(
    { length: jointCount + 1 },
    (_, linkIndex) => ({
      id: `L${linkIndex}`,
      name: `Link ${linkIndex}`,
      geometryOccurrences: linkIndex === 0
        ? [{
            occurrenceKey: `robot-${index}-occurrence`,
            assetReferenceId: assetReferenceIds[0] ?? 'asset-robot',
            linkLocalPose: identityPose(),
            statistics: {
              vertices: triangleCount * 3,
              triangles: triangleCount,
              meshes: triangleCount === 0 ? 0 : 1,
              materials: triangleCount === 0 ? 0 : 1,
            },
            collisionBoxes: [],
          }]
        : [],
    }),
  )
  const joints: RobotJointDefinitionV4[] = Array.from(
    { length: jointCount },
    (_, jointIndex) => ({
      id: `J${jointIndex + 1}`,
      type: 'revolute',
      parentLinkId: `L${jointIndex}`,
      childLinkId: `L${jointIndex + 1}`,
      origin: identityPose(quaternionScale),
      axis: [0, 0, 1],
      min: -180,
      max: 180,
      home: 0,
      zeroOffset: 0,
      direction: 1,
      maximumVelocity: 90,
    }),
  )
  const finalLinkId = `L${jointCount}`
  const frames: FrameDefinitionV4[] = [
    { id: 'Base', name: 'Base', parentFrameId: 'L0', localPose: identityPose(), role: 'base' },
    {
      id: 'Tool',
      name: 'Tool',
      parentFrameId: finalLinkId,
      localPose: identityPose(),
      role: 'tool',
    },
    { id: 'TCP', name: 'TCP', parentFrameId: 'Tool', localPose: identityPose(), role: 'tcp' },
  ]

  return {
    id: `definition-${index}`,
    name: `Robot Definition ${index}`,
    manufacturer: 'Generic',
    model: `Model ${index}`,
    assetReferenceIds,
    sourceConventions: Object.fromEntries(assetReferenceIds.map((assetId) => [assetId, {
      linearUnit: 'millimeter',
      sourceToMeters: 0.001,
      orientation: { mode: 'up-axis', upAxis: 'z' },
    }])),
    links,
    joints,
    frames,
    excludedGeometryOccurrenceKeys: [],
  }
}

function makeRobot(index = 1, definitionIndex = 1): RobotInstanceV4 {
  return {
    id: `robot-${index}`,
    name: `Robot ${index}`,
    definitionId: `definition-${definitionIndex}`,
    visible: true,
    baseParentFrameId: 'mcp',
    localBasePose: identityPose(),
    initialJointValues: { J1: 0 },
    jointSource: 'simulation',
    selectedToolFrameId: 'Tool',
    selectedTcpFrameId: 'TCP',
    numericStatus: {
      value: 0,
      sourceOwnership: 'simulation',
      overlay: { visible: false, frameId: null },
    },
    intentionalMountEntityId: null,
  }
}

function makeSpatialEntity(index: number): SpatialEntityV4 {
  return {
    id: `entity-${index}`,
    name: `Entity ${index}`,
    geometry: { kind: 'box', dimensionsM: [1, 1, 1], color: '#808080' },
    parentFrameId: 'world',
    localPose: identityPose(),
    visible: false,
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
  }
}

function cloneProject(project: WorkcellProjectV4): WorkcellProjectV4 {
  return JSON.parse(JSON.stringify(project)) as WorkcellProjectV4
}

export function makeMinimalWorkcellProjectV4(
  options: MinimalProjectOptionsV4 = {},
): WorkcellProjectV4 {
  const quaternionScale = options.scaledTransforms === true ? 2 : 1

  return {
    schemaVersion: 4,
    projectId: 'project-v4',
    revisionId: 'revision-1',
    metadata: {
      name: 'Minimal Project V4',
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    },
    assetReferences: [makeAssetReference()],
    scene: {
      frames: [
        { id: 'world', name: 'World', parentFrameId: null, localPose: identityPose(), role: 'world' },
        { id: 'mcp', name: 'MCP', parentFrameId: 'world', localPose: identityPose(), role: 'mcp' },
      ],
    },
    robotDefinitions: [makeDefinition(1, 1, 0, quaternionScale)],
    robots: [makeRobot()],
    spatialEntities: [],
    sceneGroups: [],
    jobs: [],
    actions: [],
    opcUa: {
      mode: 'off',
      endpoints: [],
      mappings: [],
      actionBindings: [],
      bridgeRoutes: [],
    },
  }
}

export function projectAtLimit(field: ProjectLimitFieldV4, count: number): WorkcellProjectV4 {
  const project = cloneProject(makeMinimalWorkcellProjectV4())

  switch (field) {
    case 'robots':
      return { ...project, robots: Array.from({ length: count }, (_, index) => makeRobot(index + 1)) }
    case 'robotDefinitions':
      return {
        ...project,
        robotDefinitions: Array.from({ length: count }, (_, index) => makeDefinition(index + 1)),
        robots: Array.from({ length: count }, (_, index) => makeRobot(index + 1, index + 1)),
      }
    case 'joints':
      return {
        ...project,
        robotDefinitions: [makeDefinition(1, count)],
        robots: [{
          ...makeRobot(),
          initialJointValues: Object.fromEntries(
            Array.from({ length: count }, (_, index) => [`J${index + 1}`, 0]),
          ),
        }],
      }
    case 'robotSources': {
      const assetReferences = Array.from({ length: count }, (_, index) => (
        makeAssetReference(`asset-robot-${index + 1}`)
      ))
      const assetIds = assetReferences.map(({ id }) => id)
      return {
        ...project,
        assetReferences,
        robotDefinitions: [makeDefinition(1, 1, 0, 1, assetIds)],
      }
    }
    case 'spatialEntities':
      return {
        ...project,
        spatialEntities: Array.from({ length: count }, (_, index) => makeSpatialEntity(index + 1)),
      }
    case 'sceneGroups':
      return {
        ...project,
        sceneGroups: Array.from({ length: count }, (_, index): SceneGroupV4 => ({
          id: `group-${index + 1}`,
          name: `Group ${index + 1}`,
          parentGroupId: null,
          visible: true,
        })),
      }
    case 'movingFramesPerEntity': {
      const entity = makeSpatialEntity(1)
      return {
        ...project,
        spatialEntities: [{
          ...entity,
          movingFrames: Array.from({ length: count }, (_, index) => ({
            frameId: `moving-frame-${index + 1}`,
            name: `Moving Frame ${index + 1}`,
            parentFrameId: 'world',
            localPose: identityPose(),
            sourceOwnership: 'simulation' as const,
          })),
        }],
      }
    }
    case 'totalFrames': {
      const sceneFrameCount = Math.max(2, count - 3)
      const extraFrames = Array.from(
        { length: sceneFrameCount - 2 },
        (_, index): FrameDefinitionV4 => ({
          id: `scene-frame-${index + 1}`,
          name: `Scene Frame ${index + 1}`,
          parentFrameId: 'world',
          localPose: identityPose(),
          role: 'custom',
        }),
      )
      return {
        ...project,
        scene: { frames: [...project.scene.frames, ...extraFrames] },
      }
    }
    case 'actions':
      return {
        ...project,
        actions: Array.from({ length: count }, (_, index): RobotActionDefinitionV4 => ({
          id: `action-${index + 1}`,
          kind: 'set-gripper-state',
          robotId: 'robot-1',
          state: 'OPEN',
        })),
      }
  }
}

export function projectWithMissingDefinition(): WorkcellProjectV4 {
  const project = cloneProject(makeMinimalWorkcellProjectV4())
  return { ...project, robots: [{ ...project.robots[0]!, definitionId: 'missing-definition' }] }
}

export function projectWithFrameCycle(): WorkcellProjectV4 {
  const project = cloneProject(makeMinimalWorkcellProjectV4())
  return {
    ...project,
    scene: {
      frames: [
        project.scene.frames[0]!,
        { ...project.scene.frames[1]!, parentFrameId: 'cycle-frame' },
        {
          id: 'cycle-frame',
          name: 'Cycle Frame',
          parentFrameId: 'mcp',
          localPose: identityPose(),
          role: 'custom',
        },
      ],
    },
  }
}

export function projectWithExtraRootKey(): unknown {
  return { ...makeMinimalWorkcellProjectV4(), unexpected: true }
}

export function projectWithSparseRobots(): unknown {
  const project = makeMinimalWorkcellProjectV4()
  const robots: RobotInstanceV4[] = []
  robots.length = 1
  return { ...project, robots }
}

export function projectWithDuplicateTopLevelId(): WorkcellProjectV4 {
  const project = cloneProject(makeMinimalWorkcellProjectV4())
  return { ...project, robots: [{ ...project.robots[0]!, id: 'definition-1' }] }
}

export function projectWithVisibleTriangleCount(triangleCount: number): WorkcellProjectV4 {
  const project = cloneProject(makeMinimalWorkcellProjectV4())
  const triangleCounts: number[] = []
  let remaining = triangleCount
  while (remaining > 0) {
    const count = Math.min(remaining, MAX_ROBOT_DEFINITION_TRIANGLES_V4)
    triangleCounts.push(count)
    remaining -= count
  }
  return {
    ...project,
    robotDefinitions: triangleCounts.map((count, index) => makeDefinition(index + 1, 1, count)),
    robots: triangleCounts.map((_, index) => makeRobot(index + 1, index + 1)),
  }
}

export { ZERO_STATISTICS }
