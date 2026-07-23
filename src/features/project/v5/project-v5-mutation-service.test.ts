import { describe, expect, it, vi } from 'vitest'

import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from '../../../core/project-v5/test-support.js'
import type {
  ProjectPublicationCoordinatorV5,
  PublishedProjectV5,
} from './project-v5-publication.js'
import {
  createProjectV5MutationService,
  type ProjectV5AtomicMutationPort,
} from './project-v5-mutation-service.js'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const NOW = '2026-07-23T00:00:00.000Z'

function project(revisionId: string, name = 'Original'): WorkcellProjectV5 {
  const candidate = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  return {
    ...candidate,
    revisionId,
    metadata: { ...candidate.metadata, name },
  }
}

function published(projectValue: WorkcellProjectV5, configRevision: string): PublishedProjectV5 {
  return Object.freeze({ project: projectValue, revisionId: projectValue.revisionId, configRevision })
}

function harness() {
  const active = published(project('revision-a'), HASH_A)
  let current: PublishedProjectV5 | null = active
  const replace = vi.fn(async (request: {
    readonly candidate: WorkcellProjectV5
    readonly expectedRevisionId: string | null
  }) => {
    expect(request.expectedRevisionId).toBe(current?.revisionId ?? null)
    const next = published(request.candidate, HASH_B)
    current = next
    return next
  })
  const publication = {
    replace,
    hydrate: vi.fn(async () => current),
    readPublished: () => current,
    isRecoveryRequired: () => false,
    readRecoveryError: () => null,
    subscribe: vi.fn(() => () => undefined),
  } satisfies Pick<ProjectPublicationCoordinatorV5, 'replace' | 'hydrate' | 'readPublished' | 'isRecoveryRequired' | 'readRecoveryError' | 'subscribe'>
  const createRevisionId = vi.fn(() => 'revision-b')
  const nowIso = vi.fn(() => NOW)
  const service = createProjectV5MutationService({ publication, createRevisionId, nowIso })
  return { active, publication, replace, createRevisionId, nowIso, service, current: () => current }
}

