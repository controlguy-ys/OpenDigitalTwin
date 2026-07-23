import { describe, expect, it, vi } from 'vitest'

import type { OpcUaEndpointV5 } from '../../../core/project-v5/index.js'
import type { RuntimeGatewayConnectivityClientV1 } from './runtime-gateway-connectivity-client.js'
import {
  createRuntimeGatewayConnectionTestPortV1,
  type OpcUaConnectionTestPortV1,
} from './runtime-gateway-connection-test.js'

const endpoint: OpcUaEndpointV5 = {
  endpointId: 'controller',
  name: 'Controller',
  endpointUrl: 'opc.tcp://controller:4840',
  enabled: true,
  publishingIntervalMs: 100,
  reconnectDelayMs: 1_000,
}

function client(result: Awaited<ReturnType<RuntimeGatewayConnectivityClientV1['testConnection']>>) {
  return {
    testConnection: vi.fn(async () => result),
  } as Pick<RuntimeGatewayConnectivityClientV1, 'testConnection'>
}

describe('Runtime Gateway connection-test port V1', () => {
  it('translates the existing canonical success result and measures stable elapsed time', async () => {
    const gateway = client({
      type: 'opcua-test-connection-result-v1', protocolVersion: 1, outcome: 'succeeded', namespaces: ['urn:controller'],
    })
    const nowMs = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(135)
    const subject: OpcUaConnectionTestPortV1 = createRuntimeGatewayConnectionTestPortV1({ gateway, nowMs })

    await expect(subject.testEndpoint(endpoint)).resolves.toEqual({
      phase: 'connected', namespaceUris: ['urn:controller'], elapsedMs: 35, error: null,
    })
    expect(gateway.testConnection).toHaveBeenCalledWith(endpoint, undefined)
  })

  it('preserves canonical diagnostic failure code and message without mutating the endpoint', async () => {
    const gateway = client({
      type: 'opcua-test-connection-result-v1', protocolVersion: 1, outcome: 'failed',
      code: 'OPC_UA_CONNECT_FAILED', message: 'Connection refused',
    })
    const subject = createRuntimeGatewayConnectionTestPortV1({ gateway, nowMs: () => 7 })
    const signal = new AbortController().signal

    await expect(subject.testEndpoint(endpoint, signal)).resolves.toEqual({
      phase: 'failed', namespaceUris: [], elapsedMs: 0,
      error: 'OPC_UA_CONNECT_FAILED: Connection refused',
    })
    expect(gateway.testConnection).toHaveBeenCalledWith(endpoint, signal)
    expect(endpoint.endpointUrl).toBe('opc.tcp://controller:4840')
  })
})
