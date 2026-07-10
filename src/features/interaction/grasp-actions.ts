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
    (requestedId !== undefined && requestedId !== held.equipmentId)
  ) {
    return null
  }

  const record = dependencies.getEquipment(held.equipmentId)
  if (record === undefined) {
    dependencies.clearHeld(held.equipmentId)
    return null
  }

  const worldTransform = composeWorldTransform(toolWorld, held.gripOffset)
  const releasedTransform = snapTransformToWorkbench(
    worldTransform,
    record.importMetadata?.colliderCenter ?? [0, 0, 0],
    record.collisionHalfExtents,
    workbenchTopZ,
  )
  dependencies.previewTransform(held.equipmentId, releasedTransform)
  dependencies.clearHeld(held.equipmentId)
  await dependencies.commitTransform(held.equipmentId)
  return releasedTransform
}

export async function resetInteractionAtTool(
  toolWorld: SerializableTransform,
  workbenchTopZ: number,
  dependencies: GraspActionDependencies,
): Promise<void> {
  const heldId = dependencies.getHeld()?.equipmentId
  await releaseHeldEquipmentAtTool(
    heldId,
    toolWorld,
    workbenchTopZ,
    dependencies,
  )
  dependencies.resetInteraction()
}
