import { describe, expect, it, vi } from 'vitest'

import { MAX_LOGICAL_SIGNALS_V5, type WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import { encodeProjectV5 } from './project-v5-codec.js'
import type { PublishedProjectV5 } from './project-v5-publication.js'
import { createProjectStoreV5 } from './project-store-v5.js'

const HASH = 'a'.repeat(64)
function published(project: WorkcellProjectV5): PublishedProjectV5 {
  return { project, revisionId: project.revisionId, configRevision: HASH }
}

function harness(realCodec = false) {
  const active = makeMinimalWorkcellProjectV5()
  let current: PublishedProjectV5 | null = published(active)
  let recoveryError: Error | null = null
  const listeners = new Set<() => void>()
  const mutations = {
    readPublished: () => current,
    isRecoveryRequired: () => recoveryError !== null,
    readRecoveryError: () => recoveryError,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    hydrate: vi.fn(async () => current),
    replace: vi.fn(async ({ candidate }: { readonly candidate: WorkcellProjectV5; readonly description: string }) => {
      current = published(candidate)
      for (const listener of listeners) listener()
      return current
    }),
    mutate: vi.fn(),
  }
  const encodeProject = vi.fn((project: WorkcellProjectV5) => new Blob([JSON.stringify(project)]))
  const decodeProject = vi.fn(async () => ({ ...active, revisionId: 'imported-revision', metadata: { ...active.metadata, name: 'Imported' } }))
  const store = createProjectStoreV5({
    mutations,
    createDefaultProject: () => ({ ...active, projectId: 'new-project', revisionId: 'new-revision' }),
    ...(realCodec ? {} : { encodeProject, decodeProject }),
  })
  return {
    active, mutations, encodeProject, decodeProject, store,
    publish: (next: WorkcellProjectV5) => { current = published(next); for (const listener of listeners) listener() },
    recover: (error: Error, clearPublished = false) => {
      recoveryError = error
      if (clearPublished) current = null
      for (const listener of listeners) listener()
    },
  }
}

describe('Project V5 store', () => {
  it('reads canonical active state, publishes New and Import through the mutation service, and exports the canonical project', async () => {
    const subject = harness()
    await subject.store.getState().hydrate()
    await subject.store.getState().newProject()
    const activeAfterNew = subject.store.getState().activeProject
    const saved = await subject.store.getState().saveActiveProject()
    await subject.store.getState().exportActiveProject()
    await subject.store.getState().importProject(new Uint8Array([1]))

    expect(subject.mutations.hydrate).toHaveBeenCalledOnce()
    expect(subject.mutations.replace).toHaveBeenCalledTimes(2)
    expect(saved).toBe(activeAfterNew)
    expect(subject.encodeProject).toHaveBeenCalledWith(saved)
    expect(subject.store.getState()).toMatchObject({ status: 'ready', activeProject: expect.objectContaining({ revisionId: 'imported-revision' }) })
  })

  it('rejects a codec-bounded import before mutation and preserves the exact active object', async () => {
    const subject = harness()
    const before = subject.store.getState().activeProject
    subject.decodeProject.mockRejectedValueOnce(Object.assign(new Error('unsupported'), { code: 'PROJECT_SCHEMA_UNSUPPORTED' }))

    await expect(subject.store.getState().importProject(new Uint8Array([1]))).rejects.toMatchObject({ code: 'PROJECT_SCHEMA_UNSUPPORTED' })

    expect(subject.mutations.replace).not.toHaveBeenCalled()
    expect(subject.store.getState().activeProject).toBe(before)
    expect(subject.store.getState().status).toBe('error')
  })

  it('keeps the active project after replacement failure and projects later authoritative publication notifications', async () => {
    const subject = harness()
    const before = subject.store.getState().activeProject
    subject.mutations.replace.mockRejectedValueOnce(new Error('publish failed'))
    await expect(subject.store.getState().newProject()).rejects.toThrow('publish failed')
    expect(subject.store.getState().activeProject).toBe(before)

    subject.publish({ ...subject.active, revisionId: 'notified-revision' })
    expect(subject.store.getState()).toMatchObject({ status: 'ready', activeProject: expect.objectContaining({ revisionId: 'notified-revision' }) })
  })

  it('projects external recovery notifications with their error and retains the exact active object', () => {
    const subject = harness()
    const before = subject.store.getState().activeProject
    const error = new Error('durable pointer corrupt')

    subject.recover(error)

    expect(subject.store.getState()).toMatchObject({ status: 'recovery-required', error: error.message })
    expect(subject.store.getState().activeProject).toBe(before)
  })

  it('retains exact current authority when recovery has no readable publication, then accepts a later publication', () => {
    const subject = harness()
    const before = subject.store.getState().activeProject
    const error = new Error('publication unreadable')

    subject.recover(error, true)

    expect(subject.store.getState()).toMatchObject({ status: 'recovery-required', error: error.message })
    expect(subject.store.getState().activeProject).toBe(before)

    subject.publish({ ...subject.active, revisionId: 'recovered-revision' })
    expect(subject.store.getState().activeProject?.revisionId).toBe('recovered-revision')
  })

  it('normalizes reordered V5 JSON through the real codec and re-exports canonical bytes', async () => {
    const subject = harness(true)
    const cloned = cloneWorkcellProjectV5(subject.active)
    const candidate: WorkcellProjectV5 = {
      ...cloned,
      revisionId: 'canonical-import',
      metadata: { ...cloned.metadata, name: 'Canonical Import' },
    }
    const reordered = Object.fromEntries(Object.entries(candidate).reverse())

    await subject.store.getState().importProject(new TextEncoder().encode(JSON.stringify(reordered)))
    const exported = await subject.store.getState().exportActiveProject()

    expect(subject.mutations.replace).toHaveBeenCalledOnce()
    expect(await exported.text()).toBe(await encodeProjectV5(candidate).text())
  })

  it('rejects a structurally oversized real source before mutation and retains exact state and error', async () => {
    const subject = harness(true)
    const before = subject.store.getState().activeProject
    const cloned = cloneWorkcellProjectV5(subject.active)
    const oversized: WorkcellProjectV5 = {
      ...cloned,
      logicalSignals: Array.from(
      { length: MAX_LOGICAL_SIGNALS_V5 + 1 },
        (_, index) => ({ ...cloned.logicalSignals[0]!, id: `signal-${index}` }),
      ),
    }

    await expect(subject.store.getState().importProject(
      new TextEncoder().encode(JSON.stringify(oversized)),
    )).rejects.toMatchObject({ code: 'LOGICAL_SIGNAL_LIMIT_EXCEEDED' })

    expect(subject.mutations.replace).not.toHaveBeenCalled()
    expect(subject.store.getState().activeProject).toBe(before)
    expect(subject.store.getState()).toMatchObject({
      status: 'error',
      error: expect.stringContaining('LOGICAL_SIGNAL_LIMIT_EXCEEDED'),
    })
  })
})
