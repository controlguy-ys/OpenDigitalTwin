import { describe, expect, it } from 'vitest'

import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from './test-support.js'
import { validateWorkcellProjectV5, type WorkcellProjectV5 } from './index.js'
import { compileWritableBooleanSignalMappingsV5 } from './opcua-boolean-write-targets.js'
import type { LogicalSignalV1, OpcUaMappingV5 } from './types.js'

function writableProject(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  const signal = project.logicalSignals[0] as unknown as { id: string; direction: string }
  signal.id = 'start'
  signal.direction = 'output'
  const endpoint = project.opcUa.endpoints[0] as unknown as { endpointId: string; enabled: boolean }
  endpoint.endpointId = 'plc'
  endpoint.enabled = true
  const mapping = project.opcUa.mappings[0] as unknown as {
    id: string; endpointId: string; direction: string; leaves: Array<Record<string, unknown>>
  }
  mapping.id = 'map-start'
  mapping.endpointId = 'plc'
  mapping.direction = 'write'
  mapping.leaves[0]!.projectTarget = { type: 'logical-signal', signalId: 'start' }
  return validateWorkcellProjectV5(project)
}

function booleanSignal(id: string, direction: LogicalSignalV1['direction']): LogicalSignalV1 {
  return { id, name: id, dataType: 'Boolean', direction, initialValue: false, unit: '', scope: { type: 'project' } }
}

function mappingFor(
  template: OpcUaMappingV5,
  id: string,
  signalId: string,
  direction: OpcUaMappingV5['direction'],
  options: { readonly endpointId?: string; readonly required?: boolean; readonly leafPath?: readonly (string | number)[] } = {},
): OpcUaMappingV5 {
  const mapping = structuredClone(template)
  ;(mapping as unknown as { id: string }).id = id
  ;(mapping as unknown as { endpointId: string }).endpointId = options.endpointId ?? 'plc'
  ;(mapping as unknown as { direction: OpcUaMappingV5['direction'] }).direction = direction
  ;(mapping.nodeAddress as unknown as { identifier: string }).identifier = `Signals.${id}`
  const leaf = mapping.leaves[0] as unknown as {
    required: boolean
    leafPath: readonly (string | number)[]
    projectTarget: { type: 'logical-signal'; signalId: string }
  }
  leaf.required = options.required ?? true
  leaf.leafPath = options.leafPath ?? []
  leaf.projectTarget = { type: 'logical-signal', signalId }
  return mapping
}

function orderedDecoyProject(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(writableProject())
  const template = project.opcUa.mappings[0]!
  ;(project.logicalSignals as unknown as LogicalSignalV1[]).splice(
    0,
    project.logicalSignals.length,
    booleanSignal('input', 'input'),
    booleanSignal('start', 'output'),
    booleanSignal('both', 'bidirectional'),
    { ...booleanSignal('count', 'output'), dataType: 'Int32', initialValue: 0 },
  )
  const endpoint = structuredClone(project.opcUa.endpoints[0]!) as unknown as { endpointId: string; name: string; enabled: boolean }
  endpoint.endpointId = 'disabled-plc'
  endpoint.name = 'Disabled PLC'
  endpoint.enabled = false
  ;(project.opcUa.endpoints as unknown as unknown[]).push(endpoint)
  const read = mappingFor(template, 'decoy-read', 'input', 'read')
  const disabled = mappingFor(template, 'decoy-disabled', 'start', 'write', { endpointId: 'disabled-plc' })
  const optional = mappingFor(template, 'decoy-optional', 'start', 'write', { required: false })
  const nonRoot = mappingFor(template, 'decoy-non-root', 'start', 'write', { leafPath: ['value'] })
  const twoLeaf = mappingFor(template, 'decoy-two-leaf', 'start', 'write', { leafPath: ['left'] })
  const secondLeaf = structuredClone(twoLeaf.leaves[0]!) as unknown as { leafPath: readonly string[] }
  secondLeaf.leafPath = ['right']
  ;(twoLeaf.leaves as unknown as unknown[]).push(secondLeaf)
  const integer = mappingFor(template, 'decoy-integer', 'count', 'write')
  const integerLeaf = integer.leaves[0] as unknown as { opcUaDataType: string; projectDataType: string }
  integerLeaf.opcUaDataType = 'Int32'
  integerLeaf.projectDataType = 'integer'
  const nonLogical = mappingFor(template, 'decoy-non-logical', 'start', 'write')
  const statusLeaf = nonLogical.leaves[0] as unknown as {
    opcUaDataType: string
    projectDataType: string
    projectTarget: { type: 'robot-status'; robotId: string }
  }
  statusLeaf.opcUaDataType = 'Double'
  statusLeaf.projectDataType = 'number'
  statusLeaf.projectTarget = { type: 'robot-status', robotId: 'robot-1' }
  const first = mappingFor(template, 'valid-write', 'start', 'write')
  const second = mappingFor(template, 'valid-read-write', 'both', 'readWrite')
  ;(project.opcUa.mappings as unknown as OpcUaMappingV5[]).splice(
    0,
    project.opcUa.mappings.length,
    read,
    disabled,
    optional,
    nonRoot,
    twoLeaf,
    integer,
    nonLogical,
    first,
    second,
  )
  return validateWorkcellProjectV5(project)
}

