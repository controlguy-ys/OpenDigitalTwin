import { describe, expect, it, vi } from 'vitest'

import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import { validateWorkcellProjectV5 } from '../../../core/project-v5/index.js'
import {
  createRuntimeGatewayConnectivityClientV1,
  isRuntimeGatewayConnectivityClientV1Error,
} from './runtime-gateway-connectivity-client.js'

function status(projectId: string | null, revisionId: string | null, configRevision: string | null, activationAttemptId = 'attempt-0001') {
  return { type: 'runtime-gateway-status-v1', protocolVersion: 1, observedAtMs: 1, gateway: { gatewayId: 'g', phase: 'online', runtimeKind: 'native' }, deployment: { http: { bindHost: '127.0.0.1', port: 1 }, opcUaServer: { bindHost: '127.0.0.1', port: 1, advertisedHost: '127.0.0.1', advertisedPort: 1 } }, project: projectId === null ? { phase: 'not-applied', authorityPhase: 'inactive', projectId: null, revisionId: null, configRevision: null, activationAttemptId: null, readinessCode: 'NO_ACTIVE_REVISION' } : { phase: 'ready', authorityPhase: 'active', projectId, revisionId, configRevision, activationAttemptId, readinessCode: 'READY' }, opcUa: { mode: 'off', server: { phase: 'disabled', endpointUrl: null, lastError: null }, clientEndpoints: [] } }
}

