import {
  composeRigidTransformV4,
  validateWorkcellProjectV4,
  type NumericStatusV4,
  type RigidTransformV4,
  type RobotInstanceV4,
  type SpatialEntityV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { computeSerialRobotPoseV4 } from '../../../core/robot-runtime/serial-kinematics.js'
import {
  createBuiltinNed2AssetReferencesV4,
  createBuiltinNed2DefinitionV4,
} from '../../robot/v4/builtin-ned2-definition.js'

export interface HackathonHandoverSampleV4Options {
  readonly projectId: string
  readonly revisionId: string
  readonly nowIso: string
}

export const HACKATHON_HANDOVER_IDS_V4 = Object.freeze({
  robotAId: 'robot-hackathon-ned2-a',
  robotBId: 'robot-hackathon-ned2-b',
  jobId: 'job-hackathon-direct-handover',
  tableId: 'entity-hackathon-table',
  workpieceId: 'entity-hackathon-workpiece',
  outputTrayId: 'entity-hackathon-output-tray',
  sharedZoneId: 'runtime-hackathon-shared-zone',
})

export const HACKATHON_HANDOVER_STEPS_V4 = Object.freeze([
  'READY', 'PICK_APPROACH', 'PICK_GRIP', 'MOVE_TO_SHARED_ZONE',
  'HANDOVER_APPROACH', 'HANDOVER_CONFIRM', 'PLACE', 'COMPLETE',
] as const)

const POSES = Object.freeze({
  home: { J1: 0, J2: 0, J3: 0, J4: 0, J5: 0, J6: 0 },
  pick: { J1: -35, J2: -38, J3: -52, J4: 0, J5: 58, J6: 0 },
  shared: { J1: 0, J2: -32, J3: -44, J4: 0, J5: 52, J6: 0 },
  place: { J1: 35, J2: -38, J3: -52, J4: 0, J5: 58, J6: 0 },
})

const REPRESENTATIVE_POSES = [
  POSES.home, POSES.pick, POSES.pick, POSES.shared,
  POSES.shared, POSES.shared, POSES.home, POSES.home,
] as const

const IDENTITY_POSE_V4: RigidTransformV4 = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
}

const ROBOT_A_BASE_POSE_V4: RigidTransformV4 = {
  positionM: [-0.35, 0, 0],
  quaternion: [0, 0, 0, 1],
}

const ROBOT_B_BASE_ROTATION_V4: RigidTransformV4 = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 1, 0],
}

function numericStatusV4(): NumericStatusV4 {
  return {
    value: 0,
    sourceOwnership: 'simulation',
    overlay: { visible: false, frameId: null },
  }
}

function robotInstanceV4(
  id: string,
  name: string,
  definitionId: string,
  localBasePose: RigidTransformV4,
): RobotInstanceV4 {
  return {
    id,
    name,
    definitionId,
    visible: true,
    baseParentFrameId: 'mcp',
    localBasePose,
    initialJointValues: POSES.home,
    jointSource: 'simulation',
    selectedToolFrameId: 'Tool',
    selectedTcpFrameId: 'TCP',
    numericStatus: numericStatusV4(),
    intentionalMountEntityId: HACKATHON_HANDOVER_IDS_V4.tableId,
  }
}

function boxEntityV4(
  id: string,
  name: string,
  dimensionsM: readonly [number, number, number],
  color: `#${string}`,
  localPose: RigidTransformV4,
  graspable = false,
): SpatialEntityV4 {
  return {
    id,
    name,
    geometry: { kind: 'box', dimensionsM, color },
    parentFrameId: 'world',
    localPose,
    visible: true,
    groupId: null,
    removable: false,
    transformOwner: graspable ? 'attachment' : 'simulation',
    numericStatus: numericStatusV4(),
    graspable,
    graspFrames: graspable ? [{
      frameId: 'frame-hackathon-workpiece-grasp',
      name: 'Workpiece Grasp',
      localPose: IDENTITY_POSE_V4,
    }] : [],
    movingFrames: [],
  }
}

