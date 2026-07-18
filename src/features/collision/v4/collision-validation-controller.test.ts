import { describe, expect, it, vi } from 'vitest'
import type { CollisionPolicyV4 } from '../../../domain/collision/collision.js'
import type { CollisionGeometryProxyV4 } from './scene-entity-adapter-v4.js'
import { createCollisionValidationControllerV4 } from './collision-validation-controller.js'

const policy: CollisionPolicyV4 = {
  enabled: true,
  nearMissMarginM: 0,
  excludedPairKeys: new Set(),
  intentionalMountPairKeys: new Set(),
  ignoredContactPairKeys: new Set(),
}

describe('createCollisionValidationControllerV4', () => {
  it('shares a pending promise and preserves the failure Error identity', async () => {
    const failure = new Error('query failed')
    const query = vi.fn(() => Promise.reject(failure))
    const controller = createCollisionValidationControllerV4({ initialInput: {
      projectRevisionId: 'revision-1', policy, proxies: [{} as CollisionGeometryProxyV4], jobRunning: false, query,
    } })
    const first = controller.validate()
    const second = controller.validate()
    expect(first).toBe(second)
    await expect(first).rejects.toBe(failure)
    expect(controller.getState().error).toBe('query failed')
    expect(query).toHaveBeenCalledOnce()
  })
})
