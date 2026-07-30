import { validateOpcUaNodeAddressV1, type OpcUaNodeAddressV1 } from '../../src/core/project-v5/index.js'

export const OPC_UA_OBJECTS_FOLDER_NODE_ID_V1 = 'ns=0;i=85'
export const MAX_OPC_UA_BROWSE_PAGE_SIZE_V1 = 100

export interface OpcUaAddressSpaceBrowseReferenceV1 {
  readonly sessionNodeId: string
  readonly browseName: string
  readonly displayName: string
  readonly nodeClass: number
  readonly referenceTypeId: string
  readonly typeDefinitionId: string | null
}

export interface OpcUaAddressSpaceBrowseResultV1 {
  readonly good: boolean
  readonly references: readonly OpcUaAddressSpaceBrowseReferenceV1[]
  readonly continuationPoint: Uint8Array | null
}

export interface OpcUaAddressSpaceBrowseSessionV1 {
  browse(request: Readonly<{ readonly nodeId: string; readonly requestedMaxReferencesPerNode: number }>): Promise<OpcUaAddressSpaceBrowseResultV1>
  browseNext(continuationPoints: readonly Uint8Array[], releaseContinuationPoints: boolean): Promise<OpcUaAddressSpaceBrowseResultV1>
  readNamespaceArray(): Promise<readonly string[]>
}

export interface OpcUaAddressSpaceBrowseSessionProofV1 {
  readonly endpointId: string
  readonly generation: number
  readonly session: OpcUaAddressSpaceBrowseSessionV1
}

export interface OpcUaAddressSpaceBrowserV1 {
  browse(request: OpcUaAddressSpaceBrowseInputV1): Promise<OpcUaAddressSpaceBrowseOutputV1>
  release(continuationToken: string): Promise<void>
}

export interface OpcUaAddressSpaceBrowseInputV1 {
  readonly endpointId: string
  readonly parentNodeId: string | null
  readonly limit: number
  readonly continuationToken: string | null
}

export interface OpcUaAddressSpaceBrowseNodeV1 {
  readonly sessionNodeId: string
  readonly browseName: string
  readonly displayName: string
  readonly nodeClass: string
  readonly referenceTypeId: string
  readonly typeDefinitionId: string | null
  readonly hasChildren: boolean
  readonly nodeAddress: OpcUaNodeAddressV1 | null
}

export interface OpcUaAddressSpaceBrowseOutputV1 {
  readonly endpointId: string
  readonly parentNodeId: string
  readonly nodes: readonly OpcUaAddressSpaceBrowseNodeV1[]
  readonly continuationToken: string | null
}

export interface OpcUaAddressSpaceBrowserOptionsV1 {
  readonly currentSession: (endpointId: string) => OpcUaAddressSpaceBrowseSessionProofV1 | null
  readonly createToken?: () => string
}

interface ContinuationV1 {
  readonly endpointId: string
  readonly parentNodeId: string
  readonly generation: number
  readonly session: OpcUaAddressSpaceBrowseSessionV1
  readonly continuationPoint: Uint8Array
}

const NODE_CLASSES: Readonly<Record<number, string>> = Object.freeze({
  1: 'Object', 2: 'Variable', 4: 'Method', 8: 'ObjectType', 16: 'VariableType',
  32: 'ReferenceType', 64: 'DataType', 128: 'View',
})

function sameSession(
  left: OpcUaAddressSpaceBrowseSessionProofV1 | null,
  right: OpcUaAddressSpaceBrowseSessionProofV1,
): boolean {
  return left !== null && left.endpointId === right.endpointId && left.generation === right.generation && left.session === right.session
}

function parseNodeId(sessionNodeId: string, namespaceArray: readonly string[]): OpcUaNodeAddressV1 | null {
  const match = /^ns=(0|[1-9][0-9]*);([isgb])=(.+)$/u.exec(sessionNodeId)
  if (match === null) return null
  const namespaceIndex = Number(match[1])
  const namespaceUri = namespaceArray[namespaceIndex]
  if (namespaceUri === undefined || namespaceUri.length === 0) return null
  const identifierType = match[2] === 'i' ? 'numeric' : match[2] === 's' ? 'string' : match[2] === 'g' ? 'guid' : 'byteString'
  try {
    return validateOpcUaNodeAddressV1({ namespaceUri, identifierType, identifier: match[3] }, '$.nodeAddress')
  } catch {
    return null
  }
}

