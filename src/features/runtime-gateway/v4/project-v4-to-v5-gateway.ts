import type { OpcUaNodeAddressV1 } from '../../../core/project-v5/opcua-node-address.js'
import {
  validateWorkcellProjectV5,
  type RobotControllerV5,
  type RobotDefinitionV5,
  type RobotInstanceV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import type { WorkcellProjectV4 } from '../../../core/project-v4/index.js'

const B_AND_R_PLC_NAMESPACE_URI_V5 = 'http://br-automation.com/OpcUa/PLC/PV/'
const NAMESPACE_URIS_V5: Readonly<Record<number, string>> = Object.freeze({
  0: 'http://opcfoundation.org/UA/',
  1: 'urn:127.0.0.1/BR/UA/EmbeddedServer',
  2: 'http://opcfoundation.org/UA/DI/',
  3: 'http://PLCopen.org/OpcUa/IEC61131-3/',
  4: 'http://br-automation.com/OpcUa/PLC/',
  5: B_AND_R_PLC_NAMESPACE_URI_V5,
  6: 'http://br-automation.com/OpcUa/PLC/SoftwareComponents/',
})

function nodeAddressV5(nodeId: string): OpcUaNodeAddressV1 {
  const match = /^ns=(\d+);s=(.+)$/u.exec(nodeId)
  if (match === null) throw new Error(`Only string OPC UA Node IDs can be sent to the V5 Gateway: ${nodeId}`)
  const namespaceUri = NAMESPACE_URIS_V5[Number(match[1])]
  if (namespaceUri === undefined) throw new Error(`OPC UA namespace index ${match[1]} is not configured.`)
  return {
    namespaceUri,
    identifierType: 'string',
    identifier: match[2]!,
  }
}

function robotDefinitionV5(
  definition: WorkcellProjectV4['robotDefinitions'][number],
): RobotDefinitionV5 {
  return {
    id: definition.id,
    name: definition.name,
    identification: {
      manufacturer: definition.manufacturer,
      model: definition.model,
      productCode: definition.model,
      serialNumberTemplate: null,
      motionDeviceCategory: 'ARTICULATED_ROBOT',
    },
    assetReferenceIds: definition.assetReferenceIds,
    sourceConventions: definition.sourceConventions,
    links: definition.links,
    joints: definition.joints,
    frames: definition.frames,
    excludedGeometryOccurrenceKeys: definition.excludedGeometryOccurrenceKeys,
  } as RobotDefinitionV5
}

function robotControllerV5(
  robot: WorkcellProjectV4['robots'][number],
): RobotControllerV5 {
  return {
    id: `controller-${robot.id}`,
    name: `${robot.name} Controller`,
    identification: {
      manufacturer: 'B&R',
      model: 'OPC UA Runtime Gateway',
      productCode: 'OPC-UA',
      serialNumber: `CTRL-${robot.id}`,
    },
  }
}

function robotInstanceV5(
  project: WorkcellProjectV4,
  robot: WorkcellProjectV4['robots'][number],
): RobotInstanceV5 {
  const definition = project.robotDefinitions.find(({ id }) => id === robot.definitionId)
  if (definition === undefined) throw new Error(`Robot Definition ${robot.definitionId} does not exist.`)
  const frameSources = Object.fromEntries(definition.frames.map(({ id }) => [id, robot.jointSource]))
  return {
    id: robot.id,
    name: robot.name,
    definitionId: robot.definitionId,
    serialNumber: `ROBOT-${robot.id}`,
    controllerId: `controller-${robot.id}`,
    visible: robot.visible,
    baseParentFrameId: robot.baseParentFrameId,
    localBasePose: robot.localBasePose,
    initialJointValues: robot.initialJointValues,
    jointSource: robot.jointSource,
    frameSources,
    selectedToolFrameId: robot.selectedToolFrameId,
    selectedTcpFrameId: robot.selectedTcpFrameId,
    numericStatus: robot.numericStatus,
    intentionalMountEntityId: null,
  }
}

function robotJointMappingsV5(project: WorkcellProjectV4): WorkcellProjectV5['opcUa']['mappings'] {
  if (project.opcUa.mode !== 'client' && project.opcUa.mode !== 'bridge') return []
  return project.opcUa.mappings.flatMap((mapping) => {
    if (mapping.direction !== 'read' && mapping.direction !== 'readWrite') return []
    const leaf = mapping.leaves.length === 1 ? mapping.leaves[0] : undefined
    if (leaf?.projectTarget.type !== 'robot-joint') return []
    return [{
      id: mapping.id,
      endpointId: mapping.endpointId,
      nodeAddress: nodeAddressV5(leaf.nodeId),
      direction: mapping.direction,
      ...(mapping.publishingIntervalMs === undefined ? {} : { publishingIntervalMs: mapping.publishingIntervalMs }),
      coherenceGroupId: mapping.coherenceGroupId,
      interpolationMode: mapping.interpolationMode,
      coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw' as const,
      leaves: [{
        leafPath: [],
        projectPath: [],
        projectTarget: leaf.projectTarget,
        opcUaDataType: leaf.opcUaDataType,
        projectDataType: leaf.projectDataType,
        scale: leaf.scale,
        offset: leaf.offset,
        unit: leaf.unit,
        required: leaf.required,
      }],
    }]
  })
}

export function projectV4ToV5Gateway(project: WorkcellProjectV4): WorkcellProjectV5 {
  const converted: WorkcellProjectV5 = {
    schemaVersion: 5,
    projectId: project.projectId,
    revisionId: project.revisionId,
    metadata: project.metadata,
    assetReferences: project.assetReferences,
    scene: project.scene,
    robotDefinitions: project.robotDefinitions.map(robotDefinitionV5),
    controllers: project.robots.map(robotControllerV5),
    robots: project.robots.map((robot) => robotInstanceV5(project, robot)),
    spatialEntities: project.spatialEntities,
    sceneGroups: project.sceneGroups,
    logicalSignals: [],
    jobs: [],
    opcUa: {
      mode: project.opcUa.mode,
      endpoints: project.opcUa.endpoints,
      mappings: robotJointMappingsV5(project),
      bridgeRoutes: [],
    },
  }
  return validateWorkcellProjectV5(converted)
}
