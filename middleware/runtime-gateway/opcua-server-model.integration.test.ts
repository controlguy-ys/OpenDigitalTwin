// @vitest-environment node

import {
  AttributeIds,
  BrowseDirection,
  DataType,
  MessageSecurityMode,
  OPCUAClient,
  OPCUACertificateManager,
  SecurityPolicy,
  StatusCodes,
  Variant,
  standardUnits,
  type ClientSession,
  type ReferenceDescription,
  type StatusCode,
} from 'node-opcua'
import { mkdtemp, rm } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  configRevisionForProjectV5,
  validateWorkcellProjectV5,
  type RigidTransformV5,
  type RobotDefinitionV5,
  type WorkcellProjectV5,
} from '../../src/core/project-v5/index.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../src/core/project-v5/test-support.js'
import {
  validateCommandResultV1,
  validateRuntimePublisherLeaseV1,
  type CommandBatchV1,
  type RuntimePublisherLeaseV1,
} from '../../src/core/runtime-protocol/v1.js'
import { createRuntimeGatewayCommandOwnerV5 } from '../../src/features/runtime-gateway/v5/runtime-gateway-command-owner.js'
import type { RuntimeGatewayDeploymentConfigV1 } from './deployment-config.js'
import { createRuntimeGatewayEntrypointService } from './main.js'
import { createOpcUaServerAdapterV1 } from './opcua-server-adapter.js'
import {
  OPENWEB_INSTANCES_NAMESPACE_URI_V1,
  OPENWEB_MODEL_NAMESPACE_URI_V1,
  instantiateOpcUaOpenWebModelV1,
  type OpcUaOpenWebModelV1,
} from './opcua-openweb-model.js'
import { OPC_UA_ROBOTICS_INSTANCES_NAMESPACE_URI_V1 } from './opcua-robotics-model.js'

const STANDARD_URI = 'http://opcfoundation.org/UA/'
const DI_URI = 'http://opcfoundation.org/UA/DI/'
const IA_URI = 'http://opcfoundation.org/UA/IA/'
const ROBOTICS_URI = 'http://opcfoundation.org/UA/Robotics/'
const ROBOTICS_TYPE_NODE_IDS = Object.freeze({
  MotionDeviceSystemType: 1002,
  ControllerType: 1003,
  MotionDeviceType: 1004,
  AxisType: 16601,
  PowerTrainType: 16794,
  Controls: 4002,
  Moves: 18178,
})
const COMMAND_BATCH_DELIVERY_TIMEOUT_MS = 10_000
const COMMAND_BATCH_QUIESCENCE_TIMEOUT_MS = 750
const COMMAND_BATCH_POLL_INTERVAL_MS = 25
const GATEWAY_PORT_ACTIVATION_ATTEMPTS = 4
const GATEWAY_ACTIVATION_ERROR_BODY_MAX_LENGTH = 4_096

let testPkiRoot = ''
let clientPkiSequence = 0

beforeEach(async () => {
  testPkiRoot = await mkdtemp(join(tmpdir(), `robot-sim-opcua-server-model-${process.pid}-`))
  clientPkiSequence = 0
})

afterEach(async () => {
  if (testPkiRoot !== '') {
    await cleanupAll({
      label: 'Test PKI root removal',
      cleanup: () => rm(testPkiRoot, { recursive: true, force: true }),
    })
  }
  testPkiRoot = ''
})
const IDENTITY_POSE: RigidTransformV5 = Object.freeze({
  positionM: [0, 0, 0] as const,
  quaternion: [0, 0, 0, 1] as const,
})

async function ephemeralPort(excluded: ReadonlySet<number> = new Set()): Promise<number> {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Expected an ephemeral TCP address')
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)))
    if (!excluded.has(address.port)) return address.port
  }
  throw new Error('Could not allocate a distinct ephemeral TCP port')
}

async function distinctEphemeralPorts(count: number): Promise<readonly number[]> {
  const ports = new Set<number>()
  while (ports.size < count) ports.add(await ephemeralPort(ports))
  return [...ports]
}

function projectWithJointCount(jointCount: number): WorkcellProjectV5 {
  const source = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  const originalDefinition = source.robotDefinitions[0]!
  const joints = Array.from({ length: jointCount }, (_, index) => ({
    id: `J${index + 1}`,
    type: index === jointCount - 1 ? 'prismatic' as const : 'revolute' as const,
    parentLinkId: `L${index}`,
    childLinkId: `L${index + 1}`,
    origin: IDENTITY_POSE,
    axis: [0, 0, 1] as const,
    min: index === jointCount - 1 ? -0.2 : -270,
    max: index === jointCount - 1 ? 1.5 : 270,
    home: 0,
    zeroOffset: 0,
    direction: 1 as const,
    maximumVelocity: 90,
  }))
  const definition: RobotDefinitionV5 = {
    ...originalDefinition,
    links: Array.from({ length: jointCount + 1 }, (_, index) => index === 0
      ? originalDefinition.links[0]!
      : { id: `L${index}`, name: `Link ${index}`, geometryOccurrences: [] }),
    joints,
  }
  return validateWorkcellProjectV5({
    ...source,
    projectId: `server-model-${jointCount}`,
    revisionId: `server-model-revision-${jointCount}`,
    robotDefinitions: [definition],
    robots: [{
      ...source.robots[0]!,
      initialJointValues: Object.fromEntries(joints.map((joint) => [
        joint.id,
        joint.type === 'prismatic' ? 0.125 : 12.5,
      ])),
    }],
    jobs: [],
    opcUa: { ...source.opcUa, mode: 'server', mappings: [] },
  })
}

