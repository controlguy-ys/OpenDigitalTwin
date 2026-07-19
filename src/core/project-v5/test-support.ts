import type { RigidTransformV5 } from './rigid-transform.js'
import type {
  AssetReferenceV5,
  GeometryStatisticsV5,
  RobotDefinitionV5,
  RobotInstanceV5,
  WorkcellProjectV5,
} from './types.js'

const ZERO_STATISTICS: GeometryStatisticsV5 = {
  vertices: 0,
  triangles: 0,
  meshes: 0,
  materials: 0,
}

function identityPose(): RigidTransformV5 {
  return { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }
}

function makeAssetReference(id = 'asset-robot'): AssetReferenceV5 {
  return {
    id,
    uri: `asset://local/${id}.step`,
    sha256: '0'.repeat(64),
    byteLength: 1,
    sourceFileName: `${id}.step`,
    mediaType: 'model/step',
  }
}

function makeRobotDefinition(): RobotDefinitionV5 {
  return {
    id: 'definition-1',
    name: 'Robot Definition 1',
    identification: {
      manufacturer: 'ABB',
      model: 'CRB15000-12/1.27',
      productCode: 'CRB15000-12/1.27',
      serialNumberTemplate: null,
      motionDeviceCategory: 'ARTICULATED_ROBOT',
    },
    assetReferenceIds: ['asset-robot'],
    sourceConventions: {
      'asset-robot': {
        linearUnit: 'millimeter',
        sourceToMeters: 0.001,
        orientation: { mode: 'up-axis', upAxis: 'z' },
      },
    },
    links: [
      {
        id: 'L0',
        name: 'Link 0',
        geometryOccurrences: [{
          occurrenceKey: 'robot-occurrence',
          assetReferenceId: 'asset-robot',
          linkLocalPose: identityPose(),
          statistics: ZERO_STATISTICS,
          collisionBoxes: [],
        }],
      },
      { id: 'L1', name: 'Link 1', geometryOccurrences: [] },
    ],
    joints: [{
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
    }],
    frames: [
      { id: 'Base', name: 'Base', parentFrameId: 'L0', localPose: identityPose(), role: 'base' },
      { id: 'Tool', name: 'Tool', parentFrameId: 'L1', localPose: identityPose(), role: 'tool' },
      { id: 'TCP', name: 'TCP', parentFrameId: 'Tool', localPose: identityPose(), role: 'tcp' },
    ],
    excludedGeometryOccurrenceKeys: [],
  }
}

function makeRobot(): RobotInstanceV5 {
  return {
    id: 'robot-1',
    name: 'Robot 1',
    definitionId: 'definition-1',
    serialNumber: 'ROBOT-SAMPLE-001',
    controllerId: 'controller-1',
    visible: true,
    baseParentFrameId: 'mcp',
    localBasePose: identityPose(),
    initialJointValues: { J1: 0 },
    jointSource: 'simulation',
    frameSources: { Base: 'simulation', Tool: 'simulation', TCP: 'simulation' },
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

export function cloneWorkcellProjectV5(project: WorkcellProjectV5): WorkcellProjectV5 {
  return structuredClone(project)
}

export function makeMinimalWorkcellProjectV5(): WorkcellProjectV5 {
  return {
    schemaVersion: 5,
    projectId: 'project-v5',
    revisionId: 'revision-1',
    metadata: {
      name: 'Minimal Project V5',
      createdAt: '2026-07-19T00:00:00.000Z',
      updatedAt: '2026-07-19T00:00:00.000Z',
    },
    assetReferences: [makeAssetReference()],
    scene: {
      frames: [
        { id: 'world', name: 'World', parentFrameId: null, localPose: identityPose(), role: 'world' },
        { id: 'mcp', name: 'MCP', parentFrameId: 'world', localPose: identityPose(), role: 'mcp' },
      ],
    },
    robotDefinitions: [makeRobotDefinition()],
    controllers: [{
      id: 'controller-1',
      name: 'Controller 1',
      identification: {
        manufacturer: 'ABB',
        model: 'OmniCore C90XT',
        productCode: '3HAC058893-001',
        serialNumber: 'CTRL-SAMPLE-001',
      },
    }],
    robots: [makeRobot()],
    spatialEntities: [],
    sceneGroups: [],
    logicalSignals: [{
      id: 'PartPresent',
      name: 'Part Present',
      dataType: 'Boolean',
      direction: 'input',
      initialValue: false,
      unit: '',
      scope: { type: 'project' },
    }],
    jobs: [{
      id: 'job-1',
      name: 'Home',
      robotId: 'robot-1',
      instructions: [{
        id: 'instruction-1',
        kind: 'move-joint',
        jointValues: { J1: 0 },
        speedPercentToNext: 100,
      }],
    }],
    opcUa: {
      mode: 'client',
      endpoints: [{
        endpointId: 'endpoint-1',
        name: 'Controller',
        endpointUrl: 'opc.tcp://localhost:4840',
        enabled: true,
        publishingIntervalMs: 100,
        reconnectDelayMs: 1_000,
      }],
      mappings: [{
        id: 'mapping-1',
        endpointId: 'endpoint-1',
        nodeAddress: {
          namespaceUri: 'urn:sample:plc',
          identifierType: 'string',
          identifier: 'Signals.PartPresent',
        },
        direction: 'read',
        coherenceGroupId: null,
        interpolationMode: 'none',
        coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
        leaves: [{
          leafPath: [],
          projectPath: [],
          projectTarget: { type: 'logical-signal', signalId: 'PartPresent' },
          opcUaDataType: 'Boolean',
          projectDataType: 'boolean',
          scale: 1,
          offset: 0,
          unit: '',
          required: true,
        }],
      }],
      bridgeRoutes: [],
    },
  }
}
