import { describe, expect, it } from 'vitest'

import type {
  FrameDefinitionV4,
  RigidTransformV4,
  RobotDefinitionV4,
  RobotJointDefinitionV4,
  RobotLinkDefinitionV4,
} from '../project-v4/index.js'
import {
  computeSerialRobotPoseV4,
  jointMotionTransformV4,
} from './index.js'

function pose(
  positionM: readonly [number, number, number] = [0, 0, 0],
  quaternion: readonly [number, number, number, number] = [0, 0, 0, 1],
): RigidTransformV4 {
  return { positionM, quaternion }
}

function link(id: string): RobotLinkDefinitionV4 {
  return { id, name: id, geometryOccurrences: [] }
}

function joint(
  id: string,
  parentLinkId: string,
  childLinkId: string,
  overrides: Partial<RobotJointDefinitionV4> = {},
): RobotJointDefinitionV4 {
  return {
    id,
    type: 'revolute',
    parentLinkId,
    childLinkId,
    origin: pose(),
    axis: [0, 0, 1],
    min: -180,
    max: 180,
    home: 0,
    zeroOffset: 0,
    direction: 1,
    maximumVelocity: 90,
    ...overrides,
  }
}

function definition(
  links: readonly RobotLinkDefinitionV4[],
  joints: readonly RobotJointDefinitionV4[],
  frames: readonly FrameDefinitionV4[] = [],
): RobotDefinitionV4 {
  return {
    id: 'custom-definition',
    name: 'Custom definition',
    manufacturer: 'User',
    model: 'Custom Six-Axis Robot',
    assetReferenceIds: [],
    sourceConventions: {},
    links,
    joints,
    frames,
    excludedGeometryOccurrenceKeys: [],
  }
}

function chainDefinition(jointCount: number): RobotDefinitionV4 {
  const links = Array.from({ length: jointCount + 1 }, (_, index) => link(`segment-${index}`))
  const joints = Array.from({ length: jointCount }, (_, index) => joint(
    `axis/${index + 1}`,
    links[index]!.id,
    links[index + 1]!.id,
  ))
  return definition(links, joints)
}

function exactJointValues(robot: RobotDefinitionV4, value = 0): Record<string, number> {
  return Object.fromEntries(robot.joints.map(({ id }) => [id, value]))
}

function expectVectorClose(
  actual: readonly number[] | undefined,
  expected: readonly number[],
): void {
  expect(actual).toBeDefined()
  expected.forEach((value, index) => expect(actual?.[index]).toBeCloseTo(value, 12))
}

describe('jointMotionTransformV4', () => {
  it('normalizes the axis and applies revolute direction and zero offset in degrees', () => {
    const motion = jointMotionTransformV4(joint('shoulder', 'root', 'arm', {
      axis: [0, 0, 4],
      zeroOffset: 10,
      direction: -1,
    }), 20)

    expectVectorClose(motion.positionM, [0, 0, 0])
    expectVectorClose(motion.quaternion, [0, 0, -Math.sin(Math.PI / 12), Math.cos(Math.PI / 12)])
  })

  it('applies prismatic movement in metres after raw-command range validation', () => {
    const slide = joint('slide', 'rail', 'carriage', {
      type: 'prismatic',
      axis: [2, 0, 0],
      min: 0,
      max: 1,
      home: 0,
      zeroOffset: 0.5,
      direction: -1,
      maximumVelocity: 1,
    })

    expectVectorClose(jointMotionTransformV4(slide, 0.9).positionM, [-1.4, 0, 0])
  })

  it('composes a rotated Joint origin before prismatic motion', () => {
    const halfSqrt = Math.SQRT1_2
    const robot = definition(
      [link('root'), link('carriage')],
      [joint('travel', 'root', 'carriage', {
        type: 'prismatic',
        origin: pose([1, 0, 0], [0, 0, halfSqrt, halfSqrt]),
        axis: [1, 0, 0],
        min: 0,
        max: 1,
        home: 0,
        maximumVelocity: 1,
      })],
    )

    const result = computeSerialRobotPoseV4(robot, { travel: 0.5 })

    expectVectorClose(result.linkLocalPoses.carriage?.positionM, [1, 0.5, 0])
    expectVectorClose(result.linkWorldPoses.carriage?.positionM, [1, 0.5, 0])
  })

  it('rejects non-finite and out-of-range commands and non-normalizable axes', () => {
    const valid = joint('valid', 'a', 'b')
    expect(() => jointMotionTransformV4(valid, Number.NaN)).toThrow('ROBOT_JOINT_VALUE_NOT_FINITE')
    expect(() => jointMotionTransformV4(valid, 181)).toThrow('ROBOT_JOINT_VALUE_OUT_OF_RANGE')
    expect(() => jointMotionTransformV4({ ...valid, axis: [0, 0, 0] }, 0)).toThrow(
      'JOINT_AXIS_NOT_NORMALIZABLE',
    )
  })
})

