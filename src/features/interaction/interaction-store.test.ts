import { describe, expect, it } from 'vitest'
import { createInteractionStore } from './interaction-store'

describe('interaction selection', () => {
  it('selects one equipment id and clears it without storing scene objects', () => {
    const store = createInteractionStore()

    store.getState().selectEquipment('imported-01')
    expect(store.getState().selectedEquipmentId).toBe('imported-01')

    store.getState().clearSelection()
    expect(store.getState().selectedEquipmentId).toBeNull()
    expect(structuredClone({ selectedEquipmentId: store.getState().selectedEquipmentId })).toEqual({
      selectedEquipmentId: null,
    })
  })
})
