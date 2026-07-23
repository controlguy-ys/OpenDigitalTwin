// @vitest-environment node

import {
  AttributeIds,
  DataType,
  MessageSecurityMode,
  OPCUAClient,
  OPCUACertificateManager,
  SecurityPolicy,
  StatusCodes,
  UserTokenType,
  Variant,
  type ClientSession,
} from 'node-opcua'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { validateWorkcellProjectV5, type WorkcellProjectV5 } from '../../src/core/project-v5/index.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../src/core/project-v5/test-support.js'
import {
  createOpcUaServerAdapterV1,
  type OpcUaServerAdapterV1,
} from './opcua-server-adapter.js'
import * as serverAdapterModule from './opcua-server-adapter.js'
import { OPENWEB_MODEL_NAMESPACE_URI_V1 } from './opcua-openweb-model.js'

const CRB_ROBOT_ID = 'robot-1'
const OPC_UA_ROBOTICS_INSTANCES_NAMESPACE_URI_V1 =
  'urn:open-web-digital-twin:instances:v1'
const TEST_PKI_ROOT = join(tmpdir(), `robot-sim-opcua-adapter-${process.pid}`)

function sampleProject(mode: 'off' | 'server' | 'bridge'): WorkcellProjectV5 {
  const source = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(source as unknown as { projectId: string }).projectId = `project-opcua-${mode}`
  ;(source as unknown as { revisionId: string }).revisionId = `revision-opcua-${mode}`
  ;(source.opcUa as unknown as { mode: WorkcellProjectV5['opcUa']['mode'] }).mode = mode
  return validateWorkcellProjectV5(source)
}

function sampleOpenWebProject(): WorkcellProjectV5 {
  const source = cloneWorkcellProjectV5(sampleProject('server'))
  ;(source.spatialEntities as unknown as WorkcellProjectV5['spatialEntities'][number][]).push({
    id: 'box',
    name: 'Box',
    geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#808080' },
    parentFrameId: 'mcp',
    localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    visible: true,
    groupId: null,
    removable: true,
    transformOwner: 'simulation',
    numericStatus: {
      value: 0,
      sourceOwnership: 'simulation',
      overlay: { visible: false, frameId: null },
    },
    graspable: false,
    graspFrames: [],
    movingFrames: [],
  })
  return validateWorkcellProjectV5(source)
}

function projectWithReservedJointId() {
  const source = sampleProject('server')
  const sourceDefinition = source.robotDefinitions[0]!
  const previousJointId = sourceDefinition.joints[0]!.id
  const definition = {
    ...sourceDefinition,
    joints: sourceDefinition.joints.map((joint, index) => (
      index === 0 ? { ...joint, id: '__proto__' } : joint
    )),
  }
  return validateWorkcellProjectV5({
    ...source,
    robotDefinitions: source.robotDefinitions.map((candidate) => (
      candidate.id === definition.id ? definition : candidate
    )),
    robots: source.robots.map((robot) => robot.definitionId !== definition.id
      ? robot
      : {
          ...robot,
          initialJointValues: Object.fromEntries(definition.joints.map(({ id, home }) => [
            id,
            id === '__proto__'
              ? robot.initialJointValues[previousJointId] ?? home
              : robot.initialJointValues[id],
          ])),
        }),
    jobs: [],
    opcUa: { ...source.opcUa, mappings: [] },
  })
}

async function openAnonymousSession(
  endpointUrl: string,
): Promise<{
  readonly client: OPCUAClient
  readonly session: ClientSession
}> {
  const client = OPCUAClient.create({
    applicationName: 'RobotSim OPC UA Adapter Integration Test',
    endpointMustExist: true,
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    connectionStrategy: { maxRetry: 0 },
    clientCertificateManager: new OPCUACertificateManager({
      rootFolder: join(TEST_PKI_ROOT, 'client'),
      name: 'client-pki',
      disableFileWatchers: true,
    }),
  })
  await client.connect(endpointUrl)
  const session = await client.createSession()
  return { client, session }
}

