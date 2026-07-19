// @vitest-environment node

import { EventEmitter } from 'node:events'
import { StatusCodes } from 'node-opcua'
import { describe, expect, it, vi } from 'vitest'

import { validateWorkcellProjectV5, type WorkcellProjectV5 } from '../../src/core/project-v5/index.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../src/core/project-v5/test-support.js'
import { validateStateBatchV1 } from '../../src/core/runtime-protocol/v1.js'
import { createOpcUaClientAdapterV1 } from './opcua-client-adapter.js'

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

function fakeConnection(namespaceArray = ['http://opcfoundation.org/UA/', 'urn:virtual-plc']) {
  const subscriptions: EventEmitter[] = []
  const groups: EventEmitter[] = []
  const write = vi.fn(async () => StatusCodes.Good)
  const session = {
    readNamespaceArray: vi.fn(async () => namespaceArray), write, close: vi.fn(async () => undefined),
    createSubscription2: vi.fn(async () => {
      const subscription = new EventEmitter() as EventEmitter & {
        monitorItems: (items: readonly unknown[]) => Promise<EventEmitter>
        terminate: () => Promise<void>
      }
      subscription.monitorItems = async (_items) => {
        const group = new EventEmitter() as EventEmitter & { terminate: () => Promise<void> }
        group.terminate = async () => undefined
        groups.push(group)
        return group
      }
      subscription.terminate = async () => undefined
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
  client.disconnect = async () => undefined
  return { client, session, subscriptions, groups }
}

function changed(value: unknown, statusCode = 'Good') {
  return {
    value: { value }, statusCode: { name: statusCode, toString: () => statusCode },
    sourceTimestamp: new Date(1_000), serverTimestamp: null,
  }
}

describe('OPC UA client adapter V1 Project V5 root-notification boundary', () => {
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

  it('invalidates writes before recovering a terminated empty Subscription and ignores its late root callback', async () => {
    const first = fakeConnection()
    const second = fakeConnection()
    const connections = [first, second]
    const adapter = createOpcUaClientAdapterV1(writeOnlyProject(), {
      gatewayId: 'gateway-local', originId: 'gateway-local:client', configRevision: REVISION,
      publish: () => undefined, createClient: () => connections.shift()!.client as never,
    })
    await adapter.start()
    await eventually(() => adapter.status()[0]?.phase === 'connected')
    first.subscriptions[0]!.emit('terminated')
    await eventually(() => adapter.status()[0]?.phase === 'reconnecting')
    await expect(adapter.write({ mappingId: 'map-start', value: true }))
      .resolves.toMatchObject({ ok: false, failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED' })
    await eventually(() => second.subscriptions.length === 1)
    expect(second.groups).toHaveLength(0)
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
