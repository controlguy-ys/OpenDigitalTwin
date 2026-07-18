import {
  MAX_RUNTIME_BATCH_BYTES_V1,
  MAX_RUNTIME_STATE_VALUES_V1,
  validateStateBatchV1,
  type RuntimeMappedValueV1,
  type StateBatchV1,
} from '../../src/core/runtime-protocol/v1.js'

export interface GatewayWebSocketV1 {
  send(data: string, callback: (error?: Error) => void): void
  close(): void
  on(event: 'close' | 'error', listener: () => void): void
  off(event: 'close' | 'error', listener: () => void): void
}

export interface StateBatchHubV1 {
  attach(socket: GatewayWebSocketV1): () => void
  activateRevision(projectId: string, configRevision: string): void
  publish(batch: StateBatchV1): void
  queueDepth(socket: GatewayWebSocketV1): number
  close(): Promise<void>
}

interface EncodedBatchV1 {
  readonly payload: string
}

interface EncodedLogicalTransmissionV1 {
  readonly projectId: string
  readonly configRevision: string
  readonly endpointId: string
  readonly chunks: readonly EncodedBatchV1[]
}

interface SocketStateV1 {
  readonly socket: GatewayWebSocketV1
  readonly onClose: () => void
  readonly onError: () => void
  transmitting: boolean
  // Depth is logical transmissions: one complete multipart send plus one newest pending update.
  pending: EncodedLogicalTransmissionV1 | null
  detached: boolean
}

interface ActiveRevisionV1 {
  readonly projectId: string
  readonly configRevision: string
}

const encoder = new TextEncoder()

export class StateBatchHubErrorV1 extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(`${code}: ${message}`)
    this.name = 'StateBatchHubErrorV1'
    this.code = code
  }
}

function sameRevisionV1(
  batch: Pick<StateBatchV1, 'projectId' | 'configRevision'>,
  active: ActiveRevisionV1 | null,
): boolean {
  return active !== null
    && batch.projectId === active.projectId
    && batch.configRevision === active.configRevision
}

function batchWithValuesV1(
  source: StateBatchV1,
  values: readonly RuntimeMappedValueV1[],
): StateBatchV1 {
  return { ...source, values }
}

function groupedValuesV1(
  values: readonly RuntimeMappedValueV1[],
): readonly (readonly RuntimeMappedValueV1[])[] {
  const groups: RuntimeMappedValueV1[][] = []
  const coherentGroupIndexes = new Map<string, number>()
  for (const value of values) {
    if (value.coherenceGroupId === null) {
      groups.push([value])
      continue
    }
    const existingIndex = coherentGroupIndexes.get(value.coherenceGroupId)
    if (existingIndex === undefined) {
      coherentGroupIndexes.set(value.coherenceGroupId, groups.length)
      groups.push([value])
    } else {
      groups[existingIndex]!.push(value)
    }
  }
  return groups
}

function assertUniqueSourceMappingIdsV1(
  values: readonly RuntimeMappedValueV1[],
): void {
  const mappingIds = new Set<string>()
  for (const value of values) {
    if (mappingIds.has(value.mappingId)) {
      throw new StateBatchHubErrorV1(
        'RUNTIME_STATE_MAPPING_DUPLICATE',
        `Source State Batch contains duplicate Mapping ID ${value.mappingId}.`,
      )
    }
    mappingIds.add(value.mappingId)
  }
}

function oversizedGroupV1(reason: string): never {
  throw new StateBatchHubErrorV1(
    'RUNTIME_STATE_BATCH_SIZE_EXCEEDED',
    `One coherence group cannot fit in a State Batch (${reason}).`,
  )
}

function encodedMappedValueBytesV1(value: RuntimeMappedValueV1): number {
  return encoder.encode(JSON.stringify(value) ?? 'null').byteLength
}

