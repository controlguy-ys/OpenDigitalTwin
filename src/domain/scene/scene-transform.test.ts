import { describe, expect, it } from 'vitest'
import type { ProjectSceneStateV1 } from '../project/scene-state-v1'
import {
  reparentSceneEntityPreservingWorld,
  worldPoseForEntity,
} from './scene-transform'

const pose = (
  positionM: readonly [number, number, number],
  quaternion: readonly [number, number, number, number] = [0, 0, 0, 1],
) => ({ positionM, quaternion })

const SCENE: ProjectSceneStateV1 = {
  robotMountContact: null,
  entities: [
    { kind: 'group', id: 'group:fixture', name: 'Fixture', parentId: null,
      localPose: pose([1, 2, 0], [0, 0, Math.SQRT1_2, Math.SQRT1_2]), visible: true },
    { kind: 'object', id: 'object:cup-1', name: 'Cup', parentId: null,
      localPose: pose([4, 5, 6]), visible: true,
      target: { kind: 'object-instance', id: 'cup-1' }, transformSource: 'manual' },
  ],
}

describe('scene transforms', () => {
  it('preserves world pose when a manual object is grouped', () => {
    const before = worldPoseForEntity(SCENE, 'object:cup-1')
    const next = reparentSceneEntityPreservingWorld(SCENE, 'object:cup-1', 'group:fixture')
    const after = worldPoseForEntity(next, 'object:cup-1')
    expect(after.positionM).toEqual(before.positionM)
    expect(after.quaternion).toEqual(before.quaternion)
  })

  it('rejects grouping an OPC UA owned object', () => {
    const opcScene: ProjectSceneStateV1 = {
      ...SCENE,
      entities: SCENE.entities.map((entity) => entity.id === 'object:cup-1'
        ? { ...entity, transformSource: 'opcua' as const }
        : entity),
    }
    expect(() => reparentSceneEntityPreservingWorld(
      opcScene, 'object:cup-1', 'group:fixture',
    )).toThrow('SCENE_OPCUA_OBJECT_REQUIRES_MCP_PARENT')
  })

  it('inserts axis travel before carriage and Robot local poses', () => {
    const scene: ProjectSceneStateV1 = {
      robotMountContact: null,
      entities: [
        { kind: 'linear-axis', id: 'linear-axis:active', name: 'Axis', parentId: null,
          localPose: pose([10, 0, 0]), visible: true, direction: 'y', minPositionM: -2,
          maxPositionM: 2, homePositionM: 0, currentPositionM: 1.25,
          carriageEntityId: 'object:part', robotEntityId: 'robot:active' },
        { kind: 'object', id: 'object:part', name: 'Part', parentId: 'linear-axis:active',
          localPose: pose([0, 0, 3]), visible: true,
          target: { kind: 'object-instance', id: 'part' }, transformSource: 'manual' },
        { kind: 'robot', id: 'robot:active', name: 'Robot', parentId: 'linear-axis:active',
          localPose: pose([0, 0, 4]), visible: true },
      ],
    }
    expect(worldPoseForEntity(scene, 'object:part').positionM).toEqual([10, 1.25, 3])
    expect(worldPoseForEntity(scene, 'robot:active').positionM).toEqual([10, 1.25, 4])
  })
})
