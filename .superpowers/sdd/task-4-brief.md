### Task 4: Store and Publish Crash-Consistent Project Revisions

**Files:**
- Modify: `src/features/project/project-db.ts`
- Create: `src/features/project/project-db.test.ts`
- Create: `src/features/project/project-revision-repository.ts`
- Create: `src/features/project/project-revision-repository.test.ts`

**Interfaces:**
- Consumes: structurally validated v3 candidates, Task 2 prepared-source registry plus `ProjectRevisionIdentityHasher`, and Task 3 archive projections for deterministic byte-aware revision identity.
- Produces: `ProjectRevisionCandidateFactory`, `ProjectMutationService`, namespace-local `ProjectSourceBlobV1`, opaque `VerifiedProjectSourceHandleV1`, byte-free `StoredWorkcellProjectSnapshotProjectionV3`, immutable `PreparedProjectRevisionRecordV1` and `StoredProjectRevisionV1`, side-effect-free `prepareRevision()`, atomic `commitPreparedRevision()`, publication finalization/compensation, `createProjectRevisionIdentityProjectionV3()`, and hydration plus mark/sweep.

- [ ] **Step 1: Write revision/pointer RED tests**

```ts
it('atomically writes Blobs/revision and flips a publishing pointer', async () => {
  const revision = await repository.prepareRevision(await preparedCandidate(snapshotA()))
  await repository.commitPreparedRevision(null, revision, 'commit-a')
  expect(await repository.readPointer()).toEqual({
    key: 'active', state: 'publishing', revisionId: revision.storedRevision.revisionId,
    previousRevisionId: null, commitToken: 'commit-a',
  })
  expect((await repository.readActive())?.snapshot).toEqual(snapshotA())
  await repository.finalizePublication('commit-a')
  expect((await repository.readPointer())?.state).toBe('stable')
})

it('rejects a stale pointer writer without replacing the winner', async () => {
  const a = await repository.prepareRevision(await preparedCandidate(snapshotA()))
  const b = await repository.prepareRevision(await preparedCandidate(snapshotB()))
  await repository.commitPreparedRevision(null, a, 'commit-a')
  await repository.finalizePublication('commit-a')
  await expect(repository.commitPreparedRevision(null, b, 'commit-b')).rejects.toMatchObject({
    code: 'PROJECT_ACTIVE_REVISION_CHANGED',
  })
  expect((await repository.readActive())?.revisionId).toBe(a.storedRevision.revisionId)
  expect(await repository.readStoredRevisionProjection(b.storedRevision.revisionId)).toBeNull()
})

it('includes exact STEP source content in revision identity without serializing ArrayBuffer', async () => {
  const a = await repository.prepareRevision(await preparedCandidate(snapshotWithStepObjectBytes([1, 2, 3])))
  const different = await repository.prepareRevision(await preparedCandidate(snapshotWithStepObjectBytes([1, 2, 4])))
  const byteIdenticalCopy = await repository.prepareRevision(await preparedCandidate(snapshotWithStepObjectBytes([1, 2, 3])))
  expect(different.storedRevision.revisionId).not.toBe(a.storedRevision.revisionId)
  expect(byteIdenticalCopy.storedRevision.revisionId).toBe(a.storedRevision.revisionId)
})

it('stores source bytes once and writes no bytes or hashes for 100 metadata revisions', async () => {
  const first = await repository.prepareRevision(await preparedCandidate(maximumProjectBytes()))
  await repository.commitPreparedRevision(null, first, 'initial')
  await repository.finalizePublication('initial')
  const blobBytes = await repository.totalSourceBlobBytes()
  const publicClone = (await projectStore.readPublicSnapshot())!
  sourceDigestSpy.mockClear()
  revisionIdentityHashSpy.mockClear()
  blobPutSpy.mockClear()
  sourceCopySpy.mockClear()
  parserSpy.mockClear()
  geometryBuildSpy.mockClear()
  for (let index = 0; index < 100; index += 1) {
    await mutationService.replaceFromActive((current) => ({
      ...current,
      manifest: { ...current.manifest, name: `${publicClone.manifest.name} ${index}` },
    }))
  }
  expect(sourceDigestSpy).not.toHaveBeenCalled()
  expect(sourceCopySpy).not.toHaveBeenCalled()
  expect(parserSpy).not.toHaveBeenCalled()
  expect(geometryBuildSpy).not.toHaveBeenCalled()
  expect(revisionIdentityHashSpy).toHaveBeenCalledTimes(100)
  expect(blobPutSpy).not.toHaveBeenCalled()
  expect(await repository.totalSourceBlobBytes()).toBe(blobBytes)
  expect(await repository.revisionCount()).toBe(1)
})

it('keeps Robot and Object content addressing namespace-local', async () => {
  const prepared = await repository.prepareRevision(candidateUsingSameBytesAsRobotAndObject())
  expect(prepared.requiredBlobs.map((blob) => blob.key).sort()).toEqual([
    `object:${SAME_SHA256}`,
    `robot:${SAME_SHA256}`,
  ])
})

it('commits two Object owners from one prepared archive Blob', async () => {
  const decoded = await decodeWorkcellProject(archiveWithTwoAssetsSharingOneBlob(), {
    sourceDigestSpy,
  })
  const objectGroup = decoded.preparedSourceGroups.find(
    (group) => group.preparedSource.namespace === 'object',
  )!
  expect(objectGroup.ownerKeys).toEqual(['object-asset:asset-a', 'object-asset:asset-b'])
  await mutationService.replacePreparedUntrusted(decoded)
  expect(sourceDigestSpy).toHaveBeenCalledTimes(UNIQUE_ARCHIVE_SOURCE_COUNT)
  expect(blobPutSpy).toHaveBeenCalledTimes(UNIQUE_ARCHIVE_SOURCE_COUNT)
  expect(sourceHandleRegistry.ownersFor(`object:${objectGroup.preparedSource.sha256}`)).toEqual([
    'object-asset:asset-a', 'object-asset:asset-b',
  ])
  await mutationService.replaceFromActive(deleteAssetRecipe('asset-a'))
  expect(await repository.hasBlob(`object:${objectGroup.preparedSource.sha256}`)).toBe(true)
  await mutationService.replaceFromActive(deleteAssetRecipe('asset-b'))
  await repository.garbageCollect()
  expect(await repository.hasBlob(`object:${objectGroup.preparedSource.sha256}`)).toBe(false)
})

it('retains one canonical resident buffer and one parse for many same-digest owners', async () => {
  for (const ownerKey of manyDistinctObjectOwners(256)) {
    const token = await staging.stage('object', copyOfSameSmallFixture())
    await mutationService.replaceFromActive(addOwnerRecipe(ownerKey, token.sha256), [
      { ownerKeys: [ownerKey], preparedSource: token },
    ])
  }
  const key = `object:${SAME_SHA256}`
  expect(sourceDigestSpy).toHaveBeenCalledTimes(256) // one per independent raw ingress
  expect(await repository.blobCountFor(key)).toBe(1)
  expect(new Set(sourceHandleRegistry.internalBuffersFor(key))).toHaveLength(1)
  expect(parserSpy).toHaveBeenCalledTimes(1)
  expect(geometryBuildSpy).toHaveBeenCalledTimes(1)
})

it('clones a shared Blob once per public snapshot without aliasing stored bytes', async () => {
  await seedTwoSemanticAssetsSharingOneBlob()
  const first = (await repository.readActive())!.snapshot
  const firstA = stepBytes(first, 'asset-a')
  const firstB = stepBytes(first, 'asset-b')
  expect(firstA).toBe(firstB)
  new Uint8Array(firstA)[0] = 255
  const second = (await repository.readActive())!.snapshot
  expect(stepBytes(second, 'asset-a')).toBe(stepBytes(second, 'asset-b'))
  expect(stepBytes(second, 'asset-a')).not.toBe(firstA)
  expect(new Uint8Array(stepBytes(second, 'asset-a'))[0]).toBe(ORIGINAL_FIRST_BYTE)
})

it('changes revision identity for changed Robot bytes with matching updated declarations', async () => {
  const bytesA = Uint8Array.from([10, 20, 30]).buffer
  const bytesB = Uint8Array.from([10, 20, 31]).buffer
  const digestA = await hashService().sha256(bytesA)
  const digestB = await hashService().sha256(bytesB)
  const a = await repository.prepareRevision(await preparedCandidate(snapshotWithRobotSource({
    id: digestA, sha256: digestA, sourceBytes: bytesA,
  })))
  const b = await repository.prepareRevision(await preparedCandidate(snapshotWithRobotSource({
    id: digestB, sha256: digestB, sourceBytes: bytesB,
  })))
  expect(b.storedRevision.revisionId).not.toBe(a.storedRevision.revisionId)
})

it('isolates stored source buffers from caller and public-read mutations', async () => {
  const source = snapshotWithStepObjectBytes([1, 2, 3])
  const revision = await repository.prepareRevision(await preparedCandidate(source))
  await repository.commitPreparedRevision(null, revision, 'isolation')
  await repository.finalizePublication('isolation')
  const sourceAsset = source.objectAssets[0]!
  if (sourceAsset.sourceKind !== 'step') throw new Error('Expected STEP fixture.')
  new Uint8Array(sourceAsset.sourceBytes)[0] = 9
  const firstRead = (await repository.readActive())!
  const firstAsset = firstRead.snapshot.objectAssets[0]!
  if (firstAsset.sourceKind !== 'step') throw new Error('Expected STEP fixture.')
  expect(new Uint8Array(firstAsset.sourceBytes)[0]).toBe(1)
  new Uint8Array(firstAsset.sourceBytes)[0] = 8
  const secondRead = (await repository.readActive())!
  const secondAsset = secondRead.snapshot.objectAssets[0]!
  if (secondAsset.sourceKind !== 'step') throw new Error('Expected STEP fixture.')
  expect(new Uint8Array(secondAsset.sourceBytes)[0]).toBe(1)
  expect(secondRead.revisionId).toBe(revision.storedRevision.revisionId)
})

it('owns, hashes once, and carries a staged source through commit', async () => {
  const hash = deferredHasher()
  const source = snapshotWithStepObjectBytes([1, 2, 3])
  sourceCopySpy.mockClear()
  const staging = sourceStagingService({ hash: hash.fn, sourceDigestSpy, sourceCopySpy })
  const pending = staging.stage('object', source.objectAssets[0]!.sourceBytes)
  const sourceAsset = source.objectAssets[0]!
  if (sourceAsset.sourceKind !== 'step') throw new Error('Expected STEP fixture.')
  new Uint8Array(sourceAsset.sourceBytes)[0] = 9
  hash.release()
  const sourceToken = await pending
  await mutationService.replaceFromActive(addStepAssetRecipe(sourceToken.sha256), [
    { ownerKeys: ['object-asset:asset-1'], preparedSource: sourceToken },
  ])
  const stored = await repository.readActive()
  const storedAsset = stored!.snapshot.objectAssets[0]!
  if (storedAsset.sourceKind !== 'step') throw new Error('Expected STEP fixture.')
  expect([...new Uint8Array(storedAsset.sourceBytes)]).toEqual([1, 2, 3])
  expect(sourceDigestSpy).toHaveBeenCalledTimes(1)
  expect(sourceCopySpy).toHaveBeenCalledTimes(1)
})

it('promotes staged tokens only after stable finalization', async () => {
  const token = await staging.stage('object', goodBytes())
  const pending = commitHarness({ pauseBeforeFinalize }).replaceFromActive(
    addStepAssetRecipe(token.sha256),
    [{ ownerKeys: ['object-asset:asset-1'], preparedSource: token }],
  )
  await pauseBeforeFinalize.reached()
  expect(sourceHandleRegistry.hasOwner('object-asset:asset-1')).toBe(false)
  expect(staging.isPrepared(token)).toBe(true)
  pauseBeforeFinalize.release()
  await pending
  expect(staging.isPrepared(token)).toBe(false)
  expect(sourceHandleRegistry.hasOwner('object-asset:asset-1')).toBe(true)
})

it('sweeps orphan revisions and source blobs after a crash or successful publication', async () => {
  await seedActiveRevisionAAndOrphanRevisionB()
  await repository.garbageCollect()
  expect(await repository.readRevision(REVISION_A)).not.toBeNull()
  expect(await repository.readStoredRevisionProjection(REVISION_B)).toBeNull()
  expect(await repository.sourceBlobKeys()).toEqual(sourceKeysReachableFrom(REVISION_A))
})

it('serializes cross-tab commit against pointer-derived mark and sweep', async () => {
  const gc = repositoryAWithHooks({ afterPointerRead: gcBarrier.pause }).garbageCollect()
  await gcBarrier.reached()
  const commitB = repositoryB.commitPreparedRevision(REVISION_A, PREPARED_B, 'commit-b')
  gcBarrier.release()
  await Promise.all([gc, commitB])
  expect(await repositoryB.readStoredRevisionProjection(REVISION_B)).not.toBeNull()
  expect(await repositoryB.sourceBlobKeys()).toEqual(expect.arrayContaining(SOURCE_KEYS_B))
})

it('treats concurrent finalization of the same token and target as idempotent', async () => {
  await repositoryA.commitPreparedRevision(REVISION_A, PREPARED_B, 'commit-b')
  await Promise.all([
    repositoryA.finalizePublication('commit-b'),
    repositoryB.finalizePublication('commit-b'),
  ])
  expect(await repositoryA.readPointer()).toMatchObject({
    state: 'stable', revisionId: REVISION_B, commitToken: 'commit-b',
  })
  await expect(repositoryB.compensatePublication('commit-b')).rejects.toMatchObject({
    code: 'PROJECT_PUBLICATION_ALREADY_FINALIZED',
  })
})

it('repairs an unverified corrupt same-key Blob from newly staged owned bytes', async () => {
  await seedBlobRow({ key: `object:${GOOD_SHA}`, sha256: GOOD_SHA, sourceBytes: corruptBytes() })
  const prepared = await preparedCandidate(snapshotWithObjectSource(goodBytes()))
  await repository.commitPreparedRevision(null, prepared, 'repair')
  await repository.finalizePublication('repair')
  expect(await reopenRepository().then((next) => next.readActive())).toMatchObject({
    snapshot: expect.objectContaining(expectedGoodObjectSource()),
  })
})

it.each(['missing', 'corrupt'] as const)(
  'repairs a %s Blob for an equal immutable revision without rewriting that revision',
  async (fault) => {
    const original = await seedEqualRevisionWithBlobFault(fault)
    const prepared = await preparedCandidate(snapshotForEqualRevision())
    await repository.commitPreparedRevision(original.revisionId, prepared, 'equal-repair')
    await repository.finalizePublication('equal-repair')
    expect(await repository.readStoredRevisionProjection(original.revisionId)).toEqual(original.projection)
    expect((await repository.readRevisionRow(original.revisionId))!.createdAt).toBe(original.createdAt)
    expect(await reopenRepository().then((next) => next.readActive())).toMatchObject({
      revisionId: original.revisionId,
      snapshot: expect.objectContaining(expectedGoodSources()),
    })
  },
)

it('fails quota preflight and IndexedDB QuotaExceededError before active mutation', async () => {
  await expect(commitWithInsufficientEstimatedStorage()).rejects.toMatchObject({
    code: 'PROJECT_STORAGE_QUOTA_INSUFFICIENT',
  })
  await expect(commitWithQuotaExceededDuringBlobTransaction()).rejects.toMatchObject({
    code: 'PROJECT_STORAGE_QUOTA_INSUFFICIENT',
  })
  expect(await authoritativeIds()).toEqual(OLD_REVISION_IDS)
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/project/project-db.test.ts src/features/project/project-revision-repository.test.ts`

