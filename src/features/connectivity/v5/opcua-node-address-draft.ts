import {
  validateOpcUaNodeAddressV1,
  type OpcUaNodeAddressV1,
} from '../../../core/project-v5/index.js'

export interface OpcUaNodeAddressDraftV1 {
  readonly namespaceUri: string
  readonly identifierType: OpcUaNodeAddressV1['identifierType']
  readonly identifier: string
}

export interface NamespaceIndexResolutionPortV1 {
  resolve(endpointId: string, sessionNodeId: string, signal?: AbortSignal): Promise<OpcUaNodeAddressV1>
}

export function createOpcUaNodeAddressDraftV1(
  address: OpcUaNodeAddressV1 | null = null,
): OpcUaNodeAddressDraftV1 {
  return Object.freeze(address === null
    ? { namespaceUri: '', identifierType: 'string' as const, identifier: '' }
    : structuredClone(validateOpcUaNodeAddressV1(address, '$.nodeAddress')))
}

export function validateOpcUaNodeAddressDraftV1(
  draft: OpcUaNodeAddressDraftV1,
): OpcUaNodeAddressV1 {
  return validateOpcUaNodeAddressV1({
    namespaceUri: draft.namespaceUri.trim(),
    identifierType: draft.identifierType,
    identifier: draft.identifier.trim(),
  }, '$.nodeAddress')
}

export async function resolveSessionNodeIdDraftV1(
  endpointId: string,
  sessionNodeId: string,
  resolver: NamespaceIndexResolutionPortV1,
  signal?: AbortSignal,
): Promise<OpcUaNodeAddressV1> {
  if (typeof endpointId !== 'string' || endpointId.length === 0) throw new Error('OPC_UA_ENDPOINT_ID_INVALID')
  if (typeof sessionNodeId !== 'string' || sessionNodeId.length === 0) throw new Error('OPC_UA_SESSION_NODE_ID_INVALID')
  const result = await resolver.resolve(endpointId, sessionNodeId, signal)
  return validateOpcUaNodeAddressV1(result, '$.nodeAddress')
}
