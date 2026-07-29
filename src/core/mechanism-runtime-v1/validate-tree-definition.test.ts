import { describe, expect, it } from 'vitest'

import { MechanismErrorV1 } from './errors.js'
import {
  makeBranchedMechanismV1,
  makeMaximumTreeMechanismV1,
  makeNestedFrameMechanismV1,
  makeOneRevoluteMechanismV1,
} from './test-support.js'
import {
  TREE_KINEMATICS_SOLVER_CONTRACT_VERSION_V1,
  TREE_KINEMATICS_SOLVER_KEY_V1,
} from './tree-kinematics-solver.js'
import { compileTreeMechanismDefinitionV1 } from './validate-tree-definition.js'
import type { MechanismDefinitionV1 } from './types.js'

function draft(definition: MechanismDefinitionV1): any {
  return structuredClone(definition)
}

function expectFailure(definition: MechanismDefinitionV1, code: string, path: string): void {
  expect(() => compileTreeMechanismDefinitionV1(definition)).toThrow(expect.objectContaining({
    name: 'MechanismErrorV1', code, path,
  }))
}

describe('compileTreeMechanismDefinitionV1', () => {
  it('compiles the exact locked Tree Solver identity used by the default Application Service', () => {
    const value = draft(makeOneRevoluteMechanismV1())
    value.solverRef.solverKey = TREE_KINEMATICS_SOLVER_KEY_V1
    value.solverRef.contractVersion = TREE_KINEMATICS_SOLVER_CONTRACT_VERSION_V1

    expect(compileTreeMechanismDefinitionV1(value).definition.solverRef).toMatchObject({
      solverKey: TREE_KINEMATICS_SOLVER_KEY_V1,
      contractVersion: TREE_KINEMATICS_SOLVER_CONTRACT_VERSION_V1,
    })
  })

  it('compiles a branched Tree in stable traversal and coordinate order', () => {
    const compiled = compileTreeMechanismDefinitionV1(makeBranchedMechanismV1())

    expect(compiled.rootBodyId).toBe('base')
    expect(compiled.traversal.map(({ jointId }) => jointId)).toEqual([
      'head-yaw', 'left-shoulder', 'left-elbow', 'right-shoulder', 'right-elbow',
    ])
    expect(compiled.movableJointIds).toEqual([
      'head-yaw', 'left-elbow', 'left-shoulder', 'right-elbow', 'right-shoulder',
    ])
  })

  it.each([
    ['zero Bodies', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.bodies = []; return value
    }],
    ['more than 128 Bodies', () => {
      const value = draft(makeMaximumTreeMechanismV1()); value.bodies.push({ bodyId: 'body-128', name: 'extra' }); return value
    }],
  ])('rejects %s at the Body resource boundary', (_name, makeInvalid) => {
    expectFailure(makeInvalid(), 'MECHANISM_RESOURCE_LIMIT_EXCEEDED', '$.bodies')
  })

  it.each([
    ['more than 127 total Joints', () => {
      const value = draft(makeMaximumTreeMechanismV1()); value.joints.push({ ...value.joints[0], jointId: 'extra-joint' }); return value
    }, 'MECHANISM_RESOURCE_LIMIT_EXCEEDED', '$.joints'],
    ['more than 64 movable Joints', () => {
      const value = draft(makeMaximumTreeMechanismV1())
      value.joints[64] = { ...value.joints[64], jointType: 'revolute', axis: [0, 0, 1], minimum: -1, maximum: 1, home: 0, zeroOffset: 0, direction: 1, maximumVelocity: 1 }
      return value
    }, 'MECHANISM_RESOURCE_LIMIT_EXCEEDED', '$.joints'],
    ['a duplicate Body ID', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.bodies[1].bodyId = 'base'; return value
    }, 'MECHANISM_ID_DUPLICATE', '$.bodies[1].bodyId'],
    ['a duplicate Joint ID', () => {
      const value = draft(makeBranchedMechanismV1()); value.joints[1].jointId = value.joints[0].jointId; return value
    }, 'MECHANISM_ID_DUPLICATE', '$.joints[1].jointId'],
    ['a missing parent Body', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.joints[0].parentBodyId = 'missing'; return value
    }, 'BODY_NOT_FOUND', '$.joints[0].parentBodyId'],
    ['a missing child Body', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.joints[0].childBodyId = 'missing'; return value
    }, 'BODY_NOT_FOUND', '$.joints[0].childBodyId'],
    ['a self edge', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.joints[0].childBodyId = 'base'; return value
    }, 'MECHANISM_TOPOLOGY_INVALID', '$.joints[0]'],
    ['a second incoming Joint', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.joints.push({ ...value.joints[0], jointId: 'joint-2' }); return value
    }, 'MECHANISM_TOPOLOGY_INVALID', '$.joints[1]'],
    ['multiple Body roots', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.bodies.push({ bodyId: 'spare', name: 'spare' }); return value
    }, 'MECHANISM_TOPOLOGY_INVALID', '$.joints'],
    ['a disconnected Body cycle', () => {
      const value = draft(makeOneRevoluteMechanismV1())
      value.bodies.push({ bodyId: 'cycle-a', name: 'cycle-a' }, { bodyId: 'cycle-b', name: 'cycle-b' })
      value.joints.push(
        { ...value.joints[0], jointId: 'cycle-joint-a', parentBodyId: 'cycle-a', childBodyId: 'cycle-b' },
        { ...value.joints[0], jointId: 'cycle-joint-b', parentBodyId: 'cycle-b', childBodyId: 'cycle-a' },
      )
      return value
    }, 'MECHANISM_TOPOLOGY_INVALID', '$.joints'],
    ['a zero movable axis', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.joints[0].axis = [0, 0, 0]; return value
    }, 'JOINT_AXIS_NOT_NORMALIZABLE', '$.joints[0].axis'],
    ['a non-finite movable axis', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.joints[0].axis = [Infinity, 0, 0]; return value
    }, 'JOINT_AXIS_NOT_NORMALIZABLE', '$.joints[0].axis'],
    ['reversed limits', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.joints[0].minimum = 2; value.joints[0].maximum = 1; return value
    }, 'JOINT_LIMIT_INVALID', '$.joints[0]'],
    ['a home value outside its limits', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.joints[0].home = 4; return value
    }, 'JOINT_LIMIT_INVALID', '$.joints[0]'],
    ['a negative velocity', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.joints[0].maximumVelocity = -1; return value
    }, 'JOINT_LIMIT_INVALID', '$.joints[0].maximumVelocity'],
    ['an invalid direction', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.joints[0].direction = 0; return value
    }, 'JOINT_DIRECTION_INVALID', '$.joints[0].direction'],
  ])('rejects %s', (_name, makeInvalid, code, path) => {
    expectFailure(makeInvalid(), code, path)
  })

  it('exposes structured validation errors', () => {
    const value = draft(makeOneRevoluteMechanismV1())
    value.joints[0].axis = [0, 0, 0]
    expect(() => compileTreeMechanismDefinitionV1(value)).toThrow(MechanismErrorV1)
  })

  it('compiles a locked Joint whose equal bounds contain home', () => {
    const value = draft(makeOneRevoluteMechanismV1())
    value.joints[0].minimum = 0.25
    value.joints[0].maximum = 0.25
    value.joints[0].home = 0.25

    expect(compileTreeMechanismDefinitionV1(value).definition.joints[0]).toMatchObject({
      minimum: 0.25,
      maximum: 0.25,
      home: 0.25,
    })
  })

  it('compiles a movable Joint with zero maximum velocity', () => {
    const value = draft(makeOneRevoluteMechanismV1())
    value.joints[0].maximumVelocity = 0

    expect(compileTreeMechanismDefinitionV1(value).definition.joints[0]).toMatchObject({
      maximumVelocity: 0,
    })
  })

  it('reports an earlier Joint record failure before a later duplicate Joint ID', () => {
    const value = draft(makeBranchedMechanismV1())
    value.joints[0].axis = [0, 0, 0]
    value.joints[1].jointId = value.joints[0].jointId

    expectFailure(value, 'JOINT_AXIS_NOT_NORMALIZABLE', '$.joints[0].axis')
  })

  it.each([
    ['a duplicate Frame ID', () => {
      const value = draft(makeNestedFrameMechanismV1()); value.frames[1].frameId = value.frames[0].frameId; return value
    }, 'MECHANISM_ID_DUPLICATE', '$.frames[1].frameId'],
    ['a missing Frame Body parent', () => {
      const value = draft(makeNestedFrameMechanismV1()); value.frames[0].parent.bodyId = 'missing'; return value
    }, 'FRAME_PARENT_NOT_FOUND', '$.frames[0].parent'],
    ['a missing Frame parent', () => {
      const value = draft(makeNestedFrameMechanismV1()); value.frames[1].parent.frameId = 'missing'; return value
    }, 'FRAME_PARENT_NOT_FOUND', '$.frames[1].parent'],
    ['a Frame parent cycle', () => {
      const value = draft(makeNestedFrameMechanismV1())
      value.frames[0].parent = { type: 'frame', frameId: 'tool-frame' }
      return value
    }, 'FRAME_CYCLE', '$.frames'],
    ['a free-body topology', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.topologyKind = 'free-body'; return value
    }, 'TOPOLOGY_UNSUPPORTED', '$.topologyKind'],
    ['a parallel topology', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.topologyKind = 'parallel'; return value
    }, 'TOPOLOGY_UNSUPPORTED', '$.topologyKind'],
    ['a fixed Motion Group coordinate', () => {
      const value = draft(makeNestedFrameMechanismV1())
      value.joints[0] = { jointId: 'fixed-1', jointType: 'fixed', parentBodyId: 'base', childBodyId: 'tool', origin: value.joints[0].origin }
      value.motionGroups = [{ motionGroupId: 'group', name: 'group', coordinateJointIds: ['fixed-1'], endFrameIds: [] }]
      return value
    }, 'MOTION_GROUP_INVALID', '$.motionGroups[0].coordinateJointIds[0]'],
    ['a missing Motion Group coordinate', () => {
      const value = draft(makeNestedFrameMechanismV1())
      value.motionGroups = [{ motionGroupId: 'group', name: 'group', coordinateJointIds: ['missing'], endFrameIds: [] }]
      return value
    }, 'MOTION_GROUP_INVALID', '$.motionGroups[0].coordinateJointIds[0]'],
    ['a duplicate Motion Group coordinate', () => {
      const value = draft(makeNestedFrameMechanismV1())
      value.motionGroups = [{ motionGroupId: 'group', name: 'group', coordinateJointIds: ['joint-1', 'joint-1'], endFrameIds: [] }]
      return value
    }, 'MOTION_GROUP_INVALID', '$.motionGroups[0].coordinateJointIds[1]'],
    ['a missing Motion Group end Frame', () => {
      const value = draft(makeNestedFrameMechanismV1())
      value.motionGroups = [{ motionGroupId: 'group', name: 'group', coordinateJointIds: [], endFrameIds: ['missing'] }]
      return value
    }, 'FRAME_NOT_FOUND', '$.motionGroups[0].endFrameIds[0]'],
    ['a duplicate Motion Group end Frame', () => {
      const value = draft(makeNestedFrameMechanismV1())
      value.motionGroups = [{ motionGroupId: 'group', name: 'group', coordinateJointIds: [], endFrameIds: ['tool-frame', 'tool-frame'] }]
      return value
    }, 'MOTION_GROUP_INVALID', '$.motionGroups[0].endFrameIds[1]'],
    ['a non-empty Tree constraint list', () => {
      const value = draft(makeOneRevoluteMechanismV1())
      value.constraints = [{ constraintId: 'constraint', constraintType: 'loop-closure', parentFrameId: 'a', childFrameId: 'b', targetPose: value.joints[0].origin }]
      return value
    }, 'TOPOLOGY_UNSUPPORTED', '$.constraints'],
    ['an unavailable solver key', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.solverRef.solverKey = 'other'; return value
    }, 'SOLVER_UNAVAILABLE', '$.solverRef.solverKey'],
    ['an unavailable solver version', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.solverRef.contractVersion = '2'; return value
    }, 'SOLVER_UNAVAILABLE', '$.solverRef.contractVersion'],
    ['non-empty solver parameters', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.solverRef.parameters = { mode: 'fast' }; return value
    }, 'SOLVER_PARAMETERS_INVALID', '$.solverRef.parameters'],
    ['an incorrect solver parameter hash', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.solverRef.normalizedParametersHash = 'wrong'; return value
    }, 'SOLVER_PARAMETERS_INVALID', '$.solverRef.normalizedParametersHash'],
  ])('rejects %s', (_name, makeInvalid, code, path) => {
    expectFailure(makeInvalid(), code, path)
  })

  it('reports an earlier Frame record failure before a later duplicate Frame ID', () => {
    const value = draft(makeNestedFrameMechanismV1())
    value.frames[0].parent = { type: 'body', bodyId: 'missing' }
    value.frames[1].frameId = value.frames[0].frameId

    expectFailure(value, 'FRAME_PARENT_NOT_FOUND', '$.frames[0].parent')
  })

  it('normalizes a nested Frame Tree into a detached frozen output', () => {
    const input = draft(makeNestedFrameMechanismV1())
    input.geometryBindings = [{
      geometryBindingId: 'geometry-a',
      bodyId: 'tool',
      assetReferenceId: 'asset-a',
      occurrenceKey: 'occurrence-a',
      bodyLocalPose: { positionM: [1, 2, 3], quaternion: [0, 0, 0, 1] },
    }]
    const compiled = compileTreeMechanismDefinitionV1(input)

    expect(compiled.definition).not.toBe(input)
    expect(compiled.definition.joints[0]).not.toBe(input.joints[0])
    expect(Object.isFrozen(compiled)).toBe(true)
    expect(Object.isFrozen(compiled.definition.frames)).toBe(true)
    expect(Object.isFrozen(compiled.definition.joints[0]!.origin)).toBe(true)
    expect(Object.isFrozen(compiled.definition.joints[0]!.origin.positionM)).toBe(true)
    expect(Object.isFrozen(compiled.definition.joints[0]!.origin.quaternion)).toBe(true)
    expect(Object.isFrozen((compiled.definition.joints[0] as any).axis)).toBe(true)
    expect(Object.isFrozen(compiled.definition.frames[0]!.localPose.positionM)).toBe(true)
    expect(Object.isFrozen(compiled.definition.frames[0]!.localPose.quaternion)).toBe(true)
    expect(Object.isFrozen(compiled.definition.geometryBindings[0]!.bodyLocalPose.positionM)).toBe(true)
    expect(Object.isFrozen(compiled.definition.geometryBindings[0]!.bodyLocalPose.quaternion)).toBe(true)
    expect(() => { (compiled.definition.joints[0]!.origin.positionM as any)[0] = 99 }).toThrow(TypeError)
    expect(() => { ((compiled.definition.joints[0] as any).axis as any)[0] = 99 }).toThrow(TypeError)
    expect(() => { (compiled.definition.frames[0]!.localPose.quaternion as any)[3] = 0 }).toThrow(TypeError)
    expect(() => { (compiled.definition.geometryBindings[0]!.bodyLocalPose.positionM as any)[0] = 99 }).toThrow(TypeError)
  })

  it('is deterministic across caller-order shuffles', () => {
    const original = draft(makeNestedFrameMechanismV1())
    original.geometryBindings = [
      {
        geometryBindingId: 'geometry-z', bodyId: 'tool', assetReferenceId: 'asset-z', occurrenceKey: 'z',
        bodyLocalPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      },
      {
        geometryBindingId: 'geometry-a', bodyId: 'base', assetReferenceId: 'asset-a', occurrenceKey: 'a',
        bodyLocalPose: { positionM: [1, 0, 0], quaternion: [0, 0, 0, 1] },
      },
    ]
    const baseline = compileTreeMechanismDefinitionV1(original)
    expect(baseline.definition.geometryBindings.map(({ geometryBindingId }) => geometryBindingId)).toEqual([
      'geometry-a', 'geometry-z',
    ])
    let state = 0x12345678
    const next = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0
      return state
    }
    const shuffled = <T,>(items: readonly T[]): T[] => {
      const copy = [...items]
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = next() % (index + 1)
        ;[copy[index], copy[swap]] = [copy[swap]!, copy[index]!]
      }
      return copy
    }

    for (let iteration = 0; iteration < 100; iteration += 1) {
      const value = draft(original)
      value.bodies = shuffled(value.bodies)
      value.joints = shuffled(value.joints)
      value.frames = shuffled(value.frames)
      value.motionGroups = shuffled(value.motionGroups)
      value.geometryBindings = shuffled(value.geometryBindings)
      expect(compileTreeMechanismDefinitionV1(value)).toEqual(baseline)
    }
  })

  it('retains hostile IDs in their typed namespaces without prototype pollution', () => {
    const value = draft(makeNestedFrameMechanismV1())
    value.bodies[0].bodyId = '__proto__'
    value.bodies[1].bodyId = 'constructor'
    value.joints[0].jointId = '__proto__'
    value.joints[0].parentBodyId = '__proto__'
    value.joints[0].childBodyId = 'constructor'
    value.frames[0].frameId = '__proto__'
    value.frames[0].parent.bodyId = '__proto__'
    value.frames[1].frameId = 'constructor'
    value.frames[1].parent.frameId = '__proto__'
    value.frames[2].parent.frameId = 'constructor'

    const compiled = compileTreeMechanismDefinitionV1(value)
    expect(compiled.rootBodyId).toBe('__proto__')
    expect(compiled.traversal[0]?.jointId).toBe('__proto__')
    expect(compiled.definition.frames.map(({ frameId }) => frameId)).toEqual(['__proto__', 'constructor', 'tool-frame'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it.each([
    ['a non-closed Body record', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.bodies[0].unexpected = true; return value
    }, '$.bodies[0].unexpected'],
    ['a bad Body scalar', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.bodies[0].bodyId = 3; return value
    }, '$.bodies[0].bodyId'],
    ['an unsupported Joint type', () => {
      const value = draft(makeOneRevoluteMechanismV1()); value.joints[0].jointType = 'continuous'; return value
    }, '$.joints[0].jointType'],
    ['an unsupported Frame role', () => {
      const value = draft(makeNestedFrameMechanismV1()); value.frames[0].role = 'unknown'; return value
    }, '$.frames[0].role'],
    ['a Frame parent accessor without reading it', () => {
      const value = draft(makeNestedFrameMechanismV1())
      Object.defineProperty(value.frames[0], 'parent', { enumerable: true, get: () => ({ type: 'body', bodyId: 'base' }) })
      return value
    }, '$.frames[0].parent'],
  ])('rejects %s as a canonical-value violation', (_name, makeInvalid, path) => {
    expectFailure(makeInvalid(), 'MECHANISM_VALUE_INVALID', path)
  })
})
