// @vitest-environment node

import { EventEmitter } from 'node:events'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DataType,
  MessageSecurityMode,
  OPCUAServer,
  SecurityPolicy,
  StatusCodes,
  Variant,
} from 'node-opcua'
import { describe, expect, it, vi } from 'vitest'

import { validateWorkcellProjectV5, type WorkcellProjectV5 } from '../../src/core/project-v5/index.js'
import { opcUaNodeAddressKeyV1 } from '../../src/core/project-v5/opcua-node-address.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../src/core/project-v5/test-support.js'
import {
  MAX_RUNTIME_BATCH_BYTES_V1,
  validateStateBatchV1,
  type RuntimePublisherMessageV1,
} from '../../src/core/runtime-protocol/v1.js'
import {
  createOpcUaClientAdapterV1,
  createOpcUaClientAdapterPublicationHarnessV1,
  createOpcUaClientSnapshotAssemblerV1,
  readNormalizedOpcUaClientPublicationV1,
  type OpcUaClientAdapterOptionsV1,
} from './opcua-client-adapter.js'
import { createRuntimeTimelineStagingV1, createStateBatchHubV1, type GatewayWebSocketV1 } from './state-batch-hub.js'
import { splitStateBatchesV1 } from './runtime-stream-timeline.js'

const REVISION = 'a'.repeat(64)

async function eventually(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('TEST_EVENTUALLY_TIMEOUT')
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
  }
}

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && /\.tsx?$/u.test(path) ? [path] : []
  }))
  return nested.flat()
}

function readProject(direction: 'read' | 'readWrite' = 'read'): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  if (direction === 'readWrite') {
    ;(project.logicalSignals[0] as unknown as { direction: 'bidirectional' }).direction = 'bidirectional'
  }
  ;(project.logicalSignals[0] as unknown as { id: string }).id = 'part-present'
  ;(project.opcUa.endpoints[0] as unknown as { endpointId: string; reconnectDelayMs: number }).endpointId = 'plc'
  ;(project.opcUa.endpoints[0] as unknown as { reconnectDelayMs: number }).reconnectDelayMs = 25
  ;(project.opcUa.mappings[0] as unknown as { id: string; endpointId: string; direction: typeof direction; nodeAddress: unknown; leaves: unknown }).id = 'map-part-present'
  ;(project.opcUa.mappings[0] as unknown as { endpointId: string }).endpointId = 'plc'
  ;(project.opcUa.mappings[0] as unknown as { direction: typeof direction }).direction = direction
  ;(project.opcUa.mappings[0] as unknown as { nodeAddress: unknown }).nodeAddress = {
    namespaceUri: 'urn:virtual-plc', identifierType: 'string', identifier: 'Machine.State',
  }
  ;(project.opcUa.mappings[0] as unknown as { leaves: unknown }).leaves = [{
    leafPath: ['payload', 'present'], projectPath: [],
    projectTarget: { type: 'logical-signal', signalId: 'part-present' },
    opcUaDataType: 'Boolean', projectDataType: 'boolean', scale: 1, offset: 0, unit: '', required: true,
  }]
  return validateWorkcellProjectV5(project)
}

function twoEndpointReadProject(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(readProject())
  const endpoint = project.opcUa.endpoints[0]!
  const signal = project.logicalSignals[0]!
  const mapping = project.opcUa.mappings[0]!
  ;(project.opcUa.endpoints as unknown as WorkcellProjectV5['opcUa']['endpoints'][number][]).push({
    ...endpoint,
    endpointId: 'plc-b',
    endpointUrl: 'opc.tcp://127.0.0.1:4841',
  })
  ;(project.logicalSignals as unknown as WorkcellProjectV5['logicalSignals'][number][]).push({
    ...signal,
    id: 'part-present-b',
    name: 'Part Present B',
  })
  ;(project.opcUa.mappings as unknown as WorkcellProjectV5['opcUa']['mappings'][number][]).push({
    ...mapping,
    id: 'map-part-present-b',
    endpointId: 'plc-b',
    leaves: mapping.leaves.map((leaf) => ({
      ...leaf,
      projectTarget: { type: 'logical-signal', signalId: 'part-present-b' },
    })),
  })
  return validateWorkcellProjectV5(project)
}

function writeOnlyProject(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(readProject())
  ;(project.logicalSignals[0] as unknown as { direction: 'output' }).direction = 'output'
  ;(project.opcUa.mappings[0] as unknown as { id: string; direction: 'write'; nodeAddress: unknown; leaves: unknown }).id = 'map-start'
  ;(project.opcUa.mappings[0] as unknown as { direction: 'write' }).direction = 'write'
  ;(project.opcUa.mappings[0] as unknown as { nodeAddress: unknown }).nodeAddress = {
    namespaceUri: 'urn:virtual-plc', identifierType: 'string', identifier: 'Start',
  }
  ;(project.opcUa.mappings[0] as unknown as { leaves: unknown }).leaves = [{
    leafPath: [], projectPath: [],
    projectTarget: { type: 'logical-signal', signalId: 'part-present' },
    opcUaDataType: 'Boolean', projectDataType: 'boolean', scale: 1, offset: 0, unit: '', required: true,
  }]
  return validateWorkcellProjectV5(project)
}

function sharedRootStringProject(count = 64): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(readProject())
  const logicalSignals = Array.from({ length: count }, (_unused, index) => ({
    id: `shared-string-${index}`,
    name: `Shared String ${index}`,
    dataType: 'String' as const,
    direction: 'input' as const,
    initialValue: '',
    unit: '',
    scope: { type: 'project' as const },
  }))
  const mappings = logicalSignals.map((signal, index) => ({
    id: `shared-root-${index}`,
    endpointId: 'plc',
    nodeAddress: {
      namespaceUri: 'urn:virtual-plc', identifierType: 'string' as const, identifier: 'Machine.Shared',
    },
    direction: 'read' as const,
    coherenceGroupId: null,
    interpolationMode: 'none' as const,
    coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw' as const,
    leaves: [{
      leafPath: ['values', index], projectPath: [],
      projectTarget: { type: 'logical-signal' as const, signalId: signal.id },
      opcUaDataType: 'String' as const, projectDataType: 'string' as const,
      scale: 1, offset: 0, unit: '', required: true,
    }],
  }))
  ;(project.logicalSignals as unknown as typeof logicalSignals).splice(0, 1, ...logicalSignals)
  ;(project.opcUa.mappings as unknown as typeof mappings).splice(0, 1, ...mappings)
  return validateWorkcellProjectV5(project)
}

function poseProject(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(readProject())
  ;(project.robots[0] as unknown as { frameSources: Record<string, string> }).frameSources.Tool = 'opcua:plc'
  ;(project.opcUa.mappings[0] as unknown as { id: string; nodeAddress: unknown; coherenceGroupId: string | null; interpolationMode: string; leaves: unknown }).id = 'map-pose'
  ;(project.opcUa.mappings[0] as unknown as { nodeAddress: unknown }).nodeAddress = {
    namespaceUri: 'urn:virtual-plc', identifierType: 'string', identifier: 'Machine.Pose',
  }
  ;(project.opcUa.mappings[0] as unknown as { coherenceGroupId: string | null }).coherenceGroupId = 'robot-pose'
  ;(project.opcUa.mappings[0] as unknown as { interpolationMode: string }).interpolationMode = 'shortest-quaternion'
  const target = { type: 'robot-frame', robotId: 'robot-1', frameId: 'Tool' }
  ;(project.opcUa.mappings[0] as unknown as { leaves: unknown }).leaves = [
    ['positionM', 0, 0.001, 'metre'], ['positionM', 1, 0.001, 'metre'], ['positionM', 2, 0.001, 'metre'],
    ['rpyDegrees', 0, 1, 'degree'], ['rpyDegrees', 1, 1, 'degree'], ['rpyDegrees', 2, 1, 'degree'],
  ].map(([projectKey, index, scale, unit]) => ({
    leafPath: ['pose', projectKey === 'positionM' ? 'position' : 'rpy', index],
    projectPath: [projectKey, index], projectTarget: target,
    opcUaDataType: 'Double', projectDataType: 'number', scale, offset: 0, unit, required: true,
  }))
  return validateWorkcellProjectV5(project)
}

function twoReadMappingsProject(intervals: readonly [number, number] = [100, 100]): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(readProject())
  ;(project.logicalSignals as unknown as unknown[]).push({
    id: 'machine-ready', name: 'Machine Ready', dataType: 'Boolean', direction: 'input', initialValue: false, unit: '', scope: { type: 'project' },
  })
  ;(project.opcUa.mappings[0] as unknown as { publishingIntervalMs: number }).publishingIntervalMs = intervals[0]
  ;(project.opcUa.mappings as unknown as unknown[]).push({
    id: 'map-machine-ready', endpointId: 'plc',
    nodeAddress: { namespaceUri: 'urn:virtual-plc', identifierType: 'string', identifier: 'Machine.Ready' },
    direction: 'read', publishingIntervalMs: intervals[1], coherenceGroupId: null, interpolationMode: 'none',
    coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
    leaves: [{
      leafPath: ['payload', 'ready'], projectPath: [],
      projectTarget: { type: 'logical-signal', signalId: 'machine-ready' },
      opcUaDataType: 'Boolean', projectDataType: 'boolean', scale: 1, offset: 0, unit: '', required: true,
    }],
  })
  return validateWorkcellProjectV5(project)
}

