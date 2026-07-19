import { describe, expect, it } from 'vitest'

import {
  validateWorkcellProjectV5,
  type OpcUaMappingV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import type { StateBatchV1 } from '../../../core/runtime-protocol/v1.js'
import { createLogicalSignalRuntimeStoreV1 } from './logical-signal-runtime-store.js'

const REVISION = 'a'.repeat(64)
const OTHER_REVISION = 'b'.repeat(64)

function endpoint(endpointId: string) {
  return {
    endpointId,
    name: endpointId,
    endpointUrl: `opc.tcp://localhost:48${40 + endpointId.length}`,
    enabled: true,
    publishingIntervalMs: 100,
    reconnectDelayMs: 1_000,
  } as const
}

function signalMapping(
  id: string,
  endpointId: string,
  signalId: string,
  leafPath: readonly (string | number)[] = [],
): OpcUaMappingV5 {
  return {
    id,
    endpointId,
    nodeAddress: {
      namespaceUri: 'urn:robot-sim:test',
      identifierType: 'string',
      identifier: `Signals.${signalId}`,
    },
    direction: 'read',
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

function projectWithBooleanInput(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project.logicalSignals as unknown as Array<WorkcellProjectV5['logicalSignals'][number]>).splice(0, 1, {
    id: 'part-present',
    name: 'Part present',
    dataType: 'Boolean',
    direction: 'input',
    initialValue: false,
    unit: '',
    scope: { type: 'project' },
  })
  ;(project.opcUa.endpoints as unknown as Array<WorkcellProjectV5['opcUa']['endpoints'][number]>).splice(0, 1, endpoint('plc'))
  ;(project.opcUa.mappings as unknown as OpcUaMappingV5[]).splice(0, 1, signalMapping('part-present-input', 'plc', 'part-present'))
  return validateWorkcellProjectV5(project)
}

function projectWithSignalsOnSeparateEndpoints(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(projectWithBooleanInput())
  ;(project.logicalSignals as unknown as Array<WorkcellProjectV5['logicalSignals'][number]>).push({
    id: 'guard-closed',
    name: 'Guard closed',
    dataType: 'Boolean',
    direction: 'input',
    initialValue: false,
    unit: '',
    scope: { type: 'project' },
  })
  ;(project.opcUa.endpoints as unknown as Array<WorkcellProjectV5['opcUa']['endpoints'][number]>).push(endpoint('safety'))
  ;(project.opcUa.mappings as unknown as OpcUaMappingV5[]).push(signalMapping('guard-closed-input', 'safety', 'guard-closed'))
  return validateWorkcellProjectV5(project)
}

function signalBatch(overrides: {
  readonly configRevision?: string
  readonly endpointId?: string
  readonly mappingId?: string
  readonly sequence?: number
  readonly sourceTimestampMs?: number
  readonly publishedTimestampMs?: number
  readonly value?: StateBatchV1['values'][number]['value']
  readonly quality?: 'GOOD' | 'UNCERTAIN' | 'BAD'
  readonly statusCode?: string
} = {}): StateBatchV1 {
  const endpointId = overrides.endpointId ?? 'plc'
  const sequence = overrides.sequence ?? 1
  return {
    type: 'state-batch-v1',
    protocolVersion: 1,
    gatewayId: 'gateway-test',
    projectId: 'project-v5',
    configRevision: overrides.configRevision ?? REVISION,
    endpointId,
    sequence,
    sourceTimestampMs: overrides.sourceTimestampMs ?? 1_000,
    publishedTimestampMs: overrides.publishedTimestampMs ?? 1_020,
    originId: 'gateway-test:client',
    values: [{
      mappingId: overrides.mappingId ?? (endpointId === 'safety' ? 'guard-closed-input' : 'part-present-input'),
      coherenceGroupId: null,
      value: overrides.value ?? true,
      unit: '',
      quality: overrides.quality ?? 'GOOD',
      statusCode: overrides.statusCode ?? 'Good',
    }],
  }
}

describe('LogicalSignalRuntimeStoreV1', () => {
  it('accepts a scalar Signal value assembled from a structured OPC UA root', () => {
    const project = cloneWorkcellProjectV5(projectWithBooleanInput())
    ;(project.opcUa.mappings as unknown as OpcUaMappingV5[]).splice(0, 1,
      signalMapping('part-present-input', 'plc', 'part-present', ['payload', 'present']),
    )
    const runtime = createLogicalSignalRuntimeStoreV1(validateWorkcellProjectV5(project), REVISION)

    expect(runtime.getState().ingest(signalBatch({ value: true }), 1_050)).toBe(true)
    expect(runtime.getState().read('part-present')).toMatchObject({ value: true, quality: 'GOOD' })
  })

  it('exposes the fixed revision and immutable Signal-ID contract without legacy fields', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)
    const state = runtime.getState()

    expect(state.projectRevisionId).toBe('revision-1')
    expect(state.configRevision).toBe(REVISION)
    expect(state.bySignalId['part-present']).toMatchObject({ value: false, owner: 'initial' })
    expect('projectId' in state).toBe(false)
    expect('signals' in state).toBe(false)
  })

  it('initializes every signal from its authored value while awaiting the first OPC UA receipt', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)

    expect(runtime.getState().read('part-present')).toMatchObject({
      signalId: 'part-present', value: false, quality: 'BAD',
      statusCode: 'BadWaitingForInitialData', owner: 'initial',
      sourceTimestampMs: 0, publishedTimestampMs: 0, receivedTimestampMs: 0,
    })
  })

  it('publishes a subscribed GOOD Boolean by stable Signal ID', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)

    expect(runtime.getState().ingest(signalBatch({ sequence: 1, value: true }), 1_050)).toBe(true)
    expect(runtime.getState().read('part-present')).toMatchObject({
      signalId: 'part-present', value: true, quality: 'GOOD',
      owner: 'opcua:plc', sourceTimestampMs: 1_000, publishedTimestampMs: 1_020,
      receivedTimestampMs: 1_050,
    })
  })

  it('retains the last GOOD Signal payload when a later value is UNCERTAIN', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)
    runtime.getState().ingest(signalBatch({ sequence: 1, value: true, quality: 'GOOD' }), 1_050)
    runtime.getState().ingest(signalBatch({
      sequence: 2, sourceTimestampMs: 1_100, value: false,
      quality: 'UNCERTAIN', statusCode: 'UncertainLastUsableValue',
    }), 1_150)

    expect(runtime.getState().read('part-present')).toMatchObject({
      value: true, quality: 'UNCERTAIN', statusCode: 'UncertainLastUsableValue',
      owner: 'opcua:plc', sourceTimestampMs: 1_100, publishedTimestampMs: 1_020,
      receivedTimestampMs: 1_150,
    })
  })

  it('retains the last value but marks disconnect STALE', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)
    runtime.getState().ingest(signalBatch({ sequence: 1, value: true }), 1_050)
    runtime.getState().markEndpointDisconnected('plc', 1_100)

    expect(runtime.getState().read('part-present')).toMatchObject({
      value: true, quality: 'STALE', statusCode: 'BadNoCommunication',
      owner: 'opcua:plc', receivedTimestampMs: 1_100,
    })
  })

  it('rejects old sequence, wrong revision, wrong endpoint, and non-Boolean payload', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)

    expect(runtime.getState().ingest(signalBatch({ sequence: 2, value: false }), 2_000)).toBe(true)
    expect(runtime.getState().ingest(signalBatch({ sequence: 1, value: true }), 2_010)).toBe(false)
    expect(runtime.getState().ingest(signalBatch({ configRevision: OTHER_REVISION }), 2_020)).toBe(false)
    expect(runtime.getState().ingest(signalBatch({ endpointId: 'unknown' }), 2_030)).toBe(false)
    expect(runtime.getState().ingest(signalBatch({ sequence: 3, value: 1 }), 2_040)).toBe(true)

    expect(runtime.getState().read('part-present')).toMatchObject({
      value: false, quality: 'BAD', statusCode: 'BadTypeMismatch', owner: 'opcua:plc',
    })
  })

  it('tracks sequence and disconnect state independently for every Endpoint', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithSignalsOnSeparateEndpoints(), REVISION)

    expect(runtime.getState().ingest(signalBatch({ endpointId: 'plc', sequence: 2, value: true }), 1_000)).toBe(true)
    expect(runtime.getState().ingest(signalBatch({ endpointId: 'safety', sequence: 1, value: true }), 1_010)).toBe(true)
    expect(runtime.getState().ingest(signalBatch({ endpointId: 'plc', sequence: 1, value: false }), 1_020)).toBe(false)
    runtime.getState().markEndpointDisconnected('plc', 1_100)

    expect(runtime.getState().read('part-present')).toMatchObject({ quality: 'STALE', owner: 'opcua:plc' })
    expect(runtime.getState().read('guard-closed')).toMatchObject({ value: true, quality: 'GOOD', owner: 'opcua:safety' })
  })

  it('does not let an irrelevant Mapping ID poison the Endpoint sequence fence', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)

    expect(runtime.getState().ingest(signalBatch({ mappingId: 'wrong-target', sequence: 100, value: true }), 1_000)).toBe(false)
    expect(runtime.getState().ingest(signalBatch({ sequence: 1, value: true }), 1_001)).toBe(true)
    expect(runtime.getState().read('part-present')).toMatchObject({ value: true, quality: 'GOOD', owner: 'opcua:plc' })
  })

  it('resets the gateway session without rewinding retained diagnostics and accepts sequence one again', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)
    runtime.getState().ingest(signalBatch({ sequence: 10, value: true }), 1_000)

    runtime.getState().resetGatewaySession(900)
    expect(runtime.getState().read('part-present')).toMatchObject({
      value: true, quality: 'BAD', statusCode: 'BadWaitingForInitialData',
      owner: 'opcua:plc', receivedTimestampMs: 1_000,
    })
    expect(runtime.getState().ingest(signalBatch({ sequence: 1, value: false }), 1_001)).toBe(true)
    expect(runtime.getState().read('part-present')).toMatchObject({ value: false, quality: 'GOOD' })
  })

  it('does not rewind received timestamps on an earlier disconnect notification', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)
    runtime.getState().ingest(signalBatch({ value: true }), 1_000)

    runtime.getState().markEndpointDisconnected('plc', 900)

    expect(runtime.getState().read('part-present')).toMatchObject({
      quality: 'STALE', receivedTimestampMs: 1_000,
    })
  })

  it('rejects older Signal source and published clocks, then preserves visible clocks across reset', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)
    expect(runtime.getState().ingest(signalBatch({
      sequence: 1, value: true, sourceTimestampMs: 1_000, publishedTimestampMs: 1_020,
    }), 1_050)).toBe(true)
    const accepted = runtime.getState().read('part-present')!

    expect(runtime.getState().ingest(signalBatch({
      sequence: 2, value: false, sourceTimestampMs: 999, publishedTimestampMs: 1_021,
    }), 1_060)).toBe(false)
    expect(runtime.getState().ingest(signalBatch({
      sequence: 2, value: false, sourceTimestampMs: 1_001, publishedTimestampMs: 1_019,
    }), 1_061)).toBe(false)
    expect(runtime.getState().read('part-present')).toEqual(accepted)

    runtime.getState().resetGatewaySession(1_070)
    expect(runtime.getState().ingest(signalBatch({
      sequence: 1, value: false, sourceTimestampMs: 1, publishedTimestampMs: 2,
    }), 1_080)).toBe(true)
    expect(runtime.getState().read('part-present')).toMatchObject({
      value: false, quality: 'GOOD', sourceTimestampMs: 1_000,
      publishedTimestampMs: 1_020, receivedTimestampMs: 1_080,
    })
  })

  it('keeps the active runtime snapshot when replaceProject validation fails', () => {
    const project = projectWithBooleanInput()
    const runtime = createLogicalSignalRuntimeStoreV1(project, REVISION)
    runtime.getState().ingest(signalBatch({ value: true }), 1_000)
    const invalid = cloneWorkcellProjectV5(project)
    ;(invalid.opcUa.mappings[0]!.leaves[0] as unknown as { projectPath: readonly (string | number)[] }).projectPath = ['invalid']

    expect(() => runtime.getState().replaceProject(invalid, REVISION)).toThrow('OPCUA_PROJECT_PATH_INVALID')
    expect(runtime.getState().read('part-present')).toMatchObject({ value: true, quality: 'GOOD', owner: 'opcua:plc' })
  })
})
