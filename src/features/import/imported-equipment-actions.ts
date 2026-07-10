export interface DeleteImportedEquipmentDependencies {
  beginEquipmentRemoval(id: string): boolean
  endEquipmentRemoval(id: string): void
  releaseHeldEquipment(id: string): Promise<void>
  removeEquipment(id: string): Promise<void>
  invalidateGeometry(id: string): void
  getSelectedEquipmentId(): string | null
  clearSelection(): void
}

export async function deleteImportedEquipment(
  id: string,
  dependencies: DeleteImportedEquipmentDependencies,
): Promise<void> {
  if (!dependencies.beginEquipmentRemoval(id)) {
    throw new Error('Equipment removal is already in progress. Retry when it completes.')
  }
  try {
    await dependencies.releaseHeldEquipment(id)
    await dependencies.removeEquipment(id)
    dependencies.invalidateGeometry(id)
    if (dependencies.getSelectedEquipmentId() === id) {
      dependencies.clearSelection()
    }
  } finally {
    dependencies.endEquipmentRemoval(id)
  }
}
