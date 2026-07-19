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

export interface RobotFrameRuntimeValueV5 {
  readonly robotId: string
  readonly frameId: string
  readonly worldPose: RigidTransformV5 | null
  readonly quality: LogicalSignalRuntimeQualityV1
  readonly statusCode: string
  readonly owner: 'manual' | 'simulation' | `opcua:${string}`
  readonly sourceTimestampMs: number
  readonly receivedTimestampMs: number
}

export interface RobotFrameStatusRuntimeStoreV5 {
  readonly projectRevisionId: string | null
  readonly configRevision: string | null
  replaceProject(project: WorkcellProjectV5, configRevision: string): void
  ingest(batch: StateBatchV1, receivedTimestampMs: number): boolean
  sampleFrame(robotId: string, frameId: string, renderTimestampMs: number): RobotFrameRuntimeValueV5 | null
  readNumericStatus(robotId: string): Readonly<{
    value: number | null
    quality: LogicalSignalRuntimeQualityV1
    statusCode: string
    owner: 'manual' | 'simulation' | `opcua:${string}`
  }> | null
  markEndpointDisconnected(endpointId: string, atMs: number): void
  resetGatewaySession(atMs: number): void
}

interface FrameChannelV5 {
  readonly mappingId: string
  readonly endpointId: string
  readonly robotId: string
  readonly frameId: string
  readonly publishingIntervalMs: number
  buffer: RuntimePoseBufferV1
  heldPose: RigidTransformV5 | null
  displayPose: RigidTransformV5 | null
  displaySourceTimestampMs: number
  sourceTimestampMs: number
  sourceFenceTimestampMs: number
  receivedTimestampMs: number
  quality: LogicalSignalRuntimeQualityV1
  statusCode: string
}

interface StatusChannelV5 {
  readonly mappingId: string
  readonly endpointId: string
  readonly robotId: string
  value: number | null
  sourceTimestampMs: number
  sourceFenceTimestampMs: number
  receivedTimestampMs: number
  quality: LogicalSignalRuntimeQualityV1
  statusCode: string
}

interface RobotRuntimeContextV5 {
  readonly project: WorkcellProjectV5
  readonly configRevision: string
  readonly frameChannelsByMappingId: ReadonlyMap<string, FrameChannelV5>
  readonly statusChannelsByMappingId: ReadonlyMap<string, StatusChannelV5>
  readonly frameChannelsByKey: ReadonlyMap<string, FrameChannelV5>
  readonly statusChannelsByRobotId: ReadonlyMap<string, StatusChannelV5>
  readonly frameChannelsByEndpoint: ReadonlyMap<string, readonly FrameChannelV5[]>
  readonly statusChannelsByEndpoint: ReadonlyMap<string, readonly StatusChannelV5[]>
  readonly endpointSequences: Map<string, number>
  readonly endpointReceiptFences: Map<string, number>
}

const CONFIG_REVISION_PATTERN = /^[0-9a-f]{64}$/u

