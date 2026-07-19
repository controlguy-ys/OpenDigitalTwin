import {
  AttributeIds,
  DataType,
  StatusCodes,
  type ClientSession,
} from 'node-opcua'

import {
  validateWorkcellProjectV5,
  type OpcUaNodeAddressV1,
  type WorkcellProjectV5,
} from '../../src/core/project-v5/index.js'
import { resolveOpcUaNodeAddressV1 } from './opcua-client-read-plan.js'

export interface CompiledOpcUaClientWriteV1 {
  readonly mappingId: string
  readonly endpointId: string
  readonly signalId: string
  readonly nodeAddress: OpcUaNodeAddressV1
  readonly dataType: 'Boolean'
}

export interface OpcUaClientWriteRequestV1 {
  readonly mappingId: string
  readonly value: boolean
}

export type OpcUaClientWriteResultV1 =
  | { readonly ok: true; readonly statusCode: 'Good' }
  | {
      readonly ok: false
      readonly statusCode: string
      readonly failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED' | 'OPC_UA_WRITE_MAPPING_INVALID' | 'OPC_UA_WRITE_REJECTED' | 'OPC_UA_WRITE_FAILED'
      readonly message: string
    }

export interface OpcUaClientSessionLeaseV1 {
  readonly endpointId: string
  readonly generation: number
  readonly session: Pick<ClientSession, 'readNamespaceArray' | 'write'>
}

export interface OpcUaClientWriteServiceDependenciesV1 {
  currentSession(endpointId: string): OpcUaClientSessionLeaseV1 | null
}

export interface OpcUaClientWriteServiceV1 {
  write(request: OpcUaClientWriteRequestV1): Promise<OpcUaClientWriteResultV1>
}

function isWriteDirection(direction: WorkcellProjectV5['opcUa']['mappings'][number]['direction']): boolean {
  return direction === 'write' || direction === 'readWrite'
}

function failed(
  failureCode: Extract<OpcUaClientWriteResultV1, { readonly ok: false }>['failureCode'],
  statusCode: string,
  message: string,
): OpcUaClientWriteResultV1 {
  return Object.freeze({ ok: false, failureCode, statusCode, message })
}

function statusName(statusCode: { readonly name?: string }): string {
  return statusCode.name ?? 'BadCommunicationError'
}

export function compileOpcUaClientWritePlanV1(
  projectInput: WorkcellProjectV5,
): readonly CompiledOpcUaClientWriteV1[] {
  const project = validateWorkcellProjectV5(projectInput)
  const endpointsById = new Map(project.opcUa.endpoints.map((endpoint) => [endpoint.endpointId, endpoint]))
  const signalsById = new Map(project.logicalSignals.map((signal) => [signal.id, signal]))
  const writes: CompiledOpcUaClientWriteV1[] = []

  for (const mapping of project.opcUa.mappings) {
    if (!isWriteDirection(mapping.direction)) continue
    const endpoint = endpointsById.get(mapping.endpointId)
    const leaf = mapping.leaves[0]
    const target = leaf?.projectTarget
    if (
      endpoint === undefined
      || !endpoint.enabled
      || mapping.leaves.length !== 1
      || leaf === undefined
      || !leaf.required
      || leaf.leafPath.length !== 0
      || leaf.projectPath.length !== 0
      || leaf.opcUaDataType !== 'Boolean'
      || target?.type !== 'logical-signal'
    ) continue
    const signal = signalsById.get(target.signalId)
    if (
      signal === undefined
      || signal.dataType !== 'Boolean'
      || (signal.direction !== 'output' && signal.direction !== 'bidirectional')
    ) continue
    writes.push(Object.freeze({
      mappingId: mapping.id,
      endpointId: mapping.endpointId,
      signalId: signal.id,
      nodeAddress: mapping.nodeAddress,
      dataType: 'Boolean',
    }))
  }
  return Object.freeze(writes)
}

export function createOpcUaClientWriteServiceV1(
  projectInput: WorkcellProjectV5,
  dependencies: OpcUaClientWriteServiceDependenciesV1,
): OpcUaClientWriteServiceV1 {
  const writesByMappingId = new Map(
    compileOpcUaClientWritePlanV1(projectInput).map((write) => [write.mappingId, write]),
  )

  return Object.freeze({
    async write(request: OpcUaClientWriteRequestV1): Promise<OpcUaClientWriteResultV1> {
      const write = writesByMappingId.get(request.mappingId)
      if (write === undefined || typeof request.value !== 'boolean') {
        return failed('OPC_UA_WRITE_MAPPING_INVALID', 'BadInvalidArgument', 'Mapping is not a writable Boolean output.')
      }
      const firstLease = dependencies.currentSession(write.endpointId)
      if (firstLease === null) {
        return failed('OPC_UA_ENDPOINT_DISCONNECTED', 'BadNoCommunication', 'Endpoint is not connected.')
      }

      let namespaceArray: readonly string[]
      try {
        namespaceArray = await firstLease.session.readNamespaceArray()
      } catch {
        return failed('OPC_UA_WRITE_FAILED', 'BadCommunicationError', 'Namespace Array read failed.')
      }

      let nodeId: string
      try {
        nodeId = resolveOpcUaNodeAddressV1(write.nodeAddress, namespaceArray)
      } catch {
        return failed('OPC_UA_WRITE_FAILED', 'BadNodeIdUnknown', 'Mapping Namespace URI is absent from the Session.')
      }
      const currentLease = dependencies.currentSession(write.endpointId)
      if (
        currentLease === null
        || currentLease.generation !== firstLease.generation
        || currentLease.session !== firstLease.session
      ) {
        return failed('OPC_UA_ENDPOINT_DISCONNECTED', 'BadNoCommunication', 'Endpoint Session changed before write.')
      }

      try {
        const statusCode = await firstLease.session.write({
          nodeId,
          attributeId: AttributeIds.Value,
          value: { value: { dataType: DataType.Boolean, value: request.value } },
        })
        if (statusCode.value === StatusCodes.Good.value) {
          return Object.freeze({ ok: true, statusCode: 'Good' })
        }
        return failed(
          'OPC_UA_WRITE_REJECTED',
          statusName(statusCode),
          `OPC UA write was rejected with ${statusName(statusCode)}.`,
        )
      } catch {
        return failed('OPC_UA_WRITE_FAILED', 'BadCommunicationError', 'OPC UA write failed.')
      }
    },
  })
}
