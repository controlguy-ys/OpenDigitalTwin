import type { RuntimeGatewayDiagnosticErrorV1, RuntimeGatewayStatusV1 } from '../../../core/runtime-protocol/gateway-status-v1.js'
import type { RuntimeIntegrationDiagnosticsV1 } from '../../../core/runtime-protocol/integration-diagnostics-v1.js'

import type { ConnectivityPresentationStateV1 } from './connectivity-presentation-store.js'

export interface ConnectionMonitorRowV1 {
  readonly id: string
  readonly component: string
  readonly state: string
  readonly endpoint: string | null
  readonly lastUpdateAtMs: number | null
  readonly quality: string | null
  readonly error: {
    readonly code: string
    readonly message: string
    readonly occurredAtMs: number | null
  } | null
  readonly details: readonly ConnectionMonitorDetailV1[]
}

export type ConnectionMonitorDetailV1 =
  | { readonly kind: 'text'; readonly label: string; readonly value: string }
  | { readonly kind: 'timestamp'; readonly label: string; readonly timestampMs: number | null }

type DetailV1 = ConnectionMonitorRowV1['details'][number]

function detail(label: string, value: string): DetailV1 {
  return Object.freeze({ kind: 'text', label, value })
}

function timestampDetail(label: string, timestampMs: number | null): DetailV1 {
  return Object.freeze({ kind: 'timestamp', label, timestampMs })
}

function unavailable(id: string, component: string, reason: string): ConnectionMonitorRowV1 {
  return Object.freeze({
    id,
    component,
    state: 'Unavailable',
    endpoint: null,
    lastUpdateAtMs: null,
    quality: null,
    error: null,
    details: Object.freeze([detail('Availability', reason)]),
  })
}

function statusFreshness(stale: boolean): DetailV1 {
  return detail('Freshness', stale ? 'Stale retained data' : 'Current decoded data')
}

