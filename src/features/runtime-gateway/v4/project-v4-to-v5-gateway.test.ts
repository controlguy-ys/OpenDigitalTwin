import { describe, expect, it } from 'vitest'
import { createDualRobotSampleV4 } from '../../project/v4/dual-robot-sample-v4.js'
import { bindBrObjectPosBoxesV4 } from '../../project/v4/box-objectpos-opcua-binding-v4.js'
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

  it('preserves six distinct ObjectPos scalar roots in one entity pose mapping', () => {
    const source = createDualRobotSampleV4({
      projectId: 'project-test', revisionId: 'revision-test', nowIso: '2026-07-21T00:00:00.000Z',
    })
    const bound = bindBrObjectPosBoxesV4(source)
    const converted = projectV4ToV5Gateway(bound)
    const mapping = converted.opcUa.mappings.find(({ id }) => id === 'mapping-object-pos-00')!

    expect(converted.opcUa.mappings).toHaveLength(20)
    expect(mapping.leaves).toHaveLength(6)
    expect(mapping.leaves.map(({ nodeAddress }) => nodeAddress?.identifier)).toEqual([
      '::Sample6X:ObjectPos[0].X',
      '::Sample6X:ObjectPos[0].Y',
      '::Sample6X:ObjectPos[0].Z',
      '::Sample6X:ObjectPos[0].Roll',
      '::Sample6X:ObjectPos[0].Pitch',
      '::Sample6X:ObjectPos[0].Yaw',
    ])
    expect(mapping.leaves.map(({ leafPath, projectPath }) => ({ leafPath, projectPath }))).toEqual([
      { leafPath: [0], projectPath: ['positionM', 0] },
      { leafPath: [1], projectPath: ['positionM', 1] },
      { leafPath: [2], projectPath: ['positionM', 2] },
      { leafPath: [3], projectPath: ['rpyDegrees', 0] },
      { leafPath: [4], projectPath: ['rpyDegrees', 1] },
      { leafPath: [5], projectPath: ['rpyDegrees', 2] },
    ])
  })
})
