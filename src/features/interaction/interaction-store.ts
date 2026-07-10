import { create } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { SerializableTransform } from '../../domain/equipment/equipment'
import type { RobotLinkId } from '../../domain/robot/crb15000'

export type SceneSelection =
  | { readonly kind: 'robot' }
  | { readonly kind: 'robot-link'; readonly linkId: RobotLinkId }
  | { readonly kind: 'equipment'; readonly equipmentId: string }
  | null

export type CollisionEntityId =
  | `robot-link:${RobotLinkId}`
  | `equipment:${string}`
  | 'workcell:workbench'
  | 'grasp-sensor'
export type CollisionPairKey = `${CollisionEntityId}|${CollisionEntityId}`

export interface ReleasedEquipment {
  equipmentId: string
  gripOffset: SerializableTransform
}

export interface InteractionStoreState {
  selection: SceneSelection
  selectedEquipmentId: string | null
  hiddenEntityIds: readonly string[]
  graspCandidateIds: readonly string[]
  heldEquipmentId: string | null
  gripOffset: SerializableTransform | null
  activeCollisionPairs: readonly CollisionPairKey[]
  selectRobot(): void
  selectRobotLink(linkId: RobotLinkId): void
  selectEquipment(id: string): void
  clearSelection(): void
  clearSelectionForEntity(id: string): void
  setEntityVisible(id: string, visible: boolean): void
  enterGraspCandidate(id: string): void
  exitGraspCandidate(id: string): void
  holdEquipment(id: string, gripOffset: SerializableTransform): boolean
  releaseHeldEquipment(id?: string): ReleasedEquipment | null
  enterCollision(first: CollisionEntityId, second: CollisionEntityId): boolean
  exitCollision(first: CollisionEntityId, second: CollisionEntityId): boolean
  resetInteraction(): void
}

function cloneTransform(transform: SerializableTransform): SerializableTransform {
  return {
    position: [...transform.position],
    quaternion: [...transform.quaternion],
    scale: [...transform.scale],
  }
}

export function canonicalCollisionPair(
  first: CollisionEntityId,
  second: CollisionEntityId,
): CollisionPairKey {
  const [left, right] = first < second ? [first, second] : [second, first]
  return `${left}|${right}` as CollisionPairKey
}

function selectionMatchesId(selection: SceneSelection, id: string): boolean {
  if (selection === null) {
    return false
  }
  if (selection.kind === 'robot') {
    return id === 'robot'
  }
  if (selection.kind === 'robot-link') {
    return selection.linkId === id
  }
  return selection.equipmentId === id
}

const INITIAL_INTERACTION_STATE = {
  selection: null,
  selectedEquipmentId: null,
  hiddenEntityIds: [] as readonly string[],
  graspCandidateIds: [] as readonly string[],
  heldEquipmentId: null,
  gripOffset: null,
  activeCollisionPairs: [] as readonly CollisionPairKey[],
}

function createInteractionState(
  set: (
    update:
      | Partial<InteractionStoreState>
      | ((state: InteractionStoreState) => Partial<InteractionStoreState>),
  ) => void,
  get: () => InteractionStoreState,
): InteractionStoreState {
  return {
    ...INITIAL_INTERACTION_STATE,
    selectRobot: () => {
      set({ selection: { kind: 'robot' }, selectedEquipmentId: null })
    },
    selectRobotLink: (linkId) => {
      set({
        selection: { kind: 'robot-link', linkId },
        selectedEquipmentId: null,
      })
    },
    selectEquipment: (equipmentId) => {
      set({
        selection: { kind: 'equipment', equipmentId },
        selectedEquipmentId: equipmentId,
      })
    },
    clearSelection: () => {
      set({ selection: null, selectedEquipmentId: null })
    },
    clearSelectionForEntity: (id) => {
      if (selectionMatchesId(get().selection, id)) {
        set({ selection: null, selectedEquipmentId: null })
      }
    },
    setEntityVisible: (id, visible) => {
      set((state) => {
        const hiddenEntityIds = visible
          ? state.hiddenEntityIds.filter((hiddenId) => hiddenId !== id)
          : state.hiddenEntityIds.includes(id)
            ? state.hiddenEntityIds
            : [...state.hiddenEntityIds, id]
        const clearSelection = !visible && selectionMatchesId(state.selection, id)
        return {
          hiddenEntityIds,
          ...(clearSelection
            ? { selection: null, selectedEquipmentId: null }
            : {}),
        }
      })
    },
    enterGraspCandidate: (id) => {
      set((state) => ({
        graspCandidateIds: state.graspCandidateIds.includes(id)
          ? state.graspCandidateIds
          : [...state.graspCandidateIds, id],
      }))
    },
    exitGraspCandidate: (id) => {
      set((state) => ({
        graspCandidateIds: state.graspCandidateIds.filter(
          (candidateId) => candidateId !== id,
        ),
      }))
    },
    holdEquipment: (id, gripOffset) => {
      const state = get()
      if (
        state.heldEquipmentId !== null ||
        !state.graspCandidateIds.includes(id)
      ) {
        return false
      }

      set({ heldEquipmentId: id, gripOffset: cloneTransform(gripOffset) })
      return true
    },
    releaseHeldEquipment: (id) => {
      const state = get()
      if (
        state.heldEquipmentId === null ||
        state.gripOffset === null ||
        (id !== undefined && state.heldEquipmentId !== id)
      ) {
        return null
      }

      const released = {
        equipmentId: state.heldEquipmentId,
        gripOffset: cloneTransform(state.gripOffset),
      }
      set({ heldEquipmentId: null, gripOffset: null })
      return released
    },
    enterCollision: (first, second) => {
      const pair = canonicalCollisionPair(first, second)
      if (get().activeCollisionPairs.includes(pair)) {
        return false
      }
      set((state) => ({
        activeCollisionPairs: [...state.activeCollisionPairs, pair],
      }))
      return true
    },
    exitCollision: (first, second) => {
      const pair = canonicalCollisionPair(first, second)
      if (!get().activeCollisionPairs.includes(pair)) {
        return false
      }
      set((state) => ({
        activeCollisionPairs: state.activeCollisionPairs.filter(
          (activePair) => activePair !== pair,
        ),
      }))
      return true
    },
    resetInteraction: () => {
      set({ ...INITIAL_INTERACTION_STATE })
    },
  }
}

export function createInteractionStore() {
  return createStore<InteractionStoreState>()(createInteractionState)
}

export const useInteractionStore = create<InteractionStoreState>()(
  createInteractionState,
)
