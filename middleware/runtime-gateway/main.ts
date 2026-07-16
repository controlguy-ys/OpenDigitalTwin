import {
  createServer,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  RuntimeGatewayDeploymentConfigError,
  readDeploymentConfig,
  type RuntimeGatewayDeploymentConfigV1,
} from './deployment-config.js'

export interface RuntimeGatewayPreApplyStatusV1 {
  readonly mode: 'off'
  readonly activeProjectId: null
  readonly activeConfigRevision: null
  readonly ready: false
  readonly readinessCode: 'NO_ACTIVE_REVISION'
  readonly opcUaStarted: false
}

export interface RuntimeGatewayEntrypointServiceV1 {
  start(): Promise<void>
  stop(): Promise<void>
  status(): RuntimeGatewayPreApplyStatusV1
}

export interface RuntimeGatewayEntrypointDependenciesV1 {
  readonly createHttpServer?: (requestListener: RequestListener) => Server
  readonly createOpcUaObject?: () => unknown
}

const PRE_APPLY_STATUS: RuntimeGatewayPreApplyStatusV1 = Object.freeze({
  mode: 'off',
  activeProjectId: null,
  activeConfigRevision: null,
  ready: false,
  readinessCode: 'NO_ACTIVE_REVISION',
  opcUaStarted: false,
})

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: Readonly<Record<string, string>>,
): void {
  const body = JSON.stringify(payload)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

export function createRuntimeGatewayEntrypointService(
  config: RuntimeGatewayDeploymentConfigV1,
  dependencies: RuntimeGatewayEntrypointDependenciesV1 = {},
): RuntimeGatewayEntrypointServiceV1 {
  const createHttpServer = dependencies.createHttpServer ?? createServer
  let server: Server | null = null
  let startPromise: Promise<void> | null = null
  let stopPromise: Promise<void> | null = null

  const requestListener: RequestListener = (request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      writeJson(response, 200, {
        status: 'live',
        gatewayId: config.gatewayId,
      })
      return
    }

    if (request.method === 'GET' && request.url === '/readyz') {
      writeJson(response, 503, {
        code: PRE_APPLY_STATUS.readinessCode,
        mode: PRE_APPLY_STATUS.mode,
      })
      return
    }

    response.writeHead(404, { 'content-length': '0' })
    response.end()
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

  async function start(): Promise<void> {
    if (server?.listening === true) return
    if (startPromise !== null) return startPromise
    if (stopPromise !== null) await stopPromise

    startPromise = startListening()
    try {
      await startPromise
    } finally {
      startPromise = null
    }
  }

  async function closeActiveServer(): Promise<void> {
    if (startPromise !== null) {
      try {
        await startPromise
      } catch {
        return
      }
    }

    const activeServer = server
    server = null
    if (activeServer === null) return

    await new Promise<void>((resolveStop, rejectStop) => {
      activeServer.close((error) => {
        if (error === undefined) resolveStop()
        else rejectStop(error)
      })
    })
  }

  async function stop(): Promise<void> {
    if (stopPromise !== null) return stopPromise
    stopPromise = closeActiveServer()
    try {
      await stopPromise
    } finally {
      stopPromise = null
    }
  }

  return Object.freeze({
    start,
    stop,
    status: () => PRE_APPLY_STATUS,
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
