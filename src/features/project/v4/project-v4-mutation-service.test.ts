import { describe, expect, it, vi } from 'vitest'

import {
  configRevisionForProjectV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import type { StoredProjectPointerV4 } from './project-v4-db.js'
import {
  createProjectMutationServiceV4,
  type ProjectMutationRecipeV4,
} from './project-v4-mutation-service.js'
import type {
  ProjectPublicationCoordinatorV4,
  PublishedProjectBundleV4,
} from './project-v4-publication.js'
import type {
  ProjectRepositoryV4,
  ProjectRevisionRecordV4,
} from './project-v4-repository.js'

const NOW_A = '2026-07-16T00:00:00.000Z'
const NOW_B = '2026-07-17T01:02:03.004Z'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function project(revisionId: string, name = `Project ${revisionId}`): WorkcellProjectV4 {
  const base = clone(makeMinimalWorkcellProjectV4())
  return {
    ...base,
    revisionId,
    metadata: { ...base.metadata, name, createdAt: NOW_A, updatedAt: NOW_A },
  }
}

async function bundle(candidate: WorkcellProjectV4): Promise<PublishedProjectBundleV4> {
  return Object.freeze({
    project: candidate,
    revisionId: candidate.revisionId,
    configRevision: await configRevisionForProjectV4(candidate),
  })
}

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

interface Harness {
  repository: ProjectRepositoryV4
  publication: ProjectPublicationCoordinatorV4
  readonly rows: Map<string, ProjectRevisionRecordV4>
  readonly events: string[]
  readonly createRevisionId: ReturnType<typeof vi.fn<() => string>>
  pointer: StoredProjectPointerV4 | null
  published: PublishedProjectBundleV4 | null
}

function createHarness(): Harness {
  const events: string[] = []
  const rows = new Map<string, ProjectRevisionRecordV4>()
  const harness: Harness = {
    events,
    rows,
    pointer: null,
    published: null,
    createRevisionId: vi.fn(() => 'revision-generated'),
    repository: undefined as never,
    publication: undefined as never,
  }
  harness.repository = {
    prepareRevision: vi.fn(),
    materializePreparedProject: vi.fn(),
    discardPreparedRevision: vi.fn(),
    commitPreparedRevision: vi.fn(),
    finalizePublication: vi.fn(async (token: string) => {
      events.push(`finalize:${token}`)
      const pointer = harness.pointer
      if (pointer === null || pointer.state !== 'publishing' || pointer.commitToken !== token) {
        throw Object.assign(new Error('token mismatch'), { code: 'PROJECT_PUBLICATION_TOKEN_MISMATCH' })
      }
      harness.pointer = {
        key: 'active',
        state: 'stable',
        revisionId: pointer.revisionId,
        commitToken: pointer.commitToken,
      }
    }),
    compensatePublication: vi.fn(async (token: string) => {
      events.push(`compensate:${token}`)
      const pointer = harness.pointer
      if (pointer === null || pointer.state !== 'publishing' || pointer.commitToken !== token) {
        throw Object.assign(new Error('token mismatch'), { code: 'PROJECT_PUBLICATION_TOKEN_MISMATCH' })
      }
      harness.pointer = pointer.previousRevisionId === null
        ? null
        : {
            key: 'active',
            state: 'stable',
            revisionId: pointer.previousRevisionId,
            commitToken: pointer.previousCommitToken!,
          }
    }),
    readRevision: vi.fn(async (revisionId: string) => {
      events.push(`read:${revisionId}`)
      return rows.get(revisionId) ?? null
    }),
    readActive: vi.fn(),
    readPointer: vi.fn(async () => {
      events.push('pointer')
      return harness.pointer
    }),
    garbageCollect: vi.fn(async () => { events.push('gc') }),
  }
  harness.publication = {
    replace: vi.fn(async ({ candidate }) => {
      events.push(`replace:${candidate.revisionId}`)
      const next = await bundle(candidate)
      harness.published = next
      return next
    }),
    restorePublished: vi.fn(async (next) => {
      events.push(`restore:${next.revisionId}`)
      harness.published = next
      return next
    }),
    readPublished: vi.fn(() => harness.published),
    isRecoveryRequired: vi.fn(() => false),
  }
  return harness
}

async function seedRow(harness: Harness, candidate: WorkcellProjectV4): Promise<void> {
  const published = await bundle(candidate)
  harness.rows.set(candidate.revisionId, published)
}

function stable(revisionId: string, token: string): StoredProjectPointerV4 {
  return { key: 'active', state: 'stable', revisionId, commitToken: token }
}

function publishing(
  revisionId: string,
  token: string,
  previousRevisionId: string | null,
  previousCommitToken: string | null,
): StoredProjectPointerV4 {
  return {
    key: 'active',
    state: 'publishing',
    revisionId,
    previousRevisionId,
    previousCommitToken,
    commitToken: token,
  }
}

function service(harness: Harness) {
  return createProjectMutationServiceV4({
    repository: harness.repository,
    publication: harness.publication,
    nowIso: () => NOW_B,
    createRevisionId: harness.createRevisionId,
  })
}

describe('ProjectMutationServiceV4 target-wins hydration', () => {
  it('leaves an absent V4 pointer absent without adopting a default or another schema', async () => {
    const harness = createHarness()
    const mutations = service(harness)
    const listener = vi.fn()
    mutations.subscribe(listener)

    await mutations.hydrate()

    expect(mutations.readPublished()).toBeNull()
    expect(harness.repository.readRevision).not.toHaveBeenCalled()
    expect(harness.publication.restorePublished).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledOnce()
  })

  it('restores a verified stable row', async () => {
    const harness = createHarness()
    const candidate = project('revision-a')
    await seedRow(harness, candidate)
    harness.pointer = stable(candidate.revisionId, 'token-a')
    const listener = vi.fn()
    const mutations = service(harness)
    mutations.subscribe(listener)

    await mutations.hydrate()

    expect(mutations.readPublished()?.project).toEqual(candidate)
    expect(harness.events).toEqual([
      'pointer',
      'read:revision-a',
      'restore:revision-a',
      'gc',
    ])
    expect(listener).toHaveBeenCalledOnce()
  })

  it('finalizes the exact valid publishing target before restoring it', async () => {
    const harness = createHarness()
    const previous = project('revision-a')
    const target = project('revision-b')
    await seedRow(harness, previous)
    await seedRow(harness, target)
    harness.pointer = publishing(target.revisionId, 'token-b', previous.revisionId, 'token-a')

    await service(harness).hydrate()

    expect(harness.pointer).toEqual(stable(target.revisionId, 'token-b'))
    expect(harness.published?.revisionId).toBe(target.revisionId)
    expect(harness.events).toEqual([
      'pointer',
      'read:revision-b',
      'finalize:token-b',
      'restore:revision-b',
      'gc',
    ])
  })

  it('compensates a corrupt target and restores the verified prior stable row', async () => {
    const harness = createHarness()
    const previous = project('revision-a')
    await seedRow(harness, previous)
    harness.pointer = publishing('revision-corrupt', 'token-b', previous.revisionId, 'token-a')

    await service(harness).hydrate()

    expect(harness.pointer).toEqual(stable(previous.revisionId, 'token-a'))
    expect(harness.published?.revisionId).toBe(previous.revisionId)
    expect(harness.events).toEqual([
      'pointer',
      'read:revision-corrupt',
      'compensate:token-b',
      'pointer',
      'read:revision-a',
      'restore:revision-a',
      'gc',
    ])
  })

  it('compensates a corrupt first target to no pointer and latches recovery', async () => {
    const harness = createHarness()
    harness.pointer = publishing('revision-corrupt', 'token-first', null, null)
    const mutations = service(harness)

    await expect(mutations.hydrate()).rejects.toMatchObject({
      code: 'PROJECT_RECOVERY_REQUIRED',
    })

    expect(harness.pointer).toBeNull()
    expect(mutations.readPublished()).toBeNull()
    expect(mutations.isRecoveryRequired()).toBe(true)
    await expect(mutations.replace(project('revision-later'))).rejects.toMatchObject({
      code: 'PROJECT_RECOVERY_REQUIRED',
    })
    expect(harness.publication.replace).not.toHaveBeenCalled()
  })

  it.each(['finalize', 'restore', 'compensate', 'prior-read'] as const)(
    'latches recovery when %s leaves publication uncertain',
    async (failurePoint) => {
      const harness = createHarness()
      const previous = project('revision-a')
      const target = project('revision-b')
      await seedRow(harness, previous)
      if (failurePoint !== 'prior-read') await seedRow(harness, target)
      harness.pointer = publishing(
        failurePoint === 'prior-read' ? 'revision-corrupt' : target.revisionId,
        'token-b',
        previous.revisionId,
        'token-a',
      )
      if (failurePoint === 'finalize') {
        vi.mocked(harness.repository.finalizePublication).mockRejectedValueOnce(new Error('finalize failed'))
      } else if (failurePoint === 'restore') {
        vi.mocked(harness.publication.restorePublished).mockRejectedValueOnce(new Error('restore failed'))
      } else if (failurePoint === 'compensate') {
        harness.rows.delete(target.revisionId)
        vi.mocked(harness.repository.compensatePublication).mockRejectedValueOnce(new Error('compensate failed'))
      } else {
        harness.rows.delete(previous.revisionId)
      }
      const mutations = service(harness)

      await expect(mutations.hydrate()).rejects.toThrow()
      expect(mutations.isRecoveryRequired()).toBe(true)
    },
  )
})

describe('ProjectMutationServiceV4 serialized recipes', () => {
  it('clones and freezes the active Project, reissues identity/time, and forwards exact CAS', async () => {
    const harness = createHarness()
    const active = project('revision-a')
    harness.published = await bundle(active)
    harness.createRevisionId.mockReturnValueOnce('revision-b')
    const mutations = service(harness)
    const listener = vi.fn()
    mutations.subscribe(listener)

    const result = await mutations.replaceFromActive({
      description: 'Rename Robot A',
      mutate(draft) {
        expect(draft).not.toBe(active)
        expect(Object.isFrozen(draft)).toBe(true)
        expect(Object.isFrozen(draft.robots[0])).toBe(true)
        return {
          ...draft,
          projectId: 'recipe-must-not-replace-project-identity',
          revisionId: 'recipe-must-not-choose-revision',
          metadata: {
            ...draft.metadata,
            createdAt: '2020-01-01T00:00:00.000Z',
          },
          robots: [{ ...draft.robots[0]!, name: 'Renamed' }],
        }
      },
    })

    expect(result.project).toMatchObject({
      projectId: active.projectId,
      revisionId: 'revision-b',
      metadata: {
        createdAt: active.metadata.createdAt,
        updatedAt: NOW_B,
      },
      robots: [{ name: 'Renamed' }],
    })
    expect(harness.publication.replace).toHaveBeenCalledWith({
      candidate: result.project,
      expectedRevisionId: active.revisionId,
    })
    expect(listener).toHaveBeenCalledOnce()
  })

  it('serializes recipes so the second reads the first successful publication', async () => {
    const harness = createHarness()
    harness.published = await bundle(project('revision-a', 'A'))
    harness.createRevisionId
      .mockReturnValueOnce('revision-b')
      .mockReturnValueOnce('revision-c')
    const firstPublication = deferred<PublishedProjectBundleV4>()
    vi.mocked(harness.publication.replace)
      .mockImplementationOnce(async ({ candidate }) => {
        const next = await firstPublication.promise
        harness.published = next
        expect(next.project).toEqual(candidate)
        return next
      })
      .mockImplementationOnce(async ({ candidate, expectedRevisionId }) => {
        expect(expectedRevisionId).toBe('revision-b')
        const next = await bundle(candidate)
        harness.published = next
        return next
      })
    const mutations = service(harness)

    const first = mutations.replaceFromActive({
      description: 'First',
      mutate: (active) => ({ ...active, metadata: { ...active.metadata, name: 'B' } }),
    })
    const secondRecipe = vi.fn((active: WorkcellProjectV4) => ({
      ...active,
      metadata: { ...active.metadata, name: `${active.metadata.name} then C` },
    }))
    const second = mutations.replaceFromActive({ description: 'Second', mutate: secondRecipe })
    await Promise.resolve()
    expect(secondRecipe).not.toHaveBeenCalled()
    firstPublication.resolve(await bundle({
      ...project('revision-b', 'B'),
      metadata: { ...project('revision-b', 'B').metadata, updatedAt: NOW_B },
    }))

    await first
    const result = await second
    expect(secondRecipe).toHaveBeenCalledOnce()
    expect(result.project.metadata.name).toBe('B then C')
    expect(result.revisionId).toBe('revision-c')
  })

  it('does not retry a stale recipe when the active revision changes during mutation', async () => {
    const harness = createHarness()
    const active = project('revision-a')
    harness.published = await bundle(active)
    const recipe = vi.fn((draft: WorkcellProjectV4) => ({
      ...draft,
      metadata: { ...draft.metadata, name: 'Attempt' },
    }))
    const external = await bundle(project('revision-external'))
    const synchronousRecipe: ProjectMutationRecipeV4 = {
      description: 'Stale',
      mutate(draft) {
        const candidate = recipe(draft)
        harness.published = external
        return candidate
      },
    }

    await expect(service(harness).replaceFromActive(synchronousRecipe)).rejects.toMatchObject({
      code: 'PROJECT_ACTIVE_REVISION_CHANGED',
    })
    expect(recipe).toHaveBeenCalledOnce()
    expect(harness.publication.replace).not.toHaveBeenCalled()
  })

  it.each(['recipe', 'validation', 'publication'] as const)(
    'preserves the published state and emits no notification on %s failure',
    async (failurePoint) => {
      const harness = createHarness()
      const active = project('revision-a')
      const activeBundle = await bundle(active)
      harness.published = activeBundle
      const mutations = service(harness)
      const listener = vi.fn()
      mutations.subscribe(listener)
      if (failurePoint === 'publication') {
        vi.mocked(harness.publication.replace).mockRejectedValueOnce(new Error('durable failed'))
      }
      const recipe: ProjectMutationRecipeV4 = {
        description: failurePoint,
        mutate(draft) {
          if (failurePoint === 'recipe') throw new Error('recipe failed')
          if (failurePoint === 'validation') return { ...draft, robots: [] }
          return { ...draft, metadata: { ...draft.metadata, name: 'Candidate' } }
        },
      }

      await expect(mutations.replaceFromActive(recipe)).rejects.toThrow()
      expect(mutations.readPublished()).toBe(activeBundle)
      expect(listener).not.toHaveBeenCalled()
    },
  )

  it('validates replacePrepared and forwards its caller-supplied expected revision unchanged', async () => {
    const harness = createHarness()
    const candidate = project('revision-import')
    const mutations = service(harness)

    const result = await mutations.replacePrepared(candidate, 'revision-caller')

    expect(result.project).not.toBe(candidate)
    expect(harness.publication.replace).toHaveBeenCalledWith({
      candidate: result.project,
      expectedRevisionId: 'revision-caller',
    })
  })
})
