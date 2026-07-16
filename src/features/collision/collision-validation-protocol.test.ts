import { describe, expect, it } from 'vitest'
import type { RobotDefinitionV4 } from '../../core/project-v4/types'
import {
  canonicalCollisionPairKeyV4,
  robotLinkCollisionIdV4,
  spatialEntityCollisionIdV4,
} from '../../core/robot-runtime/collision-identity'
import type {
  CollisionFinding,
  CollisionPolicyV4,
} from '../../domain/collision/collision'
import { CRB15000_DEFINITION, type RobotLinkId } from '../../domain/robot/crb15000'
import {
  MAX_COLLISION_VALIDATION_FINDINGS,
  collisionPolicyFromWireV4,
  collisionPolicyToWireV4,
  validateCollisionValidationProgress,
  validateCollisionValidationRequest,
  validateCollisionValidationRequestV4,
  validateCollisionValidationResult,
  type CollisionValidationRequestV4,
  type CollisionValidationRequest,
} from './collision-validation-protocol'
import type { CollisionGeometryProxyV4 } from './scene-entity-adapter'

const LINK_IDS: readonly RobotLinkId[] = [
  'LINK00',
  'LINK01',
  'LINK02',
  'LINK03',
  'LINK04',
  'LINK05',
  'LINK06',
]

const IDENTITY = {
  position: [0, 0, 0] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
}

const BOX = {
  id: 'default',
  center: [0, 0, 0] as [number, number, number],
  halfExtents: [0.1, 0.1, 0.1] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
}

function request(): CollisionValidationRequest {
  return {
    requestId: 'validation-1',
    revision: 'scene-7',
    mode: 'validate',
    sequence: [
      {
        id: 'pose-1',
        name: 'Pose 1',
        anglesDeg: [0, 0, 0, 0, 0, 0],
        durationMs: 1_000,
        easing: 'linear',
      },
      {
        id: 'pose-2',
        name: 'Pose 2',
        anglesDeg: [10, 0, 0, 0, 0, 0],
        durationMs: 1_000,
        easing: 'linear',
      },
    ],
    robot: {
      definition: CRB15000_DEFINITION,
      rootPose: IDENTITY,
      geometryTransforms: Object.fromEntries(
        LINK_IDS.map((linkId) => [linkId, IDENTITY]),
      ) as Record<RobotLinkId, typeof IDENTITY>,
      toolFrames: {
        flange: IDENTITY,
        tool: IDENTITY,
        tcp: IDENTITY,
      },
      linkEntities: LINK_IDS.map((linkId) => ({
        linkId,
        id: `robot-link:${linkId}` as const,
        name: linkId,
        boxes: [BOX],
        collisionActive: true,
      })),
      toolEntity: {
        id: 'tool:default',
        name: 'Tool',
        boxes: [BOX],
      },
    },
    heldObject: null,
    staticEntities: [
      {
        id: 'workcell:workbench',
        name: 'Workbench',
        category: 'environment',
        boxes: [BOX],
        worldMatrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1,
        ],
      },
    ],
    mountContactPairKey: 'robot-link:LINK00|workcell:workbench',
    policy: {
      enabled: true,
      warningDistanceM: 0.05,
      ignoredPairKeys: [],
      enabledRobotSelfPairs: [],
    },
  }
}

const FINDING: CollisionFinding = {
  pairKey: 'robot-link:LINK01|workcell:workbench',
  firstEntityId: 'robot-link:LINK01',
  secondEntityId: 'workcell:workbench',
  firstBoxId: 'default',
  secondBoxId: 'default',
  kind: 'collision',
  separationM: -0.01,
  sampleIndex: 3,
  timeMs: 150,
}

