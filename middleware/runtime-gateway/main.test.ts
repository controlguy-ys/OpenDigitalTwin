// @vitest-environment node

import {
  createServer as createNetServer,
  connect,
  type Server as NetServer,
} from 'node:net'
import WebSocket from 'ws'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  configRevisionForProjectV4,
  validateWorkcellProjectV4,
  type WorkcellProjectV4,
} from '../../src/core/project-v4/index.js'
import { createDualRobotSampleV4 } from '../../src/features/project/v4/dual-robot-sample-v4.js'
import type { RuntimeGatewayDeploymentConfigV1 } from './deployment-config.js'
import {
  ROBOT_SIM_OPC_UA_NAMESPACE_URI_V1,
  type OpcUaServerAdapterV1,
} from './opcua-server-adapter.js'
import type {
  OpcUaClientAdapterOptionsV1,
  OpcUaClientAdapterV1,
} from './opcua-client-adapter.js'
import {
  MAX_RUNTIME_BATCH_BYTES_V1,
  type StateBatchV1,
} from '../../src/core/runtime-protocol/v1.js'
import { validateRuntimeGatewayStatusV1 } from '../../src/core/runtime-protocol/gateway-status-v1.js'

async function importMain() {
  return import('./main.js')
}

async function findAvailablePort(): Promise<number> {
  const server = createNetServer()

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('Expected an ephemeral TCP address')
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error))
  })
  return address.port
}

async function closeNetServer(server: NetServer): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error))
  })
}

async function listenOnEphemeralPort(): Promise<{
  readonly server: NetServer
  readonly port: number
}> {
  const server = createNetServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('Expected an ephemeral TCP address')
  }

  return { server, port: address.port }
}

function createTestConfig(httpPort: number): RuntimeGatewayDeploymentConfigV1 {
  return Object.freeze({
    gatewayId: 'test-gateway',
    runtimeKind: 'native',
    host: '127.0.0.1',
    httpPort,
    opcUaAdvertisedHost: '127.0.0.1',
    opcUaAdvertisedPort: 24840,
    opcUaPort: 14840,
  })
}

function sampleProject(
  mode: 'off' | 'server' | 'client' | 'bridge',
  revisionId = `revision-main-${mode}`,
): WorkcellProjectV4 {
  const project = createDualRobotSampleV4({
    projectId: 'project-main-http',
    revisionId,
    nowIso: '2026-07-17T00:00:00.000Z',
    opcUaMode: mode === 'off' ? 'off' : 'server',
  })
  return mode === 'off' || mode === 'server'
    ? project
    : validateWorkcellProjectV4({ ...project, opcUa: { ...project.opcUa, mode } })
}

function projectWithReservedJointId(): WorkcellProjectV4 {
  const source = sampleProject('server')
  const sourceDefinition = source.robotDefinitions[0]!
  const previousJointId = sourceDefinition.joints[0]!.id
  const definition = {
    ...sourceDefinition,
    joints: sourceDefinition.joints.map((joint, index) => (
      index === 0 ? { ...joint, id: '__proto__' } : joint
    )),
  }
  return validateWorkcellProjectV4({
    ...source,
    robotDefinitions: source.robotDefinitions.map((candidate) => (
      candidate.id === definition.id ? definition : candidate
    )),
    robots: source.robots.map((robot) => robot.definitionId !== definition.id
      ? robot
      : {
          ...robot,
          initialJointValues: Object.fromEntries(definition.joints.map(({ id, home }) => [
            id,
            id === '__proto__'
              ? robot.initialJointValues[previousJointId] ?? home
              : robot.initialJointValues[id],
          ])),
        }),
    jobs: [],
    opcUa: { ...source.opcUa, mappings: [] },
  })
}

function fakeServerAdapter(
  endpointUrl = 'opc.tcp://127.0.0.1:14840',
  stopErrorAfterShutdown: Error | null = null,
): {
  readonly adapter: OpcUaServerAdapterV1
  readonly start: ReturnType<typeof vi.fn>
  readonly stop: ReturnType<typeof vi.fn>
  readonly publishRobotJointState: ReturnType<typeof vi.fn>
} {
  let started = false
  const start = vi.fn(async () => {
    started = true
  })
  const stop = vi.fn(async () => {
    started = false
    if (stopErrorAfterShutdown !== null) {
      const error = stopErrorAfterShutdown
      stopErrorAfterShutdown = null
      throw error
    }
  })
  const publishRobotJointState = vi.fn(async () => undefined)
  const adapter: OpcUaServerAdapterV1 = {
    start,
    stop,
    publishRobotJointState,
    status: () => ({
      mode: 'server',
      started,
      endpointUrl: started ? endpointUrl : null,
      namespaceUri: ROBOT_SIM_OPC_UA_NAMESPACE_URI_V1,
      namespaceIndex: started ? 2 : null,
      nodeIds: {},
    }),
  }
  return { adapter, start, stop, publishRobotJointState }
}

