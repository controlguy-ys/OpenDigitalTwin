import { describe, expect, it } from 'vitest'

import {
  opcUaNodeAddressKeyV1,
  validateWorkcellProjectV5,
  type OpcUaMappingV5,
  type WorkcellProjectV5,
} from '../../src/core/project-v5/index.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../src/core/project-v5/test-support.js'
import {
  assembleMappingValueV1,
  compileOpcUaClientReadPlanV1,
  groupResolvedRootsBySamplingIntervalV1,
  resolveOpcUaNodeAddressV1,
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

function assemblyMapping(
  leaves: readonly Record<string, unknown>[],
): OpcUaMappingV5 {
  return {
    id: 'assembly-mapping',
    endpointId: 'plc',
    nodeAddress: { namespaceUri: 'urn:virtual-plc', identifierType: 'string', identifier: 'Machine.Root' },
    direction: 'read',
    coherenceGroupId: null,
    interpolationMode: 'none',
    coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
    leaves,
  } as unknown as OpcUaMappingV5
}

function assemblyLeaf(
  leafPath: readonly (string | number)[],
  projectPath: readonly (string | number)[],
  opcUaDataType: string,
  projectDataType: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    leafPath,
    projectPath,
    projectTarget: { type: 'entity-status', entityId: 'entity-1' },
    opcUaDataType,
    projectDataType,
    scale: 1,
    offset: 0,
    unit: '',
    required: true,
    ...overrides,
  }
}

