import { describe, expect, it, vi } from 'vitest'

import { createOpcUaNodeAddressResolverV1 } from './opcua-node-address-resolver.js'

function harness() {
  const session = {
    readNamespaceArray: vi.fn(async () => [
      'http://opcfoundation.org/UA/',
      'urn:virtual-plc',
      'https://example.com/model',
    ]),
  }
  let generation = 1
  let connected = true
  const resolver = createOpcUaNodeAddressResolverV1({
    currentSession: (endpointId) => connected
      ? { endpointId, generation, session }
      : null,
  })
  return {
    resolver,
    session,
    disconnect: () => { connected = false },
    replaceGeneration: () => { generation += 1 },
  }
}

describe('createOpcUaNodeAddressResolverV1', () => {
  it.each([
    ['ns=1;s=ObjectPos', { namespaceUri: 'urn:virtual-plc', identifierType: 'string', identifier: 'ObjectPos' }],
    ['ns=1;s= ObjectPos ', { namespaceUri: 'urn:virtual-plc', identifierType: 'string', identifier: ' ObjectPos ' }],
    ['ns=1;i=42', { namespaceUri: 'urn:virtual-plc', identifierType: 'numeric', identifier: '42' }],
    ['ns=2;g=12345678-1234-1234-1234-123456789abc', { namespaceUri: 'https://example.com/model', identifierType: 'guid', identifier: '12345678-1234-1234-1234-123456789abc' }],
    ['ns=1;b=AQID', { namespaceUri: 'urn:virtual-plc', identifierType: 'byteString', identifier: 'AQID' }],
  ] as const)('resolves the current Session index without persisting ns= for %s', async (sessionNodeId, expected) => {
    const { resolver } = harness()
    const address = await resolver.resolve('plc-a', sessionNodeId)

    expect(address).toEqual(expected)
    expect(JSON.stringify(address)).not.toContain('ns=')
  })

  it('rejects a Namespace Index paste while no Browse Session exists', async () => {
    const { resolver, disconnect } = harness()
    disconnect()

    await expect(resolver.resolve('plc-a', 'ns=1;s=ObjectPos'))
      .rejects.toThrow('OPC_UA_BROWSE_SESSION_UNAVAILABLE')
  })

  it('rejects a result when the Session changes during NamespaceArray read', async () => {
    const subject = harness()
    subject.session.readNamespaceArray.mockImplementationOnce(async () => {
      subject.replaceGeneration()
      return ['http://opcfoundation.org/UA/', 'urn:virtual-plc']
    })

    await expect(subject.resolver.resolve('plc-a', 'ns=1;s=ObjectPos'))
      .rejects.toThrow('OPC_UA_NAMESPACE_SESSION_STALE')
  })

  it('rejects invalid and out-of-range Session NodeIds', async () => {
    const { resolver } = harness()

    await expect(resolver.resolve('plc-a', 's=ObjectPos')).rejects.toThrow('OPC_UA_SESSION_NODE_ID_INVALID')
    await expect(resolver.resolve('plc-a', 'ns=9;s=ObjectPos')).rejects.toThrow('OPC_UA_NAMESPACE_INDEX_OUT_OF_RANGE')
  })

  it('rejects a duplicate Namespace URI instead of persisting an ambiguous index', async () => {
    const session = {
      readNamespaceArray: vi.fn(async () => [
        'http://opcfoundation.org/UA/',
        'urn:duplicate',
        'urn:duplicate',
      ]),
    }
    const resolver = createOpcUaNodeAddressResolverV1({
      currentSession: () => ({ endpointId: 'plc-a', generation: 1, session }),
    })

    await expect(resolver.resolve('plc-a', 'ns=2;s=ObjectPos'))
      .rejects.toThrow('OPC_UA_NAMESPACE_ARRAY_INVALID')
  })
})
