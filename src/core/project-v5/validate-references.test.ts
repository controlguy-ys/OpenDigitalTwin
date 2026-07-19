import { describe, expect, it } from 'vitest'

import { validateWorkcellProjectV5 } from './validate.js'
import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
  projectV5AtLimit,
  projectWithInstructionSignalV5,
  projectWithMissingMoveJointV5,
} from './test-support.js'

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
})
