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
import { WebSocketServer } from 'ws'

import {
  MAX_OPC_UA_VALUES_PER_CALL_V5,
  MAX_RUNTIME_BATCH_BYTES_V5,
  configRevisionForProjectV5,
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../../src/core/project-v5/index.js'
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
import {
  createOpcUaClientAdapterV1,
  type OpcUaClientAdapterV1,
  type OpcUaClientAdapterOptionsV1,
} from './opcua-client-adapter.js'
import {
  createStateBatchHubV1,
  isStreamableStateSnapshotV1,
  type StateBatchHubV1,
} from './state-batch-hub.js'
import type { RuntimeMappedValueV1, StateBatchV1 } from '../../src/core/runtime-protocol/v1.js'
import {
  validateRuntimeGatewayStatusV1,
  type RuntimeGatewayStatusV1,
} from '../../src/core/runtime-protocol/gateway-status-v1.js'

export const MAX_RUNTIME_PROJECT_BODY_BYTES_V1 = 1024 * 1024

export interface RuntimeGatewayEntrypointServiceV1 {
  start(): Promise<void>
  stop(): Promise<void>
  status(): RuntimeGatewayStatusV1
}

export interface RuntimeGatewayEntrypointDependenciesV1 {
  readonly createHttpServer?: (requestListener: RequestListener) => Server
  readonly createOpcUaServerAdapter?: (
    project: WorkcellProjectV5,
    options: OpcUaServerAdapterOptionsV1,
  ) => OpcUaServerAdapterV1
  readonly createOpcUaClientAdapter?: (
    project: WorkcellProjectV5,
    options: OpcUaClientAdapterOptionsV1,
  ) => OpcUaClientAdapterV1
  readonly createStateBatchHub?: () => StateBatchHubV1
  readonly pkiRootDir?: string
  readonly nowMs?: () => number
}

interface ActiveProjectRuntimeV1 {
  readonly project: WorkcellProjectV5
  readonly configRevision: string
  readonly serverAdapter: OpcUaServerAdapterV1 | null
  readonly clientAdapter: OpcUaClientAdapterV1 | null
}

interface StagedRobotJointStateV1 {
  readonly robotId: string
  readonly jointValues: Readonly<Record<string, number>>
}

interface StagedClientBatchesV1 {
  publish(batch: StateBatchV1): void
  flushTo(hub: StateBatchHubV1): void
  clear(): void
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

const MAX_STAGED_CLIENT_ENDPOINTS_V1 = 8
const MAX_STAGED_CLIENT_CHANNELS_PER_ENDPOINT_V1 = 128

function stagedChannelGroupsV1(
  values: readonly RuntimeMappedValueV1[],
): readonly (readonly RuntimeMappedValueV1[])[] {
  const coherent = new Map<string, RuntimeMappedValueV1[]>()
  const groups: RuntimeMappedValueV1[][] = []
  for (const value of values) {
    if (value.coherenceGroupId === null) {
      groups.push([value])
      continue
    }
    const existing = coherent.get(value.coherenceGroupId)
    if (existing === undefined) {
      const group = [value]
      coherent.set(value.coherenceGroupId, group)
      groups.push(group)
    } else {
      existing.push(value)
    }
  }
  return groups
}

function stagedChannelKeyV1(values: readonly RuntimeMappedValueV1[]): string {
  const coherenceGroupId = values[0]?.coherenceGroupId
  return coherenceGroupId === null || coherenceGroupId === undefined
    ? `mapping:${values[0]!.mappingId}`
    : `coherence:${coherenceGroupId}`
}

function createStagedClientBatchesV1(): StagedClientBatchesV1 {
  const snapshotsByEndpoint = new Map<string, Map<string, StateBatchV1>>()

  const publish = (batch: StateBatchV1): void => {
    const endpoint = snapshotsByEndpoint.get(batch.endpointId) ?? new Map<string, StateBatchV1>()
    snapshotsByEndpoint.set(batch.endpointId, endpoint)
    for (const values of stagedChannelGroupsV1(batch.values)) {
      const channelKey = stagedChannelKeyV1(values)
      const snapshot = { ...batch, values }
      if (!isStreamableStateSnapshotV1(snapshot)) continue
      const existing = endpoint.get(channelKey)
      if (existing !== undefined && existing.sequence > batch.sequence) continue
      endpoint.delete(channelKey)
      endpoint.set(channelKey, snapshot)
    }
    while (endpoint.size > MAX_STAGED_CLIENT_CHANNELS_PER_ENDPOINT_V1) {
      const oldest = endpoint.keys().next().value as string | undefined
      if (oldest === undefined) break
      endpoint.delete(oldest)
    }
    while (snapshotsByEndpoint.size > MAX_STAGED_CLIENT_ENDPOINTS_V1) {
      const oldest = snapshotsByEndpoint.keys().next().value as string | undefined
      if (oldest === undefined) break
      snapshotsByEndpoint.delete(oldest)
    }
  }

  return Object.freeze({
    publish,
    flushTo(hub: StateBatchHubV1) {
      const batches = [...snapshotsByEndpoint.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([, channels]) => {
          const sourceBatches = new Map<number, StateBatchV1[]>()
          for (const batch of channels.values()) {
            const siblings = sourceBatches.get(batch.sequence) ?? []
            siblings.push(batch)
            sourceBatches.set(batch.sequence, siblings)
          }
          return [...sourceBatches.entries()]
            .sort(([left], [right]) => left - right)
            .map(([, siblings]) => ({
              ...siblings[0]!,
              values: siblings.flatMap(({ values }) => values),
            }))
        })
      snapshotsByEndpoint.clear()
      for (const batch of batches) hub.publish(batch)
    },
    clear() {
      snapshotsByEndpoint.clear()
    },
  })
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
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

export function createRuntimeGatewayEntrypointService(
  config: RuntimeGatewayDeploymentConfigV1,
  dependencies: RuntimeGatewayEntrypointDependenciesV1 = {},
): RuntimeGatewayEntrypointServiceV1 {
  const createHttpServer = dependencies.createHttpServer ?? createServer
  const createOpcUaServerAdapter = dependencies.createOpcUaServerAdapter
    ?? createOpcUaServerAdapterV1
  const createOpcUaClientAdapter = dependencies.createOpcUaClientAdapter
    ?? createOpcUaClientAdapterV1
  const createStateBatchHub = dependencies.createStateBatchHub
    ?? createStateBatchHubV1
  const pkiRootDir = dependencies.pkiRootDir
    ?? join(tmpdir(), 'web-digital-twin-runtime-gateway', config.gatewayId)
  const nowMs = dependencies.nowMs ?? Date.now
  let server: Server | null = null
  let webSocketServer: WebSocketServer | null = null
  let stateBatchHub = createStateBatchHub()
  let activeRuntime: ActiveProjectRuntimeV1 | null = null
  let lifecycleTail: Promise<void> = Promise.resolve()
  let runtimeTail: Promise<void> = Promise.resolve()

  function status(): RuntimeGatewayStatusV1 {
    const active = activeRuntime
    const project = active === null
      ? {
          phase: 'not-applied' as const,
          projectId: null,
          revisionId: null,
          configRevision: null,
          readinessCode: 'NO_ACTIVE_REVISION' as const,
        }
      : {
          phase: 'ready' as const,
          projectId: active.project.projectId,
          revisionId: active.project.revisionId,
          configRevision: active.configRevision,
          readinessCode: 'READY' as const,
        }
    const serverStatus = active?.serverAdapter?.status()
    const server = serverStatus?.started === true
      ? { phase: 'listening' as const, endpointUrl: serverStatus.endpointUrl, lastError: null }
      : { phase: 'disabled' as const, endpointUrl: null, lastError: null }
    return validateRuntimeGatewayStatusV1({
      type: 'runtime-gateway-status-v1',
      protocolVersion: 1,
      observedAtMs: nowMs(),
      gateway: {
        gatewayId: config.gatewayId,
        phase: 'online',
        runtimeKind: config.runtimeKind,
      },
      deployment: {
        http: { bindHost: config.host, port: config.httpPort },
        opcUaServer: {
          bindHost: config.host,
          port: config.opcUaPort,
          advertisedHost: config.opcUaAdvertisedHost,
          advertisedPort: config.opcUaAdvertisedPort,
        },
      },
      project,
      opcUa: {
        mode: active?.project.opcUa.mode ?? 'off',
        server,
        clientEndpoints: active?.clientAdapter?.status() ?? [],
      },
    })
  }

  function enqueueRuntimeTransition(
    transition: () => Promise<void>,
  ): Promise<void> {
    const requestedTransition = runtimeTail.then(transition)
    runtimeTail = requestedTransition.catch(() => undefined)
    return requestedTransition
  }

  function validateProjectMode(project: WorkcellProjectV5): void {
    void project
  }

  async function recoverPreviousRuntime(
    previous: ActiveProjectRuntimeV1 | null,
    restartAdapters: boolean,
  ): Promise<boolean> {
    if (previous === null) return false
    if (restartAdapters) {
      await previous.serverAdapter?.start()
      await previous.clientAdapter?.start()
    }
    activeRuntime = previous
    return true
  }

  async function replaceActiveProject(project: WorkcellProjectV5): Promise<void> {
    validateProjectMode(project)
    const configRevision = await configRevisionForProjectV5(project)
    const previous = activeRuntime
    let candidateServerAdapter: OpcUaServerAdapterV1 | null = null
    let candidateClientAdapter: OpcUaClientAdapterV1 | null = null
    const stagedClientBatches = createStagedClientBatchesV1()
    let clientBatchPublisherLive = false
    let previousAdaptersStopped = false

    try {
      if (project.opcUa.mode === 'server' || project.opcUa.mode === 'bridge') {
        candidateServerAdapter = createOpcUaServerAdapter(project, {
          host: config.host,
          advertisedHost: config.opcUaAdvertisedHost,
          advertisedPort: config.opcUaAdvertisedPort,
          port: config.opcUaPort,
          pkiRootDir,
        })
      }
      if (project.opcUa.mode === 'client' || project.opcUa.mode === 'bridge') {
        candidateClientAdapter = createOpcUaClientAdapter(project, {
          gatewayId: config.gatewayId,
          originId: `${config.gatewayId}:opcua-client`,
          configRevision,
          publish: (batch) => {
            if (clientBatchPublisherLive) {
              stateBatchHub.publish(batch)
            } else {
              stagedClientBatches.publish(batch)
            }
          },
        })
      }
      previousAdaptersStopped = previous !== null
        && (previous.serverAdapter !== null || previous.clientAdapter !== null)
      await previous?.serverAdapter?.stop()
      await previous?.clientAdapter?.stop()

      if (candidateServerAdapter !== null) {
        await candidateServerAdapter.start()
        const adapterStatus = candidateServerAdapter.status()
        if (!adapterStatus.started || adapterStatus.endpointUrl === null) {
          throw new Error('OPC_UA_SERVER_START_INCOMPLETE')
        }
      }
      await candidateClientAdapter?.start()
      // Candidate adapters can synchronously emit their first monitored value
      // from start().  Do not let it race the revision fence or old source
      // sequence; stage it until the candidate has started successfully.
      stateBatchHub.activateRevision(project.projectId, configRevision)
      stagedClientBatches.flushTo(stateBatchHub)
      clientBatchPublisherLive = true
      activeRuntime = Object.freeze({
        project,
        configRevision,
        serverAdapter: candidateServerAdapter,
        clientAdapter: candidateClientAdapter,
      })
    } catch (error) {
      stagedClientBatches.clear()
      await candidateClientAdapter?.stop().catch(() => undefined)
      await candidateServerAdapter?.stop().catch(() => undefined)
      let recovered = false
      let recoveryError: unknown = null
      try {
        recovered = await recoverPreviousRuntime(previous, previousAdaptersStopped)
      } catch (caughtRecoveryError) {
        recoveryError = caughtRecoveryError
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

    if (jointValueCount > MAX_OPC_UA_VALUES_PER_CALL_V5) {
      throw new RuntimeGatewayHttpError(
        400,
        'RUNTIME_STATE_INVALID',
        `Runtime state must not exceed ${MAX_OPC_UA_VALUES_PER_CALL_V5} joint values.`,
      )
    }
    return Object.freeze(staged)
  }

  async function applyProjectRequest(request: IncomingMessage): Promise<RuntimeGatewayStatusV1> {
    const body = await readJsonBody(request, MAX_RUNTIME_PROJECT_BODY_BYTES_V1)
    let project: WorkcellProjectV5
    try {
      project = validateWorkcellProjectV5(body)
    } catch (error) {
      throw new RuntimeGatewayHttpError(
        400,
        'PROJECT_INVALID',
        `Project V5 validation failed: ${conciseError(error)}`,
      )
    }
    await enqueueRuntimeTransition(async () => replaceActiveProject(project))
    return status()
  }

  async function publishStateRequest(request: IncomingMessage): Promise<RuntimeGatewayStatusV1> {
    const body = await readJsonBody(request, MAX_RUNTIME_BATCH_BYTES_V5)

    await enqueueRuntimeTransition(async () => {
      const active = activeRuntime
      if (active === null) {
        throw new RuntimeGatewayHttpError(
          409,
          'NO_ACTIVE_REVISION',
          'No active Project Revision exists.',
        )
      }
      if (
        (active.project.opcUa.mode !== 'server' && active.project.opcUa.mode !== 'bridge')
        || active.serverAdapter === null
      ) {
        throw new RuntimeGatewayHttpError(
          409,
          'OPC_UA_SERVER_NOT_ACTIVE',
          'Runtime state publication requires an active OPC UA Server Project.',
        )
      }
      const staged = validateStateBatch(body, active)
      for (const robotState of staged) {
        await active.serverAdapter.publishRobotJointState(
          robotState.robotId,
          robotState.jointValues,
        )
      }
    })

    return status()
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
      if (currentStatus.project.phase !== 'ready') {
        writeJson(response, 503, {
          code: currentStatus.project.readinessCode,
          mode: currentStatus.opcUa.mode,
        })
      } else {
        writeJson(response, 200, currentStatus)
      }
      return
    }

    if (request.method === 'GET' && request.url === '/runtime/status') {
      writeJson(response, 200, status())
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
    const candidateWebSocketServer = new WebSocketServer({ noServer: true, clientTracking: false })
    candidate.on('upgrade', (request, socket, head) => {
      if (request.url === '/runtime/ws') {
        candidateWebSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
          stateBatchHub.attach(webSocket)
        })
        return
      }
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
        void candidateWebSocketServer.close()
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
    webSocketServer = candidateWebSocketServer
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

  async function closeWebSocketServer(): Promise<void> {
    const activeWebSocketServer = webSocketServer
    webSocketServer = null
    if (activeWebSocketServer === null) return
    await new Promise<void>((resolveStop, rejectStop) => {
      activeWebSocketServer.close((error) => {
        if (error === undefined) resolveStop()
        else rejectStop(error)
      })
    })
  }

  async function closeService(): Promise<void> {
    await stateBatchHub.close()
    await closeWebSocketServer()
    await closeHttpServer()
    await enqueueRuntimeTransition(async () => {
      const active = activeRuntime
      activeRuntime = null
      await active?.clientAdapter?.stop()
      await active?.serverAdapter?.stop()
    })
    stateBatchHub = createStateBatchHub()
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
