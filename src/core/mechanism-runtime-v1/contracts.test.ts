import { describe, expect, it } from 'vitest'

import {
  MAX_MECHANISM_BODIES_V1,
  MAX_MECHANISM_MOVABLE_JOINTS_V1,
  MAX_MECHANISM_TREE_JOINTS_V1,
} from './limits.js'
import { MechanismErrorV1, failMechanismV1 } from './errors.js'
import type {
  ForwardKinematicsRequestV1,
  ForwardKinematicsResultV1,
  MechanismFrameParentV1,
  MechanismGeometryBindingV1,
  MechanismJointV1,
  MechanismLoopClosureConstraintV1,
  MechanismRuntimeInstanceV1,
  MechanismSolverReferenceV1,
  MechanismSourceProvenanceV1,
  RobotCapabilityV1,
  RigidTransformV1,
  TwinEntityDefinitionV1,
} from './types.js'
import {
  frozenNullPrototypeRecordV1,
  inspectCanonicalJsonObjectV1,
  normalizeMechanismRigidTransformV1,
} from './validation-support.js'
import { makeMechanismTreeFkBenchmarkFixtureV1 } from './test-support.js'

const rawTypeModules = import.meta.glob('./types.ts', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>

function capture(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }
  throw new Error('Expected action to throw.')
}

const identityPose = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
} satisfies RigidTransformV1

const fixedJoint = {
  jointId: 'joint-fixed',
  jointType: 'fixed',
  parentBodyId: 'base',
  childBodyId: 'fixed-link',
  origin: identityPose,
} satisfies MechanismJointV1

const revoluteJoint = {
  jointId: 'joint-revolute',
  jointType: 'revolute',
  parentBodyId: 'fixed-link',
  childBodyId: 'arm',
  origin: identityPose,
  axis: [0, 0, 1],
  minimum: -Math.PI,
  maximum: Math.PI,
  home: 0,
  zeroOffset: 0,
  direction: 1,
  maximumVelocity: 1,
} satisfies MechanismJointV1

const prismaticJoint = {
  jointId: 'joint-prismatic',
  jointType: 'prismatic',
  parentBodyId: 'arm',
  childBodyId: 'tool',
  origin: identityPose,
  axis: [1, 0, 0],
  minimum: 0,
  maximum: 1,
  home: 0,
  zeroOffset: 0,
  direction: -1,
  maximumVelocity: 1,
} satisfies MechanismJointV1

const frameBodyParent = { type: 'body', bodyId: 'base' } satisfies MechanismFrameParentV1
const frameFrameParent = { type: 'frame', frameId: 'base-frame' } satisfies MechanismFrameParentV1

const solverReference = {
  solverKey: 'tree-fk',
  contractVersion: '1.0',
  parameters: {},
  normalizedParametersHash: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
} satisfies MechanismSolverReferenceV1

const provenance = {
  sourceKind: 'fixture',
  sourceDetail: 'Contract fixture.',
  sourceName: 'Contract fixture',
  sourceRevision: '1',
  adapterKey: null,
  adapterVersion: null,
} satisfies MechanismSourceProvenanceV1

const loopClosure = {
  constraintId: 'loop-1',
  constraintType: 'loop-closure',
  parentFrameId: 'base-frame',
  childFrameId: 'tool-frame',
  targetPose: identityPose,
} satisfies MechanismLoopClosureConstraintV1

const geometryBinding = {
  geometryBindingId: 'geometry-1',
  bodyId: 'tool',
  assetReferenceId: 'asset-1',
  occurrenceKey: 'occurrence-1',
  bodyLocalPose: identityPose,
} satisfies MechanismGeometryBindingV1

const twinEntity = {
  entityId: 'entity-1',
  displayName: 'Fixture entity',
  manufacturer: 'OpenAI',
  model: 'Fixture',
  definitionRevision: '1',
  assetBindings: [{ assetBindingId: 'asset-binding-1', assetReferenceId: 'asset-1', mechanismGeometryBindingId: 'geometry-1' }],
  mechanismDefinitionId: 'mechanism-1',
  capabilityIds: ['robot-1'],
} satisfies TwinEntityDefinitionV1

const runtimeInstance = {
  instanceId: 'instance-1',
  definitionId: 'mechanism-1',
  parentFrameId: 'world',
  localPose: identityPose,
  activeToolFrameId: 'tool-frame',
  activeTcpFrameId: null,
  visible: true,
  declaredValueOwners: {
    coordinates: 'simulation',
    frames: { 'tool-frame': 'manual' },
  },
} satisfies MechanismRuntimeInstanceV1

