import { useState } from 'react'

import type { AppCommandIdV6, AppCommandRegistryV6 } from '../../commands/v6/app-command-v6.js'

export interface ModelToolboxV6Props {
  readonly registry: AppCommandRegistryV6
}

const TOOLBOX_COMMANDS: readonly AppCommandIdV6[] = [
  'tool.select', 'tool.translate', 'tool.rotate',
  'model.addBox', 'model.addCylinder', 'view.focusSelection', 'view.fitAll',
]

export function ModelToolboxV6({ registry }: ModelToolboxV6Props) {
  const [, refresh] = useState(0)
  return <aside aria-label="Model toolbox">
    {TOOLBOX_COMMANDS.map((id) => {
      const command = registry.get(id)
      if (command === null || !command.visible) return null
      return <button
        aria-pressed={command.checked}
        data-command-id={command.id}
        disabled={!command.enabled}
        key={command.id}
        onClick={() => { void registry.invoke(command.id).then(() => refresh((value) => value + 1)) }}
        type="button"
      >{command.label}</button>
    })}
  </aside>
}
