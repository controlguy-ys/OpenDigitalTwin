import { describe, expect, it } from 'vitest'

import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import type { StateBatchV1 } from '../../../core/runtime-protocol/v1.js'
import { createRobotJointRuntimeStoreV5 } from './robot-joint-runtime-store.js'

const REVISION = 'a'.repeat(64)

function projectWithOpcUaRobot() {
  const project = structuredClone(makeMinimalWorkcellProjectV5())
  const robot = project.robots[0] as { jointSource: `opcua:${string}` }
  robot.jointSource = 'opcua:endpoint-1'
  const mapping = project.opcUa.mappings[0] as unknown as { leaves: Array<{ projectTarget: unknown; projectDataType: string; opcUaDataType: string }> }
  mapping.leaves[0]!.projectTarget = { type: 'robot-joint', robotId: 'robot-1', jointId: 'J1' }
  mapping.leaves[0]!.projectDataType = 'number'
  mapping.leaves[0]!.opcUaDataType = 'Double'
  return project
}

function jointBatch(value: unknown, sequence = 1, options: { readonly endpointId?: string; readonly mappingId?: string; readonly sourceTimestampMs?: number; readonly publishedTimestampMs?: number; readonly configRevision?: string } = {}): StateBatchV1 {
  return {
    type: 'state-batch-v1', protocolVersion: 1, gatewayId: 'gateway', projectId: 'project-v5',
    configRevision: options.configRevision ?? REVISION, endpointId: options.endpointId ?? 'endpoint-1', sequence,
    sourceTimestampMs: options.sourceTimestampMs ?? 10, publishedTimestampMs: options.publishedTimestampMs ?? options.sourceTimestampMs ?? 10, originId: 'gateway',
    values: [{ mappingId: options.mappingId ?? 'mapping-1', coherenceGroupId: null, value, unit: 'degree', quality: 'GOOD', statusCode: 'Good' }],
  } as StateBatchV1
}

function projectWithTwoOpcUaRobots() {
  const project = projectWithOpcUaRobot()
  const first = project.robots[0]!
  ;(project.robots as unknown as unknown[]).push({ ...first, id: 'robot-2', name: 'Robot 2', serialNumber: 'ROBOT-SAMPLE-002', jointSource: 'opcua:endpoint-2' })
  ;(project.opcUa.endpoints as unknown as unknown[]).push({ endpointId: 'endpoint-2', name: 'Controller 2', endpointUrl: 'opc.tcp://localhost:4841', enabled: true, publishingIntervalMs: 100, reconnectDelayMs: 1_000 })
  const mapping = structuredClone(project.opcUa.mappings[0]!)
  ;(mapping as unknown as { id: string; endpointId: string; leaves: Array<{ projectTarget: unknown }> }).id = 'mapping-2'
  ;(mapping as unknown as { endpointId: string }).endpointId = 'endpoint-2'
  ;(mapping as unknown as { leaves: Array<{ projectTarget: unknown }> }).leaves[0]!.projectTarget = { type: 'robot-joint', robotId: 'robot-2', jointId: 'J1' }
  ;(project.opcUa.mappings as unknown as unknown[]).push(mapping)
  return project
}

function projectWithSameEndpointRobots() {
  const project = projectWithTwoOpcUaRobots()
  ;(project.robots[1] as { jointSource: `opcua:${string}` }).jointSource = 'opcua:endpoint-1'
  ;(project.opcUa.mappings[1] as { endpointId: string; nodeAddress: { identifier: string } }).endpointId = 'endpoint-1'
  ;(project.opcUa.mappings[1] as { nodeAddress: { identifier: string } }).nodeAddress.identifier = 'Signals.Robot2.J1'
  return project
}

