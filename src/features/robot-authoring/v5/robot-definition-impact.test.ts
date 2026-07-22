import { describe, expect, it } from 'vitest'

import {
  validateWorkcellProjectV5,
  type OpcUaMappingV5,
  type RobotDefinitionV5,
  type RobotInstanceV5,
  type RobotJobV5,
  type SpatialEntityV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import { analyzeRobotDefinitionImpactV5 } from './robot-definition-impact.js'

function jointMapping(id: string, robotId: string, jointId: string): OpcUaMappingV5 {
  const mapping = structuredClone(makeMinimalWorkcellProjectV5().opcUa.mappings[0]!)
  return {
    ...mapping,
    id,
    direction: 'write',
    leaves: [{
      ...mapping.leaves[0]!,
      opcUaDataType: 'Double',
      projectDataType: 'number',
      projectTarget: { type: 'robot-joint', robotId, jointId },
    }],
  }
}

function frameMapping(id: string, robotId: string, frameId: string): OpcUaMappingV5 {
  const mapping = structuredClone(makeMinimalWorkcellProjectV5().opcUa.mappings[0]!)
  return {
    ...mapping,
    id,
    direction: 'write',
    leaves: [{
      ...mapping.leaves[0]!,
      leafPath: ['positionM', 0],
      projectPath: ['positionM', 0],
      opcUaDataType: 'Double',
      projectDataType: 'number',
      projectTarget: { type: 'robot-frame', robotId, frameId },
    }, {
      ...mapping.leaves[0]!,
      leafPath: ['positionM', 1],
      projectPath: ['positionM', 1],
      opcUaDataType: 'Double',
      projectDataType: 'number',
      projectTarget: { type: 'robot-frame', robotId, frameId },
    }, {
      ...mapping.leaves[0]!,
      leafPath: ['positionM', 2],
      projectPath: ['positionM', 2],
      opcUaDataType: 'Double',
      projectDataType: 'number',
      projectTarget: { type: 'robot-frame', robotId, frameId },
    }, {
      ...mapping.leaves[0]!,
      leafPath: ['rpyDegrees', 0],
      projectPath: ['rpyDegrees', 0],
      opcUaDataType: 'Double',
      projectDataType: 'number',
      projectTarget: { type: 'robot-frame', robotId, frameId },
    }, {
      ...mapping.leaves[0]!,
      leafPath: ['rpyDegrees', 1],
      projectPath: ['rpyDegrees', 1],
      opcUaDataType: 'Double',
      projectDataType: 'number',
      projectTarget: { type: 'robot-frame', robotId, frameId },
    }, {
      ...mapping.leaves[0]!,
      leafPath: ['rpyDegrees', 2],
      projectPath: ['rpyDegrees', 2],
      opcUaDataType: 'Double',
      projectDataType: 'number',
      projectTarget: { type: 'robot-frame', robotId, frameId },
    }],
  }
}

function projectWithSharedDefinitionV5(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  const firstRobot = project.robots[0]!
  const robotA: RobotInstanceV5 = { ...firstRobot, id: 'robot-a', name: 'Robot A' }
  const robotB: RobotInstanceV5 = { ...firstRobot, id: 'robot-b', name: 'Robot B' }
  ;(project.robots as RobotInstanceV5[]).splice(0, 1, robotB, robotA)
  ;(project.jobs as RobotJobV5[]).splice(0, 1,
    { ...project.jobs[0]!, id: 'job-b', name: 'Job B', robotId: 'robot-b', instructions: [{ ...project.jobs[0]!.instructions[0]!, id: 'instruction-b' }] },
    { ...project.jobs[0]!, id: 'job-a', name: 'Job A', robotId: 'robot-a', instructions: [{ ...project.jobs[0]!.instructions[0]!, id: 'instruction-a' }] },
  )
  ;(project.opcUa.mappings as OpcUaMappingV5[]).splice(0, 1, jointMapping('map-j1-a', 'robot-a', 'J1'))
  return validateWorkcellProjectV5(project)
}

function changedDefinitionV5(): RobotDefinitionV5 {
  const definition = makeMinimalWorkcellProjectV5().robotDefinitions[0]!
  return {
    ...definition,
    joints: definition.joints.map((joint) => joint.id === 'J1' ? { ...joint, axis: [0, 1, 0] } : joint),
  }
}

function projectWithJ6ReferencesV5(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  const definition = project.robotDefinitions[0]!
  const withJ6: RobotDefinitionV5 = {
    ...definition,
    links: [...definition.links, { id: 'L2', name: 'Link 2', geometryOccurrences: [] }],
    joints: [...definition.joints, {
      ...definition.joints[0]!, id: 'J6', parentLinkId: 'L1', childLinkId: 'L2', axis: [0, 1, 0],
    }],
    frames: definition.frames.map((frame) => frame.id === 'Tool' ? { ...frame, parentFrameId: 'L2' } : frame),
  }
  const robot = project.robots[0]!
  ;(project.robotDefinitions as RobotDefinitionV5[]).splice(0, 1, withJ6)
  ;(project.robots as RobotInstanceV5[]).splice(0, 1, { ...robot, initialJointValues: { ...robot.initialJointValues, J6: 0 } })
  ;(project.jobs as RobotJobV5[]).splice(0, 1, {
    ...project.jobs[0]!, instructions: [{ id: 'instruction-1', kind: 'move-joint', jointValues: { J1: 0, J6: 0 }, speedPercentToNext: 100 }],
  })
  ;(project.opcUa.mappings as OpcUaMappingV5[]).splice(0, 1, jointMapping('map-j6', 'robot-1', 'J6'))
  return validateWorkcellProjectV5(project)
}

function candidateDefinitionWithoutJ6V5(): RobotDefinitionV5 {
  const definition = projectWithJ6ReferencesV5().robotDefinitions[0]!
  return {
    ...definition,
    links: definition.links.filter((link) => link.id !== 'L2'),
    joints: definition.joints.filter((joint) => joint.id !== 'J6'),
    frames: definition.frames.map((frame) => frame.id === 'Tool' ? { ...frame, parentFrameId: 'L1' } : frame),
  }
}

function graspablePart(): SpatialEntityV5 {
  return {
    id: 'part', name: 'Part', geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#ffffff' },
    parentFrameId: 'mcp', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, visible: true,
    groupId: null, removable: true, transformOwner: 'simulation',
    numericStatus: { value: 0, sourceOwnership: 'simulation', overlay: { visible: false, frameId: null } },
    graspable: true, graspFrames: [{ frameId: 'part-grasp', name: 'Part Grasp', localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] } }],
    movingFrames: [],
  }
}