function commandProject(): WorkcellProjectV5 {
  const source = projectWithJointCount(2)
  return validateWorkcellProjectV5({
    ...source,
    projectId: 'server-model-command',
    revisionId: 'server-model-command-revision',
    spatialEntities: [...source.spatialEntities, {
      id: 'box', name: 'Box', geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#808080' },
      parentFrameId: 'mcp', localPose: IDENTITY_POSE, visible: true, groupId: null, removable: true,
      transformOwner: 'simulation', numericStatus: { value: 0, sourceOwnership: 'simulation', overlay: { visible: false, frameId: null } },
      graspable: false, graspFrames: [], movingFrames: [],
    }],
  })
}

function createClient(applicationName: string): OPCUAClient {
  const sequence = clientPkiSequence++
  return OPCUAClient.create({
    applicationName, endpointMustExist: true,
    securityMode: MessageSecurityMode.None, securityPolicy: SecurityPolicy.None,
    connectionStrategy: { maxRetry: 0 },
    clientCertificateManager: new OPCUACertificateManager({ rootFolder: join(testPkiRoot, `client-${sequence}`), name: 'client-pki', disableFileWatchers: true }),
  })
}

async function openSession(endpointUrl: string): Promise<{ readonly client: OPCUAClient; readonly session: ClientSession }> {
  const client = createClient('RobotSim real-server integration test')
  await client.connect(endpointUrl)
  return { client, session: await client.createSession() }
}

async function closeSession(value: { readonly client: OPCUAClient; readonly session: ClientSession } | null): Promise<void> {
  if (value === null) return
  await cleanupAll(
    { label: 'OPC UA Session close', cleanup: () => value.session.close() },
    { label: 'OPC UA Client disconnect', cleanup: () => value.client.disconnect() },
  )
}

type CleanupTask = Readonly<{ label: string; cleanup: () => Promise<void> | void }>