describe('RobotJointRuntimeStoreV5', () => {
  it('applies a subscribed Joint only to an OPC UA-owned Robot', () => {
    const robots = createRobotJointRuntimeStoreV5(projectWithOpcUaRobot(), REVISION)
    expect(robots.getState().ingest(jointBatch(22.5), 1_000)).toBe(true)
    expect(robots.getState().readRobot('robot-1')).toMatchObject({
      jointValues: { J1: 22.5 }, jointSource: 'opcua:endpoint-1', quality: 'GOOD',
    })
    expect(() => robots.getState().writeJointValues('robot-1', { J1: 0 }, 'simulation'))
      .toThrow('ROBOT_JOINT_OWNERSHIP_CONFLICT')
  })

  it('retains values as STALE and resets only its owner to BAD', () => {
    const robots = createRobotJointRuntimeStoreV5(projectWithOpcUaRobot(), REVISION)
    robots.getState().ingest(jointBatch(22.5), 1_000)
    robots.getState().markEndpointDisconnected('endpoint-1', 1_001)
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ jointValues: { J1: 22.5 }, quality: 'STALE' })
    robots.getState().resetEndpointSession('endpoint-1', 1_002)
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ jointValues: { J1: 22.5 }, quality: 'BAD', statusCode: 'BadWaitingForInitialData' })
  })

  it('restores a framed replay without live fences and isolates catch-up rollback', () => {
    const robots = createRobotJointRuntimeStoreV5(projectWithOpcUaRobot(), REVISION)
    expect(robots.getState().restoreReplayPrefix(jointBatch(10, 99), 10)).toBe(true)
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ jointValues: { J1: 10 }, quality: 'GOOD' })

    const guard = robots.getState().beginEndpointCatchup('endpoint-1', 11)
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ jointValues: { J1: 10 }, quality: 'STALE' })
    expect(robots.getState().ingest(jointBatch(20, 1), 12)).toBe(true)
    guard.abort()
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ jointValues: { J1: 10 }, quality: 'STALE' })
    robots.getState().resetEndpointSession('endpoint-1', 13)
    expect(robots.getState().ingest(jointBatch(30, 1), 14)).toBe(true)
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ jointValues: { J1: 30 }, quality: 'GOOD' })
  })

  it('keeps endpoint reset and disconnect changes quarantined inside catch-up until completion', () => {
    const robots = createRobotJointRuntimeStoreV5(projectWithOpcUaRobot(), REVISION)
    robots.getState().ingest(jointBatch(20, 9, { sourceTimestampMs: 100, publishedTimestampMs: 100 }), 100)
    const guard = robots.getState().beginEndpointCatchup('endpoint-1', 101)
    robots.getState().resetEndpointSession('endpoint-1', 102)
    robots.getState().markEndpointDisconnected('endpoint-1', 103)
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ jointValues: { J1: 20 }, quality: 'STALE' })
    expect(robots.getState().ingest(jointBatch(5, 1, { sourceTimestampMs: 1, publishedTimestampMs: 1 }), 104)).toBe(true)
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ jointValues: { J1: 20 }, quality: 'STALE' })
    guard.abort()
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ jointValues: { J1: 20 }, quality: 'STALE' })
    expect(robots.getState().ingest(jointBatch(6, 1, { sourceTimestampMs: 2, publishedTimestampMs: 2 }), 105)).toBe(false)
  })

  it('installs guard and ordering fences before observable publications', () => {
    const robots = createRobotJointRuntimeStoreV5(projectWithOpcUaRobot(), REVISION)
    let catchupAttempt = 'none'
    let triedCatchup = false
    const stopCatchup = robots.subscribe((state) => {
      if (!triedCatchup && state.byRobotId['robot-1']?.quality === 'STALE') {
        triedCatchup = true
        try { state.beginEndpointCatchup('endpoint-1', 2); catchupAttempt = 'started' } catch { catchupAttempt = 'blocked' }
      }
    })
    const guard = robots.getState().beginEndpointCatchup('endpoint-1', 1)
    stopCatchup()
    expect(catchupAttempt).toBe('blocked')
    guard.abort()

    let reentered = false
    const stopIngest = robots.subscribe((state) => {
      if (!reentered && state.byRobotId['robot-1']?.quality === 'GOOD') {
        reentered = true
        state.ingest(jointBatch(5, 1, { sourceTimestampMs: 50, publishedTimestampMs: 50 }), 101)
      }
    })
    expect(robots.getState().ingest(jointBatch(10, 2, { sourceTimestampMs: 100, publishedTimestampMs: 100 }), 100)).toBe(true)
    stopIngest()
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ jointValues: { J1: 10 } })
  })

  it('clears reset fences before notifying subscribers', () => {
    const robots = createRobotJointRuntimeStoreV5(projectWithOpcUaRobot(), REVISION)
    robots.getState().ingest(jointBatch(10, 9, { sourceTimestampMs: 100, publishedTimestampMs: 100 }), 100)
    let guard!: { commit(): void; abort(): void }
    let started = false
    const stop = robots.subscribe((state) => {
      if (!started && state.byRobotId['robot-1']?.statusCode === 'BadWaitingForInitialData') {
        started = true
        guard = state.beginEndpointCatchup('endpoint-1', 102)
      }
    })
    robots.getState().resetEndpointSession('endpoint-1', 101)
    stop()
    guard.abort()
    expect(robots.getState().ingest(jointBatch(2, 1, { sourceTimestampMs: 1, publishedTimestampMs: 1 }), 103)).toBe(true)
  })

  it('isolates endpoints, fences live clocks, and admits lower clocks after an endpoint reset', () => {
    const robots = createRobotJointRuntimeStoreV5(projectWithTwoOpcUaRobots(), REVISION)
    expect(robots.getState().ingest(jointBatch(20, 9, { sourceTimestampMs: 100, publishedTimestampMs: 100 }), 100)).toBe(true)
    expect(robots.getState().ingest(jointBatch(30, 1, { endpointId: 'endpoint-2', mappingId: 'mapping-2', sourceTimestampMs: 100, publishedTimestampMs: 100 }), 100)).toBe(true)
    expect(robots.getState().ingest(jointBatch(21, 10, { configRevision: 'b'.repeat(64), sourceTimestampMs: 101 }), 101)).toBe(false)
    expect(robots.getState().ingest(jointBatch(21, 10, { sourceTimestampMs: 101 }), 99)).toBe(false)
    expect(robots.getState().ingest(jointBatch(21, 10, { sourceTimestampMs: 99, publishedTimestampMs: 101 }), 101)).toBe(false)
    expect(robots.getState().ingest(jointBatch(21, 10, { sourceTimestampMs: 101, publishedTimestampMs: 99 }), 101)).toBe(false)
    robots.getState().markEndpointDisconnected('endpoint-1', 102)
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ quality: 'STALE' })
    expect(robots.getState().readRobot('robot-2')).toMatchObject({ quality: 'GOOD', jointValues: { J1: 30 } })
    robots.getState().resetEndpointSession('endpoint-1', 103)
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ quality: 'BAD', statusCode: 'BadWaitingForInitialData' })
    expect(robots.getState().readRobot('robot-2')).toMatchObject({ quality: 'GOOD' })
    expect(robots.getState().ingest(jointBatch(1, 1, { sourceTimestampMs: 1, publishedTimestampMs: 1 }), 104)).toBe(true)
  })

  it('quarantines owned Robots and restores untouched same-endpoint channels on sparse catch-up commit', () => {
    const robots = createRobotJointRuntimeStoreV5(projectWithSameEndpointRobots(), REVISION)
    const initial = {
      ...jointBatch(10, 1), values: [
        { mappingId: 'mapping-1', coherenceGroupId: null, value: 10, unit: 'degree', quality: 'GOOD' as const, statusCode: 'Good' },
        { mappingId: 'mapping-2', coherenceGroupId: null, value: 20, unit: 'degree', quality: 'GOOD' as const, statusCode: 'Good' },
      ],
    }
    expect(robots.getState().ingest(initial, 1)).toBe(true)
    const guard = robots.getState().beginEndpointCatchup('endpoint-1', 2)
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ quality: 'STALE' })
    expect(robots.getState().readRobot('robot-2')).toMatchObject({ quality: 'STALE' })
    expect(robots.getState().ingest(jointBatch(11, 2), 3)).toBe(true)
    guard.commit()
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ quality: 'GOOD', jointValues: { J1: 11 } })
    expect(robots.getState().readRobot('robot-2')).toMatchObject({ quality: 'GOOD', jointValues: { J1: 20 } })
  })

  it('rejects an entire coherence group when one of its channels is stale', () => {
    const robots = createRobotJointRuntimeStoreV5(projectWithSameEndpointRobots(), REVISION)
    robots.getState().ingest(jointBatch(10, 1, { sourceTimestampMs: 100, publishedTimestampMs: 100 }), 1)
    robots.getState().ingest(jointBatch(20, 2, { mappingId: 'mapping-2', sourceTimestampMs: 10, publishedTimestampMs: 10 }), 2)
    const grouped = {
      ...jointBatch(11, 3, { sourceTimestampMs: 50, publishedTimestampMs: 50 }), values: [
        { mappingId: 'mapping-1', coherenceGroupId: 'both', value: 11, unit: 'degree', quality: 'GOOD' as const, statusCode: 'Good' },
        { mappingId: 'mapping-2', coherenceGroupId: 'both', value: 21, unit: 'degree', quality: 'GOOD' as const, statusCode: 'Good' },
      ],
    }
    expect(robots.getState().ingest(grouped, 3)).toBe(false)
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ jointValues: { J1: 10 } })
    expect(robots.getState().readRobot('robot-2')).toMatchObject({ jointValues: { J1: 20 } })
  })

  it('makes a gateway reset durable across an old catch-up guard and admits a fresh low clock', () => {
    const robots = createRobotJointRuntimeStoreV5(projectWithOpcUaRobot(), REVISION)
    robots.getState().ingest(jointBatch(20, 9, { sourceTimestampMs: 100, publishedTimestampMs: 100 }), 100)
    const guard = robots.getState().beginEndpointCatchup('endpoint-1', 101)
    robots.getState().resetGatewaySession(102)
    guard.commit()
    guard.abort()
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ quality: 'BAD', statusCode: 'BadWaitingForInitialData' })
    expect(robots.getState().ingest(jointBatch(1, 1, { sourceTimestampMs: 1, publishedTimestampMs: 1 }), 103)).toBe(true)
  })

  it('publishes one atomic all-Endpoint Gateway reset', () => {
    const robots = createRobotJointRuntimeStoreV5(projectWithTwoOpcUaRobots(), REVISION)
    robots.getState().ingest(jointBatch(10, 1), 1)
    robots.getState().ingest(jointBatch(20, 1, { endpointId: 'endpoint-2', mappingId: 'mapping-2' }), 1)
    const snapshots: string[][] = []
    const stop = robots.subscribe((state) => {
      if (Object.values(state.byRobotId).some((robot) => robot.quality === 'BAD')) {
        snapshots.push(['robot-1', 'robot-2'].map((id) => state.byRobotId[id]!.quality))
      }
    })
    robots.getState().resetGatewaySession(2)
    stop()
    expect(snapshots).toEqual([['BAD', 'BAD']])
  })

  it('keeps an active guard and Project intact when replacement compilation fails', () => {
    const project = projectWithOpcUaRobot()
    const robots = createRobotJointRuntimeStoreV5(project, REVISION)
    const guard = robots.getState().beginEndpointCatchup('endpoint-1', 1)
    const invalid = structuredClone(project)
    ;(invalid.robots[0] as { name: string }).name = ''
    expect(() => robots.getState().replaceProject(invalid, 'b'.repeat(64))).toThrow()
    expect(() => robots.getState().beginEndpointCatchup('endpoint-1', 2)).toThrow('ENDPOINT_CATCHUP_ALREADY_ACTIVE')
    expect(robots.getState()).toMatchObject({ projectRevisionId: project.revisionId, configRevision: REVISION })
    guard.abort()
  })

  it('uses own-key Robot lookup semantics', () => {
    const robots = createRobotJointRuntimeStoreV5(projectWithOpcUaRobot(), REVISION)
    expect(robots.getState().readRobot('toString')).toBeNull()
    expect(robots.getState().readRobot('constructor')).toBeNull()
    expect(Object.getPrototypeOf(robots.getState().byRobotId)).toBeNull()
  })

  it('keeps an old no-channel guard from completing a replacement guard', () => {
    const project = projectWithOpcUaRobot()
    ;(project.opcUa.endpoints as unknown as unknown[]).push({ endpointId: 'endpoint-empty', name: 'Empty', endpointUrl: 'opc.tcp://localhost:4842', enabled: true, publishingIntervalMs: 100, reconnectDelayMs: 1_000 })
    const robots = createRobotJointRuntimeStoreV5(project, REVISION)
    const old = robots.getState().beginEndpointCatchup('endpoint-empty', 1)
    robots.getState().resetEndpointSession('endpoint-empty', 2)
    expect(() => robots.getState().beginEndpointCatchup('endpoint-empty', 3)).toThrow('ENDPOINT_CATCHUP_ALREADY_ACTIVE')
    old.commit()
    const replacement = robots.getState().beginEndpointCatchup('endpoint-empty', 4)
    replacement.abort()
    expect(() => robots.getState().beginEndpointCatchup('endpoint-empty', 5)).not.toThrow()
  })

  it('rejects non-plain Joint updates without invoking accessors', () => {
    const robots = createRobotJointRuntimeStoreV5(makeMinimalWorkcellProjectV5(), REVISION)
    const accessor = {} as Record<string, number>
    Object.defineProperty(accessor, 'J1', { enumerable: true, get: () => { throw new Error('must not invoke') } })
    const symbol = { J1: 1 } as Record<string, number>
    Object.defineProperty(symbol, Symbol('extra'), { enumerable: true, value: 2 })
    for (const value of [Object.create({ J1: 1 }) as Record<string, number>, accessor, symbol]) {
      expect(() => robots.getState().writeJointValues('robot-1', value, 'simulation')).toThrow('PROJECT_VALUE_INVALID')
      expect(robots.getState().readRobot('robot-1')?.jointValues).toEqual({ J1: 0 })
    }
  })

  it('retains the last valid Joint value when GOOD OPC UA data has the wrong type or exceeds limits', () => {
    const robots = createRobotJointRuntimeStoreV5(projectWithOpcUaRobot(), REVISION)
    robots.getState().ingest(jointBatch(20, 1), 1)
    expect(robots.getState().ingest(jointBatch('bad', 2, { sourceTimestampMs: 20, publishedTimestampMs: 20 }), 2)).toBe(true)
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ jointValues: { J1: 20 }, quality: 'BAD', statusCode: 'BadTypeMismatch' })
    expect(robots.getState().ingest(jointBatch(999, 3, { sourceTimestampMs: 30, publishedTimestampMs: 30 }), 3)).toBe(true)
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ jointValues: { J1: 20 }, quality: 'BAD', statusCode: 'BadOutOfRange' })
    expect(() => robots.getState().ingest(jointBatch(Number.NaN, 4, { sourceTimestampMs: 40, publishedTimestampMs: 40 }), 4)).toThrow('RUNTIME_PROTOCOL_INVALID')
    expect(robots.getState().readRobot('robot-1')).toMatchObject({ jointValues: { J1: 20 }, quality: 'BAD', statusCode: 'BadOutOfRange' })
  })
})
