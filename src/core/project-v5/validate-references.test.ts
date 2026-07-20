import { describe, expect, it } from 'vitest'

import { validateWorkcellProjectV5 } from './validate.js'
import type { WorkcellProjectV5 } from './types.js'
import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
  projectV5AtLimit,
  projectWithInstructionSignalV5,
  projectWithMissingMoveJointV5,
} from './test-support.js'

const FRAME_PROJECT_PATHS = [
  ['positionM', 0], ['positionM', 1], ['positionM', 2],
  ['rpyDegrees', 0], ['rpyDegrees', 1], ['rpyDegrees', 2],
] as const

function setRecords(project: WorkcellProjectV5, key: 'logicalSignals' | 'spatialEntities', records: readonly unknown[]): void {
  ;(project[key] as unknown as unknown[]).splice(0, project[key].length, ...records)
}

function setMappings(project: WorkcellProjectV5, mappings: readonly unknown[]): void {
  ;(project.opcUa.mappings as unknown as unknown[]).splice(0, project.opcUa.mappings.length, ...mappings)
}

function inputSignal(id: string): Record<string, unknown> {
  return { id, name: id, dataType: 'Boolean', direction: 'input', initialValue: false, unit: '', scope: { type: 'project' } }
}

function numericLeaf(
  target: Record<string, unknown>,
  leafPath: readonly (string | number)[] = [],
  projectPath: readonly (string | number)[] = [],
  opcUaDataType = 'Double',
  projectDataType = 'number',
): Record<string, unknown> {
  return {
    leafPath,
    projectPath,
    projectTarget: target,
    opcUaDataType,
    projectDataType,
    scale: 1,
    offset: 0,
    unit: '',
    required: true,
  }
}

function mappingFor(
  id: string,
  endpointId: string,
  identifier: string,
  leaves: readonly Record<string, unknown>[],
  direction: 'read' | 'write' | 'readWrite' = 'read',
): Record<string, unknown> {
  return {
    id,
    endpointId,
    nodeAddress: { namespaceUri: 'urn:sample:plc', identifierType: 'string', identifier },
    direction,
    coherenceGroupId: null,
    interpolationMode: 'none',
    coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
    leaves,
  }
}

function logicalMapping(id: string, endpointId: string, signalId: string, leafPaths: readonly (readonly (string | number)[])[] = [[]]): Record<string, unknown> {
  return mappingFor(id, endpointId, `Signals.${id}`, leafPaths.map((leafPath) => numericLeaf(
    { type: 'logical-signal', signalId }, leafPath, [], 'Boolean', 'boolean',
  )))
}

function appendEndpoint(project: WorkcellProjectV5, endpointId: string, enabled = true, publishingIntervalMs = 100): void {
  ;(project.opcUa.endpoints as unknown as unknown[]).push({
    endpointId,
    name: endpointId,
    endpointUrl: `opc.tcp://localhost:${4840 + project.opcUa.endpoints.length}`,
    enabled,
    publishingIntervalMs,
    reconnectDelayMs: 1_000,
  })
}

function projectWithEndpointRoots(count: number, endpointId = 'endpoint-1'): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  setRecords(project, 'logicalSignals', Array.from({ length: count }, (_, index) => inputSignal(index === 0 ? 'PartPresent' : `Signal-${index}`)))
  setMappings(project, Array.from({ length: count }, (_, index) => logicalMapping(
    `mapping-${index}`,
    endpointId,
    index === 0 ? 'PartPresent' : `Signal-${index}`,
  )))
  return project
}

function frameLeaves(target: Record<string, unknown>, opcUaDataType = 'Double', projectDataType = 'number'): Record<string, unknown>[] {
  return FRAME_PROJECT_PATHS.map((projectPath, index) => numericLeaf(target, [index], projectPath, opcUaDataType, projectDataType))
}

