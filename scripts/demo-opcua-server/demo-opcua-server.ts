import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  DataType,
  MessageSecurityMode,
  OPCUACertificateManager,
  OPCUAServer,
  SecurityPolicy,
  StatusCodes,
  Variant,
  type UAVariable,
} from 'node-opcua'

import { createTrakDemoModel, type TrakDemoModel } from './trak-demo-model.js'

export const BR_PV_NAMESPACE_URI = 'http://br-automation.com/OpcUa/PLC/PV/'

type ObjectPoseField = 'X' | 'Y' | 'Z' | 'Roll' | 'Pitch' | 'Yaw'
type RobotField = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6' | 'Status'

export interface DemoOpcUaNodeIds {
  readonly button: string
  readonly jobId: string
  readonly jobs: readonly string[]
  readonly robot: Readonly<Record<RobotField, string>>
  readonly objectPos: readonly Readonly<Record<ObjectPoseField, string>>[]
  readonly objectPosCli: Readonly<Record<ObjectPoseField, string>>
}

export interface StartedDemoOpcUaServer {
  readonly endpointUrl: string
  readonly namespaceIndex: number
  readonly nodeIds: DemoOpcUaNodeIds
}

export interface DemoOpcUaServer {
  readonly model: TrakDemoModel
  start(): Promise<StartedDemoOpcUaServer>
  stop(): Promise<void>
}

export interface DemoOpcUaServerOptions {
  readonly host?: string
  readonly advertisedHost?: string
  readonly port?: number
  readonly tickMs?: number
  readonly pkiRootDir?: string
  readonly autoStartRobot?: boolean
}

function pvNodeId(namespaceIndex: number, identifier: string): string {
  return `ns=${namespaceIndex};s=::Sample6X:${identifier}`
}

function validateOptions(options: DemoOpcUaServerOptions): Required<DemoOpcUaServerOptions> {
  const port = options.port ?? 4_840
  const tickMs = options.tickMs ?? 100
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('port must be an integer between 0 and 65535.')
  }
  if (!Number.isFinite(tickMs) || tickMs < 10) {
    throw new Error('tickMs must be a finite number of at least 10 ms.')
  }
  return {
    host: options.host ?? '127.0.0.1',
    advertisedHost: options.advertisedHost ?? '127.0.0.1',
    port,
    tickMs,
    pkiRootDir: options.pkiRootDir ?? join(tmpdir(), 'open-digital-twin-demo-opcua-pki'),
    autoStartRobot: options.autoStartRobot ?? false,
  }
}

