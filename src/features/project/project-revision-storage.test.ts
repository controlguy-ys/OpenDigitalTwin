import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorkcellProjectSnapshotV3 } from '../../domain/project/project-v3'
import {
  ProjectDatabase,
  type ProjectSourceBlobV1,
  type StoredProjectRevisionV1,
  type StoredWorkcellProjectSnapshotProjectionV3,
} from './project-db'
import {
  garbageCollectProjectRevisionStorageV1,
  preflightProjectRevisionStorageQuotaV1,
  PROJECT_REVISION_COMMIT_OVERHEAD_BYTES_V1,
  rethrowProjectRevisionStorageWriteErrorV1,
} from './project-revision-storage'
import { repositoryProjectFixture } from './project-revision-repository.test-support'

const ROBOT_A = 'a'.repeat(64)
const OBJECT_A = 'b'.repeat(64)
const ORPHAN = 'c'.repeat(64)
const OBJECT_B = 'd'.repeat(64)
const REVISION_A = '1'.repeat(64)
const REVISION_B = '2'.repeat(64)
const REVISION_ORPHAN = '3'.repeat(64)

let sequence = 0
let baseSnapshot: WorkcellProjectSnapshotV3
const openDatabases: { readonly database: ProjectDatabase; readonly name: string }[] = []

function databasePair(): { readonly a: ProjectDatabase; readonly b: ProjectDatabase; readonly name: string } {
  const name = `project-revision-storage-${++sequence}`
  const a = new ProjectDatabase(name)
  const b = new ProjectDatabase(name)
  openDatabases.push({ database: a, name }, { database: b, name })
  return { a, b, name }
}

function projection(
  projectId: string,
  robotSha256 = ROBOT_A,
  objectSha256: string | null = null,
): StoredWorkcellProjectSnapshotProjectionV3 {
  const candidate = structuredClone(baseSnapshot) as unknown as Record<string, unknown>
  const manifest = candidate.manifest as Record<string, unknown>
  manifest.projectId = projectId
  manifest.name = projectId
  const robot = candidate.robot as Record<string, unknown>
  const robotSources = robot.sources as Record<string, unknown>[]
  const robotSource = robotSources[0]!
  robotSource.id = robotSha256
  robotSource.sha256 = robotSha256
  delete robotSource.sourceBytes
  for (const link of robot.links as Record<string, unknown>[]) {
    for (const sourceRef of link.sourceRefs as Record<string, unknown>[]) {
      sourceRef.sourceAssetId = robotSha256
    }
  }
  const objectAssets = candidate.objectAssets as Record<string, unknown>[]
  if (objectSha256 === null) {
    candidate.objectAssets = []
  } else {
    const asset = objectAssets[0]!
    delete asset.sourceBytes
    asset.sourceSha256 = objectSha256
    candidate.objectAssets = [asset]
  }
  return candidate as unknown as StoredWorkcellProjectSnapshotProjectionV3
}

function revision(
  revisionId: string,
  projectId: string,
  snapshot: StoredWorkcellProjectSnapshotProjectionV3,
): StoredProjectRevisionV1 {
  return {
    revisionId,
    projectId,
    createdAt: '2026-07-15T00:00:00.000Z',
    snapshot,
  }
}

function blob(namespace: 'robot' | 'object', sha256: string): ProjectSourceBlobV1 {
  const bytes = Uint8Array.from([sha256.charCodeAt(0)]).buffer
  return {
    key: `${namespace}:${sha256}`,
    namespace,
    sha256,
    sourceBytes: bytes,
    byteLength: bytes.byteLength,
  }
}