function entity(id: string, frameId: string, ownership = 'simulation'): Record<string, unknown> {
  return {
    id,
    name: id,
    geometry: { kind: 'box', dimensionsM: [1, 1, 1], color: '#ffffff' },
    parentFrameId: 'mcp',
    localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    visible: true,
    groupId: null,
    removable: true,
    transformOwner: ownership,
    numericStatus: { value: 0, sourceOwnership: ownership, overlay: { visible: false, frameId: null } },
    graspable: false,
    graspFrames: [],
    movingFrames: [{
      frameId,
      name: frameId,
      parentFrameId: 'mcp',
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      sourceOwnership: ownership,
    }],
  }
}

function projectWithDefinitionFrameCount(totalFrameCount: number): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  const additional = totalFrameCount - project.scene.frames.length - project.robotDefinitions[0]!.frames.length
  const frames = project.robotDefinitions[0]!.frames as unknown as unknown[]
  const sources = project.robots[0]!.frameSources as unknown as Record<string, string>
  for (let index = 0; index < additional; index += 1) {
    const id = `DefinitionFrame-${index}`
    frames.push({
      id,
      name: id,
      parentFrameId: 'L1',
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      role: 'custom',
    })
    sources[id] = 'simulation'
  }
  return project
}

function projectWithRobotJointTarget(target: Record<string, unknown>, direction: 'read' | 'readWrite' = 'read'): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project.robots[0] as unknown as { jointSource: string }).jointSource = 'opcua:endpoint-1'
  setMappings(project, [mappingFor('mapping-joint', 'endpoint-1', 'Robot.Joint', [numericLeaf(target)], direction)])
  return project
}

function projectWithRobotFrameTarget(target: Record<string, unknown>, direction: 'read' | 'readWrite' = 'read'): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project.robots[0]!.frameSources as unknown as Record<string, string>).Base = 'opcua:endpoint-1'
  setMappings(project, [mappingFor('mapping-frame', 'endpoint-1', 'Robot.Frame', frameLeaves(target), direction)])
  return project
}

