import { describe, expect, it, vi } from 'vitest'
import {
  removeCanonicalExternalEntity,
  routeCanonicalExternalEntity,
} from './external-entity-removal'

describe('removeCanonicalExternalEntity', () => {
  it('routes synchronous work without losing its result', () => {
    const equipment = vi.fn(() => 'equipment-result')
    const object = vi.fn(() => 'object-result')

    expect(
      routeCanonicalExternalEntity('equipment:shared-01', {
        equipment,
        object,
      }),
    ).toBe('equipment-result')
    expect(equipment).toHaveBeenCalledWith('shared-01')
    expect(object).not.toHaveBeenCalled()
  })

  it.each([
    ['equipment:shared-01', 'equipment'],
    ['object:shared-01', 'object'],
  ] as const)('routes %s to only its canonical owner', async (entityId, owner) => {
    const removeEquipment = vi.fn(async () => undefined)
    const removeObject = vi.fn(async () => undefined)

    await removeCanonicalExternalEntity(entityId, {
      removeEquipment,
      removeObject,
    })

    expect(removeEquipment).toHaveBeenCalledTimes(owner === 'equipment' ? 1 : 0)
    expect(removeObject).toHaveBeenCalledTimes(owner === 'object' ? 1 : 0)
    expect(
      owner === 'equipment' ? removeEquipment : removeObject,
    ).toHaveBeenCalledWith('shared-01')
  })
})
