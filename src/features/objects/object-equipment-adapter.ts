import type { EquipmentRecord } from '../../domain/equipment/equipment'
import { validateCollisionBox } from '../../domain/collision/collision'
import type {
  ObjectInstanceRecordV1,
} from '../../domain/project/project'
import type { CollisionBox } from '../../domain/collision/collision'
import type { Object3D } from 'three'
import type { GeometryEntityRegistration } from '../collision/geometry-entity-registry'

export interface ObjectAssetSceneReadModelV3 {
  readonly id: string
  readonly name: string
  readonly colliderCenter: readonly [number, number, number]
  readonly collisionHalfExtents: readonly [number, number, number]
  readonly collisionBoxes?: readonly CollisionBox[] | undefined
}

export type ObjectInstanceSceneReadModelV3 = ObjectInstanceRecordV1 & {
  readonly graspable?: boolean
}

export function objectInstanceToGeometryEntity(
  asset: ObjectAssetSceneReadModelV3,
  instance: ObjectInstanceSceneReadModelV3,
  object: Object3D | null,
  held = false,
  colliderRevision = 0,
): GeometryEntityRegistration {
  const boxes = asset.collisionBoxes !== undefined
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
  instance: ObjectInstanceSceneReadModelV3,
  asset: ObjectAssetSceneReadModelV3,
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
    graspable: instance.graspable ?? true,
    collisionHalfExtents: [...asset.collisionHalfExtents],
    collisionCenter: [...asset.colliderCenter],
    stackLightAnchor: null,
  }
}

export function objectRecords(
  assets: readonly ObjectAssetSceneReadModelV3[],
  instances: readonly ObjectInstanceSceneReadModelV3[],
): EquipmentRecord[] {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
  return instances.flatMap((instance) => {
    const asset = assetsById.get(instance.assetId)
    return asset === undefined || !instance.visible
      ? []
      : [objectInstanceToEquipmentRecord(instance, asset)]
  })
}
