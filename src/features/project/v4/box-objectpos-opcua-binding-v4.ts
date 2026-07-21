import {
  validateWorkcellProjectV4,
  type OpcUaMappingV4,
  type RigidTransformV4,
  type SpatialEntityV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'

export const BR_OBJECT_POS_ENDPOINT_ID_V4 = 'endpoint-br-object-pos'
export const BR_OBJECT_POS_ENDPOINT_URL_V4 = 'opc.tcp://127.0.0.1:4840'
export const BR_OBJECT_POS_BOX_COUNT_V4 = 20
export const BR_OBJECT_POS_BOX_SPACING_M_V4 = 0.3
export const BR_OBJECT_POS_NODE_PREFIX_V4 = 'ns=5;s=::Sample6X:ObjectPos'

const OBJECT_POS_LEAVES_V4 = [
  ['positionM', 0, 'X', 0.001, 'metre'],
  ['positionM', 1, 'Y', 0.001, 'metre'],
  ['positionM', 2, 'Z', 0.001, 'metre'],
  ['rpyDegrees', 0, 'Roll', 1, 'degree'],
  ['rpyDegrees', 1, 'Pitch', 1, 'degree'],
  ['rpyDegrees', 2, 'Yaw', 1, 'degree'],
] as const

const IDENTITY_POSE_V4: RigidTransformV4 = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
}

function rowPoseV4(index: number): RigidTransformV4 {
  return {
    positionM: [index * BR_OBJECT_POS_BOX_SPACING_M_V4, 0, 0],
    quaternion: [0, 0, 0, 1],
  }
}

function boxIdV4(index: number): string {
  return `box-object-pos-${String(index).padStart(2, '0')}`
}

function frameIdV4(index: number): string {
  return `frame-object-pos-${String(index).padStart(2, '0')}`
}

function mappingIdV4(index: number): string {
  return `mapping-object-pos-${String(index).padStart(2, '0')}`
}

function nodeIdV4(index: number, field: string): string {
  return `${BR_OBJECT_POS_NODE_PREFIX_V4}[${index}].${field}`
}

function objectPosBoxV4(index: number): SpatialEntityV4 {
  const entityId = boxIdV4(index)
  const frameId = frameIdV4(index)
  const rowPose = rowPoseV4(index)
  const owner = `opcua:${BR_OBJECT_POS_ENDPOINT_ID_V4}` as const
  return {
    id: entityId,
    name: `ObjectPos[${index}]`,
    geometry: {
      kind: 'box',
      dimensionsM: [0.2, 0.2, 0.2],
      color: '#2dd4bf',
    },
    parentFrameId: frameId,
    localPose: IDENTITY_POSE_V4,
    visible: true,
    groupId: null,
    removable: true,
    transformOwner: owner,
    numericStatus: {
      value: 0,
      sourceOwnership: 'manual',
      overlay: { visible: false, frameId: null },
    },
    graspable: false,
    graspFrames: [],
    movingFrames: [{
      frameId,
      name: `ObjectPos[${index}] OPC UA Frame`,
      parentFrameId: 'mcp',
      localPose: rowPose,
      sourceOwnership: owner,
    }],
  }
}

function objectPosMappingV4(index: number): OpcUaMappingV4 {
  const entityId = boxIdV4(index)
  const frameId = frameIdV4(index)
  const target = { type: 'entity-frame' as const, entityId, frameId }
  return {
    id: mappingIdV4(index),
    endpointId: BR_OBJECT_POS_ENDPOINT_ID_V4,
    direction: 'read',
    publishingIntervalMs: 100,
    coherenceGroupId: `entity:${entityId}:pose`,
    sourceOwnership: `opcua:${BR_OBJECT_POS_ENDPOINT_ID_V4}`,
    interpolationMode: 'shortest-quaternion',
    coordinateConvention: 'project-v4-z-up-metres-quaternion-xyzw',
    leaves: OBJECT_POS_LEAVES_V4.map(([root, component, field, scale, unit]) => ({
      leafPath: [root, component],
      nodeId: nodeIdV4(index, field),
      projectTarget: target,
      opcUaDataType: 'Double' as const,
      projectDataType: 'number' as const,
      scale,
      offset: 0,
      unit,
      required: true,
    })),
  }
}

export function bindBrObjectPosBoxesV4(
  projectInput: WorkcellProjectV4,
): WorkcellProjectV4 {
  const project = validateWorkcellProjectV4(projectInput)
  const reservedEntityIds = new Set(
    Array.from({ length: BR_OBJECT_POS_BOX_COUNT_V4 }, (_, index) => boxIdV4(index)),
  )
  const reservedMappingIds = new Set(
    Array.from({ length: BR_OBJECT_POS_BOX_COUNT_V4 }, (_, index) => mappingIdV4(index)),
  )
  const endpoint = {
    endpointId: BR_OBJECT_POS_ENDPOINT_ID_V4,
    name: 'B&R ObjectPos[0..19]',
    endpointUrl: BR_OBJECT_POS_ENDPOINT_URL_V4,
    enabled: true,
    publishingIntervalMs: 100,
    reconnectDelayMs: 1_000,
  }
  const preservedMappings = project.opcUa.mappings.filter((mapping) => (
    mapping.endpointId !== BR_OBJECT_POS_ENDPOINT_ID_V4
      && !mapping.leaves.some((leaf) => (
        (leaf.projectTarget.type === 'entity-frame' || leaf.projectTarget.type === 'entity-status')
          && reservedEntityIds.has(leaf.projectTarget.entityId)
      ))
  ))
  const preservedActionBindings = project.opcUa.actionBindings.filter((binding) => (
    binding.endpointId !== BR_OBJECT_POS_ENDPOINT_ID_V4
  ))
  const preservedBridgeRoutes = project.opcUa.bridgeRoutes.filter((route) => (
    !reservedMappingIds.has(route.sourceChannelId) && !reservedMappingIds.has(route.destinationChannelId)
  ))
  return validateWorkcellProjectV4({
    ...project,
    spatialEntities: [
      ...project.spatialEntities.filter(({ id }) => !reservedEntityIds.has(id)),
      ...Array.from({ length: BR_OBJECT_POS_BOX_COUNT_V4 }, (_, index) => objectPosBoxV4(index)),
    ],
    opcUa: {
      ...project.opcUa,
      mode: 'client',
      endpoints: [
        ...project.opcUa.endpoints.filter(({ endpointId }) => endpointId !== BR_OBJECT_POS_ENDPOINT_ID_V4),
        endpoint,
      ],
      mappings: [
        ...preservedMappings,
        ...Array.from({ length: BR_OBJECT_POS_BOX_COUNT_V4 }, (_, index) => objectPosMappingV4(index)),
      ],
      actionBindings: preservedActionBindings,
      bridgeRoutes: preservedBridgeRoutes,
    },
  })
}
