import type { SerializableTransform } from '../domain/equipment/equipment'
import type { ExternalCollisionEntityId } from '../features/interaction/interaction-store'
import { routeCanonicalExternalEntity } from './external-entity-removal'

interface CanonicalExternalEntityMutationDependencies {
  previewEquipment(id: string, transform: SerializableTransform): void
  previewObject(id: string, transform: SerializableTransform): void
  commitEquipment(id: string): Promise<void>
  commitObject(id: string): Promise<void>
  cancelEquipment(id: string): void
  cancelObject(id: string): void
  setEquipmentNumericStatus(id: string, value: number): Promise<void>
  setEquipmentOverlayVisible(id: string, visible: boolean): Promise<void>
  setEquipmentStatusSource(
    id: string,
    source: 'manual' | 'opcua',
  ): Promise<void>
  updateObject(id: string, update: Record<string, unknown>): Promise<void>
}

export interface CanonicalExternalEntityMutations {
  preview(
    entityId: ExternalCollisionEntityId,
    transform: SerializableTransform,
  ): void
  commit(entityId: ExternalCollisionEntityId): Promise<void>
  cancel(entityId: ExternalCollisionEntityId): void
  setNumericStatus(
    entityId: ExternalCollisionEntityId,
    value: number,
  ): Promise<void>
  setOverlayVisible(
    entityId: ExternalCollisionEntityId,
    visible: boolean,
  ): Promise<void>
  setStatusSource(
    entityId: ExternalCollisionEntityId,
    source: 'manual' | 'opcua',
  ): Promise<void>
}

export function createCanonicalExternalEntityMutations(
  dependencies: CanonicalExternalEntityMutationDependencies,
): CanonicalExternalEntityMutations {
  return {
    preview: (entityId, transform) =>
      routeCanonicalExternalEntity(entityId, {
        equipment: (id) => dependencies.previewEquipment(id, transform),
        object: (id) => dependencies.previewObject(id, transform),
      }),
    commit: (entityId) =>
      routeCanonicalExternalEntity(entityId, {
        equipment: dependencies.commitEquipment,
        object: dependencies.commitObject,
      }),
    cancel: (entityId) =>
      routeCanonicalExternalEntity(entityId, {
        equipment: dependencies.cancelEquipment,
        object: dependencies.cancelObject,
      }),
    setNumericStatus: (entityId, value) =>
      routeCanonicalExternalEntity(entityId, {
        equipment: (id) => dependencies.setEquipmentNumericStatus(id, value),
        object: (id) =>
          dependencies.updateObject(id, {
            numericStatus: value,
            statusSource: 'manual',
          }),
      }),
    setOverlayVisible: (entityId, visible) =>
      routeCanonicalExternalEntity(entityId, {
        equipment: (id) =>
          dependencies.setEquipmentOverlayVisible(id, visible),
        object: (id) =>
          dependencies.updateObject(id, { statusOverlayVisible: visible }),
      }),
    setStatusSource: (entityId, source) =>
      routeCanonicalExternalEntity(entityId, {
        equipment: (id) =>
          dependencies.setEquipmentStatusSource(id, source),
        object: (id) => dependencies.updateObject(id, { statusSource: source }),
      }),
  }
}
