import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  ObjectAssetRecordV2,
  ObjectInstanceRecordV1,
} from '../../domain/project/project'
import { ObjectAssetDatabase } from './object-asset-db'
import { createObjectAssetStore } from './object-asset-store'

const databases: ObjectAssetDatabase[] = []
const databaseNames = new Set<string>()
let databaseIndex = 0

function createDatabase(label: string) {
  const name = `object-assets-${label}-${++databaseIndex}`
  const database = new ObjectAssetDatabase(name)
  databases.push(database)
  databaseNames.add(name)
  return database
}

function machineAsset(): ObjectAssetRecordV2 {
  return {
    id: 'machine-asset',
    name: 'Machine asset',
    sourceFileName: 'machine.step',
    sourceBytes: new Uint8Array([1, 2, 3, 4]).buffer,
    importScale: 0.001,
    originMode: 'source',
    colliderCenter: [0, 0, 0.1],
    collisionHalfExtents: [0.5, 0.4, 0.3],
    collisionBoxes: [
      {
        id: 'main',
        center: [0, 0, 0.1],
        halfExtents: [0.5, 0.4, 0.3],
        quaternion: [0, 0, 0, 1],
      },
      {
        id: 'guard',
        center: [0.5, 0, 0.4],
        halfExtents: [0.1, 0.2, 0.1],
        quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      },
    ],
    statistics: { vertices: 24, triangles: 8, meshes: 1, materials: 1 },
  }
}

function machineInstance(id: string): ObjectInstanceRecordV1 {
  return {
    id,
    assetId: 'machine-asset',
    name: id,
    transform: {
      position: [0.6, 0.3, 1.1],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    numericStatus: 0,
    statusSource: 'manual',
    statusOverlayVisible: true,
    visible: true,
  }
}

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  for (const name of databaseNames) await Dexie.delete(name)
  databaseNames.clear()
})

describe('Object Asset persistence', () => {
  it('migrates legacy IndexedDB Asset rows and preserves Instances', async () => {
    const db = createDatabase('legacy-rows')
    const { collisionBoxes: _boxes, ...legacy } = machineAsset()
    const instance = machineInstance('machine-legacy')
    instance.transform.position = [0.9, 0.8, 0.7]
    await db.transaction('rw', db.assets, db.instances, async () => {
      await db.assets.add(legacy as unknown as ObjectAssetRecordV2)
      await db.instances.add(instance)
    })
    const store = createObjectAssetStore(db)

    await store.getState().hydrate()

    expect(store.getState().persistenceStatus).toBe('persistent')
    expect(store.getState().assets[0]!.collisionBoxes).toEqual([{
      id: 'default',
      center: [0, 0, 0.1],
      halfExtents: [0.5, 0.4, 0.3],
      quaternion: [0, 0, 0, 1],
    }])
    expect(store.getState().instances[0]!.transform.position).toEqual([
      0.9, 0.8, 0.7,
    ])
    expect(Array.from(new Uint8Array(store.getState().assets[0]!.sourceBytes))).toEqual([
      1, 2, 3, 4,
    ])
    expect((await db.assets.get('machine-asset'))?.collisionBoxes[0]!.id).toBe(
      'default',
    )
  })

  it('does not reinterpret an invalid V2 Box array as legacy data', async () => {
    const db = createDatabase('invalid-v2-row')
    const invalid = machineAsset()
    invalid.collisionBoxes = []
    await db.assets.add(invalid)
    const store = createObjectAssetStore(db)

    await store.getState().hydrate()

    expect(store.getState().persistenceStatus).toBe('memory-only')
    expect(store.getState().assets).toEqual([])
    expect((await db.assets.get('machine-asset'))?.collisionBoxes).toEqual([])
  })

  it('stores one STEP Asset and restores two Instances that reference it', async () => {
    const firstDatabase = createDatabase('sharing')
    const store = createObjectAssetStore(firstDatabase)
    await store.getState().upsertAsset(machineAsset())
    await store.getState().createInstance(machineInstance('machine-01'))
    await store.getState().createInstance(machineInstance('machine-02'))
    firstDatabase.close()

    const reopenedDatabase = new ObjectAssetDatabase(firstDatabase.name)
    databases.push(reopenedDatabase)
    const reopened = createObjectAssetStore(reopenedDatabase)
    await reopened.getState().hydrate()

    expect(reopened.getState().assets).toHaveLength(1)
    expect(reopened.getState().instances).toHaveLength(2)
    expect(reopened.getState().instances.map(({ assetId }) => assetId)).toEqual([
      'machine-asset',
      'machine-asset',
    ])
  })

  it('refuses to delete an Asset while Instances still reference it', async () => {
    const store = createObjectAssetStore(createDatabase('delete-guard'))
    await store.getState().upsertAsset(machineAsset())
    await store.getState().createInstance(machineInstance('machine-01'))

    await expect(store.getState().removeAsset('machine-asset')).rejects.toThrow(
      'Instances',
    )
    expect(store.getState().assets).toHaveLength(1)
  })

  it('owns copies of source bytes and transform tuples', async () => {
    const store = createObjectAssetStore(createDatabase('copy-boundary'))
    const asset = machineAsset()
    const instance = machineInstance('machine-01')

    await store.getState().upsertAsset(asset)
    await store.getState().createInstance(instance)
    new Uint8Array(asset.sourceBytes)[0] = 99
    instance.transform.position[0] = 99
    asset.collisionBoxes[1]!.center[0] = 99

    expect(
      Array.from(new Uint8Array(store.getState().assets[0]!.sourceBytes)),
    ).toEqual([1, 2, 3, 4])
    expect(store.getState().instances[0]!.transform.position).toEqual([
      0.6, 0.3, 1.1,
    ])
    expect(store.getState().assets[0]!.collisionBoxes[1]!.center).toEqual([
      0.5, 0, 0.4,
    ])
  })

  it('preserves all Compound Boxes when replacing a project', async () => {
    const store = createObjectAssetStore(createDatabase('replace-compound'))
    const asset = machineAsset()
    await store.getState().replaceProject([asset], [machineInstance('machine-01')])

    expect(store.getState().assets[0]!.collisionBoxes).toEqual(
      machineAsset().collisionBoxes,
    )
    asset.collisionBoxes[0]!.halfExtents[0] = 99
    expect(store.getState().assets[0]!.collisionBoxes[0]!.halfExtents[0]).toBe(0.5)
  })

  it('repairs the legacy bounds mirror from the canonical first Box', async () => {
    const store = createObjectAssetStore(createDatabase('legacy-mirror'))
    const asset = machineAsset()
    asset.colliderCenter = [9, 9, 9]
    asset.collisionHalfExtents = [8, 8, 8]

    await store.getState().replaceProject([asset], [])

    expect(store.getState().assets[0]!.colliderCenter).toEqual([0, 0, 0.1])
    expect(store.getState().assets[0]!.collisionHalfExtents).toEqual([
      0.5, 0.4, 0.3,
    ])
  })

  it('rejects invalid Compound Boxes without changing active Assets', async () => {
    const store = createObjectAssetStore(createDatabase('atomic-invalid'))
    await store.getState().replaceProject(
      [machineAsset()],
      [machineInstance('machine-01')],
    )
    const before = store.getState().assets
    const invalid = machineAsset()
    invalid.collisionBoxes = []

    await expect(store.getState().replaceProject([invalid], [])).rejects.toThrow(/Box/i)
    expect(store.getState().assets).toEqual(before)
  })
})
