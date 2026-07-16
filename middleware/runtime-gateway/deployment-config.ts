export interface RuntimeGatewayDeploymentConfigV1 {
  readonly gatewayId: string
  readonly host: string
  readonly httpPort: number
  readonly websocketPath: string
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
const DEFAULT_HOST = '0.0.0.0'
const DEFAULT_HTTP_PORT = 8081
const DEFAULT_WEBSOCKET_PATH = '/runtime/ws'
const DEFAULT_OPC_UA_PORT = 4840

const GATEWAY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const PORT_PATTERN = /^[1-9][0-9]{0,4}$/
const HOST_FORBIDDEN_PATTERN = /[\p{Cc}\s/\\?#]/u
const WEBSOCKET_PATH_FORBIDDEN_PATTERN = /[\p{Cc}\s\\?#]/u

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

function readHost(
  environment: RuntimeGatewayDeploymentEnvironmentV1,
): string {
  const name = 'ROBOTSIM_GATEWAY_HOST'
  const value = recognizedValue(environment, name, DEFAULT_HOST)
  if (value.length > 255) invalid(name, 'must be at most 255 characters')
  if (HOST_FORBIDDEN_PATTERN.test(value)) {
    invalid(name, 'must be a host without whitespace, controls, path, query, or fragment characters')
  }
  return value
}

function readPort(
  environment: RuntimeGatewayDeploymentEnvironmentV1,
  name: 'ROBOTSIM_GATEWAY_HTTP_PORT' | 'ROBOTSIM_OPCUA_PORT',
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

function readWebsocketPath(
  environment: RuntimeGatewayDeploymentEnvironmentV1,
): string {
  const name = 'ROBOTSIM_GATEWAY_WEBSOCKET_PATH'
  const value = recognizedValue(environment, name, DEFAULT_WEBSOCKET_PATH)
  if (value.length > 1024) invalid(name, 'must be at most 1024 characters')
  if (!value.startsWith('/') || value.startsWith('//')) {
    invalid(name, 'must begin with exactly one slash')
  }
  if (value.endsWith('/')) invalid(name, 'must not end with a slash')
  if (WEBSOCKET_PATH_FORBIDDEN_PATTERN.test(value)) {
    invalid(name, 'must be a path without whitespace, controls, backslashes, query, or fragment characters')
  }
  return value
}

export function readDeploymentConfig(
  environment: RuntimeGatewayDeploymentEnvironmentV1,
): RuntimeGatewayDeploymentConfigV1 {
  return Object.freeze({
    gatewayId: readGatewayId(environment),
    host: readHost(environment),
    httpPort: readPort(environment, 'ROBOTSIM_GATEWAY_HTTP_PORT', DEFAULT_HTTP_PORT),
    websocketPath: readWebsocketPath(environment),
    opcUaPort: readPort(environment, 'ROBOTSIM_OPCUA_PORT', DEFAULT_OPC_UA_PORT),
  })
}
