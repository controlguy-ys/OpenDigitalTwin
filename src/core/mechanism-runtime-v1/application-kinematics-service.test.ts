import { describe, expect, it } from 'vitest'

import {
  createApplicationKinematicsServiceV1,
  createDefaultApplicationKinematicsServiceV1,
  type CompiledMechanismEvaluatorV1,
} from './application-kinematics-service.js'
import { MechanismErrorV1 } from './errors.js'
import { createSolverRegistryV1 } from './solver-registry.js'
import { makeOneRevoluteMechanismV1 } from './test-support.js'
import type { ForwardKinematicsRequestV1, ForwardKinematicsResultV1, KinematicsSolverV1, MechanismDefinitionV1, RigidTransformV1 } from './types.js'

const identityPose: RigidTransformV1 = Object.freeze({
  positionM: Object.freeze([0, 0, 0] as [number, number, number]),
  quaternion: Object.freeze([0, 0, 0, 1] as [number, number, number, number]),
})

function record<T>(entries: readonly (readonly [string, T])[]): Readonly<Record<string, T>> {
  const value = Object.create(null) as Record<string, T>
  for (const [key, entry] of entries) Object.defineProperty(value, key, { enumerable: true, value: entry })
  return Object.freeze(value)
}

function definition(): MechanismDefinitionV1 {
  const value: any = structuredClone(makeOneRevoluteMechanismV1())
  value.solverRef = { ...value.solverRef, solverKey: 'spy-fk', contractVersion: '2' }
  return value
}

function result(request: { readonly mechanismDefinition: MechanismDefinitionV1, readonly coordinatesByStableId: Readonly<Record<string, number>>, readonly requestedFrameIds?: readonly string[], readonly requestedMotionGroupId?: string }): ForwardKinematicsResultV1 {
  const definitionValue = request.mechanismDefinition
  const frameIds = request.requestedFrameIds ?? definitionValue.frames.map(({ frameId }) => frameId)
  const groups = request.requestedMotionGroupId === undefined
    ? definitionValue.motionGroups
    : definitionValue.motionGroups.filter(({ motionGroupId }) => motionGroupId === request.requestedMotionGroupId)
  return Object.freeze({
    solverKey: 'spy-fk',
    solverContractVersion: '2',
    normalizedCoordinates: request.coordinatesByStableId,
    bodyLocalPoses: record(definitionValue.bodies.map(({ bodyId }) => [bodyId, identityPose] as const)),
    bodyWorldPoses: record(definitionValue.bodies.map(({ bodyId }) => [bodyId, identityPose] as const)),
    frameWorldPoses: record(frameIds.map((frameId) => [frameId, identityPose] as const)),
    motionGroupEndFramePoses: record(groups.map((group) => [
      group.motionGroupId,
      record(group.endFrameIds.map((frameId) => [frameId, identityPose] as const)),
    ] as const)),
    warnings: Object.freeze([]),
  })
}

function spySolver(options: {
  readonly invalid?: boolean
  readonly alterResult?: (result: ForwardKinematicsResultV1) => ForwardKinematicsResultV1
  readonly duringValidation?: (definition: MechanismDefinitionV1) => void
  readonly beforeResult?: (request: ForwardKinematicsRequestV1) => void
} = {}): {
  readonly solver: KinematicsSolverV1
  readonly calls: { validate: number, normalize: number, evaluate: number, definition?: MechanismDefinitionV1, coordinates?: Readonly<Record<string, number>> }
} {
  const calls: { validate: number, normalize: number, evaluate: number, definition?: MechanismDefinitionV1, coordinates?: Readonly<Record<string, number>> } = {
    validate: 0, normalize: 0, evaluate: 0,
  }
  const solver: KinematicsSolverV1 = Object.freeze({
    solverKey: 'spy-fk',
    contractVersion: '2',
    describeCapabilities: () => Object.freeze({ topologyKinds: Object.freeze(['tree'] as const), jointTypes: Object.freeze(['revolute'] as const), deterministicForward: true, inverse: false, jacobian: false, constraintProjection: false }),
    validateDefinition: (definitionValue: MechanismDefinitionV1) => {
      calls.validate += 1
      options.duringValidation?.(definitionValue)
      return options.invalid
        ? Object.freeze({ valid: false, errors: Object.freeze([{ code: 'BODY_NOT_FOUND', path: '$.bodies[0]', message: 'Missing Body.' }]), warnings: Object.freeze([]) })
        : Object.freeze({ valid: true, errors: Object.freeze([]), warnings: Object.freeze([]) })
    },
    normalizeCoordinates: (_definition: MechanismDefinitionV1, coordinates: Readonly<Record<string, number>>) => {
      calls.normalize += 1
      return record<number>(Object.entries(coordinates).map(([key, value]) => [key, value === 0 ? 0 : value] as const))
    },
    evaluateForward: (request: ForwardKinematicsRequestV1) => {
      calls.evaluate += 1
      calls.definition = request.mechanismDefinition
      calls.coordinates = request.coordinatesByStableId
      options.beforeResult?.(request)
      const baseline = result(request)
      return options.alterResult?.(baseline) ?? baseline
    },
  })
  return { solver, calls }
}

