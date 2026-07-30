import { createStore } from 'zustand/vanilla'
import { describe, expect, it, vi } from 'vitest'

import { makeMinimalWorkcellProjectV5 } from '../../core/project-v5/test-support.js'
import type { WorkcellProjectV5 } from '../../core/project-v5/types.js'
import type { BrowserProjectApplicationResourcesV5 } from '../../features/project/v5/browser-project-resources-v5.js'
import type { ProjectStoreStateV5 } from '../../features/project/v5/project-store-v5.js'
import { createWorkspaceLayoutStoreV6 } from '../../features/ui/v6/workspace-layout-store-v6.js'
import {
  createAppCommandCompositionV6,
  type AppCommandCompositionContextV6,
} from './app-command-composition-v6.js'

function createHarness() {
  const project = makeMinimalWorkcellProjectV5()
  const store = createStore<ProjectStoreStateV5>()(() => ({
    activeProject: project,
    status: 'ready',
    error: null,
    hydrate: vi.fn(async () => undefined),
    newProject: vi.fn(async () => undefined),
    saveActiveProject: vi.fn(async () => project),
    exportActiveProject: vi.fn(async () => new Blob()),
    importProject: vi.fn(async () => undefined),
  }))
  const mutate = vi.fn(async (_request: {
    readonly expectedRevisionId: string
    readonly description: string
    readonly recipe: (candidate: WorkcellProjectV5) => WorkcellProjectV5
  }) => ({ project, revisionId: 'revision-next' }))
  const resources = {
    store,
    mutations: { readPublished: () => ({ project, revisionId: project.revisionId }), mutate },
    files: {
      pickProject: vi.fn(async () => new File(['{}'], 'project.json')),
      downloadProject: vi.fn(),
    },
  } as unknown as BrowserProjectApplicationResourcesV5
  const setSelection = vi.fn()
  const openDialog = vi.fn()
  const setInteractionMode = vi.fn()
  const layout = createWorkspaceLayoutStoreV6({ storage: null })
  const context: AppCommandCompositionContextV6 = {
    resources,
    selection: null,
    setSelection,
    layout,
    openDialog,
    setInteractionMode,
    createEntityId: () => 'entity-created',
  }
  return { context, layout, mutate, openDialog, project, resources, setInteractionMode, setSelection, store }
}

describe('createAppCommandCompositionV6', () => {
  it('delegates current V5 project and file commands through the resource ports', async () => {
    const harness = createHarness()
    const registry = createAppCommandCompositionV6(harness.context)

    await registry.invoke('project.new')
    await registry.invoke('project.save')
    await registry.invoke('project.export')
    await registry.invoke('project.import')

    expect(harness.store.getState().newProject).toHaveBeenCalledOnce()
    expect(harness.store.getState().saveActiveProject).toHaveBeenCalledOnce()
    expect(harness.store.getState().exportActiveProject).toHaveBeenCalledOnce()
    expect(harness.resources.files.downloadProject).toHaveBeenCalledWith(
      expect.any(Blob),
      { name: harness.project.metadata.name, projectId: harness.project.projectId },
    )
    expect(harness.resources.files.pickProject).toHaveBeenCalledOnce()
    expect(harness.store.getState().importProject).toHaveBeenCalledWith(expect.any(File))
  })

  it('uses current V5 status and publication to enable mutable commands', () => {
    const harness = createHarness()
    harness.store.setState({ activeProject: null, status: 'loading' })
    const registry = createAppCommandCompositionV6(harness.context)

    expect(registry.get('project.new')?.enabled).toBe(false)
    expect(registry.get('project.save')?.enabled).toBe(false)
    expect(registry.get('model.addBox')?.enabled).toBe(false)
  })

  it('publishes exactly one expected-revision primitive mutation and selects only after success', async () => {
    const harness = createHarness()
    const registry = createAppCommandCompositionV6(harness.context)

    await registry.invoke('model.addBox')

    expect(harness.mutate).toHaveBeenCalledOnce()
    expect(harness.mutate).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevisionId: harness.project.revisionId,
      description: 'Add box',
    }))
    const request = harness.mutate.mock.calls[0]![0]
    const candidate = request.recipe(harness.project)
    expect(candidate.spatialEntities).toContainEqual(expect.objectContaining({
      id: 'entity-created',
      geometry: expect.objectContaining({ kind: 'box' }),
      transformOwner: 'manual',
    }))
    expect(harness.setSelection).toHaveBeenCalledExactlyOnceWith({ kind: 'entity', id: 'entity-created' })
  })

  it('propagates a stale-revision rejection without selecting the primitive', async () => {
    const harness = createHarness()
    const stale = new Error('PROJECT_ACTIVE_REVISION_CHANGED')
    harness.mutate.mockRejectedValueOnce(stale)
    const registry = createAppCommandCompositionV6(harness.context)

    await expect(registry.invoke('model.addCylinder')).rejects.toThrow('PROJECT_ACTIVE_REVISION_CHANGED')
    expect(harness.setSelection).not.toHaveBeenCalled()
  })

  it('keeps interaction, layout, theme, help, and presentation actions outside Project mutations', async () => {
    const harness = createHarness()
    const registry = createAppCommandCompositionV6(harness.context)

    await registry.invoke('tool.translate')
    await registry.invoke('view.theme.dark')
    await registry.invoke('view.layout.reset')
    await registry.invoke('help.controls')
    await registry.invoke('view.main.maximize')

    expect(harness.setInteractionMode).toHaveBeenCalledWith('translate')
    expect(harness.layout.getState().preferences.theme).toBe('dark')
    expect(harness.openDialog).toHaveBeenCalledWith({ kind: 'help', topic: 'controls' })
    expect(harness.layout.getState().mainViewPresentation).toBe('maximized')
    expect(harness.mutate).not.toHaveBeenCalled()
  })
})
