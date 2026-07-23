export type RuntimeGatewayOpcUaClientEndpointPhaseV1 =
  | 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'faulted'

export interface RuntimeGatewayDiagnosticErrorV1 {
  readonly code: string
  readonly message: string
  readonly occurredAtMs: number
}

export interface RuntimeGatewayOpcUaClientEndpointStatusV1 {
  readonly endpointId: string
  readonly endpointUrl: string
  readonly phase: RuntimeGatewayOpcUaClientEndpointPhaseV1
  readonly sessionActive: boolean
  readonly subscriptionActive: boolean
  readonly monitoredItemCount: number
  readonly mappingCount: number
  readonly lastValueQuality: 'GOOD' | 'UNCERTAIN' | 'BAD' | null
  readonly lastNotificationAtMs: number | null
  readonly lastGoodValueAtMs: number | null
  readonly reconnectAttempt: number
  readonly nextRetryAtMs: number | null
  readonly lastError: RuntimeGatewayDiagnosticErrorV1 | null
}

export type RuntimeGatewayModeV1 = 'off' | 'client' | 'server' | 'bridge'
export type RuntimeGatewayRuntimeKindV1 = 'native' | 'docker'

export interface RuntimeGatewayStatusV1 {
  readonly type: 'runtime-gateway-status-v1'
  readonly protocolVersion: 1
  readonly observedAtMs: number
  readonly gateway: {
    readonly gatewayId: string
    readonly phase: 'online'
    readonly runtimeKind: RuntimeGatewayRuntimeKindV1
  }
  readonly deployment: {
    readonly http: { readonly bindHost: string; readonly port: number }
    readonly opcUaServer: {
      readonly bindHost: string
      readonly port: number
      readonly advertisedHost: string
      readonly advertisedPort: number
    }
  }
  readonly project: {
    readonly phase: 'not-applied' | 'ready' | 'deactivating' | 'recovery-required'
    /**
     * Authority is deliberately more specific than readiness.  A recovery
     * required runtime can still retain the old active tuple, but it must not
     * accept a new mutation until an operator has recovered it.
     */
    readonly authorityPhase: 'inactive' | 'active' | 'deactivating' | 'recovery-required'
    readonly projectId: string | null
    readonly revisionId: string | null
    readonly configRevision: string | null
    readonly activationAttemptId: string | null
    readonly readinessCode: 'NO_ACTIVE_REVISION' | 'READY' | 'DEACTIVATING' | 'RECOVERY_REQUIRED'
  }
  readonly opcUa: {
    readonly mode: RuntimeGatewayModeV1
    readonly server: {
      readonly phase: 'disabled' | 'listening' | 'faulted'
      readonly endpointUrl: string | null
      readonly lastError: RuntimeGatewayDiagnosticErrorV1 | null
    }
    readonly clientEndpoints: readonly RuntimeGatewayOpcUaClientEndpointStatusV1[]
  }
}

export class RuntimeGatewayStatusValidationError extends Error {
  readonly code = 'RUNTIME_GATEWAY_STATUS_INVALID' as const

  constructor(path: string, reason: string) {
    super(`RUNTIME_GATEWAY_STATUS_INVALID at ${path}: ${reason}`)
    this.name = 'RuntimeGatewayStatusValidationError'
  }
}

const CONFIG_REVISION_PATTERN = /^[0-9a-f]{64}$/
const ACTIVATION_ATTEMPT_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

function invalid(path: string, reason: string): never {
  throw new RuntimeGatewayStatusValidationError(path, reason)
}

function record(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid(path, 'must be an object')
  }
  return value as Readonly<Record<string, unknown>>
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(path, `must contain exactly ${keys.join(', ')}`)
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalid(path, 'must be a non-empty string')
  }
  return value
}

function nullableNonEmptyString(value: unknown, path: string): string | null {
  if (value === null) return null
  return nonEmptyString(value, path)
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return invalid(path, 'must be a finite non-negative safe integer')
  }
  return value
}

function port(value: unknown, path: string): number {
  const candidate = nonNegativeSafeInteger(value, path)
  if (candidate < 1 || candidate > 65_535) {
    return invalid(path, 'must be an integer from 1 through 65535')
  }
  return candidate
}

function enumValue<T extends string>(
  value: unknown,
  choices: readonly T[],
  path: string,
): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    return invalid(path, `must be one of ${choices.join(', ')}`)
  }
  return value as T
}

function nullableTimestamp(value: unknown, path: string): number | null {
  if (value === null) return null
  return nonNegativeSafeInteger(value, path)
}

function diagnosticError(
  value: unknown,
  path: string,
): RuntimeGatewayDiagnosticErrorV1 {
  const source = record(value, path)
  exactKeys(source, ['code', 'message', 'occurredAtMs'], path)
  return Object.freeze({
    code: nonEmptyString(source.code, `${path}.code`),
    message: nonEmptyString(source.message, `${path}.message`),
    occurredAtMs: nonNegativeSafeInteger(source.occurredAtMs, `${path}.occurredAtMs`),
  })
}