function fakeClientAdapter(): {
  readonly adapter: OpcUaClientAdapterV1
  readonly start: ReturnType<typeof vi.fn>
  readonly stop: ReturnType<typeof vi.fn>
} {
  let started = false
  const start = vi.fn(async () => { started = true })
  const stop = vi.fn(async () => { started = false })
  return {
    adapter: {
      start,
      stop,
      status: () => [{
        endpointId: 'endpoint-sample-server',
        endpointUrl: 'opc.tcp://127.0.0.1:4840',
        phase: started ? 'reconnecting' : 'disabled',
        sessionActive: false,
        subscriptionActive: false,
        monitoredItemCount: 0,
        mappingCount: 0,
        lastValueQuality: null,
        lastNotificationAtMs: null,
        lastGoodValueAtMs: null,
        reconnectAttempt: started ? 1 : 0,
        nextRetryAtMs: started ? 9_100 : null,
        lastError: started
          ? { code: 'OPC_UA_CLIENT_CONNECT_TIMEOUT', message: 'OPC_UA_CLIENT_CONNECT_TIMEOUT', occurredAtMs: 9_000 }
          : null,
      }],
    },
    start,
    stop,
  }
}

function gatewayStatus(value: unknown) {
  return validateRuntimeGatewayStatusV1(value)
}

function singleMappingBatchAtExactEncodedSize(
  source: StateBatchV1,
  byteLength: number,
): StateBatchV1 {
  const emptyValueSource = {
    ...source,
    values: [{ ...source.values[0]!, value: '' }],
  }
  const padding = byteLength - new TextEncoder().encode(JSON.stringify(emptyValueSource)).byteLength
  if (padding < 0) throw new Error('Requested batch size is below its fixed envelope.')
  return {
    ...emptyValueSource,
    values: [{ ...emptyValueSource.values[0]!, value: 'x'.repeat(padding) }],
  }
}

async function requestJson(
  port: number,
  method: 'PUT' | 'POST',
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function requestUpgrade(port: number, path: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    let response = ''
    let settled = false

    const settle = () => {
      if (settled) return
      settled = true
      resolve(response)
    }

    socket.setEncoding('utf8')
    socket.once('error', reject)
    socket.on('data', (chunk: string) => {
      response += chunk
    })
    socket.once('end', settle)
    socket.once('close', settle)
    socket.once('connect', () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        'Host: 127.0.0.1',
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Key: dGVzdC1rZXk=',
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'))
    })
  })
}