describe('collision validation protocol', () => {
  it('owns a serializable request and strips unknown runtime objects', () => {
    const candidate = request() as CollisionValidationRequest & {
      renderObject?: unknown
    }
    candidate.renderObject = { isObject3D: true, geometry: new ArrayBuffer(8) }

    const validated = validateCollisionValidationRequest(candidate)

    expect(validated).not.toBe(candidate)
    expect(validated).not.toHaveProperty('renderObject')
    expect(validated.robot.definition.joints).not.toBe(
      candidate.robot.definition.joints,
    )
    expect(validated.robot.linkEntities[0]).not.toBe(
      candidate.robot.linkEntities[0],
    )
    expect(
      (validated.robot.linkEntities[0] as unknown as { collisionActive: boolean })
        .collisionActive,
    ).toBe(true)
    expect(() => structuredClone(validated)).not.toThrow()
    expect(validated.mountContactPairKey).toBe(
      'robot-link:LINK00|workcell:workbench',
    )
  })

  it('requires and defensively owns each Robot Link collision participation flag', () => {
    const candidate = request() as unknown as {
      robot: { linkEntities: Array<Record<string, unknown>> }
      mountContactPairKey: string | null
    }
    candidate.robot.linkEntities[0]!.collisionActive = false
    candidate.mountContactPairKey = null

    const validated = validateCollisionValidationRequest(candidate)
    candidate.robot.linkEntities[0]!.collisionActive = true

    expect(
      (validated.robot.linkEntities[0] as unknown as { collisionActive: boolean })
        .collisionActive,
    ).toBe(false)
    expect(() =>
      validateCollisionValidationRequest({
        ...request(),
        robot: {
          ...request().robot,
          linkEntities: request().robot.linkEntities.map((link, index) =>
            index === 0 ? { ...link, collisionActive: 'yes' } : link,
          ),
        },
        mountContactPairKey: null,
      }),
    ).toThrow(/collision participation/i)
  })

  it('rejects malformed request identifiers, transforms, and incomplete Robot links', () => {
    expect(() =>
      validateCollisionValidationRequest({ ...request(), requestId: ' ' }),
    ).toThrow(/request id/i)
    expect(() =>
      validateCollisionValidationRequest({
        ...request(),
        robot: {
          ...request().robot,
          rootPose: { ...IDENTITY, scale: [1, Number.NaN, 1] },
        },
      }),
    ).toThrow(/root pose/i)
    expect(() =>
      validateCollisionValidationRequest({
        ...request(),
        robot: {
          ...request().robot,
          linkEntities: request().robot.linkEntities.slice(0, 6),
        },
      }),
    ).toThrow(/seven Robot Link/i)
    expect(() => validateCollisionValidationRequest({
      ...request(),
      mountContactPairKey: 'robot-link:LINK00|missing',
    })).toThrow(/mount contact/i)
  })

  it('validates bounded progress records', () => {
    expect(
      validateCollisionValidationProgress({
        requestId: 'validation-1',
        revision: 'scene-7',
        processedSamples: 250,
        totalSamples: 1_000,
      }),
    ).toEqual({
      requestId: 'validation-1',
      revision: 'scene-7',
      processedSamples: 250,
      totalSamples: 1_000,
    })
    expect(() =>
      validateCollisionValidationProgress({
        requestId: 'validation-1',
        revision: 'scene-7',
        processedSamples: 1_001,
        totalSamples: 1_000,
      }),
    ).toThrow(/processed samples/i)
  })

  it('caps findings at 10,000 and marks the result truncated', () => {
    const result = validateCollisionValidationResult({
      requestId: 'validation-1',
      revision: 'scene-7',
      mode: 'validate',
      sampleCount: 20_000,
      durationMs: 4_000,
      findings: Array.from(
        { length: MAX_COLLISION_VALIDATION_FINDINGS + 1 },
        () => FINDING,
      ),
      mountContact: {
        pairKey: 'robot-link:LINK00|workcell:workbench',
        state: 'contact',
      },
      truncated: false,
    })

    expect(result.findings).toHaveLength(MAX_COLLISION_VALIDATION_FINDINGS)
    expect(result.truncated).toBe(true)
  })

  it('does not validate findings beyond the owned 10,000-result cap', () => {
    const result = validateCollisionValidationResult({
      requestId: 'validation-1',
      revision: 'scene-7',
      mode: 'validate',
      sampleCount: 20_000,
      durationMs: 4_000,
      findings: [
        ...Array.from(
          { length: MAX_COLLISION_VALIDATION_FINDINGS },
          () => FINDING,
        ),
        { invalid: true },
      ],
      mountContact: {
        pairKey: 'robot-link:LINK00|workcell:workbench',
        state: 'contact',
      },
      truncated: false,
    })

    expect(result.findings).toHaveLength(MAX_COLLISION_VALIDATION_FINDINGS)
    expect(result.truncated).toBe(true)
  })

  it('rejects results with inconsistent metadata', () => {
    expect(() =>
      validateCollisionValidationResult({
        requestId: 'validation-1',
        revision: 'scene-7',
        mode: 'validate',
        sampleCount: 2,
        durationMs: 100,
        findings: [{ ...FINDING, sampleIndex: 2 }],
        mountContact: {
          pairKey: 'robot-link:LINK00|workcell:workbench',
          state: 'contact',
        },
        truncated: false,
      }),
    ).toThrow(/sample index/i)
  })
})

