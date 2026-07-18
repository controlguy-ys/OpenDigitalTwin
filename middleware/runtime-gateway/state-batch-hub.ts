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
  readonly projectId: string
  readonly configRevision: string
  readonly payload: string
}

interface SocketStateV1 {
  readonly socket: GatewayWebSocketV1
  readonly onClose: () => void
  readonly onError: () => void
  transmitting: boolean
  pending: EncodedBatchV1 | null
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

function encodedSizeV1(batch: StateBatchV1): number {
  return encoder.encode(JSON.stringify(batch)).byteLength
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

function oversizedGroupV1(reason: string): never {
  throw new StateBatchHubErrorV1(
    'RUNTIME_STATE_BATCH_SIZE_EXCEEDED',
    `One coherence group cannot fit in a State Batch (${reason}).`,
  )
}

export function splitStateBatchesV1(
  source: StateBatchV1,
): readonly StateBatchV1[] {
  if (!Array.isArray(source.values) || source.values.length === 0) {
    return Object.freeze([validateStateBatchV1(source)])
  }

  const chunks: StateBatchV1[] = []
  let pending: RuntimeMappedValueV1[] = []

  const publishPending = (): void => {
    if (pending.length === 0) return
    chunks.push(validateStateBatchV1(batchWithValuesV1(source, pending)))
    pending = []
  }

  for (const group of groupedValuesV1(source.values)) {
    if (group.length > MAX_RUNTIME_STATE_VALUES_V1) oversizedGroupV1('value limit')
    const groupBatch = batchWithValuesV1(source, group)
    if (encodedSizeV1(groupBatch) > MAX_RUNTIME_BATCH_BYTES_V1) {
      oversizedGroupV1('encoded byte limit')
    }

    const candidate = [...pending, ...group]
    const candidateBatch = batchWithValuesV1(source, candidate)
    if (
      candidate.length > MAX_RUNTIME_STATE_VALUES_V1
      || encodedSizeV1(candidateBatch) > MAX_RUNTIME_BATCH_BYTES_V1
    ) {
      publishPending()
      pending = [...group]
    } else {
      pending = candidate
    }
  }
  publishPending()
  return Object.freeze(chunks)
}

export function createStateBatchHubV1(): StateBatchHubV1 {
  const sockets = new Map<GatewayWebSocketV1, SocketStateV1>()
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

  const sendNext = (state: SocketStateV1, encoded: EncodedBatchV1): void => {
    if (state.detached || closed) return
    state.transmitting = true
    try {
      state.socket.send(encoded.payload, (error?: Error) => {
        if (state.detached) return
        if (error !== undefined) {
          detachState(state)
          return
        }
        state.transmitting = false
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
    for (const state of sockets.values()) state.pending = null
  }

  const publish = (untrustedBatch: StateBatchV1): void => {
    if (closed) return
    const batch = validateStateBatchV1(untrustedBatch)
    if (!sameRevisionV1(batch, activeRevision)) return
    const encoded: EncodedBatchV1 = Object.freeze({
      projectId: batch.projectId,
      configRevision: batch.configRevision,
      payload: JSON.stringify(batch),
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
    for (const state of [...sockets.values()]) {
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
