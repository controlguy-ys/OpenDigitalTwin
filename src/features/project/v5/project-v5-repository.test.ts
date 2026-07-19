import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import {
  canonicalProjectV5Json,
  configRevisionForProjectV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from '../../../core/project-v5/test-support.js'
import { ProjectDatabaseV5 } from './project-v5-db.js'
import {
  createProjectRepositoryV5,
  type PreparedProjectRevisionV5,
  type ProjectRepositoryV5,
} from './project-v5-repository.js'

const NOW = '2026-07-19T00:00:00.000Z'
const openDatabases: Dexie[] = []
const databaseNames = new Set<string>()
let sequence = 0

function uniqueDatabaseName(prefix = 'project-v5-repository'): string {
  const name = `${prefix}-${++sequence}`
  databaseNames.add(name)
  return name
}

function project(revisionId: string, name = 'V5 project'): WorkcellProjectV5 {
  const candidate = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  return {
    ...candidate,
    revisionId,
    metadata: { ...candidate.metadata, name },
  }
}

function createRepository(database: ProjectDatabaseV5, now = () => NOW): ProjectRepositoryV5 {
  return createProjectRepositoryV5({ database, now })
}

async function publishStable(
  repository: ProjectRepositoryV5,
  candidate: WorkcellProjectV5,
  token: string,
): Promise<void> {
  const prepared = await repository.prepareRevision(candidate)
  await repository.commitPreparedRevision((await repository.readPointer())?.revisionId ?? null, prepared, token)
  await repository.finalizePublication(token)
}

async function expectRepositoryError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code })
}

function deferred<T = void>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>((complete) => { resolve = complete }), resolve }
}

afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close()
  for (const name of databaseNames) await Dexie.delete(name)
  databaseNames.clear()
})

describe('ProjectRepositoryV5 preparation authority', () => {
  it('round-trips only canonical V5 content', async () => {
    const database = new ProjectDatabaseV5(uniqueDatabaseName())
    openDatabases.push(database)
    const repository = createRepository(database)
    const candidate = project('revision-a')
    const prepared = await repository.prepareRevision(candidate)
    await repository.commitPreparedRevision(null, prepared, 'commit-v5-a')
    await repository.finalizePublication('commit-v5-a')
    await expect(repository.readActive()).resolves.toEqual(candidate)
  })

  it('uses repository-local opaque prepared handles with exact object identity', async () => {
    const database = new ProjectDatabaseV5(uniqueDatabaseName())
    openDatabases.push(database)
    const repository = createRepository(database)
    const other = createRepository(database)
    const prepared = await repository.prepareRevision(project('revision-a'))
    const forged = { ...prepared } as PreparedProjectRevisionV5

    expect(repository.materializePreparedProject(prepared)).toEqual(project('revision-a'))
    expect(() => repository.materializePreparedProject(forged)).toThrow('PROJECT_PREPARED_REVISION_INVALID')
    expect(() => other.materializePreparedProject(prepared)).toThrow('PROJECT_PREPARED_REVISION_INVALID')
    repository.discardPreparedRevision(prepared)
    expect(() => repository.materializePreparedProject(prepared)).toThrow('PROJECT_PREPARED_REVISION_CONSUMED')
  })

  it('prepares without Dexie writes, snapshots canonical content, and returns frozen fresh materializations', async () => {
    const database = new ProjectDatabaseV5(uniqueDatabaseName())
    openDatabases.push(database)
    const repository = createRepository(database)
    const candidate = project('revision-a')
    const prepared = await repository.prepareRevision(candidate)

    expect(await Promise.all([
      database.projectRevisions.count(), database.projectPointers.count(), database.projectCommitTokens.count(),
    ])).toEqual([0, 0, 0])
    const first = repository.materializePreparedProject(prepared)
    const second = repository.materializePreparedProject(prepared)
    expect(first).not.toBe(second)
    expect(Object.isFrozen(first)).toBe(true)
    expect(first).toEqual(candidate)
    ;(candidate.metadata as { name: string }).name = 'mutated after prepare'
    expect(repository.materializePreparedProject(prepared).metadata.name).toBe('V5 project')
  })
})

