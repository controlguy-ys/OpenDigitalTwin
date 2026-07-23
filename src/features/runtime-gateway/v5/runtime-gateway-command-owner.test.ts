import { describe, expect, it, vi } from 'vitest'

import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import type { CommandBatchV1, RuntimeScalarOrStructureV1 } from '../../../core/runtime-protocol/v1.js'
import { createRuntimeGatewayCommandOwnerV5 } from './runtime-gateway-command-owner.js'

const REVISION = 'a'.repeat(64)
const lease = (generation = 7, expiresAt = 6_000) => ({ projectId: 'project-v5', configRevision: REVISION, publisherId: 'browser-a', generation, expiresAt })

function projectWithBox() {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project.spatialEntities as unknown as unknown[]).push({
    id: 'box-1', name: 'Box', geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#ffffff' },
    parentFrameId: 'world', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    visible: true, groupId: null, removable: true, transformOwner: 'simulation',
    numericStatus: { value: 0, sourceOwnership: 'simulation', overlay: { visible: false, frameId: null } },
    graspable: false, graspFrames: [], movingFrames: [],
  })
  return project
}

function batch(value: RuntimeScalarOrStructureV1, commandId = 'command-1', targetId = 'robot-1'): CommandBatchV1 {
  return {
    type: 'command-batch-v1', protocolVersion: 1, projectId: 'project-v5', configRevision: REVISION,
    leaseGeneration: 7, commands: [{ commandId, expiresAt: 2_000, targetId, value }],
  }
}

describe('RuntimeGatewayCommandOwnerV5', () => {
  it('time-fences an expired accepted lease before and after a delayed Simulation mutation', async () => {
    const project = projectWithBox()
    let now = 1_000
    let releaseWrite!: () => void
    const delayedWrite = vi.fn(() => new Promise<void>((resolve) => { releaseWrite = resolve }))
    const owner = createRuntimeGatewayCommandOwnerV5({
      project, configRevision: REVISION, nowMs: () => now,
      readLease: () => ({ projectId: 'project-v5', configRevision: REVISION, publisherId: 'browser-a', generation: 7, expiresAt: 1_100 }),
      simulation: { writeJointValues: delayedWrite, commitObjectPose: vi.fn(), writeLogicalSignal: vi.fn(), startJob: vi.fn(), cancelJob: vi.fn() },
    })
    const executing = owner.execute(batch({ kind: 'robot-joint-target', robotId: 'robot-1', jointValues: { J1: 12 } }))
    now = 1_100
    releaseWrite()
    await expect(executing).resolves.toMatchObject({ acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE' })

    now = 1_100
    await expect(owner.execute(batch({ kind: 'robot-joint-target', robotId: 'robot-1', jointValues: { J1: 13 } }, 'expired-before-write')))
      .resolves.toMatchObject({ acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE' })
    expect(delayedWrite).toHaveBeenCalledOnce()
  })

  it('requires the currently accepted Browser lease generation before a Simulation mutation', async () => {
    const project = projectWithBox()
    let accepted = false
    const writeJointValues = vi.fn()
    const owner = createRuntimeGatewayCommandOwnerV5({
      project, configRevision: REVISION, nowMs: () => 1_000,
      readLease: () => accepted ? lease() : null,
      simulation: { writeJointValues, commitObjectPose: vi.fn(), writeLogicalSignal: vi.fn(), startJob: vi.fn(), cancelJob: vi.fn() },
    })
    await expect(owner.execute(batch({ kind: 'robot-joint-target', robotId: 'robot-1', jointValues: { J1: 12 } })))
      .resolves.toMatchObject({ acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE' })
    expect(writeJointValues).not.toHaveBeenCalled()

    accepted = true
    await expect(owner.execute(batch({ kind: 'robot-joint-target', robotId: 'robot-1', jointValues: { J1: 12 } })))
      .resolves.toMatchObject({ acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED' })
    expect(writeJointValues).toHaveBeenCalledOnce()
  })

  it('validates exact Robot Joint IDs before one V5 Simulation commit', async () => {
    const project = projectWithBox()
    const writeJointValues = vi.fn()
    const owner = createRuntimeGatewayCommandOwnerV5({
      project, configRevision: REVISION, readLease: () => lease(), nowMs: () => 1_000,
      simulation: { writeJointValues, commitObjectPose: vi.fn(), writeLogicalSignal: vi.fn(), startJob: vi.fn(), cancelJob: vi.fn() },
    })
    await expect(owner.execute(batch({ kind: 'robot-joint-target', robotId: 'robot-1', jointValues: { J1: 12 } })))
      .resolves.toMatchObject({ executionState: 'SUCCEEDED' })
    expect(writeJointValues).toHaveBeenCalledExactlyOnceWith('robot-1', { J1: 12 })
    await expect(owner.execute(batch({ kind: 'robot-joint-target', robotId: 'robot-1', jointValues: { J2: 12 } }, 'bad-joint')))
      .resolves.toMatchObject({ acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_TARGET_INVALID' })
  })

  it('converts a complete RPY command exactly once at the simulation boundary', async () => {
    const project = projectWithBox()
    const commitObjectPose = vi.fn()
    const owner = createRuntimeGatewayCommandOwnerV5({
      project, configRevision: REVISION, readLease: () => lease(), nowMs: () => 1_000,
      simulation: { writeJointValues: vi.fn(), commitObjectPose, writeLogicalSignal: vi.fn(), startJob: vi.fn(), cancelJob: vi.fn() },
    })
    await owner.execute(batch({
      kind: 'scene-object-pose', objectId: 'box-1', pose: { x: 1, y: 2, z: 3, roll: 0, pitch: 0, yaw: Math.PI },
    }, 'command-1', 'box-1'))
    expect(commitObjectPose).toHaveBeenCalledExactlyOnceWith('box-1', expect.objectContaining({
      positionM: [1, 2, 3], quaternion: [0, 0, 1, 0],
    }))
  })
})
