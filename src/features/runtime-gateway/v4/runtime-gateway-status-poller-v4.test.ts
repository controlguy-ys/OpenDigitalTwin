import { describe, expect, it, vi } from 'vitest'

import {
  createRuntimeGatewayStatusPollerV4,
} from './runtime-gateway-status-poller-v4.js'
import {
  validateRuntimeGatewayStatusV1,
  type RuntimeGatewayStatusV1,
} from '../../../core/runtime-protocol/gateway-status-v1.js'

function statusFixtureV1(): RuntimeGatewayStatusV1 {
  return validateRuntimeGatewayStatusV1({
    type: 'runtime-gateway-status-v1', protocolVersion: 1, observedAtMs: 1_000,
    gateway: { gatewayId: 'gateway-test', phase: 'online', runtimeKind: 'native' },
    deployment: {
      http: { bindHost: '127.0.0.1', port: 8081 },
      opcUaServer: {
        bindHost: '127.0.0.1', port: 4841,
        advertisedHost: '127.0.0.1', advertisedPort: 4841,
      },
    },
    project: {
      phase: 'not-applied', projectId: null, revisionId: null,
      configRevision: null,
      readinessCode: 'NO_ACTIVE_REVISION',
    },
    opcUa: {
      mode: 'off',
      server: { phase: 'disabled', endpointUrl: null, lastError: null },
      clientEndpoints: [],
    },
  })
}

describe('Runtime Gateway status poller V4', () => {
  it('polls immediately, every ten seconds for Header, and every two seconds for Monitor', async () => {
    vi.useFakeTimers()
    try {
      const readStatus = vi.fn().mockResolvedValue(statusFixtureV1())
      const onStatus = vi.fn()
      const poller = createRuntimeGatewayStatusPollerV4({ readStatus, onStatus, onError: vi.fn() })

      poller.setDemand('header')
      await Promise.resolve()
      expect(readStatus).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(9_999)
      expect(readStatus).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(readStatus).toHaveBeenCalledTimes(2)

      poller.setDemand('monitor')
      await vi.advanceTimersByTimeAsync(2_000)
      expect(readStatus).toHaveBeenCalledTimes(3)
      poller.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('allows only one read in flight and aborts it without reporting an error on stop', async () => {
    vi.useFakeTimers()
    try {
      let resolve!: (value: RuntimeGatewayStatusV1) => void
      const readStatus = vi.fn((_signal?: AbortSignal) => new Promise<RuntimeGatewayStatusV1>((done) => { resolve = done }))
      const onError = vi.fn()
      const poller = createRuntimeGatewayStatusPollerV4({ readStatus, onStatus: vi.fn(), onError })
      poller.setDemand('monitor')
      await vi.runOnlyPendingTimersAsync()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(readStatus).toHaveBeenCalledTimes(1)
      poller.stop()
      resolve(statusFixtureV1())
      await Promise.resolve()
      expect(onError).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a rejected read once and continues at the active cadence', async () => {
    vi.useFakeTimers()
    try {
      const error = new Error('gateway unavailable')
      const readStatus = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue(statusFixtureV1())
      const onError = vi.fn()
      const onStatus = vi.fn()
      const poller = createRuntimeGatewayStatusPollerV4({ readStatus, onStatus, onError })

      poller.setDemand('monitor')
      await Promise.resolve()
      expect(onError).toHaveBeenCalledWith(error)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(readStatus).toHaveBeenCalledTimes(2)
      expect(onStatus).toHaveBeenCalledWith(statusFixtureV1())
      poller.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a synchronous read failure and continues at the active cadence', async () => {
    vi.useFakeTimers()
    try {
      const error = new Error('gateway unavailable')
      const readStatus = vi.fn()
        .mockImplementationOnce(() => { throw error })
        .mockResolvedValue(statusFixtureV1())
      const onError = vi.fn()
      const poller = createRuntimeGatewayStatusPollerV4({ readStatus, onStatus: vi.fn(), onError })

      expect(() => poller.setDemand('header')).not.toThrow()
      await Promise.resolve()
      expect(onError).toHaveBeenCalledWith(error)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(readStatus).toHaveBeenCalledTimes(2)
      poller.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('exposes demand, in-flight state, and the scheduled poll time', async () => {
    vi.useFakeTimers()
    try {
      const poller = createRuntimeGatewayStatusPollerV4({
        readStatus: vi.fn().mockResolvedValue(statusFixtureV1()),
        onStatus: vi.fn(),
        onError: vi.fn(),
        nowMs: () => 500,
      })

      expect(poller.status()).toEqual({ demand: 'stopped', inFlight: false, nextPollAtMs: null })
      poller.setDemand('header')
      expect(poller.status()).toEqual({ demand: 'header', inFlight: true, nextPollAtMs: null })
      await vi.advanceTimersByTimeAsync(0)
      expect(poller.status()).toEqual({ demand: 'header', inFlight: false, nextPollAtMs: 10_500 })
      poller.stop()
      expect(poller.status()).toEqual({ demand: 'stopped', inFlight: false, nextPollAtMs: null })
    } finally {
      vi.useRealTimers()
    }
  })
})
