import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ProjectDatabaseV5,
  type StoredProjectPointerV5,
} from './project-v5-db.js'

const openDatabases: Dexie[] = []
const databaseNames = new Set<string>()
let sequence = 0

function uniqueDatabaseName(prefix = 'project-v5-db'): string {
  const name = `${prefix}-${++sequence}`
  databaseNames.add(name)
  return name
}

afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close()
  for (const name of databaseNames) await Dexie.delete(name)
  databaseNames.clear()
})

describe('ProjectDatabaseV5', () => {
  it('uses a standalone V5 database and leaves V4 untouched', async () => {
    const legacy = new Dexie('robot-sim-project-v4')
    legacy.version(1).stores({ marker: '&key' })
    openDatabases.push(legacy)
    databaseNames.add('robot-sim-project-v4')
    await legacy.table('marker').put({ key: 'sentinel', value: 'unchanged' })
    const database = new ProjectDatabaseV5()
    openDatabases.push(database)
    databaseNames.add(database.name)

    expect(database.name).toBe('robot-sim-project-v5')
    await database.open()
    await expect(legacy.table('marker').get('sentinel')).resolves.toEqual({
      key: 'sentinel', value: 'unchanged',
    })
  })

  it('declares only the canonical revision, pointer, and permanent-token tables at version 1', async () => {
    const database = new ProjectDatabaseV5(uniqueDatabaseName())
    openDatabases.push(database)
    await database.open()

    expect(database.verno).toBe(1)
    expect(database.tables.map(({ name }) => name).sort()).toEqual([
      'projectCommitTokens',
      'projectPointers',
      'projectRevisions',
    ])
    expect(database.tables.some(({ name }) => name === 'projects')).toBe(false)
    expect(database.tables.some(({ name }) => name === 'projectSourceBlobs')).toBe(false)
  })

  it.each([
    {
      key: 'active', state: 'publishing', revisionId: 'revision-b',
      previousRevisionId: 'revision-a', previousCommitToken: 'commit-a', commitToken: 'commit-b',
    },
    {
      key: 'active', state: 'publishing', revisionId: 'revision-a',
      previousRevisionId: null, previousCommitToken: null, commitToken: 'commit-a',
    },
  ] satisfies readonly StoredProjectPointerV5[])(
    'round-trips the exact publishing pointer tuple for $commitToken',
    async (pointer) => {
      const database = new ProjectDatabaseV5(uniqueDatabaseName())
      openDatabases.push(database)
      await database.projectPointers.put(pointer)
      await expect(database.projectPointers.get('active')).resolves.toEqual(pointer)
    },
  )
})
