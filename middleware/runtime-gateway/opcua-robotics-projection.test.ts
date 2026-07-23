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

function sharedDefinitionProject(): WorkcellProjectV5 {
  const project = projectWithJointCount(2)
  const robot = project.robots[0]!
  return validateWorkcellProjectV5({
    ...project,
    robots: [{ ...robot, id: 'robot-a', serialNumber: 'ROBOT-A-001' }, {
      ...robot, id: 'robot-b', serialNumber: 'ROBOT-B-002',
    }],
    jobs: [],
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

  it('preserves Definition identification for every instance sharing that Definition', () => {
    const project = sharedDefinitionProject()
    const definition = project.robotDefinitions[0]!
    const devices = projectRoboticsSystemV1(project).motionDevices

    expect(devices.map((device) => ({
      id: device.id,
      manufacturer: device.manufacturer,
      model: device.model,
      productCode: device.productCode,
      serialNumber: device.serialNumber,
      category: device.category,
    }))).toEqual([
      {
        id: 'robot-a',
        manufacturer: definition.identification.manufacturer,
        model: definition.identification.model,
        productCode: definition.identification.productCode,
        serialNumber: 'ROBOT-A-001',
        category: definition.identification.motionDeviceCategory,
      },
      {
        id: 'robot-b',
        manufacturer: definition.identification.manufacturer,
        model: definition.identification.model,
        productCode: definition.identification.productCode,
        serialNumber: 'ROBOT-B-002',
        category: definition.identification.motionDeviceCategory,
      },
    ])
  })

  it('converts only prismatic metres to millimetres', () => {
    expect(projectJointActualForOpcUaV1('revolute', 12.5)).toEqual({ value: 12.5, unit: 'degree' })
    expect(projectJointActualForOpcUaV1('prismatic', 0.125)).toEqual({ value: 125, unit: 'millimetre' })
    expect(projectJointRangeForOpcUaV1('revolute', -270, 270)).toEqual({ low: -270, high: 270 })
    expect(projectJointRangeForOpcUaV1('prismatic', -0.2, 1.5)).toEqual({ low: -200, high: 1_500 })
  })

  it.each([
    ['actual NaN', () => projectJointActualForOpcUaV1('revolute', Number.NaN)],
    ['actual Infinity', () => projectJointActualForOpcUaV1('revolute', Number.POSITIVE_INFINITY)],
    ['actual prismatic overflow', () => projectJointActualForOpcUaV1('prismatic', 1e308)],
    ['range NaN', () => projectJointRangeForOpcUaV1('revolute', Number.NaN, 1)],
    ['range Infinity', () => projectJointRangeForOpcUaV1('revolute', -1, Number.POSITIVE_INFINITY)],
    ['range prismatic overflow', () => projectJointRangeForOpcUaV1('prismatic', -1e308, 1e308)],
  ])('rejects non-finite %s with a stable projection error', (_name, project) => {
    expect(project).toThrow('OPC_UA_ROBOTICS_PROJECTION_VALUE_INVALID')
  })

  it('rejects a finite V5 prismatic joint state that overflows during OPC UA projection', () => {
    const project = cloneWorkcellProjectV5(projectWithJointCount(2))
    const definition = project.robotDefinitions[0]!
    const prismatic = definition.joints[1]!
    ;(definition.joints as unknown as RobotDefinitionV5['joints'][number][])[1] = {
      ...prismatic,
      min: -1e308,
      max: 1e308,
    }
    ;(project.robots[0]!.initialJointValues as unknown as Record<string, number>).J2 = 1e308
    const validFiniteProject = validateWorkcellProjectV5(project)

    expect(() => projectRoboticsSystemV1(validFiniteProject)).toThrow('OPC_UA_ROBOTICS_PROJECTION_VALUE_INVALID')
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
    expect(Object.isFrozen(projection.motionDevices[0]!.powerTrains)).toBe(true)
    expect(Object.isFrozen(projection.motionDevices[0]!.powerTrains[0]!)).toBe(true)
    expect(Object.isFrozen(projection.controllers)).toBe(true)
    expect(Object.isFrozen(projection.controllers[0]!)).toBe(true)
    expect(Object.isFrozen(projection.controllers[0]!.identification)).toBe(true)
    expect(Object.isFrozen(projection.safety)).toBe(true)
    expect(() => {
      ;(projection.motionDevices as unknown as Array<unknown>).push({})
    }).toThrow(TypeError)
    source.robots[0]!.name = 'Mutated after projection'
    expect(projection.motionDevices[0]!.browseName).toBe('Robot 1')
  })

  it.each([
    ['controller', 'ROBOT_CONTROLLER_NOT_FOUND', (project: WorkcellProjectV5) => { project.robots[0]!.controllerId = 'missing-controller' }],
    ['definition', 'ROBOT_DEFINITION_NOT_FOUND', (project: WorkcellProjectV5) => { project.robots[0]!.definitionId = 'missing-definition' }],
    ['joint state', 'ROBOT_JOINT_SET_MISMATCH', (project: WorkcellProjectV5) => { project.robots[0]!.initialJointValues = {} }],
  ])('rejects a missing %s before creating a projection', (_name, expectedCode, corrupt) => {
    const invalid = cloneWorkcellProjectV5(projectWithJointCount(2))
    corrupt(invalid)

    expect(() => projectRoboticsSystemV1(invalid)).toThrow(expectedCode)
  })
})
