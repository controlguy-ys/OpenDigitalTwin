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
  readonly channelKey: string
  readonly chunks: readonly EncodedBatchV1[]
}

interface PendingSnapshotsV1 {
  readonly projectId: string
  readonly configRevision: string
  readonly snapshotsByEndpoint: Map<string, Map<string, StateBatchV1>>
}

interface SocketStateV1 {
  readonly socket: GatewayWebSocketV1
  readonly onClose: () => void
  readonly onError: () => void
  transmitting: boolean
  // One in-flight transmission plus one composite of the latest independent
  // channels that arrived while it was blocked.
  pending: PendingSnapshotsV1 | null
  // A bounded attach-time replay sends the latest snapshot for every channel.
  replay: EncodedLogicalTransmissionV1[]
  detached: boolean
}

interface ActiveRevisionV1 {
  readonly projectId: string
  readonly configRevision: string
}

const encoder = new TextEncoder()
const MAX_REPLAY_ENDPOINTS_V1 = 8
const MAX_CACHED_CHANNELS_PER_ENDPOINT_V1 = MAX_RUNTIME_STATE_VALUES_V1

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

function transmissionGroupsV1(
  values: readonly RuntimeMappedValueV1[],
): readonly (readonly RuntimeMappedValueV1[])[] {
  const groups: RuntimeMappedValueV1[][] = []
  const coherentGroupIndexes = new Map<string, number>()
  const uncoherent: RuntimeMappedValueV1[] = []
  for (const value of values) {
    if (value.coherenceGroupId === null) {
      uncoherent.push(value)
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
  return Object.freeze([
    ...(uncoherent.length === 0 ? [] : [Object.freeze(uncoherent)]),
    ...groups.map((group) => Object.freeze(group)),
  ])
}

function channelKeyV1(values: readonly RuntimeMappedValueV1[]): string {
  const coherenceGroupId = values[0]?.coherenceGroupId
  if (coherenceGroupId !== null && coherenceGroupId !== undefined) {
    return `coherence:${coherenceGroupId}`
  }
  return values.length === 1
    ? `mapping:${values[0]!.mappingId}`
    : `snapshot:${values.map(({ mappingId }) => mappingId).sort().join(',')}`
}

interface SnapshotSourceV1 {
  readonly channelKey: string
  readonly batch: StateBatchV1
}

function snapshotSourcesV1(source: StateBatchV1): readonly SnapshotSourceV1[] {
  return Object.freeze(groupedValuesV1(source.values).map((values) => Object.freeze({
    channelKey: channelKeyV1(values),
    batch: batchWithValuesV1(source, values),
  })))
}

export function isStreamableStateSnapshotV1(snapshot: StateBatchV1): boolean {
  try {
    // A cached or deferred snapshot can be assigned any later positive wire
    // sequence. Reject groups that cannot fit the widest valid envelope.
    splitStateBatchesV1(snapshot, Number.MAX_SAFE_INTEGER)
    return true
  } catch (error) {
    if (
      error instanceof StateBatchHubErrorV1
      && error.code === 'RUNTIME_STATE_BATCH_SIZE_EXCEEDED'
    ) {
      return false
    }
    throw error
  }
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
  const latestSnapshotsByEndpoint = new Map<string, Map<string, StateBatchV1>>()
  let activeRevision: ActiveRevisionV1 | null = null
  let closed = false

  const detachState = (state: SocketStateV1): void => {
    if (state.detached) return
    state.detached = true
    state.pending = null
    state.replay = []
    state.transmitting = false
    sockets.delete(state.socket)
    state.socket.off('close', state.onClose)
    state.socket.off('error', state.onError)
  }

  const detachAndCloseState = (state: SocketStateV1): void => {
    detachState(state)
    try {
      state.socket.close()
    } catch {
      // A peer can disappear while the hub is isolating its failed stream.
    }
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
        try {
          if (state.detached) return
          if (error != null) {
            detachAndCloseState(state)
            return
          }
          state.transmitting = false
          if (!sameRevisionV1(transmission, activeRevision)) {
            state.replay = []
            const pending = nextPending(state)
            if (pending !== undefined && sameRevisionV1(pending, activeRevision)) {
              sendNext(state, pending)
            }
            return
          }
          if (
            chunkIndex + 1 < transmission.chunks.length
          ) {
            sendNext(state, transmission, chunkIndex + 1)
            return
          }
          const replay = state.replay.shift()
          if (replay !== undefined) {
            sendNext(state, replay)
            return
          }
          const pending = nextPending(state)
          if (pending !== undefined && sameRevisionV1(pending, activeRevision)) {
            sendNext(state, pending)
          }
        } catch {
          // A newly assigned wire sequence may make an otherwise valid source
          // batch too large. The affected peer must not terminate the gateway.
          detachAndCloseState(state)
        }
      })
    } catch {
      detachAndCloseState(state)
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
      replay: [],
      detached: false,
    }
    sockets.set(socket, state)
    socket.on('close', onClose)
    socket.on('error', onError)
    if (activeRevision !== null) {
      try {
        const stagedWireSequences = new Map(wireSequenceByEndpoint)
        const replay = [...latestSnapshotsByEndpoint.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .flatMap(([endpointId, snapshots]) => [...snapshots.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([channelKey, snapshot]) => encodeTransmissionWithStagedWireSequences(
              stagedWireSequences,
              endpointId,
              channelKey,
              snapshot,
            )))
        wireSequenceByEndpoint.clear()
        for (const [stagedEndpointId, sequence] of stagedWireSequences) {
          wireSequenceByEndpoint.set(stagedEndpointId, sequence)
        }
        const first = replay.shift()
        state.replay = replay
        if (first !== undefined) sendNext(state, first)
      } catch {
        // Replay is client-specific: retain the hub and isolate this peer.
        detachAndCloseState(state)
      }
    }
    return () => detachState(state)
  }

  const activateRevision = (projectId: string, configRevision: string): void => {
    if (
      activeRevision?.projectId === projectId
      && activeRevision.configRevision === configRevision
    ) {
      // A replacement adapter starts its own source sequence at one, while
      // existing browser sockets must keep their hub-owned wire sequences.
      lastSourceSequenceByEndpoint.clear()
      return
    }
    activeRevision = Object.freeze({ projectId, configRevision })
    lastSourceSequenceByEndpoint.clear()
    wireSequenceByEndpoint.clear()
    latestSnapshotsByEndpoint.clear()
    for (const state of sockets.values()) {
      state.pending = null
      state.replay = []
    }
  }

  function encodeTransmission(
    endpointId: string,
    channelKey: string,
    source: StateBatchV1,
  ): EncodedLogicalTransmissionV1 {
    const stagedWireSequences = new Map(wireSequenceByEndpoint)
    const transmission = encodeTransmissionWithStagedWireSequences(
      stagedWireSequences,
      endpointId,
      channelKey,
      source,
    )
    wireSequenceByEndpoint.clear()
    for (const [stagedEndpointId, sequence] of stagedWireSequences) {
      wireSequenceByEndpoint.set(stagedEndpointId, sequence)
    }
    return transmission
  }

  function encodeTransmissionWithStagedWireSequences(
    stagedWireSequences: Map<string, number>,
    endpointId: string,
    channelKey: string,
    source: StateBatchV1,
  ): EncodedLogicalTransmissionV1 {
    const firstWireSequence = (stagedWireSequences.get(endpointId) ?? 0) + 1
    const chunks = splitStateBatchesV1(source, firstWireSequence)
    chunks.forEach((chunk) => stagedWireSequences.set(chunk.endpointId, chunk.sequence))
    return Object.freeze({
      projectId: source.projectId,
      configRevision: source.configRevision,
      endpointId,
      channelKey,
      chunks: Object.freeze(chunks.map((chunk) => Object.freeze({ payload: JSON.stringify(chunk) }))),
    })
  }

  function encodePendingSnapshots(pending: PendingSnapshotsV1): EncodedLogicalTransmissionV1 | undefined {
    const stagedWireSequences = new Map(wireSequenceByEndpoint)
    const chunks: EncodedBatchV1[] = []
    for (const [endpointId, snapshots] of [...pending.snapshotsByEndpoint.entries()]
      .sort(([left], [right]) => left.localeCompare(right))) {
      for (const [channelKey, snapshot] of [...snapshots.entries()]
        .sort(([left], [right]) => left.localeCompare(right))) {
        chunks.push(...encodeTransmissionWithStagedWireSequences(
          stagedWireSequences,
          endpointId,
          channelKey,
          snapshot,
        ).chunks)
      }
    }
    if (chunks.length === 0) return undefined
    wireSequenceByEndpoint.clear()
    for (const [endpointId, sequence] of stagedWireSequences) {
      wireSequenceByEndpoint.set(endpointId, sequence)
    }
    return Object.freeze({
      projectId: pending.projectId,
      configRevision: pending.configRevision,
      endpointId: 'composite',
      channelKey: 'composite',
      chunks: Object.freeze(chunks),
    })
  }

  function nextPending(state: SocketStateV1): EncodedLogicalTransmissionV1 | undefined {
    const pending = state.pending
    state.pending = null
    return pending === null ? undefined : encodePendingSnapshots(pending)
  }

  function enqueue(
    state: SocketStateV1,
    transmission: EncodedLogicalTransmissionV1 | null,
    endpointId: string,
    snapshots: readonly SnapshotSourceV1[],
  ): void {
    if (state.transmitting) {
      const source = snapshots[0]?.batch
      if (source === undefined) return
      if (
        state.pending === null
        || state.pending.projectId !== source.projectId
        || state.pending.configRevision !== source.configRevision
      ) {
        state.pending = {
          projectId: source.projectId,
          configRevision: source.configRevision,
          snapshotsByEndpoint: new Map(),
        }
      }
      const endpointSnapshots = state.pending.snapshotsByEndpoint.get(endpointId) ?? new Map()
      state.pending.snapshotsByEndpoint.set(endpointId, endpointSnapshots)
      for (const snapshot of snapshots) {
        endpointSnapshots.set(snapshot.channelKey, snapshot.batch)
      }
      return
    }
    if (transmission !== null) sendNext(state, transmission)
  }

  const publish = (untrustedBatch: StateBatchV1): void => {
    if (closed) return
    if (!sameRevisionV1(untrustedBatch, activeRevision)) return
    const previousSourceSequence = lastSourceSequenceByEndpoint.get(untrustedBatch.endpointId)
    if (previousSourceSequence !== undefined && untrustedBatch.sequence <= previousSourceSequence) return
    assertUniqueSourceMappingIdsV1(untrustedBatch.values)
    const streamableSnapshots = snapshotSourcesV1(untrustedBatch)
      .filter(({ batch: snapshot }) => isStreamableStateSnapshotV1(snapshot))
    const streamableValues = streamableSnapshots.flatMap(({ batch: snapshot }) => snapshot.values)
    const sources = transmissionGroupsV1(streamableValues).map((values) => Object.freeze({
      channelKey: channelKeyV1(values),
      batch: batchWithValuesV1(untrustedBatch, values),
    }))
    lastSourceSequenceByEndpoint.set(untrustedBatch.endpointId, untrustedBatch.sequence)
    if (streamableSnapshots.length === 0) return
    const endpointSnapshots = latestSnapshotsByEndpoint.get(untrustedBatch.endpointId) ?? new Map()
    latestSnapshotsByEndpoint.set(untrustedBatch.endpointId, endpointSnapshots)
    for (const source of streamableSnapshots) {
      endpointSnapshots.delete(source.channelKey)
      endpointSnapshots.set(source.channelKey, source.batch)
    }
    while (endpointSnapshots.size > MAX_CACHED_CHANNELS_PER_ENDPOINT_V1) {
      const oldestChannelKey = endpointSnapshots.keys().next().value as string | undefined
      if (oldestChannelKey === undefined) break
      endpointSnapshots.delete(oldestChannelKey)
    }
    if (latestSnapshotsByEndpoint.size > MAX_REPLAY_ENDPOINTS_V1) {
      const oldestEndpointId = latestSnapshotsByEndpoint.keys().next().value as string | undefined
      if (oldestEndpointId !== undefined) latestSnapshotsByEndpoint.delete(oldestEndpointId)
    }
    if (sockets.size === 0) return
    for (const source of sources) {
      const snapshots = snapshotSourcesV1(source.batch)
      const states = [...sockets.values()]
      const idleStates = states.filter((state) => !state.transmitting)
      let transmission: EncodedLogicalTransmissionV1 | null = null
      if (idleStates.length > 0) {
        try {
          transmission = encodeTransmission(untrustedBatch.endpointId, source.channelKey, source.batch)
        } catch {
          // This source cannot be represented at the endpoint's current wire
          // sequence. Isolate only peers about to receive it synchronously.
          for (const state of idleStates) detachAndCloseState(state)
        }
      }
      for (const state of states) {
        enqueue(
          state,
          transmission,
          untrustedBatch.endpointId,
          snapshots,
        )
      }
    }
  }

  const queueDepth = (socket: GatewayWebSocketV1): number => {
    const state = sockets.get(socket)
    if (state === undefined) return 0
    return (state.transmitting ? 1 : 0)
      + state.replay.length
      + (state.pending === null ? 0 : 1)
  }

  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    activeRevision = null
    latestSnapshotsByEndpoint.clear()
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
