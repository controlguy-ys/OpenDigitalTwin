import {
  AttributeIds,
  MessageSecurityMode,
  OPCUAClient,
  SecurityPolicy,
  TimestampsToReturn,
  type ClientMonitoredItemGroup,
  type ClientSession,
  type ClientSubscription,
} from 'node-opcua'

import {
  validateWorkcellProjectV5,
  type OpcUaEndpointV5,
  type WorkcellProjectV5,
} from '../../src/core/project-v5/index.js'
import {
  MAX_RUNTIME_BATCH_BYTES_V1,
  MAX_RUNTIME_STATE_VALUES_V1,
  endpointLifecycleEventIdV1,
  validateEndpointLifecycleV1,
  validateStateBatchV1,
  type RuntimeMappedValueV1,
  type RuntimePublisherMessageV1,
  type RuntimeValueQualityV1,
  type StateBatchV1,
} from '../../src/core/runtime-protocol/v1.js'
import type {
  RuntimeGatewayDiagnosticErrorV1,
  RuntimeGatewayOpcUaClientEndpointPhaseV1,
  RuntimeGatewayOpcUaClientEndpointStatusV1,
} from '../../src/core/runtime-protocol/gateway-status-v1.js'
import {
  assembleMappingValueV1,
  compileOpcUaClientReadPlanV1,
  groupResolvedRootsBySamplingIntervalV1,
  resolveOpcUaClientReadRootsV1,
  type CompiledOpcUaClientEndpointReadPlanV1,
  type ResolvedOpcUaClientMonitoredRootV1,
} from './opcua-client-read-plan.js'
import { RuntimeStreamTimelineErrorV1, splitStateBatchesV1 } from './runtime-stream-timeline.js'
import {
  compileOpcUaClientWritePlanV1,
  createOpcUaClientWriteServiceV1,
  type OpcUaClientWriteRequestV1,
  type OpcUaClientWriteResultV1,
} from './opcua-client-write-service.js'

export interface OpcUaClientSnapshotAssemblerOptionsV1 {
  readonly project: WorkcellProjectV5
  readonly endpoint: CompiledOpcUaClientEndpointReadPlanV1
}

export interface UnsequencedOpcUaClientSnapshotV1 {
  readonly sourceTimestampMs: number
  readonly values: readonly RuntimeMappedValueV1[]
}

export interface OpcUaClientSnapshotAssemblerV1 {
  accept(
    rootKey: string,
    value: unknown,
    statusCode: string,
    sourceTimestampMs: number,
  ): UnsequencedOpcUaClientSnapshotV1 | null
  reset(): void
}

export interface OpcUaClientAdapterOptionsV1 {
  readonly gatewayId: string
  readonly originId: string
  readonly configRevision: string
  readonly publisherGeneration?: number
  readonly publish: (publication: NormalizedOpcUaClientPublicationV1) => void
  readonly nowMs?: () => number
  readonly createClient?: (endpoint: OpcUaEndpointV5) => OPCUAClient
  /** Test/process-restore seam; each value must be a positive safe integer. */
  readonly initialSourceSequenceByEndpoint?: Readonly<Record<string, number>>
  /** Test/process-restore seam; each value must be a non-negative safe integer. */
  readonly initialSessionGenerationByEndpoint?: Readonly<Record<string, number>>
}

export interface OpcUaClientAdapterV1 {
  start(): Promise<void>
  stop(): Promise<void>
  status(): readonly RuntimeGatewayOpcUaClientEndpointStatusV1[]
  write(request: OpcUaClientWriteRequestV1): Promise<OpcUaClientWriteResultV1>
}

interface EndpointRuntimeDiagnosticsV1 {
  lastValueQuality: 'GOOD' | 'UNCERTAIN' | 'BAD' | null
  lastNotificationAtMs: number | null
  lastGoodValueAtMs: number | null
  reconnectAttempt: number
  nextRetryAtMs: number | null
  lastError: RuntimeGatewayDiagnosticErrorV1 | null
}

interface EarlyRootSnapshotV1 {
  readonly rootKey: string
  readonly snapshot: UnsequencedOpcUaClientSnapshotV1
  readonly arrivalOrdinal: number
  readonly encodedBytes: number
}

interface EndpointRuntimeV1 extends EndpointRuntimeDiagnosticsV1 {
  readonly endpoint: OpcUaEndpointV5
  readonly readPlan: CompiledOpcUaClientEndpointReadPlanV1 | null
  readonly mappingCount: number
  client: OPCUAClient | null
  session: ClientSession | null
  subscription: ClientSubscription | null
  groups: ClientMonitoredItemGroup[]
  assembler: OpcUaClientSnapshotAssemblerV1 | null
  reconnectTimer: NodeJS.Timeout | null
  recovery: Promise<void> | null
  connectTask: Promise<void> | null
  generation: number
  nextSourceSequence: number
  sessionGeneration: number
  lastGatewayTimestampMs: number
  earlyRoots: Map<string, EarlyRootSnapshotV1>
  earlyEncodedBytes: number
  nextEarlyArrivalOrdinal: number
  drainingEarlyRoots: boolean
  sourceSequenceExhausted: boolean
  sessionGenerationExhausted: boolean
  gatewayClockFailed: boolean
  disconnectedSessionGeneration: number | null
  stopped: boolean
  connecting: boolean
  connected: boolean
}

