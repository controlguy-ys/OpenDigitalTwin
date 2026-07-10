export interface DeleteImportedEquipmentDependencies {
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
  await dependencies.releaseHeldEquipment(id)
  await dependencies.removeEquipment(id)
  dependencies.invalidateGeometry(id)
  if (dependencies.getSelectedEquipmentId() === id) {
    dependencies.clearSelection()
  }
}
