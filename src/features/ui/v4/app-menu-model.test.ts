import { describe, expect, it } from 'vitest'

import { createAppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'
import type { AppCommandV4 } from '../../commands/v4/app-command.js'
import { buildAppMenuModelV4 } from './app-menu-model.js'

function command(id: string, section: AppCommandV4['section'], visible = true): AppCommandV4 {
  return { id, label: id, section, kind: 'action', visible, enabled: true, execute() {} }
}

describe('buildAppMenuModelV4', () => {
  it('keeps placement order, submenus, separators, and cross-section ids', () => {
    const commands = [
      command('project.new', 'project'), command('project.save', 'project'), command('project.import', 'project'), command('project.export', 'project'), command('project.sample.dual', 'project'),
      command('connectivity.mode.off', 'connectivity'), command('connectivity.mode.server', 'connectivity'), command('connectivity.details.open', 'connectivity'),
      command('view.sidebar', 'view'), command('view.inspector', 'view'), command('view.bottom', 'view'), command('view.ribbon', 'view'), command('view.layout.reset', 'view'), command('view.theme.system', 'view'), command('view.theme.light', 'view'), command('view.theme.dark', 'view'), command('view.layer.grid', 'view'), command('view.layer.world', 'view'), command('view.layer.mcp', 'view'), command('view.layer.base', 'view'), command('view.layer.tcp', 'view'), command('view.home', 'view'), command('view.fitAll', 'view'), command('view.focusSelection', 'view'), command('view.orientation.isometric', 'view'), command('view.orientation.top', 'view'), command('view.orientation.front', 'view'), command('view.orientation.right', 'view'), command('view.orientation.back', 'view'), command('view.orientation.left', 'view'), command('view.orientation.bottom', 'view'),
    ]
    const model = buildAppMenuModelV4(createAppCommandRegistryV4(commands))
    expect(model.map(({ id }) => id)).toEqual(['project', 'home', 'connectivity', 'view'])
    const project = model[0]!
    expect(project.children.map((node) => node.kind === 'submenu' ? node.label : node.kind === 'command' ? node.commandId : node.id)).toEqual(['project.new', 'project.save', 'project.import', 'project.export', 'project.separator.1', 'Samples'])
    expect(model[2]!.children).toMatchObject([{ kind: 'submenu', label: 'Runtime Mode' }, { kind: 'separator', id: 'connectivity.separator.1' }, { kind: 'command', commandId: 'connectivity.details.open' }])
    expect((model[3]!.children.find((node) => node.kind === 'submenu' && node.label === 'Camera') as { children: readonly { commandId: string }[] }).children.map(({ commandId }) => commandId)).toEqual(['view.home', 'view.fitAll', 'view.focusSelection'])
    expect(Object.isFrozen(model)).toBe(true)
  })

  it('removes unavailable nodes and empty sections without empty separators', () => {
    const model = buildAppMenuModelV4(createAppCommandRegistryV4([command('help.opcUaMapping', 'help', false)]))
    expect(model).toEqual([])
  })

  it('renormalizes separators after a missing placement and protects nested arrays', () => {
    const model = buildAppMenuModelV4(createAppCommandRegistryV4([
      command('project.new', 'project'), command('project.sample.dual', 'project'),
    ]))
    expect(model[0]?.children).toMatchObject([
      { kind: 'command', commandId: 'project.new' },
      { kind: 'separator', id: 'project.separator.1' },
      { kind: 'submenu', label: 'Samples' },
    ])
    expect(Object.isFrozen((model[0]!.children.at(-1) as { children: readonly unknown[] }).children)).toBe(true)
  })

  it('keeps cross-section references as the same registry command id', () => {
    const focus = command('view.focusSelection', 'view')
    const model = buildAppMenuModelV4(createAppCommandRegistryV4([focus, command('view.home', 'view'), command('view.fitAll', 'view')]))
    const home = model.find((section) => section.id === 'home')!
    const view = model.find((section) => section.id === 'view')!
    const camera = view.children.find((node) => node.kind === 'submenu' && node.label === 'Camera') as Extract<typeof view.children[number], { kind: 'submenu' }>
    expect(home.children).toContainEqual({ kind: 'command', commandId: focus.id })
    expect(camera.children).toContainEqual({ kind: 'command', commandId: focus.id })
  })
})