async function cleanupAll(...tasks: readonly CleanupTask[]): Promise<void> {
  const failures: unknown[] = []
  for (const task of tasks) {
    try {
      await task.cleanup()
    } catch (error) {
      failures.push(new Error(`${task.label}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }))
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'OPC UA integration cleanup failed')
}

async function namespaceUris(session: ClientSession): Promise<readonly string[]> {
  const dataValue = await session.read({ nodeId: 'i=2255', attributeId: AttributeIds.Value })
  if (!Array.isArray(dataValue.value.value) || !dataValue.value.value.every((value) => typeof value === 'string')) {
    throw new Error('Expected the OPC UA NamespaceArray to contain strings')
  }
  return dataValue.value.value
}

function namespaceIndex(uris: readonly string[], uri: string): number {
  const index = uris.indexOf(uri)
  if (index < 0) throw new Error(`Missing OPC UA namespace ${uri}`)
  return index
}

async function browseGood(
  session: ClientSession,
  nodeId: string,
  browseDirection: BrowseDirection,
  referenceTypeId?: string,
  includeSubtypes = false,
): Promise<ReferenceDescription[]> {
  const browse = await session.browse({
    nodeId,
    browseDirection,
    ...(referenceTypeId === undefined ? {} : { referenceTypeId }),
    includeSubtypes,
    resultMask: 0x3f,
  })
  if (!browse.statusCode.isGood()) throw new Error(`OPC UA browse failed for ${nodeId}: ${browse.statusCode.toString()}`)
  return browse.references ?? []
}

async function typeDefinitionNodeId(session: ClientSession, nodeId: string): Promise<string> {
  const references = await browseGood(session, nodeId, BrowseDirection.Forward, 'i=40')
  if (references.length !== 1) throw new Error(`Expected one TypeDefinition for ${nodeId}, received ${references.length}`)
  return references[0]!.nodeId.toString()
}

async function propertyNode(session: ClientSession, parentNodeId: string, browseName: string): Promise<string> {
  const property = (await browseGood(session, parentNodeId, BrowseDirection.Forward, 'i=46'))
    .find((reference) => reference.browseName.name === browseName)
  if (property === undefined) throw new Error(`Missing OPC UA property ${browseName} under ${parentNodeId}`)
  return property.nodeId.toString()
}

async function componentNode(session: ClientSession, parentNodeId: string, browseName: string): Promise<string> {
  const component = (await browseGood(session, parentNodeId, BrowseDirection.Forward, 'i=47'))
    .find((reference) => reference.browseName.name === browseName)
  if (component === undefined) throw new Error(`Missing OPC UA component ${browseName} under ${parentNodeId}`)
  return component.nodeId.toString()
}

async function browseProductNodeIds(session: ClientSession, rootNodeId: string): Promise<readonly string[]> {
  const seen = new Set<string>()
  const pending = [rootNodeId]
  while (pending.length > 0) {
    const nodeId = pending.pop()!
    if (seen.has(nodeId)) continue
    seen.add(nodeId)
    for (const reference of await browseGood(session, nodeId, BrowseDirection.Forward, 'HierarchicalReferences', true)) {
      pending.push(reference.nodeId.toString())
    }
  }
  return [...seen]
}

async function discoverProductRootsFromObjects(
  session: ClientSession,
  projectId: string,
): Promise<Readonly<{ openWebRootNodeId: string; productRootNodeId: string }>> {
  const openWeb = (await browseGood(session, 'i=85', BrowseDirection.Forward, 'i=35', true))
    .filter((reference) => reference.browseName.name === 'OpenWebDigitalTwin')
  if (openWeb.length !== 1) throw new Error(`Expected exactly one OpenWebDigitalTwin under Objects, received ${openWeb.length}`)
  const projects = (await browseGood(session, openWeb[0]!.nodeId.toString(), BrowseDirection.Forward, 'i=47'))
    .filter((reference) => reference.browseName.name === 'Projects')
  if (projects.length !== 1) throw new Error(`Expected exactly one Projects node, received ${projects.length}`)
  const project = (await browseGood(session, projects[0]!.nodeId.toString(), BrowseDirection.Forward, 'i=47'))
    .filter((reference) => reference.browseName.name === projectId)
  if (project.length !== 1) throw new Error(`Expected exactly one product Project ${projectId}, received ${project.length}`)
  return Object.freeze({
    openWebRootNodeId: openWeb[0]!.nodeId.toString(),
    productRootNodeId: project[0]!.nodeId.toString(),
  })
}

async function write(session: ClientSession, nodeId: string, dataType: DataType, value: unknown): Promise<StatusCode> {
  return session.write({ nodeId, attributeId: AttributeIds.Value, value: { value: new Variant({ dataType, value }) } })
}

async function readValue(session: ClientSession, nodeId: string): Promise<unknown> {
  const value = await session.read({ nodeId, attributeId: AttributeIds.Value })
  if (!value.statusCode.isGood()) throw new Error(`Bad OPC UA read ${value.statusCode.toString()}`)
  return value.value.value
}

function commandPath(instanceNamespaceIndex: number, project: WorkcellProjectV5, requestId: string, field: string): string {
  return `ns=${instanceNamespaceIndex};s=OpenWebDigitalTwin/Projects/${project.projectId}/Result/${requestId}/${field}`
}

function objectCommandPath(instanceNamespaceIndex: number, project: WorkcellProjectV5, field: string): string {
  return `ns=${instanceNamespaceIndex};s=OpenWebDigitalTwin/Projects/${project.projectId}/Command/SceneObjects/box/${field}`
}

async function openWebSocket(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/runtime/ws`)
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  // This black-box harness intentionally keeps a persistent batch recorder plus
  // short-lived lease/result waiters on one socket.
  socket.setMaxListeners(0)
  return socket
}

async function nextMessage(
  socket: WebSocket,
  expected: string | ((value: Record<string, unknown>) => boolean),
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  const expectedLabel = typeof expected === 'string' ? expected : 'matching WebSocket message'
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${expectedLabel}`)) }, timeoutMs)
    const onError = (error: Error) => { cleanup(); reject(error) }
    const onMessage = (data: WebSocket.RawData) => {
      const value: unknown = JSON.parse(data.toString())
      if (value === null || typeof value !== 'object') return
      const record = value as Record<string, unknown>
      if (typeof expected === 'string' ? record.type !== expected : !expected(record)) return
      cleanup(); resolve(record)
    }
    const cleanup = () => { clearTimeout(timeout); socket.off('error', onError); socket.off('message', onMessage) }
    socket.on('error', onError); socket.on('message', onMessage)
  })
}

function sleep(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs))
}

interface CommandBatchRecorder {
  readonly batches: CommandBatchV1[]
  dispose(): void
}

function isCommandBatch(value: unknown): value is CommandBatchV1 {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as { readonly type?: unknown }).type === 'command-batch-v1'
}

function recordCommandBatches(socket: WebSocket): CommandBatchRecorder {
  const batches: CommandBatchV1[] = []
  const onMessage = (data: WebSocket.RawData) => {
    const value: unknown = JSON.parse(data.toString())
    if (value !== null && typeof value === 'object' && isCommandBatch(value as Record<string, unknown>)) {
      batches.push(value as CommandBatchV1)
    }
  }
  socket.on('message', onMessage)
  return { batches, dispose: () => socket.off('message', onMessage) }
}

async function expectStableBatchCount(recorder: CommandBatchRecorder, expected: number): Promise<void> {
  const deliveryDeadline = Date.now() + COMMAND_BATCH_DELIVERY_TIMEOUT_MS
  while (recorder.batches.length < expected && Date.now() < deliveryDeadline) {
    await sleep(COMMAND_BATCH_POLL_INTERVAL_MS)
  }
  expect(recorder.batches).toHaveLength(expected)
  const quietDeadline = Date.now() + COMMAND_BATCH_QUIESCENCE_TIMEOUT_MS
  while (Date.now() < quietDeadline) {
    expect(recorder.batches).toHaveLength(expected)
    await sleep(Math.min(COMMAND_BATCH_POLL_INTERVAL_MS, quietDeadline - Date.now()))
  }
  expect(recorder.batches).toHaveLength(expected)
}

async function closeWebSocket(socket: WebSocket | null): Promise<void> {
  if (socket === null || socket.readyState === WebSocket.CLOSED) return
  await new Promise<void>((resolve, reject) => {
    const onClose = () => { socket.off('error', onError); resolve() }
    const onError = (error: Error) => { socket.off('close', onClose); reject(error) }
    socket.once('close', onClose)
    socket.once('error', onError)
    socket.close()
  })
}

function isAddressInUse(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const candidate = error as Readonly<{ code?: unknown; message?: unknown }>
  return candidate.code === 'EADDRINUSE'
    || (typeof candidate.message === 'string' && /EADDRINUSE/u.test(candidate.message))
}

async function gatewayActivationError(response: Response): Promise<Error> {
  let responseText = ''
  try {
    responseText = await response.text()
  } catch (error) {
    responseText = `Unable to read Gateway activation response: ${error instanceof Error ? error.message : String(error)}`
  }
  const boundedResponseText = responseText.length <= GATEWAY_ACTIVATION_ERROR_BODY_MAX_LENGTH
    ? responseText
    : `${responseText.slice(0, GATEWAY_ACTIVATION_ERROR_BODY_MAX_LENGTH)}…[truncated]`
  return new Error(
    `Gateway project activation failed with HTTP ${response.status}${boundedResponseText.length === 0 ? '' : `: ${boundedResponseText}`}`,
  )
}

async function startActivatedGateway(project: WorkcellProjectV5): Promise<Readonly<{
  gateway: ReturnType<typeof createRuntimeGatewayEntrypointService>
  httpPort: number
}>> {
  let lastAddressInUse: unknown = null
  for (let attempt = 1; attempt <= GATEWAY_PORT_ACTIVATION_ATTEMPTS; attempt += 1) {
    const ports = await distinctEphemeralPorts(2)
    const httpPort = ports[0]
    const opcUaPort = ports[1]
    if (httpPort === undefined || opcUaPort === undefined) throw new Error('Expected two distinct ephemeral ports')
    const config: RuntimeGatewayDeploymentConfigV1 = Object.freeze({
      gatewayId: 'server-model-integration', runtimeKind: 'native', host: '127.0.0.1', httpPort,
      opcUaAdvertisedHost: '127.0.0.1', opcUaAdvertisedPort: opcUaPort, opcUaPort,
    })
    const gateway = createRuntimeGatewayEntrypointService(config, { pkiRootDir: testPkiRoot })
    try {
      await gateway.start()
      const activation = await fetch(`http://127.0.0.1:${httpPort}/runtime/project`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(project),
      })
      if (activation.status !== 200) throw await gatewayActivationError(activation)
      return Object.freeze({ gateway, httpPort })
    } catch (error) {
      try {
        await cleanupAll({ label: `Gateway stop after port activation attempt ${attempt}`, cleanup: () => gateway.stop() })
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Gateway port activation failed and cleanup failed')
      }
      if (!isAddressInUse(error)) throw error
      lastAddressInUse = error
    }
  }
  throw new Error(`Gateway ports remained unavailable after ${GATEWAY_PORT_ACTIVATION_ATTEMPTS} attempts`, { cause: lastAddressInUse })
}

