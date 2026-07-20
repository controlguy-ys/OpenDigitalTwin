import { describe, expect, it } from 'vitest'

import {
  validateWorkcellProjectV5,
  type OpcUaMappingV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import type { StateBatchV1 } from '../../../core/runtime-protocol/v1.js'
import { createObjectRuntimeStateV5 } from './object-runtime-state.js'

const REVISION = 'a'.repeat(64)

function endpoint(endpointId: string, publishingIntervalMs = 100) {
  return {
    endpointId,
    name: endpointId,
    endpointUrl: `opc.tcp://localhost:48${40 + endpointId.length}`,
    enabled: true,
    publishingIntervalMs,
    reconnectDelayMs: 1_000,
  } as const
}

function frameMapping(entityId: string, frameId: string, endpointId: string): OpcUaMappingV5 {
  const paths = [
    ['positionM', 0], ['positionM', 1], ['positionM', 2],
    ['rpyDegrees', 0], ['rpyDegrees', 1], ['rpyDegrees', 2],
  ] as const
  return {
    id: `${entityId}-pose`,
    endpointId,
    nodeAddress: { namespaceUri: 'urn:robot-sim:test', identifierType: 'string', identifier: `${entityId}.Pose` },
    direction: 'read',
    coherenceGroupId: `${entityId}-pose`,
    interpolationMode: 'shortest-quaternion',
    coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
    leaves: paths.map((projectPath, index) => ({
      leafPath: [index], projectPath,
      projectTarget: { type: 'entity-frame' as const, entityId, frameId },
      opcUaDataType: 'Double' as const, projectDataType: 'number' as const,
      scale: 1, offset: 0, unit: index < 3 ? 'metre' : 'degree', required: true,
    })),
  }
}

function statusMapping(entityId: string, endpointId: string): OpcUaMappingV5 {
  return {
    id: `${entityId}-status`, endpointId,
    nodeAddress: { namespaceUri: 'urn:robot-sim:test', identifierType: 'string', identifier: `${entityId}.Status` },
    direction: 'read', coherenceGroupId: null, interpolationMode: 'none',
    coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
    leaves: [{
      leafPath: [], projectPath: [], projectTarget: { type: 'entity-status', entityId },
      opcUaDataType: 'Double', projectDataType: 'number', scale: 1, offset: 0, unit: 'number', required: true,
    }],
  }
}

function projectWithArrayMappedBox(options: { publishingIntervalMs?: number } = {}): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  const publishingIntervalMs = options.publishingIntervalMs ?? 100
  ;(project.opcUa.endpoints as unknown as Array<WorkcellProjectV5['opcUa']['endpoints'][number]>).splice(0, 1, endpoint('plc', publishingIntervalMs))
  ;(project.spatialEntities as unknown as Array<WorkcellProjectV5['spatialEntities'][number]>).push({
    id: 'box', name: 'Box', geometry: { kind: 'box', dimensionsM: [1, 1, 1], color: '#808080' },
    parentFrameId: 'box-motion', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    visible: true, groupId: null, removable: true, transformOwner: 'opcua:plc',
    numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: false, frameId: null } },
    graspable: false, graspFrames: [],
    movingFrames: [{
      frameId: 'box-motion', name: 'Box motion', parentFrameId: 'world',
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, sourceOwnership: 'opcua:plc',
    }],
  })
  ;(project.opcUa.mappings as unknown as OpcUaMappingV5[]).splice(0, 1, frameMapping('box', 'box-motion', 'plc'))
  return validateWorkcellProjectV5(project)
}

function projectWithMappedBoxFrameAndStatusOnSeparateEndpoints(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(projectWithArrayMappedBox())
  ;(project.opcUa.endpoints as unknown as Array<WorkcellProjectV5['opcUa']['endpoints'][number]>).splice(0, 1, endpoint('motion-plc'), endpoint('status-plc'))
  const box = project.spatialEntities[0] as unknown as { transformOwner: string; movingFrames: Array<{ sourceOwnership: string }>; numericStatus: { sourceOwnership: string } }
  box.transformOwner = 'opcua:motion-plc'
  box.movingFrames[0]!.sourceOwnership = 'opcua:motion-plc'
  box.numericStatus.sourceOwnership = 'opcua:status-plc'
  ;(project.opcUa.mappings as unknown as OpcUaMappingV5[]).splice(
    0, 1,
    frameMapping('box', 'box-motion', 'motion-plc'),
    statusMapping('box', 'status-plc'),
  )
  return validateWorkcellProjectV5(project)
}

