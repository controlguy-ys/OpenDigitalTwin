import { describe, expect, it } from 'vitest'
import type { RobotDefinitionV4 } from '../../core/project-v4/types'
import {
  canonicalCollisionPairKeyV4,
  robotAdjacencyPairKeysV4,
  robotLinkCollisionIdV4,
  spatialEntityCollisionIdV4,
} from '../../core/robot-runtime/collision-identity'
import { computeSerialRobotPoseV4 } from '../../core/robot-runtime/serial-kinematics'
import type { CollisionPolicyV4 } from '../../domain/collision/collision'
import { queryGeometryCollisionsV4 } from '../../domain/collision/query-collision'
import type { JointAnglesDeg } from '../../domain/robot/joint-frame'
import { CRB15000_DEFINITION, type RobotLinkId } from '../../domain/robot/crb15000'
import type { RobotKeyframe, RobotKeyframeEasing } from '../joints/keyframes'
import {
  MAX_COLLISION_VALIDATION_FINDINGS,
  collisionPolicyFromWireV4,
  collisionPolicyToWireV4,
  type CollisionValidationRequestV4,
  type CollisionValidationRequest,
  type CollisionValidationWorkerEvent,
} from './collision-validation-protocol'
import {
  createCollisionValidationWorkerHandler,
  runCollisionValidation,
  runCollisionValidationV4,
} from './collision-validation.worker'
import {
  robotLinkCollisionProxiesV4,
  visibleCollisionEntitiesV4,
  type CollisionGeometryProxyV4,
} from './scene-entity-adapter'
import { sampleJointSequence } from './validate-pose-sequence'

function pose(
  id: string,
  jointOneDeg: number,
  durationMs = 1_000,
  easing: RobotKeyframeEasing = 'linear',
): RobotKeyframe {
  return {
    id,
    name: id,
    anglesDeg: [jointOneDeg, 0, 0, 0, 0, 0] as JointAnglesDeg,
    durationMs,
    easing,
  }
}

function maximumJointStep(
  samples: readonly { readonly anglesDeg: JointAnglesDeg }[],
): number {
  let maximum = 0
  for (let sampleIndex = 1; sampleIndex < samples.length; sampleIndex += 1) {
    const previous = samples[sampleIndex - 1]!
    const current = samples[sampleIndex]!
    for (let jointIndex = 0; jointIndex < 6; jointIndex += 1) {
      maximum = Math.max(
        maximum,
        Math.abs(current.anglesDeg[jointIndex]! - previous.anglesDeg[jointIndex]!),
      )
    }
  }
  return maximum
}

