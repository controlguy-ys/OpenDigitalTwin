import { describe, expect, it } from 'vitest'

import cncFixture from './fixtures/cnc-xyz.mechanism-v1.json' with { type: 'json' }
import humanoidFixture from './fixtures/branched-humanoid.mechanism-v1.json' with { type: 'json' }
import { createDefaultApplicationKinematicsServiceV1 } from './application-kinematics-service.js'
import type { MechanismDefinitionV1, RigidTransformV1 } from './types.js'
import * as testSupport from './test-support.js'

const identity: RigidTransformV1 = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
}

const humanoid = humanoidFixture as unknown as MechanismDefinitionV1
const cnc = cncFixture as unknown as MechanismDefinitionV1

function evaluate(
  definition: MechanismDefinitionV1,
  coordinatesByStableId: Readonly<Record<string, number>>,
  rootWorldPose: RigidTransformV1 = identity,
) {
  return createDefaultApplicationKinematicsServiceV1().compile(definition).evaluateForward({
    rootWorldPose,
    coordinatesByStableId,
  })
}

describe('approved generalized Mechanism V1 fixtures', () => {
  it('rejects an unknown fixture key through the Application Service common validation', () => {
    const invalidFixture = { ...structuredClone(humanoid), unknownFixtureKey: true }

    expect(() => createDefaultApplicationKinematicsServiceV1().compile(invalidFixture)).toThrow(expect.objectContaining({
      code: 'MECHANISM_VALUE_INVALID',
      path: '$.unknownFixtureKey',
    }))
  })

  it('keeps unrelated humanoid branches unchanged when the left arm moves', () => {
    const atHome = evaluate(humanoid, {
      'head-yaw': 0,
      'left-shoulder': 0,
      'left-elbow': 0,
      'right-shoulder': 0,
      'right-elbow': 0,
      'left-hip': 0,
      'left-knee': 0,
      'right-hip': 0,
      'right-knee': 0,
    })
    const moved = evaluate(humanoid, {
      'head-yaw': 0,
      'left-shoulder': Math.PI / 2,
      'left-elbow': 0,
      'right-shoulder': 0,
      'right-elbow': 0,
      'left-hip': 0,
      'left-knee': 0,
      'right-hip': 0,
      'right-knee': 0,
    })

    expect(moved.frameWorldPoses['left-hand']).not.toEqual(atHome.frameWorldPoses['left-hand'])
    for (const frameId of ['head-frame', 'right-hand', 'left-foot', 'right-foot'] as const) {
      expect(moved.frameWorldPoses[frameId]).toEqual(atHome.frameWorldPoses[frameId])
    }
    expect(Object.keys(moved.motionGroupEndFramePoses).sort()).toEqual(['head', 'left-arm', 'left-leg', 'right-arm', 'right-leg'])
  })

  it('places the CNC spindle at the exact commanded XYZ metres', () => {
    const result = evaluate(cnc, { 'axis-x': 0.125, 'axis-y': 0.5, 'axis-z': 0.875 })

    expect(result.frameWorldPoses.spindle?.positionM).toEqual([0.125, 0.5, 0.875])
  })

  it('provides fresh deterministic linear-carriage and mounted-robot builders', () => {
    const makeLinearCarriage = Reflect.get(testSupport, 'makeLinearCarriageMechanismV1') as undefined | (() => MechanismDefinitionV1)
    const makeMountedRobot = Reflect.get(testSupport, 'makeMountedRobotMechanismV1') as undefined | (() => MechanismDefinitionV1)

    expect(makeLinearCarriage).toBeTypeOf('function')
    expect(makeMountedRobot).toBeTypeOf('function')
    const firstCarriage = makeLinearCarriage!()
    const secondCarriage = makeLinearCarriage!()

    expect(firstCarriage).toEqual(secondCarriage)
    expect(firstCarriage).not.toBe(secondCarriage)
    expect(makeMountedRobot!()).not.toBe(makeMountedRobot!())
  })

  it('composes the linear carriage Frame as the mounted Robot root without changing TCP FK', () => {
    const makeLinearCarriage = Reflect.get(testSupport, 'makeLinearCarriageMechanismV1') as () => MechanismDefinitionV1
    const makeMountedRobot = Reflect.get(testSupport, 'makeMountedRobotMechanismV1') as () => MechanismDefinitionV1
    const carriage = evaluate(makeLinearCarriage(), { 'carriage-axis': 0.75 })
    const robot = evaluate(makeMountedRobot(), { 'robot-slide': 0.2 }, carriage.frameWorldPoses.carriage!)

    expect(robot.frameWorldPoses.tcp?.positionM).toEqual([1.2, 0, 0.3])
  })

  it('evaluates two non-aliasing instances from one compiled Definition', () => {
    const compiled = createDefaultApplicationKinematicsServiceV1().compile(cnc)
    const first = compiled.evaluateForward({ rootWorldPose: identity, coordinatesByStableId: { 'axis-x': 0.1, 'axis-y': 0.2, 'axis-z': 0.3 } })
    const second = compiled.evaluateForward({ rootWorldPose: { positionM: [10, 0, 0], quaternion: [0, 0, 0, 1] }, coordinatesByStableId: { 'axis-x': 0.4, 'axis-y': 0.5, 'axis-z': 0.6 } })

    expect(first).not.toBe(second)
    expect(first.bodyWorldPoses).not.toBe(second.bodyWorldPoses)
    expect(first.frameWorldPoses.spindle?.positionM).toEqual([0.1, 0.2, 0.3])
    expect(second.frameWorldPoses.spindle?.positionM).toEqual([10.4, 0.5, 0.6])
  })
})
