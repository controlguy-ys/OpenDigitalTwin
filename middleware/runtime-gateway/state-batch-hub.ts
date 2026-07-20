import {
  MAX_RUNTIME_BATCH_BYTES_V1,
  MAX_RUNTIME_STATE_VALUES_V1,
  type EndpointCatchupBoundaryV1,
  type EndpointLifecycleV1,
  type EndpointReplayBoundaryV1,
  type RuntimeMappedValueV1,
  type RuntimePublisherMessageV1,
  type StateBatchV1,
} from '../../src/core/runtime-protocol/v1.js'
import {
  readNormalizedOpcUaClientPublicationV1,
  type NormalizedOpcUaClientPublicationV1,
} from './opcua-client-adapter.js'
import {
  isStreamableStateSnapshotV1,
  splitStateBatchesV1,
} from './runtime-stream-timeline.js'

export interface GatewayWebSocketV1 {
  send(data: string, callback: (error?: Error) => void): void
  close(): void
  on(event: 'close' | 'error', listener: () => void): void
  off(event: 'close' | 'error', listener: () => void): void
}

export interface StateBatchHubV1 {
  attach(socket: GatewayWebSocketV1): () => void
  deactivateRevision(): void
  prepareRevisionActivation(options: PrepareRevisionActivationOptionsV1): PreparedRevisionActivationV1
  publish(publication: NormalizedOpcUaClientPublicationV1): boolean
  queueDepth(socket: GatewayWebSocketV1): number
  close(): Promise<void>
}

export interface StateBatchHubOptionsV1 {
  readonly initialReplayCounter?: number
  readonly initialCatchupCounter?: number
  readonly initialWireSequenceByEndpoint?: Readonly<Record<string, number>>
}

const SEALED_RUNTIME_TIMELINE_V1: unique symbol = Symbol('sealed-runtime-timeline-v1')

export interface SealedRuntimeTimelineV1 {
  readonly [SEALED_RUNTIME_TIMELINE_V1]: true
}

export interface RuntimeTimelineStagingV1 {
  publish(publication: NormalizedOpcUaClientPublicationV1): void
  assertHealthy(): void
  seal(): SealedRuntimeTimelineV1
}

export interface PrepareRevisionActivationOptionsV1 {
  readonly projectId: string
  readonly configRevision: string
  readonly gatewayId: string
  readonly originId: string
  readonly publisherGeneration: number
  readonly endpointIds: readonly string[]
  readonly stagedTimeline: SealedRuntimeTimelineV1
}

export interface PreparedRevisionActivationV1 {
  installPrepared(): void
  flushPrepared(): void
}

interface ActiveRevisionV1 {
  readonly projectId: string
  readonly configRevision: string
  readonly gatewayId: string
  readonly originId: string
  readonly publisherGeneration: number
  readonly endpointIds: ReadonlySet<string>
}

interface SessionIdentityV1 {
  readonly publisherGeneration: number
  readonly sessionGeneration: number
}

interface EndpointAdmissionV1 {
  lastSourceSequence: number | null
  session: SessionIdentityV1 | null
  connected: boolean
  readonly sourceTimestampByChannel: Map<string, number>
  readonly publishedTimestampByChannel: Map<string, number>
}

interface TimelineObservationV1 {
  readonly batch: StateBatchV1
  readonly order: number
  readonly channelKey: string
}

interface ReconstructionRecordV1 {
  readonly channelKey: string
  good: TimelineObservationV1 | null
  latest: TimelineObservationV1
  lastUpdatedOrder: number
}

interface TimelineSegmentV1 {
  readonly records: Map<string, ReconstructionRecordV1>
}

type TimelineEntryV1 =
  | { readonly kind: 'segment'; readonly segment: TimelineSegmentV1 }
  | { readonly kind: 'barrier'; readonly message: EndpointLifecycleV1 }

interface EndpointTimelineV1 {
  readonly entries: TimelineEntryV1[]
  current: TimelineSegmentV1
}

interface MutableTimelineV1 {
  readonly endpoints: Map<string, EndpointTimelineV1>
  readonly admissions: Map<string, EndpointAdmissionV1>
  nextOrder: number
  barrierCount: number
}

interface StagedTimelineDataV1 {
  readonly messagesByEndpoint: ReadonlyMap<string, readonly RuntimePublisherMessageV1[]>
}

interface EndpointReplayCacheV1 {
  readonly prefixRecords: Map<string, ReconstructionRecordV1>
  connected: EndpointLifecycleV1 | null
  readonly currentRecords: Map<string, ReconstructionRecordV1>
  disconnected: EndpointLifecycleV1 | null
  readonly lruByChannel: Map<string, number>
}

interface EncodedTransmissionV1 {
  readonly endpointId: string
  readonly projectId: string
  readonly configRevision: string
  readonly frames: readonly string[]
}

interface SocketStateV1 {
  readonly socket: GatewayWebSocketV1
  readonly onClose: () => void
  readonly onError: () => void
  current: EncodedTransmissionV1 | null
  currentFrameIndex: number
  readonly queue: EncodedTransmissionV1[]
  pending: MutableTimelineV1
  holdUntilPreparedFlush: boolean
  detached: boolean
  listenersRemoved: boolean
}

class HubRangeErrorV1 extends Error {
  readonly code: 'RUNTIME_STATE_WIRE_SEQUENCE_EXHAUSTED' | 'RUNTIME_REPLAY_COUNTER_EXHAUSTED' | 'RUNTIME_CATCHUP_COUNTER_EXHAUSTED'
  readonly endpointId: string

  constructor(
    code: 'RUNTIME_STATE_WIRE_SEQUENCE_EXHAUSTED' | 'RUNTIME_REPLAY_COUNTER_EXHAUSTED' | 'RUNTIME_CATCHUP_COUNTER_EXHAUSTED',
    endpointId: string,
  ) {
    super(code)
    this.name = 'HubRangeErrorV1'
    this.code = code
    this.endpointId = endpointId
  }
}