describe('sampleJointSequence', () => {
  it('limits Preview samples to a two degree maximum Joint delta', () => {
    const result = sampleJointSequence([pose('start', 0), pose('end', 5)], 'preview')

    expect(result.samples).toHaveLength(4)
    expect(maximumJointStep(result.samples)).toBeLessThanOrEqual(2)
    expect(result.samples[0]).toEqual({
      sampleIndex: 0,
      timeMs: 0,
      anglesDeg: [0, 0, 0, 0, 0, 0],
    })
    expect(result.samples.at(-1)).toEqual({
      sampleIndex: 3,
      timeMs: 1_000,
      anglesDeg: [5, 0, 0, 0, 0, 0],
    })
  })

  it('limits Validate samples to a half-degree maximum Joint delta', () => {
    const result = sampleJointSequence([pose('start', 0), pose('end', 2)], 'validate')

    expect(result.samples).toHaveLength(5)
    expect(maximumJointStep(result.samples)).toBeLessThanOrEqual(0.5)
    expect(result.samples.map(({ timeMs }) => timeMs)).toEqual([
      0, 250, 500, 750, 1_000,
    ])
  })

  it('derives exact timestamps and angles from duration and easing', () => {
    const result = sampleJointSequence(
      [pose('start', 0, 900, 'easeInOut'), pose('end', 5)],
      'preview',
    )

    expect(result.samples.map(({ timeMs }) => timeMs)).toEqual([
      0, 225, 450, 675, 900,
    ])
    expect(result.samples.map(({ anglesDeg }) => anglesDeg[0])).toEqual([
      0,
      0.78125,
      2.5,
      4.21875,
      5,
    ])
    expect(maximumJointStep(result.samples)).toBeLessThanOrEqual(2)
  })

  it('includes every segment endpoint exactly once', () => {
    const result = sampleJointSequence(
      [pose('a', 0, 600), pose('b', 4, 400), pose('c', 0)],
      'preview',
    )

    expect(result.samples.filter(({ timeMs }) => timeMs === 600)).toEqual([
      {
        sampleIndex: 2,
        timeMs: 600,
        anglesDeg: [4, 0, 0, 0, 0, 0],
      },
    ])
    expect(result.samples.at(-1)).toMatchObject({
      timeMs: 1_000,
      anglesDeg: [0, 0, 0, 0, 0, 0],
    })
  })

  it('is deterministic across repeated sampling', () => {
    const sequence = [
      pose('a', -3, 321, 'easeInOut'),
      pose('b', 7, 654, 'linear'),
      pose('c', -1),
    ]

    expect(sampleJointSequence(sequence, 'validate')).toEqual(
      sampleJointSequence(sequence, 'validate'),
    )
  })

  it('preserves the elapsed duration of a zero-motion segment', () => {
    const result = sampleJointSequence(
      [pose('pause-start', 12, 750), pose('pause-end', 12)],
      'preview',
    )

    expect(result).toMatchObject({
      truncated: false,
      totalDurationMs: 750,
      samples: [
        { sampleIndex: 0, timeMs: 0, anglesDeg: [12, 0, 0, 0, 0, 0] },
        { sampleIndex: 1, timeMs: 750, anglesDeg: [12, 0, 0, 0, 0, 0] },
      ],
    })
  })

  it('truly truncates at 20,000 samples without replacing the last sample', () => {
    const result = sampleJointSequence(
      [pose('start', 0, 1_000), pose('far-end', 10_000.5)],
      'validate',
    )

    expect(result.samples).toHaveLength(20_000)
    expect(result.truncated).toBe(true)
    expect(result.samples.at(-1)?.sampleIndex).toBe(19_999)
    expect(result.samples.at(-1)?.timeMs).toBeLessThan(1_000)
    expect(result.samples.at(-1)?.anglesDeg[0]).toBeLessThan(10_000.5)
  })
})

const LINK_IDS: readonly RobotLinkId[] = [
  'LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06',
]
const IDENTITY = {
  position: [0, 0, 0] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
}

