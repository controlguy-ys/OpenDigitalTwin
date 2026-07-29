import { describe, expect, it, vi } from 'vitest'

import {
  createDefaultApplicationKinematicsServiceV1,
  type ApplicationKinematicsServiceV1,
} from '../../../core/mechanism-runtime-v1/application-kinematics-service.js'
import { MechanismErrorV1 } from '../../../core/mechanism-runtime-v1/errors.js'
import { EMPTY_SOLVER_PARAMETERS_SHA256_V1 } from '../../../core/mechanism-runtime-v1/limits.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import type { WorkcellProjectV5 } from '../../../core/project-v5/types.js'
import {
  createProjectRobotKinematicsFactoryV5,
  type RobotPoseEvaluationRequestV5,
} from './project-v5-robot-kinematics.js'

const REVISION = 'a'.repeat(64)

function withSecondRobot(projectInput = makeMinimalWorkcellProjectV5()): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(projectInput)
  const first = project.robots[0]!
  ;(project.robots as unknown as unknown[]).push({
    ...first, id: 'robot-2', name: 'Robot 2', serialNumber: 'ROBOT-SAMPLE-002',
    localBasePose: { positionM: [1, 2, 3], quaternion: [0, 0, 0, 1] }, initialJointValues: { J1: 10 },
  })
  return project
}

function withDistinctDefinitionAndRobot(): WorkcellProjectV5 {
  const project = withSecondRobot()
  const first = project.robotDefinitions[0]!
  ;(project.robotDefinitions as unknown as unknown[]).push({ ...first, id: 'definition-2', name: 'Robot Definition 2' })
  ;(project.robots[1] as { definitionId: string }).definitionId = 'definition-2'
  ;(project.robots as unknown as unknown[]).push({
    ...project.robots[0]!, id: 'robot-3', name: 'Robot 3', serialNumber: 'ROBOT-SAMPLE-003',
    localBasePose: { positionM: [3, 2, 1], quaternion: [0, 0, 0, 1] }, initialJointValues: { J1: 30 },
  })
  return project
}

function spyService(): { readonly service: ApplicationKinematicsServiceV1; readonly calls: { compile: number; evaluate: number } } {
  const defaultService = createDefaultApplicationKinematicsServiceV1()
  const calls = { compile: 0, evaluate: 0 }
  return {
    calls,
    service: {
      compile(definition) {
        calls.compile += 1
        const compiled = defaultService.compile(definition)
        return Object.freeze({
          ...compiled,
          evaluateForward(request: Parameters<typeof compiled.evaluateForward>[0]) { calls.evaluate += 1; return compiled.evaluateForward(request) },
        })
      },
    },
  }
}

function request(robotId = 'robot-1', coordinateRevision = 1, jointValue = 10, rootX = 0) {
  return {
    robotId, coordinateRevision, jointValues: { J1: jointValue },
    rootWorldPose: { positionM: [rootX, 0, 0] as const, quaternion: [0, 0, 0, 1] as const },
  }
}

