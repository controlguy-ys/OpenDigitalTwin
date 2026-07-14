import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProjectHashService, createProjectRevisionIdentityHasher } from '../../lib/hash/sha256'
import {
  createProjectSourceStagingService,
  installProjectSourcePublicationRepositoryBindingInternalV1,
  stageProjectSourcesV3,
  type ProjectSourceStagingService,
  type WorkcellProjectSnapshotV3,
} from '../../domain/project/project-v3'
import { ProjectDatabase, type StoredWorkcellProjectSnapshotProjectionV3 } from './project-db'
import { createProjectRevisionIdentityProjectionV3 } from './project-revision-canonical'
import {
  materializeHydratedProjectSnapshotV1,
  type HydratedProjectRevisionV1,
} from './project-revision-hydration'
import {
  createProjectRevisionFoundation,
  createProjectRevisionRepository,
  type PreparedProjectRevisionRecordV1,
  type ProjectRevisionRepository,
} from './project-revision-repository'
import { PROJECT_REVISION_COMMIT_OVERHEAD_BYTES_V1 } from './project-revision-storage'
import { repositoryProjectFixture } from './project-revision-repository.test-support'

let sequence = 0
let database: ProjectDatabase
let repository: ProjectRevisionRepository
let sourceStaging: ProjectSourceStagingService
let databaseName: string

interface ActiveRepositoryRevisionTestContext {
  readonly revisionId: string
  readonly commitToken: string
  readonly snapshot: WorkcellProjectSnapshotV3
  readonly sourceHandles: readonly {
    readonly ownerKey: string
    readonly blobKey: string
  }[]
}

type ConnectedRepositoryTestApi = ProjectRevisionRepository & {
  readRevision(revisionId: string): Promise<HydratedProjectRevisionV1 | null>
  adoptHydratedRevision(
    hydrated: HydratedProjectRevisionV1,
  ): Promise<ActiveRepositoryRevisionTestContext>
}

function projection(name: string): StoredWorkcellProjectSnapshotProjectionV3 {
  return {
    manifest: {
      format: 'WebDigitalTwinProject',
      schemaVersion: 3,
      projectId: 'pointer-protocol-project',
      name,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    },
    robot: { sources: [] },
    objectAssets: [],
  } as unknown as StoredWorkcellProjectSnapshotProjectionV3
}

function projectionWithAssets(
  name: string,
  assetIds: readonly string[],
): StoredWorkcellProjectSnapshotProjectionV3 {
  return {
    ...projection(name),
    objectAssets: assetIds.map((id) => ({
      id,
      name: id,
      sourceKind: 'box',
      size: [1, 1, 1],
    })),
  } as unknown as StoredWorkcellProjectSnapshotProjectionV3
}

function stepAssetBytes(snapshot: WorkcellProjectSnapshotV3, assetId: string): ArrayBuffer {
  const asset = snapshot.objectAssets.find(({ id }) => id === assetId)
  expect(asset?.sourceKind).toBe('step')
  return (asset as Extract<
    WorkcellProjectSnapshotV3['objectAssets'][number],
    { readonly sourceKind: 'step' }
  >).sourceBytes
}

async function prepared(name: string): Promise<PreparedProjectRevisionRecordV1> {
  return preparedFor(repository, sourceStaging, name)
}

async function preparedFor(
  targetRepository: ProjectRevisionRepository,
  staging: ProjectSourceStagingService,
  name: string,
): Promise<PreparedProjectRevisionRecordV1> {
  const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
  const staged = await stageProjectSourcesV3(
    await repositoryProjectFixture({
      projectId: 'pointer-protocol-project',
      name,
    }),
    staging,
    createProjectRevisionIdentityHasher(hashService),
  )
  return targetRepository.prepareRevision(targetRepository.createCandidate({
    projection: staged.projection,
    preparedSourceGroups: staged.preparedSourceGroups,
  }))
}

beforeEach(() => {
  databaseName = `project-revision-repository-${++sequence}`
  database = new ProjectDatabase(databaseName)
  const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
  const foundation = createProjectRevisionFoundation({
    database,
    revisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
    sourceStagingOptions: {
      sourceDigest: { digestSource: hashService.sha256.bind(hashService) },
    },
    now: () => '2026-07-15T00:00:00.000Z',
  })
  repository = foundation.repository
  sourceStaging = foundation.sourceStaging
})

afterEach(async () => {
  database.close()
  await Dexie.delete(databaseName)
})

