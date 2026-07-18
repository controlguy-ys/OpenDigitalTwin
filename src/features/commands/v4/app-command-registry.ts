import type { AppCommandSectionV4, AppCommandV4 } from './app-command.js'

export interface AppCommandRegistryV4 {
  get(commandId: string): AppCommandV4 | null
  list(section: AppCommandSectionV4): readonly AppCommandV4[]
}

export function createAppCommandRegistryV4(
  commands: readonly AppCommandV4[],
): AppCommandRegistryV4 {
  const orderedCommands = [...commands]
  const commandsById = new Map<string, AppCommandV4>()

  for (const command of orderedCommands) {
    if (commandsById.has(command.id)) {
      throw new Error(`Duplicate App command id: ${command.id}`)
    }
    commandsById.set(command.id, command)
  }

  return {
    get(commandId) {
      return commandsById.get(commandId) ?? null
    },
    list(section) {
      return Object.freeze(orderedCommands.filter((command) => (
        command.section === section && command.visible
      )))
    },
  }
}
