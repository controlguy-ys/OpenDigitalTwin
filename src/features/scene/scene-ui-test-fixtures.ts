import type { WorkcellProjectSnapshotV3 } from '../../domain/project/project-v3'
import type { SceneEntityV1 } from '../../domain/project/scene-state-v1'
import { selectSceneRuntime } from './scene-runtime-selector'

export const TEST_IDENTITY_POSE = {
  positionM: [0, 0, 0] as const,
  quaternion: [0, 0, 0, 1] as const,
}

export const TEST_SCENE_ENTITIES: readonly SceneEntityV1[] = [
  {
    kind: 'robot', id: 'robot:active', name: 'Assembly Robot', parentId: null,
    localPose: TEST_IDENTITY_POSE, visible: true,
  },
  {
    kind: 'group', id: 'group:fixture', name: 'Fixture Group', parentId: null,
    localPose: { ...TEST_IDENTITY_POSE, positionM: [1, 2, 3] }, visible: true,
  },
  {
    kind: 'object', id: 'object:cup-1', name: 'Cup', parentId: 'group:fixture',
    localPose: { ...TEST_IDENTITY_POSE, positionM: [0.1, 0.2, 0.3] }, visible: true,
    target: { kind: 'object-instance', id: 'cup-1' }, transformSource: 'manual',
  },
  {
    kind: 'object', id: 'object:live-part', name: 'Live Part', parentId: null,
    localPose: TEST_IDENTITY_POSE, visible: true,
    target: { kind: 'object-instance', id: 'live-part' }, transformSource: 'opcua',
  },
  {
    kind: 'object', id: 'equipment:workbench', name: 'Workbench', parentId: null,
    localPose: TEST_IDENTITY_POSE, visible: false,
    target: { kind: 'built-in-equipment', id: 'workbench' }, transformSource: 'manual',
  },
  {
    kind: 'linear-axis', id: 'linear-axis:active', name: 'Linear Axis', parentId: null,
    localPose: TEST_IDENTITY_POSE, visible: true, direction: 'x', minPositionM: -1,
    maxPositionM: 1, homePositionM: 0, currentPositionM: 0,
    carriageEntityId: null, robotEntityId: null,
  },
]

export function testSceneRuntime(entities = TEST_SCENE_ENTITIES) {
  return selectSceneRuntime({
    scene: { entities, robotMountContact: null },
    objectAssets: [],
    objectInstances: [],
    builtInEquipment: [],
  } as unknown as WorkcellProjectSnapshotV3, { isolatedEntityId: null })
}
