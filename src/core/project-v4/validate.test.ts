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

  it('always reports the shared ProjectV4Error contract', () => {
    expect(() => validateWorkcellProjectV4(null)).toThrow(ProjectV4Error)
  })
})
