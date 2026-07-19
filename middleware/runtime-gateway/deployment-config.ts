import type { RuntimeGatewayRuntimeKindV1 } from '../../src/core/runtime-protocol/gateway-status-v1.js'

export interface RuntimeGatewayDeploymentConfigV1 {
  readonly gatewayId: string
  readonly runtimeKind: RuntimeGatewayRuntimeKindV1
  readonly host: string
  readonly httpPort: number
  readonly opcUaAdvertisedHost: string
  readonly opcUaAdvertisedPort: number
  readonly opcUaPort: number
}

export type RuntimeGatewayDeploymentEnvironmentV1 = Readonly<
  Record<string, string | undefined>
>

export class RuntimeGatewayDeploymentConfigError extends Error {
  readonly code = 'RUNTIME_GATEWAY_DEPLOYMENT_CONFIG_INVALID' as const
  readonly path: string

  constructor(path: string, reason: string) {
    super(`RUNTIME_GATEWAY_DEPLOYMENT_CONFIG_INVALID at ${path}: ${reason}`)
    this.name = 'RuntimeGatewayDeploymentConfigError'
    this.path = path
  }
}

const DEFAULT_GATEWAY_ID = 'runtime-gateway'
const DEFAULT_RUNTIME_KIND: RuntimeGatewayRuntimeKindV1 = 'native'
const DEFAULT_HOST = '0.0.0.0'
const DEFAULT_OPC_UA_ADVERTISED_HOST = 'localhost'
const DEFAULT_HTTP_PORT = 8081
const DEFAULT_OPC_UA_PORT = 4840

const GATEWAY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const PORT_PATTERN = /^[1-9][0-9]{0,4}$/
const HOST_FORBIDDEN_PATTERN = /[\p{Cc}\s/\\?#]/u

function environmentPath(name: string): string {
  return `$.environment.${name}`
}

function invalid(name: string, reason: string): never {
  throw new RuntimeGatewayDeploymentConfigError(environmentPath(name), reason)
}

function recognizedValue(
  environment: RuntimeGatewayDeploymentEnvironmentV1,
  name: string,
  fallback: string,
): string {
  const value = environment[name]
  if (value === undefined) return fallback

  const trimmed = value.trim()
  if (trimmed.length === 0) invalid(name, 'must not be empty')
  return trimmed
}

function readGatewayId(
  environment: RuntimeGatewayDeploymentEnvironmentV1,
): string {
  const name = 'ROBOTSIM_GATEWAY_ID'
  const value = recognizedValue(environment, name, DEFAULT_GATEWAY_ID)
  if (!GATEWAY_ID_PATTERN.test(value)) {
    invalid(name, 'must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')
  }
  return value
}

function readRuntimeKind(
  environment: RuntimeGatewayDeploymentEnvironmentV1,
): RuntimeGatewayRuntimeKindV1 {
  const name = 'ROBOTSIM_RUNTIME_KIND'
  const value = recognizedValue(environment, name, DEFAULT_RUNTIME_KIND)
  if (value !== 'native' && value !== 'docker') {
    invalid(name, 'must be native or docker')
  }
  return value
}

function readHost(
  environment: RuntimeGatewayDeploymentEnvironmentV1,
  name: 'ROBOTSIM_GATEWAY_HOST' | 'ROBOTSIM_OPCUA_ADVERTISE_HOST',
  fallback: string,
): string {
  const value = recognizedValue(environment, name, fallback)
  if (value.length > 255) invalid(name, 'must be at most 255 characters')
  if (HOST_FORBIDDEN_PATTERN.test(value)) {
    invalid(name, 'must be a host without whitespace, controls, path, query, or fragment characters')
  }
  const colonCount = [...value].filter((character) => character === ':').length
  if (
    (colonCount === 1 && !value.startsWith('['))
    || (value.startsWith('[') && !value.endsWith(']'))
  ) {
    invalid(name, 'must not include a TCP port')
  }
  return value
}

function readPort(
  environment: RuntimeGatewayDeploymentEnvironmentV1,
  name:
    | 'ROBOTSIM_GATEWAY_HTTP_PORT'
    | 'ROBOTSIM_OPCUA_ADVERTISE_PORT'
    | 'ROBOTSIM_OPCUA_PORT',
  fallback: number,
): number {
  const value = recognizedValue(environment, name, String(fallback))
  if (!PORT_PATTERN.test(value)) {
    invalid(name, 'must be an ASCII decimal integer from 1 through 65535')
  }

  const port = Number.parseInt(value, 10)
  if (port > 65535) invalid(name, 'must be between 1 and 65535')
  return port
}

export function readDeploymentConfig(
  environment: RuntimeGatewayDeploymentEnvironmentV1,
): RuntimeGatewayDeploymentConfigV1 {
  return Object.freeze({
    gatewayId: readGatewayId(environment),
    runtimeKind: readRuntimeKind(environment),
    host: readHost(environment, 'ROBOTSIM_GATEWAY_HOST', DEFAULT_HOST),
    httpPort: readPort(environment, 'ROBOTSIM_GATEWAY_HTTP_PORT', DEFAULT_HTTP_PORT),
    opcUaAdvertisedHost: readHost(
      environment,
      'ROBOTSIM_OPCUA_ADVERTISE_HOST',
      DEFAULT_OPC_UA_ADVERTISED_HOST,
    ),
    opcUaAdvertisedPort: readPort(
      environment,
      'ROBOTSIM_OPCUA_ADVERTISE_PORT',
      DEFAULT_OPC_UA_PORT,
    ),
    opcUaPort: readPort(environment, 'ROBOTSIM_OPCUA_PORT', DEFAULT_OPC_UA_PORT),
  })
}
