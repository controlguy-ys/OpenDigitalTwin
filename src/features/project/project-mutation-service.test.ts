import Dexie from 'dexie'
import { afterEach, expect, it, vi } from 'vitest'
import {
  stageProjectSourcesV3,
  type PreparedProjectSourceGroupV1,
  type WorkcellProjectSnapshotV3,
} from '../../domain/project/project-v3'
import {
  createProjectHashService,
  createProjectRevisionIdentityHasher,
  createProjectSourceDigest,
} from '../../lib/hash/sha256'
import { ProjectDatabase } from './project-db'
import {
  createProjectMutationService,
} from './project-mutation-service'
import {
  createProjectPublicationCoordinator,
  type AppliedProjectRuntimePublicationV1,
  type ProjectRuntimeV3,
} from './project-publication-coordinator'
import { createProjectRevisionFoundation } from './project-revision-repository'
import { repositoryProjectFixture } from './project-revision-repository.test-support'
import { createBrowserProjectRuntime } from './browser-project-runtime'
import { useCollisionStore } from '../collision/collision-store'
import { useRobotConfigurationStore } from '../robot/robot-configuration-store'

const databases: ProjectDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) {
    const name = database.name
    database.close()
    await Dexie.delete(name)
  }
})

function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

function publication(): AppliedProjectRuntimePublicationV1 {
  return { commit: vi.fn(), rollback: vi.fn(), cleanup: vi.fn() }
}

function earlyFailureMutationHarness(recoveryRequired: boolean) {
  const revoke = vi.fn()
  const createCandidate = vi.fn((candidate) => candidate)
  const replace = vi.fn(async () => undefined)
  const readPublished = vi.fn(() => null)
  const service = createProjectMutationService({
    repository: { createCandidate } as never,
    sourceStaging: { revoke } as never,
    coordinator: {
      replace,
      readPublished,
      isRecoveryRequired: () => recoveryRequired,
    } as never,
  })
  const preparedSource = Object.freeze({ kind: 'prepared-step-source' }) as never
  const preparedSources: readonly PreparedProjectSourceGroupV1[] = [{
    ownerKeys: ['object-asset:step-review'],
    preparedSource,
  }]
  return { service, revoke, createCandidate, replace, preparedSource, preparedSources }
}

it('revokes a prepared STEP source when recovery blocks the mutation before recipe execution', async () => {
  const harness = earlyFailureMutationHarness(true)

  await expect(harness.service.replaceFromActive(
    (current) => current,
    harness.preparedSources,
  )).rejects.toThrow('PROJECT_RECOVERY_REQUIRED')

  expect(harness.revoke).toHaveBeenCalledOnce()
  expect(harness.revoke).toHaveBeenCalledWith(harness.preparedSource)
  expect(harness.createCandidate).not.toHaveBeenCalled()
})

it('revokes a prepared STEP source when no active Project exists before recipe execution', async () => {
  const harness = earlyFailureMutationHarness(false)

  await expect(harness.service.replaceFromActive(
    (current) => current,
    harness.preparedSources,
  )).rejects.toThrow('PROJECT_ACTIVE_REVISION_MISSING')

  expect(harness.revoke).toHaveBeenCalledOnce()
  expect(harness.revoke).toHaveBeenCalledWith(harness.preparedSource)
  expect(harness.createCandidate).not.toHaveBeenCalled()
})

it('revokes a prepared STEP source when the coordinator has no published bundle', async () => {
  const harness = earlyFailureMutationHarness(false)
  await harness.service.replacePreparedUntrusted({
    projection: { manifest: { name: 'seed' } } as never,
    preparedSourceGroups: [],
    warnings: [],
  })
  harness.revoke.mockClear()

  await expect(harness.service.replaceFromActive(
    (current) => current,
    harness.preparedSources,
  )).rejects.toThrow('PROJECT_ACTIVE_REVISION_MISSING')

  expect(harness.replace).toHaveBeenCalledOnce()
  expect(harness.revoke).toHaveBeenCalledOnce()
  expect(harness.revoke).toHaveBeenCalledWith(harness.preparedSource)
})

it('revokes every prepared token when recovery blocks untrusted replacement', async () => {
  const harness = earlyFailureMutationHarness(true)
  const secondPreparedSource = Object.freeze({ kind: 'second-prepared-source' }) as never
  const preparedSourceGroups: readonly PreparedProjectSourceGroupV1[] = [
    ...harness.preparedSources,
    {
      ownerKeys: ['object-asset:second-step'],
      preparedSource: secondPreparedSource,
    },
  ]

  await expect(harness.service.replacePreparedUntrusted({
    projection: { manifest: { name: 'blocked replacement' } } as never,
    preparedSourceGroups,
    warnings: [],
  })).rejects.toThrow('PROJECT_RECOVERY_REQUIRED')

  expect(harness.revoke).toHaveBeenCalledTimes(2)
  expect(harness.revoke).toHaveBeenCalledWith(harness.preparedSource)
  expect(harness.revoke).toHaveBeenCalledWith(secondPreparedSource)
  expect(harness.createCandidate).not.toHaveBeenCalled()
  expect(harness.replace).not.toHaveBeenCalled()
})

