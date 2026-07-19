import { failProjectV5 } from './errors.js'

export interface OpcUaNodeAddressV1 {
  readonly namespaceUri: string
  readonly identifierType: 'string' | 'numeric' | 'guid' | 'byteString'
  readonly identifier: string
}

const IDENTIFIER_TYPES = new Set<OpcUaNodeAddressV1['identifierType']>([
  'string',
  'numeric',
  'guid',
  'byteString',
])
const CANONICAL_UNSIGNED_INT32 = /^(?:0|[1-9][0-9]{0,9})$/
const CANONICAL_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function failInvalid(path: string, message: string, code: string): never {
  return failProjectV5(code, path, message)
}

function validateNamespaceUri(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || !/^(?:urn|http|https):/.test(value)) {
    return failInvalid(path, 'Namespace URI must be an absolute urn:, http:, or https: URI.', 'OPCUA_NAMESPACE_URI_INVALID')
  }

  try {
    const uri = new URL(value)
    if (
      (uri.protocol === 'http:' || uri.protocol === 'https:') && uri.hostname.length === 0
      || (uri.protocol === 'urn:' && uri.pathname.length === 0)
    ) {
      return failInvalid(path, 'Namespace URI must be an absolute urn:, http:, or https: URI.', 'OPCUA_NAMESPACE_URI_INVALID')
    }
  } catch {
    return failInvalid(path, 'Namespace URI must be an absolute urn:, http:, or https: URI.', 'OPCUA_NAMESPACE_URI_INVALID')
  }

  return value
}

function validateIdentifierType(value: unknown, path: string): OpcUaNodeAddressV1['identifierType'] {
  if (typeof value !== 'string' || !IDENTIFIER_TYPES.has(value as OpcUaNodeAddressV1['identifierType'])) {
    return failInvalid(path, 'Identifier type must be string, numeric, guid, or byteString.', 'OPCUA_NODE_IDENTIFIER_TYPE_INVALID')
  }
  return value as OpcUaNodeAddressV1['identifierType']
}

function validateIdentifier(
  value: unknown,
  identifierType: OpcUaNodeAddressV1['identifierType'],
  path: string,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    return failInvalid(path, 'Node identifier must be a non-empty canonical string.', 'OPCUA_NODE_IDENTIFIER_INVALID')
  }

  if (identifierType === 'numeric') {
    if (!CANONICAL_UNSIGNED_INT32.test(value) || Number(value) > 4_294_967_295) {
      return failInvalid(path, 'Numeric identifier must be a canonical unsigned 32-bit decimal.', 'OPCUA_NODE_IDENTIFIER_INVALID')
    }
  } else if (identifierType === 'guid' && !CANONICAL_GUID.test(value)) {
    return failInvalid(path, 'GUID identifier must use lowercase canonical UUID form.', 'OPCUA_NODE_IDENTIFIER_INVALID')
  } else if (identifierType === 'byteString' && !CANONICAL_BASE64.test(value)) {
    return failInvalid(path, 'ByteString identifier must use canonical padded Base64.', 'OPCUA_NODE_IDENTIFIER_INVALID')
  }

  return value
}

export function validateOpcUaNodeAddressV1(value: unknown, path: string): OpcUaNodeAddressV1 {
  if (!isRecord(value)) {
    return failInvalid(path, 'Node address must be an object.', 'OPCUA_NODE_ADDRESS_INVALID')
  }
  const keys = Object.keys(value).sort()
  if (keys.length !== 3 || keys.join(',') !== 'identifier,identifierType,namespaceUri') {
    return failInvalid(path, 'Node address must contain only namespaceUri, identifierType, and identifier.', 'OPCUA_NODE_ADDRESS_INVALID')
  }

  const namespaceUri = validateNamespaceUri(value.namespaceUri, `${path}.namespaceUri`)
  const identifierType = validateIdentifierType(value.identifierType, `${path}.identifierType`)
  const identifier = validateIdentifier(value.identifier, identifierType, `${path}.identifier`)
  return { namespaceUri, identifierType, identifier }
}

export function opcUaNodeAddressKeyV1(address: OpcUaNodeAddressV1): string {
  const value = validateOpcUaNodeAddressV1(address, '$.nodeAddress')
  return JSON.stringify([value.namespaceUri, value.identifierType, value.identifier])
}