describe('Project V5 Robot kinematics evaluator', () => {
  it('projects and compiles each distinct Definition once, shares it by Robot, and exposes the exact identity', () => {
    const { service, calls } = spyService()
    const project = withDistinctDefinitionAndRobot()
    const before = structuredClone(project)

    const evaluator = createProjectRobotKinematicsFactoryV5(service).compileProject(project, REVISION)
    const evaluated = evaluator.evaluateRobot(request())

    evaluator.evaluateRobot(request('robot-2', 1, 20, 1))
    evaluator.evaluateRobot(request('robot-3', 1, 30, 3))
    expect(calls.compile).toBe(2)
    expect(evaluated.identity).toEqual({
      projectId: project.projectId, projectRevisionId: project.revisionId, configRevision: REVISION,
      adapterKey: 'open-digital-twin/project-v5-robot', adapterVersion: '1',
      solverKey: 'open-digital-twin/tree-fk', solverContractVersion: '1',
      normalizedSolverParametersHash: EMPTY_SOLVER_PARAMETERS_SHA256_V1,
    })
    expect(evaluated.pose.jointValues).toEqual({ J1: 10 })
    expect(project).toEqual(before)
    expect(Object.isFrozen(evaluated)).toBe(true)
    expect(Object.isFrozen(evaluated.identity)).toBe(true)
    expect(Object.isFrozen(evaluated.pose)).toBe(true)
  })

  it('rejects invalid config revisions and every authored Robot initial coordinate/root before returning an evaluator', () => {
    expect(() => createProjectRobotKinematicsFactoryV5().compileProject(makeMinimalWorkcellProjectV5(), 'A'.repeat(64)))
      .toThrow('Config revision must be a lowercase 64-character hexadecimal digest.')
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.robots[0]!.initialJointValues as { J1: number }).J1 = 999
    expect(() => createProjectRobotKinematicsFactoryV5().compileProject(project, REVISION))
      .toThrow('ROBOT_JOINT_VALUE_OUT_OF_RANGE')

    const laterCoordinate = withSecondRobot()
    ;(laterCoordinate.robots[1]!.initialJointValues as { J1: number }).J1 = 999
    expect(() => createProjectRobotKinematicsFactoryV5().compileProject(laterCoordinate, REVISION))
      .toThrow('ROBOT_JOINT_VALUE_OUT_OF_RANGE')

    const laterRoot = withSecondRobot()
    ;(laterRoot.robots[1]!.localBasePose.positionM as [number, number, number])[2] = Number.POSITIVE_INFINITY
    expect(() => createProjectRobotKinematicsFactoryV5().compileProject(laterRoot, REVISION))
      .toThrow('PROJECT_NUMBER_NOT_FINITE')
  })

  it('does not publish a partial evaluator when its Application Service rejects compilation', () => {
    const defaultService = createDefaultApplicationKinematicsServiceV1()
    let fail = true
    const service: ApplicationKinematicsServiceV1 = {
      compile(definition) {
        if (fail) throw new MechanismErrorV1('SOLVER_UNAVAILABLE', '$.solver', 'solver candidate rejected')
        return defaultService.compile(definition)
      },
    }
    const factory = createProjectRobotKinematicsFactoryV5(service)

    expect(() => factory.compileProject(makeMinimalWorkcellProjectV5(), REVISION)).toThrow('PROJECT_VALUE_INVALID')
    fail = false
    expect(factory.compileProject(makeMinimalWorkcellProjectV5(), REVISION).evaluateRobot(request()).pose.jointValues).toEqual({ J1: 10 })
  })

  it('uses one exact bounded cache entry per Robot state/root and does not key by requested consumers or unrelated state', () => {
    const { service, calls } = spyService()
    const evaluator = createProjectRobotKinematicsFactoryV5(service).compileProject(withSecondRobot(), REVISION)

    const first = evaluator.evaluateRobot(request())
    expect(evaluator.evaluateRobot(request())).toBe(first)
    // A new object and arbitrary caller-only status must not be part of the cache key.
    const sameStateWithUnrelatedStatus: RobotPoseEvaluationRequestV5 & { readonly status: string } = {
      ...request(), jointValues: { J1: 10 }, status: 'unrelated',
    }
    expect(evaluator.evaluateRobot(sameStateWithUnrelatedStatus)).toBe(first)
    expect(calls.evaluate).toBe(1)

    expect(evaluator.evaluateRobot(request('robot-1', 2))).not.toBe(first)
    expect(evaluator.evaluateRobot(request('robot-1', 2, 11))).not.toBe(first)
    expect(evaluator.evaluateRobot(request('robot-1', 2, 11, 1))).not.toBe(first)
    expect(evaluator.evaluateRobot(request('robot-2', 2, 20, 1))).not.toBe(first)
    expect(calls.evaluate).toBe(5)
  })

  it('recomputes when a coordinate value changes at the same revision and normalizes equivalent root quaternions', () => {
    const { service, calls } = spyService()
    const evaluator = createProjectRobotKinematicsFactoryV5(service).compileProject(makeMinimalWorkcellProjectV5(), REVISION)
    const first = evaluator.evaluateRobot(request('robot-1', 7, 10))
    const changed = evaluator.evaluateRobot(request('robot-1', 7, 11))
    const sameRoot = evaluator.evaluateRobot({ ...request('robot-1', 7, 11), rootWorldPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, -3] } })

    expect(changed).not.toBe(first)
    expect(sameRoot).toBe(changed)
    expect(calls.evaluate).toBe(2)
  })

  it('uses exact authored Joint values in the cache key even when canonical radians underflow to the same value', () => {
    const { service, calls } = spyService()
    const evaluator = createProjectRobotKinematicsFactoryV5(service).compileProject(makeMinimalWorkcellProjectV5(), REVISION)
    const first = evaluator.evaluateRobot(request('robot-1', 7, Number.MIN_VALUE))
    const second = evaluator.evaluateRobot(request('robot-1', 7, Number.MIN_VALUE * 2))

    expect(second).not.toBe(first)
    expect(second.pose.jointValues.J1).toBe(Number.MIN_VALUE * 2)
    expect(calls.evaluate).toBe(2)
  })

  it('invalidates every normalized root component and replaces, rather than accumulates, a Robot cache entry', () => {
    const { service, calls } = spyService()
    const factory = createProjectRobotKinematicsFactoryV5(service)
    const base = {
      ...request('robot-1', 1, 10),
      rootWorldPose: { positionM: [0, 0, 0] as const, quaternion: [0.1, 0.2, 0.3, 1] as const },
    }
    const roots = [
      { positionM: [1, 0, 0], quaternion: [0.1, 0.2, 0.3, 1] },
      { positionM: [0, 1, 0], quaternion: [0.1, 0.2, 0.3, 1] },
      { positionM: [0, 0, 1], quaternion: [0.1, 0.2, 0.3, 1] },
      { positionM: [0, 0, 0], quaternion: [0.2, 0.2, 0.3, 1] },
      { positionM: [0, 0, 0], quaternion: [0.1, 0.3, 0.3, 1] },
      { positionM: [0, 0, 0], quaternion: [0.1, 0.2, 0.4, 1] },
      { positionM: [0, 0, 0], quaternion: [0.1, 0.2, 0.3, 2] },
    ] as const
    for (const rootWorldPose of roots) {
      const evaluator = factory.compileProject(makeMinimalWorkcellProjectV5(), REVISION)
      const baseline = evaluator.evaluateRobot(base)
      expect(evaluator.evaluateRobot({ ...base, rootWorldPose })).not.toBe(baseline)
      // Returning to base must recompute: one Robot retains only its latest entry.
      expect(evaluator.evaluateRobot(base)).not.toBe(baseline)
    }
    expect(calls.evaluate).toBe(21)
  })

  it('does not serialize coordinates or roots while evaluating cache reads', () => {
    const { service } = spyService()
    const evaluator = createProjectRobotKinematicsFactoryV5(service).compileProject(makeMinimalWorkcellProjectV5(), REVISION)
    const stringify = vi.spyOn(JSON, 'stringify').mockImplementation(() => { throw new Error('cache reads must not serialize') })
    try {
      evaluator.evaluateRobot(request())
      evaluator.evaluateRobot(request())
    } finally {
      stringify.mockRestore()
    }
  })

  it('creates a replacement evaluator with an empty cache for a replacement Project/configuration', () => {
    const { service, calls } = spyService()
    const factory = createProjectRobotKinematicsFactoryV5(service)
    const first = factory.compileProject(makeMinimalWorkcellProjectV5(), REVISION)
    first.evaluateRobot(request())
    const replacementProject = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(replacementProject as { revisionId: string }).revisionId = 'revision-2'
    const replacement = factory.compileProject(replacementProject, REVISION)
    replacement.evaluateRobot(request())

    expect(calls.compile).toBe(2)
    expect(calls.evaluate).toBe(2)
    expect(replacement.evaluateRobot(request()).identity).toMatchObject({ projectRevisionId: 'revision-2', configRevision: REVISION })
  })

  it('creates a replacement evaluator for a config-only replacement', () => {
    const { service, calls } = spyService()
    const factory = createProjectRobotKinematicsFactoryV5(service)
    const project = makeMinimalWorkcellProjectV5()
    const first = factory.compileProject(project, REVISION)
    first.evaluateRobot(request())
    const replacement = factory.compileProject(project, 'b'.repeat(64))
    replacement.evaluateRobot(request())

    expect(calls.compile).toBe(2)
    expect(calls.evaluate).toBe(2)
    expect(replacement.evaluateRobot(request()).identity).toMatchObject({
      projectRevisionId: project.revisionId, configRevision: 'b'.repeat(64),
    })
  })
})
