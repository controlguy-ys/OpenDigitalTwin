import {
  validateWorkcellProjectV5,
  type NumericStatusV5,
  type RigidTransformV5,
  type RobotDefinitionV5,
  type RobotInstanceV5,
  type RobotJobInstructionV1,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'

export interface LogicalIoJobSampleV5Options {
  readonly projectId: string
  readonly revisionId: string
  readonly nowIso: string
}

const NAMESPACE_URI_V5 = 'urn:robot-sim-web:logical-io-job-sample:v5'

export const LOGICAL_IO_JOB_SAMPLE_IDS_V5 = Object.freeze({
  robotSourceId: 'builtin-logical-io-robot-source',
  robotDefinitionId: 'definition-logical-io-robot',
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

function createSourceOnlyRobotDefinition(): RobotDefinitionV5 {
  return {
    id: LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotDefinitionId,
    name: 'Source-only Two-Joint Articulated Robot',
    identification: {
      manufacturer: 'RobotSimWeb',
      model: 'Logical 2R',
      productCode: 'RSW-LOGICAL-2R',
      serialNumberTemplate: 'LOGICAL-2R-{serial}',
      motionDeviceCategory: 'ARTICULATED_ROBOT',
    },
    assetReferenceIds: [LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotSourceId],
    sourceConventions: {
      [LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotSourceId]: {
        linearUnit: 'meter',
        sourceToMeters: 1,
        orientation: { mode: 'up-axis', upAxis: 'z' },
      },
    },
    links: [
      { id: 'L0', name: 'Base Link', geometryOccurrences: [] },
      { id: 'L1', name: 'Joint 1 Link', geometryOccurrences: [] },
      { id: 'L2', name: 'Joint 2 Link', geometryOccurrences: [] },
    ],
    joints: [
      {
        id: 'J1',
        type: 'revolute',
        parentLinkId: 'L0',
        childLinkId: 'L1',
        origin: identityPose(),
        axis: [0, 0, 1],
        min: -180,
        max: 180,
        home: 0,
        zeroOffset: 0,
        direction: 1,
        maximumVelocity: 90,
      },
      {
        id: 'J2',
        type: 'revolute',
        parentLinkId: 'L1',
        childLinkId: 'L2',
        origin: identityPose(),
        axis: [0, 0, 1],
        min: -180,
        max: 180,
        home: 0,
        zeroOffset: 0,
        direction: 1,
        maximumVelocity: 90,
      },
    ],
    frames: [
      { id: 'Base', name: 'Base', parentFrameId: 'L0', localPose: identityPose(), role: 'base' },
      { id: 'Tool', name: 'Tool', parentFrameId: 'L2', localPose: identityPose(), role: 'tool' },
      { id: 'TCP', name: 'TCP', parentFrameId: 'Tool', localPose: identityPose(), role: 'tcp' },
    ],
    excludedGeometryOccurrenceKeys: [],
  }
}

function createRobotInstance(definition: RobotDefinitionV5): RobotInstanceV5 {
  return {
    id: LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotId,
    name: 'Logical I/O Robot',
    definitionId: definition.id,
    serialNumber: 'LOGICAL-2R-001',
    controllerId: LOGICAL_IO_JOB_SAMPLE_IDS_V5.controllerId,
    visible: true,
    baseParentFrameId: 'mcp',
    localBasePose: identityPose(),
    initialJointValues: { J1: 0, J2: 0 },
    jointSource: 'simulation',
    frameSources: { Base: 'simulation', Tool: 'simulation', TCP: 'simulation' },
    selectedToolFrameId: 'Tool',
    selectedTcpFrameId: 'TCP',
    numericStatus: numericStatus(),
    intentionalMountEntityId: null,
  }
}

function createInstructions(): readonly RobotJobInstructionV1[] {
  const poses = [
    [0, 0], [10, -10], [20, -20], [30, -30], [40, -20],
    [50, -10], [40, 0], [30, 10], [20, 20], [10, 10], [0, 0],
  ] as const
  const move = (
    id: string,
    [J1, J2]: readonly [number, number],
    speedPercentToNext: number,
  ): RobotJobInstructionV1 => ({
    id,
    kind: 'move-joint',
    jointValues: { J1, J2 },
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
  const definition = createSourceOnlyRobotDefinition()
  return validateWorkcellProjectV5({
    schemaVersion: 5,
    projectId: options.projectId,
    revisionId: options.revisionId,
    metadata: {
      name: 'Logical I/O Pick and Place Contract Sample',
      createdAt: options.nowIso,
      updatedAt: options.nowIso,
    },
    assetReferences: [{
      id: LOGICAL_IO_JOB_SAMPLE_IDS_V5.robotSourceId,
      uri: 'builtin://abb/logical-2r@v1',
      sha256: '0'.repeat(64),
      byteLength: 1,
      sourceFileName: 'logical-2r.step',
      mediaType: 'model/step',
    }],
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
        manufacturer: 'RobotSimWeb',
        model: 'Logical Controller',
        productCode: 'RSW-LOGICAL-CONTROLLER',
        serialNumber: 'LOGICAL-CONTROLLER-001',
      },
    }],
    robots: [createRobotInstance(definition)],
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
