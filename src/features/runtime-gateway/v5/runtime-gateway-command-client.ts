import {
  compileWritableBooleanSignalMappingsV5,
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import {
  validateCommandRequestV1,
  validateCommandResultV1,
  validateRuntimePublisherLeaseV1,
  type CommandResultV1,
  type RuntimePublisherLeaseV1,
} from '../../../core/runtime-protocol/v1.js'

export interface GatewaySignalWritePortV1 {
  writeBoolean(signalId: string, value: boolean, signal?: AbortSignal): Promise<CommandResultV1>
}

const clientErrors = new WeakSet<object>()
const signalErrors = new WeakSet<object>()
const BUILTIN_CLIENT_ERROR_CODES = new Set([
  'RUNTIME_GATEWAY_BASE_PATH_INVALID',
  'RUNTIME_GATEWAY_TIMEOUT',
  'RUNTIME_GATEWAY_UNAVAILABLE',
  'RUNTIME_GATEWAY_RESPONSE_INVALID',
])
const FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/u
const HTTP_ERROR_CODE_PATTERN = /^RUNTIME_GATEWAY_HTTP_([1-5][0-9]{2})$/u

function isHttpErrorStatus(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 100 && value <= 599 && value !== 200
}

function isAllowedClientErrorPair(code: string, statusCode: number | null): boolean {
  if (BUILTIN_CLIENT_ERROR_CODES.has(code)) return statusCode === null
  const httpMatch = HTTP_ERROR_CODE_PATTERN.exec(code)
  if (httpMatch !== null) return isHttpErrorStatus(statusCode) && Number(httpMatch[1]) === statusCode
  return FAILURE_CODE_PATTERN.test(code) && isHttpErrorStatus(statusCode)
}

export class RuntimeGatewayCommandClientV1Error extends Error {
  readonly code: string
  readonly statusCode: number | null
  readonly cause?: unknown
  constructor(code: string, message: string, options: { readonly statusCode?: number; readonly cause?: unknown } = {}) {
    super(message)
    this.name = 'RuntimeGatewayCommandClientV1Error'
    this.code = code
    this.statusCode = options.statusCode ?? null
    this.cause = options.cause
    clientErrors.add(this)
  }
}

export function isRuntimeGatewayCommandClientV1Error(value: unknown): value is RuntimeGatewayCommandClientV1Error {
  if (!(value instanceof RuntimeGatewayCommandClientV1Error) || !clientErrors.has(value)) return false
  return isAllowedClientErrorPair(value.code, value.statusCode)
}

export interface RuntimeGatewayCommandClientOptionsV1 {
  readonly createCommandId: () => string
  readonly fetch?: (input: string, init: RequestInit) => Promise<Response>
  readonly nowMs?: () => number
  readonly basePath?: string
}

export interface RuntimeGatewayCommandClientV1 {
  writeBoolean(request: {
    readonly projectId: string
    readonly configRevision: string
    readonly targetId: string
    readonly value: boolean
  }, signal?: AbortSignal): Promise<CommandResultV1>
  clearLease(): void
}

export interface ActiveRuntimeContextV5 {
  readonly project: WorkcellProjectV5
  readonly configRevision: string
}

export class GatewaySignalWriteErrorV1 extends Error {
  readonly code: 'SIGNAL_WRITE_MAPPING_NOT_FOUND' | 'SIGNAL_WRITE_MAPPING_AMBIGUOUS'
  constructor(code: 'SIGNAL_WRITE_MAPPING_NOT_FOUND' | 'SIGNAL_WRITE_MAPPING_AMBIGUOUS', message: string) {
    super(message)
    this.name = 'GatewaySignalWriteErrorV1'
    this.code = code
    signalErrors.add(this)
  }
}

export function isGatewaySignalWriteErrorV1(value: unknown): value is GatewaySignalWriteErrorV1 {
  return value instanceof GatewaySignalWriteErrorV1 && signalErrors.has(value)
    && (value.code === 'SIGNAL_WRITE_MAPPING_NOT_FOUND' || value.code === 'SIGNAL_WRITE_MAPPING_AMBIGUOUS')
}

function abortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function normalizedBasePath(value: string | undefined): string {
  const normalized = (value ?? '/runtime').trim().replace(/\/+$/, '')
  if (normalized.length === 0) {
    throw new RuntimeGatewayCommandClientV1Error(
      'RUNTIME_GATEWAY_BASE_PATH_INVALID',
      'Runtime Gateway base path is empty.',
    )
  }
  return normalized
}

function isTerminal(result: CommandResultV1): boolean {
  const pair = `${result.acknowledgement}/${result.executionState}`
  return pair === 'ACCEPTED/SUCCEEDED' || pair === 'ACCEPTED/FAILED' || pair === 'REJECTED/FAILED'
}

function exactErrorBody(value: unknown, statusCode: number): { readonly code: string; readonly message: string } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).length !== 2
    || typeof record.code !== 'string'
    || !isAllowedClientErrorPair(record.code, statusCode)
    || typeof record.message !== 'string'
  ) return null
  return { code: record.code, message: record.message }
}

