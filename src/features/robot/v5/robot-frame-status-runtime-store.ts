import {
  validateWorkcellProjectV5,
  type OpcUaMappingLeafV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import {
  createRuntimePoseBufferV1,
  rpyDegreesToRuntimeQuaternionV1,
  type RuntimePoseBufferV1,
  type RuntimeRigidTransformV1,
} from '../../../core/runtime-interpolation/v1.js'
import type { RuntimeMappedValueV1, RuntimeValueQualityV1, StateBatchV1 } from '../../../core/runtime-protocol/v1.js'

export type RobotFrameStatusRuntimeQualityV5 = RuntimeValueQualityV1 | 'STALE'
export type RobotFrameStatusRuntimeOwnerV5 = `opcua:${string}`

export interface RobotRuntimeFrameV5 {
  readonly robotId: string
  readonly frameId: string
  readonly worldPose: RuntimeRigidTransformV1
  readonly sourceTimestampMs: number
  readonly publishedTimestampMs: number
  readonly receivedTimestampMs: number
  readonly quality: RobotFrameStatusRuntimeQualityV5
  readonly statusCode: string
  readonly owner: RobotFrameStatusRuntimeOwnerV5
}

export interface RobotRuntimeNumericStatusV5 {
  readonly robotId: string
  readonly value: number
  readonly sourceTimestampMs: number
  readonly publishedTimestampMs: number
  readonly receivedTimestampMs: number
  readonly quality: RobotFrameStatusRuntimeQualityV5
  readonly statusCode: string
  readonly owner: RobotFrameStatusRuntimeOwnerV5
}

export interface RobotFrameStatusRuntimeStoreV5 {
  ingest(value: unknown, receivedTimestampMs?: number): boolean
  markEndpointDisconnected(endpointId: string, receivedTimestampMs?: number): void
  replaceProject(projectInput: WorkcellProjectV5, configRevision: string): void
  sampleFrame(robotId: string, frameId: string, nowMs?: number): RobotRuntimeFrameV5 | null
  readNumericStatus(robotId: string): RobotRuntimeNumericStatusV5 | null
}

interface FrameChannelV5 {
  readonly mappingId: string
  readonly endpointId: string
  readonly robotId: string
  readonly frameId: string
  readonly publishingIntervalMs: number
  readonly leaves: readonly OpcUaMappingLeafV5[]
  readonly buffer: RuntimePoseBufferV1
  heldPose: RuntimeRigidTransformV1 | null
  sourceTimestampMs: number
  publishedTimestampMs: number
  receivedTimestampMs: number
  quality: RobotFrameStatusRuntimeQualityV5
  statusCode: string
}

interface StatusChannelV5 {
  readonly mappingId: string
  readonly endpointId: string
  readonly robotId: string
  value: number | null
  sourceTimestampMs: number
  publishedTimestampMs: number
  receivedTimestampMs: number
  quality: RobotFrameStatusRuntimeQualityV5
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

function isRuntimeMappedValue(value: unknown): value is RuntimeMappedValueV1 {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.mappingId === 'string'
    && (typeof record.coherenceGroupId === 'string' || record.coherenceGroupId === null)
    && typeof record.unit === 'string'
    && (record.quality === 'GOOD' || record.quality === 'UNCERTAIN' || record.quality === 'BAD')
    && typeof record.statusCode === 'string'
    && Object.hasOwn(record, 'value')
}

function asStateBatch(value: unknown): StateBatchV1 | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (
    record.type !== 'state-batch-v1'
    || record.protocolVersion !== 1
    || typeof record.projectId !== 'string'
    || typeof record.configRevision !== 'string'
    || typeof record.endpointId !== 'string'
    || !Number.isSafeInteger(record.sequence)
    || (record.sequence as number) <= 0
    || !Number.isSafeInteger(record.sourceTimestampMs)
    || (record.sourceTimestampMs as number) < 0
    || !Number.isSafeInteger(record.publishedTimestampMs)
    || (record.publishedTimestampMs as number) < 0
    || !Array.isArray(record.values)
    || !record.values.every(isRuntimeMappedValue)
  ) return null
  return record as unknown as StateBatchV1
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
    const publishingIntervalMs = mapping.publishingIntervalMs ?? endpoint.publishingIntervalMs
    if (target.type === 'robot-frame') {
      const channel: FrameChannelV5 = {
        mappingId: mapping.id,
        endpointId: mapping.endpointId,
        robotId: target.robotId,
        frameId: target.frameId,
        publishingIntervalMs,
        leaves: mapping.leaves,
        buffer: createRuntimePoseBufferV1(frameKey(target.robotId, target.frameId), publishingIntervalMs),
        heldPose: null,
        sourceTimestampMs: 0,
        publishedTimestampMs: 0,
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
        publishedTimestampMs: 0,
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
  })
}

function leafValue(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value
  for (const segment of path) {
    if (typeof segment === 'number' && Array.isArray(current)) current = current[segment]
    else if (typeof segment === 'string' && current !== null && typeof current === 'object' && !Array.isArray(current)) current = (current as Record<string, unknown>)[segment]
    else return undefined
  }
  return current
}

function poseFromMappedValue(mapped: RuntimeMappedValueV1, leaves: readonly OpcUaMappingLeafV5[]): RuntimeRigidTransformV1 | null {
  const positionM: number[] = []
  const rpyDegrees: number[] = []
  for (const leaf of leaves) {
    const raw = leafValue(mapped.value, leaf.leafPath)
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
    const scaled = raw * leaf.scale + leaf.offset
    if (!Number.isFinite(scaled)) return null
    const [property, index] = leaf.projectPath
    if (property === 'positionM' && typeof index === 'number') positionM[index] = scaled
    else if (property === 'rpyDegrees' && typeof index === 'number') rpyDegrees[index] = scaled
    else return null
  }
  if (positionM.length !== 3 || rpyDegrees.length !== 3 || positionM.some((value) => !Number.isFinite(value)) || rpyDegrees.some((value) => !Number.isFinite(value))) return null
  return Object.freeze({
    positionM: Object.freeze([positionM[0]!, positionM[1]!, positionM[2]!]) as RuntimeRigidTransformV1['positionM'],
    quaternion: Object.freeze(rpyDegreesToRuntimeQuaternionV1([rpyDegrees[0]!, rpyDegrees[1]!, rpyDegrees[2]!])) as RuntimeRigidTransformV1['quaternion'],
  })
}

function updateFrameChannel(channel: FrameChannelV5, mapped: RuntimeMappedValueV1, batch: StateBatchV1, receivedTimestampMs: number): void {
  let quality: RobotFrameStatusRuntimeQualityV5 = mapped.quality
  let statusCode = mapped.statusCode
  if (mapped.quality === 'GOOD') {
    const pose = poseFromMappedValue(mapped, channel.leaves)
    if (pose === null || !channel.buffer.push({ sequence: batch.sequence, sourceTimestampMs: batch.sourceTimestampMs, receivedTimestampMs, pose })) {
      quality = 'BAD'
      statusCode = 'BadTypeMismatch'
    } else {
      channel.heldPose = pose
    }
  }
  channel.sourceTimestampMs = batch.sourceTimestampMs
  channel.publishedTimestampMs = batch.publishedTimestampMs
  channel.receivedTimestampMs = receivedTimestampMs
  channel.quality = quality
  channel.statusCode = statusCode
}

function updateStatusChannel(channel: StatusChannelV5, mapped: RuntimeMappedValueV1, batch: StateBatchV1, receivedTimestampMs: number): void {
  let quality: RobotFrameStatusRuntimeQualityV5 = mapped.quality
  let statusCode = mapped.statusCode
  if (mapped.quality === 'GOOD') {
    if (typeof mapped.value !== 'number' || !Number.isFinite(mapped.value)) {
      quality = 'BAD'
      statusCode = 'BadTypeMismatch'
    } else channel.value = mapped.value
  }
  channel.sourceTimestampMs = batch.sourceTimestampMs
  channel.publishedTimestampMs = batch.publishedTimestampMs
  channel.receivedTimestampMs = receivedTimestampMs
  channel.quality = quality
  channel.statusCode = statusCode
}

function wouldBreakFrameClock(channel: FrameChannelV5, batch: StateBatchV1, receivedTimestampMs: number): boolean {
  return batch.sourceTimestampMs < channel.sourceTimestampMs
    || batch.sourceTimestampMs > receivedTimestampMs + Math.max(500, 5 * channel.publishingIntervalMs)
}

function wouldRewindStatusClock(channel: StatusChannelV5, batch: StateBatchV1): boolean {
  return batch.sourceTimestampMs < channel.sourceTimestampMs
}

export function createRobotFrameStatusRuntimeStoreV5(
  projectInput: WorkcellProjectV5,
  configRevision: string,
): RobotFrameStatusRuntimeStoreV5 {
  let context = compileContext(projectInput, configRevision)

  const ingest = (value: unknown, receiptCandidate = Date.now()): boolean => {
    const batch = asStateBatch(value)
    if (batch === null) return false
    const receivedTimestampMs = requireTimestamp(receiptCandidate, 'Receipt timestamp')
    if (
      batch.projectId !== context.project.projectId
      || batch.configRevision !== context.configRevision
      || batch.sequence <= (context.endpointSequences.get(batch.endpointId) ?? 0)
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
      frames.some(([channel]) => wouldBreakFrameClock(channel, batch, receivedTimestampMs))
      || statuses.some(([channel]) => wouldRewindStatusClock(channel, batch))
    ) return false

    context.endpointSequences.set(batch.endpointId, batch.sequence)
    frames.forEach(([channel, mapped]) => updateFrameChannel(channel, mapped, batch, receivedTimestampMs))
    statuses.forEach(([channel, mapped]) => updateStatusChannel(channel, mapped, batch, receivedTimestampMs))
    return true
  }

  const markEndpointDisconnected = (endpointId: string, receiptCandidate = Date.now()): void => {
    const receivedTimestampMs = requireTimestamp(receiptCandidate, 'Receipt timestamp')
    for (const channel of context.frameChannelsByEndpoint.get(endpointId) ?? []) {
      if (channel.heldPose === null) continue
      channel.quality = 'STALE'
      channel.statusCode = 'BadNoCommunication'
      channel.receivedTimestampMs = receivedTimestampMs
    }
    for (const channel of context.statusChannelsByEndpoint.get(endpointId) ?? []) {
      if (channel.value === null) continue
      channel.quality = 'STALE'
      channel.statusCode = 'BadNoCommunication'
      channel.receivedTimestampMs = receivedTimestampMs
    }
  }

  const sampleFrame = (robotId: string, frameId: string, nowCandidate = Date.now()): RobotRuntimeFrameV5 | null => {
    const nowMs = requireTimestamp(nowCandidate, 'Current time')
    const channel = context.frameChannelsByKey.get(frameKey(robotId, frameId))
    if (channel === undefined || channel.heldPose === null) return null
    const sample = channel.buffer.sample(nowMs)
    const stale = channel.quality === 'STALE' || sample?.quality === 'STALE'
    return Object.freeze({
      robotId,
      frameId,
      worldPose: sample?.pose ?? channel.heldPose,
      sourceTimestampMs: channel.quality === 'GOOD' && sample?.quality === 'GOOD' ? sample.sourceTimestampMs : channel.sourceTimestampMs,
      publishedTimestampMs: channel.publishedTimestampMs,
      receivedTimestampMs: channel.receivedTimestampMs,
      quality: stale ? 'STALE' : channel.quality,
      statusCode: stale ? 'BadNoCommunication' : channel.statusCode,
      owner: `opcua:${channel.endpointId}`,
    })
  }

  const readNumericStatus = (robotId: string): RobotRuntimeNumericStatusV5 | null => {
    const channel = context.statusChannelsByRobotId.get(robotId)
    if (channel === undefined || channel.value === null) return null
    return Object.freeze({
      robotId,
      value: channel.value,
      sourceTimestampMs: channel.sourceTimestampMs,
      publishedTimestampMs: channel.publishedTimestampMs,
      receivedTimestampMs: channel.receivedTimestampMs,
      quality: channel.quality,
      statusCode: channel.statusCode,
      owner: `opcua:${channel.endpointId}`,
    })
  }

  return Object.freeze({
    ingest,
    markEndpointDisconnected,
    replaceProject: (nextProjectInput: WorkcellProjectV5, nextConfigRevision: string) => {
      const nextContext = compileContext(nextProjectInput, nextConfigRevision)
      context = nextContext
    },
    sampleFrame,
    readNumericStatus,
  })
}
