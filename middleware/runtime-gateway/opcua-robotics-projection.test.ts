// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  validateWorkcellProjectV5,
  type RobotDefinitionV5,
  type RobotInstanceV5,
  type WorkcellProjectV5,
} from '../../src/core/project-v5/index.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../src/core/project-v5/test-support.js'
import {
  projectJointActualForOpcUaV1,
  projectJointRangeForOpcUaV1,
  projectRoboticsSystemV1,
} from './opcua-robotics-projection.js'

const IDENTITY_POSE = Object.freeze({ positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] })

function projectWithJointCount(jointCount: number): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  const sourceDefinition = project.robotDefinitions[0]!
  const joints = Array.from({ length: jointCount }, (_, index) => ({
    id: `J${index + 1}`,
    type: index === jointCount - 1 ? 'prismatic' as const : 'revolute' as const,
    parentLinkId: `L${index}`,
    childLinkId: `L${index + 1}`,
    origin: IDENTITY_POSE,
    axis: [0, 0, 1] as const,
    min: index === jointCount - 1 ? -0.2 : -270,
    max: index === jointCount - 1 ? 1.5 : 270,
    home: 0,
    zeroOffset: 0,
    direction: 1 as const,
    maximumVelocity: 90,
  }))
  const definition: RobotDefinitionV5 = {
    ...sourceDefinition,
    links: Array.from({ length: jointCount + 1 }, (_, index) => index === 0
      ? sourceDefinition.links[0]!
      : { id: `L${index}`, name: `Link ${index}`, geometryOccurrences: [] }),
    joints,
  }
  const robot: RobotInstanceV5 = {
    ...project.robots[0]!,
    initialJointValues: Object.fromEntries(joints.map((joint) => [
      joint.id,
      joint.type === 'prismatic' ? 0.125 : 12.5,
    ])),
  }

  return validateWorkcellProjectV5({
    ...project,
    robotDefinitions: [definition],
    robots: [robot],
    jobs: [],
  })
}

function robotAndTrackProject(): WorkcellProjectV5 {
  const project = projectWithJointCount(2)
  const robot = project.robots[0]!
  const sourceDefinition = project.robotDefinitions[0]!
  const trackDefinition: RobotDefinitionV5 = {
    ...sourceDefinition,
    id: 'track-definition',
    name: 'Linear Track Definition',
    identification: {
      ...sourceDefinition.identification,
      motionDeviceCategory: 'OTHER',
    },
    links: [sourceDefinition.links[0]!, {
      id: 'TrackL1',
      name: 'Track Link 1',
      geometryOccurrences: [],
    }],
    joints: [{
      ...sourceDefinition.joints[1]!,
      id: 'TrackAxis',
      type: 'prismatic',
      parentLinkId: 'L0',
      childLinkId: 'TrackL1',
      min: -1,
      max: 2,
    }],
    frames: [{ ...sourceDefinition.frames[0]!, id: 'TrackBase', parentFrameId: 'L0' }, {
      ...sourceDefinition.frames[1]!, id: 'TrackTool', parentFrameId: 'TrackL1', role: 'tool',
    }, {
      ...sourceDefinition.frames[2]!, id: 'TrackTCP', parentFrameId: 'TrackTool', role: 'tcp',
    }],
  }
  const track: RobotInstanceV5 = {
    ...robot,
    id: 'track-a',
    name: 'Linear Track A',
    definitionId: trackDefinition.id,
    serialNumber: 'TRACK-SAMPLE-001',
    controllerId: 'controller-2',
    initialJointValues: { TrackAxis: 0.25 },
    frameSources: { TrackBase: 'simulation', TrackTool: 'simulation', TrackTCP: 'simulation' },
    selectedToolFrameId: 'TrackTool',
    selectedTcpFrameId: 'TrackTCP',
  }

  return validateWorkcellProjectV5({
    ...project,
    robotDefinitions: [sourceDefinition, trackDefinition],
    controllers: [...project.controllers, {
      id: 'controller-2',
      name: 'Track Controller',
      identification: {
        manufacturer: 'Track Co', model: 'Linear 1', productCode: 'TRACK-1', serialNumber: 'TRACK-CTRL-001',
      },
    }],
    robots: [{ ...robot, id: 'robot-a' }, track],
  })
}

