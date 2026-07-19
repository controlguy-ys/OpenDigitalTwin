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
  validateWorkcellProjectV4,
  type OpcUaEndpointV4,
  type OpcUaMappingLeafV4,
  type OpcUaMappingV4,
  type WorkcellProjectV4,
} from '../../src/core/project-v4/index.js'
import { rpyDegreesToRuntimeQuaternionV1 } from '../../src/core/runtime-interpolation/v1.js'
import {
  validateStateBatchV1,
  type RuntimeMappedValueV1,
  type RuntimeScalarOrStructureV1,
  type RuntimeValueQualityV1,
  type StateBatchV1,
} from '../../src/core/runtime-protocol/v1.js'
import type {
  RuntimeGatewayDiagnosticErrorV1,
  RuntimeGatewayOpcUaClientEndpointPhaseV1,
  RuntimeGatewayOpcUaClientEndpointStatusV1,
} from '../../src/core/runtime-protocol/gateway-status-v1.js'

export interface CompiledOpcUaClientMappingV1 {
  readonly id: string
  readonly coherenceGroupId: string | null
  readonly coordinateConvention: OpcUaMappingV4['coordinateConvention']
  readonly publishingIntervalMs: number
  readonly leaves: readonly OpcUaMappingLeafV4[]
}

export interface CompiledOpcUaClientEndpointV1 {
  readonly endpointId: string
  readonly endpointUrl: string
  readonly publishingIntervalMs: number
  readonly reconnectDelayMs: number
  readonly monitoringIntervalMs: number
  readonly nodeSamplingIntervalMs: Readonly<Record<string, number>>
  readonly nodeIds: readonly string[]
  readonly mappings: readonly CompiledOpcUaClientMappingV1[]
}

export interface OpcUaClientSnapshotAssemblerOptionsV1 {
  readonly project: WorkcellProjectV4
  readonly endpoint: CompiledOpcUaClientEndpointV1
  readonly configRevision?: string
  readonly gatewayId: string
  readonly originId: string
  readonly nowMs: () => number
  readonly publish: (batch: StateBatchV1) => void
}

export interface OpcUaClientSnapshotAssemblerV1 {
  accept(nodeId: string, value: unknown, statusCode: string, sourceTimestampMs: number): void
  reset(): void
}

export interface OpcUaClientAdapterOptionsV1 {
  readonly gatewayId: string
  readonly originId: string
  readonly configRevision: string
  readonly publish: (batch: StateBatchV1) => void
  readonly nowMs?: () => number
  readonly createClient?: (endpoint: OpcUaEndpointV4) => OPCUAClient
}

export interface OpcUaClientAdapterV1 {
  start(): Promise<void>
  stop(): Promise<void>
  status(): readonly RuntimeGatewayOpcUaClientEndpointStatusV1[]
}

interface LeafSampleV1 {
  readonly value: RuntimeScalarOrStructureV1
  readonly quality: RuntimeValueQualityV1
  readonly statusCode: string
  readonly sourceTimestampMs: number
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
  readonly endpoint: OpcUaEndpointV4
  readonly plan: CompiledOpcUaClientEndpointV1 | null
  readonly assembler: OpcUaClientSnapshotAssemblerV1 | null
  client: OPCUAClient | null
  session: ClientSession | null
  subscription: ClientSubscription | null
  group: ClientMonitoredItemGroup | null
  reconnectTimer: NodeJS.Timeout | null
  recovery: Promise<void> | null
  connectTask: Promise<void> | null
  generation: number
  stopped: boolean
  connecting: boolean
  connected: boolean
}

const CONNECT_TIMEOUT_MS = 5_000

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

function isReadDirection(direction: OpcUaMappingV4['direction']): boolean {
  return direction === 'read' || direction === 'readWrite'
}

function isClientMode(project: WorkcellProjectV4): boolean {
  return project.opcUa.mode === 'client' || project.opcUa.mode === 'bridge'
}

function uniqueNodeIds(mappings: readonly CompiledOpcUaClientMappingV1[]): readonly string[] {
  return Object.freeze([...new Set(mappings.flatMap((mapping) => (
    mapping.leaves.map((leaf) => leaf.nodeId)
  )))])
}

function freezeMapping(
  mapping: OpcUaMappingV4,
  endpoint: OpcUaEndpointV4,
): CompiledOpcUaClientMappingV1 {
  return Object.freeze({
    id: mapping.id,
    coherenceGroupId: mapping.coherenceGroupId,
    coordinateConvention: mapping.coordinateConvention,
    publishingIntervalMs: mapping.publishingIntervalMs ?? endpoint.publishingIntervalMs,
    leaves: Object.freeze([...mapping.leaves]),
  })
}