function encodedValueListBytesV1(
  values: readonly RuntimeMappedValueV1[],
  encodedValueBytesByMappingId: ReadonlyMap<string, number>,
): number {
  return values.reduce(
    (bytes, value) => bytes + encodedValueBytesByMappingId.get(value.mappingId)!,
    Math.max(0, values.length - 1),
  )
}

export function splitStateBatchesV1(
  source: StateBatchV1,
  firstWireSequence = source.sequence,
): readonly StateBatchV1[] {
  if (!Array.isArray(source.values) || source.values.length === 0) {
    return Object.freeze([validateStateBatchV1(source)])
  }
  assertUniqueSourceMappingIdsV1(source.values)

  const encodedValueBytesByMappingId = new Map(
    source.values.map((value) => [value.mappingId, encodedMappedValueBytesV1(value)]),
  )
  const encodedEmptyBatchBytesBySequence = new Map<number, number>()
  const encodedBatchBytesV1 = (
    sequence: number,
    valueBytes: number,
  ): number => {
    let emptyBatchBytes = encodedEmptyBatchBytesBySequence.get(sequence)
    if (emptyBatchBytes === undefined) {
      emptyBatchBytes = encoder.encode(JSON.stringify({ ...source, sequence, values: [] })).byteLength
      encodedEmptyBatchBytesBySequence.set(sequence, emptyBatchBytes)
    }
    return emptyBatchBytes + valueBytes
  }

  const chunks: StateBatchV1[] = []
  let pending: RuntimeMappedValueV1[] = []
  let pendingValueBytes = 0

  const publishPending = (): void => {
    if (pending.length === 0) return
    const sequence = firstWireSequence + chunks.length
    if (!Number.isSafeInteger(sequence)) {
      throw new StateBatchHubErrorV1(
        'RUNTIME_STATE_WIRE_SEQUENCE_EXHAUSTED',
        `Endpoint ${source.endpointId} exhausted its wire sequence range.`,
      )
    }
    chunks.push(validateStateBatchV1({ ...batchWithValuesV1(source, pending), sequence }))
    pending = []
    pendingValueBytes = 0
  }

  for (const group of groupedValuesV1(source.values)) {
    if (group.length > MAX_RUNTIME_STATE_VALUES_V1) oversizedGroupV1('value limit')
    const groupValueBytes = encodedValueListBytesV1(group, encodedValueBytesByMappingId)
    const candidateValueBytes = pending.length === 0
      ? groupValueBytes
      : pendingValueBytes + 1 + groupValueBytes
    const sequence = firstWireSequence + chunks.length
    if (pending.length > 0 && (
      pending.length + group.length > MAX_RUNTIME_STATE_VALUES_V1
      || encodedBatchBytesV1(sequence, candidateValueBytes) > MAX_RUNTIME_BATCH_BYTES_V1
    )) {
      publishPending()
    }
    const pendingSequence = firstWireSequence + chunks.length
    if (!Number.isSafeInteger(pendingSequence)) {
      throw new StateBatchHubErrorV1(
        'RUNTIME_STATE_WIRE_SEQUENCE_EXHAUSTED',
        `Endpoint ${source.endpointId} exhausted its wire sequence range.`,
      )
    }
    if (encodedBatchBytesV1(pendingSequence, groupValueBytes) > MAX_RUNTIME_BATCH_BYTES_V1) {
      oversizedGroupV1('encoded byte limit')
    }
    pending = pending.length === 0 ? [...group] : [...pending, ...group]
    pendingValueBytes = pending.length === group.length
      ? groupValueBytes
      : pendingValueBytes + 1 + groupValueBytes
  }
  publishPending()
  return Object.freeze(chunks)
}

