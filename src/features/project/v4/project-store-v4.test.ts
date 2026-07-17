import { describe, expect, it, vi } from 'vitest'

import {
  canonicalProjectV4Bytes,
  canonicalProjectV4Json,
  configRevisionForProjectV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { decodeProjectV4, encodeProjectV4 } from './project-v4-codec.js'
import type {
  ProjectMutationServiceV4,
} from './project-v4-mutation-service.js'
import type { PublishedProjectBundleV4 } from './project-v4-publication.js'
import { createProjectStoreV4 } from './project-store-v4.js'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function project(revisionId: string, name = `Project ${revisionId}`): WorkcellProjectV4 {
  const base = clone(makeMinimalWorkcellProjectV4())
  return {
    ...base,
    revisionId,
    metadata: { ...base.metadata, name },
  }
}

async function bundle(candidate: WorkcellProjectV4): Promise<PublishedProjectBundleV4> {
  return {
    project: candidate,
    revisionId: candidate.revisionId,
    configRevision: await configRevisionForProjectV4(candidate),
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete
    reject = fail
  })
  return { promise, resolve, reject }
}

interface MutationHarness {
  mutations: ProjectMutationServiceV4
  readonly listeners: Set<() => void>
  published: PublishedProjectBundleV4 | null
  recoveryRequired: boolean
}

function createMutationHarness(): MutationHarness {
  const listeners = new Set<() => void>()
  const harness: MutationHarness = {
    listeners,
    published: null,
    recoveryRequired: false,
    mutations: undefined as never,
  }
  harness.mutations = {
    hydrate: vi.fn(async () => undefined),
    readPublished: vi.fn(() => harness.published),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    replace: vi.fn(async (candidate) => {
      harness.published = await bundle(candidate)
      listeners.forEach((listener) => listener())
      return harness.published
    }),
    replacePrepared: vi.fn(async (candidate) => {
      harness.published = await bundle(candidate)
      listeners.forEach((listener) => listener())
      return harness.published
    }),
    replaceFromActive: vi.fn(),
    isRecoveryRequired: vi.fn(() => harness.recoveryRequired),
  }
  return harness
}

function createStore(harness: MutationHarness, createDefaultProject = () => project('revision-new')) {
  return createProjectStoreV4({
    mutations: harness.mutations,
    createDefaultProject,
    encodeProject: encodeProjectV4,
    decodeProject: decodeProjectV4,
  })
}

