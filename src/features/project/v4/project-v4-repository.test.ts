import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  canonicalProjectV4Json,
  configRevisionForProjectV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import {
  ProjectDatabaseV4,
  type StoredProjectRevisionV4,
} from './project-v4-db.js'
import {
  createProjectRepositoryV4,
  type PreparedProjectRevisionV4,
  type ProjectRepositoryV4,
  type ProjectRepositoryV4Error,
} from './project-v4-repository.js'

const FIXED_NOW = '2026-07-16T01:02:03.004Z'
const openDatabases: ProjectDatabaseV4[] = []
const databaseNames = new Set<string>()
let sequence = 0
let database!: ProjectDatabaseV4
let repository!: ProjectRepositoryV4

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function reverseObjectKeyOrder<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => reverseObjectKeyOrder(item)) as T
  if (value === null || typeof value !== 'object') return value
  const clone: Record<string, unknown> = {}
  for (const key of Object.keys(value).reverse()) {
    clone[key] = reverseObjectKeyOrder((value as Record<string, unknown>)[key])
  }
  return clone as T
}

function project(
  revisionId: string,
  name = `Project ${revisionId}`,
): WorkcellProjectV4 {
  const source = jsonClone(makeMinimalWorkcellProjectV4())
  return {
    ...source,
    revisionId,
    metadata: {
      ...source.metadata,
      name,
      updatedAt: '2026-07-16T01:00:00.000Z',
    },
  }
}

function uniqueDatabaseName(prefix = 'project-v4-repository'): string {
  const name = `${prefix}-${++sequence}`
  databaseNames.add(name)
  return name
}

function createRepository(
  target: ProjectDatabaseV4,
  now: () => string = () => FIXED_NOW,
): ProjectRepositoryV4 {
  return createProjectRepositoryV4({ database: target, now })
}

async function publishStable(
  target: ProjectRepositoryV4,
  candidate: WorkcellProjectV4,
  token: string,
  expectedRevisionId: string | null = null,
): Promise<PreparedProjectRevisionV4> {
  const prepared = await target.prepareRevision(candidate)
  await target.commitPreparedRevision(expectedRevisionId, prepared, token)
  await target.finalizePublication(token)
  return prepared
}

async function storedRow(
  candidate: WorkcellProjectV4,
  createdAt = FIXED_NOW,
): Promise<StoredProjectRevisionV4> {
  return {
    revisionId: candidate.revisionId,
    projectId: candidate.projectId,
    configRevision: await configRevisionForProjectV4(candidate),
    createdAt,
    canonicalJson: canonicalProjectV4Json(candidate),
  }
}

async function expectRepositoryError(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    name: 'ProjectRepositoryV4Error',
    code,
  } satisfies Partial<ProjectRepositoryV4Error>)
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => { resolve = complete })
  return { promise, resolve }
}

beforeEach(() => {
  database = new ProjectDatabaseV4(uniqueDatabaseName())
  openDatabases.push(database)
  repository = createRepository(database)
})

afterEach(async () => {
  for (const target of openDatabases.splice(0)) target.close()
  for (const name of databaseNames) await Dexie.delete(name)
  databaseNames.clear()
})

