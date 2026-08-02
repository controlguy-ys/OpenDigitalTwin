import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  createAppCommandRegistryV6,
  type AppCommandIdV6,
  type AppCommandSnapshotV6,
} from '../../commands/v6/app-command-v6.js'
import { ModelToolboxV6 } from './ModelToolboxV6.js'

const TOOLBOX_COMMANDS: readonly { readonly id: AppCommandIdV6; readonly label: string }[] = [
  { id: 'tool.select', label: 'Select' },
  { id: 'tool.translate', label: 'Translate' },
  { id: 'tool.rotate', label: 'Rotate' },
  { id: 'model.addGroup', label: 'Add Group' },
  { id: 'model.addBox', label: 'Add Box' },
  { id: 'model.addCylinder', label: 'Add Cylinder' },
  { id: 'view.focusSelection', label: 'Focus Selection' },
  { id: 'view.fitAll', label: 'Fit All' },
]

function command(id: AppCommandIdV6, label: string, execute: () => void): AppCommandSnapshotV6 {
  return { id, label, enabled: true, visible: true, execute }
}

describe('ModelToolboxV6', () => {
  it('exposes semantic Interaction, Geometry, and Camera sections without merging primitive actions', async () => {
    const executes = new Map<AppCommandIdV6, ReturnType<typeof vi.fn>>()
    const registry = createAppCommandRegistryV6(TOOLBOX_COMMANDS.map(({ id, label }) => {
      const execute = vi.fn()
      executes.set(id, execute)
      return command(id, label, execute)
    }))

    render(<ModelToolboxV6 registry={registry} />)

    const toolbox = screen.getByRole('complementary', { name: 'Model toolbox' })
    for (const heading of ['Interaction', 'Geometry', 'Camera']) {
      expect(within(toolbox).getByRole('heading', { level: 2, name: heading })).toBeVisible()
      expect(within(toolbox).getByRole('region', { name: heading })).toBeVisible()
    }
    expect(within(toolbox).getByRole('button', { name: 'Add Box' })).toHaveAttribute('data-command-id', 'model.addBox')
    expect(within(toolbox).getByRole('button', { name: 'Add Cylinder' })).toHaveAttribute('data-command-id', 'model.addCylinder')
    expect(within(toolbox).getByRole('button', { name: 'Add Box' })).not.toHaveAttribute('data-command-id', 'model.addCylinder')

    for (const { id, label } of TOOLBOX_COMMANDS) {
      fireEvent.click(within(toolbox).getByRole('button', { name: label }))
      await vi.waitFor(() => expect(executes.get(id)).toHaveBeenCalledOnce())
    }
  })

  it('activates Add Group once for each native Enter and Space keyboard activation', async () => {
    const execute = vi.fn()
    const registry = createAppCommandRegistryV6([
      command('model.addGroup', 'Add Group', execute),
    ])
    const user = userEvent.setup()

    render(<ModelToolboxV6 registry={registry} />)
    const addGroup = screen.getByRole('button', { name: 'Add Group' })
    addGroup.focus()

    await user.keyboard('{Enter}')
    expect(execute).toHaveBeenCalledOnce()
    await user.keyboard(' ')
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