Expected: FAIL because the DB contains only one mutable `projects.active` row.

- [ ] **Step 3: Add the Dexie revision schema without deleting the legacy table**

```ts
export interface StoredProjectRevisionV1 {
  readonly revisionId: string
  readonly projectId: string
  readonly createdAt: string
  readonly snapshot: StoredWorkcellProjectSnapshotProjectionV3
}

export type ProjectSourceNamespaceV1 = 'robot' | 'object'
export type ProjectSourceBlobKeyV1 = `${ProjectSourceNamespaceV1}:${string}`

export interface ProjectSourceBlobV1 {
  readonly key: ProjectSourceBlobKeyV1
  readonly namespace: ProjectSourceNamespaceV1
  readonly sha256: string
  readonly sourceBytes: ArrayBuffer
  readonly byteLength: number
}

export type StoredWorkcellProjectSnapshotProjectionV3 = ByteFreeWorkcellProjectProjectionV3

export type ProjectSourceOwnerKeyV1 = `robot-source:${string}` | `object-asset:${string}`
declare const verifiedProjectSourceBrand: unique symbol
export interface VerifiedProjectSourceHandleV1 {
  readonly [verifiedProjectSourceBrand]: true
  readonly ownerKey: ProjectSourceOwnerKeyV1
  readonly blobKey: ProjectSourceBlobKeyV1
  readonly sha256: string
  readonly byteLength: number
}

export type ProjectCandidateSourceClaimV1 =
  | { readonly kind: 'verified-ref'; readonly handle: VerifiedProjectSourceHandleV1 }
  | {
      readonly kind: 'prepared-source'
      readonly ownerKeys: readonly ProjectSourceOwnerKeyV1[]
      readonly preparedSource: PreparedProjectSourceV1
    }

export interface ProjectRevisionCandidateV1 {
  readonly snapshot: WorkcellProjectSnapshotV3
  readonly sourceClaims: readonly ProjectCandidateSourceClaimV1[]
}

export interface ProjectRevisionCandidateFactory {
  fromActive(
    active: ActiveProjectRevisionContextV1,
    nextProjection: StoredWorkcellProjectSnapshotProjectionV3,
    sourceChanges: readonly PreparedProjectSourceGroupV1[],
  ): ProjectRevisionCandidateV1
  fromPreparedUntrusted(
    projection: ByteFreeWorkcellProjectProjectionV3,
    sourceChanges: readonly PreparedProjectSourceGroupV1[],
  ): ProjectRevisionCandidateV1
}

export type ActiveProjectMutationRecipeV1 = (
  current: StoredWorkcellProjectSnapshotProjectionV3,
) => StoredWorkcellProjectSnapshotProjectionV3

export interface ProjectMutationService {
  replaceFromActive(
    recipe: ActiveProjectMutationRecipeV1,
    sourceChanges?: readonly PreparedProjectSourceGroupV1[],
  ): Promise<void>
  replaceUntrusted(snapshot: WorkcellProjectSnapshotV3): Promise<void>
  replacePreparedUntrusted(result: ProjectDecodeResultV3 | ProjectMigrationResultV3): Promise<void>
}

export interface PreparedProjectRevisionRecordV1 {
  readonly runtimeSnapshot: WorkcellProjectSnapshotV3
  readonly storedRevision: StoredProjectRevisionV1
  readonly requiredBlobs: readonly ProjectSourceBlobV1[]
  readonly retainedSourceHandles: readonly VerifiedProjectSourceHandleV1[]
  readonly pendingSourceUpgrades: readonly PreparedProjectSourceGroupV1[]
}

export interface ProjectRevisionRepository {
  prepareRevision(candidate: ProjectRevisionCandidateV1): Promise<PreparedProjectRevisionRecordV1>
  commitPreparedRevision(
    expectedRevisionId: string | null,
    revision: PreparedProjectRevisionRecordV1,
    commitToken: string,
  ): Promise<void>
  finalizePublication(commitToken: string): Promise<void>
  compensatePublication(commitToken: string): Promise<void>
  readRevision(revisionId: string): Promise<HydratedProjectRevisionV1 | null>
  garbageCollect(): Promise<void>
}

export type StoredProjectPointerV1 =
  | {
      readonly key: 'active'
      readonly state: 'stable'
      readonly revisionId: string
      readonly commitToken: string
    }
  | {
      readonly key: 'active'
      readonly state: 'publishing'
      readonly revisionId: string
      readonly previousRevisionId: string | null
      readonly previousCommitToken: string | null
      readonly commitToken: string
    }

```

