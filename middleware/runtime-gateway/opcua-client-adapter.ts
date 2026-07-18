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

export interface CompiledOpcUaClientMappingV1 {
  readonly id: string
  readonly coherenceGroupId: string | null
  readonly coordinateConvention: OpcUaMappingV4['coordinateConvention']
  readonly leaves: readonly OpcUaMappingLeafV4[]
}

export interface CompiledOpcUaClientEndpointV1 {
  readonly endpointId: string
  readonly endpointUrl: string
  readonly publishingIntervalMs: number
  readonly reconnectDelayMs: number
  readonly nodeIds: readonly string[]
  readonly mappings: readonly CompiledOpcUaClientMappingV1[]
}

export interface OpcUaClientSnapshotAssemblerOptionsV1 {
  readonly project: WorkcellProjectV4
  readonly endpoint: CompiledOpcUaClientEndpointV1
  readonly gatewayId: string
  readonly originId: string
  readonly nowMs: () => number
  readonly publish: (batch: StateBatchV1) => void
}

export interface OpcUaClientSnapshotAssemblerV1 {
  accept(nodeId: string, value: unknown, statusCode: string, sourceTimestampMs: number): void
}

export interface OpcUaClientAdapterOptionsV1 {
  readonly gatewayId: string
  readonly originId: string
  readonly publish: (batch: StateBatchV1) => void
  readonly nowMs?: () => number
}

export interface OpcUaClientEndpointStatusV1 {
  readonly endpointId: string
  readonly connected: boolean
  readonly lastError: string | null
}

export interface OpcUaClientAdapterV1 {
  start(): Promise<void>
  stop(): Promise<void>
  status(): readonly OpcUaClientEndpointStatusV1[]
}

interface LeafSampleV1 {
  readonly value: RuntimeScalarOrStructureV1
  readonly quality: RuntimeValueQualityV1
  readonly statusCode: string
  readonly sourceTimestampMs: number
}

interface EndpointRuntimeV1 {
  readonly plan: CompiledOpcUaClientEndpointV1
  readonly assembler: OpcUaClientSnapshotAssemblerV1
  client: OPCUAClient | null
  session: ClientSession | null
  subscription: ClientSubscription | null
  group: ClientMonitoredItemGroup | null
  reconnectTimer: NodeJS.Timeout | null
  stopped: boolean
  connecting: boolean
  connected: boolean
  lastError: string | null
}

const CONNECT_TIMEOUT_MS = 5_000

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

