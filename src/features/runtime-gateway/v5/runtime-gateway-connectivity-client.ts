import {
  validateWorkcellProjectV5,
  type OpcUaEndpointV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import {
  validateRuntimeGatewayStatusV1,
  type RuntimeGatewayStatusV1,
} from '../../../core/runtime-protocol/gateway-status-v1.js'
import {
  type ProjectV5GatewayPublicationPort, type ProjectV5GatewayRollbackDispositionV1,
  type PublishedProjectV5,
} from '../../project/v5/project-v5-publication.js'
import type { RuntimeProjectAuthorityV1 } from '../../../core/runtime-protocol/project-activation-v1.js'
import { validateOpcUaNamespaceIndexResponseV1, validateOpcUaTestConnectionResultV1, type OpcUaNamespaceIndexResponseV1, type OpcUaTestConnectionResultV1 } from '../../../core/runtime-protocol/opcua-connectivity-v1.js'

const RESPONSE_LIMIT_BYTES = 64 * 1024
const CONFIG_REVISION = /^[0-9a-f]{64}$/u
const errors = new WeakSet<object>()

export class RuntimeGatewayConnectivityClientV1Error extends Error {
  readonly code: string
  readonly statusCode: number | null
  readonly details: Readonly<Record<string, string | null>> | null
  constructor(code: string, message: string, statusCode: number | null = null, cause?: unknown, details: Readonly<Record<string, string | null>> | null = null) {
    super(message)
    this.name = 'RuntimeGatewayConnectivityClientV1Error'
    this.code = code
    this.statusCode = statusCode
    this.details = details
    if (cause !== undefined) this.cause = cause
    errors.add(this)
  }
}

export function isRuntimeGatewayConnectivityClientV1Error(value: unknown): value is RuntimeGatewayConnectivityClientV1Error {
  return value instanceof RuntimeGatewayConnectivityClientV1Error && errors.has(value)
}

export interface PreparedRuntimeGatewayProjectV1 {
  readonly projectRevisionId: string
  readonly configRevision: string
}

export interface RuntimeGatewayConnectivityClientV1Options {
  readonly fetch?: (input: string, init: RequestInit) => Promise<Response>
  readonly basePath?: string
  readonly timeoutMs?: number
  readonly createActivationAttemptId?: () => string
}

export interface RuntimeGatewayConnectivityClientV1 extends ProjectV5GatewayPublicationPort<PreparedRuntimeGatewayProjectV1> {
  testConnection(endpoint: OpcUaEndpointV5, signal?: AbortSignal): Promise<OpcUaTestConnectionResultV1>
  resolveNamespaceIndex(endpointId: string, namespaceUri: string, signal?: AbortSignal): Promise<OpcUaNamespaceIndexResponseV1>
}

interface CandidateRecord {
  readonly project: WorkcellProjectV5
  readonly configRevision: string
  state: 'prepared' | 'attempted' | 'activated' | 'consumed'
  readonly generation: number
  readonly activationAttemptId: string
  readonly expectedAuthority: RuntimeProjectAuthorityV1 | null
}

const ATTEMPT = /^[A-Za-z0-9_-]{8,128}$/u

function base(value: string | undefined): string {
  const normalized = (value ?? '/runtime').trim().replace(/\/+$/u, '')
  const hasControl = [...normalized].some((character) => { const code = character.codePointAt(0)!; return code < 32 || code === 127 })
  if (!normalized.startsWith('/') || normalized.startsWith('//') || normalized.includes('\\') || normalized.includes('?') || normalized.includes('#') || hasControl || normalized.length === 0) {
    throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_BASE_PATH_INVALID', 'Runtime Gateway base path must be an absolute path.')
  }
  return normalized
}

function abortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function concise(value: unknown): string {
  return value instanceof Error ? value.message.slice(0, 512) : String(value).slice(0, 512)
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^[0-9]+$/u.test(declared) || Number(declared) > RESPONSE_LIMIT_BYTES)) {
    throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_RESPONSE_TOO_LARGE', 'Runtime Gateway response exceeds 64 KiB.', response.status)
  }
  const reader = response.body?.getReader()
  if (reader === undefined) throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_RESPONSE_INVALID', 'Runtime Gateway returned no response body.', response.status)
  const chunks: Uint8Array[] = []; let bytes = 0
  while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > RESPONSE_LIMIT_BYTES) { void Promise.resolve(reader.cancel()).catch(() => undefined); throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_RESPONSE_TOO_LARGE', 'Runtime Gateway response exceeds 64 KiB.', response.status) }; chunks.push(next.value) }
  const merged = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength }
  const text = new TextDecoder().decode(merged)
  try { return JSON.parse(text) as unknown } catch {
    throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_RESPONSE_INVALID', 'Runtime Gateway returned invalid JSON.', response.status)
  }
}

