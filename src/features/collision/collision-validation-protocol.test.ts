import { describe, expect, it } from 'vitest'
import type { CollisionFinding } from '../../domain/collision/collision'
import { CRB15000_DEFINITION, type RobotLinkId } from '../../domain/robot/crb15000'
import {
  MAX_COLLISION_VALIDATION_FINDINGS,
  validateCollisionValidationProgress,
  validateCollisionValidationRequest,
  validateCollisionValidationResult,
  type CollisionValidationRequest,
} from './collision-validation-protocol'

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
    expect(() => structuredClone(validated)).not.toThrow()
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
        truncated: false,
      }),
    ).toThrow(/sample index/i)
  })
})