export function compileOpcUaClientReadPlanV1(
  projectInput: WorkcellProjectV4,
): readonly CompiledOpcUaClientEndpointV1[] {
  const project = validateWorkcellProjectV4(projectInput)
  if (!isClientMode(project)) return Object.freeze([])

  const mappingsByEndpoint = new Map<string, CompiledOpcUaClientMappingV1[]>()
  for (const mapping of project.opcUa.mappings) {
    if (!isReadDirection(mapping.direction)) continue
    const endpoint = project.opcUa.endpoints.find(({ endpointId }) => endpointId === mapping.endpointId)
    if (endpoint === undefined) continue
    const mappings = mappingsByEndpoint.get(mapping.endpointId) ?? []
    mappings.push(freezeMapping(mapping, endpoint))
    mappingsByEndpoint.set(mapping.endpointId, mappings)
  }

  const endpoints: CompiledOpcUaClientEndpointV1[] = []
  for (const endpoint of project.opcUa.endpoints) {
    if (!endpoint.enabled) continue
    const mappings = mappingsByEndpoint.get(endpoint.endpointId)
    if (mappings === undefined || mappings.length === 0) continue
    const nodeSamplingIntervalMs = Object.fromEntries([...new Set(
      mappings.flatMap((mapping) => mapping.leaves.map((leaf) => leaf.nodeId)),
    )].map((nodeId) => [nodeId, Math.min(...mappings.flatMap((mapping) => (
      mapping.leaves.some((leaf) => leaf.nodeId === nodeId) ? [mapping.publishingIntervalMs] : []
    )))])) as Record<string, number>
    endpoints.push(Object.freeze({
      endpointId: endpoint.endpointId,
      endpointUrl: endpoint.endpointUrl,
      publishingIntervalMs: endpoint.publishingIntervalMs,
      reconnectDelayMs: endpoint.reconnectDelayMs,
      monitoringIntervalMs: Math.min(...Object.values(nodeSamplingIntervalMs)),
      nodeSamplingIntervalMs: Object.freeze(nodeSamplingIntervalMs),
      mappings: Object.freeze(mappings),
      nodeIds: uniqueNodeIds(mappings),
    }))
  }
  return Object.freeze(endpoints)
}

function runtimeQuality(statusCode: string): RuntimeValueQualityV1 {
  if (statusCode.startsWith('Good')) return 'GOOD'
  if (statusCode.startsWith('Uncertain')) return 'UNCERTAIN'
  return 'BAD'
}

function scalarFromLeaf(
  leaf: OpcUaMappingLeafV4,
  input: unknown,
): RuntimeScalarOrStructureV1 | null {
  if (leaf.projectDataType === 'boolean') return typeof input === 'boolean' ? input : null
  if (leaf.projectDataType === 'string') return typeof input === 'string' ? input : null
  if (typeof input !== 'number' || !Number.isFinite(input)) return null
  const scaled = input * leaf.scale + leaf.offset
  if (!Number.isFinite(scaled)) return null
  return leaf.projectDataType === 'integer' ? Math.trunc(scaled) : scaled
}

function setLeafAtPath(
  target: Record<string, RuntimeScalarOrStructureV1>,
  path: readonly (string | number)[],
  value: RuntimeScalarOrStructureV1,
): void {
  let current: Record<string, RuntimeScalarOrStructureV1> | RuntimeScalarOrStructureV1[] = target
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]!
    const existing = Array.isArray(current)
      ? current[typeof segment === 'number' ? segment : Number.NaN]
      : current[String(segment)]
    const nextSegment = path[index + 1]!
    if (existing !== undefined && typeof existing === 'object' && existing !== null) {
      current = existing as Record<string, RuntimeScalarOrStructureV1> | RuntimeScalarOrStructureV1[]
      continue
    }
    const child: Record<string, RuntimeScalarOrStructureV1> | RuntimeScalarOrStructureV1[] = (
      typeof nextSegment === 'number' ? [] : {}
    )
    if (Array.isArray(current)) {
      current[typeof segment === 'number' ? segment : Number.NaN] = child
    } else {
      current[String(segment)] = child
    }
    current = child
  }
  const finalSegment = path.at(-1)
  if (finalSegment === undefined) throw new Error('OPC_UA_LEAF_PATH_EMPTY')
  if (Array.isArray(current)) {
    current[typeof finalSegment === 'number' ? finalSegment : Number.NaN] = value
  } else {
    current[String(finalSegment)] = value
  }
}

