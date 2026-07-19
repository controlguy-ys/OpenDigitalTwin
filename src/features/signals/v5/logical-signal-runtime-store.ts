import {
  validateLogicalSignalValueV1,
  validateWorkcellProjectV5,
  type LogicalSignalValueV1,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import type { RuntimeMappedValueV1, RuntimeValueQualityV1, StateBatchV1 } from '../../../core/runtime-protocol/v1.js'
import { createStore, type StoreApi } from 'zustand/vanilla'

export type LogicalSignalRuntimeQualityV1 = RuntimeValueQualityV1 | 'STALE'
export type LogicalSignalRuntimeOwnerV1 = 'initial' | `opcua:${string}`

export interface LogicalSignalRuntimeValueV1 {
  readonly signalId: string
  readonly value: LogicalSignalValueV1
  readonly quality: LogicalSignalRuntimeQualityV1
  readonly statusCode: string
  readonly owner: LogicalSignalRuntimeOwnerV1
  readonly sourceTimestampMs: number
  readonly publishedTimestampMs: number
  readonly receivedTimestampMs: number
}

export interface LogicalSignalRuntimeStoreV1 {
  readonly projectId: string
  readonly configRevision: string
  readonly signals: Readonly<Record<string, LogicalSignalRuntimeValueV1>>
  read(signalId: string): LogicalSignalRuntimeValueV1 | null
  ingest(value: unknown, receivedTimestampMs?: number): boolean
  markEndpointDisconnected(endpointId: string, receivedTimestampMs?: number): void
  replaceProject(projectInput: WorkcellProjectV5, configRevision: string): void
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
    const channel: SignalChannelV1 = Object.freeze({
      mappingId: mapping.id,
      endpointId: mapping.endpointId,
      signalId: signal.id,
      dataType: signal.dataType,
    })
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
    sourceTimestampMs: batch.sourceTimestampMs,
    publishedTimestampMs: batch.publishedTimestampMs,
    receivedTimestampMs,
  })
}

export function createLogicalSignalRuntimeStoreV1(
  projectInput: WorkcellProjectV5,
  configRevision: string,
): StoreApi<LogicalSignalRuntimeStoreV1> {
  let context = compileContext(projectInput, configRevision)

  return createStore<LogicalSignalRuntimeStoreV1>()((set, get) => {
    const publish = (nextContext: LogicalSignalRuntimeContextV1, signals: Readonly<Record<string, LogicalSignalRuntimeValueV1>>): void => {
      context = nextContext
      set({
        ...get(),
        projectId: nextContext.project.projectId,
        configRevision: nextContext.configRevision,
        signals: frozenSignals(signals),
      }, true)
    }

    const ingest = (value: unknown, receiptCandidate = Date.now()): boolean => {
      const batch = asStateBatch(value)
      if (batch === null) return false
      const receivedTimestampMs = requireTimestamp(receiptCandidate, 'Receipt timestamp')
      if (
        batch.projectId !== context.project.projectId
        || batch.configRevision !== context.configRevision
        || !context.channelIdsByEndpoint.has(batch.endpointId)
        || batch.sequence <= (context.endpointSequences.get(batch.endpointId) ?? 0)
      ) return false

      context.endpointSequences.set(batch.endpointId, batch.sequence)
      const nextSignals: Record<string, LogicalSignalRuntimeValueV1> = { ...get().signals }
      let changed = false
      for (const mapped of batch.values) {
        const channel = context.channelsByMappingId.get(mapped.mappingId)
        if (channel === undefined || channel.endpointId !== batch.endpointId) continue
        const previous = nextSignals[channel.signalId]
        if (previous === undefined) continue
        nextSignals[channel.signalId] = nextSignalValue(previous, channel, mapped, batch, receivedTimestampMs)
        changed = true
      }
      if (!changed) return false
      publish(context, nextSignals)
      return true
    }

    const markEndpointDisconnected = (endpointId: string, receiptCandidate = Date.now()): void => {
      const receivedTimestampMs = requireTimestamp(receiptCandidate, 'Receipt timestamp')
      const ids = context.channelIdsByEndpoint.get(endpointId)
      if (ids === undefined) return
      const nextSignals: Record<string, LogicalSignalRuntimeValueV1> = { ...get().signals }
      for (const signalId of ids) {
        const previous = nextSignals[signalId]
        if (previous === undefined || previous.owner === 'initial') continue
        nextSignals[signalId] = frozenSignalValue({
          ...previous,
          quality: 'STALE',
          statusCode: 'BadNoCommunication',
          receivedTimestampMs,
        })
      }
      publish(context, nextSignals)
    }

    return {
      projectId: context.project.projectId,
      configRevision: context.configRevision,
      signals: context.initialSignals,
      read: (signalId) => get().signals[signalId] ?? null,
      ingest,
      markEndpointDisconnected,
      replaceProject: (nextProjectInput, nextConfigRevision) => {
        const nextContext = compileContext(nextProjectInput, nextConfigRevision)
        publish(nextContext, nextContext.initialSignals)
      },
    }
  })
}
