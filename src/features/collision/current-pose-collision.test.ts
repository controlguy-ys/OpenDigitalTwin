import { Group } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_COLLISION_POLICY } from '../../domain/collision/collision'
import {
  registerGeometryEntity,
  type GeometryEntityRegistry,
} from './geometry-entity-registry'
import {
  CurrentPoseCollisionScheduler,
  publishCurrentPoseCollision,
  queryCurrentPoseCollision,
} from './current-pose-collision'
import { createCollisionStore } from './collision-store'

describe('current-pose collision scheduler', () => {
  it('runs the first revision immediately and does not repeat a stable revision', () => {
    const scheduler = new CurrentPoseCollisionScheduler()
    const query = vi.fn()

    expect(scheduler.observe(0, 'revision-1', query)).toBe(true)
    expect(scheduler.observe(100, 'revision-1', query)).toBe(false)
    expect(scheduler.observe(1_000, 'revision-1', query)).toBe(false)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('coalesces changed revisions and executes at most once per 100 ms', () => {
    const scheduler = new CurrentPoseCollisionScheduler(100)
    const observed: string[] = []

    scheduler.observe(0, 'revision-1', (revision) => observed.push(revision))
    expect(
      scheduler.observe(25, 'revision-2', (revision) => observed.push(revision)),
    ).toBe(false)
    expect(
      scheduler.observe(99, 'revision-3', (revision) => observed.push(revision)),
    ).toBe(false)
    expect(
      scheduler.observe(100, 'revision-3', (revision) => observed.push(revision)),
    ).toBe(true)
    expect(
      scheduler.observe(150, 'revision-4', (revision) => observed.push(revision)),
    ).toBe(false)
    expect(
      scheduler.observe(200, 'revision-4', (revision) => observed.push(revision)),
    ).toBe(true)

    expect(observed).toEqual(['revision-1', 'revision-3', 'revision-4'])
  })

  it('queries current geometry without changing scene transforms', () => {
    const registry: GeometryEntityRegistry = new Map()
    const robot = new Group()
    robot.position.set(0.25, -0.5, 1.2)
    robot.rotation.set(0.2, -0.3, 0.4)
    robot.scale.set(1.1, 0.9, 1.2)
    const object = new Group()
    object.position.set(0.25, -0.5, 1.2)
    const before = {
      position: robot.position.toArray(),
      quaternion: robot.quaternion.toArray(),
      scale: robot.scale.toArray(),
    }
    registerGeometryEntity(
      {
        id: 'robot-link:LINK03',
        name: 'Link 03',
        category: 'robot-link',
        boxes: [
          {
            id: 'main',
            center: [0, 0, 0],
            halfExtents: [0.2, 0.2, 0.2],
            quaternion: [0, 0, 0, 1],
          },
        ],
        object: robot,
      },
      registry,
    )
    registerGeometryEntity(
      {
        id: 'object:fixture-01',
        name: 'Fixture',
        category: 'object',
        boxes: [
          {
            id: 'main',
            center: [0, 0, 0],
            halfExtents: [0.2, 0.2, 0.2],
            quaternion: [0, 0, 0, 1],
          },
        ],
        object,
      },
      registry,
    )

    const result = queryCurrentPoseCollision(
      DEFAULT_COLLISION_POLICY,
      registry,
    )

    expect(result.findings).toHaveLength(1)
    expect(robot.position.toArray()).toEqual(before.position)
    expect(robot.quaternion.toArray()).toEqual(before.quaternion)
    expect(robot.scale.toArray()).toEqual(before.scale)
  })

  it('publishes one atomic collision-store replacement per query', () => {
    const collisionStore = createCollisionStore()
    const replaceCollisionState = vi.spyOn(
      collisionStore.getState(),
      'replaceCollisionState',
    )

    publishCurrentPoseCollision(collisionStore, new Map())

    expect(replaceCollisionState).toHaveBeenCalledTimes(1)
    expect(collisionStore.getState().currentFindings).toEqual([])
  })
})
