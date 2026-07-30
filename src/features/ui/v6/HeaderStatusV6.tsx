import { Check, Circle, Radio, TriangleAlert, XCircle, type LucideIcon } from 'lucide-react'

import type { ConnectivityPresentationStateV1 } from '../../connectivity/v5/connectivity-presentation-store.js'
import { StatusBadgeV6, type StatusBadgeStateV6 } from './StatusBadgeV6.js'

export interface HeaderStatusItemV6 {
  readonly icon: LucideIcon
  readonly label: string
  readonly state: StatusBadgeStateV6
}

export interface HeaderStatusV6Props {
  readonly projectName: string
  readonly saveState: 'Saved' | 'Unsaved' | 'Saving' | 'Error'
  readonly simulation: HeaderStatusItemV6
  readonly connectivity: ConnectivityPresentationStateV1
}

function gatewayBadge(connectivity: ConnectivityPresentationStateV1): HeaderStatusItemV6 {
  const gateway = connectivity.gateway
  if (gateway.state === 'online') return { icon: Check, label: `Gateway ${gateway.label}`, state: 'success' }
  if (gateway.state === 'activating') return { icon: Radio, label: `Gateway ${gateway.label}`, state: 'warning' }
  return { icon: XCircle, label: `Gateway ${gateway.label}`, state: 'fault' }
}

function opcUaBadge(connectivity: ConnectivityPresentationStateV1): HeaderStatusItemV6 {
  const opcUa = connectivity.opcUa
  if (opcUa.state === 'off') return { icon: Circle, label: `OPC UA ${opcUa.label}`, state: 'neutral' }
  if (opcUa.state === 'client-connected' || opcUa.state === 'server-listening' || opcUa.state === 'bridge-connected') {
    return { icon: Check, label: `OPC UA ${opcUa.label}`, state: 'success' }
  }
  if (opcUa.state === 'client-degraded' || opcUa.state === 'bridge-degraded') {
    return { icon: TriangleAlert, label: `OPC UA ${opcUa.label}`, state: 'warning' }
  }
  return { icon: XCircle, label: `OPC UA ${opcUa.label}`, state: 'fault' }
}

export function HeaderStatusV6({ projectName, saveState, simulation, connectivity }: HeaderStatusV6Props) {
  return <div data-one-row="true" data-testid="v6-header-status">
    <span>{projectName}</span>
    <span aria-label={`Project ${saveState}`}>{saveState}</span>
    <StatusBadgeV6 {...simulation} />
    <StatusBadgeV6 {...gatewayBadge(connectivity)} />
    <StatusBadgeV6 {...opcUaBadge(connectivity)} />
  </div>
}