Add `projectRevisions` keyed by `revisionId` and indexed by `projectId`, `projectSourceBlobs` keyed by `key`, and `projectPointers` keyed by `key`. Retain the existing `projects` table only until Task 5 removes the current browser-store authority; Task 4 does not read, migrate, normalize, or delete its rows. A revision row intentionally has no mutable parent pointer and contains no source `ArrayBuffer`: Robot source projections omit `sourceBytes` while retaining `id === sha256`; STEP Object projections replace `sourceBytes` with `sourceSha256`; primitive branches are unchanged. Raw Mechanics Manifest bytes are not stored. Content addressing is deliberately namespace-local, so equal bytes create one `robot:<sha256>` Blob and one `object:<sha256>` Blob when used in both roles, but only one Blob within either namespace.

Every pointer in this schema has a required commit token. Tokenless or unknown
pointer shapes fail closed; no legacy pointer normalization API is exposed.

`PreparedProjectRevisionRecordV1` is a frozen repository-bound WeakMap capability, not a serializable command record. Copied, forged, foreign-repository, revoked, or replayed facades fail before DB access. Any public summaries on the facade are informational only; commit, activation, and rollback use the repository-owned private state. New staged groups are captured as a closed data-only graph, attested once, and atomically moved through the exact canonical staging service's repository-only port (`active -> publication-leased -> consumed|revoked`). No public staging method, raw-buffer adopter, generic consume callback, or publication-lease type is exposed. Stable pointer finalization alone mints no verified handle: activation rechecks the exact stable revision and commit token inside the pointer/revision transaction and synchronously performs an all-or-none canonical resident/handle registry swap before the no-throw ownership commit.