describe('computeSerialRobotPoseV4', () => {
  it('follows topology rather than names or declaration order for mixed Joint types', () => {
    const root = link('foundation')
    const arm = link('upper arm')
    const tip = link('slide:tip')
    const rotate = joint('rotate-main', root.id, arm.id, {
      origin: pose([1, 0, 0]),
      axis: [0, 0, 1],
    })
    const slide = joint('linear travel', arm.id, tip.id, {
      type: 'prismatic',
      origin: pose([0, 1, 0]),
      axis: [1, 0, 0],
      min: 0,
      max: 1,
      home: 0,
      maximumVelocity: 1,
    })
    const robot = definition([tip, root, arm], [slide, rotate])

    const home = computeSerialRobotPoseV4(robot, { 'rotate-main': 0, 'linear travel': 0 })
    const moved = computeSerialRobotPoseV4(robot, { 'rotate-main': 90, 'linear travel': 0.2 })

    expectVectorClose(home.linkWorldPoses['slide:tip']?.positionM, [1, 1, 0])
    expectVectorClose(moved.linkWorldPoses['slide:tip']?.positionM, [0, 0.2, 0])
    expect(moved.linkLocalPoses.foundation).toEqual(home.linkLocalPoses.foundation)
    expect(moved.linkLocalPoses['slide:tip']).not.toEqual(home.linkLocalPoses['slide:tip'])
  })

  it('resolves configured Link-owned and Frame-owned Definition Frames in any order', () => {
    const robot = definition(
      [link('root-link'), link('wrist-link')],
      [joint('wrist-axis', 'root-link', 'wrist-link', { origin: pose([0, 0, 2]) })],
      [
        { id: 'tcp-custom', name: 'TCP', parentFrameId: 'tool-custom', localPose: pose([0, 0, 0.2]), role: 'tcp' },
        { id: 'base-custom', name: 'Base', parentFrameId: 'root-link', localPose: pose(), role: 'base' },
        { id: 'tool-custom', name: 'Tool', parentFrameId: 'wrist-link', localPose: pose([0, 0, 0.3]), role: 'tool' },
      ],
    )

    const result = computeSerialRobotPoseV4(robot, { 'wrist-axis': 0 }, pose([5, 0, 0]))

    expectVectorClose(result.frameWorldPoses['base-custom']?.positionM, [5, 0, 0])
    expectVectorClose(result.frameWorldPoses['tool-custom']?.positionM, [5, 0, 2.3])
    expectVectorClose(result.frameWorldPoses['tcp-custom']?.positionM, [5, 0, 2.5])
  })

  it.each([1, 16])('accepts a %i-Joint runtime definition', (jointCount) => {
    const robot = chainDefinition(jointCount)
    expect(() => computeSerialRobotPoseV4(robot, exactJointValues(robot))).not.toThrow()
  })

  it.each([
    [0, 'ROBOT_JOINT_COUNT_TOO_SMALL'],
    [17, 'ROBOT_JOINT_LIMIT_EXCEEDED'],
  ] as const)('rejects a %i-Joint runtime definition', (jointCount, code) => {
    const robot = chainDefinition(jointCount)
    expect(() => computeSerialRobotPoseV4(robot, exactJointValues(robot))).toThrow(code)
  })

  it('requires the exact finite in-range Joint key set', () => {
    const robot = chainDefinition(2)

    expect(() => computeSerialRobotPoseV4(robot, { 'axis/1': 0 })).toThrow(
      'ROBOT_JOINT_KEY_SET_MISMATCH',
    )
    expect(() => computeSerialRobotPoseV4(robot, {
      'axis/1': 0,
      'axis/2': 0,
      extra: 0,
    })).toThrow('ROBOT_JOINT_KEY_SET_MISMATCH')
    expect(() => computeSerialRobotPoseV4(robot, {
      'axis/1': Number.POSITIVE_INFINITY,
      'axis/2': 0,
    })).toThrow('ROBOT_JOINT_VALUE_NOT_FINITE')
    expect(() => computeSerialRobotPoseV4(robot, {
      'axis/1': 181,
      'axis/2': 0,
    })).toThrow('ROBOT_JOINT_VALUE_OUT_OF_RANGE')
  })

  it('rejects unknown Link and Definition Frame parents and Frame cycles', () => {
    const validJoint = joint('axis', 'root', 'tip')

    expect(() => computeSerialRobotPoseV4(
      definition([link('root'), link('tip')], [{ ...validJoint, parentLinkId: 'missing' }]),
      { axis: 0 },
    )).toThrow('ROBOT_LINK_NOT_FOUND')

    expect(() => computeSerialRobotPoseV4(
      definition([link('root'), link('tip')], [validJoint], [
        { id: 'bad', name: 'Bad', parentFrameId: 'missing', localPose: pose(), role: 'custom' },
      ]),
      { axis: 0 },
    )).toThrow('FRAME_PARENT_NOT_FOUND')

    expect(() => computeSerialRobotPoseV4(
      definition([link('root'), link('tip')], [validJoint], [
        { id: 'a', name: 'A', parentFrameId: 'b', localPose: pose(), role: 'custom' },
        { id: 'b', name: 'B', parentFrameId: 'a', localPose: pose(), role: 'custom' },
      ]),
      { axis: 0 },
    )).toThrow('FRAME_CYCLE')
  })

  it('rejects branched, self-connected, and disconnected cyclic Joint topologies', () => {
    expect(() => computeSerialRobotPoseV4(
      definition(
        [link('a'), link('b'), link('c')],
        [joint('ab', 'a', 'b'), joint('ac', 'a', 'c')],
      ),
      { ab: 0, ac: 0 },
    )).toThrow('ROBOT_JOINT_CHAIN_INVALID')

    expect(() => computeSerialRobotPoseV4(
      definition([link('a'), link('b')], [joint('self', 'a', 'a')]),
      { self: 0 },
    )).toThrow('ROBOT_JOINT_CHAIN_INVALID')

    expect(() => computeSerialRobotPoseV4(
      definition(
        [link('a'), link('b'), link('detached')],
        [joint('ab', 'a', 'b'), joint('ba', 'b', 'a')],
      ),
      { ab: 0, ba: 0 },
    )).toThrow('ROBOT_JOINT_CHAIN_INVALID')
  })

  it('clones caller-owned commands, transforms, axes, and the World Base pose', () => {
    const mutableAxis: [number, number, number] = [0, 0, 1]
    const mutableOriginPosition: [number, number, number] = [0, 0, 1]
    const mutableWorldPosition: [number, number, number] = [2, 0, 0]
    const robot = definition(
      [link('root'), link('tip')],
      [joint('axis', 'root', 'tip', {
        axis: mutableAxis,
        origin: pose(mutableOriginPosition),
      })],
    )
    const commands = { axis: 0 }
    const worldBase = pose(mutableWorldPosition)

    const result = computeSerialRobotPoseV4(robot, commands, worldBase)
    commands.axis = 90
    mutableAxis[2] = 9
    mutableOriginPosition[2] = 9
    mutableWorldPosition[0] = 9

    expect(result.jointValues.axis).toBe(0)
    expectVectorClose(result.linkWorldPoses.root?.positionM, [2, 0, 0])
    expectVectorClose(result.linkWorldPoses.tip?.positionM, [2, 0, 1])
    expect(result.linkWorldPoses.root?.positionM).not.toBe(mutableWorldPosition)
  })

  it('treats delimiter and object-prototype-looking IDs as opaque keys', () => {
    const robot = definition(
      [link('__proto__'), link('constructor')],
      [joint('joint%3A:|', '__proto__', 'constructor')],
      [{
        id: 'frame%3A:|',
        name: 'Opaque frame',
        parentFrameId: 'constructor',
        localPose: pose([0, 0, 1]),
        role: 'custom',
      }],
    )
    const commands = Object.fromEntries([['joint%3A:|', 0]])

    const result = computeSerialRobotPoseV4(robot, commands)

    expect(Object.hasOwn(result.linkWorldPoses, '__proto__')).toBe(true)
    expect(Object.hasOwn(result.linkWorldPoses, 'constructor')).toBe(true)
    expect(Object.hasOwn(result.jointValues, 'joint%3A:|')).toBe(true)
    expectVectorClose(result.frameWorldPoses['frame%3A:|']?.positionM, [0, 0, 1])
  })
})