interface LeaseCache {
  readonly key: string
  readonly epoch: number
  readonly lease: RuntimePublisherLeaseV1
}

export function createRuntimeGatewayCommandClientV1(
  options: RuntimeGatewayCommandClientOptionsV1,
): RuntimeGatewayCommandClientV1 {
  if (typeof options.createCommandId !== 'function') throw new TypeError('createCommandId is required.')
  const basePath = normalizedBasePath(options.basePath)
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  const nowMs = options.nowMs ?? Date.now
  let activeKey: string | null = null
  let epoch = 0
  let cache: LeaseCache | null = null

  const invalidateAll = (): void => {
    epoch += 1
    cache = null
  }
  const selectContext = (key: string): number => {
    if (activeKey !== key) {
      activeKey = key
      invalidateAll()
    }
    return epoch
  }
  const cacheCandidate = (
    key: string,
    candidateEpoch: number,
    candidate: RuntimePublisherLeaseV1,
  ): void => {
    if (activeKey !== key || epoch !== candidateEpoch) return
    if (cache !== null && cache.key === key && cache.epoch === epoch) {
      if (
        cache.lease.generation > candidate.generation
        || (cache.lease.generation === candidate.generation && cache.lease.expiresAt >= candidate.expiresAt)
      ) return
    }
    cache = { key, epoch, lease: candidate }
  }

  return Object.freeze({
    clearLease(): void {
      invalidateAll()
    },
    async writeBoolean(
      input: {
        readonly projectId: string
        readonly configRevision: string
        readonly targetId: string
        readonly value: boolean
      },
      callerSignal?: AbortSignal,
    ): Promise<CommandResultV1> {
      if (callerSignal?.aborted) throw abortError()
      const commandId = options.createCommandId()
      if (callerSignal?.aborted) throw abortError()
      const key = `${input.projectId}\u0000${input.configRevision}`
      const operationEpoch = selectContext(key)
      const deadline = new AbortController()
      const combined = new AbortController()
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        deadline.abort()
      }, 5_000)
      const abortFromCaller = (): void => combined.abort()
      const abortFromDeadline = (): void => combined.abort()
      callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
      deadline.signal.addEventListener('abort', abortFromDeadline, { once: true })

      const abortFailure = (): Error => {
        if (callerSignal?.aborted) return abortError()
        if (timedOut) {
          return new RuntimeGatewayCommandClientV1Error(
            'RUNTIME_GATEWAY_TIMEOUT',
            'Runtime Gateway command timed out.',
          )
        }
        return abortError()
      }
      const throwIfAborted = (): void => {
        if (combined.signal.aborted) throw abortFailure()
      }
      const abortRace = async <T>(operation: Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
        let settled = false
        const onAbort = (): void => {
          if (settled) return
          settled = true
          combined.signal.removeEventListener('abort', onAbort)
          reject(abortFailure())
        }
        combined.signal.addEventListener('abort', onAbort, { once: true })
        if (combined.signal.aborted) onAbort()
        operation.then(
          (value) => {
            if (settled) return
            settled = true
            combined.signal.removeEventListener('abort', onAbort)
            if (combined.signal.aborted) reject(abortFailure())
            else resolve(value)
          },
          (error: unknown) => {
            if (settled) return
            settled = true
            combined.signal.removeEventListener('abort', onAbort)
            if (combined.signal.aborted) reject(abortFailure())
            else reject(error)
          },
        )
      })
      const request = async (url: string, init: RequestInit): Promise<Response> => {
        throwIfAborted()
        try {
          const operation = fetcher(url, { ...init, signal: combined.signal, redirect: 'error' })
          const response = await abortRace(operation)
          throwIfAborted()
          if (response.redirected) {
            throw new RuntimeGatewayCommandClientV1Error(
              'RUNTIME_GATEWAY_RESPONSE_INVALID',
              'Runtime Gateway redirected a command request.',
            )
          }
          return response
        } catch (error) {
          throwIfAborted()
          if (isRuntimeGatewayCommandClientV1Error(error)) throw error
          throw new RuntimeGatewayCommandClientV1Error(
            'RUNTIME_GATEWAY_UNAVAILABLE',
            'Runtime Gateway is unavailable.',
            { cause: error },
          )
        }
      }
      const parseSuccessJson = async (response: Response): Promise<unknown> => {
        try {
          const value = await abortRace(response.json())
          throwIfAborted()
          return value
        } catch (error) {
          throwIfAborted()
          if (isRuntimeGatewayCommandClientV1Error(error)) throw error
          throw new RuntimeGatewayCommandClientV1Error(
            'RUNTIME_GATEWAY_RESPONSE_INVALID',
            'Runtime Gateway returned invalid JSON.',
            { cause: error },
          )
        }
      }
      const throwHttpError = async (response: Response): Promise<never> => {
        let body: unknown
        try {
          body = await abortRace(response.json())
          throwIfAborted()
        } catch {
          throwIfAborted()
          body = undefined
        }
        const exact = exactErrorBody(body, response.status)
        throw new RuntimeGatewayCommandClientV1Error(
          exact?.code ?? `RUNTIME_GATEWAY_HTTP_${response.status}`,
          exact?.message ?? `Runtime Gateway returned HTTP ${response.status}.`,
          { statusCode: response.status },
        )
      }
      const getLease = async (force: boolean): Promise<RuntimePublisherLeaseV1> => {
        if (
          !force
          && activeKey === key
          && epoch === operationEpoch
          && cache !== null
          && cache.key === key
          && cache.epoch === operationEpoch
        ) {
          if (cache.lease.expiresAt >= nowMs()) return cache.lease
          cache = null
        }
        const response = await request(`${basePath}/command-lease`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        })
        if (response.status !== 200) await throwHttpError(response)
        const body = await parseSuccessJson(response)
        let candidate: RuntimePublisherLeaseV1
        try {
          candidate = validateRuntimePublisherLeaseV1(body)
        } catch (error) {
          throw new RuntimeGatewayCommandClientV1Error(
            'RUNTIME_GATEWAY_RESPONSE_INVALID',
            'Runtime Gateway returned an invalid lease.',
            { cause: error },
          )
        }
        throwIfAborted()
        if (
          candidate.projectId !== input.projectId
          || candidate.configRevision !== input.configRevision
          || !candidate.publisherId.endsWith(':client-write')
          || candidate.expiresAt < nowMs()
        ) {
          throw new RuntimeGatewayCommandClientV1Error(
            'RUNTIME_GATEWAY_RESPONSE_INVALID',
            'Runtime Gateway lease does not match the active command context.',
          )
        }
        cacheCandidate(key, operationEpoch, candidate)
        return candidate
      }
      const post = async (leaseValue: RuntimePublisherLeaseV1): Promise<CommandResultV1> => {
        const expiresAt = Math.min(nowMs() + 5_000, leaseValue.expiresAt)
        let command
        try {
          command = validateCommandRequestV1({
            type: 'command-request-v1',
            protocolVersion: 1,
            commandId,
            projectId: input.projectId,
            configRevision: input.configRevision,
            leaseGeneration: leaseValue.generation,
            expiresAt,
            targetId: input.targetId,
            value: input.value,
          })
        } catch (error) {
          throw new RuntimeGatewayCommandClientV1Error(
            'RUNTIME_GATEWAY_RESPONSE_INVALID',
            'Runtime Gateway command request is invalid.',
            { cause: error },
          )
        }
        const response = await request(`${basePath}/command`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(command),
        })
        if (response.status !== 200) await throwHttpError(response)
        const body = await parseSuccessJson(response)
        let result: CommandResultV1
        try {
          result = validateCommandResultV1(body)
        } catch (error) {
          throw new RuntimeGatewayCommandClientV1Error(
            'RUNTIME_GATEWAY_RESPONSE_INVALID',
            'Runtime Gateway returned an invalid command result.',
            { cause: error },
          )
        }
        throwIfAborted()
        if (
          !isTerminal(result)
          || result.projectId !== input.projectId
          || result.configRevision !== input.configRevision
          || result.leaseGeneration !== leaseValue.generation
          || result.targetId !== input.targetId
          || result.commandId !== commandId
          || result.attachedObjectId !== null
        ) {
          throw new RuntimeGatewayCommandClientV1Error(
            'RUNTIME_GATEWAY_RESPONSE_INVALID',
            'Runtime Gateway command result does not correlate to the request.',
          )
        }
        throwIfAborted()
        return result
      }

      try {
        let leaseValue = await getLease(false)
        let result = await post(leaseValue)
        if (
          result.acknowledgement === 'REJECTED'
          && result.executionState === 'FAILED'
          && result.failureCode === 'COMMAND_LEASE_STALE'
        ) {
          if (
            activeKey === key
            && epoch === operationEpoch
            && cache?.key === key
            && cache.epoch === operationEpoch
            && cache.lease === leaseValue
          ) cache = null
          throwIfAborted()
          leaseValue = await getLease(true)
          result = await post(leaseValue)
        }
        throwIfAborted()
        return result
      } finally {
        clearTimeout(timer)
        callerSignal?.removeEventListener('abort', abortFromCaller)
        deadline.signal.removeEventListener('abort', abortFromDeadline)
      }
    },
  })
}

