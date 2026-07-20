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

function projectWithSignalsOnOneEndpoint(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(projectWithSignalsOnSeparateEndpoints())
  ;(project.opcUa.mappings[1] as unknown as { endpointId: string }).endpointId = 'plc'
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
  it('returns a single-use no-op catch-up guard for an enabled Endpoint with no Signal channels', () => {
    const project = cloneWorkcellProjectV5(projectWithBooleanInput())
    ;(project.opcUa.endpoints as unknown as Array<WorkcellProjectV5['opcUa']['endpoints'][number]>).push(endpoint('idle'))
    const runtime = createLogicalSignalRuntimeStoreV1(validateWorkcellProjectV5(project), REVISION)

    const guard = runtime.getState().beginEndpointCatchup('idle', 1_000)
    expect(() => runtime.getState().beginEndpointCatchup('idle', 1_001)).toThrow('ENDPOINT_CATCHUP_ALREADY_ACTIVE')
    expect(() => { guard.commit(); guard.commit(); guard.abort(); guard.abort() }).not.toThrow()
    expect(() => runtime.getState().beginEndpointCatchup('idle', 1_002).abort()).not.toThrow()
    expect(() => runtime.getState().beginEndpointCatchup('missing', 1_000)).toThrow('ENDPOINT_CATCHUP_UNKNOWN_ENDPOINT')
  })

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
      sequence: 2, sourceTimestampMs: 1_100, publishedTimestampMs: 1_120, value: false,
      quality: 'UNCERTAIN', statusCode: 'UncertainLastUsableValue',
    }), 1_150)

    expect(runtime.getState().read('part-present')).toMatchObject({
      value: true, quality: 'UNCERTAIN', statusCode: 'UncertainLastUsableValue',
      owner: 'opcua:plc', sourceTimestampMs: 1_100, publishedTimestampMs: 1_120,
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
      value: false, quality: 'GOOD', sourceTimestampMs: 1,
      publishedTimestampMs: 2, receivedTimestampMs: 1_080,
    })
  })

  it('restores untouched sparse channels on catch-up commit, keeps abort durably STALE, and bypasses live fences for replay prefix', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithSignalsOnOneEndpoint(), REVISION)
    const initial = signalBatch({ sequence: 10, value: true, sourceTimestampMs: 1_000, publishedTimestampMs: 1_020 })
    expect(runtime.getState().ingest({
      ...initial,
      values: [
        initial.values[0]!,
        { ...initial.values[0]!, mappingId: 'guard-closed-input', value: true },
      ],
    }, 1_050)).toBe(true)
    const priorB = runtime.getState().read('guard-closed')!

    const guard = runtime.getState().beginEndpointCatchup('plc', 1_060)
    expect(runtime.getState().read('part-present')).toMatchObject({ quality: 'STALE' })
    expect(runtime.getState().read('guard-closed')).toMatchObject({ quality: 'STALE' })
    expect(runtime.getState().ingest(signalBatch({
      sequence: 11, value: false, sourceTimestampMs: 1_001, publishedTimestampMs: 1_021,
    }), 1_070)).toBe(true)
    expect(runtime.getState().read('part-present')).toMatchObject({ quality: 'STALE', statusCode: 'BadNoCommunication' })
    guard.commit()
    expect(runtime.getState().read('part-present')).toMatchObject({ value: false, quality: 'GOOD' })
    expect(runtime.getState().read('guard-closed')).toEqual(priorB)

    const aborted = runtime.getState().beginEndpointCatchup('plc', 1_080)
    aborted.abort()
    expect(runtime.getState().read('part-present')).toMatchObject({ quality: 'STALE', statusCode: 'BadNoCommunication' })

    expect(runtime.getState().restoreReplayPrefix(signalBatch({
      sequence: 1, value: true, sourceTimestampMs: 1, publishedTimestampMs: 2,
    }), 1_090)).toBe(true)
    expect(runtime.getState().ingest(signalBatch({
      sequence: 11, value: true, sourceTimestampMs: 1_002, publishedTimestampMs: 1_022,
    }), 1_091)).toBe(false)
  })

  it('commits a disconnected catch-up as STALE instead of resurrecting the hidden GOOD Signal', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)
    const guard = runtime.getState().beginEndpointCatchup('plc', 1_000)
    expect(runtime.getState().ingest(signalBatch({ sequence: 1, value: true }), 1_001)).toBe(true)
    runtime.getState().markEndpointDisconnected('plc', 1_002)
    guard.commit()

    expect(runtime.getState().read('part-present')).toMatchObject({
      value: true, quality: 'STALE', statusCode: 'BadNoCommunication', receivedTimestampMs: 1_002,
    })
  })

  it('keeps guarded Signal lifecycle transitions in the hidden candidate through commit', () => {
    const preGood = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)
    const preGoodGuard = preGood.getState().beginEndpointCatchup('plc', 1_000)
    preGood.getState().resetEndpointSession('plc', 1_001)
    expect(preGood.getState().read('part-present')).toMatchObject({ quality: 'STALE', statusCode: 'BadNoCommunication' })
    preGoodGuard.commit()
    expect(preGood.getState().read('part-present')).toMatchObject({ quality: 'BAD', statusCode: 'BadWaitingForInitialData' })

    const connectedThenDisconnected = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)
    const stateGuard = connectedThenDisconnected.getState().beginEndpointCatchup('plc', 2_000)
    connectedThenDisconnected.getState().resetEndpointSession('plc', 2_001)
    expect(connectedThenDisconnected.getState().ingest(signalBatch({ sequence: 1, value: true }), 2_002)).toBe(true)
    connectedThenDisconnected.getState().markEndpointDisconnected('plc', 2_003)
    stateGuard.commit()
    expect(connectedThenDisconnected.getState().read('part-present')).toMatchObject({ value: true, quality: 'STALE', statusCode: 'BadNoCommunication' })

    const reconnect = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)
    expect(reconnect.getState().ingest(signalBatch({ value: true }), 3_000)).toBe(true)
    const reconnectGuard = reconnect.getState().beginEndpointCatchup('plc', 3_001)
    reconnect.getState().markEndpointDisconnected('plc', 3_002)
    reconnect.getState().resetEndpointSession('plc', 3_003)
    reconnectGuard.commit()
    expect(reconnect.getState().read('part-present')).toMatchObject({ value: true, quality: 'BAD', statusCode: 'BadWaitingForInitialData' })
  })

  it('keeps the public Signal STALE overlay field-for-field unchanged during guarded lifecycle transitions', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)
    expect(runtime.getState().ingest(signalBatch({ value: true }), 1_000)).toBe(true)
    const guard = runtime.getState().beginEndpointCatchup('plc', 1_001)
    const overlay = runtime.getState().read('part-present')

    runtime.getState().resetEndpointSession('plc', 1_002)
    expect(runtime.getState().read('part-present')).toEqual(overlay)
    runtime.getState().markEndpointDisconnected('plc', 1_003)
    expect(runtime.getState().read('part-present')).toEqual(overlay)

    guard.commit()
    expect(runtime.getState().read('part-present')).toMatchObject({
      value: true, quality: 'STALE', statusCode: 'BadNoCommunication', receivedTimestampMs: 1_003,
    })
  })

  it('admits an independent fresh Signal group while rejecting a stale group atomically', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithSignalsOnOneEndpoint(), REVISION)
    const first = signalBatch({ sequence: 1, value: true, sourceTimestampMs: 1_000, publishedTimestampMs: 1_020 })
    expect(runtime.getState().ingest(first, 1_020)).toBe(true)
    const initialB = signalBatch({ sequence: 2, mappingId: 'guard-closed-input', value: true, sourceTimestampMs: 500, publishedTimestampMs: 520 })
    expect(runtime.getState().ingest(initialB, 1_020)).toBe(true)
    const mixed = signalBatch({ sequence: 3, value: false, sourceTimestampMs: 999, publishedTimestampMs: 1_021 })
    expect(runtime.getState().ingest({ ...mixed, values: [
      mixed.values[0]!,
      { ...mixed.values[0]!, mappingId: 'guard-closed-input', value: false, coherenceGroupId: null },
    ] }, 1_021)).toBe(true)
    expect(runtime.getState().read('part-present')).toMatchObject({ value: true })
    expect(runtime.getState().read('guard-closed')).toMatchObject({ value: false })

    const sameGroup = signalBatch({ sequence: 4, value: false, sourceTimestampMs: 998, publishedTimestampMs: 1_022 })
    expect(runtime.getState().ingest({ ...sameGroup, values: [
      { ...sameGroup.values[0]!, coherenceGroupId: 'paired' },
      { ...sameGroup.values[0]!, mappingId: 'guard-closed-input', coherenceGroupId: 'paired' },
    ] }, 1_022)).toBe(false)
    expect(runtime.getState().read('guard-closed')).toMatchObject({ value: false })
  })

  it('namespaces Signal coherence groups away from colliding Mapping IDs', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithSignalsOnOneEndpoint(), REVISION)
    expect(runtime.getState().ingest(signalBatch({ sequence: 1, sourceTimestampMs: 1_000 }), 1_000)).toBe(true)
    expect(runtime.getState().ingest(signalBatch({ sequence: 2, mappingId: 'guard-closed-input', sourceTimestampMs: 500 }), 1_001)).toBe(true)
    const mixed = signalBatch({ sequence: 3, sourceTimestampMs: 900, value: false })
    expect(runtime.getState().ingest({ ...mixed, values: [
      { ...mixed.values[0]!, coherenceGroupId: 'guard-closed-input' },
      { ...mixed.values[0]!, mappingId: 'guard-closed-input', coherenceGroupId: null, value: false },
    ] }, 1_002)).toBe(true)
    expect(runtime.getState().read('guard-closed')).toMatchObject({ value: false })
  })

  it('aborts a Signal cut back to its payload and live fences before leaving it durably STALE', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)
    expect(runtime.getState().ingest(signalBatch({ sequence: 1, value: true, sourceTimestampMs: 1_000, publishedTimestampMs: 1_020 }), 1_000)).toBe(true)
    const guard = runtime.getState().beginEndpointCatchup('plc', 1_001)
    expect(runtime.getState().ingest(signalBatch({ sequence: 2, value: false, sourceTimestampMs: 1_001, publishedTimestampMs: 1_021 }), 1_002)).toBe(true)
    guard.abort()
    expect(runtime.getState().read('part-present')).toMatchObject({
      value: true, quality: 'STALE', sourceTimestampMs: 1_000, publishedTimestampMs: 1_020, receivedTimestampMs: 1_001,
    })
    expect(runtime.getState().ingest(signalBatch({ sequence: 2, value: false, sourceTimestampMs: 1_001, publishedTimestampMs: 1_021 }), 1_003)).toBe(true)
  })

  it('invalidates an outstanding Signal guard on gateway reset without resurrecting GOOD', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)
    expect(runtime.getState().ingest(signalBatch({ value: true }), 1_000)).toBe(true)
    const guard = runtime.getState().beginEndpointCatchup('plc', 1_001)
    runtime.getState().resetGatewaySession(1_002)
    guard.commit()
    expect(runtime.getState().read('part-present')).toMatchObject({ quality: 'BAD', statusCode: 'BadWaitingForInitialData' })
  })

  it('invalidates an outstanding Signal guard on project replacement', () => {
    const project = projectWithBooleanInput()
    const runtime = createLogicalSignalRuntimeStoreV1(project, REVISION)
    const guard = runtime.getState().beginEndpointCatchup('plc', 1_000)
    runtime.getState().replaceProject(project, REVISION)
    guard.abort(); guard.commit()
    expect(runtime.getState().read('part-present')).toMatchObject({ quality: 'BAD', statusCode: 'BadWaitingForInitialData' })
  })

  it('commits a rejected-only Signal cut by restoring its untouched pre-cut state', () => {
    const runtime = createLogicalSignalRuntimeStoreV1(projectWithBooleanInput(), REVISION)
    expect(runtime.getState().ingest(signalBatch({ value: true, sourceTimestampMs: 1_000 }), 1_000)).toBe(true)
    const guard = runtime.getState().beginEndpointCatchup('plc', 1_001)
    expect(runtime.getState().ingest(signalBatch({ sequence: 2, value: false, sourceTimestampMs: 999 }), 1_002)).toBe(false)
    guard.commit()
    expect(runtime.getState().read('part-present')).toMatchObject({ value: true, quality: 'GOOD' })
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