describe('validateWorkcellProjectV5 reference, semantic, and OPC UA budget validation', () => {
  it.each([
    ['logicalSignals', 1_024, 1_025, 'LOGICAL_SIGNAL_LIMIT_EXCEEDED'],
    ['opcUaMappings', 128, 129, 'OPCUA_STRUCTURE_ROOT_LIMIT_EXCEEDED'],
    ['opcUaLeaves', 1_024, 1_025, 'OPCUA_PROJECT_LEAF_LIMIT_EXCEEDED'],
    ['jobInstructions', 2_048, 2_049, 'TOTAL_JOB_INSTRUCTION_LIMIT_EXCEEDED'],
  ] as const)('%s accepts %i and rejects %i', (field, exact, plusOne, code) => {
    expect(() => validateWorkcellProjectV5(projectV5AtLimit(field, exact))).not.toThrow()
    expect(() => validateWorkcellProjectV5(projectV5AtLimit(field, plusOne))).toThrow(code)
  })

  it.each([
    ['set-do', 'input', 'JOB_SIGNAL_DIRECTION_INVALID'],
    ['wait-di', 'output', 'JOB_SIGNAL_DIRECTION_INVALID'],
    ['wait-di', 'internal', 'JOB_SIGNAL_DIRECTION_INVALID'],
  ] as const)('rejects %s against %s', (kind, direction, code) => {
    expect(() => validateWorkcellProjectV5(projectWithInstructionSignalV5(kind, direction))).toThrow(code)
  })

  it('requires the exact Robot Joint set for every move-joint', () => {
    expect(() => validateWorkcellProjectV5(projectWithMissingMoveJointV5('J2')))
      .toThrow('ROBOT_JOINT_SET_MISMATCH')
  })

  it('uses Namespace URI when the same logical Node has different session indexes', () => {
    const project = makeMinimalWorkcellProjectV5()
    expect(project.opcUa.mappings[0]!.nodeAddress).toEqual({
      namespaceUri: 'urn:sample:plc', identifierType: 'string', identifier: 'Signals.PartPresent',
    })
    expect(JSON.stringify(project)).not.toMatch(/ns=\d+;/u)
  })

  it('requires each Robot Controller and rejects a Controller with no Robot', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.robots[0] as unknown as { controllerId: string }).controllerId = 'missing-controller'
    expect(() => validateWorkcellProjectV5(project)).toThrowError(expect.objectContaining({
      code: 'ROBOT_CONTROLLER_NOT_FOUND', path: '$.robots[0].controllerId',
    }))

    const unused = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(unused.controllers as unknown as unknown[]).push({
      id: 'controller-2',
      name: 'Controller 2',
      identification: { manufacturer: 'ABB', model: 'OmniCore', productCode: 'P2', serialNumber: 'CTRL-2' },
    })
    expect(() => validateWorkcellProjectV5(unused)).toThrow('ROBOT_CONTROLLER_UNREFERENCED')
  })

  it('requires exact Robot Frame source keys and known OPC UA owners', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    delete (project.robots[0]!.frameSources as unknown as Record<string, unknown>).TCP
    expect(() => validateWorkcellProjectV5(project)).toThrow('ROBOT_FRAME_SOURCE_SET_MISMATCH')

    const unknownOwner = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(unknownOwner.robots[0]!.frameSources as unknown as Record<string, unknown>).TCP = 'opcua:missing'
    expect(() => validateWorkcellProjectV5(unknownOwner)).toThrow('OPCUA_ENDPOINT_NOT_FOUND')
  })

  it('validates logical Signal scopes and Job timer and attachment semantics', () => {
    const scoped = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(scoped.logicalSignals[0] as unknown as { scope: unknown }).scope = { type: 'robot', id: 'missing' }
    expect(() => validateWorkcellProjectV5(scoped)).toThrow('ROBOT_INSTANCE_NOT_FOUND')

    const timer = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(timer.jobs[0]!.instructions as unknown as unknown[]).splice(0, 1, {
      id: 'instruction-1', kind: 'delay', durationMs: 0,
    })
    expect(() => validateWorkcellProjectV5(timer)).toThrow('JOB_TIMER_INVALID')

    const attachment = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(attachment.spatialEntities as unknown as unknown[]).push({
      id: 'part-1',
      name: 'Part',
      geometry: { kind: 'box', dimensionsM: [1, 1, 1], color: '#ffffff' },
      parentFrameId: 'mcp',
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      visible: true,
      groupId: null,
      removable: true,
      transformOwner: 'simulation',
      numericStatus: { value: 0, sourceOwnership: 'simulation', overlay: { visible: false, frameId: null } },
      graspable: false,
      graspFrames: [],
      movingFrames: [],
    })
    ;(attachment.jobs[0]!.instructions as unknown as unknown[]).splice(0, 1, {
      id: 'instruction-1',
      kind: 'attach',
      objectId: 'part-1',
      toolFrameId: 'Tool',
      objectGraspFrameId: null,
      maximumDistanceM: 0,
    })
    expect(() => validateWorkcellProjectV5(attachment)).toThrow('OBJECT_NOT_GRASPABLE')
  })

  it('rejects duplicate instruction IDs across Jobs', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.jobs as unknown as unknown[]).push({
      id: 'job-2', name: 'Second', robotId: 'robot-1', instructions: [{
        id: 'instruction-1', kind: 'delay', durationMs: 1,
      }],
    })
    expect(() => validateWorkcellProjectV5(project)).toThrow('PROJECT_ID_DUPLICATE')
  })

  it('requires one target per Mapping and validates target path semantics', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.opcUa.mappings[0]!.leaves[0] as unknown as { leafPath: unknown }).leafPath = ['first']
    ;(project.opcUa.mappings[0]!.leaves as unknown as unknown[]).push({
      ...project.opcUa.mappings[0]!.leaves[0],
      leafPath: ['other'],
      projectTarget: { type: 'robot-status', robotId: 'robot-1' },
    })
    expect(() => validateWorkcellProjectV5(project)).toThrow('OPCUA_MAPPING_TARGET_MISMATCH')

    const path = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(path.opcUa.mappings[0]!.leaves[0] as unknown as { projectPath: unknown }).projectPath = ['value']
    expect(() => validateWorkcellProjectV5(path)).toThrow('OPCUA_PROJECT_PATH_INVALID')
  })

  it('rejects multiple Leaves for a scalar Mapping target', () => {
    const project = projectWithRobotJointTarget({ type: 'robot-joint', robotId: 'robot-1', jointId: 'J1' })
    const first = project.opcUa.mappings[0]!.leaves[0]!
    ;(first as unknown as { leafPath: readonly string[] }).leafPath = ['first-scalar']
    ;(project.opcUa.mappings[0]!.leaves as unknown as unknown[]).push({ ...first, leafPath: ['second-scalar'] })
    expect(() => validateWorkcellProjectV5(project)).toThrow('OPCUA_SCALAR_MAPPING_LEAF_COUNT_INVALID')
  })

  it('requires all six Frame destination paths and authored OPC UA ownership', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.robots[0]!.frameSources as unknown as Record<string, unknown>).Base = 'opcua:endpoint-1'
    ;(project.opcUa.mappings[0] as unknown as Record<string, unknown>).leaves = [
      ['positionM', 0], ['positionM', 1], ['positionM', 2],
      ['rpyDegrees', 0], ['rpyDegrees', 1], ['rpyDegrees', 2],
    ].map((projectPath, index) => ({
      ...project.opcUa.mappings[0]!.leaves[0],
      leafPath: [index],
      projectPath,
      projectTarget: { type: 'robot-frame', robotId: 'robot-1', frameId: 'Base' },
      opcUaDataType: 'Double',
      projectDataType: 'number',
    }))
    expect(() => validateWorkcellProjectV5(project)).not.toThrow()

    ;(project.robots[0]!.frameSources as unknown as Record<string, unknown>).Base = 'simulation'
    expect(() => validateWorkcellProjectV5(project)).toThrow('OPCUA_OWNERSHIP_MISMATCH')
  })

  it('validates Logical Signal Mapping types, direction, and scale', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.opcUa.mappings[0]!.leaves[0] as unknown as { scale: number }).scale = 2
    expect(() => validateWorkcellProjectV5(project)).toThrow('OPCUA_SCALE_NOT_APPLICABLE')

    const direction = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(direction.opcUa.mappings[0] as unknown as { direction: string }).direction = 'write'
    expect(() => validateWorkcellProjectV5(direction)).toThrow('OPCUA_SIGNAL_DIRECTION_MISMATCH')
  })

  it('rejects duplicate endpoint Node and leaf channels and Bridge Mapping cycles', () => {
    const duplicate = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(duplicate.opcUa.mappings as unknown as unknown[]).push({
      ...duplicate.opcUa.mappings[0],
      id: 'mapping-2',
    })
    expect(() => validateWorkcellProjectV5(duplicate)).toThrow('OPCUA_CHANNEL_DUPLICATE')

    const bridge = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(bridge.logicalSignals as unknown as unknown[]).push({
      id: 'OtherSignal', name: 'Other Signal', dataType: 'Boolean', direction: 'input', initialValue: false, unit: '', scope: { type: 'project' },
    })
    ;(bridge.opcUa.mappings as unknown as unknown[]).push({
      ...bridge.opcUa.mappings[0],
      id: 'mapping-2',
      nodeAddress: {
        namespaceUri: 'urn:sample:plc', identifierType: 'string', identifier: 'Signals.Other',
      },
      leaves: [{
        ...bridge.opcUa.mappings[0]!.leaves[0],
        projectTarget: { type: 'logical-signal', signalId: 'OtherSignal' },
      }],
    })
    ;(bridge.opcUa.bridgeRoutes as unknown as unknown[]).push(
      { id: 'route-1', sourceMappingId: 'mapping-1', destinationMappingId: 'mapping-2', direction: 'forward', scale: 1, offset: 0, unit: '' },
      { id: 'route-2', sourceMappingId: 'mapping-2', destinationMappingId: 'mapping-1', direction: 'forward', scale: 1, offset: 0, unit: '' },
    )
    expect(() => validateWorkcellProjectV5(bridge)).toThrow('BRIDGE_ROUTE_CYCLE')
  })

  it('keeps colon-bearing Robot and Joint targets structurally distinct', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    const firstDefinition = project.robotDefinitions[0] as unknown as Record<string, unknown>
    firstDefinition.id = 'definition-colon-1'
    ;(firstDefinition.joints as Array<Record<string, unknown>>)[0]!.id = 'x'
    const firstRobot = project.robots[0] as unknown as Record<string, unknown>
    firstRobot.id = 'robot:joint'
    firstRobot.definitionId = 'definition-colon-1'
    firstRobot.initialJointValues = { x: 0 }
    firstRobot.jointSource = 'opcua:endpoint-1'
    ;(project.jobs[0] as unknown as Record<string, unknown>).robotId = 'robot:joint'
    ;((project.jobs[0] as unknown as { instructions: Array<Record<string, unknown>> }).instructions[0]!).jointValues = { x: 0 }

    const secondDefinition = structuredClone(firstDefinition)
    secondDefinition.id = 'definition-colon-2'
    ;(secondDefinition.joints as Array<Record<string, unknown>>)[0]!.id = 'joint:x'
    ;(project.robotDefinitions as unknown as unknown[]).push(secondDefinition)
    const secondRobot = structuredClone(firstRobot)
    secondRobot.id = 'robot'
    secondRobot.definitionId = 'definition-colon-2'
    secondRobot.initialJointValues = { 'joint:x': 0 }
    ;(project.robots as unknown as unknown[]).push(secondRobot)

    setMappings(project, [
      mappingFor('mapping-colon-a', 'endpoint-1', 'Robot.A', [numericLeaf({ type: 'robot-joint', robotId: 'robot:joint', jointId: 'x' })]),
      mappingFor('mapping-colon-b', 'endpoint-1', 'Robot.B', [numericLeaf({ type: 'robot-joint', robotId: 'robot', jointId: 'joint:x' })]),
    ])
    expect(() => validateWorkcellProjectV5(project)).not.toThrow()
  })

  it('rejects colon-colliding Robot targets mixed inside one Mapping', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    const firstDefinition = project.robotDefinitions[0] as unknown as Record<string, unknown>
    firstDefinition.id = 'definition-colon-1'
    ;(firstDefinition.joints as Array<Record<string, unknown>>)[0]!.id = 'x'
    const firstRobot = project.robots[0] as unknown as Record<string, unknown>
    firstRobot.id = 'robot:joint'
    firstRobot.definitionId = 'definition-colon-1'
    firstRobot.initialJointValues = { x: 0 }
    firstRobot.jointSource = 'opcua:endpoint-1'
    ;(project.jobs[0] as unknown as Record<string, unknown>).robotId = 'robot:joint'
    ;((project.jobs[0] as unknown as { instructions: Array<Record<string, unknown>> }).instructions[0]!).jointValues = { x: 0 }
    const secondDefinition = structuredClone(firstDefinition)
    secondDefinition.id = 'definition-colon-2'
    ;(secondDefinition.joints as Array<Record<string, unknown>>)[0]!.id = 'joint:x'
    ;(project.robotDefinitions as unknown as unknown[]).push(secondDefinition)
    const secondRobot = structuredClone(firstRobot)
    secondRobot.id = 'robot'
    secondRobot.definitionId = 'definition-colon-2'
    secondRobot.initialJointValues = { 'joint:x': 0 }
    secondRobot.jointSource = 'opcua:endpoint-1'
    ;(project.robots as unknown as unknown[]).push(secondRobot)
    setMappings(project, [mappingFor('mapping-colon', 'endpoint-1', 'Robot.Mixed', [
      numericLeaf({ type: 'robot-joint', robotId: 'robot:joint', jointId: 'x' }, [0]),
      numericLeaf({ type: 'robot-joint', robotId: 'robot', jointId: 'joint:x' }, [1]),
    ])])
    expect(() => validateWorkcellProjectV5(project)).toThrow('OPCUA_MAPPING_TARGET_MISMATCH')
  })

  it('keeps colon-bearing Entity and Frame targets structurally distinct', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    setRecords(project, 'spatialEntities', [
      entity('entity:frame', 'x', 'opcua:endpoint-1'),
      entity('entity', 'frame:x', 'opcua:endpoint-1'),
    ])
    setMappings(project, [
      mappingFor('mapping-entity-a', 'endpoint-1', 'Entity.A', frameLeaves({ type: 'entity-frame', entityId: 'entity:frame', frameId: 'x' })),
      mappingFor('mapping-entity-b', 'endpoint-1', 'Entity.B', frameLeaves({ type: 'entity-frame', entityId: 'entity', frameId: 'frame:x' })),
    ])
    expect(() => validateWorkcellProjectV5(project)).not.toThrow()
  })

  it('rejects colon-colliding Entity targets mixed inside one Mapping', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    setRecords(project, 'spatialEntities', [
      entity('entity:frame', 'x', 'opcua:endpoint-1'),
      entity('entity', 'frame:x', 'opcua:endpoint-1'),
    ])
    const leaves = frameLeaves({ type: 'entity-frame', entityId: 'entity:frame', frameId: 'x' })
    leaves[5]!.projectTarget = { type: 'entity-frame', entityId: 'entity', frameId: 'frame:x' }
    setMappings(project, [mappingFor('mapping-entity-mixed', 'endpoint-1', 'Entity.Mixed', leaves)])
    expect(() => validateWorkcellProjectV5(project)).toThrow('OPCUA_MAPPING_TARGET_MISMATCH')
  })

  it.each([
    [1_024, 1_025],
  ])('counts Definition Frames before cross-reference maps at %i and %i', (exact, plusOne) => {
    expect(() => validateWorkcellProjectV5(projectWithDefinitionFrameCount(exact))).not.toThrow()
    expect(() => validateWorkcellProjectV5(projectWithDefinitionFrameCount(plusOne)))
      .toThrow('PROJECT_FRAME_LIMIT_EXCEEDED')
  })

  it.each([
    ['robot-joint', 'Boolean', 'boolean'],
    ['robot-frame', 'Boolean', 'boolean'],
    ['robot-status', 'Boolean', 'boolean'],
    ['entity-frame', 'Boolean', 'boolean'],
    ['entity-status', 'Boolean', 'boolean'],
    ['robot-joint', 'String', 'string'],
    ['robot-frame', 'String', 'string'],
    ['robot-status', 'String', 'string'],
    ['entity-frame', 'String', 'string'],
    ['entity-status', 'String', 'string'],
  ] as const)('rejects %s/%s Mapping values for numeric targets', (kind, opcUaDataType, projectDataType) => {
    let project: WorkcellProjectV5
    if (kind === 'robot-joint') {
      project = projectWithRobotJointTarget({ type: kind, robotId: 'robot-1', jointId: 'J1' })
      ;(project.opcUa.mappings[0]!.leaves[0] as unknown as Record<string, unknown>).opcUaDataType = opcUaDataType
      ;(project.opcUa.mappings[0]!.leaves[0] as unknown as Record<string, unknown>).projectDataType = projectDataType
    } else if (kind === 'robot-frame') {
      project = projectWithRobotFrameTarget({ type: kind, robotId: 'robot-1', frameId: 'Base' })
      for (const leaf of project.opcUa.mappings[0]!.leaves) {
        ;(leaf as unknown as Record<string, unknown>).opcUaDataType = opcUaDataType
        ;(leaf as unknown as Record<string, unknown>).projectDataType = projectDataType
      }
    } else if (kind === 'robot-status') {
      project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
      ;(project.robots[0]!.numericStatus as unknown as { sourceOwnership: string }).sourceOwnership = 'opcua:endpoint-1'
      setMappings(project, [mappingFor('mapping-status', 'endpoint-1', 'Robot.Status', [numericLeaf({ type: kind, robotId: 'robot-1' }, [], [], opcUaDataType, projectDataType)])])
    } else if (kind === 'entity-frame') {
      project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
      setRecords(project, 'spatialEntities', [entity('entity-1', 'frame-1', 'opcua:endpoint-1')])
      ;(project.opcUa.mappings as unknown as unknown[])[0] = mappingFor(
        'mapping-entity-frame',
        'endpoint-1',
        'Entity.Frame',
        frameLeaves({ type: kind, entityId: 'entity-1', frameId: 'frame-1' }, opcUaDataType, projectDataType),
      )
    } else {
      project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
      setRecords(project, 'spatialEntities', [entity('entity-1', 'frame-1', 'opcua:endpoint-1')])
      setMappings(project, [mappingFor('mapping-entity-status', 'endpoint-1', 'Entity.Status', [numericLeaf({ type: kind, entityId: 'entity-1' }, [], [], opcUaDataType, projectDataType)])])
    }
    expect(() => validateWorkcellProjectV5(project)).toThrow('OPCUA_DATA_TYPE_MISMATCH')
  })

  it('rejects signed zero in leaf and Project numeric path components', () => {
    const leafPath = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(leafPath.opcUa.mappings[0]!.leaves[0] as unknown as Record<string, unknown>).leafPath = [-0]
    expect(() => validateWorkcellProjectV5(leafPath)).toThrowError(expect.objectContaining({
      code: 'OPCUA_PATH_INVALID', path: '$.opcUa.mappings[0].leaves[0].leafPath[0]',
    }))

    const projectPath = projectWithRobotFrameTarget({ type: 'robot-frame', robotId: 'robot-1', frameId: 'Base' })
    ;(projectPath.opcUa.mappings[0]!.leaves[0] as unknown as Record<string, unknown>).projectPath = ['positionM', -0]
    expect(() => validateWorkcellProjectV5(projectPath)).toThrowError(expect.objectContaining({
      code: 'OPCUA_PATH_INVALID', path: '$.opcUa.mappings[0].leaves[0].projectPath[1]',
    }))
  })

  it('reports duplicate Endpoint and Entity Frame keys at their actual fields', () => {
    const endpoint = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    appendEndpoint(endpoint, 'endpoint-1')
    expect(() => validateWorkcellProjectV5(endpoint)).toThrowError(expect.objectContaining({
      code: 'PROJECT_ID_DUPLICATE', path: '$.opcUa.endpoints[1].endpointId',
    }))

    const frame = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    const duplicateFrameEntity = entity('entity-1', 'frame-1')
    ;(duplicateFrameEntity.movingFrames as unknown as unknown[]).push({
      ...(duplicateFrameEntity.movingFrames as Array<Record<string, unknown>>)[0],
    })
    setRecords(frame, 'spatialEntities', [duplicateFrameEntity])
    expect(() => validateWorkcellProjectV5(frame)).toThrowError(expect.objectContaining({
      code: 'PROJECT_ID_DUPLICATE', path: '$.spatialEntities[0].movingFrames[1].frameId',
    }))
  })

  it.each([
    ['endpoints', 8, 9, 'OPCUA_ENDPOINT_LIMIT_EXCEEDED'],
    ['endpointRoots', 64, 65, 'OPCUA_ENDPOINT_STRUCTURE_ROOT_LIMIT_EXCEEDED'],
    ['leavesPerRoot', 32, 33, 'OPCUA_STRUCTURE_LEAF_LIMIT_EXCEEDED'],
    ['pathDepth', 4, 5, 'OPCUA_STRUCTURE_DEPTH_LIMIT_EXCEEDED'],
    ['fixedArrayElements', 256, 257, 'OPCUA_FIXED_ARRAY_LIMIT_EXCEEDED'],
  ] as const)('enforces %s exact and plus-one limits', (field, exact, plusOne, code) => {
    const projectAt = (count: number): WorkcellProjectV5 => {
      if (field === 'endpoints') {
        const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
        for (let index = 2; index <= count; index += 1) appendEndpoint(project, `endpoint-${index}`)
        return project
      }
      if (field === 'endpointRoots') return projectWithEndpointRoots(count)
      if (field === 'leavesPerRoot') {
        const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
        setMappings(project, [logicalMapping('mapping-leaves', 'endpoint-1', 'PartPresent', Array.from({ length: count }, (_, index) => [index]))])
        return project
      }
      if (field === 'pathDepth') {
        const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
        setMappings(project, [logicalMapping('mapping-depth', 'endpoint-1', 'PartPresent', [Array.from({ length: count }, (_, index) => `field-${index}`)])])
        return project
      }
      const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
      setMappings(project, [logicalMapping('mapping-array', 'endpoint-1', 'PartPresent', [[count - 1]])])
      return project
    }
    expect(() => validateWorkcellProjectV5(projectAt(exact))).not.toThrow()
    expect(() => validateWorkcellProjectV5(projectAt(plusOne))).toThrow(code)
  })

  it('accepts the exact active update rate, rejects plus one, and ignores disabled Mapping owners', () => {
    const exact = projectV5AtLimit('opcUaLeaves', 512)
    ;(exact.opcUa.endpoints[0] as unknown as { publishingIntervalMs: number }).publishingIntervalMs = 50
    expect(() => validateWorkcellProjectV5(exact)).not.toThrow()

    const plusOne = cloneWorkcellProjectV5(exact)
    appendEndpoint(plusOne, 'endpoint-2', true, 1_000)
    ;(plusOne.logicalSignals as unknown as unknown[]).push(inputSignal('RateExtra'))
    ;(plusOne.opcUa.mappings as unknown as unknown[]).push(logicalMapping('mapping-rate-extra', 'endpoint-2', 'RateExtra'))
    expect(() => validateWorkcellProjectV5(plusOne)).toThrow('OPCUA_UPDATE_RATE_LIMIT_EXCEEDED')

    const disabled = cloneWorkcellProjectV5(exact)
    appendEndpoint(disabled, 'endpoint-2', false, 50)
    ;(disabled.opcUa.mappings as unknown as unknown[]).push(logicalMapping('mapping-disabled', 'endpoint-2', 'PartPresent'))
    expect(() => validateWorkcellProjectV5(disabled)).not.toThrow()
  })

  it('enforces readWrite target ownership exactly like read ownership', () => {
    const mismatch = projectWithRobotJointTarget({ type: 'robot-joint', robotId: 'robot-1', jointId: 'J1' }, 'readWrite')
    ;(mismatch.robots[0] as unknown as { jointSource: string }).jointSource = 'simulation'
    expect(() => validateWorkcellProjectV5(mismatch)).toThrow('OPCUA_OWNERSHIP_MISMATCH')

    const matching = projectWithRobotJointTarget({ type: 'robot-joint', robotId: 'robot-1', jointId: 'J1' }, 'readWrite')
    expect(() => validateWorkcellProjectV5(matching)).not.toThrow()
  })
})