function exactError(value: unknown): { readonly code: string; readonly message: string; readonly details: Readonly<Record<string, string | null>> | null } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const allowed = new Set(['code', 'message', 'recoveredProjectId', 'recoveredRevisionId', 'recoveryError'])
  if (typeof record.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(record.code) || typeof record.message !== 'string' || new TextEncoder().encode(record.message).byteLength > 512 || Object.keys(record).some((key) => !allowed.has(key))) return null
  const details: Record<string, string | null> = {}
  for (const key of ['recoveredProjectId', 'recoveredRevisionId', 'recoveryError']) {
    if (!(key in record)) continue
    if (record[key] !== null && (typeof record[key] !== 'string' || new TextEncoder().encode(record[key] as string).byteLength > 512)) return null
    details[key] = record[key] as string | null
  }
  return { code: record.code, message: record.message, details: Object.keys(details).length === 0 ? null : Object.freeze(details) }
}

function authorityFromStatus(status: RuntimeGatewayStatusV1): RuntimeProjectAuthorityV1 | null {
  return status.project.phase === 'ready' ? Object.freeze({
    projectId: status.project.projectId!, revisionId: status.project.revisionId!,
    configRevision: status.project.configRevision!, activationAttemptId: status.project.activationAttemptId!,
  }) : null
}

function sameAuthority(left: RuntimeProjectAuthorityV1 | null, right: RuntimeProjectAuthorityV1 | null): boolean {
  return left === right || (left !== null && right !== null && left.projectId === right.projectId && left.revisionId === right.revisionId && left.configRevision === right.configRevision && left.activationAttemptId === right.activationAttemptId)
}

function statusFor(status: RuntimeGatewayStatusV1, project: WorkcellProjectV5, configRevision: string, activationAttemptId: string): RuntimeGatewayStatusV1 {
  if (
    status.project.phase !== 'ready'
    || status.project.projectId !== project.projectId
    || status.project.revisionId !== project.revisionId
    || status.project.configRevision !== configRevision
    || status.project.activationAttemptId !== activationAttemptId
  ) throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_STATUS_MISMATCH', 'Runtime Gateway status does not match the requested Project.')
  return status
}

