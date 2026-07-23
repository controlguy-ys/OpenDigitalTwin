import { describe, expect, it } from 'vitest'

import type { ConnectivityPresentationStateV1 } from './connectivity-presentation-store.js'
import { connectionMonitorRowsV1 } from './connection-monitor-model.js'

const revision = 'a'.repeat(64)

function presentation(overrides: Partial<ConnectivityPresentationStateV1> = {}): ConnectivityPresentationStateV1 {
  const status = {
    type: 'runtime-gateway-status-v1', protocolVersion: 1, observedAtMs: 1_000,
    gateway: { gatewayId: 'gateway-a', phase: 'online', runtimeKind: 'docker' },
    deployment: { http: { bindHost: '127.0.0.1', port: 8081 }, opcUaServer: { bindHost: '0.0.0.0', port: 4841, advertisedHost: 'gateway', advertisedPort: 4841 } },
    project: { phase: 'ready', authorityPhase: 'active', projectId: 'project-a', revisionId: 'revision-a', configRevision: revision, activationAttemptId: 'attempt-0001', readinessCode: 'READY' },
    opcUa: {
      mode: 'bridge',
      server: { phase: 'listening', endpointUrl: 'opc.tcp://gateway:4841', lastError: null },
      clientEndpoints: [
        { endpointId: 'plc-z', endpointUrl: 'opc.tcp://z:4840', phase: 'reconnecting', sessionActive: false, subscriptionActive: false, monitoredItemCount: 4, mappingCount: 2, lastValueQuality: 'UNCERTAIN', lastNotificationAtMs: 910, lastGoodValueAtMs: 900, reconnectAttempt: 3, nextRetryAtMs: 1_200, lastError: { code: 'RETRYING', message: 'Waiting to reconnect.', occurredAtMs: 905 } },
        { endpointId: 'plc-a', endpointUrl: 'opc.tcp://a:4840', phase: 'connected', sessionActive: true, subscriptionActive: true, monitoredItemCount: 2, mappingCount: 1, lastValueQuality: 'GOOD', lastNotificationAtMs: 990, lastGoodValueAtMs: 990, reconnectAttempt: 0, nextRetryAtMs: null, lastError: null },
      ],
    },
  } as const
  const integrationDiagnostics = {
    type: 'runtime-integration-diagnostics-v1', protocolVersion: 1, observedAtMs: 995,
    projectId: 'project-a', revisionId: 'revision-a', configRevision: revision,
    serverModel: { standardNodeSets: 'loaded', roboticsModel: 'ready', productModel: 'ready', activeSessionCount: 2, maximumSessionCount: 16, lastError: null },
    browserPublisher: { phase: 'active', publisherId: 'browser-a', generation: 7, expiresAt: 1_500 },
    lastCommandResult: { type: 'command-result-v1', protocolVersion: 1, projectId: 'project-a', configRevision: revision, leaseGeneration: 7, targetId: 'job-a', commandId: 'start', acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED', failureCode: null, message: 'Started.', attachedObjectId: null, completedAt: 980 },
  } as const
  return {
    gateway: { state: 'online', label: 'Online', detail: 'Runtime Gateway responded.' },
    opcUa: { state: 'bridge-connected', label: 'Connected', detail: 'Project: READY' },
    status,
    integrationDiagnostics,
    transportError: null,
    lastObservedAtMs: 1_000,
    ...overrides,
  } as ConnectivityPresentationStateV1
}

describe('connectionMonitorRowsV1', () => {
  it('projects every diagnostic field in fixed rows with endpoint IDs sorted deterministically', () => {
    const rows = connectionMonitorRowsV1(presentation())

    expect(rows.map((row) => row.id)).toEqual([
      'web-proxy', 'gateway', 'project', 'opcua-server', 'server-model',
      'browser-publisher', 'opcua-client:plc-a', 'opcua-client:plc-z', 'outgoing-command',
    ])
    expect(rows[1]).toMatchObject({ state: 'Online', details: expect.arrayContaining([{ label: 'Runtime kind', value: 'docker' }, { label: 'Observed', value: '1000' }]) })
    expect(rows[2]).toMatchObject({ state: 'ready', details: expect.arrayContaining([{ label: 'Authority', value: 'active' }, { label: 'Revision', value: 'revision-a' }]) })
    expect(rows[3]).toMatchObject({ state: 'listening', endpoint: 'opc.tcp://gateway:4841' })
    expect(rows[4]).toMatchObject({ state: 'ready', details: expect.arrayContaining([{ label: 'Standard NodeSet', value: 'loaded' }, { label: 'Robotics', value: 'ready' }, { label: 'Product', value: 'ready' }, { label: 'Sessions', value: '2 / 16' }]) })
    expect(rows[5]).toMatchObject({ state: 'active', details: expect.arrayContaining([{ label: 'Generation', value: '7' }, { label: 'Expires', value: '1500' }]) })
    expect(rows[6]).toMatchObject({ endpoint: 'opc.tcp://a:4840', state: 'connected', quality: 'GOOD', details: expect.arrayContaining([{ label: 'Session', value: 'Active' }, { label: 'Subscription', value: 'Active' }, { label: 'Monitored items', value: '2' }, { label: 'Mappings', value: '1' }, { label: 'Last notification', value: '990' }, { label: 'Last GOOD', value: '990' }]) })
    expect(rows[7]).toMatchObject({ endpoint: 'opc.tcp://z:4840', state: 'reconnecting', quality: 'UNCERTAIN', error: { code: 'RETRYING', message: 'Waiting to reconnect.', occurredAtMs: 905 }, details: expect.arrayContaining([{ label: 'Reconnect attempt', value: '3' }, { label: 'Next retry', value: '1200' }]) })
    expect(rows[8]).toMatchObject({ state: 'ACCEPTED/SUCCEEDED', quality: 'ACCEPTED', lastUpdateAtMs: 980, details: expect.arrayContaining([{ label: 'Target', value: 'job-a' }, { label: 'Command', value: 'start' }, { label: 'Lease generation', value: '7' }]) })
  })

  it('keeps the current proxy error fresh while retained status and diagnostics are stale', () => {
    const rows = connectionMonitorRowsV1(presentation({ transportError: 'Gateway disconnected.' }))

    expect(rows[0]).toMatchObject({ state: 'Error', error: { code: 'RUNTIME_GATEWAY_TRANSPORT_ERROR', message: 'Gateway disconnected.' } })
    expect(rows[0]!.details).toContainEqual({ label: 'Freshness', value: 'Current transport error' })
    expect(rows.slice(1).every((row) => row.details.some((detail) => detail.label === 'Freshness' && detail.value === 'Stale retained data'))).toBe(true)
  })

  it('rejects cross-revision diagnostics and a command owned by another status Project/configuration', () => {
    const crossRevision = presentation({ integrationDiagnostics: { ...presentation().integrationDiagnostics!, revisionId: 'revision-b' } })
    expect(connectionMonitorRowsV1(crossRevision).slice(4, 6).every((row) => row.state === 'Unavailable')).toBe(true)

    const wrongCommand = presentation({ integrationDiagnostics: { ...presentation().integrationDiagnostics!, lastCommandResult: { ...presentation().integrationDiagnostics!.lastCommandResult!, configRevision: 'b'.repeat(64) } } })
    expect(connectionMonitorRowsV1(wrongCommand).at(-1)).toMatchObject({ state: 'Unavailable' })
  })

  it('keeps every fixed non-client row visible as unavailable without a decoded status', () => {
    const rows = connectionMonitorRowsV1(presentation({ status: null, integrationDiagnostics: null, transportError: null, lastObservedAtMs: null }))
    expect(rows.map((row) => row.id)).toEqual(['web-proxy', 'gateway', 'project', 'opcua-server', 'server-model', 'browser-publisher', 'outgoing-command'])
    expect(rows.every((row) => row.state === 'Unavailable')).toBe(true)
  })
})
