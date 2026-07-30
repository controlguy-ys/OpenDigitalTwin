import type { ReactNode } from 'react'

export interface ConnectivityMenuV6Props {
  readonly projectAvailable: boolean
  readonly onOpenOpcUaSettings: (opener: HTMLButtonElement) => void
  readonly onOpenConnectionMonitor: (opener: HTMLButtonElement) => void
  readonly onOpenBindingOverview: (opener: HTMLButtonElement) => void
  readonly onOpenDockerRunGuide: (opener: HTMLButtonElement) => void
}

export function ConnectivityMenuV6({
  projectAvailable,
  onOpenOpcUaSettings,
  onOpenConnectionMonitor,
  onOpenBindingOverview,
  onOpenDockerRunGuide,
}: ConnectivityMenuV6Props): ReactNode {
  return <div aria-label="Connectivity" className="v6-connectivity-menu" role="group">
    <button disabled={!projectAvailable} onClick={(event) => onOpenOpcUaSettings(event.currentTarget)} type="button">OPC UA Settings</button>
    <button onClick={(event) => onOpenConnectionMonitor(event.currentTarget)} type="button">Connection Monitor</button>
    <button disabled={!projectAvailable} onClick={(event) => onOpenBindingOverview(event.currentTarget)} type="button">Binding Overview</button>
    <button onClick={(event) => onOpenDockerRunGuide(event.currentTarget)} type="button">Docker Run Guide</button>
  </div>
}
