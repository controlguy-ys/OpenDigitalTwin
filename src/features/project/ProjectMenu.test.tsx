import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore } from 'zustand/vanilla'
import { expect, it, vi } from 'vitest'
import type { WorkcellProjectSnapshotV3 as CurrentProjectSnapshot } from '../../domain/project/project-v3'
import type { ProjectStoreState } from './project-store'
import { ProjectMenu } from './ProjectMenu'

it('saves, exports, and imports a selected .wdtwin archive', async () => {
  const save = vi.fn(async () =>
    ({ manifest: { projectId: 'project-01' } }) as CurrentProjectSnapshot,
  )
  const archive = new Blob([new Uint8Array([1, 2, 3])])
  const file = new File([new Uint8Array([9])], 'cell.wdtwin')
  const wholeFileRead = vi.spyOn(file, 'arrayBuffer')
  const exportProject = vi.fn(async () => archive)
  const importProject = vi.fn(async () => undefined)
  const download = vi.fn()
  const store = createStore<ProjectStoreState>()(() => ({
    activeProjectId: 'project-01',
    activeProjectName: 'Workcell 01',
    activeSnapshot: null,
    status: 'ready',
    error: null,
    hydrate: vi.fn(async () => undefined),
    newProject: vi.fn(async () => undefined),
    saveActiveProject: save,
    exportActiveProject: exportProject,
    importProject,
  }))
  const user = userEvent.setup()
  render(<ProjectMenu download={download} store={store} />)

  await user.click(screen.getByRole('button', { name: 'Save project' }))
  await user.click(screen.getByRole('button', { name: 'Export project' }))
  await user.upload(
    screen.getByLabelText('Import project'),
    file,
  )

  expect(save).toHaveBeenCalledOnce()
  expect(exportProject).toHaveBeenCalledOnce()
  expect(download).toHaveBeenCalledWith(
    archive,
    'Workcell 01.wdtwin',
  )
  expect(importProject).toHaveBeenCalledWith(file)
  expect(wholeFileRead).not.toHaveBeenCalled()
})

it('disables durable Project actions when recovery requires a reload', () => {
  const store = createStore<ProjectStoreState>()(() => ({
    activeProjectId: 'project-01',
    activeProjectName: 'Workcell 01',
    activeSnapshot: null,
    status: 'recovery-required',
    error: 'Publication recovery is required.',
    hydrate: vi.fn(async () => undefined),
    newProject: vi.fn(async () => undefined),
    saveActiveProject: vi.fn(),
    exportActiveProject: vi.fn(),
    importProject: vi.fn(async () => undefined),
  }))

  render(<ProjectMenu store={store} />)

  expect(screen.getByText('Reload required')).toBeVisible()
  expect(screen.getByRole('button', { name: 'New' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save project' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Export project' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
})
