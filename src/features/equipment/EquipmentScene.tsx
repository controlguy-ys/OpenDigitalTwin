import { memo, useEffect, useSyncExternalStore } from 'react'
import type { EquipmentRecord } from '../../domain/equipment/equipment'
import { BuiltInEquipment } from './BuiltInEquipment'
import { StackLight } from './StackLight'
import { useEquipmentStore } from './equipment-store'
import { importedGeometryRepository } from '../import/imported-geometry-repository'

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
      {record.kind === 'imported' ? (
        <ImportedEquipment record={record} />
      ) : (
        <BuiltInEquipment record={record} />
      )}
    </group>
  )
})

function ImportedEquipment({ record }: EquipmentInstanceProps) {
  useSyncExternalStore(
    importedGeometryRepository.subscribe,
    importedGeometryRepository.getSnapshot,
    importedGeometryRepository.getSnapshot,
  )
  const asset = importedGeometryRepository.get(record.id)

  useEffect(() => {
    if (asset === undefined) {
      void importedGeometryRepository.load(record).catch(() => undefined)
    }
  }, [asset, record])

  if (asset === undefined) {
    return null
  }

  return (
    <group name={`${record.id}-imported-visual`}>
      <primitive object={asset.group} />
      {record.stackLightAnchor === null ? null : (
        <group
          name={`${record.id}-stack-light-anchor`}
          position={record.stackLightAnchor}
        >
          <StackLight name={`${record.id}-stack-light`} status={record.status} />
        </group>
      )}
    </group>
  )
}

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
