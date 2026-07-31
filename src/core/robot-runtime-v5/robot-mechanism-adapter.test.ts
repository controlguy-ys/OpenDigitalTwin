import { describe, expect, it } from 'vitest'

import { createDefaultApplicationKinematicsServiceV1 } from '../mechanism-runtime-v1/application-kinematics-service.js'
import { MechanismErrorV1 } from '../mechanism-runtime-v1/errors.js'
import { EMPTY_SOLVER_PARAMETERS_SHA256_V1 } from '../mechanism-runtime-v1/limits.js'
import { ProjectV5Error } from '../project-v5/errors.js'
import { makeMinimalWorkcellProjectV5 } from '../project-v5/test-support.js'
import type { RobotDefinitionV5, RobotInstanceV5 } from '../project-v5/types.js'
import golden from './fixtures/serial-kinematics-golden-v5.json' with { type: 'json' }
import { buildSerialKinematicsErrorCaseV5, SERIAL_KINEMATICS_ERROR_CASE_IDS_V5 } from './test-support.js'
import {
  canonicalCoordinatesFromRobotV5,
  projectRobotCapabilityV5,
  projectRobotDefinitionV5ToMechanismV1,
  projectRobotInstanceV5ToMechanismInstanceV1,
  serialRobotPoseFromMechanismV1,
  validateSerialRobotCompatibilityInputV5,
} from './robot-mechanism-adapter.js'
import { computeSerialRobotPoseV5 } from './serial-kinematics.js'

function inputs(): { definition: RobotDefinitionV5; robot: RobotInstanceV5 } {
  const project = structuredClone(makeMinimalWorkcellProjectV5())
  return { definition: project.robotDefinitions[0]!, robot: project.robots[0]! }
}