describe('Project V5 atomic mutation service', () => {
  it('implements the fixed atomic port and creates one fully validated revision from the active project', async () => {
    const subject = harness()
    const atomic: ProjectV5AtomicMutationPort = subject.service
    const recipe = vi.fn((active: WorkcellProjectV5) => ({
      ...active,
      metadata: { ...active.metadata, name: 'Renamed' },
    }))

    await expect(atomic.mutate({
      expectedRevisionId: subject.active.revisionId,
      description: 'Rename Project',
      recipe,
    })).resolves.toEqual(expect.objectContaining({
      revisionId: 'revision-b', configRevision: HASH_B,
      project: expect.objectContaining({
        projectId: subject.active.project.projectId,
        revisionId: 'revision-b',
        metadata: expect.objectContaining({
          name: 'Renamed',
          createdAt: subject.active.project.metadata.createdAt,
          updatedAt: NOW,
        }),
      }),
    }))

    expect(recipe).toHaveBeenCalledTimes(1)
    expect(subject.createRevisionId).toHaveBeenCalledTimes(1)
    expect(subject.nowIso).toHaveBeenCalledTimes(1)
    expect(subject.replace).toHaveBeenCalledTimes(1)
    expect(subject.service.readPublished()).toEqual(subject.current())
  })

  it('rejects a stale request before invoking its recipe or revision generator', async () => {
    const subject = harness()
    const recipe = vi.fn((active: WorkcellProjectV5) => active)

    await expect(subject.service.mutate({
      expectedRevisionId: 'stale-revision',
      description: 'Stale edit',
      recipe,
    })).rejects.toMatchObject({ code: 'PROJECT_ACTIVE_REVISION_CHANGED' })

    expect(recipe).not.toHaveBeenCalled()
    expect(subject.createRevisionId).not.toHaveBeenCalled()
    expect(subject.replace).not.toHaveBeenCalled()
  })

  it('serializes concurrent requests so the second stale edit never runs its recipe', async () => {
    const subject = harness()
    let releaseFirst!: () => void
    const firstStarted = new Promise<void>((resolve) => { releaseFirst = resolve })
    const firstRecipe = vi.fn((active: WorkcellProjectV5) => {
      releaseFirst()
      return { ...active, metadata: { ...active.metadata, name: 'First' } }
    })
    const secondRecipe = vi.fn((active: WorkcellProjectV5) => active)

    const first = subject.service.mutate({
      expectedRevisionId: subject.active.revisionId,
      description: 'First',
      recipe: firstRecipe,
    })
    await firstStarted
    const second = subject.service.mutate({
      expectedRevisionId: subject.active.revisionId,
      description: 'Second',
      recipe: secondRecipe,
    })

    await expect(first).resolves.toMatchObject({ revisionId: 'revision-b' })
    await expect(second).rejects.toMatchObject({ code: 'PROJECT_ACTIVE_REVISION_CHANGED' })
    expect(firstRecipe).toHaveBeenCalledTimes(1)
    expect(secondRecipe).not.toHaveBeenCalled()
    expect(subject.replace).toHaveBeenCalledTimes(1)
  })

  it('queues a reentrant request behind the active mutation and rejects it as stale', async () => {
    const subject = harness()
    let reentrant: Promise<PublishedProjectV5> | null = null
    const recipe = (active: WorkcellProjectV5) => {
      reentrant = subject.service.mutate({
        expectedRevisionId: subject.active.revisionId,
        description: 'Nested',
        recipe: (nested) => nested,
      })
      return { ...active, metadata: { ...active.metadata, name: 'Outer' } }
    }

    await expect(subject.service.mutate({
      expectedRevisionId: subject.active.revisionId,
      description: 'Outer',
      recipe,
    })).resolves.toMatchObject({ revisionId: 'revision-b' })
    await expect(reentrant).rejects.toMatchObject({ code: 'PROJECT_ACTIVE_REVISION_CHANGED' })
    expect(subject.replace).toHaveBeenCalledTimes(1)
  })

  it('does not publish or generate metadata when the recipe throws or returns an invalid candidate', async () => {
    const recipeFailure = harness()
    await expect(recipeFailure.service.mutate({
      expectedRevisionId: recipeFailure.active.revisionId,
      description: 'Broken recipe',
      recipe: () => { throw new Error('recipe failure') },
    })).rejects.toThrow('recipe failure')
    expect(recipeFailure.createRevisionId).not.toHaveBeenCalled()
    expect(recipeFailure.nowIso).not.toHaveBeenCalled()
    expect(recipeFailure.replace).not.toHaveBeenCalled()

    const validationFailure = harness()
    await expect(validationFailure.service.mutate({
      expectedRevisionId: validationFailure.active.revisionId,
      description: 'Invalid recipe',
      recipe: (active) => ({ ...active, metadata: { ...active.metadata, name: '' } }),
    })).rejects.toThrow()
    expect(validationFailure.replace).not.toHaveBeenCalled()
  })

  it('serializes replacement and hydration with mutations and relays authoritative publication notifications', async () => {
    const active = published(project('revision-a'), HASH_A)
    const replacement = project('replacement-revision', 'Imported')
    let current: PublishedProjectV5 | null = active
    const listeners = new Set<() => void>()
    const publication = {
      replace: vi.fn(async (request: { readonly candidate: WorkcellProjectV5; readonly expectedRevisionId: string | null }) => {
        expect(request.expectedRevisionId).toBe(current?.revisionId ?? null)
        current = published(request.candidate, HASH_B)
        for (const listener of listeners) listener()
        return current
      }),
      hydrate: vi.fn(async () => current),
      readPublished: () => current,
      isRecoveryRequired: () => false,
      readRecoveryError: () => null,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    } satisfies Pick<ProjectPublicationCoordinatorV5, 'replace' | 'hydrate' | 'readPublished' | 'isRecoveryRequired' | 'readRecoveryError' | 'subscribe'>
    const service = createProjectV5MutationService({
      publication,
      createRevisionId: () => 'revision-b',
      nowIso: () => NOW,
    })
    const listener = vi.fn()
    const unsubscribe = service.subscribe(listener)

    await expect(service.replace({ candidate: replacement, description: 'Import Project' })).resolves.toEqual(
      expect.objectContaining({ project: replacement }),
    )
    await expect(service.hydrate()).resolves.toEqual(expect.objectContaining({ project: replacement }))
    expect(publication.replace).toHaveBeenCalledTimes(1)
    expect(publication.hydrate).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('runs hydrate, replace, and stale mutate in exact FIFO order and relays recovery error authority', async () => {
    const active = published(project('revision-a'), HASH_A)
    const replacement = project('replacement-revision', 'Imported')
    let current: PublishedProjectV5 | null = active
    let releaseHydrate!: () => void
    const hydrateGate = new Promise<void>((resolve) => { releaseHydrate = resolve })
    const events: string[] = []
    const recovery = new Error('reload required')
    const publication = {
      hydrate: vi.fn(async () => { events.push('hydrate:start'); await hydrateGate; events.push('hydrate:end'); return current }),
      replace: vi.fn(async ({ candidate }: { readonly candidate: WorkcellProjectV5 }) => {
        events.push('replace')
        current = published(candidate, HASH_B)
        return current
      }),
      readPublished: () => current,
      isRecoveryRequired: () => false,
      readRecoveryError: () => recovery,
      subscribe: vi.fn(() => () => undefined),
    }
    const service = createProjectV5MutationService({ publication, createRevisionId: () => 'unused', nowIso: () => NOW })
    const recipe = vi.fn((value: WorkcellProjectV5) => value)

    const hydrating = service.hydrate()
    const replacing = service.replace({ candidate: replacement, description: 'Import' })
    const mutating = service.mutate({ expectedRevisionId: active.revisionId, description: 'Stale', recipe })
    await Promise.resolve()
    expect(events).toEqual(['hydrate:start'])
    releaseHydrate()

    await expect(hydrating).resolves.toEqual(active)
    await expect(replacing).resolves.toEqual(published(replacement, HASH_B))
    await expect(mutating).rejects.toMatchObject({ code: 'PROJECT_ACTIVE_REVISION_CHANGED' })
    expect(events).toEqual(['hydrate:start', 'hydrate:end', 'replace'])
    expect(recipe).not.toHaveBeenCalled()
    expect(service.readRecoveryError()).toBe(recovery)
  })
})