`VerifiedProjectSourceHandleV1` is a non-serializable, unforgeable runtime token minted only after successful stable publication or hydrating and re-verifying a committed Blob. The repository registers it in a private WeakSet/WeakMap against owner, namespace, digest, byte length, and one canonical repository-owned resident buffer per namespace/digest Blob key. All handles for that key share the canonical buffer. Promoting a newly staged owner for an already verified digest discards the duplicate staged bytes and binds the owner to the canonical buffer; digest/config-derived parse and Geometry caches are shared too. A public hydration/read clones each unique Blob key at most once per returned snapshot, shares that caller-owned clone among same-key records in that snapshot, and never aliases the canonical buffer or a later read. `PreparedProjectSourceV1` has a separate private staging registry and is the only accepted new-source claim. `ActiveProjectRevisionContextV1` is internal to the Project store and never returned by a public selector. The public `replaceFromActive()` callback receives only a frozen byte-free projection, never handles or internal buffers. The service preserves verified sources by unchanged owner key and accepts added/replaced sources only as exact prepared-token groups. Every source owner appears in exactly one group; one token may cover multiple distinct owners only when they share its namespace/digest, such as two semantic Object Assets backed by one archive Blob. Reusing a token across groups, a missing/duplicate owner, or a stray/revoked/leased token fails before preparation. `replaceUntrusted()` stages every unique raw Blob once internally; migration/archive decode call `replacePreparedUntrusted()` with their existing groups. `ProjectRevisionCandidateFactory` is private infrastructure. Downstream WS2-WS5 consume `ProjectMutationService` and never construct claims/handles. `prepareRevision()` performs no source hashing: it validates registered handles/tokens, obtains the already owned staged bytes, retains existing handles separately, and records new groups only as `pendingSourceUpgrades`. After matching pointer finalization, the staging service consumes each pending token once and mints one active verified handle per owner against the shared committed Blob key; no handle exists for that source before then. Any validation/stale-commit/publication-compensation/cancel/discard path revokes pending tokens once. Finalization/activation failure enters recovery and reload hydration mints handles from committed Blobs. A metadata-only recipe therefore copies, hashes, and writes zero source bytes even when displayed values originated from a public cloned read.

