import {
  normalizeRigidTransformV5,
  validateWorkcellProjectV5,
  type RigidTransformV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import {
  createRuntimePoseBufferV1,
  type RuntimePoseBufferV1,
} from '../../../core/runtime-interpolation/v1.js'
import {
  validateStateBatchV1,
  type RuntimeMappedValueV1,
  type RuntimeValueQualityV1,
  type StateBatchV1,
} from '../../../core/runtime-protocol/v1.js'

export type LogicalSignalRuntimeQualityV1 = RuntimeValueQualityV1 | 'STALE'

export interface ObjectFrameRuntimeValueV5 {
  readonly entityId: string
  readonly frameId: string
  readonly worldPose: RigidTransformV5 | null
  readonly quality: LogicalSignalRuntimeQualityV1
  readonly statusCode: string
  readonly owner: 'manual' | 'simulation' | `opcua:${string}` | 'attachment'
  readonly sourceTimestampMs: number
  readonly receivedTimestampMs: number
}

export interface ObjectNumericStatusRuntimeValueV5 {
  readonly entityId: string
  readonly value: number | null
  readonly quality: LogicalSignalRuntimeQualityV1
  readonly statusCode: string
  readonly owner: 'manual' | 'simulation' | `opcua:${string}`
  readonly sourceTimestampMs: number
  readonly receivedTimestampMs: number
}

export interface ObjectRuntimeStateV5 {
  readonly projectRevisionId: string | null
  readonly configRevision: string | null
  replaceProject(project: WorkcellProjectV5, configRevision: string): void
  ingest(batch: StateBatchV1, receivedTimestampMs: number): boolean
  restoreReplayPrefix(batch: StateBatchV1, receivedTimestampMs: number): boolean
  beginEndpointCatchup(endpointId: string, atMs: number): EndpointCatchupGuardV5
  sampleFrame(entityId: string, frameId: string, renderTimestampMs: number): ObjectFrameRuntimeValueV5 | null
  readNumericStatus(entityId: string): ObjectNumericStatusRuntimeValueV5 | null
  markEndpointDisconnected(endpointId: string, atMs: number): void
  resetEndpointSession(endpointId: string, atMs: number): void
  resetGatewaySession(atMs: number): void
}

export interface EndpointCatchupGuardV5 {
  commit(): void
  abort(): void
}

interface FrameChannelV5 {
  readonly mappingId: string
  readonly endpointId: string
  readonly entityId: string
  readonly frameId: string
  readonly publishingIntervalMs: number
  buffer: RuntimePoseBufferV1
  heldPose: RigidTransformV5 | null
  displayPose: RigidTransformV5 | null
  displaySourceTimestampMs: number
  sourceTimestampMs: number
  sourceFenceTimestampMs: number
  publishedFenceTimestampMs: number
  receivedTimestampMs: number
  quality: LogicalSignalRuntimeQualityV1
  statusCode: string
}

interface StatusChannelV5 {
  readonly mappingId: string
  readonly endpointId: string
  readonly entityId: string
  value: number | null
  sourceTimestampMs: number
  sourceFenceTimestampMs: number
  publishedFenceTimestampMs: number
  receivedTimestampMs: number
  quality: LogicalSignalRuntimeQualityV1
  statusCode: string
}

type ObjectCatchupEventV5 =
  | Readonly<{ kind: 'frame'; mappingId: string; mapped: RuntimeMappedValueV1; batch: StateBatchV1; receivedTimestampMs: number }>
  | Readonly<{ kind: 'status'; mappingId: string; mapped: RuntimeMappedValueV1; batch: StateBatchV1; receivedTimestampMs: number }>
  | Readonly<{ kind: 'connected'; atMs: number }>
  | Readonly<{ kind: 'disconnected'; atMs: number }>

interface ObjectCatchupStateV5 {
  readonly frameCandidates: ReadonlyMap<string, FrameChannelV5>
  readonly statusCandidates: ReadonlyMap<string, StatusChannelV5>
  readonly events: ObjectCatchupEventV5[]
  readonly touched: Set<string>
  readonly sequence: number | undefined
  readonly receipt: number | undefined
  readonly atMs: number
  active: boolean
}

interface ObjectRuntimeContextV5 {
  readonly project: WorkcellProjectV5
  readonly configRevision: string
  readonly frameChannelsByMappingId: ReadonlyMap<string, FrameChannelV5>
  readonly statusChannelsByMappingId: ReadonlyMap<string, StatusChannelV5>
  readonly frameChannelsByKey: ReadonlyMap<string, FrameChannelV5>
  readonly statusChannelsByEntityId: ReadonlyMap<string, StatusChannelV5>
  readonly frameChannelsByEndpoint: ReadonlyMap<string, readonly FrameChannelV5[]>
  readonly statusChannelsByEndpoint: ReadonlyMap<string, readonly StatusChannelV5[]>
  readonly enabledEndpointIds: ReadonlySet<string>
  readonly endpointSequences: Map<string, number>
  readonly endpointReceiptFences: Map<string, number>
}

const CONFIG_REVISION_PATTERN = /^[0-9a-f]{64}$/u

function frameKey(entityId: string, frameId: string): string {
  return `${entityId}\u0000${frameId}`
}

function requireConfigRevision(configRevision: string): string {
  if (!CONFIG_REVISION_PATTERN.test(configRevision)) {
    throw new TypeError('Config revision must be a lowercase 64-character hexadecimal digest.')
  }
  return configRevision
}

function requireTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer.`)
  return value
}

function appendByEndpoint<T extends { readonly endpointId: string }>(channelsByEndpoint: Map<string, T[]>, channel: T): void {
  const channels = channelsByEndpoint.get(channel.endpointId) ?? []
  channels.push(channel)
  channelsByEndpoint.set(channel.endpointId, channels)
}

function compileContext(projectInput: WorkcellProjectV5, configRevision: string): ObjectRuntimeContextV5 {
  const project = validateWorkcellProjectV5(projectInput)
  const revision = requireConfigRevision(configRevision)
  const enabledEndpoints = new Map(
    project.opcUa.endpoints.filter((endpoint) => endpoint.enabled).map((endpoint) => [endpoint.endpointId, endpoint]),
  )
  const frameChannelsByMappingId = new Map<string, FrameChannelV5>()
  const statusChannelsByMappingId = new Map<string, StatusChannelV5>()
  const frameChannelsByKey = new Map<string, FrameChannelV5>()
  const statusChannelsByEntityId = new Map<string, StatusChannelV5>()
  const frameChannelsByEndpoint = new Map<string, FrameChannelV5[]>()
  const statusChannelsByEndpoint = new Map<string, StatusChannelV5[]>()

  for (const mapping of project.opcUa.mappings) {
    const endpoint = enabledEndpoints.get(mapping.endpointId)
    const target = mapping.leaves[0]?.projectTarget
    if (endpoint === undefined || (mapping.direction !== 'read' && mapping.direction !== 'readWrite') || target === undefined) continue
    if (target.type === 'entity-frame') {
      const publishingIntervalMs = mapping.publishingIntervalMs ?? endpoint.publishingIntervalMs
      const channel: FrameChannelV5 = {
        mappingId: mapping.id,
        endpointId: mapping.endpointId,
        entityId: target.entityId,
        frameId: target.frameId,
        publishingIntervalMs,
        buffer: createRuntimePoseBufferV1(frameKey(target.entityId, target.frameId), publishingIntervalMs),
        heldPose: null,
        displayPose: null,
        displaySourceTimestampMs: 0,
        sourceTimestampMs: 0,
        sourceFenceTimestampMs: 0,
        publishedFenceTimestampMs: 0,
        receivedTimestampMs: 0,
        quality: 'BAD',
        statusCode: 'BadWaitingForInitialData',
      }
      frameChannelsByMappingId.set(mapping.id, channel)
      frameChannelsByKey.set(frameKey(target.entityId, target.frameId), channel)
      appendByEndpoint(frameChannelsByEndpoint, channel)
    } else if (target.type === 'entity-status') {
      const channel: StatusChannelV5 = {
        mappingId: mapping.id,
        endpointId: mapping.endpointId,
        entityId: target.entityId,
        value: null,
        sourceTimestampMs: 0,
        sourceFenceTimestampMs: 0,
        publishedFenceTimestampMs: 0,
        receivedTimestampMs: 0,
        quality: 'BAD',
        statusCode: 'BadWaitingForInitialData',
      }
      statusChannelsByMappingId.set(mapping.id, channel)
      statusChannelsByEntityId.set(target.entityId, channel)
      appendByEndpoint(statusChannelsByEndpoint, channel)
    }
  }

  return Object.freeze({
    project,
    configRevision: revision,
    frameChannelsByMappingId,
    statusChannelsByMappingId,
    frameChannelsByKey,
    statusChannelsByEntityId,
    frameChannelsByEndpoint: new Map([...frameChannelsByEndpoint].map(([key, value]) => [key, Object.freeze(value)])),
    statusChannelsByEndpoint: new Map([...statusChannelsByEndpoint].map(([key, value]) => [key, Object.freeze(value)])),
    enabledEndpointIds: new Set(enabledEndpoints.keys()),
    endpointSequences: new Map(),
    endpointReceiptFences: new Map(),
  })
}

function canonicalPose(value: RuntimeMappedValueV1['value']): RigidTransformV5 | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.positionM) || record.positionM.length !== 3 || !Array.isArray(record.quaternion) || record.quaternion.length !== 4) return null
  if (![...record.positionM, ...record.quaternion].every((component) => typeof component === 'number' && Number.isFinite(component))) return null
  try {
    const normalized = normalizeRigidTransformV5({
      positionM: [record.positionM[0] as number, record.positionM[1] as number, record.positionM[2] as number],
      quaternion: [record.quaternion[0] as number, record.quaternion[1] as number, record.quaternion[2] as number, record.quaternion[3] as number],
    }, '$.value')
    return Object.freeze({
      positionM: Object.freeze([...normalized.positionM]) as RigidTransformV5['positionM'],
      quaternion: Object.freeze([...normalized.quaternion]) as RigidTransformV5['quaternion'],
    })
  } catch {
    return null
  }
}

function updateFrameChannel(channel: FrameChannelV5, mapped: RuntimeMappedValueV1, batch: StateBatchV1, receivedTimestampMs: number): void {
  let quality: LogicalSignalRuntimeQualityV1 = mapped.quality
  let statusCode = mapped.statusCode
  if (mapped.quality === 'GOOD') {
    const pose = canonicalPose(mapped.value)
    if (pose === null || !channel.buffer.push({ sequence: batch.sequence, sourceTimestampMs: batch.sourceTimestampMs, receivedTimestampMs, pose })) {
      quality = 'BAD'
      statusCode = 'BadTypeMismatch'
    } else {
      channel.heldPose = pose
      channel.displayPose = pose
    }
  }
  const firstInSession = channel.sourceFenceTimestampMs === 0
  channel.sourceFenceTimestampMs = batch.sourceTimestampMs
  channel.publishedFenceTimestampMs = batch.publishedTimestampMs
  channel.sourceTimestampMs = firstInSession ? batch.sourceTimestampMs : Math.max(channel.sourceTimestampMs, batch.sourceTimestampMs)
  channel.receivedTimestampMs = Math.max(channel.receivedTimestampMs, receivedTimestampMs)
  channel.quality = quality
  channel.statusCode = statusCode
}

function updateStatusChannel(channel: StatusChannelV5, mapped: RuntimeMappedValueV1, batch: StateBatchV1, receivedTimestampMs: number): void {
  let quality: LogicalSignalRuntimeQualityV1 = mapped.quality
  let statusCode = mapped.statusCode
  if (mapped.quality === 'GOOD') {
    if (typeof mapped.value !== 'number' || !Number.isFinite(mapped.value)) {
      quality = 'BAD'
      statusCode = 'BadTypeMismatch'
    } else channel.value = mapped.value
  }
  const firstInSession = channel.sourceFenceTimestampMs === 0
  channel.sourceFenceTimestampMs = batch.sourceTimestampMs
  channel.publishedFenceTimestampMs = batch.publishedTimestampMs
  channel.sourceTimestampMs = firstInSession ? batch.sourceTimestampMs : Math.max(channel.sourceTimestampMs, batch.sourceTimestampMs)
  channel.receivedTimestampMs = Math.max(channel.receivedTimestampMs, receivedTimestampMs)
  channel.quality = quality
  channel.statusCode = statusCode
}

function updateFrameCandidate(channel: FrameChannelV5, mapped: RuntimeMappedValueV1, batch: StateBatchV1, receivedTimestampMs: number): void {
  let quality: LogicalSignalRuntimeQualityV1 = mapped.quality
  let statusCode = mapped.statusCode
  if (mapped.quality === 'GOOD') {
    const pose = canonicalPose(mapped.value)
    if (pose === null) {
      quality = 'BAD'
      statusCode = 'BadTypeMismatch'
    } else {
      channel.heldPose = pose
      channel.displayPose = pose
    }
  }
  const firstInSession = channel.sourceFenceTimestampMs === 0
  channel.sourceFenceTimestampMs = batch.sourceTimestampMs
  channel.publishedFenceTimestampMs = batch.publishedTimestampMs
  channel.sourceTimestampMs = firstInSession ? batch.sourceTimestampMs : Math.max(channel.sourceTimestampMs, batch.sourceTimestampMs)
  channel.receivedTimestampMs = Math.max(channel.receivedTimestampMs, receivedTimestampMs)
  channel.quality = quality
  channel.statusCode = statusCode
}

function markFrameDisconnected(channel: FrameChannelV5, atMs: number): void {
  channel.quality = 'STALE'
  channel.statusCode = 'BadNoCommunication'
  channel.receivedTimestampMs = Math.max(channel.receivedTimestampMs, atMs)
}

function markStatusDisconnected(channel: StatusChannelV5, atMs: number): void {
  channel.quality = 'STALE'
  channel.statusCode = 'BadNoCommunication'
  channel.receivedTimestampMs = Math.max(channel.receivedTimestampMs, atMs)
}

function resetFrameSession(channel: FrameChannelV5, atMs: number): void {
  channel.heldPose = channel.displayPose ?? channel.heldPose
  channel.buffer = createRuntimePoseBufferV1(frameKey(channel.entityId, channel.frameId), channel.publishingIntervalMs)
  channel.displaySourceTimestampMs = 0
  channel.sourceFenceTimestampMs = 0
  channel.publishedFenceTimestampMs = 0
  channel.receivedTimestampMs = Math.max(channel.receivedTimestampMs, atMs)
  channel.quality = 'BAD'
  channel.statusCode = 'BadWaitingForInitialData'
}

function resetStatusSession(channel: StatusChannelV5, atMs: number): void {
  channel.sourceFenceTimestampMs = 0
  channel.publishedFenceTimestampMs = 0
  channel.receivedTimestampMs = Math.max(channel.receivedTimestampMs, atMs)
  channel.quality = 'BAD'
  channel.statusCode = 'BadWaitingForInitialData'
}

function restorePrefixFrameChannel(channel: FrameChannelV5, mapped: RuntimeMappedValueV1, batch: StateBatchV1, receivedTimestampMs: number): void {
  let quality: LogicalSignalRuntimeQualityV1 = mapped.quality
  let statusCode = mapped.statusCode
  if (mapped.quality === 'GOOD') {
    const pose = canonicalPose(mapped.value)
    if (pose === null) {
      quality = 'BAD'
      statusCode = 'BadTypeMismatch'
    } else {
      // Prefix data reconstructs retained display state.  It deliberately
      // bypasses the live interpolation and sequence/clock fences.
      channel.heldPose = pose
      channel.displayPose = pose
      channel.displaySourceTimestampMs = batch.sourceTimestampMs
    }
  }
  channel.sourceTimestampMs = batch.sourceTimestampMs
  channel.receivedTimestampMs = receivedTimestampMs
  channel.quality = quality
  channel.statusCode = statusCode
}

function restorePrefixStatusChannel(channel: StatusChannelV5, mapped: RuntimeMappedValueV1, batch: StateBatchV1, receivedTimestampMs: number): void {
  let quality: LogicalSignalRuntimeQualityV1 = mapped.quality
  let statusCode = mapped.statusCode
  if (mapped.quality === 'GOOD') {
    if (typeof mapped.value !== 'number' || !Number.isFinite(mapped.value)) {
      quality = 'BAD'
      statusCode = 'BadTypeMismatch'
    } else channel.value = mapped.value
  }
  channel.sourceTimestampMs = batch.sourceTimestampMs
  channel.receivedTimestampMs = receivedTimestampMs
  channel.quality = quality
  channel.statusCode = statusCode
}

export function createObjectRuntimeStateV5(projectInput: WorkcellProjectV5, configRevision: string): ObjectRuntimeStateV5 {
  let context = compileContext(projectInput, configRevision)
  let guardEpoch = 0
  const guardsByEndpoint = new Map<string, ObjectCatchupStateV5>()
  const noOpGuardsByEndpoint = new Set<string>()

  const ingest = (batchInput: StateBatchV1, receiptCandidate: number): boolean => {
    const batch = validateStateBatchV1(batchInput)
    const receivedTimestampMs = requireTimestamp(receiptCandidate, 'Receipt timestamp')
    if (
      batch.projectId !== context.project.projectId
      || batch.configRevision !== context.configRevision
      || batch.sequence <= (context.endpointSequences.get(batch.endpointId) ?? 0)
      || receivedTimestampMs < (context.endpointReceiptFences.get(batch.endpointId) ?? 0)
    ) return false
    const guard = guardsByEndpoint.get(batch.endpointId)
    const frames = batch.values.flatMap((mapped) => {
      const channel = context.frameChannelsByMappingId.get(mapped.mappingId)
      if (channel?.endpointId !== batch.endpointId) return []
      return [[guard?.frameCandidates.get(channel.mappingId) ?? channel, mapped] as const]
    })
    const statuses = batch.values.flatMap((mapped) => {
      const channel = context.statusChannelsByMappingId.get(mapped.mappingId)
      if (channel?.endpointId !== batch.endpointId) return []
      return [[guard?.statusCandidates.get(channel.mappingId) ?? channel, mapped] as const]
    })
    if (frames.length === 0 && statuses.length === 0) return false
    if (batch.sourceTimestampMs > batch.publishedTimestampMs) return false
    const grouped = new Map<string, Array<(typeof frames)[number] | (typeof statuses)[number]>>()
    for (const entry of [...frames, ...statuses]) {
      const key = entry[1].coherenceGroupId === null
        ? `mapping:${entry[0].mappingId}`
        : `coherence:${entry[1].coherenceGroupId}`
      const group = grouped.get(key) ?? []
      group.push(entry)
      grouped.set(key, group)
    }
    const accepted = [...grouped.values()].flatMap((group) => group.some(([channel]) => (
      batch.sourceTimestampMs < channel.sourceFenceTimestampMs
      || batch.publishedTimestampMs < channel.publishedFenceTimestampMs
    )) ? [] : group)
    if (accepted.length === 0) return false

    const acceptedFrames = accepted.filter((entry): entry is (typeof frames)[number] => 'buffer' in entry[0])
    const acceptedStatuses = accepted.filter((entry): entry is (typeof statuses)[number] => !('buffer' in entry[0]))
    if (guard === undefined) {
      acceptedFrames.forEach(([channel, mapped]) => updateFrameChannel(channel, mapped, batch, receivedTimestampMs))
      acceptedStatuses.forEach(([channel, mapped]) => updateStatusChannel(channel, mapped, batch, receivedTimestampMs))
    } else {
      for (const [channel, mapped] of acceptedFrames) {
        updateFrameCandidate(channel, mapped, batch, receivedTimestampMs)
        guard.touched.add(channel.mappingId)
        guard.events.push(Object.freeze({ kind: 'frame', mappingId: channel.mappingId, mapped, batch, receivedTimestampMs }))
      }
      for (const [channel, mapped] of acceptedStatuses) {
        updateStatusChannel(channel, mapped, batch, receivedTimestampMs)
        guard.touched.add(channel.mappingId)
        guard.events.push(Object.freeze({ kind: 'status', mappingId: channel.mappingId, mapped, batch, receivedTimestampMs }))
      }
    }
    context.endpointSequences.set(batch.endpointId, batch.sequence)
    context.endpointReceiptFences.set(batch.endpointId, receivedTimestampMs)
    return true
  }

  const markEndpointDisconnected = (endpointId: string, atCandidate: number): void => {
    const atMs = requireTimestamp(atCandidate, 'Disconnect timestamp')
    const guard = guardsByEndpoint.get(endpointId)
    if (guard !== undefined) {
      for (const channel of guard.frameCandidates.values()) {
        markFrameDisconnected(channel, atMs)
        guard.touched.add(channel.mappingId)
      }
      for (const channel of guard.statusCandidates.values()) {
        markStatusDisconnected(channel, atMs)
        guard.touched.add(channel.mappingId)
      }
      guard.events.push(Object.freeze({ kind: 'disconnected', atMs }))
      return
    }
    for (const channel of context.frameChannelsByEndpoint.get(endpointId) ?? []) {
      markFrameDisconnected(channel, atMs)
    }
    for (const channel of context.statusChannelsByEndpoint.get(endpointId) ?? []) {
      markStatusDisconnected(channel, atMs)
    }
  }

  const resetEndpointSession = (endpointId: string, atCandidate: number): void => {
    const atMs = requireTimestamp(atCandidate, 'Endpoint reset timestamp')
    const guard = guardsByEndpoint.get(endpointId)
    if (guard === undefined) {
      for (const channel of context.frameChannelsByEndpoint.get(endpointId) ?? []) resetFrameSession(channel, atMs)
      for (const channel of context.statusChannelsByEndpoint.get(endpointId) ?? []) resetStatusSession(channel, atMs)
    } else {
      for (const channel of guard.frameCandidates.values()) {
        resetFrameSession(channel, atMs)
        guard.touched.add(channel.mappingId)
      }
      for (const channel of guard.statusCandidates.values()) {
        resetStatusSession(channel, atMs)
        guard.touched.add(channel.mappingId)
      }
      guard.events.push(Object.freeze({ kind: 'connected', atMs }))
    }
    context.endpointSequences.delete(endpointId)
    context.endpointReceiptFences.delete(endpointId)
  }

  const restoreReplayPrefix = (batchInput: StateBatchV1, receiptCandidate: number): boolean => {
    const batch = validateStateBatchV1(batchInput)
    const receivedTimestampMs = requireTimestamp(receiptCandidate, 'Replay receipt timestamp')
    if (
      batch.projectId !== context.project.projectId
      || batch.configRevision !== context.configRevision
      || batch.sourceTimestampMs > batch.publishedTimestampMs
    ) return false
    const frames = batch.values.flatMap((mapped) => {
      const channel = context.frameChannelsByMappingId.get(mapped.mappingId)
      return channel?.endpointId === batch.endpointId ? [[channel, mapped] as const] : []
    })
    const statuses = batch.values.flatMap((mapped) => {
      const channel = context.statusChannelsByMappingId.get(mapped.mappingId)
      return channel?.endpointId === batch.endpointId ? [[channel, mapped] as const] : []
    })
    if (frames.length === 0 && statuses.length === 0) return false
    frames.forEach(([channel, mapped]) => restorePrefixFrameChannel(channel, mapped, batch, receivedTimestampMs))
    statuses.forEach(([channel, mapped]) => restorePrefixStatusChannel(channel, mapped, batch, receivedTimestampMs))
    return true
  }

  const beginEndpointCatchup = (endpointId: string, atCandidate: number): EndpointCatchupGuardV5 => {
    const atMs = requireTimestamp(atCandidate, 'Catch-up timestamp')
    const frames = context.frameChannelsByEndpoint.get(endpointId) ?? []
    const statuses = context.statusChannelsByEndpoint.get(endpointId) ?? []
    if (!context.enabledEndpointIds.has(endpointId)) throw new Error('ENDPOINT_CATCHUP_UNKNOWN_ENDPOINT')
    if (guardsByEndpoint.has(endpointId) || noOpGuardsByEndpoint.has(endpointId)) throw new Error('ENDPOINT_CATCHUP_ALREADY_ACTIVE')
    const epoch = guardEpoch
    if (frames.length === 0 && statuses.length === 0) {
      let active = true
      noOpGuardsByEndpoint.add(endpointId)
      const finish = (): void => {
        if (!active || epoch !== guardEpoch) return
        active = false
        noOpGuardsByEndpoint.delete(endpointId)
      }
      return Object.freeze({ commit: finish, abort: finish })
    }
    const guard: ObjectCatchupStateV5 = {
      frameCandidates: new Map(frames.map((channel) => [channel.mappingId, { ...channel }])),
      statusCandidates: new Map(statuses.map((channel) => [channel.mappingId, { ...channel }])),
      events: [], touched: new Set<string>(),
      sequence: context.endpointSequences.get(endpointId), receipt: context.endpointReceiptFences.get(endpointId),
      atMs, active: true,
    }
    guardsByEndpoint.set(endpointId, guard)
    return Object.freeze({
      commit: () => {
        if (!guard.active || epoch !== guardEpoch) return
        guard.active = false
        for (const event of guard.events) {
          if (event.kind === 'connected') {
            for (const channel of frames) resetFrameSession(channel, event.atMs)
            for (const channel of statuses) resetStatusSession(channel, event.atMs)
          } else if (event.kind === 'disconnected') {
            for (const channel of frames) markFrameDisconnected(channel, event.atMs)
            for (const channel of statuses) markStatusDisconnected(channel, event.atMs)
          } else if (event.kind === 'frame') {
            const channel = context.frameChannelsByMappingId.get(event.mappingId)
            if (channel !== undefined) updateFrameChannel(channel, event.mapped, event.batch, event.receivedTimestampMs)
          } else {
            const channel = context.statusChannelsByMappingId.get(event.mappingId)
            if (channel !== undefined) updateStatusChannel(channel, event.mapped, event.batch, event.receivedTimestampMs)
          }
        }
        guardsByEndpoint.delete(endpointId)
      },
      abort: () => {
        if (!guard.active || epoch !== guardEpoch) return
        guard.active = false
        guardsByEndpoint.delete(endpointId)
        if (guard.sequence === undefined) context.endpointSequences.delete(endpointId)
        else context.endpointSequences.set(endpointId, guard.sequence)
        if (guard.receipt === undefined) context.endpointReceiptFences.delete(endpointId)
        else context.endpointReceiptFences.set(endpointId, guard.receipt)
        // A failed frame restores its pre-cut payload then becomes durably stale.
        markEndpointDisconnected(endpointId, atMs)
      },
    })
  }

  const resetGatewaySession = (atCandidate: number): void => {
    const atMs = requireTimestamp(atCandidate, 'Reset timestamp')
    for (const channel of context.frameChannelsByMappingId.values()) {
      channel.heldPose = channel.displayPose ?? channel.heldPose
      channel.buffer = createRuntimePoseBufferV1(frameKey(channel.entityId, channel.frameId), channel.publishingIntervalMs)
      channel.displaySourceTimestampMs = 0
      channel.sourceFenceTimestampMs = 0
      channel.publishedFenceTimestampMs = 0
      channel.receivedTimestampMs = Math.max(channel.receivedTimestampMs, atMs)
      channel.quality = 'BAD'
      channel.statusCode = 'BadWaitingForInitialData'
    }
    for (const channel of context.statusChannelsByMappingId.values()) {
      channel.sourceFenceTimestampMs = 0
      channel.publishedFenceTimestampMs = 0
      channel.receivedTimestampMs = Math.max(channel.receivedTimestampMs, atMs)
      channel.quality = 'BAD'
      channel.statusCode = 'BadWaitingForInitialData'
    }
    context.endpointSequences.clear()
    context.endpointReceiptFences.clear()
    guardsByEndpoint.clear()
    noOpGuardsByEndpoint.clear()
    guardEpoch += 1
  }

  const sampleFrame = (entityId: string, frameId: string, renderCandidate: number): ObjectFrameRuntimeValueV5 | null => {
    const renderTimestampMs = requireTimestamp(renderCandidate, 'Render timestamp')
    const channel = context.frameChannelsByKey.get(frameKey(entityId, frameId))
    if (channel === undefined) return null
    const sample = channel.heldPose === null ? null : channel.buffer.sample(renderTimestampMs)
    if (sample !== null) {
      channel.displayPose = sample.pose
      channel.displaySourceTimestampMs = Math.max(channel.displaySourceTimestampMs, sample.sourceTimestampMs)
    }
    const guard = guardsByEndpoint.get(channel.endpointId)
    const quarantined = guard !== undefined
    const bufferIsStale = sample?.quality === 'STALE'
    const quality = quarantined || (channel.quality === 'GOOD' && bufferIsStale) ? 'STALE' : channel.quality
    return Object.freeze({
      entityId,
      frameId,
      worldPose: sample?.pose ?? channel.displayPose ?? channel.heldPose,
      quality,
      statusCode: quality === 'STALE' && (quarantined || channel.quality === 'GOOD') ? 'BadNoCommunication' : channel.statusCode,
      owner: `opcua:${channel.endpointId}`,
      sourceTimestampMs: channel.quality === 'GOOD' && sample?.quality === 'GOOD'
        ? channel.displaySourceTimestampMs
        : channel.sourceTimestampMs,
      receivedTimestampMs: guard === undefined ? channel.receivedTimestampMs : Math.max(channel.receivedTimestampMs, guard.atMs),
    })
  }

  const readNumericStatus = (entityId: string): ObjectNumericStatusRuntimeValueV5 | null => {
    const channel = context.statusChannelsByEntityId.get(entityId)
    if (channel === undefined) return null
    const guard = guardsByEndpoint.get(channel.endpointId)
    return Object.freeze({
      entityId,
      value: channel.value,
      quality: guard === undefined ? channel.quality : 'STALE',
      statusCode: guard === undefined ? channel.statusCode : 'BadNoCommunication',
      owner: `opcua:${channel.endpointId}`,
      sourceTimestampMs: channel.sourceTimestampMs,
      receivedTimestampMs: guard === undefined ? channel.receivedTimestampMs : Math.max(channel.receivedTimestampMs, guard.atMs),
    })
  }

  return Object.freeze({
    get projectRevisionId() { return context.project.revisionId },
    get configRevision() { return context.configRevision },
    ingest,
    restoreReplayPrefix,
    beginEndpointCatchup,
    markEndpointDisconnected,
    resetEndpointSession,
    resetGatewaySession,
    replaceProject: (nextProjectInput: WorkcellProjectV5, nextConfigRevision: string) => {
      const nextContext = compileContext(nextProjectInput, nextConfigRevision)
      context = nextContext
      guardsByEndpoint.clear()
      noOpGuardsByEndpoint.clear()
      guardEpoch += 1
    },
    sampleFrame,
    readNumericStatus,
  })
}
