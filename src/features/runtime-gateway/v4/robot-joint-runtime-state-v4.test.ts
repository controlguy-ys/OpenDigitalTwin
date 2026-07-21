import { describe, expect, it } from 'vitest'
import { createDualRobotSampleV4 } from '../../project/v4/dual-robot-sample-v4.js'
import { bindBrRobotJointsV4 } from '../../project/v4/robot-joint-opcua-binding-v4.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import { createRobotJointRuntimeStateV4 } from './robot-joint-runtime-state-v4.js'

describe('V4 Robot Joint OPC UA runtime state', () => {
  it('applies a live StateBatch to all six mapped Joints and fences stale batches', () => {
    const source = createDualRobotSampleV4({
      projectId: 'project-test', revisionId: 'revision-test', nowIso: '2026-07-21T00:00:00.000Z',
    })
    const robot = source.robots[0]!
    const project = bindBrRobotJointsV4(source, robot.id)
    const registry = createRobotRuntimeRegistryV4()
    registry.getState().replaceProject(project)
    const configRevision = 'a'.repeat(64)
    const runtime = createRobotJointRuntimeStateV4(project, registry, configRevision)
    const values = project.opcUa.mappings.slice(-6).map((mapping, index) => ({
      mappingId: mapping.id,
      coherenceGroupId: null,
      value: index + 1,
      unit: 'deg',
      quality: 'GOOD' as const,
      statusCode: 'Good',
    }))
    const batch = {
      type: 'state-batch-v1' as const,
      protocolVersion: 1 as const,
      gatewayId: 'gateway-local',
      projectId: project.projectId,
      configRevision,
      endpointId: 'endpoint-br-robot',
      sequence: 1,
      sourceTimestampMs: 100,
      publishedTimestampMs: 100,
      originId: 'gateway-local:opcua-client',
      values,
    }

    expect(runtime.ingest(batch, 200)).toBe(true)
    expect(registry.getState().robots[robot.id]!.jointValues).toMatchObject({
      J1: 1, J2: 2, J3: 3, J4: 4, J5: 5, J6: 6,
    })
    expect(runtime.ingest({ ...batch, sequence: 1, sourceTimestampMs: 101, publishedTimestampMs: 101 }, 201)).toBe(false)
  })
})