export function createHackathonHandoverSampleV4(
  options: HackathonHandoverSampleV4Options,
): WorkcellProjectV4 {
  const definition = createBuiltinNed2DefinitionV4()
  const sharedLocalTcp = computeSerialRobotPoseV4(
    definition,
    POSES.shared,
  ).frameWorldPoses.TCP!
  const sharedWorldTcpA = computeSerialRobotPoseV4(
    definition,
    POSES.shared,
    ROBOT_A_BASE_POSE_V4,
  ).frameWorldPoses.TCP!
  const rotatedSharedLocalTcp = composeRigidTransformV4(
    ROBOT_B_BASE_ROTATION_V4,
    sharedLocalTcp,
  )
  const robotBBasePose: RigidTransformV4 = {
    positionM: [
      sharedWorldTcpA.positionM[0] - rotatedSharedLocalTcp.positionM[0],
      sharedWorldTcpA.positionM[1] - rotatedSharedLocalTcp.positionM[1],
      sharedWorldTcpA.positionM[2] - rotatedSharedLocalTcp.positionM[2],
    ],
    quaternion: ROBOT_B_BASE_ROTATION_V4.quaternion,
  }
  const robotA = robotInstanceV4(
    HACKATHON_HANDOVER_IDS_V4.robotAId,
    'NED2-A',
    definition.id,
    ROBOT_A_BASE_POSE_V4,
  )
  const robotB = robotInstanceV4(
    HACKATHON_HANDOVER_IDS_V4.robotBId,
    'NED2-B',
    definition.id,
    robotBBasePose,
  )
  const pickTcpA = computeSerialRobotPoseV4(
    definition,
    POSES.pick,
    robotA.localBasePose,
  ).frameWorldPoses.TCP!
  const placeTcpB = computeSerialRobotPoseV4(
    definition,
    POSES.place,
    robotB.localBasePose,
  ).frameWorldPoses.TCP!
  const steps = REPRESENTATIVE_POSES.map((jointValues, index) => ({
    kind: 'joint-pose' as const,
    jointValues,
    speedPercentToNext: index === REPRESENTATIVE_POSES.length - 1 ? 100 : 35,
  }))

  return validateWorkcellProjectV4({
    schemaVersion: 4,
    projectId: options.projectId,
    revisionId: options.revisionId,
    metadata: {
      name: 'Hackathon NED2 Direct Handover',
      createdAt: options.nowIso,
      updatedAt: options.nowIso,
    },
    assetReferences: createBuiltinNed2AssetReferencesV4(),
    scene: {
      frames: [
        { id: 'world', name: 'World', parentFrameId: null, localPose: IDENTITY_POSE_V4, role: 'world' },
        { id: 'mcp', name: 'MCP', parentFrameId: 'world', localPose: IDENTITY_POSE_V4, role: 'mcp' },
      ],
    },
    robotDefinitions: [definition],
    robots: [robotA, robotB],
    spatialEntities: [
      boxEntityV4(
        HACKATHON_HANDOVER_IDS_V4.tableId,
        'Handover Table',
        [1.2, 0.8, 0.08],
        '#6B7280',
        { positionM: [-0.4, 0, -0.04], quaternion: [0, 0, 0, 1] },
      ),
      boxEntityV4(
        HACKATHON_HANDOVER_IDS_V4.workpieceId,
        'Workpiece',
        [0.04, 0.04, 0.08],
        '#00B7C7',
        pickTcpA,
        true,
      ),
      boxEntityV4(
        HACKATHON_HANDOVER_IDS_V4.outputTrayId,
        'Output Tray',
        [0.18, 0.14, 0.025],
        '#F59E0B',
        { positionM: placeTcpB.positionM, quaternion: [0, 0, 0, 1] },
      ),
    ],
    sceneGroups: [],
    jobs: [{
      id: HACKATHON_HANDOVER_IDS_V4.jobId,
      name: 'NED2 Direct Handover',
      robotId: robotA.id,
      steps,
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

export function isHackathonHandoverSampleV4(project: WorkcellProjectV4): boolean {
  const ids = HACKATHON_HANDOVER_IDS_V4
  return project.jobs.some(({ id }) => id === ids.jobId)
    && project.robots.some(({ id }) => id === ids.robotAId)
    && project.robots.some(({ id }) => id === ids.robotBId)
    && project.spatialEntities.some(({ id }) => id === ids.workpieceId)
}
