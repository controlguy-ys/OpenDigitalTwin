import { describe, expect, it } from 'vitest'
import type { JointAnglesDeg } from '../../domain/robot/joint-frame'
import { CRB15000_DEFINITION, type RobotLinkId } from '../../domain/robot/crb15000'
import type { RobotKeyframe, RobotKeyframeEasing } from '../joints/keyframes'
import {
  MAX_COLLISION_VALIDATION_FINDINGS,
  type CollisionValidationRequest,
  type CollisionValidationWorkerEvent,
} from './collision-validation-protocol'
import {
  createCollisionValidationWorkerHandler,
  runCollisionValidation,
} from './collision-validation.worker'
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
