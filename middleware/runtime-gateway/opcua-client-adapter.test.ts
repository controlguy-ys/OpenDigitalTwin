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
import { describe, expect, it } from 'vitest'

import { validateStateBatchV1 } from '../../src/core/runtime-protocol/v1.js'
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

function projectWithEntityPoseMapping() {
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
      value: { positionM: [0, 0.5, 0.6] },
    })
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
        publish: (batch) => { batches.push(batch) },
      })
      await adapter.start()
      await eventually(() => adapter!.status()[0]?.connected === true)
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
