import {
  validateWorkcellProjectV4,
  type RobotIdV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { validateStateBatchV1 } from '../../../core/runtime-protocol/v1.js'
import type { RobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import type { StoreApi } from 'zustand/vanilla'

export interface RobotJointRuntimeStateV4 {
  ingest(value: unknown, receivedTimestampMs?: number): boolean
  resetGatewaySession(nowMs?: number): void
}

interface JointChannelV4 {
  readonly mappingId: string
  readonly endpointId: string
  readonly robotId: RobotIdV4
  readonly jointId: string
  readonly minimum: number
  readonly maximum: number
}

function timestampV4(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Receipt timestamp must be a non-negative safe integer.')
  return value
}

function compileChannelsV4(project: WorkcellProjectV4): readonly JointChannelV4[] {
  if (project.opcUa.mode !== 'client' && project.opcUa.mode !== 'bridge') return []
  const endpoints = new Map(project.opcUa.endpoints.map((endpoint) => [endpoint.endpointId, endpoint]))
  const definitions = new Map(project.robotDefinitions.map((definition) => [definition.id, definition]))
  const robots = new Map(project.robots.map((robot) => [robot.id, robot]))
  const channels: JointChannelV4[] = []
  for (const mapping of project.opcUa.mappings) {
    if (mapping.direction !== 'read' && mapping.direction !== 'readWrite') continue
    const endpoint = endpoints.get(mapping.endpointId)
    const leaf = mapping.leaves.length === 1 ? mapping.leaves[0] : undefined
    if (endpoint?.enabled !== true || leaf?.projectTarget.type !== 'robot-joint') continue
    const target = leaf.projectTarget
    const robot = robots.get(target.robotId)
    const definition = robot === undefined ? undefined : definitions.get(robot.definitionId)
    const joint = definition?.joints.find(({ id }) => id === target.jointId)
    if (
      robot === undefined
      || joint === undefined
      || robot.jointSource !== `opcua:${mapping.endpointId}`
      || mapping.sourceOwnership !== `opcua:${mapping.endpointId}`
      || leaf.projectDataType !== 'number'
    ) continue
    channels.push({
      mappingId: mapping.id,
      endpointId: mapping.endpointId,
      robotId: target.robotId,
      jointId: target.jointId,
      minimum: joint.min,
      maximum: joint.max,
    })
  }
  return channels
}

export function createRobotJointRuntimeStateV4(
  projectInput: WorkcellProjectV4,
  registry: StoreApi<RobotRuntimeRegistryV4>,
  configRevision = projectInput.revisionId,
): RobotJointRuntimeStateV4 {
  const project = validateWorkcellProjectV4(projectInput)
  const channelsByMappingId = new Map(
    compileChannelsV4(project).map((channel) => [channel.mappingId, channel]),
  )
  const latestSequenceByEndpoint = new Map<string, number>()

  const resetGatewaySession = (nowCandidate = Date.now()): void => {
    timestampV4(nowCandidate)
    latestSequenceByEndpoint.clear()
  }

  const ingest = (value: unknown, receivedTimestampCandidate = Date.now()): boolean => {
    const receivedTimestampMs = timestampV4(receivedTimestampCandidate)
    let batch
    try {
      batch = validateStateBatchV1(value)
    } catch {
      return false
    }
    if (
      batch.projectId !== project.projectId
      || batch.configRevision !== configRevision
      || !project.opcUa.endpoints.some(({ endpointId }) => endpointId === batch.endpointId)
      || batch.sourceTimestampMs > batch.publishedTimestampMs
    ) {
      return false
    }
    const previousSequence = latestSequenceByEndpoint.get(batch.endpointId) ?? 0
    if (batch.sequence <= previousSequence) return false

    let applied = false
    for (const mapped of batch.values) {
      const channel = channelsByMappingId.get(mapped.mappingId)
      if (channel === undefined || channel.endpointId !== batch.endpointId) continue
      if (mapped.quality !== 'GOOD' || typeof mapped.value !== 'number' || !Number.isFinite(mapped.value)) continue
      if (mapped.value < channel.minimum || mapped.value > channel.maximum) {
        continue
      }
      try {
        registry.getState().writeJointValues(
          channel.robotId,
          { [channel.jointId]: mapped.value },
          `opcua:${channel.endpointId}`,
        )
        applied = true
      } catch {
        // A stale project or ownership change rejects the sample without
        // terminating the gateway stream.
      }
    }
    latestSequenceByEndpoint.set(batch.endpointId, batch.sequence)
    void receivedTimestampMs
    return applied
  }

  return Object.freeze({ ingest, resetGatewaySession })
}
