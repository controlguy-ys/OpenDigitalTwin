import type { ExternalCollisionEntityId } from '../features/interaction/interaction-store'

export interface ExternalEntityRemovalOwners {
  removeEquipment(id: string): Promise<void>
  removeObject(id: string): Promise<void>
}

export interface CanonicalExternalEntityOwners<Result> {
  equipment(id: string): Result
  object(id: string): Result
}

export function routeCanonicalExternalEntity<Result>(
  entityId: ExternalCollisionEntityId,
  owners: CanonicalExternalEntityOwners<Result>,
): Result {
  return entityId.startsWith('object:')
    ? owners.object(entityId.slice('object:'.length))
    : owners.equipment(entityId.slice('equipment:'.length))
}

export async function removeCanonicalExternalEntity(
  entityId: ExternalCollisionEntityId,
  owners: ExternalEntityRemovalOwners,
): Promise<void> {
  await routeCanonicalExternalEntity(entityId, {
    equipment: owners.removeEquipment,
    object: owners.removeObject,
  })
}
