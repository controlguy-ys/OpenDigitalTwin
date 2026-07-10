import type { StoreApi } from 'zustand/vanilla'
import type { EventStoreState } from '../../state/event-store'
import { isCollisionPairAllowed } from './interaction-math'
import {
  canonicalCollisionPair,
  type CollisionEntityId,
  type InteractionStoreState,
} from './interaction-store'

export interface CollisionEventDependencies {
  interactionStore: Pick<StoreApi<InteractionStoreState>, 'getState'>
  eventStore: Pick<StoreApi<EventStoreState>, 'getState'>
  pausePlayback(): void
  now(): number
}

export function handleCollisionEnter(
  first: CollisionEntityId,
  second: CollisionEntityId,
  dependencies: CollisionEventDependencies,
): boolean {
  if (!isCollisionPairAllowed(first, second)) {
    return false
  }
  const added = dependencies.interactionStore
    .getState()
    .enterCollision(first, second)
  if (!added) {
    return false
  }

  const pairKey = canonicalCollisionPair(first, second)
  dependencies.eventStore
    .getState()
    .appendCollision(pairKey, dependencies.now())
  dependencies.pausePlayback()
  return true
}

export function handleCollisionExit(
  first: CollisionEntityId,
  second: CollisionEntityId,
  dependencies: CollisionEventDependencies,
): boolean {
  if (!isCollisionPairAllowed(first, second)) {
    return false
  }
  return dependencies.interactionStore.getState().exitCollision(first, second)
}
