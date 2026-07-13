import type { Vector3Tuple, WorldObb } from './collision'

export interface WorldAabb {
  readonly min: Vector3Tuple
  readonly max: Vector3Tuple
}

interface SweepEntry {
  readonly obb: WorldObb
  readonly key: string
  readonly aabb: WorldAabb
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
  const firstKey = `${first.entityId}\u0000${first.boxId}`
  const secondKey = `${second.entityId}\u0000${second.boxId}`
  return firstKey <= secondKey
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
    key: `${obb.entityId}/${obb.boxId}`,
    aabb: worldAabbFromObb(obb, warningDistanceM),
  }))
  entries.sort(
    (first, second) =>
      first.aabb.min[0] - second.aabb.min[0] ||
      (first.key < second.key ? -1 : first.key > second.key ? 1 : 0),
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
  pairs.sort((first, second) => {
    const firstKey = `${first[0].entityId}/${first[0].boxId}|${first[1].entityId}/${first[1].boxId}`
    const secondKey = `${second[0].entityId}/${second[0].boxId}|${second[1].entityId}/${second[1].boxId}`
    return firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0
  })
  return Object.freeze(pairs)
}