Generate lowercase `revisionId` as SHA-256 of UTF-8 `projectId + "\n" + canonicalJson(storedProjection)`. The projection keeps every normalized configuration field, recursively sorts object keys and unordered collections, preserves Job/Pose domain order, and contains only verified digest references. Never call `JSON.stringify()` on an `ArrayBuffer`. `commitPreparedRevision(expected, prepared, token)` accepts only a prepared record and, in one Dexie transaction spanning Blobs, revisions, and pointers, verifies the expected stable pointer, inserts required Blobs plus the byte-free revision row, then writes a `publishing` pointer containing new/previous revision IDs and the unique token. An existing Blob is reused without a write only when its key is registered as digest-verified in this hydration session. Otherwise the transaction replaces that same-key row from the newly staged, verified owned bytes and exact namespace/digest/length; this repairs a corrupt stale row instead of publishing an unreopenable revision. It performs no source hashing or caller-buffer reads. Before that transaction, calculate the additional unique Blob bytes plus bounded revision overhead and use `navigator.storage.estimate()` when available; known insufficient headroom or an IndexedDB `QuotaExceededError` maps to `PROJECT_STORAGE_QUOTA_INSUFFICIENT` without changing the pointer/runtime. Estimate success is not treated as a guarantee. A second tab that observes `publishing` rejects mutation as `PROJECT_PUBLICATION_IN_PROGRESS`; no unpointed DB revision exists for concurrent GC to sweep.