export function createGatewaySignalWritePortV1(options: {
  readonly readActiveContext: () => ActiveRuntimeContextV5
  readonly commandClient: RuntimeGatewayCommandClientV1
}): GatewaySignalWritePortV1 {
  return Object.freeze({
    async writeBoolean(signalId: string, value: boolean, signal?: AbortSignal): Promise<CommandResultV1> {
      const context = options.readActiveContext()
      const project = validateWorkcellProjectV5(context.project)
      const matches = compileWritableBooleanSignalMappingsV5(project)
        .filter((mapping) => mapping.signalId === signalId)
      if (matches.length === 0) {
        throw new GatewaySignalWriteErrorV1(
          'SIGNAL_WRITE_MAPPING_NOT_FOUND',
          `No writable Boolean Mapping exists for Signal ${signalId}.`,
        )
      }
      if (matches.length !== 1) {
        throw new GatewaySignalWriteErrorV1(
          'SIGNAL_WRITE_MAPPING_AMBIGUOUS',
          `Multiple writable Boolean Mappings exist for Signal ${signalId}.`,
        )
      }
      const mapping = matches[0]!
      return options.commandClient.writeBoolean({
        projectId: project.projectId,
        configRevision: context.configRevision,
        targetId: mapping.mappingId,
        value,
      }, signal)
    },
  })
}