describe('ProjectRevisionRepository pointer protocol', () => {
  it('rejects a plain incomplete candidate before source lease, hashing, or persistence', async () => {
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const revisionHash = vi.fn(async () => 'a'.repeat(64))
    const foundation = createProjectRevisionFoundation({
      database,
      revisionIdentityHasher: { hashRevisionIdentity: revisionHash },
      sourceStagingOptions: {
        sourceDigest: { digestSource: hashService.sha256.bind(hashService) },
      },
    })
    const source = await foundation.sourceStaging.stage(
      'object',
      Uint8Array.from([1, 2, 3]).buffer,
    )
    const incomplete = {
      manifest: {
        format: 'WebDigitalTwinProject',
        schemaVersion: 3,
        projectId: 'incomplete-project',
        name: 'Incomplete',
        createdAt: '2026-07-15T00:00:00.000Z',
        updatedAt: '2026-07-15T00:00:00.000Z',
      },
      robot: { sources: [] },
      objectAssets: [],
    } as unknown as StoredWorkcellProjectSnapshotProjectionV3

    await expect(foundation.repository.prepareRevision({
      projection: incomplete,
      preparedSourceGroups: [{
        ownerKeys: ['object-asset:asset-a'],
        preparedSource: source,
      }],
    } as never)).rejects.toMatchObject({ code: 'PROJECT_REVISION_CANDIDATE_INVALID' })

    expect(revisionHash).not.toHaveBeenCalled()
    expect(() => foundation.sourceStaging.assertPrepared(source)).not.toThrow()
    expect(await database.projectSourceBlobs.count()).toBe(0)
    expect(await database.projectRevisions.count()).toBe(0)
    expect(await database.projectPointers.count()).toBe(0)
  })

  it('atomically stores an initial revision behind a publishing pointer', async () => {
    const revision = await prepared('Initial')

    await repository.commitPreparedRevision(null, revision, 'commit-a')

    expect(await repository.readPointer()).toEqual({
      key: 'active',
      state: 'publishing',
      revisionId: revision.storedRevision.revisionId,
      previousRevisionId: null,
      previousCommitToken: null,
      commitToken: 'commit-a',
    })
    expect(await database.projectRevisions.get(revision.storedRevision.revisionId))
      .toEqual(revision.storedRevision)
  })

  it('integrity-hydrates the exact publishing target for startup recovery', async () => {
    const revision = await prepared('Interrupted publication')
    await repository.commitPreparedRevision(null, revision, 'interrupted')

    const hydrated = await repository.readRevision(revision.storedRevision.revisionId)

    expect(hydrated).not.toBeNull()
    await repository.finalizePublication('interrupted')
    await expect(repository.adoptHydratedRevision(hydrated!)).resolves.toMatchObject({
      revisionId: revision.storedRevision.revisionId,
      commitToken: 'interrupted',
    })
  })

  it('compensates to the exact previous stable commit token', async () => {
    const first = await prepared('First')
    await repository.commitPreparedRevision(null, first, 'commit-a')
    await repository.finalizePublication('commit-a')
    const second = await prepared('Second')
    await repository.commitPreparedRevision(first.storedRevision.revisionId, second, 'commit-b')

    await repository.compensatePublication('commit-b')

    expect(await repository.readPointer()).toEqual({
      key: 'active',
      state: 'stable',
      revisionId: first.storedRevision.revisionId,
      commitToken: 'commit-a',
    })
  })

  it('rejects a stale CAS without leaving an orphan revision', async () => {
    const winner = await prepared('Winner')
    const stale = await prepared('Stale')
    await repository.commitPreparedRevision(null, winner, 'commit-a')
    await repository.finalizePublication('commit-a')

    await expect(repository.commitPreparedRevision(null, stale, 'commit-b')).rejects
      .toMatchObject({ code: 'PROJECT_ACTIVE_REVISION_CHANGED' })

    expect(await repository.readPointer()).toMatchObject({
      state: 'stable',
      revisionId: winner.storedRevision.revisionId,
      commitToken: 'commit-a',
    })
    expect(await database.projectRevisions.get(stale.storedRevision.revisionId)).toBeUndefined()
  })

  it('treats repeated finalization of the same token as idempotent', async () => {
    const revision = await prepared('Finalized')
    await repository.commitPreparedRevision(null, revision, 'commit-a')

    await repository.finalizePublication('commit-a')
    await expect(repository.finalizePublication('commit-a')).resolves.toBeUndefined()

    expect(await repository.readPointer()).toEqual({
      key: 'active',
      state: 'stable',
      revisionId: revision.storedRevision.revisionId,
      commitToken: 'commit-a',
    })
  })

  it('deletes the initial publishing pointer during compensation', async () => {
    const revision = await prepared('Initial')
    await repository.commitPreparedRevision(null, revision, 'commit-a')

    await repository.compensatePublication('commit-a')

    expect(await repository.readPointer()).toBeNull()
  })

  it('rejects a stable or already claimed commit token before any write', async () => {
    const first = await prepared('First token')
    await repository.commitPreparedRevision(null, first, 'commit-a')
    await repository.finalizePublication('commit-a')
    const stableReuse = await prepared('Stable token reuse')

    await expect(repository.commitPreparedRevision(
      first.storedRevision.revisionId,
      stableReuse,
      'commit-a',
    )).rejects.toMatchObject({ code: 'PROJECT_COMMIT_TOKEN_REUSED' })
    expect(await database.projectRevisions.get(stableReuse.storedRevision.revisionId)).toBeUndefined()

    const compensatedDatabaseName = `project-revision-token-${++sequence}`
    const compensatedDatabase = new ProjectDatabase(compensatedDatabaseName)
    try {
      const compensatedHashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
      const compensatedFoundation = createProjectRevisionFoundation({
        database: compensatedDatabase,
        revisionIdentityHasher: createProjectRevisionIdentityHasher(
          compensatedHashService,
        ),
        sourceStagingOptions: {
          sourceDigest: {
            digestSource: compensatedHashService.sha256.bind(compensatedHashService),
          },
        },
      })
      const compensatedRepository = compensatedFoundation.repository
      const claimed = await preparedFor(
        compensatedRepository,
        compensatedFoundation.sourceStaging,
        'Claimed',
      )
      await compensatedRepository.commitPreparedRevision(null, claimed, 'commit-once')
      await compensatedRepository.compensatePublication('commit-once')
      const reused = await preparedFor(
        compensatedRepository,
        compensatedFoundation.sourceStaging,
        'Reused',
      )

      await expect(compensatedRepository.commitPreparedRevision(
        null,
        reused,
        'commit-once',
      )).rejects.toMatchObject({ code: 'PROJECT_COMMIT_TOKEN_REUSED' })
      expect(await compensatedDatabase.projectRevisions.get(reused.storedRevision.revisionId))
        .toBeUndefined()
    } finally {
      compensatedDatabase.close()
      await Dexie.delete(compensatedDatabaseName)
    }
  })

  it('durably rejects a compensated commit token after reopen so delayed finalize cannot ABA', async () => {
    const original = await prepared('Original ABA attempt')
    await repository.commitPreparedRevision(null, original, 'commit-aba')
    await repository.compensatePublication('commit-aba')

    const reopenedDatabase = new ProjectDatabase(databaseName)
    const reopenedHashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const reopenedFoundation = createProjectRevisionFoundation({
      database: reopenedDatabase,
      revisionIdentityHasher: createProjectRevisionIdentityHasher(reopenedHashService),
      sourceStagingOptions: {
        sourceDigest: { digestSource: reopenedHashService.sha256.bind(reopenedHashService) },
      },
    })
    try {
      const replacement = await preparedFor(
        reopenedFoundation.repository,
        reopenedFoundation.sourceStaging,
        'Replacement ABA attempt',
      )

      await expect(reopenedFoundation.repository.commitPreparedRevision(
        null,
        replacement,
        'commit-aba',
      )).rejects.toMatchObject({ code: 'PROJECT_COMMIT_TOKEN_REUSED' })
      await expect(repository.finalizePublication('commit-aba')).rejects.toMatchObject({
        code: 'PROJECT_PUBLICATION_NOT_FOUND',
      })
      expect(await reopenedDatabase.projectPointers.get('active')).toBeUndefined()
      expect(await reopenedDatabase.projectRevisions.get(replacement.storedRevision.revisionId))
        .toBeUndefined()
    } finally {
      reopenedDatabase.close()
    }
  })

  it('lets only one of two repositories reserve the same commit token', async () => {
    const contenderA = await prepared('Contender A')
    const databaseB = new ProjectDatabase(databaseName)
    const hashServiceB = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const foundationB = createProjectRevisionFoundation({
      database: databaseB,
      revisionIdentityHasher: createProjectRevisionIdentityHasher(hashServiceB),
      sourceStagingOptions: {
        sourceDigest: { digestSource: hashServiceB.sha256.bind(hashServiceB) },
      },
    })
    try {
      const contenderB = await preparedFor(
        foundationB.repository,
        foundationB.sourceStaging,
        'Contender B',
      )
      const outcomes = await Promise.allSettled([
        repository.commitPreparedRevision(null, contenderA, 'shared-token'),
        foundationB.repository.commitPreparedRevision(null, contenderB, 'shared-token'),
      ])

      expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
      expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1)
      expect(outcomes.find(({ status }) => status === 'rejected')).toMatchObject({
        reason: { code: 'PROJECT_COMMIT_TOKEN_REUSED' },
      })
      expect(await database.projectRevisions.count()).toBe(1)
    } finally {
      databaseB.close()
    }
  })

  it('rejects a non-canonical revision identity before persistence', async () => {
    const sourceHashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const invalidFoundation = createProjectRevisionFoundation({
      database,
      revisionIdentityHasher: {
        hashRevisionIdentity: async () => 'NOT-A-SHA256',
      },
      sourceStagingOptions: {
        sourceDigest: { digestSource: sourceHashService.sha256.bind(sourceHashService) },
      },
    })
    const staged = await stageProjectSourcesV3(
      await repositoryProjectFixture({ name: 'Invalid identity' }),
      invalidFoundation.sourceStaging,
      createProjectRevisionIdentityHasher(sourceHashService),
    )

    await expect(invalidFoundation.repository.prepareRevision(
      invalidFoundation.repository.createCandidate({
      projection: staged.projection,
      preparedSourceGroups: staged.preparedSourceGroups,
    }))).rejects.toMatchObject({ code: 'PROJECT_REVISION_ID_INVALID' })
    expect(await database.projectRevisions.count()).toBe(0)
    expect(await database.projectPointers.count()).toBe(0)
  })

  it('reuses an exactly equal immutable revision without rewriting its createdAt', async () => {
    const first = await prepared('Equal')
    await repository.commitPreparedRevision(null, first, 'commit-a')
    await repository.finalizePublication('commit-a')
    const original = await database.projectRevisions.get(first.storedRevision.revisionId)
    const laterHashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const laterFoundation = createProjectRevisionFoundation({
      database,
      revisionIdentityHasher: createProjectRevisionIdentityHasher(
        laterHashService,
      ),
      sourceStagingOptions: {
        sourceDigest: { digestSource: laterHashService.sha256.bind(laterHashService) },
      },
      now: () => '2026-07-16T00:00:00.000Z',
    })
    const laterRepository = laterFoundation.repository
    const equal = await preparedFor(laterRepository, laterFoundation.sourceStaging, 'Equal')

    await laterRepository.commitPreparedRevision(
      first.storedRevision.revisionId,
      equal,
      'commit-b',
    )

    expect(await database.projectRevisions.get(first.storedRevision.revisionId)).toEqual(original)
  })

  it('normalizes unordered asset records before calculating revision identity', async () => {
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const revisionHasher = createProjectRevisionIdentityHasher(hashService)
    const forwardSources = [
      { id: 'asset-a', bytes: [4, 5, 6] },
      { id: 'asset-b', bytes: [7, 8, 9] },
    ]
    const reverseSources = [...forwardSources].reverse()
    const forwardStaged = await stageProjectSourcesV3(
      await repositoryProjectFixture({ name: 'Assets', objectStepAssets: forwardSources }),
      sourceStaging,
      revisionHasher,
    )
    const reverseStaged = await stageProjectSourcesV3(
      await repositoryProjectFixture({ name: 'Assets', objectStepAssets: reverseSources }),
      sourceStaging,
      revisionHasher,
    )
    const forward = await repository.prepareRevision(repository.createCandidate({
      projection: forwardStaged.projection,
      preparedSourceGroups: forwardStaged.preparedSourceGroups,
    }))
    const reverse = await repository.prepareRevision(repository.createCandidate({
      projection: reverseStaged.projection,
      preparedSourceGroups: reverseStaged.preparedSourceGroups,
    }))

    expect(reverse.storedRevision.revisionId).toBe(forward.storedRevision.revisionId)
  })

  it('does not depend on locale collation while canonicalizing unordered records', () => {
    const original = String.prototype.localeCompare
    let calls = 0
    String.prototype.localeCompare = function localeCompareGuard(): number {
      calls += 1
      return original.call(this, String(arguments[0]))
    }
    try {
      createProjectRevisionIdentityProjectionV3(
        projectionWithAssets('Assets', ['asset-b', 'asset-a']),
      )
    } finally {
      String.prototype.localeCompare = original
    }

    expect(calls).toBe(0)
  })
})

