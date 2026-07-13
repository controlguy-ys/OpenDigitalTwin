import { Group } from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollisionBox } from '../../domain/collision/collision'
import {
  geometryEntityRegistry,
  registerGeometryEntity,
  snapshotGeometryEntities,
} from './geometry-entity-registry'

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const

function box(
  center: [number, number, number] = [0, 0, 0],
  halfExtents: [number, number, number] = [0.5, 0.5, 0.5],
): CollisionBox {
  return {
    id: 'default',
    center,
    halfExtents,
    quaternion: [0, 0, 0, 1],
  }
}

beforeEach(() => {
  geometryEntityRegistry.clear()
})

describe('geometry Entity registry', () => {
  it('replaces a registration without allowing stale cleanup to remove its successor', () => {
    const first = new Group()
    const second = new Group()
    const cleanupFirst = registerGeometryEntity({
      id: 'equipment:fixture',
      name: 'Fixture',
      category: 'equipment',
      boxes: [box()],
      object: first,
      colliderRevision: 1,
    })
    const cleanupSecond = registerGeometryEntity({
      id: 'equipment:fixture',
      name: 'Held Fixture',
      category: 'held-object',
      boxes: [box()],
      object: second,
      colliderRevision: 2,
    })

    cleanupFirst()
    expect(geometryEntityRegistry.get('equipment:fixture')).toMatchObject({
      category: 'held-object',
      object: second,
      colliderRevision: 2,
    })

    cleanupSecond()
    expect(geometryEntityRegistry.has('equipment:fixture')).toBe(false)
  })

  it('owns collider tuples before caller mutation', () => {
    const center: [number, number, number] = [1, 2, 3]
    const halfExtents: [number, number, number] = [0.1, 0.2, 0.3]
    const quaternion: [number, number, number, number] = [0, 0, 0, 1]
    const object = new Group()

    registerGeometryEntity({
      id: 'equipment:owned',
      name: 'Owned',
      category: 'equipment',
      boxes: [{ id: 'default', center, halfExtents, quaternion }],
      object,
      colliderRevision: 0,
    })
    center[0] = 99
    halfExtents[1] = 99
    quaternion[3] = 2

    expect(snapshotGeometryEntities().entities[0]?.boxes[0]).toEqual({
      id: 'default',
      center: [1, 2, 3],
      halfExtents: [0.1, 0.2, 0.3],
      quaternion: [0, 0, 0, 1],
    })
  })

  it('updates each live matrix once and returns an owned immutable snapshot', () => {
    const object = new Group()
    object.position.set(1, 2, 3)
    const updateWorldMatrix = vi.spyOn(object, 'updateWorldMatrix')
    registerGeometryEntity({
      id: 'tool:default',
      name: 'Parallel gripper',
      category: 'tool',
      boxes: [box()],
      object,
      colliderRevision: 0,
    })

    const snapshot = snapshotGeometryEntities()
    const entity = snapshot.entities[0]!
    expect(updateWorldMatrix).toHaveBeenCalledTimes(1)
    expect(updateWorldMatrix).toHaveBeenCalledWith(true, false)
    expect(entity.worldMatrix).toHaveLength(16)
    expect(entity.worldMatrix).not.toBe(object.matrixWorld.elements)
    expect(entity.worldMatrix[12]).toBe(1)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.entities)).toBe(true)
    expect(Object.isFrozen(entity)).toBe(true)
    expect(Object.isFrozen(entity.worldMatrix)).toBe(true)
    expect(Object.isFrozen(entity.boxes)).toBe(true)

    object.position.set(9, 9, 9)
    object.updateMatrixWorld(true)
    expect(entity.worldMatrix).toEqual(IDENTITY.map((value, index) =>
      index === 12 ? 1 : index === 13 ? 2 : index === 14 ? 3 : value,
    ))
  })

  it('reports a missing Object3D separately instead of publishing an active Entity', () => {
    registerGeometryEntity({
      id: 'object:missing',
      name: 'Missing Object',
      category: 'object',
      boxes: [box()],
      object: null,
      colliderRevision: 0,
    })

    const snapshot = snapshotGeometryEntities()
    expect(snapshot.entities).toEqual([])
    expect(snapshot.diagnostics).toEqual([
      {
        entityId: 'object:missing',
        message: 'Collision Entity object:missing has no live Object3D.',
      },
    ])
    expect(Object.isFrozen(snapshot.diagnostics)).toBe(true)
    expect(Object.isFrozen(snapshot.diagnostics[0])).toBe(true)
  })
})