function projectWithMappedBoxFrameAndStatusOnOneEndpoint(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(projectWithMappedBoxFrameAndStatusOnSeparateEndpoints())
  const box = project.spatialEntities[0] as unknown as { numericStatus: { sourceOwnership: string } }
  box.numericStatus.sourceOwnership = 'opcua:motion-plc'
  ;(project.opcUa.mappings[1] as unknown as { endpointId: string }).endpointId = 'motion-plc'
  return validateWorkcellProjectV5(project)
}

function batch(
  endpointId: string,
  sequence: number,
  values: StateBatchV1['values'],
  sourceTimestampMs = 1_000,
): StateBatchV1 {
  return {
    type: 'state-batch-v1', protocolVersion: 1, gatewayId: 'gateway-test',
    projectId: 'project-v5', configRevision: REVISION, endpointId, sequence,
    sourceTimestampMs, publishedTimestampMs: sourceTimestampMs + 20,
    originId: 'gateway-test:client', values,
  }
}

function objectPoseBatch(overrides: {
  readonly endpointId?: string
  readonly sequence?: number
  readonly sourceTimestampMs?: number
  readonly positionM?: readonly [number, number, number]
  readonly yaw?: number
  readonly quality?: 'GOOD' | 'UNCERTAIN' | 'BAD'
  readonly statusCode?: string
} = {}): StateBatchV1 {
  const positionM = overrides.positionM ?? [0, 0, 0]
  const halfYawRadians = (overrides.yaw ?? 0) * Math.PI / 360
  return batch(overrides.endpointId ?? 'plc', overrides.sequence ?? 1, [{
    mappingId: 'box-pose', coherenceGroupId: 'box-pose',
    value: {
      positionM: [...positionM],
      quaternion: [0, 0, Math.sin(halfYawRadians), Math.cos(halfYawRadians)],
    }, unit: 'project-v5-z-up-metres-quaternion-xyzw',
    quality: overrides.quality ?? 'GOOD', statusCode: overrides.statusCode ?? 'Good',
  }], overrides.sourceTimestampMs ?? 1_000)
}

function objectStatusBatch(overrides: {
  readonly endpointId?: string
  readonly sequence?: number
  readonly status?: number
  readonly sourceTimestampMs?: number
} = {}): StateBatchV1 {
  return batch(overrides.endpointId ?? 'status-plc', overrides.sequence ?? 1, [{
    mappingId: 'box-status', coherenceGroupId: null, value: overrides.status ?? 0,
    unit: 'number', quality: 'GOOD', statusCode: 'Good',
  }], overrides.sourceTimestampMs ?? 1_000)
}

