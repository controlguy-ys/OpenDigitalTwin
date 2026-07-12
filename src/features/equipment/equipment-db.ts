import Dexie, { type Table } from 'dexie'
import type { EquipmentRecord } from '../../domain/equipment/equipment'

export interface SceneDatabaseRecord {
  key: string
  selectedEquipmentId: string | null
  deletedEquipmentIds?: string[]
}

export class EquipmentDatabase extends Dexie {
  equipment!: Table<EquipmentRecord, string>
  scene!: Table<SceneDatabaseRecord, string>

  constructor(name = 'robot-sim-equipment') {
    super(name)

    this.version(1).stores({
      equipment: '&id, kind, status, name',
      scene: '&key',
    })
  }
}

export const equipmentDb = new EquipmentDatabase()
