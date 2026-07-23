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
  type StatusCode,
} from 'node-opcua'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { describe, expect, it } from 'vitest'

import {
  configRevisionForProjectV5,
  validateWorkcellProjectV5,
  type RigidTransformV5,
  type RobotDefinitionV5,
  type WorkcellProjectV5,
} from '../../src/core/project-v5/index.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../src/core/project-v5/test-support.js'
import type { RuntimeGatewayDeploymentConfigV1 } from './deployment-config.js'
import { createRuntimeGatewayEntrypointService } from './main.js'
import { createOpcUaServerAdapterV1 } from './opcua-server-adapter.js'
import { OPENWEB_MODEL_NAMESPACE_URI_V1 } from './opcua-openweb-model.js'
import { OPC_UA_ROBOTICS_INSTANCES_NAMESPACE_URI_V1 } from './opcua-robotics-model.js'

const STANDARD_URI = 'http://opcfoundation.org/UA/'
const DI_URI = 'http://opcfoundation.org/UA/DI/'
const IA_URI = 'http://opcfoundation.org/UA/IA/'
const ROBOTICS_URI = 'http://opcfoundation.org/UA/Robotics/'
const TEST_PKI_ROOT = join(tmpdir(), `robot-sim-opcua-server-model-${process.pid}`)
const IDENTITY_POSE: RigidTransformV5 = Object.freeze({
  positionM: [0, 0, 0] as const,
  quaternion: [0, 0, 0, 1] as const,
})

async function ephemeralPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Expected an ephemeral TCP address')
  await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)))
  return address.port
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

async function openSession(endpointUrl: string): Promise<{ readonly client: OPCUAClient; readonly session: ClientSession }> {
  const client = OPCUAClient.create({
    applicationName: 'RobotSim real-server integration test', endpointMustExist: true,
    securityMode: MessageSecurityMode.None, securityPolicy: SecurityPolicy.None,
    connectionStrategy: { maxRetry: 0 },
    clientCertificateManager: new OPCUACertificateManager({ rootFolder: join(TEST_PKI_ROOT, 'client'), name: 'client-pki', disableFileWatchers: true }),
  })
  await client.connect(endpointUrl)
  return { client, session: await client.createSession() }
}