const CONNECT_TIMEOUT_MS = 5_000
const MAX_EARLY_NOTIFICATION_BYTES_V1 = 8 * MAX_RUNTIME_BATCH_BYTES_V1
const encoder = new TextEncoder()
const NORMALIZED_OPCUA_CLIENT_PUBLICATION_V1: unique symbol = Symbol('normalized-opcua-client-publication-v1')
const normalizedOpcUaClientPublicationsV1 = new WeakSet<object>()

export interface NormalizedOpcUaClientPublicationV1 {
  readonly message: RuntimePublisherMessageV1
  readonly [NORMALIZED_OPCUA_CLIENT_PUBLICATION_V1]: true
}

function normalizeOpcUaClientPublicationV1(
  message: RuntimePublisherMessageV1,
): NormalizedOpcUaClientPublicationV1 {
  const validated = message.type === 'state-batch-v1'
    ? validateStateBatchV1(message)
    : validateEndpointLifecycleV1(message)
  const publication = Object.freeze({
    message: validated,
    [NORMALIZED_OPCUA_CLIENT_PUBLICATION_V1]: true as const,
  })
  normalizedOpcUaClientPublicationsV1.add(publication)
  return publication
}

export function readNormalizedOpcUaClientPublicationV1(
  publication: NormalizedOpcUaClientPublicationV1,
): RuntimePublisherMessageV1 {
  if (
    publication === null
    || typeof publication !== 'object'
    || !normalizedOpcUaClientPublicationsV1.has(publication)
  ) {
    throw new TypeError('Normalized OPC UA Client publication is invalid.')
  }
  return publication.message
}

export interface OpcUaClientAdapterPublicationHarnessV1 {
  lifecycle(phase: 'connected' | 'disconnected'): NormalizedOpcUaClientPublicationV1
  state(input: Readonly<{
    readonly rootKey: string
    readonly value: unknown
    readonly statusCode: string
    readonly sourceTimestampMs: number
  }>): readonly NormalizedOpcUaClientPublicationV1[]
}

/**
 * Test-only construction aid for Hub/Gateway fakes.  It intentionally accepts
 * OPC UA root notifications rather than raw protocol envelopes, so every State
 * publication follows the real mapping assembly and the module-private
 * normalization path.
 */
export function createOpcUaClientAdapterPublicationHarnessV1(options: Readonly<{
  readonly project: WorkcellProjectV5
  readonly endpointId: string
  readonly gatewayId: string
  readonly originId: string
  readonly configRevision: string
  readonly publisherGeneration?: number
  readonly nowMs?: () => number
}>): OpcUaClientAdapterPublicationHarnessV1 {
  const project = validateWorkcellProjectV5(options.project)
  const endpoint = compileOpcUaClientReadPlanV1(project)
    .find((candidate) => candidate.endpointId === options.endpointId)
  if (endpoint === undefined) {
    throw new TypeError(`OPC UA Client publication harness requires a read plan for ${options.endpointId}.`)
  }
  const publisherGeneration = options.publisherGeneration ?? 1
  if (!Number.isSafeInteger(publisherGeneration) || publisherGeneration < 1) {
    throw new TypeError('OPC UA publisher generation must be a positive safe integer.')
  }
  const nowMs = options.nowMs ?? Date.now
  const assembler = createOpcUaClientSnapshotAssemblerV1({ project, endpoint })
  let nextSequence = 1
  let sessionGeneration = 0
  let lastGatewayTimestampMs = 0
  const nextTimestamp = (): number => {
    const sample = nowMs()
    if (!Number.isSafeInteger(sample) || sample < 0) {
      throw new TypeError('Gateway clock must return a non-negative safe integer.')
    }
    lastGatewayTimestampMs = Math.max(lastGatewayTimestampMs, sample)
    return lastGatewayTimestampMs
  }
  const reserve = (count: number): number => {
    const first = nextSequence
    const last = first + count - 1
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last < 1) {
      throw new Error('OPC_UA_SOURCE_SEQUENCE_EXHAUSTED')
    }
    nextSequence = last + 1
    return first
  }

  return Object.freeze({
    lifecycle(phase: 'connected' | 'disconnected'): NormalizedOpcUaClientPublicationV1 {
      const occurredAtMs = nextTimestamp()
      if (phase === 'connected') sessionGeneration += 1
      const sequence = reserve(1)
      return normalizeOpcUaClientPublicationV1(validateEndpointLifecycleV1({
        type: 'endpoint-lifecycle-v1',
        protocolVersion: 1,
        gatewayId: options.gatewayId,
        projectId: project.projectId,
        configRevision: options.configRevision,
        endpointId: endpoint.endpointId,
        sequence,
        originId: options.originId,
        eventId: endpointLifecycleEventIdV1({ publisherGeneration, sessionGeneration, phase }),
        publisherGeneration,
        sessionGeneration,
        phase,
        statusCode: phase === 'connected' ? 'Good' : 'BadNoCommunication',
        occurredAtMs,
      }))
    },
    state(input: Readonly<{
      readonly rootKey: string
      readonly value: unknown
      readonly statusCode: string
      readonly sourceTimestampMs: number
    }>): readonly NormalizedOpcUaClientPublicationV1[] {
      const snapshot = assembler.accept(
        input.rootKey,
        input.value,
        input.statusCode,
        input.sourceTimestampMs,
      )
      if (snapshot === null) return Object.freeze([])
      const source = Object.freeze({
        type: 'state-batch-v1' as const,
        protocolVersion: 1 as const,
        gatewayId: options.gatewayId,
        projectId: project.projectId,
        configRevision: options.configRevision,
        endpointId: endpoint.endpointId,
        sequence: 1,
        sourceTimestampMs: snapshot.sourceTimestampMs,
        publishedTimestampMs: nextTimestamp(),
        originId: options.originId,
        values: snapshot.values,
      }) as StateBatchV1
      const chunks = splitStateBatchesV1(source, nextSequence)
      reserve(chunks.length)
      return Object.freeze(chunks.map(normalizeOpcUaClientPublicationV1))
    },
  })
}