it('publishes one validated V3 candidate before observers see it', async () => {
  const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
  const revisionIdentityHasher = createProjectRevisionIdentityHasher(hashService)
  const database = new ProjectDatabase(`mutation-service-${crypto.randomUUID()}`)
  databases.push(database)
  const foundation = createProjectRevisionFoundation({
    database,
    revisionIdentityHasher,
    sourceHashService: hashService,
    sourceStagingOptions: {
      sourceDigest: createProjectSourceDigest(hashService),
    },
  })
  const barrier = deferred()
  let prepareCount = 0
  const runtime: ProjectRuntimeV3<{ snapshot: WorkcellProjectSnapshotV3 }> = {
    prepare: vi.fn(async (snapshot) => {
      prepareCount += 1
      if (prepareCount === 2) await barrier.promise
      return { snapshot }
    }),
    apply: vi.fn(() => publication()),
    dispose: vi.fn(),
  }
  let commitIndex = 0
  const coordinator = createProjectPublicationCoordinator({
    repository: foundation.repository,
    runtime,
    createCommitToken: () => `commit-${++commitIndex}`,
  })
  const service = createProjectMutationService({
    repository: foundation.repository,
    sourceStaging: foundation.sourceStaging,
    coordinator,
  })
  const projectA = await repositoryProjectFixture({ name: 'Cell A' })
  const staged = await stageProjectSourcesV3(
    projectA,
    foundation.sourceStaging,
    revisionIdentityHasher,
  )
  await service.replacePreparedUntrusted({ ...staged, warnings: [] })

  const pending = service.replaceFromActive((current) => ({
    ...current,
    manifest: { ...current.manifest, name: 'Cell B' },
  }))

  expect(service.readPublished()?.snapshot.manifest.name).toBe('Cell A')
  barrier.release()
  await pending
  expect(service.readPublished()?.snapshot.manifest.name).toBe('Cell B')
  expect(runtime.apply).toHaveBeenCalledTimes(2)
  expect((await foundation.repository.readPointer())?.state).toBe('stable')
})

it('flushes feature subscribers only after the mutation service exposes the matching bundle', async () => {
  const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
  const revisionIdentityHasher = createProjectRevisionIdentityHasher(hashService)
  const database = new ProjectDatabase(`mutation-subscriber-${crypto.randomUUID()}`)
  databases.push(database)
  const foundation = createProjectRevisionFoundation({
    database,
    revisionIdentityHasher,
    sourceHashService: hashService,
    sourceStagingOptions: {
      sourceDigest: createProjectSourceDigest(hashService),
    },
  })
  const runtime = createBrowserProjectRuntime({
    prepareRobotAssets: async () => new Map(),
  })
  let commitIndex = 0
  const coordinator = createProjectPublicationCoordinator({
    repository: foundation.repository,
    runtime,
    createCommitToken: () => `subscriber-commit-${++commitIndex}`,
  })
  const service = createProjectMutationService({
    repository: foundation.repository,
    sourceStaging: foundation.sourceStaging,
    coordinator,
  })
  const projectA = await repositoryProjectFixture({ name: 'Cell A' })
  const staged = await stageProjectSourcesV3(
    projectA,
    foundation.sourceStaging,
    revisionIdentityHasher,
  )
  await service.replacePreparedUntrusted({ ...staged, warnings: [] })
  const observations: Array<{
    storeName: string
    storeWarningDistanceM: number
    publishedName: string | undefined
    publishedWarningDistanceM: number | undefined
  }> = []
  const observe = () => {
    const authoritative = service.readPublished()?.snapshot
    observations.push({
      storeName: useRobotConfigurationStore.getState().configuration.name,
      storeWarningDistanceM: useCollisionStore.getState().policy.warningDistanceM,
      publishedName: authoritative?.robot.name,
      publishedWarningDistanceM: authoritative?.collisionPolicy.warningDistanceM,
    })
  }
  const unsubscribes = [
    useRobotConfigurationStore.subscribe(observe),
    useCollisionStore.subscribe(observe),
  ]
  try {
    await service.replaceFromActive((current) => ({
      ...current,
      robot: { ...current.robot, name: 'Robot B' },
      collisionPolicy: {
        ...current.collisionPolicy,
        warningDistanceM: 0.2,
      },
    }))
  } finally {
    for (const unsubscribe of unsubscribes) unsubscribe()
  }

  expect(observations).toHaveLength(2)
  expect(observations.every((observation) =>
    observation.storeName === observation.publishedName &&
    observation.storeWarningDistanceM === observation.publishedWarningDistanceM,
  )).toBe(true)
})

