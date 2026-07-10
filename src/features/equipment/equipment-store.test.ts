import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EquipmentRecord } from '../../domain/equipment/equipment'
import { EquipmentDatabase } from './equipment-db'
import {
  BUILT_IN_EQUIPMENT,
  createEquipmentStore,
} from './equipment-store'

const openDatabases: EquipmentDatabase[] = []
const databaseNames = new Set<string>()
let databaseIndex = 0

function createDatabase(label: string): EquipmentDatabase {
  databaseIndex += 1
  const name = `equipment-store-${label}-${databaseIndex}`
  databaseNames.add(name)
  const database = new EquipmentDatabase(name)
  openDatabases.push(database)
  return database
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const database of openDatabases.splice(0)) {
    database.close()
  }
  for (const name of databaseNames) {
    await Dexie.delete(name)
  }
  databaseNames.clear()
})

describe('built-in equipment', () => {
  it('defines exactly the two cups and machine at their approved transforms', () => {
    expect(BUILT_IN_EQUIPMENT).toHaveLength(3)
    expect(BUILT_IN_EQUIPMENT).toEqual([
      expect.objectContaining({
        id: 'cup-01',
        name: 'Cup 01',
        kind: 'cup',
        status: 'RUNNING',
        graspable: true,
        transform: expect.objectContaining({ position: [0.75, 0, 1.15] }),
      }),
      expect.objectContaining({
        id: 'cup-02',
        name: 'Cup 02',
        kind: 'cup',
        status: 'WARNING',
        graspable: true,
        transform: expect.objectContaining({ position: [0.72, -0.18, 1.15] }),
      }),
      expect.objectContaining({
        id: 'machine-01',
        name: 'Machine 01',
        kind: 'machine',
        status: 'RUNNING',
        graspable: false,
        stackLightAnchor: [0, 0, 0.32],
        transform: expect.objectContaining({ position: [0.92, 0.35, 1.28] }),
      }),
    ])
  })

  it('seeds an empty database once even when hydration is requested twice', async () => {
    const database = createDatabase('seed')
    const open = vi.spyOn(database, 'open')
    const store = createEquipmentStore(database)

    await Promise.all([
      store.getState().hydrate(),
      store.getState().hydrate(),
    ])

    expect(open).toHaveBeenCalledTimes(1)
    expect(await database.equipment.toArray()).toHaveLength(3)
    expect(store.getState()).toMatchObject({
      records: BUILT_IN_EQUIPMENT,
      persistenceStatus: 'persistent',
      warnings: [],
    })
  })
})

describe('equipment persistence', () => {
  it('restores imported source bytes, status, and transform in a recreated store', async () => {
    const firstDatabase = createDatabase('restore')
    const firstStore = createEquipmentStore(firstDatabase)
    const imported: EquipmentRecord = {
      id: 'imported-fixture',
      name: 'Imported Fixture',
      kind: 'imported',
      status: 'FAULT',
      transform: {
        position: [1.2, -0.4, 1.08],
        quaternion: [0, 0, 0.7071068, 0.7071068],
        scale: [0.001, 0.001, 0.001],
      },
      graspable: false,
      collisionHalfExtents: [0.12, 0.1, 0.08],
      stackLightAnchor: [0, 0, 0.26],
      sourceBytes: new Uint8Array([1, 3, 5, 7, 9]).buffer,
    }

    await firstStore.getState().hydrate()
    await firstStore.getState().upsertEquipment(imported)
    firstDatabase.close()

    const secondDatabase = new EquipmentDatabase(firstDatabase.name)
    openDatabases.push(secondDatabase)
    const recreatedStore = createEquipmentStore(secondDatabase)
    await recreatedStore.getState().hydrate()

    const restored = recreatedStore
      .getState()
      .records.find(({ id }) => id === imported.id)
    expect(restored).toMatchObject({
      id: imported.id,
      status: imported.status,
      transform: imported.transform,
    })
    const restoredBytes = restored?.sourceBytes
    expect(restoredBytes?.byteLength).toBe(5)
    if (restoredBytes === undefined) {
      throw new Error('Expected restored source bytes')
    }
    expect(Array.from(new Uint8Array(restoredBytes))).toEqual([1, 3, 5, 7, 9])
  })

  it('retains built-ins in memory and warns once when opening IndexedDB fails', async () => {
    const database = createDatabase('open-failure')
    const open = vi
      .spyOn(database, 'open')
      .mockRejectedValueOnce(new Error('IndexedDB is blocked'))
    const store = createEquipmentStore(database)

    await expect(store.getState().hydrate()).resolves.toBeUndefined()
    await expect(store.getState().hydrate()).resolves.toBeUndefined()

    expect(open).toHaveBeenCalledTimes(1)
    expect(store.getState()).toMatchObject({
      records: BUILT_IN_EQUIPMENT,
      persistenceStatus: 'memory-only',
    })
    expect(store.getState().warnings).toHaveLength(1)
  })

  it('keeps an explicit update in memory when its database write fails', async () => {
    const database = createDatabase('write-failure')
    const store = createEquipmentStore(database)
    await store.getState().hydrate()
    vi.spyOn(database.equipment, 'put').mockRejectedValueOnce(
      new Error('storage quota exceeded'),
    )

    await expect(
      store.getState().setEquipmentStatus('machine-01', 'FAULT'),
    ).resolves.toBeUndefined()

    expect(
      store.getState().records.find(({ id }) => id === 'machine-01')?.status,
    ).toBe('FAULT')
    expect(store.getState().persistenceStatus).toBe('memory-only')
    expect(store.getState().warnings).toHaveLength(1)
  })
})
