import { describe, expect, it } from 'vitest'

import golden from './fixtures/serial-kinematics-golden-v5.json' with { type: 'json' }
import {
  createDefaultApplicationKinematicsServiceV1,
  type ApplicationKinematicsServiceV1,
} from '../mechanism-runtime-v1/application-kinematics-service.js'
import { MechanismErrorV1, type MechanismErrorCodeV1 } from '../mechanism-runtime-v1/errors.js'
import { ProjectV5Error } from '../project-v5/errors.js'
import { makeMinimalWorkcellProjectV5 } from '../project-v5/test-support.js'
import type { QuaternionV5, RigidTransformV5 } from '../project-v5/rigid-transform.js'
import type { SerialRobotPoseV5 } from './serial-kinematics.js'
import { computeSerialRobotPoseV5, createSerialRobotKinematicsV5 } from './serial-kinematics.js'
import {
  buildSerialKinematicsErrorCaseV5,
  buildSerialKinematicsSuccessCaseV5,
  SERIAL_KINEMATICS_ERROR_CASE_IDS_V5,
  SERIAL_KINEMATICS_SUCCESS_CASE_IDS_V5,
  type SerialKinematicsErrorCaseIdV5,
  type SerialKinematicsSuccessCaseIdV5,
} from './test-support.js'

const ABSOLUTE_TOLERANCE = 1e-12

interface SerialKinematicsGoldenV5 {
  readonly schemaVersion: 1
  readonly sourceCommit: string
  readonly successCases: readonly { readonly caseId: SerialKinematicsSuccessCaseIdV5; readonly expected: SerialRobotPoseV5 }[]
  readonly errorCases: readonly {
    readonly caseId: SerialKinematicsErrorCaseIdV5
    readonly expected: { readonly name: 'ProjectV5Error'; readonly code: string; readonly path: string; readonly message: string; readonly recovery: string | null }
  }[]
}

const goldenFixture = golden as unknown as SerialKinematicsGoldenV5

function expectClose(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(ABSOLUTE_TOLERANCE)
}

function normalized(quaternion: QuaternionV5): QuaternionV5 {
  const magnitude = Math.hypot(...quaternion)
  return [quaternion[0] / magnitude, quaternion[1] / magnitude, quaternion[2] / magnitude, quaternion[3] / magnitude]
}

function expectEquivalentQuaternion(actual: QuaternionV5, expected: QuaternionV5): void {
  const actualNormalized = normalized(actual)
  const expectedNormalized = normalized(expected)
  const direct = actualNormalized.every((component, index) => Math.abs(component - expectedNormalized[index]!) <= ABSOLUTE_TOLERANCE)
  const opposite = actualNormalized.every((component, index) => Math.abs(component + expectedNormalized[index]!) <= ABSOLUTE_TOLERANCE)
  expect(direct || opposite).toBe(true)
}

function expectEquivalentTransform(actual: RigidTransformV5, expected: RigidTransformV5): void {
  actual.positionM.forEach((component, index) => expectClose(component, expected.positionM[index]!))
  expectEquivalentQuaternion(actual.quaternion, expected.quaternion)
}

function expectEquivalentPose(actual: SerialRobotPoseV5, expected: SerialRobotPoseV5): void {
  expect(Object.keys(actual.jointValues).sort()).toEqual(Object.keys(expected.jointValues).sort())
  for (const [jointId, value] of Object.entries(expected.jointValues)) expectClose(actual.jointValues[jointId]!, value)
  for (const key of ['linkLocalPoses', 'linkWorldPoses', 'frameWorldPoses'] as const) {
    expect(Object.keys(actual[key]).sort()).toEqual(Object.keys(expected[key]).sort())
    for (const [id, transform] of Object.entries(expected[key])) expectEquivalentTransform(actual[key][id]!, transform)
  }
}

