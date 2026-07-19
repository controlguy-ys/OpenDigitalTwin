import {
  validateLogicalSignalValueV1,
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import {
  validateStateBatchV1,
  type RuntimeMappedValueV1,
  type RuntimeValueQualityV1,
  type StateBatchV1,
} from '../../../core/runtime-protocol/v1.js'
import { createStore, type StoreApi } from 'zustand/vanilla'

export type LogicalSignalRuntimeQualityV1 = RuntimeValueQualityV1 | 'STALE'

export interface LogicalSignalRuntimeValueV1 {
  readonly signalId: string
  readonly value: boolean | number | string
  readonly quality: LogicalSignalRuntimeQualityV1
  readonly statusCode: string
  readonly sourceTimestampMs: number
  readonly publishedTimestampMs: number
  readonly receivedTimestampMs: number
  readonly owner: 'initial' | 'simulation' | `opcua:${string}`
}

export interface LogicalSignalRuntimeStoreV1 {
  readonly projectRevisionId: string | null
  readonly configRevision: string | null
  readonly bySignalId: Readonly<Record<string, LogicalSignalRuntimeValueV1>>
  replaceProject(project: WorkcellProjectV5, configRevision: string): void
  ingest(batch: StateBatchV1, receivedTimestampMs: number): boolean
  markEndpointDisconnected(endpointId: string, atMs: number): void
  resetGatewaySession(atMs: number): void
  read(signalId: string): LogicalSignalRuntimeValueV1 | null
}

interface SignalChannelV1 {
  readonly mappingId: string
  readonly endpointId: string
  readonly signalId: string
  readonly dataType: WorkcellProjectV5['logicalSignals'][number]['dataType']
}

interface LogicalSignalRuntimeContextV1 {
  readonly project: WorkcellProjectV5
  readonly configRevision: string
  readonly channelsByMappingId: ReadonlyMap<string, SignalChannelV1>
  readonly channelIdsByEndpoint: ReadonlyMap<string, readonly string[]>
  readonly initialSignals: Readonly<Record<string, LogicalSignalRuntimeValueV1>>
  readonly endpointSequences: Map<string, number>
  readonly endpointReceiptFences: Map<string, number>
  readonly endpointSourceTimestampFences: Map<string, number>
  readonly endpointPublishedTimestampFences: Map<string, number>
}

const CONFIG_REVISION_PATTERN = /^[0-9a-f]{64}$/u

function requireConfigRevision(configRevision: string): string {
  if (!CONFIG_REVISION_PATTERN.test(configRevision)) {
    throw new TypeError('Config revision must be a lowercase 64-character hexadecimal digest.')
  }
  return configRevision
}

function requireTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`)
  }
  return value
}

function frozenSignalValue(value: LogicalSignalRuntimeValueV1): LogicalSignalRuntimeValueV1 {
  return Object.freeze({ ...value })
}

function frozenSignals(
  values: Readonly<Record<string, LogicalSignalRuntimeValueV1>>,
): Readonly<Record<string, LogicalSignalRuntimeValueV1>> {
  return Object.freeze({ ...values })
}

function compileContext(
  projectInput: WorkcellProjectV5,
  configRevision: string,
): LogicalSignalRuntimeContextV1 {
  const project = validateWorkcellProjectV5(projectInput)
  const revision = requireConfigRevision(configRevision)
  const endpointById = new Map(project.opcUa.endpoints.map((endpoint) => [endpoint.endpointId, endpoint]))
  const signalsById = new Map(project.logicalSignals.map((signal) => [signal.id, signal]))
  const channelsByMappingId = new Map<string, SignalChannelV1>()
  const channelIdsByEndpoint = new Map<string, string[]>()

  for (const mapping of project.opcUa.mappings) {
    const endpoint = endpointById.get(mapping.endpointId)
    const target = mapping.leaves[0]?.projectTarget
    if (
      endpoint === undefined
      || !endpoint.enabled
      || (mapping.direction !== 'read' && mapping.direction !== 'readWrite')
      || target?.type !== 'logical-signal'
      || mapping.leaves.length !== 1
      || mapping.leaves[0]!.leafPath.length !== 0
    ) continue
    const signal = signalsById.get(target.signalId)
    if (signal === undefined) continue
    const channel = Object.freeze({
      mappingId: mapping.id,
      endpointId: mapping.endpointId,
      signalId: signal.id,
      dataType: signal.dataType,
    }) satisfies SignalChannelV1
    channelsByMappingId.set(mapping.id, channel)
    const ids = channelIdsByEndpoint.get(mapping.endpointId) ?? []
    ids.push(signal.id)
    channelIdsByEndpoint.set(mapping.endpointId, ids)
  }

  const initialSignals: Record<string, LogicalSignalRuntimeValueV1> = {}
  for (const signal of project.logicalSignals) {
    initialSignals[signal.id] = frozenSignalValue({
      signalId: signal.id,
      value: signal.initialValue,
      quality: 'BAD',
      statusCode: 'BadWaitingForInitialData',
      owner: 'initial',
      sourceTimestampMs: 0,
      publishedTimestampMs: 0,
      receivedTimestampMs: 0,
    })
  }

  return Object.freeze({
    project,
    configRevision: revision,
    channelsByMappingId,
    channelIdsByEndpoint: new Map([...channelIdsByEndpoint].map(([endpointId, ids]) => [endpointId, Object.freeze([...new Set(ids)])])),
    initialSignals: frozenSignals(initialSignals),
    endpointSequences: new Map(),
    endpointReceiptFences: new Map(),
    endpointSourceTimestampFences: new Map(),
    endpointPublishedTimestampFences: new Map(),
  })
}

function nextSignalValue(
  previous: LogicalSignalRuntimeValueV1,
  channel: SignalChannelV1,
  mapped: RuntimeMappedValueV1,
  batch: StateBatchV1,
  receivedTimestampMs: number,
): LogicalSignalRuntimeValueV1 {
  let quality: LogicalSignalRuntimeQualityV1 = mapped.quality
  let statusCode = mapped.statusCode
  let nextValue = previous.value
  if (mapped.quality === 'GOOD') {
    try {
      nextValue = validateLogicalSignalValueV1(channel.dataType, mapped.value, '$.value')
    } catch {
      quality = 'BAD'
      statusCode = 'BadTypeMismatch'
    }
  }
  return frozenSignalValue({
    signalId: channel.signalId,
    value: nextValue,
    quality,
    statusCode,
    owner: `opcua:${channel.endpointId}`,
    sourceTimestampMs: Math.max(previous.sourceTimestampMs, batch.sourceTimestampMs),
    publishedTimestampMs: Math.max(previous.publishedTimestampMs, batch.publishedTimestampMs),
    receivedTimestampMs: Math.max(previous.receivedTimestampMs, receivedTimestampMs),
  })
}

export function createLogicalSignalRuntimeStoreV1(
  projectInput: WorkcellProjectV5,
  configRevision: string,
): StoreApi<LogicalSignalRuntimeStoreV1> {
  let context = compileContext(projectInput, configRevision)

  return createStore<LogicalSignalRuntimeStoreV1>()((set, get) => {
    const publish = (
      nextContext: LogicalSignalRuntimeContextV1,
      bySignalId: Readonly<Record<string, LogicalSignalRuntimeValueV1>>,
    ): void => {
      context = nextContext
      set({
        ...get(),
        projectRevisionId: nextContext.project.revisionId,
        configRevision: nextContext.configRevision,
        bySignalId: frozenSignals(bySignalId),
      }, true)
    }

    const ingest = (batchInput: StateBatchV1, receiptCandidate: number): boolean => {
      const batch = validateStateBatchV1(batchInput)
      const receivedTimestampMs = requireTimestamp(receiptCandidate, 'Receipt timestamp')
      if (
        batch.projectId !== context.project.projectId
        || batch.configRevision !== context.configRevision
        || !context.channelIdsByEndpoint.has(batch.endpointId)
        || batch.sequence <= (context.endpointSequences.get(batch.endpointId) ?? 0)
        || receivedTimestampMs < (context.endpointReceiptFences.get(batch.endpointId) ?? 0)
        || batch.sourceTimestampMs < (context.endpointSourceTimestampFences.get(batch.endpointId) ?? 0)
        || batch.publishedTimestampMs < (context.endpointPublishedTimestampFences.get(batch.endpointId) ?? 0)
      ) return false

      const recognized = batch.values.flatMap((mapped) => {
        const channel = context.channelsByMappingId.get(mapped.mappingId)
        return channel?.endpointId === batch.endpointId ? [[channel, mapped] as const] : []
      })
      if (recognized.length === 0) return false

      const nextSignals: Record<string, LogicalSignalRuntimeValueV1> = { ...get().bySignalId }
      for (const [channel, mapped] of recognized) {
        const previous = nextSignals[channel.signalId]
        if (previous === undefined) continue
        nextSignals[channel.signalId] = nextSignalValue(previous, channel, mapped, batch, receivedTimestampMs)
      }
      context.endpointSequences.set(batch.endpointId, batch.sequence)
      context.endpointReceiptFences.set(batch.endpointId, receivedTimestampMs)
      context.endpointSourceTimestampFences.set(batch.endpointId, batch.sourceTimestampMs)
      context.endpointPublishedTimestampFences.set(batch.endpointId, batch.publishedTimestampMs)
      publish(context, nextSignals)
      return true
    }

    const markEndpointDisconnected = (endpointId: string, atCandidate: number): void => {
      const atMs = requireTimestamp(atCandidate, 'Disconnect timestamp')
      const signalIds = context.channelIdsByEndpoint.get(endpointId)
      if (signalIds === undefined) return
      const nextSignals: Record<string, LogicalSignalRuntimeValueV1> = { ...get().bySignalId }
      for (const signalId of signalIds) {
        const previous = nextSignals[signalId]
        if (previous === undefined) continue
        nextSignals[signalId] = frozenSignalValue({
          ...previous,
          quality: 'STALE',
          statusCode: 'BadNoCommunication',
          receivedTimestampMs: Math.max(previous.receivedTimestampMs, atMs),
        })
      }
      publish(context, nextSignals)
    }

    const resetGatewaySession = (atCandidate: number): void => {
      const atMs = requireTimestamp(atCandidate, 'Reset timestamp')
      const nextSignals: Record<string, LogicalSignalRuntimeValueV1> = { ...get().bySignalId }
      for (const signalIds of context.channelIdsByEndpoint.values()) {
        for (const signalId of signalIds) {
          const previous = nextSignals[signalId]
          if (previous === undefined) continue
          nextSignals[signalId] = frozenSignalValue({
            ...previous,
            quality: 'BAD',
            statusCode: 'BadWaitingForInitialData',
            receivedTimestampMs: Math.max(previous.receivedTimestampMs, atMs),
          })
        }
      }
      context.endpointSequences.clear()
      context.endpointReceiptFences.clear()
      context.endpointSourceTimestampFences.clear()
      context.endpointPublishedTimestampFences.clear()
      publish(context, nextSignals)
    }

    return {
      projectRevisionId: context.project.revisionId,
      configRevision: context.configRevision,
      bySignalId: context.initialSignals,
      read: (signalId) => get().bySignalId[signalId] ?? null,
      ingest,
      markEndpointDisconnected,
      resetGatewaySession,
      replaceProject: (nextProjectInput, nextConfigRevision) => {
        const nextContext = compileContext(nextProjectInput, nextConfigRevision)
        publish(nextContext, nextContext.initialSignals)
      },
    }
  })
}
