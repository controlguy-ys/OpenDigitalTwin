import { memo } from 'react'
import type { EquipmentRecord } from '../../domain/equipment/equipment'
import { BuiltInEquipment } from './BuiltInEquipment'
import { useEquipmentStore } from './equipment-store'

interface EquipmentInstanceProps {
  record: EquipmentRecord
}

const EquipmentInstance = memo(function EquipmentInstance({
  record,
}: EquipmentInstanceProps) {
  return (
    <group
      name={record.id}
      position={record.transform.position}
      quaternion={record.transform.quaternion}
      scale={record.transform.scale}
      userData={{ equipmentId: record.id }}
    >
      <BuiltInEquipment record={record} />
    </group>
  )
})

export function EquipmentScene() {
  const records = useEquipmentStore((state) => state.records)

  return (
    <group name="equipment-scene">
      {records.map((record) => (
        <EquipmentInstance key={record.id} record={record} />
      ))}
    </group>
  )
}