`readRevision()` resolves every byte-free reference, rejects missing/cross-namespace/mismatched-length Blobs, recomputes each unique referenced Blob digest through `ProjectHashService` once per hydration, then returns an owned hydrated snapshot plus fresh verified handles. Internal hydration interns one canonical resident buffer per Blob key. Every public snapshot/archive read receives one clone per unique key, shared only within that returned snapshot, never the repository-owned buffer. Identical configuration plus byte-identical sources may reuse an immutable revision; changed bytes produce a different revision ID even when filenames and metadata are unchanged. When `commitPreparedRevision()` finds an existing `revisionId`, it treats the revision row as idempotent only if `projectId` and the complete byte-free projection are exactly equal, retains its original `createdAt`, and never rewrites that immutable row. Required Blob rows are still independently verified/reused or repaired from the current owned staged bytes under the preceding rule before the pointer may publish; a missing/corrupt Blob is not excused by an equal revision ID. Any revision identity collision/mismatch fails closed without `put`-overwriting the immutable row.

- [ ] **Step 4: Implement compare-and-swap and recovery transactions**

`finalizePublication(token)` atomically changes only the matching publishing pointer to stable and retains that token on the stable pointer. If another tab already finalized the same token/target, finalization is an idempotent success; a stable different token/target fails closed. `compensatePublication(token)` restores the exact retained `(previousRevisionId, previousCommitToken)` pair only while the matching pointer is still publishing; an initial publication deletes the pointer. It never rolls back an already stable target, and a late `finalizePublication(newToken)` after compensation fails closed instead of finalizing the restored previous revision. `garbageCollect()` opens one Dexie read-write transaction spanning pointer, revision, and Blob tables; inside that same transaction it rereads the pointer, derives the stable/publishing mark set, removes every other revision, then removes every Blob unreachable from the retained projections. This transaction boundary serializes against a second-tab `commitPreparedRevision()` so GC cannot mark A, interleave commit B, and sweep B. Run it after finalization and at startup. Cleanup-retry IDs for in-memory Three.js disposal do not pin DB revisions or Blobs. A cleanup failure never rolls back a commit: emit one bounded diagnostic and retry idempotently.

Legacy adoption, tokenless-pointer normalization, cleanup-eligibility capabilities, and deletion of existing feature-store rows are explicitly out of scope until the user requests them again. The new repository must ignore those rows and never treat them as a fallback authority.

- [ ] **Step 5: Run GREEN, reopen, and concurrency tests**

Run: `npm run test:run -- src/features/project/project-db.test.ts src/features/project/project-revision-repository.test.ts`

Expected: PASS for reopen persistence, byte-free immutable rows, namespace-local Blob de-duplication, stale-writer rejection, durable token replay rejection, startup orphan cleanup, exact quota mapping, newly verified Robot/Object byte identity, zero rehash/rewrite on metadata edits, bounded revision retention, tuple ownership, and input/public-read buffer isolation.

- [ ] **Step 6: Commit**

```powershell
git add src/features/project/project-db.ts src/features/project/project-db.test.ts src/features/project/project-revision-repository.ts src/features/project/project-revision-repository.test.ts
git diff --cached --check
git commit -m "feat: store immutable project revisions"
```

---

#### Part B: Publish One Prebuilt Runtime Bundle

**Files:**
- Create: `src/features/project/project-runtime-bundle.ts`
- Create: `src/features/project/project-commit-coordinator.ts`
- Create: `src/features/project/project-commit-coordinator.test.ts`
- Modify: `src/features/project/project-store.ts`
- Modify: `src/features/project/project-store.test.ts`
- Modify: `src/features/project/browser-project-runtime.ts`
- Modify: `src/features/project/browser-project-runtime.test.ts`

**Interfaces:**
- Consumes: the Task 4 Part A repository-prepared runtime snapshot, verified source handles/new-source digest results, and a browser runtime that can prepare all derived assets without mutating active state.
- Produces: `PreparedProjectCommit`, `ActiveProjectRuntimeBundle`, `ProjectCommitCoordinator`, a serialized mutation gate, bounded cleanup diagnostics/retry queue, and store status `recovery-required`.

