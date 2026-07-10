import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  EquipmentRecord,
  SerializableTransform,
} from '../../domain/equipment/equipment'
import { EquipmentDatabase } from './equipment-db'
import {
  BUILT_IN_EQUIPMENT,
  createEquipmentStore,
  EQUIPMENT_CORRUPT_ROW_WARNING,
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
  it('preserves and commits an operator preview issued during slow hydration', async () => {
    const database = createDatabase('transform-hydration-race')
    const actualOpen = database.open.bind(database)
    let releaseOpen!: () => void
    const openGate = new Promise<void>((resolve) => {
      releaseOpen = resolve
    })
    vi.spyOn(database, 'open').mockImplementation(
      (async () => {
        await openGate
        return actualOpen()
      }) as typeof database.open,
    )
    const put = vi.spyOn(database.equipment, 'put')
    const store = createEquipmentStore(database)
    const operatorTransform: SerializableTransform = {
      position: [1.4, -0.3, 1.2],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    }

    const hydration = store.getState().hydrate()
    store
      .getState()
      .previewEquipmentTransform('cup-01', operatorTransform)
    const commit = store.getState().commitEquipmentTransform('cup-01')
    expect(
      store.getState().records.find(({ id }) => id === 'cup-01')?.transform,
    ).toEqual(operatorTransform)

    releaseOpen()
    await Promise.all([hydration, commit])

    expect(
      store.getState().records.find(({ id }) => id === 'cup-01')?.transform,
    ).toEqual(operatorTransform)
    expect(put).toHaveBeenCalledTimes(1)
    expect(put.mock.calls[0]?.[0].transform).toEqual(operatorTransform)
  })

  it('applies many transform previews in memory and persists one explicit commit', async () => {
    const database = createDatabase('transform-preview')
    const store = createEquipmentStore(database)
    await store.getState().hydrate()
    const put = vi.spyOn(database.equipment, 'put')
    const transforms: SerializableTransform[] = [1, 2, 3].map((x) => ({
      position: [x, -x, 1.15],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    }))

    for (const transform of transforms) {
      store.getState().previewEquipmentTransform('cup-01', transform)
    }

    expect(put).not.toHaveBeenCalled()
    expect(
      store.getState().records.find(({ id }) => id === 'cup-01')?.transform,
    ).toEqual(transforms[2])

    await store.getState().commitEquipmentTransform('cup-01')

    expect(put).toHaveBeenCalledTimes(1)
    expect(put.mock.calls[0]?.[0].transform).toEqual(transforms[2])
  })

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
      importMetadata: {
        sourceFileName: 'fixture.step',
        detectedUnit: 'millimeter',
        selectedSourceUnit: 'millimeter',
        postImportScale: 1,
        originMode: 'center',
        colliderCenter: [0, 0, 0],
      },
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
      importMetadata: imported.importMetadata,
    })
    const restoredBytes = restored?.sourceBytes
    expect(restoredBytes?.byteLength).toBe(5)
    if (restoredBytes === undefined) {
      throw new Error('Expected restored source bytes')
    }
    expect(Array.from(new Uint8Array(restoredBytes))).toEqual([1, 3, 5, 7, 9])
  })

  it('skips one corrupt row while retaining valid persisted equipment', async () => {
    const database = createDatabase('corrupt-row')
    const valid: EquipmentRecord = {
      id: 'valid-persisted-fixture',
      name: 'Valid Persisted Fixture',
      kind: 'imported',
      status: 'WARNING',
      transform: {
        position: [1.1, -0.2, 1.2],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
      graspable: true,
      collisionHalfExtents: [0.1, 0.1, 0.1],
      stackLightAnchor: null,
      sourceBytes: new Uint8Array([8, 6, 4, 2]).buffer,
      importMetadata: {
        sourceFileName: 'valid.step',
        detectedUnit: 'meter',
        selectedSourceUnit: 'meter',
        postImportScale: 1,
        originMode: 'source',
        colliderCenter: [0.05, 0.05, 0.05],
      },
    }
    const corrupt = {
      id: 'corrupt-persisted-fixture',
      name: 'Corrupt Persisted Fixture',
      kind: 'imported',
      status: 'RUNNING',
      graspable: false,
      collisionHalfExtents: [0.1, 0.1, 0.1],
      stackLightAnchor: null,
    } as unknown as EquipmentRecord
    await database.open()
    await database.equipment.bulkPut([valid, corrupt])
    const store = createEquipmentStore(database)

    await store.getState().hydrate()
    await store.getState().hydrate()

    expect(store.getState().persistenceStatus).toBe('persistent')
    expect(store.getState().records.map(({ id }) => id)).toEqual([
      'cup-01',
      'cup-02',
      'machine-01',
      valid.id,
    ])
    expect(store.getState().warnings).toEqual([
      EQUIPMENT_CORRUPT_ROW_WARNING,
    ])
    expect(EQUIPMENT_CORRUPT_ROW_WARNING).toMatch(/re-import/i)
  })

  it('copies caller bytes once and passes the store-owned bytes to Dexie', async () => {
    const database = createDatabase('source-bytes-copy')
    const store = createEquipmentStore(database)
    await store.getState().hydrate()
    const put = vi.spyOn(database.equipment, 'put')
    const callerBytes = new Uint8Array([2, 4, 6, 8]).buffer
    const callerView = new Uint8Array(callerBytes)
    const imported: EquipmentRecord = {
      id: 'copy-boundary-fixture',
      name: 'Copy Boundary Fixture',
      kind: 'imported',
      status: 'OFF',
      transform: {
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
      graspable: false,
      collisionHalfExtents: [0.1, 0.1, 0.1],
      stackLightAnchor: null,
      sourceBytes: callerBytes,
      importMetadata: {
        sourceFileName: 'copy.step',
        detectedUnit: 'meter',
        selectedSourceUnit: 'meter',
        postImportScale: 1,
        originMode: 'center',
        colliderCenter: [0, 0, 0],
      },
    }

    await store.getState().upsertEquipment(imported)

    const storeBytes = store
      .getState()
      .records.find(({ id }) => id === imported.id)?.sourceBytes
    expect(storeBytes).toBeDefined()
    if (storeBytes === undefined) {
      throw new Error('Expected the store to own a source byte copy')
    }
    expect(storeBytes).not.toBe(callerBytes)
    expect(put.mock.calls[0]?.[0].sourceBytes).toBe(storeBytes)
    expect(callerBytes.byteLength).toBe(4)
    expect(Array.from(callerView)).toEqual([2, 4, 6, 8])
    callerView[0] = 99
    expect(Array.from(new Uint8Array(storeBytes))).toEqual([2, 4, 6, 8])
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

  it('removes imported equipment from memory and IndexedDB', async () => {
    const database = createDatabase('remove')
    const store = createEquipmentStore(database)
    await store.getState().hydrate()
    const imported: EquipmentRecord = {
      id: 'remove-me',
      name: 'Remove Me',
      kind: 'imported',
      status: 'OFF',
      transform: {
        position: [0, 0, 1.2],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
      graspable: false,
      collisionHalfExtents: [0.1, 0.1, 0.1],
      stackLightAnchor: null,
      sourceBytes: new Uint8Array([1, 2]).buffer,
      importMetadata: {
        sourceFileName: 'remove.step',
        detectedUnit: 'meter',
        selectedSourceUnit: 'meter',
        postImportScale: 1,
        originMode: 'center',
        colliderCenter: [0, 0, 0],
      },
    }
    await store.getState().upsertEquipment(imported)

    await store.getState().removeEquipment(imported.id)

    expect(store.getState().records.some(({ id }) => id === imported.id)).toBe(false)
    expect(await database.equipment.get(imported.id)).toBeUndefined()
  })

  it('keeps a removal in memory when deleting from IndexedDB fails', async () => {
    const database = createDatabase('remove-failure')
    const store = createEquipmentStore(database)
    await store.getState().hydrate()
    vi.spyOn(database.equipment, 'delete').mockRejectedValueOnce(
      new Error('delete failed'),
    )

    await store.getState().removeEquipment('cup-01')

    expect(store.getState().records.some(({ id }) => id === 'cup-01')).toBe(false)
    expect(store.getState().persistenceStatus).toBe('memory-only')
    expect(store.getState().warnings).toHaveLength(1)
  })

  it('rejects invalid imported reload data before mutating memory or IndexedDB', async () => {
    const database = createDatabase('invalid-upsert')
    const store = createEquipmentStore(database)
    await store.getState().hydrate()
    const put = vi.spyOn(database.equipment, 'put')
    const invalid = {
      id: 'invalid-imported',
      name: 'Invalid Imported',
      kind: 'imported',
      status: 'OFF',
      transform: {
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
      graspable: false,
      collisionHalfExtents: [0.1, 0.1, 0.1],
      stackLightAnchor: null,
      sourceBytes: new Uint8Array([1]).buffer,
    } as unknown as EquipmentRecord

    await expect(store.getState().upsertEquipment(invalid)).rejects.toThrow(
      /invalid equipment record/i,
    )

    expect(store.getState().records.some(({ id }) => id === invalid.id)).toBe(false)
    expect(put).not.toHaveBeenCalled()
  })
})
