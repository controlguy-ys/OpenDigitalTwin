import {
  validateWorkcellProjectV4,
  type NumericStatusV4,
  type OpcUaProjectConfigurationV4,
  type RigidTransformV4,
  type RobotDefinitionV4,
  type RobotInstanceV4,
  type RobotJobStepV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  createBuiltinNed2AssetReferencesV4,
  createBuiltinNed2DefinitionV4,
} from '../../robot/v4/builtin-ned2-definition.js'

export interface DualRobotSampleV4Options {
  readonly projectId: string
  readonly revisionId: string
  readonly nowIso: string
  readonly opcUaMode?: 'off' | 'server'
}

const PRIMARY_ROBOT_ID_V4 = 'robot-sample-primary'
const SLIDE_ROBOT_ID_V4 = 'robot-sample-linear-slide'
const SLIDE_DEFINITION_ID_V4 = 'definition-sample-linear-slide'
const SLIDE_JOINT_ID_V4 = 'SLIDE_X'
const SLIDE_SOURCE_ID_V4 = 'builtin-sample-linear-slide-source'
const PRIMARY_ROBOT_JOB_ID_V4 = 'job-sample-primary'
const PRIMARY_ROBOT_TECHNICAL_DEMO_JOB_ID_V4 = 'job-sample-primary-technical-demo'
const SLIDE_JOB_ID_V4 = 'job-sample-linear-slide'
const OPC_UA_ENDPOINT_ID_V4 = 'endpoint-sample-server'
const PRIMARY_ROBOT_MAPPING_ID_V4 = 'mapping-sample-primary-j1'
const SLIDE_MAPPING_ID_V4 = 'mapping-sample-slide-position'
const PRIMARY_ROBOT_JOINT_NODE_ID_V4 =
  'ns=2;s=RobotSim/Robots/robot-sample-primary/Joints/J1/Actual'
const SLIDE_JOINT_NODE_ID_V4 =
  'ns=2;s=RobotSim/Robots/robot-sample-linear-slide/Joints/SLIDE_X/Actual'

export const DUAL_ROBOT_SAMPLE_IDS_V4 = Object.freeze({
  primaryRobotId: PRIMARY_ROBOT_ID_V4,
  slideRobotId: SLIDE_ROBOT_ID_V4,
  slideDefinitionId: SLIDE_DEFINITION_ID_V4,
  slideJointId: SLIDE_JOINT_ID_V4,
  primaryRobotJobId: PRIMARY_ROBOT_JOB_ID_V4,
  primaryRobotTechnicalDemoJobId: PRIMARY_ROBOT_TECHNICAL_DEMO_JOB_ID_V4,
  slideJobId: SLIDE_JOB_ID_V4,
  opcUaEndpointId: OPC_UA_ENDPOINT_ID_V4,
  primaryRobotMappingId: PRIMARY_ROBOT_MAPPING_ID_V4,
  slideMappingId: SLIDE_MAPPING_ID_V4,
  primaryRobotJointNodeId: PRIMARY_ROBOT_JOINT_NODE_ID_V4,
  slideJointNodeId: SLIDE_JOINT_NODE_ID_V4,
})

function poseAtX(x: number): RigidTransformV4 {
  return {
    positionM: [x, 0, 0],
    quaternion: [0, 0, 0, 1],
  }
}

function numericStatusV4(): NumericStatusV4 {
  return {
    value: 0,
    sourceOwnership: 'simulation',
    overlay: { visible: false, frameId: null },
  }
}

type JointPoseStepV4 = Extract<RobotJobStepV4, { readonly kind: 'joint-pose' }>

function primaryRobotJointPoseV4(
  jointValues: readonly [number, number, number, number, number, number],
  speedPercentToNext: number,
): JointPoseStepV4 {
  const [J1, J2, J3, J4, J5, J6] = jointValues
  return {
    kind: 'joint-pose',
    jointValues: { J1, J2, J3, J4, J5, J6 },
    speedPercentToNext,
  }
}