function aggregateQuality(samples: readonly LeafSampleV1[]): RuntimeValueQualityV1 {
  if (samples.some((sample) => sample.quality === 'BAD')) return 'BAD'
  if (samples.some((sample) => sample.quality === 'UNCERTAIN')) return 'UNCERTAIN'
  return 'GOOD'
}

function aggregateStatusCode(samples: readonly LeafSampleV1[]): string {
  const bad = samples.find((sample) => sample.quality === 'BAD')
  if (bad !== undefined) return bad.statusCode
  const uncertain = samples.find((sample) => sample.quality === 'UNCERTAIN')
  return uncertain?.statusCode ?? 'Good'
}

function mappingValue(
  mapping: CompiledOpcUaClientMappingV1,
  samples: readonly LeafSampleV1[],
): RuntimeMappedValueV1 {
  const rootScalar = mapping.leaves.length === 1 && mapping.leaves[0]!.leafPath.length === 0
  const structured: Record<string, RuntimeScalarOrStructureV1> = {}
  if (!rootScalar) {
    for (let index = 0; index < mapping.leaves.length; index += 1) {
      setLeafAtPath(structured, mapping.leaves[index]!.leafPath, samples[index]!.value)
    }
  }
  const firstTarget = mapping.leaves[0]?.projectTarget
  const isEntityPose = firstTarget?.type === 'entity-frame'
    && mapping.leaves.length === 6
    && mapping.leaves.every((leaf) => leaf.projectTarget.type === 'entity-frame')
    && Array.isArray(structured.positionM)
    && Array.isArray(structured.rpyDegrees)
  const value: RuntimeScalarOrStructureV1 = rootScalar
    ? samples[0]!.value
    : isEntityPose
    ? {
        positionM: structured.positionM as readonly number[],
        quaternion: rpyDegreesToRuntimeQuaternionV1(structured.rpyDegrees as [number, number, number]),
      }
    : structured
  return Object.freeze({
    mappingId: mapping.id,
    coherenceGroupId: mapping.coherenceGroupId,
    value,
    unit: isEntityPose ? mapping.coordinateConvention : mapping.leaves[0]!.unit,
    quality: aggregateQuality(samples),
    statusCode: aggregateStatusCode(samples),
  })
}

export function createOpcUaClientSnapshotAssemblerV1(
  options: OpcUaClientSnapshotAssemblerOptionsV1,
): OpcUaClientSnapshotAssemblerV1 {
  const samplesByMapping = new Map<string, (LeafSampleV1 | undefined)[]>()
  const referencesByNodeId = new Map<string, { readonly mapping: CompiledOpcUaClientMappingV1; readonly index: number }[]>()
  let sequence = 0
  for (const mapping of options.endpoint.mappings) {
    samplesByMapping.set(mapping.id, Array.from({ length: mapping.leaves.length }))
    mapping.leaves.forEach((leaf, index) => {
      const references = referencesByNodeId.get(leaf.nodeId) ?? []
      references.push({ mapping, index })
      referencesByNodeId.set(leaf.nodeId, references)
    })
  }

  const reset = (): void => {
    for (const samples of samplesByMapping.values()) samples.fill(undefined)
  }

  return Object.freeze({
    reset,
    accept(nodeId: string, input: unknown, statusCode: string, sourceTimestampMs: number) {
      const references = referencesByNodeId.get(nodeId)
      if (references === undefined) return
      const changedMappingIds = new Set<string>()
      for (const reference of references) {
        const leaf = reference.mapping.leaves[reference.index]!
        const scalar = scalarFromLeaf(leaf, input)
        const samples = samplesByMapping.get(reference.mapping.id)!
        const previous = samples[reference.index]
        const quality = scalar === null ? 'BAD' : runtimeQuality(statusCode)
        if (quality === 'BAD') {
          if (previous !== undefined) {
            samples[reference.index] = Object.freeze({
              value: previous.value,
              quality: 'BAD',
              statusCode: scalar === null ? 'BadTypeMismatch' : statusCode,
              sourceTimestampMs,
            })
            changedMappingIds.add(reference.mapping.id)
          }
          continue
        }
        samples[reference.index] = Object.freeze({
          value: scalar!,
          quality,
          statusCode,
          sourceTimestampMs,
        })
        changedMappingIds.add(reference.mapping.id)
      }
      const published: RuntimeMappedValueV1[] = []
      let latestSourceTimestampMs = 0
      for (const mapping of options.endpoint.mappings) {
        if (!changedMappingIds.has(mapping.id)) continue
        const samples = samplesByMapping.get(mapping.id)!
        if (samples.some((candidate) => candidate === undefined)) continue
        const coherent = samples as LeafSampleV1[]
        latestSourceTimestampMs = Math.max(
          latestSourceTimestampMs,
          ...coherent.map((candidate) => candidate.sourceTimestampMs),
        )
        published.push(mappingValue(mapping, coherent))
      }
      if (published.length === 0) return
      sequence += 1
      options.publish(validateStateBatchV1({
        type: 'state-batch-v1',
        protocolVersion: 1,
        gatewayId: options.gatewayId,
        projectId: options.project.projectId,
        configRevision: options.configRevision ?? options.project.revisionId,
        endpointId: options.endpoint.endpointId,
        sequence,
        sourceTimestampMs: latestSourceTimestampMs,
        publishedTimestampMs: options.nowMs(),
        originId: options.originId,
        values: published,
      }))
    },
  })
}

