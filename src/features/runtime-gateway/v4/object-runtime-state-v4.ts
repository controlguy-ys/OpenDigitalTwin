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
  readonly buffer: RuntimePoseBufferV1
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
  const first = mapping.leaves[0]?.projectTarget
  if (first?.type !== 'entity-frame') return null
  if (!mapping.leaves.every((leaf) => (
    leaf.projectTarget.type === 'entity-frame'
    && leaf.projectTarget.entityId === first.entityId
    && leaf.projectTarget.frameId === first.frameId
  ))) return null
  return { entityId: first.entityId, frameId: first.frameId }
}

function statusTargetV4(mapping: OpcUaMappingV4): SpatialEntityIdV4 | null {
  const target = mapping.leaves.length === 1
    ? mapping.leaves[0]?.projectTarget
    : undefined
  return target?.type === 'entity-status' ? target.entityId : null
}

function compileChannelsV4(project: WorkcellProjectV4): readonly RuntimeChannelV4[] {
  const endpoints = new Map(project.opcUa.endpoints.map((endpoint) => [endpoint.endpointId, endpoint]))
  const channels: RuntimeChannelV4[] = []
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
      channels.push({
        kind: 'pose',
        mappingId: mapping.id,
        endpointId: endpoint.endpointId,
        entityId: poseTarget.entityId,
        frameId: poseTarget.frameId,
        buffer: createRuntimePoseBufferV1(
          `${poseTarget.entityId}:${poseTarget.frameId}`,
          mapping.publishingIntervalMs,
        ),
        quality: 'BAD',
        statusCode: 'BadWaitingForInitialData',
      })
      continue
    }

    const statusTarget = statusTargetV4(mapping)
    if (
      statusTarget !== null
      && endpointOwnsEntityStatusV4(project, endpoint.endpointId, statusTarget)
    ) {
      channels.push({
        kind: 'status',
        mappingId: mapping.id,
        endpointId: endpoint.endpointId,
        entityId: statusTarget,
        publishingIntervalMs: mapping.publishingIntervalMs,
        value: null,
        sourceTimestampMs: 0,
        receivedTimestampMs: 0,
        quality: 'BAD',
        statusCode: 'BadWaitingForInitialData',
      })
    }
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
  const positionM = finiteTupleV4(mapped.value.positionM, 3)
  const quaternion = finiteTupleV4(mapped.value.quaternion, 4)
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
      channel.quality = mapped.quality
      channel.statusCode = mapped.statusCode
      if (mapped.quality === 'BAD') {
        applied = true
        continue
      }
      if (channel.kind === 'pose') {
        const pose = poseFromMappedValueV4(mapped)
        if (pose === null) {
          channel.quality = 'BAD'
          channel.statusCode = 'BadTypeMismatch'
          applied = true
          continue
        }
        applied = channel.buffer.push({
          sequence: batch.sequence,
          sourceTimestampMs: batch.sourceTimestampMs,
          receivedTimestampMs,
          pose,
        }) || applied
      } else if (typeof mapped.value === 'number' && Number.isFinite(mapped.value)) {
        channel.value = mapped.value
        channel.sourceTimestampMs = batch.sourceTimestampMs
        channel.receivedTimestampMs = receivedTimestampMs
        applied = true
      } else {
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
    if (result === null) return null
    return Object.freeze({
      entityId,
      frameId,
      sourceTimestampMs: result.sourceTimestampMs,
      pose: result.pose,
      quality: result.quality === 'STALE' ? 'STALE' : channel.quality,
      statusCode: result.quality === 'STALE' ? 'BadNoCommunication' : channel.statusCode,
    })
  }

  const readEntityStatus = (
    entityId: SpatialEntityIdV4,
    nowCandidate = Date.now(),
  ): ObjectRuntimeNumericStatusV4 | null => {
    const nowMs = positiveSafeTimestampV4(nowCandidate, 'Current time')
    const channel = statusChannelsByEntityId.get(entityId)
    if (channel === undefined || channel.value === null) return null
    const staleAfterMs = Math.max(500, 5 * channel.publishingIntervalMs)
    const stale = nowMs - channel.receivedTimestampMs > staleAfterMs
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
    sampleEntityFrame,
    readEntityStatus,
    bindingKeys: () => Object.freeze([...poseChannelsByKey.keys()]),
  })
}
