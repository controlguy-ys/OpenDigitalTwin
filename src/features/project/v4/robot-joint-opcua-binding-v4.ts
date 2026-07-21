import {
  validateWorkcellProjectV4,
  type OpcUaMappingV4,
  type RobotIdV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'

export const BR_ROBOT_OPCUA_ENDPOINT_ID_V4 = 'endpoint-br-robot'
export const BR_ROBOT_OPCUA_ENDPOINT_URL_V4 = 'opc.tcp://127.0.0.1:4840'
export const BR_ROBOT_OPCUA_NAMESPACE_URI_V4 = 'http://br-automation.com/OpcUa/PLC/PV/'
export const BR_ROBOT_OPCUA_NODE_PREFIX_V4 = '::Sample6X:Rob.'

const BR_ROBOT_JOINT_NAMES_V4 = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'] as const

export interface BrRobotJointOpcUaBindingV4 {
  readonly jointId: string
  readonly opcUaNodeId: string
  readonly mappingId: string
}

export function brRobotJointOpcUaBindingsV4(
  project: WorkcellProjectV4,
  robotId: RobotIdV4,
): readonly BrRobotJointOpcUaBindingV4[] {
  const robot = project.robots.find((candidate) => candidate.id === robotId)
  if (robot === undefined) throw new Error(`Robot ${robotId} does not exist.`)
  const definition = project.robotDefinitions.find((candidate) => candidate.id === robot.definitionId)
  if (definition === undefined) throw new Error(`Robot Definition ${robot.definitionId} does not exist.`)
  if (definition.joints.length < BR_ROBOT_JOINT_NAMES_V4.length) {
    throw new Error('The selected Robot must have at least six Joints for Rob.Q1-Q6 binding.')
  }
  return Object.freeze(BR_ROBOT_JOINT_NAMES_V4.map((opcUaJointName, index) => ({
    jointId: definition.joints[index]!.id,
    opcUaNodeId: `ns=5;s=${BR_ROBOT_OPCUA_NODE_PREFIX_V4}${opcUaJointName}`,
    mappingId: `mapping-${robotId}-rob-${opcUaJointName.toLowerCase()}`,
  })))
}

function mappingForBindingV4(
  robotId: RobotIdV4,
  endpointId: string,
  binding: BrRobotJointOpcUaBindingV4,
): OpcUaMappingV4 {
  return {
    id: binding.mappingId,
    endpointId,
    direction: 'read',
    coherenceGroupId: null,
    sourceOwnership: `opcua:${endpointId}`,
    interpolationMode: 'none',
    coordinateConvention: 'project-v4-z-up-metres-quaternion-xyzw',
    leaves: [{
      leafPath: [],
      nodeId: binding.opcUaNodeId,
      projectTarget: { type: 'robot-joint', robotId, jointId: binding.jointId },
      opcUaDataType: 'Double',
      projectDataType: 'number',
      scale: 1,
      offset: 0,
      unit: 'deg',
      required: true,
    }],
  }
}

export function bindBrRobotJointsV4(
  projectInput: WorkcellProjectV4,
  robotId: RobotIdV4,
): WorkcellProjectV4 {
  const project = validateWorkcellProjectV4(projectInput)
  const bindings = brRobotJointOpcUaBindingsV4(project, robotId)
  const endpoint = {
    endpointId: BR_ROBOT_OPCUA_ENDPOINT_ID_V4,
    name: 'B&R Rob Q1-Q6',
    endpointUrl: BR_ROBOT_OPCUA_ENDPOINT_URL_V4,
    enabled: true,
    publishingIntervalMs: 100,
    reconnectDelayMs: 1_000,
  }
  const mappedJointIds = new Set(bindings.map(({ jointId }) => jointId))
  const mappings = project.opcUa.mappings.filter((mapping) => !mapping.leaves.some((leaf) => (
    leaf.projectTarget.type === 'robot-joint'
      && leaf.projectTarget.robotId === robotId
      && mappedJointIds.has(leaf.projectTarget.jointId)
  )))
  return validateWorkcellProjectV4({
    ...project,
    opcUa: {
      ...project.opcUa,
      mode: 'client',
      endpoints: [
        ...project.opcUa.endpoints.filter(({ endpointId }) => endpointId !== endpoint.endpointId),
        endpoint,
      ],
      mappings: [
        ...mappings,
        ...bindings.map((binding) => mappingForBindingV4(robotId, endpoint.endpointId, binding)),
      ],
    },
    robots: project.robots.map((candidate) => candidate.id === robotId
      ? { ...candidate, jointSource: `opcua:${endpoint.endpointId}` }
      : candidate),
  })
}
