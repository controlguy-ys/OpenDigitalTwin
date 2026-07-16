import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ProjectDatabaseV4,
  type StoredProjectPointerV4,
} from './project-v4-db.js'

const openDatabases: Dexie[] = []
const databaseNames = new Set<string>()
let sequence = 0

function uniqueDatabaseName(prefix = 'project-v4-db'): string {
  const name = `${prefix}-${++sequence}`
  databaseNames.add(name)
  return name
}

afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close()
  for (const name of databaseNames) await Dexie.delete(name)
  databaseNames.clear()
})

describe('ProjectDatabaseV4', () => {
  it('uses the exact standalone V4 database name by default', () => {
    databaseNames.add('robot-sim-project-v4')
    const database = new ProjectDatabaseV4()
    openDatabases.push(database)

    expect(database.name).toBe('robot-sim-project-v4')
  })

  it('declares only the canonical-JSON revision, pointer, and permanent-token tables at version 1', async () => {
    const database = new ProjectDatabaseV4(uniqueDatabaseName())
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
    expect(database.projectRevisions.schema.primKey).toMatchObject({
      name: 'revisionId',
      unique: true,
    })
    expect(database.projectRevisions.schema.indexes.map(({ name }) => name)).toEqual(['projectId'])
    expect(database.projectPointers.schema.primKey).toMatchObject({ name: 'key', unique: true })
    expect(database.projectPointers.schema.indexes.map(({ name }) => name)).toEqual([
      'state',
      'revisionId',
    ])
    expect(database.projectCommitTokens.schema.primKey).toMatchObject({
      name: 'commitToken',
      unique: true,
    })
    expect(database.projectCommitTokens.schema.indexes.map(({ name }) => name)).toEqual([
      'revisionId',
    ])
  })

  it('never opens, upgrades, or mutates the V3 database', async () => {
    const legacyName = 'robot-sim-project'
    const v4Name = 'robot-sim-project-v4'
    databaseNames.add(legacyName)
    databaseNames.add(v4Name)
    const legacy = new Dexie(legacyName)
    legacy.version(7).stores({ marker: '&key', projects: '&key' })
    openDatabases.push(legacy)
    await legacy.open()
    await legacy.table('marker').put({ key: 'sentinel', value: 'v3-unchanged' })
    const legacyVersion = legacy.verno
    const legacyTables = legacy.tables.map(({ name }) => name).sort()
    legacy.close()

    const database = new ProjectDatabaseV4()
    openDatabases.push(database)
    await database.open()
    await database.projectCommitTokens.add({
      commitToken: 'v4-token',
      revisionId: 'revision-v4',
      createdAt: '2026-07-16T00:00:00.000Z',
    })
    database.close()

    const reopenedLegacy = new Dexie(legacyName)
    reopenedLegacy.version(7).stores({ marker: '&key', projects: '&key' })
    openDatabases.push(reopenedLegacy)
    await reopenedLegacy.open()

    expect(reopenedLegacy.verno).toBe(legacyVersion)
    expect(reopenedLegacy.tables.map(({ name }) => name).sort()).toEqual(legacyTables)
    await expect(reopenedLegacy.table('marker').get('sentinel')).resolves.toEqual({
      key: 'sentinel',
      value: 'v3-unchanged',
    })
  })

  it.each([
    {
      key: 'active',
      state: 'publishing',
      revisionId: 'revision-b',
      previousRevisionId: 'revision-a',
      previousCommitToken: 'commit-a',
      commitToken: 'commit-b',
    },
    {
      key: 'active',
      state: 'publishing',
      revisionId: 'revision-a',
      previousRevisionId: null,
      previousCommitToken: null,
      commitToken: 'commit-a',
    },
  ] satisfies readonly StoredProjectPointerV4[])(
    'round-trips the exact publishing pointer tuple for $commitToken',
    async (pointer) => {
      const database = new ProjectDatabaseV4(uniqueDatabaseName())
      openDatabases.push(database)

      await database.projectPointers.put(pointer)

      await expect(database.projectPointers.get('active')).resolves.toEqual(pointer)
    },
  )
})
