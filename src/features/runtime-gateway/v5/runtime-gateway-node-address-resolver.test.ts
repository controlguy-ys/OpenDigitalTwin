import { describe, expect, it, vi } from 'vitest'

import {
  createRuntimeGatewayNodeAddressResolverV1,
  RuntimeGatewayNodeAddressResolverV1Error,
} from './runtime-gateway-node-address-resolver.js'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('createRuntimeGatewayNodeAddressResolverV1', () => {
  it('uses the closed same-origin route and validates the stable address', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      nodeAddress: {
        namespaceUri: 'urn:virtual-plc',
        identifierType: 'string',
        identifier: 'ObjectPos',
      },
    }))
    const resolver = createRuntimeGatewayNodeAddressResolverV1({ fetch: fetcher })

    await expect(resolver.resolve('plc-a', 'ns=2;s=ObjectPos')).resolves.toEqual({
      namespaceUri: 'urn:virtual-plc',
      identifierType: 'string',
      identifier: 'ObjectPos',
    })
    expect(fetcher).toHaveBeenCalledWith('/runtime/opcua/resolve-node-address', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ endpointId: 'plc-a', sessionNodeId: 'ns=2;s=ObjectPos' }),
      redirect: 'error',
    }))
  })

  it('preserves a stable Gateway error code', async () => {
    const resolver = createRuntimeGatewayNodeAddressResolverV1({
      fetch: async () => jsonResponse({
        code: 'OPC_UA_BROWSE_SESSION_UNAVAILABLE',
        message: 'Endpoint has no live Browse Session.',
      }, 409),
    })

    await expect(resolver.resolve('plc-a', 'ns=2;s=ObjectPos')).rejects.toMatchObject({
      code: 'OPC_UA_BROWSE_SESSION_UNAVAILABLE',
      statusCode: 409,
    } satisfies Partial<RuntimeGatewayNodeAddressResolverV1Error>)
  })

  it('rejects an oversized response before parsing it', async () => {
    const resolver = createRuntimeGatewayNodeAddressResolverV1({
      fetch: async () => new Response('{}', {
        status: 200,
        headers: { 'content-length': String(64 * 1024 + 1) },
      }),
    })

    await expect(resolver.resolve('plc-a', 'ns=2;s=ObjectPos')).rejects.toMatchObject({
      code: 'RUNTIME_GATEWAY_RESPONSE_TOO_LARGE',
    })
  })
})
