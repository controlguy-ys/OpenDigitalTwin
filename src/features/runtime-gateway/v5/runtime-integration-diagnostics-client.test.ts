import { describe, expect, it, vi } from 'vitest'

import { validateRuntimeGatewayStatusV1 } from '../../../core/runtime-protocol/gateway-status-v1.js'
import { createRuntimeConnectivitySnapshotReaderV1, createRuntimeIntegrationDiagnosticsClientV1 } from './runtime-integration-diagnostics-client.js'

const diagnostics = {
  type: 'runtime-integration-diagnostics-v1', protocolVersion: 1, observedAtMs: 1,
  projectId: null, revisionId: null, configRevision: null,
  serverModel: { standardNodeSets: 'disabled', roboticsModel: 'disabled', productModel: 'disabled', activeSessionCount: 0, maximumSessionCount: 16, lastError: null },
  browserPublisher: { phase: 'absent', publisherId: null, generation: null, expiresAt: null },
  lastCommandResult: null,
} as const

describe('Runtime integration diagnostics client V1', () => {
  it('reads validated status and diagnostics under one AbortSignal and rejects a cross-revision pair', async () => {
    const status = validateRuntimeGatewayStatusV1({
      type: 'runtime-gateway-status-v1', protocolVersion: 1, observedAtMs: 1,
      gateway: { gatewayId: 'gateway', phase: 'online', runtimeKind: 'native' },
      deployment: { http: { bindHost: '127.0.0.1', port: 8081 }, opcUaServer: { bindHost: '127.0.0.1', port: 4841, advertisedHost: '127.0.0.1', advertisedPort: 4841 } },
      project: { phase: 'not-applied', authorityPhase: 'inactive', projectId: null, revisionId: null, configRevision: null, activationAttemptId: null, readinessCode: 'NO_ACTIVE_REVISION' },
      opcUa: { mode: 'off', server: { phase: 'disabled', endpointUrl: null, lastError: null }, clientEndpoints: [] },
    })
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/status') ? status : diagnostics)))
    const reader = createRuntimeConnectivitySnapshotReaderV1({ fetch })
    const controller = new AbortController()
    await expect(reader(controller.signal)).resolves.toEqual({ status, integrationDiagnostics: diagnostics })
    expect(fetch).toHaveBeenCalledWith('/runtime/status', expect.objectContaining({ signal: controller.signal }))
    expect(fetch).toHaveBeenCalledWith('/runtime/integration-diagnostics', expect.objectContaining({ signal: controller.signal }))

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
})
