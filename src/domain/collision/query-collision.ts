import { broadPhasePairs } from './broad-phase'
import {
  canonicalCollisionPairKeyV4,
  encodeRuntimeIdentitySegmentV4,
  type CollisionPairKeyV4,
} from '../../core/robot-runtime/collision-identity'
import {
  pairKey,
  validateCollisionPolicy,
  validateCollisionPolicyV4,
  validateGeometryCollisionEntity,
  validateGeometryCollisionEntityV4,
  type CollisionFinding,
  type CollisionFindingV4,
  type CollisionPolicy,
  type CollisionPolicyV4,
  type GeometryCollisionEntity,
  type GeometryCollisionEntityV4,
  type WorldObb,
} from './collision'
import { queryObbPair, worldObbFromBox } from './obb'

export interface CollisionQueryMetadata {
  readonly sampleIndex?: number | null
  readonly timeMs?: number | null
}

export interface CollisionQueryTelemetry {
  readonly entityCount: number
  readonly boxCount: number
  readonly broadPhaseCandidateCount: number
  readonly narrowPhaseTestCount: number
  readonly findingCount: number
}

export interface CollisionQueryResult {
  readonly findings: readonly CollisionFinding[]
  readonly mountContact: Readonly<{
    readonly pairKey: string
    readonly state: 'clear' | 'near' | 'contact'
  }> | null
  readonly telemetry: CollisionQueryTelemetry
}

export type MountContactState = NonNullable<
  CollisionQueryResult['mountContact']
>

export interface GeometryCollisionQueryOptionsV1 {
  readonly mountContactPairKey: string | null
  readonly metadata?: CollisionQueryMetadata
}

function pairEnabledByCategory(
  first: GeometryCollisionEntity,
  second: GeometryCollisionEntity,
  policy: CollisionPolicy,
): boolean {
  if (first.category === 'robot-link' && second.category === 'robot-link') {
    return policy.enabledRobotSelfPairs.includes(pairKey(first.id, second.id))
  }
  const robotSide = new Set(['robot-link', 'tool'])
  const externalSide = new Set(['environment', 'equipment', 'object'])
  if (
    (robotSide.has(first.category) && externalSide.has(second.category)) ||
    (robotSide.has(second.category) && externalSide.has(first.category))
  ) {
    return true
  }
  return (
    (first.category === 'held-object' && externalSide.has(second.category)) ||
    (second.category === 'held-object' && externalSide.has(first.category))
  )
}

function findingSeverity(finding: CollisionFinding): number {
  return finding.kind === 'collision' ? 0 : 1
}

function compareStrings(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0
}

function compareFindings(first: CollisionFinding, second: CollisionFinding): number {
  const firstTime = first.timeMs ?? Number.NEGATIVE_INFINITY
  const secondTime = second.timeMs ?? Number.NEGATIVE_INFINITY
  return (
    firstTime - secondTime ||
    findingSeverity(first) - findingSeverity(second) ||
    compareStrings(first.pairKey, second.pairKey) ||
    compareStrings(first.firstBoxId, second.firstBoxId) ||
    compareStrings(first.secondBoxId, second.secondBoxId)
  )
}

function moreSevere(
  candidate: CollisionFinding,
  current: CollisionFinding,
): boolean {
  const candidateSeverity = findingSeverity(candidate)
  const currentSeverity = findingSeverity(current)
  if (candidateSeverity !== currentSeverity) {
    return candidateSeverity < currentSeverity
  }
  if (candidate.separationM !== current.separationM) {
    return candidate.separationM < current.separationM
  }
  return compareFindings(candidate, current) < 0
}

function validateMetadata(metadata: CollisionQueryMetadata): void {
  if (
    metadata.sampleIndex !== undefined &&
    metadata.sampleIndex !== null &&
    (!Number.isInteger(metadata.sampleIndex) || metadata.sampleIndex < 0)
  ) {
    throw new Error('Collision sample index must be non-negative.')
  }
  if (
    metadata.timeMs !== undefined &&
    metadata.timeMs !== null &&
    (!Number.isFinite(metadata.timeMs) || metadata.timeMs < 0)
  ) {
    throw new Error('Collision time must be non-negative and finite.')
  }
}