const sealedRuntimeTimelinesV1 = new WeakSet<object>()
const consumedRuntimeTimelinesV1 = new WeakSet<object>()
const stagedTimelineDataV1 = new WeakMap<object, StagedTimelineDataV1>()

const encoder = new TextEncoder()
const MAX_ENDPOINTS_V1 = 8
const MAX_CACHED_CHANNELS_PER_ENDPOINT_V1 = MAX_RUNTIME_STATE_VALUES_V1
const MAX_TIMELINE_BYTES_V1 = 8 * MAX_RUNTIME_BATCH_BYTES_V1
const MAX_PENDING_LIFECYCLE_BARRIERS_V1 = 32

function encodedBytesV1(value: string): number {
  return encoder.encode(value).byteLength
}

function batchWithValuesV1(
  source: StateBatchV1,
  values: readonly RuntimeMappedValueV1[],
): StateBatchV1 {
  return Object.freeze({ ...source, values: Object.freeze([...values]) })
}

function groupedValuesV1(
  values: readonly RuntimeMappedValueV1[],
): readonly (readonly RuntimeMappedValueV1[])[] {
  const groups: RuntimeMappedValueV1[][] = []
  const coherentIndexes = new Map<string, number>()
  for (const value of values) {
    if (value.coherenceGroupId === null) {
      groups.push([value])
      continue
    }
    const existing = coherentIndexes.get(value.coherenceGroupId)
    if (existing === undefined) {
      coherentIndexes.set(value.coherenceGroupId, groups.length)
      groups.push([value])
    } else {
      groups[existing]!.push(value)
    }
  }
  return Object.freeze(groups.map((group) => Object.freeze(group)))
}

function channelKeyV1(values: readonly RuntimeMappedValueV1[]): string {
  const coherenceGroupId = values[0]?.coherenceGroupId
  return coherenceGroupId === null || coherenceGroupId === undefined
    ? `mapping:${values[0]!.mappingId}`
    : `coherence:${coherenceGroupId}`
}

function createAdmissionV1(): EndpointAdmissionV1 {
  return {
    lastSourceSequence: null,
    session: null,
    connected: false,
    sourceTimestampByChannel: new Map(),
    publishedTimestampByChannel: new Map(),
  }
}

function cloneAdmissionV1(source: EndpointAdmissionV1): EndpointAdmissionV1 {
  return {
    lastSourceSequence: source.lastSourceSequence,
    session: source.session === null ? null : Object.freeze({ ...source.session }),
    connected: source.connected,
    sourceTimestampByChannel: new Map(source.sourceTimestampByChannel),
    publishedTimestampByChannel: new Map(source.publishedTimestampByChannel),
  }
}

function cloneObservationV1(source: TimelineObservationV1): TimelineObservationV1 {
  return Object.freeze({ ...source })
}

function cloneRecordV1(source: ReconstructionRecordV1): ReconstructionRecordV1 {
  const latest = cloneObservationV1(source.latest)
  return {
    channelKey: source.channelKey,
    good: source.good === null
      ? null
      : source.good === source.latest ? latest : cloneObservationV1(source.good),
    latest,
    lastUpdatedOrder: source.lastUpdatedOrder,
  }
}

function cloneRecordMapV1(
  source: ReadonlyMap<string, ReconstructionRecordV1>,
): Map<string, ReconstructionRecordV1> {
  return new Map([...source].map(([key, record]) => [key, cloneRecordV1(record)]))
}

function createTimelineV1(): MutableTimelineV1 {
  return {
    endpoints: new Map(),
    admissions: new Map(),
    nextOrder: 0,
    barrierCount: 0,
  }
}

function cloneTimelineV1(source: MutableTimelineV1): MutableTimelineV1 {
  const endpoints = new Map<string, EndpointTimelineV1>()
  for (const [endpointId, endpoint] of source.endpoints) {
    const cloneSegment = (segment: TimelineSegmentV1): TimelineSegmentV1 => ({
      records: cloneRecordMapV1(segment.records),
    })
    endpoints.set(endpointId, {
      entries: endpoint.entries.map((entry) => entry.kind === 'barrier'
        ? { kind: 'barrier' as const, message: entry.message }
        : { kind: 'segment' as const, segment: cloneSegment(entry.segment) }),
      current: cloneSegment(endpoint.current),
    })
  }
  return {
    endpoints,
    admissions: new Map([...source.admissions].map(([key, admission]) => [key, cloneAdmissionV1(admission)])),
    nextOrder: source.nextOrder,
    barrierCount: source.barrierCount,
  }
}

function endpointTimelineV1(timeline: MutableTimelineV1, endpointId: string): EndpointTimelineV1 {
  let endpoint = timeline.endpoints.get(endpointId)
  if (endpoint === undefined) {
    endpoint = { entries: [], current: { records: new Map() } }
    timeline.endpoints.set(endpointId, endpoint)
  }
  return endpoint
}

function observationsForRecordV1(record: ReconstructionRecordV1): readonly TimelineObservationV1[] {
  return record.good !== null && record.good !== record.latest
    ? Object.freeze([record.good, record.latest])
    : Object.freeze([record.latest])
}

function updateRecordV1(
  records: Map<string, ReconstructionRecordV1>,
  channelKey: string,
  batch: StateBatchV1,
  order: number,
): void {
  const observation: TimelineObservationV1 = Object.freeze({ batch, order, channelKey })
  const declaredGood = batch.values.every(({ quality }) => quality === 'GOOD')
  const existing = records.get(channelKey)
  if (existing === undefined) {
    records.set(channelKey, {
      channelKey,
      good: declaredGood ? observation : null,
      latest: observation,
      lastUpdatedOrder: order,
    })
    return
  }
  if (declaredGood) existing.good = observation
  existing.latest = observation
  existing.lastUpdatedOrder = order
}

