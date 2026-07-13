import type { EquipmentRecord } from '../../domain/equipment/equipment'
import { validateCollisionBox } from '../../domain/collision/collision'
import type {
  ObjectAssetRecordV1,
  ObjectAssetRecordV2,
  ObjectInstanceRecordV1,
} from '../../domain/project/project'
import type { Object3D } from 'three'
import type { GeometryEntityRegistration } from '../collision/geometry-entity-registry'

export function objectInstanceToGeometryEntity(
  asset: ObjectAssetRecordV1 | ObjectAssetRecordV2,
  instance: ObjectInstanceRecordV1,
  object: Object3D | null,
  held = false,
  colliderRevision = 0,
): GeometryEntityRegistration {
  const boxes = 'collisionBoxes' in asset
    ? asset.collisionBoxes
    : [{
        id: 'default',
        center: asset.colliderCenter,
        halfExtents: asset.collisionHalfExtents,
        quaternion: [0, 0, 0, 1] as const,
      }]
  return Object.freeze({
    id: `object:${instance.id}`,
    name: instance.name,
    category: held ? 'held-object' : 'object',
    boxes: Object.freeze(boxes.map(validateCollisionBox)),
    object,
    colliderRevision,
  })
}

export function objectInstanceToEquipmentRecord(
  instance: ObjectInstanceRecordV1,
  asset: ObjectAssetRecordV1,
): EquipmentRecord {
  return {
    id: instance.id,
    assetId: asset.id,
    name: instance.name,
    kind: 'imported',
    status: 'OFF',
    numericStatus: instance.numericStatus,
    statusSource: instance.statusSource,
    statusOverlayVisible: instance.statusOverlayVisible,
    transform: {
      position: [...instance.transform.position],
      quaternion: [...instance.transform.quaternion],
      scale: [...instance.transform.scale],
    },
    graspable: true,
    collisionHalfExtents: [...asset.collisionHalfExtents],
    collisionCenter: [...asset.colliderCenter],
    stackLightAnchor: null,
  }
}

export function objectRecords(
  assets: readonly ObjectAssetRecordV1[],
  instances: readonly ObjectInstanceRecordV1[],
): EquipmentRecord[] {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
  return instances.flatMap((instance) => {
    const asset = assetsById.get(instance.assetId)
    return asset === undefined || !instance.visible
      ? []
      : [objectInstanceToEquipmentRecord(instance, asset)]
  })
}
