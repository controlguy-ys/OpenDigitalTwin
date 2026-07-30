import { describe, expect, it } from 'vitest'
import { validateOpcUaAddressSpaceBrowseRequestV1, validateOpcUaAddressSpaceBrowseResponseV1, validateOpcUaNamespaceIndexResponseV1, validateOpcUaTestConnectionResultV1 } from './opcua-connectivity-v1.js'

describe('OPC UA connectivity V1 validators', () => {
  it('rejects duplicate, oversized, aggregate-oversized, and unknown namespace results', () => {
    const result = { type: 'opcua-test-connection-result-v1', protocolVersion: 1, outcome: 'succeeded', namespaces: ['urn:a'] }
    expect(() => validateOpcUaTestConnectionResultV1({ ...result, namespaces: ['urn:a', 'urn:a'] })).toThrow()
    expect(() => validateOpcUaTestConnectionResultV1({ ...result, namespaces: ['x'.repeat(4097)] })).toThrow()
    expect(() => validateOpcUaTestConnectionResultV1({ ...result, namespaces: Array.from({ length: 13 }, () => 'x'.repeat(4096)) })).toThrow()
    expect(() => validateOpcUaTestConnectionResultV1({ ...result, extra: true })).toThrow()
  })
  it('rejects unbounded failures and non-integer namespace indexes', () => {
    expect(() => validateOpcUaTestConnectionResultV1({ type: 'opcua-test-connection-result-v1', protocolVersion: 1, outcome: 'failed', code: '', message: 'x' })).toThrow()
    expect(() => validateOpcUaNamespaceIndexResponseV1({ type: 'opcua-namespace-index-response-v1', protocolVersion: 1, endpointId: 'a', namespaceUri: 'urn:a', namespaceIndex: 1.5 })).toThrow()
  })
  it.each(['ns=0;i=01', 'ns=0;i=4294967296', 'ns=0;s=', 'ns=0;g=12345678-1234-1234-1234-123456789ABC', 'ns=0;b=AQI', 'ns=65536;i=1'])('rejects noncanonical browse parent NodeIds before a route can call OPC UA: %s', (parentNodeId) => {
    expect(() => validateOpcUaAddressSpaceBrowseRequestV1({ type: 'opcua-address-space-browse-request-v1', protocolVersion: 1, endpointId: 'plc', parentNodeId, limit: 1, continuationToken: null })).toThrow()
  })
  it('rejects malformed browse response nodes and oversized response text', () => {
    const response = { type: 'opcua-address-space-browse-response-v1', protocolVersion: 1, endpointId: 'plc', parentNodeId: 'ns=0;i=85', continuationToken: null, nodes: [{ sessionNodeId: 'ns=1;s=Leaf', browseName: 'Leaf', displayName: 'Leaf', nodeClass: 'Variable', referenceTypeId: 'ns=0;i=47', typeDefinitionId: null, hasChildren: false, nodeAddress: { namespaceUri: 'urn:plant', identifierType: 'string', identifier: 'Leaf' } }] }
    expect(validateOpcUaAddressSpaceBrowseResponseV1(response)).toMatchObject({ endpointId: 'plc' })
    expect(() => validateOpcUaAddressSpaceBrowseResponseV1({ ...response, nodes: [{ ...response.nodes[0], sessionNodeId: 'ns=0;i=01' }] })).toThrow()
    expect(() => validateOpcUaAddressSpaceBrowseResponseV1({ ...response, nodes: [{ ...response.nodes[0], browseName: 'x'.repeat(1025) }] })).toThrow()
  })
})