async function closeSession(value: { readonly client: OPCUAClient; readonly session: ClientSession } | null): Promise<void> {
  await value?.session.close().catch(() => undefined)
  await value?.client.disconnect().catch(() => undefined)
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

async function typeDefinitionName(session: ClientSession, nodeId: string): Promise<string | null> {
  const browse = await session.browse({
    nodeId, browseDirection: BrowseDirection.Both, referenceTypeId: 'i=40', includeSubtypes: false, resultMask: 0x3f,
  })
  if (!browse.statusCode.isGood()) throw new Error(`TypeDefinition browse failed: ${browse.statusCode.toString()}`)
  return browse.references?.[0]?.browseName.name ?? null
}

async function hasRelation(session: ClientSession, nodeId: string, relationName: string): Promise<boolean> {
  const browse = await session.browse({ nodeId, browseDirection: BrowseDirection.Forward, includeSubtypes: false, resultMask: 0x3f })
  for (const reference of browse.references ?? []) {
    const type = await session.read({ nodeId: reference.referenceTypeId, attributeId: AttributeIds.BrowseName })
    const name = type.value.value
    if (typeof name === 'object' && name !== null && 'name' in name && name.name === relationName) return true
  }
  return false
}

async function propertyNode(session: ClientSession, parentNodeId: string, browseName: string): Promise<string> {
  const browse = await session.browse({ nodeId: parentNodeId, browseDirection: BrowseDirection.Forward, referenceTypeId: 'i=46', includeSubtypes: false, resultMask: 0x3f })
  const property = browse.references?.find((reference) => reference.browseName.name === browseName)
  if (property === undefined) throw new Error(`Missing OPC UA property ${browseName} under ${parentNodeId}`)
  return property.nodeId.toString()
}

async function browseProductNodeIds(session: ClientSession, rootNodeId: string): Promise<readonly string[]> {
  const seen = new Set<string>()
  const pending = [rootNodeId]
  while (pending.length > 0) {
    const nodeId = pending.pop()!
    if (seen.has(nodeId)) continue
    seen.add(nodeId)
    const browse = await session.browse({ nodeId, browseDirection: BrowseDirection.Forward, referenceTypeId: 'HierarchicalReferences', includeSubtypes: true, resultMask: 0x3f })
    for (const reference of browse.references ?? []) pending.push(reference.nodeId.toString())
  }
  return [...seen]
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

async function expectNoCommand(socket: WebSocket): Promise<void> {
  await expect(nextMessage(socket, 'command-batch-v1', 200)).rejects.toThrow('Timed out waiting for command-batch-v1')
}

async function waitForResult(session: ClientSession, nodeId: string, expected: unknown): Promise<void> {
  for (let attempts = 0; attempts < 50; attempts += 1) {
    if (await readValue(session, nodeId) === expected) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for product Result ${String(expected)}`)
}

describe('OPC UA server model real-client integration', () => {
  it.each([2, 7, 16])('loads official NodeSets and exposes the standard %i-Axis model through a real Client', async (jointCount) => {
    const project = projectWithJointCount(jointCount)
    const adapter = createOpcUaServerAdapterV1(project, {
      host: '127.0.0.1', advertisedHost: '127.0.0.1', port: 0, advertisedPort: 0,
      pkiRootDir: TEST_PKI_ROOT, configRevision: 'a'.repeat(64),
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
      expect(await typeDefinitionName(connection.session, root)).toBe('MotionDeviceSystemType')
      expect(await typeDefinitionName(connection.session, device)).toBe('MotionDeviceType')
      expect(await typeDefinitionName(connection.session, controller)).toBe('ControllerType')
      expect(await typeDefinitionName(connection.session, powerTrain)).toBe('PowerTrainType')
      expect(await typeDefinitionName(connection.session, `${device}/Axes/J1`)).toBe('AxisType')
      expect(await hasRelation(connection.session, controller, 'Controls')).toBe(true)
      expect(await hasRelation(connection.session, powerTrain, 'Moves')).toBe(true)
      const axisNodeIds = Array.from({ length: jointCount }, (_, index) => `${device}/Axes/J${index + 1}`)
      await expect(Promise.all(axisNodeIds.map((nodeId) => typeDefinitionName(session, nodeId))))
        .resolves.toEqual(Array.from({ length: jointCount }, () => 'AxisType'))
      const absentAxis = await connection.session.read({ nodeId: `${device}/Axes/J${jointCount + 1}`, attributeId: AttributeIds.NodeClass })
      expect(absentAxis.statusCode.equals(StatusCodes.BadNodeIdUnknown)).toBe(true)
      const productIds = await browseProductNodeIds(connection.session, adapter.status().productRootNodeId!)
      expect(productIds.every((nodeId) => {
        const match = /^ns=(\d+);/u.exec(nodeId)
        return match !== null && [instances, namespaceIndex(uris, OPENWEB_MODEL_NAMESPACE_URI_V1)].includes(Number(match[1]))
      })).toBe(true)
      expect(robotics).toBeGreaterThan(0)
    } finally {
      await closeSession(connection)
      await adapter.stop()
    }
  }, 45_000)

  it('publishes degree/millimetre Actuals and rejects a real Client write', async () => {
    const adapter = createOpcUaServerAdapterV1(projectWithJointCount(2), {
      host: '127.0.0.1', advertisedHost: '127.0.0.1', port: 0, advertisedPort: 0,
      pkiRootDir: TEST_PKI_ROOT, configRevision: 'b'.repeat(64),
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
    } finally { await closeSession(connection); await adapter.stop() }
  }, 45_000)

  it('stages real Session commands independently, fences invalid work, publishes RUNNING, and settles atomically through the Browser lease transport', async () => {
    const httpPort = await ephemeralPort()
    const opcUaPort = await ephemeralPort()
    const config: RuntimeGatewayDeploymentConfigV1 = Object.freeze({
      gatewayId: 'server-model-integration', runtimeKind: 'native', host: '127.0.0.1', httpPort,
      opcUaAdvertisedHost: '127.0.0.1', opcUaAdvertisedPort: opcUaPort, opcUaPort,
    })
    const project = commandProject()
    const configRevision = await configRevisionForProjectV5(project)
    const gateway = createRuntimeGatewayEntrypointService(config, { pkiRootDir: TEST_PKI_ROOT })
    let first: Awaited<ReturnType<typeof openSession>> | null = null
    let second: Awaited<ReturnType<typeof openSession>> | null = null
    let socket: WebSocket | null = null
    try {
      await gateway.start()
      expect((await fetch(`http://127.0.0.1:${httpPort}/runtime/project`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(project) })).status).toBe(200)
      const endpointUrl = gateway.status().opcUa.server.endpointUrl
      if (endpointUrl === null) throw new Error('Gateway OPC UA listener did not start')
      first = await openSession(endpointUrl); second = await openSession(endpointUrl)
      const instances = namespaceIndex(await namespaceUris(first.session), OPC_UA_ROBOTICS_INSTANCES_NAMESPACE_URI_V1)
      socket = await openWebSocket(httpPort)
      const leaseMessage = nextMessage(socket, (message) => typeof message.generation === 'number' && typeof message.expiresAt === 'number')
      socket.send(JSON.stringify({ type: 'browser-publisher-lease-acquire-v1', protocolVersion: 1, projectId: project.projectId, configRevision, publisherId: 'browser-integration' }))
      const lease = await leaseMessage
      let generation = lease.generation
      if (typeof generation !== 'number') throw new Error('Expected Browser lease generation')
      const expiresAt = Date.now() + 30_000
      const fields = ['RequestId', 'ExpiresAt', 'X', 'Y', 'Z', 'Roll', 'Pitch', 'Yaw'] as const
      const values: Readonly<Record<(typeof fields)[number], unknown>> = Object.freeze({ RequestId: 'object-atomic-1', ExpiresAt: new Date(expiresAt), X: 1, Y: 2, Z: 3, Roll: 10, Pitch: 20, Yaw: 30 })
      const dataTypes: Readonly<Record<(typeof fields)[number], DataType>> = Object.freeze({ RequestId: DataType.String, ExpiresAt: DataType.DateTime, X: DataType.Double, Y: DataType.Double, Z: DataType.Double, Roll: DataType.Double, Pitch: DataType.Double, Yaw: DataType.Double })

      for (const field of fields) expect(await write(first.session, objectCommandPath(instances, project, field), dataTypes[field], values[field])).toBe(StatusCodes.Good)
      expect(await write(second.session, objectCommandPath(instances, project, 'RequestId'), DataType.String, 'mixed-session')).toBe(StatusCodes.Good)
      expect((await write(second.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, true)).equals(StatusCodes.BadInvalidArgument)).toBe(true)
      await expectNoCommand(socket)

      for (const field of fields) {
        const expiredValue = field === 'RequestId'
          ? 'expired-session-command'
          : field === 'ExpiresAt'
            ? new Date(Date.now() - 1)
            : values[field]
        expect(await write(second.session, objectCommandPath(instances, project, field), dataTypes[field], expiredValue)).toBe(StatusCodes.Good)
      }
      expect((await write(second.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, true)).equals(StatusCodes.BadInvalidArgument)).toBe(true)
      await expectNoCommand(socket)

      const actualX = `ns=${instances};s=OpenWebDigitalTwin/Projects/${project.projectId}/Actual/SceneObjects/box/Pose/X`
      expect(await readValue(first.session, actualX)).toBe(0)
      socket.send(JSON.stringify({ type: 'browser-publisher-lease-release-v1', protocolVersion: 1, projectId: project.projectId, configRevision, publisherId: 'browser-integration', generation }))
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(await write(first.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, true)).toBe(StatusCodes.Good)
      await expectNoCommand(socket)
      await waitForResult(first.session, commandPath(instances, project, 'object-atomic-1', 'FailureCode'), 'BROWSER_PUBLISHER_UNAVAILABLE')
      expect(await readValue(first.session, actualX)).toBe(0)

      const replacementLeaseMessage = nextMessage(socket, (message) => typeof message.generation === 'number' && typeof message.expiresAt === 'number')
      socket.send(JSON.stringify({ type: 'browser-publisher-lease-acquire-v1', protocolVersion: 1, projectId: project.projectId, configRevision, publisherId: 'browser-integration' }))
      const replacementLease = await replacementLeaseMessage
      if (typeof replacementLease.generation !== 'number') throw new Error('Expected replacement Browser lease generation')
      generation = replacementLease.generation
      expect(await write(first.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, false)).toBe(StatusCodes.Good)
      for (const field of fields) expect(await write(first.session, objectCommandPath(instances, project, field), dataTypes[field], values[field])).toBe(StatusCodes.Good)

      const batchMessage = nextMessage(socket, 'command-batch-v1')
      expect(await write(first.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, true)).toBe(StatusCodes.Good)
      const batch = await batchMessage
      expect(batch).toMatchObject({ leaseGeneration: generation, commands: [{ commandId: 'object-atomic-1', value: { kind: 'scene-object-pose', pose: { x: 1, y: 2, z: 3, roll: 10, pitch: 20, yaw: 30 } } }] })
      await waitForResult(first.session, commandPath(instances, project, 'object-atomic-1', 'ExecutionState'), 'RUNNING')
      socket.send(JSON.stringify({ type: 'command-result-v1', protocolVersion: 1, projectId: project.projectId, configRevision, leaseGeneration: generation, targetId: 'box', commandId: 'object-atomic-1', acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED', failureCode: null, message: 'Applied atomically by the Browser Simulation.', attachedObjectId: null, completedAt: Date.now() }))
      await waitForResult(first.session, commandPath(instances, project, 'object-atomic-1', 'ExecutionState'), 'SUCCEEDED')

      expect(await write(first.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, false)).toBe(StatusCodes.Good)
      for (const field of fields) expect(await write(first.session, objectCommandPath(instances, project, field), dataTypes[field], values[field])).toBe(StatusCodes.Good)
      expect(await write(first.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, true)).toBe(StatusCodes.Good)
      await expectNoCommand(socket)
      await waitForResult(first.session, commandPath(instances, project, 'object-atomic-1', 'ExecutionState'), 'SUCCEEDED')

      expect(await write(first.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, false)).toBe(StatusCodes.Good)
      for (const field of fields) expect(await write(first.session, objectCommandPath(instances, project, field), dataTypes[field], field === 'X' ? 99 : values[field])).toBe(StatusCodes.Good)
      expect(await write(first.session, objectCommandPath(instances, project, 'Execute'), DataType.Boolean, true)).toBe(StatusCodes.Good)
      await expectNoCommand(socket)
      await waitForResult(first.session, `ns=${instances};s=OpenWebDigitalTwin/Projects/${project.projectId}/Diagnostics/LastCommand/FailureCode`, 'COMMAND_ID_CONFLICT')
    } finally {
      socket?.close(); await closeSession(second); await closeSession(first); await gateway.stop()
    }
  }, 60_000)

  it('accepts sixteen real Sessions and rejects a seventeenth', async () => {
    const adapter = createOpcUaServerAdapterV1(projectWithJointCount(2), {
      host: '127.0.0.1', advertisedHost: '127.0.0.1', port: 0, advertisedPort: 0,
      pkiRootDir: TEST_PKI_ROOT, configRevision: 'c'.repeat(64),
    })
    const sessions: Array<Awaited<ReturnType<typeof openSession>>> = []
    let rejectedClient: OPCUAClient | null = null
    try {
      await adapter.start()
      for (let index = 0; index < 16; index += 1) sessions.push(await openSession(adapter.status().endpointUrl!))
      expect(adapter.status().activeSessionCount).toBe(16)
      rejectedClient = OPCUAClient.create({ applicationName: 'seventeenth OPC UA Session', endpointMustExist: true, securityMode: MessageSecurityMode.None, securityPolicy: SecurityPolicy.None, connectionStrategy: { maxRetry: 0 } })
      await expect(rejectedClient.connect(adapter.status().endpointUrl!).then(() => rejectedClient!.createSession())).rejects.toBeDefined()
      expect(adapter.status().activeSessionCount).toBe(16)
    } finally {
      await rejectedClient?.disconnect().catch(() => undefined)
      await Promise.all(sessions.map((session) => closeSession(session)))
      await adapter.stop()
    }
  }, 60_000)
})
