import { describe, expect, it } from 'vitest'
import type { GeometryCollisionEntity } from '../../domain/collision/collision'
import {
  isHeldSceneEntityVisible,
  resolveGeometryGraspTarget,
} from './GraspController'

function entity(
  id: string,
  category: GeometryCollisionEntity['category'],
  x: number,
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
    boxes: [
      {
        id: 'main',
        center: [0, 0, 0],
        halfExtents: [0.2, 0.2, 0.2],
        quaternion: [0, 0, 0, 1],
      },
    ],
  }
}

describe('GraspController geometry target resolution', () => {
  it('keeps imported Object and legacy Equipment canonical ids distinct', () => {
    const sensor = entity('tool:grasp-sensor', 'tool', 0)

    expect(
      resolveGeometryGraspTarget(
        sensor,
        [
          entity('object:shared-01', 'object', 0.1),
          entity('equipment:shared-01', 'equipment', -0.1),
        ],
        new Set(['equipment:shared-01', 'object:shared-01']),
      ),
    ).toBe('equipment:shared-01')
  })

  it('suppresses held rendering and its overlay when Scene visibility or isolation is ineffective', () => {
    const byId = new Map([
      ['object:held-cup', { entityId: 'object:held-cup', effectiveVisible: false }],
    ])

    expect(isHeldSceneEntityVisible(
      { byId } as never,
      'object:held-cup',
    )).toBe(false)
    expect(isHeldSceneEntityVisible(
      { byId } as never,
      'object:missing',
    )).toBe(true)
  })
})
