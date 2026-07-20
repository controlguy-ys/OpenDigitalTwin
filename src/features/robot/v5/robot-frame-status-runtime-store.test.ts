import { describe, expect, it } from 'vitest'

import {
  validateWorkcellProjectV5,
  type OpcUaMappingV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import type { StateBatchV1 } from '../../../core/runtime-protocol/v1.js'
import { createRobotFrameStatusRuntimeStoreV5 } from './robot-frame-status-runtime-store.js'

const REVISION = 'a'.repeat(64)

function frameMapping(): OpcUaMappingV5 {
  const paths = [
    ['positionM', 0], ['positionM', 1], ['positionM', 2],
    ['rpyDegrees', 0], ['rpyDegrees', 1], ['rpyDegrees', 2],
  ] as const
  return {
    id: 'robot-tcp', endpointId: 'plc',
    nodeAddress: { namespaceUri: 'urn:robot-sim:test', identifierType: 'string', identifier: 'Robot.TCP' },
    direction: 'read', coherenceGroupId: 'robot-tcp', interpolationMode: 'shortest-quaternion',
    coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
    leaves: paths.map((projectPath, index) => ({
      leafPath: [index], projectPath,
      projectTarget: { type: 'robot-frame' as const, robotId: 'robot-a', frameId: 'TCP' },
      opcUaDataType: 'Double' as const, projectDataType: 'number' as const,
      scale: 1, offset: 0, unit: index < 3 ? 'metre' : 'degree', required: true,
    })),
  }
}

function statusMapping(): OpcUaMappingV5 {
  return {
    id: 'robot-status', endpointId: 'plc',
    nodeAddress: { namespaceUri: 'urn:robot-sim:test', identifierType: 'string', identifier: 'Robot.Status' },
    direction: 'read', coherenceGroupId: null, interpolationMode: 'none',
    coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
    leaves: [{
      leafPath: [], projectPath: [], projectTarget: { type: 'robot-status', robotId: 'robot-a' },
      opcUaDataType: 'Double', projectDataType: 'number', scale: 1, offset: 0, unit: 'number', required: true,
    }],
  }
}

function projectWithMappedRobotTcpAndStatus(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project.robots[0] as unknown as { id: string; frameSources: Record<string, string>; numericStatus: { sourceOwnership: string } }).id = 'robot-a'
  const robot = project.robots[0] as unknown as { frameSources: Record<string, string>; numericStatus: { sourceOwnership: string } }
  robot.frameSources.TCP = 'opcua:plc'
  robot.numericStatus.sourceOwnership = 'opcua:plc'
  ;(project.jobs[0] as unknown as { robotId: string }).robotId = 'robot-a'
  ;(project.opcUa.endpoints as unknown as Array<WorkcellProjectV5['opcUa']['endpoints'][number]>).splice(0, 1, {
    endpointId: 'plc', name: 'PLC', endpointUrl: 'opc.tcp://localhost:4840', enabled: true,
    publishingIntervalMs: 100, reconnectDelayMs: 1_000,
  })
  ;(project.opcUa.mappings as unknown as OpcUaMappingV5[]).splice(0, 1, frameMapping(), statusMapping())
  return validateWorkcellProjectV5(project)
}

function robotFrameStatusBatch(overrides: {
  readonly sequence?: number
  readonly sourceTimestampMs?: number
  readonly positionM?: readonly [number, number, number]
  readonly yaw?: number
  readonly status?: number
  readonly quality?: 'GOOD' | 'UNCERTAIN' | 'BAD'
} = {}): StateBatchV1 {
  const positionM = overrides.positionM ?? [0, 0, 0]
  const quality = overrides.quality ?? 'GOOD'
  const halfYawRadians = (overrides.yaw ?? 0) * Math.PI / 360
  return {
    type: 'state-batch-v1', protocolVersion: 1, gatewayId: 'gateway-test', projectId: 'project-v5',
    configRevision: REVISION, endpointId: 'plc', sequence: overrides.sequence ?? 1,
    sourceTimestampMs: overrides.sourceTimestampMs ?? 1_000, publishedTimestampMs: (overrides.sourceTimestampMs ?? 1_000) + 20, originId: 'gateway-test:client',
    values: [
      {
        mappingId: 'robot-tcp', coherenceGroupId: 'robot-tcp', value: {
          positionM: [...positionM], quaternion: [0, 0, Math.sin(halfYawRadians), Math.cos(halfYawRadians)],
        },
        unit: 'project-v5-z-up-metres-quaternion-xyzw', quality, statusCode: quality === 'GOOD' ? 'Good' : 'BadNoData',
      },
      {
        mappingId: 'robot-status', coherenceGroupId: null, value: overrides.status ?? 0,
        unit: 'number', quality, statusCode: quality === 'GOOD' ? 'Good' : 'BadNoData',
      },
    ],
  }
}