describe('ProjectRepositoryV4 prepared authority', () => {
  it('prepares distinct author and canonical identities without writing Dexie', async () => {
    const candidate = project('revision-a')

    const prepared = await repository.prepareRevision(candidate)

    expect(prepared.revisionId).toBe('revision-a')
    expect(prepared.configRevision).toBe(await configRevisionForProjectV4(candidate))
    expect(prepared.configRevision).toMatch(/^[0-9a-f]{64}$/u)
    expect(prepared.configRevision).not.toBe(prepared.revisionId)
    expect(prepared.project).toEqual(candidate)
    expect(prepared.project).not.toBe(candidate)
    expect(Object.isFrozen(prepared)).toBe(true)
    expect(Object.isFrozen(prepared.project)).toBe(true)
    await expect(Promise.all([
      database.projectRevisions.count(),
      database.projectPointers.count(),
      database.projectCommitTokens.count(),
    ])).resolves.toEqual([0, 0, 0])
  })

  it('materializes only the repository-owned frozen clone and rejects forged or cross-repository capabilities', async () => {
    const candidate = project('revision-a')
    const prepared = await repository.prepareRevision(candidate)
    const otherDatabase = new ProjectDatabaseV4(uniqueDatabaseName())
    openDatabases.push(otherDatabase)
    const otherRepository = createRepository(otherDatabase)
    const forged = {
      revisionId: prepared.revisionId,
      configRevision: prepared.configRevision,
      project: prepared.project,
    }

    expect(repository.materializePreparedProject(prepared)).toBe(prepared.project)
    expect(() => repository.materializePreparedProject(forged)).toThrow(
      'PROJECT_PREPARED_REVISION_INVALID',
    )
    expect(() => otherRepository.materializePreparedProject(prepared)).toThrow(
      'PROJECT_PREPARED_REVISION_INVALID',
    )
  })

  it('consumes discarded and committed capabilities', async () => {
    const discarded = await repository.prepareRevision(project('revision-discarded'))
    repository.discardPreparedRevision(discarded)

    expect(() => repository.materializePreparedProject(discarded)).toThrow(
      'PROJECT_PREPARED_REVISION_CONSUMED',
    )
    expect(() => repository.discardPreparedRevision(discarded)).toThrow(
      'PROJECT_PREPARED_REVISION_CONSUMED',
    )

    const committed = await repository.prepareRevision(project('revision-a'))
    await repository.commitPreparedRevision(null, committed, 'token-a')
    expect(() => repository.materializePreparedProject(committed)).toThrow(
      'PROJECT_PREPARED_REVISION_CONSUMED',
    )
  })

  it('rejects a noncanonical persistence timestamp before any write', async () => {
    const invalid = createRepository(database, () => '2026-07-16T01:02:03Z')

    await expectRepositoryError(
      invalid.prepareRevision(project('revision-a')),
      'PROJECT_REVISION_CORRUPT',
    )
    await expect(Promise.all([
      database.projectRevisions.count(),
      database.projectPointers.count(),
      database.projectCommitTokens.count(),
    ])).resolves.toEqual([0, 0, 0])
  })
})

