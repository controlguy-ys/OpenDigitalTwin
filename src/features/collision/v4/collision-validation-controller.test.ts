import { describe, expect, it, vi } from 'vitest'
import { spatialEntityCollisionIdV4 } from '../../../core/robot-runtime/collision-identity.js'
import type { CollisionPolicyV4 } from '../../../domain/collision/collision.js'
import {
  validateGeometryCollisionEntityV4,
} from '../../../domain/collision/collision.js'
import type { CollisionQueryResultV4 } from '../../../domain/collision/query-collision.js'
import type { CollisionGeometryProxyV4 } from './scene-entity-adapter-v4.js'
import {
  createCollisionValidationControllerV4,
  queryVisibleGeometryCollisionsV4,
} from './collision-validation-controller.js'

const policy = (): CollisionPolicyV4 => ({
  enabled: true,
  nearMissMarginM: 0,
  excludedPairKeys: new Set(),
  intentionalMountPairKeys: new Set(),
  ignoredContactPairKeys: new Set(),
})

const emptyResult = (): CollisionQueryResultV4 => Object.freeze({
  findings: Object.freeze([]),
  telemetry: Object.freeze({ entityCount: 1, boxCount: 1, broadPhaseCandidateCount: 0, narrowPhaseTestCount: 0, findingCount: 0 }),
})