async function openWebSocket(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/runtime/ws`)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return socket
}

async function nextWebSocketMessage(socket: WebSocket): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    socket.once('message', (data) => resolve(data.toString()))
    socket.once('error', reject)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runtime Gateway entrypoint', () => {
  it('has no import-time signals, logging, or exit-code side effects', async () => {
    vi.resetModules()
    const signalCounts = {
      SIGINT: process.listenerCount('SIGINT'),
      SIGTERM: process.listenerCount('SIGTERM'),
    }
    const exitCode = process.exitCode
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await importMain()

    expect(process.listenerCount('SIGINT')).toBe(signalCounts.SIGINT)
    expect(process.listenerCount('SIGTERM')).toBe(signalCounts.SIGTERM)
    expect(process.exitCode).toBe(exitCode)
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
  })

  it('reports a frozen Off status before any active Project Revision exists', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const service = createRuntimeGatewayEntrypointService(createTestConfig(8081))

    const status = gatewayStatus(service.status())

    expect(status).toMatchObject({
      type: 'runtime-gateway-status-v1',
      protocolVersion: 1,
      gateway: { gatewayId: 'test-gateway', phase: 'online', runtimeKind: 'native' },
      deployment: {
        http: { bindHost: '127.0.0.1', port: 8081 },
        opcUaServer: {
          bindHost: '127.0.0.1', port: 14840,
          advertisedHost: '127.0.0.1', advertisedPort: 24840,
        },
      },
      project: {
        phase: 'not-applied', projectId: null, revisionId: null, configRevision: null,
        readinessCode: 'NO_ACTIVE_REVISION',
      },
      opcUa: {
        mode: 'off',
        server: { phase: 'disabled', endpointUrl: null, lastError: null },
        clientEndpoints: [],
      },
    })
    expect(Object.isFrozen(status)).toBe(true)
  })

  it('serves exact Off-mode liveness/readiness and rejects ordinary routes', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const createOpcUaServerAdapter = vi.fn(() => fakeServerAdapter().adapter)
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      { createOpcUaServerAdapter },
    )

    await service.start()
    await service.start()
    try {
      const health = await fetch(`http://127.0.0.1:${port}/healthz`)
      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({
        status: 'live',
        gatewayId: 'test-gateway',
      })

      const readiness = await fetch(`http://127.0.0.1:${port}/readyz`)
      expect(readiness.status).toBe(503)
      expect(await readiness.json()).toEqual({
        code: 'NO_ACTIVE_REVISION',
        mode: 'off',
      })

      const missing = await fetch(`http://127.0.0.1:${port}/not-found`)
      expect(missing.status).toBe(404)
      expect(createOpcUaServerAdapter).not.toHaveBeenCalled()
    } finally {
      await service.stop()
    }
  })

  it('rejects WebSocket Upgrade outside the exact runtime stream route', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const createOpcUaServerAdapter = vi.fn(() => fakeServerAdapter().adapter)
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      { createOpcUaServerAdapter },
    )

    await service.start()
    try {
      const response = await requestUpgrade(port, '/runtime/ws/not-exact')
      expect(response).not.toContain('101 Switching Protocols')
      expect(response).toMatch(/^HTTP\/1\.1 426 Upgrade Required\r\n/)
      expect(createOpcUaServerAdapter).not.toHaveBeenCalled()
    } finally {
      await service.stop()
    }
  })

  it('activates an offline Client Project promptly and exposes its connection state', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const fake = fakeClientAdapter()
    let suppliedConfigRevision: string | null = null
    const createOpcUaClientAdapter = vi.fn((
      _project: WorkcellProjectV4,
      options: OpcUaClientAdapterOptionsV1,
    ) => {
      suppliedConfigRevision = options.configRevision
      return fake.adapter
    })
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      { createOpcUaClientAdapter },
    )
    const project = sampleProject('client')

    await service.start()
    try {
      const apply = await requestJson(port, 'PUT', '/runtime/project', project)
      expect(apply.status).toBe(200)
      expect(gatewayStatus(await apply.json())).toMatchObject({
        project: {
          phase: 'ready', projectId: project.projectId, revisionId: project.revisionId,
          readinessCode: 'READY',
        },
        opcUa: {
          mode: 'client',
          server: { phase: 'disabled', endpointUrl: null, lastError: null },
          clientEndpoints: [{
            endpointId: 'endpoint-sample-server', phase: 'reconnecting',
            sessionActive: false, subscriptionActive: false,
            lastError: { code: 'OPC_UA_CLIENT_CONNECT_TIMEOUT' },
          }],
        },
      })
      expect(createOpcUaClientAdapter).toHaveBeenCalledTimes(1)
      expect(suppliedConfigRevision).toBe(await configRevisionForProjectV4(project))
      expect(fake.start).toHaveBeenCalledTimes(1)
    } finally {
      await service.stop()
    }
    expect(fake.stop).toHaveBeenCalledTimes(1)
  })

  it('activates both adapters for a Bridge Project', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const server = fakeServerAdapter()
    const client = fakeClientAdapter()
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      {
        createOpcUaServerAdapter: () => server.adapter,
        createOpcUaClientAdapter: () => client.adapter,
      },
    )

    await service.start()
    try {
      const response = await requestJson(port, 'PUT', '/runtime/project', sampleProject('bridge'))
      expect(response.status).toBe(200)
      expect(gatewayStatus(await response.json())).toMatchObject({
        project: { phase: 'ready', readinessCode: 'READY' },
        opcUa: {
          mode: 'bridge',
          server: { phase: 'listening', endpointUrl: 'opc.tcp://127.0.0.1:14840', lastError: null },
          clientEndpoints: [{
            endpointId: 'endpoint-sample-server', phase: 'reconnecting',
            lastError: { code: 'OPC_UA_CLIENT_CONNECT_TIMEOUT' },
          }],
        },
      })
      expect(server.start).toHaveBeenCalledTimes(1)
      expect(client.start).toHaveBeenCalledTimes(1)
    } finally {
      await service.stop()
    }
    expect(server.stop).toHaveBeenCalledTimes(1)
    expect(client.stop).toHaveBeenCalledTimes(1)
  })

  it('streams a Client state batch through the exact WebSocket route', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const client = fakeClientAdapter()
    let publish: ((batch: StateBatchV1) => void) | null = null
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      {
        createOpcUaClientAdapter: (_project, options) => {
          publish = options.publish
          return client.adapter
        },
      },
    )
    const project = sampleProject('client', 'a'.repeat(64))
    const configRevision = await configRevisionForProjectV4(project)

    await service.start()
    let socket: WebSocket | null = null
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      socket = await openWebSocket(port)
      const message = nextWebSocketMessage(socket)
      publish!({
        type: 'state-batch-v1',
        protocolVersion: 1,
        gatewayId: 'test-gateway',
        projectId: project.projectId,
        configRevision,
        endpointId: 'endpoint-sample-server',
        sequence: 1,
        sourceTimestampMs: 1,
        publishedTimestampMs: 1,
        originId: 'test-gateway:opcua-client',
        values: [{
          mappingId: 'mapping-sample-crb-j1',
          coherenceGroupId: null,
          value: 10,
          unit: 'degree',
          quality: 'GOOD',
          statusCode: 'Good',
        }],
      })
      expect(JSON.parse(await message)).toMatchObject({
        type: 'state-batch-v1',
        projectId: project.projectId,
        configRevision,
        values: [{ mappingId: 'mapping-sample-crb-j1', value: 10 }],
      })
    } finally {
      socket?.close()
      await service.stop()
    }
  })

  it('stages synchronous Client start samples until activation and accepts sequence one after same-revision replacement', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    let adapterIndex = 0
    const createOpcUaClientAdapter = vi.fn((_project: WorkcellProjectV4, options) => {
      const value = ++adapterIndex
      const adapter: OpcUaClientAdapterV1 = {
        start: async () => {
          options.publish({
            type: 'state-batch-v1',
            protocolVersion: 1,
            gatewayId: 'test-gateway',
            projectId: _project.projectId,
            configRevision: options.configRevision,
            endpointId: 'endpoint-sample-server',
            sequence: 1,
            sourceTimestampMs: value,
            publishedTimestampMs: value,
            originId: 'test-gateway:opcua-client',
            values: [{
              mappingId: 'mapping-synchronous-start',
              coherenceGroupId: null,
              value,
              unit: 'degree',
              quality: 'GOOD',
              statusCode: 'Good',
            }],
          })
        },
        stop: async () => undefined,
        status: () => [],
      }
      return adapter
    })
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      { createOpcUaClientAdapter },
    )
    const project = sampleProject('client', 'revision-synchronous-start')

    await service.start()
    let socket: WebSocket | null = null
    let replaySocket: WebSocket | null = null
    try {
      socket = await openWebSocket(port)
      const initial = nextWebSocketMessage(socket)
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      expect(JSON.parse(await initial)).toMatchObject({
        sequence: 1,
        values: [{ mappingId: 'mapping-synchronous-start', value: 1 }],
      })

      replaySocket = new WebSocket(`ws://127.0.0.1:${port}/runtime/ws`)
      const replay = nextWebSocketMessage(replaySocket)
      await new Promise<void>((resolve, reject) => {
        replaySocket!.once('open', resolve)
        replaySocket!.once('error', reject)
      })
      expect(JSON.parse(await replay)).toMatchObject({
        values: [{ mappingId: 'mapping-synchronous-start', value: 1 }],
      })

      const replacement = nextWebSocketMessage(socket)
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      expect(JSON.parse(await replacement)).toMatchObject({
        sequence: 3,
        values: [{ mappingId: 'mapping-synchronous-start', value: 2 }],
      })
      expect(createOpcUaClientAdapter).toHaveBeenCalledTimes(2)
    } finally {
      replaySocket?.close()
      socket?.close()
      await service.stop()
    }
  })

  it('keeps every channel from one synchronous Client source batch through activation', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const createOpcUaClientAdapter = vi.fn((_project: WorkcellProjectV4, options) => {
      const adapter: OpcUaClientAdapterV1 = {
        start: async () => {
          options.publish({
            type: 'state-batch-v1',
            protocolVersion: 1,
            gatewayId: 'test-gateway',
            projectId: _project.projectId,
            configRevision: options.configRevision,
            endpointId: 'endpoint-sample-server',
            sequence: 1,
            sourceTimestampMs: 1,
            publishedTimestampMs: 1,
            originId: 'test-gateway:opcua-client',
            values: [
              {
                mappingId: 'mapping-object-box-x',
                coherenceGroupId: null,
                value: 1.5,
                unit: 'meter',
                quality: 'GOOD',
                statusCode: 'Good',
              },
              {
                mappingId: 'mapping-object-box-status',
                coherenceGroupId: null,
                value: 92,
                unit: 'status-code',
                quality: 'GOOD',
                statusCode: 'Good',
              },
            ],
          })
        },
        stop: async () => undefined,
        status: () => [],
      }
      return adapter
    })
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      { createOpcUaClientAdapter },
    )
    const project = sampleProject('client', 'revision-synchronous-multi-channel')

    await service.start()
    let socket: WebSocket | null = null
    try {
      socket = await openWebSocket(port)
      const received: StateBatchV1[] = []
      socket.on('message', (data) => {
        received.push(JSON.parse(data.toString()) as StateBatchV1)
      })
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      await expect.poll(
        () => received.flatMap(({ values }) => values.map(({ mappingId, value }) => ({ mappingId, value })))
          .sort((left, right) => left.mappingId.localeCompare(right.mappingId)),
      ).toEqual([
        { mappingId: 'mapping-object-box-status', value: 92 },
        { mappingId: 'mapping-object-box-x', value: 1.5 },
      ])
      expect(createOpcUaClientAdapter).toHaveBeenCalledTimes(1)
    } finally {
      socket?.close()
      await service.stop()
    }
  })

  it('keeps an older independent Status snapshot while newer Pose snapshots arrive during activation', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const createOpcUaClientAdapter = vi.fn((_project: WorkcellProjectV4, options) => {
      const publish = (
        sequence: number,
        mappingId: string,
        value: number,
        unit: string,
      ) => options.publish({
        type: 'state-batch-v1',
        protocolVersion: 1,
        gatewayId: 'test-gateway',
        projectId: _project.projectId,
        configRevision: options.configRevision,
        endpointId: 'endpoint-sample-server',
        sequence,
        sourceTimestampMs: sequence,
        publishedTimestampMs: sequence,
        originId: 'test-gateway:opcua-client',
        values: [{
          mappingId,
          coherenceGroupId: null,
          value,
          unit,
          quality: 'GOOD',
          statusCode: 'Good',
        }],
      })
      const adapter: OpcUaClientAdapterV1 = {
        start: async () => {
          publish(1, 'mapping-object-box-status', 91, 'status-code')
          for (let sequence = 2; sequence <= 130; sequence += 1) {
            publish(sequence, 'mapping-object-box-x', sequence, 'meter')
          }
        },
        stop: async () => undefined,
        status: () => [],
      }
      return adapter
    })
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      { createOpcUaClientAdapter },
    )
    const project = sampleProject('client', 'revision-synchronous-channel-retention')

    await service.start()
    let socket: WebSocket | null = null
    try {
      socket = await openWebSocket(port)
      const received: StateBatchV1[] = []
      socket.on('message', (data) => {
        received.push(JSON.parse(data.toString()) as StateBatchV1)
      })
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      await expect.poll(
        () => received.flatMap(({ values }) => values.map(({ mappingId, value }) => ({ mappingId, value })))
          .sort((left, right) => left.mappingId.localeCompare(right.mappingId)),
      ).toEqual([
        { mappingId: 'mapping-object-box-status', value: 91 },
        { mappingId: 'mapping-object-box-x', value: 130 },
      ])
      expect(createOpcUaClientAdapter).toHaveBeenCalledTimes(1)
    } finally {
      socket?.close()
      await service.stop()
    }
  })

  it('keeps the last streamable staged channel when a newer activation sample cannot be streamed', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    let publishLive: ((batch: StateBatchV1) => void) | null = null
    const createOpcUaClientAdapter = vi.fn((_project: WorkcellProjectV4, options) => {
      const batch = (sequence: number, value: number | string): StateBatchV1 => ({
        type: 'state-batch-v1',
        protocolVersion: 1,
        gatewayId: 'test-gateway',
        projectId: _project.projectId,
        configRevision: options.configRevision,
        endpointId: 'endpoint-sample-server',
        sequence,
        sourceTimestampMs: sequence,
        publishedTimestampMs: sequence,
        originId: 'test-gateway:opcua-client',
        values: [{
          mappingId: 'mapping-object-box-x',
          coherenceGroupId: null,
          value,
          unit: 'meter',
          quality: 'GOOD',
          statusCode: 'Good',
        }],
      })
      publishLive = options.publish
      const adapter: OpcUaClientAdapterV1 = {
        start: async () => {
          options.publish(batch(1, 1.5))
          options.publish(singleMappingBatchAtExactEncodedSize(
            batch(2, ''),
            MAX_RUNTIME_BATCH_BYTES_V1,
          ))
        },
        stop: async () => undefined,
        status: () => [],
      }
      return adapter
    })
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      { createOpcUaClientAdapter },
    )
    const project = sampleProject('client', 'revision-synchronous-last-streamable')

    await service.start()
    let socket: WebSocket | null = null
    try {
      socket = await openWebSocket(port)
      const received: StateBatchV1[] = []
      socket.on('message', (data) => {
        received.push(JSON.parse(data.toString()) as StateBatchV1)
      })
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      await expect.poll(
        () => received.flatMap(({ values }) => values.map(({ value }) => value)),
      ).toEqual([1.5])

      publishLive!({
        type: 'state-batch-v1',
        protocolVersion: 1,
        gatewayId: 'test-gateway',
        projectId: project.projectId,
        configRevision: await configRevisionForProjectV4(project),
        endpointId: 'endpoint-sample-server',
        sequence: 3,
        sourceTimestampMs: 3,
        publishedTimestampMs: 3,
        originId: 'test-gateway:opcua-client',
        values: [{
          mappingId: 'mapping-object-box-x',
          coherenceGroupId: null,
          value: 3.5,
          unit: 'meter',
          quality: 'GOOD',
          statusCode: 'Good',
        }],
      })
      await expect.poll(
        () => received.flatMap(({ values }) => values.map(({ value }) => value)),
      ).toEqual([1.5, 3.5])
    } finally {
      socket?.close()
      await service.stop()
    }
  })

  it('closes runtime sockets on stop and accepts a fresh stream after restart', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port))
    await service.start()
    const first = await openWebSocket(port)
    const closed = new Promise<void>((resolve) => first.once('close', resolve))
    await service.stop()
    await closed
    await service.start()
    const second = await openWebSocket(port)
    try {
      expect(second.readyState).toBe(WebSocket.OPEN)
    } finally {
      second.close()
      await service.stop()
    }
  })

  it('recovers a prior Client when a replacement Client fails to start', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const prior = fakeClientAdapter()
    const candidate = fakeClientAdapter()
    candidate.start.mockRejectedValueOnce(new Error('candidate-client-failure'))
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      {
        createOpcUaClientAdapter: (project) => (
          project.revisionId === 'revision-client-fails' ? candidate.adapter : prior.adapter
        ),
      },
    )
    const firstProject = sampleProject('client', 'revision-client-prior')
    const replacement = sampleProject('client', 'revision-client-fails')

    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', firstProject)).status).toBe(200)
      const failed = await requestJson(port, 'PUT', '/runtime/project', replacement)
      expect(failed.status).toBe(503)
      expect(await failed.json()).toMatchObject({
        code: 'PROJECT_ACTIVATION_FAILED',
        recoveredRevisionId: firstProject.revisionId,
      })
      expect(prior.stop).toHaveBeenCalledTimes(1)
      expect(prior.start).toHaveBeenCalledTimes(2)
      expect(candidate.stop).toHaveBeenCalledTimes(1)
      expect(gatewayStatus(service.status())).toMatchObject({
        project: { phase: 'ready', revisionId: firstProject.revisionId },
        opcUa: { mode: 'client' },
      })
    } finally {
      await service.stop()
    }
  })

  it('stops idempotently before and after starting', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port))

    await service.stop()
    await service.stop()
    await service.start()
    await service.stop()
    await service.stop()

    await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow()
  })

  it('serializes start, pending stop, and restart so the final state is live', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port))

    const firstStart = service.start()
    const pendingStop = service.stop()
    const restart = service.start()

    try {
      const results = await Promise.allSettled([firstStart, pendingStop, restart])
      expect(results.map(({ status }) => status)).toEqual([
        'fulfilled',
        'fulfilled',
        'fulfilled',
      ])

      const health = await fetch(`http://127.0.0.1:${port}/healthz`)
      expect(health.status).toBe(200)
    } finally {
      await service.stop()
    }
  })

  it('serializes concurrent restarts after stop without competing listeners', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port))

    await service.start()
    const pendingStop = service.stop()
    const firstRestart = service.start()
    const secondRestart = service.start()

    try {
      const results = await Promise.allSettled([
        pendingStop,
        firstRestart,
        secondRestart,
      ])
      expect(results.map(({ status }) => status)).toEqual([
        'fulfilled',
        'fulfilled',
        'fulfilled',
      ])

      const health = await fetch(`http://127.0.0.1:${port}/healthz`)
      expect(health.status).toBe(200)
    } finally {
      await service.stop()
    }
  })

  it('honors the final requested state across repeated concurrent transitions', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port))

    await service.start()
    const transitions = [
      service.stop(),
      service.start(),
      service.stop(),
      service.start(),
      service.stop(),
      service.start(),
    ]

    try {
      const results = await Promise.allSettled(transitions)
      expect(results.every(({ status }) => status === 'fulfilled')).toBe(true)

      const health = await fetch(`http://127.0.0.1:${port}/healthz`)
      expect(health.status).toBe(200)
    } finally {
      await service.stop()
    }
  })

  it('retries a failed listen after the real port conflict is removed', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const blocker = await listenOnEphemeralPort()
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(blocker.port),
    )

    try {
      await expect(service.start()).rejects.toMatchObject({ code: 'EADDRINUSE' })
      await closeNetServer(blocker.server)

      await service.start()
      const health = await fetch(`http://127.0.0.1:${blocker.port}/healthz`)
      expect(health.status).toBe(200)
    } finally {
      await service.stop()
      await closeNetServer(blocker.server)
    }
  })

  it('activates an Off Project without constructing OPC UA and becomes ready', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const createOpcUaServerAdapter = vi.fn(() => fakeServerAdapter().adapter)
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      {
        createOpcUaServerAdapter,
        pkiRootDir: 'C:\\runtime-gateway-test-pki',
      },
    )
    const project = sampleProject('off')

    await service.start()
    try {
      const apply = await requestJson(port, 'PUT', '/runtime/project', project)
      expect(apply.status).toBe(200)
      expect(gatewayStatus(await apply.json())).toMatchObject({
        project: { phase: 'ready', projectId: project.projectId, revisionId: project.revisionId },
        opcUa: {
          mode: 'off',
          server: { phase: 'disabled', endpointUrl: null, lastError: null },
          clientEndpoints: [],
        },
      })
      expect(createOpcUaServerAdapter).not.toHaveBeenCalled()

      const readiness = await fetch(`http://127.0.0.1:${port}/readyz`)
      expect(readiness.status).toBe(200)
      expect(gatewayStatus(await readiness.json())).toMatchObject({
        project: { phase: 'ready', projectId: project.projectId, revisionId: project.revisionId },
        opcUa: { mode: 'off', server: { phase: 'disabled', endpointUrl: null } },
      })

      const status = await fetch(`http://127.0.0.1:${port}/runtime/status`)
      expect(status.status).toBe(200)
      expect(gatewayStatus(await status.json())).toMatchObject({
        project: { phase: 'ready', projectId: project.projectId, revisionId: project.revisionId },
        opcUa: { mode: 'off', server: { phase: 'disabled', endpointUrl: null } },
      })
    } finally {
      await service.stop()
    }
  })

  it('activates a Server Project, publishes a validated two-Robot state, and stops its adapter', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const fake = fakeServerAdapter()
    const createOpcUaServerAdapter = vi.fn(() => fake.adapter)
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      {
        createOpcUaServerAdapter,
        pkiRootDir: 'C:\\runtime-gateway-test-pki',
      },
    )
    const project = sampleProject('server')

    await service.start()
    try {
      const apply = await requestJson(port, 'PUT', '/runtime/project', project)
      expect(apply.status).toBe(200)
      expect(gatewayStatus(await apply.json())).toMatchObject({
        project: { phase: 'ready', projectId: project.projectId, revisionId: project.revisionId },
        opcUa: {
          mode: 'server',
          server: { phase: 'listening', endpointUrl: 'opc.tcp://127.0.0.1:14840', lastError: null },
          clientEndpoints: [],
        },
      })
      expect(createOpcUaServerAdapter).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: project.projectId,
          revisionId: project.revisionId,
        }),
        {
          advertisedHost: '127.0.0.1',
          advertisedPort: 24840,
          host: '127.0.0.1',
          port: 14840,
          pkiRootDir: 'C:\\runtime-gateway-test-pki',
        },
      )
      expect(fake.start).toHaveBeenCalledTimes(1)

      const publish = await requestJson(port, 'POST', '/runtime/state', {
        projectId: project.projectId,
        revisionId: project.revisionId,
        robots: [
          { robotId: 'robot-sample-crb', jointValues: { J1: 15, J2: -5 } },
          {
            robotId: 'robot-sample-linear-slide',
            jointValues: { SLIDE_X: 0.75 },
          },
        ],
      })
      expect(publish.status).toBe(200)
      expect(gatewayStatus(await publish.json())).toMatchObject({
        project: { phase: 'ready', projectId: project.projectId, revisionId: project.revisionId },
        opcUa: { mode: 'server', server: { phase: 'listening', endpointUrl: 'opc.tcp://127.0.0.1:14840' } },
      })
      expect(fake.publishRobotJointState.mock.calls).toEqual([
        ['robot-sample-crb', { J1: 15, J2: -5 }],
        ['robot-sample-linear-slide', { SLIDE_X: 0.75 }],
      ])

      const readiness = await fetch(`http://127.0.0.1:${port}/readyz`)
      expect(readiness.status).toBe(200)
      expect(gatewayStatus(await readiness.json())).toMatchObject({
        project: { phase: 'ready' },
        opcUa: { mode: 'server', server: { phase: 'listening', endpointUrl: 'opc.tcp://127.0.0.1:14840' } },
      })
    } finally {
      await service.stop()
    }

    expect(fake.stop).toHaveBeenCalledTimes(1)
    expect(gatewayStatus(service.status())).toMatchObject({
      project: { phase: 'not-applied', readinessCode: 'NO_ACTIVE_REVISION' },
      opcUa: { mode: 'off', server: { phase: 'disabled', endpointUrl: null } },
    })
  })

  it('rejects stale or invalid state before publishing any part of the batch', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const fake = fakeServerAdapter()
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      { createOpcUaServerAdapter: () => fake.adapter },
    )
    const project = sampleProject('server')

    await service.start()
    try {
      await requestJson(port, 'PUT', '/runtime/project', project)

      const stale = await requestJson(port, 'POST', '/runtime/state', {
        projectId: project.projectId,
        revisionId: 'revision-stale',
        robots: [{ robotId: 'robot-sample-crb', jointValues: { J1: 10 } }],
      })
      expect(stale.status).toBe(409)
      expect(await stale.json()).toMatchObject({ code: 'REVISION_MISMATCH' })

      const invalid = await requestJson(port, 'POST', '/runtime/state', {
        projectId: project.projectId,
        revisionId: project.revisionId,
        robots: [
          { robotId: 'robot-sample-crb', jointValues: { J1: 10 } },
          {
            robotId: 'robot-sample-linear-slide',
            jointValues: { JOINT_MISSING: 0.5 },
          },
        ],
      })
      expect(invalid.status).toBe(400)
      expect(await invalid.json()).toMatchObject({ code: 'RUNTIME_STATE_INVALID' })
      expect(fake.publishRobotJointState).not.toHaveBeenCalled()
    } finally {
      await service.stop()
    }
  })

  it('preserves a schema-valid reserved JavaScript key as an arbitrary Joint id', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const fake = fakeServerAdapter()
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      { createOpcUaServerAdapter: () => fake.adapter },
    )
    const project = projectWithReservedJointId()

    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      const jointValues = Object.fromEntries([['__proto__', 12]])
      const response = await requestJson(port, 'POST', '/runtime/state', {
        projectId: project.projectId,
        revisionId: project.revisionId,
        robots: [{ robotId: project.robots[0]!.id, jointValues }],
      })

      expect(response.status).toBe(200)
      expect(fake.publishRobotJointState).toHaveBeenCalledTimes(1)
      const published = fake.publishRobotJointState.mock.calls[0]![1]
      expect(Object.hasOwn(published, '__proto__')).toBe(true)
      expect(published.__proto__).toBe(12)
    } finally {
      await service.stop()
    }
  })

  it('bounds and rejects malformed Project bodies without replacing the active Revision', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port))
    const project = sampleProject('off')

    await service.start()
    try {
      await requestJson(port, 'PUT', '/runtime/project', project)

      const malformed = await fetch(`http://127.0.0.1:${port}/runtime/project`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{',
      })
      expect(malformed.status).toBe(400)
      expect(await malformed.json()).toMatchObject({ code: 'JSON_BODY_INVALID' })

      const oversized = await fetch(`http://127.0.0.1:${port}/runtime/project`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ padding: 'x'.repeat(1_048_576) }),
      })
      expect(oversized.status).toBe(413)
      expect(await oversized.json()).toMatchObject({ code: 'REQUEST_BODY_TOO_LARGE' })

      expect(gatewayStatus(service.status())).toMatchObject({
        project: { phase: 'ready', projectId: project.projectId, revisionId: project.revisionId },
      })
    } finally {
      await service.stop()
    }
  })

  it('recovers the prior active Server when a replacement Server fails to start', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const prior = fakeServerAdapter('opc.tcp://127.0.0.1:14840')
    const candidate = fakeServerAdapter('opc.tcp://127.0.0.1:14841')
    candidate.start.mockRejectedValueOnce(new Error('candidate-port-conflict'))
    const createOpcUaServerAdapter = vi.fn((project: WorkcellProjectV4) => (
      project.revisionId === 'revision-replacement-fails'
        ? candidate.adapter
        : prior.adapter
    ))
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      { createOpcUaServerAdapter },
    )
    const firstProject = sampleProject('server', 'revision-prior-active')
    const replacement = sampleProject('server', 'revision-replacement-fails')

    await service.start()
    try {
      const firstApply = await requestJson(
        port,
        'PUT',
        '/runtime/project',
        firstProject,
      )
      expect(firstApply.status).toBe(200)

      const failedApply = await requestJson(
        port,
        'PUT',
        '/runtime/project',
        replacement,
      )
      expect(failedApply.status).toBe(503)
      expect(await failedApply.json()).toMatchObject({
        code: 'PROJECT_ACTIVATION_FAILED',
        recoveredRevisionId: firstProject.revisionId,
      })
      expect(prior.stop).toHaveBeenCalledTimes(1)
      expect(prior.start).toHaveBeenCalledTimes(2)
      expect(candidate.start).toHaveBeenCalledTimes(1)
      expect(candidate.stop).toHaveBeenCalledTimes(1)
      expect(gatewayStatus(service.status())).toMatchObject({
        project: { phase: 'ready', projectId: firstProject.projectId, revisionId: firstProject.revisionId },
        opcUa: {
          mode: 'server',
          server: { phase: 'listening', endpointUrl: 'opc.tcp://127.0.0.1:14840' },
        },
      })
    } finally {
      await service.stop()
    }
  })

  it('restarts a prior Server when its replacement stop partially shuts down then fails', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const prior = fakeServerAdapter(
      'opc.tcp://127.0.0.1:14840',
      new Error('partial-shutdown-failed'),
    )
    const candidate = fakeServerAdapter('opc.tcp://127.0.0.1:14841')
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      {
        createOpcUaServerAdapter: (project) => (
          project.revisionId === 'revision-partial-stop-replacement'
            ? candidate.adapter
            : prior.adapter
        ),
      },
    )
    const firstProject = sampleProject('server', 'revision-partial-stop-prior')
    const replacement = sampleProject('server', 'revision-partial-stop-replacement')

    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', firstProject)).status)
        .toBe(200)
      const failedApply = await requestJson(port, 'PUT', '/runtime/project', replacement)

      expect(failedApply.status).toBe(503)
      expect(await failedApply.json()).toMatchObject({
        code: 'PROJECT_ACTIVATION_FAILED',
        recoveredRevisionId: firstProject.revisionId,
      })
      expect(prior.start).toHaveBeenCalledTimes(2)
      expect(candidate.start).not.toHaveBeenCalled()
      expect(gatewayStatus(service.status())).toMatchObject({
        project: { phase: 'ready', revisionId: firstProject.revisionId },
        opcUa: { server: { phase: 'listening' } },
      })
    } finally {
      await service.stop()
    }
  })
})
