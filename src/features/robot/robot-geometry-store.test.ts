import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  RobotLinkGeometryRecordV1,
  RobotLinkGeometryRecordV2,
} from '../../domain/project/project'
import type { RobotLinkId } from '../../domain/robot/crb15000'
import { RobotGeometryDatabase } from './robot-geometry-db'
import { createRobotGeometryStore } from './robot-geometry-store'

const LINK_IDS = [
  'LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06',
] as const satisfies readonly RobotLinkId[]
const databases: RobotGeometryDatabase[] = []
const names = new Set<string>()
let index = 0

function database(label: string) {
  const name = `robot-geometry-${label}-${++index}`
  const result = new RobotGeometryDatabase(name)
  databases.push(result)
  names.add(name)
  return result
}

function link(linkId: RobotLinkId): RobotLinkGeometryRecordV2 {
  return {
    linkId,
    sourceFileName: `${linkId}.step`,
    sourceBytes: new Uint8Array([1, 2, 3]).buffer,
    localTransform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    visible: true,
    collisionCenter: [0, 0, 0],
    collisionHalfExtents: [0.1, 0.1, 0.1],
    collisionBoxes: [
      {
        id: 'primary',
        center: [0, 0, 0],
        halfExtents: [0.1, 0.1, 0.1],
        quaternion: [0, 0, 0, 1],
      },
      {
        id: 'secondary',
        center: [0.2, 0, 0],
        halfExtents: [0.02, 0.03, 0.04],
        quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      },
    ],
    statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
  }
}

afterEach(async () => {
  for (const item of databases.splice(0)) item.close()
  for (const name of names) await Dexie.delete(name)
  names.clear()
})

