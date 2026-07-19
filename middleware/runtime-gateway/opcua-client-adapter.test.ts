// @vitest-environment node

import { EventEmitter } from 'node:events'
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
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../src/core/project-v5/test-support.js'
import { MAX_RUNTIME_BATCH_BYTES_V1, validateStateBatchV1 } from '../../src/core/runtime-protocol/v1.js'
import {
  createOpcUaClientAdapterV1,
  createOpcUaClientSnapshotAssemblerV1,
} from './opcua-client-adapter.js'

const REVISION = 'a'.repeat(64)

async function eventually(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('TEST_EVENTUALLY_TIMEOUT')
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
  }
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

function sharedRootStringProject(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(readProject())
  const logicalSignals = Array.from({ length: 64 }, (_unused, index) => ({
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

function readWriteRootProject(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(readProject('readWrite'))
  ;(project.opcUa.mappings[0] as unknown as { leaves: unknown }).leaves = [{
    leafPath: [], projectPath: [],
    projectTarget: { type: 'logical-signal', signalId: 'part-present' },
    opcUaDataType: 'Boolean', projectDataType: 'boolean', scale: 1, offset: 0, unit: '', required: true,
  }]
  return validateWorkcellProjectV5(project)
}

function fakeConnection(namespaceArray = ['http://opcfoundation.org/UA/', 'urn:virtual-plc']) {
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
  client.connect = async (_endpointUrl) => undefined
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

describe('OPC UA client adapter V1 Project V5 root-notification boundary', () => {
  it('fans out a maximal shared String root through bounded State Batches without dropping mapping IDs', () => {
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
    const published: unknown[] = []
    const assembler = createOpcUaClientSnapshotAssemblerV1({
      project,
      endpoint,
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      nowMs: () => 2_000,
      publish: (batch) => { published.push(batch) },
    })

    assembler.accept('plc\0s=Machine.Shared', {
      values: Array.from({ length: 64 }, () => 'x'.repeat(4_096)),
    }, 'Good', 1_000)

    const batches = published.map((batch) => validateStateBatchV1(batch))
    expect(batches.length).toBeGreaterThan(1)
    expect(batches.map(({ sequence }) => sequence)).toEqual([...batches.keys()].map((index) => index + 1))
    expect(batches.every((batch) => Buffer.byteLength(JSON.stringify(batch)) <= MAX_RUNTIME_BATCH_BYTES_V1)).toBe(true)
    expect(batches.flatMap(({ values }) => values.map(({ mappingId }) => mappingId))).toEqual(
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
      publish: (batch) => { batches.push(batch) }, createClient: () => connection.client as never,
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
      publish: (batch) => { batches.push(batch) }, createClient: () => connection.client as never,
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
      publish: (batch) => { batches.push(batch) }, createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => connection.groups.length === 1)

    connection.groups[0]!.emit('changed', {}, changed({
      pose: { position: new Float64Array([1_000, 2_000, 3_000]), rpy: [0, 0, 90] },
    }), 0)

    const published = validateStateBatchV1(batches[0])
    expect(published).toMatchObject({ configRevision: 'b'.repeat(64), sequence: 1 })
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
      publish: (batch) => { batches.push(batch) }, createClient: () => connection.client as never,
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
      publish: (batch) => { batches.push(batch) }, createClient: () => connections.shift()!.client as never,
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
        publish: (batch) => { published.push(batch) },
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
})
