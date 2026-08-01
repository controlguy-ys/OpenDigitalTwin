import type { RuntimeGatewayDiagnosticErrorV1, RuntimeGatewayStatusV1 } from '../../../core/runtime-protocol/gateway-status-v1.js'
import type { RuntimeIntegrationDiagnosticsV1 } from '../../../core/runtime-protocol/integration-diagnostics-v1.js'

import type { ConnectivityPresentationStateV1 } from './connectivity-presentation-store.js'

export type ConnectionMonitorFreshnessV1 = 'current' | 'last-known' | 'unavailable'

export interface ConnectionMonitorRowV1 {
  readonly id: string
  readonly component: string
  readonly freshness: ConnectionMonitorFreshnessV1
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
    freshness: 'unavailable',
    state: 'Unavailable',
    endpoint: null,
    lastUpdateAtMs: null,
    quality: null,
    error: null,
    details: Object.freeze([detail('Availability', reason)]),
  })
}

function statusFreshness(freshness: Exclude<ConnectionMonitorFreshnessV1, 'unavailable'>): DetailV1 {
  return detail('Freshness', freshness === 'last-known' ? 'Last known' : 'Current')
}

function retainedValue(raw: string | null, freshness: Exclude<ConnectionMonitorFreshnessV1, 'unavailable'>): string | null {
  return raw === null || freshness === 'current' ? raw : `Last known: ${raw}`
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
      freshness: 'current',
      state: 'Error',
      endpoint: null,
      lastUpdateAtMs: null,
      quality: null,
      error: Object.freeze({ code: 'RUNTIME_GATEWAY_TRANSPORT_ERROR', message: presentation.transportError, occurredAtMs: presentation.transportErrorOccurredAtMs ?? null }),
      details: Object.freeze([
        detail('Freshness', 'Current transport error'),
        detail('Error code', 'RUNTIME_GATEWAY_TRANSPORT_ERROR'),
        timestampDetail('Failure time', presentation.transportErrorOccurredAtMs ?? null),
      ]),
    })
  }
  if (presentation.status === null) return unavailable('web-proxy', 'Web proxy', 'No decoded Runtime Gateway status.')
  return Object.freeze({
    id: 'web-proxy', component: 'Web proxy', state: 'Online', endpoint: null,
    freshness: 'current',
    lastUpdateAtMs: presentation.lastObservedAtMs, quality: 'GOOD', error: null,
    details: Object.freeze([detail('Freshness', 'Current decoded data')]),
  })
}

