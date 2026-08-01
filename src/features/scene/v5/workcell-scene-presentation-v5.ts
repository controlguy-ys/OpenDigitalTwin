export interface WorkcellSceneBoundsV5 {
  readonly center: readonly [number, number, number]
  readonly radius: number
}

export interface WorkcellSceneGeometrySampleV5 {
  readonly key: string
  readonly selectionKey: string | null
  readonly worldCenter: readonly [number, number, number] | null
  readonly radius: number
  readonly issue: 'unresolved-world-pose' | null
}

export interface WorkcellScenePresentationV5 {
  readonly state: 'ready' | 'empty' | 'degraded'
  readonly visibleGeometryCount: number
  readonly unresolvedPoseKeys: readonly string[]
  readonly visibleBounds: WorkcellSceneBoundsV5 | null
  readonly selectionBounds: WorkcellSceneBoundsV5 | null
}

const freezeTuple = (value: readonly [number, number, number]): readonly [number, number, number] => (
  Object.freeze([value[0], value[1], value[2]]) as readonly [number, number, number]
)

function aggregateBounds(samples: readonly WorkcellSceneGeometrySampleV5[]): WorkcellSceneBoundsV5 | null {
  const visible = samples.filter((sample) => sample.worldCenter !== null && sample.issue === null)
  if (visible.length === 0) return null
  const min: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (const sample of visible) {
    const center = sample.worldCenter!
    const radius = Number.isFinite(sample.radius) && sample.radius >= 0 ? sample.radius : 0
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, center[axis]! - radius)
      max[axis] = Math.max(max[axis]!, center[axis]! + radius)
    }
  }
  const center = [
    (min[0]! + max[0]!) / 2,
    (min[1]! + max[1]!) / 2,
    (min[2]! + max[2]!) / 2,
  ] as [number, number, number]
  const radius = Math.hypot(
    max[0]! - center[0],
    max[1]! - center[1],
    max[2]! - center[2],
  )
  return Object.freeze({ center: freezeTuple(center), radius })
}

export function reduceWorkcellScenePresentationV5(
  samples: readonly WorkcellSceneGeometrySampleV5[],
  expectedVisibleGeometryCount: number,
  selectedKey: string | null,
): WorkcellScenePresentationV5 {
  const reports = new Map<string, WorkcellSceneGeometrySampleV5>()
  for (const sample of samples) reports.set(sample.key, sample)
  const deduplicated = [...reports.values()]
  const visible = deduplicated.filter((sample) => sample.worldCenter !== null && sample.issue === null)
  const unresolvedPoseKeys = deduplicated
    .filter((sample) => sample.issue === 'unresolved-world-pose' || sample.worldCenter === null)
    .map((sample) => sample.key)
    .sort()
  const visibleBounds = aggregateBounds(deduplicated)
  const selectionBounds = selectedKey === null
    ? null
    : aggregateBounds(deduplicated.filter((sample) => sample.selectionKey === selectedKey))
  const state = visible.length === 0 && expectedVisibleGeometryCount === 0
    ? 'empty'
    : unresolvedPoseKeys.length > 0 || visible.length === 0
      ? 'degraded'
      : 'ready'
  return Object.freeze({
    state,
    visibleGeometryCount: visible.length,
    unresolvedPoseKeys: Object.freeze(unresolvedPoseKeys),
    visibleBounds,
    selectionBounds,
  })
}