describe('ProjectRepositoryV4 CAS and permanent publication state', () => {
  it('atomically creates the token, immutable canonical row, and first publishing pointer', async () => {
    const candidate = project('revision-a')
    const prepared = await repository.prepareRevision(candidate)

    await repository.commitPreparedRevision(null, prepared, 'token-a')

    await expect(database.projectCommitTokens.toArray()).resolves.toEqual([{
      commitToken: 'token-a',
      revisionId: 'revision-a',
      createdAt: FIXED_NOW,
    }])
    await expect(database.projectRevisions.toArray()).resolves.toEqual([{
      revisionId: 'revision-a',
      projectId: candidate.projectId,
      configRevision: prepared.configRevision,
      createdAt: FIXED_NOW,
      canonicalJson: canonicalProjectV4Json(candidate),
    }])
    await expect(repository.readPointer()).resolves.toEqual({
      key: 'active',
      state: 'publishing',
      revisionId: 'revision-a',
      previousRevisionId: null,
      previousCommitToken: null,
      commitToken: 'token-a',
    })
    await expect(repository.readActive()).resolves.toEqual(candidate)
  })

  it('rejects stale CAS before any row, token, or pointer mutation', async () => {
    const active = project('revision-a')
    await publishStable(repository, active, 'token-a')
    const before = await Promise.all([
      database.projectRevisions.toArray(),
      database.projectPointers.toArray(),
      database.projectCommitTokens.toArray(),
    ])
    const prepared = await repository.prepareRevision(project('revision-b'))

    await expectRepositoryError(
      repository.commitPreparedRevision('revision-stale', prepared, 'token-b'),
      'PROJECT_ACTIVE_REVISION_CHANGED',
    )

    expect(await Promise.all([
      database.projectRevisions.toArray(),
      database.projectPointers.toArray(),
      database.projectCommitTokens.toArray(),
    ])).toEqual(before)
    expect(() => repository.materializePreparedProject(prepared)).toThrow(
      'PROJECT_PREPARED_REVISION_CONSUMED',
    )
  })

  it('rejects conflicting content for one revisionId and rolls back the new token', async () => {
    await publishStable(repository, project('revision-a', 'Original'), 'token-a')
    const prepared = await repository.prepareRevision(project('revision-a', 'Conflicting'))

    await expectRepositoryError(
      repository.commitPreparedRevision('revision-a', prepared, 'token-conflict'),
      'PROJECT_REVISION_ID_COLLISION',
    )

    await expect(database.projectCommitTokens.toArray()).resolves.toEqual([{
      commitToken: 'token-a',
      revisionId: 'revision-a',
      createdAt: FIXED_NOW,
    }])
    await expect(repository.readActive()).resolves.toEqual(project('revision-a', 'Original'))
  })

  it('reuses identical immutable content without replacing its original createdAt', async () => {
    const candidate = project('revision-a')
    await publishStable(repository, candidate, 'token-a')
    const laterRepository = createRepository(database, () => '2026-07-16T02:03:04.005Z')
    const prepared = await laterRepository.prepareRevision(candidate)

    await laterRepository.commitPreparedRevision('revision-a', prepared, 'token-b')

    await expect(database.projectRevisions.get('revision-a')).resolves.toMatchObject({
      createdAt: FIXED_NOW,
    })
    await expect(laterRepository.readPointer()).resolves.toMatchObject({
      state: 'publishing',
      revisionId: 'revision-a',
      previousRevisionId: 'revision-a',
      previousCommitToken: 'token-a',
      commitToken: 'token-b',
    })
  })

  it.each([
    ['', 'PROJECT_COMMIT_TOKEN_INVALID'],
    ['line\nbreak', 'PROJECT_COMMIT_TOKEN_INVALID'],
    ['x'.repeat(129), 'PROJECT_COMMIT_TOKEN_INVALID'],
  ] as const)('rejects invalid commit token %# before writing', async (token, code) => {
    const prepared = await repository.prepareRevision(project('revision-a'))

    await expectRepositoryError(repository.commitPreparedRevision(null, prepared, token), code)

    await expect(Promise.all([
      database.projectRevisions.count(),
      database.projectPointers.count(),
      database.projectCommitTokens.count(),
    ])).resolves.toEqual([0, 0, 0])
  })

  it('retains compensated token reservations permanently across repository reopen', async () => {
    const name = database.name
    await publishStable(repository, project('revision-a'), 'token-a')
    const candidateB = project('revision-b')
    const preparedB = await repository.prepareRevision(candidateB)
    await repository.commitPreparedRevision('revision-a', preparedB, 'token-b')
    await repository.compensatePublication('token-b')
    database.close()

    const reopenedDatabase = new ProjectDatabaseV4(name)
    openDatabases.push(reopenedDatabase)
    const reopened = createRepository(reopenedDatabase)
    const replay = await reopened.prepareRevision(candidateB)

    await expectRepositoryError(
      reopened.commitPreparedRevision('revision-a', replay, 'token-b'),
      'PROJECT_COMMIT_TOKEN_REUSED',
    )
    await expectRepositoryError(
      reopened.finalizePublication('token-b'),
      'PROJECT_PUBLICATION_TOKEN_MISMATCH',
    )
    await expect(reopenedDatabase.projectCommitTokens.count()).resolves.toBe(2)
    await expect(reopened.readPointer()).resolves.toEqual({
      key: 'active',
      state: 'stable',
      revisionId: 'revision-a',
      commitToken: 'token-a',
    })
  })

  it('lets exactly one cross-tab transaction reserve a racing token', async () => {
    const secondDatabase = new ProjectDatabaseV4(database.name)
    openDatabases.push(secondDatabase)
    const secondRepository = createRepository(secondDatabase)
    const first = await repository.prepareRevision(project('revision-a'))
    const second = await secondRepository.prepareRevision(project('revision-b'))

    const results = await Promise.allSettled([
      repository.commitPreparedRevision(null, first, 'racing-token'),
      secondRepository.commitPreparedRevision(null, second, 'racing-token'),
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect((results.find(({ status }) => status === 'rejected') as PromiseRejectedResult).reason)
      .toMatchObject({ code: 'PROJECT_COMMIT_TOKEN_REUSED' })
    await expect(database.projectCommitTokens.count()).resolves.toBe(1)
    await expect(database.projectRevisions.count()).resolves.toBe(1)
  })

  it('finalizes idempotently and rejects another token without changing the stable pointer', async () => {
    const prepared = await repository.prepareRevision(project('revision-a'))
    await repository.commitPreparedRevision(null, prepared, 'token-a')

    await repository.finalizePublication('token-a')
    await repository.finalizePublication('token-a')
    const stable = await repository.readPointer()
    await expectRepositoryError(
      repository.finalizePublication('token-other'),
      'PROJECT_PUBLICATION_TOKEN_MISMATCH',
    )

    await expect(repository.readPointer()).resolves.toEqual(stable)
  })

  it('compensates later and first publications while retaining both tokens', async () => {
    await publishStable(repository, project('revision-a'), 'token-a')
    const preparedB = await repository.prepareRevision(project('revision-b'))
    await repository.commitPreparedRevision('revision-a', preparedB, 'token-b')

    await repository.compensatePublication('token-b')

    await expect(repository.readPointer()).resolves.toEqual({
      key: 'active',
      state: 'stable',
      revisionId: 'revision-a',
      commitToken: 'token-a',
    })
    await expect(database.projectCommitTokens.count()).resolves.toBe(2)

    const isolatedDatabase = new ProjectDatabaseV4(uniqueDatabaseName('first-compensation'))
    openDatabases.push(isolatedDatabase)
    const isolated = createRepository(isolatedDatabase)
    const first = await isolated.prepareRevision(project('revision-first'))
    await isolated.commitPreparedRevision(null, first, 'token-first')

    await isolated.compensatePublication('token-first')

    await expect(isolated.readPointer()).resolves.toBeNull()
    await expect(isolatedDatabase.projectCommitTokens.count()).resolves.toBe(1)
  })

  it('rejects compensation after finalization', async () => {
    await publishStable(repository, project('revision-a'), 'token-a')

    await expectRepositoryError(
      repository.compensatePublication('token-a'),
      'PROJECT_PUBLICATION_ALREADY_FINALIZED',
    )
  })
})

describe('ProjectRepositoryV4 retained-row integrity and garbage collection', () => {
  it('returns fresh deeply frozen records only after all row integrity checks pass', async () => {
    const candidate = project('revision-a')
    await publishStable(repository, candidate, 'token-a')

    const first = await repository.readRevision('revision-a')
    const second = await repository.readRevision('revision-a')

    expect(first).toEqual({
      revisionId: 'revision-a',
      configRevision: await configRevisionForProjectV4(candidate),
      project: candidate,
    })
    expect(first).not.toBe(second)
    expect(first?.project).not.toBe(second?.project)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first?.project)).toBe(true)
    await expect(repository.readRevision('revision-missing')).resolves.toBeNull()
  })

  it('rejects closed-row, canonical-text, Project identity, and config hash corruption', async () => {
    const candidate = project('revision-a')
    await publishStable(repository, candidate, 'token-a')
    const valid = (await database.projectRevisions.get('revision-a'))!

    await database.projectRevisions.put({ ...valid, unexpected: true } as never)
    await expectRepositoryError(repository.readRevision('revision-a'), 'PROJECT_REVISION_CORRUPT')

    await database.projectRevisions.put({
      ...valid,
      canonicalJson: JSON.stringify(reverseObjectKeyOrder(JSON.parse(valid.canonicalJson))),
    })
    await expectRepositoryError(repository.readRevision('revision-a'), 'PROJECT_REVISION_CORRUPT')

    const wrongProject = project('revision-other')
    await database.projectRevisions.put({
      ...valid,
      canonicalJson: canonicalProjectV4Json(wrongProject),
      configRevision: await configRevisionForProjectV4(wrongProject),
    })
    await expectRepositoryError(repository.readRevision('revision-a'), 'PROJECT_REVISION_CORRUPT')

    await database.projectRevisions.put({ ...valid, configRevision: 'f'.repeat(64) })
    await expectRepositoryError(
      repository.readRevision('revision-a'),
      'PROJECT_CONFIG_REVISION_MISMATCH',
    )
  })

  it('fails on corrupt pointers and never falls back from a missing active revision', async () => {
    await database.projectPointers.put({
      key: 'active',
      state: 'stable',
      revisionId: 'revision-missing',
      commitToken: 'token-a',
      unexpected: true,
    } as never)

    await expectRepositoryError(repository.readPointer(), 'PROJECT_POINTER_INVALID')
    await database.projectPointers.put({
      key: 'active',
      state: 'stable',
      revisionId: 'revision-missing',
      commitToken: 'token-a',
    })
    await expectRepositoryError(repository.readActive(), 'PROJECT_REVISION_MISSING')
  })

  it('garbage-collects only unreachable revisions for stable and publishing pointers', async () => {
    await publishStable(repository, project('revision-a'), 'token-a')
    await database.projectRevisions.add(await storedRow(project('revision-orphan-a')))

    await repository.garbageCollect()

    await expect(database.projectRevisions.toCollection().primaryKeys())
      .resolves.toEqual(['revision-a'])

    const preparedB = await repository.prepareRevision(project('revision-b'))
    await repository.commitPreparedRevision('revision-a', preparedB, 'token-b')
    await database.projectRevisions.add(await storedRow(project('revision-orphan-b')))

    await repository.garbageCollect()

    expect((await database.projectRevisions.toCollection().primaryKeys()).sort()).toEqual([
      'revision-a',
      'revision-b',
    ])
    await expect(database.projectCommitTokens.count()).resolves.toBe(2)
  })

  it('validates every retained row before deleting anything and fails safely without a pointer', async () => {
    await publishStable(repository, project('revision-a'), 'token-a')
    await database.projectRevisions.add(await storedRow(project('revision-orphan')))
    await database.projectRevisions.update('revision-a', { configRevision: '0'.repeat(64) })

    await expectRepositoryError(
      repository.garbageCollect(),
      'PROJECT_CONFIG_REVISION_MISMATCH',
    )
    expect((await database.projectRevisions.toCollection().primaryKeys()).sort()).toEqual([
      'revision-a',
      'revision-orphan',
    ])

    await database.projectPointers.delete('active')
    await expectRepositoryError(repository.garbageCollect(), 'PROJECT_POINTER_MISSING')
    expect((await database.projectRevisions.toCollection().primaryKeys()).sort()).toEqual([
      'revision-a',
      'revision-orphan',
    ])
  })

  it('holds pointer and revision write locks across mark-and-sweep so a second-tab commit waits', async () => {
    await publishStable(repository, project('revision-a'), 'token-a')
    await database.projectRevisions.add(await storedRow(project('revision-orphan')))
    const secondDatabase = new ProjectDatabaseV4(database.name)
    openDatabases.push(secondDatabase)
    const secondRepository = createRepository(secondDatabase)
    const preparedB = await secondRepository.prepareRevision(project('revision-b'))
    const pointerRead = deferred()
    const release = deferred()
    const pointerTable = database.projectPointers
    const originalGet = pointerTable.get.bind(pointerTable)
    pointerTable.get = (async (key: string) => {
      const value = await originalGet(key)
      if (key === 'active') {
        pointerRead.resolve()
        await Dexie.waitFor(release.promise)
      }
      return value
    }) as typeof pointerTable.get

    const collection = repository.garbageCollect()
    await pointerRead.promise
    let commitSettled = false
    const commit = secondRepository
      .commitPreparedRevision('revision-a', preparedB, 'token-b')
      .finally(() => { commitSettled = true })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(commitSettled).toBe(false)
    release.resolve()
    await collection
    await commit
    expect((await secondDatabase.projectRevisions.toCollection().primaryKeys()).sort()).toEqual([
      'revision-a',
      'revision-b',
    ])
  })
})