describe('RobotFrameStatusRuntimeStoreV5', () => {
  it('returns a single-use no-op catch-up guard for an enabled Endpoint with no Robot channels', () => {
    const project = cloneWorkcellProjectV5(projectWithMappedRobotTcpAndStatus())
    ;(project.opcUa.endpoints as unknown as Array<WorkcellProjectV5['opcUa']['endpoints'][number]>).push({
      endpointId: 'idle', name: 'Idle', endpointUrl: 'opc.tcp://localhost:4841', enabled: true,
      publishingIntervalMs: 100, reconnectDelayMs: 1_000,
    })
    const runtime = createRobotFrameStatusRuntimeStoreV5(validateWorkcellProjectV5(project), REVISION)

    const guard = runtime.beginEndpointCatchup('idle', 1_000)
    expect(() => runtime.beginEndpointCatchup('idle', 1_001)).toThrow('ENDPOINT_CATCHUP_ALREADY_ACTIVE')
    expect(() => { guard.commit(); guard.commit(); guard.abort(); guard.abort() }).not.toThrow()
    expect(() => runtime.beginEndpointCatchup('idle', 1_002).abort()).not.toThrow()
    expect(() => runtime.beginEndpointCatchup('missing', 1_000)).toThrow('ENDPOINT_CATCHUP_UNKNOWN_ENDPOINT')
  })

  it('exposes the fixed revision contract and nullable configured Frame and Status values', () => {
    const runtime = createRobotFrameStatusRuntimeStoreV5(projectWithMappedRobotTcpAndStatus(), REVISION)

    expect(runtime.projectRevisionId).toBe('revision-1')
    expect(runtime.configRevision).toBe(REVISION)
    expect(runtime.sampleFrame('robot-a', 'TCP', 1_000)).toMatchObject({
      worldPose: null, quality: 'BAD', statusCode: 'BadWaitingForInitialData', owner: 'opcua:plc',
    })
    expect(runtime.readNumericStatus('robot-a')).toMatchObject({
      value: null, quality: 'BAD', statusCode: 'BadWaitingForInitialData', owner: 'opcua:plc',
    })
  })

  it('ingests a coherent Robot Frame and numeric Status, then retains both STALE', () => {
    const runtime = createRobotFrameStatusRuntimeStoreV5(projectWithMappedRobotTcpAndStatus(), REVISION)
    runtime.ingest(robotFrameStatusBatch({ sequence: 1, positionM: [0.4, 0.1, 0.8], yaw: 30, status: 7 }), 1_000)

    expect(runtime.sampleFrame('robot-a', 'TCP', 1_000)).toMatchObject({
      worldPose: { positionM: [0.4, 0.1, 0.8] }, quality: 'GOOD', owner: 'opcua:plc',
    })
    expect(runtime.readNumericStatus('robot-a')).toMatchObject({ value: 7, quality: 'GOOD', owner: 'opcua:plc' })
    runtime.markEndpointDisconnected('plc', 1_100)
    expect(runtime.sampleFrame('robot-a', 'TCP', 1_100)).toMatchObject({
      quality: 'STALE', statusCode: 'BadNoCommunication', owner: 'opcua:plc',
    })
    expect(runtime.readNumericStatus('robot-a')).toMatchObject({
      value: 7, quality: 'STALE', statusCode: 'BadNoCommunication', owner: 'opcua:plc',
    })
  })

  it('holds numeric Status instead of interpolating it and retains the last GOOD frame on BAD', () => {
    const runtime = createRobotFrameStatusRuntimeStoreV5(projectWithMappedRobotTcpAndStatus(), REVISION)
    runtime.ingest(robotFrameStatusBatch({ sequence: 1, positionM: [0, 0, 0], status: 1 }), 1_000)
    runtime.ingest(robotFrameStatusBatch({ sequence: 2, positionM: [10, 0, 0], status: 9, quality: 'BAD' }), 1_100)

    expect(runtime.sampleFrame('robot-a', 'TCP', 1_100)).toMatchObject({
      worldPose: { positionM: [0, 0, 0] }, quality: 'BAD', statusCode: 'BadNoData',
    })
    expect(runtime.readNumericStatus('robot-a')).toMatchObject({ value: 1, quality: 'BAD', statusCode: 'BadNoData' })
  })

  it('rejects replacement with duplicate Frame ownership without changing the active runtime', () => {
    const project = projectWithMappedRobotTcpAndStatus()
    const runtime = createRobotFrameStatusRuntimeStoreV5(project, REVISION)
    runtime.ingest(robotFrameStatusBatch({ positionM: [1, 0, 0] }), 1_000)
    const invalid = cloneWorkcellProjectV5(project)
    const duplicate = {
      ...invalid.opcUa.mappings[0]!,
      id: 'robot-tcp-duplicate',
      nodeAddress: { ...invalid.opcUa.mappings[0]!.nodeAddress, identifier: 'Robot.TCP.Duplicate' },
    }
    ;(invalid.opcUa.mappings as unknown as OpcUaMappingV5[]).push(duplicate)

    expect(() => runtime.replaceProject(invalid, REVISION)).toThrow('OPCUA_READ_OWNER_DUPLICATE')
    expect(runtime.sampleFrame('robot-a', 'TCP', 1_000)).toMatchObject({ worldPose: { positionM: [1, 0, 0] } })
  })

  it('resets a gateway session to accept sequence one while retaining display values', () => {
    const runtime = createRobotFrameStatusRuntimeStoreV5(projectWithMappedRobotTcpAndStatus(), REVISION)
    runtime.ingest(robotFrameStatusBatch({ sequence: 10, positionM: [1, 0, 0], status: 2 }), 1_000)

    runtime.resetGatewaySession(900)
    expect(runtime.sampleFrame('robot-a', 'TCP', 1_000)).toMatchObject({
      worldPose: { positionM: [1, 0, 0] }, quality: 'BAD', statusCode: 'BadWaitingForInitialData',
    })
    expect(runtime.readNumericStatus('robot-a')).toMatchObject({ value: 2, quality: 'BAD', statusCode: 'BadWaitingForInitialData' })
    expect(runtime.ingest(robotFrameStatusBatch({ sequence: 1, positionM: [2, 0, 0], status: 3 }), 1_001)).toBe(true)
    expect(runtime.sampleFrame('robot-a', 'TCP', 1_001)).toMatchObject({
      worldPose: { positionM: [2, 0, 0] }, quality: 'GOOD', statusCode: 'Good',
    })
    expect(runtime.readNumericStatus('robot-a')).toMatchObject({ value: 3, quality: 'GOOD', statusCode: 'Good' })
  })

  it('restores only untouched sparse catch-up channels and keeps an aborted catch-up stale', () => {
    const runtime = createRobotFrameStatusRuntimeStoreV5(projectWithMappedRobotTcpAndStatus(), REVISION)
    const initial = robotFrameStatusBatch({ sequence: 1, positionM: [1, 0, 0], status: 1 })
    expect(runtime.ingest(initial, 1_000)).toBe(true)

    const guard = runtime.beginEndpointCatchup('plc', 1_010)
    expect(() => runtime.beginEndpointCatchup('plc', 1_011)).toThrow('ENDPOINT_CATCHUP_ALREADY_ACTIVE')
    const statusOnly = robotFrameStatusBatch({ sequence: 2, status: 2 })
    expect(runtime.ingest({ ...statusOnly, sourceTimestampMs: 1_001, values: [statusOnly.values[1]!] }, 1_020)).toBe(true)
    expect(runtime.readNumericStatus('robot-a')).toMatchObject({ quality: 'STALE', statusCode: 'BadNoCommunication' })
    guard.commit()

    expect(runtime.readNumericStatus('robot-a')).toMatchObject({ value: 2, quality: 'GOOD' })
    expect(runtime.sampleFrame('robot-a', 'TCP', 1_020)).toMatchObject({
      worldPose: { positionM: [1, 0, 0] }, quality: 'GOOD',
    })

    const aborted = runtime.beginEndpointCatchup('plc', 1_030)
    const changed = robotFrameStatusBatch({ sequence: 3, status: 3 })
    expect(runtime.ingest({ ...changed, sourceTimestampMs: 1_002, values: [changed.values[1]!] }, 1_031)).toBe(true)
    aborted.abort()
    expect(runtime.readNumericStatus('robot-a')).toMatchObject({
      value: 2, quality: 'STALE', statusCode: 'BadNoCommunication',
    })
  })

  it('preserves Robot interpolation history for a State-only catch-up', () => {
    const runtime = createRobotFrameStatusRuntimeStoreV5(projectWithMappedRobotTcpAndStatus(), REVISION)
    expect(runtime.ingest(robotFrameStatusBatch({ sequence: 1, positionM: [0, 0, 0], sourceTimestampMs: 1_000 }), 1_000)).toBe(true)
    expect(runtime.ingest(robotFrameStatusBatch({ sequence: 2, positionM: [10, 0, 0], sourceTimestampMs: 1_100 }), 1_100)).toBe(true)

    const guard = runtime.beginEndpointCatchup('plc', 1_200)
    const status = robotFrameStatusBatch({ sequence: 3, status: 2, sourceTimestampMs: 1_101 })
    expect(runtime.ingest({ ...status, values: [status.values[1]!] }, 1_201)).toBe(true)
    guard.commit()

    expect(runtime.sampleFrame('robot-a', 'TCP', 1_250)).toMatchObject({ worldPose: { positionM: [5, 0, 0] } })
  })

  it('keeps a guarded Robot Frame payload and timestamps invisible until atomic commit', () => {
    const runtime = createRobotFrameStatusRuntimeStoreV5(projectWithMappedRobotTcpAndStatus(), REVISION)
    const first = robotFrameStatusBatch({ sequence: 1, positionM: [1, 0, 0], sourceTimestampMs: 1_000 })
    expect(runtime.ingest({ ...first, values: [first.values[0]!] }, 1_000)).toBe(true)
    const guard = runtime.beginEndpointCatchup('plc', 1_010)
    const next = robotFrameStatusBatch({ sequence: 2, positionM: [3, 0, 0], sourceTimestampMs: 1_100 })
    expect(runtime.ingest({ ...next, values: [next.values[0]!] }, 1_100)).toBe(true)
    expect(runtime.sampleFrame('robot-a', 'TCP', 1_100)).toMatchObject({
      worldPose: { positionM: [1, 0, 0] }, quality: 'STALE', statusCode: 'BadNoCommunication', sourceTimestampMs: 1_000,
    })
    guard.commit()
    expect(runtime.sampleFrame('robot-a', 'TCP', 1_300)).toMatchObject({ worldPose: { positionM: [3, 0, 0] }, quality: 'GOOD' })
  })

  it('appends a lifecycle-free Robot Frame catch-up to the retained interpolation trajectory', () => {
    const baseline = createRobotFrameStatusRuntimeStoreV5(projectWithMappedRobotTcpAndStatus(), REVISION)
    const guarded = createRobotFrameStatusRuntimeStoreV5(projectWithMappedRobotTcpAndStatus(), REVISION)
    for (const runtime of [baseline, guarded]) {
      const first = robotFrameStatusBatch({ sequence: 1, positionM: [0, 0, 0], sourceTimestampMs: 1_000 })
      expect(runtime.ingest({ ...first, values: [first.values[0]!] }, 1_000)).toBe(true)
    }
    const next = robotFrameStatusBatch({ sequence: 2, positionM: [10, 0, 0], sourceTimestampMs: 1_100 })
    expect(baseline.ingest({ ...next, values: [next.values[0]!] }, 1_100)).toBe(true)
    const guard = guarded.beginEndpointCatchup('plc', 1_050)
    expect(guarded.ingest({ ...next, values: [next.values[0]!] }, 1_100)).toBe(true)
    guard.commit()
    expect(guarded.sampleFrame('robot-a', 'TCP', 1_250)).toEqual(baseline.sampleFrame('robot-a', 'TCP', 1_250))
  })

  it('namespaces Robot coherence groups away from colliding Mapping IDs', () => {
    const runtime = createRobotFrameStatusRuntimeStoreV5(projectWithMappedRobotTcpAndStatus(), REVISION)
    const frame = robotFrameStatusBatch({ sequence: 1, sourceTimestampMs: 1_000 })
    expect(runtime.ingest({ ...frame, values: [frame.values[0]!] }, 1_000)).toBe(true)
    const firstStatus = robotFrameStatusBatch({ sequence: 2, sourceTimestampMs: 500, status: 1 })
    expect(runtime.ingest({ ...firstStatus, values: [firstStatus.values[1]!] }, 1_001)).toBe(true)
    const mixed = robotFrameStatusBatch({ sequence: 3, sourceTimestampMs: 900, status: 2 })
    expect(runtime.ingest({ ...mixed, values: [
      { ...mixed.values[0]!, coherenceGroupId: 'robot-status' },
      { ...mixed.values[1]!, coherenceGroupId: null },
    ] }, 1_002)).toBe(true)
    expect(runtime.readNumericStatus('robot-a')).toMatchObject({ value: 2 })
  })

  it('admits an independent fresh Robot group while rejecting a stale group atomically', () => {
    const runtime = createRobotFrameStatusRuntimeStoreV5(projectWithMappedRobotTcpAndStatus(), REVISION)
    const initialFrame = robotFrameStatusBatch({ sequence: 1, sourceTimestampMs: 1_000, positionM: [1, 0, 0] })
    expect(runtime.ingest({ ...initialFrame, values: [initialFrame.values[0]!] }, 1_000)).toBe(true)
    const initialStatus = robotFrameStatusBatch({ sequence: 2, sourceTimestampMs: 500, status: 1 })
    expect(runtime.ingest({ ...initialStatus, values: [initialStatus.values[1]!] }, 1_001)).toBe(true)
    const status = robotFrameStatusBatch({ sequence: 3, sourceTimestampMs: 900, status: 2 })
    expect(runtime.ingest({ ...status, values: [status.values[0]!, status.values[1]!] }, 1_002)).toBe(true)
    expect(runtime.sampleFrame('robot-a', 'TCP', 1_002)).toMatchObject({ worldPose: { positionM: [1, 0, 0] } })
    expect(runtime.readNumericStatus('robot-a')).toMatchObject({ value: 2 })

    const grouped = robotFrameStatusBatch({ sequence: 4, sourceTimestampMs: 800, status: 3 })
    expect(runtime.ingest({ ...grouped, values: [
      { ...grouped.values[0]!, coherenceGroupId: 'paired' },
      { ...grouped.values[1]!, coherenceGroupId: 'paired' },
    ] }, 1_003)).toBe(false)
    expect(runtime.readNumericStatus('robot-a')).toMatchObject({ value: 2 })
  })

  it('aborts a Robot cut back to its pose buffer and live fences before durable STALE', () => {
    const runtime = createRobotFrameStatusRuntimeStoreV5(projectWithMappedRobotTcpAndStatus(), REVISION)
    const first = robotFrameStatusBatch({ sequence: 1, positionM: [1, 0, 0], sourceTimestampMs: 1_000 })
    expect(runtime.ingest({ ...first, values: [first.values[0]!] }, 1_000)).toBe(true)
    const guard = runtime.beginEndpointCatchup('plc', 1_001)
    const second = robotFrameStatusBatch({ sequence: 2, positionM: [2, 0, 0], sourceTimestampMs: 1_001 })
    expect(runtime.ingest({ ...second, values: [second.values[0]!] }, 1_002)).toBe(true)
    guard.abort()
    expect(runtime.sampleFrame('robot-a', 'TCP', 1_001)).toMatchObject({ worldPose: { positionM: [1, 0, 0] }, quality: 'STALE', sourceTimestampMs: 1_000 })
    expect(runtime.ingest({ ...second, values: [second.values[0]!] }, 1_003)).toBe(true)
  })

  it('keeps Robot reads quarantined through a guarded lifecycle reset and invalidates the guard on gateway reset', () => {
    const runtime = createRobotFrameStatusRuntimeStoreV5(projectWithMappedRobotTcpAndStatus(), REVISION)
    const first = robotFrameStatusBatch({ positionM: [1, 0, 0] })
    expect(runtime.ingest({ ...first, values: [first.values[0]!] }, 1_000)).toBe(true)
    const guard = runtime.beginEndpointCatchup('plc', 1_001)
    runtime.resetEndpointSession('plc', 1_002)
    expect(runtime.sampleFrame('robot-a', 'TCP', 1_002)).toMatchObject({ quality: 'STALE', statusCode: 'BadNoCommunication' })
    guard.commit()
    expect(runtime.sampleFrame('robot-a', 'TCP', 1_002)).toMatchObject({ quality: 'BAD', statusCode: 'BadWaitingForInitialData' })
    const invalidated = runtime.beginEndpointCatchup('plc', 1_003)
    runtime.resetGatewaySession(1_004)
    invalidated.commit()
    expect(runtime.sampleFrame('robot-a', 'TCP', 1_004)).toMatchObject({ quality: 'BAD', statusCode: 'BadWaitingForInitialData' })
  })

  it('invalidates an outstanding Robot guard on project replacement', () => {
    const project = projectWithMappedRobotTcpAndStatus()
    const runtime = createRobotFrameStatusRuntimeStoreV5(project, REVISION)
    const guard = runtime.beginEndpointCatchup('plc', 1_000)
    runtime.replaceProject(project, REVISION)
    guard.abort(); guard.commit()
    expect(runtime.sampleFrame('robot-a', 'TCP', 1_000)).toMatchObject({ quality: 'BAD', statusCode: 'BadWaitingForInitialData' })
  })

  it('commits a rejected-only Robot cut by restoring its untouched pre-cut pose', () => {
    const runtime = createRobotFrameStatusRuntimeStoreV5(projectWithMappedRobotTcpAndStatus(), REVISION)
    const first = robotFrameStatusBatch({ positionM: [1, 0, 0], sourceTimestampMs: 1_000 })
    expect(runtime.ingest({ ...first, values: [first.values[0]!] }, 1_000)).toBe(true)
    const guard = runtime.beginEndpointCatchup('plc', 1_001)
    const stale = robotFrameStatusBatch({ sequence: 2, positionM: [2, 0, 0], sourceTimestampMs: 999 })
    expect(runtime.ingest({ ...stale, values: [stale.values[0]!] }, 1_002)).toBe(false)
    guard.commit()
    expect(runtime.sampleFrame('robot-a', 'TCP', 1_002)).toMatchObject({ worldPose: { positionM: [1, 0, 0] }, quality: 'GOOD' })
  })

  it('deeply freezes the retained Robot fallback pose after reset before a sample', () => {
    const runtime = createRobotFrameStatusRuntimeStoreV5(projectWithMappedRobotTcpAndStatus(), REVISION)
    runtime.ingest(robotFrameStatusBatch({ positionM: [1, 2, 3] }), 1_000)
    runtime.resetGatewaySession(1_001)
    const snapshot = runtime.sampleFrame('robot-a', 'TCP', 1_001)!

    expect(Object.isFrozen(snapshot.worldPose)).toBe(true)
    expect(Object.isFrozen(snapshot.worldPose!.positionM)).toBe(true)
    expect(Object.isFrozen(snapshot.worldPose!.quaternion)).toBe(true)
    expect(() => { (snapshot.worldPose!.positionM as unknown as number[])[0] = 99 }).toThrow()
    expect(runtime.sampleFrame('robot-a', 'TCP', 1_001)?.worldPose?.positionM).toEqual([1, 2, 3])
  })
})
