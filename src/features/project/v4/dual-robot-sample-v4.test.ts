import { describe, expect, it } from 'vitest'

import { validateWorkcellProjectV4 } from '../../../core/project-v4/index.js'
import { BUILTIN_CRB_DEFINITION_ID_V4 } from '../../robot/v4/builtin-crb-definition.js'
import {
  createDualRobotSampleV4,
  DUAL_ROBOT_SAMPLE_IDS_V4,
} from './dual-robot-sample-v4.js'

const IDENTITY = {
  projectId: 'project-dual-robot',
  revisionId: 'revision-dual-robot',
  nowIso: '2026-07-17T06:00:00.000Z',
} as const

describe('dual-Robot Project V4 sample', () => {
  it('creates a validated, spatially separated source-only sample with one Job per Robot', () => {
    const project = createDualRobotSampleV4(IDENTITY)

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
      },
    })
    expect(project.robotDefinitions).toHaveLength(2)
    expect(project.robots).toHaveLength(2)
    expect(project.jobs).toHaveLength(2)

    const crbDefinition = project.robotDefinitions.find(
      ({ id }) => id === BUILTIN_CRB_DEFINITION_ID_V4,
    )!
    const sourceOnlyDefinition = project.robotDefinitions.find(
      ({ id }) => id !== BUILTIN_CRB_DEFINITION_ID_V4,
    )!
    expect(crbDefinition.assetReferenceIds).toHaveLength(7)
    expect(sourceOnlyDefinition).toMatchObject({
      assetReferenceIds: ['builtin-sample-linear-slide-source'],
      joints: [{ type: 'prismatic', axis: [1, 0, 0] }],
    })
    expect(sourceOnlyDefinition.links.every(
      ({ geometryOccurrences }) => geometryOccurrences.length === 0,
    )).toBe(true)
    expect(project.assetReferences.every(({ uri }) => uri.startsWith('builtin://'))).toBe(true)
    expect(project.assetReferences.every(
      ({ sourceFileName }) => !sourceFileName.includes('/') && !sourceFileName.includes('\\'),
    )).toBe(true)

    const [firstRobot, secondRobot] = project.robots
    expect(firstRobot!.localBasePose.positionM).not.toEqual(
      secondRobot!.localBasePose.positionM,
    )
    expect(Math.abs(
      firstRobot!.localBasePose.positionM[0]
        - secondRobot!.localBasePose.positionM[0],
    )).toBeGreaterThanOrEqual(2)

    for (const robot of project.robots) {
      const definition = project.robotDefinitions.find(
        ({ id }) => id === robot.definitionId,
      )!
      const job = project.jobs.find(({ robotId }) => robotId === robot.id)!
      expect(job.steps).toHaveLength(2)
      const [firstPose, secondPose] = job.steps
      expect(firstPose?.kind).toBe('joint-pose')
      expect(secondPose?.kind).toBe('joint-pose')
      if (firstPose?.kind !== 'joint-pose' || secondPose?.kind !== 'joint-pose') {
        throw new Error('Sample Jobs must contain only joint-pose steps.')
      }
      expect(Object.keys(firstPose.jointValues).sort()).toEqual(
        definition.joints.map(({ id }) => id).sort(),
      )
      expect(firstPose.jointValues).not.toEqual(secondPose.jointValues)
    }
  })

  it('optionally publishes one valid Joint mapping for each Robot in OPC UA server mode', () => {
    const project = createDualRobotSampleV4({
      ...IDENTITY,
      projectId: 'project-server',
      revisionId: 'revision-server',
      nowIso: '2026-07-17T07:00:00.000Z',
      opcUaMode: 'server',
    })

    expect(validateWorkcellProjectV4(project)).toEqual(project)
    expect(project.opcUa.mode).toBe('server')
    expect(project.opcUa.endpoints).toHaveLength(1)
    expect(project.opcUa.mappings).toHaveLength(2)
    expect(project.opcUa.endpoints[0]?.endpointId).toBe(
      DUAL_ROBOT_SAMPLE_IDS_V4.opcUaEndpointId,
    )
    expect(new Set(project.opcUa.mappings.flatMap(({ leaves }) => (
      leaves.map(({ nodeId }) => nodeId)
    )))).toEqual(new Set([
      DUAL_ROBOT_SAMPLE_IDS_V4.crbJointNodeId,
      DUAL_ROBOT_SAMPLE_IDS_V4.slideJointNodeId,
    ]))
    expect(project.opcUa.mappings.every(
      ({ direction, sourceOwnership }) => (
        direction === 'publish' && sourceOwnership === 'simulation'
      ),
    )).toBe(true)
    expect(new Set(project.opcUa.mappings.flatMap(({ leaves }) => (
      leaves.map(({ projectTarget }) => (
        projectTarget.type === 'robot-joint' ? projectTarget.robotId : null
      ))
    )))).toEqual(new Set(project.robots.map(({ id }) => id)))
  })
})
