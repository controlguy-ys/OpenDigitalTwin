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
  type RuntimeMappedValueV1,
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
import { splitStateBatchesV1 } from './state-batch-hub.js'
import {
  compileOpcUaClientWritePlanV1,
  createOpcUaClientWriteServiceV1,
  type OpcUaClientWriteRequestV1,
  type OpcUaClientWriteResultV1,
} from './opcua-client-write-service.js'

export interface OpcUaClientSnapshotAssemblerOptionsV1 {
  readonly project: WorkcellProjectV5
  readonly endpoint: CompiledOpcUaClientEndpointReadPlanV1
  readonly configRevision: string
  readonly gatewayId: string
  readonly originId: string
  readonly nowMs: () => number
  readonly publish: (batch: StateBatchV1) => void
}

export interface OpcUaClientSnapshotAssemblerV1 {
  accept(rootKey: string, value: unknown, statusCode: string, sourceTimestampMs: number): void
  reset(): void
}

export interface OpcUaClientAdapterOptionsV1 {
  readonly gatewayId: string
  readonly originId: string
  readonly configRevision: string
  readonly publish: (batch: StateBatchV1) => void
  readonly nowMs?: () => number
  readonly createClient?: (endpoint: OpcUaEndpointV5) => OPCUAClient
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
  stopped: boolean
  connecting: boolean
  connected: boolean
}

const CONNECT_TIMEOUT_MS = 5_000

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
  let nextSequence = 1

  const reset = (): void => {
    retained.clear()
  }

  return Object.freeze({
    reset,
    accept(rootKey: string, input: unknown, statusCode: string, sourceTimestampMs: number): void {
      const mappingIds = mappingIdsByRootKey.get(rootKey)
      if (mappingIds === undefined) return
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
      if (values.length === 0) return
      const source: StateBatchV1 = {
        type: 'state-batch-v1',
        protocolVersion: 1,
        gatewayId: options.gatewayId,
        projectId: project.projectId,
        configRevision: options.configRevision,
        endpointId: options.endpoint.endpointId,
        sequence: nextSequence,
        sourceTimestampMs,
        publishedTimestampMs: options.nowMs(),
        originId: options.originId,
        values,
      }
      const batches = splitStateBatchesV1(source, nextSequence)
      nextSequence += batches.length
      for (const batch of batches) options.publish(batch)
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
  const runtimes = new Map<string, EndpointRuntimeV1>()
  let lifecycleTail: Promise<void> = Promise.resolve()

  for (const endpoint of project.opcUa.endpoints) {
    const readPlan = readPlansByEndpoint.get(endpoint.endpointId) ?? null
    const mappingIds = new Set<string>([
      ...(readPlan?.monitoredRoots.flatMap((root) => root.mappingIds) ?? []),
      ...(writeMappingIdsByEndpoint.get(endpoint.endpointId) ?? []),
    ])
    const eligible = isClientMode(project) && endpoint.enabled && mappingIds.size > 0
    runtimes.set(endpoint.endpointId, {
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
      stopped: true,
      connecting: false,
      connected: false,
      lastValueQuality: null,
      lastNotificationAtMs: null,
      lastGoodValueAtMs: null,
      reconnectAttempt: 0,
      nextRetryAtMs: null,
      lastError: null,
    })
  }

  function scheduleReconnect(runtime: EndpointRuntimeV1): void {
    if (
      runtime.stopped
      || runtime.reconnectTimer !== null
      || runtime.recovery !== null
      || runtime.connecting
      || runtime.connected
    ) return
    runtime.nextRetryAtMs = nowMs() + runtime.endpoint.reconnectDelayMs
    runtime.reconnectTimer = setTimeout(() => {
      runtime.reconnectTimer = null
      runtime.nextRetryAtMs = null
      startConnect(runtime)
    }, runtime.endpoint.reconnectDelayMs)
  }

  function startConnect(runtime: EndpointRuntimeV1): void {
    if (runtime.connectTask !== null) return
    const task = connect(runtime)
    runtime.connectTask = task
    void task.finally(() => {
      if (runtime.connectTask === task) runtime.connectTask = null
    })
  }

  function recover(runtime: EndpointRuntimeV1, error: unknown): void {
    if (runtime.stopped || runtime.recovery !== null) return
    runtime.generation += 1
    runtime.connected = false
    runtime.lastError = diagnosticError(error, nowMs())
    runtime.reconnectAttempt += 1
    runtime.nextRetryAtMs = nowMs() + runtime.endpoint.reconnectDelayMs
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
        runtime.assembler?.accept(root.rootKey, dataValue.value.value, statusCode, sourceTimestampMs)
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
        runtime.assembler = createOpcUaClientSnapshotAssemblerV1({
          project,
          endpoint: readPlan,
          configRevision: options.configRevision,
          gatewayId: options.gatewayId,
          originId: options.originId,
          nowMs,
          publish: options.publish,
        })
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
      runtime.connected = true
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
        runtime.stopped = true
        runtime.generation += 1
        runtime.reconnectAttempt = 0
        runtime.nextRetryAtMs = null
        await closeRuntime(runtime)
        await runtime.recovery
        await runtime.connectTask
        await closeRuntime(runtime)
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