function humanize(value: string): string {
  return value
    .split('-')
    .map((word) => word.length === 0 ? word : `${word[0]!.toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ')
}

function sameAuthorityTuple(
  status: RuntimeGatewayStatusV1,
  diagnostics: RuntimeIntegrationDiagnosticsV1,
): boolean {
  return status.project.projectId === diagnostics.projectId
    && status.project.revisionId === diagnostics.revisionId
    && status.project.configRevision === diagnostics.configRevision
}

function orderedEndpoints(status: RuntimeGatewayStatusV1): readonly RuntimeGatewayStatusV1['opcUa']['clientEndpoints'][number][] {
  return [...status.opcUa.clientEndpoints].sort((left, right) => (
    left.endpointId < right.endpointId ? -1 : left.endpointId > right.endpointId ? 1 : 0
  ))
}

function errorOrNull(error: RuntimeGatewayDiagnosticErrorV1 | null): RuntimeGatewayDiagnosticErrorV1 | null {
  return error === null ? null : Object.freeze({ ...error })
}

function proxyRow(presentation: ConnectivityPresentationStateV1): ConnectionMonitorRowV1 {
  if (presentation.transportError !== null) {
    return Object.freeze({
      id: 'web-proxy',
      component: 'Web proxy',
      state: 'Error',
      endpoint: null,
      lastUpdateAtMs: null,
      quality: null,
      error: Object.freeze({ code: 'RUNTIME_GATEWAY_TRANSPORT_ERROR', message: presentation.transportError, occurredAtMs: null }),
      details: Object.freeze([detail('Freshness', 'Current transport error')]),
    })
  }
  if (presentation.status === null) return unavailable('web-proxy', 'Web proxy', 'No decoded Runtime Gateway status.')
  return Object.freeze({
    id: 'web-proxy', component: 'Web proxy', state: 'Online', endpoint: null,
    lastUpdateAtMs: presentation.lastObservedAtMs, quality: 'GOOD', error: null,
    details: Object.freeze([detail('Freshness', 'Current decoded data')]),
  })
}

function statusRows(status: RuntimeGatewayStatusV1, stale: boolean): readonly ConnectionMonitorRowV1[] {
  const freshness = statusFreshness(stale)
  const httpBinding = `${status.deployment.http.bindHost}:${status.deployment.http.port}`
  const gateway = Object.freeze({
    id: 'gateway', component: 'Runtime Gateway', state: 'Online', endpoint: httpBinding,
    lastUpdateAtMs: status.observedAtMs, quality: 'GOOD', error: null,
    details: Object.freeze([
      detail('Gateway ID', status.gateway.gatewayId),
      detail('Runtime kind', status.gateway.runtimeKind),
      detail('HTTP bind', httpBinding),
      timestampDetail('Observed', status.observedAtMs),
      freshness,
    ]),
  })
  const project = Object.freeze({
    id: 'project', component: 'Project', state: humanize(status.project.phase), endpoint: null,
    lastUpdateAtMs: status.observedAtMs, quality: status.project.readinessCode, error: null,
    details: Object.freeze([
      detail('Authority', status.project.authorityPhase),
      detail('Project ID', status.project.projectId ?? 'None'),
      detail('Revision', status.project.revisionId ?? 'None'),
      detail('Configuration revision', status.project.configRevision ?? 'None'),
      detail('Activation attempt', status.project.activationAttemptId ?? 'None'),
      detail('Readiness', status.project.readinessCode),
      freshness,
    ]),
  })
  const server = Object.freeze({
    id: 'opcua-server', component: 'OPC UA Server', state: humanize(status.opcUa.server.phase),
    endpoint: status.opcUa.server.endpointUrl, lastUpdateAtMs: status.observedAtMs,
    quality: status.opcUa.server.phase === 'listening' ? 'GOOD' : null,
    error: errorOrNull(status.opcUa.server.lastError),
    details: Object.freeze([
      detail('Mode', status.opcUa.mode),
      detail('Bind', `${status.deployment.opcUaServer.bindHost}:${status.deployment.opcUaServer.port}`),
      detail('Advertised', `${status.deployment.opcUaServer.advertisedHost}:${status.deployment.opcUaServer.advertisedPort}`),
      freshness,
    ]),
  })
  const clients = orderedEndpoints(status).map((endpoint) => Object.freeze({
    id: `opcua-client:${endpoint.endpointId}`, component: 'OPC UA Client', state: humanize(endpoint.phase),
    endpoint: endpoint.endpointUrl, lastUpdateAtMs: endpoint.lastNotificationAtMs ?? status.observedAtMs,
    quality: endpoint.lastValueQuality, error: errorOrNull(endpoint.lastError),
    details: Object.freeze([
      detail('Endpoint ID', endpoint.endpointId),
      detail('Session', endpoint.sessionActive ? 'Active' : 'Inactive'),
      detail('Subscription', endpoint.subscriptionActive ? 'Active' : 'Inactive'),
      detail('Monitored items', String(endpoint.monitoredItemCount)),
      detail('Mappings', String(endpoint.mappingCount)),
      timestampDetail('Last notification', endpoint.lastNotificationAtMs),
      timestampDetail('Last GOOD', endpoint.lastGoodValueAtMs),
      detail('Reconnect attempt', String(endpoint.reconnectAttempt)),
      timestampDetail('Next retry', endpoint.nextRetryAtMs),
      freshness,
    ]),
  }))
  return Object.freeze([gateway, project, server, ...clients])
}

function diagnosticsRows(
  status: RuntimeGatewayStatusV1 | null,
  diagnostics: RuntimeIntegrationDiagnosticsV1 | null,
  stale: boolean,
): readonly ConnectionMonitorRowV1[] {
  if (status === null) return Object.freeze([
    unavailable('server-model', 'Server model', 'No decoded Runtime Gateway status.'),
    unavailable('browser-publisher', 'Browser publisher', 'No decoded Runtime Gateway status.'),
    unavailable('outgoing-command', 'Outgoing command', 'No decoded Runtime Gateway status.'),
  ])
  if (diagnostics === null || !sameAuthorityTuple(status, diagnostics)) {
    return Object.freeze([
      unavailable('server-model', 'Server model', 'Diagnostics Project/revision/configuration do not match status.'),
      unavailable('browser-publisher', 'Browser publisher', 'Diagnostics Project/revision/configuration do not match status.'),
      unavailable('outgoing-command', 'Outgoing command', 'Diagnostics Project/revision/configuration do not match status.'),
    ])
  }
  const freshness = statusFreshness(stale)
  const model = diagnostics.serverModel
  const modelFaulted = model.lastError !== null
    || model.standardNodeSets === 'faulted'
    || model.roboticsModel === 'faulted'
    || model.productModel === 'faulted'
  const modelDisabled = model.standardNodeSets === 'disabled'
    && model.roboticsModel === 'disabled'
    && model.productModel === 'disabled'
  const modelReady = model.standardNodeSets === 'loaded'
    && model.roboticsModel === 'ready'
    && model.productModel === 'ready'
  const serverModel = Object.freeze({
    id: 'server-model', component: 'Server model', state: modelFaulted ? 'Faulted' : modelDisabled ? 'Disabled' : modelReady ? 'Ready' : 'Loading', endpoint: null,
    lastUpdateAtMs: diagnostics.observedAtMs, quality: modelReady ? 'GOOD' : null,
    error: model.lastError === null ? null : Object.freeze({ code: 'SERVER_MODEL_ERROR', message: model.lastError, occurredAtMs: diagnostics.observedAtMs }),
    details: Object.freeze([
      detail('Standard NodeSet', model.standardNodeSets), detail('Robotics', model.roboticsModel), detail('Product', model.productModel),
      detail('Sessions', `${model.activeSessionCount} / ${model.maximumSessionCount}`), freshness,
    ]),
  })
  const publisher = diagnostics.browserPublisher
  const browserPublisher = Object.freeze({
    id: 'browser-publisher', component: 'Browser publisher', state: humanize(publisher.phase), endpoint: null,
    lastUpdateAtMs: diagnostics.observedAtMs, quality: publisher.phase === 'active' ? 'GOOD' : null, error: null,
    details: Object.freeze([
      detail('Publisher ID', publisher.publisherId ?? 'None'), detail('Generation', publisher.generation === null ? 'None' : String(publisher.generation)),
      timestampDetail('Expires', publisher.expiresAt), freshness,
    ]),
  })
  const command = diagnostics.lastCommandResult
  const commandMatches = command !== null
    && command.projectId === status.project.projectId
    && command.configRevision === status.project.configRevision
  const outgoingCommand = command === null
    ? Object.freeze({ id: 'outgoing-command', component: 'Outgoing command', state: 'No command', endpoint: null, lastUpdateAtMs: diagnostics.observedAtMs, quality: null, error: null, details: Object.freeze([freshness]) })
    : !commandMatches
      ? unavailable('outgoing-command', 'Outgoing command', 'Command Project/configuration does not match status.')
      : Object.freeze({
        id: 'outgoing-command', component: 'Outgoing command', state: `${command.acknowledgement} / ${command.executionState}`, endpoint: null,
        lastUpdateAtMs: command.completedAt, quality: command.acknowledgement,
        error: command.failureCode === null ? null : Object.freeze({ code: command.failureCode, message: command.message, occurredAtMs: command.completedAt ?? diagnostics.observedAtMs }),
        details: Object.freeze([
          detail('Project ID', command.projectId),
          detail('Configuration revision', command.configRevision),
          detail('Target', command.targetId), detail('Command', command.commandId), detail('Lease generation', String(command.leaseGeneration)),
          detail('Attached object', command.attachedObjectId ?? 'None'), detail('Message', command.message), freshness,
        ]),
      })
  return Object.freeze([serverModel, browserPublisher, outgoingCommand])
}

export function connectionMonitorRowsV1(presentation: ConnectivityPresentationStateV1): readonly ConnectionMonitorRowV1[] {
  const status = presentation.status
  const stale = presentation.transportError !== null
  const proxy = proxyRow(presentation)
  if (status === null) {
    return Object.freeze([
      proxy,
      unavailable('gateway', 'Runtime Gateway', 'No decoded Runtime Gateway status.'),
      unavailable('project', 'Project', 'No decoded Runtime Gateway status.'),
      unavailable('opcua-server', 'OPC UA Server', 'No decoded Runtime Gateway status.'),
      ...diagnosticsRows(null, null, false),
    ])
  }
  const [gateway, project, server, ...clients] = statusRows(status, stale)
  const [serverModel, browserPublisher, outgoingCommand] = diagnosticsRows(status, presentation.integrationDiagnostics, stale)
  return Object.freeze([proxy, gateway!, project!, server!, serverModel!, browserPublisher!, ...clients, outgoingCommand!])
}