describe('Runtime Gateway Connectivity Client V1 prepared candidates', () => {
  it('publishes an exact prepared Project and validates the returned status', async () => {
    const project = validateWorkcellProjectV5(makeMinimalWorkcellProjectV5()); const hash = 'a'.repeat(64)
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(status(project.projectId, project.revisionId, hash)), { status: 200 }))
    const client = createRuntimeGatewayConnectivityClientV1({ fetch }); const prepared = await client.prepare(project, hash, undefined as never)
    await expect(client.activate(prepared)).resolves.toMatchObject({ project: { configRevision: hash } })
    expect(fetch).toHaveBeenCalledWith('/runtime/project', expect.objectContaining({ method: 'PUT' }))
    expect(JSON.parse(String(fetch.mock.calls[0]![1].body))).toMatchObject({ type: 'runtime-project-activation-v1', project, configRevision: hash, activationAttemptId: 'attempt-0001', expectedAuthority: null })
  })
  it('rejects a ready status for a different Project or hash', async () => {
    const project = validateWorkcellProjectV5(makeMinimalWorkcellProjectV5()); const hash = 'a'.repeat(64)
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: async () => new Response(JSON.stringify(status(project.projectId, project.revisionId, 'b'.repeat(64))), { status: 200 }) })
    await expect(client.activate(await client.prepare(project, hash, undefined as never))).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_STATUS_MISMATCH' })
  })
  it('hydrates only an inactive Gateway or the exact durable active authority', async () => {
    const project = validateWorkcellProjectV5(makeMinimalWorkcellProjectV5()); const hash = 'a'.repeat(64)
    const exact = createRuntimeGatewayConnectivityClientV1({
      fetch: async () => new Response(JSON.stringify(status(project.projectId, project.revisionId, hash))),
      createActivationAttemptId: () => 'attempt-0001',
    })
    await expect(exact.prepare(project, hash, null)).resolves.toMatchObject({ configRevision: hash })
    const other = createRuntimeGatewayConnectivityClientV1({
      fetch: async () => new Response(JSON.stringify(status('other', 'other', hash))),
    })
    await expect(other.prepare(project, hash, null)).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_AUTHORITY_MISMATCH' })
  })
  it('sends exact unconditional DELETE and requires canonical inactive status', async () => {
    const calls: RequestInit[] = []; const client = createRuntimeGatewayConnectivityClientV1({ fetch: async (_url, init) => { calls.push(init); return new Response(JSON.stringify(status(null, null, null)), { status: 200 }) } })
    await expect(client.deactivate()).resolves.toMatchObject({ project: { phase: 'not-applied' } })
    expect(JSON.parse(String(calls[0]!.body))).toEqual({ type: 'runtime-project-deactivate-v1', protocolVersion: 1, unconditional: true })
  })
  it('fences rollback after an activation response is invalid', async () => {
    const project = validateWorkcellProjectV5(makeMinimalWorkcellProjectV5()); const hash = 'a'.repeat(64); const calls: RequestInit[] = []
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: async (_url, init) => { calls.push(init); return new Response(JSON.stringify(calls.length === 1 ? {} : status(null, null, null)), { status: 200 }) } })
    const prepared = await client.prepare(project, hash, undefined as never)
    await expect(client.activate(prepared)).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_STATUS_INVALID' })
    await expect(client.rollback(prepared)).resolves.toBe('candidate-deactivated')
    expect(JSON.parse(String(calls[1]!.body))).toMatchObject({ type: 'runtime-project-deactivate-v1', protocolVersion: 1, projectId: project.projectId, revisionId: project.revisionId, configRevision: hash, activationAttemptId: 'attempt-0001' })
  })
  it('consumes a never-attempted prepared candidate without a request', async () => {
    const fetch = vi.fn()
    const client = createRuntimeGatewayConnectivityClientV1({ fetch, createActivationAttemptId: () => 'attempt-0001' })
    const prepared = await client.prepare(validateWorkcellProjectV5(makeMinimalWorkcellProjectV5()), 'a'.repeat(64), undefined as never)
    await client.rollback(prepared)
    expect(fetch).not.toHaveBeenCalled()
    await expect(client.rollback(prepared)).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_CANDIDATE_CONSUMED' })
  })
  it('treats rollback conflict as satisfied when status proves candidate absent', async () => {
    const project = validateWorkcellProjectV5(makeMinimalWorkcellProjectV5()); const hash = 'a'.repeat(64); let call = 0
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: async () => { call += 1; if (call === 1) throw new Error('lost'); if (call === 2) return new Response(JSON.stringify({ code: 'PROJECT_DEACTIVATION_CONFLICT', message: 'conflict' }), { status: 409 }); return new Response(JSON.stringify(status('previous', 'previous', 'b'.repeat(64))), { status: 200 }) } })
    const prepared = await client.prepare(project, hash, undefined as never); await expect(client.activate(prepared)).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_UNAVAILABLE' })
    await expect(client.rollback(prepared)).resolves.toBe('other-authority'); await expect(client.rollback(prepared)).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_CANDIDATE_CONSUMED' })
  })
  it('does not consume rollback conflict when status still matches candidate', async () => {
    const project = validateWorkcellProjectV5(makeMinimalWorkcellProjectV5()); const hash = 'a'.repeat(64); let call = 0
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: async () => { call += 1; if (call === 1) throw new Error('lost'); if (call === 2) return new Response(JSON.stringify({ code: 'PROJECT_DEACTIVATION_CONFLICT', message: 'conflict' }), { status: 409 }); return new Response(JSON.stringify(status(project.projectId, project.revisionId, hash)), { status: 200 }) } })
    const prepared = await client.prepare(project, hash, undefined as never); await client.activate(prepared).catch(() => undefined)
    await expect(client.rollback(prepared)).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_STATUS_MISMATCH' })
  })
  it('surfaces an exact recovery-required rollback candidate instead of treating it as another authority', async () => {
    const project = validateWorkcellProjectV5(makeMinimalWorkcellProjectV5()); const hash = 'a'.repeat(64); let call = 0
    const recovery = {
      ...status(project.projectId, project.revisionId, hash),
      project: { phase: 'recovery-required', authorityPhase: 'recovery-required', projectId: project.projectId, revisionId: project.revisionId, configRevision: hash, activationAttemptId: 'attempt-0001', readinessCode: 'RECOVERY_REQUIRED' },
    }
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: async () => {
      call += 1
      if (call === 1) throw new Error('lost activation response')
      if (call === 2) return new Response(JSON.stringify({ code: 'PROJECT_DEACTIVATION_CONFLICT', message: 'conflict' }), { status: 409 })
      return new Response(JSON.stringify(recovery))
    } })
    const prepared = await client.prepare(project, hash, undefined as never)
    await expect(client.activate(prepared)).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_UNAVAILABLE' })
    await expect(client.rollback(prepared)).rejects.toMatchObject({ code: 'PROJECT_DEACTIVATION_RECOVERY_REQUIRED' })
  })
  it('reconciles a retry conflict to inactive before consuming the rollback candidate', async () => {
    const project = validateWorkcellProjectV5(makeMinimalWorkcellProjectV5()); const hash = 'a'.repeat(64); let call = 0
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: async () => {
      call += 1
      if (call === 1) throw new Error('lost activation response')
      if (call === 2 || call === 4) return new Response(JSON.stringify({ code: 'PROJECT_DEACTIVATION_CONFLICT', message: 'conflict' }), { status: 409 })
      if (call === 3) return new Response(JSON.stringify(status(project.projectId, project.revisionId, hash)))
      return new Response(JSON.stringify(status(null, null, null)))
    } })
    const prepared = await client.prepare(project, hash, undefined as never)
    await expect(client.activate(prepared)).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_UNAVAILABLE' })
    await expect(client.rollback(prepared)).resolves.toBe('candidate-deactivated')
  })
  it('reconciles an oversized successful DELETE response to confirmed inactivity', async () => {
    const project = validateWorkcellProjectV5(makeMinimalWorkcellProjectV5()); const hash = 'a'.repeat(64); let call = 0
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: async () => {
      call += 1
      if (call === 1) return new Response(JSON.stringify(status(project.projectId, project.revisionId, hash)))
      if (call === 2) return new Response('x', { status: 200, headers: { 'content-length': String(64 * 1024 + 1) } })
      return new Response(JSON.stringify(status(null, null, null)))
    } })
    const prepared = await client.prepare(project, hash, undefined as never)
    await client.activate(prepared)
    await expect(client.rollback(prepared)).resolves.toBe('candidate-deactivated')
  })
  it('accepts a versioned connection diagnostic result', async () => {
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: async () => new Response(JSON.stringify({ type: 'opcua-test-connection-result-v1', protocolVersion: 1, outcome: 'succeeded', namespaces: ['urn:controller'] })) })
    await expect(client.testConnection({ endpointId: 'x', name: 'x', endpointUrl: 'opc.tcp://localhost:4840', enabled: true, publishingIntervalMs: 50, reconnectDelayMs: 0 })).resolves.toMatchObject({ outcome: 'succeeded' })
  })
  it.each([
    { type: 'opcua-test-connection-result-v1', protocolVersion: 1, outcome: 'succeeded', namespaces: ['urn:a'], extra: true },
    { type: 'opcua-test-connection-result-v1', protocolVersion: 1, outcome: 'succeeded', namespaces: ['urn:a', 'urn:a'] },
    { type: 'opcua-test-connection-result-v1', protocolVersion: 1, outcome: 'succeeded', namespaces: Array.from({ length: 257 }, (_, index) => `urn:${index}`) },
    { type: 'opcua-test-connection-result-v1', protocolVersion: 1, outcome: 'succeeded', namespaces: ['x'.repeat(4097)] },
  ])('rejects malformed connection diagnostic result', async (result) => {
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: async () => new Response(JSON.stringify(result)) })
    await expect(client.testConnection({ endpointId: 'x', name: 'x', endpointUrl: 'opc.tcp://localhost:4840', enabled: true, publishingIntervalMs: 50, reconnectDelayMs: 0 })).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_RESPONSE_INVALID' })
  })
  it('requires namespace response to echo the exact request', async () => {
    const result = { type: 'opcua-namespace-index-response-v1', protocolVersion: 1, endpointId: 'plc', namespaceUri: 'urn:controller', namespaceIndex: 2 }
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: async () => new Response(JSON.stringify(result)) })
    await expect(client.resolveNamespaceIndex('plc', 'urn:controller')).resolves.toEqual(result)
    const wrong = createRuntimeGatewayConnectivityClientV1({ fetch: async () => new Response(JSON.stringify({ ...result, endpointId: 'other' })) })
    await expect(wrong.resolveNamespaceIndex('plc', 'urn:controller')).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_RESPONSE_INVALID' })
    const wrongUri = createRuntimeGatewayConnectivityClientV1({ fetch: async () => new Response(JSON.stringify({ ...result, namespaceUri: 'urn:other' })) })
    await expect(wrongUri.resolveNamespaceIndex('plc', 'urn:controller')).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_RESPONSE_INVALID' })
    const malformed = createRuntimeGatewayConnectivityClientV1({ fetch: async () => new Response(JSON.stringify({ ...result, namespaceIndex: 1.5, extra: true })) })
    await expect(malformed.resolveNamespaceIndex('plc', 'urn:controller')).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_RESPONSE_INVALID' })
  })
  it('preserves mid-flight caller abort for both diagnostics', async () => {
    const endpoint = { endpointId: 'x', name: 'x', endpointUrl: 'opc.tcp://localhost:4840', enabled: true, publishingIntervalMs: 50, reconnectDelayMs: 0 }
    for (const invoke of [(client: ReturnType<typeof createRuntimeGatewayConnectivityClientV1>, signal: AbortSignal) => client.testConnection(endpoint, signal), (client: ReturnType<typeof createRuntimeGatewayConnectivityClientV1>, signal: AbortSignal) => client.resolveNamespaceIndex('x', 'urn:x', signal)]) {
      const controller = new AbortController(); const client = createRuntimeGatewayConnectivityClientV1({ fetch: async () => new Promise<Response>(() => undefined), timeoutMs: 60_000 }); const pending = invoke(client, controller.signal); controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    }
  })
  it('validates and reactivates the supplied previous publication exactly', async () => {
    const project = validateWorkcellProjectV5(makeMinimalWorkcellProjectV5()); const previous = { project, revisionId: project.revisionId, configRevision: 'a'.repeat(64) }
    let call = 0; const fetch = vi.fn(async () => new Response(JSON.stringify(call++ === 0 ? status(null, null, null) : status(project.projectId, project.revisionId, previous.configRevision))))
    const client = createRuntimeGatewayConnectivityClientV1({ fetch, createActivationAttemptId: () => 'attempt-0001' })
    await expect(client.reactivate({ ...previous, configRevision: 'bad' })).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_CONFIG_REVISION_INVALID' }); expect(fetch).not.toHaveBeenCalled()
    await expect(client.reactivate(previous)).resolves.toMatchObject({ project: { configRevision: previous.configRevision } }); expect(fetch).toHaveBeenCalledWith('/runtime/project', expect.objectContaining({ method: 'PUT' }))
  })
  it('cleans previous only when it is not the active Gateway revision', async () => {
    const project = validateWorkcellProjectV5(makeMinimalWorkcellProjectV5()); const previous = { project, revisionId: project.revisionId, configRevision: 'a'.repeat(64) }
    const active = createRuntimeGatewayConnectivityClientV1({ fetch: async () => new Response(JSON.stringify(status(project.projectId, project.revisionId, previous.configRevision))) })
    await expect(active.cleanupPrevious(previous)).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_CLEANUP_ACTIVE_REVISION' })
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(status(null, null, null))))
    const inactive = createRuntimeGatewayConnectivityClientV1({ fetch }); await inactive.cleanupPrevious(previous); await inactive.cleanupPrevious(previous)
    expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls.every(([url, init]) => url === '/runtime/status' && (init as RequestInit).method === 'GET')).toBe(true)
  })
  it('rejects a declared oversized response before reading its body', async () => {
    const text = vi.fn(async () => { throw new Error('body read') })
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: async () => ({ ok: true, status: 200, headers: new Headers({ 'content-length': String(64 * 1024 + 1) }), text } as unknown as Response) })
    await expect(client.readStatus()).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_RESPONSE_TOO_LARGE' })
    expect(text).not.toHaveBeenCalled()
  })
  it('caps a chunked response and cancels its reader', async () => {
    const cancel = vi.fn()
    const reader = { read: vi.fn().mockResolvedValueOnce({ done: false, value: new Uint8Array(64 * 1024) }).mockResolvedValueOnce({ done: false, value: new Uint8Array(1) }), cancel }
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: async () => ({ ok: true, status: 200, headers: new Headers(), body: { getReader: () => reader } } as unknown as Response) })
    await expect(client.readStatus()).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_RESPONSE_TOO_LARGE' })
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('returns the overflow error without waiting for a non-settling reader cancellation', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    const reader = { read: vi.fn().mockResolvedValue({ done: false, value: new Uint8Array(64 * 1024 + 1) }), cancel }
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: async () => ({ ok: true, status: 200, headers: new Headers(), body: { getReader: () => reader } } as unknown as Response) })
    await expect(client.readStatus()).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_RESPONSE_TOO_LARGE' })
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('normalizes invalid JSON responses', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); controller.close() } })
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: async () => ({ ok: true, status: 200, headers: new Headers(), body: stream } as unknown as Response) })
    await expect(client.readStatus()).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_RESPONSE_INVALID' })
  })
  it('preserves exact HTTP errors and falls back for malformed envelopes', async () => {
    const error = new Response(JSON.stringify({ code: 'OPC_UA_NAMESPACE_URI_MISSING', message: 'missing' }), { status: 409 })
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: async () => error })
    await expect(client.readStatus()).rejects.toMatchObject({ code: 'OPC_UA_NAMESPACE_URI_MISSING', statusCode: 409 })
    const fallback = createRuntimeGatewayConnectivityClientV1({ fetch: async () => new Response('{}', { status: 502 }) })
    await expect(fallback.readStatus()).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_HTTP_502', statusCode: 502 })
  })
  it.each([
    { code: 'lowercase', message: 'bad' },
    { code: 'VALID_CODE', message: 'x'.repeat(513) },
    { code: 'VALID_CODE', message: 'bad', injected: true },
    { code: 'VALID_CODE', message: 'bad', recoveryError: 'x'.repeat(513) },
  ])('rejects a noncanonical bounded Gateway error envelope', async (envelope) => {
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: async () => new Response(JSON.stringify(envelope), { status: 503 }) })
    await expect(client.readStatus()).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_HTTP_503', statusCode: 503 })
  })
  it('honors pre-aborted caller signal and timeout', async () => {
    const aborted = new AbortController(); aborted.abort()
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: async () => new Response('{}'), timeoutMs: 1 })
    await expect(client.testConnection({ endpointId: 'x', name: 'x', endpointUrl: 'opc.tcp://localhost:4840', enabled: true, publishingIntervalMs: 50, reconnectDelayMs: 0 }, aborted.signal)).rejects.toMatchObject({ name: 'AbortError' })
    const timeout = createRuntimeGatewayConnectivityClientV1({ fetch: async () => new Promise<Response>(() => undefined), timeoutMs: 1 })
    await expect(timeout.readStatus()).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_TIMEOUT' })
  })
  it.each(['//evil', '/runtime\\evil', '/runtime?x=1', '/runtime#x', '/runtime\u0001x'])('rejects unsafe base path %j', (basePath) => {
    try { createRuntimeGatewayConnectivityClientV1({ basePath }); throw new Error('expected rejection') } catch (error) { expect(error).toMatchObject({ code: 'RUNTIME_GATEWAY_BASE_PATH_INVALID' }) }
  })
  it('rejects a forged prepared candidate before issuing a Gateway request', async () => {
    const fetch = vi.fn()
    const client = createRuntimeGatewayConnectivityClientV1({ fetch })

    await expect(client.activate({
      projectRevisionId: 'forged',
      configRevision: 'a'.repeat(64),
    } as never)).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_CANDIDATE_FOREIGN' })

    try {
      await client.activate({} as never)
    } catch (error) {
      expect(isRuntimeGatewayConnectivityClientV1Error(error)).toBe(true)
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts the coordinator-owned config hash without recomputing it', async () => {
    const project = validateWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: vi.fn() })

    await expect(client.prepare(project, 'b'.repeat(64), undefined as never)).resolves.toMatchObject({ configRevision: 'b'.repeat(64) })
  })

  it('fences an older prepared handle after a newer preparation', async () => {
    const project = validateWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    const client = createRuntimeGatewayConnectivityClientV1({ fetch: vi.fn() })
    const older = await client.prepare(project, 'a'.repeat(64), undefined as never)
    await client.prepare(project, 'b'.repeat(64), undefined as never)
    await expect(client.activate(older)).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_CANDIDATE_STALE' })
  })
})
