import type { ExternalCollisionEntityId } from '../features/interaction/interaction-store'

export interface ExternalEntityRemovalOwners {
  removeEquipment(id: string): Promise<void>
  removeObject(id: string): Promise<void>
}

export async function removeCanonicalExternalEntity(
  entityId: ExternalCollisionEntityId,
  owners: ExternalEntityRemovalOwners,
): Promise<void> {
  if (entityId.startsWith('object:')) {
    await owners.removeObject(entityId.slice('object:'.length))
    return
  }
  await owners.removeEquipment(entityId.slice('equipment:'.length))
}