describe('OPC UA server adapter V1', () => {
  const adapters: OpcUaServerAdapterV1[] = []

  afterEach(async () => {
    await Promise.all(adapters.splice(0).map(async (adapter) => adapter.stop()))
  })

  it('does not expose the retired RobotSim namespace alias', () => {
    expect(serverAdapterModule).not.toHaveProperty('ROBOT_SIM_OPC_UA_NAMESPACE_URI_V1')
  })

  it('does not start an OPC UA server when the validated Project mode is off', async () => {
    const adapter = createOpcUaServerAdapterV1(sampleProject('off'), {
      host: '127.0.0.1',
      advertisedHost: '127.0.0.1',
      advertisedPort: 0,
      port: 0,
      pkiRootDir: TEST_PKI_ROOT,
    })
    adapters.push(adapter)

    await adapter.start()

    expect(adapter.status()).toEqual({
      mode: 'off',
      started: false,
      endpointUrl: null,
      namespaceUri: OPC_UA_ROBOTICS_INSTANCES_NAMESPACE_URI_V1,
      namespaceIndex: null,
      nodeIds: {},
      productNamespaceUri: OPENWEB_MODEL_NAMESPACE_URI_V1,
      productNamespaceIndex: null,
      productRootNodeId: null,
    })
    await expect(adapter.publishRobotJointState(CRB_ROBOT_ID, { J1: 5 }))
      .rejects.toThrow('OPC_UA_SERVER_MODE_OFF')
    await adapter.stop()
    await adapter.stop()
  })

  it('starts the Server role for a validated Bridge Project', async () => {
    const adapter = createOpcUaServerAdapterV1(sampleProject('bridge'), {
      host: '127.0.0.1',
      advertisedHost: '127.0.0.1',
      advertisedPort: 0,
      port: 0,
      pkiRootDir: TEST_PKI_ROOT,
    })
    adapters.push(adapter)

    await adapter.start()

    expect(adapter.status()).toMatchObject({
      mode: 'server',
      started: true,
      endpointUrl: expect.stringMatching(/^opc\.tcp:\/\/127\.0\.0\.1:\d+$/u),
    })
  })

  it('exposes official Robotics Axis ActualPosition through deterministic read-only Double nodes and publishes updates', async () => {
    const project = sampleProject('server')
    const adapter = createOpcUaServerAdapterV1(project, {
      host: '0.0.0.0',
      advertisedHost: '127.0.0.1',
      advertisedPort: 0,
      port: 0,
      pkiRootDir: TEST_PKI_ROOT,
    })
    adapters.push(adapter)

    await adapter.start()
    await adapter.start()
    const status = adapter.status()

    expect(status.mode).toBe('server')
    expect(status.started).toBe(true)
    expect(status.endpointUrl).toMatch(/^opc\.tcp:\/\/127\.0\.0\.1:\d+$/u)
    expect(status.namespaceUri).toBe(OPC_UA_ROBOTICS_INSTANCES_NAMESPACE_URI_V1)
    expect(status.namespaceIndex).toBeGreaterThan(1)

    const namespaceIndex = status.namespaceIndex
    expect(namespaceIndex).not.toBeNull()
    const crbNodeId = status.nodeIds[CRB_ROBOT_ID]?.J1
    expect(crbNodeId).toMatch(new RegExp(`^ns=${namespaceIndex};s=Robotics/`, 'u'))
    expect(status.nodeIds).toEqual({
      [CRB_ROBOT_ID]: expect.objectContaining({ J1: crbNodeId }),
    })

    const endpointUrl = status.endpointUrl
    expect(endpointUrl).not.toBeNull()
    const { client, session } = await openAnonymousSession(endpointUrl!)
    try {
      const endpointDescriptions = await client.getEndpoints()
      expect(endpointDescriptions).not.toHaveLength(0)
      expect(endpointDescriptions.every(({ securityMode, securityPolicyUri }) => (
        securityMode === MessageSecurityMode.None
        && securityPolicyUri === SecurityPolicy.None
      ))).toBe(true)

      expect(endpointDescriptions.every(({ userIdentityTokens }) => {
        const tokens = userIdentityTokens ?? []
        return tokens.length === 1
          && tokens[0]?.tokenType === UserTokenType.Anonymous
      })).toBe(true)

      const initialValues = await session.read([{ nodeId: crbNodeId, attributeId: AttributeIds.Value }])
      expect(initialValues.map(({ statusCode }) => statusCode.isGood())).toEqual([true])
      expect(initialValues.map(({ value }) => value.dataType)).toEqual([DataType.Double])
      expect(initialValues.map(({ value }) => value.value)).toEqual([0])
      const writeStatus = await session.write({
        nodeId: crbNodeId,
        attributeId: AttributeIds.Value,
        value: { value: new Variant({ dataType: DataType.Double, value: 99 }) },
      })
      expect(writeStatus).toBe(StatusCodes.BadNotWritable)

      await adapter.publishRobotJointState(CRB_ROBOT_ID, { J1: 12.5 })

      const publishedValues = await session.read([{ nodeId: crbNodeId, attributeId: AttributeIds.Value }])
      expect(publishedValues.map(({ value }) => value.value)).toEqual([12.5])
    } finally {
      await session.close()
      await client.disconnect()
    }

    await adapter.stop()
    await adapter.stop()
    expect(adapter.status().started).toBe(false)
  }, 30_000)

  it('creates the OpenWebDigitalTwin product model and publishes its Actual snapshot beside Robotics telemetry', async () => {
    const project = sampleOpenWebProject()
    const adapter = createOpcUaServerAdapterV1(project, {
      host: '127.0.0.1',
      advertisedHost: '127.0.0.1',
      advertisedPort: 0,
      port: 0,
      pkiRootDir: TEST_PKI_ROOT,
    })
    adapters.push(adapter)
    await adapter.start()

    const status = adapter.status()
    expect(status.productNamespaceUri).toBe(OPENWEB_MODEL_NAMESPACE_URI_V1)
    expect(status.productNamespaceIndex).toBeGreaterThan(1)
    expect(status.productRootNodeId).toMatch(/^ns=\d+;s=OpenWebDigitalTwin\/Projects\/project-opcua-server$/u)

    await adapter.publishActualSnapshot({
      projectId: project.projectId,
      revisionId: project.revisionId,
      configRevision: project.revisionId,
      robots: { [CRB_ROBOT_ID]: { J1: 21.5 } },
      sceneObjects: {
        box: {
          pose: { positionM: [0.4, 0.5, 0.6], quaternion: [0, 0, 0, 1] },
          status: 3,
          color: '#123456',
          quality: 'GOOD',
          sourceTimestampMs: 1_000,
          publishedTimestampMs: 1_050,
        },
      },
      logicalSignals: {
        PartPresent: {
          value: true,
          quality: 'GOOD',
          statusCode: 'Good',
          sourceTimestampMs: 1_000,
          publishedTimestampMs: 1_050,
        },
      },
      jobs: { 'job-1': { state: 'running', stepIndex: 2, failureCode: null } },
      attachments: { box: { state: 'attached', parentFrameId: 'robot-1:Tool' } },
    })

    const { client, session } = await openAnonymousSession(status.endpointUrl!)
    try {
      const objectX = `ns=${status.namespaceIndex};s=OpenWebDigitalTwin/Projects/${project.projectId}/Actual/SceneObjects/box/Pose/X`
      const robotJ1 = status.nodeIds[CRB_ROBOT_ID]!.J1!
      const values = await session.read([
        { nodeId: objectX, attributeId: AttributeIds.Value },
        { nodeId: robotJ1, attributeId: AttributeIds.Value },
      ])
      expect(values.map(({ statusCode }) => statusCode.isGood())).toEqual([true, true])
      expect(values.map(({ value }) => value.value)).toEqual([0.4, 21.5])
    } finally {
      await session.close()
      await client.disconnect()
    }
  }, 30_000)

  it('rejects unknown Robot and joint identities before changing any value', async () => {
    const adapter = createOpcUaServerAdapterV1(sampleProject('server'), {
      host: '127.0.0.1',
      advertisedHost: '127.0.0.1',
      advertisedPort: 0,
      port: 0,
      pkiRootDir: TEST_PKI_ROOT,
    })
    adapters.push(adapter)
    await adapter.start()

    await expect(adapter.publishRobotJointState('robot-missing', { J1: 1 }))
      .rejects.toThrow('OPC_UA_ROBOT_NOT_FOUND')
    await expect(adapter.publishRobotJointState(CRB_ROBOT_ID, { JOINT_MISSING: 1 }))
      .rejects.toThrow('OPC_UA_JOINT_NOT_FOUND')
    await expect(adapter.publishRobotJointState(CRB_ROBOT_ID, { J1: Number.NaN }))
      .rejects.toThrow('OPC_UA_JOINT_VALUE_INVALID')
  }, 30_000)

  it('reports and publishes a schema-valid reserved JavaScript key Joint id', async () => {
    const project = projectWithReservedJointId()
    const adapter = createOpcUaServerAdapterV1(project, {
      host: '127.0.0.1',
      advertisedHost: '127.0.0.1',
      advertisedPort: 0,
      port: 0,
      pkiRootDir: TEST_PKI_ROOT,
    })
    adapters.push(adapter)

    await adapter.start()
    const robotId = project.robots[0]!.id
    const jointNodeIds = adapter.status().nodeIds[robotId]!
    expect(Object.hasOwn(jointNodeIds, '__proto__')).toBe(true)
    const nodeId = jointNodeIds['__proto__']
    expect(nodeId).toBeTypeOf('string')

    const values = Object.fromEntries([['__proto__', 7]])
    await adapter.publishRobotJointState(robotId, values)
    const { client, session } = await openAnonymousSession(adapter.status().endpointUrl!)
    try {
      const value = await session.read({
        nodeId: nodeId!,
        attributeId: AttributeIds.Value,
      })
      expect(value.statusCode.equals(StatusCodes.Good)).toBe(true)
      expect(value.value.value).toBe(7)
    } finally {
      await session.close()
      await client.disconnect()
    }
  }, 30_000)
})