export function queryGeometryCollisions(
  entityCandidates: readonly GeometryCollisionEntity[],
  policyCandidate: CollisionPolicy,
  options: GeometryCollisionQueryOptionsV1 = { mountContactPairKey: null },
): readonly CollisionFinding[] {
  return queryGeometryCollisionsWithTelemetry(
    entityCandidates,
    policyCandidate,
    options,
  ).findings
}

export function queryGeometryCollisionsWithTelemetry(
  entityCandidates: readonly GeometryCollisionEntity[],
  policyCandidate: CollisionPolicy,
  options: GeometryCollisionQueryOptionsV1 = { mountContactPairKey: null },
): CollisionQueryResult {
  const policy = validateCollisionPolicy(policyCandidate)
  const entities = entityCandidates.map(validateGeometryCollisionEntity)
  const metadata = options.metadata ?? {}
  validateMetadata(metadata)
  const boxCount = entities.reduce(
    (total, entity) => total + entity.boxes.length,
    0,
  )
  if (!policy.enabled) {
    return Object.freeze({
      findings: Object.freeze([]),
      mountContact: null,
      telemetry: Object.freeze({
        entityCount: entities.length,
        boxCount,
        broadPhaseCandidateCount: 0,
        narrowPhaseTestCount: 0,
        findingCount: 0,
      }),
    })
  }

  const entitiesById = new Map<string, GeometryCollisionEntity>()
  for (const entity of entities) {
    if (entitiesById.has(entity.id)) {
      throw new Error(`Duplicate Collision Entity id: ${entity.id}`)
    }
    entitiesById.set(entity.id, entity)
  }
  const mountPairIds = options.mountContactPairKey?.split('|') ?? []
  const mountPairIsActive = mountPairIds.length === 2 &&
    mountPairIds.every((id) => entitiesById.has(id))
  const worldObbs = entities.flatMap((entity) =>
    entity.boxes.map((box) => worldObbFromBox(entity, box)),
  )
  const ignored = new Set(policy.ignoredPairKeys)
  const findingsByPair = new Map<string, CollisionFinding>()
  const broadPhaseCandidates = broadPhasePairs(
    worldObbs,
    policy.warningDistanceM,
  )
  let narrowPhaseTestCount = 0
  for (const [firstObb, secondObb] of broadPhaseCandidates) {
    const firstEntity = entitiesById.get(firstObb.entityId)!
    const secondEntity = entitiesById.get(secondObb.entityId)!
    const key = pairKey(firstEntity.id, secondEntity.id)
    if (
      (ignored.has(key) && (!mountPairIsActive || key !== options.mountContactPairKey)) ||
      !pairEnabledByCategory(firstEntity, secondEntity, policy)
    ) {
      continue
    }
    narrowPhaseTestCount += 1
    const finding = queryObbPair(
      firstObb,
      secondObb,
      policy.warningDistanceM,
      metadata,
    )
    if (finding === null) continue
    const current = findingsByPair.get(key)
    if (current === undefined || moreSevere(finding, current)) {
      findingsByPair.set(key, finding)
    }
  }
  const mountFinding = mountPairIsActive
    ? findingsByPair.get(options.mountContactPairKey!)
    : undefined
  const findings = Object.freeze(
    [...findingsByPair.values()]
      .filter(({ pairKey: key }) =>
        !mountPairIsActive || key !== options.mountContactPairKey)
      .sort(compareFindings),
  )
  return Object.freeze({
    findings,
    mountContact: !mountPairIsActive
      ? null
      : Object.freeze({
          pairKey: options.mountContactPairKey!,
          state: mountFinding === undefined
            ? 'clear' as const
            : mountFinding.kind === 'collision'
              ? 'contact' as const
              : 'near' as const,
        }),
    telemetry: Object.freeze({
      entityCount: entities.length,
      boxCount,
      broadPhaseCandidateCount: broadPhaseCandidates.length,
      narrowPhaseTestCount,
      findingCount: findings.length,
    }),
  })
}

