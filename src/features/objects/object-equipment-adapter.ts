import type { EquipmentRecord } from '../../domain/equipment/equipment'
import type {
  ObjectAssetRecordV1,
  ObjectInstanceRecordV1,
} from '../../domain/project/project'

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
    graspable: false,
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
