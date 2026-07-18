import type { AppCommandSectionV4 } from '../../commands/v4/app-command.js'
import type { AppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'
import { APP_COMMAND_PLACEMENTS_BY_SECTION_V4 } from '../../../app/v4/app-command-composition.js'

export const APP_MENU_SECTIONS_V4 = Object.freeze([
  { id: 'project', label: 'Project' }, { id: 'home', label: 'Home' },
  { id: 'model', label: 'Model' }, { id: 'job', label: 'Job' },
  { id: 'simulation', label: 'Simulation' }, { id: 'connectivity', label: 'Connectivity' },
  { id: 'view', label: 'View' }, { id: 'help', label: 'Help' },
] as const)

export type AppMenuNodeV4 =
  | { readonly kind: 'command'; readonly commandId: string }
  | { readonly kind: 'submenu'; readonly id: string; readonly label: string; readonly children: readonly AppMenuNodeV4[] }
  | { readonly kind: 'separator'; readonly id: string }

export interface AppMenuSectionModelV4 {
  readonly id: AppCommandSectionV4
  readonly label: string
  readonly children: readonly AppMenuNodeV4[]
}

export interface AppMenuNavigationPropsV4 {
  readonly openSection: AppCommandSectionV4 | null
  readonly onOpenSectionChange: (section: AppCommandSectionV4 | null) => void
  readonly onPreviewSection: (section: AppCommandSectionV4 | null) => void
}

function freezeCommand(commandId: string): AppMenuNodeV4 {
  return Object.freeze({ kind: 'command' as const, commandId })
}

export function buildAppMenuModelV4(registry: AppCommandRegistryV4): readonly AppMenuSectionModelV4[] {
  const result: AppMenuSectionModelV4[] = []
  for (const section of APP_MENU_SECTIONS_V4) {
    const placements = APP_COMMAND_PLACEMENTS_BY_SECTION_V4[section.id]
    const groups: AppMenuNodeV4[][] = []
    let index = 0
    while (index < placements.length) {
      const placement = placements[index]!
      const key = placement.submenu?.id ?? null
      const group: AppMenuNodeV4[] = []
      const label = placement.submenu?.label
      while (index < placements.length && (placements[index]!.submenu?.id ?? null) === key) {
        const candidate = placements[index]!
        const command = registry.get(candidate.commandId)
        if (command?.visible === true) group.push(freezeCommand(candidate.commandId))
        index += 1
      }
      if (group.length === 0) continue
      if (key === null) groups.push(group)
      else groups.push([Object.freeze({ kind: 'submenu' as const, id: key, label: label!, children: Object.freeze(group) })])
    }
    const children: AppMenuNodeV4[] = []
    for (const group of groups) {
      if (children.length > 0) children.push(Object.freeze({ kind: 'separator' as const, id: `${section.id}.separator.${groups.indexOf(group)}` }))
      children.push(...group)
    }
    if (children.length > 0) result.push(Object.freeze({ id: section.id, label: section.label, children: Object.freeze(children) }))
  }
  return Object.freeze(result)
}
