import { create } from 'zustand'
import { createStore } from 'zustand/vanilla'

export interface InteractionStoreState {
  selectedEquipmentId: string | null
  selectEquipment(id: string): void
  clearSelection(): void
}

function createInteractionState(
  set: (state: Partial<InteractionStoreState>) => void,
): InteractionStoreState {
  return {
    selectedEquipmentId: null,
    selectEquipment: (id) => {
      set({ selectedEquipmentId: id })
    },
    clearSelection: () => {
      set({ selectedEquipmentId: null })
    },
  }
}

export function createInteractionStore() {
  return createStore<InteractionStoreState>()(createInteractionState)
}

export const useInteractionStore = create<InteractionStoreState>()(
  createInteractionState,
)
