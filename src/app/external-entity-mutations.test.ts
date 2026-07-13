import { describe, expect, it, vi } from 'vitest'
import type { SerializableTransform } from '../domain/equipment/equipment'
import { createCanonicalExternalEntityMutations } from './external-entity-mutations'

const TRANSFORM: SerializableTransform = {
  position: [1, 2, 3],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
}

describe('canonical external Entity mutations', () => {
  it.each(['equipment', 'object'] as const)(
    'routes every %s mutation to only its canonical owner',
    async (owner) => {
      const dependencies = {
        previewEquipment: vi.fn(),
        previewObject: vi.fn(),
        commitEquipment: vi.fn(async () => undefined),
        commitObject: vi.fn(async () => undefined),
        cancelEquipment: vi.fn(),
        cancelObject: vi.fn(),
        setEquipmentNumericStatus: vi.fn(async () => undefined),
        setEquipmentOverlayVisible: vi.fn(async () => undefined),
        setEquipmentStatusSource: vi.fn(async () => undefined),
        updateObject: vi.fn(async () => undefined),
      }
      const mutations = createCanonicalExternalEntityMutations(dependencies)
      const entityId = `${owner}:shared-01` as const

      mutations.preview(entityId, TRANSFORM)
      await mutations.commit(entityId)
      mutations.cancel(entityId)
      await mutations.setNumericStatus(entityId, 42.5)
      await mutations.setOverlayVisible(entityId, false)
      await mutations.setStatusSource(entityId, 'opcua')

      expect(dependencies.previewEquipment).toHaveBeenCalledTimes(
        owner === 'equipment' ? 1 : 0,
      )
      expect(dependencies.previewObject).toHaveBeenCalledTimes(
        owner === 'object' ? 1 : 0,
      )
      expect(dependencies.commitEquipment).toHaveBeenCalledTimes(
        owner === 'equipment' ? 1 : 0,
      )
      expect(dependencies.commitObject).toHaveBeenCalledTimes(
        owner === 'object' ? 1 : 0,
      )
      expect(dependencies.cancelEquipment).toHaveBeenCalledTimes(
        owner === 'equipment' ? 1 : 0,
      )
      expect(dependencies.cancelObject).toHaveBeenCalledTimes(
        owner === 'object' ? 1 : 0,
      )

      if (owner === 'equipment') {
        expect(dependencies.previewEquipment).toHaveBeenCalledWith(
          'shared-01',
          TRANSFORM,
        )
        expect(dependencies.commitEquipment).toHaveBeenCalledWith('shared-01')
        expect(dependencies.cancelEquipment).toHaveBeenCalledWith('shared-01')
        expect(dependencies.setEquipmentNumericStatus).toHaveBeenCalledWith(
          'shared-01',
          42.5,
        )
        expect(dependencies.setEquipmentOverlayVisible).toHaveBeenCalledWith(
          'shared-01',
          false,
        )
        expect(dependencies.setEquipmentStatusSource).toHaveBeenCalledWith(
          'shared-01',
          'opcua',
        )
        expect(dependencies.updateObject).not.toHaveBeenCalled()
      } else {
        expect(dependencies.previewObject).toHaveBeenCalledWith(
          'shared-01',
          TRANSFORM,
        )
        expect(dependencies.commitObject).toHaveBeenCalledWith('shared-01')
        expect(dependencies.cancelObject).toHaveBeenCalledWith('shared-01')
        expect(dependencies.updateObject.mock.calls).toEqual([
          ['shared-01', { numericStatus: 42.5, statusSource: 'manual' }],
          ['shared-01', { statusOverlayVisible: false }],
          ['shared-01', { statusSource: 'opcua' }],
        ])
        expect(dependencies.setEquipmentNumericStatus).not.toHaveBeenCalled()
        expect(dependencies.setEquipmentOverlayVisible).not.toHaveBeenCalled()
        expect(dependencies.setEquipmentStatusSource).not.toHaveBeenCalled()
      }
    },
  )
})
