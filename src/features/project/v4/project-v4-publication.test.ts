import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  configRevisionForProjectV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { ProjectDatabaseV4 } from './project-v4-db.js'
import {
  createProjectPublicationCoordinatorV4,
  type AppliedProjectRuntimePublicationV4,
  type PreparedProjectRuntimeBundleV4,
  type ProjectPublicationCoordinatorV4,
  type ProjectPublicationV4Error,
  type ProjectRuntimeV4,
  type PublishedProjectBundleV4,
} from './project-v4-publication.js'
import {
  createProjectRepositoryV4,
  type ProjectRepositoryV4,
} from './project-v4-repository.js'

interface RuntimeResources {
  readonly label: string
}

interface RuntimeControls {
  readonly prepareErrors: Map<string, Error>
  readonly applyErrors: Map<string, Error>
  readonly commitErrors: Map<string, Error>
  readonly rollbackErrors: Map<string, Error>
  readonly cleanupErrors: Map<string, Error>
  readonly bundleOverrides: Map<
    string,
    (project: WorkcellProjectV4, revisionId: string) => PreparedProjectRuntimeBundleV4<RuntimeResources>
  >
  onCommit?: ((revisionId: string) => void) | undefined
}

interface RuntimeHarness {
  readonly runtime: ProjectRuntimeV4<RuntimeResources>
  readonly controls: RuntimeControls
  readonly events: string[]
  readonly applications: Map<string, AppliedProjectRuntimePublicationV4>
  currentRevisionId: string | null
}

const FIXED_NOW = '2026-07-16T01:02:03.004Z'
const openDatabases: ProjectDatabaseV4[] = []
const databaseNames = new Set<string>()
let sequence = 0
let database!: ProjectDatabaseV4
let repository!: ProjectRepositoryV4

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function project(revisionId: string, name = `Project ${revisionId}`): WorkcellProjectV4 {
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

function uniqueDatabaseName(prefix = 'project-v4-publication'): string {
  const name = `${prefix}-${++sequence}`
  databaseNames.add(name)
  return name
}

function createRuntimeHarness(): RuntimeHarness {
  const controls: RuntimeControls = {
    prepareErrors: new Map(),
    applyErrors: new Map(),
    commitErrors: new Map(),
    rollbackErrors: new Map(),
    cleanupErrors: new Map(),
    bundleOverrides: new Map(),
  }
  const events: string[] = []
  const applications = new Map<string, AppliedProjectRuntimePublicationV4>()
  const harness: RuntimeHarness = {
    controls,
    events,
    applications,
    currentRevisionId: null,
    runtime: undefined as never,
  }
  const runtime: ProjectRuntimeV4<RuntimeResources> = {
    prepare: vi.fn(async (candidate, revisionId) => {
      events.push(`prepare:${revisionId}`)
      const error = controls.prepareErrors.get(revisionId)
      if (error !== undefined) throw error
      return controls.bundleOverrides.get(revisionId)?.(candidate, revisionId) ?? {
        project: candidate,
        revisionId,
        resources: { label: `resources:${revisionId}` },
      }
    }),
    apply: vi.fn(async (bundle) => {
      events.push(`apply:${bundle.revisionId}`)
      const applyError = controls.applyErrors.get(bundle.revisionId)
      if (applyError !== undefined) throw applyError
      const previousRevisionId = harness.currentRevisionId
      const application: AppliedProjectRuntimePublicationV4 = {
        commit: vi.fn(() => {
          events.push(`commit:${bundle.revisionId}`)
          controls.onCommit?.(bundle.revisionId)
          const error = controls.commitErrors.get(bundle.revisionId)
          if (error !== undefined) throw error
          harness.currentRevisionId = bundle.revisionId
        }),
        rollback: vi.fn(() => {
          events.push(`rollback:${bundle.revisionId}`)
          harness.currentRevisionId = previousRevisionId
          const error = controls.rollbackErrors.get(bundle.revisionId)
          if (error !== undefined) throw error
        }),
        cleanup: vi.fn(() => {
          events.push(`cleanup:${bundle.revisionId}`)
          const error = controls.cleanupErrors.get(bundle.revisionId)
          if (error !== undefined) throw error
        }),
      }
      applications.set(bundle.revisionId, application)
      return application
    }),
    dispose: vi.fn((bundle) => {
      events.push(`dispose:${bundle.revisionId}`)
    }),
  }
  ;(harness as { runtime: ProjectRuntimeV4<RuntimeResources> }).runtime = runtime
  return harness
}

function wrapRepository(
  overrides: Partial<ProjectRepositoryV4> = {},
): ProjectRepositoryV4 {
  return { ...repository, ...overrides }
}

function coordinator(
  runtime: ProjectRuntimeV4<RuntimeResources>,
  tokens: readonly string[],
  targetRepository: ProjectRepositoryV4 = repository,
  onRecoveryRequired?: (error: unknown) => void,
): ProjectPublicationCoordinatorV4 {
  const remaining = [...tokens]
  return createProjectPublicationCoordinatorV4({
    repository: targetRepository,
    runtime,
    createCommitToken: () => {
      const token = remaining.shift()
      if (token === undefined) throw new Error('test commit token exhausted')
      return token
    },
    onRecoveryRequired,
  })
}

async function publishedBundle(candidate: WorkcellProjectV4): Promise<PublishedProjectBundleV4> {
  return {
    project: candidate,
    revisionId: candidate.revisionId,
    configRevision: await configRevisionForProjectV4(candidate),
  }
}

async function expectPublicationError(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    name: 'ProjectPublicationV4Error',
    code,
  } satisfies Partial<ProjectPublicationV4Error>)
}