describe('compileWritableBooleanSignalMappingsV5', () => {
  it('preserves authored order for write and readWrite candidates among every valid decoy', () => {
    expect(compileWritableBooleanSignalMappingsV5(orderedDecoyProject()).map(({ mappingId, signalId }) => ({ mappingId, signalId }))).toEqual([
      { mappingId: 'valid-write', signalId: 'start' },
      { mappingId: 'valid-read-write', signalId: 'both' },
    ])
  })

  it('returns all authored writable candidates so consumers can detect ambiguity', () => {
    const project = cloneWorkcellProjectV5(writableProject())
    const second = structuredClone(project.opcUa.mappings[0]!) as unknown as { id: string; nodeAddress: { identifier: string } }
    second.id = 'map-start-second'
    second.nodeAddress.identifier = 'Start.Second'
    ;(project.opcUa.mappings as unknown as unknown[]).push(second)
    expect(compileWritableBooleanSignalMappingsV5(validateWorkcellProjectV5(project)).map(({ mappingId }) => mappingId)).toEqual([
      'map-start', 'map-start-second',
    ])
  })

  it('rejects a Project whose Mapping references a missing Endpoint before compilation', () => {
    const project = cloneWorkcellProjectV5(writableProject())
    ;(project.opcUa.mappings[0] as unknown as { endpointId: string }).endpointId = 'missing'
    expect(() => compileWritableBooleanSignalMappingsV5(project)).toThrow()
  })

  it('returns the valid Mapping in authored order, frozen and without mutating the Project', () => {
    const project = writableProject()
    const before = JSON.stringify(project)
    const compiled = compileWritableBooleanSignalMappingsV5(project)
    expect(compiled).toEqual([expect.objectContaining({
      mappingId: 'map-start', endpointId: 'plc', signalId: 'start', dataType: 'Boolean',
    })])
    expect(Object.isFrozen(compiled)).toBe(true)
    expect(Object.isFrozen(compiled[0])).toBe(true)
    expect(JSON.stringify(project)).toBe(before)
  })

  it.each([
    ['disabled Endpoint', (project: WorkcellProjectV5) => { (project.opcUa.endpoints[0] as any).enabled = false }],
    ['read direction', (project: WorkcellProjectV5) => { (project.opcUa.mappings[0] as any).direction = 'read'; (project.logicalSignals[0] as any).direction = 'input' }],
    ['optional Leaf', (project: WorkcellProjectV5) => { (project.opcUa.mappings[0] as any).leaves[0].required = false }],
    ['non-root Leaf', (project: WorkcellProjectV5) => { (project.opcUa.mappings[0] as any).leaves[0].leafPath = ['value'] }],
  ])('excludes a %s', (_name, mutate) => {
    const project = cloneWorkcellProjectV5(writableProject())
    mutate(project)
    expect(compileWritableBooleanSignalMappingsV5(validateWorkcellProjectV5(project))).toEqual([])
  })

  it.each([
    ['structured project path', (project: WorkcellProjectV5) => { (project.opcUa.mappings[0] as any).leaves[0].projectPath = ['value'] }],
    ['non-Boolean OPC UA type', (project: WorkcellProjectV5) => { const l = (project.opcUa.mappings[0] as any).leaves[0]; l.opcUaDataType = 'Int32'; l.projectDataType = 'integer' }],
    ['input signal', (project: WorkcellProjectV5) => { (project.logicalSignals[0] as any).direction = 'input' }],
  ])('validates a malformed %s before compiling it', (_name, mutate) => {
    const project = cloneWorkcellProjectV5(writableProject())
    mutate(project)
    expect(() => compileWritableBooleanSignalMappingsV5(project)).toThrow()
  })

  it.each([
    ['non-logical target', (project: WorkcellProjectV5) => { const l = (project.opcUa.mappings[0] as any).leaves[0]; l.projectTarget = { type: 'robot-status', robotId: 'robot-1' }; l.opcUaDataType = 'Double'; l.projectDataType = 'number' }],
    ['non-Boolean signal', (project: WorkcellProjectV5) => { const s = project.logicalSignals[0] as any; s.dataType = 'Int32'; s.initialValue = 0; const l = (project.opcUa.mappings[0] as any).leaves[0]; l.opcUaDataType = 'Int32'; l.projectDataType = 'integer' }],
  ])('excludes a valid V5 %s decoy', (_name, mutate) => {
    const project = cloneWorkcellProjectV5(writableProject())
    mutate(project)
    expect(compileWritableBooleanSignalMappingsV5(project)).toEqual([])
  })
})
