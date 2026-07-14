import { describe, expect, it, vi } from 'vitest'
import {
  preflightWorkcellProjectShapeV3,
  type ByteFreeWorkcellProjectProjectionV3,
  type WorkcellProjectSnapshotV3,
} from '../../domain/project/project-v3'
import {
  createProjectHashService,
  createProjectRevisionIdentityHasher,
  type ProjectHashService,
} from '../../lib/hash/sha256'
import type { ProjectSourceBlobV1, StoredProjectRevisionV1 } from './project-db'
import { createProjectRevisionIdentityBytesV1 } from './project-revision-canonical'
import type { CanonicalProjectRepositorySourceBindingInternalV1 } from './project-revision-repository'
import { repositoryProjectFixture } from './project-revision-repository.test-support'
import * as hydrationApi from './project-revision-hydration'
import {
  ProjectRevisionHydrationError,
  hydrateStoredProjectRevisionV1,
  materializeHydratedProjectSnapshotV1,
} from './project-revision-hydration'

const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
const revisionIdentityHasher = createProjectRevisionIdentityHasher(hashService)

interface HydrationFixture {
  readonly revision: StoredProjectRevisionV1
  blobs: ProjectSourceBlobV1[]
  readonly robotDigest: string
  readonly objectDigest: string
}

function arrayBuffer(value: unknown): ArrayBuffer {
  expect(Object.prototype.toString.call(value)).toBe('[object ArrayBuffer]')
  return value as ArrayBuffer
}

function stepAssetBytes(
  snapshot: WorkcellProjectSnapshotV3,
  assetId: string,
): ArrayBuffer {
  const asset = snapshot.objectAssets.find(({ id }) => id === assetId)
  expect(asset?.sourceKind).toBe('step')
  return (asset as Extract<
    WorkcellProjectSnapshotV3['objectAssets'][number],
    { readonly sourceKind: 'step' }
  >).sourceBytes
}

async function hydrationFixture(
  sameDigestAcrossNamespaces = false,
): Promise<HydrationFixture> {
  const robotBytes = [1, 2, 3, 4]
  const objectBytes = sameDigestAcrossNamespaces ? robotBytes : [9, 8, 7, 6]
  const snapshot = await repositoryProjectFixture({
    robotBytes,
    objectStepAssets: [
      { id: 'cup-a', bytes: objectBytes },
      { id: 'cup-b', bytes: objectBytes },
    ],
  })
  const projection = structuredClone(snapshot) as unknown as Record<string, unknown>
  const robot = projection.robot as Record<string, unknown>
  const robotSources = robot.sources as Record<string, unknown>[]
  const objectAssets = projection.objectAssets as Record<string, unknown>[]
  const blobsByKey = new Map<string, ProjectSourceBlobV1>()

  for (const source of robotSources) {
    const sourceBytes = arrayBuffer(source.sourceBytes)
    const sha256 = String(source.sha256)
    delete source.sourceBytes
    blobsByKey.set(`robot:${sha256}`, {
      key: `robot:${sha256}`,
      namespace: 'robot',
      sha256,
      sourceBytes,
      byteLength: sourceBytes.byteLength,
    })
  }
  for (const asset of objectAssets) {
    if (asset.sourceKind !== 'step') continue
    const sourceBytes = arrayBuffer(asset.sourceBytes)
    const sha256 = await hashService.sha256(sourceBytes)
    delete asset.sourceBytes
    asset.sourceSha256 = sha256
    blobsByKey.set(`object:${sha256}`, {
      key: `object:${sha256}`,
      namespace: 'object',
      sha256,
      sourceBytes,
      byteLength: sourceBytes.byteLength,
    })
  }

  const robotDigest = String(robotSources[0]?.sha256)
  const objectDigest = String(objectAssets[0]?.sourceSha256)
  const byteFreeProjection = projection as unknown as ByteFreeWorkcellProjectProjectionV3
  const revisionId = await revisionIdentityHasher.hashRevisionIdentity(
    createProjectRevisionIdentityBytesV1(snapshot.manifest.projectId, byteFreeProjection),
  )
  return {
    revision: {
      revisionId,
      projectId: snapshot.manifest.projectId,
      createdAt: '2026-07-15T00:00:00.000Z',
      snapshot: byteFreeProjection,
    },
    blobs: [...blobsByKey.values()],
    robotDigest,
    objectDigest,
  }
}

