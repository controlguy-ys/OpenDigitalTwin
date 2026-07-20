import { validateWorkcellProjectV5 } from './validate.js'
import type { OpcUaNodeAddressV1 } from './opcua-node-address.js'
import type { WorkcellProjectV5 } from './types.js'

export interface WritableBooleanSignalMappingV5 {
  readonly mappingId: string
  readonly endpointId: string
  readonly signalId: string
  readonly nodeAddress: OpcUaNodeAddressV1
  readonly dataType: 'Boolean'
}

/** Compiles the one scalar Boolean shape that may be written by a browser job. */
export function compileWritableBooleanSignalMappingsV5(
  projectInput: WorkcellProjectV5,
): readonly WritableBooleanSignalMappingV5[] {
  const project = validateWorkcellProjectV5(projectInput)
  const endpoints = new Map(project.opcUa.endpoints.map((endpoint) => [endpoint.endpointId, endpoint]))
  const signals = new Map(project.logicalSignals.map((signal) => [signal.id, signal]))
  const mappings: WritableBooleanSignalMappingV5[] = []
  for (const mapping of project.opcUa.mappings) {
    const leaf = mapping.leaves[0]
    const target = leaf?.projectTarget
    const endpoint = endpoints.get(mapping.endpointId)
    if (
      endpoint === undefined || !endpoint.enabled
      || (mapping.direction !== 'write' && mapping.direction !== 'readWrite')
      || mapping.leaves.length !== 1 || leaf === undefined || !leaf.required
      || leaf.leafPath.length !== 0 || leaf.projectPath.length !== 0
      || leaf.opcUaDataType !== 'Boolean' || target?.type !== 'logical-signal'
    ) continue
    const signal = signals.get(target.signalId)
    if (signal === undefined || signal.dataType !== 'Boolean' || (signal.direction !== 'output' && signal.direction !== 'bidirectional')) continue
    mappings.push(Object.freeze({
      mappingId: mapping.id,
      endpointId: mapping.endpointId,
      signalId: signal.id,
      nodeAddress: mapping.nodeAddress,
      dataType: 'Boolean',
    }))
  }
  return Object.freeze(mappings)
}
