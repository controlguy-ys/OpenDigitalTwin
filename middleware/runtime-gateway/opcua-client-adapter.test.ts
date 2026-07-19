// @vitest-environment node

import {
  DataType,
  MessageSecurityMode,
  OPCUAServer,
  SecurityPolicy,
  StatusCodes,
  Variant,
  type UAVariable,
} from 'node-opcua'
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'

import { validateStateBatchV1 } from '../../src/core/runtime-protocol/v1.js'
import type { WorkcellProjectV4 } from '../../src/core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../src/core/project-v4/test-support.js'
import {
  compileOpcUaClientReadPlanV1,
  createOpcUaClientAdapterV1,
  createOpcUaClientSnapshotAssemblerV1,
} from './opcua-client-adapter.js'

const REVISION = 'a'.repeat(64)

async function eventually(
  predicate: () => boolean,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('TEST_EVENTUALLY_TIMEOUT')
    await new Promise<void>((resolve) => { setTimeout(resolve, 25) })
  }
}

function projectWithEntityPoseMapping(): WorkcellProjectV4 {
  const project = makeMinimalWorkcellProjectV4()
  const endpointId = 'endpoint-live'
  const entityId = 'box-live'
  const frameId = 'box-live-motion'
  const target = { type: 'entity-frame' as const, entityId, frameId }
  const leaves = [
    ['positionM', 0, 'ns=2;s=Box/X', 0.001, 'metre'],
    ['positionM', 1, 'ns=2;s=Box/Y', 0.001, 'metre'],
    ['positionM', 2, 'ns=2;s=Box/Z', 0.001, 'metre'],
    ['rpyDegrees', 0, 'ns=2;s=Box/Roll', 1, 'degree'],
    ['rpyDegrees', 1, 'ns=2;s=Box/Pitch', 1, 'degree'],
    ['rpyDegrees', 2, 'ns=2;s=Box/Yaw', 1, 'degree'],
  ].map(([root, index, nodeId, scale, unit]) => ({
    leafPath: [root as string, index as number],
    nodeId: nodeId as string,
    projectTarget: target,
    opcUaDataType: 'Double' as const,
    projectDataType: 'number' as const,
    scale: scale as number,
    offset: 0,
    unit: unit as string,
    required: true,
  }))

  return {
    ...project,
    revisionId: REVISION,
    spatialEntities: [{
      id: entityId,
      name: 'Live box',
      geometry: { kind: 'box' as const, dimensionsM: [1, 1, 1], color: '#808080' as const },
      parentFrameId: frameId,
      localPose: { positionM: [0, 0, 0] as const, quaternion: [0, 0, 0, 1] as const },
      visible: true,
      groupId: null,
      removable: true,
      transformOwner: `opcua:${endpointId}` as const,
      numericStatus: {
        value: 0,
        sourceOwnership: 'manual' as const,
        overlay: { visible: true, frameId: null },
      },
      graspable: false,
      graspFrames: [],
      movingFrames: [{
        frameId,
        name: 'Live frame',
        parentFrameId: 'world',
        localPose: { positionM: [0, 0, 0] as const, quaternion: [0, 0, 0, 1] as const },
        sourceOwnership: `opcua:${endpointId}` as const,
      }],
    }],
    opcUa: {
      mode: 'client' as const,
      endpoints: [{
        endpointId,
        name: 'Live endpoint',
        endpointUrl: 'opc.tcp://127.0.0.1:4840',
        enabled: true,
        publishingIntervalMs: 100,
        reconnectDelayMs: 100,
      }],
      mappings: [{
        id: 'mapping-live-pose',
        endpointId,
        direction: 'read' as const,
        publishingIntervalMs: 100,
        coherenceGroupId: 'box-live-pose',
        sourceOwnership: `opcua:${endpointId}` as const,
        interpolationMode: 'shortest-quaternion' as const,
        coordinateConvention: 'project-v4-z-up-metres-quaternion-xyzw' as const,
        leaves,
      }],
      actionBindings: [],
      bridgeRoutes: [],
    },
  }
}

