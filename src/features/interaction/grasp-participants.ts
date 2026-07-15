import type { EquipmentRecord } from '../../domain/equipment/equipment'
import type {
  ObjectInstanceRecordV1,
} from '../../domain/project/project'
import {
  objectRecords,
  type ObjectAssetSceneReadModelV3,
} from '../objects/object-equipment-adapter'
import type { ExternalCollisionEntityId } from './interaction-store'

export interface RuntimeGraspParticipant {
  readonly entityId: ExternalCollisionEntityId
  readonly record: EquipmentRecord
}

export function collisionEntityToGraspParticipantId(
  value: unknown,
): ExternalCollisionEntityId | null {
  if (typeof value !== 'string') return null
  if (
    (value.startsWith('equipment:') || value.startsWith('object:')) &&
    !value.endsWith(':')
  ) {
    return value as ExternalCollisionEntityId
  }
  return null
}

export function runtimeGraspParticipants(
  equipmentRecords: readonly EquipmentRecord[],
  assets: readonly ObjectAssetSceneReadModelV3[],
  instances: readonly ObjectInstanceRecordV1[],
): RuntimeGraspParticipant[] {
  return [
    ...equipmentRecords.map((record) => ({
      entityId: `equipment:${record.id}` as const,
      record,
    })),
    ...objectRecords(assets, instances).map((record) => ({
      entityId: `object:${record.id}` as const,
      record,
    })),
  ]
}
