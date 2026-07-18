import {
  validateWorkcellProjectV4,
  type FrameIdV4,
  type OpcUaMappingV4,
  type SpatialEntityIdV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  createRuntimePoseBufferV1,
  type RuntimePoseBufferV1,
} from '../../../core/runtime-interpolation/v1.js'
import {
  validateStateBatchV1,
  type RuntimeMappedValueV1,
} from '../../../core/runtime-protocol/v1.js'

export type ObjectRuntimeQualityV4 = 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE'

export interface ObjectRuntimePoseV4 {
  readonly entityId: SpatialEntityIdV4
  readonly frameId: FrameIdV4
  readonly sourceTimestampMs: number
  readonly pose: WorkcellProjectV4['spatialEntities'][number]['localPose']
  readonly quality: ObjectRuntimeQualityV4
  readonly statusCode: string
}

export interface ObjectRuntimeNumericStatusV4 {
  readonly entityId: SpatialEntityIdV4
  readonly sourceTimestampMs: number
  readonly value: number
  readonly quality: ObjectRuntimeQualityV4
  readonly statusCode: string
}

export interface ObjectRuntimeStateV4 {
  ingest(value: unknown, receivedTimestampMs?: number): boolean
  resetGatewaySession(nowMs?: number): void
  sampleEntityFrame(
    entityId: SpatialEntityIdV4,
    frameId: FrameIdV4,
    nowMs?: number,
  ): ObjectRuntimePoseV4 | null
  readEntityStatus(
    entityId: SpatialEntityIdV4,
    nowMs?: number,
  ): ObjectRuntimeNumericStatusV4 | null
  bindingKeys(): readonly string[]
}

interface PoseChannelV4 {
  readonly kind: 'pose'
  readonly mappingId: string
  readonly endpointId: string
  readonly entityId: SpatialEntityIdV4
  readonly frameId: FrameIdV4
  readonly publishingIntervalMs: number
  buffer: RuntimePoseBufferV1
  heldPose: {
    readonly sourceTimestampMs: number
    readonly pose: WorkcellProjectV4['spatialEntities'][number]['localPose']
  } | null
  latestSignalTimestampMs: number
  latestReceiptTimestampMs: number
  quality: Exclude<ObjectRuntimeQualityV4, 'STALE'>
  statusCode: string
}

interface StatusChannelV4 {
  readonly kind: 'status'
  readonly mappingId: string
  readonly endpointId: string
  readonly entityId: SpatialEntityIdV4
  readonly publishingIntervalMs: number
  value: number | null
  sourceTimestampMs: number
  receivedTimestampMs: number
  latestSignalTimestampMs: number
  latestReceiptTimestampMs: number
  quality: Exclude<ObjectRuntimeQualityV4, 'STALE'>
  statusCode: string
}

type RuntimeChannelV4 = PoseChannelV4 | StatusChannelV4

