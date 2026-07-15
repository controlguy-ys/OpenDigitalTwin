import { describe, expect, it } from 'vitest'
import type {
  CollisionBox,
  GeometryCollisionEntity,
} from '../../domain/collision/collision'
import {
  queryGeometryCollisionsWithTelemetry,
} from '../../domain/collision/query-collision'
import {
  CRB15000_DEFINITION,
  type RobotLinkId,
} from '../../domain/robot/crb15000'
import type { CollisionValidationRequest } from './collision-validation-protocol'
import { runCollisionValidation } from './collision-validation.worker'
import { CurrentPoseCollisionScheduler } from './current-pose-collision'

const LINK_IDS = [
  'LINK00',
  'LINK01',
  'LINK02',
  'LINK03',
  'LINK04',
  'LINK05',
  'LINK06',
] as const satisfies readonly RobotLinkId[]

const IDENTITY_MATRIX = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const
const IDENTITY_TRANSFORM = {
  position: [0, 0, 0] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
}
const BOX: CollisionBox = {
  id: 'default',
  center: [0, 0, 0],
  halfExtents: [0.02, 0.02, 0.02],
  quaternion: [0, 0, 0, 1],
}

function translatedMatrix(x: number, y: number, z: number): readonly number[] {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ]
}

function referenceEntities(): readonly GeometryCollisionEntity[] {
  const robot = LINK_IDS.map((linkId, index) => ({
    id: `robot-link:${linkId}` as const,
    name: linkId,
    category: 'robot-link' as const,
    boxes: [BOX],
    worldMatrix: translatedMatrix(index * 0.25, 0, 0),
  }))
  const tool: GeometryCollisionEntity = {
    id: 'tool:default',
    name: 'Tool',
    category: 'tool',
    boxes: [BOX],
    worldMatrix: translatedMatrix(1.75, 0, 0),
  }
  const externals = Array.from({ length: 50 }, (_, index) => ({
    id: `object:external-${index.toString().padStart(2, '0')}` as const,
    name: `External ${index}`,
    category: 'object' as const,
    boxes: [BOX],
    worldMatrix: translatedMatrix(index * 0.25, index < 3 ? 0.06 : 2, 0),
  }))
  return [...robot, tool, ...externals]
}

function thousandSampleRequest(): CollisionValidationRequest {
  return {
    requestId: 'performance-1000',
    revision: 'performance-fixture-v1',
    mode: 'validate',
    sequence: [
      {
        id: 'start',
        name: 'Start',
        anglesDeg: [0, 0, 0, 0, 0, 0],
        durationMs: 1_000,
        easing: 'linear',
      },
      {
        id: 'end',
        name: 'End',
        anglesDeg: [499.5, 0, 0, 0, 0, 0],
        durationMs: 1_000,
        easing: 'linear',
      },
    ],
    robot: {
      definition: CRB15000_DEFINITION,
      rootPose: IDENTITY_TRANSFORM,
      geometryTransforms: Object.fromEntries(
        LINK_IDS.map((linkId) => [linkId, IDENTITY_TRANSFORM]),
      ) as Record<RobotLinkId, typeof IDENTITY_TRANSFORM>,
      toolFrames: {
        flange: IDENTITY_TRANSFORM,
        tool: IDENTITY_TRANSFORM,
        tcp: IDENTITY_TRANSFORM,
      },
      linkEntities: LINK_IDS.map((linkId) => ({
        linkId,
        id: `robot-link:${linkId}` as const,
        name: linkId,
        collisionActive: true,
        boxes: [BOX],
      })),
      toolEntity: {
        id: 'tool:default',
        name: 'Tool',
        boxes: [BOX],
      },
    },
    heldObject: null,
    staticEntities: Array.from({ length: 50 }, (_, index) => ({
      id: `object:external-${index.toString().padStart(2, '0')}` as const,
      name: `External ${index}`,
      category: 'object' as const,
      boxes: [BOX],
      worldMatrix: IDENTITY_MATRIX,
    })),
    mountContactPairKey: null,
    policy: {
      enabled: true,
      warningDistanceM: 0.02,
      ignoredPairKeys: [],
      enabledRobotSelfPairs: [],
    },
  }
}

describe('geometry collision reference performance fixture', () => {
  it('reports broad and narrow phase telemetry below unconstrained all-pairs', () => {
    const entities = referenceEntities()
    const result = queryGeometryCollisionsWithTelemetry(entities, {
      enabled: true,
      warningDistanceM: 0.02,
      ignoredPairKeys: [],
      enabledRobotSelfPairs: [],
    })
    const unconstrainedPairs = entities.length * (entities.length - 1) / 2

    expect(entities).toHaveLength(7 + 1 + 50)
    expect(result.telemetry).toMatchObject({
      entityCount: 58,
      boxCount: 58,
      findingCount: result.findings.length,
    })
    expect(result.telemetry.broadPhaseCandidateCount).toBeLessThan(
      unconstrainedPairs,
    )
    expect(result.telemetry.broadPhaseCandidateCount).toBeGreaterThan(0)
    expect(result.telemetry.broadPhaseCandidateCount).toBe(3)
    expect(result.telemetry.narrowPhaseTestCount).toBeLessThanOrEqual(
      result.telemetry.broadPhaseCandidateCount,
    )
  })

  it('caps the scheduler at 10 Hz under a continuously changing revision', () => {
    const scheduler = new CurrentPoseCollisionScheduler()
    let queries = 0
    for (let nowMs = 0; nowMs < 1_000; nowMs += 1) {
      scheduler.observe(nowMs, `revision-${nowMs}`, () => {
        queries += 1
      })
    }

    expect(queries).toBe(10)
  })

  it('processes 1,000 samples while deterministically reporting finding-cap pressure', async () => {
    let animationCounter = 0
    const progress: number[] = []

    const result = await runCollisionValidation(thousandSampleRequest(), {
      onProgress: ({ processedSamples }) => progress.push(processedSamples),
      yieldControl: () => new Promise<void>((resolve) => {
        setTimeout(() => {
          animationCounter += 1
          resolve()
        }, 0)
      }),
    })

    expect(result?.sampleCount).toBe(1_000)
    expect(result?.truncated).toBe(true)
    expect(result?.findings).toHaveLength(10_000)
    expect(progress).toEqual([250, 500, 750, 1_000])
    expect(animationCounter).toBeGreaterThan(0)
  })
})
