import {
  coerceNodeId,
  NodeIdType,
  type ClientSession,
} from 'node-opcua'

import {
  validateOpcUaNodeAddressV1,
  type OpcUaNodeAddressV1,
} from '../../src/core/project-v5/index.js'

export interface OpcUaBrowseSessionProofV1 {
  readonly endpointId: string
  readonly generation: number
  readonly session: Pick<ClientSession, 'readNamespaceArray'>
}

export interface OpcUaNodeAddressSessionPortV1 {
  currentSession(endpointId: string): OpcUaBrowseSessionProofV1 | null
}

export interface OpcUaNodeAddressResolverV1 {
  resolve(endpointId: string, sessionNodeId: string): Promise<OpcUaNodeAddressV1>
}

function fail(code: string): never {
  throw new Error(code)
}

function boundedText(value: string, code: string, maximumBytes: number): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > maximumBytes) {
    return fail(code)
  }
  return value
}

function parsedAddress(sessionNodeId: string): {
  readonly namespaceIndex: number
  readonly identifierType: OpcUaNodeAddressV1['identifierType']
  readonly identifier: string
} {
  boundedText(sessionNodeId, 'OPC_UA_SESSION_NODE_ID_INVALID', 8 * 1024)
  if (!/^ns=(?:0|[1-9][0-9]*);[isgb]=.+$/u.test(sessionNodeId)) {
    return fail('OPC_UA_SESSION_NODE_ID_INVALID')
  }
  let nodeId
  try {
    nodeId = coerceNodeId(sessionNodeId)
  } catch {
    return fail('OPC_UA_SESSION_NODE_ID_INVALID')
  }
  if (!Number.isSafeInteger(nodeId.namespace) || nodeId.namespace < 0 || nodeId.namespace > 65_535) {
    return fail('OPC_UA_SESSION_NODE_ID_INVALID')
  }
  if (nodeId.identifierType === NodeIdType.NUMERIC) {
    return Object.freeze({ namespaceIndex: nodeId.namespace, identifierType: 'numeric', identifier: String(nodeId.value) })
  }
  if (nodeId.identifierType === NodeIdType.STRING) {
    return Object.freeze({ namespaceIndex: nodeId.namespace, identifierType: 'string', identifier: String(nodeId.value) })
  }
  if (nodeId.identifierType === NodeIdType.GUID) {
    return Object.freeze({ namespaceIndex: nodeId.namespace, identifierType: 'guid', identifier: String(nodeId.value).toLowerCase() })
  }
  if (nodeId.identifierType === NodeIdType.BYTESTRING && Buffer.isBuffer(nodeId.value)) {
    return Object.freeze({ namespaceIndex: nodeId.namespace, identifierType: 'byteString', identifier: nodeId.value.toString('base64') })
  }
  return fail('OPC_UA_SESSION_NODE_ID_INVALID')
}

export function createOpcUaNodeAddressResolverV1(
  sessions: OpcUaNodeAddressSessionPortV1,
): OpcUaNodeAddressResolverV1 {
  return Object.freeze({
    async resolve(endpointId: string, sessionNodeId: string): Promise<OpcUaNodeAddressV1> {
      boundedText(endpointId, 'OPC_UA_ENDPOINT_ID_INVALID', 1_024)
      const parsed = parsedAddress(sessionNodeId)
      const first = sessions.currentSession(endpointId)
      if (first === null) return fail('OPC_UA_BROWSE_SESSION_UNAVAILABLE')
      let namespaceArray: readonly string[]
      try {
        namespaceArray = await first.session.readNamespaceArray()
      } catch {
        return fail('OPC_UA_NAMESPACE_READ_FAILED')
      }
      const current = sessions.currentSession(endpointId)
      if (
        current === null
        || current.endpointId !== first.endpointId
        || current.generation !== first.generation
        || current.session !== first.session
      ) {
        return fail('OPC_UA_NAMESPACE_SESSION_STALE')
      }
      if (!Array.isArray(namespaceArray) || namespaceArray.length > 256) {
        return fail('OPC_UA_NAMESPACE_ARRAY_INVALID')
      }
      const unique = new Set<string>()
      let totalBytes = 0
      for (const value of namespaceArray) {
        if (
          typeof value !== 'string'
          || value.length === 0
          || Buffer.byteLength(value) > 4_096
          || unique.has(value)
        ) {
          return fail('OPC_UA_NAMESPACE_ARRAY_INVALID')
        }
        unique.add(value)
        totalBytes += Buffer.byteLength(value)
        if (totalBytes > 48 * 1024) return fail('OPC_UA_NAMESPACE_ARRAY_INVALID')
      }
      const namespaceUri = namespaceArray[parsed.namespaceIndex]
      if (namespaceUri === undefined) {
        return fail('OPC_UA_NAMESPACE_INDEX_OUT_OF_RANGE')
      }
      try {
        return validateOpcUaNodeAddressV1({
          namespaceUri,
          identifierType: parsed.identifierType,
          identifier: parsed.identifier,
        }, '$.nodeAddress')
      } catch {
        return fail('OPC_UA_SESSION_NODE_ID_INVALID')
      }
    },
  })
}
