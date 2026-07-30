import type { ReactNode } from 'react'

export interface ConnectivityMenuV6Props {
  readonly projectAvailable: boolean
  readonly onOpenOpcUaSettings: () => void
  readonly onOpenConnectionMonitor: (opener: HTMLButtonElement) => void
  readonly onOpenBindingOverview: () => void
  readonly onOpenDockerRunGuide: () => void
}

export function ConnectivityMenuV6({
  projectAvailable,
  onOpenOpcUaSettings,
  onOpenConnectionMonitor,
  onOpenBindingOverview,
  onOpenDockerRunGuide,
}: ConnectivityMenuV6Props): ReactNode {
  return <div aria-label="Connectivity" className="v6-connectivity-menu" role="group">
    <button disabled={!projectAvailable} onClick={onOpenOpcUaSettings} type="button">OPC UA Settings</button>
    <button onClick={(event) => onOpenConnectionMonitor(event.currentTarget)} type="button">Connection Monitor</button>
    <button disabled={!projectAvailable} onClick={onOpenBindingOverview} type="button">Binding Overview</button>
    <button onClick={onOpenDockerRunGuide} type="button">Docker Run Guide</button>
  </div>
}