beforeEach(() => {
  database = new ProjectDatabaseV4(uniqueDatabaseName())
  openDatabases.push(database)
  repository = createProjectRepositoryV4({ database, now: () => FIXED_NOW })
})

afterEach(async () => {
  for (const target of openDatabases.splice(0)) target.close()
  for (const name of databaseNames) await Dexie.delete(name)
  databaseNames.clear()
})

describe('Project V4 serialized publication', () => {
  it('publishes the exact revision/config bundle and exposes it before synchronous commit observers run', async () => {
    const harness = createRuntimeHarness()
    const garbageCollect = vi.fn(repository.garbageCollect)
    const target = wrapRepository({ garbageCollect })
    const publication = coordinator(harness.runtime, ['token-a'], target)
    let observedDuringCommit: string | null = null
    harness.controls.onCommit = () => {
      observedDuringCommit = publication.readPublished()?.revisionId ?? null
    }
    const candidate = project('revision-a')

    const result = await publication.replace({ candidate, expectedRevisionId: null })

    expect(result).toEqual(await publishedBundle(candidate))
    expect(result.revisionId).not.toBe(result.configRevision)
    expect(Object.isFrozen(result)).toBe(true)
    expect(publication.readPublished()).toEqual(result)
    expect(publication.readPublished()).not.toBe(result)
    expect(observedDuringCommit).toBe('revision-a')
    expect(harness.currentRevisionId).toBe('revision-a')
    expect(harness.applications.get('revision-a')?.commit).toHaveBeenCalledTimes(1)
    expect(harness.applications.get('revision-a')?.cleanup).toHaveBeenCalledTimes(1)
    expect(garbageCollect).toHaveBeenCalledTimes(1)
    expect(publication.isRecoveryRequired()).toBe(false)
    await expect(repository.readPointer()).resolves.toMatchObject({
      state: 'stable',
      revisionId: 'revision-a',
      commitToken: 'token-a',
    })
  })

  it('executes concurrent replacements strictly in invocation order', async () => {
    const harness = createRuntimeHarness()
    const publication = coordinator(harness.runtime, ['token-a', 'token-b'])
    const candidateA = project('revision-a')
    const candidateB = project('revision-b')

    const first = publication.replace({ candidate: candidateA, expectedRevisionId: null })
    const second = publication.replace({
      candidate: candidateB,
      expectedRevisionId: 'revision-a',
    })
    const results = await Promise.all([first, second])

    expect(results.map(({ revisionId }) => revisionId)).toEqual(['revision-a', 'revision-b'])
    expect(harness.events).toEqual([
      'prepare:revision-a',
      'apply:revision-a',
      'commit:revision-a',
      'cleanup:revision-a',
      'prepare:revision-b',
      'apply:revision-b',
      'commit:revision-b',
      'cleanup:revision-b',
    ])
    expect(publication.readPublished()?.revisionId).toBe('revision-b')
  })

  it('leaves storage and publication untouched when runtime preparation rejects', async () => {
    const harness = createRuntimeHarness()
    const error = new Error('prepare failed')
    harness.controls.prepareErrors.set('revision-a', error)
    const publication = coordinator(harness.runtime, ['token-a'])

    await expect(publication.replace({
      candidate: project('revision-a'),
      expectedRevisionId: null,
    })).rejects.toBe(error)

    await expect(Promise.all([
      database.projectRevisions.count(),
      database.projectPointers.count(),
      database.projectCommitTokens.count(),
    ])).resolves.toEqual([0, 0, 0])
    expect(harness.runtime.dispose).not.toHaveBeenCalled()
    expect(publication.readPublished()).toBeNull()
    expect(publication.isRecoveryRequired()).toBe(false)
  })

  it('disposes prepared runtime resources and retains A when repository CAS rejects B', async () => {
    const harness = createRuntimeHarness()
    const publication = coordinator(harness.runtime, ['token-a', 'token-b'])
    const candidateA = project('revision-a')
    await publication.replace({ candidate: candidateA, expectedRevisionId: null })

    await expect(publication.replace({
      candidate: project('revision-b'),
      expectedRevisionId: 'revision-stale',
    })).rejects.toMatchObject({ code: 'PROJECT_ACTIVE_REVISION_CHANGED' })

    expect(harness.events).toContain('dispose:revision-b')
    expect(harness.events).not.toContain('apply:revision-b')
    expect(publication.readPublished()?.revisionId).toBe('revision-a')
    expect(harness.currentRevisionId).toBe('revision-a')
    expect(publication.isRecoveryRequired()).toBe(false)
    await expect(repository.readActive()).resolves.toEqual(candidateA)
  })

  it('compensates an apply rejection and keeps the old durable/runtime publication editable', async () => {
    const harness = createRuntimeHarness()
    const publication = coordinator(harness.runtime, ['token-a', 'token-b'])
    const candidateA = project('revision-a')
    await publication.replace({ candidate: candidateA, expectedRevisionId: null })
    const error = new Error('apply failed')
    harness.controls.applyErrors.set('revision-b', error)

    await expect(publication.replace({
      candidate: project('revision-b'),
      expectedRevisionId: 'revision-a',
    })).rejects.toBe(error)

    await expect(repository.readPointer()).resolves.toEqual({
      key: 'active',
      state: 'stable',
      revisionId: 'revision-a',
      commitToken: 'token-a',
    })
    await expect(repository.readActive()).resolves.toEqual(candidateA)
    expect(harness.events).toContain('dispose:revision-b')
    expect(publication.readPublished()?.revisionId).toBe('revision-a')
    expect(harness.currentRevisionId).toBe('revision-a')
    expect(publication.isRecoveryRequired()).toBe(false)
  })

  it('enters recovery when apply rejection compensation fails and rejects every later edit/restore', async () => {
    const harness = createRuntimeHarness()
    let rejectCompensation = false
    const compensationError = new Error('compensation failed')
    const recoveryErrors: unknown[] = []
    const target = wrapRepository({
      compensatePublication: async (token) => {
        if (rejectCompensation) throw compensationError
        return repository.compensatePublication(token)
      },
    })
    const publication = coordinator(
      harness.runtime,
      ['token-a', 'token-b'],
      target,
      (error) => recoveryErrors.push(error),
    )
    await publication.replace({ candidate: project('revision-a'), expectedRevisionId: null })
    const applyError = new Error('apply failed')
    harness.controls.applyErrors.set('revision-b', applyError)
    rejectCompensation = true

    await expect(publication.replace({
      candidate: project('revision-b'),
      expectedRevisionId: 'revision-a',
    })).rejects.toBe(applyError)

    expect(publication.isRecoveryRequired()).toBe(true)
    expect(recoveryErrors).toEqual([compensationError])
    expect(harness.events).not.toContain('dispose:revision-b')
    await expect(repository.readPointer()).resolves.toMatchObject({
      state: 'publishing',
      revisionId: 'revision-b',
      commitToken: 'token-b',
    })
    await expectPublicationError(
      publication.replace({
        candidate: project('revision-c'),
        expectedRevisionId: 'revision-b',
      }),
      'PROJECT_RECOVERY_REQUIRED',
    )
    await expectPublicationError(
      publication.restorePublished(await publishedBundle(project('revision-a'))),
      'PROJECT_RECOVERY_REQUIRED',
    )
  })

  it('rolls back and enters recovery when durable finalization fails after runtime apply', async () => {
    const harness = createRuntimeHarness()
    let rejectFinalization = false
    const finalizationError = new Error('finalize failed')
    const target = wrapRepository({
      finalizePublication: async (token) => {
        if (rejectFinalization) throw finalizationError
        return repository.finalizePublication(token)
      },
    })
    const publication = coordinator(harness.runtime, ['token-a', 'token-b'], target)
    await publication.replace({ candidate: project('revision-a'), expectedRevisionId: null })
    rejectFinalization = true

    await expect(publication.replace({
      candidate: project('revision-b'),
      expectedRevisionId: 'revision-a',
    })).rejects.toBe(finalizationError)

    const application = harness.applications.get('revision-b')!
    expect(application.rollback).toHaveBeenCalledTimes(1)
    expect(application.commit).not.toHaveBeenCalled()
    expect(application.cleanup).not.toHaveBeenCalled()
    expect(publication.readPublished()?.revisionId).toBe('revision-a')
    expect(harness.currentRevisionId).toBe('revision-a')
    expect(publication.isRecoveryRequired()).toBe(true)
    await expect(repository.readPointer()).resolves.toMatchObject({
      state: 'publishing',
      revisionId: 'revision-b',
    })
  })

  it('restores the prior in-memory bundle but keeps durable B stable when runtime commit rejects', async () => {
    const harness = createRuntimeHarness()
    const publication = coordinator(harness.runtime, ['token-a', 'token-b'])
    await publication.replace({ candidate: project('revision-a'), expectedRevisionId: null })
    const commitError = new Error('commit failed')
    harness.controls.commitErrors.set('revision-b', commitError)

    await expect(publication.replace({
      candidate: project('revision-b'),
      expectedRevisionId: 'revision-a',
    })).rejects.toBe(commitError)

    const application = harness.applications.get('revision-b')!
    expect(application.rollback).toHaveBeenCalledTimes(1)
    expect(application.cleanup).not.toHaveBeenCalled()
    expect(publication.readPublished()?.revisionId).toBe('revision-a')
    expect(harness.currentRevisionId).toBe('revision-a')
    expect(publication.isRecoveryRequired()).toBe(true)
    await expect(repository.readPointer()).resolves.toMatchObject({
      state: 'stable',
      revisionId: 'revision-b',
      commitToken: 'token-b',
    })
  })

  it.each(['cleanup', 'garbage-collection'] as const)(
    'keeps a successful publication authoritative when %s fails',
    async (failure) => {
      const harness = createRuntimeHarness()
      const cleanupError = new Error('cleanup failed')
      const garbageCollectionError = new Error('garbage collection failed')
      if (failure === 'cleanup') harness.controls.cleanupErrors.set('revision-a', cleanupError)
      const target = failure === 'garbage-collection'
        ? wrapRepository({ garbageCollect: async () => { throw garbageCollectionError } })
        : repository
      const publication = coordinator(harness.runtime, ['token-a'], target)

      const result = await publication.replace({
        candidate: project('revision-a'),
        expectedRevisionId: null,
      })

      expect(result.revisionId).toBe('revision-a')
      expect(publication.readPublished()?.revisionId).toBe('revision-a')
      expect(harness.currentRevisionId).toBe('revision-a')
      expect(publication.isRecoveryRequired()).toBe(false)
      await expect(repository.readPointer()).resolves.toMatchObject({
        state: 'stable',
        revisionId: 'revision-a',
      })
    },
  )

  it.each(['revision', 'project'] as const)(
    'rejects a runtime adapter with a mismatched prepared %s before pointer write',
    async (mismatch) => {
      const harness = createRuntimeHarness()
      harness.controls.bundleOverrides.set('revision-a', (candidate, revisionId) => ({
        project: mismatch === 'project' ? project('revision-a', 'Wrong project') : candidate,
        revisionId: mismatch === 'revision' ? 'revision-wrong' : revisionId,
        resources: { label: 'mismatched' },
      }))
      const publication = coordinator(harness.runtime, ['token-a'])

      await expectPublicationError(
        publication.replace({ candidate: project('revision-a'), expectedRevisionId: null }),
        'PROJECT_RUNTIME_PREPARED_BUNDLE_INVALID',
      )

      expect(harness.events).toContain(
        mismatch === 'revision' ? 'dispose:revision-wrong' : 'dispose:revision-a',
      )
      await expect(Promise.all([
        database.projectRevisions.count(),
        database.projectPointers.count(),
        database.projectCommitTokens.count(),
      ])).resolves.toEqual([0, 0, 0])
      expect(publication.isRecoveryRequired()).toBe(false)
    },
  )
})

