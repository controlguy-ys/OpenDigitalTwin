import { validateRuntimePublisherLeaseV1, type RuntimePublisherLeaseV1 } from '../../src/core/runtime-protocol/v1.js'

export const BROWSER_PUBLISHER_LEASE_TTL_MS_V1 = 5_000
export const BROWSER_PUBLISHER_RENEWAL_INTERVAL_MS_V1 = 2_000

export interface BrowserPublisherLeaseManagerV1 {
  acquire(request: Readonly<{ projectId: string; configRevision: string; publisherId: string }>): RuntimePublisherLeaseV1
  renew(lease: RuntimePublisherLeaseV1): RuntimePublisherLeaseV1
  release(lease: RuntimePublisherLeaseV1): void
  invalidateRevision(): number
  /** Applies time-based expiration as an explicit lifecycle action. */
  tick(): boolean
  current(): RuntimePublisherLeaseV1 | null
  snapshot(): Readonly<{ phase: 'absent' | 'active' | 'expired'; publisherId: string | null; generation: number | null; expiresAt: number | null }>
  renewalIntervalMs(): number
}

export class BrowserPublisherLeaseErrorV1 extends Error {
  readonly code = 'BROWSER_PUBLISHER_UNAVAILABLE' as const
  constructor() {
    super('BROWSER_PUBLISHER_UNAVAILABLE')
    this.name = 'BrowserPublisherLeaseErrorV1'
  }
}

function sameLease(left: RuntimePublisherLeaseV1, right: RuntimePublisherLeaseV1): boolean {
  return left.projectId === right.projectId && left.configRevision === right.configRevision
    && left.publisherId === right.publisherId && left.generation === right.generation
}

export function createBrowserPublisherLeaseManagerV1(options: Readonly<{ nowMs: () => number }>): BrowserPublisherLeaseManagerV1 {
  let generation = 0
  let active: RuntimePublisherLeaseV1 | null = null
  let expired = false

  function now(): number {
    const value = options.nowMs()
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('BROWSER_PUBLISHER_CLOCK_INVALID')
    return value
  }
  function expireIfDue(): boolean {
    if (active !== null && active.expiresAt <= now()) {
      active = null
      expired = true
      return true
    }
    return false
  }
  function issue(request: Readonly<{ projectId: string; configRevision: string; publisherId: string }>): RuntimePublisherLeaseV1 {
    generation += 1
    if (!Number.isSafeInteger(generation)) throw new Error('BROWSER_PUBLISHER_GENERATION_EXHAUSTED')
    active = validateRuntimePublisherLeaseV1({
      projectId: request.projectId,
      configRevision: request.configRevision,
      publisherId: request.publisherId,
      generation,
      expiresAt: now() + BROWSER_PUBLISHER_LEASE_TTL_MS_V1,
    })
    expired = false
    return active
  }

  return Object.freeze({
    acquire: issue,
    renew(lease: RuntimePublisherLeaseV1) {
      expireIfDue()
      const current = active
      if (current === null || !sameLease(current, lease)) throw new BrowserPublisherLeaseErrorV1()
      active = validateRuntimePublisherLeaseV1({ ...current, expiresAt: now() + BROWSER_PUBLISHER_LEASE_TTL_MS_V1 })
      return active
    },
    release(lease: RuntimePublisherLeaseV1) {
      expireIfDue()
      const current = active
      if (current !== null && sameLease(current, lease)) active = null
    },
    invalidateRevision() {
      generation += 1
      if (!Number.isSafeInteger(generation)) throw new Error('BROWSER_PUBLISHER_GENERATION_EXHAUSTED')
      active = null
      expired = false
      return generation
    },
    tick: expireIfDue,
    current: () => active,
    snapshot() {
      const current = active
      return Object.freeze(current === null
        ? { phase: expired ? 'expired' as const : 'absent' as const, publisherId: null, generation: null, expiresAt: null }
        : { phase: 'active' as const, publisherId: current.publisherId, generation: current.generation, expiresAt: current.expiresAt })
    },
    renewalIntervalMs: () => BROWSER_PUBLISHER_RENEWAL_INTERVAL_MS_V1,
  })
}
