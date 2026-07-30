import { describe, expect, it, vi } from 'vitest'

import {
  V6_COMMAND_PLACEMENTS,
  createAppCommandRegistryV6,
  type AppCommandIdV6,
  type AppCommandSnapshotV6,
} from './app-command-v6.js'

function command(
  id: AppCommandIdV6,
  overrides: Partial<AppCommandSnapshotV6> = {},
): AppCommandSnapshotV6 {
  return {
    id,
    label: id,
    enabled: true,
    visible: true,
    execute: vi.fn(),
    ...overrides,
  }
}

describe('createAppCommandRegistryV6', () => {
  it('invokes an enabled visible command by its stable V6 identity', async () => {
    const addBox = vi.fn()
    const registry = createAppCommandRegistryV6([
      command('model.addBox', { label: 'Add Box', execute: addBox }),
    ])

    expect(registry.get('model.addBox')?.enabled).toBe(true)
    expect(registry.get('model.addBox')?.label).toBe('Add Box')

    await registry.invoke('model.addBox')

    expect(addBox).toHaveBeenCalledOnce()
  })

  it('rejects duplicate command identities before exposing a registry', () => {
    expect(() => createAppCommandRegistryV6([
      command('project.save'),
      command('project.save'),
    ])).toThrow('Duplicate V6 command id: project.save')
  })

  it('rejects an unknown command invocation without running another command', async () => {
    const save = vi.fn()
    const registry = createAppCommandRegistryV6([
      command('project.save', { execute: save }),
    ])

    await expect(registry.invoke('project.unknown')).rejects
      .toThrow('Unknown V6 command id: project.unknown')

    expect(save).not.toHaveBeenCalled()
  })

  it('does not invoke hidden commands', async () => {
    const execute = vi.fn()
    const registry = createAppCommandRegistryV6([
      command('project.export', { visible: false, execute }),
    ])

    await expect(registry.invoke('project.export')).rejects
      .toThrow('Hidden V6 command id: project.export')

    expect(execute).not.toHaveBeenCalled()
  })

  it('does not invoke disabled commands', async () => {
    const execute = vi.fn()
    const registry = createAppCommandRegistryV6([
      command('project.import', { enabled: false, execute }),
    ])

    await expect(registry.invoke('project.import')).rejects
      .toThrow('Disabled V6 command id: project.import')

    expect(execute).not.toHaveBeenCalled()
  })

  it('preserves an asynchronous command rejection', async () => {
    const rejected = new Error('V5 mutation rejected')
    const registry = createAppCommandRegistryV6([
      command('job.start', { execute: async () => { throw rejected } }),
    ])

    await expect(registry.invoke('job.start')).rejects.toBe(rejected)
  })

  it('defines Main View maximize as a transient presentation command', async () => {
    let maximized = false
    const projectMutation = vi.fn()
    const maximize = {
      id: 'view.main.maximize',
      get label() { return maximized ? 'Restore Main View' : 'Maximize Main View' },
      get icon() { return maximized ? 'Minimize2' as const : 'Maximize2' as const },
      get checked() { return maximized },
      enabled: true,
      visible: true,
      execute: () => { maximized = !maximized },
    } satisfies AppCommandSnapshotV6
    const registry = createAppCommandRegistryV6([maximize])

    expect(registry.get('view.main.maximize')).toMatchObject({
      label: 'Maximize Main View', icon: 'Maximize2', checked: false,
    })
    expect(V6_COMMAND_PLACEMENTS.filter(({ commandId }) => commandId === 'view.main.maximize'))
      .toEqual([
        { commandId: 'view.main.maximize', surface: 'view-menu' },
        { commandId: 'view.main.maximize', surface: 'main-view-pane-toolbar' },
      ])

    await registry.invoke('view.main.maximize')

    expect(registry.get('view.main.maximize')).toMatchObject({
      label: 'Restore Main View', icon: 'Minimize2', checked: true,
    })
    expect(projectMutation).not.toHaveBeenCalled()
  })
})