function projectWithEntityStatusMapping(): WorkcellProjectV4 {
  const project = projectWithEntityPoseMapping()
  const endpointId = project.opcUa.endpoints[0]!.endpointId
  return {
    ...project,
    opcUa: {
      ...project.opcUa,
      mappings: [...project.opcUa.mappings, {
        id: 'mapping-live-status',
        endpointId,
        direction: 'read' as const,
        publishingIntervalMs: 100,
        coherenceGroupId: null,
        sourceOwnership: `opcua:${endpointId}` as const,
        interpolationMode: 'none' as const,
        coordinateConvention: 'project-v4-z-up-metres-quaternion-xyzw' as const,
        leaves: [{
          leafPath: [],
          nodeId: 'ns=2;s=Box/Status',
          projectTarget: { type: 'entity-status' as const, entityId: 'box-live' },
          opcUaDataType: 'Double' as const,
          projectDataType: 'number' as const,
          scale: 1,
          offset: 0,
          unit: 'state',
          required: true,
        }],
      }],
    },
  }
}

function fakeOpcUaClientConnection() {
  const group = new EventEmitter() as EventEmitter & {
    terminate(): Promise<void>
  }
  group.terminate = async () => undefined
  const subscription = {
    monitorItems: async () => group,
    terminate: async () => undefined,
  }
  const session = {
    createSubscription2: async () => subscription,
    close: async () => undefined,
  }
  const client = new EventEmitter() as EventEmitter & {
    connect(endpointUrl: string): Promise<void>
    createSession(): Promise<typeof session>
    disconnect(): Promise<void>
  }
  client.connect = async (_endpointUrl: string) => undefined
  client.createSession = async () => session
  client.disconnect = async () => undefined
  return { client, group }
}

function fakeDataValue(value: number, statusCode = 'Good') {
  return {
    value: { value },
    statusCode: { toString: () => statusCode },
    sourceTimestamp: new Date(1000),
    serverTimestamp: null,
  }
}

