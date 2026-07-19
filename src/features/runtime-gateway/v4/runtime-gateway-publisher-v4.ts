import type { WorkcellProjectV4 } from '../../../core/project-v4/index.js'
import {
  validateRuntimeGatewayStatusV1,
  type RuntimeGatewayStatusV1,
} from '../../../core/runtime-protocol/gateway-status-v1.js'

export type RuntimeGatewayStatusV4 = RuntimeGatewayStatusV1

export interface RuntimeGatewayPresentationV4 {
  readonly phase: 'idle' | 'activating' | 'ready' | 'error'
  readonly projectRevisionId: string | null
  readonly mode: 'off' | 'server' | 'client' | 'bridge' | null
  readonly endpointUrl: string | null
  readonly message: string | null
}

export interface RuntimeGatewayRobotStateV4 {
  readonly robotId: string
  readonly jointValues: Readonly<Record<string, number>>
}

export interface RuntimeGatewayStatePayloadV4 {
  readonly projectId: string
  readonly revisionId: string
  readonly robots: readonly RuntimeGatewayRobotStateV4[]
}

export interface RuntimeGatewayPublisherV4 {
  activateProject(
    project: WorkcellProjectV4,
    signal?: AbortSignal,
  ): Promise<RuntimeGatewayStatusV4>
  publishRobotState(
    payload: RuntimeGatewayStatePayloadV4,
    signal?: AbortSignal,
  ): Promise<RuntimeGatewayStatusV4>
  readStatus(signal?: AbortSignal): Promise<RuntimeGatewayStatusV4>
}

export interface RuntimeGatewayPublisherOptionsV4 {
  readonly fetch?: (
    input: string,
    init: RequestInit,
  ) => Promise<Response>
  readonly basePath?: string
}

export class RuntimeGatewayPublisherV4Error extends Error {
  readonly code: string
  readonly statusCode: number | null
  readonly cause?: unknown

  constructor(
    code: string,
    message: string,
    options: { readonly statusCode?: number; readonly cause?: unknown } = {},
  ) {
    super(`${code}: ${message}`)
    this.name = 'RuntimeGatewayPublisherV4Error'
    this.code = code
    this.statusCode = options.statusCode ?? null
    if (options.cause !== undefined) this.cause = options.cause
  }
}

export function runtimeGatewayStatePublicationRequiresReactivationV4(
  error: unknown,
): boolean {
  if (!(error instanceof RuntimeGatewayPublisherV4Error)) return false
  return error.code === 'NO_ACTIVE_REVISION'
    || error.code === 'OPC_UA_SERVER_NOT_ACTIVE'
}

interface PendingStateResultV4 {
  readonly promise: Promise<RuntimeGatewayStatusV4>
  readonly resolve: (status: RuntimeGatewayStatusV4) => void
  readonly reject: (error: unknown) => void
}

interface QueuedStateV4 {
  payload: RuntimeGatewayStatePayloadV4
  signal: AbortSignal | undefined
  readonly result: PendingStateResultV4
}

function gatewayFailureV4(
  code: string,
  message: string,
  options?: { readonly statusCode?: number; readonly cause?: unknown },
): never {
  throw new RuntimeGatewayPublisherV4Error(code, message, options)
}

function normalizeBasePathV4(value: string): string {
  const trimmed = value.trim().replace(/\/+$/u, '')
  if (trimmed.length === 0) {
    return gatewayFailureV4(
      'RUNTIME_GATEWAY_BASE_PATH_INVALID',
      'Runtime Gateway base path must not be empty.',
    )
  }
  return trimmed
}

