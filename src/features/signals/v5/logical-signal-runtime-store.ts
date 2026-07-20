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
  restoreReplayPrefix(batch: StateBatchV1, receivedTimestampMs: number): boolean
  beginEndpointCatchup(endpointId: string, atMs: number): EndpointCatchupGuardV5
  markEndpointDisconnected(endpointId: string, atMs: number): void
  resetEndpointSession(endpointId: string, atMs: number): void
  resetGatewaySession(atMs: number): void
  read(signalId: string): LogicalSignalRuntimeValueV1 | null
}

export interface EndpointCatchupGuardV5 {
  commit(): void
  abort(): void
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
  readonly enabledEndpointIds: ReadonlySet<string>
  readonly initialSignals: Readonly<Record<string, LogicalSignalRuntimeValueV1>>
  readonly endpointSequences: Map<string, number>
  readonly endpointReceiptFences: Map<string, number>
  readonly channelSourceTimestampFences: Map<string, number>
  readonly channelPublishedTimestampFences: Map<string, number>
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
    enabledEndpointIds: new Set(project.opcUa.endpoints.filter((endpoint) => endpoint.enabled).map((endpoint) => endpoint.endpointId)),
    initialSignals: frozenSignals(initialSignals),
    endpointSequences: new Map(),
    endpointReceiptFences: new Map(),
    channelSourceTimestampFences: new Map(),
    channelPublishedTimestampFences: new Map(),
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
    receivedTimestampMs: Math.max(previous.receivedTimestampMs, receivedTimestampMs),
  })
}

