import { describe, expect, it } from 'vitest'

import { ProjectV4Error } from './errors'
import {
  makeMinimalWorkcellProjectV4,
  projectAtLimit,
  projectWithDuplicateTopLevelId,
  projectWithExtraRootKey,
  projectWithFrameCycle,
  projectWithMissingDefinition,
  projectWithSparseRobots,
  projectWithVisibleTriangleCount,
  type ProjectLimitFieldV4,
} from './test-support'
import {
  preflightWorkcellProjectShapeV4,
  validateWorkcellProjectV4,
} from './validate'
import type { OpcUaDataTypeV4, ProjectScalarDataTypeV4, WorkcellProjectV4 } from './types'

function projectWithScalarMapping(
  opcUaDataType: OpcUaDataTypeV4,
  projectDataType: ProjectScalarDataTypeV4,
): WorkcellProjectV4 {
  const project = makeMinimalWorkcellProjectV4()
  return {
    ...project,
    opcUa: {
      mode: 'client',
      endpoints: [{
        endpointId: 'endpoint-1',
        name: 'Controller',
        endpointUrl: 'opc.tcp://localhost:4840',
        enabled: true,
        publishingIntervalMs: 100,
        reconnectDelayMs: 1_000,
      }],
      mappings: [{
        id: 'mapping-1',
        endpointId: 'endpoint-1',
        direction: 'read',
        coherenceGroupId: null,
        sourceOwnership: 'opcua:endpoint-1',
        interpolationMode: 'none',
        coordinateConvention: 'project-v4-z-up-metres-quaternion-xyzw',
        leaves: [{
          leafPath: [],
          nodeId: 'ns=2;s=Joint1',
          projectTarget: { type: 'robot-joint', robotId: 'robot-1', jointId: 'J1' },
          opcUaDataType,
          projectDataType,
          scale: 1,
          offset: 0,
          unit: 'degree',
          required: true,
        }],
      }],
      actionBindings: [],
      bridgeRoutes: [],
    },
  }
}

function projectWithLeafPaths(
  leafPaths: readonly (readonly (string | number)[])[],
): WorkcellProjectV4 {
  const project = projectWithScalarMapping('Double', 'number')
  const mapping = project.opcUa.mappings[0]!
  const leaf = mapping.leaves[0]!
  return {
    ...project,
    opcUa: {
      ...project.opcUa,
      mappings: [{
        ...mapping,
        leaves: leafPaths.map((leafPath, index) => ({
          ...leaf,
          leafPath,
          nodeId: `ns=2;s=Leaf${index}`,
        })),
      }],
    },
  }
}

