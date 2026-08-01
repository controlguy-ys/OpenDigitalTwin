import { describe, expect, it, vi } from 'vitest'

import {
  createRuntimeGatewayStatusPollerV1,
  type RuntimeConnectivitySnapshotV1,
} from './runtime-gateway-status-poller.js'
import {
  validateRuntimeGatewayStatusV1,
  type RuntimeGatewayStatusV1,
} from '../../core/runtime-protocol/gateway-status-v1.js'

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
      activationAttemptId: null, authorityPhase: 'inactive',
      readinessCode: 'NO_ACTIVE_REVISION',
    },
    opcUa: {
      mode: 'off',
      server: { phase: 'disabled', endpointUrl: null, lastError: null },
      clientEndpoints: [],
    },
  })
}

function snapshotFixtureV1(): RuntimeConnectivitySnapshotV1 {
  return {
    status: statusFixtureV1(),
    integrationDiagnostics: {
      type: 'runtime-integration-diagnostics-v1', protocolVersion: 1, observedAtMs: 1_000,
      projectId: null, revisionId: null, configRevision: null,
      serverModel: { standardNodeSets: 'disabled', roboticsModel: 'disabled', productModel: 'disabled', activeSessionCount: 0, maximumSessionCount: 16, lastError: null },
      browserPublisher: { phase: 'absent', publisherId: null, generation: null, expiresAt: null },
      lastCommandResult: null,
    },
  }
}

describe('Runtime Gateway status poller V1', () => {
  it('polls immediately, every ten seconds for Header, and every two seconds for Monitor', async () => {
    vi.useFakeTimers()
    try {
      const readConnectivitySnapshot = vi.fn().mockResolvedValue(snapshotFixtureV1())
      const onSnapshot = vi.fn()
      const poller = createRuntimeGatewayStatusPollerV1({ readConnectivitySnapshot, onSnapshot, onError: vi.fn() })

      poller.setDemand('header')
      await Promise.resolve()
      expect(readConnectivitySnapshot).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(9_999)
      expect(readConnectivitySnapshot).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(readConnectivitySnapshot).toHaveBeenCalledTimes(2)

      poller.setDemand('monitor')
      await vi.advanceTimersByTimeAsync(2_000)
      expect(readConnectivitySnapshot).toHaveBeenCalledTimes(3)
      poller.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('allows only one read in flight and aborts it without reporting an error on stop', async () => {
    vi.useFakeTimers()
    try {
      let resolve!: (value: RuntimeConnectivitySnapshotV1) => void
      let signal: AbortSignal | undefined
      const readConnectivitySnapshot = vi.fn((nextSignal?: AbortSignal) => new Promise<RuntimeConnectivitySnapshotV1>((done) => { signal = nextSignal; resolve = done }))
      const onError = vi.fn()
      const poller = createRuntimeGatewayStatusPollerV1({ readConnectivitySnapshot, onSnapshot: vi.fn(), onError })
      poller.setDemand('monitor')
      await vi.runOnlyPendingTimersAsync()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(readConnectivitySnapshot).toHaveBeenCalledTimes(1)
      poller.stop()
      expect(signal?.aborted).toBe(true)
      resolve(snapshotFixtureV1())
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
      const readConnectivitySnapshot = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue(snapshotFixtureV1())
      const onError = vi.fn()
      const onSnapshot = vi.fn()
      const poller = createRuntimeGatewayStatusPollerV1({ readConnectivitySnapshot, onSnapshot, onError })

      poller.setDemand('monitor')
      await Promise.resolve()
      expect(onError).toHaveBeenCalledWith(error)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(readConnectivitySnapshot).toHaveBeenCalledTimes(2)
      expect(onSnapshot).toHaveBeenCalledWith(snapshotFixtureV1())
      poller.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a synchronous read failure and continues at the active cadence', async () => {
    vi.useFakeTimers()
    try {
      const error = new Error('gateway unavailable')
      const readConnectivitySnapshot = vi.fn()
        .mockImplementationOnce(() => { throw error })
        .mockResolvedValue(snapshotFixtureV1())
      const onError = vi.fn()
      const poller = createRuntimeGatewayStatusPollerV1({ readConnectivitySnapshot, onSnapshot: vi.fn(), onError })

      expect(() => poller.setDemand('header')).not.toThrow()
      await Promise.resolve()
      expect(onError).toHaveBeenCalledWith(error)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(readConnectivitySnapshot).toHaveBeenCalledTimes(2)
      poller.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('exposes demand, in-flight state, and the scheduled poll time', async () => {
    vi.useFakeTimers()
    try {
      const poller = createRuntimeGatewayStatusPollerV1({
        readConnectivitySnapshot: vi.fn().mockResolvedValue(snapshotFixtureV1()),
        onSnapshot: vi.fn(),
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

  it('starts an immediate demand poll, clears a scheduled poll, and never overlaps an in-flight request', async () => {
    vi.useFakeTimers()
    try {
      let resolve!: (value: RuntimeConnectivitySnapshotV1) => void
      const readConnectivitySnapshot = vi.fn(() => new Promise<RuntimeConnectivitySnapshotV1>((done) => { resolve = done }))
      const poller = createRuntimeGatewayStatusPollerV1({
        readConnectivitySnapshot,
        onSnapshot: vi.fn(),
        onError: vi.fn(),
      })

      poller.setDemand('header')
      expect(readConnectivitySnapshot).toHaveBeenCalledTimes(1)
      poller.pollNow()
      expect(readConnectivitySnapshot).toHaveBeenCalledTimes(1)
      resolve(snapshotFixtureV1())
      await vi.advanceTimersByTimeAsync(0)
      expect(poller.status().nextPollAtMs).not.toBeNull()

      poller.pollNow()
      expect(readConnectivitySnapshot).toHaveBeenCalledTimes(2)
      poller.stop()
      poller.pollNow()
      expect(readConnectivitySnapshot).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