function nodeHasChildren(nodeClass: number): boolean {
  return nodeClass !== 4
}

function releaseSilently(state: ContinuationV1): void {
  void state.session.browseNext([state.continuationPoint], true).catch(() => undefined)
}

export function createOpcUaAddressSpaceBrowserV1(options: OpcUaAddressSpaceBrowserOptionsV1): OpcUaAddressSpaceBrowserV1 {
  const continuations = new Map<string, ContinuationV1>()
  const createToken = options.createToken ?? (() => globalThis.crypto.randomUUID())

  const release = async (continuationToken: string): Promise<void> => {
    const state = continuations.get(continuationToken)
    if (state === undefined) throw new Error('OPC_UA_BROWSE_CONTINUATION_INVALID')
    continuations.delete(continuationToken)
    await state.session.browseNext([state.continuationPoint], true)
  }

  return Object.freeze({
    release,
    async browse(request: OpcUaAddressSpaceBrowseInputV1): Promise<OpcUaAddressSpaceBrowseOutputV1> {
      if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > MAX_OPC_UA_BROWSE_PAGE_SIZE_V1) throw new Error('OPC_UA_BROWSE_REQUEST_INVALID')
      const parentNodeId = request.parentNodeId ?? OPC_UA_OBJECTS_FOLDER_NODE_ID_V1
      const continuation = request.continuationToken === null ? undefined : continuations.get(request.continuationToken)
      if (request.continuationToken !== null && continuation === undefined) throw new Error('OPC_UA_BROWSE_CONTINUATION_INVALID')
      if (continuation !== undefined && (continuation.endpointId !== request.endpointId || continuation.parentNodeId !== parentNodeId)) throw new Error('OPC_UA_BROWSE_CONTINUATION_INVALID')
      const first = options.currentSession(request.endpointId)
      if (first === null) throw new Error('OPC_UA_BROWSE_SESSION_UNAVAILABLE')
      if (continuation !== undefined && (continuation.generation !== first.generation || continuation.session !== first.session)) {
        continuations.delete(request.continuationToken!)
        releaseSilently(continuation)
        throw new Error('OPC_UA_BROWSE_SESSION_STALE')
      }
      let namespaceArray: readonly string[]
      try { namespaceArray = await first.session.readNamespaceArray() } catch { throw new Error('OPC_UA_NAMESPACE_READ_FAILED') }
      if (!sameSession(options.currentSession(request.endpointId), first)) throw new Error('OPC_UA_BROWSE_SESSION_STALE')
      let result: OpcUaAddressSpaceBrowseResultV1
      try {
        result = continuation === undefined
          ? await first.session.browse({ nodeId: parentNodeId, requestedMaxReferencesPerNode: request.limit })
          : await first.session.browseNext([continuation.continuationPoint], false)
      } catch { throw new Error('OPC_UA_BROWSE_FAILED') }
      if (!result.good) throw new Error('OPC_UA_BROWSE_FAILED')
      if (!sameSession(options.currentSession(request.endpointId), first)) {
        if (result.continuationPoint !== null) releaseSilently({ endpointId: request.endpointId, parentNodeId, generation: first.generation, session: first.session, continuationPoint: result.continuationPoint })
        throw new Error('OPC_UA_BROWSE_SESSION_STALE')
      }
      if (continuation !== undefined) continuations.delete(request.continuationToken!)
      let continuationToken: string | null = null
      if (result.continuationPoint !== null) {
        continuationToken = createToken()
        if (continuationToken.length === 0 || continuations.has(continuationToken)) throw new Error('OPC_UA_BROWSE_TOKEN_INVALID')
        continuations.set(continuationToken, Object.freeze({ endpointId: request.endpointId, parentNodeId, generation: first.generation, session: first.session, continuationPoint: result.continuationPoint }))
      }
      const nodes = result.references.map((reference) => Object.freeze({
        sessionNodeId: reference.sessionNodeId,
        browseName: reference.browseName,
        displayName: reference.displayName,
        nodeClass: NODE_CLASSES[reference.nodeClass] ?? 'Unspecified',
        referenceTypeId: reference.referenceTypeId,
        typeDefinitionId: reference.typeDefinitionId,
        hasChildren: nodeHasChildren(reference.nodeClass),
        nodeAddress: parseNodeId(reference.sessionNodeId, namespaceArray),
      }))
      return Object.freeze({ endpointId: request.endpointId, parentNodeId, nodes: Object.freeze(nodes), continuationToken })
    },
  })
}
