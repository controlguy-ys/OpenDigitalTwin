import {
  validateWorkcellProjectV4,
  type FrameDefinitionV4,
  type RigidTransformV4,
  type RobotInstanceV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  createBuiltinCrbAssetReferencesV4,
  createBuiltinCrbDefinitionV4,
} from '../../robot/v4/builtin-crb-definition.js'

const IDENTITY_POSE_V4: RigidTransformV4 = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
}

function sceneFrameV4(
  id: string,
  name: string,
  parentFrameId: string | null,
  role: FrameDefinitionV4['role'],
): FrameDefinitionV4 {
  return { id, name, parentFrameId, localPose: IDENTITY_POSE_V4, role }
}

export interface DefaultProjectV4Options {
  readonly projectId: string
  readonly revisionId: string
  readonly nowIso: string
}

export function createDefaultProjectV4(
  options: DefaultProjectV4Options,
): WorkcellProjectV4 {
  const definition = createBuiltinCrbDefinitionV4()
  const robot: RobotInstanceV4 = {
    id: 'robot-default',
    name: 'CRB15000',
    definitionId: definition.id,
    visible: true,
    baseParentFrameId: 'mcp',
    localBasePose: IDENTITY_POSE_V4,
    initialJointValues: Object.fromEntries(
      definition.joints.map(({ id, home }) => [id, home]),
    ),
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

  return validateWorkcellProjectV4({
    schemaVersion: 4,
    projectId: options.projectId,
    revisionId: options.revisionId,
    metadata: {
      name: 'Untitled Workcell',
      createdAt: options.nowIso,
      updatedAt: options.nowIso,
    },
    assetReferences: createBuiltinCrbAssetReferencesV4(),
    scene: {
      frames: [
        sceneFrameV4('world', 'World', null, 'world'),
        sceneFrameV4('mcp', 'MCP', 'world', 'mcp'),
      ],
    },
    robotDefinitions: [definition],
    robots: [robot],
    spatialEntities: [],
    sceneGroups: [],
    jobs: [{
      id: 'job-default',
      name: 'Default Job',
      robotId: robot.id,
      steps: [],
    }],
    actions: [],
    opcUa: {
      mode: 'off',
      endpoints: [],
      mappings: [],
      actionBindings: [],
      bridgeRoutes: [],
    },
  })
}
