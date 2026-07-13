import { create } from 'zustand'
import { createStore } from 'zustand/vanilla'
import {
  DEFAULT_COLLISION_POLICY,
  validateCollisionDiagnostic,
  validateCollisionFinding,
  validateCollisionPolicy,
  type CollisionDiagnostic,
  type CollisionFinding,
  type CollisionPolicy,
} from '../../domain/collision/collision'

export interface CollisionStateSnapshot {
  readonly policy: CollisionPolicy
  readonly currentFindings: readonly CollisionFinding[]
  readonly diagnostics: readonly CollisionDiagnostic[]
}

export interface CollisionStoreState extends CollisionStateSnapshot {
  replaceCollisionState(snapshot: CollisionStateSnapshot): void
}

function ownedSnapshot(snapshot: CollisionStateSnapshot): CollisionStateSnapshot {
  return {
    policy: validateCollisionPolicy(snapshot.policy),
    currentFindings: Object.freeze(
      snapshot.currentFindings.map(validateCollisionFinding),
    ),
    diagnostics: Object.freeze(
      snapshot.diagnostics.map(validateCollisionDiagnostic),
    ),
  }
}

function createInitialSnapshot(): CollisionStateSnapshot {
  return ownedSnapshot({
    policy: DEFAULT_COLLISION_POLICY,
    currentFindings: [],
    diagnostics: [],
  })
}

function collisionStateCreator(
  set: (snapshot: CollisionStateSnapshot) => void,
): CollisionStoreState {
  return {
    ...createInitialSnapshot(),
    replaceCollisionState: (candidate) => {
      const snapshot = ownedSnapshot(candidate)
      set(snapshot)
    },
  }
}

export function createCollisionStore() {
  return createStore<CollisionStoreState>()(collisionStateCreator)
}

export const useCollisionStore = create<CollisionStoreState>()(
  collisionStateCreator,
)