const IDENTITY_V4 = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
} as const

function definitionV4(
  id: string,
  jointTypes: readonly ('revolute' | 'prismatic')[],
): RobotDefinitionV4 {
  const links = Array.from({ length: jointTypes.length + 1 }, (_, index) => ({
    id: `link-${index}`,
    name: `${id} Link ${index}`,
    geometryOccurrences: index === 0 ? [{
      occurrenceKey: `${id}-geometry`,
      assetReferenceId: `${id}-asset`,
      linkLocalPose: IDENTITY_V4,
      statistics: { vertices: 0, triangles: 0, meshes: 0, materials: 0 },
      collisionBoxes: [{
        id: 'main', centerM: [0, 0, 0] as const,
        halfExtentsM: [0.2, 0.2, 0.2] as const,
        quaternion: [0, 0, 0, 1] as const,
      }],
    }] : [],
  }))
  return {
    id,
    name: id,
    manufacturer: 'Test',
    model: 'Variable',
    assetReferenceIds: [`${id}-asset`],
    sourceConventions: {
      [`${id}-asset`]: {
        linearUnit: 'meter', sourceToMeters: 1,
        orientation: { mode: 'up-axis', upAxis: 'z' },
      },
    },
    links,
    joints: jointTypes.map((type, index) => ({
      id: `joint-${index}`,
      type,
      parentLinkId: `link-${index}`,
      childLinkId: `link-${index + 1}`,
      origin: IDENTITY_V4,
      axis: type === 'revolute' ? [0, 0, 1] as const : [1, 0, 0] as const,
      min: type === 'revolute' ? -180 : 0,
      max: type === 'revolute' ? 180 : 1,
      home: 0,
      zeroOffset: 0,
      direction: 1 as const,
      maximumVelocity: type === 'revolute' ? 90 : 1,
    })),
    frames: [],
    excludedGeometryOccurrenceKeys: [],
  }
}

const DEFINITION_A_V4 = definitionV4('definition-a', ['revolute'])
const DEFINITION_B_V4 = definitionV4('definition-b', ['revolute', 'prismatic'])

function proxyV4(id: string, effectiveVisible = true): CollisionGeometryProxyV4 {
  return {
    effectiveVisible,
    entity: {
      id: spatialEntityCollisionIdV4(id),
      name: id,
      category: 'spatial-entity',
      worldMatrix: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
      boxes: [{
        id: 'main', center: [0, 0, 0], halfExtents: [0.1, 0.1, 0.1],
        quaternion: [0, 0, 0, 1],
      }],
    },
  }
}

