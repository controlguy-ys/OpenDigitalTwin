import type { RefObject } from 'react'
import type { Object3D } from 'three'

export function updateEquipmentObjectRegistration(
  registry: Map<string, Object3D>,
  equipmentId: string,
  ownerRef: RefObject<Object3D | null>,
  object: Object3D | null,
): void {
  const previousOwner = ownerRef.current
  if (object === null) {
    if (
      previousOwner !== null &&
      registry.get(equipmentId) === previousOwner
    ) {
      registry.delete(equipmentId)
    }
    ownerRef.current = null
    return
  }

  ownerRef.current = object
  registry.set(equipmentId, object)
}
