// @vitest-environment node

import {
  DataType,
  MessageSecurityMode,
  OPCUAServer,
  SecurityPolicy,
  StatusCodes,
  Variant,
  VariantArrayType,
} from 'node-opcua'
import { describe, expect, it } from 'vitest'

import {
  canonicalProjectV5Json,
  validateWorkcellProjectV5,
  type OpcUaMappingV5,
  type WorkcellProjectV5,
} from '../../src/core/project-v5/index.js'
import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from '../../src/core/project-v5/test-support.js'
import {
  validateCommandRequestV1,
  type RuntimePublisherMessageV1,
} from '../../src/core/runtime-protocol/v1.js'
import { createObjectRuntimeStateV5 } from '../../src/features/scene/v5/object-runtime-state.js'
import { createRobotJointRuntimeStoreV5 } from '../../src/features/robot/v5/robot-joint-runtime-store.js'
import { createLogicalSignalRuntimeStoreV1 } from '../../src/features/signals/v5/logical-signal-runtime-store.js'
import { createEndpointLifecycleRouterV5 } from '../../src/features/runtime-gateway/v5/endpoint-lifecycle-router.js'
import {
  createOpcUaClientAdapterV1,
  readNormalizedOpcUaClientPublicationV1,
} from './opcua-client-adapter.js'
import { createRuntimeCommandDedupeRegistryV1 } from './runtime-command-dedupe-registry.js'
import { createRuntimeCommandServiceV1 } from './runtime-command-service.js'

const CONFIG_REVISION = 'a'.repeat(64)
const NAMESPACE_URI = 'urn:virtual-plc:job-io'
const GATEWAY_ID = 'gateway-local'

interface PlcValues {
  readonly ready: boolean
  readonly pose: readonly [number, number, number, number, number, number]
  readonly j1: number
}

interface LocalOpcUaServer {
  readonly endpointUrl: string
  readonly port: number
  readonly namespaceIndex: number
  readonly readStart: () => boolean
  readonly startWriteCount: () => number
  publish(values: PlcValues, sourceTimestampMs: number): void
  stop(): Promise<void>
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, milliseconds) })
}

async function eventually(assertion: () => void, timeoutMs = 12_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastFailure: unknown
  while (Date.now() < deadline) {
    try {
      assertion()
      return
    } catch (error) {
      lastFailure = error
      await delay(20)
    }
  }
  throw lastFailure ?? new Error('TEST_EVENTUALLY_TIMEOUT')
}

function endpointPort(endpointUrl: string): number {
  const match = /:(\d+)(?:\/|$)/u.exec(endpointUrl)
  if (match?.[1] === undefined) throw new Error(`TEST_ENDPOINT_PORT_INVALID:${endpointUrl}`)
  return Number(match[1])
}

async function startServerOnce(options: {
  readonly port: number
  readonly namespacesBeforeTarget: number
  readonly initial: PlcValues
}): Promise<LocalOpcUaServer> {
  const server = new OPCUAServer({
    host: '127.0.0.1',
    hostname: '127.0.0.1',
    port: options.port,
    resourcePath: '',
    allowAnonymous: true,
    securityModes: [MessageSecurityMode.None],
    securityPolicies: [SecurityPolicy.None],
  })
  try {
    await server.initialize()
    const addressSpace = server.engine.addressSpace
    if (addressSpace === null) throw new Error('TEST_ADDRESS_SPACE_UNAVAILABLE')
    for (let index = 0; index < options.namespacesBeforeTarget; index += 1) {
      addressSpace.registerNamespace(`urn:virtual-plc:filler:${index}`)
    }
    const namespace = addressSpace.registerNamespace(NAMESPACE_URI)
    let startValue = false
    let writes = 0
    namespace.addVariable({
      organizedBy: addressSpace.rootFolder.objects,
      browseName: 'Start',
      nodeId: `ns=${namespace.index};s=Start`,
      dataType: DataType.Boolean,
      minimumSamplingInterval: 50,
      value: {
        get: () => new Variant({ dataType: DataType.Boolean, value: startValue }),
        set: (variant: Variant) => {
          startValue = variant.value as boolean
          writes += 1
          return StatusCodes.Good
        },
      },
    })
    const ready = namespace.addVariable({
      organizedBy: addressSpace.rootFolder.objects,
      browseName: 'Ready',
      nodeId: `ns=${namespace.index};s=Ready`,
      dataType: DataType.Boolean,
      value: new Variant({ dataType: DataType.Boolean, value: options.initial.ready }),
    })
    const pose = namespace.addVariable({
      organizedBy: addressSpace.rootFolder.objects,
      browseName: 'BoxPose',
      nodeId: `ns=${namespace.index};s=BoxPose`,
      dataType: DataType.Double,
      valueRank: 1,
      arrayDimensions: [6],
      value: new Variant({
        dataType: DataType.Double,
        arrayType: VariantArrayType.Array,
        value: Float64Array.from(options.initial.pose),
      }),
    })
    const j1 = namespace.addVariable({
      organizedBy: addressSpace.rootFolder.objects,
      browseName: 'J1',
      nodeId: `ns=${namespace.index};s=J1`,
      dataType: DataType.Double,
      value: new Variant({ dataType: DataType.Double, value: options.initial.j1 }),
    })
    await server.start()
    let stopped = false
    const endpointUrl = server.getEndpointUrl()
    return Object.freeze({
      endpointUrl,
      port: endpointPort(endpointUrl),
      namespaceIndex: namespace.index,
      readStart: () => startValue,
      startWriteCount: () => writes,
      publish(values: PlcValues, sourceTimestampMs: number): void {
        const sourceTimestamp = new Date(sourceTimestampMs)
        ready.setValueFromSource({ dataType: DataType.Boolean, value: values.ready }, StatusCodes.Good, sourceTimestamp)
        pose.setValueFromSource({
          dataType: DataType.Double,
          arrayType: VariantArrayType.Array,
          value: Float64Array.from(values.pose),
        }, StatusCodes.Good, sourceTimestamp)
        j1.setValueFromSource({ dataType: DataType.Double, value: values.j1 }, StatusCodes.Good, sourceTimestamp)
      },
      async stop(): Promise<void> {
        if (stopped) return
        stopped = true
        await server.shutdown(0)
      },
    })
  } catch (error) {
    await server.shutdown(0).catch(() => undefined)
    throw error
  }
}

