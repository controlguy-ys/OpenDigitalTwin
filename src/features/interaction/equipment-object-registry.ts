import type { RefObject } from 'react'
import type { Object3D } from 'three'
import { updateGeometryEntityObject } from '../collision/geometry-entity-registry'
import type { ExternalCollisionEntityId } from './interaction-store'

export function updateEquipmentObjectRegistration(
  registry: Map<string, Object3D>,
  entityId: ExternalCollisionEntityId,
  ownerRef: RefObject<Object3D | null>,
  object: Object3D | null,
): void {
  const previousOwner = ownerRef.current
  if (object === null) {
    if (
      previousOwner !== null &&
      registry.get(entityId) === previousOwner
    ) {
      registry.delete(entityId)
    }
    ownerRef.current = null
    updateGeometryEntityObject(entityId, registry.get(entityId) ?? null)
    return
  }

  ownerRef.current = object
  registry.set(entityId, object)
  updateGeometryEntityObject(entityId, object)
}
