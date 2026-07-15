import { describe, expect, it } from 'vitest'
import {
  pairKey,
  type CollisionBox,
  type CollisionPolicy,
  type GeometryCollisionEntity,
} from './collision'
import {
  queryGeometryCollisions,
  queryGeometryCollisionsWithTelemetry,
} from './query-collision'

const BOX: CollisionBox = {
  id: 'main',
  center: [0, 0, 0],
  halfExtents: [0.5, 0.5, 0.5],
  quaternion: [0, 0, 0, 1],
}

const POLICY: CollisionPolicy = {
  enabled: true,
  warningDistanceM: 0.1,
  ignoredPairKeys: [],
  enabledRobotSelfPairs: [],
}

function entity(
  id: string,
  category: GeometryCollisionEntity['category'],
  x: number,
  boxes: readonly CollisionBox[] = [BOX],
): GeometryCollisionEntity {
  return {
    id,
    name: id,
    category,
    worldMatrix: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      x, 0, 0, 1,
    ],
    boxes,
  }
}

describe('geometry collision orchestration', () => {
  it('does not exempt LINK00 and workbench without explicit mount contact', () => {
    const findings = queryGeometryCollisions(
      [
        entity('robot-link:LINK00', 'robot-link', 0),
        entity('workcell:workbench', 'environment', 0.75),
      ],
      POLICY,
      { mountContactPairKey: null },
    )

    expect(findings).toContainEqual(expect.objectContaining({
      kind: 'collision',
      pairKey: pairKey('robot-link:LINK00', 'workcell:workbench'),
    }))
  })

  it('classifies only the configured pair as mount contact without changing candidate telemetry', () => {
    const mountPairKey = pairKey('robot-link:LINK00', 'workcell:workbench')
    const result = queryGeometryCollisionsWithTelemetry(
      [
        entity('robot-link:LINK00', 'robot-link', 0),
        entity('robot-link:LINK01', 'robot-link', 0),
        entity('workcell:workbench', 'environment', 0.75),
      ],
      POLICY,
      { mountContactPairKey: mountPairKey },
    )

    expect(result.findings).not.toContainEqual(
      expect.objectContaining({ pairKey: mountPairKey }),
    )
    expect(result.findings).toContainEqual(expect.objectContaining({
      pairKey: pairKey('robot-link:LINK01', 'workcell:workbench'),
      kind: 'collision',
    }))
    expect(result.mountContact).toEqual({ pairKey: mountPairKey, state: 'contact' })
    expect(result.telemetry).toMatchObject({
      broadPhaseCandidateCount: 3,
      narrowPhaseTestCount: 2,
      findingCount: 1,
    })
  })

  it('returns current-pose collision and near-miss rows in stable order', () => {
    const findings = queryGeometryCollisions(
      [
        entity('object:near', 'object', 1.05),
        entity('robot-link:LINK03', 'robot-link', 0),
        entity('workcell:workbench', 'environment', 0.75),
      ],
      POLICY,
    )

    expect(findings.map(({ kind, pairKey: key }) => [kind, key])).toEqual([
      ['collision', 'robot-link:LINK03|workcell:workbench'],
      ['near-miss', 'object:near|robot-link:LINK03'],
    ])
    expect(findings.every((finding) => finding.sampleIndex === null)).toBe(true)
    expect(findings.every((finding) => finding.timeMs === null)).toBe(true)
  })

  it('applies ignored-pair and disabled policy before returning findings', () => {
    const entities = [
      entity('robot-link:LINK03', 'robot-link', 0),
      entity('object:cup-01', 'object', 0.5),
    ]
    const key = pairKey(entities[0]!.id, entities[1]!.id)

    expect(
      queryGeometryCollisions(entities, {
        ...POLICY,
        ignoredPairKeys: [key],
      }),
    ).toEqual([])
    expect(
      queryGeometryCollisions(entities, { ...POLICY, enabled: false }),
    ).toEqual([])
  })

  it('only enables configured Robot self-collision pairs', () => {
    const entities = [
      entity('robot-link:LINK02', 'robot-link', 0),
      entity('robot-link:LINK05', 'robot-link', 0.5),
    ]
    const key = pairKey(entities[0]!.id, entities[1]!.id)

    expect(queryGeometryCollisions(entities, POLICY)).toEqual([])
    expect(
      queryGeometryCollisions(entities, {
        ...POLICY,
        enabledRobotSelfPairs: [key],
      }),
    ).toHaveLength(1)
  })

  it('rejects adjacent and identical Robot self-pair policy entries', () => {
    const adjacent = pairKey('robot-link:LINK02', 'robot-link:LINK03')
    const identical = pairKey('robot-link:LINK02', 'robot-link:LINK02')

    expect(() =>
      queryGeometryCollisions(
        [
          entity('robot-link:LINK02', 'robot-link', 0),
          entity('robot-link:LINK03', 'robot-link', 0.5),
        ],
        { ...POLICY, enabledRobotSelfPairs: [adjacent] },
      ),
    ).toThrow(/non-adjacent|self pair/i)
    expect(() =>
      queryGeometryCollisions(
        [entity('robot-link:LINK02', 'robot-link', 0)],
        { ...POLICY, enabledRobotSelfPairs: [identical] },
      ),
    ).toThrow(/non-adjacent|self pair/i)
  })

  it('collapses Compound Box hits to the most severe Entity-pair finding', () => {
    const findings = queryGeometryCollisions(
      [
        entity('robot-link:LINK03', 'robot-link', 0, [
          { ...BOX, id: 'shallow', center: [0, 0, 0] },
          { ...BOX, id: 'deep', center: [0.3, 0, 0] },
        ]),
        entity('object:cup-01', 'object', 0.75),
      ],
      POLICY,
      {
        mountContactPairKey: null,
        metadata: { sampleIndex: 4, timeMs: 125 },
      },
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      secondBoxId: 'deep',
      kind: 'collision',
      separationM: -0.55,
      sampleIndex: 4,
      timeMs: 125,
    })
  })

  it('tests held Objects against the Environment without changing identity', () => {
    const findings = queryGeometryCollisions(
      [
        entity('object:cup-01', 'held-object', 0),
        entity('workcell:workbench', 'environment', 0.75),
      ],
      POLICY,
    )

    expect(findings[0]?.pairKey).toBe('object:cup-01|workcell:workbench')
  })
})