const robotCapability = {
  robotCapabilityId: 'robot-1',
  mechanismId: 'mechanism-1',
  motionGroupIds: ['group-1'],
  baseFrameId: null,
  flangeFrameIds: ['flange-frame'],
  toolFrameIds: ['tool-frame'],
  tcpFrameIds: ['tcp-frame'],
  homeCoordinateSets: [{ coordinateSetId: 'home-1', name: 'Home', coordinatesByStableId: { 'joint-revolute': 0 } }],
  robotStatusSemantics: { numericStatusSupported: true, motionStateSupported: true, safetyStateSupported: false },
  roboticsOpcUaView: {
    axisJointIds: ['joint-revolute'],
    baseFrameId: null,
    flangeFrameIds: ['flange-frame'],
    toolFrameIds: ['tool-frame'],
    tcpFrameIds: ['tcp-frame'],
  },
} satisfies RobotCapabilityV1

const mechanismDefinition = {
  mechanismId: 'mechanism-1',
  name: 'Contract mechanism',
  topologyKind: 'tree',
  solverRef: solverReference,
  bodies: [
    { bodyId: 'base', name: 'Base' },
    { bodyId: 'fixed-link', name: 'Fixed link' },
    { bodyId: 'arm', name: 'Arm' },
    { bodyId: 'tool', name: 'Tool' },
  ],
  joints: [fixedJoint, revoluteJoint, prismaticJoint],
  frames: [
    { frameId: 'base-frame', name: 'Base', role: 'base', parent: frameBodyParent, localPose: identityPose },
    { frameId: 'tool-frame', name: 'Tool', role: 'tool', parent: frameFrameParent, localPose: identityPose },
  ],
  motionGroups: [{ motionGroupId: 'group-1', name: 'Primary', coordinateJointIds: ['joint-revolute'], endFrameIds: ['tool-frame'] }],
  constraints: [loopClosure],
  geometryBindings: [geometryBinding],
  sourceProvenance: provenance,
} satisfies ForwardKinematicsRequestV1['mechanismDefinition']

const forwardRequest = {
  mechanismDefinition,
  rootWorldPose: identityPose,
  coordinatesByStableId: { 'joint-revolute': 0, 'joint-prismatic': 0 },
  requestedFrameIds: ['tool-frame'],
  requestedMotionGroupId: 'group-1',
} satisfies ForwardKinematicsRequestV1

const forwardResult = {
  solverKey: 'tree-fk',
  solverContractVersion: '1.0',
  normalizedCoordinates: { 'joint-revolute': 0, 'joint-prismatic': 0 },
  bodyLocalPoses: { base: identityPose },
  bodyWorldPoses: { base: identityPose },
  frameWorldPoses: { 'tool-frame': identityPose },
  motionGroupEndFramePoses: { 'group-1': { 'tool-frame': identityPose } },
  warnings: [],
} satisfies ForwardKinematicsResultV1

void [twinEntity, runtimeInstance, robotCapability, forwardRequest, forwardResult]