function statusRows(status: RuntimeGatewayStatusV1, rowFreshness: Exclude<ConnectionMonitorFreshnessV1, 'unavailable'>): readonly ConnectionMonitorRowV1[] {
  const freshness = statusFreshness(rowFreshness)
  const httpBinding = `${status.deployment.http.bindHost}:${status.deployment.http.port}`
  const gateway = Object.freeze({
    id: 'gateway', component: 'Runtime Gateway', state: retainedValue('Online', rowFreshness)!, endpoint: httpBinding,
    freshness: rowFreshness,
    lastUpdateAtMs: status.observedAtMs, quality: retainedValue('GOOD', rowFreshness), error: null,
    details: Object.freeze([
      detail('Gateway ID', status.gateway.gatewayId),
      detail('Runtime kind', status.gateway.runtimeKind),
      detail('HTTP bind', httpBinding),
      timestampDetail('Observed', status.observedAtMs),
      freshness,
    ]),
  })
  const project = Object.freeze({
    id: 'project', component: 'Project', state: retainedValue(humanize(status.project.phase), rowFreshness)!, endpoint: null,
    freshness: rowFreshness,
    lastUpdateAtMs: status.observedAtMs, quality: retainedValue(status.project.readinessCode, rowFreshness), error: null,
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
    id: 'opcua-server', component: 'OPC UA Server', state: retainedValue(humanize(status.opcUa.server.phase), rowFreshness)!,
    freshness: rowFreshness,
    endpoint: status.opcUa.server.endpointUrl, lastUpdateAtMs: status.observedAtMs,
    quality: retainedValue(status.opcUa.server.phase === 'listening' ? 'GOOD' : null, rowFreshness),
    error: errorOrNull(status.opcUa.server.lastError),
    details: Object.freeze([
      detail('Mode', status.opcUa.mode),
      detail('Bind', `${status.deployment.opcUaServer.bindHost}:${status.deployment.opcUaServer.port}`),
      detail('Advertised', `${status.deployment.opcUaServer.advertisedHost}:${status.deployment.opcUaServer.advertisedPort}`),
      freshness,
    ]),
  })
  const clients = orderedEndpoints(status).map((endpoint) => Object.freeze({
    id: `opcua-client:${endpoint.endpointId}`, component: 'OPC UA Client', state: retainedValue(humanize(endpoint.phase), rowFreshness)!,
    freshness: rowFreshness,
    endpoint: endpoint.endpointUrl, lastUpdateAtMs: endpoint.lastNotificationAtMs ?? status.observedAtMs,
    quality: retainedValue(endpoint.lastValueQuality, rowFreshness), error: errorOrNull(endpoint.lastError),
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
  rowFreshness: Exclude<ConnectionMonitorFreshnessV1, 'unavailable'>,
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
  const freshness = statusFreshness(rowFreshness)
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
    id: 'server-model', component: 'Server model', state: retainedValue(modelFaulted ? 'Faulted' : modelDisabled ? 'Disabled' : modelReady ? 'Ready' : 'Loading', rowFreshness)!, endpoint: null,
    freshness: rowFreshness,
    lastUpdateAtMs: diagnostics.observedAtMs, quality: retainedValue(modelReady ? 'GOOD' : null, rowFreshness),
    error: model.lastError === null ? null : Object.freeze({ code: 'SERVER_MODEL_ERROR', message: model.lastError, occurredAtMs: diagnostics.observedAtMs }),
    details: Object.freeze([
      detail('Standard NodeSet', model.standardNodeSets), detail('Robotics', model.roboticsModel), detail('Product', model.productModel),
      detail('Sessions', `${model.activeSessionCount} / ${model.maximumSessionCount}`), freshness,
    ]),
  })
  const publisher = diagnostics.browserPublisher
  const browserPublisher = Object.freeze({
    id: 'browser-publisher', component: 'Browser publisher', state: retainedValue(humanize(publisher.phase), rowFreshness)!, endpoint: null,
    freshness: rowFreshness,
    lastUpdateAtMs: diagnostics.observedAtMs, quality: retainedValue(publisher.phase === 'active' ? 'GOOD' : null, rowFreshness), error: null,
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
    ? Object.freeze({ id: 'outgoing-command', component: 'Outgoing command', freshness: rowFreshness, state: retainedValue('No command', rowFreshness)!, endpoint: null, lastUpdateAtMs: diagnostics.observedAtMs, quality: null, error: null, details: Object.freeze([freshness]) })
    : !commandMatches
      ? unavailable('outgoing-command', 'Outgoing command', 'Command Project/configuration does not match status.')
      : Object.freeze({
    id: 'outgoing-command', component: 'Outgoing command', freshness: rowFreshness, state: `${command.acknowledgement} / ${command.executionState}`, endpoint: null,
        lastUpdateAtMs: command.completedAt, quality: retainedValue(command.acknowledgement, rowFreshness),
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
  const rowFreshness: ConnectionMonitorFreshnessV1 = presentation.statusFreshness
    ?? (presentation.transportError !== null ? status === null ? 'unavailable' : 'last-known' : status === null ? 'unavailable' : 'current')
  const proxy = proxyRow(presentation)
  if (status === null) {
    return Object.freeze([
      proxy,
      unavailable('gateway', 'Runtime Gateway', 'No decoded Runtime Gateway status.'),
      unavailable('project', 'Project', 'No decoded Runtime Gateway status.'),
      unavailable('opcua-server', 'OPC UA Server', 'No decoded Runtime Gateway status.'),
      ...diagnosticsRows(null, null, 'current'),
    ])
  }
  const retainedFreshness = rowFreshness === 'unavailable' ? 'last-known' : rowFreshness
  const [gateway, project, server, ...clients] = statusRows(status, retainedFreshness)
  const [serverModel, browserPublisher, outgoingCommand] = diagnosticsRows(status, presentation.integrationDiagnostics, retainedFreshness)
  return Object.freeze([proxy, gateway!, project!, server!, serverModel!, browserPublisher!, ...clients, outgoingCommand!])
}