async function waitForResult(session: ClientSession, nodeId: string, expected: unknown, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await readValue(session, nodeId) === expected) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for product Result ${String(expected)}`)
}

describe('OPC UA server model real-client integration', () => {
  it('recognizes EADDRINUSE preserved from a Gateway activation response body', async () => {
    const addressInUse = await gatewayActivationError(new Response(
      JSON.stringify({ error: 'OPC_UA_SERVER_START_FAILED: listen EADDRINUSE 127.0.0.1:4841' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    ))
    const unavailable = await gatewayActivationError(new Response('Gateway project validation failed', { status: 503 }))

    expect(isAddressInUse(addressInUse)).toBe(true)
    expect(isAddressInUse(unavailable)).toBe(false)
  })

  it.each([2, 7, 16])('loads official NodeSets and exposes the standard %i-Axis model through a real Client', async (jointCount) => {
    const project = projectWithJointCount(jointCount)
    const capturedOpenWebModel: { model: OpcUaOpenWebModelV1 | null } = { model: null }
    const adapter = createOpcUaServerAdapterV1(project, {
      host: '127.0.0.1', advertisedHost: '127.0.0.1', port: 0, advertisedPort: 0,
      pkiRootDir: testPkiRoot, configRevision: 'a'.repeat(64),
      openWebModelFactory: (options) => {
        const model = instantiateOpcUaOpenWebModelV1(options)
        capturedOpenWebModel.model = model
        return model
      },
    })
    let connection: Awaited<ReturnType<typeof openSession>> | null = null
    try {
      await adapter.start()
      connection = await openSession(adapter.status().endpointUrl!)
      const session = connection.session
      const uris = await namespaceUris(connection.session)
      expect(uris).toEqual(expect.arrayContaining([STANDARD_URI, DI_URI, IA_URI, ROBOTICS_URI]))
      const instances = namespaceIndex(uris, OPC_UA_ROBOTICS_INSTANCES_NAMESPACE_URI_V1)
      const robotics = namespaceIndex(uris, ROBOTICS_URI)
      const root = `ns=${instances};s=Robotics/${project.projectId}/MotionDeviceSystem`
      const device = `ns=${instances};s=Robotics/${project.projectId}/MotionDeviceSystem/MotionDevices/robot-1`
      const controller = `ns=${instances};s=Robotics/${project.projectId}/MotionDeviceSystem/Controllers/controller-1`
      const powerTrain = `ns=${instances};s=Robotics/${project.projectId}/MotionDeviceSystem/MotionDevices/robot-1/PowerTrains/robot-1/J1/power-train`
      expect(await typeDefinitionNodeId(connection.session, root)).toBe(`ns=${robotics};i=${ROBOTICS_TYPE_NODE_IDS.MotionDeviceSystemType}`)
      expect(await typeDefinitionNodeId(connection.session, device)).toBe(`ns=${robotics};i=${ROBOTICS_TYPE_NODE_IDS.MotionDeviceType}`)
      expect(await typeDefinitionNodeId(connection.session, controller)).toBe(`ns=${robotics};i=${ROBOTICS_TYPE_NODE_IDS.ControllerType}`)
      expect(await typeDefinitionNodeId(connection.session, powerTrain)).toBe(`ns=${robotics};i=${ROBOTICS_TYPE_NODE_IDS.PowerTrainType}`)
      expect(await typeDefinitionNodeId(connection.session, `${device}/Axes/J1`)).toBe(`ns=${robotics};i=${ROBOTICS_TYPE_NODE_IDS.AxisType}`)
      const controls = await browseGood(connection.session, controller, BrowseDirection.Forward, `ns=${robotics};i=${ROBOTICS_TYPE_NODE_IDS.Controls}`)
      expect(controls).toHaveLength(1)
      expect(controls[0]!.isForward).toBe(true)
      expect(controls[0]!.referenceTypeId.toString()).toBe(`ns=${robotics};i=${ROBOTICS_TYPE_NODE_IDS.Controls}`)
      expect(controls[0]!.nodeId.toString()).toBe(device)
      const moves = await browseGood(connection.session, powerTrain, BrowseDirection.Forward, `ns=${robotics};i=${ROBOTICS_TYPE_NODE_IDS.Moves}`)
      expect(moves).toHaveLength(1)
      expect(moves[0]!.isForward).toBe(true)
      expect(moves[0]!.referenceTypeId.toString()).toBe(`ns=${robotics};i=${ROBOTICS_TYPE_NODE_IDS.Moves}`)
      expect(moves[0]!.nodeId.toString()).toBe(`${device}/Axes/J1`)
      const axisNodeIds = Array.from({ length: jointCount }, (_, index) => `${device}/Axes/J${index + 1}`)
      const axesFolder = await componentNode(connection.session, device, 'Axes')
      const axisChildren = await browseGood(connection.session, axesFolder, BrowseDirection.Forward, 'i=47')
      expect(axisChildren).toHaveLength(jointCount)
      expect(axisChildren.map((reference) => reference.browseName.name).sort()).toEqual(
        Array.from({ length: jointCount }, (_, index) => `J${index + 1}`).sort(),
      )
      expect(axisChildren.map((reference) => reference.nodeId.toString()).sort()).toEqual(axisNodeIds.sort())
      await expect(Promise.all(axisNodeIds.map((nodeId) => typeDefinitionNodeId(session, nodeId))))
        .resolves.toEqual(Array.from({ length: jointCount }, () => `ns=${robotics};i=${ROBOTICS_TYPE_NODE_IDS.AxisType}`))
      const absentAxis = await connection.session.read({ nodeId: `${device}/Axes/J${jointCount + 1}`, attributeId: AttributeIds.NodeClass })
      expect(absentAxis.statusCode.equals(StatusCodes.BadNodeIdUnknown)).toBe(true)
      const productRoots = await discoverProductRootsFromObjects(connection.session, project.projectId)
      expect(productRoots.productRootNodeId).toBe(adapter.status().productRootNodeId)
      const productIds = await browseProductNodeIds(connection.session, productRoots.openWebRootNodeId)
      expect(productIds).not.toHaveLength(0)
      if (capturedOpenWebModel.model === null) throw new Error('Expected the OpenWeb model factory to capture the live model instance')
      const liveProductNodeIds = capturedOpenWebModel.model.productNodeIds()
      expect([...productIds].sort()).toEqual(liveProductNodeIds.map(({ nodeId }) => nodeId).sort())
      expect(liveProductNodeIds.every(({ nodeId, namespaceUri }) => {
        const match = /^ns=(\d+);/u.exec(nodeId)
        return match !== null && uris[Number(match[1])] === namespaceUri
      })).toBe(true)
      expect(productIds.every((nodeId) => {
        const match = /^ns=(\d+);/u.exec(nodeId)
        return match !== null && [instances, namespaceIndex(uris, OPENWEB_MODEL_NAMESPACE_URI_V1), namespaceIndex(uris, OPENWEB_INSTANCES_NAMESPACE_URI_V1)].includes(Number(match[1]))
      })).toBe(true)
      expect(robotics).toBeGreaterThan(0)
    } finally {
      await cleanupAll(
        { label: 'OPC UA Client connection cleanup', cleanup: () => closeSession(connection) },
        { label: 'OPC UA Server adapter stop', cleanup: () => adapter.stop() },
      )
    }
  }, 45_000)

  it('publishes degree/millimetre Actuals and rejects a real Client write', async () => {
    const adapter = createOpcUaServerAdapterV1(projectWithJointCount(2), {
      host: '127.0.0.1', advertisedHost: '127.0.0.1', port: 0, advertisedPort: 0,
      pkiRootDir: testPkiRoot, configRevision: 'b'.repeat(64),
    })
    let connection: Awaited<ReturnType<typeof openSession>> | null = null
    try {
      await adapter.start(); connection = await openSession(adapter.status().endpointUrl!)
      const [j1, j2] = [adapter.status().nodeIds['robot-1']!.J1!, adapter.status().nodeIds['robot-1']!.J2!]
      const [j1Eu, j2Eu] = await Promise.all([propertyNode(connection.session, j1, 'EngineeringUnits'), propertyNode(connection.session, j2, 'EngineeringUnits')])
      const [j1Range, j2Range] = await Promise.all([propertyNode(connection.session, j1, 'EURange'), propertyNode(connection.session, j2, 'EURange')])
      expect(await readValue(connection.session, j1)).toBe(12.5)
      expect(await readValue(connection.session, j2)).toBe(125)
      expect(await readValue(connection.session, j1Eu)).toMatchObject({ unitId: standardUnits.degree.unitId })
      expect(await readValue(connection.session, j2Eu)).toMatchObject({ unitId: standardUnits.millimetre.unitId })
      expect(await readValue(connection.session, j1Range)).toMatchObject({ low: -270, high: 270 })
      expect(await readValue(connection.session, j2Range)).toMatchObject({ low: -200, high: 1_500 })
      expect(await write(connection.session, j1, DataType.Double, 99)).toBe(StatusCodes.BadNotWritable)
    } finally {
      await cleanupAll(
        { label: 'OPC UA Client connection cleanup', cleanup: () => closeSession(connection) },
        { label: 'OPC UA Server adapter stop', cleanup: () => adapter.stop() },
      )
    }
  }, 45_000)

  it('stages real Session commands independently, fences stale Browser work, and settles through the V5 command owner', async () => {
    const project = commandProject()
    const configRevision = await configRevisionForProjectV5(project)
    const activatedGateway = await startActivatedGateway(project)
    const { gateway, httpPort } = activatedGateway
    let first: Awaited<ReturnType<typeof openSession>> | null = null
    let second: Awaited<ReturnType<typeof openSession>> | null = null
    let socket: WebSocket | null = null
    let recorder: CommandBatchRecorder | null = null
    try {
      const endpointUrl = gateway.status().opcUa.server.endpointUrl
      if (endpointUrl === null) throw new Error('Gateway OPC UA listener did not start')
      first = await openSession(endpointUrl); second = await openSession(endpointUrl)
      const instances = namespaceIndex(await namespaceUris(first.session), OPC_UA_ROBOTICS_INSTANCES_NAMESPACE_URI_V1)
      socket = await openWebSocket(httpPort)
      recorder = recordCommandBatches(socket)
      const leaseMessage = nextMessage(socket, (message) => typeof message.generation === 'number' && typeof message.expiresAt === 'number')
      socket.send(JSON.stringify({ type: 'browser-publisher-lease-acquire-v1', protocolVersion: 1, projectId: project.projectId, configRevision, publisherId: 'browser-integration' }))
      let activeLease: RuntimePublisherLeaseV1 | null = validateRuntimePublisherLeaseV1(await leaseMessage)
      let generation = activeLease.generation
      const fields = ['RequestId', 'ExpiresAt', 'X', 'Y', 'Z', 'Roll', 'Pitch', 'Yaw'] as const
      const values: Readonly<Record<(typeof fields)[number], unknown>> = Object.freeze({ RequestId: 'object-atomic-1', ExpiresAt: new Date(Date.now() + 30_000), X: 1, Y: 2, Z: 3, Roll: 0, Pitch: 0, Yaw: Math.PI })
      const dataTypes: Readonly<Record<(typeof fields)[number], DataType>> = Object.freeze({ RequestId: DataType.String, ExpiresAt: DataType.DateTime, X: DataType.Double, Y: DataType.Double, Z: DataType.Double, Roll: DataType.Double, Pitch: DataType.Double, Yaw: DataType.Double })
      const browserPoses = new Map<string, RigidTransformV5>()
      let browserPoseMutations = 0
      const owner = createRuntimeGatewayCommandOwnerV5({
        project,
        configRevision,
        nowMs: Date.now,
        readLease: () => activeLease !== null && activeLease.expiresAt > Date.now() ? activeLease : null,
        simulation: {
          writeJointValues: () => undefined,
          commitObjectPose: (objectId, pose) => { browserPoseMutations += 1; browserPoses.set(objectId, pose) },
          writeLogicalSignal: () => undefined,
          startJob: () => undefined,
          cancelJob: () => undefined,
        },
      })
      const stageCompleteObjectCommand = async (requestId: string): Promise<void> => {
        expect(await write(first!.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, false)).toBe(StatusCodes.Good)
        for (const field of fields) {
          const value = field === 'RequestId'
            ? requestId
            : field === 'ExpiresAt'
              ? new Date(Date.now() + 30_000)
              : values[field]
          expect(await write(first!.session, objectCommandPath(instances, project, field), dataTypes[field], value)).toBe(StatusCodes.Good)
        }
      }

      for (const field of fields) expect(await write(first.session, objectCommandPath(instances, project, field), dataTypes[field], values[field])).toBe(StatusCodes.Good)
      expect(await write(second.session, objectCommandPath(instances, project, 'RequestId'), DataType.String, 'mixed-session')).toBe(StatusCodes.Good)
      const incompleteBatchCount = recorder.batches.length
      expect((await write(second.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, true)).equals(StatusCodes.BadInvalidArgument)).toBe(true)
      await expectStableBatchCount(recorder, incompleteBatchCount)

      for (const field of fields) {
        const expiredValue = field === 'RequestId'
          ? 'expired-session-command'
          : field === 'ExpiresAt'
            ? new Date(Date.now() - 1)
            : values[field]
        expect(await write(second.session, objectCommandPath(instances, project, field), dataTypes[field], expiredValue)).toBe(StatusCodes.Good)
      }
      const expiredBatchCount = recorder.batches.length
      expect((await write(second.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, true)).equals(StatusCodes.BadInvalidArgument)).toBe(true)
      await expectStableBatchCount(recorder, expiredBatchCount)

      const actualX = `ns=${instances};s=OpenWebDigitalTwin/Projects/${project.projectId}/Actual/SceneObjects/box/Pose/X`
      expect(await readValue(first.session, actualX)).toBe(0)
      socket.send(JSON.stringify({ type: 'browser-publisher-lease-release-v1', protocolVersion: 1, projectId: project.projectId, configRevision, publisherId: 'browser-integration', generation }))
      await new Promise((resolve) => setTimeout(resolve, 25))
      activeLease = null
      const unavailableBatchCount = recorder.batches.length
      expect(await write(first.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, true)).toBe(StatusCodes.Good)
      await waitForResult(first.session, commandPath(instances, project, 'object-atomic-1', 'FailureCode'), 'BROWSER_PUBLISHER_UNAVAILABLE')
      await expectStableBatchCount(recorder, unavailableBatchCount)
      expect(await readValue(first.session, actualX)).toBe(0)

      const replacementLeaseMessage = nextMessage(socket, (message) => typeof message.generation === 'number' && typeof message.expiresAt === 'number')
      socket.send(JSON.stringify({ type: 'browser-publisher-lease-acquire-v1', protocolVersion: 1, projectId: project.projectId, configRevision, publisherId: 'browser-integration' }))
      activeLease = validateRuntimePublisherLeaseV1(await replacementLeaseMessage)
      generation = activeLease.generation
      await stageCompleteObjectCommand('object-atomic-1')

      const acceptedBatchCount = recorder.batches.length
      expect(await write(first.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, true)).toBe(StatusCodes.Good)
      await expectStableBatchCount(recorder, acceptedBatchCount + 1)
      const batch = recorder.batches[acceptedBatchCount]!
      expect(batch).toMatchObject({ leaseGeneration: generation, commands: [{ commandId: 'object-atomic-1', value: { kind: 'scene-object-pose', pose: { x: 1, y: 2, z: 3, roll: 0, pitch: 0, yaw: Math.PI } } }] })
      await waitForResult(first.session, commandPath(instances, project, 'object-atomic-1', 'ExecutionState'), 'RUNNING')
      const ownerResult = await owner.execute(batch)
      expect(ownerResult).toMatchObject({ acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED', failureCode: null })
      expect(browserPoseMutations).toBe(1)
      expect(browserPoses.get('box')).toEqual({ positionM: [1, 2, 3], quaternion: [0, 0, 1, 0] })
      socket.send(JSON.stringify(ownerResult))
      await waitForResult(first.session, commandPath(instances, project, 'object-atomic-1', 'ExecutionState'), 'SUCCEEDED')

      await stageCompleteObjectCommand('object-atomic-1')
      const duplicateBatchCount = recorder.batches.length
      expect(await write(first.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, true)).toBe(StatusCodes.Good)
      await waitForResult(first.session, commandPath(instances, project, 'object-atomic-1', 'ExecutionState'), 'SUCCEEDED')
      await expectStableBatchCount(recorder, duplicateBatchCount)

      expect(await write(first.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, false)).toBe(StatusCodes.Good)
      for (const field of fields) expect(await write(first.session, objectCommandPath(instances, project, field), dataTypes[field], field === 'X' ? 99 : values[field])).toBe(StatusCodes.Good)
      const conflictBatchCount = recorder.batches.length
      expect(await write(first.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, true)).toBe(StatusCodes.Good)
      await waitForResult(first.session, `ns=${instances};s=OpenWebDigitalTwin/Projects/${project.projectId}/Diagnostics/LastCommand/FailureCode`, 'COMMAND_ID_CONFLICT')
      await expectStableBatchCount(recorder, conflictBatchCount)

      await stageCompleteObjectCommand('lease-replacement-command')
      const staleBatchCount = recorder.batches.length
      expect(await write(first.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, true)).toBe(StatusCodes.Good)
      await expectStableBatchCount(recorder, staleBatchCount + 1)
      const staleBatch = recorder.batches[staleBatchCount]!
      expect(staleBatch.leaseGeneration).toBe(generation)
      await waitForResult(first.session, commandPath(instances, project, 'lease-replacement-command', 'ExecutionState'), 'RUNNING')
      const nextLeaseMessage = nextMessage(socket, (message) => typeof message.generation === 'number' && typeof message.expiresAt === 'number')
      socket.send(JSON.stringify({ type: 'browser-publisher-lease-acquire-v1', protocolVersion: 1, projectId: project.projectId, configRevision, publisherId: 'browser-integration' }))
      activeLease = validateRuntimePublisherLeaseV1(await nextLeaseMessage)
      expect(activeLease.generation).toBeGreaterThan(generation)
      generation = activeLease.generation
      await waitForResult(first.session, commandPath(instances, project, 'lease-replacement-command', 'FailureCode'), 'COMMAND_LEASE_STALE')
      await expectStableBatchCount(recorder, staleBatchCount + 1)
      const staleOwnerResult = await owner.execute(staleBatch)
      expect(staleOwnerResult).toMatchObject({ acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE' })
      expect(browserPoseMutations).toBe(1)
      socket.send(JSON.stringify(staleOwnerResult))
      await waitForResult(first.session, commandPath(instances, project, 'lease-replacement-command', 'FailureCode'), 'COMMAND_LEASE_STALE')
      await expectStableBatchCount(recorder, staleBatchCount + 1)

      await stageCompleteObjectCommand('wrong-result-generation-command')
      const wrongResultBatchCount = recorder.batches.length
      expect(await write(first.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, true)).toBe(StatusCodes.Good)
      await expectStableBatchCount(recorder, wrongResultBatchCount + 1)
      await waitForResult(first.session, commandPath(instances, project, 'wrong-result-generation-command', 'ExecutionState'), 'RUNNING')
      socket.send(JSON.stringify(validateCommandResultV1({
        type: 'command-result-v1', protocolVersion: 1, projectId: project.projectId, configRevision,
        leaseGeneration: staleBatch.leaseGeneration, targetId: 'box', commandId: 'wrong-result-generation-command',
        acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'BROWSER_COMMAND_FAILED',
        message: 'Wrong lease-generation result.', attachedObjectId: null, completedAt: Date.now(),
      })))
      await waitForResult(first.session, commandPath(instances, project, 'wrong-result-generation-command', 'FailureCode'), 'BROWSER_RESULT_INVALID')
      expect(browserPoseMutations).toBe(1)
      await expectStableBatchCount(recorder, wrongResultBatchCount + 1)

      await stageCompleteObjectCommand('passive-lease-expiry-command')
      const expiryBatchCount = recorder.batches.length
      expect(await write(first.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, true)).toBe(StatusCodes.Good)
      await expectStableBatchCount(recorder, expiryBatchCount + 1)
      const expiryBatch = recorder.batches[expiryBatchCount]!
      await waitForResult(first.session, commandPath(instances, project, 'passive-lease-expiry-command', 'ExecutionState'), 'RUNNING')
      await waitForResult(first.session, commandPath(instances, project, 'passive-lease-expiry-command', 'FailureCode'), 'COMMAND_LEASE_STALE', 8_000)
      await expectStableBatchCount(recorder, expiryBatchCount + 1)
      const expiredOwnerResult = await owner.execute(expiryBatch)
      expect(expiredOwnerResult).toMatchObject({ acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE' })
      expect(browserPoseMutations).toBe(1)
      socket.send(JSON.stringify(expiredOwnerResult))
      await waitForResult(first.session, commandPath(instances, project, 'passive-lease-expiry-command', 'FailureCode'), 'COMMAND_LEASE_STALE')
      await expectStableBatchCount(recorder, expiryBatchCount + 1)
      expect(await readValue(first.session, actualX)).toBe(0)
    } finally {
      recorder?.dispose()
      await cleanupAll(
        { label: 'Gateway WebSocket close', cleanup: () => closeWebSocket(socket) },
        { label: 'Second OPC UA Client connection cleanup', cleanup: () => closeSession(second) },
        { label: 'First OPC UA Client connection cleanup', cleanup: () => closeSession(first) },
        { label: 'Runtime Gateway stop', cleanup: () => gateway.stop() },
      )
    }
  }, 60_000)

  it('accepts sixteen real Sessions and rejects a seventeenth', async () => {
    const adapter = createOpcUaServerAdapterV1(projectWithJointCount(2), {
      host: '127.0.0.1', advertisedHost: '127.0.0.1', port: 0, advertisedPort: 0,
      pkiRootDir: testPkiRoot, configRevision: 'c'.repeat(64),
    })
    const sessions: ClientSession[] = []
    let client: OPCUAClient | null = null
    const priorDefaultMaxListeners = EventEmitter.defaultMaxListeners
    EventEmitter.defaultMaxListeners = 0
    try {
      await adapter.start()
      client = createClient('sixteen concurrent OPC UA Sessions')
      await client.connect(adapter.status().endpointUrl!)
      for (let index = 0; index < 16; index += 1) sessions.push(await client.createSession())
      expect(adapter.status().activeSessionCount).toBe(16)
      await expect(client.createSession()).rejects.toThrow(StatusCodes.BadTooManySessions.toString())
      expect(adapter.status().activeSessionCount).toBe(16)
    } finally {
      try {
        await cleanupAll(
          ...sessions.map((session, index) => ({ label: `OPC UA Session ${index + 1} close`, cleanup: () => session.close() })),
          { label: 'Shared OPC UA Client disconnect', cleanup: () => client?.disconnect() },
          { label: 'OPC UA Server adapter stop', cleanup: () => adapter.stop() },
        )
      } finally {
        EventEmitter.defaultMaxListeners = priorDefaultMaxListeners
      }
    }
  }, 60_000)
})