describe('Mechanism runtime V1 contracts', () => {
  it('exposes independent common mechanism limits and structured errors', () => {
    expect(MAX_MECHANISM_BODIES_V1).toBe(128)
    expect(MAX_MECHANISM_TREE_JOINTS_V1).toBe(127)
    expect(MAX_MECHANISM_MOVABLE_JOINTS_V1).toBe(64)
    expect(capture(() => failMechanismV1(
      'BODY_NOT_FOUND',
      '$.joints[0].parentBodyId',
      'Body base is missing.',
      'Add the referenced Body.',
    ))).toMatchObject({
      name: 'MechanismErrorV1',
      code: 'BODY_NOT_FOUND',
      path: '$.joints[0].parentBodyId',
      recovery: 'Add the referenced Body.',
    })
  })

  it('provides a deterministic maximum-size branched Tree FK benchmark fixture', () => {
    const first = makeMechanismTreeFkBenchmarkFixtureV1()
    const second = makeMechanismTreeFkBenchmarkFixtureV1()
    const movable = first.mechanismDefinition.joints.filter((joint) => joint.jointType !== 'fixed')
    const fixed = first.mechanismDefinition.joints.filter((joint) => joint.jointType === 'fixed')
    const parentCounts = new Map<string, number>()
    for (const joint of first.mechanismDefinition.joints) {
      parentCounts.set(joint.parentBodyId, (parentCounts.get(joint.parentBodyId) ?? 0) + 1)
    }

    expect(first.mechanismDefinition.bodies).toHaveLength(128)
    expect(first.mechanismDefinition.joints).toHaveLength(127)
    expect(movable).toHaveLength(64)
    expect(fixed).toHaveLength(63)
    expect(parentCounts.get('benchmark-body-000')).toBe(4)
    expect(Object.keys(first.coordinatesByStableId).sort()).toEqual(movable.map((joint) => joint.jointId).sort())
    expect(first).toEqual(second)
  })

  it('documents canonical right-handed Z-up axes and joint quantities in SI units', () => {
    const source = rawTypeModules['./types.ts']

    expect(source).toContain('right-handed, Z-up')
    expect(source).toContain('radians for revolute Joints and metres for prismatic Joints')
    expect(source).toContain('radians per second for revolute Joints and metres per second for prismatic Joints')
    expect(revoluteJoint.minimum).toBe(-Math.PI)
    expect(revoluteJoint.maximum).toBe(Math.PI)
    expect(prismaticJoint.minimum).toBe(0)
    expect(prismaticJoint.maximum).toBe(1)
  })

  it('clones only detached canonical JSON data without invoking accessors', () => {
    const input = { nested: { values: [1, { enabled: true }] } }
    const result = inspectCanonicalJsonObjectV1(input, '$.parameters')

    expect(result).toEqual(input)
    expect(result).not.toBe(input)
    expect(result.nested).not.toBe(input.nested)
    expect(Object.getPrototypeOf(result)).toBeNull()
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.nested)).toBe(true)

    let accessorReads = 0
    const accessorInput = {}
    Object.defineProperty(accessorInput, 'value', {
      enumerable: true,
      get() {
        accessorReads += 1
        return 'not-read'
      },
    })

    expect(capture(() => inspectCanonicalJsonObjectV1(accessorInput, '$.parameters'))).toMatchObject({
      name: 'MechanismErrorV1',
      code: 'MECHANISM_VALUE_INVALID',
      path: '$.parameters.value',
    })
    expect(accessorReads).toBe(0)
  })

  it('rejects non-canonical values before they become solver parameters', () => {
    class CustomPrototype { readonly value = 1 }
    const symbol = Symbol('parameter')
    const sparse = [1, 0, 3]
    delete sparse[1]
    const nonEnumerable = {}
    Object.defineProperty(nonEnumerable, 'hidden', { enumerable: false, value: 1 })

    for (const [value, path] of [
      [new CustomPrototype(), '$.parameters'],
      [{ [symbol]: 1 }, '$.parameters'],
      [{ values: sparse }, '$.parameters.values'],
      [{ value: Number.POSITIVE_INFINITY }, '$.parameters.value'],
      [nonEnumerable, '$.parameters.hidden'],
    ] as const) {
      expect(capture(() => inspectCanonicalJsonObjectV1(value, '$.parameters'))).toMatchObject({
        name: 'MechanismErrorV1',
        code: 'MECHANISM_VALUE_INVALID',
        path,
      })
    }
  })

  it('retains hostile string IDs in frozen null-prototype records', () => {
    const hostile = Object.create(null) as Record<string, unknown>
    Object.defineProperty(hostile, '__proto__', { configurable: true, enumerable: true, value: 'body-1', writable: true })
    Object.defineProperty(hostile, 'constructor', { configurable: true, enumerable: true, value: 'joint-1', writable: true })

    const inspected = inspectCanonicalJsonObjectV1(hostile, '$.parameters')
    const record = frozenNullPrototypeRecordV1([
      ['__proto__', 'body-1'],
      ['constructor', 'joint-1'],
    ])

    expect(inspected['__proto__']).toBe('body-1')
    expect(inspected.constructor).toBe('joint-1')
    expect(Object.getPrototypeOf(record)).toBeNull()
    expect(Object.isFrozen(record)).toBe(true)
    expect(record['__proto__']).toBe('body-1')
    expect(record.constructor).toBe('joint-1')
  })

  it('normalizes detached transforms and translates V5 math errors', () => {
    const input = { positionM: [1, 2, 3], quaternion: [0, 0, 0, 2] } satisfies RigidTransformV1
    const result = normalizeMechanismRigidTransformV1(input, '$.origin')

    expect(result).toEqual({ positionM: [1, 2, 3], quaternion: [0, 0, 0, 1] })
    expect(result).not.toBe(input)
    expect(result.positionM).not.toBe(input.positionM)
    expect(result.quaternion).not.toBe(input.quaternion)
    expect(capture(() => normalizeMechanismRigidTransformV1({
      positionM: [0, 0, 0],
      quaternion: [0, 0, 0, 0],
    }, '$.origin'))).toSatisfy((error: unknown) => (
      error instanceof MechanismErrorV1
      && error.code === 'TRANSFORM_INVALID'
      && error.path === '$.origin'
      && error.cause instanceof Error
    ))
  })
})
