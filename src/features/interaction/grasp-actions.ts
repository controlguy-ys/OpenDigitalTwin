import type {
  EquipmentRecord,
  SerializableTransform,
} from '../../domain/equipment/equipment'
import type { ReleasedEquipment } from './interaction-store'
import {
  composeWorldTransform,
  snapTransformToWorkbench,
} from './interaction-math'

export interface GraspActionDependencies {
  getHeld(): ReleasedEquipment | null
  getEquipment(id: string): EquipmentRecord | undefined
  previewTransform(id: string, transform: SerializableTransform): void
  clearHeld(id: string): void
  commitTransform(id: string): Promise<void>
  resetInteraction(): void
  toPersistedTransform(world: SerializableTransform): SerializableTransform
}

export async function releaseHeldEquipmentAtTool(
  requestedId: string | undefined,
  toolWorld: SerializableTransform,
  workbenchTopZ: number,
  dependencies: GraspActionDependencies,
): Promise<SerializableTransform | null> {
  const held = dependencies.getHeld()
  if (
    held === null ||
    (requestedId !== undefined &&
      (requestedId.includes(':')
        ? requestedId !== held.entityId
        : requestedId !== held.equipmentId))
  ) {
    return null
  }

  const record = dependencies.getEquipment(held.entityId)
  if (record === undefined) {
    dependencies.clearHeld(held.entityId)
    return null
  }

  const worldTransform = composeWorldTransform(toolWorld, held.gripOffset)
  const releasedTransform = snapTransformToWorkbench(
    worldTransform,
    record.collisionCenter ??
      record.importMetadata?.colliderCenter ??
      [0, 0, 0],
    record.collisionHalfExtents,
    workbenchTopZ,
  )
  dependencies.previewTransform(
    held.entityId,
    dependencies.toPersistedTransform(releasedTransform),
  )
  dependencies.clearHeld(held.entityId)
  await dependencies.commitTransform(held.entityId)
  return releasedTransform
}

export async function resetInteractionAtTool(
  toolWorld: SerializableTransform,
  workbenchTopZ: number,
  dependencies: GraspActionDependencies,
): Promise<void> {
  const heldId = dependencies.getHeld()?.entityId
  await releaseHeldEquipmentAtTool(
    heldId,
    toolWorld,
    workbenchTopZ,
    dependencies,
  )
  dependencies.resetInteraction()
}
