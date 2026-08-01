import {
  useSyncExternalStore,
  type KeyboardEventHandler,
} from 'react'

import type {
  AppCommandIdV6,
  AppCommandRegistryV6,
  AppCommandSurfaceV6,
} from '../../commands/v6/app-command-v6.js'
import { ButtonV6 } from './ButtonV6.js'

interface CommandSurfaceControllerV6 {
  getVersion(): number
  subscribe(listener: () => void): () => void
  invoke(commandId: AppCommandIdV6): Promise<void>
}

const controllers = new WeakMap<AppCommandRegistryV6, CommandSurfaceControllerV6>()

function controllerFor(registry: AppCommandRegistryV6): CommandSurfaceControllerV6 {
  const existing = controllers.get(registry)
  if (existing !== undefined) return existing
  let version = 0
  const listeners = new Set<() => void>()
  const controller: CommandSurfaceControllerV6 = {
    getVersion: () => version,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async invoke(commandId) {
      await registry.invoke(commandId)
      version += 1
      listeners.forEach((listener) => listener())
    },
  }
  controllers.set(registry, controller)
  return controller
}

export async function invokeCommandSurfaceV6(
  registry: AppCommandRegistryV6,
  commandId: AppCommandIdV6,
): Promise<void> {
  await controllerFor(registry).invoke(commandId)
}

function menuItemRole(
  commandId: AppCommandIdV6,
  checked: boolean | undefined,
  surface: AppCommandSurfaceV6,
): 'menuitem' | 'menuitemcheckbox' | 'menuitemradio' | undefined {
  const menuSurface = surface.endsWith('-menu') || surface.endsWith('-context-menu')
  if (!menuSurface) return undefined
  if (checked === undefined) return 'menuitem'
  return commandId.startsWith('view.theme.') ? 'menuitemradio' : 'menuitemcheckbox'
}

export interface CommandSurfaceControlV6Props {
  readonly registry: AppCommandRegistryV6
  readonly commandId: AppCommandIdV6
  readonly surface: AppCommandSurfaceV6
  readonly ariaControls?: string
  readonly className?: string
  readonly onInvoked?: () => void
  readonly onKeyDown?: KeyboardEventHandler<HTMLButtonElement>
  readonly tabIndex?: number
}

export function CommandSurfaceControlV6({
  registry,
  commandId,
  surface,
  ariaControls,
  className,
  onInvoked,
  onKeyDown,
  tabIndex,
}: CommandSurfaceControlV6Props) {
  const controller = controllerFor(registry)
  useSyncExternalStore(controller.subscribe, controller.getVersion, controller.getVersion)
  const command = registry.get(commandId)
  if (command === null || !command.visible) return null
  const role = menuItemRole(command.id, command.checked, surface)
  const checkable = role === 'menuitemcheckbox' || role === 'menuitemradio'
  const toolbarButton = surface === 'main-view-pane-toolbar'
  return <ButtonV6
    aria-checked={checkable ? Boolean(command.checked) : undefined}
    aria-controls={ariaControls}
    aria-pressed={toolbarButton ? Boolean(command.checked) : undefined}
    className={['v6-command-surface-control', className].filter(Boolean).join(' ')}
    data-command-id={command.id}
    data-command-surface={surface}
    disabled={!command.enabled}
    onClick={(event) => {
      if (toolbarButton) event.currentTarget.focus()
      void controller.invoke(command.id).then(() => onInvoked?.())
    }}
    onKeyDown={onKeyDown}
    role={role}
    size="compact"
    tabIndex={tabIndex}
    variant={toolbarButton ? 'secondary' : 'ghost'}
  >{command.label}</ButtonV6>
}
