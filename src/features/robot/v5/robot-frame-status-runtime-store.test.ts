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
    sourceTimestampMs: 1_000, publishedTimestampMs: 1_020, originId: 'gateway-test:client',
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
