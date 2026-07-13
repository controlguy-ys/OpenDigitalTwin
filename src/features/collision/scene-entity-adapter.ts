import type { Object3D } from 'three'
import { validateCollisionBox, type CollisionBox } from '../../domain/collision/collision'
import type { EquipmentRecord } from '../../domain/equipment/equipment'
import type {
  RobotLinkGeometryRecordV1,
  RobotLinkGeometryRecordV2,
} from '../../domain/project/project'
import type { GeometryEntityRegistration } from './geometry-entity-registry'

export { objectInstanceToGeometryEntity } from '../objects/object-equipment-adapter'

type RobotLinkCollisionRecord = Pick<
  RobotLinkGeometryRecordV1,
  'linkId' | 'collisionCenter' | 'collisionHalfExtents'
> & Partial<Pick<RobotLinkGeometryRecordV2, 'collisionBoxes'>>

function defaultBox(
  center: readonly [number, number, number],
  halfExtents: readonly [number, number, number],
) {
  return Object.freeze({
    id: 'default',
    center: Object.freeze([...center]) as readonly [number, number, number],
    halfExtents: Object.freeze([...halfExtents]) as readonly [
      number,
      number,
      number,
    ],
    quaternion: Object.freeze([0, 0, 0, 1]) as readonly [
      number,
      number,
      number,
      number,
    ],
  })
}

function registration(
  value: Omit<GeometryEntityRegistration, 'boxes'> & {
    readonly boxes: readonly CollisionBox[]
  },
): GeometryEntityRegistration {
  return Object.freeze({
    id: value.id,
    name: value.name,
    category: value.category,
    boxes: Object.freeze(value.boxes.map(validateCollisionBox)),
    object: value.object,
    colliderRevision: value.colliderRevision ?? 0,
  })
}

export function equipmentRecordToGeometryEntity(
  record: EquipmentRecord,
  object: Object3D | null,
  held = false,
  colliderRevision = 0,
): GeometryEntityRegistration {
  return registration({
    id: `equipment:${record.id}`,
    name: record.name,
    category: held ? 'held-object' : 'equipment',
    boxes: [
      defaultBox(
        record.collisionCenter ??
          record.importMetadata?.colliderCenter ??
          [0, 0, 0],
        record.collisionHalfExtents,
      ),
    ],
    object,
    colliderRevision,
  })
}

export function robotLinkToGeometryEntity(
  record: RobotLinkCollisionRecord,
  object: Object3D | null,
  colliderRevision = 0,
): GeometryEntityRegistration {
  return registration({
    id: `robot-link:${record.linkId}`,
    name: record.linkId,
    category: 'robot-link',
    boxes: record.collisionBoxes ?? [
      defaultBox(record.collisionCenter, record.collisionHalfExtents),
    ],
    object,
    colliderRevision,
  })
}

export function workbenchToGeometryEntity(
  object: Object3D | null,
  colliderRevision = 0,
): GeometryEntityRegistration {
  return registration({
    id: 'workcell:workbench',
    name: 'Workbench',
    category: 'environment',
    boxes: [defaultBox([0, 0, 1.03], [0.9, 0.6, 0.05])],
    object,
    colliderRevision,
  })
}
