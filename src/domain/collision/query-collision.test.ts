import { describe, expect, it } from 'vitest'
import {
  canonicalCollisionPairKeyV4,
  robotLinkCollisionIdV4,
  spatialEntityCollisionIdV4,
} from '../../core/robot-runtime/collision-identity'
import {
  pairKey,
  validateGeometryCollisionEntity,
  validateGeometryCollisionEntityV4,
  type CollisionBox,
  type CollisionPolicyV4,
  type CollisionPolicy,
  type GeometryCollisionEntityV4,
  type GeometryCollisionEntity,
} from './collision'
import {
  queryGeometryCollisions,
  queryGeometryCollisionsV4,
  queryGeometryCollisionsWithTelemetry,
  queryGeometryCollisionsWithTelemetryV4,
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

  it('evaluates configured mount contact even when a stale policy also ignores that pair', () => {
    const mountPairKey = pairKey('robot-link:LINK00', 'workcell:workbench')
    const result = queryGeometryCollisionsWithTelemetry(
      [
        entity('robot-link:LINK00', 'robot-link', 0),
        entity('workcell:workbench', 'environment', 0.75),
      ],
      { ...POLICY, ignoredPairKeys: [mountPairKey] },
      { mountContactPairKey: mountPairKey },
    )

    expect(result.mountContact).toEqual({ pairKey: mountPairKey, state: 'contact' })
    expect(result.telemetry.narrowPhaseTestCount).toBe(1)
    expect(result.findings).toEqual([])
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

const POLICY_V4: CollisionPolicyV4 = {
  enabled: true,
  nearMissMarginM: 0.1,
  excludedPairKeys: new Set(),
  intentionalMountPairKeys: new Set(),
  ignoredContactPairKeys: new Set(),
}

function entityV4(
  id: GeometryCollisionEntityV4['id'],
  category: GeometryCollisionEntityV4['category'],
  x = 0,
): GeometryCollisionEntityV4 {
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
    boxes: [BOX],
  }
}

describe('geometry collision orchestration v4', () => {
  it('rejects an unknown runtime category even with a valid V4 namespace', () => {
    const candidate = entityV4(
      spatialEntityCollisionIdV4('fixture'),
      'spatial-entity',
    )
    expect(() => validateGeometryCollisionEntityV4({
      ...candidate,
      category: 'bogus' as GeometryCollisionEntityV4['category'],
    })).toThrow(/category|bogus/i)
  })

  it('keeps V3 Entity validation isolated from the V4 spatial namespace', () => {
    const candidate = entityV4(
      spatialEntityCollisionIdV4('fixture'),
      'spatial-entity',
    )
    expect(() => validateGeometryCollisionEntity(
      candidate as unknown as GeometryCollisionEntity,
    )).toThrow(/namespace|category/i)
  })

  it('retains cross-Robot and same-Robot non-adjacent pairs', () => {
    const aRoot = robotLinkCollisionIdV4('robot-a', 'root')
    const aChild = robotLinkCollisionIdV4('robot-a', 'child')
    const aTip = robotLinkCollisionIdV4('robot-a', 'tip')
    const bRoot = robotLinkCollisionIdV4('robot-b', 'root')
    const adjacent = canonicalCollisionPairKeyV4(aRoot, aChild)
    const findings = queryGeometryCollisionsV4([
      entityV4(aRoot, 'robot-link'),
      entityV4(aChild, 'robot-link'),
      entityV4(aTip, 'robot-link'),
      entityV4(bRoot, 'robot-link'),
    ], {
      ...POLICY_V4,
      excludedPairKeys: new Set([adjacent]),
    })
    const keys = new Set(findings.map(({ pairKey: key }) => key))

    expect(keys).not.toContain(adjacent)
    expect(keys).toContain(canonicalCollisionPairKeyV4(aRoot, aTip))
    expect(keys).toContain(canonicalCollisionPairKeyV4(aRoot, bRoot))
  })

  it('suppresses only explicit adjacency, mount, and ignored-contact keys', () => {
    const root = robotLinkCollisionIdV4('robot-a', 'root')
    const child = robotLinkCollisionIdV4('robot-a', 'child')
    const table = spatialEntityCollisionIdV4('table')
    const fixture = spatialEntityCollisionIdV4('fixture')
    const adjacency = canonicalCollisionPairKeyV4(root, child)
    const mount = canonicalCollisionPairKeyV4(root, table)
    const ignored = canonicalCollisionPairKeyV4(child, fixture)
    const findings = queryGeometryCollisionsV4([
      entityV4(root, 'robot-link'),
      entityV4(child, 'robot-link'),
      entityV4(table, 'spatial-entity'),
      entityV4(fixture, 'spatial-entity'),
    ], {
      ...POLICY_V4,
      excludedPairKeys: new Set([adjacency]),
      intentionalMountPairKeys: new Set([mount]),
      ignoredContactPairKeys: new Set([ignored]),
    })
    const keys = new Set(findings.map(({ pairKey: key }) => key))

    expect(keys).not.toContain(adjacency)
    expect(keys).not.toContain(mount)
    expect(keys).not.toContain(ignored)
    expect(keys).toContain(canonicalCollisionPairKeyV4(root, fixture))
    expect(keys).toContain(canonicalCollisionPairKeyV4(child, table))
  })

  it('preserves most-severe collapse, metadata, ordering, and telemetry', () => {
    const robot = robotLinkCollisionIdV4('robot-a', 'tip')
    const entityId = spatialEntityCollisionIdV4('part|1')
    const result = queryGeometryCollisionsWithTelemetryV4([
      {
        ...entityV4(robot, 'robot-link'),
        boxes: [
          { ...BOX, id: 'shallow', center: [0, 0, 0] },
          { ...BOX, id: 'deep', center: [0.3, 0, 0] },
        ],
      },
      entityV4(entityId, 'spatial-entity', 0.75),
    ], POLICY_V4, { sampleIndex: 7, timeMs: 125 })

    expect(result.findings).toEqual([expect.objectContaining({
      pairKey: canonicalCollisionPairKeyV4(robot, entityId),
      firstBoxId: 'deep',
      kind: 'collision',
      sampleIndex: 7,
      timeMs: 125,
    })])
    expect(result.telemetry).toMatchObject({
      entityCount: 2,
      boxCount: 3,
      broadPhaseCandidateCount: 2,
      narrowPhaseTestCount: 2,
      findingCount: 1,
    })
  })

  it('queries a valid V4 aggregate with more than the V3 per-Entity Box cap', () => {
    const robot = entityV4(
      robotLinkCollisionIdV4('robot-a', 'root'),
      'robot-link',
    )
    const spatial = entityV4(
      spatialEntityCollisionIdV4('fixture'),
      'spatial-entity',
    )
    const result = queryGeometryCollisionsWithTelemetryV4([{
      ...robot,
      boxes: Array.from({ length: 17 }, (_, index) => ({
        ...BOX,
        id: `box-${index}`,
        center: [index * 10, 0, 0] as const,
      })),
    }, spatial], POLICY_V4)

    expect(result.telemetry.boxCount).toBe(18)
    expect(result.findings).toHaveLength(1)
  })

  it('validates duplicate ids before the disabled fast path', () => {
    const id = spatialEntityCollisionIdV4('duplicate')
    expect(() => queryGeometryCollisionsV4([
      entityV4(id, 'spatial-entity'),
      entityV4(id, 'spatial-entity'),
    ], { ...POLICY_V4, enabled: false })).toThrow(/duplicate/i)
  })

  it('keeps findings and telemetry deterministic under Entity permutation', () => {
    const entities = [
      entityV4(robotLinkCollisionIdV4('robot-b', 'root'), 'robot-link'),
      entityV4(spatialEntityCollisionIdV4('fixture'), 'spatial-entity'),
      entityV4(robotLinkCollisionIdV4('robot-a', 'root'), 'robot-link'),
    ]
    expect(queryGeometryCollisionsWithTelemetryV4(entities, POLICY_V4)).toEqual(
      queryGeometryCollisionsWithTelemetryV4([...entities].reverse(), POLICY_V4),
    )
  })
})