function requestV4(): CollisionValidationRequestV4 {
  const policy: CollisionPolicyV4 = {
    enabled: true,
    nearMissMarginM: 0,
    excludedPairKeys: new Set(),
    intentionalMountPairKeys: new Set(),
    ignoredContactPairKeys: new Set(),
  }
  return {
    requestId: 'request-v4',
    revision: 'revision-v4',
    mode: 'validate',
    definitions: [DEFINITION_A_V4, DEFINITION_B_V4],
    robotPlacements: [
      { robotId: 'robot-a', worldBasePose: IDENTITY_V4, effectiveVisible: true },
      { robotId: 'robot-b', worldBasePose: IDENTITY_V4, effectiveVisible: true },
    ],
    sequence: [
      {
        sampleIndex: 0,
        timeMs: 0,
        robots: [
          { robotId: 'robot-b', definitionId: 'definition-b', jointValues: {
            'joint-0': 0, 'joint-1': 0,
          } },
          { robotId: 'robot-a', definitionId: 'definition-a', jointValues: {
            'joint-0': 0,
          } },
        ],
      },
      {
        sampleIndex: 1,
        timeMs: 100,
        robots: [
          { robotId: 'robot-a', definitionId: 'definition-a', jointValues: {
            'joint-0': 10,
          } },
          { robotId: 'robot-b', definitionId: 'definition-b', jointValues: {
            'joint-0': 10, 'joint-1': 0.2,
          } },
        ],
      },
    ],
    staticProxies: [proxyV4('fixture')],
    policy: collisionPolicyToWireV4(policy),
  }
}