function isRecordV4(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeStatusV4(value: unknown): RuntimeGatewayStatusV4 {
  try {
    return validateRuntimeGatewayStatusV1(value)
  } catch (error) {
    return gatewayFailureV4(
      'RUNTIME_GATEWAY_RESPONSE_INVALID',
      error instanceof Error ? error.message : 'Runtime Gateway status is invalid.',
      { cause: error },
    )
  }
}

function abortErrorV4(): DOMException {
  return new DOMException('Runtime Gateway request was aborted.', 'AbortError')
}

function signalIsAbortedV4(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false
}

function errorCodeFromPayloadV4(value: unknown): string | null {
  if (!isRecordV4(value)) return null
  const candidate = value.errorCode ?? value.code
  return typeof candidate === 'string' && candidate.trim().length > 0
    ? candidate
    : null
}

function errorMessageFromPayloadV4(value: unknown): string | null {
  if (!isRecordV4(value)) return null
  const candidate = value.message ?? value.error
  return typeof candidate === 'string' && candidate.trim().length > 0
    ? candidate
    : null
}

function assertExpectedRevisionV4(
  status: RuntimeGatewayStatusV4,
  expected: Pick<RuntimeGatewayStatePayloadV4, 'projectId' | 'revisionId'>,
): RuntimeGatewayStatusV4 {
  if (
    status.project.projectId !== expected.projectId
    || status.project.revisionId !== expected.revisionId
  ) {
    return gatewayFailureV4(
      'RUNTIME_GATEWAY_REVISION_MISMATCH',
      `Runtime Gateway returned ${String(status.project.projectId)}/${String(status.project.revisionId)} for ${expected.projectId}/${expected.revisionId}.`,
    )
  }
  if (status.project.phase !== 'ready') {
    return gatewayFailureV4(
      status.project.readinessCode,
      'Runtime Gateway did not activate the requested Project revision.',
    )
  }
  return status
}

function ownedStatePayloadV4(
  payload: RuntimeGatewayStatePayloadV4,
): RuntimeGatewayStatePayloadV4 {
  if (payload.projectId.trim().length === 0 || payload.revisionId.trim().length === 0) {
    return gatewayFailureV4(
      'RUNTIME_GATEWAY_STATE_INVALID',
      'Runtime Gateway state requires Project and Revision ids.',
    )
  }
  const robotIds = new Set<string>()
  const robots = payload.robots.map((robot, robotIndex) => {
    if (robot.robotId.trim().length === 0 || robotIds.has(robot.robotId)) {
      return gatewayFailureV4(
        'RUNTIME_GATEWAY_STATE_INVALID',
        `Robot state ${robotIndex} must have a unique non-empty id.`,
      )
    }
    robotIds.add(robot.robotId)
    const jointValues = Object.create(null) as Record<string, number>
    for (const [jointId, value] of Object.entries(robot.jointValues)) {
      if (jointId.trim().length === 0 || !Number.isFinite(value)) {
        return gatewayFailureV4(
          'RUNTIME_GATEWAY_STATE_INVALID',
          `Robot ${robot.robotId} Joint state must contain finite keyed values.`,
        )
      }
      jointValues[jointId] = value
    }
    return Object.freeze({
      robotId: robot.robotId,
      jointValues: Object.freeze(jointValues),
    })
  })
  return Object.freeze({
    projectId: payload.projectId,
    revisionId: payload.revisionId,
    robots: Object.freeze(robots),
  })
}

function pendingStateResultV4(): PendingStateResultV4 {
  let resolveResult!: (status: RuntimeGatewayStatusV4) => void
  let rejectResult!: (error: unknown) => void
  const promise = new Promise<RuntimeGatewayStatusV4>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  return Object.freeze({
    promise,
    resolve: resolveResult,
    reject: rejectResult,
  })
}

export function createRuntimeGatewayPublisherV4(
  options: RuntimeGatewayPublisherOptionsV4 = {},
): RuntimeGatewayPublisherV4 {
  const fetchV4 = options.fetch ?? ((input: string, init: RequestInit) => (
    globalThis.fetch(input, init)
  ))
  const basePath = normalizeBasePathV4(options.basePath ?? '/runtime')
  let commandTail: Promise<void> = Promise.resolve()
  let queuedState: QueuedStateV4 | null = null
  let drainingState = false

  const enqueueCommand = <Result>(
    command: () => Promise<Result>,
  ): Promise<Result> => {
    const pending = commandTail.then(command, command)
    commandTail = pending.then(() => undefined, () => undefined)
    return pending
  }

  const requestStatus = async (
    method: 'GET' | 'PUT' | 'POST',
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<RuntimeGatewayStatusV4> => {
    if (signalIsAbortedV4(signal)) throw abortErrorV4()
    const init: RequestInit = {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    }
    let response: Response
    try {
      response = await fetchV4(`${basePath}${path}`, init)
    } catch (error) {
      if (
        signalIsAbortedV4(signal)
        || (error instanceof DOMException && error.name === 'AbortError')
      ) {
        throw error
      }
      return gatewayFailureV4(
        'RUNTIME_GATEWAY_UNAVAILABLE',
        'Runtime Gateway could not be reached.',
        { cause: error },
      )
    }

    let payload: unknown
    try {
      payload = await response.json() as unknown
    } catch (error) {
      if (!response.ok) {
        return gatewayFailureV4(
          `RUNTIME_GATEWAY_HTTP_${response.status}`,
          `Runtime Gateway request failed with HTTP ${response.status}.`,
          { statusCode: response.status, cause: error },
        )
      }
      return gatewayFailureV4(
        'RUNTIME_GATEWAY_RESPONSE_INVALID',
        'Runtime Gateway returned invalid JSON.',
        { statusCode: response.status, cause: error },
      )
    }
    if (!response.ok) {
      return gatewayFailureV4(
        errorCodeFromPayloadV4(payload) ?? `RUNTIME_GATEWAY_HTTP_${response.status}`,
        errorMessageFromPayloadV4(payload)
          ?? `Runtime Gateway request failed with HTTP ${response.status}.`,
        { statusCode: response.status },
      )
    }
    return decodeStatusV4(payload)
  }

  const activateProject = (
    project: WorkcellProjectV4,
    signal?: AbortSignal,
  ): Promise<RuntimeGatewayStatusV4> => enqueueCommand(async () => {
    const status = assertExpectedRevisionV4(
      await requestStatus('PUT', '/project', project, signal),
      project,
    )
    if (status.opcUa.mode !== project.opcUa.mode) {
      return gatewayFailureV4(
        'RUNTIME_GATEWAY_MODE_MISMATCH',
        `Runtime Gateway returned ${status.opcUa.mode} for requested ${project.opcUa.mode} mode.`,
      )
    }
    return status
  })

  const drainState = (): void => {
    if (drainingState) return
    drainingState = true
    void (async () => {
      while (queuedState !== null) {
        const batch = queuedState
        queuedState = null
        try {
          const status = await enqueueCommand(async () => assertExpectedRevisionV4(
            await requestStatus('POST', '/state', batch.payload, batch.signal),
            batch.payload,
          ))
          batch.result.resolve(status)
        } catch (error) {
          batch.result.reject(error)
        }
      }
    })().finally(() => {
      drainingState = false
      if (queuedState !== null) drainState()
    })
  }

  const publishRobotState = (
    payload: RuntimeGatewayStatePayloadV4,
    signal?: AbortSignal,
  ): Promise<RuntimeGatewayStatusV4> => {
    if (signal?.aborted === true) return Promise.reject(abortErrorV4())
    let owned: RuntimeGatewayStatePayloadV4
    try {
      owned = ownedStatePayloadV4(payload)
    } catch (error) {
      return Promise.reject(error)
    }
    if (queuedState === null) {
      queuedState = {
        payload: owned,
        signal,
        result: pendingStateResultV4(),
      }
    } else {
      queuedState.payload = owned
      queuedState.signal = signal
    }
    const pending = queuedState.result.promise
    drainState()
    return pending
  }

  return Object.freeze({
    activateProject,
    publishRobotState,
    readStatus: (signal?: AbortSignal) => enqueueCommand(
      () => requestStatus('GET', '/status', undefined, signal),
    ),
  })
}
