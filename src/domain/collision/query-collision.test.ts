import { describe, expect, it } from 'vitest'
import {
  pairKey,
  type CollisionBox,
  type CollisionPolicy,
  type GeometryCollisionEntity,
} from './collision'
import { queryGeometryCollisions } from './query-collision'

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
      { sampleIndex: 4, timeMs: 125 },
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