function validationRequest(
  sequence: readonly RobotKeyframe[],
  mode: CollisionValidationRequest['mode'] = 'preview',
  linkHalfExtents: [number, number, number] = [0.02, 0.02, 0.02],
): CollisionValidationRequest {
  const linkEntities = LINK_IDS.map((linkId) => ({
    linkId,
    id: `robot-link:${linkId}` as const,
    name: linkId,
    collisionActive: true,
    boxes: [{
      id: 'default',
      center: [0, 0, 0] as [number, number, number],
      halfExtents: linkHalfExtents,
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
    }],
  }))
  return {
    requestId: 'worker-validation-1',
    revision: 'runtime-1',
    mode,
    sequence,
    robot: {
      definition: CRB15000_DEFINITION,
      rootPose: IDENTITY,
      geometryTransforms: Object.fromEntries(
        LINK_IDS.map((linkId) => [linkId, IDENTITY]),
      ) as Record<RobotLinkId, typeof IDENTITY>,
      toolFrames: { flange: IDENTITY, tool: IDENTITY, tcp: IDENTITY },
      linkEntities,
      toolEntity: null,
    },
    heldObject: {
      id: 'object:held-cup',
      name: 'Held cup',
      boxes: [{
        id: 'default',
        center: [0, 0, 0],
        halfExtents: [0.04, 0.04, 0.04],
        quaternion: [0, 0, 0, 1],
      }],
      tcpLocalTransform: {
        position: [0.3, 0, 0],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    },
    staticEntities: [
      {
        id: 'workcell:workbench',
        name: 'Workbench',
        category: 'environment',
        boxes: [{
          id: 'top',
          center: [0, 0, 0.338],
          halfExtents: [0.03, 0.03, 0.03],
          quaternion: [0, 0, 0, 1],
        }],
        worldMatrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1,
        ],
      },
      {
        id: 'equipment:fixture',
        name: 'Fixture',
        category: 'equipment',
        boxes: [{
          id: 'default',
          center: [0.935, 0, 1.235],
          halfExtents: [0.04, 0.04, 0.04],
          quaternion: [0, 0, 0, 1],
        }],
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
      warningDistanceM: 0,
      ignoredPairKeys: [],
      enabledRobotSelfPairs: [],
    },
  }
}

describe('runCollisionValidation', () => {
  it('leaves configured mount contact unavailable when collision policy is disabled', async () => {
    const request = validationRequest([pose('start', 0), pose('end', 0)])
    const result = await runCollisionValidation({
      ...request,
      policy: { ...request.policy, enabled: false },
    })

    expect(result?.mountContact).toBeNull()
  })

  it('keeps the Project V3 absolute Robot root aligned with a held/static probe', async () => {
    const baseRequest = validationRequest([
      pose('start', -249.75, 2_775),
      pose('end', 249.75),
    ], 'validate')
    const request = {
      ...baseRequest,
      mountContactPairKey: null,
      policy: { ...baseRequest.policy, warningDistanceM: 0.05 },
      robot: {
        ...baseRequest.robot,
        rootPose: {
          ...baseRequest.robot.rootPose,
          position: [0, 0, 1.08] as [number, number, number],
        },
        linkEntities: baseRequest.robot.linkEntities.map((link) => ({
          ...link,
          collisionActive: false,
        })),
      },
      heldObject: {
        id: 'object:collision-fixture' as const,
        name: 'Collision Fixture',
        boxes: [{
          id: 'worker-00',
          center: [0, 0, 0] as [number, number, number],
          halfExtents: [0.02, 0.02, 0.02] as [number, number, number],
          quaternion: [0, 0, 0, 1] as [number, number, number, number],
        }],
        tcpLocalTransform: {
          position: [0, 0, 0.09] as [number, number, number],
          quaternion: [
            0,
            -Math.SQRT1_2,
            0,
            Math.SQRT1_2,
          ] as [number, number, number, number],
          scale: [1, 1, 1] as [number, number, number],
        },
      },
      staticEntities: [{
        id: 'object:collision-worker-load-00' as const,
        name: 'Collision Worker Load 1',
        category: 'object' as const,
        boxes: [{
          id: 'worker-00',
          center: [0, 0, 0] as [number, number, number],
          halfExtents: [0.02, 0.02, 0.02] as [number, number, number],
          quaternion: [0, 0, 0, 1] as [number, number, number, number],
        }],
        worldMatrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          0.725, 0, 2.315, 1,
        ],
      }],
    }

    const aligned = await runCollisionValidation(request)
    const doubleMounted = await runCollisionValidation({
      ...request,
      robot: {
        ...request.robot,
        rootPose: { ...request.robot.rootPose, position: [0, 0, 2.16] },
      },
    })
    const alignedPair = aligned?.findings.filter(
      ({ pairKey }) =>
        pairKey ===
        'object:collision-fixture|object:collision-worker-load-00',
    ) ?? []

    expect(alignedPair.length).toBeGreaterThan(0)
    expect(alignedPair.every(({ sampleIndex, timeMs }) =>
      sampleIndex !== null && sampleIndex > 400 && sampleIndex < 600 &&
      timeMs !== null && timeMs > 1_200 && timeMs < 1_600,
    )).toBe(true)
    expect(doubleMounted?.findings).toEqual([])
  })

  it('reports the configured mount pair separately from sequence findings', async () => {
    const baseRequest = validationRequest([pose('start', 0), pose('end', 0)])
    const mountSurface = {
      ...baseRequest.staticEntities[0]!,
      id: 'equipment:mount-plate' as const,
      category: 'equipment' as const,
      boxes: [{
        id: 'mount',
        center: [0, 0, 0] as [number, number, number],
        halfExtents: [0.05, 0.05, 0.05] as [number, number, number],
        quaternion: [0, 0, 0, 1] as [number, number, number, number],
      }],
    }
    const request = {
      ...baseRequest,
      heldObject: null,
      mountContactPairKey: 'equipment:mount-plate|robot-link:LINK00',
      staticEntities: [mountSurface],
      robot: {
        ...baseRequest.robot,
        linkEntities: baseRequest.robot.linkEntities.map((link) => ({
          ...link,
          collisionActive: link.linkId === 'LINK00',
        })),
      },
    }

    const result = await runCollisionValidation(request)

    expect(result?.findings).toEqual([])
    expect(result?.mountContact).toEqual({
      pairKey: 'equipment:mount-plate|robot-link:LINK00',
      state: 'contact',
    })
  })

  it('keeps all seven FK links but excludes an inactive colliding Link proxy', async () => {
    const baseRequest = validationRequest([
      pose('start', 0),
      pose('end', 0),
    ])
    const staticEntity = {
      id: 'equipment:link-probe' as const,
      name: 'Link probe',
      category: 'equipment' as const,
      boxes: [{
        id: 'origin',
        center: [0, 0, 0] as [number, number, number],
        halfExtents: [0.01, 0.01, 0.01] as [number, number, number],
        quaternion: [0, 0, 0, 1] as [number, number, number, number],
      }],
      worldMatrix: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
    }
    const withLinkParticipation = (collisionActive: boolean) => ({
      ...baseRequest,
      mountContactPairKey: null,
      heldObject: null,
      staticEntities: [staticEntity],
      robot: {
        ...baseRequest.robot,
        linkEntities: baseRequest.robot.linkEntities.map((link) => ({
          ...link,
          collisionActive: link.linkId === 'LINK00' ? collisionActive : false,
        })),
      },
    })

    expect(withLinkParticipation(false).robot.linkEntities).toHaveLength(7)
    const hiddenResult = await runCollisionValidation(
      withLinkParticipation(false),
    )
    const visibleResult = await runCollisionValidation(
      withLinkParticipation(true),
    )

    expect(hiddenResult?.findings).toEqual([])
    expect(visibleResult?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pairKey: 'equipment:link-probe|robot-link:LINK00',
        }),
      ]),
    )
  })

  it('recomputes a TCP-held Object and includes Workbench findings with sample metadata', async () => {
    const request = validationRequest([
      pose('start', 0, 1_000),
      pose('end', 90),
    ])

    const result = await runCollisionValidation(request)

    expect(result).not.toBeNull()
    expect(result?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pairKey: 'equipment:fixture|object:held-cup',
          sampleIndex: 0,
          timeMs: 0,
        }),
        expect.objectContaining({
          pairKey: 'robot-link:LINK01|workcell:workbench',
          sampleIndex: expect.any(Number),
          timeMs: expect.any(Number),
        }),
      ]),
    )
    expect(result?.findings.every(({ sampleIndex, timeMs }) =>
      sampleIndex !== null && timeMs !== null,
    )).toBe(true)
  })

  it('posts progress every 250 samples and cancels only at a boundary', async () => {
    const request = validationRequest(
      [pose('start', -270, 1_000), pose('end', 270)],
      'validate',
    )
    const progress: number[] = []
    let cancelled = false

    const result = await runCollisionValidation(request, {
      isCancelled: () => cancelled,
      onProgress: ({ processedSamples }) => progress.push(processedSamples),
      yieldControl: () => {
        cancelled = true
        return Promise.resolve()
      },
    })

    expect(result).toBeNull()
    expect(progress).toEqual([250])
  })

  it('caps Worker findings at 10,000 and marks truncation', async () => {
    const request = validationRequest(
      [pose('start', 0, 1_000), pose('end', 1_000)],
      'validate',
      [10, 10, 10],
    )

    const result = await runCollisionValidation(request, {
      yieldControl: () => Promise.resolve(),
    })

    expect(result?.findings).toHaveLength(MAX_COLLISION_VALIDATION_FINDINGS)
    expect(result?.truncated).toBe(true)
  })

  it('handles validate and cancel Worker commands at a progress boundary', async () => {
    const request = validationRequest(
      [pose('start', -270, 1_000), pose('end', 270)],
      'validate',
    )
    const events: CollisionValidationWorkerEvent[] = []
    const handleCommand = createCollisionValidationWorkerHandler((event) =>
      events.push(event),
    )

    const execution = handleCommand({ type: 'validate', request })
    expect(events[0]).toMatchObject({
      type: 'progress',
      progress: { processedSamples: 250 },
    })
    await handleCommand({ type: 'cancel', requestId: request.requestId })
    await execution

    expect(events.at(-1)).toEqual({
      type: 'cancelled',
      requestId: request.requestId,
      revision: request.revision,
    })
  })
})

