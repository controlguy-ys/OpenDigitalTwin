import { expect, it } from 'vitest'
import type {
  ObjectAssetRecordV1,
  ObjectInstanceRecordV1,
} from '../../domain/project/project'
import { Group } from 'three'
import {
  objectInstanceToEquipmentRecord,
  objectInstanceToGeometryEntity,
} from './object-equipment-adapter'

it('keeps Asset collision center while adapting a reusable Instance for the scene', () => {
  const asset: ObjectAssetRecordV1 = {
    id: 'asset-01',
    name: 'Fixture',
    sourceFileName: 'fixture.step',
    sourceBytes: new Uint8Array([1]).buffer,
    importScale: 1,
    originMode: 'source',
    colliderCenter: [0.2, -0.1, 0.4],
    collisionHalfExtents: [0.5, 0.4, 0.3],
    statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
  }
  const instance: ObjectInstanceRecordV1 = {
    id: 'instance-01',
    assetId: asset.id,
    name: 'Fixture 01',
    transform: {
      position: [1, 2, 3],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    numericStatus: 7,
    statusSource: 'manual',
    statusOverlayVisible: true,
    visible: true,
  }

  expect(objectInstanceToEquipmentRecord(instance, asset)).toMatchObject({
    assetId: 'asset-01',
    collisionCenter: [0.2, -0.1, 0.4],
    graspable: true,
    numericStatus: 7,
  })

  expect(objectInstanceToGeometryEntity(asset, instance, new Group())).toMatchObject({
    id: 'object:instance-01',
    category: 'object',
    boxes: [
      {
        center: asset.colliderCenter,
        halfExtents: asset.collisionHalfExtents,
      },
    ],
  })
})
