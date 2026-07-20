import { describe, expect, it, vi } from 'vitest'

import { endpointLifecycleEventIdV1, validateEndpointLifecycleV1 } from '../../../core/runtime-protocol/v1.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import { validateWorkcellProjectV5, type WorkcellProjectV5 } from '../../../core/project-v5/index.js'
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

  it('isolates target failures and rejects an equal tuple with a conflicting semantic key', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.opcUa.endpoints[0] as unknown as { endpointId: string }).endpointId = 'plc-a'
    ;(project.opcUa.mappings[0] as unknown as { endpointId: string }).endpointId = 'plc-a'
    const throwing = { resetEndpointSession: vi.fn(() => { throw new Error('disposed') }), markEndpointDisconnected: vi.fn() }
    const later = { resetEndpointSession: vi.fn(), markEndpointDisconnected: vi.fn() }
    const router = createEndpointLifecycleRouterV5({
      readActiveContext: () => ({ project: validateWorkcellProjectV5(project), configRevision: REVISION, gatewayId: 'gateway-1' }),
      targets: [throwing, later],
    })

    expect(router.ingest(lifecycle(), 100)).toBe(true)
    expect(later.resetEndpointSession).toHaveBeenCalledExactlyOnceWith('plc-a', 100)
    // Same order tuple but a different origin/event semantic identity is a
    // conflict, not a duplicate; it must not fan out.
    expect(router.ingest(lifecycle({ originId: 'other-origin' }), 101)).toBe(false)
    expect(later.resetEndpointSession).toHaveBeenCalledOnce()
    router.resetSocketSession()
    expect(router.ingest(lifecycle({ originId: 'other-origin' }), 102)).toBe(true)
    expect(later.resetEndpointSession).toHaveBeenCalledTimes(2)
  })

  it('serializes reentrant delivery so every target sees connected before disconnected and consumes the later tuple once', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.opcUa.endpoints[0] as unknown as { endpointId: string }).endpointId = 'plc-a'
    ;(project.opcUa.mappings[0] as unknown as { endpointId: string }).endpointId = 'plc-a'
    const observations: string[] = []
    let router!: ReturnType<typeof createEndpointLifecycleRouterV5>
    const reentrant = {
      resetEndpointSession: vi.fn(() => {
        observations.push('first:connected')
        router.ingest(lifecycle({ phase: 'disconnected', sequence: 2 }), 101)
      }),
      markEndpointDisconnected: vi.fn(() => observations.push('first:disconnected')),
    }
    const later = {
      resetEndpointSession: vi.fn(() => observations.push('later:connected')),
      markEndpointDisconnected: vi.fn(() => observations.push('later:disconnected')),
    }
    router = createEndpointLifecycleRouterV5({
      readActiveContext: () => ({ project: validateWorkcellProjectV5(project), configRevision: REVISION, gatewayId: 'gateway-1' }),
      targets: [reentrant, later],
    })

    expect(router.ingest(lifecycle({ sequence: 1 }), 100)).toBe(true)
    expect(observations).toEqual([
      'first:connected', 'later:connected', 'first:disconnected', 'later:disconnected',
    ])
    expect(router.ingest(lifecycle({ phase: 'disconnected', sequence: 3 }), 102)).toBe(false)
  })

  it('rejects the complete context/order matrix, treats Event IDs as Endpoint-scoped, and resets bounded records', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    const endpoints = project.opcUa.endpoints as unknown as Array<{ endpointId: string; enabled: boolean; name: string; endpointUrl: string; publishingIntervalMs: number; reconnectDelayMs: number }>
    endpoints[0]!.endpointId = 'plc-a'
    ;(project.opcUa.mappings[0] as unknown as { endpointId: string }).endpointId = 'plc-a'
    endpoints.push({ ...endpoints[0]!, endpointId: 'plc-b', name: 'PLC B' })
    const target = { resetEndpointSession: vi.fn(), markEndpointDisconnected: vi.fn() }
    let active = project as WorkcellProjectV5
    const router = createEndpointLifecycleRouterV5({
      readActiveContext: () => ({ project: active, configRevision: REVISION, gatewayId: 'gateway-1' }),
      targets: [target],
    })

    expect(router.ingest(lifecycle({ projectId: 'wrong' }), 1)).toBe(false)
    expect(router.ingest(lifecycle({ configRevision: 'b'.repeat(64) }), 1)).toBe(false)
    expect(router.ingest(lifecycle({ gatewayId: 'wrong' }), 1)).toBe(false)
    expect(router.ingest(lifecycle({ endpointId: 'unknown' }), 1)).toBe(false)
    expect(router.ingest({ ...lifecycle(), eventId: 'malformed' } as never, 1)).toBe(false)
    const disabled = cloneWorkcellProjectV5(project)
    ;(disabled.opcUa.endpoints[0] as unknown as { enabled: boolean }).enabled = false
    active = disabled as WorkcellProjectV5
    expect(router.ingest(lifecycle(), 1)).toBe(false)
    active = project as WorkcellProjectV5

    expect(router.ingest(lifecycle({ sequence: 1 }), 10)).toBe(true)
    expect(router.ingest(lifecycle({ sequence: 2 }), 11)).toBe(false)
    expect(router.ingest(lifecycle({ sequence: 3, originId: 'conflict' }), 12)).toBe(false)
    expect(router.ingest({ ...lifecycle({ sequence: 4 }), publisherGeneration: 0 } as never, 13)).toBe(false)
    expect(router.ingest(lifecycle({ endpointId: 'plc-b', sequence: 1 }), 14)).toBe(true)
    expect(target.resetEndpointSession).toHaveBeenCalledTimes(2)
    router.resetSocketSession()
    expect(router.ingest(lifecycle({ sequence: 5, originId: 'conflict' }), 15)).toBe(true)

    const capacityProject = cloneWorkcellProjectV5(project) as WorkcellProjectV5
    const capacityEndpoints = capacityProject.opcUa.endpoints as unknown as Array<{ endpointId: string; enabled: boolean; name: string; endpointUrl: string; publishingIntervalMs: number; reconnectDelayMs: number }>
    for (let index = 2; index < 9; index += 1) capacityEndpoints.push({ ...capacityEndpoints[0]!, endpointId: `plc-${index}`, name: `PLC ${index}` })
    const capacity = createEndpointLifecycleRouterV5({
      readActiveContext: () => ({ project: capacityProject, configRevision: REVISION, gatewayId: 'gateway-1' }), targets: [target],
    })
    for (const endpointId of capacityEndpoints.slice(0, 8).map(({ endpointId }) => endpointId)) {
      expect(capacity.ingest(lifecycle({ endpointId }), 20)).toBe(true)
    }
    expect(capacity.ingest(lifecycle({ endpointId: capacityEndpoints[8]!.endpointId }), 20)).toBe(false)
  })
})