function createPrimaryRobotTechnicalDemoStepsV4(): readonly JointPoseStepV4[] {
  return [
    primaryRobotJointPoseV4([0, 0, 0, 0, 0, 0], 20),
    primaryRobotJointPoseV4([20, -15, -20, 10, 15, 0], 25),
    primaryRobotJointPoseV4([40, -30, -40, 20, 25, 30], 30),
    primaryRobotJointPoseV4([60, -20, -55, 45, 10, 60], 35),
    primaryRobotJointPoseV4([35, 5, -45, 70, -20, 90], 25),
    primaryRobotJointPoseV4([0, 20, -30, 90, -35, 120], 30),
    primaryRobotJointPoseV4([-35, 5, -45, 70, -20, 90], 35),
    primaryRobotJointPoseV4([-60, -20, -55, 45, 10, 60], 25),
    primaryRobotJointPoseV4([-40, -30, -40, 20, 25, 30], 30),
    primaryRobotJointPoseV4([-20, -15, -20, 10, 15, 0], 25),
    primaryRobotJointPoseV4([0, -10, -10, -20, 10, -30], 20),
    primaryRobotJointPoseV4([0, 0, 0, 0, 0, 0], 100),
  ]
}

function createSourceOnlySlideDefinitionV4(): RobotDefinitionV4 {
  return {
    id: SLIDE_DEFINITION_ID_V4,
    name: 'Source-only Linear Slide',
    manufacturer: 'Generic',
    model: 'Logical 1-Axis Slide',
    assetReferenceIds: [SLIDE_SOURCE_ID_V4],
    sourceConventions: {
      [SLIDE_SOURCE_ID_V4]: {
        linearUnit: 'meter',
        sourceToMeters: 1,
        orientation: { mode: 'up-axis', upAxis: 'z' },
      },
    },
    links: [
      { id: 'SLIDE_BASE', name: 'Slide Base', geometryOccurrences: [] },
      { id: 'SLIDE_CARRIAGE', name: 'Slide Carriage', geometryOccurrences: [] },
    ],
    joints: [{
      id: SLIDE_JOINT_ID_V4,
      type: 'prismatic',
      parentLinkId: 'SLIDE_BASE',
      childLinkId: 'SLIDE_CARRIAGE',
      origin: poseAtX(0),
      axis: [1, 0, 0],
      min: 0,
      max: 1.2,
      home: 0.2,
      zeroOffset: 0,
      direction: 1,
      maximumVelocity: 0.5,
    }],
    frames: [
      {
        id: 'Base',
        name: 'Base',
        parentFrameId: 'SLIDE_BASE',
        localPose: poseAtX(0),
        role: 'base',
      },
      {
        id: 'Tool',
        name: 'Tool',
        parentFrameId: 'SLIDE_CARRIAGE',
        localPose: poseAtX(0),
        role: 'tool',
      },
      {
        id: 'TCP',
        name: 'TCP',
        parentFrameId: 'Tool',
        localPose: poseAtX(0),
        role: 'tcp',
      },
    ],
    excludedGeometryOccurrenceKeys: [],
  }
}

function robotInstanceV4(
  id: string,
  name: string,
  definition: RobotDefinitionV4,
  baseX: number,
): RobotInstanceV4 {
  return {
    id,
    name,
    definitionId: definition.id,
    visible: true,
    baseParentFrameId: 'mcp',
    localBasePose: poseAtX(baseX),
    initialJointValues: Object.fromEntries(
      definition.joints.map(({ id: jointId, home }) => [jointId, home]),
    ),
    jointSource: 'simulation',
    selectedToolFrameId: 'Tool',
    selectedTcpFrameId: 'TCP',
    numericStatus: numericStatusV4(),
    intentionalMountEntityId: null,
  }
}

function opcUaConfigurationV4(
  mode: 'off' | 'server',
): OpcUaProjectConfigurationV4 {
  if (mode === 'off') {
    return {
      mode,
      endpoints: [],
      mappings: [],
      actionBindings: [],
      bridgeRoutes: [],
    }
  }
  return {
    mode,
    endpoints: [{
      endpointId: OPC_UA_ENDPOINT_ID_V4,
      name: 'Dual Robot Sample Server',
      endpointUrl: 'opc.tcp://localhost:4840',
      enabled: true,
      publishingIntervalMs: 100,
      reconnectDelayMs: 1_000,
    }],
    mappings: [
      {
        id: PRIMARY_ROBOT_MAPPING_ID_V4,
        endpointId: OPC_UA_ENDPOINT_ID_V4,
        direction: 'publish',
        coherenceGroupId: null,
        sourceOwnership: 'simulation',
        interpolationMode: 'none',
        coordinateConvention: 'project-v4-z-up-metres-quaternion-xyzw',
        leaves: [{
          leafPath: [],
          nodeId: PRIMARY_ROBOT_JOINT_NODE_ID_V4,
          projectTarget: {
            type: 'robot-joint',
            robotId: PRIMARY_ROBOT_ID_V4,
            jointId: 'J1',
          },
          opcUaDataType: 'Double',
          projectDataType: 'number',
          scale: 1,
          offset: 0,
          unit: 'degree',
          required: true,
        }],
      },
      {
        id: SLIDE_MAPPING_ID_V4,
        endpointId: OPC_UA_ENDPOINT_ID_V4,
        direction: 'publish',
        coherenceGroupId: null,
        sourceOwnership: 'simulation',
        interpolationMode: 'none',
        coordinateConvention: 'project-v4-z-up-metres-quaternion-xyzw',
        leaves: [{
          leafPath: [],
          nodeId: SLIDE_JOINT_NODE_ID_V4,
          projectTarget: {
            type: 'robot-joint',
            robotId: SLIDE_ROBOT_ID_V4,
            jointId: SLIDE_JOINT_ID_V4,
          },
          opcUaDataType: 'Double',
          projectDataType: 'number',
          scale: 1,
          offset: 0,
          unit: 'metre',
          required: true,
        }],
      },
    ],
    actionBindings: [],
    bridgeRoutes: [],
  }
}