describe('collision validation protocol v4', () => {
  it('encodes policy Sets as sorted duplicate-free arrays and recreates distinct Sets', () => {
    const first = canonicalCollisionPairKeyV4(
      robotLinkCollisionIdV4('robot-b', 'root'),
      spatialEntityCollisionIdV4('z'),
    )
    const second = canonicalCollisionPairKeyV4(
      robotLinkCollisionIdV4('robot-a', 'root'),
      spatialEntityCollisionIdV4('a'),
    )
    const policy: CollisionPolicyV4 = {
      enabled: true,
      nearMissMarginM: 0.05,
      excludedPairKeys: new Set([first, second]),
      intentionalMountPairKeys: new Set([second]),
      ignoredContactPairKeys: new Set(),
    }
    const wire = collisionPolicyToWireV4(policy)
    expect(wire.excludedPairKeys).toEqual([second, first].sort())
    const decoded = collisionPolicyFromWireV4(wire)
    expect(decoded.excludedPairKeys).toEqual(new Set([first, second]))
    expect(decoded.excludedPairKeys).not.toBe(policy.excludedPairKeys)
    expect(decoded.excludedPairKeys).not.toBe(decoded.intentionalMountPairKeys)
    expect(decoded.intentionalMountPairKeys).not.toBe(decoded.ignoredContactPairKeys)
  })

  it('rejects duplicate, unsorted, and malformed wire pair arrays', () => {
    const pair = canonicalCollisionPairKeyV4(
      robotLinkCollisionIdV4('robot-a', 'root'),
      spatialEntityCollisionIdV4('fixture'),
    )
    const later = canonicalCollisionPairKeyV4(
      robotLinkCollisionIdV4('robot-z', 'root'),
      spatialEntityCollisionIdV4('fixture'),
    )
    const wire = requestV4().policy
    expect(() => collisionPolicyFromWireV4({
      ...wire, excludedPairKeys: [pair, pair],
    })).toThrow(/duplicate|sorted/i)
    expect(() => collisionPolicyFromWireV4({
      ...wire, excludedPairKeys: [later, pair],
    })).toThrow(/sorted/i)
    expect(() => collisionPolicyFromWireV4({
      ...wire, excludedPairKeys: ['robot-link:robot:root|spatial-entity:上'],
    })).toThrow(/canonical/i)
    expect(() => collisionPolicyFromWireV4({
      ...wire, ignoredContactPairKeys: undefined,
    })).toThrow(/array/i)
    expect(() => collisionPolicyFromWireV4({
      ...wire, intentionalMountPairKeys: new Set(),
    })).toThrow(/array/i)
  })

  it('owns wire arrays and decoded Sets across caller mutation', () => {
    const pair = canonicalCollisionPairKeyV4(
      robotLinkCollisionIdV4('robot-a', 'root'),
      spatialEntityCollisionIdV4('fixture'),
    )
    const mutable = {
      ...requestV4().policy,
      excludedPairKeys: [pair],
    }
    const decoded = collisionPolicyFromWireV4(mutable)
    mutable.excludedPairKeys.length = 0
    expect(decoded.excludedPairKeys).toEqual(new Set([pair]))

    const source = new Set([pair])
    const wire = collisionPolicyToWireV4({
      enabled: true,
      nearMissMarginM: 0,
      excludedPairKeys: source,
      intentionalMountPairKeys: new Set(),
      ignoredContactPairKeys: new Set(),
    })
    source.clear()
    expect(wire.excludedPairKeys).toEqual([pair])
  })

  it('accepts heterogeneous Robots and sample Robot sets in any order', () => {
    const candidate = requestV4()
    const validated = validateCollisionValidationRequestV4(candidate)

    expect(validated.sequence).toHaveLength(2)
    expect(validated.sequence[0]?.robots.map(({ robotId }) => robotId)).toEqual([
      'robot-b', 'robot-a',
    ])
    expect(validated.definitions[0]).not.toBe(candidate.definitions[0])
    expect(() => structuredClone(validated)).not.toThrow()
  })

  it('owns prototype-shaped Robot and Definition identities without aliasing', () => {
    const definition = { ...DEFINITION_A_V4, id: 'constructor' }
    const candidate: CollisionValidationRequestV4 = {
      ...requestV4(),
      definitions: [definition],
      robotPlacements: [{
        robotId: '__proto__', worldBasePose: IDENTITY_V4, effectiveVisible: true,
      }],
      sequence: [{
        sampleIndex: 0,
        timeMs: 0,
        robots: [{
          robotId: '__proto__',
          definitionId: 'constructor',
          jointValues: { 'joint-0': 0 },
        }],
      }],
      staticProxies: [],
    }
    const validated = validateCollisionValidationRequestV4(candidate)
    expect(validated.robotPlacements[0]?.robotId).toBe('__proto__')
    expect(validated.sequence[0]?.robots[0]?.definitionId).toBe('constructor')
  })

  it('requires exact literal Joint keys with finite in-limit values', () => {
    const base = requestV4()
    const first = base.sequence[0]!
    const robotB = first.robots[0]!
    for (const jointValues of [
      { 'joint-0': 0 },
      { 'joint-0': 0, 'joint-1': 0, extra: 0 },
      { 'joint-0': 0, 'joint-1': Number.NaN },
      { 'joint-0': 0, 'joint-1': 2 },
    ]) {
      expect(() => validateCollisionValidationRequestV4({
        ...base,
        sequence: [{
          ...first,
          robots: [{ ...robotB, jointValues }, first.robots[1]!],
        }],
      })).toThrow(/joint|limit|finite|key/i)
    }
  })

  it('rejects duplicate identities and inconsistent Robot sets or Definition ids', () => {
    const base = requestV4()
    expect(() => validateCollisionValidationRequestV4({
      ...base, definitions: [base.definitions[0]!, base.definitions[0]!],
    })).toThrow(/duplicate.*definition/i)
    expect(() => validateCollisionValidationRequestV4({
      ...base, robotPlacements: [base.robotPlacements[0]!, base.robotPlacements[0]!],
    })).toThrow(/duplicate.*robot/i)
    expect(() => validateCollisionValidationRequestV4({
      ...base,
      sequence: [{
        ...base.sequence[0]!,
        robots: [base.sequence[0]!.robots[0]!, base.sequence[0]!.robots[0]!],
      }],
    })).toThrow(/duplicate.*robot/i)
    expect(() => validateCollisionValidationRequestV4({
      ...base,
      sequence: [base.sequence[0]!, {
        ...base.sequence[1]!, robots: [base.sequence[1]!.robots[0]!],
      }],
    })).toThrow(/robot.*set/i)
    expect(() => validateCollisionValidationRequestV4({
      ...base,
      sequence: [{
        ...base.sequence[0]!,
        robots: [{ ...base.sequence[0]!.robots[0]!, definitionId: 'definition-a' },
          base.sequence[0]!.robots[1]!],
      }],
    })).toThrow(/definition/i)
    expect(() => validateCollisionValidationRequestV4({
      ...base,
      robotPlacements: [
        ...base.robotPlacements,
        { robotId: 'robot-unknown', worldBasePose: IDENTITY_V4, effectiveVisible: true },
      ],
    })).toThrow(/robot.*set|placement/i)
  })

  it('requires contiguous zero-based indices and finite nondecreasing times', () => {
    const base = requestV4()
    for (const sequence of [
      [{ ...base.sequence[0]!, sampleIndex: 1 }],
      [base.sequence[0]!, { ...base.sequence[1]!, sampleIndex: 2 }],
      [{ ...base.sequence[0]!, timeMs: -1 }],
      [base.sequence[0]!, { ...base.sequence[1]!, timeMs: -1 }],
    ]) {
      expect(() => validateCollisionValidationRequestV4({
        ...base, sequence,
      })).toThrow(/sample ind(?:ex|ices)|time/i)
    }
    expect(() => validateCollisionValidationRequestV4({
      ...base,
      sequence: [base.sequence[0]!, { ...base.sequence[1]!, timeMs: 0 }],
    })).not.toThrow()
  })

  it('accepts one and sixteen literal Joint keys including prototype names', () => {
    const one = definitionV4('definition-prototype', ['revolute'])
    const prototypeJoint = {
      ...one.joints[0]!,
      id: '__proto__',
    }
    const withPrototype = { ...one, joints: [prototypeJoint] }
    const sixteen = definitionV4('definition-sixteen', Array.from(
      { length: 16 },
      (_, index) => index === 15 ? 'prismatic' as const : 'revolute' as const,
    ))
    const state = (definition: RobotDefinitionV4, robotId: string) => ({
      robotId,
      definitionId: definition.id,
      jointValues: Object.fromEntries(definition.joints.map(({ id }) => [id, 0])),
    })
    const candidate: CollisionValidationRequestV4 = {
      ...requestV4(),
      definitions: [withPrototype, sixteen],
      robotPlacements: [
        { robotId: 'prototype', worldBasePose: IDENTITY_V4, effectiveVisible: true },
        { robotId: 'sixteen', worldBasePose: IDENTITY_V4, effectiveVisible: true },
      ],
      sequence: [{
        sampleIndex: 0,
        timeMs: 0,
        robots: [state(sixteen, 'sixteen'), state(withPrototype, 'prototype')],
      }],
      staticProxies: [],
    }
    const validated = validateCollisionValidationRequestV4(candidate)
    expect(Object.hasOwn(
      validated.sequence[0]!.robots[1]!.jointValues,
      '__proto__',
    )).toBe(true)
    expect(Object.keys(validated.sequence[0]!.robots[0]!.jointValues)).toHaveLength(16)
  })

  it('rejects duplicate static proxy ids while preserving hidden proxies on the wire', () => {
    const base = requestV4()
    const hidden = proxyV4('hidden', false)
    expect(validateCollisionValidationRequestV4({
      ...base, staticProxies: [hidden],
    }).staticProxies[0]?.effectiveVisible).toBe(false)
    expect(() => validateCollisionValidationRequestV4({
      ...base, staticProxies: [hidden, hidden],
    })).toThrow(/duplicate.*static|duplicate.*collision/i)
  })

  it('rejects missing and non-array V4 request collections', () => {
    const base = requestV4() as unknown as Record<string, unknown>
    for (const [key, value] of [
      ['definitions', undefined],
      ['robotPlacements', {}],
      ['sequence', null],
      ['staticProxies', new Set()],
    ] as const) {
      expect(() => validateCollisionValidationRequestV4({
        ...base, [key]: value,
      })).toThrow(/array/i)
    }
  })

  it('accepts exactly 20,000 pre-sampled states and rejects the 20,001st', () => {
    const base = requestV4()
    const robot = base.sequence[0]!.robots.find(({ robotId }) => robotId === 'robot-a')!
    const compact = {
      ...base,
      definitions: [DEFINITION_A_V4],
      robotPlacements: [base.robotPlacements[0]!],
      staticProxies: [],
      sequence: Array.from({ length: 20_000 }, (_, index) => ({
        sampleIndex: index,
        timeMs: index,
        robots: [robot],
      })),
    }
    expect(validateCollisionValidationRequestV4(compact).sequence).toHaveLength(20_000)
    expect(() => validateCollisionValidationRequestV4({
      ...compact,
      sequence: [...compact.sequence, {
        sampleIndex: 20_000, timeMs: 20_000, robots: [robot],
      }],
    })).toThrow(/sample cap/i)
  })
})