describe('Project V4 aggregate validation', () => {
  it.each([
    ['robots', 8, 9, 'ROBOT_INSTANCE_LIMIT_EXCEEDED'],
    ['robotDefinitions', 8, 9, 'ROBOT_DEFINITION_LIMIT_EXCEEDED'],
    ['joints', 16, 17, 'ROBOT_JOINT_LIMIT_EXCEEDED'],
    ['robotSources', 7, 8, 'ROBOT_STEP_SOURCE_LIMIT_EXCEEDED'],
    ['spatialEntities', 256, 257, 'SPATIAL_ENTITY_LIMIT_EXCEEDED'],
    ['sceneGroups', 256, 257, 'SCENE_GROUP_LIMIT_EXCEEDED'],
    ['movingFramesPerEntity', 32, 33, 'MOVING_FRAME_LIMIT_EXCEEDED'],
    ['totalFrames', 1_024, 1_025, 'PROJECT_FRAME_LIMIT_EXCEEDED'],
    ['actions', 256, 257, 'ACTION_LIMIT_EXCEEDED'],
  ] satisfies readonly [ProjectLimitFieldV4, number, number, string][])(
    '%s accepts %i and rejects %i',
    (field, exact, plusOne, code) => {
      expect(() => validateWorkcellProjectV4(projectAtLimit(field, exact))).not.toThrow()
      expect(() => validateWorkcellProjectV4(projectAtLimit(field, plusOne))).toThrow(code)
    },
  )

  it('rejects every dangling reference and frame cycle before returning a project', () => {
    expect(() => validateWorkcellProjectV4(projectWithMissingDefinition())).toThrow(
      'ROBOT_DEFINITION_NOT_FOUND',
    )
    expect(() => validateWorkcellProjectV4(projectWithFrameCycle())).toThrow('FRAME_CYCLE')
  })

  it.each([1, 2, 3])('rejects schema %i without migration', (schemaVersion) => {
    expect(() => validateWorkcellProjectV4({ schemaVersion })).toThrowError(
      expect.objectContaining({ code: 'PROJECT_SCHEMA_UNSUPPORTED' }),
    )
  })

  it('rejects extra keys, sparse arrays, and duplicate top-level IDs', () => {
    expect(() => preflightWorkcellProjectShapeV4(projectWithExtraRootKey())).toThrowError(
      expect.objectContaining({ code: 'PROJECT_RECORD_NOT_CLOSED', path: '$' }),
    )
    expect(() => preflightWorkcellProjectShapeV4(projectWithSparseRobots())).toThrowError(
      expect.objectContaining({ code: 'PROJECT_ARRAY_NOT_DENSE', path: '$.robots' }),
    )
    expect(() => validateWorkcellProjectV4(projectWithDuplicateTopLevelId())).toThrowError(
      expect.objectContaining({ code: 'PROJECT_ID_DUPLICATE' }),
    )
  })

  it('accepts the exact visible-triangle budget and rejects plus one', () => {
    expect(() => validateWorkcellProjectV4(projectWithVisibleTriangleCount(1_500_000))).not.toThrow()
    expect(() => validateWorkcellProjectV4(projectWithVisibleTriangleCount(1_500_001))).toThrow(
      'VISIBLE_SCENE_TRIANGLE_LIMIT_EXCEEDED',
    )
  })

  it('returns a deeply frozen normalized clone without freezing caller data', () => {
    const callerProject = makeMinimalWorkcellProjectV4({ scaledTransforms: true })
    const project = validateWorkcellProjectV4(callerProject)

    expect(project).not.toBe(callerProject)
    expect(project.metadata).not.toBe(callerProject.metadata)
    expect(project.robotDefinitions[0]?.joints[0]?.origin.quaternion).toEqual([0, 0, 0, 1])
    expect(Object.isFrozen(project)).toBe(true)
    expect(Object.isFrozen(project.robotDefinitions)).toBe(true)
    expect(Object.isFrozen(project.robotDefinitions[0]?.joints[0]?.origin)).toBe(true)
    expect(Object.isFrozen(callerProject)).toBe(false)
    expect(Object.isFrozen(callerProject.metadata)).toBe(false)
  })

  it('allows reusable definitions to share local IDs while keeping top-level IDs distinct', () => {
    const project = projectAtLimit('robotDefinitions', 2)

    expect(project.robotDefinitions[0]?.joints[0]?.id).toBe('J1')
    expect(project.robotDefinitions[1]?.joints[0]?.id).toBe('J1')
    expect(() => validateWorkcellProjectV4(project)).not.toThrow()
  })

  it('rejects an OPC UA scalar type that cannot produce the declared Project scalar type', () => {
    expect(() => validateWorkcellProjectV4(projectWithScalarMapping('Boolean', 'boolean'))).not.toThrow()
    expect(() => validateWorkcellProjectV4(projectWithScalarMapping('Boolean', 'number'))).toThrowError(
      expect.objectContaining({ code: 'OPCUA_DATA_TYPE_MISMATCH' }),
    )
  })

  it('rejects a second Mapping that aliases one Node across State and Command channels', () => {
    const project = projectWithScalarMapping('Double', 'number')
    const firstMapping = project.opcUa.mappings[0]!
    const aliasedProject: WorkcellProjectV4 = {
      ...project,
      opcUa: {
        ...project.opcUa,
        mappings: [firstMapping, { ...firstMapping, id: 'mapping-2', direction: 'readWrite' }],
      },
    }

    expect(() => validateWorkcellProjectV4(aliasedProject)).toThrowError(
      expect.objectContaining({ code: 'OPCUA_STATE_COMMAND_NODE_ALIAS' }),
    )
  })

  it('rejects an Action Binding that aliases a State Mapping endpoint and Node', () => {
    const project = projectWithScalarMapping('Boolean', 'boolean')
    const aliasedProject: WorkcellProjectV4 = {
      ...project,
      actions: [{
        id: 'action-1',
        kind: 'set-gripper-state',
        robotId: 'robot-1',
        state: 'OPEN',
      }],
      opcUa: {
        ...project.opcUa,
        actionBindings: [{
          id: 'binding-1',
          endpointId: 'endpoint-1',
          nodeId: 'ns=2;s=Joint1',
          kind: 'action-execute',
          actionId: 'action-1',
          triggerMode: 'boolean-rising-edge',
          integerCommandValue: null,
        }],
      },
    }

    expect(() => validateWorkcellProjectV4(aliasedProject)).toThrowError(
      expect.objectContaining({ code: 'OPCUA_STATE_COMMAND_NODE_ALIAS' }),
    )
  })

  it('rejects a multi-route static Bridge cycle', () => {
    const project = projectWithScalarMapping('Double', 'number')
    const firstMapping = project.opcUa.mappings[0]!
    const secondMapping = {
      ...firstMapping,
      id: 'mapping-2',
      leaves: firstMapping.leaves.map((leaf) => ({
        ...leaf,
        nodeId: 'ns=2;s=Joint2',
      })),
    }
    const cyclicProject: WorkcellProjectV4 = {
      ...project,
      opcUa: {
        ...project.opcUa,
        mode: 'bridge',
        mappings: [firstMapping, secondMapping],
        bridgeRoutes: [
          {
            id: 'route-1',
            sourceChannelId: 'mapping-1',
            destinationChannelId: 'mapping-2',
            direction: 'forward',
            scale: 1,
            offset: 0,
            unit: 'degree',
            sourceOwnership: 'client',
          },
          {
            id: 'route-2',
            sourceChannelId: 'mapping-2',
            destinationChannelId: 'mapping-1',
            direction: 'forward',
            scale: 1,
            offset: 0,
            unit: 'degree',
            sourceOwnership: 'server',
          },
        ],
      },
    }

    expect(() => validateWorkcellProjectV4(cyclicProject)).toThrowError(
      expect.objectContaining({ code: 'BRIDGE_ROUTE_CYCLE' }),
    )
  })

  it.each([
    ['scalar plus structure', [[], ['value']]],
    ['ancestor before descendant', [['pose'], ['pose', 'x']]],
    ['descendant before ancestor', [['pose', 'x'], ['pose']]],
    ['named and numeric children', [['pose', 'x'], ['pose', 0]]],
  ] as const)('rejects incoherent OPC leaf trees: %s', (_label, leafPaths) => {
    expect(() => validateWorkcellProjectV4(projectWithLeafPaths(leafPaths))).toThrowError(
      expect.objectContaining({ code: 'OPCUA_LEAF_PATH_TREE_INVALID' }),
    )
  })

  it('rejects an Array with a custom prototype without calling its inherited map', () => {
    const project = makeMinimalWorkcellProjectV4()
    const robots = [...project.robots]
    let inheritedMapCalled = false
    const customPrototype = Object.create(Array.prototype) as object
    Object.defineProperty(customPrototype, 'map', {
      configurable: true,
      value: () => {
        inheritedMapCalled = true
        return []
      },
    })
    Object.setPrototypeOf(robots, customPrototype)

    expect(() => validateWorkcellProjectV4({ ...project, robots })).toThrowError(
      expect.objectContaining({ code: 'PROJECT_ARRAY_PROTOTYPE_INVALID' }),
    )
    expect(inheritedMapCalled).toBe(false)
  })

  it('clones a valid __proto__ Joint key as an own property without prototype mutation', () => {
    const project = makeMinimalWorkcellProjectV4()
    const definition = project.robotDefinitions[0]!
    const robot = project.robots[0]!
    const initialJointValues: Record<string, number> = {}
    Object.defineProperty(initialJointValues, '__proto__', {
      configurable: true,
      enumerable: true,
      value: 0,
      writable: true,
    })
    const protoKeyProject: WorkcellProjectV4 = {
      ...project,
      robotDefinitions: [{
        ...definition,
        joints: [{ ...definition.joints[0]!, id: '__proto__' }],
      }],
      robots: [{ ...robot, initialJointValues }],
    }

    const validated = validateWorkcellProjectV4(protoKeyProject)
    const validatedJointValues = validated.robots[0]!.initialJointValues
    expect(Object.hasOwn(validatedJointValues, '__proto__')).toBe(true)
    expect(validatedJointValues.__proto__).toBe(0)
    expect(Object.getPrototypeOf(validatedJointValues)).toBe(Object.prototype)
  })

  it('always reports the shared ProjectV4Error contract', () => {
    expect(() => validateWorkcellProjectV4(null)).toThrow(ProjectV4Error)
  })
})
