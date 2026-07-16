import { Group } from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_COLLISION_POLICY,
  type CollisionPolicyV4,
} from '../../domain/collision/collision'
import { spatialEntityCollisionIdV4 } from '../../core/robot-runtime/collision-identity'
import {
  registerGeometryEntity,
  type GeometryEntityRegistry,
} from './geometry-entity-registry'
import {
  CurrentPoseCollisionScheduler,
  publishCurrentPoseCollision,
  queryCurrentPoseCollision,
  queryCurrentPoseCollisionV4,
} from './current-pose-collision'
import type { CollisionGeometryProxyV4 } from './scene-entity-adapter'
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
    expect(result.telemetry).toMatchObject({
      entityCount: 2,
      boxCount: 2,
      broadPhaseCandidateCount: 1,
      narrowPhaseTestCount: 1,
      findingCount: 1,
    })
    expect(robot.position.toArray()).toEqual(before.position)
    expect(robot.quaternion.toArray()).toEqual(before.quaternion)
    expect(robot.scale.toArray()).toEqual(before.scale)
  })

  it('derives and reports the configured active mount pair separately', () => {
    const registry: GeometryEntityRegistry = new Map()
    for (const [id, category] of [
      ['robot-link:LINK00', 'robot-link'],
      ['workcell:workbench', 'environment'],
    ] as const) {
      registerGeometryEntity({
        id,
        name: id,
        category,
        boxes: [{
          id: 'main',
          center: [0, 0, 0],
          halfExtents: [0.5, 0.5, 0.5],
          quaternion: [0, 0, 0, 1],
        }],
        object: new Group(),
      }, registry)
    }

    const result = queryCurrentPoseCollision(
      DEFAULT_COLLISION_POLICY,
      registry,
      { baseLinkId: 'LINK00', mountSurfaceCollisionEntityId: 'workcell:workbench' },
    )

    expect(result.findings).toEqual([])
    expect(result.mountContact).toEqual({
      pairKey: 'robot-link:LINK00|workcell:workbench',
      state: 'contact',
    })
    expect(result.telemetry.findingCount).toBe(0)
  })

  it('publishes one atomic collision-store replacement per query', () => {
    const collisionStore = createCollisionStore()
    const replaceCollisionState = vi.spyOn(
      collisionStore.getState(),
      'replaceCollisionState',
    )
    let transitions = 0
    const unsubscribe = collisionStore.subscribe(() => {
      transitions += 1
    })

    publishCurrentPoseCollision(collisionStore, new Map())
    unsubscribe()

    expect(replaceCollisionState).toHaveBeenCalledTimes(1)
    expect(transitions).toBe(1)
    expect(collisionStore.getState().currentFindings).toEqual([])
    expect(
      (collisionStore.getState() as unknown as { latestTelemetry: unknown })
        .latestTelemetry,
    ).toEqual({
      entityCount: 0,
      boxCount: 0,
      broadPhaseCandidateCount: 0,
      narrowPhaseTestCount: 0,
      findingCount: 0,
    })
  })
})

const POLICY_V4: CollisionPolicyV4 = {
  enabled: true,
  nearMissMarginM: 0,
  excludedPairKeys: new Set(),
  intentionalMountPairKeys: new Set(),
  ignoredContactPairKeys: new Set(),
}

function proxy(id: string, effectiveVisible: boolean): CollisionGeometryProxyV4 {
  return {
    effectiveVisible,
    entity: {
      id: spatialEntityCollisionIdV4(id),
      name: id,
      category: 'spatial-entity',
      worldMatrix: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
      boxes: [{
        id: 'main', center: [0, 0, 0], halfExtents: [0.5, 0.5, 0.5],
        quaternion: [0, 0, 0, 1],
      }],
    },
  }
}

describe('current-pose collision v4', () => {
  it('removes hidden proxies before broad-phase telemetry without mutation', () => {
    const visible = proxy('visible', true)
    const hidden = proxy('hidden', false)
    const before = JSON.stringify([visible, hidden])

    const result = queryCurrentPoseCollisionV4(POLICY_V4, [visible, hidden])

    expect(result.findings).toEqual([])
    expect(result.telemetry).toMatchObject({
      entityCount: 1,
      boxCount: 1,
      broadPhaseCandidateCount: 0,
    })
    expect(JSON.stringify([visible, hidden])).toBe(before)
  })

  it('reports the same overlap when both proxies are visible', () => {
    const result = queryCurrentPoseCollisionV4(POLICY_V4, [
      proxy('first', true),
      proxy('second', true),
    ])
    expect(result.findings).toHaveLength(1)
    expect(result.telemetry).toMatchObject({
      entityCount: 2,
      broadPhaseCandidateCount: 1,
      narrowPhaseTestCount: 1,
    })
  })
})
