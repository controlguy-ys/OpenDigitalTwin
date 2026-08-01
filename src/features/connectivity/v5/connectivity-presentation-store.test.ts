import { describe, expect, it, vi } from 'vitest'

import { createConnectivityPresentationStoreV1, deriveConnectivityPresentationV1, type RuntimeConnectivitySnapshotV1 } from './connectivity-presentation-store.js'

const revision = 'a'.repeat(64)
function snapshot(overrides: Record<string, unknown> = {}): RuntimeConnectivitySnapshotV1 {
  const status = {
    type: 'runtime-gateway-status-v1', protocolVersion: 1, observedAtMs: 1_000,
    gateway: { gatewayId: 'gateway', phase: 'online', runtimeKind: 'native' },
    deployment: { http: { bindHost: '127.0.0.1', port: 8081 }, opcUaServer: { bindHost: '127.0.0.1', port: 4841, advertisedHost: '127.0.0.1', advertisedPort: 4841 } },
    project: { phase: 'ready', authorityPhase: 'active', projectId: 'project', revisionId: 'revision', configRevision: revision, activationAttemptId: 'attempt-0001', readinessCode: 'READY' },
    opcUa: { mode: 'bridge', server: { phase: 'listening', endpointUrl: 'opc.tcp://gateway:4841', lastError: null }, clientEndpoints: [{ endpointId: 'plc', endpointUrl: 'opc.tcp://plc:4840', phase: 'connected', sessionActive: true, subscriptionActive: true, monitoredItemCount: 1, mappingCount: 1, lastValueQuality: 'GOOD', lastNotificationAtMs: 1_000, lastGoodValueAtMs: 1_000, reconnectAttempt: 0, nextRetryAtMs: null, lastError: null }] },
  }
  const integrationDiagnostics = { type: 'runtime-integration-diagnostics-v1', protocolVersion: 1, observedAtMs: 1_000, projectId: 'project', revisionId: 'revision', configRevision: revision, serverModel: { standardNodeSets: 'loaded', roboticsModel: 'ready', productModel: 'ready', activeSessionCount: 1, maximumSessionCount: 16, lastError: null }, browserPublisher: { phase: 'active', publisherId: 'browser', generation: 1, expiresAt: 2_000 }, lastCommandResult: null }
  return { status: { ...status, ...(overrides.status as object) }, integrationDiagnostics: { ...integrationDiagnostics, ...(overrides.integrationDiagnostics as object) } } as RuntimeConnectivitySnapshotV1
}