function freezeMapping(mapping: OpcUaMappingV4): CompiledOpcUaClientMappingV1 {
  return Object.freeze({
    id: mapping.id,
    coherenceGroupId: mapping.coherenceGroupId,
    coordinateConvention: mapping.coordinateConvention,
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
    const mappings = mappingsByEndpoint.get(mapping.endpointId) ?? []
    mappings.push(freezeMapping(mapping))
    mappingsByEndpoint.set(mapping.endpointId, mappings)
  }

  const endpoints: CompiledOpcUaClientEndpointV1[] = []
  for (const endpoint of project.opcUa.endpoints) {
    if (!endpoint.enabled) continue
    const mappings = mappingsByEndpoint.get(endpoint.endpointId)
    if (mappings === undefined || mappings.length === 0) continue
    endpoints.push(Object.freeze({
      endpointId: endpoint.endpointId,
      endpointUrl: endpoint.endpointUrl,
      publishingIntervalMs: endpoint.publishingIntervalMs,
      reconnectDelayMs: endpoint.reconnectDelayMs,
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
  const structured: Record<string, RuntimeScalarOrStructureV1> = {}
  for (let index = 0; index < mapping.leaves.length; index += 1) {
    setLeafAtPath(structured, mapping.leaves[index]!.leafPath, samples[index]!.value)
  }
  const firstTarget = mapping.leaves[0]?.projectTarget
  const isEntityPose = firstTarget?.type === 'entity-frame'
    && mapping.leaves.length === 6
    && mapping.leaves.every((leaf) => leaf.projectTarget.type === 'entity-frame')
    && Array.isArray(structured.positionM)
    && Array.isArray(structured.rpyDegrees)
  const value: RuntimeScalarOrStructureV1 = isEntityPose
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

  return Object.freeze({
    accept(nodeId: string, input: unknown, statusCode: string, sourceTimestampMs: number) {
      const references = referencesByNodeId.get(nodeId)
      if (references === undefined) return
      const published: RuntimeMappedValueV1[] = []
      let latestSourceTimestampMs = sourceTimestampMs
      for (const reference of references) {
        const leaf = reference.mapping.leaves[reference.index]!
        const scalar = scalarFromLeaf(leaf, input)
        const sample: LeafSampleV1 = Object.freeze({
          value: scalar ?? 0,
          quality: scalar === null ? 'BAD' : runtimeQuality(statusCode),
          statusCode: scalar === null ? 'BadTypeMismatch' : statusCode,
          sourceTimestampMs,
        })
        const samples = samplesByMapping.get(reference.mapping.id)!
        samples[reference.index] = sample
        if (samples.some((candidate) => candidate === undefined)) continue
        const coherent = samples as LeafSampleV1[]
        latestSourceTimestampMs = Math.max(
          latestSourceTimestampMs,
          ...coherent.map((candidate) => candidate.sourceTimestampMs),
        )
        published.push(mappingValue(reference.mapping, coherent))
      }
      if (published.length === 0) return
      sequence += 1
      options.publish(validateStateBatchV1({
        type: 'state-batch-v1',
        protocolVersion: 1,
        gatewayId: options.gatewayId,
        projectId: options.project.projectId,
        configRevision: options.project.revisionId,
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
  runtime.group = null
  if (group !== null) await group.terminate().catch(() => undefined)
  const subscription = runtime.subscription
  runtime.subscription = null
  if (subscription !== null) await subscription.terminate().catch(() => undefined)
  const session = runtime.session
  runtime.session = null
  if (session !== null) await session.close().catch(() => undefined)
  const client = runtime.client
  runtime.client = null
  if (client !== null) await client.disconnect().catch(() => undefined)
  runtime.connected = false
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
  const runtimes = new Map<string, EndpointRuntimeV1>()
  let lifecycleTail: Promise<void> = Promise.resolve()

  for (const plan of plans) {
    runtimes.set(plan.endpointId, {
      plan,
      assembler: createOpcUaClientSnapshotAssemblerV1({ project, endpoint: plan, gatewayId: options.gatewayId, originId: options.originId, nowMs, publish: options.publish }),
      client: null,
      session: null,
      subscription: null,
      group: null,
      reconnectTimer: null,
      stopped: true,
      connecting: false,
      connected: false,
      lastError: null,
    })
  }

  function scheduleReconnect(runtime: EndpointRuntimeV1): void {
    if (runtime.stopped || runtime.reconnectTimer !== null) return
    runtime.reconnectTimer = setTimeout(() => {
      runtime.reconnectTimer = null
      void connect(runtime)
    }, runtime.plan.reconnectDelayMs)
  }

  async function connect(runtime: EndpointRuntimeV1): Promise<void> {
    if (runtime.stopped || runtime.connecting || runtime.connected) return
    runtime.connecting = true
    const candidate = createClient({
      endpointId: runtime.plan.endpointId,
      name: runtime.plan.endpointId,
      endpointUrl: runtime.plan.endpointUrl,
      enabled: true,
      publishingIntervalMs: runtime.plan.publishingIntervalMs,
      reconnectDelayMs: runtime.plan.reconnectDelayMs,
    })
    runtime.client = candidate
    try {
      await withTimeout(candidate.connect(runtime.plan.endpointUrl), CONNECT_TIMEOUT_MS)
      if (runtime.stopped) return
      const session = await candidate.createSession()
      if (runtime.stopped) { await session.close(); return }
      runtime.session = session
      const subscription = await session.createSubscription2({
        requestedPublishingInterval: runtime.plan.publishingIntervalMs,
        requestedLifetimeCount: 60,
        requestedMaxKeepAliveCount: 10,
        maxNotificationsPerPublish: 0,
        publishingEnabled: true,
        priority: 0,
      })
      runtime.subscription = subscription
      const group = await subscription.monitorItems(
        runtime.plan.nodeIds.map((nodeId) => ({ nodeId, attributeId: AttributeIds.Value })),
        { samplingInterval: runtime.plan.publishingIntervalMs, queueSize: 1, discardOldest: true },
        TimestampsToReturn.Both,
      )
      runtime.group = group
      group.on('changed', (_item, dataValue, index) => {
        const nodeId = runtime.plan.nodeIds[index]
        if (nodeId === undefined || runtime.stopped) return
        const timestamp = dataValue.sourceTimestamp?.getTime()
          ?? dataValue.serverTimestamp?.getTime()
          ?? nowMs()
        runtime.assembler.accept(nodeId, dataValue.value.value, dataValue.statusCode.toString(), timestamp)
      })
      group.on('err', (message) => { runtime.lastError = message })
      group.on('terminated', () => {
        runtime.connected = false
        if (!runtime.stopped) scheduleReconnect(runtime)
      })
      candidate.on('connection_lost', () => {
        runtime.connected = false
        if (!runtime.stopped) scheduleReconnect(runtime)
      })
      runtime.connected = true
      runtime.lastError = null
    } catch (error) {
      runtime.lastError = error instanceof Error ? error.message : String(error)
      await closeRuntime(runtime)
      if (!runtime.stopped) scheduleReconnect(runtime)
    } finally {
      runtime.connecting = false
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
        runtime.stopped = false
        void connect(runtime)
      }
    }),
    stop: () => enqueue(async () => {
      await Promise.all([...runtimes.values()].map(async (runtime) => {
        runtime.stopped = true
        await closeRuntime(runtime)
      }))
    }),
    status: () => Object.freeze([...runtimes.values()].map((runtime) => Object.freeze({
      endpointId: runtime.plan.endpointId,
      connected: runtime.connected,
      lastError: runtime.lastError,
    }))),
  })
}
