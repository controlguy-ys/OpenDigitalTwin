import type { RevisionIdV4 } from '../../../core/project-v4/index.js'
import type { CollisionPolicyV4 } from '../../../domain/collision/collision.js'
import {
  queryGeometryCollisionsWithTelemetryV4,
  type CollisionQueryResultV4,
} from '../../../domain/collision/query-collision.js'
import {
  visibleCollisionEntitiesV4,
  type CollisionGeometryProxyV4,
} from './scene-entity-adapter-v4.js'

export type CollisionQueryV4 = (
  policy: CollisionPolicyV4,
  proxies: readonly CollisionGeometryProxyV4[],
) => CollisionQueryResultV4 | Promise<CollisionQueryResultV4>

export interface CollisionValidationInputV4 {
  readonly projectRevisionId: RevisionIdV4
  readonly policy: CollisionPolicyV4
  readonly proxies: readonly CollisionGeometryProxyV4[]
  readonly jobRunning: boolean
  readonly query: CollisionQueryV4
}

export interface CollisionValidationStateV4 {
  readonly projectRevisionId: RevisionIdV4
  readonly pending: boolean
  readonly canValidate: boolean
  readonly error: string | null
  readonly result: CollisionQueryResultV4 | null
}

export interface CollisionValidationControllerV4 {
  getState(): CollisionValidationStateV4
  subscribe(listener: () => void): () => void
  replaceInput(input: CollisionValidationInputV4): void
  validate(): Promise<void>
  dispose(): void
}

export interface CreateCollisionValidationControllerOptionsV4 {
  readonly initialInput: CollisionValidationInputV4
}

export const queryVisibleGeometryCollisionsV4: CollisionQueryV4 = (policy, proxies) => (
  queryGeometryCollisionsWithTelemetryV4(visibleCollisionEntitiesV4(proxies), policy)
)

function copyInput(input: CollisionValidationInputV4): CollisionValidationInputV4 {
  return Object.freeze({
    ...input,
    policy: Object.freeze({
      ...input.policy,
      excludedPairKeys: new Set(input.policy.excludedPairKeys),
      intentionalMountPairKeys: new Set(input.policy.intentionalMountPairKeys),
      ignoredContactPairKeys: new Set(input.policy.ignoredContactPairKeys),
    }),
    proxies: Object.freeze([...input.proxies]),
  })
}

function canValidate(input: CollisionValidationInputV4): boolean {
  return !input.jobRunning && input.proxies.length > 0
}

function immutableState(state: CollisionValidationStateV4): CollisionValidationStateV4 {
  return Object.freeze({ ...state })
}

function normalizedError(error: unknown): Error {
  return error instanceof Error && error.message.length > 0
    ? error
    : new Error('Collision validation failed.')
}

export function createCollisionValidationControllerV4(
  options: CreateCollisionValidationControllerOptionsV4,
): CollisionValidationControllerV4 {
  let disposed = false
  let input = copyInput(options.initialInput)
  let state = immutableState({
    projectRevisionId: input.projectRevisionId,
    pending: false,
    canValidate: canValidate(input),
    error: null,
    result: null,
  })
  let token = 0
  let inFlight: Promise<void> | null = null
  const subscribers = new Set<() => void>()

  const publish = (next: CollisionValidationStateV4): void => {
    if (disposed) return
    state = immutableState(next)
    const listeners = new Set(subscribers)
    for (const listener of listeners) listener()
  }

  const controller: CollisionValidationControllerV4 = {
    getState: () => state,
    subscribe(listener) {
      if (!disposed) subscribers.add(listener)
      return () => subscribers.delete(listener)
    },
    replaceInput(nextInput) {
      if (disposed) return
      const next = copyInput(nextInput)
      const revisionChanged = next.projectRevisionId !== input.projectRevisionId
      input = next
      if (revisionChanged) {
        token += 1
        inFlight = null
        publish({
          projectRevisionId: input.projectRevisionId,
          pending: false,
          canValidate: canValidate(input),
          error: null,
          result: null,
        })
      } else if (!state.pending) {
        publish({ ...state, canValidate: canValidate(input) })
      }
    },
    validate() {
      if (disposed) return Promise.reject(new Error('Collision validation controller is disposed.'))
      if (inFlight !== null) return inFlight
      if (!canValidate(input)) {
        const error = new Error(input.jobRunning
          ? 'Collision validation is unavailable while a Job is running.'
          : 'Collision validation requires registered Geometry.')
        publish({ ...state, pending: false, canValidate: false, error: error.message })
        return Promise.reject(error)
      }
      const requestInput = input
      const requestToken = ++token
      publish({ ...state, pending: true, canValidate: false, error: null })
      const pending = Promise.resolve()
        .then(() => requestInput.query(requestInput.policy, requestInput.proxies))
        .then(
          (result) => {
            if (!disposed && token === requestToken) {
              inFlight = null
              publish({
                projectRevisionId: input.projectRevisionId,
                pending: false,
                canValidate: canValidate(input),
                error: null,
                result,
              })
            }
          },
          (caught: unknown) => {
            const error = normalizedError(caught)
            if (!disposed && token === requestToken) {
              inFlight = null
              publish({
                projectRevisionId: input.projectRevisionId,
                pending: false,
                canValidate: canValidate(input),
                error: error.message,
                result: null,
              })
            }
            throw error
          },
        )
      inFlight = pending
      return pending
    },
    dispose() {
      if (disposed) return
      disposed = true
      token += 1
      inFlight = null
      subscribers.clear()
    },
  }
  return Object.freeze(controller)
}
