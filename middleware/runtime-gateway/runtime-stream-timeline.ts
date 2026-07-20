import {
  MAX_RUNTIME_BATCH_BYTES_V1,
  MAX_RUNTIME_STATE_VALUES_V1,
  validateStateBatchV1,
  type RuntimeMappedValueV1,
  type StateBatchV1,
} from '../../src/core/runtime-protocol/v1.js'

const encoder = new TextEncoder()

export class RuntimeStreamTimelineErrorV1 extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(`${code}: ${message}`)
    this.name = 'RuntimeStreamTimelineErrorV1'
    this.code = code
  }
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

function assertUniqueSourceMappingIdsV1(values: readonly RuntimeMappedValueV1[]): void {
  const mappingIds = new Set<string>()
  for (const value of values) {
    if (mappingIds.has(value.mappingId)) {
      throw new RuntimeStreamTimelineErrorV1(
        'RUNTIME_STATE_MAPPING_DUPLICATE',
        `Source State Batch contains duplicate Mapping ID ${value.mappingId}.`,
      )
    }
    mappingIds.add(value.mappingId)
  }
}

function oversizedGroupV1(reason: string): never {
  throw new RuntimeStreamTimelineErrorV1(
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
  const encodedBatchBytesV1 = (sequence: number, valueBytes: number): number => {
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
      throw new RuntimeStreamTimelineErrorV1(
        'RUNTIME_STATE_WIRE_SEQUENCE_EXHAUSTED',
        `Endpoint ${source.endpointId} exhausted its wire sequence range.`,
      )
    }
    chunks.push(validateStateBatchV1({ ...source, values: pending, sequence }))
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
    )) publishPending()
    const pendingSequence = firstWireSequence + chunks.length
    if (!Number.isSafeInteger(pendingSequence)) {
      throw new RuntimeStreamTimelineErrorV1(
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

export function isStreamableStateSnapshotV1(snapshot: StateBatchV1): boolean {
  try {
    // Streamability concerns the envelope and coherence grouping, not a
    // hypothetical exhausted Hub counter.  The Hub reserves its real range
    // atomically before using the splitter.
    splitStateBatchesV1(snapshot)
    return true
  } catch (error) {
    if (
      error instanceof RuntimeStreamTimelineErrorV1
      && error.code === 'RUNTIME_STATE_BATCH_SIZE_EXCEEDED'
    ) return false
    throw error
  }
}