describe('createApplicationKinematicsServiceV1', () => {
  it('compiles one exact Solver validation into a detached immutable forward evaluator', () => {
    const spy = spySolver()
    const source = definition()
    const service = createApplicationKinematicsServiceV1(createSolverRegistryV1([spy.solver]))

    const compiled: CompiledMechanismEvaluatorV1 = service.compile(source)
    ;(source as any).name = 'mutated after compilation'
    const evaluated = compiled.evaluateForward({ rootWorldPose: identityPose, coordinatesByStableId: { 'joint-1': -0 } })

    expect(spy.calls.validate).toBe(1)
    expect(spy.calls.normalize).toBe(1)
    expect(spy.calls.evaluate).toBe(1)
    expect(spy.calls.definition).toBe(compiled.definition)
    expect(spy.calls.coordinates).toEqual({ 'joint-1': 0 })
    expect(compiled.definition.name).toBe('Fixture mechanism')
    expect(Object.isFrozen(compiled.definition)).toBe(true)
    expect(compiled.solverKey).toBe('spy-fk')
    expect(compiled.solverContractVersion).toBe('2')
    expect(compiled.normalizedSolverParametersHash).toBe(source.solverRef.normalizedParametersHash)
    expect(evaluated.normalizedCoordinates).toEqual({ 'joint-1': 0 })
    expect('solveInverse' in service).toBe(false)
    expect('evaluateJacobian' in service).toBe(false)
    expect('projectConstraints' in service).toBe(false)
  })

  it('reports the Solver validation report first finding without evaluating', () => {
    const spy = spySolver({ invalid: true })
    const service = createApplicationKinematicsServiceV1(createSolverRegistryV1([spy.solver]))

    expect(() => service.compile(definition())).toThrow(expect.objectContaining({ code: 'BODY_NOT_FOUND', path: '$.bodies[0]' }))
    expect(spy.calls).toMatchObject({ validate: 1, normalize: 0, evaluate: 0 })
  })

  it('rejects the second caller-ordered duplicate Motion Group ID before any Solver call', () => {
    const spy = spySolver()
    const source = definition()
    ;(source as any).motionGroups = [
      { motionGroupId: 'z-group', name: 'First Z group', coordinateJointIds: ['joint-1'], endFrameIds: [] },
      { motionGroupId: 'z-group', name: 'Second Z group', coordinateJointIds: ['joint-1'], endFrameIds: [] },
      { motionGroupId: 'a-group', name: 'A group', coordinateJointIds: ['joint-1'], endFrameIds: [] },
    ]
    const service = createApplicationKinematicsServiceV1(createSolverRegistryV1([spy.solver]))

    expect(() => service.compile(source)).toThrow(MechanismErrorV1)
    expect(() => service.compile(source)).toThrow(expect.objectContaining({
      code: 'MECHANISM_ID_DUPLICATE',
      path: '$.motionGroups[1].motionGroupId',
    }))
    expect(spy.calls).toMatchObject({ validate: 0, normalize: 0, evaluate: 0 })
  })

  it.each([
    ['a non-array Motion Group collection', (source: any) => {
      source.motionGroups = null
    }, '$.motionGroups'],
    ['a null Motion Group entry', (source: any) => {
      source.motionGroups = [null]
    }, '$.motionGroups[0]'],
    ['missing Motion Group IDs', (source: any) => {
      const group = { name: 'Missing ID', coordinateJointIds: ['joint-1'], endFrameIds: [] }
      source.motionGroups = [group, { ...group }]
    }, '$.motionGroups[0].motionGroupId'],
    ['non-string Motion Group IDs', (source: any) => {
      const group = { motionGroupId: 1, name: 'Numeric ID', coordinateJointIds: ['joint-1'], endFrameIds: [] }
      source.motionGroups = [group, { ...group }]
    }, '$.motionGroups[0].motionGroupId'],
  ] as const)('defers %s to branded Solver shape validation', (_name, corrupt, path) => {
    const source = structuredClone(makeOneRevoluteMechanismV1()) as any
    corrupt(source)

    expect(() => createDefaultApplicationKinematicsServiceV1().compile(source)).toThrow(MechanismErrorV1)
    expect(() => createDefaultApplicationKinematicsServiceV1().compile(source)).toThrow(expect.objectContaining({
      code: 'MECHANISM_VALUE_INVALID',
      path,
    }))
  })

  it('clones and freezes before exact resolution and validates that same canonical Definition once', () => {
    let mutationSucceeded: boolean | undefined
    let validatedDefinition: MechanismDefinitionV1 | undefined
    const spy = spySolver({
      duringValidation: (value) => {
        validatedDefinition = value
        mutationSucceeded = Reflect.set(value.solverRef, 'solverKey', 'identity-drift')
      },
    })
    const source = definition()
    const service = createApplicationKinematicsServiceV1(createSolverRegistryV1([spy.solver]))

    const compiled = service.compile(source)

    expect(mutationSucceeded).toBe(false)
    expect(validatedDefinition).toBe(compiled.definition)
    expect(Object.isFrozen(validatedDefinition!.solverRef)).toBe(true)
    expect(compiled.solverKey).toBe('spy-fk')
    expect(source.solverRef.solverKey).toBe('spy-fk')
    expect(spy.calls.validate).toBe(1)
  })

  it.each([
    ['wrong Solver identity', (value: ForwardKinematicsResultV1) => Object.freeze({ ...value, solverKey: 'foreign' })],
    ['missing Body', (value: ForwardKinematicsResultV1) => Object.freeze({ ...value, bodyLocalPoses: record([['base', identityPose]]) })],
    ['foreign Body', (value: ForwardKinematicsResultV1) => Object.freeze({ ...value, bodyWorldPoses: record([...Object.entries(value.bodyWorldPoses), ['foreign', identityPose]]) })],
    ['foreign coordinate', (value: ForwardKinematicsResultV1) => Object.freeze({ ...value, normalizedCoordinates: record([['foreign', 0]]) })],
    ['mutable result record', (value: ForwardKinematicsResultV1) => Object.freeze({ ...value, bodyLocalPoses: Object.create(null) })],
    ['non-finite transform', (value: ForwardKinematicsResultV1) => Object.freeze({ ...value, bodyWorldPoses: record([
      ['arm', Object.freeze({ positionM: Object.freeze([Infinity, 0, 0] as [number, number, number]), quaternion: identityPose.quaternion })],
      ['base', identityPose],
    ]) })],
    ['non-normalized transform', (value: ForwardKinematicsResultV1) => Object.freeze({ ...value, bodyWorldPoses: record([
      ['arm', Object.freeze({ positionM: identityPose.positionM, quaternion: Object.freeze([0, 0, 0, 2] as [number, number, number, number]) })],
      ['base', identityPose],
    ]) })],
    ['foreign Frame', (value: ForwardKinematicsResultV1) => Object.freeze({ ...value, frameWorldPoses: record([['foreign-frame', identityPose]]) })],
  ] as const)('fails closed for a Solver result with %s', (_name, alterResult) => {
    const spy = spySolver({ alterResult })
    const service = createApplicationKinematicsServiceV1(createSolverRegistryV1([spy.solver]))
    const compiled = service.compile(definition())

    expect(() => compiled.evaluateForward({ rootWorldPose: identityPose, coordinatesByStableId: { 'joint-1': 0 } })).toThrow(expect.objectContaining({
      code: 'SOLVER_RESULT_INVALID',
    }))
  })

  it('accepts exactly requested Frame and Motion Group result filters', () => {
    const spy = spySolver()
    const source = definition()
    ;(source as any).frames = [{ frameId: 'tool-frame', name: 'Tool', role: 'tool', parent: { type: 'body', bodyId: 'arm' }, localPose: identityPose }]
    ;(source as any).motionGroups = [{ motionGroupId: 'primary', name: 'Primary', coordinateJointIds: ['joint-1'], endFrameIds: ['tool-frame'] }]
    const compiled = createApplicationKinematicsServiceV1(createSolverRegistryV1([spy.solver])).compile(source)

    const evaluated = compiled.evaluateForward({
      rootWorldPose: identityPose,
      coordinatesByStableId: { 'joint-1': 0 },
      requestedFrameIds: ['tool-frame'],
      requestedMotionGroupId: 'primary',
    })

    expect(Object.keys(evaluated.frameWorldPoses)).toEqual(['tool-frame'])
    expect(Object.keys(evaluated.motionGroupEndFramePoses)).toEqual(['primary'])
  })

  it('forwards and validates against one immutable requested Frame snapshot', () => {
    let mutationAttempts = 0
    let mutationSucceeded: boolean | undefined
    let forwardedSnapshot: readonly string[] | undefined
    const spy = spySolver({
      beforeResult: (request) => {
        mutationAttempts += 1
        forwardedSnapshot = request.requestedFrameIds
        try {
          ;(request.requestedFrameIds as string[]).splice(0)
          mutationSucceeded = true
        } catch {
          mutationSucceeded = false
        }
      },
    })
    const source = definition()
    ;(source as any).frames = [{ frameId: 'tool-frame', name: 'Tool', role: 'tool', parent: { type: 'body', bodyId: 'arm' }, localPose: identityPose }]
    const requestedFrameIds = ['tool-frame', 'tool-frame']
    const compiled = createApplicationKinematicsServiceV1(createSolverRegistryV1([spy.solver])).compile(source)

    const evaluated = compiled.evaluateForward({
      rootWorldPose: identityPose,
      coordinatesByStableId: { 'joint-1': 0 },
      requestedFrameIds,
    })

    expect(mutationAttempts).toBe(1)
    expect(mutationSucceeded).toBe(false)
    expect(forwardedSnapshot).toEqual(['tool-frame'])
    expect(forwardedSnapshot).not.toBe(requestedFrameIds)
    expect(Object.isFrozen(forwardedSnapshot)).toBe(true)
    expect(requestedFrameIds).toEqual(['tool-frame', 'tool-frame'])
    expect(Object.keys(evaluated.frameWorldPoses)).toEqual(['tool-frame'])
  })
})