export function createDemoOpcUaServer(
  optionsInput: DemoOpcUaServerOptions = {},
): DemoOpcUaServer {
  const options = validateOptions(optionsInput)
  const model = createTrakDemoModel()
  let server: OPCUAServer | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let started: StartedDemoOpcUaServer | null = null
  let publishSnapshot: (() => void) | null = null

  async function start(): Promise<StartedDemoOpcUaServer> {
    if (started !== null) return started

    const certificateManager = new OPCUACertificateManager({
      rootFolder: options.pkiRootDir,
      name: 'demo-server-pki',
      disableFileWatchers: true,
    })
    const candidate = new OPCUAServer({
      host: options.host,
      hostname: options.advertisedHost,
      port: options.port,
      resourcePath: '',
      allowAnonymous: true,
      securityModes: [MessageSecurityMode.None],
      securityPolicies: [SecurityPolicy.None],
      serverCertificateManager: certificateManager,
      serverInfo: {
        applicationName: { text: 'OpenDigitalTwin TrakDemo OPC UA Server' },
        applicationUri: 'urn:open-digital-twin:demo:trak',
        productUri: 'urn:open-digital-twin:demo',
      },
    })

    try {
      await candidate.initialize()
      const addressSpace = candidate.engine.addressSpace
      if (addressSpace === null) throw new Error('OPC_UA_ADDRESS_SPACE_UNAVAILABLE')

      while (addressSpace.getNamespaceArray().length < 5) {
        const index = addressSpace.getNamespaceArray().length
        addressSpace.registerNamespace(`urn:open-digital-twin:demo:filler:${index}`)
      }
      const namespace = addressSpace.registerNamespace(BR_PV_NAMESPACE_URI)
      if (namespace.index !== 5) {
        throw new Error(`B&R demo namespace must be index 5, received ${namespace.index}.`)
      }

      const sample6x = namespace.addObject({
        organizedBy: addressSpace.rootFolder.objects,
        browseName: 'Sample6X',
        nodeId: pvNodeId(namespace.index, 'Sample6X'),
      })
      const variables: UAVariable[] = []
      const valueReaders: Array<() => number> = []
      const valueDataTypes: DataType[] = []

      function addNumericVariable(
        identifier: string,
        dataType: DataType,
        read: () => number,
      ): UAVariable {
        const variable = namespace.addVariable({
          componentOf: sample6x,
          browseName: identifier,
          nodeId: pvNodeId(namespace.index, identifier),
          dataType,
          accessLevel: 'CurrentRead',
          userAccessLevel: 'CurrentRead',
          minimumSamplingInterval: options.tickMs,
          value: new Variant({ dataType, value: read() }),
        })
        variables.push(variable)
        valueReaders.push(read)
        valueDataTypes.push(dataType)
        return variable
      }

      const buttonNodeId = pvNodeId(namespace.index, 'Button')
      namespace.addVariable({
        componentOf: sample6x,
        browseName: 'Button',
        nodeId: buttonNodeId,
        dataType: DataType.Int32,
        minimumSamplingInterval: options.tickMs,
        value: {
          get: () => new Variant({ dataType: DataType.Int32, value: model.snapshot().button }),
          set: (variant: Variant) => {
            if (variant.dataType !== DataType.Int32 || !Number.isFinite(Number(variant.value))) {
              return StatusCodes.BadTypeMismatch
            }
            model.writeButton(Number(variant.value))
            return StatusCodes.Good
          },
        },
      })

      const jobIdNodeId = pvNodeId(namespace.index, 'JobID')
      addNumericVariable('JobID', DataType.Int32, () => model.snapshot().jobId)
      const jobNodeIds = Array.from({ length: 20 }, (_, index) => {
        const identifier = `Job${index + 1}`
        addNumericVariable(identifier, DataType.Int32, () => model.snapshot().jobStatus[index] ?? 0)
        return pvNodeId(namespace.index, identifier)
      })

      const robotFields = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Status'] as const
      const robotKeys = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'status'] as const
      const robotNodeIds = Object.create(null) as Record<RobotField, string>
      robotFields.forEach((field, index) => {
        const identifier = `Rob.${field}`
        addNumericVariable(
          identifier,
          field === 'Status' ? DataType.Int32 : DataType.Double,
          () => model.snapshot().robot[robotKeys[index]!],
        )
        robotNodeIds[field] = pvNodeId(namespace.index, identifier)
      })

      const objectFields = ['X', 'Y', 'Z', 'Roll', 'Pitch', 'Yaw'] as const
      const objectKeys = ['x', 'y', 'z', 'roll', 'pitch', 'yaw'] as const
      const objectNodeIds = Array.from({ length: 20 }, (_, objectIndex) => {
        const fields = Object.create(null) as Record<ObjectPoseField, string>
        objectFields.forEach((field, fieldIndex) => {
          const identifier = `ObjectPos[${objectIndex}].${field}`
          addNumericVariable(
            identifier,
            DataType.Double,
            () => model.snapshot().objectPos[objectIndex]![objectKeys[fieldIndex]!],
          )
          fields[field] = pvNodeId(namespace.index, identifier)
        })
        return Object.freeze(fields)
      })
      const objectPosCliNodeIds = Object.create(null) as Record<ObjectPoseField, string>
      objectFields.forEach((field, fieldIndex) => {
        const identifier = `ObjectPosCli.${field}`
        addNumericVariable(
          identifier,
          DataType.Double,
          () => model.snapshot().objectPosCli[objectKeys[fieldIndex]!],
        )
        objectPosCliNodeIds[field] = pvNodeId(namespace.index, identifier)
      })

      publishSnapshot = () => {
        const timestamp = new Date()
        variables.forEach((variable, index) => {
          variable.setValueFromSource(
            { dataType: valueDataTypes[index]!, value: valueReaders[index]!() },
            StatusCodes.Good,
            timestamp,
          )
        })
      }
      publishSnapshot()
      if (options.autoStartRobot) model.writeButton(1)

      await candidate.start()
      server = candidate
      timer = setInterval(() => {
        model.step(options.tickMs / 1_000)
        publishSnapshot?.()
      }, options.tickMs)

      started = Object.freeze({
        endpointUrl: candidate.getEndpointUrl(),
        namespaceIndex: namespace.index,
        nodeIds: Object.freeze({
          button: buttonNodeId,
          jobId: jobIdNodeId,
          jobs: Object.freeze(jobNodeIds),
          robot: Object.freeze(robotNodeIds),
          objectPos: Object.freeze(objectNodeIds),
          objectPosCli: Object.freeze(objectPosCliNodeIds),
        }),
      })
      return started
    } catch (error) {
      await candidate.shutdown(0).catch(() => undefined)
      throw error
    }
  }

  async function stop(): Promise<void> {
    if (timer !== null) clearInterval(timer)
    timer = null
    publishSnapshot = null
    started = null
    const activeServer = server
    server = null
    if (activeServer !== null) await activeServer.shutdown(0)
  }

  return Object.freeze({ model, start, stop })
}