function flattenRecordsV1(
  records: ReadonlyMap<string, ReconstructionRecordV1>,
): readonly StateBatchV1[] {
  const observations = [...records.values()].flatMap((record) => observationsForRecordV1(record))
    .sort((left, right) => left.order - right.order || left.channelKey.localeCompare(right.channelKey))
  const batches: StateBatchV1[] = []
  let index = 0
  while (index < observations.length) {
    const first = observations[index]!
    const sameOrder: TimelineObservationV1[] = []
    while (index < observations.length && observations[index]!.order === first.order) {
      sameOrder.push(observations[index]!)
      index += 1
    }
    const values = sameOrder.flatMap(({ batch }) => batch.values)
    batches.push(batchWithValuesV1(first.batch, values))
  }
  return Object.freeze(batches)
}

function appendAcceptedMessageV1(timeline: MutableTimelineV1, message: RuntimePublisherMessageV1): void {
  const endpoint = endpointTimelineV1(timeline, message.endpointId)
  if (message.type === 'endpoint-lifecycle-v1') {
    if (endpoint.current.records.size > 0) {
      endpoint.entries.push({ kind: 'segment', segment: endpoint.current })
    }
    endpoint.entries.push({ kind: 'barrier', message })
    endpoint.current = { records: new Map() }
    timeline.barrierCount += 1
    return
  }
  timeline.nextOrder += 1
  const order = timeline.nextOrder
  for (const values of groupedValuesV1(message.values)) {
    const key = channelKeyV1(values)
    updateRecordV1(endpoint.current.records, key, batchWithValuesV1(message, values), order)
  }
}

function endpointTimelineMessagesV1(endpoint: EndpointTimelineV1): readonly RuntimePublisherMessageV1[] {
  const messages: RuntimePublisherMessageV1[] = []
  for (const entry of endpoint.entries) {
    if (entry.kind === 'barrier') messages.push(entry.message)
    else messages.push(...flattenRecordsV1(entry.segment.records))
  }
  messages.push(...flattenRecordsV1(endpoint.current.records))
  return Object.freeze(messages)
}

function timelineMessagesByEndpointV1(
  timeline: MutableTimelineV1,
): ReadonlyMap<string, readonly RuntimePublisherMessageV1[]> {
  const result = new Map<string, readonly RuntimePublisherMessageV1[]>()
  for (const [endpointId, endpoint] of [...timeline.endpoints].sort(([left], [right]) => left.localeCompare(right))) {
    const messages = endpointTimelineMessagesV1(endpoint)
    if (messages.length > 0) result.set(endpointId, messages)
  }
  return result
}

function timelineDepthV1(timeline: MutableTimelineV1): number {
  let depth = 0
  for (const endpoint of timeline.endpoints.values()) {
    depth += endpoint.entries.reduce((count, entry) => count + (
      entry.kind === 'barrier' || entry.segment.records.size > 0 ? 1 : 0
    ), 0)
    if (endpoint.current.records.size > 0) depth += 1
  }
  return depth
}

function lifecycleIsNewerV1(message: EndpointLifecycleV1, prior: SessionIdentityV1 | null): boolean {
  return prior === null
    || message.publisherGeneration > prior.publisherGeneration
    || (
      message.publisherGeneration === prior.publisherGeneration
      && message.sessionGeneration > prior.sessionGeneration
    )
}

function admitMessageV1(
  admissions: Map<string, EndpointAdmissionV1>,
  message: RuntimePublisherMessageV1,
): RuntimePublisherMessageV1 | null {
  const admission = admissions.get(message.endpointId) ?? createAdmissionV1()
  admissions.set(message.endpointId, admission)
  if (admission.lastSourceSequence !== null && message.sequence <= admission.lastSourceSequence) return null

  if (message.type === 'endpoint-lifecycle-v1') {
    if (message.phase === 'connected') {
      if (!lifecycleIsNewerV1(message, admission.session)) return null
      admission.lastSourceSequence = message.sequence
      admission.session = Object.freeze({
        publisherGeneration: message.publisherGeneration,
        sessionGeneration: message.sessionGeneration,
      })
      admission.connected = true
      admission.sourceTimestampByChannel.clear()
      admission.publishedTimestampByChannel.clear()
      return message
    }
    if (
      !admission.connected
      || admission.session === null
      || admission.session.publisherGeneration !== message.publisherGeneration
      || admission.session.sessionGeneration !== message.sessionGeneration
    ) return null
    admission.lastSourceSequence = message.sequence
    admission.connected = false
    return message
  }

  if (!admission.connected || message.sourceTimestampMs > message.publishedTimestampMs) return null
  admission.lastSourceSequence = message.sequence
  const acceptedValues: RuntimeMappedValueV1[] = []
  for (const values of groupedValuesV1(message.values)) {
    const key = channelKeyV1(values)
    if (
      message.sourceTimestampMs < (admission.sourceTimestampByChannel.get(key) ?? 0)
      || message.publishedTimestampMs < (admission.publishedTimestampByChannel.get(key) ?? 0)
    ) continue
    admission.sourceTimestampByChannel.set(key, message.sourceTimestampMs)
    admission.publishedTimestampByChannel.set(key, message.publishedTimestampMs)
    acceptedValues.push(...values)
  }
  return acceptedValues.length === 0 ? null : batchWithValuesV1(message, acceptedValues)
}

function predictedMessageBytesV1(message: RuntimePublisherMessageV1): number {
  return encodedBytesV1(JSON.stringify({ ...message, sequence: Number.MAX_SAFE_INTEGER }))
}

