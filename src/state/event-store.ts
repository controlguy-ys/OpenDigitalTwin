import { create } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { CollisionPairKey } from '../features/interaction/interaction-store'

export interface SimulationEvent {
  id: string
  type: 'collision'
  severity: 'error'
  timestampMs: number
  pairKey: CollisionPairKey
  message: string
}

export interface EventStoreState {
  events: readonly SimulationEvent[]
  appendCollision(pairKey: CollisionPairKey, timestampMs?: number): void
}

function createEventStateCreator() {
  let sequence = 0
  return (
    set: (
      update: (state: EventStoreState) => Partial<EventStoreState>,
    ) => void,
  ): EventStoreState => ({
    events: [],
    appendCollision: (pairKey, timestampMs = Date.now()) => {
      sequence += 1
      const event: SimulationEvent = {
        id: `collision-${timestampMs}-${sequence}`,
        type: 'collision',
        severity: 'error',
        timestampMs,
        pairKey,
        message: `Collision detected: ${pairKey}`,
      }
      set((state) => ({ events: [...state.events, event] }))
    },
  })
}

export function createEventStore() {
  return createStore<EventStoreState>()(createEventStateCreator())
}

export const useEventStore = create<EventStoreState>()(createEventStateCreator())
