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
  readonly nowMs?: () => number
  readonly continuationTtlMs?: number
  readonly maxContinuations?: number
  readonly maxContinuationsPerEndpoint?: number
}

interface ContinuationV1 {
  readonly endpointId: string
  readonly parentNodeId: string
  readonly generation: number
  readonly session: OpcUaAddressSpaceBrowseSessionV1
  readonly continuationPoint: Uint8Array
  readonly createdAtMs: number
  readonly expiresAtMs: number
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
  // This is deliberately conservative: the browse response does not expose
  // a child-count for the referenced node, so only container node classes are
  // offered as expandable. Leaf Variables never claim children.
  return nodeClass === 1 || nodeClass === 8 || nodeClass === 16 || nodeClass === 128
}

function validReference(reference: OpcUaAddressSpaceBrowseReferenceV1): boolean {
  return /^ns=(0|[1-9][0-9]*);(?:i=(?:0|[1-9][0-9]{0,9})|s=.{1,4096}|g=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|b=(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/u.test(reference.sessionNodeId)
    && reference.browseName.length > 0 && Buffer.byteLength(reference.browseName) <= 1_024
    && reference.displayName.length > 0 && Buffer.byteLength(reference.displayName) <= 1_024
    && /^ns=(0|[1-9][0-9]*);(?:i=(?:0|[1-9][0-9]{0,9})|s=.{1,4096}|g=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|b=(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/u.test(reference.referenceTypeId)
    && (reference.typeDefinitionId === null || /^ns=(0|[1-9][0-9]*);(?:i=(?:0|[1-9][0-9]{0,9})|s=.{1,4096}|g=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|b=(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/u.test(reference.typeDefinitionId))
    && NODE_CLASSES[reference.nodeClass] !== undefined
}

export function createOpcUaAddressSpaceBrowserV1(options: OpcUaAddressSpaceBrowserOptionsV1): OpcUaAddressSpaceBrowserV1 {
  const continuations = new Map<string, ContinuationV1>()
  const createToken = options.createToken ?? (() => globalThis.crypto.randomUUID())
  const nowMs = options.nowMs ?? Date.now
  const continuationTtlMs = options.continuationTtlMs ?? 30_000
  const maxContinuations = options.maxContinuations ?? 32
  const maxContinuationsPerEndpoint = options.maxContinuationsPerEndpoint ?? 8
  if (!Number.isSafeInteger(continuationTtlMs) || continuationTtlMs < 1 || continuationTtlMs > 300_000 || !Number.isSafeInteger(maxContinuations) || maxContinuations < 1 || maxContinuations > 128 || !Number.isSafeInteger(maxContinuationsPerEndpoint) || maxContinuationsPerEndpoint < 1 || maxContinuationsPerEndpoint > maxContinuations) throw new Error('OPC_UA_BROWSE_CONFIGURATION_INVALID')

  const abandon = async (token: string, state: ContinuationV1): Promise<void> => {
    continuations.delete(token)
    try { await state.session.browseNext([state.continuationPoint], true) } catch { }
  }
  const sweep = async (): Promise<void> => {
    const now = nowMs()
    for (const [token, state] of continuations) {
      if (state.expiresAtMs <= now) await abandon(token, state)
    }
  }
  const makeRoom = async (endpointId: string): Promise<void> => {
    while (continuations.size >= maxContinuations || [...continuations.values()].filter((state) => state.endpointId === endpointId).length >= maxContinuationsPerEndpoint) {
      const candidate = [...continuations.entries()]
        .filter(([, state]) => continuations.size >= maxContinuations || state.endpointId === endpointId)
        .sort(([, left], [, right]) => left.createdAtMs - right.createdAtMs)[0]
      if (candidate === undefined) return
      await abandon(candidate[0], candidate[1])
    }
  }

  const release = async (continuationToken: string): Promise<void> => {
    await sweep()
    const state = continuations.get(continuationToken)
    if (state === undefined) throw new Error('OPC_UA_BROWSE_CONTINUATION_INVALID')
    continuations.delete(continuationToken)
    await state.session.browseNext([state.continuationPoint], true)
  }

  return Object.freeze({
    release,
    async browse(request: OpcUaAddressSpaceBrowseInputV1): Promise<OpcUaAddressSpaceBrowseOutputV1> {
      await sweep()
      if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > MAX_OPC_UA_BROWSE_PAGE_SIZE_V1) throw new Error('OPC_UA_BROWSE_REQUEST_INVALID')
      const parentNodeId = request.parentNodeId ?? OPC_UA_OBJECTS_FOLDER_NODE_ID_V1
      const continuation = request.continuationToken === null ? undefined : continuations.get(request.continuationToken)
      if (request.continuationToken !== null && continuation === undefined) throw new Error('OPC_UA_BROWSE_CONTINUATION_INVALID')
      if (continuation !== undefined && (continuation.endpointId !== request.endpointId || continuation.parentNodeId !== parentNodeId)) throw new Error('OPC_UA_BROWSE_CONTINUATION_INVALID')
      const first = options.currentSession(request.endpointId)
      if (first === null) throw new Error('OPC_UA_BROWSE_SESSION_UNAVAILABLE')
      if (continuation !== undefined && (continuation.generation !== first.generation || continuation.session !== first.session)) {
        await abandon(request.continuationToken!, continuation)
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
        if (result.continuationPoint !== null) await first.session.browseNext([result.continuationPoint], true).catch(() => undefined)
        throw new Error('OPC_UA_BROWSE_SESSION_STALE')
      }
      if (continuation !== undefined) continuations.delete(request.continuationToken!)
      if (result.references.length > request.limit || result.references.some((reference) => !validReference(reference))) {
        if (result.continuationPoint !== null) await first.session.browseNext([result.continuationPoint], true).catch(() => undefined)
        throw new Error('OPC_UA_BROWSE_RESPONSE_INVALID')
      }
      let continuationToken: string | null = null
      if (result.continuationPoint !== null) {
        continuationToken = createToken()
        if (!/^[A-Za-z0-9_-]{1,256}$/u.test(continuationToken) || continuations.has(continuationToken)) {
          await first.session.browseNext([result.continuationPoint], true).catch(() => undefined)
          throw new Error('OPC_UA_BROWSE_TOKEN_INVALID')
        }
        await makeRoom(request.endpointId)
        const createdAtMs = nowMs()
        continuations.set(continuationToken, Object.freeze({ endpointId: request.endpointId, parentNodeId, generation: first.generation, session: first.session, continuationPoint: result.continuationPoint, createdAtMs, expiresAtMs: createdAtMs + continuationTtlMs }))
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
      const output = Object.freeze({ endpointId: request.endpointId, parentNodeId, nodes: Object.freeze(nodes), continuationToken })
      if (Buffer.byteLength(JSON.stringify(output)) > 64 * 1024) {
        if (continuationToken !== null) {
          const state = continuations.get(continuationToken)
          if (state !== undefined) await abandon(continuationToken, state)
        }
        throw new Error('OPC_UA_BROWSE_RESPONSE_INVALID')
      }
      return output
    },
  })
}
