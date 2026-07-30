import { describe, expect, it } from 'vitest'

import { ProjectV5Error } from './errors'
import { validateLogicalSignalValueV1 } from './logical-signal'
import type { RobotMechanicsMetadataV1 } from './types'
import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from './test-support'
import { validateWorkcellProjectV5 } from './validate'

describe('Project V5 aggregate shape validation', () => {
  function projectWithEntity(): ReturnType<typeof makeMinimalWorkcellProjectV5> {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.spatialEntities as unknown as Array<Record<string, unknown>>).push({
      id: 'box',
      name: 'Box',
      geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#808080' },
      parentFrameId: 'world',
      localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      visible: true,
      groupId: null,
      removable: true,
      transformOwner: 'manual',
      numericStatus: { value: 0, sourceOwnership: 'manual', overlay: { visible: false, frameId: null } },
      graspable: false,
      graspFrames: [],
      movingFrames: [],
    })
    return project
  }

  it('accepts optional Object communications metadata and rejects wrong field types', () => {
    const omitted = projectWithEntity()
    expect(validateWorkcellProjectV5(omitted).spatialEntities[0]).toMatchObject({ id: 'box' })

    const explicit = projectWithEntity()
    Object.assign(explicit.spatialEntities[0] as unknown as Record<string, unknown>, {
      enableComms: true,
      tagName: '',
    })
    expect(validateWorkcellProjectV5(explicit).spatialEntities[0]).toMatchObject({
      enableComms: true,
      tagName: '',
    })

    const wrongEnabled = projectWithEntity()
    ;(wrongEnabled.spatialEntities[0] as unknown as Record<string, unknown>).enableComms = 'true'
    expect(() => validateWorkcellProjectV5(wrongEnabled)).toThrowError(
      expect.objectContaining({ path: '$.spatialEntities[0].enableComms' }),
    )

    const wrongTag = projectWithEntity()
    ;(wrongTag.spatialEntities[0] as unknown as Record<string, unknown>).tagName = 42
    expect(() => validateWorkcellProjectV5(wrongTag)).toThrowError(
      expect.objectContaining({ path: '$.spatialEntities[0].tagName' }),
    )
  })

  function projectWithMechanics(mechanics: RobotMechanicsMetadataV1 | Record<string, unknown>): unknown {
    const project = makeMinimalWorkcellProjectV5()
    const definition = project.robotDefinitions[0]!
    return {
      ...project,
      robotDefinitions: [{ ...definition, mechanics }],
    }
  }

  it('accepts confirmed manifest mechanics and rejects unknown provenance fields', () => {
    const mechanics: RobotMechanicsMetadataV1 = {
      schemaVersion: 1,
      status: 'confirmed',
      sourceKind: 'manifest',
      sourceName: 'ned2.robot.json',
      calibrationRevision: 'ned2-r1',
    }
    expect(validateWorkcellProjectV5(projectWithMechanics(mechanics))).toBeDefined()
    expect(() => validateWorkcellProjectV5(projectWithMechanics({
      ...mechanics,
      unexpected: true,
    }))).toThrow(/closed|unexpected/i)
  })

  it('rejects an empty calibration revision', () => {
    const project = projectWithMechanics({
      schemaVersion: 1,
      status: 'estimated',
      sourceKind: 'step-estimate',
      sourceName: 'robot.step',
      calibrationRevision: '',
    })
    expect(() => validateWorkcellProjectV5(project)).toThrow(/calibrationRevision/)
  })

  it.each([1, 2, 3, 4])('rejects schema V%i without conversion', (schemaVersion) => {
    expect(() => validateWorkcellProjectV5({ schemaVersion })).toThrowError(
      expect.objectContaining({ code: 'PROJECT_SCHEMA_UNSUPPORTED', path: '$.schemaVersion' }),
    )
  })

  it('requires separate Robot and Controller identification', () => {
    const project = makeMinimalWorkcellProjectV5()

    expect(project.robotDefinitions[0]!.identification).toMatchObject({
      manufacturer: 'ABB',
      model: 'CRB15000-12/1.27',
      productCode: 'CRB15000-12/1.27',
      serialNumberTemplate: null,
      motionDeviceCategory: 'ARTICULATED_ROBOT',
    })
    expect(project.controllers[0]!.identification.serialNumber).toBe('CTRL-SAMPLE-001')
    expect(project.robots[0]!.serialNumber).toBe('ROBOT-SAMPLE-001')
  })

  it('rejects persisted Signal runtime fields', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.logicalSignals[0] as unknown as Record<string, unknown>).quality = 'GOOD'

    expect(() => validateWorkcellProjectV5(project)).toThrowError(
      expect.objectContaining({ code: 'PROJECT_RECORD_NOT_CLOSED', path: '$.logicalSignals[0]' }),
    )
  })

  it('rejects accessors, symbols, sparse arrays, and custom prototypes before reading them', () => {
    const project = makeMinimalWorkcellProjectV5()
    const accessorProject = cloneWorkcellProjectV5(project)
    let accessorRead = false
    Object.defineProperty(accessorProject.metadata, 'name', {
      configurable: true,
      enumerable: true,
      get: () => {
        accessorRead = true
        return 'not read'
      },
    })
    expect(() => validateWorkcellProjectV5(accessorProject)).toThrowError(
      expect.objectContaining({ code: 'PROJECT_RECORD_NOT_CLOSED', path: '$.metadata' }),
    )
    expect(accessorRead).toBe(false)

    const symbolProject = cloneWorkcellProjectV5(project)
    Object.defineProperty(symbolProject.scene, Symbol('runtime'), {
      configurable: true,
      enumerable: true,
      value: true,
    })
    expect(() => validateWorkcellProjectV5(symbolProject)).toThrow('PROJECT_RECORD_NOT_CLOSED')

    const sparseProject = cloneWorkcellProjectV5(project)
    const sparseSignals: unknown[] = []
    sparseSignals.length = 1
    ;(sparseProject as unknown as Record<string, unknown>).logicalSignals = sparseSignals
    expect(() => validateWorkcellProjectV5(sparseProject)).toThrowError(
      expect.objectContaining({ code: 'PROJECT_ARRAY_NOT_DENSE', path: '$.logicalSignals' }),
    )

    const prototypeProject = cloneWorkcellProjectV5(project)
    Object.setPrototypeOf(prototypeProject.opcUa.endpoints, Object.create(Array.prototype))
    expect(() => validateWorkcellProjectV5(prototypeProject)).toThrowError(
      expect.objectContaining({ code: 'PROJECT_ARRAY_PROTOTYPE_INVALID', path: '$.opcUa.endpoints' }),
    )
  })

  it('rejects unknown fields in every tagged instruction and target shape', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    const instruction = project.jobs[0]!.instructions[0] as unknown as Record<string, unknown>
    instruction.runtimeProgress = 50
    expect(() => validateWorkcellProjectV5(project)).toThrowError(
      expect.objectContaining({ code: 'PROJECT_RECORD_NOT_CLOSED', path: '$.jobs[0].instructions[0]' }),
    )

    const targetProject = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    const leaf = targetProject.opcUa.mappings[0]!.leaves[0]!
    ;(leaf.projectTarget as unknown as Record<string, unknown>).sourceTimestamp = 'runtime-only'
    expect(() => validateWorkcellProjectV5(targetProject)).toThrowError(
      expect.objectContaining({
        code: 'PROJECT_RECORD_NOT_CLOSED',
        path: '$.opcUa.mappings[0].leaves[0].projectTarget',
      }),
    )
  })

  it('enforces logical scalar type, finite values, and scalar bounds', () => {
    expect(validateLogicalSignalValueV1('Boolean', true, '$.value')).toBe(true)
    expect(validateLogicalSignalValueV1('Int32', -2_147_483_648, '$.value')).toBe(-2_147_483_648)
    expect(validateLogicalSignalValueV1('UInt32', 4_294_967_295, '$.value')).toBe(4_294_967_295)
    expect(validateLogicalSignalValueV1('Double', 1.5, '$.value')).toBe(1.5)
    expect(validateLogicalSignalValueV1('String', 'ok', '$.value')).toBe('ok')
    expect(() => validateLogicalSignalValueV1('Int32', 2_147_483_648, '$.value')).toThrowError(
      expect.objectContaining({ code: 'LOGICAL_SIGNAL_VALUE_TYPE_MISMATCH', path: '$.value' }),
    )
    expect(() => validateLogicalSignalValueV1('UInt32', -1, '$.value')).toThrow('LOGICAL_SIGNAL_VALUE_TYPE_MISMATCH')
    expect(() => validateLogicalSignalValueV1('Double', Number.NaN, '$.value')).toThrow('LOGICAL_SIGNAL_VALUE_TYPE_MISMATCH')
    expect(() => validateLogicalSignalValueV1('String', 'a'.repeat(4_097), '$.value')).toThrow(
      'LOGICAL_SIGNAL_VALUE_TYPE_MISMATCH',
    )

    const nonFiniteProject = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(nonFiniteProject.opcUa.mappings[0]!.leaves[0] as unknown as Record<string, unknown>).scale = Number.POSITIVE_INFINITY
    expect(() => validateWorkcellProjectV5(nonFiniteProject)).toThrowError(
      expect.objectContaining({ code: 'PROJECT_NUMBER_NOT_FINITE', path: '$.opcUa.mappings[0].leaves[0].scale' }),
    )
  })

  it('returns a deeply frozen clone without freezing or retaining caller data', () => {
    const callerProject = makeMinimalWorkcellProjectV5()
    const project = validateWorkcellProjectV5(callerProject)

    expect(project).not.toBe(callerProject)
    expect(project.metadata).not.toBe(callerProject.metadata)
    expect(project.logicalSignals[0]).not.toBe(callerProject.logicalSignals[0])
    expect(Object.isFrozen(project)).toBe(true)
    expect(Object.isFrozen(project.opcUa.mappings[0]!.leaves[0]!.projectTarget)).toBe(true)
    expect(Object.isFrozen(callerProject)).toBe(false)
    expect(Object.isFrozen(callerProject.metadata)).toBe(false)
  })

  it('passes closed shapes to the cross-reference validator', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.robots[0] as unknown as Record<string, unknown>).controllerId = 'not-checked-yet'
    ;(project.jobs[0] as unknown as Record<string, unknown>).robotId = 'not-checked-yet'

    expect(() => validateWorkcellProjectV5(project)).toThrowError(
      expect.objectContaining({ code: 'ROBOT_CONTROLLER_NOT_FOUND', path: '$.robots[0].controllerId' }),
    )
  })

  it('always reports the shared ProjectV5Error contract', () => {
    expect(() => validateWorkcellProjectV5(null)).toThrow(ProjectV5Error)
  })
})
