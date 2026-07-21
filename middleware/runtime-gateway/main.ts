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
  MAX_RUNTIME_BATCH_BYTES_V1,
  validateCommandRequestV1,
  validateCommandResultV1,
  type CommandRequestV1,
  type CommandResultV1,
} from '../../src/core/runtime-protocol/v1.js'
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
  type NormalizedOpcUaClientPublicationV1,
} from './opcua-client-adapter.js'
import {
  createRuntimeTimelineStagingV1,
  createStateBatchHubV1,
  type RuntimeTimelineStagingV1,
  type StateBatchHubV1,
} from './state-batch-hub.js'
import {
  createRuntimeCommandDedupeRegistryV1,
  type RuntimeCommandDedupeRegistryV1,
} from './runtime-command-dedupe-registry.js'
import {
  createRuntimeCommandServiceV1,
  type RuntimeCommandServiceV1,
} from './runtime-command-service.js'
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
  readonly initialCommittedCommandGeneration?: number
  /** Test-only synchronous injection point immediately before the final staging health check. */
  readonly beforeCandidateTimelineSealForTest?: () => void
}

interface ActiveProjectRuntimeV1 {
  readonly project: WorkcellProjectV5
  readonly configRevision: string
  readonly generation: number
  readonly commandDedupe: RuntimeCommandDedupeRegistryV1
  readonly commandService: RuntimeCommandServiceV1 | null
  readonly serverAdapter: OpcUaServerAdapterV1 | null
  readonly clientAdapter: OpcUaClientAdapterV1 | null
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
  incompleteRequests: Set<IncomingMessage>,
  shutdownRequested: () => boolean,
): Promise<unknown> {
  const stopTracking = (): void => {
    incompleteRequests.delete(request)
    request.off('end', stopTracking)
    request.off('close', stopTracking)
    request.off('aborted', stopTracking)
  }
  if (!request.complete) {
    incompleteRequests.add(request)
    request.once('end', stopTracking)
    request.once('close', stopTracking)
    request.once('aborted', stopTracking)
    if (request.complete) stopTracking()
    else if (shutdownRequested()) request.destroy()
  }

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
  const initialCommittedCommandGeneration = dependencies.initialCommittedCommandGeneration ?? 0
  if (!Number.isSafeInteger(initialCommittedCommandGeneration) || initialCommittedCommandGeneration < 0) {
    throw new Error('INITIAL_COMMITTED_COMMAND_GENERATION_INVALID')
  }
  let server: Server | null = null
  let webSocketServer: WebSocketServer | null = null
  let stateBatchHub: StateBatchHubV1 | null = createStateBatchHub()
  const incompleteBodyRequests = new Set<IncomingMessage>()
  let activeRuntime: ActiveProjectRuntimeV1 | null = null
  let lifecycleTail: Promise<void> = Promise.resolve()
  let runtimeTail: Promise<void> = Promise.resolve()
  let committedCommandGeneration = initialCommittedCommandGeneration
  let shutdownRequested = false

  function requireStateBatchHub(): StateBatchHubV1 {
    if (stateBatchHub === null) throw new Error('STATE_BATCH_HUB_UNAVAILABLE')
    return stateBatchHub
  }

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

  function enqueueRuntimeTransition<T>(
    transition: () => Promise<T>,
  ): Promise<T> {
    const requestedTransition = runtimeTail.then(transition)
    runtimeTail = requestedTransition.then(() => undefined, () => undefined)
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
    const candidateGeneration = committedCommandGeneration + 1
    if (!Number.isSafeInteger(candidateGeneration)) {
      throw new RuntimeGatewayHttpError(
        503,
        'PROJECT_ACTIVATION_FAILED',
        'Project activation failed: COMMAND_GENERATION_EXHAUSTED',
      )
    }
    let candidateServerAdapter: OpcUaServerAdapterV1 | null = null
    let candidateClientAdapter: OpcUaClientAdapterV1 | null = null
    let candidateCommandDedupe: RuntimeCommandDedupeRegistryV1 | null = null
    let candidateCommandService: RuntimeCommandServiceV1 | null = null
    const stagedClientTimeline: RuntimeTimelineStagingV1 = createRuntimeTimelineStagingV1()
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
          publisherGeneration: candidateGeneration,
          publish: (batch: NormalizedOpcUaClientPublicationV1) => {
            if (clientBatchPublisherLive) {
              requireStateBatchHub().publish(batch)
            } else {
              // Candidate callbacks cannot throw into node-opcua.  The
              // detached timeline records a sticky health failure for the
              // transition's final pre-seal check instead.
              try { stagedClientTimeline.publish(batch) } catch { /* sealed callback is unreachable by design */ }
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
      candidateCommandDedupe = createRuntimeCommandDedupeRegistryV1()
      if (candidateClientAdapter !== null) {
        candidateCommandService = createRuntimeCommandServiceV1({
          project,
          configRevision,
          publisherId: `${config.gatewayId}:client-write`,
          generation: candidateGeneration,
          nowMs,
          clientAdapter: candidateClientAdapter,
          dedupe: candidateCommandDedupe,
        })
      }
      const nextRuntime = Object.freeze({
        project,
        configRevision,
        generation: candidateGeneration,
        commandDedupe: candidateCommandDedupe,
        commandService: candidateCommandService,
        serverAdapter: candidateServerAdapter,
        clientAdapter: candidateClientAdapter,
      })

      // Resolve the Hub and run the one explicit test-only injection while
      // callbacks still target the detached candidate timeline.  The final
      // health check therefore either includes that synchronous publication
      // in the sealed cut or fails the transition.
      const activeHub = requireStateBatchHub()
      dependencies.beforeCandidateTimelineSealForTest?.()
      stagedClientTimeline.assertHealthy()
      const sealedTimeline = stagedClientTimeline.seal()
      const preparedActivation = activeHub.prepareRevisionActivation({
        projectId: project.projectId,
        configRevision,
        gatewayId: config.gatewayId,
        originId: `${config.gatewayId}:opcua-client`,
        publisherGeneration: candidateGeneration,
        endpointIds: project.opcUa.mode === 'client' || project.opcUa.mode === 'bridge'
          ? project.opcUa.endpoints.filter(({ enabled }) => enabled).map(({ endpointId }) => endpointId)
          : [],
        stagedTimeline: sealedTimeline,
      })

      // No await, user callback, send/close, or disposal may appear in this
      // tail. A reentrant callback during flush reaches the installed Hub.
      activeRuntime = nextRuntime
      committedCommandGeneration = candidateGeneration
      preparedActivation.installPrepared()
      clientBatchPublisherLive = true
      preparedActivation.flushPrepared()
      try { previous?.commandService?.close() } catch { /* post-commit cleanup is isolated */ }
      try { previous?.commandDedupe.clear() } catch { /* post-commit cleanup is isolated */ }
    } catch (error) {
      candidateCommandService?.close()
      candidateCommandDedupe?.clear()
      await candidateClientAdapter?.stop().catch(() => undefined)
      await candidateServerAdapter?.stop().catch(() => undefined)
      let recovered = false
      let recoveryError: unknown = null
      try {
        recovered = await recoverPreviousRuntime(previous, previousAdaptersStopped)
      } catch (caughtRecoveryError) {
        recoveryError = caughtRecoveryError
        await Promise.all([
          previous?.clientAdapter?.stop().catch(() => undefined),
          previous?.serverAdapter?.stop().catch(() => undefined),
        ])
        previous?.commandService?.close()
        previous?.commandDedupe.clear()
      }
      if (!recovered) {
        activeRuntime = null
        requireStateBatchHub().deactivateRevision()
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
    const body = await readJsonBody(
      request,
      MAX_RUNTIME_PROJECT_BODY_BYTES_V1,
      incompleteBodyRequests,
      () => shutdownRequested,
    )
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
    const body = await readJsonBody(
      request,
      MAX_RUNTIME_BATCH_BYTES_V5,
      incompleteBodyRequests,
      () => shutdownRequested,
    )

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

  function noClientCommandResult(request: CommandRequestV1): CommandResultV1 {
    return validateCommandResultV1({
      type: 'command-result-v1',
      protocolVersion: 1,
      projectId: request.projectId,
      configRevision: request.configRevision,
      leaseGeneration: request.leaseGeneration,
      targetId: request.targetId,
      commandId: request.commandId,
      acknowledgement: 'REJECTED',
      executionState: 'FAILED',
      failureCode: 'OPC_UA_CLIENT_NOT_ACTIVE',
      message: 'Runtime command requires an active OPC UA Client Project.',
      attachedObjectId: null,
      completedAt: nowMs(),
    })
  }

  async function commandLeaseRequest(): Promise<unknown> {
    return enqueueRuntimeTransition(async () => {
      const commandService = activeRuntime?.commandService
      if (commandService === null || commandService === undefined) {
        throw new RuntimeGatewayHttpError(
          409,
          'OPC_UA_CLIENT_NOT_ACTIVE',
          'Runtime command lease requires an active OPC UA Client Project.',
        )
      }
      return commandService.lease()
    })
  }

  async function commandRequest(request: IncomingMessage): Promise<CommandResultV1> {
    const body = await readJsonBody(
      request,
      MAX_RUNTIME_BATCH_BYTES_V1,
      incompleteBodyRequests,
      () => shutdownRequested,
    )
    let command: CommandRequestV1
    try {
      command = validateCommandRequestV1(body)
    } catch (error) {
      throw new RuntimeGatewayHttpError(
        400,
        'COMMAND_REQUEST_INVALID',
        `Command Request validation failed: ${conciseError(error)}`,
      )
    }
    let result: Promise<CommandResultV1> | null = null
    await enqueueRuntimeTransition(async () => {
      const commandService = activeRuntime?.commandService
      result = commandService === null || commandService === undefined
        ? Promise.resolve(noClientCommandResult(command))
        : commandService.execute(command)
    })
    return result!
  }

  function clientEndpointActionPath(
    url: string | undefined,
  ): { readonly endpointId: string; readonly action: 'disconnect' | 'reconnect' } | null {
    if (url === undefined) return null
    const match = /^\/runtime\/client-endpoints\/([^/]+)\/(disconnect|reconnect)$/u.exec(url)
    if (match === null) return null
    try {
      return Object.freeze({
        endpointId: decodeURIComponent(match[1]!),
        action: match[2] as 'disconnect' | 'reconnect',
      })
    } catch {
      throw new RuntimeGatewayHttpError(
        400,
        'OPC_UA_ENDPOINT_ID_INVALID',
        'Client Endpoint id is not valid URL encoding.',
      )
    }
  }

  async function clientEndpointActionRequest(
    endpointId: string,
    action: 'disconnect' | 'reconnect',
  ): Promise<RuntimeGatewayStatusV1> {
    await enqueueRuntimeTransition(async () => {
      const active = activeRuntime
      if (
        active === null
        || (active.project.opcUa.mode !== 'client' && active.project.opcUa.mode !== 'bridge')
        || active.clientAdapter === null
      ) {
        throw new RuntimeGatewayHttpError(
          409,
          'OPC_UA_CLIENT_NOT_ACTIVE',
          'Client Endpoint control requires an active OPC UA Client Project.',
        )
      }
      const control = action === 'disconnect'
        ? active.clientAdapter.disconnectEndpoint
        : active.clientAdapter.reconnectEndpoint
      if (control === undefined) {
        throw new RuntimeGatewayHttpError(
          501,
          'OPC_UA_ENDPOINT_CONTROL_UNAVAILABLE',
          'The active OPC UA Client adapter does not support endpoint control.',
        )
      }
      try {
        await control(endpointId)
      } catch (error) {
        const code = error instanceof Error ? error.message : String(error)
        if (code === 'OPC_UA_ENDPOINT_NOT_FOUND') {
          throw new RuntimeGatewayHttpError(
            404,
            code,
            `Client Endpoint ${endpointId} does not exist in the active Project.`,
          )
        }
        if (code === 'OPC_UA_ENDPOINT_NOT_ACTIVE') {
          throw new RuntimeGatewayHttpError(
            409,
            code,
            `Client Endpoint ${endpointId} has no active binding.`,
          )
        }
        throw error
      }
    })
    return status()
  }

  function writeRequestError(response: ServerResponse, error: unknown): void {
    if (response.destroyed || response.headersSent || response.writableEnded) return
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

    if (request.method === 'GET' && request.url === '/runtime/command-lease') {
      writeJson(response, 200, await commandLeaseRequest())
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

    if (request.method === 'POST' && request.url === '/runtime/command') {
      writeJson(response, 200, await commandRequest(request))
      return
    }

    const endpointAction = clientEndpointActionPath(request.url)
    if (request.method === 'POST' && endpointAction !== null) {
      writeJson(
        response,
        200,
        await clientEndpointActionRequest(endpointAction.endpointId, endpointAction.action),
      )
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
          requireStateBatchHub().attach(webSocket)
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
    if (stateBatchHub === null) stateBatchHub = createStateBatchHub()
    if (server?.listening === true) {
      shutdownRequested = false
      return
    }
    server = null
    await startListening()
    shutdownRequested = false
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
    shutdownRequested = true
    let firstFailure: unknown
    let hasFailure = false
    const retainFirstFailure = (error: unknown): void => {
      if (hasFailure) return
      hasFailure = true
      firstFailure = error
    }
    try {
      await enqueueRuntimeTransition(async () => {
        const active = activeRuntime
        activeRuntime = null
        active?.commandService?.close()
        active?.commandDedupe.clear()
        for (const request of incompleteBodyRequests) {
          incompleteBodyRequests.delete(request)
          request.destroy()
        }

        let adapterFailure: unknown
        let hasAdapterFailure = false
        try {
          await active?.clientAdapter?.stop()
        } catch (error) {
          hasAdapterFailure = true
          adapterFailure = error
        }
        try {
          await active?.serverAdapter?.stop()
        } catch (error) {
          if (!hasAdapterFailure) {
            hasAdapterFailure = true
            adapterFailure = error
          }
        }
        if (hasAdapterFailure) throw adapterFailure
      })
    } catch (error) {
      retainFirstFailure(error)
    }
    const closingHub = stateBatchHub
    stateBatchHub = null
    try {
      await closingHub?.close()
    } catch (error) {
      retainFirstFailure(error)
    }
    try {
      await closeWebSocketServer()
    } catch (error) {
      retainFirstFailure(error)
    }
    try {
      await closeHttpServer()
    } catch (error) {
      retainFirstFailure(error)
    }
    try {
      stateBatchHub = createStateBatchHub()
    } catch (error) {
      retainFirstFailure(error)
    }
    if (hasFailure) throw firstFailure
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
