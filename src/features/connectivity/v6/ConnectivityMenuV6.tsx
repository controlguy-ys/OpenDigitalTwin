import type { KeyboardEventHandler, ReactNode } from 'react'

export interface ConnectivityMenuV6Props {
  readonly projectAvailable: boolean
  readonly onOpenOpcUaSettings: (opener: HTMLButtonElement) => void
  readonly onOpenConnectionMonitor: (opener: HTMLButtonElement) => void
  readonly onOpenBindingOverview: (opener: HTMLButtonElement) => void
  readonly onOpenDockerRunGuide: (opener: HTMLButtonElement) => void
  readonly presentation?: 'group' | 'menu'
  readonly onMenuItemKeyDown?: KeyboardEventHandler<HTMLButtonElement>
}

export function ConnectivityMenuV6({
  projectAvailable,
  onOpenOpcUaSettings,
  onOpenConnectionMonitor,
  onOpenBindingOverview,
  onOpenDockerRunGuide,
  presentation = 'group',
  onMenuItemKeyDown,
}: ConnectivityMenuV6Props): ReactNode {
  const buttons = <>
    <button className="v6-connectivity-menu-item" disabled={!projectAvailable} onClick={(event) => onOpenOpcUaSettings(event.currentTarget)} onKeyDown={onMenuItemKeyDown} role={presentation === 'menu' ? 'menuitem' : undefined} type="button">OPC UA Settings</button>
    <button className="v6-connectivity-menu-item" onClick={(event) => onOpenConnectionMonitor(event.currentTarget)} onKeyDown={onMenuItemKeyDown} role={presentation === 'menu' ? 'menuitem' : undefined} type="button">Connection Monitor</button>
    <button className="v6-connectivity-menu-item" disabled={!projectAvailable} onClick={(event) => onOpenBindingOverview(event.currentTarget)} onKeyDown={onMenuItemKeyDown} role={presentation === 'menu' ? 'menuitem' : undefined} type="button">Binding Overview</button>
    <button className="v6-connectivity-menu-item" onClick={(event) => onOpenDockerRunGuide(event.currentTarget)} onKeyDown={onMenuItemKeyDown} role={presentation === 'menu' ? 'menuitem' : undefined} type="button">Docker Run Guide</button>
  </>
  return presentation === 'menu'
    ? buttons
    : <div aria-label="Connectivity" className="v6-connectivity-menu" role="group">{buttons}</div>
}