function positiveSafeTimestampV4(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`)
  }
  return value
}

function endpointOwnsEntityTransformV4(
  project: WorkcellProjectV4,
  endpointId: string,
  entityId: SpatialEntityIdV4,
  frameId: FrameIdV4,
): boolean {
  const entity = project.spatialEntities.find(({ id }) => id === entityId)
  if (
    entity === undefined
    || entity.transformOwner !== `opcua:${endpointId}`
    || entity.parentFrameId !== frameId
  ) return false
  return entity.movingFrames.some((frame) => (
    frame.frameId === frameId && frame.sourceOwnership === `opcua:${endpointId}`
  ))
}

function endpointOwnsEntityStatusV4(
  project: WorkcellProjectV4,
  endpointId: string,
  entityId: SpatialEntityIdV4,
): boolean {
  return project.spatialEntities.some((entity) => (
    entity.id === entityId
    && entity.numericStatus.sourceOwnership === `opcua:${endpointId}`
  ))
}

function poseTargetV4(mapping: OpcUaMappingV4): {
  readonly entityId: SpatialEntityIdV4
  readonly frameId: FrameIdV4
} | null {
  const canonicalPaths = [
    ['positionM', 0], ['positionM', 1], ['positionM', 2],
    ['rpyDegrees', 0], ['rpyDegrees', 1], ['rpyDegrees', 2],
  ] as const
  const first = mapping.leaves[0]?.projectTarget
  if (
    first?.type !== 'entity-frame'
    || mapping.leaves.length !== canonicalPaths.length
    || mapping.interpolationMode !== 'shortest-quaternion'
    || mapping.coordinateConvention !== 'project-v4-z-up-metres-quaternion-xyzw'
    || mapping.sourceOwnership !== `opcua:${mapping.endpointId}`
  ) return null
  if (!mapping.leaves.every((leaf, index) => (
    leaf.projectTarget.type === 'entity-frame'
    && leaf.projectTarget.entityId === first.entityId
    && leaf.projectTarget.frameId === first.frameId
    && leaf.projectDataType === 'number'
    && leaf.leafPath.length === 2
    && leaf.leafPath[0] === canonicalPaths[index]![0]
    && leaf.leafPath[1] === canonicalPaths[index]![1]
  ))) return null
  return { entityId: first.entityId, frameId: first.frameId }
}

function statusTargetV4(mapping: OpcUaMappingV4): SpatialEntityIdV4 | null {
  const target = mapping.leaves.length === 1
    ? mapping.leaves[0]?.projectTarget
    : undefined
  return target?.type === 'entity-status'
    && mapping.sourceOwnership === `opcua:${mapping.endpointId}`
    && mapping.leaves[0]?.leafPath.length === 0
    && mapping.leaves[0].projectDataType === 'number'
    ? target.entityId
    : null
}

function compileChannelsV4(project: WorkcellProjectV4): readonly RuntimeChannelV4[] {
  if (project.opcUa.mode !== 'client' && project.opcUa.mode !== 'bridge') return []
  const endpoints = new Map(project.opcUa.endpoints.map((endpoint) => [endpoint.endpointId, endpoint]))
  const poseCandidates = new Map<string, Array<{
    readonly mapping: OpcUaMappingV4
    readonly entityId: SpatialEntityIdV4
    readonly frameId: FrameIdV4
  }>>()
  const statusCandidates = new Map<SpatialEntityIdV4, OpcUaMappingV4[]>()
  for (const mapping of project.opcUa.mappings) {
    if (mapping.direction !== 'read' && mapping.direction !== 'readWrite') continue
    const endpoint = endpoints.get(mapping.endpointId)
    if (endpoint === undefined || !endpoint.enabled) continue

    const poseTarget = poseTargetV4(mapping)
    if (
      poseTarget !== null
      && endpointOwnsEntityTransformV4(
        project,
        endpoint.endpointId,
        poseTarget.entityId,
        poseTarget.frameId,
      )
    ) {
      const key = `${poseTarget.entityId}:${poseTarget.frameId}`
      const candidates = poseCandidates.get(key) ?? []
      candidates.push({ mapping, ...poseTarget })
      poseCandidates.set(key, candidates)
      continue
    }

    const statusTarget = statusTargetV4(mapping)
    if (
      statusTarget !== null
      && endpointOwnsEntityStatusV4(project, endpoint.endpointId, statusTarget)
    ) {
      const candidates = statusCandidates.get(statusTarget) ?? []
      candidates.push(mapping)
      statusCandidates.set(statusTarget, candidates)
    }
  }

  const channels: RuntimeChannelV4[] = []
  for (const candidates of poseCandidates.values()) {
    if (candidates.length !== 1) continue
    const { mapping, entityId, frameId } = candidates[0]!
    const endpoint = endpoints.get(mapping.endpointId)!
    const publishingIntervalMs = mapping.publishingIntervalMs ?? endpoint.publishingIntervalMs
    channels.push({
      kind: 'pose',
      mappingId: mapping.id,
      endpointId: mapping.endpointId,
      entityId,
      frameId,
      buffer: createRuntimePoseBufferV1(
        `${entityId}:${frameId}`,
        publishingIntervalMs,
      ),
      heldPose: null,
      publishingIntervalMs,
      latestSignalTimestampMs: -1,
      latestReceiptTimestampMs: -1,
      quality: 'BAD',
      statusCode: 'BadWaitingForInitialData',
    })
  }
  for (const [entityId, candidates] of statusCandidates) {
    if (candidates.length !== 1) continue
    const mapping = candidates[0]!
    const endpoint = endpoints.get(mapping.endpointId)!
    channels.push({
        kind: 'status',
        mappingId: mapping.id,
        endpointId: mapping.endpointId,
        entityId,
        publishingIntervalMs: mapping.publishingIntervalMs ?? endpoint.publishingIntervalMs,
        value: null,
        sourceTimestampMs: 0,
        receivedTimestampMs: 0,
        latestSignalTimestampMs: -1,
        latestReceiptTimestampMs: -1,
        quality: 'BAD',
        statusCode: 'BadWaitingForInitialData',
      })
  }
  return channels
}

function finiteTupleV4(value: unknown, length: number): readonly number[] | null {
  if (!Array.isArray(value) || value.length !== length) return null
  return value.every((component) => typeof component === 'number' && Number.isFinite(component))
    ? value as readonly number[]
    : null
}

function poseFromMappedValueV4(
  mapped: RuntimeMappedValueV1,
): WorkcellProjectV4['spatialEntities'][number]['localPose'] | null {
  if (mapped.value === null || typeof mapped.value !== 'object' || Array.isArray(mapped.value)) {
    return null
  }
  const record = mapped.value as Readonly<Record<string, unknown>>
  const positionM = finiteTupleV4(record.positionM, 3)
  const quaternion = finiteTupleV4(record.quaternion, 4)
  if (positionM === null || quaternion === null) return null
  return {
    positionM: positionM as [number, number, number],
    quaternion: quaternion as [number, number, number, number],
  }
}

export function createObjectRuntimeStateV4(
  projectInput: WorkcellProjectV4,
): ObjectRuntimeStateV4 {
  const project = validateWorkcellProjectV4(projectInput)
  const channels = compileChannelsV4(project)
  const channelsByMappingId = new Map(channels.map((channel) => [channel.mappingId, channel]))
  const poseChannelsByKey = new Map(
    channels.flatMap((channel) => channel.kind === 'pose'
      ? [[`${channel.entityId}:${channel.frameId}`, channel] as const]
      : []),
  )
  const statusChannelsByEntityId = new Map(
    channels.flatMap((channel) => channel.kind === 'status'
      ? [[channel.entityId, channel] as const]
      : []),
  )
  const latestSequenceByEndpoint = new Map<string, number>()

  const resetGatewaySession = (nowCandidate = Date.now()): void => {
    const nowMs = positiveSafeTimestampV4(nowCandidate, 'Current time')
    latestSequenceByEndpoint.clear()
    for (const channel of channels) {
      channel.latestSignalTimestampMs = -1
      if (channel.kind === 'pose') {
        const displayed = channel.buffer.sample(nowMs)
        if (displayed !== null) {
          channel.heldPose = {
            sourceTimestampMs: displayed.sourceTimestampMs,
            pose: displayed.pose,
          }
        }
        channel.buffer = createRuntimePoseBufferV1(
          `${channel.entityId}:${channel.frameId}`,
          channel.publishingIntervalMs,
        )
        channel.latestReceiptTimestampMs = -1
      } else {
        channel.latestReceiptTimestampMs = -1
      }
      channel.quality = 'BAD'
      channel.statusCode = 'BadWaitingForInitialData'
    }
  }

  const ingest = (value: unknown, receivedTimestampCandidate = Date.now()): boolean => {
    const receivedTimestampMs = positiveSafeTimestampV4(
      receivedTimestampCandidate,
      'Receipt timestamp',
    )
    let batch
    try {
      batch = validateStateBatchV1(value)
    } catch {
      return false
    }
    if (
      batch.projectId !== project.projectId
      || batch.configRevision !== project.revisionId
      || !project.opcUa.endpoints.some(({ endpointId }) => endpointId === batch.endpointId)
    ) return false
    const previousSequence = latestSequenceByEndpoint.get(batch.endpointId) ?? 0
    if (batch.sequence <= previousSequence) return false
    latestSequenceByEndpoint.set(batch.endpointId, batch.sequence)

    let applied = false
    for (const mapped of batch.values) {
      const channel = channelsByMappingId.get(mapped.mappingId)
      if (channel === undefined || channel.endpointId !== batch.endpointId) continue
      if (batch.sourceTimestampMs < channel.latestSignalTimestampMs) continue
      channel.latestReceiptTimestampMs = receivedTimestampMs
      if (mapped.quality === 'BAD') {
        channel.latestSignalTimestampMs = batch.sourceTimestampMs
        channel.quality = mapped.quality
        channel.statusCode = mapped.statusCode
        applied = true
        continue
      }
      if (channel.kind === 'pose') {
        const pose = poseFromMappedValueV4(mapped)
        if (pose === null) {
          channel.latestSignalTimestampMs = batch.sourceTimestampMs
          channel.quality = 'BAD'
          channel.statusCode = 'BadTypeMismatch'
          applied = true
          continue
        }
        const accepted = channel.buffer.push({
          sequence: batch.sequence,
          sourceTimestampMs: batch.sourceTimestampMs,
          receivedTimestampMs,
          pose,
        })
        if (accepted) {
          channel.latestSignalTimestampMs = batch.sourceTimestampMs
          channel.heldPose = {
            sourceTimestampMs: batch.sourceTimestampMs,
            pose,
          }
          channel.quality = mapped.quality
          channel.statusCode = mapped.statusCode
          applied = true
        }
      } else if (typeof mapped.value === 'number' && Number.isFinite(mapped.value)) {
        channel.latestSignalTimestampMs = batch.sourceTimestampMs
        channel.quality = mapped.quality
        channel.statusCode = mapped.statusCode
        channel.value = mapped.value
        channel.sourceTimestampMs = batch.sourceTimestampMs
        channel.receivedTimestampMs = receivedTimestampMs
        applied = true
      } else {
        channel.latestSignalTimestampMs = batch.sourceTimestampMs
        channel.quality = 'BAD'
        channel.statusCode = 'BadTypeMismatch'
        applied = true
      }
    }
    return applied
  }

  const sampleEntityFrame = (
    entityId: SpatialEntityIdV4,
    frameId: FrameIdV4,
    nowCandidate = Date.now(),
  ): ObjectRuntimePoseV4 | null => {
    const nowMs = positiveSafeTimestampV4(nowCandidate, 'Current time')
    const channel = poseChannelsByKey.get(`${entityId}:${frameId}`)
    if (channel === undefined) return null
    const result = channel.buffer.sample(nowMs)
    const held = channel.heldPose
    if (result === null && held === null) return null
    const staleAfterMs = Math.max(1_000, 3 * channel.publishingIntervalMs)
    const stale = nowMs - channel.latestReceiptTimestampMs > staleAfterMs
    return Object.freeze({
      entityId,
      frameId,
      sourceTimestampMs: result?.sourceTimestampMs ?? held!.sourceTimestampMs,
      pose: result?.pose ?? held!.pose,
      quality: stale ? 'STALE' : channel.quality,
      statusCode: stale ? 'BadNoCommunication' : channel.statusCode,
    })
  }

  const readEntityStatus = (
    entityId: SpatialEntityIdV4,
    nowCandidate = Date.now(),
  ): ObjectRuntimeNumericStatusV4 | null => {
    const nowMs = positiveSafeTimestampV4(nowCandidate, 'Current time')
    const channel = statusChannelsByEntityId.get(entityId)
    if (channel === undefined || channel.value === null) return null
    const staleAfterMs = Math.max(1_000, 3 * channel.publishingIntervalMs)
    const stale = nowMs - channel.latestReceiptTimestampMs > staleAfterMs
    return Object.freeze({
      entityId,
      sourceTimestampMs: channel.sourceTimestampMs,
      value: channel.value,
      quality: stale ? 'STALE' : channel.quality,
      statusCode: stale ? 'BadNoCommunication' : channel.statusCode,
    })
  }

  return Object.freeze({
    ingest,
    resetGatewaySession,
    sampleEntityFrame,
    readEntityStatus,
    bindingKeys: () => Object.freeze([...poseChannelsByKey.keys()]),
  })
}