function threeReadMappingsProject(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(twoReadMappingsProject([50, 100]))
  ;(project.logicalSignals as unknown as unknown[]).push({
    id: 'machine-running', name: 'Machine Running', dataType: 'Boolean', direction: 'input', initialValue: false, unit: '', scope: { type: 'project' },
  })
  ;(project.opcUa.mappings as unknown as unknown[]).push({
    id: 'map-machine-running', endpointId: 'plc',
    nodeAddress: { namespaceUri: 'urn:virtual-plc', identifierType: 'string', identifier: 'Machine.Running' },
    direction: 'read', publishingIntervalMs: 150, coherenceGroupId: null, interpolationMode: 'none',
    coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
    leaves: [{
      leafPath: ['payload', 'running'], projectPath: [],
      projectTarget: { type: 'logical-signal', signalId: 'machine-running' },
      opcUaDataType: 'Boolean', projectDataType: 'boolean', scale: 1, offset: 0, unit: '', required: true,
    }],
  })
  return validateWorkcellProjectV5(project)
}

function earlyCapacityProject(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(sharedRootStringProject(1))
  ;(project.opcUa.endpoints[0] as unknown as { reconnectDelayMs: number }).reconnectDelayMs = 100
  ;(project.opcUa.mappings[0] as unknown as { publishingIntervalMs: number }).publishingIntervalMs = 50
  ;(project.logicalSignals as unknown as unknown[]).push({
    id: 'early-other', name: 'Early Other', dataType: 'String', direction: 'input', initialValue: '', unit: '', scope: { type: 'project' },
  })
  ;(project.opcUa.mappings as unknown as unknown[]).push({
    id: 'early-other-map', endpointId: 'plc',
    nodeAddress: { namespaceUri: 'urn:virtual-plc', identifierType: 'string', identifier: 'Machine.Other' },
    direction: 'read', publishingIntervalMs: 100, coherenceGroupId: null, interpolationMode: 'none',
    coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
    leaves: [{
      leafPath: ['values', 0], projectPath: [],
      projectTarget: { type: 'logical-signal', signalId: 'early-other' },
      opcUaDataType: 'String', projectDataType: 'string', scale: 1, offset: 0, unit: '', required: true,
    }],
  })
  return validateWorkcellProjectV5(project)
}

function readWriteRootProject(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(readProject('readWrite'))
  ;(project.opcUa.mappings[0] as unknown as { leaves: unknown }).leaves = [{
    leafPath: [], projectPath: [],
    projectTarget: { type: 'logical-signal', signalId: 'part-present' },
    opcUaDataType: 'Boolean', projectDataType: 'boolean', scale: 1, offset: 0, unit: '', required: true,
  }]
  return validateWorkcellProjectV5(project)
}

function fakeConnection(
  namespaceArray = ['http://opcfoundation.org/UA/', 'urn:virtual-plc'],
  options: Readonly<{
    onMonitorItems?: (input: Readonly<{
      readonly groupIndex: number
      readonly groups: readonly EventEmitter[]
    }>) => void
  }> = {},
) {
  const subscriptions: EventEmitter[] = []
  const groups: EventEmitter[] = []
  const monitorRequests: { readonly items: readonly unknown[]; readonly samplingIntervalMs: number }[] = []
  const write = vi.fn(async () => StatusCodes.Good)
  const session = {
    readNamespaceArray: vi.fn(async () => namespaceArray), write, close: vi.fn(async () => undefined),
    createSubscription2: vi.fn(async () => {
      const subscription = new EventEmitter() as EventEmitter & {
        monitorItems: (items: readonly unknown[], parameters: { readonly samplingInterval: number }) => Promise<EventEmitter>
        terminate: () => Promise<void>
      }
      subscription.monitorItems = async (items, parameters) => {
        const group = new EventEmitter() as EventEmitter & { terminate: () => Promise<void> }
        group.terminate = vi.fn(async () => undefined)
        groups.push(group)
        monitorRequests.push({ items, samplingIntervalMs: parameters.samplingInterval })
        options.onMonitorItems?.({ groupIndex: groups.length - 1, groups })
        return group
      }
      subscription.terminate = vi.fn(async () => undefined)
      subscriptions.push(subscription)
      return subscription
    }),
  }
  const client = new EventEmitter() as EventEmitter & {
    connect: (endpointUrl: string) => Promise<void>
    createSession: () => Promise<typeof session>
    disconnect: () => Promise<void>
  }
  client.connect = vi.fn(async (_endpointUrl) => undefined)
  client.createSession = async () => session
  client.disconnect = vi.fn(async () => undefined)
  return { client, session, subscriptions, groups, monitorRequests }
}

function changed(value: unknown, statusCode = 'Good') {
  return {
    value: { value }, statusCode: { name: statusCode, toString: () => statusCode },
    sourceTimestamp: new Date(1_000), serverTimestamp: null,
  }
}

function immediateGatewaySocket(): {
  readonly socket: GatewayWebSocketV1
  readonly sent: string[]
} {
  const listeners = new Map<'close' | 'error', Set<() => void>>()
  const sent: string[] = []
  return {
    sent,
    socket: {
      send(data, callback) {
        sent.push(data)
        callback()
      },
      close() {},
      on(event, listener) {
        const current = listeners.get(event) ?? new Set<() => void>()
        current.add(listener)
        listeners.set(event, current)
      },
      off(event, listener) {
        listeners.get(event)?.delete(listener)
      },
    },
  }
}

function collectStatePublication(
  target: unknown[],
  publication: Parameters<OpcUaClientAdapterOptionsV1['publish']>[0],
): void {
  const message = 'message' in publication
    ? readNormalizedOpcUaClientPublicationV1(publication)
    : publication
  if (message.type === 'state-batch-v1') target.push(message)
}

function rawStateBatch(): RuntimePublisherMessageV1 {
  return validateStateBatchV1({
    type: 'state-batch-v1',
    protocolVersion: 1,
    gatewayId: 'gateway-local',
    projectId: 'project-local',
    configRevision: REVISION,
    endpointId: 'plc',
    sequence: 1,
    sourceTimestampMs: 1_000,
    publishedTimestampMs: 1_000,
    originId: 'gateway-local:opcua-client',
    values: [
      {
        mappingId: 'map-part-present',
        coherenceGroupId: null,
        value: true,
        unit: '',
        quality: 'GOOD',
        statusCode: 'Good',
      },
    ],
  })
}

function exactSequenceDigitBoundaryPayloadLength(): number {
  const project = sharedRootStringProject(1)
  const rootKey = `plc\0${opcUaNodeAddressKeyV1(project.opcUa.mappings[0]!.nodeAddress)}`
  const endpoint = {
    endpointId: 'plc',
    monitoredRoots: [{
      rootKey,
      endpointId: 'plc',
      nodeAddress: project.opcUa.mappings[0]!.nodeAddress,
      mappingIds: ['shared-root-0'],
      samplingIntervalMs: 100,
    }],
  }
  const sourceFor = (length: number) => {
    const assembler = createOpcUaClientSnapshotAssemblerV1({ project, endpoint })
    const snapshot = assembler.accept(rootKey, { values: ['x'.repeat(length)] }, 'Good', 1_000)!
    return Object.freeze({
      type: 'state-batch-v1' as const,
      protocolVersion: 1 as const,
      gatewayId: 'gateway-local',
      projectId: project.projectId,
      configRevision: REVISION,
      endpointId: 'plc',
      sequence: 1,
      sourceTimestampMs: 1_000,
      publishedTimestampMs: 1_000,
      originId: 'gateway-local:opcua-client',
      values: snapshot.values,
    }) as Parameters<typeof splitStateBatchesV1>[0]
  }
  const fits = (length: number, sequence: number): boolean => {
    try {
      return splitStateBatchesV1(sourceFor(length), sequence).length === 1
    } catch {
      return false
    }
  }
  let low = 0
  let high = MAX_RUNTIME_BATCH_BYTES_V1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (fits(middle, 1)) low = middle
    else high = middle - 1
  }
  if (!fits(low, 1) || fits(low, Number.MAX_SAFE_INTEGER - 1)) {
    throw new Error('TEST_EXACT_SEQUENCE_DIGIT_BOUNDARY_NOT_FOUND')
  }
  return low
}

