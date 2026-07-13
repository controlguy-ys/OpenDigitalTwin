import { broadPhasePairs } from './broad-phase'
import {
  pairKey,
  validateCollisionPolicy,
  validateGeometryCollisionEntity,
  type CollisionFinding,
  type CollisionPolicy,
  type GeometryCollisionEntity,
} from './collision'
import { queryObbPair, worldObbFromBox } from './obb'

export interface CollisionQueryMetadata {
  readonly sampleIndex?: number | null
  readonly timeMs?: number | null
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
  metadata: CollisionQueryMetadata = {},
): readonly CollisionFinding[] {
  const policy = validateCollisionPolicy(policyCandidate)
  const entities = entityCandidates.map(validateGeometryCollisionEntity)
  validateMetadata(metadata)
  if (!policy.enabled) return Object.freeze([])

  const entitiesById = new Map<string, GeometryCollisionEntity>()
  for (const entity of entities) {
    if (entitiesById.has(entity.id)) {
      throw new Error(`Duplicate Collision Entity id: ${entity.id}`)
    }
    entitiesById.set(entity.id, entity)
  }
  const worldObbs = entities.flatMap((entity) =>
    entity.boxes.map((box) => worldObbFromBox(entity, box)),
  )
  const ignored = new Set(policy.ignoredPairKeys)
  const findingsByPair = new Map<string, CollisionFinding>()
  for (const [firstObb, secondObb] of broadPhasePairs(
    worldObbs,
    policy.warningDistanceM,
  )) {
    const firstEntity = entitiesById.get(firstObb.entityId)!
    const secondEntity = entitiesById.get(secondObb.entityId)!
    const key = pairKey(firstEntity.id, secondEntity.id)
    if (ignored.has(key) || !pairEnabledByCategory(firstEntity, secondEntity, policy)) {
      continue
    }
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
  return Object.freeze([...findingsByPair.values()].sort(compareFindings))
}
