import { describe, expect, it, vi } from 'vitest'
import type { SerializableTransform } from '../../domain/equipment/equipment'
import { createInteractionStore } from '../interaction/interaction-store'
import { deleteImportedEquipment } from './imported-equipment-actions'

const OFFSET: SerializableTransform = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
}

describe('deleteImportedEquipment', () => {
  it('removes persistence before invalidating geometry and clearing matching selection', async () => {
    const calls: string[] = []
    const dependencies = {
      beginEquipmentRemoval: vi.fn(() => {
        calls.push('begin')
        return true
      }),
      endEquipmentRemoval: vi.fn(() => {
        calls.push('end')
      }),
      releaseHeldEquipment: vi.fn(async () => {
        calls.push('release')
      }),
      removeEquipment: vi.fn(async () => {
        calls.push('record')
      }),
      invalidateGeometry: vi.fn(() => {
        calls.push('geometry')
      }),
      getSelectedEquipmentId: () => 'imported-01',
      clearSelection: vi.fn(() => {
        calls.push('selection')
      }),
    }

    await deleteImportedEquipment('imported-01', dependencies)

    expect(calls).toEqual([
      'begin',
      'release',
      'record',
      'geometry',
      'selection',
      'end',
    ])
  })

  it('leaves cache and selection unchanged when record removal rejects', async () => {
    const invalidateGeometry = vi.fn()
    const clearSelection = vi.fn()

    await expect(
      deleteImportedEquipment('imported-01', {
        beginEquipmentRemoval: () => true,
        endEquipmentRemoval: vi.fn(),
        releaseHeldEquipment: vi.fn(async () => undefined),
        removeEquipment: vi.fn(async () => {
          throw new Error('remove failed')
        }),
        invalidateGeometry,
        getSelectedEquipmentId: () => 'imported-01',
        clearSelection,
      }),
    ).rejects.toThrow('remove failed')

    expect(invalidateGeometry).not.toHaveBeenCalled()
    expect(clearSelection).not.toHaveBeenCalled()
  })

  it('aborts removal when release persistence rejects', async () => {
    const removeEquipment = vi.fn(async () => undefined)
    const invalidateGeometry = vi.fn()

    await expect(
      deleteImportedEquipment('imported-01', {
        beginEquipmentRemoval: () => true,
        endEquipmentRemoval: vi.fn(),
        releaseHeldEquipment: vi.fn(async () => {
          throw new Error('release persistence failed')
        }),
        removeEquipment,
        invalidateGeometry,
        getSelectedEquipmentId: () => 'imported-01',
        clearSelection: vi.fn(),
      }),
    ).rejects.toThrow('release persistence failed')

    expect(removeEquipment).not.toHaveBeenCalled()
    expect(invalidateGeometry).not.toHaveBeenCalled()
  })

  it('blocks re-grasp during deferred release persistence and leaves no stale held id', async () => {
    const interactionStore = createInteractionStore()
    interactionStore.getState().enterGraspCandidate('imported-01')
    interactionStore.getState().holdEquipment('imported-01', OFFSET)
    let finishRelease!: () => void
    const releaseGate = new Promise<void>((resolve) => {
      finishRelease = resolve
    })
    const deletion = deleteImportedEquipment('imported-01', {
      beginEquipmentRemoval: (id) =>
        interactionStore.getState().beginEquipmentRemoval(id),
      endEquipmentRemoval: (id) => {
        interactionStore.getState().endEquipmentRemoval(id)
      },
      releaseHeldEquipment: async (id) => {
        interactionStore.getState().releaseHeldEquipment(id)
        await releaseGate
      },
      removeEquipment: vi.fn(async () => undefined),
      invalidateGeometry: vi.fn(),
      getSelectedEquipmentId: () => null,
      clearSelection: vi.fn(),
    })

    await Promise.resolve()
    interactionStore.getState().enterGraspCandidate('imported-01')
    expect(
      interactionStore.getState().holdEquipment('imported-01', OFFSET),
    ).toBe(false)
    expect(interactionStore.getState()).toMatchObject({
      heldEquipmentId: null,
      removingEquipmentIds: ['imported-01'],
    })

    finishRelease()
    await deletion

    expect(interactionStore.getState()).toMatchObject({
      heldEquipmentId: null,
      removingEquipmentIds: [],
    })
  })
})