describe('V5 serial kinematics compatibility characterization', () => {
  it('delegates one projected definition through the injected Application Service', () => {
    const defaultService = createDefaultApplicationKinematicsServiceV1()
    let compileCalls = 0
    let evaluateCalls = 0
    const service: ApplicationKinematicsServiceV1 = {
      compile(definition) {
        compileCalls += 1
        const compiled = defaultService.compile(definition)
        return {
          ...compiled,
          evaluateForward(request) {
            evaluateCalls += 1
            return compiled.evaluateForward(request)
          },
        }
      },
    }
    const project = makeMinimalWorkcellProjectV5()
    const definition = project.robotDefinitions[0]!
    const robot = project.robots[0]!

    const pose = createSerialRobotKinematicsV5(service).evaluate(definition, robot.initialJointValues, robot.localBasePose)

    expect(compileCalls).toBe(1)
    expect(evaluateCalls).toBe(1)
    expect(pose).toEqual(computeSerialRobotPoseV5(definition, robot.initialJointValues, robot.localBasePose))
  })

  it('maps every post-prevalidation common Mechanism failure to its V5 error code', () => {
    const project = makeMinimalWorkcellProjectV5()
    const definition = project.robotDefinitions[0]!
    const robot = project.robots[0]!
    const mappings = [
      ['COORDINATE_SET_MISMATCH', 'ROBOT_JOINT_KEY_SET_MISMATCH'],
      ['COORDINATE_VALUE_NOT_FINITE', 'ROBOT_JOINT_VALUE_NOT_FINITE'],
      ['JOINT_LIMIT_EXCEEDED', 'ROBOT_JOINT_VALUE_OUT_OF_RANGE'],
      ['JOINT_LIMIT_INVALID', 'ROBOT_JOINT_LIMIT_INVALID'],
      ['JOINT_AXIS_NOT_NORMALIZABLE', 'JOINT_AXIS_NOT_NORMALIZABLE'],
      ['JOINT_DIRECTION_INVALID', 'ROBOT_JOINT_DIRECTION_INVALID'],
      ['MECHANISM_VALUE_INVALID', 'PROJECT_VALUE_INVALID'],
      ['MECHANISM_ID_DUPLICATE', 'PROJECT_ID_DUPLICATE'],
      ['BODY_NOT_FOUND', 'ROBOT_LINK_NOT_FOUND'],
      ['FRAME_PARENT_NOT_FOUND', 'FRAME_PARENT_NOT_FOUND'],
      ['FRAME_CYCLE', 'FRAME_CYCLE'],
      ['MECHANISM_TOPOLOGY_INVALID', 'ROBOT_JOINT_CHAIN_INVALID'],
      ['TOPOLOGY_UNSUPPORTED', 'ROBOT_JOINT_CHAIN_INVALID'],
      ['TRANSFORM_INVALID', 'PROJECT_VALUE_INVALID'],
    ] as const satisfies readonly (readonly [MechanismErrorCodeV1, string])[]

    for (const [mechanismCode, projectCode] of mappings) {
      const service: ApplicationKinematicsServiceV1 = {
        compile() { throw new MechanismErrorV1(mechanismCode, '$.result', `${mechanismCode} from Application Service.`) },
      }
      try {
        createSerialRobotKinematicsV5(service).evaluate(definition, robot.initialJointValues, robot.localBasePose)
        throw new Error(`Expected ${mechanismCode} to reject.`)
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectV5Error)
        expect(error).toMatchObject({
          code: projectCode,
          path: '$.result',
          recovery: 'Correct the Robot Definition or Joint values and try again.',
        })
        expect((error as Error).message).toBe(`${projectCode} at $.result: ${mechanismCode} from Application Service.`)
      }
    }
  })

  it('uses one stable V5 fallback for every solver-only Mechanism failure', () => {
    const project = makeMinimalWorkcellProjectV5()
    const definition = project.robotDefinitions[0]!
    const robot = project.robots[0]!
    const solverOnlyCodes = [
      'SOLVER_REGISTRATION_DUPLICATE', 'SOLVER_UNAVAILABLE', 'SOLVER_CAPABILITY_UNAVAILABLE',
      'SOLVER_PARAMETERS_INVALID', 'SOLVER_RESULT_INVALID', 'MECHANISM_RESOURCE_LIMIT_EXCEEDED',
      'FRAME_NOT_FOUND', 'MOTION_GROUP_NOT_FOUND', 'MOTION_GROUP_INVALID', 'CONSTRAINT_UNSATISFIED',
    ] as const satisfies readonly MechanismErrorCodeV1[]

    for (const mechanismCode of solverOnlyCodes) {
      const service: ApplicationKinematicsServiceV1 = {
        compile() { throw new MechanismErrorV1(mechanismCode, '$.service', 'Neutral service failure.') },
      }
      try {
        createSerialRobotKinematicsV5(service).evaluate(definition, robot.initialJointValues, robot.localBasePose)
        throw new Error(`Expected ${mechanismCode} to reject.`)
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectV5Error)
        expect(error).toMatchObject({
          code: 'PROJECT_VALUE_INVALID',
          path: '$.result',
          recovery: 'Correct the Robot Definition or Joint values and try again.',
        })
        expect((error as Error).message).toBe('PROJECT_VALUE_INVALID at $.result: Serial kinematics evaluation failed.')
      }
    }
  })

  it('rethrows the original ProjectV5Error cause from a finite transform overflow', () => {
    const project = makeMinimalWorkcellProjectV5()
    const original = new ProjectV5Error('PROJECT_VALUE_INVALID', '$.result', 'Finite composition overflow.', 'Inspect the resulting pose.')
    const service: ApplicationKinematicsServiceV1 = {
      compile() { throw new MechanismErrorV1('TRANSFORM_INVALID', '$.mechanism', 'Common transform failed.', undefined, original) },
    }

    try {
      createSerialRobotKinematicsV5(service).evaluate(project.robotDefinitions[0]!, project.robots[0]!.initialJointValues)
      throw new Error('Expected the original transform cause.')
    } catch (error) {
      expect(error).toBe(original)
    }
  })

  it('retains serial FK success when projection-only metadata is invalid', () => {
    const project = structuredClone(makeMinimalWorkcellProjectV5())
    const definition = project.robotDefinitions[0]!
    const robot = project.robots[0]!
    const draft = definition as any
    draft.joints[0] = { ...definition.joints[0]!, home: 999, maximumVelocity: -1 }
    draft.links[0] = {
      ...definition.links[0]!,
      geometryOccurrences: [{
        ...definition.links[0]!.geometryOccurrences[0]!,
        occurrenceKey: 'serial-ignored-invalid-geometry',
        linkLocalPose: { positionM: [Number.POSITIVE_INFINITY, 0, 0], quaternion: [0, 0, 0, 1] },
      }],
    }

    expect(computeSerialRobotPoseV5(definition, robot.initialJointValues, robot.localBasePose)).toMatchObject({
      jointValues: robot.initialJointValues,
      linkWorldPoses: { L0: robot.localBasePose },
    })
    expect(definition.joints[0]!.home).toBe(999)
    expect(definition.joints[0]!.maximumVelocity).toBe(-1)
    expect(definition.links[0]!.geometryOccurrences[0]!.linkLocalPose.positionM[0]).toBe(Number.POSITIVE_INFINITY)
  })

  it('pins every pre-refactor success pose to the checked-in golden contract', () => {
    expect(goldenFixture.schemaVersion).toBe(1)
    expect(goldenFixture.sourceCommit).toMatch(/^[0-9a-f]{40}$/u)
    expect(goldenFixture.successCases.map(({ caseId }) => caseId)).toEqual(SERIAL_KINEMATICS_SUCCESS_CASE_IDS_V5)
    for (const { caseId, expected } of goldenFixture.successCases) {
      const input = buildSerialKinematicsSuccessCaseV5(caseId)
      expectEquivalentPose(computeSerialRobotPoseV5(input.definition, input.jointValues, input.worldBasePose), expected)
    }
  })

  it('retains NED2 home, mid-range, and limit-adjacent golden parity through the compatibility wrapper', () => {
    const kinematics = createSerialRobotKinematicsV5()
    const cases = ['ned2-home', 'ned2-mid-range', 'ned2-limit-adjacent'] as const

    for (const caseId of cases) {
      const input = buildSerialKinematicsSuccessCaseV5(caseId)
      const expected = goldenFixture.successCases.find((candidate) => candidate.caseId === caseId)?.expected
      expect(expected).toBeDefined()
      expectEquivalentPose(kinematics.evaluate(input.definition, input.jointValues, input.worldBasePose), expected!)
    }
  })

  it('pins every pre-refactor ProjectV5Error field to the checked-in golden contract', () => {
    expect(goldenFixture.errorCases.map(({ caseId }) => caseId)).toEqual(SERIAL_KINEMATICS_ERROR_CASE_IDS_V5)
    for (const { caseId, expected } of goldenFixture.errorCases) {
      const input = buildSerialKinematicsErrorCaseV5(caseId)
      try {
        computeSerialRobotPoseV5(input.definition, input.jointValues, input.worldBasePose)
        throw new Error(`Expected ${caseId} to reject.`)
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectV5Error)
        const projectError = error as ProjectV5Error
        expect({
          name: projectError.name,
          code: projectError.code,
          path: projectError.path,
          message: projectError.message,
          recovery: projectError.recovery ?? null,
        }).toEqual(expected)
      }
    }
  })
})
