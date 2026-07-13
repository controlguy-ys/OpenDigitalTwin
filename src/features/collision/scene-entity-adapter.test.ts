import { Group } from 'three'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COLLISION_POLICY,
  pairKey,
} from '../../domain/collision/collision'
import { queryGeometryCollisions } from '../../domain/collision/query-collision'
import type { EquipmentRecord } from '../../domain/equipment/equipment'
import type {
  ObjectAssetRecordV1,
  ObjectInstanceRecordV1,
  RobotLinkGeometryRecordV1,
  RobotLinkGeometryRecordV2,
} from '../../domain/project/project'
import {
  geometryEntityRegistry,
  registerGeometryEntity,
  snapshotGeometryEntities,
} from './geometry-entity-registry'
import {
  equipmentRecordToGeometryEntity,
  objectInstanceToGeometryEntity,
  robotLinkToGeometryEntity,
  workbenchToGeometryEntity,
} from './scene-entity-adapter'

function equipment(): EquipmentRecord {
  return {
    id: 'fixture-01',
    name: 'Fixture',
    kind: 'machine',
    status: 'OFF',
    numericStatus: 0,
    statusSource: 'manual',
    statusOverlayVisible: false,
    transform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    graspable: true,
    collisionCenter: [0.2, -0.1, 0.4],
    collisionHalfExtents: [0.5, 0.4, 0.3],
    stackLightAnchor: null,
  }
}

function asset(): ObjectAssetRecordV1 {
  return {
    id: 'asset-01',
    name: 'Fixture Asset',
    sourceFileName: 'fixture.step',
    sourceBytes: new Uint8Array([1]).buffer,
    importScale: 1,
    originMode: 'source',
    colliderCenter: [0.2, -0.1, 0.4],
    collisionHalfExtents: [0.5, 0.4, 0.3],
    statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
  }
}

function instance(): ObjectInstanceRecordV1 {
  return {
    id: 'fixture-01',
    assetId: 'asset-01',
    name: 'Fixture Instance',
    transform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    numericStatus: 0,
    statusSource: 'manual',
    statusOverlayVisible: false,
    visible: true,
  }
}

function robotGeometry(
  linkId: RobotLinkGeometryRecordV1['linkId'] = 'LINK03',
): RobotLinkGeometryRecordV1 {
  return {
    linkId,
    sourceFileName: `${linkId}.step`,
    sourceBytes: new Uint8Array([1]).buffer,
    localTransform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    visible: true,
    collisionCenter: [0.12, -0.23, 0.34],
    collisionHalfExtents: [0.41, 0.32, 0.23],
    statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
  }
}

describe('scene collision Entity adapters', () => {
  it('adapts legacy Equipment and imported Object Instances to equivalent Boxes', () => {
    const object = new Group()
    const legacy = equipmentRecordToGeometryEntity(equipment(), object)
    const imported = objectInstanceToGeometryEntity(asset(), instance(), object)

    expect(legacy).toMatchObject({
      id: 'equipment:fixture-01',
      category: 'equipment',
    })
    expect(imported).toMatchObject({
      id: 'object:fixture-01',
      category: 'object',
    })
    expect(imported.boxes).toEqual(legacy.boxes)
  })

  it('keeps canonical external IDs while only switching category across grasp and release', () => {
    const object = new Group()

    expect(equipmentRecordToGeometryEntity(equipment(), object, true)).toMatchObject({
      id: 'equipment:fixture-01',
      category: 'held-object',
    })
    expect(objectInstanceToGeometryEntity(asset(), instance(), object, true)).toMatchObject({
      id: 'object:fixture-01',
      category: 'held-object',
    })
    expect(objectInstanceToGeometryEntity(asset(), instance(), object, false)).toMatchObject({
      id: 'object:fixture-01',
      category: 'object',
    })
  })

  it('uses the active custom Robot Link collider record', () => {
    expect(robotLinkToGeometryEntity(robotGeometry(), new Group())).toMatchObject({
      id: 'robot-link:LINK03',
      category: 'robot-link',
      boxes: [
        {
          id: 'default',
          center: [0.12, -0.23, 0.34],
          halfExtents: [0.41, 0.32, 0.23],
          quaternion: [0, 0, 0, 1],
        },
      ],
    })
  })

  it('preserves every canonical V2 Robot Link Compound Box', () => {
    const compound: RobotLinkGeometryRecordV2 = {
      ...robotGeometry(),
      collisionBoxes: [
        {
          id: 'body',
          center: [0.12, -0.23, 0.34],
          halfExtents: [0.41, 0.32, 0.23],
          quaternion: [0, 0, 0, 1],
        },
        {
          id: 'wrist',
          center: [0.5, 0.1, -0.2],
          halfExtents: [0.08, 0.09, 0.1],
          quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
        },
      ],
    }

    const registration = robotLinkToGeometryEntity(compound, new Group())

    expect(registration.boxes).toEqual(compound.collisionBoxes)
    expect(registration.boxes).not.toBe(compound.collisionBoxes)
  })

  it('publishes the existing Workbench proxy as the environment pair participant', () => {
    geometryEntityRegistry.clear()
    const workbench = new Group()
    const linkObject = new Group()
    registerGeometryEntity(workbenchToGeometryEntity(workbench))
    registerGeometryEntity(
      robotLinkToGeometryEntity(
        {
          ...robotGeometry('LINK01'),
          collisionCenter: [0, 0, 1.03],
          collisionHalfExtents: [0.1, 0.1, 0.1],
        },
        linkObject,
      ),
    )
    registerGeometryEntity(
      robotLinkToGeometryEntity(
        {
          ...robotGeometry('LINK00'),
          collisionCenter: [0, 0, 1.03],
          collisionHalfExtents: [0.1, 0.1, 0.1],
        },
        new Group(),
      ),
    )

    const snapshot = snapshotGeometryEntities()
    const workbenchEntity = snapshot.entities.find(
      ({ id }) => id === 'workcell:workbench',
    )
    expect(workbenchEntity).toMatchObject({
      category: 'environment',
      boxes: [
        {
          center: [0, 0, 1.03],
          halfExtents: [0.9, 0.6, 0.05],
        },
      ],
    })
    expect(queryGeometryCollisions(snapshot.entities, DEFAULT_COLLISION_POLICY)).toEqual([
      expect.objectContaining({
        pairKey: pairKey('robot-link:LINK01', 'workcell:workbench'),
      }),
    ])
  })
})