describe('Project V4 runtime restore and crash primitives', () => {
  it('restores runtime publication without any repository mutation', async () => {
    const harness = createRuntimeHarness()
    const publication = coordinator(harness.runtime, [])
    const candidate = project('revision-a')
    const bundle = await publishedBundle(candidate)
    const before = await Promise.all([
      database.projectRevisions.count(),
      database.projectPointers.count(),
      database.projectCommitTokens.count(),
    ])

    const result = await publication.restorePublished(bundle)

    expect(result).toEqual(bundle)
    expect(publication.readPublished()).toEqual(bundle)
    expect(harness.currentRevisionId).toBe('revision-a')
    expect(await Promise.all([
      database.projectRevisions.count(),
      database.projectPointers.count(),
      database.projectCommitTokens.count(),
    ])).toEqual(before)
  })

  it.each(['apply', 'commit'] as const)(
    'enters recovery without a false bundle when restore %s fails',
    async (failure) => {
      const harness = createRuntimeHarness()
      const error = new Error(`restore ${failure} failed`)
      if (failure === 'apply') harness.controls.applyErrors.set('revision-a', error)
      else harness.controls.commitErrors.set('revision-a', error)
      const publication = coordinator(harness.runtime, [])

      await expect(publication.restorePublished(
        await publishedBundle(project('revision-a')),
      )).rejects.toBe(error)

      expect(publication.readPublished()).toBeNull()
      expect(publication.isRecoveryRequired()).toBe(true)
      if (failure === 'commit') {
        expect(harness.applications.get('revision-a')?.rollback).toHaveBeenCalledTimes(1)
      }
    },
  )

  it('rejects a supplied restore bundle whose revision or config does not match its Project', async () => {
    const harness = createRuntimeHarness()
    const publication = coordinator(harness.runtime, [])
    const candidate = project('revision-a')

    await expectPublicationError(
      publication.restorePublished({
        project: candidate,
        revisionId: 'revision-wrong',
        configRevision: await configRevisionForProjectV4(candidate),
      }),
      'PROJECT_PUBLISHED_BUNDLE_INVALID',
    )
    await expectPublicationError(
      publication.restorePublished({
        project: candidate,
        revisionId: candidate.revisionId,
        configRevision: '0'.repeat(64),
      }),
      'PROJECT_PUBLISHED_BUNDLE_INVALID',
    )
    expect(harness.runtime.prepare).not.toHaveBeenCalled()
    expect(publication.isRecoveryRequired()).toBe(false)
  })

  it('finalizes and restores the publishing target after a crash, then retains only target B', async () => {
    const name = database.name
    const firstRuntime = createRuntimeHarness()
    const firstCoordinator = coordinator(firstRuntime.runtime, ['token-a'])
    const candidateA = project('revision-a')
    const candidateB = project('revision-b')
    await firstCoordinator.replace({ candidate: candidateA, expectedRevisionId: null })
    const preparedB = await repository.prepareRevision(candidateB)
    await repository.commitPreparedRevision('revision-a', preparedB, 'token-crash-b')
    database.close()

    const reopenedDatabase = new ProjectDatabaseV4(name)
    openDatabases.push(reopenedDatabase)
    const reopenedRepository = createProjectRepositoryV4({
      database: reopenedDatabase,
      now: () => FIXED_NOW,
    })
    const reopenedRuntime = createRuntimeHarness()
    const reopenedCoordinator = coordinator(
      reopenedRuntime.runtime,
      [],
      reopenedRepository,
    )
    const retainedB = await reopenedRepository.readRevision('revision-b')
    expect(retainedB).not.toBeNull()

    await reopenedRepository.finalizePublication('token-crash-b')
    await reopenedCoordinator.restorePublished(retainedB!)
    await reopenedRepository.garbageCollect()

    await expect(reopenedRepository.readPointer()).resolves.toEqual({
      key: 'active',
      state: 'stable',
      revisionId: 'revision-b',
      commitToken: 'token-crash-b',
    })
    expect(reopenedCoordinator.readPublished()?.revisionId).toBe('revision-b')
    expect(reopenedRuntime.currentRevisionId).toBe('revision-b')
    await expect(reopenedDatabase.projectRevisions.toCollection().primaryKeys())
      .resolves.toEqual(['revision-b'])
  })

  it.each(['missing', 'corrupt'] as const)(
    'compensates an unreadable %s crash target and restores exact stable A',
    async (failure) => {
      const name = database.name
      const firstRuntime = createRuntimeHarness()
      const firstCoordinator = coordinator(firstRuntime.runtime, ['token-a'])
      const candidateA = project('revision-a')
      const candidateB = project('revision-b')
      await firstCoordinator.replace({ candidate: candidateA, expectedRevisionId: null })
      const preparedB = await repository.prepareRevision(candidateB)
      await repository.commitPreparedRevision('revision-a', preparedB, 'token-crash-b')
      if (failure === 'missing') await database.projectRevisions.delete('revision-b')
      else await database.projectRevisions.update('revision-b', { configRevision: '0'.repeat(64) })
      database.close()

      const reopenedDatabase = new ProjectDatabaseV4(name)
      openDatabases.push(reopenedDatabase)
      const reopenedRepository = createProjectRepositoryV4({
        database: reopenedDatabase,
        now: () => FIXED_NOW,
      })
      let targetReadable = false
      try {
        targetReadable = await reopenedRepository.readRevision('revision-b') !== null
      } catch {
        targetReadable = false
      }
      expect(targetReadable).toBe(false)

      await reopenedRepository.compensatePublication('token-crash-b')

      await expect(reopenedRepository.readPointer()).resolves.toEqual({
        key: 'active',
        state: 'stable',
        revisionId: 'revision-a',
        commitToken: 'token-a',
      })
      await expect(reopenedRepository.readActive()).resolves.toEqual(candidateA)
    },
  )
})