function projectWithToolReferencesV5(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project.spatialEntities as SpatialEntityV5[]).push(graspablePart())
  ;(project.jobs as RobotJobV5[]).splice(0, 1, {
    ...project.jobs[0]!,
    instructions: [...project.jobs[0]!.instructions, {
      id: 'attach-part', kind: 'attach', objectId: 'part', toolFrameId: 'Tool', objectGraspFrameId: 'part-grasp', maximumDistanceM: 1,
    }],
  })
  ;(project.opcUa.mappings as OpcUaMappingV5[]).splice(0, 1, frameMapping('map-tool', 'robot-1', 'Tool'))
  return validateWorkcellProjectV5(project)
}

function candidateDefinitionWithoutToolV5(): RobotDefinitionV5 {
  const definition = makeMinimalWorkcellProjectV5().robotDefinitions[0]!
  return {
    ...definition,
    frames: definition.frames
      .filter((frame) => frame.id !== 'Tool')
      .map((frame) => frame.id === 'TCP' ? { ...frame, parentFrameId: 'L1' } : frame),
  }
}

describe('analyzeRobotDefinitionImpactV5', () => {
  it('reports every affected Instance, Job, OPC UA mapping, and Frame', () => {
    const report = analyzeRobotDefinitionImpactV5(projectWithSharedDefinitionV5(), changedDefinitionV5())

    expect(report.robotIds).toEqual(['robot-a', 'robot-b'])
    expect(report.jobIds).toEqual(['job-a', 'job-b'])
    expect(report.mappingIds).toEqual(['map-j1-a'])
    expect(report.frameIds).toEqual(['TCP', 'Tool'])
    expect(report.requiresMotionRevalidation).toBe(true)
    expect(report.blockingCodes).toEqual([])
  })

  it('reports removed Joint IDs referenced by Jobs or mappings as blocking', () => {
    const report = analyzeRobotDefinitionImpactV5(projectWithJ6ReferencesV5(), candidateDefinitionWithoutJ6V5())

    expect(report.robotIds).toEqual(['robot-1'])
    expect(report.jobIds).toEqual(['job-1'])
    expect(report.mappingIds).toEqual(['map-j6'])
    expect(report.blockingCodes).toContain('JOINT_DEPENDENCY_CONFLICT')
  })

  it('keeps inputs unchanged and reports removed selected, attached, and mapped Frames as blocking', () => {
    const project = projectWithToolReferencesV5()
    const candidate = candidateDefinitionWithoutToolV5()
    const projectBefore = JSON.stringify(project)
    const candidateBefore = JSON.stringify(candidate)

    const report = analyzeRobotDefinitionImpactV5(project, candidate)

    expect(report.frameIds).toEqual(['TCP', 'Tool'])
    expect(report.mappingIds).toEqual(['map-tool'])
    expect(report.blockingCodes).toEqual(['FRAME_DEPENDENCY_CONFLICT'])
    expect(JSON.stringify(project)).toBe(projectBefore)
    expect(JSON.stringify(candidate)).toBe(candidateBefore)
  })
})