- [ ] **Step 1: Write phase-fault RED tests**

```ts
it.each([
  'validate', 'verify-cryptographic-provenance', 'prepare-robot', 'prepare-object',
  'reconcile-mechanics-jobs', 'reconcile-cache', 'commit-prepared', 'publish-runtime',
])('keeps one complete revision when %s fails', async (phase) => {
  const harness = commitHarness({ failAt: phase })
  await expect(harness.replace(snapshotB())).rejects.toBeDefined()
  expect(await harness.authoritativeIds()).toEqual({
    pointer: 'revision-a', cache: 'revision-a', runtime: 'revision-a',
  })
  expect(harness.interactionEnabled()).toBe(true)
})

it('enters recovery-required when pointer compensation fails', async () => {
  const harness = commitHarness({ failAt: 'publish-runtime', failCompensation: true })
  await expect(harness.replace(snapshotB())).rejects.toBeDefined()
  expect(harness.status()).toBe('recovery-required')
  expect(harness.interactionEnabled()).toBe(false)
  expect(harness.reloadRequested()).toBe(true)
})

it('keeps the new publishing revision blocked for startup recovery when finalization fails', async () => {
  const harness = commitHarness({ failAt: 'finalize-publication' })
  await expect(harness.replace(snapshotB())).rejects.toBeDefined()
  expect(await harness.authoritativeIds()).toEqual({
    pointer: 'revision-b:publishing', cache: 'revision-b', runtime: 'revision-b',
  })
  expect(harness.status()).toBe('recovery-required')
  expect(harness.interactionEnabled()).toBe(false)
  expect(harness.reloadRequested()).toBe(true)
})

it.each(['after-commit-before-publish', 'after-publish-before-finalize', 'during-finalize'])(
  'resolves a crash at %s without leaving publishing stuck',
  async (crashPoint) => {
    const reopened = await reopenCommitHarness(crashPoint)
    expect(await reopened.resolvePublishingPointer()).toMatchObject({ state: 'stable' })
    expect(await reopened.authoritativeIds()).toEqual(ALL_NEW_REVISION_IDS)
  },
)

it('keeps the committed new revision when old-runtime disposal fails', async () => {
  const harness = commitHarness({ failAt: 'dispose-old' })
  await expect(harness.replace(snapshotB())).resolves.toBeUndefined()
  expect(await harness.authoritativeIds()).toEqual({
    pointer: 'revision-b', cache: 'revision-b', runtime: 'revision-b',
  })
  expect(harness.interactionEnabled()).toBe(true)
  expect(harness.cleanupDiagnostics()).toEqual([
    expect.objectContaining({ code: 'PROJECT_OLD_RUNTIME_DISPOSE_FAILED', revisionId: 'revision-a' }),
  ])
  expect(harness.pendingCleanupRevisionIds()).toEqual(['revision-a'])
})

it('keeps inactive Object Assets lazy and enforces actual visible preparation budgets', async () => {
  const inactive = projectWithInactiveObjectAssets(256)
  await runtime.prepare(inactive, 'revision-inactive')
  expect(objectParserSpy).not.toHaveBeenCalled()
  expect(objectGeometryBuildSpy).not.toHaveBeenCalled()

  await expect(runtime.prepare(projectWithActualVisibleRenderGroups(1024), 'revision-at-limit'))
    .resolves.toBeDefined()
  await expect(runtime.prepare(projectWithActualVisibleRenderGroups(1025), 'revision-over-limit'))
    .rejects.toMatchObject({ code: 'PROJECT_VISIBLE_RENDER_ITEMS_EXCEEDED' })
  await expect(runtime.prepare(projectWithActualVisibleTriangles(1_500_001), 'revision-over-triangles'))
    .rejects.toMatchObject({ code: 'PROJECT_VISIBLE_TRIANGLES_EXCEEDED' })
  expect(runtime.activeRevisionId()).toBe('revision-a')
})
```

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- src/features/project/project-commit-coordinator.test.ts src/features/project/project-store.test.ts src/features/project/browser-project-runtime.test.ts`

Expected: FAIL because the current store mutates runtime before writing one mutable DB row and uses best-effort reconstruction.

- [ ] **Step 3: Define preparation and publication as separate operations**

```ts
export interface PreparedProjectCommit<RuntimeBundle> {
  readonly revision: PreparedProjectRevisionRecordV1
  readonly runtimeBundle: RuntimeBundle
  readonly cacheRevisionId: string
}

export interface ProjectRuntimeV3<RuntimeBundle> {
  prepare(snapshot: WorkcellProjectSnapshotV3, revisionId: string): Promise<RuntimeBundle>
  publish(bundle: RuntimeBundle): void
  activeRevisionId(): string | null
  dispose(bundle: RuntimeBundle): void
}

