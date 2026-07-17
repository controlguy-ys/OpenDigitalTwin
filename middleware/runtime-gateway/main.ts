import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  MAX_OPCUA_VALUES_PER_CALL_V4,
  MAX_RUNTIME_BATCH_BYTES_V4,
  validateWorkcellProjectV4,
  type WorkcellProjectV4,
} from '../../src/core/project-v4/index.js'
import {
  RuntimeGatewayDeploymentConfigError,
  readDeploymentConfig,
  type RuntimeGatewayDeploymentConfigV1,
} from './deployment-config.js'
import {
  createOpcUaServerAdapterV1,
  type OpcUaServerAdapterOptionsV1,
  type OpcUaServerAdapterV1,
} from './opcua-server-adapter.js'

export const MAX_RUNTIME_PROJECT_BODY_BYTES_V1 = 1024 * 1024

export interface RuntimeGatewayPreApplyStatusV1 {
  readonly mode: 'off'
  readonly activeProjectId: null
  readonly activeConfigRevision: null
  readonly ready: false
  readonly readinessCode: 'NO_ACTIVE_REVISION'
  readonly opcUaStarted: false
}

export interface RuntimeGatewayActiveStatusV1 {
  readonly mode: 'off' | 'server'
  readonly activeProjectId: string
  readonly activeConfigRevision: string
  readonly ready: true
  readonly readinessCode: 'READY'
  readonly opcUaStarted: boolean
  readonly endpointUrl: string | null
}

export type RuntimeGatewayStatusV1 =
  | RuntimeGatewayPreApplyStatusV1
  | RuntimeGatewayActiveStatusV1

export interface RuntimeGatewayEntrypointServiceV1 {
  start(): Promise<void>
  stop(): Promise<void>
  status(): RuntimeGatewayStatusV1
}

export interface RuntimeGatewayEntrypointDependenciesV1 {
  readonly createHttpServer?: (requestListener: RequestListener) => Server
  readonly createOpcUaServerAdapter?: (
    project: WorkcellProjectV4,
    options: OpcUaServerAdapterOptionsV1,
  ) => OpcUaServerAdapterV1
  readonly pkiRootDir?: string
}

const PRE_APPLY_STATUS: RuntimeGatewayPreApplyStatusV1 = Object.freeze({
  mode: 'off',
  activeProjectId: null,
  activeConfigRevision: null,
  ready: false,
  readinessCode: 'NO_ACTIVE_REVISION',
  opcUaStarted: false,
})

interface ActiveProjectRuntimeV1 {
  readonly project: WorkcellProjectV4
  readonly adapter: OpcUaServerAdapterV1 | null
}

interface StagedRobotJointStateV1 {
  readonly robotId: string
  readonly jointValues: Readonly<Record<string, number>>
}

