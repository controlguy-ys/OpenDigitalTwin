import { Maximize2, Minimize2 } from 'lucide-react'
import { useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'

import type { AppCommandRegistryV6 } from '../../commands/v6/app-command-v6.js'
import { invokeCommandSurfaceV6 } from '../../ui/v6/CommandSurfaceControlV6.js'
import { IconButtonV6 } from '../../ui/v6/IconButtonV6.js'
import type { WorkspaceLayoutStoreV6 } from '../../ui/v6/workspace-layout-store-v6.js'

export interface WorkcellViewportV6Props {
  readonly registry: AppCommandRegistryV6
  readonly canvas: ReactNode
  readonly overlay?: ReactNode
  readonly onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void
  readonly layoutStore?: WorkspaceLayoutStoreV6
}

const noSubscription = () => () => {}
const workspacePresentation = () => 'workspace' as const

export function isCameraPointerInputV6(button: number, shiftKey: boolean): 'select' | 'orbit' | 'pan' | 'context-menu' | null {
  if (button === 0) return 'select'
  if (button === 1) return shiftKey ? 'pan' : 'orbit'
  if (button === 2) return 'context-menu'
  return null
}

export function WorkcellViewportV6({ canvas, layoutStore, onContextMenu, overlay, registry }: WorkcellViewportV6Props) {
  const [, setVersion] = useState(0)
  const presentation = useSyncExternalStore(
    layoutStore?.subscribe ?? noSubscription,
    layoutStore === undefined ? workspacePresentation : () => layoutStore.getState().mainViewPresentation,
    workspacePresentation,
  )
  const command = registry.get('view.main.maximize')
  if (command === null || !command.visible) throw new Error('Main View presentation command is required.')
  const maximized = layoutStore === undefined ? Boolean(command.checked) : presentation === 'maximized'
  const label = maximized ? 'Restore Main View' : 'Maximize Main View'
  const Icon = maximized ? Minimize2 : Maximize2
  return <section aria-label="Main View" className="v6-workcell-viewport" id="v6-main-view">
    <div className="v6-main-view-toolbar" role="toolbar">
      <IconButtonV6
        aria-controls="v6-main-view"
        aria-pressed={maximized}
        data-command-id="view.main.maximize"
        data-command-surface="main-view-pane-toolbar"
        icon={Icon}
        label={label}
        onClick={(event) => {
          event.currentTarget.focus()
          void invokeCommandSurfaceV6(registry, 'view.main.maximize')
          setVersion((version) => version + 1)
        }}
      />
    </div>
    <div
      className="v6-main-view-canvas-host"
      data-camera-mapping="left:select,middle:orbit,shift+middle:pan,wheel:zoom,right:context-menu"
      data-testid="v6-canvas-host"
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu?.(event)
      }}
    >
      {canvas}
      {overlay}
    </div>
  </section>
}