async function startLocalOpcUaServer(options: {
  readonly port?: number
  readonly namespacesBeforeTarget?: number
  readonly initial?: PlcValues
} = {}): Promise<LocalOpcUaServer> {
  const requestedPort = options.port ?? 0
  const attempts = requestedPort === 0 ? 1 : 20
  let lastFailure: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await startServerOnce({
        port: requestedPort,
        namespacesBeforeTarget: options.namespacesBeforeTarget ?? 0,
        initial: options.initial ?? { ready: false, pose: [0, 0, 0, 0, 0, 0], j1: 0 },
      })
    } catch (error) {
      lastFailure = error
      if (attempt + 1 < attempts) await delay(25)
    }
  }
  throw lastFailure
}

function readMapping(
  id: string,
  identifier: string,
  leaves: OpcUaMappingV5['leaves'],
  overrides: Partial<Pick<OpcUaMappingV5, 'coherenceGroupId' | 'interpolationMode'>> = {},
): OpcUaMappingV5 {
  return {
    id,
    endpointId: 'plc',
    nodeAddress: { namespaceUri: NAMESPACE_URI, identifierType: 'string', identifier },
    direction: 'read',
    coherenceGroupId: overrides.coherenceGroupId ?? null,
    interpolationMode: overrides.interpolationMode ?? 'none',
    coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
    leaves,
  }
}

function integrationProject(endpointUrl: string): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project.opcUa.endpoints as unknown as WorkcellProjectV5['opcUa']['endpoints'][number][]).splice(0, 1, {
    endpointId: 'plc', name: 'Virtual PLC', endpointUrl, enabled: true,
    publishingIntervalMs: 50, reconnectDelayMs: 25,
  })
  ;(project.logicalSignals as unknown as WorkcellProjectV5['logicalSignals'][number][]).splice(
    0,
    1,
    { id: 'start', name: 'Start', dataType: 'Boolean', direction: 'output', initialValue: false, unit: '', scope: { type: 'project' } },
    { id: 'ready', name: 'Ready', dataType: 'Boolean', direction: 'input', initialValue: false, unit: '', scope: { type: 'project' } },
  )
  ;(project.robots[0] as unknown as { jointSource: `opcua:${string}` }).jointSource = 'opcua:plc'
  ;(project.spatialEntities as unknown as WorkcellProjectV5['spatialEntities'][number][]).push({
    id: 'box', name: 'Box', geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#808080' },
    parentFrameId: 'box-motion', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    visible: true, groupId: null, removable: true, transformOwner: 'opcua:plc',
    numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: false, frameId: null } },
    graspable: false, graspFrames: [],
    movingFrames: [{
      frameId: 'box-motion', name: 'Box motion', parentFrameId: 'world',
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, sourceOwnership: 'opcua:plc',
    }],
  })
  const logicalLeaf = (signalId: string) => ({
    leafPath: [], projectPath: [], projectTarget: { type: 'logical-signal' as const, signalId },
    opcUaDataType: 'Boolean' as const, projectDataType: 'boolean' as const,
    scale: 1, offset: 0, unit: '', required: true,
  })
  const posePaths = [
    ['positionM', 0], ['positionM', 1], ['positionM', 2],
    ['rpyDegrees', 0], ['rpyDegrees', 1], ['rpyDegrees', 2],
  ] as const
  const mappings: OpcUaMappingV5[] = [
    {
      ...readMapping('map-start', 'Start', [logicalLeaf('start')]),
      direction: 'write',
    },
    readMapping('map-ready', 'Ready', [logicalLeaf('ready')]),
    readMapping('map-box-pose', 'BoxPose', posePaths.map((projectPath, index) => ({
      leafPath: [index], projectPath,
      projectTarget: { type: 'entity-frame' as const, entityId: 'box', frameId: 'box-motion' },
      opcUaDataType: 'Double', projectDataType: 'number', scale: 1, offset: 0,
      unit: index < 3 ? 'metre' : 'degree', required: true,
    })), { coherenceGroupId: 'box-pose', interpolationMode: 'shortest-quaternion' }),
    readMapping('map-j1', 'J1', [{
      leafPath: [], projectPath: [], projectTarget: { type: 'robot-joint', robotId: 'robot-1', jointId: 'J1' },
      opcUaDataType: 'Double', projectDataType: 'number', scale: 1, offset: 0, unit: 'degree', required: true,
    }], { interpolationMode: 'revolute-wrapped' }),
  ]
  ;(project.opcUa.mappings as unknown as OpcUaMappingV5[]).splice(0, 1, ...mappings)
  return validateWorkcellProjectV5(project)
}