describe('OPC UA client adapter V1 Project V5 root-notification boundary', () => {
  it('rejects raw and forged normalized-publication wrappers at the runtime reader', () => {
    const raw = rawStateBatch()

    expect(() => readNormalizedOpcUaClientPublicationV1(raw as never))
      .toThrow(new TypeError('Normalized OPC UA Client publication is invalid.'))
    expect(() => readNormalizedOpcUaClientPublicationV1({ message: raw } as never))
      .toThrow(new TypeError('Normalized OPC UA Client publication is invalid.'))
  })

  it('constructs test publications only through validated root assembly and private normalization', () => {
    const project = readProject()
    const harness = createOpcUaClientAdapterPublicationHarnessV1({
      project,
      endpointId: 'plc',
      gatewayId: 'gateway-local',
      originId: 'gateway-local:opcua-client',
      configRevision: REVISION,
    })

    const connected = readNormalizedOpcUaClientPublicationV1(harness.lifecycle('connected'))
    const publications = harness.state({
      rootKey: `plc\0${opcUaNodeAddressKeyV1(project.opcUa.mappings[0]!.nodeAddress)}`,
      value: { payload: { present: true } },
      statusCode: 'Good',
      sourceTimestampMs: 1_000,
    })

    expect(connected).toMatchObject({ type: 'endpoint-lifecycle-v1', sequence: 1, phase: 'connected' })
    expect(publications.map(readNormalizedOpcUaClientPublicationV1)).toEqual([
      expect.objectContaining({
        type: 'state-batch-v1', sequence: 2,
        values: [expect.objectContaining({ mappingId: 'map-part-present', value: true, quality: 'GOOD' })],
      }),
    ])
  })

  it('keeps the constrained publication harness out of production consumers', async () => {
    const root = fileURLToPath(new URL('../../', import.meta.url))
    const rootEntries = await readdir(root, { withFileTypes: true })
    const rootTypeScriptFiles = rootEntries
      .filter((entry) => entry.isFile() && /\.tsx?$/u.test(entry.name))
      .map((entry) => join(root, entry.name))
    const files = [
      ...rootTypeScriptFiles,
      ...(await sourceFiles(join(root, 'middleware'))),
      ...(await sourceFiles(join(root, 'src'))),
    ]
    const consumers = await Promise.all(files.map(async (file) => ({
      file,
      source: await readFile(file, 'utf8'),
    })))
    expect(consumers.some(({ file }) => file.replaceAll('\\', '/').endsWith('/src/app/App.tsx'))).toBe(true)
    const harnessConsumers = consumers.filter(({ file, source }) => (
      !file.endsWith('opcua-client-adapter.ts')
      && source.includes('createOpcUaClientAdapterPublicationHarnessV1')
    ))

    expect(harnessConsumers.map(({ file }) => file.replaceAll('\\', '/')))
      .toEqual(expect.arrayContaining([
        expect.stringMatching(/opcua-client-adapter\.test\.ts$/u),
      ]))
    expect(harnessConsumers.every(({ file }) => (
      file.endsWith('.test.ts') || file.includes('.test-support.')
    ))).toBe(true)
    const productionStarReexports = consumers.filter(({ file, source }) => (
      !file.endsWith('.test.ts')
      && !file.includes('.test-support.')
      && /export\s*\*\s*from\s*['"][^'"]*opcua-client-adapter(?:\.js)?['"]/u.test(source)
    ))
    expect(productionStarReexports).toEqual([])
  })

  it('publishes every byte-split chunk of a 64-value root in one consecutive reserved source range', async () => {
    const connection = fakeConnection()
    const published: RuntimePublisherMessageV1[] = []
    const initialSourceSequence = Number.MAX_SAFE_INTEGER - 3
    const adapter = createOpcUaClientAdapterV1(sharedRootStringProject(), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:opcua-client',
      configRevision: REVISION,
      nowMs: () => 1_000,
      publish: (publication) => { published.push(readNormalizedOpcUaClientPublicationV1(publication)) },
      createClient: () => connection.client as never,
      // The adapter's deterministic counter seam must make exhaustion and full
      // multi-chunk reservations testable without mutating private state.
      initialSourceSequenceByEndpoint: { plc: initialSourceSequence },
    } as OpcUaClientAdapterOptionsV1 & {
      readonly initialSourceSequenceByEndpoint: Readonly<Record<string, number>>
    })

    await adapter.start()
    await eventually(() => connection.groups.length === 1)
    connection.groups[0]!.emit('changed', {}, changed({
      values: Array.from({ length: 64 }, () => 'x'.repeat(4_096)),
    }), 0)
    await eventually(() => published.length === 3)

    expect(published.map(({ type, sequence }) => [type, sequence])).toEqual([
      ['endpoint-lifecycle-v1', initialSourceSequence],
      ['state-batch-v1', initialSourceSequence + 1],
      ['state-batch-v1', initialSourceSequence + 2],
    ])
    await adapter.stop()
  })

  it('emits one terminal disconnect and permanently closes a live endpoint when a full State range cannot reserve', async () => {
    const connection = fakeConnection()
    const published: RuntimePublisherMessageV1[] = []
    const initialSourceSequence = Number.MAX_SAFE_INTEGER - 2
    const adapter = createOpcUaClientAdapterV1(sharedRootStringProject(), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:opcua-client',
      configRevision: REVISION,
      publish: (publication) => { published.push(readNormalizedOpcUaClientPublicationV1(publication)) },
      createClient: () => connection.client as never,
      initialSourceSequenceByEndpoint: { plc: initialSourceSequence },
    } as OpcUaClientAdapterOptionsV1 & {
      readonly initialSourceSequenceByEndpoint: Readonly<Record<string, number>>
    })

    await adapter.start()
    await eventually(() => connection.groups.length === 1)
    connection.groups[0]!.emit('changed', {}, changed({
      values: Array.from({ length: 64 }, () => 'x'.repeat(4_096)),
    }), 0)

    await eventually(() => published.length >= 2)
    expect(published.map(({ type, sequence }) => [type, sequence])).toEqual([
      ['endpoint-lifecycle-v1', initialSourceSequence],
      ['endpoint-lifecycle-v1', initialSourceSequence + 1],
    ])
    expect(published.at(-1)).toMatchObject({ phase: 'disconnected', statusCode: 'BadNoCommunication' })
    await eventually(() => adapter.status()[0]?.lastError?.code === 'OPC_UA_SOURCE_SEQUENCE_EXHAUSTED')
    await eventually(() => adapter.status()[0]?.phase === 'faulted')
    await new Promise<void>((resolve) => { setTimeout(resolve, 50) })
    expect(connection.client.connect).toHaveBeenCalledOnce()
    await adapter.stop()
  })

  it('emits the terminal disconnect when exact split planning reaches source-sequence exhaustion', async () => {
    const connection = fakeConnection()
    const published: RuntimePublisherMessageV1[] = []
    const initialSourceSequence = Number.MAX_SAFE_INTEGER - 1
    const adapter = createOpcUaClientAdapterV1(sharedRootStringProject(), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:opcua-client',
      configRevision: REVISION,
      publish: (publication) => { published.push(readNormalizedOpcUaClientPublicationV1(publication)) },
      createClient: () => connection.client as never,
      initialSourceSequenceByEndpoint: { plc: initialSourceSequence },
    })

    await adapter.start()
    await eventually(() => connection.groups.length === 1)
    connection.groups[0]!.emit('changed', {}, changed({
      values: Array.from({ length: 64 }, () => 'x'.repeat(4_096)),
    }), 0)

    await eventually(() => published.length === 2)
    expect(published.map(({ type, sequence }) => [type, sequence])).toEqual([
      ['endpoint-lifecycle-v1', initialSourceSequence],
      ['endpoint-lifecycle-v1', Number.MAX_SAFE_INTEGER],
    ])
    await eventually(() => adapter.status()[0]?.lastError?.code === 'OPC_UA_SOURCE_SEQUENCE_EXHAUSTED')
    await adapter.stop()
  })

  it('permanently closes after a terminal disconnect consumes the final source sequence', async () => {
    const firstConnection = fakeConnection()
    const secondConnection = fakeConnection()
    const connections = [firstConnection, secondConnection]
    const createClient = vi.fn(() => connections.shift()!.client)
    const published: RuntimePublisherMessageV1[] = []
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:opcua-client',
      configRevision: REVISION,
      publish: (publication) => { published.push(readNormalizedOpcUaClientPublicationV1(publication)) },
      createClient: () => createClient() as never,
      initialSourceSequenceByEndpoint: { plc: Number.MAX_SAFE_INTEGER - 1 },
    })

    await adapter.start()
    await eventually(() => firstConnection.groups.length === 1)
    firstConnection.client.emit('connection_lost')

    await eventually(() => adapter.status()[0]?.lastError?.code === 'OPC_UA_SOURCE_SEQUENCE_EXHAUSTED')
    await eventually(() => firstConnection.session.close.mock.calls.length === 1)
    await new Promise<void>((resolve) => { setTimeout(resolve, 50) })

    expect(published.map(({ type, sequence }) => [type, sequence])).toEqual([
      ['endpoint-lifecycle-v1', Number.MAX_SAFE_INTEGER - 1],
      ['endpoint-lifecycle-v1', Number.MAX_SAFE_INTEGER],
    ])
    expect(published.at(-1)).toMatchObject({ phase: 'disconnected', statusCode: 'BadNoCommunication' })
    expect(adapter.status()[0]?.phase).toBe('faulted')
    expect(createClient).toHaveBeenCalledOnce()
    expect(secondConnection.client.connect).not.toHaveBeenCalled()
    await adapter.stop()
  })

  it('does not consume a source sequence when high sequence digits make an otherwise fitting State chunk unencodable', async () => {
    const connection = fakeConnection()
    const published: RuntimePublisherMessageV1[] = []
    const initialSourceSequence = Number.MAX_SAFE_INTEGER - 2
    const payloadLength = exactSequenceDigitBoundaryPayloadLength()
    const adapter = createOpcUaClientAdapterV1(sharedRootStringProject(1), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:opcua-client',
      configRevision: REVISION,
      nowMs: () => 1_000,
      publish: (publication) => { published.push(readNormalizedOpcUaClientPublicationV1(publication)) },
      createClient: () => connection.client as never,
      initialSourceSequenceByEndpoint: { plc: initialSourceSequence },
    })

    await adapter.start()
    await eventually(() => connection.groups.length === 1)
    connection.groups[0]!.emit('changed', {}, changed({ values: ['x'.repeat(payloadLength)] }), 0)
    await new Promise<void>((resolve) => { setTimeout(resolve, 20) })
    await adapter.stop()

    expect(published.map(({ type, sequence }) => [type, sequence])).toEqual([
      ['endpoint-lifecycle-v1', initialSourceSequence],
      ['endpoint-lifecycle-v1', initialSourceSequence + 1],
    ])
  })

  it('fails an invalid Gateway-clock connection without publishing or consuming source/session lifecycle state', async () => {
    const connection = fakeConnection()
    const published: RuntimePublisherMessageV1[] = []
    const samples = [Number.NaN]
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:opcua-client',
      configRevision: REVISION,
      nowMs: () => samples.shift() ?? Number.NaN,
      publish: (publication) => { published.push(readNormalizedOpcUaClientPublicationV1(publication)) },
      createClient: () => connection.client as never,
    })

    await adapter.start()
    await eventually(() => adapter.status()[0]?.phase === 'faulted')
    expect(adapter.status()[0]?.lastError).toMatchObject({
      code: 'Gateway clock must return a non-negative safe integer.',
      occurredAtMs: 0,
    })
    expect(published).toEqual([])
    await adapter.stop()
  })

  it('clamps regressing Gateway-clock samples across connected, State, and stop disconnect publications', async () => {
    const connection = fakeConnection()
    const published: RuntimePublisherMessageV1[] = []
    const samples = [1_000, 900]
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:opcua-client',
      configRevision: REVISION,
      nowMs: () => samples.shift() ?? 900,
      publish: (publication) => { published.push(readNormalizedOpcUaClientPublicationV1(publication)) },
      createClient: () => connection.client as never,
    })

    await adapter.start()
    await eventually(() => connection.groups.length === 1)
    connection.groups[0]!.emit('changed', {}, changed({ payload: { present: true } }), 0)
    await eventually(() => published.length === 2)
    await adapter.stop()

    expect(published).toEqual([
      expect.objectContaining({ type: 'endpoint-lifecycle-v1', phase: 'connected', occurredAtMs: 1_000 }),
      expect.objectContaining({ type: 'state-batch-v1', publishedTimestampMs: 1_000 }),
      expect.objectContaining({ type: 'endpoint-lifecycle-v1', phase: 'disconnected', occurredAtMs: 1_000 }),
    ])
  })

  it('fails session-generation exhaustion without publishing, wrapping, or reconnecting', async () => {
    const connection = fakeConnection()
    const published: RuntimePublisherMessageV1[] = []
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:opcua-client',
      configRevision: REVISION,
      publish: (publication) => { published.push(readNormalizedOpcUaClientPublicationV1(publication)) },
      createClient: () => connection.client as never,
      initialSessionGenerationByEndpoint: { plc: Number.MAX_SAFE_INTEGER },
    })

    await adapter.start()
    await eventually(() => adapter.status()[0]?.lastError?.code === 'OPC_UA_SESSION_GENERATION_EXHAUSTED')
    await eventually(() => adapter.status()[0]?.phase === 'faulted')
    expect(published).toEqual([])
    await new Promise<void>((resolve) => { setTimeout(resolve, 50) })
    expect(connection.client.connect).toHaveBeenCalledOnce()
    await adapter.stop()
  })

  it('emits one disconnected lifecycle under reentrant and repeated loss signals for the same Session', async () => {
    const connection = fakeConnection()
    const published: RuntimePublisherMessageV1[] = []
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:opcua-client',
      configRevision: REVISION,
      publish: (publication) => {
        const message = readNormalizedOpcUaClientPublicationV1(publication)
        published.push(message)
        if (message.type !== 'endpoint-lifecycle-v1' || message.phase !== 'disconnected') return
        connection.client.emit('connection_lost')
        connection.subscriptions[0]!.emit('terminated')
        connection.groups[0]!.emit('terminated')
      },
      createClient: () => connection.client as never,
    })

    await adapter.start()
    await eventually(() => connection.groups.length === 1)
    connection.client.emit('connection_lost')
    await eventually(() => published.some((message) => (
      message.type === 'endpoint-lifecycle-v1' && message.phase === 'disconnected'
    )))

    expect(published.filter((message) => (
      message.type === 'endpoint-lifecycle-v1'
      && message.phase === 'disconnected'
      && message.sessionGeneration === 1
    ))).toHaveLength(1)
    await adapter.stop()
  })

  it('closes a live Session on an invalid recovery clock without a partial disconnect lifecycle', async () => {
    const connection = fakeConnection()
    const published: RuntimePublisherMessageV1[] = []
    let now = 1_000
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:opcua-client',
      configRevision: REVISION,
      nowMs: () => now,
      publish: (publication) => { published.push(readNormalizedOpcUaClientPublicationV1(publication)) },
      createClient: () => connection.client as never,
    })

    await adapter.start()
    await eventually(() => connection.groups.length === 1)
    now = Number.NaN
    expect(() => connection.client.emit('connection_lost')).not.toThrow()

    await eventually(() => adapter.status()[0]?.phase === 'faulted')
    expect(adapter.status()[0]?.lastError).toMatchObject({
      code: 'Gateway clock must return a non-negative safe integer.',
      occurredAtMs: 1_000,
    })
    expect(published).toEqual([expect.objectContaining({ type: 'endpoint-lifecycle-v1', phase: 'connected' })])
    expect(connection.session.close).toHaveBeenCalledOnce()
    await adapter.stop()
  })

  it('publishes connected before draining only the latest early snapshot for one root', async () => {
    const published: RuntimePublisherMessageV1[] = []
    const connection = fakeConnection(undefined, {
      onMonitorItems: ({ groupIndex, groups }) => {
        if (groupIndex !== 1) return
        groups[0]!.emit('changed', {}, changed({ payload: { present: true } }), 0)
        groups[0]!.emit('changed', {}, changed({ payload: { present: false } }), 0)
      },
    })
    const adapter = createOpcUaClientAdapterV1(twoReadMappingsProject([50, 100]), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:opcua-client',
      configRevision: REVISION,
      publish: (publication) => { published.push(readNormalizedOpcUaClientPublicationV1(publication)) },
      createClient: () => connection.client as never,
    })

    await adapter.start()
    await eventually(() => published.length >= 2)

    expect(published.map(({ type, sequence }) => [type, sequence])).toEqual([
      ['endpoint-lifecycle-v1', 1],
      ['state-batch-v1', 2],
    ])
    expect((published[1] as Extract<RuntimePublisherMessageV1, { type: 'state-batch-v1' }>).values)
      .toEqual([expect.objectContaining({ mappingId: 'map-part-present', value: false })])
    await adapter.stop()
  })

  it('fails early notification byte capacity before publishing connected', async () => {
    const published: RuntimePublisherMessageV1[] = []
    const connection = fakeConnection(undefined, {
      onMonitorItems: ({ groupIndex, groups }) => {
        if (groupIndex !== 1) return
        groups[0]!.emit('changed', {}, changed({
          values: ['x'.repeat((8 * MAX_RUNTIME_BATCH_BYTES_V1) + 1)],
        }), 0)
      },
    })
    const adapter = createOpcUaClientAdapterV1(earlyCapacityProject(), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:opcua-client',
      configRevision: REVISION,
      publish: (publication) => { published.push(readNormalizedOpcUaClientPublicationV1(publication)) },
      createClient: () => connection.client as never,
    })

    await adapter.start()
    await eventually(() => adapter.status()[0]?.lastError?.code === 'OPC_UA_EARLY_NOTIFICATION_CAPACITY_EXCEEDED')
    expect(published).toEqual([])
    expect(adapter.status()[0]?.phase).toBe('reconnecting')
    await adapter.stop()
  })

  it('keeps a reentrant drain notification behind the already buffered early roots', async () => {
    const published: RuntimePublisherMessageV1[] = []
    const connection = fakeConnection(undefined, {
      onMonitorItems: ({ groupIndex, groups }) => {
        if (groupIndex !== 2) return
        groups[1]!.emit('changed', {}, changed({ payload: { ready: true } }), 0)
        groups[0]!.emit('changed', {}, changed({ payload: { present: true } }), 0)
        groups[0]!.emit('changed', {}, changed({ payload: { present: false } }), 0)
      },
    })
    const adapter = createOpcUaClientAdapterV1(threeReadMappingsProject(), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:opcua-client',
      configRevision: REVISION,
      publish: (publication) => {
        const message = readNormalizedOpcUaClientPublicationV1(publication)
        published.push(message)
        if (
          message.type === 'state-batch-v1'
          && message.values[0]?.mappingId === 'map-machine-ready'
        ) {
          connection.groups[2]!.emit('changed', {}, changed({ payload: { running: true } }), 0)
        }
      },
      createClient: () => connection.client as never,
    })

    await adapter.start()
    await eventually(() => published.length >= 4)
    expect(published.map((message) => (
      message.type === 'state-batch-v1' ? message.values[0]?.mappingId : message.type
    ))).toEqual([
      'endpoint-lifecycle-v1',
      'map-machine-ready',
      'map-part-present',
      'map-machine-running',
    ])
    await adapter.stop()
  })

  it('publishes a normalized connected barrier before State and exactly one terminal disconnect', async () => {
    const connection = fakeConnection()
    const published: RuntimePublisherMessageV1[] = []
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:opcua-client',
      configRevision: REVISION,
      publisherGeneration: 7,
      publish: (publication) => { published.push(readNormalizedOpcUaClientPublicationV1(publication as Parameters<typeof readNormalizedOpcUaClientPublicationV1>[0])) },
      createClient: () => connection.client as never,
    })

    await adapter.start()
    await eventually(() => connection.groups.length === 1)
    expect(published).toEqual([
      expect.objectContaining({
        type: 'endpoint-lifecycle-v1', phase: 'connected', statusCode: 'Good', sequence: 1,
        publisherGeneration: 7, sessionGeneration: 1,
      }),
    ])

    connection.groups[0]!.emit('changed', {}, changed({ payload: { present: true } }), 0)
    await eventually(() => published.length === 2)
    expect(published.map(({ type, sequence }) => [type, sequence])).toEqual([
      ['endpoint-lifecycle-v1', 1], ['state-batch-v1', 2],
    ])

    await adapter.stop()
    expect(published.filter(({ type }) => type === 'endpoint-lifecycle-v1')).toEqual([
      expect.objectContaining({ phase: 'connected', sequence: 1 }),
      expect.objectContaining({ phase: 'disconnected', statusCode: 'BadNoCommunication', sequence: 3 }),
    ])
  })

  it('assembles a maximal shared String root without owning source sequencing or publication', () => {
    const project = sharedRootStringProject()
    const endpoint = {
      endpointId: 'plc',
      monitoredRoots: [{
        rootKey: 'plc\0s=Machine.Shared',
        endpointId: 'plc',
        nodeAddress: { namespaceUri: 'urn:virtual-plc', identifierType: 'string' as const, identifier: 'Machine.Shared' },
        mappingIds: project.opcUa.mappings.map(({ id }) => id),
        samplingIntervalMs: 100,
      }],
    }
    const assembler = createOpcUaClientSnapshotAssemblerV1({
      project,
      endpoint,
    })

    const snapshot = assembler.accept('plc\0s=Machine.Shared', {
      values: Array.from({ length: 64 }, () => 'x'.repeat(4_096)),
    }, 'Good', 1_000)

    expect(snapshot?.sourceTimestampMs).toBe(1_000)
    expect(snapshot?.values.map(({ mappingId }) => mappingId)).toEqual(
      project.opcUa.mappings.map(({ id }) => id),
    )
  })

  it('connects a write-only Endpoint with an empty Subscription and one live Boolean write', async () => {
    const connection = fakeConnection()
    const adapter = createOpcUaClientAdapterV1(writeOnlyProject(), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      publish: () => undefined, createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => adapter.status()[0]?.phase === 'connected')
    expect(adapter.status()[0]).toMatchObject({ sessionActive: true, subscriptionActive: true, monitoredItemCount: 0, mappingCount: 1 })
    await expect(adapter.write({ mappingId: 'map-start', value: true })).resolves.toEqual({ ok: true, statusCode: 'Good' })
    expect(connection.session.write).toHaveBeenCalledOnce()
    await adapter.stop()
  })

  it('recovers a write-only empty Subscription, fences the stale lease, and writes through the replacement Session', async () => {
    const first = fakeConnection()
    const second = fakeConnection()
    const connections = [first, second]
    const adapter = createOpcUaClientAdapterV1(writeOnlyProject(), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      publish: () => undefined, createClient: () => connections.shift()!.client as never,
    })
    await adapter.start()
    await eventually(() => adapter.status()[0]?.phase === 'connected')
    expect(first.groups).toHaveLength(0)
    first.subscriptions[0]!.emit('terminated')

    await eventually(() => adapter.status()[0]?.phase === 'reconnecting')
    await expect(adapter.write({ mappingId: 'map-start', value: true }))
      .resolves.toMatchObject({ failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED' })
    await eventually(() => adapter.status()[0]?.phase === 'connected' && second.subscriptions.length === 1)
    expect(second.groups).toHaveLength(0)
    await expect(adapter.write({ mappingId: 'map-start', value: true }))
      .resolves.toEqual({ ok: true, statusCode: 'Good' })
    expect(second.session.write).toHaveBeenCalledOnce()
    await adapter.stop()
  })

  it('preserves adapter source continuity through reconnect so the real StateBatchHub forwards the first fresh root', async () => {
    const project = readProject()
    const first = fakeConnection(['http://opcfoundation.org/UA/', 'urn:virtual-plc'])
    const second = fakeConnection(['http://opcfoundation.org/UA/', 'urn:other', 'urn:virtual-plc'])
    const connections = [first, second]
    const hub = createStateBatchHubV1()
    const browser = immediateGatewaySocket()
    const prepared = hub.prepareRevisionActivation({
      projectId: project.projectId,
      configRevision: REVISION,
      gatewayId: 'gateway-local',
      originId: 'gateway-local:client',
      publisherGeneration: 1,
      endpointIds: ['plc'],
      stagedTimeline: createRuntimeTimelineStagingV1().seal(),
    })
    prepared.installPrepared()
    prepared.flushPrepared()
    hub.attach(browser.socket)
    const adapter = createOpcUaClientAdapterV1(project, {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      publish: (batch) => hub.publish(batch), createClient: () => connections.shift()!.client as never,
    })
    await adapter.start()
    await eventually(() => first.groups.length === 1)
    first.groups[0]!.emit('changed', {}, changed({ payload: { present: true } }), 0)
    await eventually(() => browser.sent.filter((payload) => JSON.parse(payload).type === 'state-batch-v1').length === 1)

    first.client.emit('connection_lost')
    await eventually(() => second.monitorRequests.length === 1)
    expect(second.monitorRequests[0]!.items[0]).toMatchObject({ nodeId: 'ns=2;s=Machine.State' })
    second.groups[0]!.emit('changed', {}, changed({ payload: { present: false } }), 0)

    await eventually(() => browser.sent.filter((payload) => JSON.parse(payload).type === 'state-batch-v1').length === 2)
    const batches = browser.sent
      .map((payload) => JSON.parse(payload))
      .filter((message) => message.type === 'state-batch-v1')
      .map((message) => validateStateBatchV1(message))
    expect(batches.map(({ sequence }) => sequence)).toEqual([2, 5])
    expect(batches.at(-1)?.values).toEqual([expect.objectContaining({ value: false, mappingId: 'map-part-present' })])
    await adapter.stop()
    await hub.close()
  })

  it('counts one readWrite Mapping once while retaining its read root', async () => {
    const connection = fakeConnection()
    const adapter = createOpcUaClientAdapterV1(readProject('readWrite'), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      publish: () => undefined, createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => adapter.status()[0]?.phase === 'connected')
    expect(adapter.status()[0]).toMatchObject({ mappingCount: 1, monitoredItemCount: 1 })
    await adapter.stop()
  })

  it('publishes no state before a complete GOOD root and emits the assembled scalar after one arrives', async () => {
    const connection = fakeConnection()
    const batches: unknown[] = []
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      publish: (publication) => { collectStatePublication(batches, publication) }, createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => connection.groups.length === 1)
    connection.groups[0]!.emit('changed', {}, changed({ payload: {} }), 0)
    expect(batches).toHaveLength(0)
    connection.groups[0]!.emit('changed', {}, changed({ payload: { present: true } }), 0)
    expect(validateStateBatchV1(batches[0]).values[0]).toMatchObject({ mappingId: 'map-part-present', value: true, quality: 'GOOD' })
    await adapter.stop()
  })

  it('retains the last complete root payload across UNCERTAIN, BAD, and invalid root notifications', async () => {
    const connection = fakeConnection()
    const batches: unknown[] = []
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      publish: (publication) => { collectStatePublication(batches, publication) }, createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => connection.groups.length === 1)
    const group = connection.groups[0]!
    group.emit('changed', {}, changed({ payload: { present: true } }), 0)
    group.emit('changed', {}, changed({ payload: { present: false } }, 'UncertainLastUsableValue'), 0)
    group.emit('changed', {}, changed({ payload: { present: false } }, 'BadNoCommunication'), 0)
    group.emit('changed', {}, changed({ payload: { present: 1 } }), 0)
    const values = batches.map((batch) => validateStateBatchV1(batch).values[0]!)
    expect(values).toMatchObject([
      { value: true, quality: 'GOOD' },
      { value: true, quality: 'UNCERTAIN', statusCode: 'UncertainLastUsableValue' },
      { value: true, quality: 'BAD', statusCode: 'BadNoCommunication' },
      { value: true, quality: 'BAD', statusCode: 'BadTypeMismatch' },
    ])
    await adapter.stop()
  })

  it('reports notification quality without refreshing the last-GOOD diagnostic time for BAD or UNCERTAIN roots', async () => {
    const connection = fakeConnection()
    let now = 5_000
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      publish: () => undefined, nowMs: () => now, createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => connection.groups.length === 1)
    connection.groups[0]!.emit('changed', {}, changed({ payload: { present: true } }), 0)
    now = 6_000
    connection.groups[0]!.emit('changed', {}, changed({ payload: { present: false } }, 'UncertainInitialValue'), 0)
    now = 7_000
    connection.groups[0]!.emit('changed', {}, changed({ payload: { present: false } }, 'BadNoCommunication'), 0)
    expect(adapter.status()[0]).toMatchObject({ lastValueQuality: 'BAD', lastNotificationAtMs: 7_000, lastGoodValueAtMs: 5_000 })
    await adapter.stop()
  })

  it('publishes one coherent canonical pose from one complete root and retains the supplied config revision', async () => {
    const connection = fakeConnection()
    const batches: unknown[] = []
    const adapter = createOpcUaClientAdapterV1(poseProject(), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: 'b'.repeat(64),
      publish: (publication) => { collectStatePublication(batches, publication) }, createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => connection.groups.length === 1)

    connection.groups[0]!.emit('changed', {}, changed({
      pose: { position: new Float64Array([1_000, 2_000, 3_000]), rpy: [0, 0, 90] },
    }), 0)

    const published = validateStateBatchV1(batches[0])
    expect(published).toMatchObject({ configRevision: 'b'.repeat(64), sequence: 2 })
    expect(published.values).toEqual([expect.objectContaining({
      mappingId: 'map-pose', coherenceGroupId: 'robot-pose', value: expect.objectContaining({ positionM: [1, 2, 3] }),
    })])
    await adapter.stop()
  })

  it('publishes only the independently changed mapping from a monitored root group', async () => {
    const connection = fakeConnection()
    const batches: unknown[] = []
    const adapter = createOpcUaClientAdapterV1(twoReadMappingsProject(), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      publish: (publication) => { collectStatePublication(batches, publication) }, createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => connection.groups.length === 1)
    connection.groups[0]!.emit('changed', {}, changed({ payload: { present: true } }), 0)
    connection.groups[0]!.emit('changed', {}, changed({ payload: { ready: true } }), 1)

    expect(batches.map((batch) => validateStateBatchV1(batch).values.map(({ mappingId }) => mappingId))).toEqual([
      ['map-part-present'], ['map-machine-ready'],
    ])
    await adapter.stop()
  })

  it('uses separate monitored groups for effective per-root sampling intervals', async () => {
    const connection = fakeConnection()
    const adapter = createOpcUaClientAdapterV1(twoReadMappingsProject([50, 100]), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      publish: () => undefined, createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => connection.monitorRequests.length === 2)
    expect(connection.monitorRequests.map(({ samplingIntervalMs }) => samplingIntervalMs)).toEqual([50, 100])
    expect(adapter.status()[0]).toMatchObject({ monitoredItemCount: 2, mappingCount: 2 })
    await adapter.stop()
  })

  it('retries after connection loss and resolves the endpoint namespace URI again for the new Session index', async () => {
    const first = fakeConnection(['http://opcfoundation.org/UA/', 'urn:virtual-plc'])
    const second = fakeConnection(['http://opcfoundation.org/UA/', 'urn:other', 'urn:virtual-plc'])
    const connections = [first, second]
    let now = 8_000
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      nowMs: () => now, publish: () => undefined, createClient: () => connections.shift()!.client as never,
    })
    await adapter.start()
    await eventually(() => first.monitorRequests.length === 1)
    expect(first.monitorRequests[0]!.items[0]).toMatchObject({ nodeId: 'ns=1;s=Machine.State' })
    first.client.emit('connection_lost')
    await eventually(() => adapter.status()[0]?.phase === 'reconnecting')
    expect(adapter.status()[0]).toMatchObject({
      reconnectAttempt: 1, nextRetryAtMs: 8_025,
      lastError: { code: 'OPC_UA_CONNECTION_LOST', occurredAtMs: 8_000 },
    })
    now = 8_025
    await eventually(() => second.monitorRequests.length === 1)
    expect(second.monitorRequests[0]!.items[0]).toMatchObject({ nodeId: 'ns=2;s=Machine.State' })
    await adapter.stop()
  })

  it('cleans monitored groups, subscription, Session, Client, and pending retry state on stop', async () => {
    const connection = fakeConnection()
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      publish: () => undefined, createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => connection.groups.length === 1)
    connection.client.emit('connection_lost')
    await eventually(() => adapter.status()[0]?.phase === 'reconnecting')

    await adapter.stop()

    expect((connection.groups[0] as unknown as { readonly terminate: unknown }).terminate).toHaveBeenCalledOnce()
    expect((connection.subscriptions[0] as unknown as { readonly terminate: unknown }).terminate).toHaveBeenCalledOnce()
    expect(connection.session.close).toHaveBeenCalledOnce()
    expect(connection.client.disconnect).toHaveBeenCalledOnce()
    expect(adapter.status()[0]).toMatchObject({ phase: 'disabled', reconnectAttempt: 0, nextRetryAtMs: null })
  })

  it.each(['monitored-group', 'subscription', 'session', 'client'] as const)('retains and retries a failed %s cleanup handle before reporting disabled', async (resource) => {
    const connection = fakeConnection()
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:client',
      configRevision: REVISION,
      publish: () => undefined,
      createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => connection.groups.length === 1)
    const groupTerminate = (connection.groups[0] as unknown as { terminate: typeof connection.session.close }).terminate
    const subscriptionTerminate = (connection.subscriptions[0] as unknown as { terminate: typeof connection.session.close }).terminate
    const cleanup = (resource === 'monitored-group'
      ? groupTerminate
      : resource === 'subscription'
        ? subscriptionTerminate
        : resource === 'session'
          ? connection.session.close
          : connection.client.disconnect) as typeof connection.session.close
    cleanup.mockRejectedValueOnce(new Error(`${resource} cleanup failed`))
    if (resource === 'monitored-group') {
      subscriptionTerminate.mockRejectedValueOnce(new Error('subscription cleanup proof failed'))
    }

    await expect(adapter.stop()).rejects.toThrow(`${resource} cleanup failed`)
    expect(cleanup).toHaveBeenCalledOnce()
    expect(adapter.status()[0]).toMatchObject({
      phase: 'faulted',
      sessionActive: resource === 'session',
      subscriptionActive: resource === 'monitored-group' || resource === 'subscription',
    })
    await expect(adapter.reconnectEndpoint!('plc')).rejects.toThrow('OPC_UA_ENDPOINT_CLEANUP_REQUIRED')

    await expect(adapter.stop()).resolves.toBeUndefined()
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(groupTerminate).toHaveBeenCalledTimes(resource === 'monitored-group' ? 2 : 1)
    expect(subscriptionTerminate).toHaveBeenCalledTimes(
      resource === 'monitored-group' || resource === 'subscription' ? 2 : 1,
    )
    expect(connection.session.close).toHaveBeenCalledTimes(resource === 'session' ? 2 : 1)
    expect(connection.client.disconnect).toHaveBeenCalledTimes(resource === 'client' ? 2 : 1)
    expect(adapter.status()[0]).toMatchObject({
      phase: 'disabled',
      sessionActive: false,
      subscriptionActive: false,
    })
  })

  it('rejects global start before creating a Client when native cleanup is pending', async () => {
    const first = fakeConnection()
    const second = fakeConnection()
    const connections = [first, second]
    const createClient = vi.fn(() => connections.shift()!.client as never)
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:client',
      configRevision: REVISION,
      publish: () => undefined,
      createClient,
    })
    await adapter.start()
    await eventually(() => first.groups.length === 1)
    first.session.close.mockRejectedValueOnce(new Error('Session close failed'))
    await expect(adapter.stop()).rejects.toThrow('Session close failed')

    await expect(adapter.start()).rejects.toThrow('OPC_UA_ENDPOINT_CLEANUP_REQUIRED')
    expect(createClient).toHaveBeenCalledOnce()
    expect(adapter.status()[0]?.phase).toBe('faulted')

    await expect(adapter.stop()).resolves.toBeUndefined()
  })

  it('retains a Session created after the stop fence when its first close fails', async () => {
    const connection = fakeConnection()
    const order: string[] = []
    let resolveSession!: (session: typeof connection.session) => void
    connection.client.createSession = vi.fn(() => new Promise<typeof connection.session>((resolve) => {
      resolveSession = resolve
    }))
    connection.session.close
      .mockImplementationOnce(async () => {
        order.push('session-close')
        throw new Error('late Session close failed')
      })
      .mockImplementationOnce(async () => { order.push('session-close-retry') })
    connection.client.disconnect = vi.fn(async () => { order.push('client-disconnect') })
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:client',
      configRevision: REVISION,
      publish: () => undefined,
      createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => vi.mocked(connection.client.createSession).mock.calls.length === 1)

    const stopping = adapter.stop()
    resolveSession(connection.session)

    await expect(stopping).rejects.toThrow('late Session close failed')
    expect(connection.session.close).toHaveBeenCalledOnce()
    expect(order).toEqual(['session-close', 'client-disconnect'])
    expect(adapter.status()[0]?.phase).toBe('faulted')

    await expect(adapter.stop()).resolves.toBeUndefined()
    expect(connection.session.close).toHaveBeenCalledTimes(2)
    expect(order).toEqual(['session-close', 'client-disconnect', 'session-close-retry'])
    expect(adapter.status()[0]?.phase).toBe('disabled')
  })

  it('terminates a late Subscription before its runtime-owned Session and Client', async () => {
    const connection = fakeConnection()
    const order: string[] = []
    const lateSubscription = Object.assign(new EventEmitter(), {
      terminate: vi.fn()
        .mockImplementationOnce(async () => {
          order.push('subscription-terminate')
          throw new Error('late Subscription terminate failed')
        })
        .mockImplementationOnce(async () => { order.push('subscription-terminate-retry') }),
      monitorItems: vi.fn(),
    })
    let resolveSubscription!: (subscription: typeof lateSubscription) => void
    connection.session.createSubscription2 = vi.fn(
      () => new Promise<typeof lateSubscription>((resolve) => { resolveSubscription = resolve }),
    )
    connection.session.close = vi.fn(async () => { order.push('session-close') })
    connection.client.disconnect = vi.fn(async () => { order.push('client-disconnect') })
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:client',
      configRevision: REVISION,
      publish: () => undefined,
      createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => connection.session.createSubscription2.mock.calls.length === 1)

    const stopping = adapter.stop()
    resolveSubscription(lateSubscription)

    await expect(stopping).rejects.toThrow('late Subscription terminate failed')
    expect(order).toEqual(['subscription-terminate', 'session-close', 'client-disconnect'])
    expect(adapter.status()[0]?.phase).toBe('faulted')

    await expect(adapter.stop()).resolves.toBeUndefined()
    expect(order).toEqual([
      'subscription-terminate',
      'session-close',
      'client-disconnect',
      'subscription-terminate-retry',
    ])
    expect(adapter.status()[0]?.phase).toBe('disabled')
  })

  it('settles every Endpoint cleanup before releasing stop for an immediate retry', async () => {
    const first = fakeConnection()
    const second = fakeConnection()
    first.session.close.mockRejectedValueOnce(new Error('first Endpoint close failed'))
    let resolveSecondDisconnect!: () => void
    second.client.disconnect = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveSecondDisconnect = resolve
      }))
      .mockResolvedValue(undefined)
    const adapter = createOpcUaClientAdapterV1(twoEndpointReadProject(), {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:client',
      configRevision: REVISION,
      publish: () => undefined,
      createClient: (endpoint) => (
        endpoint.endpointId === 'plc' ? first.client : second.client
      ) as never,
    })
    await adapter.start()
    await eventually(() => adapter.status().every(({ phase }) => phase === 'connected'))

    const firstStop = adapter.stop()
    let firstOutcome: 'pending' | 'resolved' | 'rejected' = 'pending'
    void firstStop.then(
      () => { firstOutcome = 'resolved' },
      () => { firstOutcome = 'rejected' },
    )
    let retry: Promise<void> | null = null
    try {
      await eventually(() => (
        first.session.close.mock.calls.length === 1
        && vi.mocked(second.client.disconnect).mock.calls.length === 1
      ))
      await Promise.resolve()
      expect(firstOutcome).toBe('pending')

      retry = adapter.stop()
      await Promise.resolve()
      expect(second.client.disconnect).toHaveBeenCalledOnce()

      resolveSecondDisconnect()
      await expect(firstStop).rejects.toThrow('first Endpoint close failed')
      await expect(retry).resolves.toBeUndefined()
      expect(first.session.close).toHaveBeenCalledTimes(2)
      expect(second.client.disconnect).toHaveBeenCalledOnce()
    } finally {
      resolveSecondDisconnect?.()
      await Promise.allSettled([firstStop, ...(retry === null ? [] : [retry])])
    }
  })

  it('disconnects and reconnects one Endpoint without changing its saved mapping count', async () => {
    const first = fakeConnection()
    const second = fakeConnection()
    const connections = [first, second]
    const published: RuntimePublisherMessageV1[] = []
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      publish: (publication) => { published.push(readNormalizedOpcUaClientPublicationV1(publication)) },
      createClient: () => connections.shift()!.client as never,
    })

    await adapter.start()
    await eventually(() => adapter.status()[0]?.phase === 'connected')
    await adapter.disconnectEndpoint!('plc')

    expect(adapter.status()[0]).toMatchObject({
      endpointId: 'plc', phase: 'disabled', mappingCount: 1,
      sessionActive: false, subscriptionActive: false,
    })
    expect(published.map((message) => message.type === 'endpoint-lifecycle-v1' ? message.phase : message.type))
      .toEqual(['connected', 'disconnected'])

    await adapter.reconnectEndpoint!('plc')
    await eventually(() => adapter.status()[0]?.phase === 'connected')
    expect(adapter.status()[0]).toMatchObject({ endpointId: 'plc', phase: 'connected', mappingCount: 1 })
    await adapter.stop()
  })

  it('settles live stop and closes every resource exactly once when the Gateway clock becomes invalid', async () => {
    const connection = fakeConnection()
    let samples = 0
    const published: RuntimePublisherMessageV1[] = []
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      nowMs: () => (samples++ === 0 ? 1_000 : Number.NaN),
      publish: (publication) => { published.push(readNormalizedOpcUaClientPublicationV1(publication)) }, createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => connection.groups.length === 1)

    await expect(adapter.stop()).resolves.toBeUndefined()
    expect(samples).toBe(2)
    expect((connection.groups[0] as unknown as { readonly terminate: unknown }).terminate).toHaveBeenCalledOnce()
    expect((connection.subscriptions[0] as unknown as { readonly terminate: unknown }).terminate).toHaveBeenCalledOnce()
    expect(connection.session.close).toHaveBeenCalledOnce()
    expect(connection.client.disconnect).toHaveBeenCalledOnce()
    expect(published.map((message) => message.type === 'endpoint-lifecycle-v1' ? message.phase : message.type)).toEqual(['connected'])
    expect(adapter.status()[0]?.lastError).toMatchObject({ occurredAtMs: 1_000 })
  })

  it('settles live stop without retrying a throwing Gateway clock for diagnostics', async () => {
    const connection = fakeConnection()
    const published: RuntimePublisherMessageV1[] = []
    let calls = 0
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      nowMs: () => {
        calls += 1
        if (calls === 1) return 1_000
        throw new Error('clock unavailable')
      },
      publish: (publication) => { published.push(readNormalizedOpcUaClientPublicationV1(publication)) },
      createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => connection.groups.length === 1)

    await expect(adapter.stop()).resolves.toBeUndefined()
    expect(calls).toBe(2)
    expect(published.map((message) => message.type === 'endpoint-lifecycle-v1' ? message.phase : message.type)).toEqual(['connected'])
    expect(adapter.status()[0]?.lastError).toMatchObject({ message: 'clock unavailable', occurredAtMs: 1_000 })
    expect((connection.groups[0] as unknown as { readonly terminate: unknown }).terminate).toHaveBeenCalledOnce()
    expect((connection.subscriptions[0] as unknown as { readonly terminate: unknown }).terminate).toHaveBeenCalledOnce()
    expect(connection.session.close).toHaveBeenCalledOnce()
    expect(connection.client.disconnect).toHaveBeenCalledOnce()
  })

  it('closes a source-exhausted live Session when its terminal diagnostic clock is invalid', async () => {
    const connection = fakeConnection()
    const samples = [1_000, 1_001, 1_002]
    let clockCalls = 0
    const published: RuntimePublisherMessageV1[] = []
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      nowMs: () => { clockCalls += 1; return samples.shift() ?? Number.NaN },
      initialSourceSequenceByEndpoint: { plc: Number.MAX_SAFE_INTEGER - 1 },
      publish: (publication) => { published.push(readNormalizedOpcUaClientPublicationV1(publication)) }, createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => connection.groups.length === 1)
    connection.groups[0]!.emit('changed', {}, changed({ payload: { present: true } }), 0)

    await eventually(() => connection.session.close.mock.calls.length === 1)
    expect((connection.groups[0] as unknown as { readonly terminate: unknown }).terminate).toHaveBeenCalledOnce()
    expect((connection.subscriptions[0] as unknown as { readonly terminate: unknown }).terminate).toHaveBeenCalledOnce()
    expect(connection.client.disconnect).toHaveBeenCalledOnce()
    expect(clockCalls).toBe(4)
    expect(published.map((message) => message.type === 'endpoint-lifecycle-v1' ? message.phase : message.type)).toEqual(['connected'])
    expect(adapter.status()[0]?.lastError).toMatchObject({ code: 'OPC_UA_SOURCE_SEQUENCE_EXHAUSTED', occurredAtMs: 1_002 })
  })

  it('records a namespace-array read exception and schedules a retry without creating a monitored group', async () => {
    const connection = fakeConnection()
    connection.session.readNamespaceArray.mockRejectedValueOnce(new Error('namespace read failed'))
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      publish: () => undefined, createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => adapter.status()[0]?.phase === 'reconnecting')
    expect(connection.groups).toHaveLength(0)
    expect(adapter.status()[0]?.lastError).toMatchObject({ message: 'namespace read failed' })
    await adapter.stop()
  })

  it('invalidates writes before recovering a terminated monitored group and ignores its late callback', async () => {
    const first = fakeConnection()
    const second = fakeConnection()
    const connections = [first, second]
    const batches: unknown[] = []
    const adapter = createOpcUaClientAdapterV1(readWriteRootProject(), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      publish: (publication) => { collectStatePublication(batches, publication) }, createClient: () => connections.shift()!.client as never,
    })
    await adapter.start()
    await eventually(() => first.groups.length === 1)
    first.groups[0]!.emit('changed', {}, changed(true), 0)
    await eventually(() => batches.length === 1)
    first.subscriptions[0]!.emit('terminated')
    await eventually(() => adapter.status()[0]?.phase === 'reconnecting')
    await expect(adapter.write({ mappingId: 'map-part-present', value: true }))
      .resolves.toMatchObject({ ok: false, failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED' })
    await eventually(() => second.subscriptions.length === 1)
    await eventually(() => second.groups.length === 1)
    const beforeLateCallback = batches.length
    first.groups[0]!.emit('changed', {}, changed(false), 0)
    await new Promise<void>((resolve) => { setTimeout(resolve, 20) })
    expect(batches).toHaveLength(beforeLateCallback)
    second.groups[0]!.emit('changed', {}, changed(false), 0)
    await eventually(() => batches.length === beforeLateCallback + 1)
    await adapter.stop()
  })

  it('contains publisher failures inside the monitored-item callback and keeps its endpoint diagnostic', async () => {
    const connection = fakeConnection()
    const adapter = createOpcUaClientAdapterV1(readProject(), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      publish: () => { throw new Error('publisher rejected batch') }, createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => connection.groups.length === 1)
    expect(() => connection.groups[0]!.emit('changed', {}, changed({ payload: { present: true } }), 0)).not.toThrow()
    expect(adapter.status()[0]).toMatchObject({ lastError: expect.objectContaining({ message: expect.stringContaining('publisher rejected batch') }) })
    await adapter.stop()
  })

  it('subscribes to a real local node-opcua Server through V5 URI resolution and publishes a root update', async () => {
    const server = new OPCUAServer({
      host: '127.0.0.1', hostname: '127.0.0.1', port: 0, resourcePath: '', allowAnonymous: true,
      securityModes: [MessageSecurityMode.None], securityPolicies: [SecurityPolicy.None],
    })
    let adapter: ReturnType<typeof createOpcUaClientAdapterV1> | null = null
    try {
      await server.initialize()
      const addressSpace = server.engine.addressSpace
      expect(addressSpace).not.toBeNull()
      const namespace = addressSpace!.registerNamespace('urn:virtual-plc')
      const variable = namespace.addVariable({
        organizedBy: addressSpace!.rootFolder.objects,
        browseName: 'MachineState', nodeId: `ns=${namespace.index};s=Machine.State`,
        dataType: DataType.Boolean, value: new Variant({ dataType: DataType.Boolean, value: false }),
      })
      await server.start()
      const project = cloneWorkcellProjectV5(readWriteRootProject())
      ;(project.opcUa.endpoints[0] as unknown as { endpointUrl: string }).endpointUrl = server.getEndpointUrl()
      const published: unknown[] = []
      adapter = createOpcUaClientAdapterV1(validateWorkcellProjectV5(project), {
        gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
        publish: (publication) => { collectStatePublication(published, publication) },
      })
      await adapter.start()
      await eventually(() => adapter?.status()[0]?.phase === 'connected', 8_000)
      variable.setValueFromSource({ dataType: DataType.Boolean, value: true }, StatusCodes.Good, new Date(1_000))
      await eventually(() => published.some((batch) => (
        validateStateBatchV1(batch).values.some(({ value }) => value === true)
      )), 8_000)
      expect(validateStateBatchV1(published.at(-1))).toMatchObject({
        configRevision: REVISION,
        values: [expect.objectContaining({ mappingId: 'map-part-present', value: true, quality: 'GOOD' })],
      })
    } finally {
      await adapter?.stop()
      await server.shutdown(0)
    }
  }, 15_000)

  it('reports disabled and unmapped Endpoints in configured order', () => {
    const project = cloneWorkcellProjectV5(writeOnlyProject())
    const endpoint = project.opcUa.endpoints[0]!
    ;(project.opcUa.endpoints as unknown as WorkcellProjectV5['opcUa']['endpoints'][number][]).push(
      { ...endpoint, endpointId: 'disabled', enabled: false },
      { ...endpoint, endpointId: 'unmapped', endpointUrl: 'opc.tcp://127.0.0.1:4841' },
    )
    const adapter = createOpcUaClientAdapterV1(validateWorkcellProjectV5(project), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION, publish: () => undefined,
    })
    expect(adapter.status().map(({ endpointId, phase, mappingCount }) => ({ endpointId, phase, mappingCount }))).toEqual([
      { endpointId: 'plc', phase: 'disabled', mappingCount: 1 },
      { endpointId: 'disabled', phase: 'disabled', mappingCount: 0 },
      { endpointId: 'unmapped', phase: 'disabled', mappingCount: 0 },
    ])
  })

  it('resolves only one URI from a live Endpoint Session', async () => {
    const namespaces = ['http://opcfoundation.org/UA/', 'urn:virtual-plc']
    const connection = fakeConnection(namespaces)
    const adapter = createOpcUaClientAdapterV1(sharedRootStringProject(), { gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION, publish: () => undefined, createClient: () => connection.client as never })
    await adapter.start()
    await eventually(() => adapter.status().some(({ phase }) => phase === 'connected'))
    const endpointId = adapter.status().find(({ phase }) => phase === 'connected')!.endpointId
    await expect(adapter.resolveNamespaceIndex?.(endpointId, 'urn:virtual-plc')).resolves.toBe(1)
    await expect(adapter.resolveNamespaceIndex?.(endpointId, 'urn:missing')).rejects.toThrow('OPC_UA_NAMESPACE_URI_MISSING')
    await expect(adapter.resolveNamespaceIndex?.('missing', 'urn:virtual-plc')).rejects.toThrow('OPC_UA_NAMESPACE_ENDPOINT_DISCONNECTED')
    namespaces.push('urn:virtual-plc')
    await expect(adapter.resolveNamespaceIndex?.(endpointId, 'urn:virtual-plc')).rejects.toThrow('OPC_UA_NAMESPACE_URI_DUPLICATE')
    await adapter.stop()
    await expect(adapter.resolveNamespaceIndex?.(endpointId, 'urn:virtual-plc')).rejects.toThrow('OPC_UA_NAMESPACE_ENDPOINT_DISCONNECTED')
  })

  it('rejects NamespaceArray read failures and malformed arrays without writes or subscriptions', async () => {
    const namespaces = ['http://opcfoundation.org/UA/', 'urn:virtual-plc']
    const connection = fakeConnection(namespaces)
    const adapter = createOpcUaClientAdapterV1(sharedRootStringProject(), { gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION, publish: () => undefined, createClient: () => connection.client as never })
    await adapter.start(); await eventually(() => adapter.status().some(({ phase }) => phase === 'connected'))
    const endpointId = adapter.status().find(({ phase }) => phase === 'connected')!.endpointId
    connection.session.readNamespaceArray.mockRejectedValueOnce(new Error('read'))
    await expect(adapter.resolveNamespaceIndex?.(endpointId, 'urn:virtual-plc')).rejects.toThrow('OPC_UA_NAMESPACE_READ_FAILED')
    namespaces[1] = ''
    await expect(adapter.resolveNamespaceIndex?.(endpointId, 'urn:virtual-plc')).rejects.toThrow('OPC_UA_NAMESPACE_ARRAY_INVALID')
    expect(connection.session.write).not.toHaveBeenCalled(); expect(connection.subscriptions).toHaveLength(1)
    await adapter.stop()
  })

  const invalidNamespaceArrays = [
    Array.from({ length: 257 }, (_, index) => `urn:${index}`),
    ['http://opcfoundation.org/UA/', 'x'.repeat(4097)],
    Array.from({ length: 13 }, (_, index) => `urn:${index}:`.padEnd(4096, 'x')),
    ['http://opcfoundation.org/UA/', 'urn:a', 'urn:a'],
  ]
  it.each(invalidNamespaceArrays.map((value) => [value] as const))('rejects an invalid NamespaceArray without mutations', async (invalidNamespaces) => {
    const namespaces = ['http://opcfoundation.org/UA/', 'urn:virtual-plc']
    const connection = fakeConnection(namespaces)
    const adapter = createOpcUaClientAdapterV1(sharedRootStringProject(), { gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION, publish: () => undefined, createClient: () => connection.client as never })
    await adapter.start(); await eventually(() => adapter.status().some(({ phase }) => phase === 'connected'))
    const endpointId = adapter.status().find(({ phase }) => phase === 'connected')!.endpointId
    namespaces.splice(0, namespaces.length, ...invalidNamespaces)
    const writes = connection.session.write.mock.calls.length; const subscriptions = connection.subscriptions.length
    await expect(adapter.resolveNamespaceIndex?.(endpointId, 'urn:virtual-plc')).rejects.toThrow('OPC_UA_NAMESPACE_ARRAY_INVALID')
    expect(connection.session.write).toHaveBeenCalledTimes(writes); expect(connection.subscriptions).toHaveLength(subscriptions)
    await adapter.stop()
  })

  it('fences a NamespaceArray read when its Endpoint disconnects during await', async () => {
    let resolveRead!: (value: string[]) => void
    const connection = fakeConnection()
    const adapter = createOpcUaClientAdapterV1(sharedRootStringProject(), { gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION, publish: () => undefined, createClient: () => connection.client as never })
    await adapter.start(); await eventually(() => adapter.status().some(({ phase }) => phase === 'connected'))
    const endpointId = adapter.status().find(({ phase }) => phase === 'connected')!.endpointId
    connection.session.readNamespaceArray.mockImplementationOnce(() => new Promise<string[]>((resolve) => { resolveRead = resolve }))
    const writes = connection.session.write.mock.calls.length; const subscriptions = connection.subscriptions.length
    const pending = adapter.resolveNamespaceIndex?.(endpointId, 'urn:virtual-plc')
    await eventually(() => connection.session.readNamespaceArray.mock.calls.length >= 2)
    await adapter.disconnectEndpoint?.(endpointId)
    resolveRead(['http://opcfoundation.org/UA/', 'urn:virtual-plc'])
    await expect(pending).rejects.toThrow('OPC_UA_NAMESPACE_SESSION_STALE')
    expect(connection.session.write).toHaveBeenCalledTimes(writes); expect(connection.subscriptions).toHaveLength(subscriptions)
    await adapter.stop()
  })
})
