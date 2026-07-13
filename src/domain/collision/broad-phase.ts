import type { Vector3Tuple, WorldObb } from './collision'

export interface WorldAabb {
  readonly min: Vector3Tuple
  readonly max: Vector3Tuple
}

interface SweepEntry {
  readonly obb: WorldObb
  readonly aabb: WorldAabb
}

function compareStrings(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0
}

function compareObbIdentity(first: WorldObb, second: WorldObb): number {
  return (
    compareStrings(first.entityId, second.entityId) ||
    compareStrings(first.boxId, second.boxId)
  )
}

function validateWarningDistance(warningDistanceM: number): void {
  if (!Number.isFinite(warningDistanceM) || warningDistanceM < 0) {
    throw new Error('Broad-phase warning distance must be finite and non-negative.')
  }
}

export function worldAabbFromObb(
  obb: WorldObb,
  expansionM = 0,
): WorldAabb {
  validateWarningDistance(expansionM)
  const radius: [number, number, number] = [0, 0, 0]
  for (let axis = 0; axis < 3; axis += 1) {
    radius[axis] = obb.axes.reduce(
      (sum, obbAxis, index) =>
        sum + Math.abs(obbAxis[axis]!) * obb.halfExtents[index]!,
      expansionM,
    )
  }
  const min: [number, number, number] = [
    obb.center[0] - radius[0],
    obb.center[1] - radius[1],
    obb.center[2] - radius[2],
  ]
  const max: [number, number, number] = [
    obb.center[0] + radius[0],
    obb.center[1] + radius[1],
    obb.center[2] + radius[2],
  ]
  return Object.freeze({
    min: Object.freeze(min),
    max: Object.freeze(max),
  })
}

function orderedPair(
  first: WorldObb,
  second: WorldObb,
): readonly [WorldObb, WorldObb] {
  return compareObbIdentity(first, second) <= 0
    ? [first, second]
    : [second, first]
}

function intervalsOverlap(
  first: WorldAabb,
  second: WorldAabb,
  axis: 1 | 2,
): boolean {
  return first.min[axis] <= second.max[axis] && first.max[axis] >= second.min[axis]
}

export function broadPhasePairs(
  obbs: readonly WorldObb[],
  warningDistanceM: number,
): readonly (readonly [WorldObb, WorldObb])[] {
  validateWarningDistance(warningDistanceM)
  const entries: SweepEntry[] = obbs.map((obb) => ({
    obb,
    aabb: worldAabbFromObb(obb, warningDistanceM),
  }))
  entries.sort(
    (first, second) =>
      first.aabb.min[0] - second.aabb.min[0] ||
      compareObbIdentity(first.obb, second.obb),
  )

  const active: SweepEntry[] = []
  const pairs: (readonly [WorldObb, WorldObb])[] = []
  for (const current of entries) {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index]!.aabb.max[0] < current.aabb.min[0]) {
        active.splice(index, 1)
      }
    }
    for (const candidate of active) {
      if (
        candidate.obb.entityId !== current.obb.entityId &&
        intervalsOverlap(candidate.aabb, current.aabb, 1) &&
        intervalsOverlap(candidate.aabb, current.aabb, 2)
      ) {
        pairs.push(orderedPair(candidate.obb, current.obb))
      }
    }
    active.push(current)
  }
  pairs.sort(
    (first, second) =>
      compareObbIdentity(first[0], second[0]) ||
      compareObbIdentity(first[1], second[1]),
  )
  return Object.freeze(pairs)
}