export function createStateBatchHubV1(): StateBatchHubV1 {
  const sockets = new Map<GatewayWebSocketV1, SocketStateV1>()
  const lastSourceSequenceByEndpoint = new Map<string, number>()
  const wireSequenceByEndpoint = new Map<string, number>()
  let activeRevision: ActiveRevisionV1 | null = null
  let closed = false

  const detachState = (state: SocketStateV1): void => {
    if (state.detached) return
    state.detached = true
    state.pending = null
    state.transmitting = false
    sockets.delete(state.socket)
    state.socket.off('close', state.onClose)
    state.socket.off('error', state.onError)
  }

  const sendNext = (
    state: SocketStateV1,
    transmission: EncodedLogicalTransmissionV1,
    chunkIndex = 0,
  ): void => {
    if (state.detached || closed) return
    const encoded = transmission.chunks[chunkIndex]
    if (encoded === undefined) return
    state.transmitting = true
    try {
      state.socket.send(encoded.payload, (error?: Error) => {
        if (state.detached) return
        if (error !== undefined) {
          detachState(state)
          return
        }
        state.transmitting = false
        if (
          sameRevisionV1(transmission, activeRevision)
          && chunkIndex + 1 < transmission.chunks.length
        ) {
          sendNext(state, transmission, chunkIndex + 1)
          return
        }
        const pending = state.pending
        state.pending = null
        if (pending === null || !sameRevisionV1(pending, activeRevision)) return
        sendNext(state, pending)
      })
    } catch {
      detachState(state)
    }
  }

  const attach = (socket: GatewayWebSocketV1): (() => void) => {
    if (closed) {
      socket.close()
      return () => undefined
    }
    const existing = sockets.get(socket)
    if (existing !== undefined) return () => detachState(existing)

    let state!: SocketStateV1
    const onClose = () => detachState(state)
    const onError = () => detachState(state)
    state = {
      socket,
      onClose,
      onError,
      transmitting: false,
      pending: null,
      detached: false,
    }
    sockets.set(socket, state)
    socket.on('close', onClose)
    socket.on('error', onError)
    return () => detachState(state)
  }

  const activateRevision = (projectId: string, configRevision: string): void => {
    activeRevision = Object.freeze({ projectId, configRevision })
    lastSourceSequenceByEndpoint.clear()
    wireSequenceByEndpoint.clear()
    for (const state of sockets.values()) state.pending = null
  }

  const publish = (untrustedBatch: StateBatchV1): void => {
    if (closed) return
    const firstWireSequence = (wireSequenceByEndpoint.get(untrustedBatch.endpointId) ?? 0) + 1
    const chunks = splitStateBatchesV1(untrustedBatch, firstWireSequence)
    const batch = chunks[0]!
    if (!sameRevisionV1(batch, activeRevision)) return
    const previousSourceSequence = lastSourceSequenceByEndpoint.get(batch.endpointId)
    if (previousSourceSequence !== undefined && untrustedBatch.sequence <= previousSourceSequence) return
    lastSourceSequenceByEndpoint.set(batch.endpointId, untrustedBatch.sequence)
    const encoded: EncodedLogicalTransmissionV1 = Object.freeze({
      projectId: batch.projectId,
      configRevision: batch.configRevision,
      endpointId: batch.endpointId,
      chunks: Object.freeze(chunks.map((chunk) => {
        wireSequenceByEndpoint.set(chunk.endpointId, chunk.sequence)
        return Object.freeze({ payload: JSON.stringify(chunk) })
      })),
    })
    for (const state of sockets.values()) {
      if (state.transmitting) state.pending = encoded
      else sendNext(state, encoded)
    }
  }

  const queueDepth = (socket: GatewayWebSocketV1): number => {
    const state = sockets.get(socket)
    if (state === undefined) return 0
    return (state.transmitting ? 1 : 0) + (state.pending === null ? 0 : 1)
  }

  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    activeRevision = null
    for (const state of sockets.values()) {
      detachState(state)
      try {
        state.socket.close()
      } catch {
        // Closing one browser must not retain or block the remaining sockets.
      }
    }
  }

  return Object.freeze({ attach, activateRevision, publish, queueDepth, close })
}