describe('OPC UA Client Read Plan V1', () => {
  it('resolves namespace URIs to canonical NodeIds for every supported identifier kind', () => {
    const namespaces = ['http://opcfoundation.org/UA/', 'urn:other', 'urn:virtual-plc']

    expect(resolveOpcUaNodeAddressV1(
      { namespaceUri: 'urn:virtual-plc', identifierType: 'string', identifier: 'Machine.State' }, namespaces,
    )).toBe('ns=2;s=Machine.State')
    expect(resolveOpcUaNodeAddressV1(
      { namespaceUri: 'urn:virtual-plc', identifierType: 'numeric', identifier: '42' }, namespaces,
    )).toBe('ns=2;i=42')
    expect(resolveOpcUaNodeAddressV1(
      { namespaceUri: 'urn:virtual-plc', identifierType: 'guid', identifier: '550e8400-e29b-41d4-a716-446655440000' }, namespaces,
    )).toBe('ns=2;g=550e8400-e29b-41d4-a716-446655440000')
    expect(resolveOpcUaNodeAddressV1(
      { namespaceUri: 'urn:virtual-plc', identifierType: 'byteString', identifier: 'AQID' }, namespaces,
    )).toBe('ns=2;b=AQID')
  })

  it('rejects a NodeAddress whose namespace URI is absent from this Session', () => {
    expect(() => resolveOpcUaNodeAddressV1(
      { namespaceUri: 'urn:missing', identifierType: 'string', identifier: 'Machine.State' },
      ['http://opcfoundation.org/UA/'],
    )).toThrow('OPC_UA_NAMESPACE_URI_NOT_FOUND')
  })

  it('extracts Float64Array and ExtensionObject source leaves independently from their Project destinations', () => {
    const mapping = assemblyMapping([
      assemblyLeaf(['extension', 'values', 1], ['measurement', 'x'], 'Double', 'number', { scale: 0.5, offset: 1 }),
      assemblyLeaf(['extension', 'name'], ['metadata', 'label'], 'String', 'string'),
    ])
    const extensionObject = Object.assign(Object.create(null), {
      values: new Float64Array([2, 8]),
      name: 'fixture',
    })

    expect(assembleMappingValueV1(mapping, { extension: extensionObject })).toEqual({
      ok: true,
      value: { measurement: { x: 5 }, metadata: { label: 'fixture' } },
      unit: '',
    })
  })

  it('builds exactly the canonical frame shape and performs one RPY-to-quaternion conversion', () => {
    const target = { type: 'robot-frame', robotId: 'robot-1', frameId: 'Tool' }
    const mapping = assemblyMapping([
      assemblyLeaf(['pose', 'position', 0], ['positionM', 0], 'Double', 'number', { projectTarget: target, scale: 0.001, unit: 'metre' }),
      assemblyLeaf(['pose', 'position', 1], ['positionM', 1], 'Double', 'number', { projectTarget: target, scale: 0.001, unit: 'metre' }),
      assemblyLeaf(['pose', 'position', 2], ['positionM', 2], 'Double', 'number', { projectTarget: target, scale: 0.001, unit: 'metre' }),
      assemblyLeaf(['pose', 'rpy', 0], ['rpyDegrees', 0], 'Double', 'number', { projectTarget: target, unit: 'degree' }),
      assemblyLeaf(['pose', 'rpy', 1], ['rpyDegrees', 1], 'Double', 'number', { projectTarget: target, unit: 'degree' }),
      assemblyLeaf(['pose', 'rpy', 2], ['rpyDegrees', 2], 'Double', 'number', { projectTarget: target, unit: 'degree' }),
    ])

    const result = assembleMappingValueV1(mapping, {
      pose: { position: new Float64Array([1_000, 2_000, 3_000]), rpy: [0, 0, 90] },
    })

    expect(result).toMatchObject({ ok: true, value: { positionM: [1, 2, 3] } })
    if (!result.ok || typeof result.value !== 'object' || Array.isArray(result.value)) throw new Error('Expected canonical frame.')
    expect(Object.keys(result.value).sort()).toEqual(['positionM', 'quaternion'])
    const quaternion = (result.value as { readonly quaternion: readonly number[] }).quaternion
    expect(quaternion).toEqual(expect.arrayContaining([expect.any(Number)]))
    expect(quaternion[2]).toBeCloseTo(Math.SQRT1_2)
    expect(quaternion[3]).toBeCloseTo(Math.SQRT1_2)
  })

  it('enforces Boolean, String, integer, and floating-point OPC UA type contracts', () => {
    const booleanMapping = assemblyMapping([assemblyLeaf([], [], 'Boolean', 'boolean')])
    const stringMapping = assemblyMapping([assemblyLeaf([], [], 'String', 'string')])
    const integerMapping = assemblyMapping([assemblyLeaf([], [], 'Int16', 'integer', { scale: 0.5, offset: 0.25 })])
    const floatingMapping = assemblyMapping([assemblyLeaf([], [], 'Double', 'number')])

    expect(assembleMappingValueV1(booleanMapping, true)).toMatchObject({ ok: true, value: true })
    expect(assembleMappingValueV1(booleanMapping, 1)).toMatchObject({ ok: false, statusCode: 'BadTypeMismatch' })
    expect(assembleMappingValueV1(stringMapping, 'ready')).toMatchObject({ ok: true, value: 'ready' })
    expect(assembleMappingValueV1(stringMapping, false)).toMatchObject({ ok: false, statusCode: 'BadTypeMismatch' })
    expect(assembleMappingValueV1(integerMapping, 5)).toMatchObject({ ok: true, value: 2 })
    expect(assembleMappingValueV1(integerMapping, 5.5)).toMatchObject({ ok: false, statusCode: 'BadTypeMismatch' })
    expect(assembleMappingValueV1(integerMapping, 40_000)).toMatchObject({ ok: false, statusCode: 'BadOutOfRange' })
    expect(assembleMappingValueV1(floatingMapping, Number.NaN)).toMatchObject({ ok: false, statusCode: 'BadTypeMismatch' })
  })

  it('rejects non-finite scaled values and preserves integer truncation after valid scaling', () => {
    const overflow = assemblyMapping([assemblyLeaf([], [], 'Double', 'number', { scale: Number.MAX_VALUE, offset: Number.MAX_VALUE })])
    const integer = assemblyMapping([assemblyLeaf([], [], 'UInt32', 'integer', { scale: 0.6, offset: 0 })])

    expect(assembleMappingValueV1(overflow, Number.MAX_VALUE)).toMatchObject({ ok: false, statusCode: 'BadOutOfRange' })
    expect(assembleMappingValueV1(integer, 9)).toMatchObject({ ok: true, value: 5 })
  })

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
