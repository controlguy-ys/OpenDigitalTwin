import type { RobotIdV4, RobotJobIdV4 } from '../../../core/project-v4/index.js'
import { APP_CONTEXT_COMMAND_IDS_V4, APP_QUICK_ACTION_IDS_V4 } from '../../../app/v4/app-command-composition.js'
import type { AppCommandSectionV4 } from '../../commands/v4/app-command.js'
import type { AppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'
import type { SceneSelectionV4 } from '../../interaction/v4/scene-selection.js'

export interface RibbonContextV4 {
  readonly selection: SceneSelectionV4
  readonly activeRobotId: RobotIdV4 | null
  readonly activeJobId: RobotJobIdV4 | null
  readonly previewSection: AppCommandSectionV4 | null
}

export type AppIconKeyV4 =
  | 'save'
  | 'play'
  | 'cancel'
  | 'home'
  | 'box'
  | 'cylinder'
  | 'group'
  | 'timeline'
  | 'collision'
  | 'server'
  | 'view'

export interface RibbonItemSpecV4 {
  readonly commandId: string
  readonly priority: number
  readonly iconKey: AppIconKeyV4
}

export type RibbonContextKindV4 = 'menu' | 'robot' | 'object' | 'job' | 'empty'

export interface ResolvedRibbonContextV4 {
  readonly kind: RibbonContextKindV4
  readonly section: AppCommandSectionV4 | null
  readonly items: readonly RibbonItemSpecV4[]
}

export const RIBBON_QUICK_ACTION_IDS_V4 = APP_QUICK_ACTION_IDS_V4

const SECTION_COMMAND_IDS_V4: Readonly<Record<AppCommandSectionV4, readonly string[]>> = Object.freeze({
  project: Object.freeze(['project.save', 'project.new', 'project.import']),
  home: Object.freeze(['view.focusSelection', 'robot.home', 'scene.visibility.toggle']),
  model: Object.freeze(['model.add.box', 'model.add.cylinder', 'model.add.group']),
  job: Object.freeze(['job.new', 'job.pose.save', 'job.start', 'job.cancel']),
  simulation: Object.freeze(['job.start', 'job.cancel', 'collision.validate']),
  connectivity: Object.freeze(['connectivity.settings.open', 'connectivity.monitor.open']),
  view: Object.freeze(['view.home', 'view.fitAll', 'view.focusSelection']),
  help: Object.freeze(['help.controls', 'help.stepImport', 'help.about']),
})

const ITEM_SPECS_BY_COMMAND_ID_V4: Readonly<Record<string, RibbonItemSpecV4>> = Object.freeze({
  'project.save': Object.freeze({ commandId: 'project.save', priority: 10, iconKey: 'save' }),
  'project.new': Object.freeze({ commandId: 'project.new', priority: 20, iconKey: 'box' }),
  'project.import': Object.freeze({ commandId: 'project.import', priority: 30, iconKey: 'box' }),
  'view.focusSelection': Object.freeze({ commandId: 'view.focusSelection', priority: 20, iconKey: 'view' }),
  'robot.home': Object.freeze({ commandId: 'robot.home', priority: 10, iconKey: 'home' }),
  'scene.visibility.toggle': Object.freeze({ commandId: 'scene.visibility.toggle', priority: 40, iconKey: 'view' }),
  'model.add.box': Object.freeze({ commandId: 'model.add.box', priority: 10, iconKey: 'box' }),
  'model.add.cylinder': Object.freeze({ commandId: 'model.add.cylinder', priority: 20, iconKey: 'cylinder' }),
  'model.add.group': Object.freeze({ commandId: 'model.add.group', priority: 30, iconKey: 'group' }),
  'job.new': Object.freeze({ commandId: 'job.new', priority: 10, iconKey: 'timeline' }),
  'job.pose.save': Object.freeze({ commandId: 'job.pose.save', priority: 10, iconKey: 'save' }),
  'job.start': Object.freeze({ commandId: 'job.start', priority: 20, iconKey: 'play' }),
  'job.cancel': Object.freeze({ commandId: 'job.cancel', priority: 30, iconKey: 'cancel' }),
  'collision.validate': Object.freeze({ commandId: 'collision.validate', priority: 30, iconKey: 'collision' }),
  'connectivity.settings.open': Object.freeze({ commandId: 'connectivity.settings.open', priority: 10, iconKey: 'server' }),
  'connectivity.monitor.open': Object.freeze({ commandId: 'connectivity.monitor.open', priority: 20, iconKey: 'server' }),
  'view.home': Object.freeze({ commandId: 'view.home', priority: 10, iconKey: 'home' }),
  'view.fitAll': Object.freeze({ commandId: 'view.fitAll', priority: 20, iconKey: 'view' }),
  'help.controls': Object.freeze({ commandId: 'help.controls', priority: 10, iconKey: 'view' }),
  'help.stepImport': Object.freeze({ commandId: 'help.stepImport', priority: 20, iconKey: 'box' }),
  'help.about': Object.freeze({ commandId: 'help.about', priority: 30, iconKey: 'view' }),
  'robot.jog.open': Object.freeze({ commandId: 'robot.jog.open', priority: 10, iconKey: 'view' }),
  'robot.base.edit': Object.freeze({ commandId: 'robot.base.edit', priority: 30, iconKey: 'home' }),
  'scene.pose.edit': Object.freeze({ commandId: 'scene.pose.edit', priority: 10, iconKey: 'view' }),
  'scene.parent.edit': Object.freeze({ commandId: 'scene.parent.edit', priority: 20, iconKey: 'group' }),
  'scene.group.move': Object.freeze({ commandId: 'scene.group.move', priority: 30, iconKey: 'group' }),
  'scene.status.edit': Object.freeze({ commandId: 'scene.status.edit', priority: 40, iconKey: 'view' }),
  'scene.delete': Object.freeze({ commandId: 'scene.delete', priority: 50, iconKey: 'cancel' }),
  'job.rename': Object.freeze({ commandId: 'job.rename', priority: 40, iconKey: 'timeline' }),
  'job.duplicate': Object.freeze({ commandId: 'job.duplicate', priority: 50, iconKey: 'timeline' }),
  'job.delete': Object.freeze({ commandId: 'job.delete', priority: 60, iconKey: 'cancel' }),
  'view.timeline.open': Object.freeze({ commandId: 'view.timeline.open', priority: 70, iconKey: 'timeline' }),
})

function targetKind(context: RibbonContextV4): RibbonContextKindV4 {
  if (context.previewSection !== null) return 'menu'
  if (
    context.selection?.kind === 'robot'
    || context.selection?.kind === 'robot-link'
    || context.selection?.kind === 'robot-frame'
  ) return 'robot'
  if (context.selection !== null) return 'object'
  if (context.activeJobId !== null) return 'job'
  return 'empty'
}

function commandIds(context: RibbonContextV4, kind: RibbonContextKindV4): readonly string[] {
  if (kind === 'menu') return SECTION_COMMAND_IDS_V4[context.previewSection!]
  if (kind === 'robot') return APP_CONTEXT_COMMAND_IDS_V4.robot
  if (kind === 'object') return APP_CONTEXT_COMMAND_IDS_V4.object
  if (kind === 'job') return APP_CONTEXT_COMMAND_IDS_V4.job
  return APP_CONTEXT_COMMAND_IDS_V4.empty
}

function visibleItems(commandIds: readonly string[], registry: AppCommandRegistryV4): readonly RibbonItemSpecV4[] {
  return Object.freeze(commandIds.flatMap((commandId) => {
    const command = registry.get(commandId)
    const spec = ITEM_SPECS_BY_COMMAND_ID_V4[commandId]
    return command?.visible === true && spec !== undefined ? [spec] : []
  }))
}

export function resolveRibbonContextV4(input: {
  readonly context: RibbonContextV4
  readonly registry: AppCommandRegistryV4
}): ResolvedRibbonContextV4 {
  const kind = targetKind(input.context)
  return Object.freeze({
    kind,
    section: kind === 'menu' ? input.context.previewSection : null,
    items: visibleItems(commandIds(input.context, kind), input.registry),
  })
}

export function resolveRibbonItemsV4(input: {
  readonly context: RibbonContextV4
  readonly registry: AppCommandRegistryV4
}): readonly RibbonItemSpecV4[] {
  return resolveRibbonContextV4(input).items
}
