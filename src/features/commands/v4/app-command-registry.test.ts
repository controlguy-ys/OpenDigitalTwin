import { describe, expect, it, vi } from 'vitest'

import type { AppCommandV4 } from './app-command.js'
import { createAppCommandRegistryV4 } from './app-command-registry.js'

function command(
  id: string,
  overrides: Partial<AppCommandV4> = {},
): AppCommandV4 {
  return {
    id,
    label: id,
    section: 'project',
    kind: 'action',
    visible: true,
    enabled: true,
    execute: vi.fn(),
    ...overrides,
  }
}

describe('createAppCommandRegistryV4', () => {
  it('rejects a duplicate command ID with the exact contract message', () => {
    const first = command('project.save')
    const duplicate = command('project.save')

    expect(() => createAppCommandRegistryV4([first, duplicate]))
      .toThrow('Duplicate App command id: project.save')
  })

  it('returns registered visible and hidden commands while unknown IDs are null', () => {
    const visible = command('project.save')
    const hidden = command('project.advanced', { visible: false })
    const registry = createAppCommandRegistryV4([visible, hidden])

    expect(registry.get('project.save')).toBe(visible)
    expect(registry.get('project.advanced')).toBe(hidden)
    expect(registry.get('project.unknown')).toBeNull()
  })

  it('lists only visible commands in their supplied order for the requested section', () => {
    const first = command('project.new')
    const hidden = command('project.hidden', { visible: false })
    const second = command('project.save')
    const otherSection = command('home.run', { section: 'home' })
    const registry = createAppCommandRegistryV4([first, hidden, second, otherSection])

    expect(registry.list('project').map((entry) => entry.id)).toEqual([
      'project.new',
      'project.save',
    ])
    expect(registry.list('home')).toEqual([otherSection])
  })

  it('evaluates a live visible getter when listing', () => {
    let visible = false
    const live = command('project.live')
    Object.defineProperty(live, 'visible', {
      get: () => visible,
      enumerable: true,
    })
    const registry = createAppCommandRegistryV4([live])

    expect(registry.list('project')).toEqual([])
    visible = true
    expect(registry.list('project')).toEqual([live])
  })

  it('preserves toggle and radio metadata without changing it', () => {
    const toggle = command('view.grid', { kind: 'toggle', checked: true })
    const radio = command('view.mode', {
      kind: 'radio',
      checked: false,
      groupId: 'view-mode',
    })
    const registry = createAppCommandRegistryV4([toggle, radio])

    expect(registry.get('view.grid')).toMatchObject({ kind: 'toggle', checked: true })
    expect(registry.get('view.mode')).toMatchObject({
      kind: 'radio',
      checked: false,
      groupId: 'view-mode',
    })
  })

  it('copies caller ordering and protects returned lists from mutation', () => {
    const first = command('project.new')
    const second = command('project.save')
    const supplied = [first, second]
    const registry = createAppCommandRegistryV4(supplied)

    supplied.reverse()
    const listed = registry.list('project')
    expect(listed.map((entry) => entry.id)).toEqual(['project.new', 'project.save'])

    expect(() => (listed as AppCommandV4[]).reverse()).toThrow()
    expect(registry.list('project').map((entry) => entry.id)).toEqual([
      'project.new',
      'project.save',
    ])
  })
})