describe('ProjectRevisionRepository canonical source binding', () => {
  it('rejects a direct-import fake binding without claiming the staging service', async () => {
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const staging = createProjectSourceStagingService({
      sourceDigest: { digestSource: hashService.sha256.bind(hashService) },
    })

    let bindingError: unknown
    try {
      installProjectSourcePublicationRepositoryBindingInternalV1(staging, {} as never)
    } catch (error) {
      bindingError = error
    }
    expect(bindingError).toMatchObject({ code: 'PROJECT_SOURCE_REPOSITORY_BINDING_INVALID' })

    const metadataOnly = createProjectRevisionRepository({
      database,
      revisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
      // A runtime caller cannot reopen the removed first-bind path with an
      // unknown sourceStaging option.
      sourceStaging: staging,
    } as never)
    const staged = await stageProjectSourcesV3(
      await repositoryProjectFixture({
        objectStepAssets: [{ id: 'asset-a', bytes: [99] }],
      }),
      staging,
      createProjectRevisionIdentityHasher(hashService),
    )
    expect(() => metadataOnly.createCandidate({
      projection: staged.projection,
      preparedSourceGroups: staged.preparedSourceGroups,
    })).toThrow(expect.objectContaining({
      code: 'PROJECT_SOURCE_REPOSITORY_BINDING_REQUIRED',
    }))
    for (const group of staged.preparedSourceGroups) {
      expect(() => staging.assertPrepared(group.preparedSource)).not.toThrow()
      staging.revoke(group.preparedSource)
    }
  })

  it('revokes every publication lease when a post-hash clock step throws', async () => {
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const foundation = createProjectRevisionFoundation({
      database,
      revisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
      sourceStagingOptions: {
        sourceDigest: { digestSource: hashService.sha256.bind(hashService) },
      },
      now: () => {
        throw new Error('CLOCK_FAILED')
      },
    })
    const staged = await stageProjectSourcesV3(
      await repositoryProjectFixture({
        objectStepAssets: [{ id: 'asset-a', bytes: [1, 2, 3] }],
      }),
      foundation.sourceStaging,
      createProjectRevisionIdentityHasher(hashService),
    )

    await expect(foundation.repository.prepareRevision(foundation.repository.createCandidate({
      projection: staged.projection,
      preparedSourceGroups: staged.preparedSourceGroups,
    }))).rejects.toThrow(/CLOCK_FAILED/)
    for (const group of staged.preparedSourceGroups) {
      expect(() => foundation.sourceStaging.assertPrepared(group.preparedSource))
        .toThrow(/revoked/i)
    }
  })

  it('leases before hashing, commits namespace-local Blobs, and consumes only after stable activation', async () => {
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const foundation = createProjectRevisionFoundation({
      database,
      revisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
      sourceStagingOptions: {
        sourceDigest: { digestSource: hashService.sha256.bind(hashService) },
      },
      now: () => '2026-07-15T00:00:00.000Z',
    })
    const { repository: sourceRepository, sourceStaging: staging } = foundation
    const staged = await stageProjectSourcesV3(
      await repositoryProjectFixture({
        objectStepAssets: [{ id: 'asset-a', bytes: [1, 2, 3] }],
      }),
      staging,
      createProjectRevisionIdentityHasher(hashService),
    )

    const pending = sourceRepository.prepareRevision(sourceRepository.createCandidate({
      projection: staged.projection,
      preparedSourceGroups: staged.preparedSourceGroups,
    }))
    for (const group of staged.preparedSourceGroups) {
      expect(() => staging.revoke(group.preparedSource)).toThrow(/publication-leased/i)
    }
    const preparedRevision = await pending
    await sourceRepository.commitPreparedRevision(null, preparedRevision, 'source-commit')

    expect((await database.projectSourceBlobs.toArray()).map(({ key }) => key).sort())
      .toEqual(staged.preparedSourceGroups.map(({ preparedSource }) =>
        `${preparedSource.namespace}:${preparedSource.sha256}`).sort())
    await expect(sourceRepository.activatePreparedSources(
      preparedRevision,
      'source-commit',
    )).rejects.toMatchObject({ code: 'PROJECT_PUBLICATION_NOT_STABLE' })
    for (const group of staged.preparedSourceGroups) {
      expect(() => staging.revoke(group.preparedSource)).toThrow(/publication-leased/i)
    }

    await sourceRepository.finalizePublication('source-commit')
    await sourceRepository.activatePreparedSources(preparedRevision, 'source-commit')
    for (const group of staged.preparedSourceGroups) {
      expect(() => staging.revoke(group.preparedSource)).toThrow(/consumed/i)
    }
  })

  it('materializes a caller-owned runtime snapshot without hashing and preserves same-digest sharing', async () => {
    const sourceDigest = vi.fn(createProjectHashService({
      subtle: globalThis.crypto.subtle,
    }).sha256)
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const foundation = createProjectRevisionFoundation({
      database,
      revisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
      sourceStagingOptions: { sourceDigest: { digestSource: sourceDigest } },
    })
    const fixture = await repositoryProjectFixture({
      objectStepAssets: [
        { id: 'asset-a', bytes: [7, 8, 9] },
        { id: 'asset-b', bytes: [7, 8, 9] },
      ],
    })
    const staged = await stageProjectSourcesV3(
      fixture,
      foundation.sourceStaging,
      createProjectRevisionIdentityHasher(hashService),
    )
    const preparedRevision = await foundation.repository.prepareRevision(
      foundation.repository.createCandidate({
        projection: staged.projection,
        preparedSourceGroups: staged.preparedSourceGroups,
      }),
    )
    sourceDigest.mockClear()

    const first = foundation.repository.materializePreparedRuntime(preparedRevision)
    const second = foundation.repository.materializePreparedRuntime(preparedRevision)
    const firstA = stepAssetBytes(first, 'asset-a')
    const firstB = stepAssetBytes(first, 'asset-b')
    const secondA = stepAssetBytes(second, 'asset-a')

    expect(firstA).toBe(firstB)
    expect(secondA).not.toBe(firstA)
    new Uint8Array(firstA)[0] = 255
    expect(new Uint8Array(secondA)[0]).toBe(7)
    expect(sourceDigest).not.toHaveBeenCalled()
  })

  it('materializes metadata-only prepared revisions without source digest work', async () => {
    const sourceDigest = vi.fn(createProjectHashService({
      subtle: globalThis.crypto.subtle,
    }).sha256)
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const foundation = createProjectRevisionFoundation({
      database,
      revisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
      sourceStagingOptions: { sourceDigest: { digestSource: sourceDigest } },
    })
    const staged = await stageProjectSourcesV3(
      await repositoryProjectFixture({ name: 'Cell A' }),
      foundation.sourceStaging,
      createProjectRevisionIdentityHasher(hashService),
    )
    const initial = await foundation.repository.prepareRevision(
      foundation.repository.createCandidate({
        projection: staged.projection,
        preparedSourceGroups: staged.preparedSourceGroups,
      }),
    )
    await foundation.repository.commitPreparedRevision(null, initial, 'initial')
    await foundation.repository.finalizePublication('initial')
    await foundation.repository.activatePreparedSources(initial, 'initial')
    sourceDigest.mockClear()
    const metadataProjection = {
      ...structuredClone(staged.projection),
      manifest: { ...staged.projection.manifest, name: 'Cell B' },
    }
    const metadata = await foundation.repository.prepareRevision(
      foundation.repository.createCandidate({ projection: metadataProjection }),
    )

    const runtime = foundation.repository.materializePreparedRuntime(metadata)

    expect(runtime.manifest.name).toBe('Cell B')
    expect(sourceDigest).not.toHaveBeenCalled()
  })

  it('idempotently discards an uncommitted prepared revision after runtime preparation fails', async () => {
    const staged = await stageProjectSourcesV3(
      await repositoryProjectFixture({ name: 'Discard me' }),
      sourceStaging,
      createProjectRevisionIdentityHasher(
        createProjectHashService({ subtle: globalThis.crypto.subtle }),
      ),
    )
    const preparedRevision = await repository.prepareRevision(repository.createCandidate({
      projection: staged.projection,
      preparedSourceGroups: staged.preparedSourceGroups,
    }))
    repository.materializePreparedRuntime(preparedRevision)

    repository.discardPreparedRevision(preparedRevision)
    repository.discardPreparedRevision(preparedRevision)

    for (const group of staged.preparedSourceGroups) {
      expect(() => sourceStaging.assertPrepared(group.preparedSource)).toThrow(/revoked/i)
    }
    expect(() => repository.materializePreparedRuntime(preparedRevision)).toThrow(
      expect.objectContaining({ code: 'PROJECT_PREPARED_REVISION_DISCARDED' }),
    )
    await expect(repository.commitPreparedRevision(
      null,
      preparedRevision,
      'discarded',
    )).rejects.toMatchObject({ code: 'PROJECT_PREPARED_REVISION_DISCARDED' })
    expect(await database.projectPointers.count()).toBe(0)
    expect(await database.projectRevisions.count()).toBe(0)
    expect(await database.projectSourceBlobs.count()).toBe(0)
  })

  it('rejects staged bytes that collide with a resident namespace and digest without mutation', async () => {
    const collisionDigest = 'c'.repeat(64)
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const collisionFoundation = createProjectRevisionFoundation({
      database,
      revisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
      sourceHashService: { sha256: async () => collisionDigest },
      sourceStagingOptions: {
        sourceDigest: { digestSource: async () => collisionDigest },
      },
      now: () => '2026-07-15T00:00:00.000Z',
    })
    const snapshot = await repositoryProjectFixture({
      name: 'Collision A',
      objectStepAssets: [{ id: 'cup-a', bytes: [1, 2, 3, 4] }],
    })
    const snapshotRecord = snapshot as unknown as Record<string, unknown>
    const robot = snapshotRecord.robot as Record<string, unknown>
    const robotSources = robot.sources as Record<string, unknown>[]
    robotSources[0]!.id = collisionDigest
    robotSources[0]!.sha256 = collisionDigest
    for (const link of robot.links as Record<string, unknown>[]) {
      for (const sourceRef of link.sourceRefs as Record<string, unknown>[]) {
        sourceRef.sourceAssetId = collisionDigest
      }
    }
    const stagedA = await stageProjectSourcesV3(
      snapshot,
      collisionFoundation.sourceStaging,
      createProjectRevisionIdentityHasher(hashService),
    )
    const revisionA = await collisionFoundation.repository.prepareRevision(
      collisionFoundation.repository.createCandidate({
        projection: stagedA.projection,
        preparedSourceGroups: stagedA.preparedSourceGroups,
      }),
    )
    await collisionFoundation.repository.commitPreparedRevision(null, revisionA, 'collision-a')
    await collisionFoundation.repository.finalizePublication('collision-a')
    await collisionFoundation.repository.activatePreparedSources(revisionA, 'collision-a')
    const hydratedBefore = await collisionFoundation.repository.readRevision(
      revisionA.storedRevision.revisionId,
    )
    const activeBefore = await collisionFoundation.repository.adoptHydratedRevision(hydratedBefore!)
    const handleBefore = activeBefore.sourceHandles.find(
      ({ ownerKey }) => ownerKey === 'object-asset:cup-a',
    )
    const pointerBefore = await collisionFoundation.repository.readPointer()
    const revisionsBefore = await database.projectRevisions.toArray()
    const blobsBefore = await database.projectSourceBlobs.toArray()

    const stagedB = await collisionFoundation.sourceStaging.stage(
      'object',
      Uint8Array.from([9, 8, 7, 6]).buffer,
    )
    const projectionB = structuredClone(revisionA.storedRevision.snapshot)
    ;(projectionB.manifest as { name: string; updatedAt: string }).name = 'Collision B'
    ;(projectionB.manifest as { name: string; updatedAt: string }).updatedAt =
      '2026-07-16T00:00:00.000Z'
    const revisionB = await collisionFoundation.repository.prepareRevision(
      collisionFoundation.repository.createCandidate({
        projection: projectionB,
        preparedSourceGroups: [{
          ownerKeys: ['object-asset:cup-a'],
          preparedSource: stagedB,
        }],
      }),
    )

    await expect(collisionFoundation.repository.commitPreparedRevision(
      revisionA.storedRevision.revisionId,
      revisionB,
      'collision-b',
    )).rejects.toMatchObject({ code: 'PROJECT_SOURCE_DIGEST_COLLISION' })

    expect(await collisionFoundation.repository.readPointer()).toEqual(pointerBefore)
    expect(await database.projectRevisions.toArray()).toEqual(revisionsBefore)
    expect(await database.projectSourceBlobs.toArray()).toEqual(blobsBefore)
    const hydratedAfter = await collisionFoundation.repository.readRevision(
      revisionA.storedRevision.revisionId,
    )
    const activeAfter = await collisionFoundation.repository.adoptHydratedRevision(hydratedAfter!)
    expect(activeAfter.sourceHandles.find(
      ({ ownerKey }) => ownerKey === 'object-asset:cup-a',
    )).toBe(handleBefore)
    expect([...new Uint8Array(stepAssetBytes(activeAfter.snapshot, 'cup-a'))]).toEqual([1, 2, 3, 4])
  })
})