function deferred(): {
  readonly promise: Promise<void>
  readonly resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

beforeEach(async () => {
  baseSnapshot = await repositoryProjectFixture({
    objectStepAssets: [{ id: 'asset-a', bytes: [4, 5, 6] }],
  })
})

afterEach(async () => {
  const names = new Set(openDatabases.splice(0).map(({ database, name }) => {
    database.close()
    return name
  }))
  await Promise.all([...names].map((name) => Dexie.delete(name)))
})

describe('project revision storage garbage collection', () => {
  it('retains the stable revision and only its exact namespace-local source Blobs', async () => {
    const { a: database } = databasePair()
    const active = revision(REVISION_A, 'project-a', projection('project-a', ROBOT_A, OBJECT_A))
    const orphan = revision(REVISION_ORPHAN, 'project-a', projection('project-a', ROBOT_A, ORPHAN))
    await database.projectRevisions.bulkPut([active, orphan])
    await database.projectSourceBlobs.bulkPut([
      blob('robot', ROBOT_A),
      blob('object', OBJECT_A),
      blob('object', ORPHAN),
    ])
    await database.projectPointers.put({
      key: 'active',
      state: 'stable',
      revisionId: active.revisionId,
      commitToken: 'commit-a',
    })

    await garbageCollectProjectRevisionStorageV1(database)

    expect((await database.projectRevisions.toCollection().primaryKeys()).sort()).toEqual([
      active.revisionId,
    ])
    expect((await database.projectSourceBlobs.toCollection().primaryKeys()).sort()).toEqual([
      `object:${OBJECT_A}`,
      `robot:${ROBOT_A}`,
    ])
  })

  it('retains both the publishing target and its exact previous stable revision', async () => {
    const { a: database } = databasePair()
    const previous = revision(REVISION_A, 'project-a', projection('project-a', ROBOT_A))
    const publishing = revision(REVISION_B, 'project-a', projection('project-a', ROBOT_A, OBJECT_B))
    const orphan = revision(REVISION_ORPHAN, 'project-a', projection('project-a', ROBOT_A, ORPHAN))
    await database.projectRevisions.bulkPut([previous, publishing, orphan])
    await database.projectSourceBlobs.bulkPut([
      blob('robot', ROBOT_A),
      blob('object', OBJECT_B),
      blob('object', ORPHAN),
    ])
    await database.projectPointers.put({
      key: 'active',
      state: 'publishing',
      revisionId: publishing.revisionId,
      previousRevisionId: previous.revisionId,
      previousCommitToken: 'commit-a',
      commitToken: 'commit-b',
    })

    await garbageCollectProjectRevisionStorageV1(database)

    expect((await database.projectRevisions.toCollection().primaryKeys()).sort()).toEqual([
      previous.revisionId,
      publishing.revisionId,
    ])
    expect((await database.projectSourceBlobs.toCollection().primaryKeys()).sort()).toEqual([
      `object:${OBJECT_B}`,
      `robot:${ROBOT_A}`,
    ])
  })

  it.each([
    {
      name: 'active pointer',
      seedFault: async (database: ProjectDatabase, active: StoredProjectRevisionV1) => {
        await database.projectRevisions.put(active)
      },
      code: 'PROJECT_POINTER_MISSING',
    },
    {
      name: 'closed native pointer',
      seedFault: async (database: ProjectDatabase, active: StoredProjectRevisionV1) => {
        await database.projectRevisions.put(active)
        await database.projectPointers.put({
          key: 'active',
          state: 'stable',
          revisionId: active.revisionId,
          commitToken: 'commit-a',
          unexpected: true,
        } as never)
      },
      code: 'PROJECT_POINTER_INVALID',
    },
    {
      name: 'retained revision',
      seedFault: async (database: ProjectDatabase, active: StoredProjectRevisionV1) => {
        await database.projectPointers.put({
          key: 'active',
          state: 'stable',
          revisionId: active.revisionId,
          commitToken: 'commit-a',
        })
      },
      code: 'PROJECT_REVISION_MISSING',
    },
    {
      name: 'native pointer revision digest',
      seedFault: async (database: ProjectDatabase, active: StoredProjectRevisionV1) => {
        await database.projectRevisions.put(active)
        await database.projectPointers.put({
          key: 'active',
          state: 'stable',
          revisionId: 'revision-a',
          commitToken: 'commit-a',
        })
      },
      code: 'PROJECT_POINTER_INVALID',
    },
    {
      name: 'retained projection',
      seedFault: async (database: ProjectDatabase, active: StoredProjectRevisionV1) => {
        await database.projectRevisions.put({
          ...active,
          snapshot: projection('project-a', ROBOT_A, 'not-a-digest'),
        })
        await database.projectPointers.put({
          key: 'active',
          state: 'stable',
          revisionId: active.revisionId,
          commitToken: 'commit-a',
        })
      },
      code: 'PROJECT_REVISION_INVALID',
    },
  ])('aborts with zero deletions for a corrupt or missing $name', async ({ seedFault, code }) => {
    const { a: database } = databasePair()
    const active = revision(REVISION_A, 'project-a', projection('project-a'))
    const orphan = revision(REVISION_ORPHAN, 'project-a', projection('project-a'))
    await database.projectRevisions.put(orphan)
    await database.projectSourceBlobs.put(blob('object', ORPHAN))
    await seedFault(database, active)
    const before = {
      revisions: await database.projectRevisions.count(),
      blobs: await database.projectSourceBlobs.count(),
    }

    await expect(garbageCollectProjectRevisionStorageV1(database)).rejects.toMatchObject({ code })

    expect(await database.projectRevisions.count()).toBe(before.revisions)
    expect(await database.projectSourceBlobs.count()).toBe(before.blobs)
  })

  it('reconstitutes and rejects corrupt non-source Project fields before deleting anything', async () => {
    const { a: database } = databasePair()
    const corruptProjection = projection('project-a') as unknown as Record<string, unknown>
    ;(corruptProjection.manifest as Record<string, unknown>).schemaVersion = 99
    const active = revision(
      REVISION_A,
      'project-a',
      corruptProjection as unknown as StoredWorkcellProjectSnapshotProjectionV3,
    )
    const orphan = revision(
      REVISION_ORPHAN,
      'project-a',
      projection('project-a', ROBOT_A, ORPHAN),
    )
    await database.projectRevisions.bulkPut([active, orphan])
    await database.projectSourceBlobs.bulkPut([
      blob('robot', ROBOT_A),
      blob('object', ORPHAN),
    ])
    await database.projectPointers.put({
      key: 'active',
      state: 'stable',
      revisionId: active.revisionId,
      commitToken: 'commit-a',
    })

    await expect(garbageCollectProjectRevisionStorageV1(database)).rejects.toMatchObject({
      code: 'PROJECT_REVISION_INVALID',
    })
    expect(await database.projectRevisions.count()).toBe(2)
    expect(await database.projectSourceBlobs.count()).toBe(2)
  })

  it('rejects a zero-length reachable source Blob before deleting anything', async () => {
    const { a: database } = databasePair()
    const active = revision(REVISION_A, 'project-a', projection('project-a'))
    const orphan = revision(
      REVISION_ORPHAN,
      'project-a',
      projection('project-a', ROBOT_A, ORPHAN),
    )
    const empty = new ArrayBuffer(0)
    await database.projectRevisions.bulkPut([active, orphan])
    await database.projectSourceBlobs.bulkPut([
      {
        key: `robot:${ROBOT_A}`,
        namespace: 'robot',
        sha256: ROBOT_A,
        sourceBytes: empty,
        byteLength: 0,
      },
      blob('object', ORPHAN),
    ])
    await database.projectPointers.put({
      key: 'active',
      state: 'stable',
      revisionId: active.revisionId,
      commitToken: 'commit-a',
    })

    await expect(garbageCollectProjectRevisionStorageV1(database)).rejects.toMatchObject({
      code: 'PROJECT_SOURCE_BLOB_INVALID',
    })
    expect(await database.projectRevisions.count()).toBe(2)
    expect(await database.projectSourceBlobs.count()).toBe(2)
  })

  it('rejects a missing reachable source Blob before deleting anything', async () => {
    const { a: database } = databasePair()
    const active = revision(REVISION_A, 'project-a', projection('project-a'))
    const orphan = revision(
      REVISION_ORPHAN,
      'project-a',
      projection('project-a', ROBOT_A, ORPHAN),
    )
    await database.projectRevisions.bulkPut([active, orphan])
    await database.projectSourceBlobs.put(blob('object', ORPHAN))
    await database.projectPointers.put({
      key: 'active',
      state: 'stable',
      revisionId: active.revisionId,
      commitToken: 'commit-a',
    })

    await expect(garbageCollectProjectRevisionStorageV1(database)).rejects.toMatchObject({
      code: 'PROJECT_SOURCE_BLOB_MISSING',
    })
    expect(await database.projectRevisions.count()).toBe(2)
    expect(await database.projectSourceBlobs.count()).toBe(1)
  })

  it('holds the three-table write lock while a second tab waits to commit', async () => {
    const { a, b } = databasePair()
    const active = revision(REVISION_A, 'project-a', projection('project-a'))
    await a.projectRevisions.put(active)
    await a.projectSourceBlobs.put(blob('robot', ROBOT_A))
    await a.projectPointers.put({
      key: 'active',
      state: 'stable',
      revisionId: active.revisionId,
      commitToken: 'commit-a',
    })
    const hookReached = deferred()
    const releaseGc = deferred()
    const gc = garbageCollectProjectRevisionStorageV1(a, {
      afterPointerRead: async () => {
        hookReached.resolve()
        await releaseGc.promise
      },
    })
    await hookReached.promise

    const next = revision(REVISION_B, 'project-a', projection('project-a', ROBOT_A, OBJECT_B))
    let commitSettled = false
    let writesFinished = false
    const commit = b.transaction(
      'rw',
      b.projectPointers,
      b.projectRevisions,
      b.projectSourceBlobs,
      async () => {
        await b.projectSourceBlobs.put(blob('object', OBJECT_B))
        await b.projectRevisions.put(next)
        await b.projectPointers.put({
          key: 'active',
          state: 'publishing',
          revisionId: next.revisionId,
          previousRevisionId: active.revisionId,
          previousCommitToken: 'commit-a',
          commitToken: 'commit-b',
        })
        writesFinished = true
      },
    ).finally(() => {
      commitSettled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(commitSettled).toBe(false)
    expect(writesFinished).toBe(false)

    releaseGc.resolve()
    await Promise.all([gc, commit])
    expect(await b.projectRevisions.get(next.revisionId)).toEqual(next)
    expect(await b.projectSourceBlobs.get(`object:${OBJECT_B}`)).toBeDefined()
    expect(await b.projectPointers.get('active')).toMatchObject({
      state: 'publishing',
      revisionId: next.revisionId,
      commitToken: 'commit-b',
    })
  })
})

describe('project revision storage quota boundary', () => {
  it('fails known insufficient headroom before the caller starts any DB write', async () => {
    const { a: database } = databasePair()
    const attempt = async () => {
      await preflightProjectRevisionStorageQuotaV1({
        additionalUniqueBlobBytes: 64,
        estimate: async () => ({
          usage: 0,
          quota: PROJECT_REVISION_COMMIT_OVERHEAD_BYTES_V1 + 63,
        }),
      })
      await database.projectRevisions.put(revision(
        REVISION_A,
        'project-a',
        projection('project-a'),
      ))
    }

    await expect(attempt()).rejects.toMatchObject({
      code: 'PROJECT_STORAGE_QUOTA_INSUFFICIENT',
    })
    expect(await database.projectRevisions.count()).toBe(0)
    expect(await database.projectPointers.count()).toBe(0)
    expect(await database.projectSourceBlobs.count()).toBe(0)
  })

  it('accepts exact known headroom and treats a failed estimate as unknown', async () => {
    await expect(preflightProjectRevisionStorageQuotaV1({
      additionalUniqueBlobBytes: 64,
      estimate: async () => ({
        usage: 100,
        quota: 100 + PROJECT_REVISION_COMMIT_OVERHEAD_BYTES_V1 + 64,
      }),
    })).resolves.toBeUndefined()
    await expect(preflightProjectRevisionStorageQuotaV1({
      additionalUniqueBlobBytes: 64,
      estimate: async () => {
        throw new Error('estimate unavailable')
      },
    })).resolves.toBeUndefined()
  })

  it('maps only a Dexie QuotaExceededError outside the transaction boundary', () => {
    const quota = new Dexie.QuotaExceededError('database full')
    expect(() => rethrowProjectRevisionStorageWriteErrorV1(quota)).toThrow(
      expect.objectContaining({ code: 'PROJECT_STORAGE_QUOTA_INSUFFICIENT', cause: quota }),
    )

    const sameNameImpostor = Object.assign(new Error('not Dexie'), {
      name: 'QuotaExceededError',
    })
    expect(() => rethrowProjectRevisionStorageWriteErrorV1(sameNameImpostor))
      .toThrow(sameNameImpostor)
    const otherDexieError = new Dexie.ConstraintError('not quota')
    expect(() => rethrowProjectRevisionStorageWriteErrorV1(otherDexieError))
      .toThrow(otherDexieError)
  })
})
