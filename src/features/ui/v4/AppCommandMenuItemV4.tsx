import { forwardRef, type ForwardRefExoticComponent, type RefAttributes } from 'react'

import type { AppCommandOutcomeV4 } from '../../commands/v4/app-command.js'
import type { AppCommandBindingsV4 } from '../../commands/v4/app-command-runtime.js'
import { useAppCommandV4 } from '../../commands/v4/use-app-command.js'

export interface AppCommandMenuItemPropsV4 {
  readonly commandBindings: AppCommandBindingsV4
  readonly commandId: string
  readonly tabIndex?: -1 | 0
  readonly onOutcome: (commandId: string, outcome: AppCommandOutcomeV4) => void
}

function idPart(id: string): string { return id.replace(/[^a-zA-Z0-9_-]/g, '-') }

export const AppCommandMenuItemV4: ForwardRefExoticComponent<
  AppCommandMenuItemPropsV4 & RefAttributes<HTMLButtonElement>
> = forwardRef<HTMLButtonElement, AppCommandMenuItemPropsV4>(function AppCommandMenuItemV4(
  { commandBindings, commandId, tabIndex = -1, onOutcome }, ref,
) {
  const { command, pending, error, invoke } = useAppCommandV4(commandBindings, commandId)
  if (command === null || command.visible !== true) return null
  const disabled = command.enabled !== true || pending
  const role = command.kind === 'toggle' ? 'menuitemcheckbox' : command.kind === 'radio' ? 'menuitemradio' : 'menuitem'
  const errorId = `app-command-error-${idPart(commandId)}`
  const title = pending ? 'Command in progress.' : command.disabledReason
  const shortcut = command.shortcut?.replace(/\bCtrl\b/gi, 'Control')
  return <>
    <button
      ref={ref}
      type="button"
      role={role}
      className="app-command-menu-item-v4"
      tabIndex={tabIndex}
      aria-checked={command.kind === 'action' ? undefined : command.checked === true}
      aria-disabled={disabled || undefined}
      aria-busy={pending || undefined}
      aria-keyshortcuts={shortcut}
      aria-describedby={error === null ? undefined : errorId}
      title={title}
      data-pending={pending || undefined}
      data-destructive={command.destructive === true || undefined}
      data-menu-direct="true"
      onClick={() => { if (!disabled) void invoke().then((outcome) => onOutcome(commandId, outcome)) }}
      onKeyDown={(event) => { if (disabled && (event.key === 'Enter' || event.key === ' ')) event.preventDefault() }}
    >
      <span>{command.label}</span>
      {command.shortcut === undefined ? null : <kbd aria-hidden="true">{command.shortcut}</kbd>}
    </button>
    {error === null ? null : <span id={errorId} role="alert" className="app-command-menu-error-v4">{error}</span>}
  </>
})