describe('ProjectRevisionRepository authenticated hydration adoption', () => {
  it('hydrates, adopts, isolates public clones, and retains sources for a zero-write metadata commit', async () => {
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const staged = await stageProjectSourcesV3(
      await repositoryProjectFixture({
        name: 'Hydrated source owners',
        objectStepAssets: [
          { id: 'cup-a', bytes: [9, 8, 7, 6] },
          { id: 'cup-b', bytes: [9, 8, 7, 6] },
        ],
      }),
      sourceStaging,
      createProjectRevisionIdentityHasher(hashService),
    )
    const initial = await repository.prepareRevision(repository.createCandidate({
      projection: staged.projection,
      preparedSourceGroups: staged.preparedSourceGroups,
    }))
    await repository.commitPreparedRevision(null, initial, 'hydrate-initial')
    await repository.finalizePublication('hydrate-initial')
    await repository.activatePreparedSources(initial, 'hydrate-initial')

    const reopenedDatabase = new ProjectDatabase(databaseName)
    const sourceSha256 = vi.fn(hashService.sha256.bind(hashService))
    const reopenedOptions = {
      database: reopenedDatabase,
      revisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
      sourceHashService: { sha256: sourceSha256 },
      sourceStagingOptions: {
        sourceDigest: { digestSource: hashService.sha256.bind(hashService) },
      },
    }
    const reopenedFoundation = createProjectRevisionFoundation(reopenedOptions)
    const reopened = reopenedFoundation.repository as ConnectedRepositoryTestApi
    try {
      const hydrated = await reopened.readRevision(initial.storedRevision.revisionId)
      expect(hydrated).not.toBeNull()
      expect(sourceSha256).toHaveBeenCalledTimes(2)

      const firstPublic = materializeHydratedProjectSnapshotV1(hydrated!)
      const secondPublic = materializeHydratedProjectSnapshotV1(hydrated!)
      expect(stepAssetBytes(firstPublic, 'cup-a')).toBe(stepAssetBytes(firstPublic, 'cup-b'))
      expect(stepAssetBytes(secondPublic, 'cup-a')).toBe(stepAssetBytes(secondPublic, 'cup-b'))
      expect(stepAssetBytes(firstPublic, 'cup-a')).not.toBe(stepAssetBytes(secondPublic, 'cup-a'))
      new Uint8Array(stepAssetBytes(firstPublic, 'cup-a'))[0] = 255
      expect([...new Uint8Array(stepAssetBytes(secondPublic, 'cup-a'))]).toEqual([9, 8, 7, 6])

      await expect(reopened.adoptHydratedRevision(
        Object.freeze({}) as HydratedProjectRevisionV1,
      )).rejects.toMatchObject({ code: 'PROJECT_REVISION_HYDRATION_CAPABILITY_INVALID' })
      const active = await reopened.adoptHydratedRevision(hydrated!)
      expect(active).toMatchObject({
        revisionId: initial.storedRevision.revisionId,
        commitToken: 'hydrate-initial',
      })
      expect(active.sourceHandles.map(({ ownerKey }) => ownerKey).sort()).toEqual([
        'object-asset:cup-a',
        'object-asset:cup-b',
        expect.stringMatching(/^robot-source:/),
      ])
      expect(stepAssetBytes(active.snapshot, 'cup-a')).toBe(stepAssetBytes(active.snapshot, 'cup-b'))
      await expect(reopened.adoptHydratedRevision(hydrated!)).rejects.toMatchObject({
        code: 'PROJECT_REVISION_HYDRATION_CAPABILITY_CONSUMED',
      })

      sourceSha256.mockClear()
      const blobPut = vi.spyOn(reopenedDatabase.projectSourceBlobs, 'put')
      const metadataProjection = structuredClone(initial.storedRevision.snapshot)
      ;(metadataProjection.manifest as { name: string; updatedAt: string }).name = 'Metadata only'
      ;(metadataProjection.manifest as { name: string; updatedAt: string }).updatedAt =
        '2026-07-16T00:00:00.000Z'
      const metadata = await reopened.prepareRevision(reopened.createCandidate({
        projection: metadataProjection,
      }))
      await reopened.commitPreparedRevision(
        initial.storedRevision.revisionId,
        metadata,
        'hydrate-metadata',
      )
      await reopened.finalizePublication('hydrate-metadata')
      await reopened.activatePreparedSources(metadata, 'hydrate-metadata')

      expect(sourceSha256).not.toHaveBeenCalled()
      expect(blobPut).not.toHaveBeenCalled()
      expect(await reopenedDatabase.projectSourceBlobs.count()).toBe(2)
    } finally {
      reopenedDatabase.close()
    }
  })

  it('charges quota only for missing or unverified unique Blob keys', async () => {
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const staged = await stageProjectSourcesV3(
      await repositoryProjectFixture({
        name: 'Quota source owner',
        objectStepAssets: [{ id: 'cup-a', bytes: [9, 8, 7, 6] }],
      }),
      sourceStaging,
      createProjectRevisionIdentityHasher(hashService),
    )
    const initial = await repository.prepareRevision(repository.createCandidate({
      projection: staged.projection,
      preparedSourceGroups: staged.preparedSourceGroups,
    }))
    await repository.commitPreparedRevision(null, initial, 'quota-initial')
    await repository.finalizePublication('quota-initial')
    await repository.activatePreparedSources(initial, 'quota-initial')

    const reopenedDatabase = new ProjectDatabase(databaseName)
    const estimate = vi.fn(async () => ({
      usage: 0,
      quota: PROJECT_REVISION_COMMIT_OVERHEAD_BYTES_V1,
    }))
    const reopenedOptions = {
      database: reopenedDatabase,
      revisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
      sourceHashService: hashService,
      sourceStagingOptions: {
        sourceDigest: { digestSource: hashService.sha256.bind(hashService) },
      },
      storageEstimate: estimate,
    }
    const reopenedFoundation = createProjectRevisionFoundation(reopenedOptions)
    const reopened = reopenedFoundation.repository as ConnectedRepositoryTestApi
    try {
      const hydrated = await reopened.readRevision(initial.storedRevision.revisionId)
      const active = await reopened.adoptHydratedRevision(hydrated!)
      const newOwnerSource = await reopenedFoundation.sourceStaging.stage(
        'object',
        stepAssetBytes(active.snapshot, 'cup-a'),
      )
      const nextProjection = structuredClone(initial.storedRevision.snapshot)
      const projectionRecord = nextProjection as unknown as {
        objectAssets: Record<string, unknown>[]
      }
      const retainedAsset = projectionRecord.objectAssets[0]!
      projectionRecord.objectAssets.push({
        ...retainedAsset,
        id: 'cup-b',
        name: 'cup-b',
      })
      const next = await reopened.prepareRevision(reopened.createCandidate({
        projection: nextProjection,
        preparedSourceGroups: [{
          ownerKeys: ['object-asset:cup-b'],
          preparedSource: newOwnerSource,
        }],
      }))
      const blobPut = vi.spyOn(reopenedDatabase.projectSourceBlobs, 'put')

      await reopened.commitPreparedRevision(
        initial.storedRevision.revisionId,
        next,
        'quota-shared-owner',
      )
      await reopened.finalizePublication('quota-shared-owner')
      await reopened.activatePreparedSources(next, 'quota-shared-owner')

      expect(estimate).toHaveBeenCalledTimes(1)
      expect(blobPut).not.toHaveBeenCalled()
      expect(await reopenedDatabase.projectSourceBlobs.count()).toBe(2)
    } finally {
      reopenedDatabase.close()
    }
  })

  it('rejects hydration adoption when a second repository changes the exact stable tuple', async () => {
    const initial = await prepared('Hydration race A')
    await repository.commitPreparedRevision(null, initial, 'hydrate-race-a')
    await repository.finalizePublication('hydrate-race-a')
    await repository.activatePreparedSources(initial, 'hydrate-race-a')
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
    const databaseA = new ProjectDatabase(databaseName)
    const databaseB = new ProjectDatabase(databaseName)
    const connected = (target: ProjectDatabase): ConnectedRepositoryTestApi =>
      createProjectRevisionFoundation({
        database: target,
        revisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
        sourceHashService: hashService,
        sourceStagingOptions: {
          sourceDigest: { digestSource: hashService.sha256.bind(hashService) },
        },
      }).repository as ConnectedRepositoryTestApi
    const repositoryA = connected(databaseA)
    const repositoryB = connected(databaseB)
    try {
      const staleHydration = await repositoryA.readRevision(initial.storedRevision.revisionId)
      const winnerHydration = await repositoryB.readRevision(initial.storedRevision.revisionId)
      await repositoryB.adoptHydratedRevision(winnerHydration!)
      const nextProjection = structuredClone(initial.storedRevision.snapshot)
      ;(nextProjection.manifest as { name: string }).name = 'Hydration race B'
      const next = await repositoryB.prepareRevision(repositoryB.createCandidate({
        projection: nextProjection,
      }))
      await repositoryB.commitPreparedRevision(
        initial.storedRevision.revisionId,
        next,
        'hydrate-race-b',
      )
      await repositoryB.finalizePublication('hydrate-race-b')
      await repositoryB.activatePreparedSources(next, 'hydrate-race-b')

      await expect(repositoryA.adoptHydratedRevision(staleHydration!)).rejects.toMatchObject({
        code: 'PROJECT_REVISION_HYDRATION_STALE',
      })
    } finally {
      databaseA.close()
      databaseB.close()
    }
  })
})