class RuntimeGatewayHttpError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly details: Readonly<Record<string, unknown>>

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
    this.name = 'RuntimeGatewayHttpError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: Readonly<Record<string, unknown>>,
): void {
  const body = JSON.stringify(payload)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function expectExactKeys(
  record: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
  path: string,
): void {
  const actualKeys = Object.keys(record).sort()
  const expected = [...expectedKeys].sort()
  if (
    actualKeys.length !== expected.length
    || actualKeys.some((key, index) => key !== expected[index])
  ) {
    throw new RuntimeGatewayHttpError(
      400,
      'RUNTIME_STATE_INVALID',
      `${path} must contain exactly ${expectedKeys.join(', ')}`,
    )
  }
}

function requestContentLength(request: IncomingMessage): number | null {
  const header = request.headers['content-length']
  if (header === undefined) return null
  const value = Array.isArray(header) ? header[0] : header
  if (value === undefined || !/^[0-9]+$/u.test(value)) {
    throw new RuntimeGatewayHttpError(
      400,
      'CONTENT_LENGTH_INVALID',
      'Content-Length must be an unsigned decimal integer.',
    )
  }
  const length = Number(value)
  if (!Number.isSafeInteger(length)) {
    throw new RuntimeGatewayHttpError(
      413,
      'REQUEST_BODY_TOO_LARGE',
      'Request body exceeds the supported byte limit.',
    )
  }
  return length
}

async function readJsonBody(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<unknown> {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim()
  if (contentType !== 'application/json') {
    request.resume()
    throw new RuntimeGatewayHttpError(
      415,
      'CONTENT_TYPE_UNSUPPORTED',
      'Content-Type must be application/json.',
    )
  }

  const contentLength = requestContentLength(request)
  if (contentLength !== null && contentLength > maximumBytes) {
    request.resume()
    throw new RuntimeGatewayHttpError(
      413,
      'REQUEST_BODY_TOO_LARGE',
      `Request body must not exceed ${maximumBytes} bytes.`,
    )
  }

  const chunks: Buffer[] = []
  let receivedBytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    receivedBytes += buffer.byteLength
    if (receivedBytes > maximumBytes) {
      request.resume()
      throw new RuntimeGatewayHttpError(
        413,
        'REQUEST_BODY_TOO_LARGE',
        `Request body must not exceed ${maximumBytes} bytes.`,
      )
    }
    chunks.push(buffer)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new RuntimeGatewayHttpError(
      400,
      'JSON_BODY_INVALID',
      'Request body must contain valid JSON.',
    )
  }
}

function browserStatus(status: RuntimeGatewayStatusV1): Readonly<Record<string, unknown>> {
  if (!status.ready) {
    return Object.freeze({
      projectId: null,
      revisionId: null,
      mode: status.mode,
      ready: false,
      opcUaStarted: false,
      endpointUrl: null,
      errorCode: status.readinessCode,
    })
  }
  return Object.freeze({
    projectId: status.activeProjectId,
    revisionId: status.activeConfigRevision,
    mode: status.mode,
    ready: true,
    opcUaStarted: status.opcUaStarted,
    endpointUrl: status.endpointUrl,
  })
}

export function createRuntimeGatewayEntrypointService(
  config: RuntimeGatewayDeploymentConfigV1,
  dependencies: RuntimeGatewayEntrypointDependenciesV1 = {},
): RuntimeGatewayEntrypointServiceV1 {
  const createHttpServer = dependencies.createHttpServer ?? createServer
  const createOpcUaServerAdapter = dependencies.createOpcUaServerAdapter
    ?? createOpcUaServerAdapterV1
  const pkiRootDir = dependencies.pkiRootDir
    ?? join(tmpdir(), 'web-digital-twin-runtime-gateway', config.gatewayId)
  let server: Server | null = null
  let activeRuntime: ActiveProjectRuntimeV1 | null = null
  let lifecycleTail: Promise<void> = Promise.resolve()
  let runtimeTail: Promise<void> = Promise.resolve()

  function status(): RuntimeGatewayStatusV1 {
    const active = activeRuntime
    if (active === null) return PRE_APPLY_STATUS

    if (active.project.opcUa.mode === 'off') {
      return Object.freeze({
        mode: 'off',
        activeProjectId: active.project.projectId,
        activeConfigRevision: active.project.revisionId,
        ready: true,
        readinessCode: 'READY',
        opcUaStarted: false,
        endpointUrl: null,
      })
    }

    const adapterStatus = active.adapter?.status()
    return Object.freeze({
      mode: 'server',
      activeProjectId: active.project.projectId,
      activeConfigRevision: active.project.revisionId,
      ready: true,
      readinessCode: 'READY',
      opcUaStarted: adapterStatus?.started === true,
      endpointUrl: adapterStatus?.endpointUrl ?? null,
    })
  }

  function enqueueRuntimeTransition(
    transition: () => Promise<void>,
  ): Promise<void> {
    const requestedTransition = runtimeTail.then(transition)
    runtimeTail = requestedTransition.catch(() => undefined)
    return requestedTransition
  }

  function validateProjectMode(project: WorkcellProjectV4): void {
    if (project.opcUa.mode !== 'off' && project.opcUa.mode !== 'server') {
      throw new RuntimeGatewayHttpError(
        400,
        'OPC_UA_MODE_UNSUPPORTED',
        `Runtime Gateway currently supports only off or server mode, not ${project.opcUa.mode}.`,
      )
    }
  }

  async function recoverPreviousRuntime(
    previous: ActiveProjectRuntimeV1 | null,
    restartAdapter: boolean,
  ): Promise<boolean> {
    if (previous === null) {
      activeRuntime = null
      return false
    }
    if (restartAdapter && previous.adapter !== null) await previous.adapter.start()
    activeRuntime = previous
    return true
  }

  async function replaceActiveProject(project: WorkcellProjectV4): Promise<void> {
    validateProjectMode(project)
    const previous = activeRuntime
    let candidateAdapter: OpcUaServerAdapterV1 | null = null
    let previousAdapterStopped = false

    try {
      if (project.opcUa.mode === 'server') {
        candidateAdapter = createOpcUaServerAdapter(project, {
          host: config.host,
          advertisedHost: config.opcUaAdvertisedHost,
          advertisedPort: config.opcUaAdvertisedPort,
          port: config.opcUaPort,
          pkiRootDir,
        })
      }
      previousAdapterStopped = previous?.adapter !== null && previous?.adapter !== undefined
      await previous?.adapter?.stop()
      activeRuntime = null

      if (candidateAdapter !== null) {
        await candidateAdapter.start()
        const adapterStatus = candidateAdapter.status()
        if (!adapterStatus.started || adapterStatus.endpointUrl === null) {
          throw new Error('OPC_UA_SERVER_START_INCOMPLETE')
        }
      }
      activeRuntime = Object.freeze({ project, adapter: candidateAdapter })
    } catch (error) {
      await candidateAdapter?.stop().catch(() => undefined)
      let recovered = false
      let recoveryError: unknown = null
      try {
        recovered = await recoverPreviousRuntime(previous, previousAdapterStopped)
      } catch (caughtRecoveryError) {
        recoveryError = caughtRecoveryError
        activeRuntime = null
      }

      throw new RuntimeGatewayHttpError(
        503,
        'PROJECT_ACTIVATION_FAILED',
        `Project activation failed: ${conciseError(error)}`,
        {
          recoveredProjectId: recovered ? previous?.project.projectId : null,
          recoveredRevisionId: recovered ? previous?.project.revisionId : null,
          recoveryError: recoveryError === null ? null : conciseError(recoveryError),
        },
      )
    }
  }

  function validateStateBatch(
    value: unknown,
    active: ActiveProjectRuntimeV1,
  ): readonly StagedRobotJointStateV1[] {
    if (!isRecord(value)) {
      throw new RuntimeGatewayHttpError(
        400,
        'RUNTIME_STATE_INVALID',
        'Runtime state must be a JSON object.',
      )
    }
    expectExactKeys(value, ['projectId', 'revisionId', 'robots'], '$')
    if (typeof value.projectId !== 'string' || typeof value.revisionId !== 'string') {
      throw new RuntimeGatewayHttpError(
        400,
        'RUNTIME_STATE_INVALID',
        'projectId and revisionId must be strings.',
      )
    }
    if (
      value.projectId !== active.project.projectId
      || value.revisionId !== active.project.revisionId
    ) {
      throw new RuntimeGatewayHttpError(
        409,
        'REVISION_MISMATCH',
        'Runtime state must target the exact active Project and Revision.',
        {
          activeProjectId: active.project.projectId,
          activeRevisionId: active.project.revisionId,
        },
      )
    }
    if (!Array.isArray(value.robots) || value.robots.length === 0) {
      throw new RuntimeGatewayHttpError(
        400,
        'RUNTIME_STATE_INVALID',
        'robots must be a non-empty array.',
      )
    }

    const definitions = new Map(
      active.project.robotDefinitions.map((definition) => [definition.id, definition]),
    )
    const robots = new Map(active.project.robots.map((robot) => [robot.id, robot]))
    const seenRobots = new Set<string>()
    const staged: StagedRobotJointStateV1[] = []
    let jointValueCount = 0

    for (const [index, robotState] of value.robots.entries()) {
      if (!isRecord(robotState)) {
        throw new RuntimeGatewayHttpError(
          400,
          'RUNTIME_STATE_INVALID',
          `$.robots[${index}] must be an object.`,
        )
      }
      expectExactKeys(robotState, ['robotId', 'jointValues'], `$.robots[${index}]`)
      if (typeof robotState.robotId !== 'string' || !isRecord(robotState.jointValues)) {
        throw new RuntimeGatewayHttpError(
          400,
          'RUNTIME_STATE_INVALID',
          `$.robots[${index}] requires string robotId and object jointValues.`,
        )
      }
      if (seenRobots.has(robotState.robotId)) {
        throw new RuntimeGatewayHttpError(
          400,
          'RUNTIME_STATE_INVALID',
          `Duplicate Robot state: ${robotState.robotId}.`,
        )
      }
      seenRobots.add(robotState.robotId)

      const robot = robots.get(robotState.robotId)
      const definition = robot === undefined
        ? undefined
        : definitions.get(robot.definitionId)
      if (robot === undefined || definition === undefined) {
        throw new RuntimeGatewayHttpError(
          400,
          'RUNTIME_STATE_INVALID',
          `Unknown Robot: ${robotState.robotId}.`,
        )
      }
      const jointIds = new Set(definition.joints.map(({ id }) => id))
      const jointEntries = Object.entries(robotState.jointValues)
      if (jointEntries.length === 0) {
        throw new RuntimeGatewayHttpError(
          400,
          'RUNTIME_STATE_INVALID',
          `Robot ${robotState.robotId} must contain at least one joint value.`,
        )
      }
      const validatedJointValues = Object.create(null) as Record<string, number>
      for (const [jointId, jointValue] of jointEntries) {
        if (!jointIds.has(jointId) || typeof jointValue !== 'number' || !Number.isFinite(jointValue)) {
          throw new RuntimeGatewayHttpError(
            400,
            'RUNTIME_STATE_INVALID',
            `Invalid joint value: ${robotState.robotId}/${jointId}.`,
          )
        }
        validatedJointValues[jointId] = jointValue
        jointValueCount += 1
      }
      staged.push(Object.freeze({
        robotId: robotState.robotId,
        jointValues: Object.freeze(validatedJointValues),
      }))
    }

    if (jointValueCount > MAX_OPCUA_VALUES_PER_CALL_V4) {
      throw new RuntimeGatewayHttpError(
        400,
        'RUNTIME_STATE_INVALID',
        `Runtime state must not exceed ${MAX_OPCUA_VALUES_PER_CALL_V4} joint values.`,
      )
    }
    return Object.freeze(staged)
  }

  async function applyProjectRequest(request: IncomingMessage): Promise<Readonly<Record<string, unknown>>> {
    const body = await readJsonBody(request, MAX_RUNTIME_PROJECT_BODY_BYTES_V1)
    let project: WorkcellProjectV4
    try {
      project = validateWorkcellProjectV4(body)
    } catch (error) {
      throw new RuntimeGatewayHttpError(
        400,
        'PROJECT_INVALID',
        `Project V4 validation failed: ${conciseError(error)}`,
      )
    }
    await enqueueRuntimeTransition(async () => replaceActiveProject(project))
    return browserStatus(status())
  }

  async function publishStateRequest(request: IncomingMessage): Promise<Readonly<Record<string, unknown>>> {
    const body = await readJsonBody(request, MAX_RUNTIME_BATCH_BYTES_V4)

    await enqueueRuntimeTransition(async () => {
      const active = activeRuntime
      if (active === null) {
        throw new RuntimeGatewayHttpError(
          409,
          'NO_ACTIVE_REVISION',
          'No active Project Revision exists.',
        )
      }
      if (active.project.opcUa.mode !== 'server' || active.adapter === null) {
        throw new RuntimeGatewayHttpError(
          409,
          'OPC_UA_SERVER_NOT_ACTIVE',
          'Runtime state publication requires an active OPC UA Server Project.',
        )
      }
      const staged = validateStateBatch(body, active)
      for (const robotState of staged) {
        await active.adapter.publishRobotJointState(
          robotState.robotId,
          robotState.jointValues,
        )
      }
    })

    return browserStatus(status())
  }

  function writeRequestError(response: ServerResponse, error: unknown): void {
    if (response.headersSent || response.writableEnded) return
    if (error instanceof RuntimeGatewayHttpError) {
      writeJson(response, error.statusCode, {
        code: error.code,
        message: error.message,
        ...error.details,
      })
      return
    }
    writeJson(response, 500, {
      code: 'RUNTIME_GATEWAY_INTERNAL_ERROR',
      message: conciseError(error),
    })
  }

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.method === 'GET' && request.url === '/healthz') {
      writeJson(response, 200, {
        status: 'live',
        gatewayId: config.gatewayId,
      })
      return
    }

    if (request.method === 'GET' && request.url === '/readyz') {
      const currentStatus = status()
      if (!currentStatus.ready) {
        writeJson(response, 503, {
          code: currentStatus.readinessCode,
          mode: currentStatus.mode,
        })
      } else {
        writeJson(response, 200, browserStatus(currentStatus))
      }
      return
    }

    if (request.method === 'GET' && request.url === '/runtime/status') {
      writeJson(response, 200, browserStatus(status()))
      return
    }

    if (request.method === 'PUT' && request.url === '/runtime/project') {
      writeJson(response, 200, await applyProjectRequest(request))
      return
    }

    if (request.method === 'POST' && request.url === '/runtime/state') {
      writeJson(response, 200, await publishStateRequest(request))
      return
    }

    response.writeHead(404, { 'content-length': '0' })
    response.end()
  }

  const requestListener: RequestListener = (request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      writeRequestError(response, error)
    })
  }

  async function startListening(): Promise<void> {
    const candidate = createHttpServer(requestListener)
    candidate.on('upgrade', (_request, socket) => {
      socket.end([
        'HTTP/1.1 426 Upgrade Required',
        'Connection: close',
        'Content-Length: 0',
        '',
        '',
      ].join('\r\n'))
    })

    await new Promise<void>((resolveStart, rejectStart) => {
      const onError = (error: Error) => {
        candidate.removeListener('listening', onListening)
        rejectStart(error)
      }
      const onListening = () => {
        candidate.removeListener('error', onError)
        resolveStart()
      }

      candidate.once('error', onError)
      candidate.once('listening', onListening)
      candidate.listen(config.httpPort, config.host)
    })

    server = candidate
  }

  async function startTransition(): Promise<void> {
    if (server?.listening === true) return
    server = null
    await startListening()
  }

  async function closeHttpServer(): Promise<void> {
    const activeServer = server
    if (activeServer === null) return

    await new Promise<void>((resolveStop, rejectStop) => {
      activeServer.close((error) => {
        if (error === undefined) resolveStop()
        else rejectStop(error)
      })
    })
    server = null
  }

  async function closeService(): Promise<void> {
    await closeHttpServer()
    await enqueueRuntimeTransition(async () => {
      const active = activeRuntime
      activeRuntime = null
      await active?.adapter?.stop()
    })
  }

  function enqueueLifecycleTransition(
    transition: () => Promise<void>,
  ): Promise<void> {
    const requestedTransition = lifecycleTail.then(transition)
    lifecycleTail = requestedTransition.catch(() => undefined)
    return requestedTransition
  }

  function start(): Promise<void> {
    return enqueueLifecycleTransition(startTransition)
  }

  function stop(): Promise<void> {
    return enqueueLifecycleTransition(closeService)
  }

  return Object.freeze({
    start,
    stop,
    status,
  })
}