function predictedFramedBytesV1(
  messages: readonly RuntimePublisherMessageV1[],
  kind: 'replay' | 'catchup',
): number {
  if (messages.length === 0) return 0
  const bodyBytes = messages.reduce((sum, message) => sum + predictedMessageBytesV1(message), 0)
  const first = messages[0]!
  const common = {
    type: kind === 'replay' ? 'endpoint-replay-boundary-v1' : 'endpoint-catchup-boundary-v1',
    protocolVersion: 1,
    gatewayId: first.gatewayId,
    projectId: first.projectId,
    configRevision: first.configRevision,
    endpointId: first.endpointId,
    sequence: Number.MAX_SAFE_INTEGER,
    ...(kind === 'replay'
      ? { replayId: `replay:${Number.MAX_SAFE_INTEGER}` }
      : { catchupId: `catchup:${Number.MAX_SAFE_INTEGER}` }),
    messageCount: messages.length,
    encodedBytes: bodyBytes,
  }
  return bodyBytes
    + encodedBytesV1(JSON.stringify({ ...common, phase: 'start' }))
    + encodedBytesV1(JSON.stringify({ ...common, phase: 'end' }))
}

function timelineWithinBoundsV1(timeline: MutableTimelineV1): boolean {
  const messagesByEndpoint = timelineMessagesByEndpointV1(timeline)
  if (
    messagesByEndpoint.size > MAX_ENDPOINTS_V1
    || timeline.barrierCount > MAX_PENDING_LIFECYCLE_BARRIERS_V1
  ) return false
  let total = 0
  for (const messages of messagesByEndpoint.values()) {
    const bytes = predictedFramedBytesV1(messages, 'catchup')
    if (bytes > MAX_TIMELINE_BYTES_V1) return false
    total += bytes
  }
  return total <= MAX_TIMELINE_BYTES_V1
}

function appendPublicationToTimelineV1(
  timeline: MutableTimelineV1,
  message: RuntimePublisherMessageV1,
): boolean {
  const accepted = admitMessageV1(timeline.admissions, message)
  if (accepted === null) return false
  appendAcceptedMessageV1(timeline, accepted)
  return true
}

export function createRuntimeTimelineStagingV1(): RuntimeTimelineStagingV1 {
  let timeline = createTimelineV1()
  let failure: Error | null = null
  let sealed = false

  const publish = (publication: NormalizedOpcUaClientPublicationV1): void => {
    if (sealed) {
      failure ??= new Error('RUNTIME_STREAM_TIMELINE_SEALED')
      throw failure
    }
    if (failure !== null) return
    let message: RuntimePublisherMessageV1
    try {
      message = readNormalizedOpcUaClientPublicationV1(publication)
    } catch {
      failure = new Error('RUNTIME_STREAM_BARRIER_CAPACITY_EXCEEDED')
      return
    }
    const candidate = cloneTimelineV1(timeline)
    appendPublicationToTimelineV1(candidate, message)
    if (!timelineWithinBoundsV1(candidate)) {
      failure = new Error('RUNTIME_STREAM_BARRIER_CAPACITY_EXCEEDED')
      return
    }
    timeline = candidate
  }

  const assertHealthy = (): void => {
    if (failure !== null) throw failure
  }

  const seal = (): SealedRuntimeTimelineV1 => {
    assertHealthy()
    if (sealed) throw new Error('RUNTIME_STREAM_TIMELINE_ALREADY_SEALED')
    sealed = true
    const handle = Object.freeze({ [SEALED_RUNTIME_TIMELINE_V1]: true as const })
    sealedRuntimeTimelinesV1.add(handle)
    stagedTimelineDataV1.set(handle, Object.freeze({ messagesByEndpoint: timelineMessagesByEndpointV1(timeline) }))
    return handle
  }

  return Object.freeze({ publish, assertHealthy, seal })
}

function createReplayCacheV1(): EndpointReplayCacheV1 {
  return {
    prefixRecords: new Map(),
    connected: null,
    currentRecords: new Map(),
    disconnected: null,
    lruByChannel: new Map(),
  }
}

function cloneReplayCacheV1(source: EndpointReplayCacheV1): EndpointReplayCacheV1 {
  return {
    prefixRecords: cloneRecordMapV1(source.prefixRecords),
    connected: source.connected,
    currentRecords: cloneRecordMapV1(source.currentRecords),
    disconnected: source.disconnected,
    lruByChannel: new Map(source.lruByChannel),
  }
}

function cloneReplayCachesV1(
  source: ReadonlyMap<string, EndpointReplayCacheV1>,
): Map<string, EndpointReplayCacheV1> {
  return new Map([...source].map(([endpointId, cache]) => [endpointId, cloneReplayCacheV1(cache)]))
}

function mergeRecordMapsV1(
  left: ReadonlyMap<string, ReconstructionRecordV1>,
  right: ReadonlyMap<string, ReconstructionRecordV1>,
): Map<string, ReconstructionRecordV1> {
  const merged = new Map<string, ReconstructionRecordV1>()
  const observations = [...left.values(), ...right.values()]
    .flatMap((record) => observationsForRecordV1(record))
    .sort((a, b) => a.order - b.order || a.channelKey.localeCompare(b.channelKey))
  for (const observation of observations) {
    updateRecordV1(merged, observation.channelKey, observation.batch, observation.order)
  }
  return merged
}

function cacheMessagesV1(cache: EndpointReplayCacheV1): readonly RuntimePublisherMessageV1[] {
  if (cache.connected === null) return Object.freeze([])
  return Object.freeze([
    ...flattenRecordsV1(cache.prefixRecords),
    cache.connected,
    ...flattenRecordsV1(cache.currentRecords),
    ...(cache.disconnected === null ? [] : [cache.disconnected]),
  ])
}

function cacheChannelKeysV1(cache: EndpointReplayCacheV1): ReadonlySet<string> {
  return new Set([...cache.prefixRecords.keys(), ...cache.currentRecords.keys()])
}

