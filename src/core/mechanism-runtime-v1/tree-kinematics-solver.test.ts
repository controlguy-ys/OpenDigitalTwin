import { describe, expect, it } from 'vitest'

import { composeRigidTransformV5, rpyDegreesToQuaternionV5 } from '../project-v5/rigid-transform.js'
import {
  makeBranchedMechanismV1,
  makeMixedTreeMechanismV1,
  makeNestedFrameMechanismV1,
  makeOneRevoluteMechanismV1,
} from './test-support.js'
import { createTreeKinematicsSolverV1 } from './tree-kinematics-solver.js'
import type { MechanismDefinitionV1, RigidTransformV1 } from './types.js'

const identityPose: RigidTransformV1 = { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }

function draft(definition: MechanismDefinitionV1): any {
  return structuredClone(definition)
}

function expectFailure(action: () => unknown, code: string, path: string): void {
  expect(action).toThrow(expect.objectContaining({ name: 'MechanismErrorV1', code, path }))
}

function deeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return true
  if (!Object.isFrozen(value)) return false
  seen.add(value)
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor === undefined || !('value' in descriptor) || deeplyFrozen(descriptor.value, seen)
  })
}

describe('createTreeKinematicsSolverV1', () => {
  it('requires precisely the movable coordinate set and returns a sorted frozen null-prototype record', () => {
    const solver = createTreeKinematicsSolverV1()
    const definition = makeBranchedMechanismV1()

    const coordinates = solver.normalizeCoordinates(definition, {
      'right-shoulder': -0,
      'left-elbow': 0.2,
      'head-yaw': 0.1,
      'right-elbow': -0.2,
      'left-shoulder': 0.3,
    })

    expect(Object.keys(coordinates)).toEqual([
      'head-yaw', 'left-elbow', 'left-shoulder', 'right-elbow', 'right-shoulder',
    ])
    expect(Object.getPrototypeOf(coordinates)).toBeNull()
    expect(Object.isFrozen(coordinates)).toBe(true)
    expect(Object.is(coordinates['right-shoulder'], -0)).toBe(false)
    expectFailure(() => solver.normalizeCoordinates(definition, { 'head-yaw': 0 }), 'COORDINATE_SET_MISMATCH', '$.coordinatesByStableId')
    expectFailure(() => solver.normalizeCoordinates(definition, {
      'head-yaw': 0, 'left-elbow': 0, 'left-shoulder': 0, 'right-elbow': 0, 'right-shoulder': 0, fixed: 0,
    }), 'COORDINATE_SET_MISMATCH', '$.coordinatesByStableId')
    expectFailure(() => solver.normalizeCoordinates(makeMixedTreeMechanismV1(), {
      'arm-slide': 0, 'tool-roll': 0, 'fixed-pedestal': 0,
    }), 'COORDINATE_SET_MISMATCH', '$.coordinatesByStableId')
  })

  it('rejects hostile coordinate records and non-finite values without using home values', () => {
    const solver = createTreeKinematicsSolverV1()
    const definition = makeOneRevoluteMechanismV1()
    const accessor = {}
    Object.defineProperty(accessor, 'joint-1', { enumerable: true, get: () => 0 })
    const hidden = { 'joint-1': 0 }
    Object.defineProperty(hidden, 'hidden', { enumerable: false, value: 1 })
    const symbol = { 'joint-1': 0, [Symbol('coordinate')]: 1 }
    class CoordinateRecord { readonly ['joint-1'] = 0 }

    for (const coordinates of [accessor, hidden, symbol, new CoordinateRecord()] as const) {
      expectFailure(() => solver.normalizeCoordinates(definition, coordinates as any), 'MECHANISM_VALUE_INVALID', '$.coordinatesByStableId')
    }
    expectFailure(() => solver.normalizeCoordinates(definition, { 'joint-1': Infinity }), 'COORDINATE_VALUE_NOT_FINITE', '$.coordinatesByStableId.joint-1')
    expectFailure(() => solver.normalizeCoordinates(definition, {}), 'COORDINATE_SET_MISMATCH', '$.coordinatesByStableId')
  })

  it('checks commanded coordinates against limits before direction and zero-offset conversion', () => {
    const solver = createTreeKinematicsSolverV1()
    const definition = draft(makeOneRevoluteMechanismV1())
    definition.joints[0].minimum = -0.5
    definition.joints[0].maximum = 0.5
    definition.joints[0].zeroOffset = 0.25
    definition.joints[0].direction = -1

    expect(solver.normalizeCoordinates(definition, { 'joint-1': 0.5 })).toEqual({ 'joint-1': 0.5 })
    expectFailure(() => solver.normalizeCoordinates(definition, { 'joint-1': 0.51 }), 'JOINT_LIMIT_EXCEEDED', '$.coordinatesByStableId.joint-1')

    const result = solver.evaluateForward({ mechanismDefinition: definition, rootWorldPose: identityPose, coordinatesByStableId: { 'joint-1': 0.5 } })
    expect(result.bodyLocalPoses.arm!.quaternion[2]).toBeCloseTo(Math.sin(-0.75 / 2))
    expect(result.bodyLocalPoses.arm!.quaternion[3]).toBeCloseTo(Math.cos(-0.75 / 2))
  })

  it('evaluates fixed, prismatic, and revolute joints as origin times motion below a non-identity root', () => {
    const solver = createTreeKinematicsSolverV1()
    const definition = draft(makeMixedTreeMechanismV1())
    definition.joints[0].origin = { positionM: [1, 0, 0], quaternion: [0, 0, 0, 1] }
    definition.joints[1].origin = { positionM: [0, 1, 0], quaternion: rpyDegreesToQuaternionV5([0, 0, 90]) }
    definition.joints[1].axis = [2, 0, 0]
    definition.joints[2].origin = { positionM: [0, 0, 1], quaternion: [0, 0, 0, 1] }
    definition.joints[2].axis = [0, 0, 2]
    const rootWorldPose = { positionM: [10, 20, 30] as const, quaternion: rpyDegreesToQuaternionV5([0, 0, 90]) }

    const result = solver.evaluateForward({
      mechanismDefinition: definition,
      rootWorldPose,
      coordinatesByStableId: { 'arm-slide': 0.5, 'tool-roll': Math.PI / 2 },
    })

    const expectedArmLocal = composeRigidTransformV5(definition.joints[1].origin, {
      positionM: [0.5, 0, 0] as const, quaternion: [0, 0, 0, 1] as const,
    })
    expect(result.bodyLocalPoses.arm).toEqual(expectedArmLocal)
    expect(result.bodyWorldPoses.base).toEqual(rootWorldPose)
    expect(result.bodyWorldPoses.tool!.quaternion).toEqual(expect.arrayContaining([expect.any(Number)]))
    expect(Math.hypot(...result.bodyWorldPoses.tool!.quaternion)).toBeCloseTo(1)
  })

  it('evaluates branched bodies independently and nested Frames, then applies output filters only after FK', () => {
    const solver = createTreeKinematicsSolverV1()
    const definition = draft(makeBranchedMechanismV1())
    definition.frames = [
      { frameId: 'left-frame', name: 'left', role: 'tool', parent: { type: 'body', bodyId: 'left-lower' }, localPose: { positionM: [1, 0, 0], quaternion: [0, 0, 0, 1] } },
      { frameId: 'right-frame', name: 'right', role: 'tool', parent: { type: 'body', bodyId: 'right-lower' }, localPose: { positionM: [1, 0, 0], quaternion: [0, 0, 0, 1] } },
      { frameId: 'nested-left', name: 'nested', role: 'tcp', parent: { type: 'frame', frameId: 'left-frame' }, localPose: { positionM: [0, 1, 0], quaternion: [0, 0, 0, 1] } },
    ]
    definition.motionGroups = [{ motionGroupId: 'left-group', name: 'left', coordinateJointIds: ['left-shoulder', 'left-elbow'], endFrameIds: ['nested-left'] }]
    const coordinates = {
      'head-yaw': Math.PI / 4, 'left-shoulder': Math.PI / 6, 'left-elbow': -Math.PI / 3,
      'right-shoulder': -Math.PI / 6, 'right-elbow': Math.PI / 3,
    }

    const all = solver.evaluateForward({ mechanismDefinition: definition, rootWorldPose: identityPose, coordinatesByStableId: coordinates })
    const filtered = solver.evaluateForward({
      mechanismDefinition: definition, rootWorldPose: identityPose, coordinatesByStableId: coordinates,
      requestedFrameIds: ['nested-left'], requestedMotionGroupId: 'left-group',
    })

    expect(all.bodyWorldPoses['left-lower']).not.toEqual(all.bodyWorldPoses['right-lower'])
    expect(all.frameWorldPoses['nested-left']).toBeDefined()
    expect(Object.keys(filtered.frameWorldPoses)).toEqual(['nested-left'])
    expect(filtered.motionGroupEndFramePoses).toEqual({ 'left-group': { 'nested-left': all.frameWorldPoses['nested-left'] } })
    expect(filtered.normalizedCoordinates).toEqual(all.normalizedCoordinates)
  })

  it('rejects invalid root transforms and unknown frame or Motion Group requests', () => {
    const solver = createTreeKinematicsSolverV1()
    const definition = makeNestedFrameMechanismV1()
    const request = { mechanismDefinition: definition, rootWorldPose: identityPose, coordinatesByStableId: { 'joint-1': 0 } }

    expectFailure(() => solver.evaluateForward({ ...request, rootWorldPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 0] } }), 'TRANSFORM_INVALID', '$.rootWorldPose')
    expectFailure(() => solver.evaluateForward({ ...request, requestedFrameIds: ['missing'] }), 'FRAME_NOT_FOUND', '$.requestedFrameIds[0]')
    expectFailure(() => solver.evaluateForward({ ...request, requestedMotionGroupId: 'missing' }), 'MOTION_GROUP_NOT_FOUND', '$.requestedMotionGroupId')
  })

  it('deduplicates existing requested Frame IDs before stable result ordering', () => {
    const solver = createTreeKinematicsSolverV1()
    const definition = makeNestedFrameMechanismV1()

    const result = solver.evaluateForward({
      mechanismDefinition: definition,
      rootWorldPose: identityPose,
      coordinatesByStableId: { 'joint-1': 0 },
      requestedFrameIds: ['tool-frame', 'base-frame', 'tool-frame'],
    })

    expect(Object.keys(result.frameWorldPoses)).toEqual(['base-frame', 'tool-frame'])
  })

  it('is deterministic across shuffled inputs and returns detached deeply frozen canonical output', () => {
    const solver = createTreeKinematicsSolverV1()
    const baselineDefinition = draft(makeNestedFrameMechanismV1())
    baselineDefinition.frames[0].localPose = { positionM: [-0, 0, 0], quaternion: [0, 0, 0, -2] }
    const shuffledDefinition = draft(baselineDefinition)
    shuffledDefinition.bodies.reverse()
    shuffledDefinition.joints.reverse()
    shuffledDefinition.frames.reverse()
    const request = { mechanismDefinition: baselineDefinition, rootWorldPose: identityPose, coordinatesByStableId: { 'joint-1': 0 } }

    const baseline = solver.evaluateForward(request)
    const shuffled = solver.evaluateForward({ ...request, mechanismDefinition: shuffledDefinition })

    expect(shuffled).toEqual(baseline)
    expect(deeplyFrozen(baseline)).toBe(true)
    expect(Object.getPrototypeOf(baseline.bodyWorldPoses)).toBeNull()
    expect(Object.is(baseline.frameWorldPoses['base-frame']!.positionM[0], -0)).toBe(false)
    expect(() => { (baseline.bodyWorldPoses.base!.positionM as any)[0] = 9 }).toThrow(TypeError)
  })

  it('recompiles mutable definitions instead of retaining a stale traversal cache', () => {
    const solver = createTreeKinematicsSolverV1()
    const definition = draft(makeOneRevoluteMechanismV1())
    const request = { mechanismDefinition: definition, rootWorldPose: identityPose, coordinatesByStableId: { 'joint-1': 0 } }

    const before = solver.evaluateForward(request)
    definition.joints[0].origin.positionM[0] = 2
    const after = solver.evaluateForward(request)

    expect(before.bodyWorldPoses.arm!.positionM).toEqual([0, 0, 0])
    expect(after.bodyWorldPoses.arm!.positionM).toEqual([2, 0, 0])
  })

  it('returns validation findings instead of throwing from validateDefinition', () => {
    const solver = createTreeKinematicsSolverV1()
    const invalid = draft(makeOneRevoluteMechanismV1())
    invalid.joints[0].axis = [0, 0, 0]

    expect(solver.validateDefinition(invalid)).toMatchObject({
      valid: false,
      errors: [{ code: 'JOINT_AXIS_NOT_NORMALIZABLE', path: '$.joints[0].axis' }],
      warnings: [],
    })
  })
})
