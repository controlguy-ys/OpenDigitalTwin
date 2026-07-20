import { describe, expect, it, vi } from 'vitest'

import { endpointLifecycleEventIdV1, validateEndpointLifecycleV1 } from '../../../core/runtime-protocol/v1.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import { validateWorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { createEndpointLifecycleRouterV5 } from './endpoint-lifecycle-router.js'

const REVISION = 'a'.repeat(64)

function lifecycle(overrides: Record<string, unknown> = {}) {
  const publisherGeneration = (overrides.publisherGeneration as number | undefined) ?? 1
  const sessionGeneration = (overrides.sessionGeneration as number | undefined) ?? 1
  const phase = (overrides.phase as 'connected' | 'disconnected' | undefined) ?? 'connected'
  return validateEndpointLifecycleV1({
    type: 'endpoint-lifecycle-v1', protocolVersion: 1,
    gatewayId: 'gateway-1', projectId: 'project-v5', configRevision: REVISION,
    endpointId: 'plc-a', sequence: 1, originId: 'gateway-1:opcua-client',
    publisherGeneration, sessionGeneration, phase,
    eventId: endpointLifecycleEventIdV1({ publisherGeneration, sessionGeneration, phase }),
    statusCode: phase === 'connected' ? 'Good' : 'BadNoCommunication', occurredAtMs: 1,
    ...overrides,
  })
}

describe('EndpointLifecycleRouterV5', () => {
  it('applies a connected reset and later disconnected stale transition only for accepted Endpoint-local order', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.opcUa.endpoints[0] as unknown as { endpointId: string }).endpointId = 'plc-a'
    ;(project.opcUa.mappings[0] as unknown as { endpointId: string }).endpointId = 'plc-a'
    const readActiveContext = () => ({
      project: validateWorkcellProjectV5(project), configRevision: REVISION, gatewayId: 'gateway-1',
    })
    const target = { resetEndpointSession: vi.fn(), markEndpointDisconnected: vi.fn() }
    const router = createEndpointLifecycleRouterV5({ readActiveContext, targets: [target] })

    expect(router.ingest(lifecycle({ phase: 'connected', sequence: 10 }), 100)).toBe(true)
    expect(router.ingest(lifecycle({ phase: 'connected', sequence: 11 }), 101)).toBe(false)
    expect(router.ingest(lifecycle({ phase: 'disconnected', sequence: 12 }), 102)).toBe(true)
    expect(router.ingest(lifecycle({ phase: 'connected', sequence: 13 }), 103)).toBe(false)
    expect(target.resetEndpointSession).toHaveBeenCalledExactlyOnceWith('plc-a', 100)
    expect(target.markEndpointDisconnected).toHaveBeenCalledExactlyOnceWith('plc-a', 102)
  })

  it('does not consume ordering or call targets for malformed, wrong-context, or unknown Endpoint events', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.opcUa.endpoints[0] as unknown as { endpointId: string }).endpointId = 'plc-a'
    ;(project.opcUa.mappings[0] as unknown as { endpointId: string }).endpointId = 'plc-a'
    const target = { resetEndpointSession: vi.fn(), markEndpointDisconnected: vi.fn() }
    const router = createEndpointLifecycleRouterV5({
      readActiveContext: () => ({ project: validateWorkcellProjectV5(project), configRevision: REVISION, gatewayId: 'gateway-1' }),
      targets: [target],
    })

    expect(router.ingest({ ...lifecycle(), eventId: 'wrong' } as never, 100)).toBe(false)
    expect(router.ingest(lifecycle({ gatewayId: 'other' }), 101)).toBe(false)
    expect(router.ingest(lifecycle({ endpointId: 'unknown' }), 102)).toBe(false)
    expect(router.ingest(lifecycle(), 103)).toBe(true)
    expect(target.resetEndpointSession).toHaveBeenCalledExactlyOnceWith('plc-a', 103)
  })
})