function isClientMode(project: WorkcellProjectV5): boolean {
  return project.opcUa.mode === 'client' || project.opcUa.mode === 'bridge'
}

function endpointPhase(runtime: EndpointRuntimeV1): RuntimeGatewayOpcUaClientEndpointPhaseV1 {
  if (runtime.stopped) return 'disabled'
  if (runtime.connected) return 'connected'
  if (runtime.connecting) return 'connecting'
  if (runtime.recovery !== null || runtime.reconnectTimer !== null) return 'reconnecting'
  return runtime.lastError === null ? 'connecting' : 'faulted'
}

function diagnosticError(error: unknown, occurredAtMs: number): RuntimeGatewayDiagnosticErrorV1 {
  const message = error instanceof Error ? error.message : String(error)
  return Object.freeze({ code: message, message, occurredAtMs })
}

function runtimeQuality(statusCode: string): RuntimeValueQualityV1 {
  if (statusCode.startsWith('Good')) return 'GOOD'
  if (statusCode.startsWith('Uncertain')) return 'UNCERTAIN'
  return 'BAD'
}

function normalizedStatusCode(statusCode: { readonly name?: string; toString(): string }): string {
  return statusCode.name ?? statusCode.toString()
}

function createClient(endpoint: OpcUaEndpointV5): OPCUAClient {
  return OPCUAClient.create({
    applicationName: 'WebDigitalTwin Runtime Gateway Client',
    endpointMustExist: true,
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    keepSessionAlive: false,
    connectionStrategy: {
      initialDelay: endpoint.reconnectDelayMs,
      maxDelay: endpoint.reconnectDelayMs,
      maxRetry: 0,
    },
  })
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('OPC_UA_CLIENT_CONNECT_TIMEOUT')), timeoutMs)
    operation.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error) },
    )
  })
}

export function createOpcUaClientSnapshotAssemblerV1(
  options: OpcUaClientSnapshotAssemblerOptionsV1,
): OpcUaClientSnapshotAssemblerV1 {
  const project = validateWorkcellProjectV5(options.project)
  const mappingsById = new Map(project.opcUa.mappings.map((mapping) => [mapping.id, mapping]))
  const mappingIdsByRootKey = new Map(
    options.endpoint.monitoredRoots.map((root) => [root.rootKey, root.mappingIds]),
  )
  const retained = new Map<string, { readonly value: RuntimeMappedValueV1['value']; readonly unit: string }>()
  const reset = (): void => {
    retained.clear()
  }

  return Object.freeze({
    reset,
    accept(rootKey: string, input: unknown, statusCode: string, sourceTimestampMs: number): UnsequencedOpcUaClientSnapshotV1 | null {
      const mappingIds = mappingIdsByRootKey.get(rootKey)
      if (mappingIds === undefined) return null
      const quality = runtimeQuality(statusCode)
      const values: RuntimeMappedValueV1[] = []
      for (const mappingId of mappingIds) {
        const mapping = mappingsById.get(mappingId)
        if (mapping === undefined) continue
        const assembled = quality === 'GOOD'
          ? assembleMappingValueV1(mapping, input)
          : { ok: false as const, statusCode }
        if (assembled.ok) {
          retained.set(mapping.id, { value: assembled.value, unit: assembled.unit })
          values.push(Object.freeze({
            mappingId: mapping.id,
            coherenceGroupId: mapping.coherenceGroupId,
            value: assembled.value,
            unit: assembled.unit,
            quality: 'GOOD',
            statusCode,
          }))
          continue
        }
        const previous = retained.get(mapping.id)
        if (previous === undefined) continue
        values.push(Object.freeze({
          mappingId: mapping.id,
          coherenceGroupId: mapping.coherenceGroupId,
          value: previous.value,
          unit: previous.unit,
          quality: quality === 'GOOD' ? 'BAD' : quality,
          statusCode: quality === 'GOOD' ? assembled.statusCode : statusCode,
        }))
      }
      if (values.length === 0) return null
      return Object.freeze({
        sourceTimestampMs,
        values: Object.freeze(values),
      })
    },
  })
}

async function terminateGroups(groups: readonly ClientMonitoredItemGroup[]): Promise<void> {
  await Promise.all(groups.map(async (group) => group.terminate().catch(() => undefined)))
}

