import type { AppCommandIdV6, AppCommandRegistryV6 } from '../../commands/v6/app-command-v6.js'
import { CommandSurfaceControlV6 } from './CommandSurfaceControlV6.js'

export interface ModelToolboxV6Props {
  readonly registry: AppCommandRegistryV6
}

const TOOLBOX_SECTIONS: readonly {
  readonly id: string
  readonly label: string
  readonly commands: readonly AppCommandIdV6[]
}[] = [
  {
    id: 'v6-toolbox-interaction',
    label: 'Interaction',
    commands: ['tool.select', 'tool.translate', 'tool.rotate'],
  },
  {
    id: 'v6-toolbox-geometry',
    label: 'Geometry',
    commands: ['model.addGroup', 'model.addBox', 'model.addCylinder'],
  },
  {
    id: 'v6-toolbox-camera',
    label: 'Camera',
    commands: ['view.focusSelection', 'view.fitAll'],
  },
]

export function ModelToolboxV6({ registry }: ModelToolboxV6Props) {
  return <aside aria-label="Model toolbox" className="v6-model-toolbox">
    {TOOLBOX_SECTIONS.map(({ commands, id, label }) => (
      <section aria-labelledby={id} className="v6-model-toolbox-section" key={id}>
        <h2 id={id}>{label}</h2>
        <div className="v6-model-toolbox-section-controls">
          {commands.map((commandId) => (
            <CommandSurfaceControlV6
              commandId={commandId}
              key={commandId}
              registry={registry}
              surface="toolbox"
            />
          ))}
        </div>
      </section>
    ))}
  </aside>
}
