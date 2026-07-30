import type {
  OpcUaMappingV5,
  OpcUaProjectTargetV5,
  SpatialEntityV5,
  WorkcellProjectV5,
} from '../../../core/project-v5/index.js'

export interface EntityCommsDisplayStateV1 {
  readonly enabled: boolean
  readonly tagName: string
  readonly mappingCount: number
}

export interface EntityCommsUpdateV1 {
  readonly enableComms?: boolean
  readonly tagName?: string
}

function targetReferencesEntity(target: OpcUaProjectTargetV5, entityId: string): boolean {
  return (target.type === 'entity-frame' || target.type === 'entity-status')
    && target.entityId === entityId
}

export function mappingTargetsEntityV1(mapping: OpcUaMappingV5, entityId: string): boolean {
  return mapping.leaves.some(({ projectTarget }) => targetReferencesEntity(projectTarget, entityId))
}

export function entityTargetMappingCountV1(project: WorkcellProjectV5, entityId: string): number {
  return project.opcUa.mappings.filter((mapping) => mappingTargetsEntityV1(mapping, entityId)).length
}

export function entityCommsDisplayStateV1(
  project: WorkcellProjectV5,
  entity: SpatialEntityV5,
): EntityCommsDisplayStateV1 {
  const mappingCount = entityTargetMappingCountV1(project, entity.id)
  return Object.freeze({
    enabled: entity.enableComms ?? mappingCount > 0,
    tagName: entity.tagName ?? entity.name,
    mappingCount,
  })
}

function isOpcUaOwner(owner: string): owner is `opcua:${string}` {
  return owner.startsWith('opcua:')
}

function disableEntityCommsV1(project: WorkcellProjectV5, entityId: string): WorkcellProjectV5 {
  const removedMappingIds = new Set(project.opcUa.mappings
    .filter((mapping) => mappingTargetsEntityV1(mapping, entityId))
    .map(({ id }) => id))
  const mappings = project.opcUa.mappings.filter(({ id }) => !removedMappingIds.has(id))
  const bridgeRoutes = project.opcUa.bridgeRoutes.filter(({ sourceMappingId, destinationMappingId }) => (
    !removedMappingIds.has(sourceMappingId) && !removedMappingIds.has(destinationMappingId)
  ))
  return {
    ...project,
    spatialEntities: project.spatialEntities.map((entity) => entity.id === entityId
      ? {
          ...entity,
          enableComms: false,
          transformOwner: isOpcUaOwner(entity.transformOwner) ? 'manual' : entity.transformOwner,
          numericStatus: {
            ...entity.numericStatus,
            sourceOwnership: isOpcUaOwner(entity.numericStatus.sourceOwnership)
              ? 'manual'
              : entity.numericStatus.sourceOwnership,
          },
          movingFrames: entity.movingFrames.map((frame) => ({
            ...frame,
            sourceOwnership: isOpcUaOwner(frame.sourceOwnership) ? 'manual' : frame.sourceOwnership,
          })),
        }
      : entity),
    opcUa: { ...project.opcUa, mappings, bridgeRoutes },
  }
}

export function updateEntityCommsV1(
  project: WorkcellProjectV5,
  entityId: string,
  update: EntityCommsUpdateV1,
): WorkcellProjectV5 {
  if (!project.spatialEntities.some((entity) => entity.id === entityId)) return project
  if (update.enableComms === false) {
    const disabled = disableEntityCommsV1(project, entityId)
    const tagName = update.tagName
    if (tagName === undefined) return disabled
    return {
      ...disabled,
      spatialEntities: disabled.spatialEntities.map((entity) => entity.id === entityId
        ? { ...entity, tagName }
        : entity),
    }
  }
  return {
    ...project,
    spatialEntities: project.spatialEntities.map((entity) => entity.id === entityId
      ? {
          ...entity,
          ...(update.enableComms === undefined ? {} : { enableComms: update.enableComms }),
          ...(update.tagName === undefined ? {} : { tagName: update.tagName }),
        }
      : entity),
  }
}
