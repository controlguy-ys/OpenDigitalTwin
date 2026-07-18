import { describe, expect, it } from 'vitest'

import { createAppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'
import type { AppCommandV4 } from '../../commands/v4/app-command.js'
import {
  resolveRibbonContextV4,
  resolveRibbonItemsV4,
  RIBBON_QUICK_ACTION_IDS_V4,
  type RibbonContextV4,
} from './ribbon-model-v4.js'

function command(id: string, visible = true): AppCommandV4 {
  return {
    id,
    label: id,
    section: id.startsWith('model.') ? 'model' : id.startsWith('view.') ? 'view' : 'job',
    kind: 'action',
    visible,
    enabled: true,
    execute() {},
  }
}

function context(overrides: Partial<RibbonContextV4> = {}): RibbonContextV4 {
  return {
    selection: null,
    activeRobotId: null,
    activeJobId: null,
    previewSection: null,
    ...overrides,
  }
}

describe('ribbon-model-v4', () => {
  it('resolves Robot, Object, Job, and Empty target contexts to distinct command ids', () => {
    const registry = createAppCommandRegistryV4(
      ['robot.jog.open', 'robot.home', 'robot.base.edit', 'scene.visibility.toggle', 'scene.pose.edit', 'scene.parent.edit', 'scene.group.move', 'scene.status.edit', 'scene.delete', 'job.pose.save', 'job.start', 'job.cancel', 'job.rename', 'job.duplicate', 'job.delete', 'view.timeline.open', 'model.add.box', 'model.add.cylinder', 'model.add.group', 'view.fitAll'].map((id) => command(id)),
    )
    const robot = resolveRibbonContextV4({ context: context({ selection: { kind: 'robot', robotId: 'robot-1' } }), registry })
    const object = resolveRibbonContextV4({ context: context({ selection: { kind: 'spatial-entity', entityId: 'box-1' } }), registry })
    const job = resolveRibbonContextV4({ context: context({ activeJobId: 'job-1' }), registry })
    const empty = resolveRibbonContextV4({ context: context(), registry })

    expect(robot.kind).toBe('robot')
    expect(robot.items.map((item) => item.commandId)).toEqual(['robot.jog.open', 'robot.home', 'robot.base.edit', 'scene.visibility.toggle'])
    expect(object.kind).toBe('object')
    expect(object.items.map((item) => item.commandId)).toEqual(['scene.pose.edit', 'scene.parent.edit', 'scene.group.move', 'scene.status.edit', 'scene.visibility.toggle', 'scene.delete'])
    expect(job.kind).toBe('job')
    expect(job.items.map((item) => item.commandId)).toEqual(['job.pose.save', 'job.start', 'job.cancel', 'job.rename', 'job.duplicate', 'job.delete', 'view.timeline.open'])
    expect(empty.kind).toBe('empty')
    expect(empty.items.map((item) => item.commandId)).toEqual(['model.add.box', 'model.add.cylinder', 'model.add.group', 'view.fitAll'])
  })

  it('gives a global menu preview precedence and restores the target context when it closes', () => {
    const registry = createAppCommandRegistryV4([
      command('project.save'), command('project.new'), command('project.import'), command('robot.home'), command('robot.jog.open'), command('robot.base.edit'), command('scene.visibility.toggle'),
    ])
    const target = context({ selection: { kind: 'robot', robotId: 'robot-1' } })
    expect(resolveRibbonItemsV4({ context: target, registry }).map((item) => item.commandId)).toContain('robot.home')
    expect(resolveRibbonContextV4({ context: { ...target, previewSection: 'project' }, registry })).toMatchObject({ kind: 'menu', section: 'project' })
    expect(resolveRibbonItemsV4({ context: { ...target, previewSection: 'project' }, registry }).map((item) => item.commandId)).toContain('project.save')
    expect(resolveRibbonItemsV4({ context: target, registry }).map((item) => item.commandId)).toContain('robot.home')
  })

  it('filters hidden capabilities while preserving the explicit quick action contract', () => {
    const registry = createAppCommandRegistryV4([
      command('model.add.box'), command('model.add.cylinder', false), command('model.add.group'), command('view.fitAll'),
    ])
    expect(resolveRibbonItemsV4({ context: context(), registry }).map((item) => item.commandId)).toEqual(['model.add.box', 'model.add.group', 'view.fitAll'])
    expect(RIBBON_QUICK_ACTION_IDS_V4).toEqual(['project.save', 'job.start', 'job.cancel'])
  })

  it('uses one explicit frequent-command group for every global section', () => {
    const ids = [
      'project.save', 'project.new', 'project.import', 'view.focusSelection', 'robot.home', 'scene.visibility.toggle',
      'model.add.box', 'model.add.cylinder', 'model.add.group', 'job.new', 'job.pose.save', 'job.start', 'job.cancel',
      'collision.validate', 'connectivity.mode.server', 'connectivity.details.open', 'view.home', 'view.fitAll',
      'help.controls', 'help.stepImport', 'help.about',
    ]
    const registry = createAppCommandRegistryV4(ids.map((id) => command(id)))
    for (const section of ['project', 'home', 'model', 'job', 'simulation', 'connectivity', 'view', 'help'] as const) {
      const resolved = resolveRibbonContextV4({ context: context({ previewSection: section }), registry })
      expect(resolved.kind).toBe('menu')
      expect(resolved.section).toBe(section)
      expect(resolved.items.length).toBeGreaterThan(0)
    }
  })
})
