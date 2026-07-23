import type { RuntimeGatewayStatusV1 } from '../../../core/runtime-protocol/gateway-status-v1.js'

export interface DockerRunGuideV1 {
  readonly text: string
  readonly actions: readonly ['copy']
  readonly externalPlc: {
    readonly native: string
    readonly docker: string
  }
  readonly gatewayServer: string
  readonly effective: {
    readonly runtimeKind: 'native' | 'docker' | 'unknown'
    readonly listener: string
    readonly advertised: string
  }
  readonly restartWarning: string
}

function powerShellLiteral(value: string | number): string {
  return `'${String(value).replaceAll("'", "''")}'`
}

export function dockerRunGuideV1(
  status: RuntimeGatewayStatusV1 | null,
): DockerRunGuideV1 {
  const listenerHost = status?.deployment.opcUaServer.bindHost ?? '0.0.0.0'
  const listenerPort = status?.deployment.opcUaServer.port ?? 4841
  const advertisedHost = status?.deployment.opcUaServer.advertisedHost ?? '127.0.0.1'
  const advertisedPort = status?.deployment.opcUaServer.advertisedPort ?? 4841
  const text = [
    `$env:ROBOTSIM_OPCUA_PORT = ${powerShellLiteral(4841)}`,
    `$env:ROBOTSIM_OPCUA_ADVERTISE_HOST = ${powerShellLiteral('127.0.0.1')}`,
    'docker compose up -d --build --wait',
    'docker compose ps',
    'Invoke-WebRequest http://127.0.0.1:8080/runtime/healthz',
    'Invoke-WebRequest http://127.0.0.1:8080/runtime/readyz',
    'Invoke-WebRequest http://127.0.0.1:8080/runtime/status',
  ].join('\n')
  return Object.freeze({
    text,
    actions: Object.freeze(['copy'] as const),
    externalPlc: Object.freeze({
      native: 'opc.tcp://127.0.0.1:4840',
      docker: 'opc.tcp://host.docker.internal:4840',
    }),
    gatewayServer: 'opc.tcp://127.0.0.1:4841',
    effective: Object.freeze({
      runtimeKind: status?.gateway.runtimeKind ?? 'unknown',
      listener: `${listenerHost}:${listenerPort}`,
      advertised: `${advertisedHost}:${advertisedPort}`,
    }),
    restartWarning: 'Environment changes take effect only after the Runtime Gateway container is recreated or restarted.',
  })
}
