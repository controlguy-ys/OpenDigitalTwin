import { describe, expect, it, vi } from 'vitest'
import type {
  EquipmentRecord,
  SerializableTransform,
} from '../../domain/equipment/equipment'
import {
  releaseHeldEquipmentAtTool,
  resetInteractionAtTool,
} from './grasp-actions'

const RECORD: EquipmentRecord = {
  id: 'cup-01',
  name: 'Cup 01',
  kind: 'cup',
  status: 'RUNNING',
  transform: {
    position: [0.75, 0, 1.15],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  },
  graspable: true,
  collisionHalfExtents: [0.055, 0.055, 0.075],
  stackLightAnchor: null,
}
const GRIP_OFFSET: SerializableTransform = {
  position: [0.1, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
}

function createDependencies(calls: string[] = []) {
  let held = {
    entityId: 'equipment:cup-01' as const,
    equipmentId: 'cup-01',
    gripOffset: GRIP_OFFSET,
  } as {
    entityId: 'equipment:cup-01'
    equipmentId: string
    gripOffset: SerializableTransform
  } | null
  return {
    getHeld: () => held,
    getEquipment: (id: string) =>
      id === 'equipment:cup-01' ? RECORD : undefined,
    previewTransform: vi.fn((_id: string, _transform: SerializableTransform) => {
      calls.push('preview')
    }),
    clearHeld: vi.fn(() => {
      calls.push('clear-held')
      held = null
    }),
    commitTransform: vi.fn(async () => {
      calls.push('commit')
    }),
    resetInteraction: vi.fn(() => {
      calls.push('reset')
    }),
    toPersistedTransform: (world: SerializableTransform) => world,
  }
}

describe('grasp release actions', () => {
  it('routes an imported Object release through its canonical persistence owner', async () => {
    const objectRecord: EquipmentRecord = {
      ...RECORD,
      id: 'shared-01',
      name: 'Imported Object',
      kind: 'imported',
      assetId: 'asset-01',
      collisionCenter: [0.02, 0, 0.03],
    }
    const dependencies = {
      getHeld: () => ({
        entityId: 'object:shared-01' as const,
        equipmentId: 'shared-01',
        gripOffset: GRIP_OFFSET,
      }),
      getEquipment: vi.fn((entityId: string) =>
        entityId === 'object:shared-01' ? objectRecord : undefined,
      ),
      previewTransform: vi.fn(),
      clearHeld: vi.fn(),
      commitTransform: vi.fn(async () => undefined),
      resetInteraction: vi.fn(),
      toPersistedTransform: (world: SerializableTransform) => world,
    }

    const released = await releaseHeldEquipmentAtTool(
      'object:shared-01',
      { ...RECORD.transform, position: [0.65, 0, 1.1265] },
      1.08,
      dependencies,
    )

    expect(released).not.toBeNull()
    expect(released?.position[2]).toBeCloseTo(1.125, 6)
    expect(dependencies.getEquipment).toHaveBeenCalledWith('object:shared-01')
    expect(dependencies.previewTransform).toHaveBeenCalledWith(
      'object:shared-01',
      expect.any(Object),
    )
    expect(dependencies.clearHeld).toHaveBeenCalledWith('object:shared-01')
    expect(dependencies.commitTransform).toHaveBeenCalledWith('object:shared-01')
  })

  it('moves the tool, releases to toolWorld * gripOffset, and commits after preview', async () => {
    const calls: string[] = []
    const dependencies = createDependencies(calls)
    const toolWorld: SerializableTransform = {
      position: [1, 2, 1.155],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    }

    const released = await releaseHeldEquipmentAtTool(
      'cup-01',
      toolWorld,
      1.08,
      dependencies,
    )

    expect(released?.position).toEqual([1.1, 2, 1.155])
    expect(dependencies.previewTransform).toHaveBeenCalledWith(
      'equipment:cup-01',
      released,
    )
    expect(calls).toEqual(['preview', 'clear-held', 'commit'])
  })

  it('reset persists a held release before clearing transient interaction state', async () => {
    const calls: string[] = []
    const dependencies = createDependencies(calls)

    await resetInteractionAtTool(
      { ...RECORD.transform, position: [0.65, 0, 1.155] },
      1.08,
      dependencies,
    )

    expect(calls).toEqual(['preview', 'clear-held', 'commit', 'reset'])
  })

  it('converts the released world pose before preview persistence', async () => {
    const dependencies = createDependencies()
    dependencies.toPersistedTransform = (world) => ({
      ...world,
      position: [world.position[0] - 1, world.position[1], world.position[2]],
    })

    const released = await releaseHeldEquipmentAtTool(
      'cup-01',
      {
        position: [1, 0, 1.155],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
      1.08,
      dependencies,
    )

    expect(released?.position).toEqual([1.1, 0, 1.155])
    const persistedTransform = vi.mocked(dependencies.previewTransform).mock.calls[0]?.[1]
    expect(persistedTransform?.position[0]).toBeCloseTo(0.1)
    expect(persistedTransform?.position[1]).toBeCloseTo(0)
    expect(persistedTransform?.position[2]).toBeCloseTo(1.155)
  })
})