describe('OPC UA client adapter V1', () => {
  it('compiles enabled read mappings and excludes disabled or write-only routes', () => {
    const project = projectWithEntityPoseMapping()
    const disabledEndpoint = { ...project.opcUa.endpoints[0]!, endpointId: 'endpoint-disabled', enabled: false }
    const disabledMapping = {
      ...project.opcUa.mappings[0]!,
      id: 'mapping-disabled',
      endpointId: disabledEndpoint.endpointId,
    }
    const writeOnly = {
      ...project.opcUa.mappings[0]!,
      id: 'mapping-write',
      direction: 'write' as const,
      leaves: project.opcUa.mappings[0]!.leaves.map((leaf, index) => ({
        ...leaf,
        nodeId: `ns=2;s=Command/${index}`,
      })),
    }

    const plan = compileOpcUaClientReadPlanV1({
      ...project,
      opcUa: {
        ...project.opcUa,
        endpoints: [...project.opcUa.endpoints, disabledEndpoint],
        mappings: [...project.opcUa.mappings, disabledMapping, writeOnly],
      },
    })

    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ endpointId: 'endpoint-live', mappings: [{ id: 'mapping-live-pose' }] })
    expect(plan[0]!.nodeIds).toHaveLength(6)
  })

  it('publishes a canonical entity pose after the initial coherent cache and on a single subsequent leaf update', () => {
    const project = projectWithEntityPoseMapping()
    const endpoint = compileOpcUaClientReadPlanV1(project)[0]!
    const batches: unknown[] = []
    const assembler = createOpcUaClientSnapshotAssemblerV1({
      project,
      endpoint,
      gatewayId: 'gateway-local',
      originId: 'gateway-local:client',
      nowMs: () => 1000,
      publish: (batch) => { batches.push(batch) },
    })

    endpoint.nodeIds.forEach((nodeId, index) => {
      assembler.accept(nodeId, index === 0 ? 1000 : 0, 'Good', 900 + index)
    })

    expect(batches).toHaveLength(1)
    const first = validateStateBatchV1(batches[0])
    expect(first).toMatchObject({ endpointId: 'endpoint-live', sequence: 1 })
    expect(first.values[0]).toMatchObject({
      mappingId: 'mapping-live-pose',
      coherenceGroupId: 'box-live-pose',
      quality: 'GOOD',
      value: { positionM: [1, 0, 0], quaternion: [0, 0, 0, 1] },
    })

    assembler.accept(endpoint.nodeIds[0]!, 2500, 'Good', 1000)

    expect(batches).toHaveLength(2)
    const second = validateStateBatchV1(batches[1])
    expect(second.values[0]!.value).toMatchObject({ positionM: [2.5, 0, 0] })
    expect(second.sequence).toBe(2)
  })

  it('uses the supplied canonical config revision for a UUID Project revision', () => {
    const configRevision = 'b'.repeat(64)
    const project = { ...projectWithEntityPoseMapping(), revisionId: '6f0e1d43-1bd3-4c89-a811-3d8681e44773' }
    const endpoint = compileOpcUaClientReadPlanV1(project)[0]!
    const batches: unknown[] = []
    const assembler = createOpcUaClientSnapshotAssemblerV1({
      project,
      endpoint,
      configRevision,
      gatewayId: 'gateway-local',
      originId: 'gateway-local:client',
      nowMs: () => 1_000,
      publish: (batch) => { batches.push(batch) },
    })

    endpoint.nodeIds.forEach((nodeId, index) => assembler.accept(nodeId, index === 0 ? 1_000 : 0, 'Good', 900 + index))

    expect(validateStateBatchV1(batches[0])).toMatchObject({
      configRevision,
      projectId: project.projectId,
    })
  })

  it('preserves the latest scalar snapshot while exposing uncertain and bad OPC UA quality', () => {
    const project = projectWithEntityPoseMapping()
    const endpoint = compileOpcUaClientReadPlanV1(project)[0]!
    const batches: unknown[] = []
    const assembler = createOpcUaClientSnapshotAssemblerV1({
      project,
      endpoint,
      gatewayId: 'gateway-local',
      originId: 'gateway-local:client',
      nowMs: () => 2000,
      publish: (batch) => { batches.push(batch) },
    })
    endpoint.nodeIds.forEach((nodeId, index) => assembler.accept(nodeId, 0, 'Good', 1000 + index))
    assembler.accept(endpoint.nodeIds[1]!, 500, 'UncertainInitialValue', 2000)

    expect(validateStateBatchV1(batches.at(-1)).values[0]).toMatchObject({ quality: 'UNCERTAIN' })

    assembler.accept(endpoint.nodeIds[2]!, 600, 'BadNoCommunication', 2100)

    expect(validateStateBatchV1(batches.at(-1)).values[0]).toMatchObject({
      quality: 'BAD',
      statusCode: 'BadNoCommunication',
      value: { positionM: [0, 0.5, 0] },
    })
  })

  it('retains the prior coherent pose when a required leaf arrives Bad', () => {
    const project = projectWithEntityPoseMapping()
    const endpoint = compileOpcUaClientReadPlanV1(project)[0]!
    const batches: unknown[] = []
    const assembler = createOpcUaClientSnapshotAssemblerV1({
      project, endpoint, gatewayId: 'gateway-local', originId: 'gateway-local:client',
      nowMs: () => 2000, publish: (batch) => { batches.push(batch) },
    })
    ;[1000, 2000, 3000, 0, 0, 0].forEach((value, index) => {
      assembler.accept(endpoint.nodeIds[index]!, value, 'Good', 1000 + index)
    })

    assembler.accept(endpoint.nodeIds[0]!, 9000, 'BadNoCommunication', 2000)

    expect(validateStateBatchV1(batches.at(-1)).values[0]).toMatchObject({
      quality: 'BAD',
      statusCode: 'BadNoCommunication',
      value: { positionM: [1, 2, 3] },
    })
  })

  it('does not fabricate a pose when the first required leaf is non-finite', () => {
    const project = projectWithEntityPoseMapping()
    const endpoint = compileOpcUaClientReadPlanV1(project)[0]!
    const batches: unknown[] = []
    const assembler = createOpcUaClientSnapshotAssemblerV1({
      project, endpoint, gatewayId: 'gateway-local', originId: 'gateway-local:client',
      nowMs: () => 2000, publish: (batch) => { batches.push(batch) },
    })
    assembler.accept(endpoint.nodeIds[0]!, Number.NaN, 'Good', 1000)
    endpoint.nodeIds.slice(1).forEach((nodeId, index) => assembler.accept(nodeId, 0, 'Good', 1001 + index))

    expect(batches).toHaveLength(0)
  })

  it('requires a fresh complete set after coherence cache reset', () => {
    const project = projectWithEntityPoseMapping()
    const endpoint = compileOpcUaClientReadPlanV1(project)[0]!
    const batches: unknown[] = []
    const assembler = createOpcUaClientSnapshotAssemblerV1({
      project, endpoint, gatewayId: 'gateway-local', originId: 'gateway-local:client',
      nowMs: () => 2000, publish: (batch) => { batches.push(batch) },
    })
    endpoint.nodeIds.forEach((nodeId, index) => assembler.accept(nodeId, index, 'Good', 1000 + index))
    expect(batches).toHaveLength(1)

    assembler.reset()
    assembler.accept(endpoint.nodeIds[0]!, 9000, 'Good', 2000)
    expect(batches).toHaveLength(1)
    endpoint.nodeIds.slice(1).forEach((nodeId, index) => assembler.accept(nodeId, 0, 'Good', 2001 + index))

    expect(validateStateBatchV1(batches.at(-1)).values[0]!.value).toMatchObject({ positionM: [9, 0, 0] })
  })

  it('retains mapping and per-node effective sampling intervals in the compiled plan', () => {
    const project = projectWithEntityStatusMapping()
    const mapping = project.opcUa.mappings[1]!
    const endpoint = compileOpcUaClientReadPlanV1({
      ...project,
      opcUa: {
        ...project.opcUa,
        mappings: [
          { ...project.opcUa.mappings[0]!, publishingIntervalMs: 250 },
          { ...mapping, publishingIntervalMs: 100 },
        ],
      },
    })[0]!

    expect(endpoint.mappings.map(({ id, publishingIntervalMs }) => ({ id, publishingIntervalMs })))
      .toEqual([
        { id: 'mapping-live-pose', publishingIntervalMs: 250 },
        { id: 'mapping-live-status', publishingIntervalMs: 100 },
      ])
    expect(endpoint.nodeSamplingIntervalMs).toMatchObject({
      'ns=2;s=Box/X': 250,
      'ns=2;s=Box/Status': 100,
    })
    expect(endpoint.monitoringIntervalMs).toBe(100)
  })

  it('reports connected Session, Subscription, counts, timestamps, quality, and no retry', async () => {
    const project = projectWithEntityPoseMapping()
    const connection = fakeOpcUaClientConnection()
    let now = 5_000
    const adapter = createOpcUaClientAdapterV1(project, {
      gatewayId: 'gateway-local', originId: 'gateway-local:client',
      configRevision: REVISION, publish: () => undefined,
      nowMs: () => now, createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => adapter.status()[0]?.phase === 'connected')
    connection.group.emit('changed', {}, fakeDataValue(1), 0)

    expect(adapter.status()[0]).toMatchObject({
      endpointId: 'endpoint-live', endpointUrl: 'opc.tcp://127.0.0.1:4840',
      phase: 'connected', sessionActive: true, subscriptionActive: true,
      monitoredItemCount: 6, mappingCount: 1, lastValueQuality: 'GOOD',
      lastNotificationAtMs: 5_000, lastGoodValueAtMs: 5_000,
      reconnectAttempt: 0, nextRetryAtMs: null, lastError: null,
    })
    await adapter.stop()
  })

  it('retains a timed error and retry deadline after connection loss', async () => {
    const project = projectWithEntityPoseMapping()
    const connection = fakeOpcUaClientConnection()
    let now = 8_000
    const adapter = createOpcUaClientAdapterV1(project, {
      gatewayId: 'gateway-local', originId: 'gateway-local:client',
      configRevision: REVISION, publish: () => undefined,
      nowMs: () => now, createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => adapter.status()[0]?.phase === 'connected')
    connection.client.emit('connection_lost')
    await eventually(() => adapter.status()[0]?.phase === 'reconnecting')

    expect(adapter.status()[0]).toMatchObject({
      phase: 'reconnecting', sessionActive: false, subscriptionActive: false,
      reconnectAttempt: 1, nextRetryAtMs: 8_100,
      lastError: {
        code: 'OPC_UA_CONNECTION_LOST',
        message: 'OPC_UA_CONNECTION_LOST',
        occurredAtMs: 8_000,
      },
    })
    await adapter.stop()
  })

  it('clears pending retry state on stop while retaining the timed error and sample facts', async () => {
    const project = projectWithEntityPoseMapping()
    const connection = fakeOpcUaClientConnection()
    let now = 7_900
    const adapter = createOpcUaClientAdapterV1(project, {
      gatewayId: 'gateway-local', originId: 'gateway-local:client',
      configRevision: REVISION, publish: () => undefined,
      nowMs: () => now, createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => adapter.status()[0]?.phase === 'connected')
    connection.group.emit('changed', {}, fakeDataValue(1), 0)
    now = 8_000
    connection.client.emit('connection_lost')
    await eventually(() => adapter.status()[0]?.phase === 'reconnecting')

    await adapter.stop()

    expect(adapter.status()[0]).toMatchObject({
      phase: 'disabled', reconnectAttempt: 0, nextRetryAtMs: null,
      lastNotificationAtMs: 7_900, lastGoodValueAtMs: 7_900,
      lastError: {
        code: 'OPC_UA_CONNECTION_LOST',
        message: 'OPC_UA_CONNECTION_LOST',
        occurredAtMs: 8_000,
      },
    })
  })

  it('records UNCERTAIN and BAD notifications without replacing the last GOOD timestamp', async () => {
    const project = projectWithEntityPoseMapping()
    const connection = fakeOpcUaClientConnection()
    let now = 5_000
    const adapter = createOpcUaClientAdapterV1(project, {
      gatewayId: 'gateway-local', originId: 'gateway-local:client',
      configRevision: REVISION, publish: () => undefined,
      nowMs: () => now, createClient: () => connection.client as never,
    })
    await adapter.start()
    await eventually(() => adapter.status()[0]?.phase === 'connected')
    connection.group.emit('changed', {}, fakeDataValue(1), 0)
    now = 6_000
    connection.group.emit('changed', {}, fakeDataValue(2, 'UncertainInitialValue'), 0)
    expect(adapter.status()[0]).toMatchObject({
      lastValueQuality: 'UNCERTAIN', lastNotificationAtMs: 6_000, lastGoodValueAtMs: 5_000,
    })
    now = 7_000
    connection.group.emit('changed', {}, fakeDataValue(3, 'BadNoCommunication'), 0)

    expect(adapter.status()[0]).toMatchObject({
      lastValueQuality: 'BAD', lastNotificationAtMs: 7_000, lastGoodValueAtMs: 5_000,
    })
    await adapter.stop()
  })

  it('reports disabled and unmapped endpoints in configured endpoint order', () => {
    const project = projectWithEntityPoseMapping()
    const disabledEndpoint = {
      ...project.opcUa.endpoints[0]!,
      endpointId: 'endpoint-disabled',
      enabled: false,
    }
    const unmappedEndpoint = {
      ...project.opcUa.endpoints[0]!,
      endpointId: 'endpoint-unmapped',
      endpointUrl: 'opc.tcp://127.0.0.1:4841',
    }
    const adapter = createOpcUaClientAdapterV1({
      ...project,
      opcUa: {
        ...project.opcUa,
        endpoints: [project.opcUa.endpoints[0]!, disabledEndpoint, unmappedEndpoint],
      },
    }, {
      gatewayId: 'gateway-local', originId: 'gateway-local:client',
      configRevision: REVISION, publish: () => undefined,
    })

    expect(adapter.status()).toEqual(expect.arrayContaining([
      expect.objectContaining({ endpointId: 'endpoint-live', mappingCount: 1 }),
      expect.objectContaining({ endpointId: 'endpoint-disabled', phase: 'disabled', mappingCount: 0 }),
      expect.objectContaining({ endpointId: 'endpoint-unmapped', phase: 'disabled', mappingCount: 0 }),
    ]))
    expect(adapter.status().map(({ endpointId }) => endpointId)).toEqual([
      'endpoint-live', 'endpoint-disabled', 'endpoint-unmapped',
    ])
  })

  it('ignores a late changed callback from a terminated monitored group', async () => {
    const project = projectWithEntityPoseMapping()
    const first = fakeOpcUaClientConnection()
    const second = fakeOpcUaClientConnection()
    const connections = [first, second]
    const batches: unknown[] = []
    const adapter = createOpcUaClientAdapterV1(project, {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:client',
      configRevision: REVISION,
      publish: (batch) => { batches.push(batch) },
      createClient: () => connections.shift()!.client as never,
    })
    const endpoint = compileOpcUaClientReadPlanV1(project)[0]!
    await adapter.start()
    await eventually(() => adapter.status()[0]?.phase === 'connected')
    endpoint.nodeIds.forEach((_, index) => {
      first.group.emit('changed', {}, fakeDataValue(index), index)
    })
    await eventually(() => batches.length === 1)

    first.group.emit('terminated')
    await eventually(() => adapter.status()[0]?.phase === 'connected' && connections.length === 0)
    const beforeLateCallback = batches.length
    second.group.emit('changed', {}, fakeDataValue(9000), 0)
    await new Promise<void>((resolve) => { setTimeout(resolve, 20) })
    expect(batches).toHaveLength(beforeLateCallback)
    endpoint.nodeIds.slice(1).forEach((_, index) => {
      second.group.emit('changed', {}, fakeDataValue(0), index + 1)
    })
    await eventually(() => batches.length === beforeLateCallback + 1)
    expect(validateStateBatchV1(batches.at(-1)).values[0]!.value).toMatchObject({
      positionM: [9, 0, 0],
    })
    const afterReconnectSnapshot = batches.length

    first.group.emit('changed', {}, fakeDataValue(9000), 0)
    await new Promise<void>((resolve) => { setTimeout(resolve, 20) })

    expect(batches).toHaveLength(afterReconnectSnapshot)
    await adapter.stop()
  })

  it('contains an invalid snapshot publication error inside the monitored-item callback', async () => {
    const project = { ...projectWithEntityPoseMapping(), revisionId: '6f0e1d43-1bd3-4c89-a811-3d8681e44773' }
    const connection = fakeOpcUaClientConnection()
    const adapter = createOpcUaClientAdapterV1(project, {
      gatewayId: 'gateway-local',
      originId: 'gateway-local:client',
      configRevision: 'd'.repeat(64),
      publish: () => { throw new Error('publisher rejected batch') },
      createClient: () => connection.client as never,
    })
    const endpoint = compileOpcUaClientReadPlanV1(project)[0]!
    await adapter.start()
    await eventually(() => adapter.status()[0]?.phase === 'connected')

    expect(() => endpoint.nodeIds.forEach((_, index) => {
      connection.group.emit('changed', {}, fakeDataValue(index), index)
    })).not.toThrow()
    expect(adapter.status()[0]?.lastError?.message).toMatch(/RUNTIME_PROTOCOL_INVALID|publisher rejected batch/)
    await adapter.stop()
  })

  it('emits a scalar value for an entity-status mapping with a root leaf path', () => {
    const project = projectWithEntityStatusMapping()
    const endpoint = compileOpcUaClientReadPlanV1(project)[0]!
    const batches: unknown[] = []
    const assembler = createOpcUaClientSnapshotAssemblerV1({
      project,
      endpoint,
      gatewayId: 'gateway-local',
      originId: 'gateway-local:client',
      nowMs: () => 1000,
      publish: (batch) => { batches.push(batch) },
    })

    assembler.accept('ns=2;s=Box/Status', 7, 'Good', 900)

    expect(validateStateBatchV1(batches[0]).values).toContainEqual(expect.objectContaining({
      mappingId: 'mapping-live-status',
      value: 7,
      unit: 'state',
      quality: 'GOOD',
    }))
  })

  it('publishes only the independently changed ready mapping so a status heartbeat cannot refresh pose timing', () => {
    const project = projectWithEntityStatusMapping()
    const endpoint = compileOpcUaClientReadPlanV1(project)[0]!
    const batches: unknown[] = []
    const assembler = createOpcUaClientSnapshotAssemblerV1({
      project,
      endpoint,
      gatewayId: 'gateway-local',
      originId: 'gateway-local:client',
      nowMs: () => 1000,
      publish: (batch) => { batches.push(batch) },
    })
    for (const [index, nodeId] of endpoint.nodeIds.entries()) {
      if (nodeId === 'ns=2;s=Box/Status') continue
      assembler.accept(nodeId, index === 0 ? 1000 : 0, 'Good', 900 + index)
    }

    assembler.accept('ns=2;s=Box/Status', 3, 'Good', 1000)

    expect(validateStateBatchV1(batches.at(-1)).values.map(({ mappingId }) => mappingId))
      .toEqual(['mapping-live-status'])

    assembler.accept('ns=2;s=Box/Status', 4, 'Good', 1_100)
    expect(validateStateBatchV1(batches.at(-1)).values.map(({ mappingId }) => mappingId))
      .toEqual(['mapping-live-status'])

    assembler.accept('ns=2;s=Box/X', 2_000, 'Good', 1_200)
    expect(validateStateBatchV1(batches.at(-1)).values.map(({ mappingId }) => mappingId))
      .toEqual(['mapping-live-pose'])
  })

  it('subscribes to a local OPC UA server and emits a StateBatch without waiting for every leaf to change again', async () => {
    const server = new OPCUAServer({
      host: '127.0.0.1',
      hostname: '127.0.0.1',
      port: 0,
      resourcePath: '',
      allowAnonymous: true,
      securityModes: [MessageSecurityMode.None],
      securityPolicies: [SecurityPolicy.None],
    })
    const batches: unknown[] = []
    let adapter: ReturnType<typeof createOpcUaClientAdapterV1> | null = null
    try {
      await server.initialize()
      const addressSpace = server.engine.addressSpace
      expect(addressSpace).not.toBeNull()
      const namespace = addressSpace!.registerNamespace('urn:test:opcua-client-adapter')
      const variables = new Map<string, UAVariable>()
      for (const name of ['X', 'Y', 'Z', 'Roll', 'Pitch', 'Yaw']) {
        variables.set(name, namespace.addVariable({
          organizedBy: addressSpace!.rootFolder.objects,
          browseName: name,
          nodeId: `ns=${namespace.index};s=Box/${name}`,
          dataType: DataType.Double,
          value: new Variant({ dataType: DataType.Double, value: 0 }),
        }))
      }
      await server.start()
      const endpointUrl = server.getEndpointUrl()
      const project = projectWithEntityPoseMapping()
      const liveProject = {
        ...project,
        opcUa: {
          ...project.opcUa,
          endpoints: project.opcUa.endpoints.map((endpoint) => ({ ...endpoint, endpointUrl })),
          mappings: project.opcUa.mappings.map((mapping) => ({
            ...mapping,
            leaves: mapping.leaves.map((leaf) => ({
              ...leaf,
              nodeId: leaf.nodeId.replace(/^ns=2/u, `ns=${namespace.index}`),
            })),
          })),
        },
      }
      adapter = createOpcUaClientAdapterV1(liveProject, {
        gatewayId: 'gateway-local',
        originId: 'gateway-local:client',
        configRevision: REVISION,
        publish: (batch) => { batches.push(batch) },
      })
      await adapter.start()
      await eventually(() => adapter!.status()[0]?.phase === 'connected')
      for (const [index, name] of ['X', 'Y', 'Z', 'Roll', 'Pitch', 'Yaw'].entries()) {
        variables.get(name)!.setValueFromSource(
          { dataType: DataType.Double, value: index === 0 ? 1000 : 0 },
          StatusCodes.Good,
          new Date(1000 + index),
        )
      }
      await eventually(() => batches.length >= 1)
      variables.get('X')!.setValueFromSource(
        { dataType: DataType.Double, value: 2000 },
        StatusCodes.Good,
        new Date(2000),
      )
      await eventually(() => {
        const latest = batches.at(-1)
        if (latest === undefined) return false
        const value = validateStateBatchV1(latest).values[0]!.value as { positionM?: readonly number[] }
        return value.positionM?.[0] === 2
      })
      expect(validateStateBatchV1(batches.at(-1)).values[0]!.value).toMatchObject({
        positionM: [2, 0, 0],
      })
    } finally {
      await adapter?.stop()
      await server.shutdown(0)
    }
  }, 15_000)
})
