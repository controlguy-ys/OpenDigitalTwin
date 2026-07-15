import { describe, expect, it } from 'vitest'
import type { WorkcellProjectSnapshotV3 } from '../../domain/project/project-v3'
import type { SceneEntityV1 } from '../../domain/project/scene-state-v1'
import { selectSceneRuntime } from './scene-runtime-selector'

const IDENTITY_POSE = {
  positionM: [0, 0, 0] as const,
  quaternion: [0, 0, 0, 1] as const,
}

function snapshot(entities: readonly SceneEntityV1[]): WorkcellProjectSnapshotV3 {
  return {
    scene: { entities, robotMountContact: null },
    objectAssets: [],
    objectInstances: [],
    builtInEquipment: [],
  } as unknown as WorkcellProjectSnapshotV3
}

describe('scene runtime selector', () => {
  it('derives World poses and effective visibility through every ancestor without changing child flags', () => {
    const group: SceneEntityV1 = {
      kind: 'group', id: 'group:fixture', name: 'Fixture', parentId: null,
      localPose: { ...IDENTITY_POSE, positionM: [1, 0, 0] }, visible: false,
    }
    const child: SceneEntityV1 = {
      kind: 'object', id: 'object:cup-1', name: 'Cup', parentId: 'group:fixture',
      localPose: { ...IDENTITY_POSE, positionM: [0, 2, 0] }, visible: true,
      target: { kind: 'object-instance', id: 'cup-1' }, transformSource: 'manual',
    }
    const project = snapshot([group, child])

    const runtime = selectSceneRuntime(project, { isolatedEntityId: null })

    expect(runtime.byId.get('object:cup-1')).toMatchObject({
      effectiveVisible: false,
      worldPose: { positionM: [1, 2, 0] },
    })
    expect(project.scene.entities[1]?.visible).toBe(true)
  })

  it('applies session isolation to the isolated branch while keeping the published project untouched', () => {
    const fixture: SceneEntityV1 = {
      kind: 'group', id: 'group:fixture', name: 'Fixture', parentId: null,
      localPose: IDENTITY_POSE, visible: true,
    }
    const cup: SceneEntityV1 = {
      kind: 'object', id: 'object:cup-1', name: 'Cup', parentId: 'group:fixture',
      localPose: IDENTITY_POSE, visible: true,
      target: { kind: 'object-instance', id: 'cup-1' }, transformSource: 'manual',
    }
    const robot: SceneEntityV1 = {
      kind: 'robot', id: 'robot:active', name: 'Robot', parentId: null,
      localPose: IDENTITY_POSE, visible: true,
    }
    const project = snapshot([robot, fixture, cup])

    const runtime = selectSceneRuntime(project, { isolatedEntityId: 'group:fixture' })

    expect(runtime.byId.get('group:fixture')?.effectiveVisible).toBe(true)
    expect(runtime.byId.get('object:cup-1')?.effectiveVisible).toBe(true)
    expect(runtime.byId.get('robot:active')?.effectiveVisible).toBe(false)
    expect(JSON.stringify(project)).not.toContain('isolatedEntityId')
  })

  it('publishes one typed render projection for Robot, Objects, Groups, and Linear Axis', () => {
    const entities: SceneEntityV1[] = [
      { kind: 'robot', id: 'robot:active', name: 'Robot', parentId: null, localPose: IDENTITY_POSE, visible: true },
      { kind: 'group', id: 'group:fixture', name: 'Fixture', parentId: null, localPose: IDENTITY_POSE, visible: true },
      {
        kind: 'object', id: 'object:cup-1', name: 'Cup', parentId: 'group:fixture',
        localPose: IDENTITY_POSE, visible: true,
        target: { kind: 'object-instance', id: 'cup-1' }, transformSource: 'manual',
      },
      {
        kind: 'linear-axis', id: 'linear-axis:active', name: 'Axis', parentId: null,
        localPose: IDENTITY_POSE, visible: true, direction: 'x', minPositionM: 0,
        maxPositionM: 1, homePositionM: 0, currentPositionM: 0,
        carriageEntityId: null, robotEntityId: null,
      },
    ]

    const runtime = selectSceneRuntime(snapshot(entities), { isolatedEntityId: null })

    expect(runtime.robot?.entityId).toBe('robot:active')
    expect(runtime.objects.map(({ entityId }) => entityId)).toEqual(['object:cup-1'])
    expect(runtime.groups.map(({ entityId }) => entityId)).toEqual(['group:fixture'])
    expect(runtime.linearAxis?.entityId).toBe('linear-axis:active')
  })

  it('projects the session draft pose without mutating the published Entity', () => {
    const object: SceneEntityV1 = {
      kind: 'object', id: 'object:cup-1', name: 'Cup', parentId: null,
      localPose: IDENTITY_POSE, visible: true,
      target: { kind: 'object-instance', id: 'cup-1' }, transformSource: 'manual',
    }
    const project = snapshot([object])
    const draftPose = {
      positionM: [4, 5, 6] as const,
      quaternion: [0, 0, 0, 1] as const,
    }

    const runtime = selectSceneRuntime(project, {
      isolatedEntityId: null,
      draftPose: { entityId: 'object:cup-1', pose: draftPose },
    })

    expect(runtime.byId.get('object:cup-1')?.worldPose.positionM).toEqual([4, 5, 6])
    expect(project.scene.entities[0]?.localPose.positionM).toEqual([0, 0, 0])
  })
})