async function closeRuntime(runtime: EndpointRuntimeV1): Promise<void> {
  if (runtime.reconnectTimer !== null) {
    clearTimeout(runtime.reconnectTimer)
    runtime.reconnectTimer = null
  }
  const groups = runtime.groups
  const subscription = runtime.subscription
  const session = runtime.session
  const client = runtime.client
  runtime.groups = []
  runtime.subscription = null
  runtime.session = null
  runtime.client = null
  runtime.assembler?.reset()
  runtime.earlyRoots.clear()
  runtime.earlyEncodedBytes = 0
  runtime.nextEarlyArrivalOrdinal = 1
  runtime.drainingEarlyRoots = false
  runtime.connected = false
  await terminateGroups(groups)
  if (subscription !== null) await subscription.terminate().catch(() => undefined)
  if (session !== null) await session.close().catch(() => undefined)
  if (client !== null) await client.disconnect().catch(() => undefined)
}

async function closeDetachedConnection(
  client: OPCUAClient,
  session: ClientSession | null,
  subscription: ClientSubscription | null,
  groups: readonly ClientMonitoredItemGroup[],
): Promise<void> {
  await terminateGroups(groups)
  if (subscription !== null) await subscription.terminate().catch(() => undefined)
  if (session !== null) await session.close().catch(() => undefined)
  await client.disconnect().catch(() => undefined)
}

