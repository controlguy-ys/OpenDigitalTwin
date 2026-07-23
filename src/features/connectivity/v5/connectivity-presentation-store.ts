import type { RuntimeGatewayStatusV1 } from '../../../core/runtime-protocol/gateway-status-v1.js'
import type { RuntimeIntegrationDiagnosticsV1 } from '../../../core/runtime-protocol/integration-diagnostics-v1.js'
import {
  createRuntimeGatewayStatusPollerV1,
  type RuntimeConnectivitySnapshotV1,
  type RuntimeGatewayStatusPollerV1,
} from '../../runtime-gateway/runtime-gateway-status-poller.js'
import { validateRuntimeConnectivitySnapshotV1 } from '../../runtime-gateway/v5/runtime-integration-diagnostics-client.js'

export type { RuntimeConnectivitySnapshotV1 } from '../../runtime-gateway/runtime-gateway-status-poller.js'

export type GatewayHeaderStateV1 = 'online' | 'offline' | 'activating' | 'error'
export type OpcUaHeaderStateV1 = 'off' | 'client-connected' | 'client-degraded' | 'server-listening' | 'bridge-connected' | 'bridge-degraded' | 'error'
export type LocalPublicationPhaseV1 = 'idle' | 'activating' | { readonly phase: 'error'; readonly message: string }

export interface ConnectivityPresentationStateV1 {
  readonly gateway: { readonly state: GatewayHeaderStateV1; readonly label: string; readonly detail: string }
  readonly opcUa: { readonly state: OpcUaHeaderStateV1; readonly label: string; readonly detail: string }
  readonly status: RuntimeGatewayStatusV1 | null
  readonly integrationDiagnostics: RuntimeIntegrationDiagnosticsV1 | null
  readonly transportError: string | null
  readonly lastObservedAtMs: number | null
}

export interface ConnectivityPresentationStoreV1 {
  startHeader(): void
  setMonitorOpen(open: boolean): void
  setPublicationPhase(phase: LocalPublicationPhaseV1): void
  getState(): ConnectivityPresentationStateV1
  subscribe(listener: () => void): () => void
  dispose(): void
  poller(): RuntimeGatewayStatusPollerV1
}

export interface ConnectivityPresentationStoreV1Options {
  readonly readConnectivitySnapshot: (signal?: AbortSignal) => Promise<RuntimeConnectivitySnapshotV1>
  readonly nowMs?: () => number
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function projectDetail(status: RuntimeGatewayStatusV1): string {
  return `Project: ${status.project.readinessCode}`
}

function connected(endpoint: RuntimeGatewayStatusV1['opcUa']['clientEndpoints'][number]): boolean {
  return endpoint.phase === 'connected' && endpoint.sessionActive && endpoint.subscriptionActive
}

function endpointError(status: RuntimeGatewayStatusV1): string | null {
  const serverError = status.opcUa.server.lastError
  if (status.opcUa.server.phase === 'faulted') return serverError?.message ?? 'OPC UA Server faulted.'
  const clientError = status.opcUa.clientEndpoints.find((endpoint) => endpoint.phase === 'faulted')?.lastError
  return clientError?.message ?? null
}

function opcUaPresentation(status: RuntimeGatewayStatusV1 | null): ConnectivityPresentationStateV1['opcUa'] {
  if (status === null) return Object.freeze({ state: 'error', label: 'Unavailable', detail: 'No decoded Runtime Gateway status is available.' })
  if (status.opcUa.mode === 'off') return Object.freeze({ state: 'off', label: 'Off', detail: projectDetail(status) })
  const fault = endpointError(status)
  if (fault !== null) return Object.freeze({ state: 'error', label: 'Error', detail: fault })
  const endpoints = status.opcUa.clientEndpoints
  const allConnected = endpoints.length > 0 && endpoints.every(connected)
  if (status.opcUa.mode === 'server') {
    return status.opcUa.server.phase === 'listening'
      ? Object.freeze({ state: 'server-listening', label: 'Listening', detail: projectDetail(status) })
      : Object.freeze({ state: 'error', label: 'Unavailable', detail: projectDetail(status) })
  }
  if (status.opcUa.mode === 'client') {
    return allConnected
      ? Object.freeze({ state: 'client-connected', label: 'Connected', detail: projectDetail(status) })
      : Object.freeze({ state: 'client-degraded', label: 'Degraded', detail: projectDetail(status) })
  }
  return status.opcUa.server.phase === 'listening' && allConnected
    ? Object.freeze({ state: 'bridge-connected', label: 'Connected', detail: projectDetail(status) })
    : Object.freeze({ state: 'bridge-degraded', label: 'Degraded', detail: projectDetail(status) })
}

export function deriveConnectivityPresentationV1(
  snapshot: RuntimeConnectivitySnapshotV1 | null,
  publicationPhase: LocalPublicationPhaseV1 = 'idle',
  transportError: string | null = null,
): ConnectivityPresentationStateV1 {
  const status = snapshot?.status ?? null
  const integrationDiagnostics = snapshot?.integrationDiagnostics ?? null
  const gateway = publicationPhase === 'activating'
    ? Object.freeze({ state: 'activating' as const, label: 'Activating', detail: 'Applying Project settings.' })
    : typeof publicationPhase === 'object'
      ? Object.freeze({ state: 'error' as const, label: 'Error', detail: publicationPhase.message })
      : transportError !== null
        ? Object.freeze({ state: 'offline' as const, label: 'Offline', detail: transportError })
        : status === null
          ? Object.freeze({ state: 'offline' as const, label: 'Offline', detail: 'Runtime Gateway has not responded yet.' })
          : Object.freeze({ state: 'online' as const, label: 'Online', detail: 'Runtime Gateway responded.' })
  return Object.freeze({
    gateway,
    opcUa: opcUaPresentation(status),
    status,
    integrationDiagnostics,
    transportError,
    lastObservedAtMs: status?.observedAtMs ?? null,
  })
}

export function createConnectivityPresentationStoreV1(
  options: ConnectivityPresentationStoreV1Options,
): ConnectivityPresentationStoreV1 {
  let latestSnapshot: RuntimeConnectivitySnapshotV1 | null = null
  let transportError: string | null = null
  let publicationPhase: LocalPublicationPhaseV1 = 'idle'
  let state = deriveConnectivityPresentationV1(latestSnapshot, publicationPhase, transportError)
  const listeners = new Set<() => void>()
  const publish = (): void => {
    state = deriveConnectivityPresentationV1(latestSnapshot, publicationPhase, transportError)
    listeners.forEach((listener) => listener())
  }
  const pollerOptions = {
    readConnectivitySnapshot: async (signal: AbortSignal | undefined) => {
      const snapshot = await options.readConnectivitySnapshot(signal)
      return validateRuntimeConnectivitySnapshotV1(snapshot)
    },
    onSnapshot: (snapshot: RuntimeConnectivitySnapshotV1) => {
      latestSnapshot = snapshot
      transportError = null
      publish()
    },
    onError: (error: unknown) => {
      transportError = message(error)
      publish()
    },
    ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
  }
  const poller = createRuntimeGatewayStatusPollerV1(pollerOptions)
  return Object.freeze({
    startHeader: () => poller.setDemand('header'),
    setMonitorOpen: (open: boolean) => poller.setDemand(open ? 'monitor' : 'header'),
    setPublicationPhase: (next: LocalPublicationPhaseV1) => { publicationPhase = next; publish() },
    getState: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    dispose: () => { poller.stop(); listeners.clear() },
    poller: () => poller,
  })
}
