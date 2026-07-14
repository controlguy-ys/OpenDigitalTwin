import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ProjectDatabase,
  type StoredProjectPointerV1,
} from './project-db'

const openDatabases: ProjectDatabase[] = []
const databaseNames = new Set<string>()
let sequence = 0

function databaseName(): string {
  const name = `project-revision-db-${++sequence}`
  databaseNames.add(name)
  return name
}

afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close()
  for (const name of databaseNames) await Dexie.delete(name)
  databaseNames.clear()
})

describe('ProjectDatabase revision schema', () => {
  it('retains the legacy projects table and adds immutable revision storage', async () => {
    const database = new ProjectDatabase(databaseName())
    openDatabases.push(database)
    await database.open()

    expect(database.tables.map(({ name }) => name).sort()).toEqual([
      'projectCommitTokens',
      'projectPointers',
      'projectRevisions',
      'projectSourceBlobs',
      'projects',
    ])
    expect(database.projectRevisions.schema.primKey.name).toBe('revisionId')
    expect(database.projectSourceBlobs.schema.primKey.name).toBe('key')
    expect(database.projectPointers.schema.primKey.name).toBe('key')
    expect(database.projectCommitTokens.schema.primKey.name).toBe('commitToken')
  })

  it('upgrades a v1 database without deleting projects.active', async () => {
    const name = databaseName()
    const legacy = new Dexie(name)
    legacy.version(1).stores({ projects: '&key' })
    await legacy.table('projects').put({ key: 'active', snapshot: { legacy: true } })
    legacy.close()

    const database = new ProjectDatabase(name)
    openDatabases.push(database)
    await database.open()

    expect(await database.projects.get('active')).toEqual({
      key: 'active',
      snapshot: { legacy: true },
    })
  })

  it('persists the exact previous stable token needed for compensation', async () => {
    const database = new ProjectDatabase(databaseName())
    openDatabases.push(database)
    const pointer: StoredProjectPointerV1 = {
      key: 'active',
      state: 'publishing',
      revisionId: 'b'.repeat(64),
      previousRevisionId: 'a'.repeat(64),
      previousCommitToken: 'commit-a',
      commitToken: 'commit-b',
    }

    await database.projectPointers.put(pointer)

    expect(await database.projectPointers.get('active')).toEqual(pointer)
  })
})