const IDENTITY_V4 = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
} as const

function workerDefinitionV4(
  id: string,
  jointTypes: readonly ('revolute' | 'prismatic')[],
): RobotDefinitionV4 {
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
    links: Array.from({ length: jointTypes.length + 1 }, (_, index) => ({
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
    })),
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

const WORKER_DEFINITION_A = workerDefinitionV4('definition-a', ['revolute'])
const WORKER_DEFINITION_B = workerDefinitionV4(
  'definition-b',
  ['revolute', 'prismatic'],
)

function workerPolicyV4(): CollisionPolicyV4 {
  return {
    enabled: true,
    nearMissMarginM: 0,
    excludedPairKeys: new Set([
      ...robotAdjacencyPairKeysV4('robot-a', WORKER_DEFINITION_A),
      ...robotAdjacencyPairKeysV4('robot-b', WORKER_DEFINITION_B),
    ]),
    intentionalMountPairKeys: new Set(),
    ignoredContactPairKeys: new Set(),
  }
}

function workerRequestV4(
  visibleA = true,
  visibleB = true,
): CollisionValidationRequestV4 {
  return {
    requestId: 'worker-v4',
    revision: 'revision-v4',
    mode: 'validate',
    definitions: [WORKER_DEFINITION_A, WORKER_DEFINITION_B],
    robotPlacements: [
      { robotId: 'robot-a', worldBasePose: IDENTITY_V4, effectiveVisible: visibleA },
      { robotId: 'robot-b', worldBasePose: IDENTITY_V4, effectiveVisible: visibleB },
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
    staticProxies: [],
    policy: collisionPolicyToWireV4(workerPolicyV4()),
  }
}

function staticProxyV4(id: string, effectiveVisible = true): CollisionGeometryProxyV4 {
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

describe('runCollisionValidationV4', () => {
  it('matches the direct heterogeneous-Robot query with stable sample metadata', async () => {
    const request = workerRequestV4()
    const firstSample = request.sequence[0]!
    const definitionById = new Map(request.definitions.map((value) => [value.id, value]))
    const placementById = new Map(request.robotPlacements.map((value) => [value.robotId, value]))
    const proxies = firstSample.robots.flatMap((state) => {
      const definition = definitionById.get(state.definitionId)!
      const placement = placementById.get(state.robotId)!
      const pose = computeSerialRobotPoseV4(
        definition,
        state.jointValues,
        placement.worldBasePose,
      )
      return robotLinkCollisionProxiesV4({
        robotId: state.robotId,
        definition,
        linkWorldPoses: pose.linkWorldPoses,
        effectiveVisible: placement.effectiveVisible,
      })
    })
    const direct = queryGeometryCollisionsV4(
      visibleCollisionEntitiesV4(proxies),
      collisionPolicyFromWireV4(request.policy),
      { sampleIndex: 0, timeMs: 0 },
    )
    const result = await runCollisionValidationV4(request)

    expect(result?.findings.filter(({ sampleIndex }) => sampleIndex === 0)).toEqual(direct)
    expect(result?.findings).toContainEqual(expect.objectContaining({
      pairKey: canonicalCollisionPairKeyV4(
        robotLinkCollisionIdV4('robot-a', 'link-0'),
        robotLinkCollisionIdV4('robot-b', 'link-0'),
      ),
      sampleIndex: 0,
      timeMs: 0,
    }))
    expect(result).toMatchObject({ sampleCount: 2, durationMs: 100, truncated: false })
  })

  it('removes hidden Robots and hidden static proxies before broad phase', async () => {
    const hiddenRobot = await runCollisionValidationV4(workerRequestV4(true, false))
    const base = workerRequestV4(false, false)
    const hiddenStatic = await runCollisionValidationV4({
      ...base,
      staticProxies: [staticProxyV4('first', true), staticProxyV4('second', false)],
    })

    expect(hiddenRobot?.findings).toEqual([])
    expect(hiddenStatic?.findings).toEqual([])
  })

  it('caps more than 10,000 worker findings without changing geometric results', async () => {
    const base = workerRequestV4(false, false)
    const result = await runCollisionValidationV4({
      ...base,
      sequence: [base.sequence[0]!],
      staticProxies: Array.from({ length: 142 }, (_, index) =>
        staticProxyV4(`entity-${index}`),
      ),
    })

    expect(result?.findings).toHaveLength(MAX_COLLISION_VALIDATION_FINDINGS)
    expect(result?.truncated).toBe(true)
    expect(result?.findings.every(({ sampleIndex, timeMs }) =>
      sampleIndex === 0 && timeMs === 0,
    )).toBe(true)
  })

  it('is deterministic under repeated requests and Robot input permutation', async () => {
    const request = workerRequestV4()
    const permuted: CollisionValidationRequestV4 = {
      ...request,
      definitions: [...request.definitions].reverse(),
      robotPlacements: [...request.robotPlacements].reverse(),
      sequence: request.sequence.map((sample) => ({
        ...sample,
        robots: [...sample.robots].reverse(),
      })),
    }
    const first = await runCollisionValidationV4(request)
    const repeated = await runCollisionValidationV4(request)
    const reordered = await runCollisionValidationV4(permuted)

    expect(repeated).toEqual(first)
    expect(reordered?.findings).toEqual(first?.findings)
  })

  it('treats 0 to 180 degrees as exactly two pre-sampled states', async () => {
    const base = workerRequestV4(false, false)
    const robotA = base.sequence[0]!.robots.find(({ robotId }) => robotId === 'robot-a')!
    const progress: number[] = []
    const result = await runCollisionValidationV4({
      ...base,
      definitions: [WORKER_DEFINITION_A],
      robotPlacements: [base.robotPlacements[0]!],
      sequence: [
        { sampleIndex: 0, timeMs: 0, robots: [robotA] },
        {
          sampleIndex: 1,
          timeMs: 1_000,
          robots: [{ ...robotA, jointValues: { 'joint-0': 180 } }],
        },
      ],
    }, {
      onProgress: ({ processedSamples }) => progress.push(processedSamples),
    })

    expect(result).toMatchObject({ sampleCount: 2, durationMs: 1_000 })
    expect(progress).toEqual([2])
  })

  it('lets a timer cancellation run at the first default yield boundary', async () => {
    const base = workerRequestV4(false, false)
    const firstSample = base.sequence[0]!
    const progress: number[] = []
    let cancelled = false
    const cancellationSignal = new Promise<void>((resolve) => {
      setTimeout(() => {
        cancelled = true
        resolve()
      }, 0)
    })

    const result = await runCollisionValidationV4({
      ...base,
      sequence: Array.from({ length: 250 }, (_, sampleIndex) => ({
        ...firstSample,
        sampleIndex,
        timeMs: sampleIndex,
      })),
    }, {
      isCancelled: () => cancelled,
      onProgress: ({ processedSamples }) => progress.push(processedSamples),
    })
    await cancellationSignal

    expect(result).toBeNull()
    expect(progress).toEqual([250])
  })
})
