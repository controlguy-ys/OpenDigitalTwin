import { describe, expect, it } from 'vitest'
import type { EquipmentRecord } from '../../domain/equipment/equipment'
import {
  equipmentRecordEntityId,
  findEquipmentRecordByEntityId,
} from './equipment-entity-selection'

const EQUIPMENT: EquipmentRecord = {
  id: 'shared-01',
  name: 'Equipment Shared',
  kind: 'machine',
  status: 'OFF',
  transform: {
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  },
  graspable: false,
  collisionHalfExtents: [0.1, 0.1, 0.1],
  stackLightAnchor: null,
}

const OBJECT: EquipmentRecord = {
  ...EQUIPMENT,
  assetId: 'asset-01',
  name: 'Object Shared',
}

describe('canonical Equipment record selection', () => {
  it('resolves same-local-id Equipment and Object records by namespace', () => {
    const records = [EQUIPMENT, OBJECT]

    expect(
      findEquipmentRecordByEntityId(records, 'equipment:shared-01'),
    ).toBe(EQUIPMENT)
    expect(
      findEquipmentRecordByEntityId(records, 'object:shared-01'),
    ).toBe(OBJECT)
    expect(equipmentRecordEntityId(EQUIPMENT)).toBe('equipment:shared-01')
    expect(equipmentRecordEntityId(OBJECT)).toBe('object:shared-01')
  })
})