describe('OPC UA Robotics projection V1', () => {
  it.each([2, 7, 16])('projects exactly %i configured Axes', (jointCount) => {
    const projection = projectRoboticsSystemV1(projectWithJointCount(jointCount))

    expect(projection.motionDevices[0]!.axes).toHaveLength(jointCount)
  })

  it('projects identity, controller relationships, Power Trains, and informational-only safety in Project order', () => {
    const project = robotAndTrackProject()
    const projection = projectRoboticsSystemV1(project)

    expect(projection).toMatchObject({
      projectId: project.projectId,
      revisionId: project.revisionId,
      controllers: project.controllers,
      safety: { value: 'unavailable', informationalOnly: true },
    })
    expect(projection.motionDevices.map(({ id, controllerId }) => ({ id, controllerId }))).toEqual([
      { id: 'robot-a', controllerId: 'controller-1' },
      { id: 'track-a', controllerId: 'controller-2' },
    ])
    expect(projection.motionDevices[0]!.powerTrains).toEqual([
      { id: 'robot-a/J1/power-train', browseName: 'J1 Power Train', axisId: 'J1' },
      { id: 'robot-a/J2/power-train', browseName: 'J2 Power Train', axisId: 'J2' },
    ])
  })

  it('converts only prismatic metres to millimetres', () => {
    expect(projectJointActualForOpcUaV1('revolute', 12.5)).toEqual({ value: 12.5, unit: 'degree' })
    expect(projectJointActualForOpcUaV1('prismatic', 0.125)).toEqual({ value: 125, unit: 'millimetre' })
    expect(projectJointRangeForOpcUaV1('revolute', -270, 270)).toEqual({ low: -270, high: 270 })
    expect(projectJointRangeForOpcUaV1('prismatic', -0.2, 1.5)).toEqual({ low: -200, high: 1_500 })
  })

  it('keeps an independent linear track as a second Motion Device', () => {
    expect(projectRoboticsSystemV1(robotAndTrackProject()).motionDevices.map(({ id }) => id))
      .toEqual(['robot-a', 'track-a'])
  })

  it('returns an immutable projection without retaining mutable caller records', () => {
    const source = cloneWorkcellProjectV5(projectWithJointCount(2))
    const projection = projectRoboticsSystemV1(source)

    expect(Object.isFrozen(projection)).toBe(true)
    expect(Object.isFrozen(projection.motionDevices)).toBe(true)
    expect(Object.isFrozen(projection.motionDevices[0]!)).toBe(true)
    expect(Object.isFrozen(projection.motionDevices[0]!.axes[0]!)).toBe(true)
    expect(() => {
      ;(projection.motionDevices as unknown as Array<unknown>).push({})
    }).toThrow(TypeError)
    source.robots[0]!.name = 'Mutated after projection'
    expect(projection.motionDevices[0]!.browseName).toBe('Robot 1')
  })

  it.each([
    ['controller', (project: WorkcellProjectV5) => { project.robots[0]!.controllerId = 'missing-controller' }],
    ['definition', (project: WorkcellProjectV5) => { project.robots[0]!.definitionId = 'missing-definition' }],
    ['joint state', (project: WorkcellProjectV5) => { project.robots[0]!.initialJointValues = {} }],
  ])('rejects a missing %s before creating a projection', (_name, corrupt) => {
    const invalid = cloneWorkcellProjectV5(projectWithJointCount(2))
    corrupt(invalid)

    expect(() => projectRoboticsSystemV1(invalid)).toThrow(/ROBOT_(CONTROLLER_NOT_FOUND|DEFINITION_NOT_FOUND|JOINT_SET_MISMATCH)/u)
  })
})