describe('Robot Geometry store', () => {
  it('migrates legacy IndexedDB Link rows and persists default Boxes', async () => {
    const db = database('legacy-rows')
    const legacy = LINK_IDS.map((linkId) => {
      const { collisionBoxes: _boxes, ...record } = link(linkId)
      return record
    }) satisfies RobotLinkGeometryRecordV1[]
    legacy[3]!.localTransform.position = [0.03, 0.02, 0.01]
    await db.links.bulkAdd(
      legacy as unknown as RobotLinkGeometryRecordV2[],
    )
    const store = createRobotGeometryStore(db)

    await store.getState().hydrate()

    expect(store.getState().persistenceStatus).toBe('persistent')
    expect(store.getState().links[0]!.collisionBoxes).toEqual([{
      id: 'default',
      center: [0, 0, 0],
      halfExtents: [0.1, 0.1, 0.1],
      quaternion: [0, 0, 0, 1],
    }])
    expect(store.getState().links[3]!.localTransform.position).toEqual([
      0.03, 0.02, 0.01,
    ])
    expect(Array.from(new Uint8Array(store.getState().links[0]!.sourceBytes))).toEqual([
      1, 2, 3,
    ])
    expect((await db.links.get('LINK00'))?.collisionBoxes[0]!.id).toBe('default')
  })

  it('does not reinterpret an invalid V2 Box array as legacy data', async () => {
    const db = database('invalid-v2-row')
    const records = LINK_IDS.map(link)
    records[0]!.collisionBoxes = []
    await db.links.bulkAdd(records)
    const store = createRobotGeometryStore(db)

    await store.getState().hydrate()

    expect(store.getState().persistenceStatus).toBe('memory-only')
    expect(store.getState().links).toEqual([])
    expect((await db.links.get('LINK00'))?.collisionBoxes).toEqual([])
  })

  it('persists seven Link records and a Geometry local pose', async () => {
    const first = database('persist')
    const store = createRobotGeometryStore(first)
    await store.getState().replaceRobot(LINK_IDS.map(link))
    await store.getState().setLocalTransform('LINK03', {
      position: [0.01, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    })
    first.close()

    const reopenedDb = new RobotGeometryDatabase(first.name)
    databases.push(reopenedDb)
    const reopened = createRobotGeometryStore(reopenedDb)
    await reopened.getState().hydrate()

    expect(reopened.getState().links).toHaveLength(7)
    expect(
      reopened.getState().links.find(({ linkId }) => linkId === 'LINK03')
        ?.localTransform.position,
    ).toEqual([0.01, 0, 0])
  })

  it('rejects an incomplete new Robot but permits explicit single-Link replacement', async () => {
    const store = createRobotGeometryStore(database('replace'))

    await expect(
      store.getState().replaceRobot(LINK_IDS.slice(0, 6).map(link)),
    ).rejects.toThrow('exactly seven')
    await store.getState().replaceRobot(LINK_IDS.map(link))
    await store.getState().replaceLink({ ...link('LINK02'), sourceFileName: 'new.step' })

    expect(
      store.getState().links.find(({ linkId }) => linkId === 'LINK02')
        ?.sourceFileName,
    ).toBe('new.step')
    expect(store.getState().links).toHaveLength(7)
  })

  it('owns every Compound Box tuple across replace and hydration', async () => {
    const first = database('compound-boxes')
    const store = createRobotGeometryStore(first)
    const links = LINK_IDS.map(link)

    await store.getState().replaceRobot(links)
    links[0]!.collisionBoxes[1]!.center[0] = 99
    expect(store.getState().links[0]!.collisionBoxes[1]!.center[0]).toBe(0.2)
    first.close()

    const reopenedDb = new RobotGeometryDatabase(first.name)
    databases.push(reopenedDb)
    const reopened = createRobotGeometryStore(reopenedDb)
    await reopened.getState().hydrate()
    expect(reopened.getState().links[0]!.collisionBoxes).toEqual([
      {
        id: 'primary',
        center: [0, 0, 0],
        halfExtents: [0.1, 0.1, 0.1],
        quaternion: [0, 0, 0, 1],
      },
      {
        id: 'secondary',
        center: [0.2, 0, 0],
        halfExtents: [0.02, 0.03, 0.04],
        quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      },
    ])
  })

  it('updates only the first Box bounds and preserves its identity and rotation', async () => {
    const store = createRobotGeometryStore(database('set-collision'))
    await store.getState().replaceRobot(LINK_IDS.map(link))

    await store.getState().setCollision('LINK00', [0.3, 0.2, 0.1], [0.4, 0.5, 0.6])

    const updated = store.getState().links[0]!
    expect(updated.collisionBoxes).toEqual([
      {
        id: 'primary',
        center: [0.3, 0.2, 0.1],
        halfExtents: [0.4, 0.5, 0.6],
        quaternion: [0, 0, 0, 1],
      },
      {
        id: 'secondary',
        center: [0.2, 0, 0],
        halfExtents: [0.02, 0.03, 0.04],
        quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      },
    ])
    expect(updated.collisionCenter).toEqual([0.3, 0.2, 0.1])
    expect(updated.collisionHalfExtents).toEqual([0.4, 0.5, 0.6])
  })

  it('repairs the legacy bounds mirror from the canonical first Box', async () => {
    const store = createRobotGeometryStore(database('legacy-mirror'))
    const links = LINK_IDS.map(link)
    links[0]!.collisionCenter = [9, 9, 9]
    links[0]!.collisionHalfExtents = [8, 8, 8]

    await store.getState().replaceRobot(links)

    expect(store.getState().links[0]!.collisionCenter).toEqual([0, 0, 0])
    expect(store.getState().links[0]!.collisionHalfExtents).toEqual([
      0.1, 0.1, 0.1,
    ])
  })

  it('rejects invalid Compound Boxes without changing the active Robot', async () => {
    const store = createRobotGeometryStore(database('atomic-invalid'))
    await store.getState().replaceRobot(LINK_IDS.map(link))
    const before = store.getState().links
    const invalid = LINK_IDS.map(link)
    invalid[0]!.collisionBoxes = []

    await expect(store.getState().replaceRobot(invalid)).rejects.toThrow(/Box/i)
    expect(store.getState().links).toEqual(before)
  })
})