function enforceReplayCacheBoundsV1(cache: EndpointReplayCacheV1): void {
  while (
    cacheChannelKeysV1(cache).size > MAX_CACHED_CHANNELS_PER_ENDPOINT_V1
    || predictedFramedBytesV1(cacheMessagesV1(cache), 'replay') > MAX_TIMELINE_BYTES_V1
  ) {
    const oldest = [...cacheChannelKeysV1(cache)]
      .sort((left, right) => (cache.lruByChannel.get(left) ?? 0) - (cache.lruByChannel.get(right) ?? 0)
        || left.localeCompare(right))[0]
    if (oldest === undefined) break
    cache.prefixRecords.delete(oldest)
    cache.currentRecords.delete(oldest)
    cache.lruByChannel.delete(oldest)
  }
}

function applyAcceptedToCacheV1(
  caches: Map<string, EndpointReplayCacheV1>,
  message: RuntimePublisherMessageV1,
  nextOrder: () => number,
): void {
  const cache = caches.get(message.endpointId) ?? createReplayCacheV1()
  caches.set(message.endpointId, cache)
  if (message.type === 'endpoint-lifecycle-v1') {
    if (message.phase === 'connected') {
      const prefix = mergeRecordMapsV1(cache.prefixRecords, cache.currentRecords)
      cache.prefixRecords.clear()
      for (const [key, record] of prefix) cache.prefixRecords.set(key, record)
      cache.currentRecords.clear()
      cache.connected = message
      cache.disconnected = null
    } else {
      cache.disconnected = message
    }
    enforceReplayCacheBoundsV1(cache)
    return
  }
  const order = nextOrder()
  for (const values of groupedValuesV1(message.values)) {
    const key = channelKeyV1(values)
    updateRecordV1(cache.currentRecords, key, batchWithValuesV1(message, values), order)
    cache.lruByChannel.set(key, order)
  }
  enforceReplayCacheBoundsV1(cache)
}

function sameRevisionV1(active: ActiveRevisionV1 | null, projectId: string, configRevision: string): boolean {
  return active !== null && active.projectId === projectId && active.configRevision === configRevision
}

function matchesActivationV1(message: RuntimePublisherMessageV1, active: ActiveRevisionV1 | null): boolean {
  return active !== null
    && message.projectId === active.projectId
    && message.configRevision === active.configRevision
    && message.gatewayId === active.gatewayId
    && message.originId === active.originId
    && active.endpointIds.has(message.endpointId)
    && (message.type !== 'endpoint-lifecycle-v1' || message.publisherGeneration === active.publisherGeneration)
}

function cloneCounterMapV1(source: ReadonlyMap<string, number>): Map<string, number> {
  return new Map(source)
}

function nextSafeCounterV1(
  value: number,
  code: HubRangeErrorV1['code'],
  endpointId: string,
): number {
  const next = value + 1
  if (!Number.isSafeInteger(next) || next < 1) throw new HubRangeErrorV1(code, endpointId)
  return next
}

function encodeMessageBodyV1(
  message: RuntimePublisherMessageV1,
  counters: Map<string, number>,
): readonly string[] {
  const current = counters.get(message.endpointId) ?? 0
  if (message.type === 'state-batch-v1') {
    const first = nextSafeCounterV1(current, 'RUNTIME_STATE_WIRE_SEQUENCE_EXHAUSTED', message.endpointId)
    let chunks: readonly StateBatchV1[]
    try {
      chunks = splitStateBatchesV1(message, first)
    } catch (error) {
      if (String(error).includes('SEQUENCE_EXHAUSTED')) {
        throw new HubRangeErrorV1('RUNTIME_STATE_WIRE_SEQUENCE_EXHAUSTED', message.endpointId)
      }
      throw error
    }
    const last = chunks.at(-1)?.sequence ?? current
    if (!Number.isSafeInteger(last)) {
      throw new HubRangeErrorV1('RUNTIME_STATE_WIRE_SEQUENCE_EXHAUSTED', message.endpointId)
    }
    counters.set(message.endpointId, last)
    return Object.freeze(chunks.map((chunk) => JSON.stringify(chunk)))
  }
  const sequence = nextSafeCounterV1(current, 'RUNTIME_STATE_WIRE_SEQUENCE_EXHAUSTED', message.endpointId)
  counters.set(message.endpointId, sequence)
  return Object.freeze([JSON.stringify({ ...message, sequence })])
}

function encodeUnframedV1(
  message: RuntimePublisherMessageV1,
  counters: Map<string, number>,
): EncodedTransmissionV1 {
  return Object.freeze({
    endpointId: message.endpointId,
    projectId: message.projectId,
    configRevision: message.configRevision,
    frames: encodeMessageBodyV1(message, counters),
  })
}

