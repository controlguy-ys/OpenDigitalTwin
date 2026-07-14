import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore } from 'zustand/vanilla'
import { expect, it, vi } from 'vitest'
import type {
  LegacyProjectSnapshotV2 as CurrentProjectSnapshot,
} from '../../domain/project/project'
import type { ProjectStoreState } from './project-store'
import { ProjectMenu } from './ProjectMenu'

it('saves, exports, and imports a selected .wdtwin archive', async () => {
  const save = vi.fn(async () =>
    ({ manifest: { projectId: 'project-01' } }) as CurrentProjectSnapshot,
  )
  const exportProject = vi.fn(async () => new Uint8Array([1, 2, 3]))
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
    new File([new Uint8Array([9])], 'cell.wdtwin'),
  )

  expect(save).toHaveBeenCalledOnce()
  expect(exportProject).toHaveBeenCalledOnce()
  expect(download).toHaveBeenCalledWith(
    new Uint8Array([1, 2, 3]),
    'Workcell 01.wdtwin',
  )
  expect(importProject).toHaveBeenCalledOnce()
})