function commandRequest(
  service: ReturnType<typeof createRuntimeCommandServiceV1>,
  commandId: string,
) {
  const lease = service.lease()
  return validateCommandRequestV1({
    type: 'command-request-v1', protocolVersion: 1, commandId,
    projectId: lease.projectId, configRevision: lease.configRevision,
    leaseGeneration: lease.generation, expiresAt: lease.expiresAt,
    targetId: 'map-start', value: true,
  })
}

describe('real local OPC UA Client write and re-resolution integration', () => {
  it('writes one Boolean through command dedupe, then rejects a fresh command while disconnected', async () => {
    const plc = await startLocalOpcUaServer()
    let adapter: ReturnType<typeof createOpcUaClientAdapterV1> | null = null
    let commandService: ReturnType<typeof createRuntimeCommandServiceV1> | null = null
    try {
      const project = integrationProject(plc.endpointUrl)
      let gatewayNow = 100_000
      const activeAdapter = createOpcUaClientAdapterV1(project, {
        gatewayId: GATEWAY_ID,
        originId: `${GATEWAY_ID}:client`,
        configRevision: CONFIG_REVISION,
        publish: () => undefined,
        nowMs: () => ++gatewayNow,
      })
      adapter = activeAdapter
      const activeCommandService = createRuntimeCommandServiceV1({
        project,
        configRevision: CONFIG_REVISION,
        publisherId: `${GATEWAY_ID}:client-write`,
        generation: 1,
        nowMs: () => ++gatewayNow,
        clientAdapter: activeAdapter,
        dedupe: createRuntimeCommandDedupeRegistryV1(),
      })
      commandService = activeCommandService
      await activeAdapter.start()
      await eventually(() => { expect(activeAdapter.status()[0]?.phase).toBe('connected') })
      const duplicateRequest = commandRequest(activeCommandService, 'same-command')
      const first = await activeCommandService.execute(duplicateRequest)
      const duplicate = await activeCommandService.execute(duplicateRequest)
      expect(first).toEqual(duplicate)
      expect(first).toMatchObject({ acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED' })
      expect(plc.readStart()).toBe(true)
      expect(plc.startWriteCount()).toBe(1)

      await plc.stop()
      await eventually(() => { expect(activeAdapter.status()[0]?.phase).toBe('reconnecting') })
      await expect(activeCommandService.execute(commandRequest(activeCommandService, 'after-disconnect'))).resolves.toMatchObject({
        acknowledgement: 'REJECTED', executionState: 'FAILED', failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED',
      })
      expect(plc.startWriteCount()).toBe(1)
    } finally {
      try {
        commandService?.close()
      } finally {
        try {
          if (adapter !== null) await adapter.stop()
        } finally {
          await plc.stop()
        }
      }
    }
  }, 30_000)

  it('re-resolves a persisted Namespace URI after same-port restart and accepts lower source timestamps', async () => {
    const first = await startLocalOpcUaServer({
      initial: { ready: false, pose: [0, 0, 0, 0, 0, 0], j1: 0 },
    })
    let adapter: ReturnType<typeof createOpcUaClientAdapterV1> | null = null
    let second: LocalOpcUaServer | null = null
    try {
      const project = integrationProject(first.endpointUrl)
      const canonicalBefore = canonicalProjectV5Json(project)
      const nodeAddressesBefore = JSON.stringify(project.opcUa.mappings.map(({ nodeAddress }) => nodeAddress))
      const signals = createLogicalSignalRuntimeStoreV1(project, CONFIG_REVISION)
      const objects = createObjectRuntimeStateV5(project, CONFIG_REVISION)
      const robots = createRobotJointRuntimeStoreV5(project, CONFIG_REVISION)
      let receiptTimestampMs = 200_000
      const router = createEndpointLifecycleRouterV5({
        readActiveContext: () => ({ project, configRevision: CONFIG_REVISION, gatewayId: GATEWAY_ID }),
        targets: [signals.getState(), objects, robots.getState()],
      })
      const route = (message: RuntimePublisherMessageV1): void => {
        receiptTimestampMs += 1
        if (message.type === 'state-batch-v1') {
          signals.getState().ingest(message, receiptTimestampMs)
          objects.ingest(message, receiptTimestampMs)
          robots.getState().ingest(message, receiptTimestampMs)
        } else {
          router.ingest(message, receiptTimestampMs)
        }
      }
      let gatewayNow = 300_000
      const activeAdapter = createOpcUaClientAdapterV1(project, {
        gatewayId: GATEWAY_ID,
        originId: `${GATEWAY_ID}:client`,
        configRevision: CONFIG_REVISION,
        publish: (publication) => { route(readNormalizedOpcUaClientPublicationV1(publication)) },
        nowMs: () => ++gatewayNow,
      })
      adapter = activeAdapter
      const snapshot = () => ({
        signal: signals.getState().read('ready'),
        object: objects.sampleFrame('box', 'box-motion', receiptTimestampMs + 100),
        joint: robots.getState().readRobot('robot-1'),
      })
      expect(first.namespaceIndex).toBe(2)
      await activeAdapter.start()
      await eventually(() => { expect(activeAdapter.status()[0]?.phase).toBe('connected') })
      first.publish({ ready: true, pose: [0.2, 0, 0, 0, 0, 0], j1: 10 }, 80_000)
      await eventually(() => {
        const value = snapshot()
        expect(value.signal).toMatchObject({ value: true, quality: 'GOOD' })
        expect(value.object).toMatchObject({ worldPose: { positionM: [0.2, 0, 0] }, quality: 'GOOD' })
        expect(value.joint).toMatchObject({ jointValues: { J1: 10 }, quality: 'GOOD' })
      })

      await first.stop()
      await eventually(() => {
        const value = snapshot()
        expect(value.signal).toMatchObject({ value: true, quality: 'STALE', statusCode: 'BadNoCommunication' })
        expect(value.object).toMatchObject({ worldPose: { positionM: [0.2, 0, 0] }, quality: 'STALE', statusCode: 'BadNoCommunication' })
        expect(value.joint).toMatchObject({ jointValues: { J1: 10 }, quality: 'STALE', statusCode: 'BadNoCommunication' })
      })

      second = await startLocalOpcUaServer({
        port: first.port,
        namespacesBeforeTarget: 1,
        initial: { ready: false, pose: [0.4, 0, 0, 0, 0, 0], j1: 20 },
      })
      expect(second.namespaceIndex).toBe(3)
      await eventually(() => { expect(activeAdapter.status()[0]?.phase).toBe('connected') })
      second.publish({ ready: true, pose: [0.3, 0, 0, 0, 0, 0], j1: 15 }, 900)
      await eventually(() => {
        const value = snapshot()
        expect(value.signal).toMatchObject({ value: true, quality: 'GOOD', sourceTimestampMs: 900 })
        expect(value.object).toMatchObject({ worldPose: { positionM: [0.3, 0, 0] }, quality: 'GOOD', sourceTimestampMs: 900 })
        expect(value.joint).toMatchObject({ jointValues: { J1: 15 }, quality: 'GOOD', sourceTimestampMs: 900 })
      })
      second.publish({ ready: false, pose: [0.4, 0, 0, 0, 0, 0], j1: 20 }, 1_000)
      await eventually(() => {
        const value = snapshot()
        expect(value.signal).toMatchObject({ value: false, quality: 'GOOD', sourceTimestampMs: 1_000 })
        expect(value.object).toMatchObject({ worldPose: { positionM: [0.4, 0, 0] }, quality: 'GOOD', sourceTimestampMs: 1_000 })
        expect(value.joint).toMatchObject({ jointValues: { J1: 20 }, quality: 'GOOD', sourceTimestampMs: 1_000 })
      })
      expect(canonicalProjectV5Json(project)).toBe(canonicalBefore)
      expect(JSON.stringify(project.opcUa.mappings.map(({ nodeAddress }) => nodeAddress))).toBe(nodeAddressesBefore)
    } finally {
      try {
        if (adapter !== null) await adapter.stop()
      } finally {
        try {
          await second?.stop()
        } finally {
          await first.stop()
        }
      }
    }
  }, 45_000)
})
