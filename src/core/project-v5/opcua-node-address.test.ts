import { describe, expect, it } from 'vitest'

import {
  MAX_JOB_TIMER_MS_V5,
  MAX_LOGICAL_SIGNALS_V5,
  MAX_LOGICAL_SIGNAL_STRING_UTF8_BYTES_V5,
  MAX_OPC_UA_ENDPOINTS_V5,
  MAX_ROBOT_CONTROLLERS_V5,
  PROJECT_V5_SCHEMA_VERSION,
} from './limits'
import {
  opcUaNodeAddressKeyV1,
  validateOpcUaNodeAddressV1,
} from './opcua-node-address'

describe('OPC UA Node address V1', () => {
  it.each([
    [{ namespaceUri: 'urn:sample:plc', identifierType: 'string', identifier: 'ObjectPos.X' }],
    [{ namespaceUri: 'https://example.test/plc', identifierType: 'numeric', identifier: '42' }],
    [{ namespaceUri: 'http://example.test/plc', identifierType: 'guid', identifier: '550e8400-e29b-41d4-a716-446655440000' }],
    [{ namespaceUri: 'urn:sample:plc', identifierType: 'byteString', identifier: 'AQID' }],
  ])('accepts a stable Namespace-URI address %#', (address) => {
    expect(validateOpcUaNodeAddressV1(address, '$.nodeAddress')).toEqual(address)
  })

  it.each(['AA==', 'AAA=', 'AQID'])('accepts canonical padded Base64 %s', (identifier) => {
    const address = {
      namespaceUri: 'urn:sample:plc', identifierType: 'byteString' as const, identifier,
    }

    expect(validateOpcUaNodeAddressV1(address, '$.nodeAddress')).toEqual(address)
  })

  it.each(['ns=2', '2', ''])('rejects Namespace Index-like URI %j', (namespaceUri) => {
    expect(() => validateOpcUaNodeAddressV1({
      namespaceUri,
      identifierType: 'string',
      identifier: 'ObjectPos.X',
    }, '$.nodeAddress')).toThrowError(expect.objectContaining({
      code: 'OPCUA_NAMESPACE_URI_INVALID',
      path: '$.nodeAddress.namespaceUri',
    }))
  })

  it.each([
    ['numeric', '042', 'OPCUA_NODE_IDENTIFIER_INVALID'],
    ['numeric', '4294967296', 'OPCUA_NODE_IDENTIFIER_INVALID'],
    ['guid', '550E8400-E29B-41D4-A716-446655440000', 'OPCUA_NODE_IDENTIFIER_INVALID'],
    ['byteString', 'AQI', 'OPCUA_NODE_IDENTIFIER_INVALID'],
    ['byteString', 'AB==', 'OPCUA_NODE_IDENTIFIER_INVALID'],
    ['byteString', 'AAB=', 'OPCUA_NODE_IDENTIFIER_INVALID'],
    ['string', '', 'OPCUA_NODE_IDENTIFIER_INVALID'],
    ['opaque', 'ObjectPos.X', 'OPCUA_NODE_IDENTIFIER_TYPE_INVALID'],
  ])('rejects noncanonical %s identifiers', (identifierType, identifier, code) => {
    expect(() => validateOpcUaNodeAddressV1({
      namespaceUri: 'urn:sample:plc', identifierType, identifier,
    }, '$.nodeAddress')).toThrowError(expect.objectContaining({
      code,
      path: identifierType === 'opaque'
        ? '$.nodeAddress.identifierType'
        : '$.nodeAddress.identifier',
    }))
  })

  it('returns a deterministic collision-safe key only for validated addresses', () => {
    expect(opcUaNodeAddressKeyV1({
      namespaceUri: 'urn:sample:plc', identifierType: 'string', identifier: 'ObjectPos.X',
    })).toBe('["urn:sample:plc","string","ObjectPos.X"]')
  })

  it('exports the V5 contract limits', () => {
    expect({
      schemaVersion: PROJECT_V5_SCHEMA_VERSION,
      endpointCount: MAX_OPC_UA_ENDPOINTS_V5,
      controllerCount: MAX_ROBOT_CONTROLLERS_V5,
      signalCount: MAX_LOGICAL_SIGNALS_V5,
      stringBytes: MAX_LOGICAL_SIGNAL_STRING_UTF8_BYTES_V5,
      jobTimerMs: MAX_JOB_TIMER_MS_V5,
    }).toEqual({
      schemaVersion: 5,
      endpointCount: 8,
      controllerCount: 8,
      signalCount: 1_024,
      stringBytes: 4_096,
      jobTimerMs: 2_147_483_647,
    })
  })
})