function frameKey(robotId: string, frameId: string): string {
  return `${robotId}\u0000${frameId}`
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

function compileContext(projectInput: WorkcellProjectV5, configRevision: string): RobotRuntimeContextV5 {
  const project = validateWorkcellProjectV5(projectInput)
  const revision = requireConfigRevision(configRevision)
  const enabledEndpoints = new Map(
    project.opcUa.endpoints.filter((endpoint) => endpoint.enabled).map((endpoint) => [endpoint.endpointId, endpoint]),
  )
  const frameChannelsByMappingId = new Map<string, FrameChannelV5>()
  const statusChannelsByMappingId = new Map<string, StatusChannelV5>()
  const frameChannelsByKey = new Map<string, FrameChannelV5>()
  const statusChannelsByRobotId = new Map<string, StatusChannelV5>()
  const frameChannelsByEndpoint = new Map<string, FrameChannelV5[]>()
  const statusChannelsByEndpoint = new Map<string, StatusChannelV5[]>()

  for (const mapping of project.opcUa.mappings) {
    const endpoint = enabledEndpoints.get(mapping.endpointId)
    const target = mapping.leaves[0]?.projectTarget
    if (endpoint === undefined || (mapping.direction !== 'read' && mapping.direction !== 'readWrite') || target === undefined) continue
    if (target.type === 'robot-frame') {
      const publishingIntervalMs = mapping.publishingIntervalMs ?? endpoint.publishingIntervalMs
      const channel: FrameChannelV5 = {
        mappingId: mapping.id,
        endpointId: mapping.endpointId,
        robotId: target.robotId,
        frameId: target.frameId,
        publishingIntervalMs,
        buffer: createRuntimePoseBufferV1(frameKey(target.robotId, target.frameId), publishingIntervalMs),
        heldPose: null,
        displayPose: null,
        displaySourceTimestampMs: 0,
        sourceTimestampMs: 0,
        sourceFenceTimestampMs: 0,
        receivedTimestampMs: 0,
        quality: 'BAD',
        statusCode: 'BadWaitingForInitialData',
      }
      frameChannelsByMappingId.set(mapping.id, channel)
      frameChannelsByKey.set(frameKey(target.robotId, target.frameId), channel)
      appendByEndpoint(frameChannelsByEndpoint, channel)
    } else if (target.type === 'robot-status') {
      const channel: StatusChannelV5 = {
        mappingId: mapping.id,
        endpointId: mapping.endpointId,
        robotId: target.robotId,
        value: null,
        sourceTimestampMs: 0,
        sourceFenceTimestampMs: 0,
        receivedTimestampMs: 0,
        quality: 'BAD',
        statusCode: 'BadWaitingForInitialData',
      }
      statusChannelsByMappingId.set(mapping.id, channel)
      statusChannelsByRobotId.set(target.robotId, channel)
      appendByEndpoint(statusChannelsByEndpoint, channel)
    }
  }

  return Object.freeze({
    project,
    configRevision: revision,
    frameChannelsByMappingId,
    statusChannelsByMappingId,
    frameChannelsByKey,
    statusChannelsByRobotId,
    frameChannelsByEndpoint: new Map([...frameChannelsByEndpoint].map(([key, value]) => [key, Object.freeze(value)])),
    statusChannelsByEndpoint: new Map([...statusChannelsByEndpoint].map(([key, value]) => [key, Object.freeze(value)])),
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
  channel.sourceFenceTimestampMs = batch.sourceTimestampMs
  channel.sourceTimestampMs = Math.max(channel.sourceTimestampMs, batch.sourceTimestampMs)
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
  channel.sourceFenceTimestampMs = batch.sourceTimestampMs
  channel.sourceTimestampMs = Math.max(channel.sourceTimestampMs, batch.sourceTimestampMs)
  channel.receivedTimestampMs = Math.max(channel.receivedTimestampMs, receivedTimestampMs)
  channel.quality = quality
  channel.statusCode = statusCode
}

export function createRobotFrameStatusRuntimeStoreV5(
  projectInput: WorkcellProjectV5,
  configRevision: string,
): RobotFrameStatusRuntimeStoreV5 {
  let context = compileContext(projectInput, configRevision)

  const ingest = (batchInput: StateBatchV1, receiptCandidate: number): boolean => {
    const batch = validateStateBatchV1(batchInput)
    const receivedTimestampMs = requireTimestamp(receiptCandidate, 'Receipt timestamp')
    if (
      batch.projectId !== context.project.projectId
      || batch.configRevision !== context.configRevision
      || batch.sequence <= (context.endpointSequences.get(batch.endpointId) ?? 0)
      || receivedTimestampMs < (context.endpointReceiptFences.get(batch.endpointId) ?? 0)
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
    if (
      frames.some(([channel]) => batch.sourceTimestampMs < channel.sourceFenceTimestampMs || batch.sourceTimestampMs > receivedTimestampMs)
      || statuses.some(([channel]) => batch.sourceTimestampMs < channel.sourceFenceTimestampMs)
    ) return false

    frames.forEach(([channel, mapped]) => updateFrameChannel(channel, mapped, batch, receivedTimestampMs))
    statuses.forEach(([channel, mapped]) => updateStatusChannel(channel, mapped, batch, receivedTimestampMs))
    context.endpointSequences.set(batch.endpointId, batch.sequence)
    context.endpointReceiptFences.set(batch.endpointId, receivedTimestampMs)
    return true
  }

  const markEndpointDisconnected = (endpointId: string, atCandidate: number): void => {
    const atMs = requireTimestamp(atCandidate, 'Disconnect timestamp')
    for (const channel of context.frameChannelsByEndpoint.get(endpointId) ?? []) {
      channel.quality = 'STALE'
      channel.statusCode = 'BadNoCommunication'
      channel.receivedTimestampMs = Math.max(channel.receivedTimestampMs, atMs)
    }
    for (const channel of context.statusChannelsByEndpoint.get(endpointId) ?? []) {
      channel.quality = 'STALE'
      channel.statusCode = 'BadNoCommunication'
      channel.receivedTimestampMs = Math.max(channel.receivedTimestampMs, atMs)
    }
  }

  const resetGatewaySession = (atCandidate: number): void => {
    const atMs = requireTimestamp(atCandidate, 'Reset timestamp')
    for (const channel of context.frameChannelsByMappingId.values()) {
      channel.heldPose = channel.displayPose ?? channel.heldPose
      channel.buffer = createRuntimePoseBufferV1(frameKey(channel.robotId, channel.frameId), channel.publishingIntervalMs)
      channel.sourceFenceTimestampMs = 0
      channel.receivedTimestampMs = Math.max(channel.receivedTimestampMs, atMs)
      channel.quality = 'BAD'
      channel.statusCode = 'BadWaitingForInitialData'
    }
    for (const channel of context.statusChannelsByMappingId.values()) {
      channel.sourceFenceTimestampMs = 0
      channel.receivedTimestampMs = Math.max(channel.receivedTimestampMs, atMs)
      channel.quality = 'BAD'
      channel.statusCode = 'BadWaitingForInitialData'
    }
    context.endpointSequences.clear()
    context.endpointReceiptFences.clear()
  }

  const sampleFrame = (robotId: string, frameId: string, renderCandidate: number): RobotFrameRuntimeValueV5 | null => {
    const renderTimestampMs = requireTimestamp(renderCandidate, 'Render timestamp')
    const channel = context.frameChannelsByKey.get(frameKey(robotId, frameId))
    if (channel === undefined) return null
    const sample = channel.heldPose === null ? null : channel.buffer.sample(renderTimestampMs)
    if (sample !== null) {
      channel.displayPose = sample.pose
      channel.displaySourceTimestampMs = Math.max(channel.displaySourceTimestampMs, sample.sourceTimestampMs)
    }
    const bufferIsStale = sample?.quality === 'STALE'
    const quality = channel.quality === 'GOOD' && bufferIsStale ? 'STALE' : channel.quality
    return Object.freeze({
      robotId,
      frameId,
      worldPose: sample?.pose ?? channel.displayPose ?? channel.heldPose,
      quality,
      statusCode: quality === 'STALE' && channel.quality === 'GOOD' ? 'BadNoCommunication' : channel.statusCode,
      owner: `opcua:${channel.endpointId}`,
      sourceTimestampMs: channel.quality === 'GOOD' && sample?.quality === 'GOOD'
        ? channel.displaySourceTimestampMs
        : channel.sourceTimestampMs,
      receivedTimestampMs: channel.receivedTimestampMs,
    })
  }

  const readNumericStatus = (robotId: string) => {
    const channel = context.statusChannelsByRobotId.get(robotId)
    if (channel === undefined) return null
    return Object.freeze({
      value: channel.value,
      quality: channel.quality,
      statusCode: channel.statusCode,
      owner: `opcua:${channel.endpointId}` as const,
    })
  }

  return Object.freeze({
    get projectRevisionId() { return context.project.revisionId },
    get configRevision() { return context.configRevision },
    ingest,
    markEndpointDisconnected,
    resetGatewaySession,
    replaceProject: (nextProjectInput: WorkcellProjectV5, nextConfigRevision: string) => {
      const nextContext = compileContext(nextProjectInput, nextConfigRevision)
      context = nextContext
    },
    sampleFrame,
    readNumericStatus,
  })
}
