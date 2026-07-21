import { describe, expect, it } from 'vitest'

import { createAppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'
import type { AppCommandV4 } from '../../commands/v4/app-command.js'
import { APP_MENU_SECTIONS_V4, buildAppMenuModelV4 } from './app-menu-model.js'

function command(id: string, section: AppCommandV4['section'], visible = true): AppCommandV4 {
  return { id, label: id, section, kind: 'action', visible, enabled: true, execute() {} }
}

const COMPLETE_CATALOG = [
  ['project.new', 'project'], ['project.save', 'project'], ['project.import', 'project'], ['project.export', 'project'], ['project.sample.dual', 'project'], ['project.sample.handover', 'project'],
  ['view.focusSelection', 'view'], ['scene.rename', 'home'], ['scene.pose.copy', 'home'], ['scene.pose.paste', 'home'], ['scene.pose.reset', 'home'], ['scene.visibility.toggle', 'home'], ['scene.isolate', 'home'], ['scene.showAll', 'home'], ['scene.delete', 'home'], ['robot.home', 'home'], ['robot.gripper.open', 'home'], ['robot.gripper.close', 'home'],
  ['model.importRobotStep', 'model'], ['model.add.box', 'model'], ['model.add.cylinder', 'model'], ['model.add.group', 'model'], ['scene.group.move', 'model'], ['scene.group.remove', 'model'], ['robot.base.edit', 'model'], ['robot.mount.edit', 'model'],
  ['job.new', 'job'], ['job.pose.save', 'job'], ['job.start', 'job'], ['job.cancel', 'job'], ['job.reset', 'job'], ['job.rename', 'job'], ['job.duplicate', 'job'], ['job.delete', 'job'], ['view.timeline.open', 'job'],
  ['collision.validate', 'simulation'], ['view.collision.open', 'simulation'], ['simulation.fault.gripConfirmTimeout', 'simulation'],
  ['connectivity.mode.off', 'connectivity'], ['connectivity.mode.client', 'connectivity'], ['connectivity.mode.server', 'connectivity'], ['connectivity.mode.bridge', 'connectivity'], ['connectivity.details.open', 'connectivity'],
  ['view.sidebar', 'view'], ['view.inspector', 'view'], ['view.bottom', 'view'], ['view.ribbon', 'view'], ['view.layout.reset', 'view'], ['view.theme.system', 'view'], ['view.theme.light', 'view'], ['view.theme.dark', 'view'], ['view.layer.grid', 'view'], ['view.layer.world', 'view'], ['view.layer.mcp', 'view'], ['view.layer.base', 'view'], ['view.layer.tcp', 'view'], ['view.home', 'view'], ['view.fitAll', 'view'], ['view.orientation.isometric', 'view'], ['view.orientation.top', 'view'], ['view.orientation.front', 'view'], ['view.orientation.right', 'view'], ['view.orientation.back', 'view'], ['view.orientation.left', 'view'], ['view.orientation.bottom', 'view'],
  ['help.controls', 'help'], ['help.stepImport', 'help'], ['help.opcUaMapping', 'help'], ['help.about', 'help'],
] as const satisfies readonly (readonly [string, AppCommandV4['section']])[]

function completeRegistry(hidden: readonly string[] = []) {
  return createAppCommandRegistryV4(COMPLETE_CATALOG.map(([id, section]) => command(id, section, !hidden.includes(id))))
}

function commandIds(nodes: readonly unknown[]): string[] {
  return nodes.map((node) => (node as { commandId: string }).commandId)
}

describe('buildAppMenuModelV4', () => {
  it('freezes every canonical section descriptor', () => {
    expect(APP_MENU_SECTIONS_V4.every((section) => Object.isFrozen(section))).toBe(true)
  })
  it('keeps placement order, submenus, separators, and cross-section ids', () => {
    const commands = [
      command('project.new', 'project'), command('project.save', 'project'), command('project.import', 'project'), command('project.export', 'project'), command('project.sample.dual', 'project'), command('project.sample.handover', 'project'),
      command('connectivity.mode.off', 'connectivity'), command('connectivity.mode.client', 'connectivity'), command('connectivity.mode.server', 'connectivity'), command('connectivity.mode.bridge', 'connectivity'), command('connectivity.details.open', 'connectivity'),
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

  it('models all eight canonical sections with the reviewed Connectivity and View subgroup matrix', () => {
    const model = buildAppMenuModelV4(completeRegistry())
    expect(model.map(({ id }) => id)).toEqual(['project', 'home', 'model', 'job', 'simulation', 'connectivity', 'view', 'help'])
    const connectivity = model.find((section) => section.id === 'connectivity')!
    expect(connectivity.children).toMatchObject([
      { kind: 'submenu', id: 'connectivity.runtime-mode', label: 'Runtime Mode' },
      { kind: 'separator', id: 'connectivity.separator.1' },
      { kind: 'command', commandId: 'connectivity.details.open' },
    ])
    expect(commandIds((connectivity.children[0] as Extract<typeof connectivity.children[number], { kind: 'submenu' }>).children)).toEqual(['connectivity.mode.off', 'connectivity.mode.client', 'connectivity.mode.server', 'connectivity.mode.bridge'])
    const view = model.find((section) => section.id === 'view')!
    const groups = view.children.filter((node): node is Extract<typeof node, { kind: 'submenu' }> => node.kind === 'submenu')
    expect(groups.map(({ id, label }) => [id, label])).toEqual([
      ['view.panels', 'Panels'], ['view.theme', 'Theme'], ['view.layers', 'Layers'], ['view.camera', 'Camera'], ['view.standard-views', 'Standard Views'],
    ])
    expect(groups.map(({ children }) => commandIds(children))).toEqual([
      ['view.sidebar', 'view.inspector', 'view.bottom', 'view.ribbon', 'view.layout.reset'],
      ['view.theme.system', 'view.theme.light', 'view.theme.dark'],
      ['view.layer.grid', 'view.layer.world', 'view.layer.mcp', 'view.layer.base', 'view.layer.tcp'],
      ['view.home', 'view.fitAll', 'view.focusSelection'],
      ['view.orientation.isometric', 'view.orientation.top', 'view.orientation.front', 'view.orientation.right', 'view.orientation.back', 'view.orientation.left', 'view.orientation.bottom'],
    ])
    const simulation = model.find((section) => section.id === 'simulation')!
    expect(simulation.children.at(-1)).toMatchObject({
      kind: 'submenu', id: 'simulation.faults', label: 'Fault Injection',
      children: [{ kind: 'command', commandId: 'simulation.fault.gripConfirmTimeout' }],
    })
  })

  it('uses stable cross-placement references and never exceeds section-submenu-command depth', () => {
    const registry = completeRegistry()
    const model = buildAppMenuModelV4(registry)
    const byId = (sectionId: string, commandId: string) => model.find(({ id }) => id === sectionId)!.children.find((node) => node.kind === 'command' && node.commandId === commandId)
    expect(byId('home', 'view.focusSelection')).toEqual({ kind: 'command', commandId: 'view.focusSelection' })
    expect(byId('job', 'job.start')).toEqual({ kind: 'command', commandId: 'job.start' })
    expect(byId('simulation', 'job.start')).toEqual({ kind: 'command', commandId: 'job.start' })
    expect(registry.get('view.focusSelection')).toBe(registry.get('view.focusSelection'))
    for (const section of model) for (const node of section.children) {
      expect(node.kind === 'submenu' ? node.children.every((child) => child.kind === 'command') : true).toBe(true)
    }
  })

  it('removes only unavailable Help nodes before removing the complete Help section', () => {
    const partial = buildAppMenuModelV4(completeRegistry(['help.opcUaMapping']))
    expect(partial.find(({ id }) => id === 'help')!.children).toEqual([
      { kind: 'command', commandId: 'help.controls' }, { kind: 'command', commandId: 'help.stepImport' }, { kind: 'command', commandId: 'help.about' },
    ])
    const absent = buildAppMenuModelV4(completeRegistry(['help.controls', 'help.stepImport', 'help.opcUaMapping', 'help.about']))
    expect(absent.some(({ id }) => id === 'help')).toBe(false)
  })

  it('makes the complete nested result mutation-safe against deep mutation attempts', () => {
    const model = buildAppMenuModelV4(completeRegistry())
    const before = JSON.stringify(model)
    const view = model.find(({ id }) => id === 'view')!
    const camera = view.children.find((node) => node.kind === 'submenu' && node.id === 'view.camera') as Extract<typeof view.children[number], { kind: 'submenu' }>
    expect(() => (model as unknown as unknown[]).push({})).toThrow()
    expect(() => (view.children as unknown as unknown[]).pop()).toThrow()
    expect(() => (camera.children as unknown as unknown[]).splice(0, 1)).toThrow()
    expect(() => { (camera as { label: string }).label = 'Changed' }).toThrow()
    expect(JSON.stringify(model)).toBe(before)
  })
})
