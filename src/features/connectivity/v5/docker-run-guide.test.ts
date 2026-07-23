import { describe, expect, it } from 'vitest'

import type { RuntimeGatewayStatusV1 } from '../../../core/runtime-protocol/gateway-status-v1.js'
import { dockerRunGuideV1 } from './docker-run-guide.js'

function status(): RuntimeGatewayStatusV1 {
  return {
    type: 'runtime-gateway-status-v1',
    protocolVersion: 1,
    observedAtMs: 1,
    gateway: { gatewayId: 'gateway', phase: 'online', runtimeKind: 'docker' },
    deployment: {
      http: { bindHost: '0.0.0.0', port: 8081 },
      opcUaServer: {
        bindHost: '0.0.0.0',
        port: 14841,
        advertisedHost: 'engineering-host',
        advertisedPort: 24841,
      },
    },
    project: {
      phase: 'not-applied',
      authorityPhase: 'inactive',
      projectId: null,
      revisionId: null,
      configRevision: null,
      activationAttemptId: null,
      readinessCode: 'NO_ACTIVE_REVISION',
    },
    opcUa: {
      mode: 'off',
      server: { phase: 'disabled', endpointUrl: null, lastError: null },
      clientEndpoints: [],
    },
  }
}

describe('dockerRunGuideV1', () => {
  it('generates the copy-only PowerShell flow and keeps external PLC and Gateway Server ports independent', () => {
    const guide = dockerRunGuideV1(null)
    expect(guide.text).toContain("$env:ROBOTSIM_OPCUA_PORT = '4841'")
    expect(guide.text).toContain("$env:ROBOTSIM_OPCUA_ADVERTISE_HOST = '127.0.0.1'")
    expect(guide.text).toContain('docker compose up -d --build --wait')
    expect(guide.text).toContain('docker compose ps')
    expect(guide.text).toContain('Invoke-WebRequest http://127.0.0.1:8080/runtime/healthz')
    expect(guide.text).toContain('Invoke-WebRequest http://127.0.0.1:8080/runtime/readyz')
    expect(guide.text).toContain('Invoke-WebRequest http://127.0.0.1:8080/runtime/status')
    expect(guide.externalPlc).toEqual({
      native: 'opc.tcp://127.0.0.1:4840',
      docker: 'opc.tcp://host.docker.internal:4840',
    })
    expect(guide.gatewayServer).toBe('opc.tcp://127.0.0.1:4841')
    expect(guide.actions).toEqual(['copy'])
    expect(guide.text).not.toMatch(/docker compose (down|restart|stop)/)
  })

  it('shows effective listener and advertised values from decoded runtime status', () => {
    const guide = dockerRunGuideV1(status())
    expect(guide.effective).toEqual({
      runtimeKind: 'docker',
      listener: '0.0.0.0:14841',
      advertised: 'engineering-host:24841',
    })
    expect(guide.text).toContain("$env:ROBOTSIM_OPCUA_PORT = '4841'")
    expect(guide.text).toContain("$env:ROBOTSIM_OPCUA_ADVERTISE_HOST = '127.0.0.1'")
    expect(guide.text).not.toContain('14841')
    expect(guide.text).not.toContain('24841')
    expect(guide.gatewayServer).toBe('opc.tcp://127.0.0.1:4841')
    expect(guide.restartWarning).toContain('restart')
  })
})