export function createOpcUaClientAdapterV1(
  projectInput: WorkcellProjectV5,
  options: OpcUaClientAdapterOptionsV1,
): OpcUaClientAdapterV1 {
  const project = validateWorkcellProjectV5(projectInput)
  const readPlansByEndpoint = new Map(
    compileOpcUaClientReadPlanV1(project).map((plan) => [plan.endpointId, plan]),
  )
  const writePlans = compileOpcUaClientWritePlanV1(project)
  const writeMappingIdsByEndpoint = new Map<string, Set<string>>()
  for (const write of writePlans) {
    const ids = writeMappingIdsByEndpoint.get(write.endpointId) ?? new Set<string>()
    ids.add(write.mappingId)
    writeMappingIdsByEndpoint.set(write.endpointId, ids)
  }
  const nowMs = options.nowMs ?? Date.now
  const createRuntimeClient = options.createClient ?? createClient
  const publisherGeneration = options.publisherGeneration ?? 1
  if (!Number.isSafeInteger(publisherGeneration) || publisherGeneration < 1) {
    throw new TypeError('OPC UA publisher generation must be a positive safe integer.')
  }
  const initialSourceSequenceByEndpoint = options.initialSourceSequenceByEndpoint ?? {}
  const initialSessionGenerationByEndpoint = options.initialSessionGenerationByEndpoint ?? {}
  const runtimes = new Map<string, EndpointRuntimeV1>()
  let lifecycleTail: Promise<void> = Promise.resolve()

  for (const endpoint of project.opcUa.endpoints) {
    const readPlan = readPlansByEndpoint.get(endpoint.endpointId) ?? null
    const mappingIds = new Set<string>([
      ...(readPlan?.monitoredRoots.flatMap((root) => root.mappingIds) ?? []),
      ...(writeMappingIdsByEndpoint.get(endpoint.endpointId) ?? []),
    ])
    const eligible = isClientMode(project) && endpoint.enabled && mappingIds.size > 0
    const initialSourceSequence = initialSourceSequenceByEndpoint[endpoint.endpointId] ?? 1
    const initialSessionGeneration = initialSessionGenerationByEndpoint[endpoint.endpointId] ?? 0
    if (!Number.isSafeInteger(initialSourceSequence) || initialSourceSequence < 1) {
      throw new TypeError('OPC UA initial source sequence must be a positive safe integer.')
    }
    if (!Number.isSafeInteger(initialSessionGeneration) || initialSessionGeneration < 0) {
      throw new TypeError('OPC UA initial session generation must be a non-negative safe integer.')
    }
    const runtime: EndpointRuntimeV1 = {
      endpoint,
      readPlan: eligible ? readPlan : null,
      mappingCount: eligible ? mappingIds.size : 0,
      client: null,
      session: null,
      subscription: null,
      groups: [],
      assembler: null,
      reconnectTimer: null,
      recovery: null,
      connectTask: null,
      generation: 0,
      nextSourceSequence: initialSourceSequence,
      sessionGeneration: initialSessionGeneration,
      lastGatewayTimestampMs: 0,
      earlyRoots: new Map(),
      earlyEncodedBytes: 0,
      nextEarlyArrivalOrdinal: 1,
      drainingEarlyRoots: false,
      sourceSequenceExhausted: false,
      sessionGenerationExhausted: false,
      gatewayClockFailed: false,
      disconnectedSessionGeneration: null,
      stopped: true,
      connecting: false,
      connected: false,
      lastValueQuality: null,
      lastNotificationAtMs: null,
      lastGoodValueAtMs: null,
      reconnectAttempt: 0,
      nextRetryAtMs: null,
      lastError: null,
    }
    if (runtime.readPlan !== null && runtime.readPlan.monitoredRoots.length > 0) {
      runtime.assembler = createOpcUaClientSnapshotAssemblerV1({
        project,
        endpoint: runtime.readPlan,
      })
    }
    runtimes.set(endpoint.endpointId, runtime)
  }

  function nextGatewayTimestamp(runtime: EndpointRuntimeV1): number {
    const sample = nowMs()
    if (!Number.isSafeInteger(sample) || sample < 0) {
      throw new TypeError('Gateway clock must return a non-negative safe integer.')
    }
    runtime.lastGatewayTimestampMs = Math.max(runtime.lastGatewayTimestampMs, sample)
    return runtime.lastGatewayTimestampMs
  }

  function isGatewayClockError(error: unknown): error is TypeError {
    return error instanceof TypeError
      && error.message === 'Gateway clock must return a non-negative safe integer.'
  }

  function reserveSourceSequenceRange(
    runtime: EndpointRuntimeV1,
    count: number,
  ): number | null {
    // Every non-terminal emission must leave the last safe sequence available
    // for the one required disconnected lifecycle event.
    if (!Number.isSafeInteger(count) || count < 1) return null
    const first = runtime.nextSourceSequence
    const last = first + count - 1
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last >= Number.MAX_SAFE_INTEGER) {
      return null
    }
    runtime.nextSourceSequence = last + 1
    return first
  }

  function reserveTerminalSourceSequence(runtime: EndpointRuntimeV1): number | null {
    const sequence = runtime.nextSourceSequence
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > Number.MAX_SAFE_INTEGER) {
      return null
    }
    runtime.nextSourceSequence = sequence + 1
    return sequence
  }

  function publishLifecycle(
    runtime: EndpointRuntimeV1,
    phase: 'connected' | 'disconnected',
    occurredAtMs = nextGatewayTimestamp(runtime),
  ): boolean {
    const sequence = phase === 'disconnected'
      ? reserveTerminalSourceSequence(runtime)
      : reserveSourceSequenceRange(runtime, 1)
    if (sequence === null) {
      runtime.lastError = diagnosticError(new Error('OPC_UA_SOURCE_SEQUENCE_EXHAUSTED'), runtime.lastGatewayTimestampMs)
      return false
    }
    const message = validateEndpointLifecycleV1({
      type: 'endpoint-lifecycle-v1',
      protocolVersion: 1,
      gatewayId: options.gatewayId,
      projectId: project.projectId,
      configRevision: options.configRevision,
      endpointId: runtime.endpoint.endpointId,
      sequence,
      originId: options.originId,
      eventId: endpointLifecycleEventIdV1({
        publisherGeneration,
        sessionGeneration: runtime.sessionGeneration,
        phase,
      }),
      publisherGeneration,
      sessionGeneration: runtime.sessionGeneration,
      phase,
      statusCode: phase === 'connected' ? 'Good' : 'BadNoCommunication',
      occurredAtMs,
    })
    options.publish(normalizeOpcUaClientPublicationV1(message))
    return true
  }

  function publishDisconnectedForSession(runtime: EndpointRuntimeV1): boolean {
    if (runtime.disconnectedSessionGeneration === runtime.sessionGeneration) return false
    const occurredAtMs = nextGatewayTimestamp(runtime)
    // Mark before the external publication callout. Reentrant recovery/stop
    // signals for this same Session therefore cannot create a second barrier.
    runtime.disconnectedSessionGeneration = runtime.sessionGeneration
    return publishLifecycle(runtime, 'disconnected', occurredAtMs)
  }

  function exhaustSourceSequence(runtime: EndpointRuntimeV1): void {
    if (runtime.sourceSequenceExhausted) return
    const wasLive = runtime.connected
    runtime.sourceSequenceExhausted = true
    // Fence callbacks before the terminal barrier so a notification from the
    // lost Session cannot follow its disconnected lifecycle event.
    runtime.generation += 1
    if (wasLive) {
      try {
        publishDisconnectedForSession(runtime)
      } catch {
        // The exact exhaustion diagnostic below remains authoritative.
      }
    }
    runtime.connected = false
    clearEarlyRoots(runtime)
    runtime.lastError = diagnosticError(
      new Error('OPC_UA_SOURCE_SEQUENCE_EXHAUSTED'),
      runtime.lastGatewayTimestampMs,
    )
    const recovery = closeRuntime(runtime).catch(() => undefined)
    runtime.recovery = recovery
    void recovery.finally(() => {
      if (runtime.recovery === recovery) runtime.recovery = null
    })
  }

  function createStateSource(
    runtime: EndpointRuntimeV1,
    snapshot: UnsequencedOpcUaClientSnapshotV1,
  ): StateBatchV1 {
    return createStateSourceAt(runtime, snapshot, nextGatewayTimestamp(runtime))
  }

  function createStateSourceAt(
    runtime: EndpointRuntimeV1,
    snapshot: UnsequencedOpcUaClientSnapshotV1,
    publishedTimestampMs: number,
  ): StateBatchV1 {
    // A logical snapshot can exceed the wire-byte limit and therefore cannot
    // be validated as one StateBatch before the splitter forms bounded chunks.
    // Its values originate only from the typed assembler above; each emitted
    // chunk is validated by splitStateBatchesV1.
    return Object.freeze({
      type: 'state-batch-v1',
      protocolVersion: 1,
      gatewayId: options.gatewayId,
      projectId: project.projectId,
      configRevision: options.configRevision,
      endpointId: runtime.endpoint.endpointId,
      // This is a placeholder solely for the splitter's preflight count. The
      // adapter replaces it with an atomically reserved source range below.
      sequence: 1,
      sourceTimestampMs: snapshot.sourceTimestampMs,
      publishedTimestampMs,
      originId: options.originId,
      values: snapshot.values,
    }) as StateBatchV1
  }

  function clearEarlyRoots(runtime: EndpointRuntimeV1): void {
    runtime.earlyRoots.clear()
    runtime.earlyEncodedBytes = 0
    runtime.nextEarlyArrivalOrdinal = 1
    runtime.drainingEarlyRoots = false
  }

  function encodedEarlySnapshotBytes(
    runtime: EndpointRuntimeV1,
    snapshot: UnsequencedOpcUaClientSnapshotV1,
  ): number {
    // Early buffering must account for the derived State frames, including
    // envelope repetition and high sequence-digit overhead, without sampling
    // the live clock or consuming a source counter.
    try {
      const chunks = splitStateBatchesV1(
        createStateSourceAt(runtime, snapshot, Number.MAX_SAFE_INTEGER),
        Number.MAX_SAFE_INTEGER - MAX_RUNTIME_STATE_VALUES_V1,
      )
      return chunks.reduce(
        (bytes, batch) => bytes + encoder.encode(JSON.stringify(batch)).byteLength,
        0,
      )
    } catch {
      // A root which cannot form a bounded State frame is necessarily beyond
      // the complete early-notification budget.
      return MAX_EARLY_NOTIFICATION_BYTES_V1 + 1
    }
  }

  function bufferEarlySnapshot(
    runtime: EndpointRuntimeV1,
    rootKey: string,
    snapshot: UnsequencedOpcUaClientSnapshotV1,
  ): void {
    const previous = runtime.earlyRoots.get(rootKey)
    if (previous !== undefined) runtime.earlyEncodedBytes -= previous.encodedBytes
    const entry: EarlyRootSnapshotV1 = Object.freeze({
      rootKey,
      snapshot,
      arrivalOrdinal: runtime.nextEarlyArrivalOrdinal,
      encodedBytes: encodedEarlySnapshotBytes(runtime, snapshot),
    })
    runtime.nextEarlyArrivalOrdinal += 1
    runtime.earlyRoots.set(rootKey, entry)
    runtime.earlyEncodedBytes += entry.encodedBytes
    const rootLimit = runtime.readPlan?.monitoredRoots.length ?? 0
    if (
      runtime.earlyRoots.size > rootLimit
      || runtime.earlyEncodedBytes > MAX_EARLY_NOTIFICATION_BYTES_V1
    ) {
      recover(runtime, new Error('OPC_UA_EARLY_NOTIFICATION_CAPACITY_EXCEEDED'))
    }
  }

  function drainEarlySnapshots(runtime: EndpointRuntimeV1): void {
    while (runtime.connected && runtime.earlyRoots.size > 0) {
      const next = [...runtime.earlyRoots.values()]
        .sort((left, right) => left.arrivalOrdinal - right.arrivalOrdinal)[0]
      if (next === undefined) break
      runtime.earlyRoots.delete(next.rootKey)
      runtime.earlyEncodedBytes -= next.encodedBytes
      publishState(runtime, createStateSource(runtime, next.snapshot))
    }
    if (runtime.connected) runtime.drainingEarlyRoots = false
  }

  function publishState(runtime: EndpointRuntimeV1, source: StateBatchV1): boolean {
    if (!runtime.connected || runtime.sourceSequenceExhausted) return false
    // Split using the exact next source sequence before reservation.  Decimal
    // digit growth changes JSON byte length near the safe-integer boundary;
    // preflighting at sequence 1 can otherwise reserve too short a range.
    const firstSequence = runtime.nextSourceSequence
    let batches: readonly StateBatchV1[]
    try {
      batches = splitStateBatchesV1(source, firstSequence)
    } catch (error) {
      if (
        error instanceof RuntimeStreamTimelineErrorV1
        && error.code === 'RUNTIME_STATE_WIRE_SEQUENCE_EXHAUSTED'
      ) {
        exhaustSourceSequence(runtime)
        return false
      }
      throw error
    }
    const reservedFirstSequence = reserveSourceSequenceRange(runtime, batches.length)
    if (reservedFirstSequence === null) {
      exhaustSourceSequence(runtime)
      return false
    }
    for (const batch of batches) options.publish(normalizeOpcUaClientPublicationV1(batch))
    return true
  }

  function scheduleReconnect(runtime: EndpointRuntimeV1): void {
    if (
      runtime.stopped
      || runtime.sourceSequenceExhausted
      || runtime.sessionGenerationExhausted
      || runtime.gatewayClockFailed
      || runtime.reconnectTimer !== null
      || runtime.recovery !== null
      || runtime.connecting
      || runtime.connected
    ) return
    try {
      runtime.nextRetryAtMs = nextGatewayTimestamp(runtime) + runtime.endpoint.reconnectDelayMs
    } catch (error) {
      runtime.gatewayClockFailed = true
      runtime.lastError = diagnosticError(error, runtime.lastGatewayTimestampMs)
      runtime.nextRetryAtMs = null
      return
    }
    runtime.reconnectTimer = setTimeout(() => {
      runtime.reconnectTimer = null
      runtime.nextRetryAtMs = null
      startConnect(runtime)
    }, runtime.endpoint.reconnectDelayMs)
  }

  function startConnect(runtime: EndpointRuntimeV1): void {
    if (
      runtime.connectTask !== null
      || runtime.sessionGenerationExhausted
      || runtime.gatewayClockFailed
    ) return
    const task = connect(runtime)
    runtime.connectTask = task
    void task.finally(() => {
      if (runtime.connectTask === task) runtime.connectTask = null
    })
  }

  function recover(runtime: EndpointRuntimeV1, error: unknown): void {
    if (
      runtime.stopped
      || runtime.sourceSequenceExhausted
      || runtime.recovery !== null
    ) return
    const wasLive = runtime.connected
    runtime.generation += 1
    // Mark the Session non-live before the publication callout.  This fences
    // repeated/reentrant transport loss signals even if clock validation
    // prevents the terminal lifecycle message from being constructed.
    runtime.connected = false
    clearEarlyRoots(runtime)
    let diagnostic = error
    if (wasLive) {
      try {
        publishDisconnectedForSession(runtime)
      } catch (publishError) {
        diagnostic = publishError
      }
    }
    if (runtime.nextSourceSequence > Number.MAX_SAFE_INTEGER) {
      exhaustSourceSequence(runtime)
      return
    }
    if (isGatewayClockError(diagnostic)) runtime.gatewayClockFailed = true
    runtime.lastError = diagnosticError(diagnostic, runtime.lastGatewayTimestampMs)
    runtime.reconnectAttempt += 1
    if (runtime.gatewayClockFailed) {
      runtime.nextRetryAtMs = null
    } else {
      try {
        runtime.nextRetryAtMs = nextGatewayTimestamp(runtime) + runtime.endpoint.reconnectDelayMs
      } catch (clockError) {
        runtime.gatewayClockFailed = true
        runtime.nextRetryAtMs = null
        runtime.lastError = diagnosticError(clockError, runtime.lastGatewayTimestampMs)
      }
    }
    const recovery = closeRuntime(runtime).catch(() => undefined)
    runtime.recovery = recovery
    void recovery.finally(() => {
      if (runtime.recovery !== recovery) return
      runtime.recovery = null
      if (!runtime.stopped) scheduleReconnect(runtime)
    })
  }

  function attachMonitoredGroup(
    runtime: EndpointRuntimeV1,
    group: ClientMonitoredItemGroup,
    roots: readonly ResolvedOpcUaClientMonitoredRootV1[],
    generation: number,
  ): void {
    const active = () => (
      !runtime.stopped
      && runtime.generation === generation
      && runtime.groups.includes(group)
    )
    group.on('changed', (_item, dataValue, index: number) => {
      const root = roots[index]
      if (root === undefined || !active()) return
      try {
        const statusCode = normalizedStatusCode(dataValue.statusCode)
        const quality = runtimeQuality(statusCode)
        const notificationAtMs = nowMs()
        runtime.lastValueQuality = quality
        runtime.lastNotificationAtMs = notificationAtMs
        if (quality === 'GOOD') runtime.lastGoodValueAtMs = notificationAtMs
        const sourceTimestampMs = dataValue.sourceTimestamp?.getTime()
          ?? dataValue.serverTimestamp?.getTime()
          ?? nowMs()
        const snapshot = runtime.assembler?.accept(
          root.rootKey,
          dataValue.value.value,
          statusCode,
          sourceTimestampMs,
        )
        if (snapshot !== null && snapshot !== undefined) {
          if (runtime.connected && !runtime.drainingEarlyRoots) {
            publishState(runtime, createStateSource(runtime, snapshot))
          } else {
            bufferEarlySnapshot(runtime, root.rootKey, snapshot)
          }
        }
      } catch (error) {
        runtime.lastError = diagnosticError(error, nowMs())
      }
    })
    group.on('err', (message) => { runtime.lastError = diagnosticError(message, nowMs()) })
    group.on('terminated', () => {
      if (active()) recover(runtime, new Error('OPC_UA_MONITORED_GROUP_TERMINATED'))
    })
  }

  async function connect(runtime: EndpointRuntimeV1): Promise<void> {
    if (
      runtime.stopped
      || runtime.sourceSequenceExhausted
      || runtime.sessionGenerationExhausted
      || runtime.gatewayClockFailed
      || runtime.connecting
      || runtime.connected
      || runtime.recovery !== null
      || runtime.mappingCount === 0
    ) return
    runtime.connecting = true
    const generation = runtime.generation
    const candidate = createRuntimeClient(runtime.endpoint)
    runtime.client = candidate
    let session: ClientSession | null = null
    let subscription: ClientSubscription | null = null
    const groups: ClientMonitoredItemGroup[] = []
    const active = () => (
      !runtime.stopped
      && runtime.generation === generation
      && runtime.client === candidate
    )
    try {
      await withTimeout(candidate.connect(runtime.endpoint.endpointUrl), CONNECT_TIMEOUT_MS)
      if (!active()) return
      session = await candidate.createSession()
      if (!active()) return
      runtime.session = session
      subscription = await session.createSubscription2({
        requestedPublishingInterval: runtime.endpoint.publishingIntervalMs,
        requestedLifetimeCount: 60,
        requestedMaxKeepAliveCount: 10,
        maxNotificationsPerPublish: 0,
        publishingEnabled: true,
        priority: 0,
      })
      if (!active()) return
      runtime.subscription = subscription
      subscription.on('terminated', () => {
        if (active()) recover(runtime, new Error('OPC_UA_SUBSCRIPTION_TERMINATED'))
      })
      candidate.on('connection_lost', () => {
        if (active()) recover(runtime, new Error('OPC_UA_CONNECTION_LOST'))
      })

      const readPlan = runtime.readPlan
      if (readPlan !== null && readPlan.monitoredRoots.length > 0) {
        const namespaceArray = await session.readNamespaceArray()
        if (!active()) return
        const resolvedRoots = resolveOpcUaClientReadRootsV1(readPlan.monitoredRoots, namespaceArray)
        const resolvedGroups = groupResolvedRootsBySamplingIntervalV1(resolvedRoots)
        for (const resolvedGroup of resolvedGroups) {
          const group = await subscription.monitorItems(
            resolvedGroup.roots.map((root) => ({ nodeId: root.nodeId, attributeId: AttributeIds.Value })),
            { samplingInterval: resolvedGroup.samplingIntervalMs, queueSize: 1, discardOldest: true },
            TimestampsToReturn.Both,
          )
          if (!active()) {
            await group.terminate().catch(() => undefined)
            return
          }
          groups.push(group)
          runtime.groups = groups
          attachMonitoredGroup(runtime, group, resolvedGroup.roots, generation)
        }
      }
      if (!active()) return
      if (runtime.sessionGeneration >= Number.MAX_SAFE_INTEGER) {
        runtime.sessionGenerationExhausted = true
        throw new Error('OPC_UA_SESSION_GENERATION_EXHAUSTED')
      }
      // Validate the clock before mutating a Session generation or reserving a
      // lifecycle source sequence. A bad injected clock must be retryable.
      const connectedOccurredAtMs = nextGatewayTimestamp(runtime)
      runtime.sessionGeneration += 1
      runtime.disconnectedSessionGeneration = null
      runtime.connected = true
      runtime.drainingEarlyRoots = true
      if (!publishLifecycle(runtime, 'connected', connectedOccurredAtMs)) {
        runtime.connected = false
        exhaustSourceSequence(runtime)
        return
      }
      drainEarlySnapshots(runtime)
      if (!runtime.connected || runtime.sourceSequenceExhausted) return
      runtime.reconnectAttempt = 0
      runtime.nextRetryAtMs = null
      runtime.lastError = null
    } catch (error) {
      if (active()) recover(runtime, error)
    } finally {
      runtime.connecting = false
      if (!active()) {
        await closeDetachedConnection(candidate, session, subscription, groups)
      }
      if (
        !runtime.stopped
        && !runtime.sourceSequenceExhausted
        && !runtime.sessionGenerationExhausted
        && !runtime.gatewayClockFailed
        && runtime.recovery === null
        && !runtime.connected
        && runtime.reconnectTimer === null
      ) scheduleReconnect(runtime)
    }
  }

  const writeService = createOpcUaClientWriteServiceV1(project, {
    currentSession(endpointId) {
      const runtime = runtimes.get(endpointId)
      if (
        runtime === undefined
        || runtime.stopped
        || !runtime.connected
        || runtime.session === null
      ) return null
      return Object.freeze({ endpointId, generation: runtime.generation, session: runtime.session })
    },
  })

  function enqueue(transition: () => Promise<void>): Promise<void> {
    const requested = lifecycleTail.then(transition)
    lifecycleTail = requested.catch(() => undefined)
    return requested
  }

  return Object.freeze({
    start: () => enqueue(async () => {
      for (const runtime of runtimes.values()) {
        if (runtime.mappingCount === 0) continue
        runtime.stopped = false
        startConnect(runtime)
      }
    }),
    stop: () => enqueue(async () => {
      await Promise.all([...runtimes.values()].map(async (runtime) => {
        const wasLive = runtime.connected
        runtime.stopped = true
        runtime.generation += 1
        if (wasLive) {
          try {
            publishDisconnectedForSession(runtime)
          } catch (error) {
            // A failed clock must not be sampled again merely to decorate a
            // stop diagnostic: cleanup remains unconditional.
            runtime.lastError = diagnosticError(error, runtime.lastGatewayTimestampMs)
          }
        }
        clearEarlyRoots(runtime)
        runtime.reconnectAttempt = 0
        runtime.nextRetryAtMs = null
        try {
          await closeRuntime(runtime)
          await runtime.recovery
          await runtime.connectTask
        } finally {
          await closeRuntime(runtime)
        }
      }))
    }),
    status: () => Object.freeze([...runtimes.values()].map((runtime) => Object.freeze({
      endpointId: runtime.endpoint.endpointId,
      endpointUrl: runtime.endpoint.endpointUrl,
      phase: endpointPhase(runtime),
      sessionActive: runtime.session !== null,
      subscriptionActive: runtime.subscription !== null,
      monitoredItemCount: runtime.readPlan?.monitoredRoots.length ?? 0,
      mappingCount: runtime.mappingCount,
      lastValueQuality: runtime.lastValueQuality,
      lastNotificationAtMs: runtime.lastNotificationAtMs,
      lastGoodValueAtMs: runtime.lastGoodValueAtMs,
      reconnectAttempt: runtime.reconnectAttempt,
      nextRetryAtMs: runtime.nextRetryAtMs,
      lastError: runtime.lastError,
    }))),
    write: (request: OpcUaClientWriteRequestV1) => writeService.write(request),
  })
}
