import { describe, expect, it } from 'vitest'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { createDualRobotSampleV4 } from './dual-robot-sample-v4.js'
import {
  bindBrRobotJointsV4,
  brRobotJointOpcUaBindingsV4,
  BR_ROBOT_OPCUA_ENDPOINT_ID_V4,
} from './robot-joint-opcua-binding-v4.js'

describe('B&R Robot OPC UA Q1-Q6 binding', () => {
  it('maps the first six Robot Joints to the verified Rob nodes', () => {
    const project = createDualRobotSampleV4({
      projectId: 'project-test', revisionId: 'revision-test', nowIso: '2026-07-21T00:00:00.000Z',
    })
    const robot = project.robots[0]!
    const bound = bindBrRobotJointsV4(project, robot.id)

    expect(bound.opcUa.mode).toBe('client')
    expect(bound.opcUa.endpoints).toEqual([
      expect.objectContaining({
        endpointId: BR_ROBOT_OPCUA_ENDPOINT_ID_V4,
        endpointUrl: 'opc.tcp://127.0.0.1:4840',
        enabled: true,
      }),
    ])
    expect(bound.robots[0]!.jointSource).toBe(`opcua:${BR_ROBOT_OPCUA_ENDPOINT_ID_V4}`)
    expect(bound.opcUa.mappings.slice(-6).map((mapping) => ({
      nodeId: mapping.leaves[0]!.nodeId,
      target: mapping.leaves[0]!.projectTarget,
    }))).toEqual([
      { nodeId: 'ns=5;s=::Sample6X:Rob.Q1', target: { type: 'robot-joint', robotId: robot.id, jointId: 'J1' } },
      { nodeId: 'ns=5;s=::Sample6X:Rob.Q2', target: { type: 'robot-joint', robotId: robot.id, jointId: 'J2' } },
      { nodeId: 'ns=5;s=::Sample6X:Rob.Q3', target: { type: 'robot-joint', robotId: robot.id, jointId: 'J3' } },
      { nodeId: 'ns=5;s=::Sample6X:Rob.Q4', target: { type: 'robot-joint', robotId: robot.id, jointId: 'J4' } },
      { nodeId: 'ns=5;s=::Sample6X:Rob.Q5', target: { type: 'robot-joint', robotId: robot.id, jointId: 'J5' } },
      { nodeId: 'ns=5;s=::Sample6X:Rob.Q6', target: { type: 'robot-joint', robotId: robot.id, jointId: 'J6' } },
    ])
  })

  it('reports when a Robot has fewer than six Joints', () => {
    const project = makeMinimalWorkcellProjectV4()
    expect(() => brRobotJointOpcUaBindingsV4(project, project.robots[0]!.id)).toThrow(
      'at least six Joints',
    )
  })
})
