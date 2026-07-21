import { describe, expect, it } from 'vitest'
import { createDualRobotSampleV4 } from '../../project/v4/dual-robot-sample-v4.js'
import { bindBrRobotJointsV4 } from '../../project/v4/robot-joint-opcua-binding-v4.js'
import { projectV4ToV5Gateway } from './project-v4-to-v5-gateway.js'

describe('V4 Runtime Gateway project adapter', () => {
  it('converts a B&R client project into a V5-valid Robot joint project', () => {
    const source = createDualRobotSampleV4({
      projectId: 'project-test', revisionId: 'revision-test', nowIso: '2026-07-21T00:00:00.000Z',
    })
    const robot = source.robots[0]!
    const bound = bindBrRobotJointsV4(source, robot.id)
    const converted = projectV4ToV5Gateway(bound)

    expect(converted.schemaVersion).toBe(5)
    expect(converted.opcUa.mode).toBe('client')
    expect(converted.opcUa.mappings).toHaveLength(6)
    expect(converted.opcUa.mappings[0]).toMatchObject({
      nodeAddress: {
        namespaceUri: 'http://br-automation.com/OpcUa/PLC/PV/',
        identifierType: 'string',
        identifier: '::Sample6X:Rob.Q1',
      },
      leaves: [{ projectTarget: { type: 'robot-joint', robotId: robot.id, jointId: 'J1' } }],
    })
  })
})