export interface CollisionQueryResultV4 {
  readonly findings: readonly CollisionFindingV4[]
  readonly telemetry: CollisionQueryTelemetry
}

function worldObbFromBoxV4(
  entity: GeometryCollisionEntityV4,
  box: GeometryCollisionEntityV4['boxes'][number],
): WorldObb {
  const shadow: GeometryCollisionEntity = entity.category === 'spatial-entity'
    ? {
        ...entity,
        id: `tool:${encodeRuntimeIdentitySegmentV4(entity.id)}`,
        category: 'tool',
        boxes: [box],
      }
    : { ...entity, boxes: [box] } as GeometryCollisionEntity
  const obb = worldObbFromBox(shadow, box)
  return Object.freeze({ ...obb, entityId: entity.id })
}

export function queryGeometryCollisionsV4(
  entities: readonly GeometryCollisionEntityV4[],
  policy: CollisionPolicyV4,
  metadata: CollisionQueryMetadata = {},
): readonly CollisionFindingV4[] {
  return queryGeometryCollisionsWithTelemetryV4(entities, policy, metadata).findings
}

export function queryGeometryCollisionsWithTelemetryV4(
  entityCandidates: readonly GeometryCollisionEntityV4[],
  policyCandidate: CollisionPolicyV4,
  metadata: CollisionQueryMetadata = {},
): CollisionQueryResultV4 {
  const policy = validateCollisionPolicyV4(policyCandidate)
  const entities = entityCandidates.map(validateGeometryCollisionEntityV4)
  validateMetadata(metadata)

  const entitiesById = new Map<string, GeometryCollisionEntityV4>()
  for (const entity of entities) {
    if (entitiesById.has(entity.id)) {
      throw new Error(`Duplicate Collision Entity id: ${entity.id}`)
    }
    entitiesById.set(entity.id, entity)
  }
  const boxCount = entities.reduce((sum, entity) => sum + entity.boxes.length, 0)
  if (!policy.enabled) {
    return Object.freeze({
      findings: Object.freeze([]),
      telemetry: Object.freeze({
        entityCount: entities.length,
        boxCount,
        broadPhaseCandidateCount: 0,
        narrowPhaseTestCount: 0,
        findingCount: 0,
      }),
    })
  }

  const worldObbs = entities.flatMap((entity) =>
    entity.boxes.map((box) => worldObbFromBoxV4(entity, box)),
  )
  const broadPhaseCandidates = broadPhasePairs(worldObbs, policy.nearMissMarginM)
  const excluded = new Set<CollisionPairKeyV4>([
    ...policy.excludedPairKeys,
    ...policy.intentionalMountPairKeys,
    ...policy.ignoredContactPairKeys,
  ])
  const findingsByPair = new Map<CollisionPairKeyV4, CollisionFindingV4>()
  let narrowPhaseTestCount = 0
  for (const [firstObb, secondObb] of broadPhaseCandidates) {
    const key = canonicalCollisionPairKeyV4(
      firstObb.entityId as GeometryCollisionEntityV4['id'],
      secondObb.entityId as GeometryCollisionEntityV4['id'],
    )
    if (excluded.has(key)) continue
    narrowPhaseTestCount += 1
    const finding = queryObbPair(
      firstObb,
      secondObb,
      policy.nearMissMarginM,
      metadata,
    ) as CollisionFindingV4 | null
    if (finding === null) continue
    const current = findingsByPair.get(key)
    if (current === undefined || moreSevere(finding, current)) {
      findingsByPair.set(key, finding)
    }
  }
  const findings = Object.freeze(
    [...findingsByPair.values()].sort(compareFindings),
  )
  return Object.freeze({
    findings,
    telemetry: Object.freeze({
      entityCount: entities.length,
      boxCount,
      broadPhaseCandidateCount: broadPhaseCandidates.length,
      narrowPhaseTestCount,
      findingCount: findings.length,
    }),
  })
}
