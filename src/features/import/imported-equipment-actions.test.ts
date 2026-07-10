import { describe, expect, it, vi } from 'vitest'
import { deleteImportedEquipment } from './imported-equipment-actions'

describe('deleteImportedEquipment', () => {
  it('removes persistence before invalidating geometry and clearing matching selection', async () => {
    const calls: string[] = []
    const dependencies = {
      removeEquipment: vi.fn(async () => {
        calls.push('record')
      }),
      invalidateGeometry: vi.fn(() => {
        calls.push('geometry')
      }),
      getSelectedEquipmentId: () => 'imported-01',
      clearSelection: vi.fn(() => {
        calls.push('selection')
      }),
    }

    await deleteImportedEquipment('imported-01', dependencies)

    expect(calls).toEqual(['record', 'geometry', 'selection'])
  })

  it('leaves cache and selection unchanged when record removal rejects', async () => {
    const invalidateGeometry = vi.fn()
    const clearSelection = vi.fn()

    await expect(
      deleteImportedEquipment('imported-01', {
        removeEquipment: vi.fn(async () => {
          throw new Error('remove failed')
        }),
        invalidateGeometry,
        getSelectedEquipmentId: () => 'imported-01',
        clearSelection,
      }),
    ).rejects.toThrow('remove failed')

    expect(invalidateGeometry).not.toHaveBeenCalled()
    expect(clearSelection).not.toHaveBeenCalled()
  })
})
