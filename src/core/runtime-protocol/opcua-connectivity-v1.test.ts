import { describe, expect, it } from 'vitest'
import { validateOpcUaNamespaceIndexResponseV1, validateOpcUaTestConnectionResultV1 } from './opcua-connectivity-v1.js'

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
})
