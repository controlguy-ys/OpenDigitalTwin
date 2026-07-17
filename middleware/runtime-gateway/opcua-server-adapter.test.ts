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

import { createDualRobotSampleV4 } from '../../src/features/project/v4/dual-robot-sample-v4.js'
import { validateWorkcellProjectV4 } from '../../src/core/project-v4/index.js'
import {
  ROBOT_SIM_OPC_UA_NAMESPACE_URI_V1,
  createOpcUaServerAdapterV1,
  type OpcUaServerAdapterV1,
} from './opcua-server-adapter.js'

const CRB_ROBOT_ID = 'robot-sample-crb'
const SLIDE_ROBOT_ID = 'robot-sample-linear-slide'
const SLIDE_JOINT_ID = 'SLIDE_X'
const TEST_PKI_ROOT = join(tmpdir(), `robot-sim-opcua-adapter-${process.pid}`)

function sampleProject(mode: 'off' | 'server') {
  return createDualRobotSampleV4({
    projectId: `project-opcua-${mode}`,
    revisionId: `revision-opcua-${mode}`,
    nowIso: '2026-07-17T00:00:00.000Z',
    opcUaMode: mode,
  })
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
  return validateWorkcellProjectV4({
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
      namespaceUri: ROBOT_SIM_OPC_UA_NAMESPACE_URI_V1,
      namespaceIndex: null,
      nodeIds: {},
    })
    await expect(adapter.publishRobotJointState(CRB_ROBOT_ID, { J1: 5 }))
      .rejects.toThrow('OPC_UA_SERVER_MODE_OFF')
    await adapter.stop()
    await adapter.stop()
  })

  it('exposes both Robots through deterministic read-only Double nodes and publishes updates', async () => {
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
    expect(status.namespaceUri).toBe(ROBOT_SIM_OPC_UA_NAMESPACE_URI_V1)
    expect(status.namespaceIndex).toBeGreaterThan(1)

    const namespaceIndex = status.namespaceIndex
    expect(namespaceIndex).not.toBeNull()
    const crbNodeId = `ns=${namespaceIndex};s=RobotSim/Robots/${CRB_ROBOT_ID}/Joints/J1/Actual`
    const slideNodeId = `ns=${namespaceIndex};s=RobotSim/Robots/${SLIDE_ROBOT_ID}/Joints/${SLIDE_JOINT_ID}/Actual`
    expect(status.nodeIds).toEqual({
      [CRB_ROBOT_ID]: expect.objectContaining({ J1: crbNodeId }),
      [SLIDE_ROBOT_ID]: { [SLIDE_JOINT_ID]: slideNodeId },
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

      const configuredMappingNodeIds = project.opcUa.mappings.flatMap(
        ({ leaves }) => leaves.map(({ nodeId }) => nodeId),
      )
      const configuredMappingValues = await session.read(configuredMappingNodeIds.map(
        (nodeId) => ({ nodeId, attributeId: AttributeIds.Value }),
      ))
      expect(configuredMappingValues.every(({ statusCode }) => statusCode.equals(StatusCodes.Good)))
        .toBe(true)
      expect(endpointDescriptions.every(({ userIdentityTokens }) => {
        const tokens = userIdentityTokens ?? []
        return tokens.length === 1
          && tokens[0]?.tokenType === UserTokenType.Anonymous
      })).toBe(true)

      const initialValues = await session.read([
        { nodeId: crbNodeId, attributeId: AttributeIds.Value },
        { nodeId: slideNodeId, attributeId: AttributeIds.Value },
      ])
      expect(initialValues.map(({ statusCode }) => statusCode.isGood())).toEqual([true, true])
      expect(initialValues.map(({ value }) => value.dataType)).toEqual([DataType.Double, DataType.Double])
      expect(initialValues.map(({ value }) => value.value)).toEqual([0, 0.2])
      const writeStatus = await session.write({
        nodeId: crbNodeId,
        attributeId: AttributeIds.Value,
        value: { value: new Variant({ dataType: DataType.Double, value: 99 }) },
      })
      expect(writeStatus).toBe(StatusCodes.BadNotWritable)

      await adapter.publishRobotJointState(CRB_ROBOT_ID, { J1: 12.5 })
      await adapter.publishRobotJointState(SLIDE_ROBOT_ID, { [SLIDE_JOINT_ID]: 0.75 })

      const publishedValues = await session.read([
        { nodeId: crbNodeId, attributeId: AttributeIds.Value },
        { nodeId: slideNodeId, attributeId: AttributeIds.Value },
      ])
      expect(publishedValues.map(({ value }) => value.value)).toEqual([12.5, 0.75])
    } finally {
      await session.close()
      await client.disconnect()
    }

    await adapter.stop()
    await adapter.stop()
    expect(adapter.status().started).toBe(false)
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