async function closeRuntime(runtime: EndpointRuntimeV1): Promise<void> {
  if (runtime.reconnectTimer !== null) {
    clearTimeout(runtime.reconnectTimer)
    runtime.reconnectTimer = null
  }
  const group = runtime.group
  const subscription = runtime.subscription
  const session = runtime.session
  const client = runtime.client
  runtime.group = null
  runtime.subscription = null
  runtime.session = null
  runtime.client = null
  runtime.connected = false
  if (group !== null) await group.terminate().catch(() => undefined)
  if (subscription !== null) await subscription.terminate().catch(() => undefined)
  if (session !== null) await session.close().catch(() => undefined)
  if (client !== null) await client.disconnect().catch(() => undefined)
}

async function closeDetachedConnection(
  client: OPCUAClient,
  session: ClientSession | null,
  subscription: ClientSubscription | null,
  group: ClientMonitoredItemGroup | null,
): Promise<void> {
  if (group !== null) await group.terminate().catch(() => undefined)
  if (subscription !== null) await subscription.terminate().catch(() => undefined)
  if (session !== null) await session.close().catch(() => undefined)
  await client.disconnect().catch(() => undefined)
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

function createClient(endpoint: OpcUaEndpointV4): OPCUAClient {
  return OPCUAClient.create({
    applicationName: 'WebDigitalTwin Runtime Gateway Client',
    endpointMustExist: true,
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    keepSessionAlive: false,
    connectionStrategy: { initialDelay: endpoint.reconnectDelayMs, maxDelay: endpoint.reconnectDelayMs, maxRetry: 0 },
  })
}

export function createOpcUaClientAdapterV1(
  projectInput: WorkcellProjectV4,
  options: OpcUaClientAdapterOptionsV1,
): OpcUaClientAdapterV1 {
  const project = validateWorkcellProjectV4(projectInput)
  const plans = compileOpcUaClientReadPlanV1(project)
  const nowMs = options.nowMs ?? Date.now
  const createRuntimeClient = options.createClient ?? createClient
  const runtimes = new Map<string, EndpointRuntimeV1>()
  let lifecycleTail: Promise<void> = Promise.resolve()

  const plansByEndpointId = new Map(plans.map((plan) => [plan.endpointId, plan]))
  for (const endpoint of project.opcUa.endpoints) {
    const plan = plansByEndpointId.get(endpoint.endpointId) ?? null
    runtimes.set(endpoint.endpointId, {
      endpoint,
      plan,
      assembler: plan === null ? null : createOpcUaClientSnapshotAssemblerV1({ project, endpoint: plan, configRevision: options.configRevision, gatewayId: options.gatewayId, originId: options.originId, nowMs, publish: options.publish }),
      client: null,
      session: null,
      subscription: null,
      group: null,
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
    runtime.nextRetryAtMs = nowMs() + runtime.plan!.reconnectDelayMs
    runtime.reconnectTimer = setTimeout(() => {
      runtime.reconnectTimer = null
      runtime.nextRetryAtMs = null
      startConnect(runtime)
    }, runtime.plan!.reconnectDelayMs)
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
    runtime.lastError = diagnosticError(error, nowMs())
    runtime.reconnectAttempt += 1
    runtime.nextRetryAtMs = nowMs() + runtime.plan!.reconnectDelayMs
    runtime.connected = false
    runtime.generation += 1
    const recovery = closeRuntime(runtime).catch(() => undefined)
    runtime.recovery = recovery
    void recovery.finally(() => {
      if (runtime.recovery !== recovery) return
      runtime.recovery = null
      if (!runtime.stopped) scheduleReconnect(runtime)
    })
  }

  async function connect(runtime: EndpointRuntimeV1): Promise<void> {
    if (
      runtime.stopped
      || runtime.connecting
      || runtime.connected
      || runtime.recovery !== null
    ) return
    const plan = runtime.plan
    if (plan === null || runtime.assembler === null) return
    runtime.connecting = true
    const generation = runtime.generation
    const candidate = createRuntimeClient({
      endpointId: plan.endpointId,
      name: plan.endpointId,
      endpointUrl: plan.endpointUrl,
      enabled: true,
      publishingIntervalMs: plan.publishingIntervalMs,
      reconnectDelayMs: plan.reconnectDelayMs,
    })
    runtime.client = candidate
    let session: ClientSession | null = null
    let subscription: ClientSubscription | null = null
    let group: ClientMonitoredItemGroup | null = null
    const active = () => (
      !runtime.stopped
      && runtime.generation === generation
      && runtime.client === candidate
    )
    try {
      await withTimeout(candidate.connect(plan.endpointUrl), CONNECT_TIMEOUT_MS)
      if (!active()) return
      session = await candidate.createSession()
      if (!active()) return
      runtime.session = session
      subscription = await session.createSubscription2({
        requestedPublishingInterval: plan.publishingIntervalMs,
        requestedLifetimeCount: 60,
        requestedMaxKeepAliveCount: 10,
        maxNotificationsPerPublish: 0,
        publishingEnabled: true,
        priority: 0,
      })
      if (!active()) return
      runtime.subscription = subscription
      group = await subscription.monitorItems(
        plan.nodeIds.map((nodeId) => ({ nodeId, attributeId: AttributeIds.Value })),
        { samplingInterval: plan.monitoringIntervalMs, queueSize: 1, discardOldest: true },
        TimestampsToReturn.Both,
      )
      if (!active()) return
      runtime.group = group
      runtime.assembler.reset()
      group.on('changed', (_item, dataValue, index) => {
        const nodeId = plan.nodeIds[index]
        if (nodeId === undefined || !active() || runtime.group !== group) return
        try {
          const quality = runtimeQuality(dataValue.statusCode.toString())
          const notificationAtMs = nowMs()
          runtime.lastValueQuality = quality
          runtime.lastNotificationAtMs = notificationAtMs
          if (quality === 'GOOD') runtime.lastGoodValueAtMs = notificationAtMs
          const timestamp = dataValue.sourceTimestamp?.getTime()
            ?? dataValue.serverTimestamp?.getTime()
            ?? nowMs()
          runtime.assembler!.accept(nodeId, dataValue.value.value, dataValue.statusCode.toString(), timestamp)
        } catch (error) {
          runtime.lastError = diagnosticError(error, nowMs())
        }
      })
      group.on('err', (message) => { runtime.lastError = diagnosticError(message, nowMs()) })
      group.on('terminated', () => {
        if (active()) recover(runtime, new Error('OPC_UA_MONITORED_GROUP_TERMINATED'))
      })
      candidate.on('connection_lost', () => {
        if (active()) recover(runtime, new Error('OPC_UA_CONNECTION_LOST'))
      })
      runtime.connected = true
      runtime.reconnectAttempt = 0
      runtime.nextRetryAtMs = null
      runtime.lastError = null
    } catch (error) {
      if (active()) recover(runtime, error)
    } finally {
      runtime.connecting = false
      if (!active()) {
        await closeDetachedConnection(candidate, session, subscription, group)
      }
      if (
        !runtime.stopped
        && runtime.recovery === null
        && !runtime.connected
        && runtime.reconnectTimer === null
      ) scheduleReconnect(runtime)
    }
  }

  function enqueue(transition: () => Promise<void>): Promise<void> {
    const requested = lifecycleTail.then(transition)
    lifecycleTail = requested.catch(() => undefined)
    return requested
  }

  return Object.freeze({
    start: () => enqueue(async () => {
      for (const runtime of runtimes.values()) {
        if (runtime.plan === null) continue
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
      monitoredItemCount: runtime.plan?.nodeIds.length ?? 0,
      mappingCount: runtime.plan?.mappings.length ?? 0,
      lastValueQuality: runtime.lastValueQuality,
      lastNotificationAtMs: runtime.lastNotificationAtMs,
      lastGoodValueAtMs: runtime.lastGoodValueAtMs,
      reconnectAttempt: runtime.reconnectAttempt,
      nextRetryAtMs: runtime.nextRetryAtMs,
      lastError: runtime.lastError,
    }))),
  })
}
