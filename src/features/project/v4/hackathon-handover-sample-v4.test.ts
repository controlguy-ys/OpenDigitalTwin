import { describe, expect, it } from 'vitest'

import {
  computeSerialRobotPoseV4,
} from '../../../core/robot-runtime/serial-kinematics.js'
import { validateWorkcellProjectV4 } from '../../../core/project-v4/index.js'
import { BUILTIN_NED2_DEFINITION_ID_V4 } from '../../robot/v4/builtin-ned2-definition.js'
import {
  createHackathonHandoverSampleV4,
  HACKATHON_HANDOVER_IDS_V4,
  HACKATHON_HANDOVER_STEPS_V4,
  isHackathonHandoverSampleV4,
} from './hackathon-handover-sample-v4.js'

const IDENTITY = {
  projectId: 'project-hackathon-handover',
  revisionId: 'revision-hackathon-handover',
  nowIso: '2026-07-21T06:00:00.000Z',
} as const

function sample() {
  return createHackathonHandoverSampleV4(IDENTITY)
}

function expectPositionsToCoincide(
  actual: readonly number[],
  expected: readonly number[],
): void {
  expect(actual).toHaveLength(3)
  actual.forEach((component, index) => {
    expect(Math.abs(component - expected[index]!)).toBeLessThanOrEqual(1e-6)
  })
}

describe('Hackathon NED2 handover Project V4 sample', () => {
  it('shares one NED2 Definition across two independent Robot Instances', () => {
    const project = sample()
    expect(project.robotDefinitions).toHaveLength(1)
    expect(project.robots.map(({ definitionId }) => definitionId)).toEqual([
      BUILTIN_NED2_DEFINITION_ID_V4,
      BUILTIN_NED2_DEFINITION_ID_V4,
    ])
    expect(project.robots.map(({ id }) => id)).toEqual([
      HACKATHON_HANDOVER_IDS_V4.robotAId,
      HACKATHON_HANDOVER_IDS_V4.robotBId,
    ])
  })

  it('creates one representative Job and the three solid Scene primitives', () => {
    const project = sample()
    expect(project.jobs).toHaveLength(1)
    expect(project.jobs[0]?.id).toBe(HACKATHON_HANDOVER_IDS_V4.jobId)
    expect(project.spatialEntities.map(({ id }) => id)).toEqual([
      HACKATHON_HANDOVER_IDS_V4.tableId,
      HACKATHON_HANDOVER_IDS_V4.workpieceId,
      HACKATHON_HANDOVER_IDS_V4.outputTrayId,
    ])
    expect(project.spatialEntities.every(({ geometry }) => (
      geometry.kind === 'box' || geometry.kind === 'cylinder'
    ))).toBe(true)
  })

  it('validates the deterministic offline Project and persists one step per Coordinator state', () => {
    const project = sample()

    expect(validateWorkcellProjectV4(project)).toEqual(project)
    expect(project).toMatchObject({
      projectId: IDENTITY.projectId,
      revisionId: IDENTITY.revisionId,
      metadata: {
        createdAt: IDENTITY.nowIso,
        updatedAt: IDENTITY.nowIso,
      },
      opcUa: {
        mode: 'off',
        endpoints: [],
        mappings: [],
        actionBindings: [],
        bridgeRoutes: [],
      },
    })
    expect(HACKATHON_HANDOVER_STEPS_V4).toEqual([
      'READY',
      'PICK_APPROACH',
      'PICK_GRIP',
      'MOVE_TO_SHARED_ZONE',
      'HANDOVER_APPROACH',
      'HANDOVER_CONFIRM',
      'PLACE',
      'COMPLETE',
    ])
    expect(project.jobs[0]?.robotId).toBe(HACKATHON_HANDOVER_IDS_V4.robotAId)
    expect(project.jobs[0]?.steps).toHaveLength(HACKATHON_HANDOVER_STEPS_V4.length)
    expect(project.jobs[0]?.steps.map((step) => (
      step.kind === 'joint-pose' ? step.speedPercentToNext : null
    ))).toEqual([35, 35, 35, 35, 35, 35, 35, 100])
  })

  it('derives both bases so the Shared TCP World positions coincide', () => {
    const project = sample()
    const definition = project.robotDefinitions[0]!
    const [robotA, robotB] = project.robots
    const sharedJointValues = {
      J1: 0,
      J2: -32,
      J3: -44,
      J4: 0,
      J5: 52,
      J6: 0,
    }
    const sharedTcpA = computeSerialRobotPoseV4(
      definition,
      sharedJointValues,
      robotA!.localBasePose,
    ).frameWorldPoses.TCP!
    const sharedTcpB = computeSerialRobotPoseV4(
      definition,
      sharedJointValues,
      robotB!.localBasePose,
    ).frameWorldPoses.TCP!

    expect(robotA!.localBasePose.quaternion).toEqual([0, 0, 0, 1])
    expect(robotB!.localBasePose.quaternion).toEqual([0, 0, 1, 0])
    expectPositionsToCoincide(sharedTcpA.positionM, sharedTcpB.positionM)
  })

  it('derives the Workpiece and Output Tray positions from the Pick and Place TCPs', () => {
    const project = sample()
    const definition = project.robotDefinitions[0]!
    const [robotA, robotB] = project.robots
    const workpiece = project.spatialEntities.find(
      ({ id }) => id === HACKATHON_HANDOVER_IDS_V4.workpieceId,
    )!
    const outputTray = project.spatialEntities.find(
      ({ id }) => id === HACKATHON_HANDOVER_IDS_V4.outputTrayId,
    )!
    const pickTcp = computeSerialRobotPoseV4(definition, {
      J1: -35, J2: -38, J3: -52, J4: 0, J5: 58, J6: 0,
    }, robotA!.localBasePose).frameWorldPoses.TCP!
    const placeTcp = computeSerialRobotPoseV4(definition, {
      J1: 35, J2: -38, J3: -52, J4: 0, J5: 58, J6: 0,
    }, robotB!.localBasePose).frameWorldPoses.TCP!

    expectPositionsToCoincide(workpiece.localPose.positionM, pickTcp.positionM)
    expectPositionsToCoincide(outputTray.localPose.positionM, placeTcp.positionM)
    expect(project.robots.map(({ intentionalMountEntityId }) => intentionalMountEntityId)).toEqual([
      HACKATHON_HANDOVER_IDS_V4.tableId,
      HACKATHON_HANDOVER_IDS_V4.tableId,
    ])
  })

  it('recognizes only Projects containing the handover Job, Robots, and Workpiece', () => {
    const project = sample()

    expect(isHackathonHandoverSampleV4(project)).toBe(true)
    expect(isHackathonHandoverSampleV4({
      ...project,
      jobs: [],
    })).toBe(false)
    expect(isHackathonHandoverSampleV4({
      ...project,
      spatialEntities: project.spatialEntities.filter(
        ({ id }) => id !== HACKATHON_HANDOVER_IDS_V4.workpieceId,
      ),
    })).toBe(false)
  })
})
