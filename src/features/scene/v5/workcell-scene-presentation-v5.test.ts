import { describe, expect, it } from 'vitest'

import {
  reduceWorkcellScenePresentationV5,
  type WorkcellSceneGeometrySampleV5,
} from './workcell-scene-presentation-v5.js'

const sample = (overrides: Partial<WorkcellSceneGeometrySampleV5> = {}): WorkcellSceneGeometrySampleV5 => ({
  key: 'robot:r1:link:L0:geometry:body',
  selectionKey: 'robot:r1',
  worldCenter: [1, 2, 3],
  radius: 0.5,
  issue: null,
  ...overrides,
})

describe('reduceWorkcellScenePresentationV5', () => {
  it('reports ready bounds for resolved robot collision and logical Part samples', () => {
    const presentation = reduceWorkcellScenePresentationV5([
      sample(),
      sample({ key: 'object:part-1', selectionKey: 'entity:part-1', worldCenter: [3, 2, 1], radius: 0.25 }),
    ], 2, 'robot:r1')

    expect(presentation.state).toBe('ready')
    expect(presentation.visibleGeometryCount).toBeGreaterThan(0)
    expect(presentation.visibleBounds).not.toBeNull()
    expect(presentation.visibleBounds?.center.every(Number.isFinite)).toBe(true)
    expect(Number.isFinite(presentation.visibleBounds?.radius)).toBe(true)
    expect(presentation.selectionBounds).not.toBeNull()
  })

  it('reports degraded and identifies an unresolved stable geometry key', () => {
    const key = 'robot:r1:link:L1:geometry:arm'
    const presentation = reduceWorkcellScenePresentationV5([
      sample(),
      sample({ key, worldCenter: null, issue: 'unresolved-world-pose' }),
    ], 2, null)

    expect(presentation.state).toBe('degraded')
    expect(presentation.unresolvedPoseKeys).toEqual([key])
  })

  it('reports empty when no visible entities are expected', () => {
    expect(reduceWorkcellScenePresentationV5([], 0, null)).toEqual({
      state: 'empty',
      visibleGeometryCount: 0,
      unresolvedPoseKeys: [],
      visibleBounds: null,
      selectionBounds: null,
    })
  })

  it('deduplicates repeated geometry reports by stable key', () => {
    const key = 'object:part-1'
    const presentation = reduceWorkcellScenePresentationV5([
      sample({ key, worldCenter: [1, 1, 1] }),
      sample({ key, worldCenter: [2, 2, 2] }),
    ], 1, null)
    expect(presentation.visibleGeometryCount).toBe(1)
    expect(presentation.visibleBounds?.center).toEqual([2, 2, 2])
  })
})