function encodeFramedV1(
  kind: 'replay' | 'catchup',
  messages: readonly RuntimePublisherMessageV1[],
  counters: Map<string, number>,
  counter: number,
): { readonly transmission: EncodedTransmissionV1; readonly counter: number } {
  const first = messages[0]
  if (first === undefined) throw new Error('RUNTIME_STREAM_EMPTY_ENDPOINT_CUT')
  const counterCode = kind === 'replay'
    ? 'RUNTIME_REPLAY_COUNTER_EXHAUSTED' as const
    : 'RUNTIME_CATCHUP_COUNTER_EXHAUSTED' as const
  const nextCounter = nextSafeCounterV1(counter, counterCode, first.endpointId)
  const startSequence = nextSafeCounterV1(
    counters.get(first.endpointId) ?? 0,
    'RUNTIME_STATE_WIRE_SEQUENCE_EXHAUSTED',
    first.endpointId,
  )
  counters.set(first.endpointId, startSequence)
  const bodyFrames = messages.flatMap((message) => [...encodeMessageBodyV1(message, counters)])
  const endSequence = nextSafeCounterV1(
    counters.get(first.endpointId) ?? 0,
    'RUNTIME_STATE_WIRE_SEQUENCE_EXHAUSTED',
    first.endpointId,
  )
  const bodyBytes = bodyFrames.reduce((sum, frame) => sum + encodedBytesV1(frame), 0)
  const common = {
    protocolVersion: 1 as const,
    gatewayId: first.gatewayId,
    projectId: first.projectId,
    configRevision: first.configRevision,
    endpointId: first.endpointId,
    messageCount: bodyFrames.length,
    encodedBytes: bodyBytes,
  }
  const start: EndpointReplayBoundaryV1 | EndpointCatchupBoundaryV1 = kind === 'replay'
    ? { type: 'endpoint-replay-boundary-v1', ...common, sequence: startSequence, replayId: `replay:${nextCounter}`, phase: 'start' }
    : { type: 'endpoint-catchup-boundary-v1', ...common, sequence: startSequence, catchupId: `catchup:${nextCounter}`, phase: 'start' }
  const end: EndpointReplayBoundaryV1 | EndpointCatchupBoundaryV1 = kind === 'replay'
    ? { type: 'endpoint-replay-boundary-v1', ...common, sequence: endSequence, replayId: `replay:${nextCounter}`, phase: 'end' }
    : { type: 'endpoint-catchup-boundary-v1', ...common, sequence: endSequence, catchupId: `catchup:${nextCounter}`, phase: 'end' }
  counters.set(first.endpointId, endSequence)
  const frames = Object.freeze([JSON.stringify(start), ...bodyFrames, JSON.stringify(end)])
  if (frames.reduce((sum, frame) => sum + encodedBytesV1(frame), 0) > MAX_TIMELINE_BYTES_V1) {
    throw new Error('RUNTIME_STREAM_BARRIER_CAPACITY_EXCEEDED')
  }
  return Object.freeze({
    transmission: Object.freeze({
      endpointId: first.endpointId,
      projectId: first.projectId,
      configRevision: first.configRevision,
      frames,
    }),
    counter: nextCounter,
  })
}

function validInitialCounterV1(value: number | undefined): number {
  const resolved = value ?? 0
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new TypeError('State Batch Hub counter must be a non-negative safe integer.')
  }
  return resolved
}

