import { validateOpcUaNodeAddressV1, type OpcUaNodeAddressV1 } from '../../src/core/project-v5/index.js'
import { validateOpcUaAddressSpaceBrowseResponseV1 } from '../../src/core/runtime-protocol/opcua-connectivity-v1.js'

export const OPC_UA_OBJECTS_FOLDER_NODE_ID_V1 = 'ns=0;i=85'
export const MAX_OPC_UA_BROWSE_PAGE_SIZE_V1 = 100
const MAX_RELEASE_ATTEMPTS_V1 = 8

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
  releaseEndpoint(endpointId: string): Promise<void>
  dispose(): Promise<void>
  pendingReleaseCount(): number
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
  readonly setTimeout?: (callback: () => void, delayMs: number) => unknown
  readonly clearTimeout?: (timer: unknown) => void
}

interface ContinuationV1 {
  readonly endpointId: string
  readonly parentNodeId: string
  readonly generation: number
  readonly session: OpcUaAddressSpaceBrowseSessionV1
  readonly continuationPoint: Uint8Array
  readonly createdAtMs: number
  readonly expiresAtMs: number
  pendingRelease: boolean
  releaseAttempts: number
  lastReleaseError: string | null
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
  const scheduleTimeout = options.setTimeout ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs))
  const cancelTimeout = options.clearTimeout ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  const timers = new Map<string, unknown>()
  let cleanupSequence = 0
  if (!Number.isSafeInteger(continuationTtlMs) || continuationTtlMs < 1 || continuationTtlMs > 300_000 || !Number.isSafeInteger(maxContinuations) || maxContinuations < 1 || maxContinuations > 128 || !Number.isSafeInteger(maxContinuationsPerEndpoint) || maxContinuationsPerEndpoint < 1 || maxContinuationsPerEndpoint > maxContinuations) throw new Error('OPC_UA_BROWSE_CONFIGURATION_INVALID')

  const clearTimer = (token: string): void => {
    const timer = timers.get(token)
    if (timer !== undefined) cancelTimeout(timer)
    timers.delete(token)
  }
  const remove = (token: string): void => {
    clearTimer(token)
    continuations.delete(token)
  }
  const scheduleRelease = (token: string, state: ContinuationV1, delayMs: number): void => {
    clearTimer(token)
    timers.set(token, scheduleTimeout(() => { void abandon(token, state) }, delayMs))
  }
  const abandon = async (token: string, state: ContinuationV1): Promise<boolean> => {
    if (continuations.get(token) !== state || state.pendingRelease) return false
    state.pendingRelease = true
    try {
      await state.session.browseNext([state.continuationPoint], true)
      remove(token)
      return true
    } catch (error) {
      state.pendingRelease = false
      state.releaseAttempts += 1
      state.lastReleaseError = error instanceof Error ? error.message.slice(0, 256) : String(error).slice(0, 256)
      if (state.releaseAttempts < MAX_RELEASE_ATTEMPTS_V1) scheduleRelease(token, state, Math.min(5_000, 25 * 2 ** state.releaseAttempts))
      return false
    }
  }
  const retainForRelease = (
    endpointId: string,
    parentNodeId: string,
    proof: OpcUaAddressSpaceBrowseSessionProofV1,
    continuationPoint: Uint8Array,
  ): readonly [string, ContinuationV1] => {
    const createdAtMs = nowMs()
    const token = `internal_cleanup:${++cleanupSequence}`
    const state: ContinuationV1 = {
      endpointId,
      parentNodeId,
      generation: proof.generation,
      session: proof.session,
      continuationPoint,
      createdAtMs,
      expiresAtMs: createdAtMs + continuationTtlMs,
      pendingRelease: false,
      releaseAttempts: 0,
      lastReleaseError: null,
    }
    continuations.set(token, state)
    return [token, state]
  }
  const releaseReturnedContinuation = async (
    endpointId: string,
    parentNodeId: string,
    proof: OpcUaAddressSpaceBrowseSessionProofV1,
    continuationPoint: Uint8Array,
  ): Promise<void> => {
    const [token, state] = retainForRelease(endpointId, parentNodeId, proof, continuationPoint)
    if (!await abandon(token, state)) throw new Error('OPC_UA_BROWSE_CLEANUP_PENDING')
  }
  const releaseTrackedContinuation = async (token: string, state: ContinuationV1): Promise<void> => {
    if (!await abandon(token, state)) throw new Error('OPC_UA_BROWSE_CLEANUP_PENDING')
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
      if (!await abandon(candidate[0], candidate[1])) throw new Error('OPC_UA_BROWSE_CLEANUP_PENDING')
    }
  }

  const release = async (continuationToken: string): Promise<void> => {
    await sweep()
    const state = continuations.get(continuationToken)
    if (state === undefined) throw new Error('OPC_UA_BROWSE_CONTINUATION_INVALID')
    if (!await abandon(continuationToken, state)) throw new Error('OPC_UA_BROWSE_RELEASE_FAILED')
  }

  return Object.freeze({
    release,
    async releaseEndpoint(endpointId: string): Promise<void> {
      const results = await Promise.all([...continuations.entries()].filter(([, state]) => state.endpointId === endpointId).map(async ([token, state]) => abandon(token, state)))
      if (results.some((released) => !released)) throw new Error('OPC_UA_BROWSE_RELEASE_FAILED')
    },
    async dispose(): Promise<void> {
      const results = await Promise.all([...continuations.entries()].map(async ([token, state]) => abandon(token, state)))
      if (results.some((released) => !released)) throw new Error('OPC_UA_BROWSE_RELEASE_FAILED')
    },
    pendingReleaseCount: () => [...continuations.values()].filter((state) => state.lastReleaseError !== null).length,
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
        if (result.continuationPoint !== null) await releaseReturnedContinuation(request.endpointId, parentNodeId, first, result.continuationPoint)
        throw new Error('OPC_UA_BROWSE_SESSION_STALE')
      }
      if (continuation !== undefined) remove(request.continuationToken!)
      if (result.references.length > request.limit || result.references.some((reference) => !validReference(reference))) {
        if (result.continuationPoint !== null) await releaseReturnedContinuation(request.endpointId, parentNodeId, first, result.continuationPoint)
        throw new Error('OPC_UA_BROWSE_RESPONSE_INVALID')
      }
      let continuationToken: string | null = null
      if (result.continuationPoint !== null) {
        continuationToken = createToken()
        if (!/^[A-Za-z0-9_-]{1,256}$/u.test(continuationToken) || continuations.has(continuationToken)) {
          await releaseReturnedContinuation(request.endpointId, parentNodeId, first, result.continuationPoint)
          throw new Error('OPC_UA_BROWSE_TOKEN_INVALID')
        }
        try {
          await makeRoom(request.endpointId)
        } catch (error) {
          await releaseReturnedContinuation(request.endpointId, parentNodeId, first, result.continuationPoint)
          throw error
        }
        const createdAtMs = nowMs()
        const state: ContinuationV1 = { endpointId: request.endpointId, parentNodeId, generation: first.generation, session: first.session, continuationPoint: result.continuationPoint, createdAtMs, expiresAtMs: createdAtMs + continuationTtlMs, pendingRelease: false, releaseAttempts: 0, lastReleaseError: null }
        continuations.set(continuationToken, state)
        scheduleRelease(continuationToken, state, continuationTtlMs)
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
          if (state !== undefined) await releaseTrackedContinuation(continuationToken, state)
        }
        throw new Error('OPC_UA_BROWSE_RESPONSE_INVALID')
      }
      try {
        validateOpcUaAddressSpaceBrowseResponseV1({ type: 'opcua-address-space-browse-response-v1', protocolVersion: 1, ...output })
      } catch {
        if (continuationToken !== null) {
          const state = continuations.get(continuationToken)
          if (state !== undefined) await releaseTrackedContinuation(continuationToken, state)
        }
        throw new Error('OPC_UA_BROWSE_RESPONSE_INVALID')
      }
      return output
    },
  })
}
