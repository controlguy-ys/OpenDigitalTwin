import { describe, expect, it } from 'vitest'

import { createBrowserPublisherLeaseManagerV1 } from './browser-publisher-lease.js'

const REVISION = 'a'.repeat(64)

describe('BrowserPublisherLeaseManagerV1', () => {
  it('increments generation on acquisition, replacement, and revision invalidation', () => {
    let now = 1_000
    const lease = createBrowserPublisherLeaseManagerV1({ nowMs: () => now })
    expect(lease.acquire({ projectId: 'project-v5', configRevision: REVISION, publisherId: 'browser-a' }))
      .toMatchObject({ generation: 1, expiresAt: 6_000 })
    now = 1_001
    expect(lease.acquire({ projectId: 'project-v5', configRevision: REVISION, publisherId: 'browser-b' }))
      .toMatchObject({ generation: 2, publisherId: 'browser-b' })
    expect(lease.invalidateRevision()).toBe(3)
    expect(lease.current()).toBeNull()
  })

  it('renews only its active owner at the fixed two second cadence', () => {
    let now = 1_000
    const lease = createBrowserPublisherLeaseManagerV1({ nowMs: () => now })
    const active = lease.acquire({ projectId: 'project-v5', configRevision: REVISION, publisherId: 'browser-a' })
    now = 2_999
    expect(lease.renew({ ...active })).toMatchObject({ expiresAt: 7_999 })
    expect(() => lease.renew({ ...active, publisherId: 'browser-b' })).toThrow('BROWSER_PUBLISHER_UNAVAILABLE')
    expect(lease.renewalIntervalMs()).toBe(2_000)
  })

  it('reports an expired lease as unavailable', () => {
    let now = 1_000
    const lease = createBrowserPublisherLeaseManagerV1({ nowMs: () => now })
    lease.acquire({ projectId: 'project-v5', configRevision: REVISION, publisherId: 'browser-a' })
    now = 6_001
    expect(lease.current()).toBeNull()
    expect(lease.snapshot()).toMatchObject({ phase: 'expired', publisherId: null })
  })
})
