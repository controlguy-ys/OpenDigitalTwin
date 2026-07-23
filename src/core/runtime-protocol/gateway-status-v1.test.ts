import { describe, expect, it } from 'vitest'

import { validateRuntimeGatewayStatusV1 } from './gateway-status-v1.js'

function bridgeStatusFixtureV1() {
  return {
    type: 'runtime-gateway-status-v1' as const,
    protocolVersion: 1 as const,
    observedAtMs: 9_000,
    gateway: { gatewayId: 'gateway-test', phase: 'online' as const, runtimeKind: 'docker' as const },
    deployment: {
      http: { bindHost: '0.0.0.0', port: 8081 },
      opcUaServer: {
        bindHost: '0.0.0.0', port: 4841,
        advertisedHost: '127.0.0.1', advertisedPort: 4841,
      },
    },
    project: {
      phase: 'ready' as const, projectId: 'project-a', revisionId: 'revision-a',
      configRevision: 'a'.repeat(64),
      activationAttemptId: 'attempt-0001', authorityPhase: 'active' as const,
      readinessCode: 'READY' as const,
    },
    opcUa: {
      mode: 'bridge' as const,
      server: {
        phase: 'listening' as const,
        endpointUrl: 'opc.tcp://127.0.0.1:4841', lastError: null,
      },
      clientEndpoints: [{
        endpointId: 'plc-a', endpointUrl: 'opc.tcp://host.docker.internal:4840',
        phase: 'reconnecting' as const, sessionActive: false, subscriptionActive: false,
        monitoredItemCount: 6, mappingCount: 1, lastValueQuality: 'GOOD' as const,
        lastNotificationAtMs: 8_000, lastGoodValueAtMs: 8_000,
        reconnectAttempt: 1, nextRetryAtMs: 9_100,
        lastError: {
          code: 'OPC_UA_CONNECTION_LOST', message: 'OPC_UA_CONNECTION_LOST', occurredAtMs: 9_000,
        },
      }],
    },
  }
}

describe('validateRuntimeGatewayStatusV1', () => {
  it('accepts independent Project-ready, Server-listening, and reconnecting Client state', () => {
    const status = validateRuntimeGatewayStatusV1(bridgeStatusFixtureV1())
    expect(status.project.phase).toBe('ready')
    expect(status.opcUa.server.phase).toBe('listening')
    expect(status.opcUa.clientEndpoints[0]?.phase).toBe('reconnecting')
    expect(Object.isFrozen(status)).toBe(true)
  })

  it('rejects a connected Client without an active Session and Subscription', () => {
    const source = bridgeStatusFixtureV1()
    expect(() => validateRuntimeGatewayStatusV1({
      ...source,
      opcUa: {
        ...source.opcUa,
        clientEndpoints: [{
          ...source.opcUa.clientEndpoints[0], phase: 'connected',
          sessionActive: false, subscriptionActive: false,
        }],
      },
    })).toThrow('RUNTIME_GATEWAY_STATUS_INVALID')
  })

  it('rejects unknown fields and a listening Server without an endpoint URL', () => {
    expect(() => validateRuntimeGatewayStatusV1({
      ...bridgeStatusFixtureV1(), unexpected: true,
    })).toThrow('RUNTIME_GATEWAY_STATUS_INVALID')
    const source = bridgeStatusFixtureV1()
    expect(() => validateRuntimeGatewayStatusV1({
      ...source,
      opcUa: { ...source.opcUa, server: { ...source.opcUa.server, endpointUrl: null } },
    })).toThrow('RUNTIME_GATEWAY_STATUS_INVALID')
  })

  it('requires an exact activation token and inactive authority for no Project', () => {
    const source = bridgeStatusFixtureV1()
    expect(() => validateRuntimeGatewayStatusV1({
      ...source,
      project: { ...source.project, activationAttemptId: 'bad' },
    })).toThrow('RUNTIME_GATEWAY_STATUS_INVALID')
    expect(() => validateRuntimeGatewayStatusV1({
      ...source,
      project: {
        phase: 'not-applied', authorityPhase: 'active', projectId: null, revisionId: null,
        configRevision: null, activationAttemptId: null, readinessCode: 'NO_ACTIVE_REVISION',
      },
    })).toThrow('RUNTIME_GATEWAY_STATUS_INVALID')
  })

  it.each([
    ['ready', 'active', 'READY'],
    ['deactivating', 'deactivating', 'DEACTIVATING'],
    ['recovery-required', 'recovery-required', 'RECOVERY_REQUIRED'],
  ] as const)('accepts the complete %s authority cross-field combination', (phase, authorityPhase, readinessCode) => {
    const source = bridgeStatusFixtureV1()
    expect(validateRuntimeGatewayStatusV1({
      ...source,
      project: { ...source.project, phase, authorityPhase, readinessCode },
    }).project).toMatchObject({ phase, authorityPhase, readinessCode, activationAttemptId: 'attempt-0001' })
  })
})