export function createLogicalSignalRuntimeStoreV1(
  projectInput: WorkcellProjectV5,
  configRevision: string,
): StoreApi<LogicalSignalRuntimeStoreV1> {
  let context = compileContext(projectInput, configRevision)
  let guardEpoch = 0

  return createStore<LogicalSignalRuntimeStoreV1>()((set, get) => {
    const guardsByEndpoint = new Map<string, {
      readonly snapshot: Readonly<Record<string, LogicalSignalRuntimeValueV1>>
      readonly pending: Record<string, LogicalSignalRuntimeValueV1>
      readonly sequence: number | undefined
      readonly receipt: number | undefined
      readonly sourceFences: ReadonlyMap<string, number | undefined>
      readonly publishedFences: ReadonlyMap<string, number | undefined>
      touched: Set<string>
      active: boolean
    }>()
    const noOpGuardsByEndpoint = new Set<string>()
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
        || batch.sourceTimestampMs > batch.publishedTimestampMs
      ) return false

      const recognized = batch.values.flatMap((mapped) => {
        const channel = context.channelsByMappingId.get(mapped.mappingId)
        return channel?.endpointId === batch.endpointId ? [[channel, mapped] as const] : []
      })
      if (recognized.length === 0) return false
      const groups = new Map<string, typeof recognized>()
      for (const entry of recognized) {
        const key = entry[1].coherenceGroupId === null
          ? `mapping:${entry[0].mappingId}`
          : `coherence:${entry[1].coherenceGroupId}`
        const group = groups.get(key) ?? []
        group.push(entry)
        groups.set(key, group)
      }
      const accepted = [...groups.values()].flatMap((group) => group.some(([channel]) => (
        batch.sourceTimestampMs < (context.channelSourceTimestampFences.get(channel.mappingId) ?? 0)
        || batch.publishedTimestampMs < (context.channelPublishedTimestampFences.get(channel.mappingId) ?? 0)
      )) ? [] : group)
      if (accepted.length === 0) return false

      const nextSignals: Record<string, LogicalSignalRuntimeValueV1> = { ...get().bySignalId }
      const guard = guardsByEndpoint.get(batch.endpointId)
      for (const [channel, mapped] of accepted) {
        const previous = guard?.pending[channel.signalId] ?? nextSignals[channel.signalId]
        if (previous === undefined) continue
        const next = nextSignalValue(previous, channel, mapped, batch, receivedTimestampMs)
        if (guard !== undefined) {
          guard.pending[channel.signalId] = next
          guard.touched.add(channel.signalId)
        } else nextSignals[channel.signalId] = next
      }
      context.endpointSequences.set(batch.endpointId, batch.sequence)
      context.endpointReceiptFences.set(batch.endpointId, receivedTimestampMs)
      for (const [channel] of accepted) {
        context.channelSourceTimestampFences.set(channel.mappingId, batch.sourceTimestampMs)
        context.channelPublishedTimestampFences.set(channel.mappingId, batch.publishedTimestampMs)
      }
      publish(context, nextSignals)
      return true
    }

    const markEndpointDisconnected = (endpointId: string, atCandidate: number): void => {
      const atMs = requireTimestamp(atCandidate, 'Disconnect timestamp')
      const signalIds = context.channelIdsByEndpoint.get(endpointId)
      if (signalIds === undefined) return
      const guard = guardsByEndpoint.get(endpointId)
      if (guard !== undefined) {
        for (const signalId of signalIds) {
          const pending = guard.pending[signalId]
          if (pending === undefined || (pending.quality === 'STALE' && pending.statusCode === 'BadNoCommunication' && pending.receivedTimestampMs >= atMs)) continue
          guard.pending[signalId] = frozenSignalValue({
            ...pending,
            quality: 'STALE',
            statusCode: 'BadNoCommunication',
            receivedTimestampMs: Math.max(pending.receivedTimestampMs, atMs),
          })
          guard.touched.add(signalId)
        }
        return
      }
      const nextSignals: Record<string, LogicalSignalRuntimeValueV1> = { ...get().bySignalId }
      let changed = false
      for (const signalId of signalIds) {
        const previous = nextSignals[signalId]
        if (previous === undefined || (previous.quality === 'STALE' && previous.statusCode === 'BadNoCommunication' && previous.receivedTimestampMs >= atMs)) continue
        nextSignals[signalId] = frozenSignalValue({
          ...previous,
          quality: 'STALE',
          statusCode: 'BadNoCommunication',
          receivedTimestampMs: Math.max(previous.receivedTimestampMs, atMs),
        })
        changed = true
      }
      if (changed) publish(context, nextSignals)
    }

    const resetEndpointSession = (endpointId: string, atCandidate: number): void => {
      const atMs = requireTimestamp(atCandidate, 'Endpoint reset timestamp')
      const signalIds = context.channelIdsByEndpoint.get(endpointId)
      if (signalIds === undefined) return
      const nextSignals: Record<string, LogicalSignalRuntimeValueV1> = { ...get().bySignalId }
      const guard = guardsByEndpoint.get(endpointId)
      for (const signalId of signalIds) {
        const previous = guard?.pending[signalId] ?? nextSignals[signalId]
        if (previous === undefined) continue
        const next = frozenSignalValue({
          ...previous,
          quality: 'BAD',
          statusCode: 'BadWaitingForInitialData',
          receivedTimestampMs: Math.max(previous.receivedTimestampMs, atMs),
        })
        if (guard === undefined) nextSignals[signalId] = next
        else {
          guard.pending[signalId] = next
          guard.touched.add(signalId)
        }
      }
      context.endpointSequences.delete(endpointId)
      context.endpointReceiptFences.delete(endpointId)
      for (const channel of context.channelsByMappingId.values()) {
        if (channel.endpointId !== endpointId) continue
        context.channelSourceTimestampFences.delete(channel.mappingId)
        context.channelPublishedTimestampFences.delete(channel.mappingId)
      }
      publish(context, nextSignals)
    }

    const restoreReplayPrefix = (batchInput: StateBatchV1, receiptCandidate: number): boolean => {
      const batch = validateStateBatchV1(batchInput)
      const receivedTimestampMs = requireTimestamp(receiptCandidate, 'Replay receipt timestamp')
      if (
        batch.projectId !== context.project.projectId
        || batch.configRevision !== context.configRevision
        || batch.sourceTimestampMs > batch.publishedTimestampMs
      ) return false
      const recognized = batch.values.flatMap((mapped) => {
        const channel = context.channelsByMappingId.get(mapped.mappingId)
        return channel?.endpointId === batch.endpointId ? [[channel, mapped] as const] : []
      })
      if (recognized.length === 0) return false
      const nextSignals: Record<string, LogicalSignalRuntimeValueV1> = { ...get().bySignalId }
      for (const [channel, mapped] of recognized) {
        const previous = nextSignals[channel.signalId]
        if (previous !== undefined) nextSignals[channel.signalId] = nextSignalValue(previous, channel, mapped, batch, receivedTimestampMs)
      }
      publish(context, nextSignals)
      return true
    }

    const beginEndpointCatchup = (endpointId: string, atCandidate: number): EndpointCatchupGuardV5 => {
      const atMs = requireTimestamp(atCandidate, 'Catch-up timestamp')
      if (!context.enabledEndpointIds.has(endpointId)) throw new Error('ENDPOINT_CATCHUP_UNKNOWN_ENDPOINT')
      if (guardsByEndpoint.has(endpointId) || noOpGuardsByEndpoint.has(endpointId)) throw new Error('ENDPOINT_CATCHUP_ALREADY_ACTIVE')
      if (!context.channelIdsByEndpoint.has(endpointId)) {
        const epoch = guardEpoch
        let active = true
        noOpGuardsByEndpoint.add(endpointId)
        const finish = (): void => {
          if (!active || epoch !== guardEpoch) return
          active = false
          noOpGuardsByEndpoint.delete(endpointId)
        }
        return Object.freeze({ commit: finish, abort: finish })
      }
      const snapshot: Record<string, LogicalSignalRuntimeValueV1> = {}
      const nextSignals: Record<string, LogicalSignalRuntimeValueV1> = { ...get().bySignalId }
      for (const signalId of context.channelIdsByEndpoint.get(endpointId) ?? []) {
        const previous = nextSignals[signalId]
        if (previous === undefined) continue
        snapshot[signalId] = previous
        nextSignals[signalId] = frozenSignalValue({ ...previous, quality: 'STALE', statusCode: 'BadNoCommunication', receivedTimestampMs: Math.max(previous.receivedTimestampMs, atMs) })
      }
      const guard = {
        snapshot: frozenSignals(snapshot), pending: { ...snapshot }, touched: new Set<string>(),
        sequence: context.endpointSequences.get(endpointId), receipt: context.endpointReceiptFences.get(endpointId), active: true,
        sourceFences: new Map([...context.channelsByMappingId.values()]
          .filter((channel) => channel.endpointId === endpointId)
          .map((channel) => [channel.mappingId, context.channelSourceTimestampFences.get(channel.mappingId)])),
        publishedFences: new Map([...context.channelsByMappingId.values()]
          .filter((channel) => channel.endpointId === endpointId)
          .map((channel) => [channel.mappingId, context.channelPublishedTimestampFences.get(channel.mappingId)])),
      }
      const epoch = guardEpoch
      guardsByEndpoint.set(endpointId, guard)
      try {
        publish(context, nextSignals)
      } catch {
        // Zustand updates state before notifying listeners. A hostile observer
        // must not strand an installed catch-up guard before its handle returns.
      }
      const finish = (commit: boolean): void => {
        if (!guard.active || epoch !== guardEpoch) return
        guard.active = false
        guardsByEndpoint.delete(endpointId)
        if (!commit) {
          if (guard.sequence === undefined) context.endpointSequences.delete(endpointId)
          else context.endpointSequences.set(endpointId, guard.sequence)
          if (guard.receipt === undefined) context.endpointReceiptFences.delete(endpointId)
          else context.endpointReceiptFences.set(endpointId, guard.receipt)
          for (const [mappingId, value] of guard.sourceFences) {
            if (value === undefined) context.channelSourceTimestampFences.delete(mappingId)
            else context.channelSourceTimestampFences.set(mappingId, value)
          }
          for (const [mappingId, value] of guard.publishedFences) {
            if (value === undefined) context.channelPublishedTimestampFences.delete(mappingId)
            else context.channelPublishedTimestampFences.set(mappingId, value)
          }
          // The stale overlay is already published and intentionally becomes
          // durable when the frame is aborted.
          return
        }
        const next: Record<string, LogicalSignalRuntimeValueV1> = { ...get().bySignalId }
        for (const [signalId, prior] of Object.entries(guard.snapshot)) {
          next[signalId] = guard.touched.has(signalId) ? guard.pending[signalId]! : prior
        }
        publish(context, next)
      }
      return Object.freeze({ commit: () => finish(true), abort: () => finish(false) })
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
      context.channelSourceTimestampFences.clear()
      context.channelPublishedTimestampFences.clear()
      guardsByEndpoint.clear()
      noOpGuardsByEndpoint.clear()
      guardEpoch += 1
      publish(context, nextSignals)
    }

    return {
      projectRevisionId: context.project.revisionId,
      configRevision: context.configRevision,
      bySignalId: context.initialSignals,
      read: (signalId) => get().bySignalId[signalId] ?? null,
      ingest,
      restoreReplayPrefix,
      beginEndpointCatchup,
      markEndpointDisconnected,
      resetEndpointSession,
      resetGatewaySession,
      replaceProject: (nextProjectInput, nextConfigRevision) => {
        const nextContext = compileContext(nextProjectInput, nextConfigRevision)
        guardsByEndpoint.clear()
        noOpGuardsByEndpoint.clear()
        guardEpoch += 1
        publish(nextContext, nextContext.initialSignals)
      },
    }
  })
}
