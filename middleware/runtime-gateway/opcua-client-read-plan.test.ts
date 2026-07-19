import { describe, expect, it } from 'vitest'

import {
  opcUaNodeAddressKeyV1,
  validateWorkcellProjectV5,
  type OpcUaMappingV5,
  type WorkcellProjectV5,
} from '../../src/core/project-v5/index.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../src/core/project-v5/test-support.js'
import {
  compileOpcUaClientReadPlanV1,
  groupResolvedRootsBySamplingIntervalV1,
  resolveOpcUaClientReadRootsV1,
} from './opcua-client-read-plan.js'

function readMapping(
  id: string,
  signalId: string,
  identifier: string,
  leafPath: readonly (string | number)[],
  publishingIntervalMs?: number,
): OpcUaMappingV5 {
  return {
    id,
    endpointId: 'plc',
    nodeAddress: {
      namespaceUri: 'urn:virtual-plc',
      identifierType: 'string',
      identifier,
    },
    direction: 'read',
    ...(publishingIntervalMs === undefined ? {} : { publishingIntervalMs }),
    coherenceGroupId: null,
    interpolationMode: 'none',
    coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
    leaves: [{
      leafPath,
      projectPath: [],
      projectTarget: { type: 'logical-signal', signalId },
      opcUaDataType: 'Boolean',
      projectDataType: 'boolean',
      scale: 1,
      offset: 0,
      unit: '',
      required: true,
    }],
  }
}

function projectWithReadMappings(mappings: readonly OpcUaMappingV5[]): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project.logicalSignals as unknown as WorkcellProjectV5['logicalSignals'][number][]).splice(0, 1,
    { id: 'signal-a', name: 'Signal A', dataType: 'Boolean', direction: 'input', initialValue: false, unit: '', scope: { type: 'project' } },
    { id: 'signal-b', name: 'Signal B', dataType: 'Boolean', direction: 'input', initialValue: false, unit: '', scope: { type: 'project' } },
  )
  ;(project.opcUa.endpoints as unknown as WorkcellProjectV5['opcUa']['endpoints'][number][]).splice(0, 1, {
    endpointId: 'plc', name: 'PLC', endpointUrl: 'opc.tcp://127.0.0.1:4840', enabled: true,
    publishingIntervalMs: 100, reconnectDelayMs: 10,
  })
  ;(project.opcUa.mappings as unknown as OpcUaMappingV5[]).splice(0, 1, ...mappings)
  return validateWorkcellProjectV5(project)
}

describe('OPC UA Client Read Plan V1', () => {
  it('deduplicates a shared root endpoint-wide and fans out in Mapping order', () => {
    const address = {
      namespaceUri: 'urn:virtual-plc', identifierType: 'string' as const, identifier: 'Box.Position',
    }
    const project = projectWithReadMappings([
      readMapping('box-pose', 'signal-a', address.identifier, ['present'], 50),
      readMapping('box-status', 'signal-b', address.identifier, ['ready'], 100),
    ])

    const endpoint = compileOpcUaClientReadPlanV1(project)[0]!

    expect(endpoint.monitoredRoots).toEqual([expect.objectContaining({
      rootKey: `plc\0${opcUaNodeAddressKeyV1(address)}`,
      mappingIds: ['box-pose', 'box-status'],
      samplingIntervalMs: 50,
    })])
  })

  it('keeps roots with different sampling intervals in separate monitored groups', () => {
    const project = projectWithReadMappings([
      readMapping('fast', 'signal-a', 'Signals.Fast', [], 50),
      readMapping('slow', 'signal-b', 'Signals.Slow', [], 100),
    ])
    const endpoint = compileOpcUaClientReadPlanV1(project)[0]!

    const resolved = resolveOpcUaClientReadRootsV1(endpoint.monitoredRoots, [
      'http://opcfoundation.org/UA/', 'urn:virtual-plc',
    ])

    expect(groupResolvedRootsBySamplingIntervalV1(resolved)).toEqual([
      expect.objectContaining({ samplingIntervalMs: 50, roots: [expect.objectContaining({ mappingIds: ['fast'] })] }),
      expect.objectContaining({ samplingIntervalMs: 100, roots: [expect.objectContaining({ mappingIds: ['slow'] })] }),
    ])
  })
})
