import { describe, expect, it, vi } from 'vitest'

import { validateRuntimeGatewayStatusV1 } from '../../../core/runtime-protocol/gateway-status-v1.js'
import { createRuntimeConnectivitySnapshotReaderV1, createRuntimeIntegrationDiagnosticsClientV1 } from './runtime-integration-diagnostics-client.js'
import { createRuntimeGatewayStatusPollerV1 } from '../runtime-gateway-status-poller.js'

const diagnostics = {
  type: 'runtime-integration-diagnostics-v1', protocolVersion: 1, observedAtMs: 1,
  projectId: null, revisionId: null, configRevision: null,
  serverModel: { standardNodeSets: 'disabled', roboticsModel: 'disabled', productModel: 'disabled', activeSessionCount: 0, maximumSessionCount: 16, lastError: null },
  browserPublisher: { phase: 'absent', publisherId: null, generation: null, expiresAt: null },
  lastCommandResult: null,
} as const

function statusFixture() {
  return validateRuntimeGatewayStatusV1({
    type: 'runtime-gateway-status-v1', protocolVersion: 1, observedAtMs: 1,
    gateway: { gatewayId: 'gateway', phase: 'online', runtimeKind: 'native' },
    deployment: { http: { bindHost: '127.0.0.1', port: 8081 }, opcUaServer: { bindHost: '127.0.0.1', port: 4841, advertisedHost: '127.0.0.1', advertisedPort: 4841 } },
    project: { phase: 'not-applied', authorityPhase: 'inactive', projectId: null, revisionId: null, configRevision: null, activationAttemptId: null, readinessCode: 'NO_ACTIVE_REVISION' },
    opcUa: { mode: 'off', server: { phase: 'disabled', endpointUrl: null, lastError: null }, clientEndpoints: [] },
  })
}

