import type {
  FrameIdV4,
  OpcUaMappingV4,
  SpatialEntityIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'

export interface SpatialEntityOpcUaBindingV4 {
  readonly entityId: SpatialEntityIdV4
  readonly frameId: FrameIdV4
  readonly endpointId: string
  readonly poseMappingId: string
  readonly statusMappingId: string | null
}

function endpointIdFromOwner(owner: string): string | null {
  return owner.startsWith('opcua:') ? owner.slice('opcua:'.length) : null
}

function hasCanonicalPoseLeafPaths(mapping: OpcUaMappingV4): boolean {
  const paths = [
    ['positionM', 0], ['positionM', 1], ['positionM', 2],
    ['rpyDegrees', 0], ['rpyDegrees', 1], ['rpyDegrees', 2],
  ] as const
  return mapping.leaves.every((leaf, index) => (
    leaf.leafPath.length === 2
    && leaf.leafPath[0] === paths[index]![0]
    && leaf.leafPath[1] === paths[index]![1]
  ))
}

function isEntityFrameMapping(
  mapping: OpcUaMappingV4,
  entityId: SpatialEntityIdV4,
  frameId: FrameIdV4,
  endpointId: string,
): boolean {
  return mapping.direction === 'read'
    && mapping.endpointId === endpointId
    && mapping.sourceOwnership === `opcua:${endpointId}`
    && mapping.leaves.length === 6
    && mapping.interpolationMode === 'shortest-quaternion'
    && mapping.coordinateConvention === 'project-v4-z-up-metres-quaternion-xyzw'
    && hasCanonicalPoseLeafPaths(mapping)
    && mapping.leaves.every((leaf) => (
      leaf.projectTarget.type === 'entity-frame'
      && leaf.projectTarget.entityId === entityId
      && leaf.projectTarget.frameId === frameId
    ))
}

function isEntityStatusMapping(
  mapping: OpcUaMappingV4,
  entityId: SpatialEntityIdV4,
  endpointId: string,
): boolean {
  return mapping.direction === 'read'
    && mapping.endpointId === endpointId
    && mapping.sourceOwnership === `opcua:${endpointId}`
    && mapping.leaves.length === 1
    && mapping.leaves[0]?.projectTarget.type === 'entity-status'
    && mapping.leaves[0].projectTarget.entityId === entityId
}

export function selectSpatialEntityOpcUaBindingV4(
  project: WorkcellProjectV4,
  entityId: SpatialEntityIdV4,
): SpatialEntityOpcUaBindingV4 | null {
  const entity = project.spatialEntities.find(({ id }) => id === entityId)
  if (entity === undefined) return null
  const endpointId = endpointIdFromOwner(entity.transformOwner)
  if (endpointId === null) return null
  const frameId = entity.parentFrameId
  const movingFrame = entity.movingFrames.find(({ frameId: candidate }) => candidate === frameId)
  if (movingFrame?.sourceOwnership !== `opcua:${endpointId}`) return null
  const poseMappings = project.opcUa.mappings.filter((mapping) => (
    isEntityFrameMapping(mapping, entityId, frameId, endpointId)
  ))
  if (poseMappings.length !== 1) return null
  const statusMappings = project.opcUa.mappings.filter((mapping) => (
    isEntityStatusMapping(mapping, entityId, endpointId)
  ))
  if (statusMappings.length > 1) return null
  return {
    entityId,
    frameId,
    endpointId,
    poseMappingId: poseMappings[0]!.id,
    statusMappingId: statusMappings[0]?.id ?? null,
  }
}
