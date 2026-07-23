import {
  MessageSecurityMode,
  OPCUACertificateManager,
  OPCUAServer,
  SecurityPolicy,
  UserTokenType,
} from 'node-opcua'
import { join } from 'node:path'

import {
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../../src/core/project-v5/index.js'
import { ROBOTICS_NODESET_FILES_V1 } from './opcua-nodeset-contract.js'
import {
  OPC_UA_ROBOTICS_INSTANCES_NAMESPACE_URI_V1,
  instantiateOpcUaRoboticsModelV1,
  type OpcUaRoboticsModelV1,
} from './opcua-robotics-model.js'
import { projectRoboticsSystemV1 } from './opcua-robotics-projection.js'
import {
  OPENWEB_MODEL_NAMESPACE_URI_V1,
  assertCanonicalConfigRevisionV1,
  instantiateOpcUaOpenWebModelV1,
  type OpcUaOpenWebModelV1,
  type ServerActualSnapshotV1,
} from './opcua-openweb-model.js'

export interface OpcUaServerAdapterOptionsV1 {
  readonly host: string
  readonly advertisedHost: string
  readonly advertisedPort: number
  readonly port: number
  readonly pkiRootDir: string
  readonly configRevision: string
}

export interface OpcUaServerAdapterStatusV1 {
  readonly mode: 'off' | 'server'
  readonly started: boolean
  readonly endpointUrl: string | null
  readonly namespaceUri: typeof OPC_UA_ROBOTICS_INSTANCES_NAMESPACE_URI_V1
  readonly namespaceIndex: number | null
  readonly nodeIds: Readonly<Record<string, Readonly<Record<string, string>>>>
  readonly productNamespaceUri: typeof OPENWEB_MODEL_NAMESPACE_URI_V1
  readonly productNamespaceIndex: number | null
  readonly productRootNodeId: string | null
}

export interface OpcUaServerAdapterV1 {
  start(): Promise<void>
  stop(): Promise<void>
  status(): OpcUaServerAdapterStatusV1
  publishRobotJointState(
    robotId: string,
    values: Readonly<Record<string, number>>,
  ): Promise<void>
  publishActualSnapshot(snapshot: ServerActualSnapshotV1): Promise<void>
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
  productNamespaceIndex: number | null,
  productRootNodeId: string | null,
): OpcUaServerAdapterStatusV1 {
  return Object.freeze({
    mode,
    started,
    endpointUrl,
    namespaceUri: OPC_UA_ROBOTICS_INSTANCES_NAMESPACE_URI_V1,
    namespaceIndex,
    nodeIds: freezeNodeIds(nodeIds),
    productNamespaceUri: OPENWEB_MODEL_NAMESPACE_URI_V1,
    productNamespaceIndex,
    productRootNodeId,
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
  const configRevision = options.configRevision
  assertCanonicalConfigRevisionV1(configRevision)
  let server: OPCUAServer | null = null
  let roboticsModel: OpcUaRoboticsModelV1 | null = null
  let openWebModel: OpcUaOpenWebModelV1 | null = null
  let currentStatus = createStatus(mode, false, null, null, {}, null, null)
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
      nodeset_filename: [...ROBOTICS_NODESET_FILES_V1],
      maxConnectionsPerEndpoint: 16,
    })

    try {
      await candidate.initialize()
      keepAnonymousUserTokenOnly(candidate)

      const addressSpace = candidate.engine.addressSpace
      if (addressSpace === null) {
        throw new Error('OPC_UA_ADDRESS_SPACE_UNAVAILABLE')
      }
      const productNamespace = addressSpace.registerNamespace(
        OPENWEB_MODEL_NAMESPACE_URI_V1,
      )
      const namespace = addressSpace.registerNamespace(
        OPC_UA_ROBOTICS_INSTANCES_NAMESPACE_URI_V1,
      )
      const nextModel = instantiateOpcUaRoboticsModelV1({
        addressSpace,
        projection: projectRoboticsSystemV1(project),
        instancesNamespace: namespace,
      })
      const nextOpenWebModel = instantiateOpcUaOpenWebModelV1({
        addressSpace,
        modelNamespace: productNamespace,
        instancesNamespace: namespace,
        project,
        configRevision,
      })

      await candidate.start()
      server = candidate
      roboticsModel = nextModel
      openWebModel = nextOpenWebModel
      currentStatus = createStatus(
        mode,
        true,
        options.advertisedPort === 0
          ? candidate.getEndpointUrl()
          : opcUaEndpointUrl(options.advertisedHost, options.advertisedPort),
        namespace.index,
        nextModel.axisActualNodeIds,
        productNamespace.index,
        nextOpenWebModel.rootNodeId,
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
    openWebModel?.dispose()
    openWebModel = null
    roboticsModel?.dispose()
    roboticsModel = null
    currentStatus = createStatus(mode, false, null, null, {}, null, null)
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
      const publishedNodeIds = currentStatus.nodeIds[robotId]
      if (publishedNodeIds === undefined) {
        throw new Error(`OPC_UA_ROBOT_NOT_FOUND: ${robotId}`)
      }

      for (const [jointId, value] of Object.entries(values)) {
        if (!Object.hasOwn(publishedNodeIds, jointId)) {
          throw new Error(`OPC_UA_JOINT_NOT_FOUND: ${robotId}/${jointId}`)
        }
        if (!Number.isFinite(value)) {
          throw new Error(`OPC_UA_JOINT_VALUE_INVALID: ${robotId}/${jointId}`)
        }
      }

      const activeModel = roboticsModel
      if (activeModel === null) {
        throw new Error('OPC_UA_ROBOTICS_MODEL_UNAVAILABLE')
      }
      for (const [jointId, value] of Object.entries(values)) {
        activeModel.publishJointActual(robotId, jointId, value)
      }
    })
  }

  function publishActualSnapshot(snapshot: ServerActualSnapshotV1): Promise<void> {
    return enqueue(async () => {
      if (mode === 'off') throw new Error('OPC_UA_SERVER_MODE_OFF')
      const activeRoboticsModel = roboticsModel
      if (activeRoboticsModel === null) throw new Error('OPC_UA_ROBOTICS_MODEL_UNAVAILABLE')
      const activeOpenWebModel = openWebModel
      if (activeOpenWebModel === null) throw new Error('OPC_UA_OPENWEB_MODEL_UNAVAILABLE')

      for (const [robotId, values] of Object.entries(snapshot.robots)) {
        const publishedNodeIds = currentStatus.nodeIds[robotId]
        if (publishedNodeIds === undefined) throw new Error(`OPC_UA_ROBOT_NOT_FOUND: ${robotId}`)
        for (const [jointId, value] of Object.entries(values)) {
          if (!Object.hasOwn(publishedNodeIds, jointId)) {
            throw new Error(`OPC_UA_JOINT_NOT_FOUND: ${robotId}/${jointId}`)
          }
          if (!Number.isFinite(value)) throw new Error(`OPC_UA_JOINT_VALUE_INVALID: ${robotId}/${jointId}`)
        }
      }

      activeOpenWebModel.publishSnapshot(snapshot)
      for (const [robotId, values] of Object.entries(snapshot.robots)) {
        for (const [jointId, value] of Object.entries(values)) {
          activeRoboticsModel.publishJointActual(robotId, jointId, value)
        }
      }
    })
  }

  return Object.freeze({
    start,
    stop,
    status: () => currentStatus,
    publishRobotJointState,
    publishActualSnapshot,
  })
}
