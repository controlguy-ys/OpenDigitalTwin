import {
  validateWorkcellProjectV5,
  type NumericStatusV5,
  type RobotInstanceV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import {
  createBuiltinNed2AssetReferencesV5,
  createBuiltinNed2DefinitionV5,
} from '../../robot/v5/builtin-ned2-definition-v5.js'

export interface DefaultProjectV5Dependencies {
  readonly createProjectId: () => string
  readonly createRevisionId: () => string
  readonly nowIso: () => string
}

function identityPose() {
  return { positionM: [0, 0, 0] as const, quaternion: [0, 0, 0, 1] as const }
}

function numericStatus(): NumericStatusV5 {
  return {
    value: 0,
    sourceOwnership: 'simulation',
    overlay: { visible: false, frameId: null },
  }
}

export function createDefaultProjectV5(dependencies: DefaultProjectV5Dependencies): WorkcellProjectV5 {
  const now = dependencies.nowIso()
  const definition = createBuiltinNed2DefinitionV5()
  const robot: RobotInstanceV5 = {
    id: 'robot-default',
    name: 'NED2',
    definitionId: definition.id,
    serialNumber: 'NED2-DEFAULT-001',
    controllerId: 'controller-default',
    visible: true,
    baseParentFrameId: 'mcp',
    localBasePose: identityPose(),
    initialJointValues: Object.fromEntries(definition.joints.map(({ id, home }) => [id, home])),
    jointSource: 'simulation',
    frameSources: Object.fromEntries(definition.frames.map(({ id }) => [id, 'simulation'])),
    selectedToolFrameId: 'Tool',
    selectedTcpFrameId: 'TCP',
    numericStatus: numericStatus(),
    intentionalMountEntityId: null,
  }
  return validateWorkcellProjectV5({
    schemaVersion: 5,
    projectId: dependencies.createProjectId(),
    revisionId: dependencies.createRevisionId(),
    metadata: { name: 'Untitled Workcell', createdAt: now, updatedAt: now },
    assetReferences: createBuiltinNed2AssetReferencesV5(),
    scene: {
      frames: [
        { id: 'world', name: 'World', parentFrameId: null, localPose: identityPose(), role: 'world' },
        { id: 'mcp', name: 'MCP', parentFrameId: 'world', localPose: identityPose(), role: 'mcp' },
      ],
    },
    robotDefinitions: [definition],
    controllers: [{
      id: robot.controllerId,
      name: 'NED2 Controller',
      identification: {
        manufacturer: 'Niryo',
        model: 'NED2',
        productCode: 'NED2',
        serialNumber: 'NED2-CONTROLLER-001',
      },
    }],
    robots: [robot],
    spatialEntities: [],
    sceneGroups: [],
    logicalSignals: [],
    jobs: [],
    opcUa: { mode: 'off', endpoints: [], mappings: [], bridgeRoutes: [] },
  })
}
