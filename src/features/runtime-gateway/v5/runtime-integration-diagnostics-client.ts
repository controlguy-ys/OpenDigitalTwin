import {
  validateRuntimeIntegrationDiagnosticsV1,
  type RuntimeIntegrationDiagnosticsV1,
} from '../../../core/runtime-protocol/integration-diagnostics-v1.js'
import {
  validateRuntimeGatewayStatusV1,
  type RuntimeGatewayStatusV1,
} from '../../../core/runtime-protocol/gateway-status-v1.js'
import type { RuntimeConnectivitySnapshotV1 } from '../runtime-gateway-status-poller.js'

const errors = new WeakSet<object>()

export class RuntimeIntegrationDiagnosticsClientV1Error extends Error {
  readonly code: string

  constructor(code: string, message: string, cause?: unknown) {
    super(message)
    this.name = 'RuntimeIntegrationDiagnosticsClientV1Error'
    this.code = code
    if (cause !== undefined) this.cause = cause
    errors.add(this)
  }
}

export interface RuntimeIntegrationDiagnosticsClientV1 {
  readIntegrationDiagnostics(signal?: AbortSignal): Promise<RuntimeIntegrationDiagnosticsV1>
}

export interface RuntimeIntegrationDiagnosticsClientV1Options {
  readonly fetch?: (input: string, init: RequestInit) => Promise<Response>
  readonly basePath?: string
}

function abortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function base(basePath: string | undefined): string {
  const base = (basePath ?? '/runtime').trim().replace(/\/+$/u, '')
  if (!base.startsWith('/') || base.startsWith('//') || base.includes('\\') || base.includes('?') || base.includes('#')) {
    throw new TypeError('Runtime Gateway base path must be an absolute path.')
  }
  return base
}

function requestInit(signal: AbortSignal | undefined): RequestInit {
  return signal === undefined
    ? { method: 'GET', headers: { Accept: 'application/json' } }
    : { method: 'GET', headers: { Accept: 'application/json' }, signal }
}

export function createRuntimeIntegrationDiagnosticsClientV1(
  options: RuntimeIntegrationDiagnosticsClientV1Options = {},
): RuntimeIntegrationDiagnosticsClientV1 {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  const url = `${base(options.basePath)}/integration-diagnostics`
  return Object.freeze({
    async readIntegrationDiagnostics(signal?: AbortSignal): Promise<RuntimeIntegrationDiagnosticsV1> {
      if (signal?.aborted) throw abortError()
      let response: Response
      try {
        response = await fetcher(url, requestInit(signal))
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw abortError()
        throw new RuntimeIntegrationDiagnosticsClientV1Error('RUNTIME_INTEGRATION_DIAGNOSTICS_UNAVAILABLE', 'Runtime integration diagnostics are unavailable.', error)
      }
      if (!response.ok) throw new RuntimeIntegrationDiagnosticsClientV1Error('RUNTIME_INTEGRATION_DIAGNOSTICS_HTTP_ERROR', `Runtime integration diagnostics request failed with HTTP ${response.status}.`)
      let value: unknown
      try {
        value = await response.json()
        return validateRuntimeIntegrationDiagnosticsV1(value)
      } catch (error) {
        throw new RuntimeIntegrationDiagnosticsClientV1Error('RUNTIME_INTEGRATION_DIAGNOSTICS_RESPONSE_INVALID', 'Runtime Gateway returned invalid integration diagnostics.', error)
      }
    },
  })
}

export interface RuntimeConnectivitySnapshotReaderV1Options extends RuntimeIntegrationDiagnosticsClientV1Options {}

export function validateRuntimeConnectivitySnapshotV1(value: unknown): RuntimeConnectivitySnapshotV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeIntegrationDiagnosticsClientV1Error('RUNTIME_CONNECTIVITY_SNAPSHOT_INVALID', 'Runtime connectivity snapshot must be an object.')
  }
  const record = value as Readonly<Record<string, unknown>>
  let status: RuntimeGatewayStatusV1
  let integrationDiagnostics: RuntimeIntegrationDiagnosticsV1
  try {
    status = validateRuntimeGatewayStatusV1(record.status)
    integrationDiagnostics = validateRuntimeIntegrationDiagnosticsV1(record.integrationDiagnostics)
  } catch (error) {
    throw new RuntimeIntegrationDiagnosticsClientV1Error('RUNTIME_CONNECTIVITY_SNAPSHOT_INVALID', 'Runtime connectivity snapshot contains invalid status or diagnostics.', error)
  }
  const statusRevision = status.project.configRevision
  const diagnosticsRevision = integrationDiagnostics.configRevision
  if (statusRevision !== diagnosticsRevision || (statusRevision === null) !== (diagnosticsRevision === null)) {
    throw new RuntimeIntegrationDiagnosticsClientV1Error('RUNTIME_CONNECTIVITY_SNAPSHOT_REVISION_MISMATCH', 'Runtime status and integration diagnostics configRevision values do not match.')
  }
  return Object.freeze({ status, integrationDiagnostics })
}

export function createRuntimeConnectivitySnapshotReaderV1(
  options: RuntimeConnectivitySnapshotReaderV1Options = {},
): (signal?: AbortSignal) => Promise<RuntimeConnectivitySnapshotV1> {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  const runtimeBase = base(options.basePath)
  const diagnostics = createRuntimeIntegrationDiagnosticsClientV1(options)
  const readStatus = async (signal?: AbortSignal): Promise<RuntimeGatewayStatusV1> => {
    if (signal?.aborted) throw abortError()
    let response: Response
    try {
      response = await fetcher(`${runtimeBase}/status`, requestInit(signal))
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw abortError()
      throw new RuntimeIntegrationDiagnosticsClientV1Error('RUNTIME_CONNECTIVITY_SNAPSHOT_UNAVAILABLE', 'Runtime Gateway status is unavailable.', error)
    }
    if (!response.ok) throw new RuntimeIntegrationDiagnosticsClientV1Error('RUNTIME_CONNECTIVITY_SNAPSHOT_HTTP_ERROR', `Runtime Gateway status request failed with HTTP ${response.status}.`)
    try {
      return validateRuntimeGatewayStatusV1(await response.json())
    } catch (error) {
      throw new RuntimeIntegrationDiagnosticsClientV1Error('RUNTIME_CONNECTIVITY_SNAPSHOT_STATUS_INVALID', 'Runtime Gateway returned invalid status.', error)
    }
  }
  return async (signal?: AbortSignal): Promise<RuntimeConnectivitySnapshotV1> => {
    if (signal?.aborted) throw abortError()
    const controller = new AbortController()
    const abortFromCaller = (): void => controller.abort()
    signal?.addEventListener('abort', abortFromCaller, { once: true })
    let firstFailure: unknown = undefined
    let failed = false
    const settle = async <T>(operation: Promise<T>): Promise<{ readonly value: T | null }> => {
      try {
        return Object.freeze({ value: await operation })
      } catch (error) {
        if (!failed) {
          failed = true
          firstFailure = error
          controller.abort()
        }
        return Object.freeze({ value: null })
      }
    }
    try {
      const [statusResult, diagnosticsResult] = await Promise.all([
        settle(readStatus(controller.signal)),
        settle(diagnostics.readIntegrationDiagnostics(controller.signal)),
      ])
      if (failed) throw firstFailure
      return validateRuntimeConnectivitySnapshotV1({
        status: statusResult.value,
        integrationDiagnostics: diagnosticsResult.value,
      })
    } finally {
      signal?.removeEventListener('abort', abortFromCaller)
    }
  }
}