it('freezes the active recipe projection and revokes prepared sources when the recipe rejects', async () => {
  const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
  const revisionIdentityHasher = createProjectRevisionIdentityHasher(hashService)
  const database = new ProjectDatabase(`mutation-recipe-failure-${crypto.randomUUID()}`)
  databases.push(database)
  const foundation = createProjectRevisionFoundation({
    database,
    revisionIdentityHasher,
    sourceHashService: hashService,
    sourceStagingOptions: {
      sourceDigest: createProjectSourceDigest(hashService),
    },
  })
  const runtime: ProjectRuntimeV3<{ snapshot: WorkcellProjectSnapshotV3 }> = {
    prepare: vi.fn(async (snapshot) => ({ snapshot })),
    apply: vi.fn(() => publication()),
    dispose: vi.fn(),
  }
  let commitIndex = 0
  const coordinator = createProjectPublicationCoordinator({
    repository: foundation.repository,
    runtime,
    createCommitToken: () => `commit-${++commitIndex}`,
  })
  const service = createProjectMutationService({
    repository: foundation.repository,
    sourceStaging: foundation.sourceStaging,
    coordinator,
  })
  const projectA = await repositoryProjectFixture({ name: 'Cell A' })
  const stagedProject = await stageProjectSourcesV3(
    projectA,
    foundation.sourceStaging,
    revisionIdentityHasher,
  )
  await service.replacePreparedUntrusted({ ...stagedProject, warnings: [] })
  const pendingSource = await foundation.sourceStaging.stage(
    'object',
    Uint8Array.of(9, 8, 7).buffer,
  )

  await expect(service.replaceFromActive((current) => {
    expect(Object.isFrozen(current)).toBe(true)
    expect(Object.isFrozen(current.manifest)).toBe(true)
    throw new Error('recipe rejected')
  }, [{
    ownerKeys: ['object-asset:new-object'],
    preparedSource: pendingSource,
  }])).rejects.toThrow('recipe rejected')

  expect(() => foundation.sourceStaging.assertPrepared(pendingSource)).toThrow(/revoked/i)
  expect(service.readPublished()?.snapshot.manifest.name).toBe('Cell A')
})

it('recovers a committed publishing revision after a simulated browser crash', async () => {
  const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
  const revisionIdentityHasher = createProjectRevisionIdentityHasher(hashService)
  const database = new ProjectDatabase(`mutation-recovery-${crypto.randomUUID()}`)
  databases.push(database)
  const originalFoundation = createProjectRevisionFoundation({
    database,
    revisionIdentityHasher,
    sourceHashService: hashService,
    sourceStagingOptions: {
      sourceDigest: createProjectSourceDigest(hashService),
    },
  })
  const project = await repositoryProjectFixture({ name: 'Recovered Cell' })
  const staged = await stageProjectSourcesV3(
    project,
    originalFoundation.sourceStaging,
    revisionIdentityHasher,
  )
  const candidate = originalFoundation.repository.createCandidate({
    projection: staged.projection,
    preparedSourceGroups: staged.preparedSourceGroups,
  })
  const prepared = await originalFoundation.repository.prepareRevision(candidate)
  await originalFoundation.repository.commitPreparedRevision(
    null,
    prepared,
    'interrupted-publication',
  )
  expect((await originalFoundation.repository.readPointer())?.state).toBe('publishing')

  const recoveredFoundation = createProjectRevisionFoundation({
    database,
    revisionIdentityHasher,
    sourceHashService: hashService,
    sourceStagingOptions: {
      sourceDigest: createProjectSourceDigest(hashService),
    },
  })
  const runtime: ProjectRuntimeV3<{ snapshot: WorkcellProjectSnapshotV3 }> = {
    prepare: vi.fn(async (snapshot) => ({ snapshot })),
    apply: vi.fn(() => publication()),
    dispose: vi.fn(),
  }
  const coordinator = createProjectPublicationCoordinator({
    repository: recoveredFoundation.repository,
    runtime,
    createCommitToken: () => 'unused-recovery-token',
  })
  const service = createProjectMutationService({
    repository: recoveredFoundation.repository,
    sourceStaging: recoveredFoundation.sourceStaging,
    coordinator,
  })

  await service.hydrate()

  expect(service.isRecoveryRequired()).toBe(false)
  expect(service.readPublished()?.snapshot.manifest.name).toBe('Recovered Cell')
  expect(runtime.apply).toHaveBeenCalledOnce()
  expect((await recoveredFoundation.repository.readPointer())?.state).toBe('stable')
})
