/// <reference types="node" />

import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

import { makeMinimalWorkcellProjectV5 } from '../project-v5/test-support.js'
import type { RobotJointDefinitionV5 } from '../project-v5/types.js'
import { computeSerialRobotPoseV5, jointMotionTransformV5 } from './serial-kinematics.js'

describe('V5 serial kinematics', () => {
  it('uses degree revolute commands, metre prismatic commands, and normalized axes', () => {
    const project = structuredClone(makeMinimalWorkcellProjectV5())
    const definition = project.robotDefinitions[0]!
    const source = definition.joints[0]!
    const joint: RobotJointDefinitionV5 = { ...source, axis: [0, 0, 4], zeroOffset: 10, direction: -1 }

    const motion = jointMotionTransformV5(joint, 20)
    expect(motion.quaternion[2]).toBeCloseTo(-Math.sin(Math.PI / 12), 12)
    expect(motion.quaternion[3]).toBeCloseTo(Math.cos(Math.PI / 12), 12)

    const prismatic: RobotJointDefinitionV5 = { ...joint, type: 'prismatic', axis: [2, 0, 0], min: 0, max: 1, zeroOffset: 0.5, direction: -1, maximumVelocity: 1 }
    expect(jointMotionTransformV5(prismatic, 0.9).positionM).toEqual([-1.4, 0, 0])
  })

  it('computes V5 link and TCP world poses without a V4 import', async () => {
    const project = makeMinimalWorkcellProjectV5()
    const robot = project.robots[0]!
    const definition = project.robotDefinitions[0]!

    const result = computeSerialRobotPoseV5(definition, robot.initialJointValues, robot.localBasePose)

    expect(Object.keys(result.linkWorldPoses)).toHaveLength(definition.links.length)
    expect(result.frameWorldPoses[robot.selectedTcpFrameId]).toBeDefined()
    const source = await readFile('src/core/robot-runtime-v5/serial-kinematics.ts', 'utf8')
    expect(source).not.toMatch(/project-v4|RigidTransformV4|RobotDefinitionV4/u)
  })

  it('rejects an incomplete Joint key set', () => {
    const definition = makeMinimalWorkcellProjectV5().robotDefinitions[0]!
    expect(() => computeSerialRobotPoseV5(definition, {})).toThrow('ROBOT_JOINT_KEY_SET_MISMATCH')
  })

  it('validates exact Joint records without invoking accessors or accepting hidden keys', () => {
    const definition = makeMinimalWorkcellProjectV5().robotDefinitions[0]!
    const accessor = {} as Record<string, number>
    Object.defineProperty(accessor, 'J1', { enumerable: true, get: () => { throw new Error('must not invoke') } })
    const symbol = { J1: 0 } as Record<string, number>
    Object.defineProperty(symbol, Symbol('extra'), { enumerable: true, value: 1 })
    for (const values of [accessor, symbol, Object.create({ J1: 0 }) as Record<string, number>]) {
      expect(() => computeSerialRobotPoseV5(definition, values)).toThrow('PROJECT_VALUE_INVALID')
    }
  })
})
