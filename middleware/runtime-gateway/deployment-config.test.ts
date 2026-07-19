// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  RuntimeGatewayDeploymentConfigError,
  readDeploymentConfig,
} from './deployment-config.js'

const DEFAULT_CONFIG = {
  gatewayId: 'runtime-gateway',
  runtimeKind: 'native',
  host: '0.0.0.0',
  httpPort: 8081,
  opcUaAdvertisedHost: 'localhost',
  opcUaAdvertisedPort: 4840,
  opcUaPort: 4840,
}

describe('readDeploymentConfig', () => {
  it('returns exact deployment defaults without owning active Project mode', () => {
    const config = readDeploymentConfig({})

    expect(config).toEqual(DEFAULT_CONFIG)
    expect(config).not.toHaveProperty('mode')
    expect(Object.keys(config)).toEqual([
      'gatewayId',
      'runtimeKind',
      'host',
      'httpPort',
      'opcUaAdvertisedHost',
      'opcUaAdvertisedPort',
      'opcUaPort',
    ])
  })

  it('trims and applies all seven explicit deployment overrides', () => {
    expect(readDeploymentConfig({
      ROBOTSIM_GATEWAY_ID: ' gateway.a-1 ',
      ROBOTSIM_RUNTIME_KIND: ' docker ',
      ROBOTSIM_GATEWAY_HOST: ' :: ',
      ROBOTSIM_GATEWAY_HTTP_PORT: ' 18081 ',
      ROBOTSIM_OPCUA_ADVERTISE_HOST: ' robot-sim.local ',
      ROBOTSIM_OPCUA_ADVERTISE_PORT: ' 24840 ',
      ROBOTSIM_OPCUA_PORT: ' 14840 ',
    })).toEqual({
      gatewayId: 'gateway.a-1',
      runtimeKind: 'docker',
      host: '::',
      httpPort: 18081,
      opcUaAdvertisedHost: 'robot-sim.local',
      opcUaAdvertisedPort: 24840,
      opcUaPort: 14840,
    })
  })

  it.each(['', ' ', 'NATIVE', 'podman'])('rejects invalid runtime kind %j', (value) => {
    expect(() => readDeploymentConfig({ ROBOTSIM_RUNTIME_KIND: value }))
      .toThrow(RuntimeGatewayDeploymentConfigError)
  })

  it.each([
    '',
    ' ',
    '0',
    '+1',
    '-1',
    '1.5',
    '1e3',
    'NaN',
    'Infinity',
    '01',
    '65536',
    '123456',
  ])('rejects invalid HTTP port syntax or range %j', (value) => {
    expect(() => readDeploymentConfig({
      ROBOTSIM_GATEWAY_HTTP_PORT: value,
    })).toThrow(RuntimeGatewayDeploymentConfigError)
  })

  it.each([
    '',
    ' ',
    '0',
    '+1',
    '-1',
    '1.5',
    '1e3',
    'NaN',
    'Infinity',
    '01',
    '65536',
    '123456',
  ])('rejects invalid OPC UA port syntax or range %j', (value) => {
    expect(() => readDeploymentConfig({
      ROBOTSIM_OPCUA_PORT: value,
    })).toThrow(RuntimeGatewayDeploymentConfigError)
  })

  it.each([
    '',
    ' ',
    '0',
    '+1',
    '-1',
    '1.5',
    '1e3',
    'NaN',
    'Infinity',
    '01',
    '65536',
    '123456',
  ])('rejects invalid OPC UA advertised port syntax or range %j', (value) => {
    expect(() => readDeploymentConfig({
      ROBOTSIM_OPCUA_ADVERTISE_PORT: value,
    })).toThrow(RuntimeGatewayDeploymentConfigError)
  })

  it.each([
    '',
    ' ',
    '-gateway',
    'gateway id',
    'gateway/id',
    `g${'a'.repeat(128)}`,
  ])('rejects invalid Gateway ID %j', (value) => {
    expect(() => readDeploymentConfig({
      ROBOTSIM_GATEWAY_ID: value,
    })).toThrow(RuntimeGatewayDeploymentConfigError)
  })

  it.each([
    '',
    ' ',
    'host name',
    'host\tname',
    'host/name',
    'host\\name',
    'host?name',
    'host#name',
    'example.com:14840',
    'h'.repeat(256),
  ])('rejects invalid host %j', (value) => {
    expect(() => readDeploymentConfig({
      ROBOTSIM_GATEWAY_HOST: value,
    })).toThrow(RuntimeGatewayDeploymentConfigError)
  })

  it.each([
    '',
    ' ',
    'host name',
    'host/name',
    'host\\name',
    'host?name',
    'host#name',
    'h'.repeat(256),
  ])('rejects invalid OPC UA advertised host %j', (value) => {
    expect(() => readDeploymentConfig({
      ROBOTSIM_OPCUA_ADVERTISE_HOST: value,
    })).toThrow(RuntimeGatewayDeploymentConfigError)
  })

  it('uses defaults only for undefined recognized values', () => {
    expect(readDeploymentConfig({
      ROBOTSIM_GATEWAY_ID: undefined,
      ROBOTSIM_RUNTIME_KIND: undefined,
      ROBOTSIM_GATEWAY_HOST: undefined,
      ROBOTSIM_GATEWAY_HTTP_PORT: undefined,
      ROBOTSIM_OPCUA_ADVERTISE_HOST: undefined,
      ROBOTSIM_OPCUA_ADVERTISE_PORT: undefined,
      ROBOTSIM_OPCUA_PORT: undefined,
    })).toEqual(DEFAULT_CONFIG)

    expect(() => readDeploymentConfig({
      ROBOTSIM_GATEWAY_ID: '',
    })).toThrow(RuntimeGatewayDeploymentConfigError)
  })

  it('returns a frozen clone and does not mutate or retain its environment', () => {
    const environment: Record<string, string | undefined> = {
      ROBOTSIM_GATEWAY_ID: ' gateway-before ',
      ROBOTSIM_GATEWAY_HTTP_PORT: '8082',
    }
    const originalEnvironment = { ...environment }

    const config = readDeploymentConfig(environment)

    expect(environment).toEqual(originalEnvironment)
    expect(Object.isFrozen(config)).toBe(true)
    environment.ROBOTSIM_GATEWAY_ID = 'gateway-after'
    expect(config.gatewayId).toBe('gateway-before')
    expect(() => {
      ;(config as { gatewayId: string }).gatewayId = 'mutated'
    }).toThrow(TypeError)
  })

  it('ignores unknown and mode-like environment keys', () => {
    expect(readDeploymentConfig({
      ROBOTSIM_GATEWAY_MODE: 'server',
      ROBOTSIM_PROJECT_ID: 'project-from-environment',
      UNRELATED: 'ignored',
    })).toEqual(DEFAULT_CONFIG)
  })

  it('uses a stable error code, path, and message without mutating input', () => {
    const environment = {
      ROBOTSIM_GATEWAY_HTTP_PORT: ' 0 ',
      UNRELATED_SECRET: 'must-not-appear',
    }
    const originalEnvironment = { ...environment }

    let thrown: unknown
    try {
      readDeploymentConfig(environment)
    } catch (error) {
      thrown = error
    }

    expect(environment).toEqual(originalEnvironment)
    expect(thrown).toBeInstanceOf(RuntimeGatewayDeploymentConfigError)
    expect(thrown).toMatchObject({
      code: 'RUNTIME_GATEWAY_DEPLOYMENT_CONFIG_INVALID',
      path: '$.environment.ROBOTSIM_GATEWAY_HTTP_PORT',
    })
    expect((thrown as Error).message).toMatch(
      /^RUNTIME_GATEWAY_DEPLOYMENT_CONFIG_INVALID at \$\.environment\.ROBOTSIM_GATEWAY_HTTP_PORT: /,
    )
    expect((thrown as Error).message).not.toContain('must-not-appear')
  })
})