describe('Connectivity presentation store V1', () => {
  it('uses one immediate poll then Header and Monitor cadences without overlap', async () => {
    vi.useFakeTimers()
    try {
      let resolve!: (value: RuntimeConnectivitySnapshotV1) => void
      const readConnectivitySnapshot = vi.fn(() => new Promise<RuntimeConnectivitySnapshotV1>((done) => { resolve = done }))
      const store = createConnectivityPresentationStoreV1({ readConnectivitySnapshot })
      store.startHeader()
      expect(readConnectivitySnapshot).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(readConnectivitySnapshot).toHaveBeenCalledTimes(1)
      resolve(snapshot())
      await vi.advanceTimersByTimeAsync(10_000)
      expect(readConnectivitySnapshot).toHaveBeenCalledTimes(2)
      store.setMonitorOpen(true)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(readConnectivitySnapshot).toHaveBeenCalledTimes(2)
      store.dispose()
    } finally { vi.useRealTimers() }
  })

  it('refreshes through the active read-only poller and does nothing while stopped', () => {
    const readConnectivitySnapshot = vi.fn().mockResolvedValue(snapshot())
    const store = createConnectivityPresentationStoreV1({ readConnectivitySnapshot })

    store.refresh()
    expect(readConnectivitySnapshot).not.toHaveBeenCalled()
    store.startHeader()
    expect(readConnectivitySnapshot).toHaveBeenCalledTimes(1)
    store.refresh()
    expect(readConnectivitySnapshot).toHaveBeenCalledTimes(1)
    store.dispose()
    store.refresh()
    expect(readConnectivitySnapshot).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['off', 'disabled', [], 'Off'],
    ['server', 'listening', [], 'Listening'],
    ['client', 'disabled', [{ phase: 'connected', sessionActive: true, subscriptionActive: true }], 'Connected'],
    ['client', 'disabled', [{ phase: 'reconnecting', sessionActive: false, subscriptionActive: false }], 'Degraded'],
    ['bridge', 'listening', [{ phase: 'connected', sessionActive: true, subscriptionActive: true }], 'Connected'],
    ['bridge', 'listening', [{ phase: 'reconnecting', sessionActive: false, subscriptionActive: false }], 'Degraded'],
  ] as const)('derives the %s role independently as %s', (mode, serverPhase, endpoints, expectedLabel) => {
    const base = snapshot()
    const clientEndpoints = endpoints.map((endpoint) => ({ ...base.status.opcUa.clientEndpoints[0]!, ...endpoint }))
    const state = deriveConnectivityPresentationV1({ status: { ...base.status, opcUa: { ...base.status.opcUa, mode, server: { ...base.status.opcUa.server, phase: serverPhase }, clientEndpoints } }, integrationDiagnostics: base.integrationDiagnostics })
    expect(state.gateway.label).toBe('Online')
    expect(state.opcUa.label).toBe(expectedLabel)
  })

  it.each([
    { name: 'Server disabled', mode: 'server', serverPhase: 'disabled', endpoints: [], expected: { state: 'error', label: 'Unavailable' } },
    { name: 'Server listening', mode: 'server', serverPhase: 'listening', endpoints: [], expected: { state: 'server-listening', label: 'Listening' } },
    { name: 'Server faulted without an error payload', mode: 'server', serverPhase: 'faulted', endpoints: [], expected: { state: 'error', label: 'Error' } },
    { name: 'Client with connected required Endpoint and unused reconnecting Endpoint', mode: 'client', serverPhase: 'disabled', endpoints: [{ mappingCount: 1, phase: 'connected', sessionActive: true, subscriptionActive: true }, { mappingCount: 0, phase: 'reconnecting', sessionActive: false, subscriptionActive: false }], expected: { state: 'client-connected', label: 'Connected' } },
    { name: 'Client with degraded required Endpoint', mode: 'client', serverPhase: 'disabled', endpoints: [{ mappingCount: 1, phase: 'reconnecting', sessionActive: false, subscriptionActive: false }], expected: { state: 'client-degraded', label: 'Degraded' } },
    { name: 'Client with faulted required Endpoint without an error payload', mode: 'client', serverPhase: 'disabled', endpoints: [{ mappingCount: 1, phase: 'faulted', sessionActive: false, subscriptionActive: false }], expected: { state: 'error', label: 'Error' } },
    { name: 'Bridge listener down with connected required Endpoint', mode: 'bridge', serverPhase: 'disabled', endpoints: [{ mappingCount: 1, phase: 'connected', sessionActive: true, subscriptionActive: true }], expected: { state: 'bridge-degraded', label: 'Degraded' } },
    { name: 'Bridge with partially connected required Endpoints', mode: 'bridge', serverPhase: 'listening', endpoints: [{ mappingCount: 1, phase: 'connected', sessionActive: true, subscriptionActive: true }, { mappingCount: 1, phase: 'reconnecting', sessionActive: false, subscriptionActive: false }], expected: { state: 'bridge-degraded', label: 'Degraded' } },
    { name: 'Bridge with faulted required Endpoint', mode: 'bridge', serverPhase: 'listening', endpoints: [{ mappingCount: 1, phase: 'faulted', sessionActive: false, subscriptionActive: false }], expected: { state: 'error', label: 'Error' } },
  ] as const)('derives $name from required Endpoint health', ({ mode, serverPhase, endpoints, expected }) => {
    const base = snapshot()
    const clientEndpoints = endpoints.map((endpoint, index) => ({
      ...base.status.opcUa.clientEndpoints[0]!,
      endpointId: `endpoint-${index + 1}`,
      ...endpoint,
    }))
    const server = {
      ...base.status.opcUa.server,
      phase: serverPhase,
      endpointUrl: serverPhase === 'listening' ? base.status.opcUa.server.endpointUrl : null,
      lastError: null,
    }
    const state = deriveConnectivityPresentationV1({
      status: { ...base.status, opcUa: { ...base.status.opcUa, mode, server, clientEndpoints } },
      integrationDiagnostics: base.integrationDiagnostics,
    })
    expect(state.opcUa).toMatchObject(expected)
  })

  it('retains decoded details but marks Gateway Offline on a transport failure and rejects a cross-revision pair', async () => {
    vi.useFakeTimers()
    try {
      const readConnectivitySnapshot = vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot({ integrationDiagnostics: { configRevision: 'b'.repeat(64) } }))
      const store = createConnectivityPresentationStoreV1({ readConnectivitySnapshot, nowMs: () => 42_000 })
      store.startHeader()
      await vi.advanceTimersByTimeAsync(0)
      expect(store.getState().gateway.label).toBe('Online')
      await vi.advanceTimersByTimeAsync(10_000)
      expect(store.getState()).toMatchObject({ gateway: { label: 'Offline' }, opcUa: { state: 'error', label: 'Unavailable' }, transportError: 'offline', status: { project: { configRevision: revision } }, statusFreshness: 'last-known', transportErrorOccurredAtMs: 42_000 })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(store.getState()).toMatchObject({ gateway: { label: 'Online' }, transportError: null, statusFreshness: 'current', transportErrorOccurredAtMs: null })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(store.getState()).toMatchObject({ gateway: { label: 'Offline' }, statusFreshness: 'last-known', transportError: expect.stringContaining('configRevision') })
      store.dispose()
    } finally { vi.useRealTimers() }
  })

  it('overrides Gateway presentation locally during activation and after a local publication error', () => {
    const base = snapshot()
    expect(deriveConnectivityPresentationV1(base, 'activating').gateway.label).toBe('Activating')
    expect(deriveConnectivityPresentationV1(base, { phase: 'error', message: 'Activation failed.' }).gateway).toMatchObject({ label: 'Error', detail: 'Activation failed.' })
  })
})
