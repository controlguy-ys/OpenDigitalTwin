export type AppCommandIdV6 =
  | 'project.new' | 'project.loadDemo' | 'project.save'
  | 'project.export' | 'project.import'
  | 'tool.select' | 'tool.translate' | 'tool.rotate'
  | 'model.addBox' | 'model.addCylinder'
  | 'view.focusSelection' | 'view.fitAll'
  | 'view.main.maximize'
  | 'scene.toggleVisibility' | 'scene.rename'
  | 'scene.duplicate' | 'scene.delete'
  | 'binding.open'
  | 'job.openEditor' | 'job.start' | 'job.cancel'
  | 'view.layout.reset'
  | 'view.theme.system' | 'view.theme.dark' | 'view.theme.light'
  | 'help.controls' | 'help.about'

export type AppCommandIconV6 = 'Maximize2' | 'Minimize2'

export interface AppCommandSnapshotV6 {
  readonly id: AppCommandIdV6
  readonly label: string
  readonly enabled: boolean
  readonly visible: boolean
  readonly checked?: boolean
  readonly shortcut?: string
  readonly icon?: AppCommandIconV6
  execute(): void | Promise<void>
}

export type AppCommandSurfaceV6 =
  | 'project-menu'
  | 'home-menu'
  | 'model-menu'
  | 'job-menu'
  | 'view-menu'
  | 'help-menu'
  | 'toolbox'
  | 'explorer-context-menu'
  | 'viewport-context-menu'
  | 'inspector'
  | 'main-view-pane-toolbar'

export interface AppCommandPlacementV6 {
  readonly commandId: AppCommandIdV6
  readonly surface: AppCommandSurfaceV6
}

export const V6_COMMAND_PLACEMENTS: readonly AppCommandPlacementV6[] = Object.freeze([
  { commandId: 'project.new', surface: 'project-menu' },
  { commandId: 'project.loadDemo', surface: 'project-menu' },
  { commandId: 'project.save', surface: 'project-menu' },
  { commandId: 'project.export', surface: 'project-menu' },
  { commandId: 'project.import', surface: 'project-menu' },
  { commandId: 'tool.select', surface: 'home-menu' },
  { commandId: 'tool.translate', surface: 'home-menu' },
  { commandId: 'tool.rotate', surface: 'home-menu' },
  { commandId: 'view.focusSelection', surface: 'home-menu' },
  { commandId: 'view.fitAll', surface: 'home-menu' },
  { commandId: 'tool.select', surface: 'toolbox' },
  { commandId: 'tool.translate', surface: 'toolbox' },
  { commandId: 'tool.rotate', surface: 'toolbox' },
  { commandId: 'model.addBox', surface: 'model-menu' },
  { commandId: 'model.addCylinder', surface: 'model-menu' },
  { commandId: 'model.addBox', surface: 'toolbox' },
  { commandId: 'model.addCylinder', surface: 'toolbox' },
  { commandId: 'view.focusSelection', surface: 'toolbox' },
  { commandId: 'view.fitAll', surface: 'toolbox' },
  { commandId: 'job.openEditor', surface: 'job-menu' },
  { commandId: 'job.start', surface: 'job-menu' },
  { commandId: 'job.cancel', surface: 'job-menu' },
  { commandId: 'view.focusSelection', surface: 'view-menu' },
  { commandId: 'view.fitAll', surface: 'view-menu' },
  { commandId: 'view.main.maximize', surface: 'view-menu' },
  { commandId: 'view.main.maximize', surface: 'main-view-pane-toolbar' },
  { commandId: 'view.layout.reset', surface: 'view-menu' },
  { commandId: 'view.theme.system', surface: 'view-menu' },
  { commandId: 'view.theme.dark', surface: 'view-menu' },
  { commandId: 'view.theme.light', surface: 'view-menu' },
  { commandId: 'scene.toggleVisibility', surface: 'explorer-context-menu' },
  { commandId: 'scene.rename', surface: 'explorer-context-menu' },
  { commandId: 'scene.duplicate', surface: 'explorer-context-menu' },
  { commandId: 'scene.delete', surface: 'explorer-context-menu' },
  { commandId: 'binding.open', surface: 'explorer-context-menu' },
  { commandId: 'scene.toggleVisibility', surface: 'viewport-context-menu' },
  { commandId: 'scene.rename', surface: 'viewport-context-menu' },
  { commandId: 'scene.duplicate', surface: 'viewport-context-menu' },
  { commandId: 'scene.delete', surface: 'viewport-context-menu' },
  { commandId: 'binding.open', surface: 'inspector' },
  { commandId: 'model.addBox', surface: 'viewport-context-menu' },
  { commandId: 'model.addCylinder', surface: 'viewport-context-menu' },
  { commandId: 'view.fitAll', surface: 'viewport-context-menu' },
  { commandId: 'help.controls', surface: 'help-menu' },
  { commandId: 'help.about', surface: 'help-menu' },
])

export interface AppCommandRegistryV6 {
  get(commandId: string): AppCommandSnapshotV6 | null
  invoke(commandId: string): Promise<void>
}

export function createAppCommandRegistryV6(
  commands: readonly AppCommandSnapshotV6[],
): AppCommandRegistryV6 {
  const commandsById = new Map<string, AppCommandSnapshotV6>()

  for (const command of commands) {
    if (commandsById.has(command.id)) {
      throw new Error(`Duplicate V6 command id: ${command.id}`)
    }
    commandsById.set(command.id, command)
  }

  return {
    get(commandId) {
      return commandsById.get(commandId) ?? null
    },
    async invoke(commandId) {
      const command = commandsById.get(commandId)
      if (command === undefined) throw new Error(`Unknown V6 command id: ${commandId}`)
      if (!command.visible) throw new Error(`Hidden V6 command id: ${commandId}`)
      if (!command.enabled) throw new Error(`Disabled V6 command id: ${commandId}`)
      await command.execute()
    },
  }
}
