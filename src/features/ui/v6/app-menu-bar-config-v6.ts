import type {
  AppCommandIdV6,
  AppCommandSurfaceV6,
} from '../../commands/v6/app-command-v6.js'

export const MENU_COMMANDS_V6: Readonly<Record<string, readonly AppCommandIdV6[]>> = Object.freeze({
  Project: ['project.new', 'project.loadDemo', 'project.save', 'project.export', 'project.import'],
  Home: ['tool.select', 'tool.translate', 'tool.rotate', 'view.focusSelection', 'view.fitAll'],
  Model: ['model.addGroup', 'model.addBox', 'model.addCylinder'],
  Job: ['job.openEditor', 'job.start', 'job.cancel'],
  Simulation: [],
  Connectivity: [],
  View: ['view.focusSelection', 'view.fitAll', 'view.main.maximize', 'view.layout.reset', 'view.theme.system', 'view.theme.dark', 'view.theme.light'],
  Help: ['help.controls', 'help.about'],
})

export const MENU_NAMES_V6 = Object.freeze(Object.keys(MENU_COMMANDS_V6))

export const MENU_SURFACES_V6: Readonly<Record<string, AppCommandSurfaceV6 | undefined>> = Object.freeze({
  Project: 'project-menu',
  Home: 'home-menu',
  Model: 'model-menu',
  Job: 'job-menu',
  Simulation: undefined,
  Connectivity: undefined,
  View: 'view-menu',
  Help: 'help-menu',
})

export function isEditableMenuTargetV6(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}
