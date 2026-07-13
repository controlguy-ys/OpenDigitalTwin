import type { EquipmentRecord } from '../../domain/equipment/equipment'
import type { ExternalCollisionEntityId } from '../interaction/interaction-store'

export function equipmentRecordEntityId(
  record: Pick<EquipmentRecord, 'assetId' | 'id'>,
): ExternalCollisionEntityId {
  return record.assetId === undefined
    ? `equipment:${record.id}`
    : `object:${record.id}`
}

export function findEquipmentRecordByEntityId(
  records: readonly EquipmentRecord[],
  entityId: ExternalCollisionEntityId | null,
): EquipmentRecord | null {
  if (entityId === null) return null
  return (
    records.find((record) => equipmentRecordEntityId(record) === entityId) ?? null
  )
}