export function createRuntimeGatewayConnectivityClientV1(
  options: RuntimeGatewayConnectivityClientV1Options = {},
): RuntimeGatewayConnectivityClientV1 {
  const basePath = base(options.basePath)
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  const timeoutMs = options.timeoutMs ?? 5_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new TypeError('timeoutMs must be a bounded positive integer.')
  const candidates = new WeakMap<object, CandidateRecord>()
  let latestGeneration = 0
  const createActivationAttemptId = options.createActivationAttemptId ?? (() => globalThis.crypto.randomUUID())

  const request = async (path: string, init: RequestInit, callerSignal?: AbortSignal): Promise<unknown> => {
    if (callerSignal?.aborted) throw abortError()
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    const abort = (): void => controller.abort()
    callerSignal?.addEventListener('abort', abort, { once: true })
    let rejectAbort!: () => void
    const abortPromise = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(callerSignal?.aborted ? abortError() : new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_TIMEOUT', 'Runtime Gateway request timed out.')); controller.signal.addEventListener('abort', rejectAbort, { once: true }) })
    try {
      const response = await Promise.race([fetcher(`${basePath}${path}`, { ...init, signal: controller.signal, redirect: 'error' }), abortPromise])
      const body = await Promise.race([boundedJson(response), abortPromise])
      if (!response.ok) {
        const error = exactError(body)
        throw new RuntimeGatewayConnectivityClientV1Error(error?.code ?? `RUNTIME_GATEWAY_HTTP_${response.status}`, error?.message ?? 'Runtime Gateway request failed.', response.status, undefined, error?.details ?? null)
      }
      return body
    } catch (error) {
      if (controller.signal.aborted) {
        if (callerSignal?.aborted) throw abortError()
        if (timedOut) throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_TIMEOUT', 'Runtime Gateway request timed out.')
        throw abortError()
      }
      if (isRuntimeGatewayConnectivityClientV1Error(error)) throw error
      throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_UNAVAILABLE', concise(error), null, error)
    } finally {
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', rejectAbort)
      callerSignal?.removeEventListener('abort', abort)
    }
  }
  const readStatus = async (): Promise<RuntimeGatewayStatusV1> => {
    try { return validateRuntimeGatewayStatusV1(await request('/status', { method: 'GET', headers: { Accept: 'application/json' } })) }
    catch (error) {
      if (isRuntimeGatewayConnectivityClientV1Error(error)) throw error
      throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_RESPONSE_INVALID', 'Runtime Gateway returned an invalid status response.', null, error)
    }
  }
  const deactivate = async (body: unknown): Promise<RuntimeGatewayStatusV1> => {
    const result = await request('/project', { method: 'DELETE', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    let status: RuntimeGatewayStatusV1
    try { status = validateRuntimeGatewayStatusV1(result) } catch (error) {
      throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_RESPONSE_INVALID', 'Runtime Gateway returned an invalid status response.', null, error)
    }
    if (status.project.phase !== 'not-applied' || status.project.projectId !== null || status.project.revisionId !== null || status.project.configRevision !== null || status.project.readinessCode !== 'NO_ACTIVE_REVISION') throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_STATUS_MISMATCH', 'Runtime Gateway did not deactivate the Project.')
    return status
  }
  const requireCandidate = (candidate: PreparedRuntimeGatewayProjectV1): CandidateRecord => {
    if (candidate === null || (typeof candidate !== 'object' && typeof candidate !== 'function')) throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_CANDIDATE_FOREIGN', 'Prepared Gateway candidate is not owned by this client.')
    const record = candidates.get(candidate as object)
    if (record === undefined) throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_CANDIDATE_FOREIGN', 'Prepared Gateway candidate is not owned by this client.')
    if (record.state === 'consumed') throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_CANDIDATE_CONSUMED', 'Prepared Gateway candidate has been consumed.')
    return record
  }

  return Object.freeze({
    async prepare(input: WorkcellProjectV5, candidateConfigRevision: string, expectedPrevious?: PublishedProjectV5 | null): Promise<PreparedRuntimeGatewayProjectV1> {
      const project = validateWorkcellProjectV5(input)
      if (!CONFIG_REVISION.test(candidateConfigRevision)) throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_CONFIG_REVISION_INVALID', 'Project config revision must be SHA-256 hex.')
      const currentStatus = expectedPrevious === undefined ? null : await readStatus()
      if (currentStatus !== null && currentStatus.project.phase !== 'ready' && currentStatus.project.phase !== 'not-applied') {
        throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_AUTHORITY_UNAVAILABLE', 'Gateway authority is not available for activation.')
      }
      const currentAuthority = currentStatus === null ? null : authorityFromStatus(currentStatus)
      if (expectedPrevious === undefined) {
        // The V5 coordinator always supplies the third argument. This keeps
        // the opaque port usable by isolated unit adapters without inventing
        // an authority from an unchecked status response.
      } else if (expectedPrevious === null) {
        // Hydration owns no Browser publication yet.  It may safely converge
        // an inactive Gateway or resume only the exact durable target; any
        // other active authority is a race and must not be replaced.
        if (currentAuthority !== null && (
          currentAuthority.projectId !== project.projectId
          || currentAuthority.revisionId !== project.revisionId
          || currentAuthority.configRevision !== candidateConfigRevision
        )) throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_AUTHORITY_MISMATCH', 'Gateway has an unexpected active Project authority.')
      } else if (currentAuthority === null || currentAuthority.projectId !== expectedPrevious.project.projectId || currentAuthority.revisionId !== expectedPrevious.revisionId || currentAuthority.configRevision !== expectedPrevious.configRevision) {
        throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_AUTHORITY_MISMATCH', 'Gateway authority does not match the coordinator previous Project.')
      }
      const activationAttemptId = expectedPrevious === undefined ? 'attempt-0001' : createActivationAttemptId()
      if (typeof activationAttemptId !== 'string' || !ATTEMPT.test(activationAttemptId)) throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_ACTIVATION_ATTEMPT_INVALID', 'Activation attempt token must be bounded URL-safe text.')
      const handle = Object.freeze({ projectRevisionId: project.revisionId, configRevision: candidateConfigRevision })
      if (latestGeneration >= Number.MAX_SAFE_INTEGER) throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_CANDIDATE_GENERATION_EXHAUSTED', 'Prepared Gateway candidate generation is exhausted.')
      candidates.set(handle, { project, configRevision: candidateConfigRevision, state: 'prepared', generation: ++latestGeneration, activationAttemptId, expectedAuthority: currentAuthority })
      return handle
    },
    async activate(candidate: PreparedRuntimeGatewayProjectV1): Promise<RuntimeGatewayStatusV1> {
      const record = requireCandidate(candidate)
      if (record.state !== 'prepared') throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_CANDIDATE_STALE', 'Prepared Gateway candidate is no longer activatable.')
      if (record.generation !== latestGeneration) throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_CANDIDATE_STALE', 'Prepared Gateway candidate was superseded by a newer candidate.')
      record.state = 'attempted'
      const status = statusFor(validateRuntimeGatewayStatusV1(await request('/project', { method: 'PUT', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'runtime-project-activation-v1', protocolVersion: 1, project: record.project, configRevision: record.configRevision, activationAttemptId: record.activationAttemptId, expectedAuthority: record.expectedAuthority }) })), record.project, record.configRevision, record.activationAttemptId)
      record.state = 'activated'
      return status
    },
    async reactivate(previous: PublishedProjectV5): Promise<RuntimeGatewayStatusV1> {
      const project = validateWorkcellProjectV5(previous.project)
      if (!CONFIG_REVISION.test(previous.configRevision)) throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_CONFIG_REVISION_INVALID', 'Project config revision must be SHA-256 hex.')
      const before = await readStatus()
      if (before.project.phase !== 'not-applied') throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_AUTHORITY_MISMATCH', 'Gateway must be inactive before conditional previous reactivation.')
      const activationAttemptId = createActivationAttemptId()
      if (typeof activationAttemptId !== 'string' || !ATTEMPT.test(activationAttemptId)) throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_ACTIVATION_ATTEMPT_INVALID', 'Activation attempt token must be bounded URL-safe text.')
      const status = validateRuntimeGatewayStatusV1(await request('/project', { method: 'PUT', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'runtime-project-activation-v1', protocolVersion: 1, project, configRevision: previous.configRevision, activationAttemptId, expectedAuthority: null }) }))
      return statusFor(status, project, previous.configRevision, activationAttemptId)
    },
    readStatus,
    async rollback(candidate: PreparedRuntimeGatewayProjectV1): Promise<ProjectV5GatewayRollbackDispositionV1> {
      const record = requireCandidate(candidate)
      if (record.state === 'prepared') { record.state = 'consumed'; return 'prepared-only' }
      try {
        await deactivate({ type: 'runtime-project-deactivate-v1', protocolVersion: 1, projectId: record.project.projectId, revisionId: record.project.revisionId, configRevision: record.configRevision, activationAttemptId: record.activationAttemptId })
        record.state = 'consumed'
        return 'candidate-deactivated'
      } catch (error) {
        if (!(isRuntimeGatewayConnectivityClientV1Error(error) && (error.code === 'PROJECT_DEACTIVATION_CONFLICT' || error.code === 'RUNTIME_GATEWAY_UNAVAILABLE' || error.code === 'RUNTIME_GATEWAY_TIMEOUT' || error.code === 'RUNTIME_GATEWAY_RESPONSE_INVALID'))) throw error
        const explicitConflict = isRuntimeGatewayConnectivityClientV1Error(error) && error.code === 'PROJECT_DEACTIVATION_CONFLICT'
        const current = await readStatus()
        if (current.project.phase === 'not-applied') { record.state = 'consumed'; return explicitConflict ? 'candidate-absent' : 'candidate-deactivated' }
        if (!sameAuthority(authorityFromStatus(current), Object.freeze({ projectId: record.project.projectId, revisionId: record.project.revisionId, configRevision: record.configRevision, activationAttemptId: record.activationAttemptId }))) { record.state = 'consumed'; return 'other-authority' }
        await deactivate({ type: 'runtime-project-deactivate-v1', protocolVersion: 1, projectId: record.project.projectId, revisionId: record.project.revisionId, configRevision: record.configRevision, activationAttemptId: record.activationAttemptId })
        record.state = 'consumed'
        return 'candidate-deactivated'
      }
    },
    async deactivate(): Promise<RuntimeGatewayStatusV1> {
      return deactivate({ type: 'runtime-project-deactivate-v1', protocolVersion: 1, unconditional: true })
    },
    async cleanupPrevious(previous: PublishedProjectV5): Promise<void> {
      const status = await readStatus()
      if (status.project.projectId === previous.project.projectId && status.project.revisionId === previous.revisionId && status.project.configRevision === previous.configRevision) {
        throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_CLEANUP_ACTIVE_REVISION', 'Refusing to remove the currently active Gateway revision.')
      }
    },
    async testConnection(endpoint: OpcUaEndpointV5, signal?: AbortSignal): Promise<OpcUaTestConnectionResultV1> {
      try { return validateOpcUaTestConnectionResultV1(await request('/opcua/test-connection', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'opcua-test-connection-request-v1', protocolVersion: 1, endpoint }) }, signal)) } catch (error) { if (isRuntimeGatewayConnectivityClientV1Error(error) || (error instanceof Error && error.name === 'AbortError')) throw error; throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_RESPONSE_INVALID', 'Runtime Gateway returned an invalid connection diagnostic.', null, error) }
    },
    async resolveNamespaceIndex(endpointId: string, namespaceUri: string, signal?: AbortSignal): Promise<OpcUaNamespaceIndexResponseV1> {
      try { const response = validateOpcUaNamespaceIndexResponseV1(await request('/opcua/namespace-index', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'opcua-namespace-index-request-v1', protocolVersion: 1, endpointId, namespaceUri }) }, signal)); if (response.endpointId !== endpointId || response.namespaceUri !== namespaceUri) throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_RESPONSE_INVALID', 'Runtime Gateway namespace response does not match the request.'); return response } catch (error) { if (isRuntimeGatewayConnectivityClientV1Error(error) || (error instanceof Error && error.name === 'AbortError')) throw error; throw new RuntimeGatewayConnectivityClientV1Error('RUNTIME_GATEWAY_RESPONSE_INVALID', 'Runtime Gateway returned an invalid namespace diagnostic.', null, error) }
    },
  })
}