describe('ProjectRepositoryV5 commit, recovery, and integrity', () => {
  it('atomically reserves token, inserts immutable revision, and writes a publishing pointer', async () => {
    const database = new ProjectDatabaseV5(uniqueDatabaseName())
    openDatabases.push(database)
    const repository = createRepository(database)
    const candidate = project('revision-a')
    const prepared = await repository.prepareRevision(candidate)
    await repository.commitPreparedRevision(null, prepared, 'token-a')

    await expect(repository.readPointer()).resolves.toEqual({
      key: 'active', state: 'publishing', revisionId: 'revision-a', previousRevisionId: null,
      previousCommitToken: null, commitToken: 'token-a',
    })
    await expect(repository.readActive()).resolves.toEqual(candidate)
    await expect(database.projectCommitTokens.toArray()).resolves.toEqual([{
      commitToken: 'token-a', revisionId: 'revision-a', createdAt: NOW,
    }])
  })

  it('consumes a prepared handle after every commit failure class', async () => {
    const cases: readonly [string, (repository: ProjectRepositoryV5, prepared: PreparedProjectRevisionV5) => Promise<unknown>][] = [
      ['invalid token', async (repository, prepared) => repository.commitPreparedRevision(null, prepared, '')],
      ['stale CAS', async (repository, prepared) => repository.commitPreparedRevision('stale', prepared, 'token-stale')],
    ]
    for (const [, run] of cases) {
      const database = new ProjectDatabaseV5(uniqueDatabaseName())
      openDatabases.push(database)
      const repository = createRepository(database)
      const prepared = await repository.prepareRevision(project(`revision-${database.name}`))
      await expect(run(repository, prepared)).rejects.toBeInstanceOf(Error)
      expect(() => repository.materializePreparedProject(prepared)).toThrow('PROJECT_PREPARED_REVISION_CONSUMED')
    }
  })

  it('consumes handles after token reuse, an in-progress publication, and an immutable collision', async () => {
    const database = new ProjectDatabaseV5(uniqueDatabaseName())
    openDatabases.push(database)
    const repository = createRepository(database)
    await publishStable(repository, project('revision-a'), 'token-a')
    const inProgress = await repository.prepareRevision(project('revision-b'))
    await repository.commitPreparedRevision('revision-a', inProgress, 'token-b')
    const blocked = await repository.prepareRevision(project('revision-c'))
    await expectRepositoryError(repository.commitPreparedRevision('revision-b', blocked, 'token-c'), 'PROJECT_PUBLICATION_IN_PROGRESS')
    expect(() => repository.materializePreparedProject(blocked)).toThrow('PROJECT_PREPARED_REVISION_CONSUMED')
    await repository.compensatePublication('token-b')
    const reused = await repository.prepareRevision(project('revision-b'))
    await expectRepositoryError(repository.commitPreparedRevision('revision-a', reused, 'token-b'), 'PROJECT_COMMIT_TOKEN_REUSED')
    expect(() => repository.materializePreparedProject(reused)).toThrow('PROJECT_PREPARED_REVISION_CONSUMED')
    const collision = await repository.prepareRevision(project('revision-a', 'conflicting'))
    await expectRepositoryError(repository.commitPreparedRevision('revision-a', collision, 'token-c'), 'PROJECT_REVISION_ID_COLLISION')
    expect(() => repository.materializePreparedProject(collision)).toThrow('PROJECT_PREPARED_REVISION_CONSUMED')
  })

  it('rejects immutable revision collisions without overwriting original createdAt or reserving the failed token', async () => {
    const database = new ProjectDatabaseV5(uniqueDatabaseName())
    openDatabases.push(database)
    const repository = createRepository(database)
    await publishStable(repository, project('revision-a', 'original'), 'token-a')
    const original = await database.projectRevisions.get('revision-a')
    const prepared = await repository.prepareRevision(project('revision-a', 'conflict'))
    await expectRepositoryError(repository.commitPreparedRevision('revision-a', prepared, 'token-b'), 'PROJECT_REVISION_ID_COLLISION')
    expect(await database.projectRevisions.get('revision-a')).toEqual(original)
    await expect(database.projectCommitTokens.toArray()).resolves.toHaveLength(1)
  })

  it('strictly validates an existing immutable row before accepting an identical revision', async () => {
    const database = new ProjectDatabaseV5(uniqueDatabaseName())
    openDatabases.push(database)
    const repository = createRepository(database)
    const candidate = project('revision-a')
    await publishStable(repository, candidate, 'token-a')
    const row = (await database.projectRevisions.get('revision-a'))!
    await database.projectRevisions.put({ ...row, canonicalJson: JSON.stringify(candidate) })
    const prepared = await repository.prepareRevision(candidate)
    await expectRepositoryError(repository.commitPreparedRevision('revision-a', prepared, 'token-b'), 'PROJECT_REVISION_CORRUPT')
    await expect(database.projectCommitTokens.count()).resolves.toBe(1)
  })

  it.each([
    ['', 'PROJECT_COMMIT_TOKEN_INVALID'],
    ['line\nbreak', 'PROJECT_COMMIT_TOKEN_INVALID'],
    ['x'.repeat(129), 'PROJECT_COMMIT_TOKEN_INVALID'],
    ['한'.repeat(43), 'PROJECT_COMMIT_TOKEN_INVALID'],
  ] as const)('rejects invalid commit token %# before any write', async (token, code) => {
    const database = new ProjectDatabaseV5(uniqueDatabaseName())
    openDatabases.push(database)
    const repository = createRepository(database)
    const prepared = await repository.prepareRevision(project('revision-a'))
    await expectRepositoryError(repository.commitPreparedRevision(null, prepared, token), code)
    await expect(Promise.all([
      database.projectRevisions.count(), database.projectPointers.count(), database.projectCommitTokens.count(),
    ])).resolves.toEqual([0, 0, 0])
  })

  it('lets only one of two database instances win a first-publication race', async () => {
    const database = new ProjectDatabaseV5(uniqueDatabaseName())
    const secondDatabase = new ProjectDatabaseV5(database.name)
    openDatabases.push(database, secondDatabase)
    const first = createRepository(database)
    const second = createRepository(secondDatabase)
    const a = await first.prepareRevision(project('revision-a'))
    const b = await second.prepareRevision(project('revision-b'))
    const results = await Promise.allSettled([
      first.commitPreparedRevision(null, a, 'token-a'),
      second.commitPreparedRevision(null, b, 'token-b'),
    ])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
  })

  it('reopens publishing target B, reads it as active, and finalizes idempotently only for its token', async () => {
    const database = new ProjectDatabaseV5(uniqueDatabaseName())
    openDatabases.push(database)
    const repository = createRepository(database)
    await publishStable(repository, project('revision-a'), 'token-a')
    const prepared = await repository.prepareRevision(project('revision-b'))
    await repository.commitPreparedRevision('revision-a', prepared, 'token-b')
    const reopened = createRepository(database)
    await expect(reopened.readActive()).resolves.toEqual(project('revision-b'))
    await reopened.finalizePublication('token-b')
    await reopened.finalizePublication('token-b')
    await expectRepositoryError(reopened.finalizePublication('token-other'), 'PROJECT_PUBLICATION_TOKEN_MISMATCH')
  })

  it('retains compensated token reservations permanently across a database reopen', async () => {
    const database = new ProjectDatabaseV5(uniqueDatabaseName())
    openDatabases.push(database)
    const repository = createRepository(database)
    await publishStable(repository, project('revision-a'), 'token-a')
    const prepared = await repository.prepareRevision(project('revision-b'))
    await repository.commitPreparedRevision('revision-a', prepared, 'token-b')
    await repository.compensatePublication('token-b')
    const reopenedDatabase = new ProjectDatabaseV5(database.name)
    openDatabases.push(reopenedDatabase)
    const reopened = createRepository(reopenedDatabase)
    const replay = await reopened.prepareRevision(project('revision-b'))
    await expectRepositoryError(reopened.commitPreparedRevision('revision-a', replay, 'token-b'), 'PROJECT_COMMIT_TOKEN_REUSED')
    await expect(reopenedDatabase.projectCommitTokens.count()).resolves.toBe(2)
  })

  it('compensates only its matching publishing token and preserves permanent rows', async () => {
    const database = new ProjectDatabaseV5(uniqueDatabaseName())
    openDatabases.push(database)
    const repository = createRepository(database)
    await publishStable(repository, project('revision-a'), 'token-a')
    const prepared = await repository.prepareRevision(project('revision-b'))
    await repository.commitPreparedRevision('revision-a', prepared, 'token-b')
    await expectRepositoryError(repository.compensatePublication('token-other'), 'PROJECT_PUBLICATION_TOKEN_MISMATCH')
    await repository.compensatePublication('token-b')
    await expect(repository.readPointer()).resolves.toEqual({
      key: 'active', state: 'stable', revisionId: 'revision-a', commitToken: 'token-a',
    })
    await expect(database.projectCommitTokens.count()).resolves.toBe(2)
    await expect(database.projectRevisions.count()).resolves.toBe(2)
  })

  it('strictly decodes retained rows and never accepts noncanonical text, wrong identities, or hashes', async () => {
    const database = new ProjectDatabaseV5(uniqueDatabaseName())
    openDatabases.push(database)
    const repository = createRepository(database)
    const candidate = project('revision-a')
    await publishStable(repository, candidate, 'token-a')
    const row = (await database.projectRevisions.get('revision-a'))!
    await database.projectRevisions.put({ ...row, canonicalJson: JSON.stringify(candidate) })
    await expectRepositoryError(repository.readRevision('revision-a'), 'PROJECT_REVISION_CORRUPT')
    await database.projectRevisions.put({ ...row, projectId: 'wrong-project' })
    await expectRepositoryError(repository.readRevision('revision-a'), 'PROJECT_REVISION_CORRUPT')
    await database.projectRevisions.put({ ...row, configRevision: 'f'.repeat(64) })
    await expectRepositoryError(repository.readRevision('revision-a'), 'PROJECT_CONFIG_REVISION_MISMATCH')
  })

  it('returns fresh frozen revision records after all persisted-row checks', async () => {
    const database = new ProjectDatabaseV5(uniqueDatabaseName())
    openDatabases.push(database)
    const repository = createRepository(database)
    const candidate = project('revision-a')
    await publishStable(repository, candidate, 'token-a')
    const first = await repository.readRevision('revision-a')
    const second = await repository.readRevision('revision-a')
    expect(first).toEqual({
      revisionId: 'revision-a', configRevision: await configRevisionForProjectV5(candidate), project: candidate,
    })
    expect(first).not.toBe(second)
    expect(first?.project).not.toBe(second?.project)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first?.project)).toBe(true)
  })

  it('garbage collects under the RW lock, retaining stable or publishing targets and never token rows', async () => {
    const database = new ProjectDatabaseV5(uniqueDatabaseName())
    openDatabases.push(database)
    const repository = createRepository(database)
    await publishStable(repository, project('revision-a'), 'token-a')
    const orphan = project('revision-orphan')
    await database.projectRevisions.add({
      revisionId: orphan.revisionId, projectId: orphan.projectId,
      configRevision: await configRevisionForProjectV5(orphan), createdAt: NOW,
      canonicalJson: canonicalProjectV5Json(orphan),
    })
    await repository.garbageCollect()
    await expect(database.projectRevisions.toCollection().primaryKeys()).resolves.toEqual(['revision-a'])
    const b = await repository.prepareRevision(project('revision-b'))
    await repository.commitPreparedRevision('revision-a', b, 'token-b')
    await repository.garbageCollect()
    expect((await database.projectRevisions.toCollection().primaryKeys()).sort()).toEqual(['revision-a', 'revision-b'])
    await expect(database.projectCommitTokens.count()).resolves.toBe(2)
  })

  it('fails GC safely for no pointer or corrupt retained rows before deleting anything', async () => {
    const database = new ProjectDatabaseV5(uniqueDatabaseName())
    openDatabases.push(database)
    const repository = createRepository(database)
    await expectRepositoryError(repository.garbageCollect(), 'PROJECT_POINTER_MISSING')
    await publishStable(repository, project('revision-a'), 'token-a')
    await database.projectRevisions.update('revision-a', { configRevision: '0'.repeat(64) })
    await expectRepositoryError(repository.garbageCollect(), 'PROJECT_CONFIG_REVISION_MISMATCH')
    await expect(database.projectRevisions.count()).resolves.toBe(1)
  })

  it('holds pointer and revision RW locks across GC so a second tab cannot race deletion', async () => {
    const database = new ProjectDatabaseV5(uniqueDatabaseName())
    const secondDatabase = new ProjectDatabaseV5(database.name)
    openDatabases.push(database, secondDatabase)
    const repository = createRepository(database)
    const second = createRepository(secondDatabase)
    await publishStable(repository, project('revision-a'), 'token-a')
    const orphan = project('revision-orphan')
    await database.projectRevisions.add({
      revisionId: orphan.revisionId, projectId: orphan.projectId,
      configRevision: await configRevisionForProjectV5(orphan), createdAt: NOW,
      canonicalJson: canonicalProjectV5Json(orphan),
    })
    const prepared = await second.prepareRevision(project('revision-b'))
    const pointerRead = deferred<void>()
    const release = deferred<void>()
    const originalGet = database.projectPointers.get.bind(database.projectPointers)
    database.projectPointers.get = (async (key: string) => {
      const value = await originalGet(key)
      if (key === 'active') {
        pointerRead.resolve()
        await Dexie.waitFor(release.promise)
      }
      return value
    }) as typeof database.projectPointers.get
    const collection = repository.garbageCollect()
    await pointerRead.promise
    let settled = false
    const commit = second.commitPreparedRevision('revision-a', prepared, 'token-b').finally(() => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)
    release.resolve()
    await collection
    await commit
    expect((await secondDatabase.projectRevisions.toCollection().primaryKeys()).sort()).toEqual(['revision-a', 'revision-b'])
  })
})