export function createDualRobotSampleV4(
  options: DualRobotSampleV4Options,
): WorkcellProjectV4 {
  const primaryRobotDefinition = createBuiltinNed2DefinitionV4()
  const slideDefinition = createSourceOnlySlideDefinitionV4()
  const primaryRobot = robotInstanceV4(
    PRIMARY_ROBOT_ID_V4,
    'NED2',
    primaryRobotDefinition,
    -1.5,
  )
  const slideRobot = robotInstanceV4(
    SLIDE_ROBOT_ID_V4,
    'Logical Linear Slide',
    slideDefinition,
    1.5,
  )
  const primaryRobotHome = Object.fromEntries(
    primaryRobotDefinition.joints.map(({ id }) => [id, 0]),
  )

  return validateWorkcellProjectV4({
    schemaVersion: 4,
    projectId: options.projectId,
    revisionId: options.revisionId,
    metadata: {
      name: 'Dual Robot Technical Demo',
      createdAt: options.nowIso,
      updatedAt: options.nowIso,
    },
    assetReferences: [
      ...createBuiltinNed2AssetReferencesV4(),
      {
        id: SLIDE_SOURCE_ID_V4,
        uri: 'builtin://generic/sample-logical-linear-slide@v1',
        sha256: '0'.repeat(64),
        byteLength: 1,
        sourceFileName: 'logical-linear-slide.step',
        mediaType: 'model/step',
      },
    ],
    scene: {
      frames: [
        {
          id: 'world',
          name: 'World',
          parentFrameId: null,
          localPose: poseAtX(0),
          role: 'world',
        },
        {
          id: 'mcp',
          name: 'MCP',
          parentFrameId: 'world',
          localPose: poseAtX(0),
          role: 'mcp',
        },
      ],
    },
    robotDefinitions: [primaryRobotDefinition, slideDefinition],
    robots: [primaryRobot, slideRobot],
    spatialEntities: [],
    sceneGroups: [],
    jobs: [
      {
        id: PRIMARY_ROBOT_TECHNICAL_DEMO_JOB_ID_V4,
        name: 'NED2 12-Pose Technical Demo',
        robotId: PRIMARY_ROBOT_ID_V4,
        steps: createPrimaryRobotTechnicalDemoStepsV4(),
      },
      {
        id: PRIMARY_ROBOT_JOB_ID_V4,
        name: 'NED2 Sweep',
        robotId: PRIMARY_ROBOT_ID_V4,
        steps: [
          {
            kind: 'joint-pose',
            jointValues: primaryRobotHome,
            speedPercentToNext: 40,
          },
          {
            kind: 'joint-pose',
            jointValues: { ...primaryRobotHome, J1: 35, J2: -20, J3: -30 },
            speedPercentToNext: 60,
          },
        ],
      },
      {
        id: SLIDE_JOB_ID_V4,
        name: 'Linear Slide Traverse',
        robotId: SLIDE_ROBOT_ID_V4,
        steps: [
          {
            kind: 'joint-pose',
            jointValues: { [SLIDE_JOINT_ID_V4]: 0.2 },
            speedPercentToNext: 50,
          },
          {
            kind: 'joint-pose',
            jointValues: { [SLIDE_JOINT_ID_V4]: 1 },
            speedPercentToNext: 50,
          },
        ],
      },
    ],
    actions: [],
    opcUa: opcUaConfigurationV4(options.opcUaMode ?? 'off'),
  })
}