function nullableDiagnosticError(
  value: unknown,
  path: string,
): RuntimeGatewayDiagnosticErrorV1 | null {
  if (value === null) return null
  return diagnosticError(value, path)
}

function clientEndpoint(
  value: unknown,
  path: string,
): RuntimeGatewayOpcUaClientEndpointStatusV1 {
  const source = record(value, path)
  exactKeys(source, [
    'endpointId',
    'endpointUrl',
    'phase',
    'sessionActive',
    'subscriptionActive',
    'monitoredItemCount',
    'mappingCount',
    'lastValueQuality',
    'lastNotificationAtMs',
    'lastGoodValueAtMs',
    'reconnectAttempt',
    'nextRetryAtMs',
    'lastError',
  ], path)
  const phase = enumValue(source.phase, [
    'disabled',
    'connecting',
    'connected',
    'reconnecting',
    'faulted',
  ] as const, `${path}.phase`)
  if (typeof source.sessionActive !== 'boolean' || typeof source.subscriptionActive !== 'boolean') {
    invalid(path, 'sessionActive and subscriptionActive must be boolean')
  }
  const nextRetryAtMs = nullableTimestamp(source.nextRetryAtMs, `${path}.nextRetryAtMs`)
  if (
    phase === 'connected'
    && (source.sessionActive !== true || source.subscriptionActive !== true || nextRetryAtMs !== null)
  ) {
    invalid(path, 'connected requires active Session and Subscription with no retry scheduled')
  }
  return Object.freeze({
    endpointId: nonEmptyString(source.endpointId, `${path}.endpointId`),
    endpointUrl: nonEmptyString(source.endpointUrl, `${path}.endpointUrl`),
    phase,
    sessionActive: source.sessionActive,
    subscriptionActive: source.subscriptionActive,
    monitoredItemCount: nonNegativeSafeInteger(source.monitoredItemCount, `${path}.monitoredItemCount`),
    mappingCount: nonNegativeSafeInteger(source.mappingCount, `${path}.mappingCount`),
    lastValueQuality: source.lastValueQuality === null
      ? null
      : enumValue(source.lastValueQuality, ['GOOD', 'UNCERTAIN', 'BAD'] as const, `${path}.lastValueQuality`),
    lastNotificationAtMs: nullableTimestamp(source.lastNotificationAtMs, `${path}.lastNotificationAtMs`),
    lastGoodValueAtMs: nullableTimestamp(source.lastGoodValueAtMs, `${path}.lastGoodValueAtMs`),
    reconnectAttempt: nonNegativeSafeInteger(source.reconnectAttempt, `${path}.reconnectAttempt`),
    nextRetryAtMs,
    lastError: nullableDiagnosticError(source.lastError, `${path}.lastError`),
  })
}

