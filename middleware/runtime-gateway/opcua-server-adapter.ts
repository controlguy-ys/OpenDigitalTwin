import {
  DataType,
  MessageSecurityMode,
  OPCUACertificateManager,
  OPCUAServer,
  SecurityPolicy,
  StatusCodes,
  UserTokenType,
  Variant,
  type UAVariable,
} from 'node-opcua'
import { join } from 'node:path'

import {
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../../src/core/project-v5/index.js'

export const ROBOT_SIM_OPC_UA_NAMESPACE_URI_V1 = 'urn:web-digital-twin:robot-sim:v5'

export interface OpcUaServerAdapterOptionsV1 {
  readonly host: string
  readonly advertisedHost: string
  readonly advertisedPort: number
  readonly port: number
  readonly pkiRootDir: string
}

export interface OpcUaServerAdapterStatusV1 {
  readonly mode: 'off' | 'server'
  readonly started: boolean
  readonly endpointUrl: string | null
  readonly namespaceUri: typeof ROBOT_SIM_OPC_UA_NAMESPACE_URI_V1
  readonly namespaceIndex: number | null
  readonly nodeIds: Readonly<Record<string, Readonly<Record<string, string>>>>
}

export interface OpcUaServerAdapterV1 {
  start(): Promise<void>
  stop(): Promise<void>
  status(): OpcUaServerAdapterStatusV1
  publishRobotJointState(
    robotId: string,
    values: Readonly<Record<string, number>>,
  ): Promise<void>
}

function freezeNodeIds(
  source: Readonly<Record<string, Readonly<Record<string, string>>>>,
): Readonly<Record<string, Readonly<Record<string, string>>>> {
  return Object.freeze(Object.fromEntries(
    Object.entries(source).map(([robotId, jointNodeIds]) => [
      robotId,
      Object.freeze({ ...jointNodeIds }),
    ]),
  ))
}

function createStatus(
  mode: 'off' | 'server',
  started: boolean,
  endpointUrl: string | null,
  namespaceIndex: number | null,
  nodeIds: Readonly<Record<string, Readonly<Record<string, string>>>>,
): OpcUaServerAdapterStatusV1 {
  return Object.freeze({
    mode,
    started,
    endpointUrl,
    namespaceUri: ROBOT_SIM_OPC_UA_NAMESPACE_URI_V1,
    namespaceIndex,
    nodeIds: freezeNodeIds(nodeIds),
  })
}

function validateOptions(options: OpcUaServerAdapterOptionsV1): void {
  if (options.host.trim().length === 0) {
    throw new Error('OPC_UA_SERVER_HOST_INVALID: host must not be empty')
  }
  if (
    options.advertisedHost.trim().length === 0
    || /[\p{Cc}\s/\\?#]/u.test(options.advertisedHost)
  ) {
    throw new Error(
      'OPC_UA_SERVER_ADVERTISED_HOST_INVALID: advertisedHost must be a host without whitespace, controls, path, query, or fragment characters',
    )
  }
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error('OPC_UA_SERVER_PORT_INVALID: port must be an integer from 0 to 65535')
  }
  if (
    !Number.isSafeInteger(options.advertisedPort)
    || options.advertisedPort < 0
    || options.advertisedPort > 65_535
  ) {
    throw new Error(
      'OPC_UA_SERVER_ADVERTISED_PORT_INVALID: advertisedPort must be an integer from 0 to 65535',
    )
  }
  if (options.pkiRootDir.trim().length === 0) {
    throw new Error('OPC_UA_SERVER_PKI_ROOT_INVALID: pkiRootDir must not be empty')
  }
}

function nodeIdForPath(namespaceIndex: number, path: string): string {
  return `ns=${namespaceIndex};s=${path}`
}

function opcUaEndpointUrl(host: string, port: number): string {
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `opc.tcp://${urlHost}:${port}`
}

function keepAnonymousUserTokenOnly(server: OPCUAServer): void {
  for (const endpoint of server.endpoints) {
    for (const description of endpoint.endpointDescriptions()) {
      const anonymous = description.userIdentityTokens?.find(
        ({ tokenType }) => tokenType === UserTokenType.Anonymous,
      )
      description.userIdentityTokens = anonymous === undefined ? [] : [anonymous]
    }
  }
}

export function createOpcUaServerAdapterV1(
  projectInput: WorkcellProjectV5,
  options: OpcUaServerAdapterOptionsV1,
): OpcUaServerAdapterV1 {
  validateOptions(options)
  const project = validateWorkcellProjectV5(projectInput)
  const serverEnabled = project.opcUa.mode === 'server' || project.opcUa.mode === 'bridge'
  const mode: OpcUaServerAdapterStatusV1['mode'] = serverEnabled ? 'server' : 'off'
  const definitionsById = new Map(
    project.robotDefinitions.map((definition) => [definition.id, definition]),
  )
  let server: OPCUAServer | null = null
  let jointVariables = new Map<string, ReadonlyMap<string, UAVariable>>()
  let currentStatus = createStatus(mode, false, null, null, {})
  let lifecycleTail: Promise<void> = Promise.resolve()

  function enqueue(transition: () => Promise<void>): Promise<void> {
    const requested = lifecycleTail.then(transition)
    lifecycleTail = requested.catch(() => undefined)
    return requested
  }

  async function startTransition(): Promise<void> {
    if (mode === 'off' || server !== null) return

    const certificateManager = new OPCUACertificateManager({
      rootFolder: options.pkiRootDir,
      name: 'server-pki',
      disableFileWatchers: true,
    })
    const userCertificateManager = new OPCUACertificateManager({
      rootFolder: join(options.pkiRootDir, 'user'),
      name: 'user-pki',
      disableFileWatchers: true,
    })
    const candidate = new OPCUAServer({
      host: options.host,
      hostname: options.advertisedHost,
      port: options.port,
      ...(options.advertisedPort === 0
        ? {}
        : {
            advertisedEndpoints: [opcUaEndpointUrl(
              options.advertisedHost,
              options.advertisedPort,
            )],
          }),
      resourcePath: '',
      allowAnonymous: true,
      securityModes: [MessageSecurityMode.None],
      securityPolicies: [SecurityPolicy.None],
      serverCertificateManager: certificateManager,
      userCertificateManager,
      serverInfo: {
        applicationName: { text: 'WebDigitalTwin RobotSim OPC UA Server' },
        applicationUri: 'urn:web-digital-twin:robot-sim:server',
        productUri: 'urn:web-digital-twin:robot-sim',
      },
    })

    try {
      await candidate.initialize()
      keepAnonymousUserTokenOnly(candidate)

      const addressSpace = candidate.engine.addressSpace
      if (addressSpace === null) {
        throw new Error('OPC_UA_ADDRESS_SPACE_UNAVAILABLE')
      }
      const namespace = addressSpace.registerNamespace(
        ROBOT_SIM_OPC_UA_NAMESPACE_URI_V1,
      )
      const namespaceIndex = namespace.index
      const robotSimObject = namespace.addObject({
        organizedBy: addressSpace.rootFolder.objects,
        browseName: 'RobotSim',
        nodeId: nodeIdForPath(namespaceIndex, 'RobotSim'),
      })
      const robotsObject = namespace.addObject({
        componentOf: robotSimObject,
        browseName: 'Robots',
        nodeId: nodeIdForPath(namespaceIndex, 'RobotSim/Robots'),
      })
      const nextVariables = new Map<string, ReadonlyMap<string, UAVariable>>()
      const nextNodeIds = Object.create(null) as Record<
        string,
        Readonly<Record<string, string>>
      >

      for (const robot of project.robots) {
        const definition = definitionsById.get(robot.definitionId)
        if (definition === undefined) {
          throw new Error(`OPC_UA_ROBOT_DEFINITION_NOT_FOUND: ${robot.definitionId}`)
        }
        const robotPath = `RobotSim/Robots/${robot.id}`
        const robotObject = namespace.addObject({
          componentOf: robotsObject,
          browseName: robot.id,
          nodeId: nodeIdForPath(namespaceIndex, robotPath),
        })
        const jointsPath = `${robotPath}/Joints`
        const jointsObject = namespace.addObject({
          componentOf: robotObject,
          browseName: 'Joints',
          nodeId: nodeIdForPath(namespaceIndex, jointsPath),
        })
        const robotVariables = new Map<string, UAVariable>()
        const robotNodeIds = Object.create(null) as Record<string, string>

        for (const joint of definition.joints) {
          const jointPath = `${jointsPath}/${joint.id}`
          const jointObject = namespace.addObject({
            componentOf: jointsObject,
            browseName: joint.id,
            nodeId: nodeIdForPath(namespaceIndex, jointPath),
          })
          const actualPath = `${jointPath}/Actual`
          const actualNodeId = nodeIdForPath(namespaceIndex, actualPath)
          const actualVariable = namespace.addVariable({
            componentOf: jointObject,
            browseName: 'Actual',
            nodeId: actualNodeId,
            dataType: DataType.Double,
            accessLevel: 'CurrentRead',
            userAccessLevel: 'CurrentRead',
            minimumSamplingInterval: 0,
            value: new Variant({
              dataType: DataType.Double,
              value: robot.initialJointValues[joint.id],
            }),
          })
          robotVariables.set(joint.id, actualVariable)
          robotNodeIds[joint.id] = actualNodeId
        }

        nextVariables.set(robot.id, robotVariables)
        nextNodeIds[robot.id] = robotNodeIds
      }

      await candidate.start()
      server = candidate
      jointVariables = nextVariables
      currentStatus = createStatus(
        mode,
        true,
        options.advertisedPort === 0
          ? candidate.getEndpointUrl()
          : opcUaEndpointUrl(options.advertisedHost, options.advertisedPort),
        namespaceIndex,
        nextNodeIds,
      )
    } catch (error) {
      await candidate.shutdown(0).catch(() => undefined)
      throw error
    }
  }

  async function stopTransition(): Promise<void> {
    const activeServer = server
    if (activeServer === null) return
    server = null
    jointVariables = new Map()
    currentStatus = createStatus(mode, false, null, null, {})
    await activeServer.shutdown(0)
  }

  function start(): Promise<void> {
    return enqueue(startTransition)
  }

  function stop(): Promise<void> {
    return enqueue(stopTransition)
  }

  function publishRobotJointState(
    robotId: string,
    values: Readonly<Record<string, number>>,
  ): Promise<void> {
    return enqueue(async () => {
      if (mode === 'off') {
        throw new Error('OPC_UA_SERVER_MODE_OFF')
      }
      const robotVariables = jointVariables.get(robotId)
      if (robotVariables === undefined) {
        throw new Error(`OPC_UA_ROBOT_NOT_FOUND: ${robotId}`)
      }

      const staged: [UAVariable, number][] = []
      for (const [jointId, value] of Object.entries(values)) {
        const variable = robotVariables.get(jointId)
        if (variable === undefined) {
          throw new Error(`OPC_UA_JOINT_NOT_FOUND: ${robotId}/${jointId}`)
        }
        if (!Number.isFinite(value)) {
          throw new Error(`OPC_UA_JOINT_VALUE_INVALID: ${robotId}/${jointId}`)
        }
        staged.push([variable, value])
      }

      const sourceTimestamp = new Date()
      for (const [variable, value] of staged) {
        variable.setValueFromSource(
          { dataType: DataType.Double, value },
          StatusCodes.Good,
          sourceTimestamp,
        )
      }
    })
  }

  return Object.freeze({
    start,
    stop,
    status: () => currentStatus,
    publishRobotJointState,
  })
}