export function createStateBatchHubV1(options: StateBatchHubOptionsV1 = {}): StateBatchHubV1 {
  const sockets = new Map<GatewayWebSocketV1, SocketStateV1>()
  let activeRevision: ActiveRevisionV1 | null = null
  let activeAdmissions = new Map<string, EndpointAdmissionV1>()
  let replayCaches = new Map<string, EndpointReplayCacheV1>()
  let wireSequenceByEndpoint = new Map<string, number>()
  for (const [endpointId, sequence] of Object.entries(options.initialWireSequenceByEndpoint ?? {})) {
    wireSequenceByEndpoint.set(endpointId, validInitialCounterV1(sequence))
  }
  let replayCounter = validInitialCounterV1(options.initialReplayCounter)
  let catchupCounter = validInitialCounterV1(options.initialCatchupCounter)
  let cacheOrder = 0
  let activationInstalled = false
  let pendingPreparedCuts: readonly EncodedTransmissionV1[] | null = null
  let closed = false

  const nextCacheOrder = (): number => {
    cacheOrder += 1
    if (!Number.isSafeInteger(cacheOrder)) cacheOrder = 1
    return cacheOrder
  }

  const removeListeners = (state: SocketStateV1): void => {
    if (state.listenersRemoved) return
    state.listenersRemoved = true
    try { state.socket.off('close', state.onClose) } catch { /* isolated peer */ }
    try { state.socket.off('error', state.onError) } catch { /* isolated peer */ }
  }

  const detachInternal = (state: SocketStateV1): void => {
    if (state.detached) return
    state.detached = true
    state.current = null
    state.currentFrameIndex = 0
    state.queue.length = 0
    state.pending = createTimelineV1()
    state.holdUntilPreparedFlush = false
    sockets.delete(state.socket)
  }

  const closeDetached = (state: SocketStateV1): void => {
    removeListeners(state)
    try { state.socket.close() } catch { /* isolated peer */ }
  }

  const detachAndClose = (state: SocketStateV1): void => {
    detachInternal(state)
    closeDetached(state)
  }

  const resetWireAfterExhaustion = (endpointId: string): void => {
    const peers = [...sockets.values()]
    for (const state of peers) detachInternal(state)
    wireSequenceByEndpoint.set(endpointId, 0)
    for (const state of peers) closeDetached(state)
  }

  const commitWireCounters = (candidate: Map<string, number>): void => {
    wireSequenceByEndpoint = candidate
  }

  const appendPending = (state: SocketStateV1, message: RuntimePublisherMessageV1): boolean => {
    const candidate = cloneTimelineV1(state.pending)
    appendAcceptedMessageV1(candidate, message)
    if (!timelineWithinBoundsV1(candidate)) {
      detachAndClose(state)
      return false
    }
    state.pending = candidate
    return true
  }

  const freezePending = (state: SocketStateV1): boolean => {
    const messagesByEndpoint = timelineMessagesByEndpointV1(state.pending)
    state.pending = createTimelineV1()
    if (messagesByEndpoint.size === 0) return true
    const stagedWire = cloneCounterMapV1(wireSequenceByEndpoint)
    let stagedCatchup = catchupCounter
    const transmissions: EncodedTransmissionV1[] = []
    try {
      for (const messages of messagesByEndpoint.values()) {
        const encoded = encodeFramedV1('catchup', messages, stagedWire, stagedCatchup)
        stagedCatchup = encoded.counter
        transmissions.push(encoded.transmission)
      }
    } catch (error) {
      if (error instanceof HubRangeErrorV1 && error.code === 'RUNTIME_STATE_WIRE_SEQUENCE_EXHAUSTED') {
        resetWireAfterExhaustion(error.endpointId)
      } else {
        detachAndClose(state)
      }
      return false
    }
    commitWireCounters(stagedWire)
    catchupCounter = stagedCatchup
    state.queue.push(...transmissions)
    return true
  }

  const kick = (state: SocketStateV1): void => {
    if (state.detached || closed || state.holdUntilPreparedFlush || state.current !== null) return
    if (state.queue.length === 0 && !freezePending(state)) return
    const transmission = state.queue.shift()
    if (transmission === undefined) return
    if (!sameRevisionV1(activeRevision, transmission.projectId, transmission.configRevision)) {
      kick(state)
      return
    }
    state.current = transmission
    state.currentFrameIndex = 0

    const sendCurrent = (): void => {
      if (state.detached || state.current === null) return
      const frame = state.current.frames[state.currentFrameIndex]
      if (frame === undefined) return
      try {
        state.socket.send(frame, (error?: Error) => {
          if (state.detached) return
          if (error != null) {
            detachAndClose(state)
            return
          }
          if (state.current === null) return
          state.currentFrameIndex += 1
          if (state.currentFrameIndex < state.current.frames.length) {
            sendCurrent()
            return
          }
          state.current = null
          state.currentFrameIndex = 0
          kick(state)
        })
      } catch {
        detachAndClose(state)
      }
    }
    sendCurrent()
  }

  const attach = (socket: GatewayWebSocketV1): (() => void) => {
    if (closed) {
      try { socket.close() } catch { /* closed Hub */ }
      return () => undefined
    }
    const existing = sockets.get(socket)
    if (existing !== undefined) return () => detachAndClose(existing)
    let state!: SocketStateV1
    const onClose = () => {
      detachInternal(state)
      removeListeners(state)
    }
    const onError = () => {
      detachInternal(state)
      removeListeners(state)
    }
    state = {
      socket,
      onClose,
      onError,
      current: null,
      currentFrameIndex: 0,
      queue: [],
      pending: createTimelineV1(),
      holdUntilPreparedFlush: false,
      detached: false,
      listenersRemoved: false,
    }
    sockets.set(socket, state)
    socket.on('close', onClose)
    socket.on('error', onError)

    if (pendingPreparedCuts !== null) {
      state.holdUntilPreparedFlush = true
      state.queue.push(...pendingPreparedCuts)
    } else if (activeRevision !== null) {
      const stagedWire = cloneCounterMapV1(wireSequenceByEndpoint)
      let stagedReplay = replayCounter
      const transmissions: EncodedTransmissionV1[] = []
      try {
        for (const endpointId of [...replayCaches.keys()].sort((left, right) => left.localeCompare(right))) {
          const cache = replayCaches.get(endpointId)!
          const messages = cacheMessagesV1(cache)
          if (messages.length === 0) continue
          const encoded = encodeFramedV1('replay', messages, stagedWire, stagedReplay)
          stagedReplay = encoded.counter
          transmissions.push(encoded.transmission)
        }
      } catch (error) {
        if (error instanceof HubRangeErrorV1 && error.code === 'RUNTIME_STATE_WIRE_SEQUENCE_EXHAUSTED') {
          resetWireAfterExhaustion(error.endpointId)
        } else {
          detachAndClose(state)
        }
        return () => undefined
      }
      commitWireCounters(stagedWire)
      replayCounter = stagedReplay
      state.queue.push(...transmissions)
      kick(state)
    }
    return () => {
      detachInternal(state)
      removeListeners(state)
    }
  }

  const publishAccepted = (message: RuntimePublisherMessageV1): boolean => {
    applyAcceptedToCacheV1(replayCaches, message, nextCacheOrder)
    if (sockets.size === 0) return true
    const idle: SocketStateV1[] = []
    for (const state of sockets.values()) {
      if (
        state.current !== null
        || state.queue.length > 0
        || state.holdUntilPreparedFlush
      ) {
        appendPending(state, message)
      } else {
        idle.push(state)
      }
    }
    if (idle.length === 0) return true
    const stagedWire = cloneCounterMapV1(wireSequenceByEndpoint)
    let transmission: EncodedTransmissionV1
    try {
      transmission = encodeUnframedV1(message, stagedWire)
    } catch (error) {
      if (error instanceof HubRangeErrorV1) resetWireAfterExhaustion(error.endpointId)
      else for (const state of idle) detachAndClose(state)
      return true
    }
    commitWireCounters(stagedWire)
    for (const state of idle) {
      if (state.detached) continue
      state.queue.push(transmission)
      kick(state)
    }
    return true
  }

  const publishMessage = (message: RuntimePublisherMessageV1): boolean => {
    if (closed || !matchesActivationV1(message, activeRevision)) return false
    const accepted = admitMessageV1(activeAdmissions, message)
    if (accepted === null) return false
    if (accepted.type === 'state-batch-v1' && !isStreamableStateSnapshotV1(accepted)) return false
    return publishAccepted(accepted)
  }

  const publish = (publication: NormalizedOpcUaClientPublicationV1): boolean => {
    if (closed) return false
    try {
      return publishMessage(readNormalizedOpcUaClientPublicationV1(publication))
    } catch {
      return false
    }
  }

  const prepareRevisionActivation = (
    activationOptions: PrepareRevisionActivationOptionsV1,
  ): PreparedRevisionActivationV1 => {
    const handle = activationOptions.stagedTimeline as object
    const stagedData = stagedTimelineDataV1.get(handle)
    if (
      !sealedRuntimeTimelinesV1.has(handle)
      || stagedData === undefined
      || consumedRuntimeTimelinesV1.has(handle)
    ) throw new TypeError('Sealed Runtime timeline is invalid.')
    if (
      typeof activationOptions.projectId !== 'string'
      || activationOptions.projectId.length === 0
      || typeof activationOptions.configRevision !== 'string'
      || activationOptions.configRevision.length === 0
      || typeof activationOptions.gatewayId !== 'string'
      || activationOptions.gatewayId.length === 0
      || typeof activationOptions.originId !== 'string'
      || activationOptions.originId.length === 0
      || !Number.isSafeInteger(activationOptions.publisherGeneration)
      || activationOptions.publisherGeneration < 1
      || activationOptions.endpointIds.length > MAX_ENDPOINTS_V1
      || new Set(activationOptions.endpointIds).size !== activationOptions.endpointIds.length
      || activationOptions.endpointIds.some((endpointId) => typeof endpointId !== 'string' || endpointId.length === 0)
    ) throw new TypeError('Prepared Runtime revision activation is invalid.')
    const activation: ActiveRevisionV1 = Object.freeze({
      projectId: activationOptions.projectId,
      configRevision: activationOptions.configRevision,
      gatewayId: activationOptions.gatewayId,
      originId: activationOptions.originId,
      publisherGeneration: activationOptions.publisherGeneration,
      endpointIds: new Set(activationOptions.endpointIds),
    })
    const differentRevision = !sameRevisionV1(activeRevision, activation.projectId, activation.configRevision)
    const plannedCaches = differentRevision ? new Map<string, EndpointReplayCacheV1>() : cloneReplayCachesV1(replayCaches)
    const plannedAdmissions = new Map<string, EndpointAdmissionV1>()
    const plannedStaged = createTimelineV1()
    let plannedCacheOrder = cacheOrder
    const plannedNextOrder = (): number => {
      plannedCacheOrder += 1
      if (!Number.isSafeInteger(plannedCacheOrder)) plannedCacheOrder = 1
      return plannedCacheOrder
    }
    for (const messages of stagedData.messagesByEndpoint.values()) {
      for (const message of messages) {
        if (!matchesActivationV1(message, activation)) continue
        const accepted = admitMessageV1(plannedAdmissions, message)
        if (accepted === null) continue
        appendAcceptedMessageV1(plannedStaged, accepted)
        applyAcceptedToCacheV1(plannedCaches, accepted, plannedNextOrder)
      }
    }
    if (!timelineWithinBoundsV1(plannedStaged)) {
      throw new Error('RUNTIME_STREAM_BARRIER_CAPACITY_EXCEEDED')
    }
    const plannedWire = differentRevision && activationInstalled
      ? new Map<string, number>()
      : cloneCounterMapV1(wireSequenceByEndpoint)
    let plannedCatchup = catchupCounter
    const plannedPendingCutsBySocket = new Map<SocketStateV1, readonly EncodedTransmissionV1[]>()
    const plannedCuts: EncodedTransmissionV1[] = []
    if (!differentRevision && sockets.size > 0) {
      for (const state of sockets.values()) {
        const pendingCuts: EncodedTransmissionV1[] = []
        for (const messages of timelineMessagesByEndpointV1(state.pending).values()) {
          const encoded = encodeFramedV1('catchup', messages, plannedWire, plannedCatchup)
          plannedCatchup = encoded.counter
          pendingCuts.push(encoded.transmission)
        }
        plannedPendingCutsBySocket.set(state, Object.freeze(pendingCuts))
      }
      for (const messages of timelineMessagesByEndpointV1(plannedStaged).values()) {
        const encoded = encodeFramedV1('catchup', messages, plannedWire, plannedCatchup)
        plannedCatchup = encoded.counter
        plannedCuts.push(encoded.transmission)
      }
    }
    consumedRuntimeTimelinesV1.add(handle)

    let installed = false
    let flushed = false
    let detachedForFlush: SocketStateV1[] = []
    return Object.freeze({
      installPrepared: () => {
        if (installed) return
        installed = true
        if (differentRevision) {
          detachedForFlush = [...sockets.values()]
          for (const state of detachedForFlush) detachInternal(state)
        }
        activeRevision = activation
        activeAdmissions = plannedAdmissions
        replayCaches = plannedCaches
        wireSequenceByEndpoint = plannedWire
        catchupCounter = plannedCatchup
        cacheOrder = plannedCacheOrder
        activationInstalled = true
        if (!differentRevision) {
          for (const state of sockets.values()) {
            state.holdUntilPreparedFlush = true
            const pendingCuts = plannedPendingCutsBySocket.get(state)
            if (pendingCuts !== undefined) {
              state.pending = createTimelineV1()
              state.queue.push(...pendingCuts)
            }
            state.queue.push(...plannedCuts)
          }
          pendingPreparedCuts = plannedCuts.length === 0 ? null : plannedCuts
        }
      },
      flushPrepared: () => {
        if (!installed || flushed) return
        flushed = true
        pendingPreparedCuts = null
        for (const state of detachedForFlush) closeDetached(state)
        detachedForFlush = []
        for (const state of sockets.values()) {
          state.holdUntilPreparedFlush = false
          kick(state)
        }
      },
    })
  }

  const deactivateRevision = (): void => {
    const detached = [...sockets.values()]
    for (const state of detached) detachInternal(state)
    activeRevision = null
    activeAdmissions = new Map()
    replayCaches = new Map()
    wireSequenceByEndpoint = new Map()
    for (const state of detached) closeDetached(state)
  }

  const queueDepth = (socket: GatewayWebSocketV1): number => {
    const state = sockets.get(socket)
    if (state === undefined) return 0
    const current = state.current === null ? 0 : state.current.frames.length - state.currentFrameIndex
    return current
      + state.queue.reduce((count, transmission) => count + transmission.frames.length, 0)
      + timelineDepthV1(state.pending)
  }

  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    const detached = [...sockets.values()]
    for (const state of detached) detachInternal(state)
    activeRevision = null
    activeAdmissions = new Map()
    replayCaches = new Map()
    wireSequenceByEndpoint = new Map()
    for (const state of detached) closeDetached(state)
  }

  return Object.freeze({ attach, deactivateRevision, prepareRevisionActivation, publish, queueDepth, close })
}
