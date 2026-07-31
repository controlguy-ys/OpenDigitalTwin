import {
  validateWorkcellProjectV5,
  type NumericStatusV5,
  type RigidTransformV5,
  type RobotInstanceV5,
  type RobotJobInstructionV1,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import {
  BUILTIN_NED2_ASSET_REFERENCE_ID_V5,
  BUILTIN_NED2_DEFINITION_ID_V5,
  createBuiltinNed2AssetReferencesV5,
  createBuiltinNed2DefinitionV5,
} from '../../robot/v5/builtin-ned2-definition-v5.js'

export interface LogicalIoJobSampleV5Options {
  readonly projectId: string
  readonly revisionId: string
  readonly nowIso: string
}

const NAMESPACE_URI_V5 = 'urn:robot-sim-web:logical-io-job-sample:v5'

export const LOGICAL_IO_JOB_SAMPLE_IDS_V5 = Object.freeze({
  robotSourceId: BUILTIN_NED2_ASSET_REFERENCE_ID_V5,
  robotDefinitionId: BUILTIN_NED2_DEFINITION_ID_V5,
  controllerId: 'controller-logical-io-robot',
  robotId: 'robot-logical-io',
  partEntityId: 'entity-part',
  partGraspFrameId: 'part-grasp',
  partPresentSignalId: 'signal-part-present',
  clampCommandSignalId: 'signal-clamp-command',
  jobId: 'job-logical-io-pick-place',
  opcUaEndpointId: 'endpoint-logical-io-plc',
  partPresentMappingId: 'mapping-part-present',
  clampCommandMappingId: 'mapping-clamp-command',
})

function identityPose(): RigidTransformV5 {
  return { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }
}

function numericStatus(): NumericStatusV5 {
  return {
    value: 0,
    sourceOwnership: 'simulation',
    overlay: { visible: false, frameId: null },
  }
}

function createRobotInstance(definitionId: string): RobotInstanceV5 {
  return {
    id: LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotId,
    name: 'NED2',
    definitionId,
    serialNumber: 'NED2-DEMO-001',
    controllerId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.controllerId,
    visible: true,
    baseParentFrameId: 'mcp',
    localBasePose: identityPose(),
    initialJointValues: { J1: 0, J2: 0, J3: 0, J4: 0, J5: 0, J6: 0 },
    jointSource: 'simulation',
    frameSources: {
      Base: 'simulation',
      Flange: 'simulation',
      Tool0: 'simulation',
      Tool: 'simulation',
      TCP: 'simulation',
    },
    selectedToolFrameId: 'Tool',
    selectedTcpFrameId: 'TCP',
    numericStatus: numericStatus(),
    intentionalMountEntityId: null,
  }
}

function createInstructions(): readonly RobotJobInstructionV1[] {
  const poses = [
    [0, 0, 0, 0, 0, 0], [10, -10, 10, 0, 5, 0], [20, -20, 20, 10, 10, 5],
    [30, -30, 30, 20, 15, 10], [40, -20, 20, 30, 20, 15], [50, -10, 10, 40, 25, 20],
    [40, 0, 0, 30, 20, 15], [30, 10, -10, 20, 15, 10], [20, 20, -20, 10, 10, 5],
    [10, 10, -10, 0, 5, 0], [0, 0, 0, 0, 0, 0],
  ] as const
  const move = (
    id: string,
    [J1, J2, J3, J4, J5, J6]: readonly [number, number, number, number, number, number],
    speedPercentToNext: number,
  ): RobotJobInstructionV1 => ({
    id,
    kind: 'move-joint',
    jointValues: { J1, J2, J3, J4, J5, J6 },
    speedPercentToNext,
  })

  return [
    ...poses.slice(0, 2).map((values, index) => move(`move-${index + 1}`, values, 30)),
    { id: 'wait-part-present', kind: 'wait-di', signalId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partPresentSignalId, expected: true, timeoutMs: 5_000 },
    { id: 'clamp-on', kind: 'set-do', signalId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.clampCommandSignalId, value: true },
    { id: 'clamp-delay', kind: 'delay', durationMs: 250 },
    { id: 'attach-part', kind: 'attach', objectId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partEntityId, toolFrameId: 'Tool', objectGraspFrameId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partGraspFrameId, maximumDistanceM: 0.05 },
    ...poses.slice(2, 9).map((values, index) => move(`move-${index + 3}`, values, 40)),
    { id: 'detach-part', kind: 'detach', objectId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partEntityId, targetParentFrameId: 'world' },
    { id: 'clamp-off', kind: 'set-do', signalId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.clampCommandSignalId, value: false },
    ...poses.slice(9).map((values, index) => move(`move-${index + 10}`, values, 30)),
  ]
}

export function createLogicalIoJobSampleV5(
  options: LogicalIoJobSampleV5Options,
): WorkcellProjectV5 {
  const definition = createBuiltinNed2DefinitionV5()
  return validateWorkcellProjectV5({
    schemaVersion: 5,
    projectId: options.projectId,
    revisionId: options.revisionId,
    metadata: {
      name: 'Logical I/O Pick and Place Contract Sample',
      createdAt: options.nowIso,
      updatedAt: options.nowIso,
    },
    assetReferences: createBuiltinNed2AssetReferencesV5(),
    scene: {
      frames: [
        { id: 'world', name: 'World', parentFrameId: null, localPose: identityPose(), role: 'world' },
        { id: 'mcp', name: 'MCP', parentFrameId: 'world', localPose: identityPose(), role: 'mcp' },
      ],
    },
    robotDefinitions: [definition],
    controllers: [{
      id: LOGICAL_IO_JOB_SAMPLE_IDS_V5.controllerId,
      name: 'Logical I/O Controller',
      identification: {
        manufacturer: 'Niryo',
        model: 'NED2',
        productCode: 'NED2',
        serialNumber: 'NED2-CONTROLLER-DEMO-001',
      },
    }],
    robots: [createRobotInstance(definition.id)],
    spatialEntities: [{
      id: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partEntityId,
      name: 'Part',
      geometry: { kind: 'box', dimensionsM: [0.05, 0.05, 0.05], color: '#00B7C7' },
      parentFrameId: 'mcp',
      localPose: { positionM: [0.2, 0, 0], quaternion: [0, 0, 0, 1] },
      visible: true,
      groupId: null,
      removable: true,
      transformOwner: 'simulation',
      numericStatus: numericStatus(),
      graspable: true,
      graspFrames: [{
        frameId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partGraspFrameId,
        name: 'Part Grasp',
        localPose: identityPose(),
      }],
      movingFrames: [],
    }],
    sceneGroups: [],
    logicalSignals: [
      {
        id: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partPresentSignalId,
        name: 'PartPresent',
        dataType: 'Boolean',
        direction: 'input',
        initialValue: false,
        unit: '',
        scope: { type: 'project' },
      },
      {
        id: LOGICAL_IO_JOB_SAMPLE_IDS_V5.clampCommandSignalId,
        name: 'ClampCommand',
        dataType: 'Boolean',
        direction: 'output',
        initialValue: false,
        unit: '',
        scope: { type: 'project' },
      },
    ],
    jobs: [{
      id: LOGICAL_IO_JOB_SAMPLE_IDS_V5.jobId,
      name: 'Logical I/O Pick and Place',
      robotId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotId,
      instructions: createInstructions(),
    }],
    opcUa: {
      mode: 'client',
      endpoints: [{
        endpointId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.opcUaEndpointId,
        name: 'Logical I/O PLC',
        endpointUrl: 'opc.tcp://localhost:4840',
        enabled: true,
        publishingIntervalMs: 100,
        reconnectDelayMs: 1_000,
      }],
      mappings: [
        {
          id: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partPresentMappingId,
          endpointId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.opcUaEndpointId,
          nodeAddress: { namespaceUri: NAMESPACE_URI_V5, identifierType: 'string', identifier: 'Signals.PartPresent' },
          direction: 'read',
          coherenceGroupId: null,
          interpolationMode: 'none',
          coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
          leaves: [{
            leafPath: [], projectPath: [],
            projectTarget: { type: 'logical-signal', signalId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.partPresentSignalId },
            opcUaDataType: 'Boolean', projectDataType: 'boolean', scale: 1, offset: 0, unit: '', required: true,
          }],
        },
        {
          id: LOGICAL_IO_JOB_SAMPLE_IDS_V5.clampCommandMappingId,
          endpointId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.opcUaEndpointId,
          nodeAddress: { namespaceUri: NAMESPACE_URI_V5, identifierType: 'string', identifier: 'Signals.ClampCommand' },
          direction: 'write',
          coherenceGroupId: null,
          interpolationMode: 'none',
          coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
          leaves: [{
            leafPath: [], projectPath: [],
            projectTarget: { type: 'logical-signal', signalId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.clampCommandSignalId },
            opcUaDataType: 'Boolean', projectDataType: 'boolean', scale: 1, offset: 0, unit: '', required: true,
          }],
        },
      ],
      bridgeRoutes: [],
    },
  })
}