function abortError(): Error {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

describe('Runtime integration diagnostics client V1', () => {
  it('reads validated status and diagnostics under one AbortSignal and rejects a cross-revision pair', async () => {
    const status = statusFixture()
    const fetch = vi.fn(async (url: string, _init: RequestInit) => new Response(JSON.stringify(url.endsWith('/status') ? status : diagnostics)))
    const reader = createRuntimeConnectivitySnapshotReaderV1({ fetch })
    const controller = new AbortController()
    await expect(reader(controller.signal)).resolves.toEqual({ status, integrationDiagnostics: diagnostics })
    const statusRequest = fetch.mock.calls.find(([url]) => url === '/runtime/status')
    const diagnosticsRequest = fetch.mock.calls.find(([url]) => url === '/runtime/integration-diagnostics')
    if (statusRequest === undefined || diagnosticsRequest === undefined) throw new Error('Expected both Runtime Gateway reads.')
    const statusSignal = statusRequest[1].signal
    const diagnosticsSignal = diagnosticsRequest[1].signal
    expect(statusSignal).toBeInstanceOf(AbortSignal)
    expect(statusSignal).toBe(diagnosticsSignal)
    expect(statusSignal).not.toBe(controller.signal)

    const mismatch = createRuntimeConnectivitySnapshotReaderV1({ fetch: async (url) => new Response(JSON.stringify(url.endsWith('/status') ? { ...status, project: { phase: 'ready', authorityPhase: 'active', projectId: 'project', revisionId: 'revision', configRevision: 'a'.repeat(64), activationAttemptId: 'attempt-0001', readinessCode: 'READY' } } : { ...diagnostics, projectId: 'project', revisionId: 'revision', configRevision: 'b'.repeat(64) })) })
    await expect(mismatch()).rejects.toMatchObject({ code: 'RUNTIME_CONNECTIVITY_SNAPSHOT_REVISION_MISMATCH' })
  })

  it('reads and validates the same-origin diagnostics route with the caller AbortSignal', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(diagnostics)))
    const controller = new AbortController()
    const client = createRuntimeIntegrationDiagnosticsClientV1({ fetch })

    await expect(client.readIntegrationDiagnostics(controller.signal)).resolves.toEqual(diagnostics)
    expect(fetch).toHaveBeenCalledWith('/runtime/integration-diagnostics', expect.objectContaining({ method: 'GET', signal: controller.signal }))
  })

  it('rejects an invalid diagnostics response and honors an already-aborted caller signal', async () => {
    const client = createRuntimeIntegrationDiagnosticsClientV1({ fetch: async () => new Response('{}') })
    await expect(client.readIntegrationDiagnostics()).rejects.toMatchObject({ code: 'RUNTIME_INTEGRATION_DIAGNOSTICS_RESPONSE_INVALID' })
    const controller = new AbortController()
    controller.abort()
    await expect(client.readIntegrationDiagnostics(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each([
    ['status', 'RUNTIME_CONNECTIVITY_SNAPSHOT_UNAVAILABLE'],
    ['diagnostics', 'RUNTIME_INTEGRATION_DIAGNOSTICS_UNAVAILABLE'],
  ] as const)('aborts the hanging %s sibling but waits for it to settle before rejecting', async (failedRoute, expectedCode) => {
    let rejectFailure!: (reason: unknown) => void
    let releaseSibling!: () => void
    let siblingSignal: AbortSignal | undefined
    const fetch = vi.fn((url: string, init: RequestInit) => {
      const route = url.endsWith('/status') ? 'status' : 'diagnostics'
      if (route === failedRoute) return new Promise<Response>((_resolve, reject) => { rejectFailure = reject })
      siblingSignal = init.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        releaseSibling = () => reject(abortError())
      })
    })
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const reader = createRuntimeConnectivitySnapshotReaderV1({ fetch })
    let settled = false
    const pending = reader(controller.signal).finally(() => { settled = true })

    await Promise.resolve()
    rejectFailure(new Error(`${failedRoute} unavailable`))
    await Promise.resolve()
    await Promise.resolve()
    expect(siblingSignal?.aborted).toBe(true)
    expect(settled).toBe(false)
    releaseSibling()
    await expect(pending).rejects.toMatchObject({ code: expectedCode })
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('keeps one poll request active across the next cadence until an aborted sibling settles', async () => {
    vi.useFakeTimers()
    try {
      let diagnosticsReject!: (reason: unknown) => void
      let activeSnapshots = 0
      let maxActiveSnapshots = 0
      let firstStatus = true
      const fetch = vi.fn((url: string, _init: RequestInit) => {
        if (url.endsWith('/status') && firstStatus) {
          firstStatus = false
          return Promise.reject(new Error('status unavailable'))
        }
        if (url.endsWith('/integration-diagnostics') && diagnosticsReject === undefined) {
          return new Promise<Response>((_resolve, reject) => { diagnosticsReject = reject })
        }
        return Promise.resolve(new Response(JSON.stringify(url.endsWith('/status') ? statusFixture() : diagnostics)))
      })
      const reader = createRuntimeConnectivitySnapshotReaderV1({ fetch })
      const readConnectivitySnapshot = vi.fn((signal?: AbortSignal) => {
        activeSnapshots += 1
        maxActiveSnapshots = Math.max(maxActiveSnapshots, activeSnapshots)
        return reader(signal).finally(() => { activeSnapshots -= 1 })
      })
      const poller = createRuntimeGatewayStatusPollerV1({ readConnectivitySnapshot, onSnapshot: vi.fn(), onError: vi.fn() })

      poller.setDemand('header')
      await vi.advanceTimersByTimeAsync(0)
      expect(poller.status().inFlight).toBe(true)
      await vi.advanceTimersByTimeAsync(20_000)
      expect(readConnectivitySnapshot).toHaveBeenCalledTimes(1)
      expect(maxActiveSnapshots).toBe(1)

      diagnosticsReject(abortError())
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(readConnectivitySnapshot).toHaveBeenCalledTimes(2)
      expect(maxActiveSnapshots).toBe(1)
      poller.stop()
    } finally { vi.useRealTimers() }
  })
})
