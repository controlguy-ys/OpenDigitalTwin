import type { StoreApi } from 'zustand/vanilla'
import type { CollisionFinding } from '../../domain/collision/collision'
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
  pausePlayback?(): void
  now(): number
}

export interface CollisionEventTransitionSummary {
  readonly enteredPairKeys: readonly string[]
  readonly exitedPairKeys: readonly string[]
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
  dependencies.pausePlayback?.()
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

function collisionEntityId(value: string): CollisionEntityId {
  return value as CollisionEntityId
}

export function synchronizeCollisionFindings(
  findings: readonly CollisionFinding[],
  dependencies: CollisionEventDependencies,
): CollisionEventTransitionSummary {
  const interaction = dependencies.interactionStore.getState()
  const currentPairKeys = new Set<string>(interaction.activeCollisionPairs)
  const collisionFindings = findings.filter(
    (finding) => finding.kind === 'collision',
  )
  const nextPairKeys = new Set<string>(
    collisionFindings.map((finding) => finding.pairKey),
  )
  const exitedPairKeys: string[] = []
  const enteredPairKeys: string[] = []

  for (const pair of [...currentPairKeys].sort()) {
    if (nextPairKeys.has(pair)) continue
    const separatorIndex = pair.indexOf('|')
    const first = collisionEntityId(pair.slice(0, separatorIndex))
    const second = collisionEntityId(pair.slice(separatorIndex + 1))
    if (interaction.exitCollision(first, second)) {
      exitedPairKeys.push(pair)
    }
  }

  for (const finding of collisionFindings) {
    if (currentPairKeys.has(finding.pairKey)) continue
    const first = collisionEntityId(finding.firstEntityId)
    const second = collisionEntityId(finding.secondEntityId)
    if (!interaction.enterCollision(first, second)) continue
    dependencies.eventStore
      .getState()
      .appendCollision(
        canonicalCollisionPair(first, second),
        dependencies.now(),
      )
    enteredPairKeys.push(finding.pairKey)
  }

  if (enteredPairKeys.length > 0) {
    dependencies.pausePlayback?.()
  }
  return Object.freeze({
    enteredPairKeys: Object.freeze(enteredPairKeys),
    exitedPairKeys: Object.freeze(exitedPairKeys),
  })
}
