import { describe, expect, it } from 'vitest'
import type {
  CollisionBox,
  GeometryCollisionEntity,
} from '../../domain/collision/collision'
import { findGraspCandidates } from './geometry-grasp-sensor'

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const

function entity(
  id: string,
  category: GeometryCollisionEntity['category'],
  x: number,
  box: CollisionBox = {
    id: 'main',
    center: [0, 0, 0],
    halfExtents: [0.2, 0.2, 0.2],
    quaternion: [0, 0, 0, 1],
  },
): GeometryCollisionEntity {
  const worldMatrix: number[] = [...IDENTITY]
  worldMatrix[12] = x
  return { id, name: id, category, worldMatrix, boxes: [box] }
}

describe('geometry grasp sensor', () => {
  it('uses OBB overlap and orders candidates by distance then canonical id', () => {
    const sensor = entity('tool:grasp-sensor', 'tool', 0, {
      id: 'sensor',
      center: [0, 0, 0],
      halfExtents: [0.3, 0.3, 0.3],
      quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    })

    expect(
      findGraspCandidates(sensor, [
        entity('object:outside', 'object', 1),
        entity('object:zeta', 'object', -0.1),
        entity('equipment:alpha', 'equipment', 0.1),
        entity('object:nearest', 'object', 0.05),
        entity('robot-link:LINK03', 'robot-link', 0),
      ]).map(({ entityId, distanceSq }) => [entityId, distanceSq]),
    ).toEqual([
      ['object:nearest', 0.0025],
      ['equipment:alpha', 0.01],
      ['object:zeta', 0.01],
    ])
  })

  it('rejects an AABB false positive when rotated OBBs are separated', () => {
    const sensor = entity('tool:grasp-sensor', 'tool', 0, {
      id: 'sensor',
      center: [0, 0, 0],
      halfExtents: [0.45, 0.04, 0.04],
      quaternion: [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)],
    })
    const separated = entity('object:separated', 'object', 0, {
      id: 'main',
      center: [0, 0.2, 0],
      halfExtents: [0.45, 0.04, 0.04],
      quaternion: [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)],
    })

    expect(findGraspCandidates(sensor, [separated])).toEqual([])
  })
})