function proxy(id: string, effectiveVisible = true): CollisionGeometryProxyV4 {
  return Object.freeze({
    effectiveVisible,
    entity: validateGeometryCollisionEntityV4({
      id: spatialEntityCollisionIdV4(id), name: id, category: 'spatial-entity',
      worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      boxes: [{ id: 'body', center: [0, 0, 0], halfExtents: [0.1, 0.1, 0.1], quaternion: [0, 0, 0, 1] }],
    }),
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, reject, resolve }
}

describe('createCollisionValidationControllerV4', () => {
  it('uses public policy/proxy order and only forwards visible Geometry to the default query', async () => {
    const result = await queryVisibleGeometryCollisionsV4(policy(), [proxy('visible'), proxy('hidden', false)])
    expect(result.telemetry.entityCount).toBe(1)
  })

  it('takes immutable accepted input snapshots and publishes frozen initial, pending, and success state', async () => {
    const inputs = [proxy('first')]
    const excluded = new Set<never>()
    const candidate = { ...policy(), excludedPairKeys: excluded }
    const query = vi.fn(async (receivedPolicy: CollisionPolicyV4, received: readonly CollisionGeometryProxyV4[]) => {
      expect(received).toEqual([proxy('first')])
      expect(receivedPolicy.excludedPairKeys.has('x|y' as never)).toBe(false)
      return emptyResult()
    })
    const controller = createCollisionValidationControllerV4({ initialInput: {
      projectRevisionId: 'revision-1', policy: candidate, proxies: inputs, jobRunning: false, query,
    } })
    const initial = controller.getState()
    expect(Object.isFrozen(initial)).toBe(true)
    expect(initial).toMatchObject({ pending: false, canValidate: true, error: null, result: null })
    inputs.push(proxy('later'))
    excluded.add('x|y' as never)
    const pending = controller.validate()
    expect(controller.getState()).toMatchObject({ pending: true, canValidate: false, result: null })
    await pending
    expect(controller.getState()).toMatchObject({ pending: false, canValidate: true, error: null })
    expect(query).toHaveBeenCalledOnce()
  })

  it('shares the exact pending Promise and publishes success once', async () => {
    const next = deferred<CollisionQueryResultV4>()
    const query = vi.fn(() => next.promise)
    const controller = createCollisionValidationControllerV4({ initialInput: {
      projectRevisionId: 'revision-1', policy: policy(), proxies: [proxy('one')], jobRunning: false, query,
    } })
    const listener = vi.fn()
    controller.subscribe(listener)
    const first = controller.validate()
    const second = controller.validate()
    expect(first).toBe(second)
    await Promise.resolve()
    expect(query).toHaveBeenCalledOnce()
    next.resolve(emptyResult())
    await first
    expect(listener).toHaveBeenCalledTimes(2)
    expect(controller.getState().result).toEqual(emptyResult())
  })

  it.each([
    ['synchronous Error', () => { throw new Error('sync failed') }, 'sync failed'],
    ['async Error', () => Promise.reject(new Error('async failed')), 'async failed'],
    ['non-Error rejection', () => Promise.reject('bad'), 'Collision validation failed.'],
  ] as const)('normalizes %s failures, publishes once, and rejects the same Error', async (_label, query, message) => {
    const controller = createCollisionValidationControllerV4({ initialInput: {
      projectRevisionId: 'revision-1', policy: policy(), proxies: [proxy('one')], jobRunning: false, query,
    } })
    const states: string[] = []
    controller.subscribe(() => states.push(controller.getState().error ?? 'pending'))
    const promise = controller.validate()
    await expect(promise).rejects.toThrow(message)
    expect(controller.getState()).toMatchObject({ pending: false, error: message, result: null })
    expect(states).toEqual(['pending', message])
  })

  it('keeps a nonempty Error object identical in state publication and caller rejection', async () => {
    const failure = new Error('same Error')
    const controller = createCollisionValidationControllerV4({ initialInput: {
      projectRevisionId: 'revision-1', policy: policy(), proxies: [proxy('one')], jobRunning: false,
      query: () => Promise.reject(failure),
    } })
    await expect(controller.validate()).rejects.toBe(failure)
    expect(controller.getState().error).toBe(failure.message)
  })

  it('rejects unavailable validation without issuing a query and preserves prior result', async () => {
    const query = vi.fn(async () => emptyResult())
    const controller = createCollisionValidationControllerV4({ initialInput: {
      projectRevisionId: 'revision-1', policy: policy(), proxies: [proxy('one')], jobRunning: false, query,
    } })
    await controller.validate()
    controller.replaceInput({ projectRevisionId: 'revision-1', policy: policy(), proxies: [], jobRunning: false, query })
    await expect(controller.validate()).rejects.toThrow(/requires registered Geometry/)
    expect(query).toHaveBeenCalledOnce()
    expect(controller.getState().result).toEqual(emptyResult())
    controller.replaceInput({ projectRevisionId: 'revision-1', policy: policy(), proxies: [proxy('one')], jobRunning: true, query })
    await expect(controller.validate()).rejects.toThrow(/while a Job is running/)
  })

  it('invalidates revision changes while old work settles and permits a new request', async () => {
    const oldQuery = deferred<CollisionQueryResultV4>()
    const newQuery = deferred<CollisionQueryResultV4>()
    const query = vi.fn()
      .mockReturnValueOnce(oldQuery.promise)
      .mockReturnValueOnce(newQuery.promise)
    const controller = createCollisionValidationControllerV4({ initialInput: {
      projectRevisionId: 'revision-old', policy: policy(), proxies: [proxy('old')], jobRunning: false, query,
    } })
    const oldPending = controller.validate()
    controller.replaceInput({ projectRevisionId: 'revision-new', policy: policy(), proxies: [proxy('new')], jobRunning: false, query })
    expect(controller.getState()).toMatchObject({ projectRevisionId: 'revision-new', pending: false, result: null })
    const nextPending = controller.validate()
    oldQuery.resolve(emptyResult())
    await oldPending
    expect(controller.getState().pending).toBe(true)
    newQuery.resolve(emptyResult())
    await nextPending
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('preserves same-revision result and prevents disposal from publishing later work', async () => {
    const pending = deferred<CollisionQueryResultV4>()
    const query = vi.fn(() => pending.promise)
    const controller = createCollisionValidationControllerV4({ initialInput: {
      projectRevisionId: 'revision-1', policy: policy(), proxies: [proxy('one')], jobRunning: false, query,
    } })
    const listener = vi.fn()
    controller.subscribe(listener)
    const request = controller.validate()
    controller.replaceInput({ projectRevisionId: 'revision-1', policy: policy(), proxies: [proxy('two')], jobRunning: false, query })
    controller.dispose()
    pending.resolve(emptyResult())
    await request
    expect(listener).toHaveBeenCalledOnce()
    await expect(controller.validate()).rejects.toThrow(/disposed/)
  })

  it('preserves a completed result through a same-revision input replacement', async () => {
    const query = vi.fn(async () => emptyResult())
    const controller = createCollisionValidationControllerV4({ initialInput: {
      projectRevisionId: 'revision-1', policy: policy(), proxies: [proxy('one')], jobRunning: false, query,
    } })
    await controller.validate()
    const completed = controller.getState().result
    controller.replaceInput({
      projectRevisionId: 'revision-1', policy: policy(), proxies: [proxy('two')], jobRunning: false, query,
    })
    expect(controller.getState().result).toBe(completed)
    expect(controller.getState().canValidate).toBe(true)
  })
})