function trackedHasher(): {
  readonly service: ProjectHashService
  readonly sha256: ReturnType<typeof vi.fn<ProjectHashService['sha256']>>
} {
  const sha256 = vi.fn<ProjectHashService['sha256']>((bytes, signal) =>
    hashService.sha256(bytes, signal))
  return { service: { sha256 }, sha256 }
}

function expectHydrationCode(action: Promise<unknown>, code: string): Promise<void> {
  return expect(action).rejects.toMatchObject({ code } satisfies Partial<ProjectRevisionHydrationError>)
}

describe('project revision hydration', () => {
  it('hashes each namespace-local Blob once and reconstitutes one complete snapshot', async () => {
    const fixture = await hydrationFixture(true)
    const tracker = trackedHasher()

    const hydrated = await hydrateStoredProjectRevisionV1(
      fixture.revision,
      fixture.blobs,
      tracker.service,
      revisionIdentityHasher,
    )
    const snapshot = materializeHydratedProjectSnapshotV1(hydrated)

    expect(tracker.sha256).toHaveBeenCalledTimes(2)
    expect(Object.prototype.toString.call(snapshot.robot.sources[0]?.sourceBytes)).toBe(
      '[object ArrayBuffer]',
    )
    expect(stepAssetBytes(snapshot, 'cup-a')).toBe(stepAssetBytes(snapshot, 'cup-b'))
    expect(snapshot.robot.sources[0]?.sourceBytes).not.toBe(stepAssetBytes(snapshot, 'cup-a'))
    expect(new Uint8Array(stepAssetBytes(snapshot, 'cup-a'))).toEqual(
      new Uint8Array(snapshot.robot.sources[0]!.sourceBytes),
    )
    expect(() => preflightWorkcellProjectShapeV3(snapshot)).not.toThrow()
  })

  it('isolates canonical bytes from stored rows, mutations, and later public reads', async () => {
    const fixture = await hydrationFixture()
    const hydrated = await hydrateStoredProjectRevisionV1(
      fixture.revision,
      fixture.blobs,
      hashService,
      revisionIdentityHasher,
    )
    const first = materializeHydratedProjectSnapshotV1(hydrated)
    const firstCupBytes = stepAssetBytes(first, 'cup-a')
    new Uint8Array(firstCupBytes)[0] = 255
    new Uint8Array(fixture.blobs.find(({ namespace }) => namespace === 'object')!.sourceBytes)[1] = 254

    const second = materializeHydratedProjectSnapshotV1(hydrated)
    const secondCupBytes = stepAssetBytes(second, 'cup-a')

    expect(firstCupBytes).not.toBe(secondCupBytes)
    expect(secondCupBytes).toBe(stepAssetBytes(second, 'cup-b'))
    expect([...new Uint8Array(secondCupBytes)]).toEqual([9, 8, 7, 6])
    expect(first.robot.sources[0]!.sourceBytes).not.toBe(second.robot.sources[0]!.sourceBytes)
  })

  it.each([
    {
      name: 'missing Blob',
      code: 'PROJECT_REVISION_SOURCE_BLOB_MISSING',
      mutate: (fixture: HydrationFixture): void => {
        fixture.blobs = fixture.blobs.filter(({ namespace }) => namespace !== 'object')
      },
    },
    {
      name: 'cross-namespace Blob',
      code: 'PROJECT_REVISION_SOURCE_NAMESPACE_MISMATCH',
      mutate: (fixture: HydrationFixture): void => {
        const row = fixture.blobs.find(({ namespace }) => namespace === 'object')!
        Object.assign(row, { key: `robot:${row.sha256}`, namespace: 'robot' })
      },
    },
    {
      name: 'key mismatch',
      code: 'PROJECT_REVISION_SOURCE_BLOB_INVALID',
      mutate: (fixture: HydrationFixture): void => {
        const row = fixture.blobs.find(({ namespace }) => namespace === 'object')!
        Object.assign(row, { key: `object:${'b'.repeat(64)}` })
      },
    },
    {
      name: 'declared length mismatch',
      code: 'PROJECT_REVISION_SOURCE_LENGTH_MISMATCH',
      mutate: (fixture: HydrationFixture): void => {
        const row = fixture.blobs.find(({ namespace }) => namespace === 'object')!
        Object.assign(row, { byteLength: row.byteLength + 1 })
      },
    },
    {
      name: 'digest mismatch',
      code: 'PROJECT_REVISION_SOURCE_DIGEST_MISMATCH',
      mutate: (fixture: HydrationFixture): void => {
        const row = fixture.blobs.find(({ namespace }) => namespace === 'object')!
        const bytes = new Uint8Array(row.sourceBytes)
        bytes[0] = (bytes[0] ?? 0) ^ 0xff
      },
    },
  ])('rejects a $name before exposing a hydrated capability', async ({ code, mutate }) => {
    const fixture = await hydrationFixture()
    mutate(fixture)

    await expectHydrationCode(
      hydrateStoredProjectRevisionV1(
        fixture.revision,
        fixture.blobs,
        hashService,
        revisionIdentityHasher,
      ),
      code,
    )
  })

  it('rejects accessors and unknown fields in untrusted revision and Blob rows', async () => {
    const fixture = await hydrationFixture()
    const rowWithAccessor = Object.create(Object.prototype, {
      ...Object.getOwnPropertyDescriptors(fixture.blobs[0]!),
      byteLength: { enumerable: true, configurable: true, get: () => 4 },
    }) as ProjectSourceBlobV1

    await expectHydrationCode(
      hydrateStoredProjectRevisionV1(
        fixture.revision,
        [rowWithAccessor, ...fixture.blobs.slice(1)],
        hashService,
        revisionIdentityHasher,
      ),
      'PROJECT_REVISION_SOURCE_BLOB_INVALID',
    )

    await expectHydrationCode(
      hydrateStoredProjectRevisionV1(
        { ...fixture.revision, unexpected: true },
        fixture.blobs,
        hashService,
        revisionIdentityHasher,
      ),
      'PROJECT_STORED_REVISION_INVALID',
    )
  })

  it('rejects a revision row whose canonical identity does not match revisionId', async () => {
    const fixture = await hydrationFixture()

    await expectHydrationCode(
      hydrateStoredProjectRevisionV1(
        { ...fixture.revision, revisionId: 'b'.repeat(64) },
        fixture.blobs,
        hashService,
        revisionIdentityHasher,
      ),
      'PROJECT_REVISION_IDENTITY_MISMATCH',
    )
  })

  it('does not mint a hydration capability when abort arrives during the final digest', async () => {
    const fixture = await hydrationFixture(true)
    const controller = new AbortController()
    let calls = 0
    const abortingHasher: ProjectHashService = {
      async sha256(bytes) {
        const digest = await hashService.sha256(bytes)
        calls += 1
        if (calls === 2) controller.abort()
        return digest
      },
    }

    await expectHydrationCode(
      hydrateStoredProjectRevisionV1(
        fixture.revision,
        fixture.blobs,
        abortingHasher,
        revisionIdentityHasher,
        controller.signal,
      ),
      'PROJECT_REVISION_HYDRATION_ABORTED',
    )
    expect(calls).toBe(2)
  })

  it('rejects a forged hydration facade', async () => {
    const fixture = await hydrationFixture()
    const hydrated = await hydrateStoredProjectRevisionV1(
      fixture.revision,
      fixture.blobs,
      hashService,
      revisionIdentityHasher,
    )

    expect(() => materializeHydratedProjectSnapshotV1({ ...hydrated })).toThrowError(
      expect.objectContaining({ code: 'PROJECT_REVISION_HYDRATION_CAPABILITY_INVALID' }),
    )
  })

  it('authenticates a repository binding before consuming canonical hydration state', async () => {
    const fixture = await hydrationFixture()
    const hydrated = await hydrateStoredProjectRevisionV1(
      fixture.revision,
      fixture.blobs,
      hashService,
      revisionIdentityHasher,
    )
    const consume = Reflect.get(
      hydrationApi,
      'consumeHydratedProjectRevisionForRepositoryInternalV1',
    ) as unknown

    expect(typeof consume).toBe('function')
    expect(() => (consume as (
      binding: CanonicalProjectRepositorySourceBindingInternalV1,
      capability: typeof hydrated,
      expectedRevisionId: string,
    ) => unknown)(
      {} as CanonicalProjectRepositorySourceBindingInternalV1,
      hydrated,
      fixture.revision.revisionId,
    )).toThrowError(expect.objectContaining({
      code: 'PROJECT_SOURCE_REPOSITORY_BINDING_INVALID',
    }))
    expect(() => materializeHydratedProjectSnapshotV1(hydrated)).not.toThrow()
  })
})
