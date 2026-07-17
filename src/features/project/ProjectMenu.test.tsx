import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore } from 'zustand/vanilla'
import { expect, it, vi } from 'vitest'

import { makeMinimalWorkcellProjectV4 } from '../../core/project-v4/test-support.js'
import type {
  ProjectStoreStateV4,
  ProjectStoreV4,
} from './v4/project-store-v4.js'
import type { ProjectMutationPortV4 } from './v4/project-mutation-port.js'
import { ProjectMenuV4 } from './ProjectMenu.js'

function createProjectStore(
  overrides: Partial<ProjectStoreStateV4> = {},
): ProjectStoreV4 {
  const activeProject = {
    ...makeMinimalWorkcellProjectV4(),
    metadata: {
      ...makeMinimalWorkcellProjectV4().metadata,
      name: 'Workcell 01',
    },
  }
  return createStore<ProjectStoreStateV4>()(() => ({
    activeProject,
    status: 'ready',
    error: null,
    hydrate: vi.fn(async () => undefined),
    newProject: vi.fn(async () => undefined),
    saveActiveProject: vi.fn(async () => activeProject),
    exportActiveProject: vi.fn(async () => new Blob(['{}'], {
      type: 'application/json',
    })),
    importProject: vi.fn(async () => undefined),
    ...overrides,
  }))
}

function mutationPort(
  active = createProjectStore().getState().activeProject!,
): ProjectMutationPortV4 {
  return {
    replaceFromActive: vi.fn(async (recipe) => ({
      project: recipe.mutate(active),
    })),
  }
}

it('routes V4 Save, JSON Export, and whole-file JSON Import through the store', async () => {
  const archive = new Blob(['{"schemaVersion":4}'], {
    type: 'application/json',
  })
  const file = new File(['{"schemaVersion":4}'], 'cell.json', {
    type: 'application/json',
  })
  const wholeFileRead = vi.spyOn(file, 'arrayBuffer')
  const store = createProjectStore({
    exportActiveProject: vi.fn(async () => archive),
  })
  const download = vi.fn()
  const user = userEvent.setup()
  render(<ProjectMenuV4 download={download} store={store} />)

  await user.click(screen.getByRole('button', { name: 'Save project' }))
  await user.click(screen.getByRole('button', { name: 'Export project' }))
  await user.upload(screen.getByLabelText('Import project'), file)

  expect(store.getState().saveActiveProject).toHaveBeenCalledOnce()
  expect(store.getState().exportActiveProject).toHaveBeenCalledOnce()
  expect(download).toHaveBeenCalledWith(archive, 'Workcell 01.json')
  expect(store.getState().importProject).toHaveBeenCalledWith(file)
  expect(wholeFileRead).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Import project')).toHaveAttribute(
    'accept',
    '.json,application/json',
  )
})

it('starts New through the V4 store and renders Project identity from activeProject', async () => {
  const store = createProjectStore()
  const user = userEvent.setup()
  render(<ProjectMenuV4 store={store} />)

  expect(screen.getByText('Workcell 01')).toBeVisible()
  expect(screen.getByText('Saved')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'New' }))

  expect(store.getState().newProject).toHaveBeenCalledOnce()
})

it('disables durable Project actions when recovery requires a reload', () => {
  const store = createProjectStore({
    status: 'recovery-required',
    error: 'Publication recovery is required.',
  })

  render(<ProjectMenuV4 store={store} />)

  expect(screen.getByText('Reload required')).toBeVisible()
  expect(screen.getByRole('button', { name: 'New' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save project' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Export project' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Publication recovery is required.',
  )
})

it('keeps Save and Export unavailable when no V4 Project is active', () => {
  const store = createProjectStore({
    activeProject: null,
    status: 'idle',
  })

  render(<ProjectMenuV4 store={store} />)

  expect(screen.getByText('Untitled Workcell')).toBeVisible()
  expect(screen.getByText('Unsaved')).toBeVisible()
  expect(screen.getByRole('button', { name: 'New' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Save project' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Export project' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled()
})

it('mutates only the persisted OPC UA Off or Server mode through replaceFromActive', async () => {
  const store = createProjectStore()
  const mutations = mutationPort(store.getState().activeProject!)
  const user = userEvent.setup()

  render(<ProjectMenuV4 mutations={mutations} store={store} />)
  await user.selectOptions(screen.getByLabelText('OPC UA Server mode'), 'server')

  expect(mutations.replaceFromActive).toHaveBeenCalledOnce()
  const recipe = vi.mocked(mutations.replaceFromActive).mock.calls[0]![0]
  const active = store.getState().activeProject!
  expect(recipe.description).toMatch(/OPC UA.*server/i)
  expect(recipe.mutate(active)).toEqual({
    ...active,
    opcUa: { ...active.opcUa, mode: 'server' },
  })
})

it('shows an imported Client mode honestly and lets the user normalize it to Off', async () => {
  const base = createProjectStore().getState().activeProject!
  const activeProject = { ...base, opcUa: { ...base.opcUa, mode: 'client' as const } }
  const store = createProjectStore({ activeProject })
  const mutations = mutationPort(activeProject)
  const user = userEvent.setup()

  render(<ProjectMenuV4 mutations={mutations} store={store} />)
  const selector = screen.getByLabelText('OPC UA Server mode')
  expect(selector).toHaveValue('client')
  expect(screen.getByRole('option', { name: 'Unsupported: Client' })).toBeDisabled()

  await user.selectOptions(selector, 'off')
  const recipe = vi.mocked(mutations.replaceFromActive).mock.calls[0]![0]
  expect(recipe.mutate(activeProject).opcUa.mode).toBe('off')
})

it('loads the dual-Robot sample and renders compact Gateway readiness', async () => {
  const store = createProjectStore()
  const mutations = mutationPort(store.getState().activeProject!)
  const user = userEvent.setup()

  render(
    <ProjectMenuV4
      gateway={{
        phase: 'ready',
        projectRevisionId: store.getState().activeProject!.revisionId,
        mode: 'server',
        endpointUrl: 'opc.tcp://127.0.0.1:4840',
        message: null,
      }}
      mutations={mutations}
      store={store}
    />,
  )

  expect(screen.getByRole('status', { name: 'Runtime Gateway status' }))
    .toHaveTextContent('Gateway ready')
  expect(screen.getByRole('status', { name: 'Runtime Gateway status' }))
    .toHaveAttribute('title', 'opc.tcp://127.0.0.1:4840')
  await user.click(screen.getByRole('button', { name: 'Load dual-Robot sample' }))

  expect(mutations.replaceFromActive).toHaveBeenCalledOnce()
  const recipe = vi.mocked(mutations.replaceFromActive).mock.calls[0]![0]
  const sample = recipe.mutate(store.getState().activeProject!)
  expect(sample.metadata.name).toBe('Dual Robot Simulation Sample')
  expect(sample.robots).toHaveLength(2)
  expect(sample.jobs).toHaveLength(2)
  expect(sample.opcUa.mode).toBe('off')
})