export function validateRuntimeGatewayStatusV1(value: unknown): RuntimeGatewayStatusV1 {
  const source = record(value, '$')
  exactKeys(source, [
    'type',
    'protocolVersion',
    'observedAtMs',
    'gateway',
    'deployment',
    'project',
    'opcUa',
  ], '$')
  if (source.type !== 'runtime-gateway-status-v1') invalid('$.type', 'must be runtime-gateway-status-v1')
  if (source.protocolVersion !== 1) invalid('$.protocolVersion', 'must be 1')

  const gatewaySource = record(source.gateway, '$.gateway')
  exactKeys(gatewaySource, ['gatewayId', 'phase', 'runtimeKind'], '$.gateway')
  const deploymentSource = record(source.deployment, '$.deployment')
  exactKeys(deploymentSource, ['http', 'opcUaServer'], '$.deployment')
  const httpSource = record(deploymentSource.http, '$.deployment.http')
  exactKeys(httpSource, ['bindHost', 'port'], '$.deployment.http')
  const opcUaServerSource = record(deploymentSource.opcUaServer, '$.deployment.opcUaServer')
  exactKeys(opcUaServerSource, ['bindHost', 'port', 'advertisedHost', 'advertisedPort'], '$.deployment.opcUaServer')

  const projectSource = record(source.project, '$.project')
  exactKeys(projectSource, [
    'phase',
    'authorityPhase',
    'projectId',
    'revisionId',
    'configRevision',
    'activationAttemptId',
    'readinessCode',
  ], '$.project')
  const projectPhase = enumValue(projectSource.phase, ['not-applied', 'ready', 'deactivating', 'recovery-required'] as const, '$.project.phase')
  const authorityPhase = enumValue(projectSource.authorityPhase, [
    'inactive', 'active', 'deactivating', 'recovery-required',
  ] as const, '$.project.authorityPhase')
  const projectId = nullableNonEmptyString(projectSource.projectId, '$.project.projectId')
  const revisionId = nullableNonEmptyString(projectSource.revisionId, '$.project.revisionId')
  const configRevision = nullableNonEmptyString(projectSource.configRevision, '$.project.configRevision')
  const activationAttemptId = nullableNonEmptyString(projectSource.activationAttemptId, '$.project.activationAttemptId')
  const readinessCode = enumValue(
    projectSource.readinessCode,
    ['NO_ACTIVE_REVISION', 'READY', 'DEACTIVATING', 'RECOVERY_REQUIRED'] as const,
    '$.project.readinessCode',
  )
  if (
    projectPhase === 'not-applied'
    && (projectId !== null || revisionId !== null || configRevision !== null || activationAttemptId !== null || readinessCode !== 'NO_ACTIVE_REVISION' || authorityPhase !== 'inactive')
  ) {
    invalid('$.project', 'not-applied requires null ids and NO_ACTIVE_REVISION')
  }
  if (
    projectPhase === 'ready'
    && (projectId === null || revisionId === null || configRevision === null || activationAttemptId === null || readinessCode !== 'READY' || authorityPhase !== 'active')
  ) {
    invalid('$.project', 'ready requires ids, configRevision, and READY')
  }
  if (
    projectPhase === 'deactivating'
    && (projectId === null || revisionId === null || configRevision === null || activationAttemptId === null || readinessCode !== 'DEACTIVATING' || authorityPhase !== 'deactivating')
  ) {
    invalid('$.project', 'deactivating requires exact active authority and DEACTIVATING')
  }
  if (
    projectPhase === 'recovery-required'
    && (projectId === null || revisionId === null || configRevision === null || activationAttemptId === null || readinessCode !== 'RECOVERY_REQUIRED' || authorityPhase !== 'recovery-required')
  ) {
    invalid('$.project', 'recovery-required retains exact authority fencing')
  }
  if (configRevision !== null && !CONFIG_REVISION_PATTERN.test(configRevision)) {
    invalid('$.project.configRevision', 'must be lowercase 64-hex')
  }
  if (activationAttemptId !== null && !ACTIVATION_ATTEMPT_PATTERN.test(activationAttemptId)) {
    invalid('$.project.activationAttemptId', 'must be a bounded activation attempt token')
  }

  const opcUaSource = record(source.opcUa, '$.opcUa')
  exactKeys(opcUaSource, ['mode', 'server', 'clientEndpoints'], '$.opcUa')
  const serverSource = record(opcUaSource.server, '$.opcUa.server')
  exactKeys(serverSource, ['phase', 'endpointUrl', 'lastError'], '$.opcUa.server')
  const serverPhase = enumValue(serverSource.phase, ['disabled', 'listening', 'faulted'] as const, '$.opcUa.server.phase')
  const serverEndpointUrl = nullableNonEmptyString(serverSource.endpointUrl, '$.opcUa.server.endpointUrl')
  const serverLastError = nullableDiagnosticError(serverSource.lastError, '$.opcUa.server.lastError')
  if (serverPhase === 'listening' && (serverEndpointUrl === null || serverLastError !== null)) {
    invalid('$.opcUa.server', 'listening requires an endpointUrl and no error')
  }
  if (serverPhase === 'disabled' && serverEndpointUrl !== null) {
    invalid('$.opcUa.server', 'disabled requires a null endpointUrl')
  }
  if (!Array.isArray(opcUaSource.clientEndpoints)) {
    invalid('$.opcUa.clientEndpoints', 'must be an array')
  }
  const clientEndpoints = Object.freeze(opcUaSource.clientEndpoints.map((endpoint, index) => (
    clientEndpoint(endpoint, `$.opcUa.clientEndpoints[${index}]`)
  )))

  return Object.freeze({
    type: 'runtime-gateway-status-v1',
    protocolVersion: 1,
    observedAtMs: nonNegativeSafeInteger(source.observedAtMs, '$.observedAtMs'),
    gateway: Object.freeze({
      gatewayId: nonEmptyString(gatewaySource.gatewayId, '$.gateway.gatewayId'),
      phase: enumValue(gatewaySource.phase, ['online'] as const, '$.gateway.phase'),
      runtimeKind: enumValue(gatewaySource.runtimeKind, ['native', 'docker'] as const, '$.gateway.runtimeKind'),
    }),
    deployment: Object.freeze({
      http: Object.freeze({
        bindHost: nonEmptyString(httpSource.bindHost, '$.deployment.http.bindHost'),
        port: port(httpSource.port, '$.deployment.http.port'),
      }),
      opcUaServer: Object.freeze({
        bindHost: nonEmptyString(opcUaServerSource.bindHost, '$.deployment.opcUaServer.bindHost'),
        port: port(opcUaServerSource.port, '$.deployment.opcUaServer.port'),
        advertisedHost: nonEmptyString(opcUaServerSource.advertisedHost, '$.deployment.opcUaServer.advertisedHost'),
        advertisedPort: port(opcUaServerSource.advertisedPort, '$.deployment.opcUaServer.advertisedPort'),
      }),
    }),
    project: Object.freeze({
      phase: projectPhase,
      authorityPhase,
      projectId,
      revisionId,
      configRevision,
      activationAttemptId,
      readinessCode,
    }),
    opcUa: Object.freeze({
      mode: enumValue(opcUaSource.mode, ['off', 'client', 'server', 'bridge'] as const, '$.opcUa.mode'),
      server: Object.freeze({
        phase: serverPhase,
        endpointUrl: serverEndpointUrl,
        lastError: serverLastError,
      }),
      clientEndpoints,
    }),
  })
}