describe('ObjectRuntimeStateV5', () => {
  it('returns a single-use no-op catch-up guard for an enabled Endpoint with no Object channels', () => {
    const project = cloneWorkcellProjectV5(projectWithArrayMappedBox())
    ;(project.opcUa.endpoints as unknown as Array<WorkcellProjectV5['opcUa']['endpoints'][number]>).push(endpoint('idle'))
    const runtime = createObjectRuntimeStateV5(validateWorkcellProjectV5(project), REVISION)

    const guard = runtime.beginEndpointCatchup('idle', 1_000)
    expect(() => runtime.beginEndpointCatchup('idle', 1_001)).toThrow('ENDPOINT_CATCHUP_ALREADY_ACTIVE')
    expect(() => { guard.commit(); guard.commit(); guard.abort(); guard.abort() }).not.toThrow()
    expect(() => runtime.beginEndpointCatchup('idle', 1_002).abort()).not.toThrow()
    expect(() => runtime.beginEndpointCatchup('missing', 1_000)).toThrow('ENDPOINT_CATCHUP_UNKNOWN_ENDPOINT')
  })

  it('exposes the fixed revision contract and nullable configured channels before GOOD data', () => {
    const runtime = createObjectRuntimeStateV5(projectWithMappedBoxFrameAndStatusOnSeparateEndpoints(), REVISION)

    expect(runtime.projectRevisionId).toBe('revision-1')
    expect(runtime.configRevision).toBe(REVISION)
    expect(runtime.sampleFrame('box', 'box-motion', 1_000)).toMatchObject({
      worldPose: null, quality: 'BAD', statusCode: 'BadWaitingForInitialData', owner: 'opcua:motion-plc',
    })
    expect(runtime.readNumericStatus('box')).toMatchObject({
      value: null, quality: 'BAD', statusCode: 'BadWaitingForInitialData', owner: 'opcua:status-plc',
    })
  })

  it('samples a coherent OPC UA-owned Object Frame two publishing cycles behind', () => {
    const runtime = createObjectRuntimeStateV5(projectWithArrayMappedBox({ publishingIntervalMs: 100 }), REVISION)
    runtime.ingest(objectPoseBatch({ sequence: 1, sourceTimestampMs: 1_000, positionM: [0, 0, 0], yaw: 0 }), 1_000)
    runtime.ingest(objectPoseBatch({ sequence: 2, sourceTimestampMs: 1_100, positionM: [1, 0, 0], yaw: 90 }), 1_100)

    expect(runtime.sampleFrame('box', 'box-motion', 1_250)).toMatchObject({
      sourceTimestampMs: 1_050, worldPose: { positionM: [0.5, 0, 0] }, quality: 'GOOD', owner: 'opcua:plc',
    })
  })

  it('retains the Object but marks it STALE and keeps OPC UA ownership on disconnect', () => {
    const runtime = createObjectRuntimeStateV5(projectWithArrayMappedBox(), REVISION)
    runtime.ingest(objectPoseBatch({ sequence: 1 }), 1_000)
    runtime.markEndpointDisconnected('plc', 1_100)

    expect(runtime.sampleFrame('box', 'box-motion', 1_100)).toMatchObject({
      quality: 'STALE', statusCode: 'BadNoCommunication', owner: 'opcua:plc',
    })
  })

  it('keeps Object Frame and numeric Status channels independent', () => {
    const runtime = createObjectRuntimeStateV5(projectWithMappedBoxFrameAndStatusOnSeparateEndpoints(), REVISION)
    runtime.ingest(objectPoseBatch({ endpointId: 'motion-plc', sequence: 1 }), 1_000)
    runtime.ingest(objectStatusBatch({ endpointId: 'status-plc', sequence: 1, status: 7 }), 1_010)
    runtime.markEndpointDisconnected('motion-plc', 1_100)

    expect(runtime.sampleFrame('box', 'box-motion', 1_100)).toMatchObject({ quality: 'STALE', owner: 'opcua:motion-plc' })
    expect(runtime.readNumericStatus('box')).toMatchObject({
      value: 7, quality: 'GOOD', owner: 'opcua:status-plc',
    })
  })

  it('uses PLC source/published admission rather than comparing PLC time to browser receipt time', () => {
    const runtime = createObjectRuntimeStateV5(projectWithArrayMappedBox(), REVISION)
    runtime.ingest(objectPoseBatch({ sequence: 1, positionM: [0, 0, 0] }), 1_000)
    runtime.ingest(objectPoseBatch({ sequence: 2, sourceTimestampMs: 1_100, positionM: [1, 0, 0] }), 1_100)
    expect(runtime.sampleFrame('box', 'box-motion', 1_250)).toMatchObject({ sourceTimestampMs: 1_050 })
    expect(runtime.ingest(objectPoseBatch({ sequence: 3, sourceTimestampMs: 1_301, positionM: [99, 0, 0] }), 1_300)).toBe(true)
    expect(runtime.ingest(objectPoseBatch({ sequence: 4, sourceTimestampMs: 1_200, positionM: [2, 0, 0], quality: 'BAD', statusCode: 'BadNoData' }), 1_300)).toBe(false)

    expect(runtime.sampleFrame('box', 'box-motion', 1_300)).toMatchObject({
      quality: 'GOOD', statusCode: 'Good', owner: 'opcua:plc',
    })
  })

  it('keeps recent UNCERTAIN quality ahead of a stale retained-GOOD pose buffer', () => {
    const runtime = createObjectRuntimeStateV5(projectWithArrayMappedBox(), REVISION)
    runtime.ingest(objectPoseBatch({ sequence: 1 }), 1_000)
    runtime.ingest(objectPoseBatch({
      sequence: 2, sourceTimestampMs: 1_100, quality: 'UNCERTAIN', statusCode: 'UncertainLastUsableValue',
    }), 1_600)

    expect(runtime.sampleFrame('box', 'box-motion', 1_600)).toMatchObject({
      worldPose: { positionM: [0, 0, 0] }, quality: 'UNCERTAIN', statusCode: 'UncertainLastUsableValue',
    })
  })

  it('commits sparse catch-up without overwriting the touched status and abort keeps the Endpoint durably STALE', () => {
    const runtime = createObjectRuntimeStateV5(projectWithMappedBoxFrameAndStatusOnOneEndpoint(), REVISION)
    const pose = objectPoseBatch({ endpointId: 'motion-plc', sequence: 1, positionM: [1, 0, 0] })
    const status = objectStatusBatch({ endpointId: 'motion-plc', sequence: 1, status: 1 })
    expect(runtime.ingest({ ...pose, values: [...pose.values, ...status.values] }, 1_000)).toBe(true)

    const guard = runtime.beginEndpointCatchup('motion-plc', 1_010)
    expect(() => runtime.beginEndpointCatchup('motion-plc', 1_011)).toThrow('ENDPOINT_CATCHUP_ALREADY_ACTIVE')
    expect(runtime.ingest(objectStatusBatch({ endpointId: 'motion-plc', sequence: 2, status: 2, sourceTimestampMs: 1_001 }), 1_020)).toBe(true)
    expect(runtime.readNumericStatus('box')).toMatchObject({ quality: 'STALE', statusCode: 'BadNoCommunication' })
    guard.commit()
    expect(runtime.readNumericStatus('box')).toMatchObject({ value: 2, quality: 'GOOD' })
    expect(runtime.sampleFrame('box', 'box-motion', 1_020)).toMatchObject({ quality: 'GOOD', worldPose: { positionM: [1, 0, 0] } })

    const aborted = runtime.beginEndpointCatchup('motion-plc', 1_030)
    expect(runtime.ingest(objectStatusBatch({ endpointId: 'motion-plc', sequence: 3, status: 3, sourceTimestampMs: 1_002 }), 1_031)).toBe(true)
    aborted.abort()
    expect(runtime.readNumericStatus('box')).toMatchObject({ value: 2, quality: 'STALE', statusCode: 'BadNoCommunication' })
  })

  it('preserves Object interpolation history for a State-only catch-up', () => {
    const runtime = createObjectRuntimeStateV5(projectWithMappedBoxFrameAndStatusOnOneEndpoint(), REVISION)
    expect(runtime.ingest(objectPoseBatch({ endpointId: 'motion-plc', sequence: 1, positionM: [0, 0, 0], sourceTimestampMs: 1_000 }), 1_000)).toBe(true)
    expect(runtime.ingest(objectPoseBatch({ endpointId: 'motion-plc', sequence: 2, positionM: [10, 0, 0], sourceTimestampMs: 1_100 }), 1_100)).toBe(true)

    const guard = runtime.beginEndpointCatchup('motion-plc', 1_200)
    expect(runtime.ingest(objectStatusBatch({ endpointId: 'motion-plc', sequence: 3, status: 2, sourceTimestampMs: 1_101 }), 1_201)).toBe(true)
    guard.commit()

    expect(runtime.sampleFrame('box', 'box-motion', 1_250)).toMatchObject({ worldPose: { positionM: [5, 0, 0] } })
  })

  it('keeps a guarded Object Frame payload and timestamps invisible until atomic commit', () => {
    const runtime = createObjectRuntimeStateV5(projectWithArrayMappedBox(), REVISION)
    expect(runtime.ingest(objectPoseBatch({ sequence: 1, positionM: [1, 0, 0], sourceTimestampMs: 1_000 }), 1_000)).toBe(true)
    const guard = runtime.beginEndpointCatchup('plc', 1_010)
    expect(runtime.ingest(objectPoseBatch({ sequence: 2, positionM: [3, 0, 0], sourceTimestampMs: 1_100 }), 1_100)).toBe(true)
    expect(runtime.sampleFrame('box', 'box-motion', 1_100)).toMatchObject({
      worldPose: { positionM: [1, 0, 0] }, quality: 'STALE', statusCode: 'BadNoCommunication', sourceTimestampMs: 1_000,
    })
    guard.commit()
    expect(runtime.sampleFrame('box', 'box-motion', 1_300)).toMatchObject({ worldPose: { positionM: [3, 0, 0] }, quality: 'GOOD' })
  })

  it('appends a lifecycle-free Object Frame catch-up to the retained interpolation trajectory', () => {
    const baseline = createObjectRuntimeStateV5(projectWithArrayMappedBox(), REVISION)
    const guarded = createObjectRuntimeStateV5(projectWithArrayMappedBox(), REVISION)
    for (const runtime of [baseline, guarded]) {
      expect(runtime.ingest(objectPoseBatch({ sequence: 1, positionM: [0, 0, 0], sourceTimestampMs: 1_000 }), 1_000)).toBe(true)
    }
    expect(baseline.ingest(objectPoseBatch({ sequence: 2, positionM: [10, 0, 0], sourceTimestampMs: 1_100 }), 1_100)).toBe(true)
    const guard = guarded.beginEndpointCatchup('plc', 1_050)
    expect(guarded.ingest(objectPoseBatch({ sequence: 2, positionM: [10, 0, 0], sourceTimestampMs: 1_100 }), 1_100)).toBe(true)
    guard.commit()
    expect(guarded.sampleFrame('box', 'box-motion', 1_250)).toEqual(baseline.sampleFrame('box', 'box-motion', 1_250))
  })

  it('namespaces Object coherence groups away from colliding Mapping IDs', () => {
    const runtime = createObjectRuntimeStateV5(projectWithMappedBoxFrameAndStatusOnOneEndpoint(), REVISION)
    expect(runtime.ingest(objectPoseBatch({ endpointId: 'motion-plc', sequence: 1, sourceTimestampMs: 1_000 }), 1_000)).toBe(true)
    expect(runtime.ingest(objectStatusBatch({ endpointId: 'motion-plc', sequence: 2, sourceTimestampMs: 500, status: 1 }), 1_001)).toBe(true)
    const status = objectStatusBatch({ endpointId: 'motion-plc', sequence: 3, sourceTimestampMs: 900, status: 2 })
    expect(runtime.ingest({ ...status, values: [
      { ...objectPoseBatch({ endpointId: 'motion-plc', sequence: 3, sourceTimestampMs: 900 }).values[0]!, coherenceGroupId: 'box-status' },
      { ...status.values[0]!, coherenceGroupId: null },
    ] }, 1_002)).toBe(true)
    expect(runtime.readNumericStatus('box')).toMatchObject({ value: 2 })
  })

  it('admits an independent fresh Object group while rejecting a stale group atomically', () => {
    const runtime = createObjectRuntimeStateV5(projectWithMappedBoxFrameAndStatusOnOneEndpoint(), REVISION)
    expect(runtime.ingest(objectPoseBatch({ endpointId: 'motion-plc', sequence: 1, sourceTimestampMs: 1_000, positionM: [1, 0, 0] }), 1_000)).toBe(true)
    expect(runtime.ingest(objectStatusBatch({ endpointId: 'motion-plc', sequence: 2, sourceTimestampMs: 500, status: 1 }), 1_001)).toBe(true)
    const status = objectStatusBatch({ endpointId: 'motion-plc', sequence: 3, sourceTimestampMs: 900, status: 2 })
    expect(runtime.ingest({ ...status, values: [
      { ...objectPoseBatch({ endpointId: 'motion-plc', sequence: 3, sourceTimestampMs: 900 }).values[0]! },
      status.values[0]!,
    ] }, 1_002)).toBe(true)
    expect(runtime.sampleFrame('box', 'box-motion', 1_002)).toMatchObject({ worldPose: { positionM: [1, 0, 0] } })
    expect(runtime.readNumericStatus('box')).toMatchObject({ value: 2 })

    const grouped = objectStatusBatch({ endpointId: 'motion-plc', sequence: 4, sourceTimestampMs: 800, status: 3 })
    expect(runtime.ingest({ ...grouped, values: [
      { ...objectPoseBatch({ endpointId: 'motion-plc', sequence: 4, sourceTimestampMs: 800 }).values[0]!, coherenceGroupId: 'paired' },
      { ...grouped.values[0]!, coherenceGroupId: 'paired' },
    ] }, 1_003)).toBe(false)
    expect(runtime.readNumericStatus('box')).toMatchObject({ value: 2 })
  })

  it('aborts an Object cut back to its pose buffer and live fences before durable STALE', () => {
    const runtime = createObjectRuntimeStateV5(projectWithArrayMappedBox(), REVISION)
    expect(runtime.ingest(objectPoseBatch({ sequence: 1, positionM: [1, 0, 0], sourceTimestampMs: 1_000 }), 1_000)).toBe(true)
    const guard = runtime.beginEndpointCatchup('plc', 1_001)
    expect(runtime.ingest(objectPoseBatch({ sequence: 2, positionM: [2, 0, 0], sourceTimestampMs: 1_001 }), 1_002)).toBe(true)
    guard.abort()
    expect(runtime.sampleFrame('box', 'box-motion', 1_001)).toMatchObject({ worldPose: { positionM: [1, 0, 0] }, quality: 'STALE', sourceTimestampMs: 1_000 })
    expect(runtime.ingest(objectPoseBatch({ sequence: 2, positionM: [2, 0, 0], sourceTimestampMs: 1_001 }), 1_003)).toBe(true)
  })

  it('keeps Object reads quarantined through a guarded lifecycle reset and invalidates the guard on gateway reset', () => {
    const runtime = createObjectRuntimeStateV5(projectWithArrayMappedBox(), REVISION)
    expect(runtime.ingest(objectPoseBatch({ positionM: [1, 0, 0] }), 1_000)).toBe(true)
    const guard = runtime.beginEndpointCatchup('plc', 1_001)
    runtime.resetEndpointSession('plc', 1_002)
    expect(runtime.sampleFrame('box', 'box-motion', 1_002)).toMatchObject({ quality: 'STALE', statusCode: 'BadNoCommunication' })
    guard.commit()
    expect(runtime.sampleFrame('box', 'box-motion', 1_002)).toMatchObject({ quality: 'BAD', statusCode: 'BadWaitingForInitialData' })
    const invalidated = runtime.beginEndpointCatchup('plc', 1_003)
    runtime.resetGatewaySession(1_004)
    invalidated.commit()
    expect(runtime.sampleFrame('box', 'box-motion', 1_004)).toMatchObject({ quality: 'BAD', statusCode: 'BadWaitingForInitialData' })
  })

  it('invalidates an outstanding Object guard on project replacement', () => {
    const project = projectWithArrayMappedBox()
    const runtime = createObjectRuntimeStateV5(project, REVISION)
    const guard = runtime.beginEndpointCatchup('plc', 1_000)
    runtime.replaceProject(project, REVISION)
    guard.abort(); guard.commit()
    expect(runtime.sampleFrame('box', 'box-motion', 1_000)).toMatchObject({ quality: 'BAD', statusCode: 'BadWaitingForInitialData' })
  })

  it('commits a rejected-only Object cut by restoring its untouched pre-cut pose', () => {
    const runtime = createObjectRuntimeStateV5(projectWithArrayMappedBox(), REVISION)
    expect(runtime.ingest(objectPoseBatch({ positionM: [1, 0, 0], sourceTimestampMs: 1_000 }), 1_000)).toBe(true)
    const guard = runtime.beginEndpointCatchup('plc', 1_001)
    expect(runtime.ingest(objectPoseBatch({ sequence: 2, positionM: [2, 0, 0], sourceTimestampMs: 999 }), 1_002)).toBe(false)
    guard.commit()
    expect(runtime.sampleFrame('box', 'box-motion', 1_002)).toMatchObject({ worldPose: { positionM: [1, 0, 0] }, quality: 'GOOD' })
  })

  it('rejects an older receipt without advancing the Endpoint session fence', () => {
    const runtime = createObjectRuntimeStateV5(projectWithArrayMappedBox(), REVISION)
    expect(runtime.ingest(objectPoseBatch({ sequence: 1, sourceTimestampMs: 1_000 }), 2_000)).toBe(true)
    expect(runtime.ingest(objectPoseBatch({ sequence: 2, sourceTimestampMs: 1_001, positionM: [1, 0, 0] }), 1_999)).toBe(false)
    expect(runtime.ingest(objectPoseBatch({ sequence: 2, sourceTimestampMs: 1_001, positionM: [1, 0, 0] }), 2_001)).toBe(true)
  })

  it('marks pre-GOOD channels stale and resets pose-buffer sequence fences without rewinding diagnostics', () => {
    const runtime = createObjectRuntimeStateV5(projectWithArrayMappedBox(), REVISION)
    runtime.markEndpointDisconnected('plc', 1_000)
    expect(runtime.sampleFrame('box', 'box-motion', 1_000)).toMatchObject({
      worldPose: null, quality: 'STALE', statusCode: 'BadNoCommunication', receivedTimestampMs: 1_000,
    })
    runtime.ingest(objectPoseBatch({ sequence: 10, positionM: [2, 0, 0] }), 1_100)
    runtime.resetGatewaySession(900)
    expect(runtime.sampleFrame('box', 'box-motion', 1_100)).toMatchObject({
      worldPose: { positionM: [2, 0, 0] }, quality: 'BAD',
      statusCode: 'BadWaitingForInitialData', receivedTimestampMs: 1_100,
    })
    expect(runtime.ingest(objectPoseBatch({ sequence: 1, positionM: [3, 0, 0] }), 1_200)).toBe(true)
    expect(runtime.sampleFrame('box', 'box-motion', 1_200)).toMatchObject({
      worldPose: { positionM: [3, 0, 0] }, quality: 'GOOD', statusCode: 'Good',
    })
  })

  it('deeply freezes the retained Object fallback pose after reset before a sample', () => {
    const runtime = createObjectRuntimeStateV5(projectWithArrayMappedBox(), REVISION)
    runtime.ingest(objectPoseBatch({ positionM: [1, 2, 3] }), 1_000)
    runtime.resetGatewaySession(1_001)
    const snapshot = runtime.sampleFrame('box', 'box-motion', 1_001)!

    expect(Object.isFrozen(snapshot.worldPose)).toBe(true)
    expect(Object.isFrozen(snapshot.worldPose!.positionM)).toBe(true)
    expect(Object.isFrozen(snapshot.worldPose!.quaternion)).toBe(true)
    expect(() => { (snapshot.worldPose!.positionM as unknown as number[])[0] = 99 }).toThrow()
    expect(runtime.sampleFrame('box', 'box-motion', 1_001)?.worldPose?.positionM).toEqual([1, 2, 3])
  })

  it('replaces displayed diagnostic source timestamps after a new gateway session', () => {
    const runtime = createObjectRuntimeStateV5(projectWithArrayMappedBox(), REVISION)
    runtime.ingest(objectPoseBatch({ sequence: 10, sourceTimestampMs: 1_000, positionM: [1, 0, 0] }), 1_000)
    runtime.sampleFrame('box', 'box-motion', 1_000)
    runtime.resetGatewaySession(1_001)

    expect(runtime.ingest(objectPoseBatch({ sequence: 1, sourceTimestampMs: 1, positionM: [2, 0, 0] }), 1_002)).toBe(true)
    expect(runtime.sampleFrame('box', 'box-motion', 1_002)).toMatchObject({ sourceTimestampMs: 1 })
  })

  it('keeps the active Object runtime snapshot when replacement has a partial frame Mapping', () => {
    const project = projectWithArrayMappedBox()
    const runtime = createObjectRuntimeStateV5(project, REVISION)
    runtime.ingest(objectPoseBatch({ positionM: [1, 0, 0] }), 1_000)
    const invalid = cloneWorkcellProjectV5(project)
    ;(invalid.opcUa.mappings[0]!.leaves as unknown as unknown[]).pop()

    expect(() => runtime.replaceProject(invalid, REVISION)).toThrow('OPCUA_PROJECT_PATH_INVALID')
    expect(runtime.sampleFrame('box', 'box-motion', 1_000)).toMatchObject({ worldPose: { positionM: [1, 0, 0] } })
  })
})