export interface ProjectCommitCoordinator {
  replace(candidate: ProjectRevisionCandidateV1): Promise<void>
}
```

The coordinator first obtains `PreparedProjectRevisionRecordV1` from the side-effect-free repository `prepareRevision()`, then passes `runtimeSnapshot` and `storedRevision.revisionId` to `prepare()`. `prepareRevision()` performs no STEP source hashing: it validates prepared/verified token registrations and asynchronously verifies small canonical cryptographic claims such as Manual Mechanics provenance through `ProjectHashService`; ordinary metadata-only edits preserve verified internal handles and perform zero source copies/source-digest calls. `prepare()` reuses Geometry by source digest plus Geometry-affecting configuration, not by whole Project revision. It eagerly prepares the Robot and only Object Assets referenced by visible Instances; inactive/uninstantiated Assets remain byte-verified lazy records. Before publication it checks declared statistics and actual parser totals, 1,500,000 rendered triangles, and 1,024 actual Three.js Mesh/material render groups. It builds selector-ready records without mutating active stores or ProjectDB, and bundle associations carry the new revision. `publish()` replaces exactly one `ActiveProjectRuntimeBundle` pointer synchronously. Scene, collision, selection, and interaction adapters read the bundle revision and ignore callbacks captured from an older generation.

Any candidate that changes `robot.mechanics` must first call `reconcileSimulationForMechanicsChange()` and include the returned Simulation state in that same candidate. The coordinator never publishes a Robot revision whose Jobs were derived from older Mechanics, and no runtime subscriber repairs durations after commit.

- [ ] **Step 4: Implement the ordered commit and compensation protocol**

Acquire one Project mutation lock and disable interaction. In exact order: create the internal candidate while preserving verified handles; call side-effect-free `prepareRevision()` so structural validation plus registered handle/prepared-token validation precedes the first write and no source is rehashed; prepare the runtime bundle and derived caches keyed by source digest plus geometry-affecting configuration; reconcile/write those non-authoritative revision-tagged associations; allocate one commit token; call `commitPreparedRevision(expected, prepared, token)` so missing/repaired Blobs, byte-free revision, expected-pointer check, and the `publishing` pointer land atomically; synchronously publish the prepared runtime bundle; call `finalizePublication(token)` to make the pointer stable; consume each `pendingSourceUpgrade` exactly once, bind every owner to its canonical resident buffer, and mint/activate its verified handle; only then make observers eligible, release the lock, and notify them; dispose the old bundle; then mark/sweep unreferenced caches, revision rows, and namespace-local source Blobs. Preparation, pointer publication, runtime publication, and stable finalization alone mint no handle.

If validation, a stale commit, or runtime publication fails, revoke every pending source token; after a publishing-pointer failure call `compensatePublication(token)` and republish the retained old bundle before unlocking. If compensation fails, enter `recovery-required`. If finalization or in-memory token consumption/handle activation fails after the new runtime publishes, do not expose observers, editing, or playback and do not roll back only one surface: keep the new publishing/stable pointer, cache, and runtime together as applicable, retain the lock under `recovery-required`, revoke only still-staged tokens, and request reload. Startup seeing `state: 'publishing'` integrity-hydrates and prepares the new revision; if successful it publishes that revision, atomically finalizes the matching token, and mints/activates verified handles from hydrated Blobs. Compensation is allowed only while that pointer is still publishing. Startup seeing a stable revision with missing in-memory handles integrity-hydrates that same revision and mints/activates its handles; it never compensates a stable pointer. If publishing-state integrity/preparation fails and `previousRevisionId` exists, it atomically compensates and rebuilds the previous revision; if no previous revision exists, compensation fails, or stable-revision activation fails, it remains `recovery-required`. Crash tests cover after atomic commit/before publish, after publish/before finalize, during finalization, and after finalization/before handle activation, and no publishing pointer remains indefinitely.

The prior revision remains DB-retained only while the pointer is `publishing`. After stable finalization it is eligible for mark/sweep regardless of an old in-memory Three.js disposal retry. If old-bundle disposal fails, keep the committed new pointer/cache/runtime, resolve the commit successfully, emit `PROJECT_OLD_RUNTIME_DISPOSE_FAILED`, queue only the in-memory resource cleanup token, and still run DB revision/Blob GC independently. A DB cleanup failure emits its own bounded diagnostic and retry without rolling back the committed Workcell.

- [ ] **Step 5: Make late work inert**

Increment one Project generation on every New, Import, delete, and replacement request. Guard Worker completion, cache writes, Manual transform Apply, Robot import Apply, OPC UA frame reduction, Job mutation, collision validation completion, and disposal callbacks with that generation. A stale callback returns without DB, cache, store, selection, collision, or Three.js mutation.

- [ ] **Step 6: Run GREEN and fake-crash recovery tests**

Run: `npm run test:run -- src/features/project`

Expected: PASS for every phase fault, stale callback, compare-and-swap race, compensation, process-reopen recovery, and resource disposal assertion.

- [ ] **Step 7: Commit**

```powershell
git add src/features/project
git diff --cached --check
git commit -m "feat: publish crash-consistent project revisions"
```

---