describe('V5 Robot-to-Mechanism adapter', () => {
  it('projects V5 links, joints, frames, geometry, provenance, and Tree identity without changing their meanings', () => {
    const { definition } = inputs()
    const draft = definition as any
    draft.joints[0].home = 90
    draft.joints[0].zeroOffset = 10
    draft.joints[0].maximumVelocity = 180
    draft.frames.push({
      id: 'Nested', name: 'Nested', parentFrameId: 'Tool', role: 'grasp',
      localPose: { positionM: [0.1, 0.2, 0.3], quaternion: [0, 0, 0, 1] },
    })

    const projected = projectRobotDefinitionV5ToMechanismV1(definition).mechanismDefinition

    expect(projected).toMatchObject({
      mechanismId: 'definition-1', name: 'Robot Definition 1', topologyKind: 'tree',
      solverRef: {
        solverKey: 'open-digital-twin/tree-fk', contractVersion: '1', parameters: {},
        normalizedParametersHash: EMPTY_SOLVER_PARAMETERS_SHA256_V1,
      },
      bodies: [{ bodyId: 'L0', name: 'Link 0' }, { bodyId: 'L1', name: 'Link 1' }],
      joints: [{
        jointId: 'J1', jointType: 'revolute', parentBodyId: 'L0', childBodyId: 'L1', axis: [0, 0, 1],
        minimum: -Math.PI, maximum: Math.PI, home: Math.PI / 2, zeroOffset: Math.PI / 18,
        direction: 1, maximumVelocity: Math.PI,
      }],
      frames: [
        { frameId: 'Base', role: 'base', parent: { type: 'body', bodyId: 'L0' } },
        { frameId: 'Nested', role: 'grasp', parent: { type: 'frame', frameId: 'Tool' } },
        { frameId: 'TCP', role: 'tcp', parent: { type: 'frame', frameId: 'Tool' } },
        { frameId: 'Tool', role: 'tool', parent: { type: 'body', bodyId: 'L1' } },
      ],
      motionGroups: [{ motionGroupId: 'primary', name: 'Primary', coordinateJointIds: ['J1'], endFrameIds: ['Base', 'Nested', 'TCP', 'Tool'] }],
      geometryBindings: [{ geometryBindingId: 'robot-occurrence', occurrenceKey: 'robot-occurrence', bodyId: 'L0', assetReferenceId: 'asset-robot' }],
      sourceProvenance: {
        sourceKind: 'project-v5-robot', sourceDetail: 'manifest', sourceName: 'ned2.robot.json',
        sourceRevision: 'ned2-r1', adapterKey: 'open-digital-twin/project-v5-robot', adapterVersion: '1',
      },
    })
    expect(projected.geometryBindings[0]!.bodyLocalPose).toEqual({ positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] })
  })

  it('projects prismatic values as metres and projects every current V5 frame role losslessly', () => {
    const { definition } = inputs()
    const draft = definition as any
    draft.joints[0] = { ...definition.joints[0]!, type: 'prismatic', min: 0.1, max: 0.9, home: 0.25, zeroOffset: 0.05, maximumVelocity: 0.4 }
    const roles = ['world', 'mcp', 'tool0', 'gripper', 'grasp', 'placement'] as const
    draft.frames.splice(0, definition.frames.length, ...roles.map((role, index) => ({
      id: role, name: role, role, parentFrameId: index === 0 ? 'L0' : roles[index - 1]!,
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    })))

    const projected = projectRobotDefinitionV5ToMechanismV1(definition).mechanismDefinition

    expect(projected.joints[0]).toMatchObject({ jointType: 'prismatic', minimum: 0.1, maximum: 0.9, home: 0.25, zeroOffset: 0.05, maximumVelocity: 0.4 })
    expect(projected.frames.map((frame) => frame.role).sort()).toEqual([...roles].sort())
  })

  it('projects and evaluates a locked zero-speed V5 Joint at its only coordinate with exact legacy pose behavior', () => {
    const { definition } = inputs()
    const draft = definition as any
    draft.joints[0] = {
      ...definition.joints[0]!, min: 30, max: 30, home: 30,
      zeroOffset: 10, direction: -1, maximumVelocity: 0,
    }
    const worldBasePose = { positionM: [1, 2, 3] as const, quaternion: [0, 0, 0, 1] as const }
    const originalJointValues = { J1: 30 }
    const legacyPose = computeSerialRobotPoseV5(definition, originalJointValues, worldBasePose)

    const projected = projectRobotDefinitionV5ToMechanismV1(definition).mechanismDefinition
    const compiled = createDefaultApplicationKinematicsServiceV1().compile(projected)
    const result = compiled.evaluateForward({
      rootWorldPose: worldBasePose,
      coordinatesByStableId: canonicalCoordinatesFromRobotV5(definition, originalJointValues),
    })
    const adaptedPose = serialRobotPoseFromMechanismV1(definition, originalJointValues, result)

    expect(projected.joints[0]).toMatchObject({
      minimum: Math.PI / 6, maximum: Math.PI / 6, home: Math.PI / 6, maximumVelocity: 0,
    })
    expect(adaptedPose).toEqual(legacyPose)
    expect(adaptedPose.linkWorldPoses.L1).toEqual({
      positionM: [1, 2, 3],
      quaternion: [0, 0, -0.3420201433256687, 0.9396926207859084],
    })
  })

  it('retains reversed-bound and negative-velocity rejection at their approved compatibility layers', () => {
    const reversed = inputs().definition
    const reversedDraft = reversed as any
    reversedDraft.joints[0] = { ...reversed.joints[0]!, min: 1, max: -1, home: 0 }
    try {
      projectRobotDefinitionV5ToMechanismV1(reversed)
      throw new Error('Expected reversed V5 bounds to reject.')
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectV5Error)
      expect(error).toMatchObject({ code: 'ROBOT_JOINT_LIMIT_INVALID', path: '$.joints.J1' })
    }

    const negativeVelocity = inputs().definition
    const velocityDraft = negativeVelocity as any
    velocityDraft.joints[0] = { ...negativeVelocity.joints[0]!, maximumVelocity: -1 }
    const projected = projectRobotDefinitionV5ToMechanismV1(negativeVelocity).mechanismDefinition
    try {
      createDefaultApplicationKinematicsServiceV1().compile(projected)
      throw new Error('Expected negative neutral maximum velocity to reject.')
    } catch (error) {
      expect(error).toBeInstanceOf(MechanismErrorV1)
      expect(error).toMatchObject({ code: 'JOINT_LIMIT_INVALID', path: '$.joints[0].maximumVelocity' })
    }
  })

  it('projects the Runtime Instance and Robot Capability with one stable Home coordinate set', () => {
    const { definition, robot } = inputs()
    const draft = definition as any
    const robotDraft = robot as any
    draft.joints[0].home = 45
    draft.joints.push({ ...definition.joints[0]!, id: 'A2', parentLinkId: 'L1', childLinkId: 'L2', home: 0, type: 'prismatic' })
    draft.links.push({ id: 'L2', name: 'Link 2', geometryOccurrences: [] })
    draft.frames.push({ id: 'Flange', name: 'Flange', role: 'flange', parentFrameId: 'L2', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] } })
    robotDraft.frameSources = { Tool: 'manual', TCP: 'opcua:line-1' }

    expect(projectRobotInstanceV5ToMechanismInstanceV1(robot)).toEqual({
      instanceId: 'robot-1', definitionId: 'definition-1', parentFrameId: 'mcp', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      activeToolFrameId: 'Tool', activeTcpFrameId: 'TCP', visible: true,
      declaredValueOwners: { coordinates: 'simulation', frames: { Tool: 'manual', TCP: 'opcua:line-1' } },
    })
    expect(projectRobotCapabilityV5(definition, robot)).toMatchObject({
      robotCapabilityId: 'robot-1', mechanismId: 'definition-1', motionGroupIds: ['primary'], baseFrameId: 'Base',
      flangeFrameIds: ['Flange'], toolFrameIds: ['Tool'], tcpFrameIds: ['TCP'],
      homeCoordinateSets: [{ coordinateSetId: 'home', name: 'Home', coordinatesByStableId: { A2: 0, J1: Math.PI / 4 } }],
      roboticsOpcUaView: { axisJointIds: ['A2', 'J1'], baseFrameId: 'Base', flangeFrameIds: ['Flange'], toolFrameIds: ['Tool'], tcpFrameIds: ['TCP'] },
    })
  })

  it('allows a Definition with no base frame and returns an immutable detached deterministic snapshot', () => {
    const { definition, robot } = inputs()
    const draft = definition as any
    draft.frames = definition.frames.filter((frame) => frame.role !== 'base')
    const first = projectRobotDefinitionV5ToMechanismV1(definition)
    const second = projectRobotDefinitionV5ToMechanismV1(definition)
    draft.links[0].name = 'Mutated after projection'

    expect(projectRobotCapabilityV5(definition, robot).baseFrameId).toBeNull()
    expect(first).toEqual(second)
    expect(first.mechanismDefinition.bodies[0]!.name).toBe('Link 0')
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.mechanismDefinition.bodies)).toBe(true)
    expect(Object.isFrozen(first.mechanismDefinition.bodies[0]!)).toBe(true)
  })

  it('requires the exact legacy V5 command keys, converts canonical coordinates, and restores the V5 pose shape', () => {
    const { definition } = inputs()
    expect(canonicalCoordinatesFromRobotV5(definition, { J1: 180 })).toEqual({ J1: Math.PI })
    expect(() => canonicalCoordinatesFromRobotV5(definition, {})).toThrow(ProjectV5Error)
    expect(serialRobotPoseFromMechanismV1(definition, { J1: 30 }, {
      solverKey: 'open-digital-twin/tree-fk', solverContractVersion: '1', normalizedCoordinates: { J1: Math.PI / 6 },
      bodyLocalPoses: { L0: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, L1: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] } },
      bodyWorldPoses: { L0: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, L1: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] } },
      frameWorldPoses: { Base: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] } }, motionGroupEndFramePoses: {}, warnings: [],
    })).toEqual({
      jointValues: { J1: 30 }, linkLocalPoses: { L0: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, L1: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] } },
      linkWorldPoses: { L0: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, L1: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] } },
      frameWorldPoses: { Base: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] } },
    })
  })

  it('returns a detached frozen V5 pose without freezing or aliasing the solver result', () => {
    const { definition } = inputs()
    const local = { positionM: [1, 2, 3] as [number, number, number], quaternion: [0, 0, 0, 1] as [number, number, number, number] }
    const world = { positionM: [4, 5, 6] as [number, number, number], quaternion: [0, 0, 0, 1] as [number, number, number, number] }
    const frame = { positionM: [7, 8, 9] as [number, number, number], quaternion: [0, 0, 0, 1] as [number, number, number, number] }
    const result = {
      solverKey: 'open-digital-twin/tree-fk', solverContractVersion: '1', normalizedCoordinates: { J1: 0 },
      bodyLocalPoses: { L0: local }, bodyWorldPoses: { L0: world }, frameWorldPoses: { Base: frame },
      motionGroupEndFramePoses: {}, warnings: [],
    }

    const pose = serialRobotPoseFromMechanismV1(definition, { J1: 0 }, result)

    expect(pose.linkLocalPoses).toEqual(result.bodyLocalPoses)
    expect(pose.linkWorldPoses).toEqual(result.bodyWorldPoses)
    expect(pose.frameWorldPoses).toEqual(result.frameWorldPoses)
    expect(pose.linkLocalPoses).not.toBe(result.bodyLocalPoses)
    expect(pose.linkWorldPoses).not.toBe(result.bodyWorldPoses)
    expect(pose.frameWorldPoses).not.toBe(result.frameWorldPoses)
    expect(pose.linkLocalPoses.L0).not.toBe(local)
    expect(pose.linkWorldPoses.L0).not.toBe(world)
    expect(pose.frameWorldPoses.Base).not.toBe(frame)
    expect(Object.isFrozen(pose.linkLocalPoses)).toBe(true)
    expect(Object.isFrozen(pose.linkLocalPoses.L0)).toBe(true)
    expect(Object.isFrozen(pose.linkLocalPoses.L0!.positionM)).toBe(true)
    expect(Object.isFrozen(result.bodyLocalPoses)).toBe(false)
    expect(Object.isFrozen(local)).toBe(false)
    expect(Object.isFrozen(local.positionM)).toBe(false)
    local.positionM[0] = 99
    ;(result.bodyLocalPoses as Record<string, typeof local>).L1 = { positionM: [10, 11, 12], quaternion: [0, 0, 0, 1] }
    expect(pose.linkLocalPoses.L0!.positionM[0]).toBe(1)
    expect(pose.linkLocalPoses).not.toHaveProperty('L1')
  })

  it('retains every Task 5 golden error exactly before the neutral core runs', () => {
    const expectedByCaseId = new Map(golden.errorCases.map((entry) => [entry.caseId, entry.expected]))
    for (const caseId of SERIAL_KINEMATICS_ERROR_CASE_IDS_V5) {
      const input = buildSerialKinematicsErrorCaseV5(caseId)
      try {
        validateSerialRobotCompatibilityInputV5(input.definition, input.jointValues, input.worldBasePose ?? { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] })
        throw new Error(`Expected ${caseId} to reject.`)
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectV5Error)
        const projectError = error as ProjectV5Error
        expect({ name: projectError.name, code: projectError.code, path: projectError.path, message: projectError.message, recovery: projectError.recovery ?? null }).toEqual(expectedByCaseId.get(caseId))
      }
    }
  })
})