describe('ProjectStoreV4 lifecycle', () => {
  it('hydrates exactly once per call and publishes the durable active Project after completion', async () => {
    const harness = createMutationHarness()
    const active = await bundle(project('revision-a'))
    const gate = deferred<void>()
    vi.mocked(harness.mutations.hydrate).mockImplementationOnce(async () => {
      await gate.promise
      harness.published = active
    })
    const store = createStore(harness)

    const pending = store.getState().hydrate()
    expect(store.getState()).toMatchObject({ status: 'loading', activeProject: null, error: null })
    gate.resolve()
    await pending

    expect(harness.mutations.hydrate).toHaveBeenCalledOnce()
    expect(store.getState()).toMatchObject({
      status: 'ready',
      activeProject: active.project,
      error: null,
    })
  })

  it('creates a new Project only through the injected explicit factory', async () => {
    const harness = createMutationHarness()
    harness.published = await bundle(project('revision-a'))
    const next = project('revision-new')
    const createDefault = vi.fn(() => next)
    const store = createStore(harness, createDefault)

    await store.getState().newProject()

    expect(createDefault).toHaveBeenCalledOnce()
    expect(harness.mutations.replace).toHaveBeenCalledWith(next)
    expect(store.getState()).toMatchObject({ status: 'ready', activeProject: next })
  })

  it('saves by returning the already durable publication without replacing it', async () => {
    const harness = createMutationHarness()
    const active = project('revision-a')
    harness.published = await bundle(active)
    const store = createStore(harness)

    await expect(store.getState().saveActiveProject()).resolves.toBe(active)

    expect(harness.mutations.replace).not.toHaveBeenCalled()
    expect(store.getState()).toMatchObject({ status: 'ready', activeProject: active })
  })

  it('exports only canonical JSON for the durable active Project', async () => {
    const harness = createMutationHarness()
    const active = project('revision-a')
    harness.published = await bundle(active)
    const store = createStore(harness)

    const exported = await store.getState().exportActiveProject()

    expect(exported.type).toBe('application/json;charset=utf-8')
    expect(await exported.text()).toBe(canonicalProjectV4Json(active))
    expect(harness.mutations.replace).not.toHaveBeenCalled()
  })

  it.each(['blob', 'uint8', 'array-buffer'] as const)(
    'imports canonical V4 JSON from %s and publishes it',
    async (sourceKind) => {
      const harness = createMutationHarness()
      harness.published = await bundle(project('revision-a'))
      const imported = project('revision-import')
      const bytes = canonicalProjectV4Bytes(imported)
      const source = sourceKind === 'blob'
        ? new Blob([bytes])
        : sourceKind === 'uint8'
          ? bytes
          : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const store = createStore(harness)

      await store.getState().importProject(source)

      expect(harness.mutations.replace).toHaveBeenCalledOnce()
      expect(store.getState()).toMatchObject({
        status: 'ready',
        activeProject: { revisionId: 'revision-import' },
      })
    },
  )

  it('accepts safe noncanonical key order and re-exports canonical JSON', async () => {
    const harness = createMutationHarness()
    harness.published = await bundle(project('revision-a'))
    const imported = project('revision-import')
    const reordered = Object.fromEntries(Object.entries(imported).reverse())
    const store = createStore(harness)

    await store.getState().importProject(new Blob([JSON.stringify(reordered)]))
    const exported = await store.getState().exportActiveProject()

    expect(await exported.text()).toBe(canonicalProjectV4Json(imported))
    expect(harness.mutations.replace).toHaveBeenCalledOnce()
  })

  it.each([1, 2, 3])('rejects schema %i before mutation and preserves the active revision', async (schemaVersion) => {
    const harness = createMutationHarness()
    const active = project('revision-a')
    harness.published = await bundle(active)
    const store = createStore(harness)

    await expect(store.getState().importProject(
      new Blob([JSON.stringify({ schemaVersion })]),
    )).rejects.toMatchObject({ code: 'PROJECT_SCHEMA_UNSUPPORTED' })

    expect(harness.mutations.replace).not.toHaveBeenCalled()
    expect(store.getState().activeProject).toBe(active)
  })

  it('rejects unknown fields and unsafe JSON before mutation', async () => {
    const harness = createMutationHarness()
    const active = project('revision-a')
    harness.published = await bundle(active)
    const store = createStore(harness)
    const imported = project('revision-import')
    const unknown = { ...imported, unknown: true }

    await expect(store.getState().importProject(
      new Blob([JSON.stringify(unknown)]),
    )).rejects.toMatchObject({ code: 'PROJECT_RECORD_NOT_CLOSED' })
    await expect(store.getState().importProject(
      new Blob(['{"schemaVersion":4} trailing']),
    )).rejects.toMatchObject({ code: 'PROJECT_JSON_PARSE_FAILED' })

    expect(harness.mutations.replace).not.toHaveBeenCalled()
    expect(store.getState().activeProject).toBe(active)
  })

  it.each(['sourceBytes', 'sourcePath', 'mountPath'] as const)(
    'rejects unsafe root field %s before mutation',
    async (field) => {
      const harness = createMutationHarness()
      const active = project('revision-a')
      harness.published = await bundle(active)
      const store = createStore(harness)
      const imported = { ...project('revision-import'), [field]: 'unsafe' }

      await expect(store.getState().importProject(
        new Blob([JSON.stringify(imported)]),
      )).rejects.toMatchObject({ code: 'PROJECT_RECORD_NOT_CLOSED' })

      expect(harness.mutations.replace).not.toHaveBeenCalled()
      expect(store.getState()).toMatchObject({ status: 'error', activeProject: active })
    },
  )

  it('fully decodes before replacement and clears a decoder error on the next success', async () => {
    const harness = createMutationHarness()
    const active = project('revision-a')
    harness.published = await bundle(active)
    const decoder = vi.fn()
      .mockRejectedValueOnce(new Error('decoder rejected'))
      .mockResolvedValueOnce(project('revision-import'))
    const store = createProjectStoreV4({
      mutations: harness.mutations,
      createDefaultProject: () => project('revision-new'),
      encodeProject: encodeProjectV4,
      decodeProject: decoder,
    })
    const source = new Blob(['{}'])

    await expect(store.getState().importProject(source)).rejects.toThrow('decoder rejected')
    expect(harness.mutations.replace).not.toHaveBeenCalled()
    expect(store.getState()).toMatchObject({
      status: 'error',
      activeProject: active,
      error: expect.stringContaining('decoder rejected'),
    })

    await store.getState().importProject(source)

    expect(harness.mutations.replace).toHaveBeenCalledOnce()
    expect(store.getState()).toMatchObject({
      status: 'ready',
      activeProject: { revisionId: 'revision-import' },
      error: null,
    })
  })

  it('preserves the prior Project after an ordinary replacement failure', async () => {
    const harness = createMutationHarness()
    const active = project('revision-a')
    harness.published = await bundle(active)
    vi.mocked(harness.mutations.replace).mockRejectedValueOnce(
      new Error('replacement failed'),
    )
    const store = createStore(harness)

    await expect(store.getState().newProject()).rejects.toThrow('replacement failed')

    expect(store.getState()).toMatchObject({
      status: 'error',
      activeProject: active,
      error: expect.stringContaining('replacement failed'),
    })
  })

  it('exposes recovery-required when hydration latches recovery', async () => {
    const harness = createMutationHarness()
    harness.recoveryRequired = true
    vi.mocked(harness.mutations.hydrate).mockRejectedValueOnce(
      Object.assign(new Error('hydrate requires reload'), {
        code: 'PROJECT_RECOVERY_REQUIRED',
      }),
    )
    const store = createStore(harness)

    await expect(store.getState().hydrate()).rejects.toMatchObject({
      code: 'PROJECT_RECOVERY_REQUIRED',
    })

    expect(store.getState()).toMatchObject({
      status: 'recovery-required',
      activeProject: null,
      error: expect.stringContaining('hydrate requires reload'),
    })
  })

  it('tracks successful mutations performed outside the Project menu', async () => {
    const harness = createMutationHarness()
    harness.published = await bundle(project('revision-a'))
    const store = createStore(harness)
    const external = await bundle(project('revision-external'))

    harness.published = external
    harness.listeners.forEach((listener) => listener())

    expect(store.getState()).toMatchObject({
      status: 'ready',
      activeProject: external.project,
      error: null,
    })
  })

  it('preserves the prior Project and exposes recovery-required after a failed operation', async () => {
    const harness = createMutationHarness()
    const active = project('revision-a')
    harness.published = await bundle(active)
    harness.recoveryRequired = true
    vi.mocked(harness.mutations.replace).mockRejectedValueOnce(
      Object.assign(new Error('reload required'), { code: 'PROJECT_RECOVERY_REQUIRED' }),
    )
    const store = createStore(harness)

    await expect(store.getState().newProject()).rejects.toMatchObject({
      code: 'PROJECT_RECOVERY_REQUIRED',
    })

    expect(store.getState()).toMatchObject({
      status: 'recovery-required',
      activeProject: active,
      error: expect.stringContaining('reload required'),
    })
  })

  it('reports a missing durable active Project without fabricating a default', async () => {
    const harness = createMutationHarness()
    const createDefault = vi.fn(() => project('revision-new'))
    const store = createStore(harness, createDefault)

    await expect(store.getState().saveActiveProject()).rejects.toMatchObject({
      code: 'PROJECT_ACTIVE_REVISION_MISSING',
    })
    await expect(store.getState().exportActiveProject()).rejects.toMatchObject({
      code: 'PROJECT_ACTIVE_REVISION_MISSING',
    })

    expect(createDefault).not.toHaveBeenCalled()
    expect(store.getState().activeProject).toBeNull()
  })
})