function conciseError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1]
  if (entrypoint === undefined) return false
  return pathToFileURL(resolve(entrypoint)).href === import.meta.url
}

async function runRuntimeGatewayEntrypoint(): Promise<void> {
  try {
    const arguments_ = process.argv.slice(2)
    if (arguments_.length > 1 || (
      arguments_[0] !== undefined
      && arguments_[0] !== '--check-config'
    )) {
      throw new Error('RUNTIME_GATEWAY_ARGUMENT_INVALID: expected no arguments or --check-config')
    }

    const config = readDeploymentConfig(process.env)
    const service = createRuntimeGatewayEntrypointService(config)

    if (arguments_[0] === '--check-config') {
      process.stdout.write(`${JSON.stringify({ config, status: service.status() })}\n`)
      return
    }

    await service.start()

    let shuttingDown = false
    const shutdown = async (): Promise<void> => {
      if (shuttingDown) return
      shuttingDown = true
      process.removeListener('SIGINT', onSigint)
      process.removeListener('SIGTERM', onSigterm)
      try {
        await service.stop()
      } catch (error) {
        process.stderr.write(`RUNTIME_GATEWAY_SHUTDOWN_FAILED: ${conciseError(error)}\n`)
        process.exitCode = 1
      }
    }
    const onSigint = () => {
      void shutdown()
    }
    const onSigterm = () => {
      void shutdown()
    }

    process.once('SIGINT', onSigint)
    process.once('SIGTERM', onSigterm)
  } catch (error) {
    const prefix = error instanceof RuntimeGatewayDeploymentConfigError
      ? ''
      : 'RUNTIME_GATEWAY_START_FAILED: '
    process.stderr.write(`${prefix}${conciseError(error)}\n`)
    process.exitCode = 1
  }
}

if (isDirectExecution()) {
  void runRuntimeGatewayEntrypoint()
}
