// @vitest-environment node

import {
  createServer as createNetServer,
  connect,
  type Server as NetServer,
} from 'node:net'
import { readFile } from 'node:fs/promises'
import WebSocket from 'ws'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  configRevisionForProjectV5,
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../../src/core/project-v5/index.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../src/core/project-v5/test-support.js'
import type { RuntimeGatewayDeploymentConfigV1 } from './deployment-config.js'
import type { OpcUaServerAdapterOptionsV1, OpcUaServerAdapterV1 } from './opcua-server-adapter.js'
import type { ProductCommandTargetV1 } from './opcua-command-staging.js'
import { OPC_UA_ROBOTICS_INSTANCES_NAMESPACE_URI_V1 } from './opcua-robotics-model.js'
import { OPENWEB_MODEL_NAMESPACE_URI_V1 } from './opcua-openweb-model.js'
import type {
  OpcUaClientAdapterOptionsV1,
  OpcUaClientAdapterV1,
} from './opcua-client-adapter.js'
import { createOpcUaClientAdapterPublicationHarnessV1 } from './opcua-client-adapter.js'
import { compileOpcUaClientReadPlanV1 } from './opcua-client-read-plan.js'
import {
  MAX_RUNTIME_BATCH_BYTES_V1,
  type StateBatchV1,
} from '../../src/core/runtime-protocol/v1.js'
import { validateRuntimeGatewayStatusV1 } from '../../src/core/runtime-protocol/gateway-status-v1.js'
import { createStateBatchHubV1 } from './state-batch-hub.js'

let createPublicationHarnessV1 = createOpcUaClientAdapterPublicationHarnessV1

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
): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project as unknown as { projectId: string }).projectId = 'project-main-http'
  ;(project as unknown as { revisionId: string }).revisionId = revisionId
  ;(project.opcUa as unknown as { mode: WorkcellProjectV5['opcUa']['mode'] }).mode = mode
  return validateWorkcellProjectV5(project)
}

function clientPublicationHarness(
  project: WorkcellProjectV5,
  configRevision: string,
  publisherGeneration = 1,
) {
  const endpoint = project.opcUa.endpoints[0]!
  const harness = createPublicationHarnessV1({
    project,
    endpointId: endpoint.endpointId,
    gatewayId: 'test-gateway',
    originId: 'test-gateway:opcua-client',
    configRevision,
    publisherGeneration,
  })
  const roots = compileOpcUaClientReadPlanV1(project)[0]!.monitoredRoots
  const rootKeyForMapping = (mappingId: string): string => {
    const root = roots.find(({ mappingIds }) => mappingIds.includes(mappingId))
    if (root === undefined) throw new Error(`Missing test monitored root for ${mappingId}.`)
    return root.rootKey
  }
  return Object.freeze({
    connected: () => harness.lifecycle('connected'),
    disconnected: () => harness.lifecycle('disconnected'),
    booleanState: (value: boolean, sourceTimestampMs = 1) => harness.state({
      rootKey: rootKeyForMapping('mapping-1'), value, statusCode: 'Good', sourceTimestampMs,
    }),
    state: (
      mappingId: string,
      value: unknown,
      sourceTimestampMs = 1,
      statusCode = 'Good',
    ) => harness.state({ rootKey: rootKeyForMapping(mappingId), value, statusCode, sourceTimestampMs }),
  })
}

interface TestReadMappingSpecV1 {
  readonly mappingId: string
  readonly signalId: string
  readonly dataType: 'Boolean' | 'Double' | 'String'
  readonly projectDataType: 'boolean' | 'number' | 'string'
  readonly initialValue: boolean | number | string
  readonly unit: string
}

function clientProjectWithReadMappings(
  revisionId: string,
  mappings: readonly TestReadMappingSpecV1[],
  mode: 'client' | 'bridge' = 'client',
): WorkcellProjectV5 {
  const source = sampleProject(mode, revisionId)
  const baseMapping = source.opcUa.mappings[0]!
  const baseLeaf = baseMapping.leaves[0]!
  return validateWorkcellProjectV5({
    ...source,
    logicalSignals: mappings.map((mapping) => ({
      id: mapping.signalId,
      name: mapping.signalId,
      dataType: mapping.dataType,
      direction: 'input',
      initialValue: mapping.initialValue,
      unit: mapping.unit,
      scope: { type: 'project' as const },
    })),
    opcUa: {
      ...source.opcUa,
      mappings: mappings.map((mapping) => ({
        ...baseMapping,
        id: mapping.mappingId,
        nodeAddress: {
          ...baseMapping.nodeAddress,
          identifier: `Signals.${mapping.mappingId}`,
        },
        leaves: [{
          ...baseLeaf,
          projectTarget: { type: 'logical-signal' as const, signalId: mapping.signalId },
          opcUaDataType: mapping.dataType,
          projectDataType: mapping.projectDataType,
          unit: mapping.unit,
        }],
      })),
    },
  })
}

function projectWithReservedJointId(): WorkcellProjectV5 {
  const source = sampleProject('server')
  const sourceDefinition = source.robotDefinitions[0]!
  const previousJointId = sourceDefinition.joints[0]!.id
  const definition = {
    ...sourceDefinition,
    joints: sourceDefinition.joints.map((joint, index) => (
      index === 0 ? { ...joint, id: '__proto__' } : joint
    )),
  }
  return validateWorkcellProjectV5({
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
  const publishActualSnapshot = vi.fn(async () => undefined)
  const adapter: OpcUaServerAdapterV1 = {
    start,
    stop,
    publishRobotJointState,
    publishActualSnapshot,
    status: () => ({
      mode: 'server',
      started,
      endpointUrl: started ? endpointUrl : null,
      namespaceUri: OPC_UA_ROBOTICS_INSTANCES_NAMESPACE_URI_V1,
      namespaceIndex: started ? 2 : null,
      nodeIds: {},
      productNamespaceUri: OPENWEB_MODEL_NAMESPACE_URI_V1,
      productNamespaceIndex: started ? 3 : null,
      productRootNodeId: started ? 'ns=3;s=OpenWebDigitalTwin' : null,
      activeSessionCount: 0,
    }),
  }
  return { adapter, start, stop, publishRobotJointState }
}

function fakeClientAdapter(): {
  readonly adapter: OpcUaClientAdapterV1
  readonly start: ReturnType<typeof vi.fn>
  readonly stop: ReturnType<typeof vi.fn>
  readonly disconnectEndpoint: ReturnType<typeof vi.fn>
  readonly reconnectEndpoint: ReturnType<typeof vi.fn>
} {
  let started = false
  const start = vi.fn(async () => { started = true })
  const stop = vi.fn(async () => { started = false })
  const disconnectEndpoint = vi.fn(async () => { started = false })
  const reconnectEndpoint = vi.fn(async () => { started = true })
  return {
    adapter: {
      start,
      stop,
      disconnectEndpoint,
      reconnectEndpoint,
      write: async () => ({ ok: false, statusCode: 'BadNoCommunication', failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED', message: 'Endpoint is not connected.' }),
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
    disconnectEndpoint,
    reconnectEndpoint,
  }
}

function gatewayStatus(value: unknown) {
  return validateRuntimeGatewayStatusV1(value)
}

async function requestJson(
  port: number,
  method: 'PUT' | 'POST',
  path: string,
  body: unknown,
): Promise<Response> {
  let requestBody = body
  if (method === 'PUT' && path === '/runtime/project') {
    try {
      const project = validateWorkcellProjectV5(body)
      requestBody = {
        type: 'runtime-project-activation-v1', protocolVersion: 1, project,
        configRevision: await configRevisionForProjectV5(project),
        activationAttemptId: `attempt-${project.revisionId}`,
        expectedAuthority: await (async () => {
          try {
            const status = gatewayStatus(await (await fetch(`http://127.0.0.1:${port}/runtime/status`)).json())
            return status.project.phase === 'ready' ? {
              projectId: status.project.projectId, revisionId: status.project.revisionId,
              configRevision: status.project.configRevision,
              activationAttemptId: status.project.activationAttemptId,
            } : null
          } catch { return null }
        })(),
      }
    } catch {
      // Intentionally preserve malformed/V4 payloads for the boundary test.
    }
  }
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {

    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
  })
  return response
}

async function requestCommand(port: number, body: unknown): Promise<Response> {
  return requestJson(port, 'POST', '/runtime/command', body)
}

async function requestLease(port: number): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/runtime/command-lease`)
}

function writableClientProject(revisionId = 'revision-command-client'): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(sampleProject('client', revisionId))
  ;(project.logicalSignals[0] as unknown as { direction: 'input' | 'output' | 'bidirectional' }).direction = 'output'
  ;(project.opcUa.mappings[0] as unknown as { direction: 'read' | 'write' | 'readWrite' }).direction = 'write'
  return validateWorkcellProjectV5(project)
}

function commandRequest(configRevision: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'command-request-v1', protocolVersion: 1, commandId: 'command-http-1',
    projectId: 'project-main-http', configRevision, leaseGeneration: 1, expiresAt: 6_000,
    targetId: 'mapping-1', value: true, ...overrides,
  }
}

function connectedClientAdapter(
  write: OpcUaClientAdapterV1['write'] = vi.fn(async () => ({ ok: true as const, statusCode: 'Good' as const })),
): {
  readonly adapter: OpcUaClientAdapterV1
  readonly write: OpcUaClientAdapterV1['write']
  readonly stop: ReturnType<typeof vi.fn>
} {
  const stop = vi.fn(async () => undefined)
  return {
    write,
    stop,
    adapter: {
      start: async () => undefined,
      stop,
      write,
      status: () => [{
        endpointId: 'endpoint-1', endpointUrl: 'opc.tcp://localhost:4840', phase: 'connected' as const,
        sessionActive: true, subscriptionActive: true, monitoredItemCount: 0, mappingCount: 1,
        lastValueQuality: null, lastNotificationAtMs: null, lastGoodValueAtMs: null,
        reconnectAttempt: 0, nextRetryAtMs: null, lastError: null,
      }],
    },
  }
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

async function openIncompleteHttpRequest(
  port: number,
  headers: readonly string[],
  bodyPrefix: string,
): Promise<{ readonly socket: ReturnType<typeof connect>; readonly response: Promise<string> }> {
  const socket = connect({ host: '127.0.0.1', port })
  socket.setEncoding('utf8')
  let responseText = ''
  let resolveResponse!: (value: string) => void
  const response = new Promise<string>((resolve) => { resolveResponse = resolve })
  socket.on('data', (chunk: string) => {
    responseText += chunk
    if (responseText.includes('\r\n\r\n')) resolveResponse(responseText)
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  socket.write([...headers, '', bodyPrefix].join('\r\n'))
  return { socket, response }
}

function jsonBodyAtByteLength(byteLength: number): string {
  const empty = JSON.stringify({ padding: '' })
  const padding = byteLength - Buffer.byteLength(empty)
  if (padding < 0) throw new Error('Requested JSON body length is too small.')
  return JSON.stringify({ padding: 'x'.repeat(padding) })
}

async function rawChunkedJsonRequest(
  port: number,
  path: string,
  body: string,
): Promise<{ readonly status: number; readonly body: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.setEncoding('utf8')
    let response = ''
    socket.once('error', reject)
    socket.on('data', (chunk: string) => { response += chunk })
    socket.once('close', () => {
      const [head = '', responseBody = ''] = response.split('\r\n\r\n', 2)
      const status = Number(head.match(/^HTTP\/1\.1 ([0-9]{3})/u)?.[1])
      resolve({ status, body: responseBody })
    })
    socket.once('connect', () => {
      const midpoint = Math.floor(body.length / 2)
      const chunks = [body.slice(0, midpoint), body.slice(midpoint)]
      socket.write([
        `POST ${path} HTTP/1.1`,
        'Host: 127.0.0.1',
        'Content-Type: application/json',
        'Transfer-Encoding: chunked',
        'Connection: close',
        '',
        '',
      ].join('\r\n'))
      for (const chunk of chunks) {
        socket.write(`${Buffer.byteLength(chunk).toString(16)}\r\n${chunk}\r\n`)
      }
      socket.end('0\r\n\r\n')
    })
  })
}

async function settlesWithin(operation: Promise<unknown>, timeoutMs = 250): Promise<boolean> {
  return Promise.race([
    operation.then(() => true, () => true),
    new Promise<boolean>((resolve) => setTimeout(resolve, timeoutMs, false)),
  ])
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

function fakeTimeouts() {
  let nextId = 0
  const pending = new Map<number, { readonly dueAt: number; readonly callback: () => void }>()
  const setTimeout = vi.fn((callback: () => void, delayMs: number) => {
    nextId += 1
    pending.set(nextId, { dueAt: delayMs, callback })
    return nextId
  })
  const clearTimeout = vi.fn((timer: unknown) => {
    if (typeof timer === 'number') pending.delete(timer)
  })
  return {
    setTimeout,
    clearTimeout,
    runDueAt(nowMs: number) {
      for (const [timer, scheduled] of [...pending]) {
        if (scheduled.dueAt > nowMs) continue
        pending.delete(timer)
        scheduled.callback()
      }
    },
    count: () => pending.size,
  }
}

async function expectNoWebSocketMessage(socket: WebSocket, durationMs = 75): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onMessage = () => settle(new Error('Unexpected stale State Batch replay.'))
    const onError = (error: Error) => settle(error)
    const timer = setTimeout(() => settle(), durationMs)
    const settle = (error?: Error) => {
      clearTimeout(timer)
      socket.off('message', onMessage)
      socket.off('error', onError)
      if (error === undefined) resolve()
      else reject(error)
    }
    socket.once('message', onMessage)
    socket.once('error', onError)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runtime Gateway entrypoint', () => {
  it('cleans product command stages on OPC UA session close and bounded lifecycle sweep', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const timers = fakeTimeouts()
    let now = 1_000
    let options: OpcUaServerAdapterOptionsV1 | null = null
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      nowMs: () => now,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      createOpcUaServerAdapter: (_project, candidate) => {
        options = candidate
        return fakeServerAdapter().adapter
      },
    })
    const project = sampleProject('server')
    const revision = await configRevisionForProjectV5(project)
    const target: ProductCommandTargetV1 = {
      targetId: 'robot-1', projectId: project.projectId, revisionId: project.revisionId, configRevision: revision,
      payload: { kind: 'robot-joint-target', robotId: 'robot-1', jointIds: ['J1'] },
    }
    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      const serverOptions = options as unknown as OpcUaServerAdapterOptionsV1
      expect(serverOptions.onSessionClose).toBeTypeOf('function')
      serverOptions.onProductCommandWrite!({ sessionId: 'opcua:session-a', target, field: 'RequestId', value: 'closed-stage' })
      serverOptions.onSessionClose!('opcua:session-a')
      serverOptions.onProductCommandWrite!({ sessionId: 'opcua:session-a', target, field: 'ExpiresAt', value: 50_000 })
      serverOptions.onProductCommandWrite!({ sessionId: 'opcua:session-a', target, field: 'J1', value: 1 })
      expect(() => serverOptions.onProductCommandWrite!({ sessionId: 'opcua:session-a', target, field: 'Execute', value: true }))
        .toThrow('COMMAND_STAGE_INCOMPLETE')

      serverOptions.onProductCommandWrite!({ sessionId: 'opcua:session-b', target, field: 'RequestId', value: 'swept-stage' })
      now = 61_000
      timers.runDueAt(now)
      serverOptions.onProductCommandWrite!({ sessionId: 'opcua:session-b', target, field: 'ExpiresAt', value: 120_000 })
      serverOptions.onProductCommandWrite!({ sessionId: 'opcua:session-b', target, field: 'J1', value: 1 })
      expect(() => serverOptions.onProductCommandWrite!({ sessionId: 'opcua:session-b', target, field: 'Execute', value: true }))
        .toThrow('COMMAND_STAGE_INCOMPLETE')
    } finally {
      await service.stop()
      expect(timers.count()).toBe(0)
    }
  })

  it('settles an admitted product command on a fake-clock Browser lease expiry without leaking timers', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const fake = fakeServerAdapter()
    const productResults = vi.fn(async () => undefined)
    const timers = fakeTimeouts()
    let now = 1_000
    let onProductCommandWrite: OpcUaServerAdapterOptionsV1['onProductCommandWrite']
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      nowMs: () => now,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      createOpcUaServerAdapter: (_project, options) => {
        onProductCommandWrite = options.onProductCommandWrite
        return { ...fake.adapter, publishProductResult: productResults }
      },
    })
    const project = sampleProject('server')
    const revision = await configRevisionForProjectV5(project)
    const target: ProductCommandTargetV1 = {
      targetId: 'robot-1', projectId: project.projectId, revisionId: project.revisionId, configRevision: revision,
      payload: { kind: 'robot-joint-target', robotId: 'robot-1', jointIds: ['J1'] },
    }
    let socket: WebSocket | null = null
    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      socket = await openWebSocket(port)
      const leaseMessage = nextWebSocketMessage(socket)
      socket.send(JSON.stringify({
        type: 'browser-publisher-lease-acquire-v1', protocolVersion: 1, projectId: project.projectId,
        configRevision: revision, publisherId: 'browser-a',
      }))
      const lease = JSON.parse(await leaseMessage) as { generation: number; expiresAt: number }
      const write = onProductCommandWrite!
      write({ sessionId: 'opcua:session-a', target, field: 'RequestId', value: 'external-expiry' })
      write({ sessionId: 'opcua:session-a', target, field: 'ExpiresAt', value: lease.expiresAt })
      write({ sessionId: 'opcua:session-a', target, field: 'J1', value: 12 })
      const batchMessage = nextWebSocketMessage(socket)
      write({ sessionId: 'opcua:session-a', target, field: 'Execute', value: true })
      expect(JSON.parse(await batchMessage)).toMatchObject({ type: 'command-batch-v1', leaseGeneration: lease.generation })
      const closed = new Promise<void>((resolve) => socket!.once('close', () => resolve()))
      now = lease.expiresAt
      timers.runDueAt(now)
      await closed
      await vi.waitFor(() => expect(productResults).toHaveBeenLastCalledWith(expect.objectContaining({
        commandId: 'external-expiry', acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE',
      })))
      // The bounded staging sweep remains the only live lifecycle timer.
      expect(timers.count()).toBe(1)
      socket = await openWebSocket(port)
      const reacquired = nextWebSocketMessage(socket)
      socket.send(JSON.stringify({
        type: 'browser-publisher-lease-acquire-v1', protocolVersion: 1, projectId: project.projectId,
        configRevision: revision, publisherId: 'browser-a',
      }))
      expect(JSON.parse(await reacquired)).toMatchObject({ generation: lease.generation + 1 })
    } finally {
      socket?.close()
      await service.stop()
      expect(timers.count()).toBe(0)
    }
  })

  it('settles an admitted product command when its Browser publisher releases the lease', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const fake = fakeServerAdapter()
    const productResults = vi.fn(async () => undefined)
    let onProductCommandWrite: OpcUaServerAdapterOptionsV1['onProductCommandWrite']
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createOpcUaServerAdapter: (_project, options) => {
        onProductCommandWrite = options.onProductCommandWrite
        return { ...fake.adapter, publishProductResult: productResults }
      },
    })
    const project = sampleProject('server')
    const revision = await configRevisionForProjectV5(project)
    const target: ProductCommandTargetV1 = {
      targetId: 'robot-1', projectId: project.projectId, revisionId: project.revisionId, configRevision: revision,
      payload: { kind: 'robot-joint-target', robotId: 'robot-1', jointIds: ['J1'] },
    }
    let socket: WebSocket | null = null
    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      expect(onProductCommandWrite).toBeTypeOf('function')
      socket = await openWebSocket(port)
      await new Promise<void>((resolve) => setImmediate(resolve))
      const leaseMessage = nextWebSocketMessage(socket)
      socket.send(JSON.stringify({
        type: 'browser-publisher-lease-acquire-v1', protocolVersion: 1, projectId: project.projectId,
        configRevision: revision, publisherId: 'browser-a',
      }))
      const lease = JSON.parse(await leaseMessage) as { generation: number }
      const expiresAt = Date.now() + 5_000
      const write = onProductCommandWrite!
      write({ sessionId: 'opcua:session-a', target, field: 'RequestId', value: 'external-release' })
      write({ sessionId: 'opcua:session-a', target, field: 'ExpiresAt', value: expiresAt })
      write({ sessionId: 'opcua:session-a', target, field: 'J1', value: 12 })
      const batchMessage = nextWebSocketMessage(socket)
      write({ sessionId: 'opcua:session-a', target, field: 'Execute', value: true })
      expect(JSON.parse(await batchMessage)).toMatchObject({ type: 'command-batch-v1', leaseGeneration: lease.generation })
      socket.send(JSON.stringify({
        type: 'browser-publisher-lease-release-v1', protocolVersion: 1, projectId: project.projectId,
        configRevision: revision, publisherId: 'browser-a', generation: lease.generation,
      }))
      await vi.waitFor(() => expect(productResults).toHaveBeenLastCalledWith(expect.objectContaining({
        commandId: 'external-release', acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE',
      })))
    } finally {
      socket?.close()
      await service.stop()
    }
  })

  it.each([
    ['rejected', (base: Record<string, unknown>) => ({ ...base, acknowledgement: 'REJECTED', executionState: 'FAILED', failureCode: 'BROWSER_COMMAND_FAILED' }), 'BROWSER_RESULT_INVALID'],
    ['idle', (base: Record<string, unknown>) => ({ ...base, executionState: 'IDLE' }), 'BROWSER_RESULT_INVALID'],
    ['running', (base: Record<string, unknown>) => ({ ...base, executionState: 'RUNNING', completedAt: null }), 'BROWSER_RESULT_INVALID'],
    ['wrong-target', (base: Record<string, unknown>) => ({ ...base, targetId: 'wrong-target' }), 'BROWSER_RESULT_INVALID'],
    ['success', (base: Record<string, unknown>) => ({ ...base, executionState: 'SUCCEEDED', failureCode: null }), null],
  ])('normalizes the Browser %s terminal result to the admitted command identity', async (_label, response, expectedFailureCode) => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const fake = fakeServerAdapter()
    const productResults = vi.fn(async () => undefined)
    let onProductCommandWrite: OpcUaServerAdapterOptionsV1['onProductCommandWrite']
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createOpcUaServerAdapter: (_project, options) => {
        onProductCommandWrite = options.onProductCommandWrite
        return { ...fake.adapter, publishProductResult: productResults }
      },
    })
    const project = sampleProject('server')
    const revision = await configRevisionForProjectV5(project)
    const target: ProductCommandTargetV1 = {
      targetId: 'robot-1', projectId: project.projectId, revisionId: project.revisionId, configRevision: revision,
      payload: { kind: 'robot-joint-target', robotId: 'robot-1', jointIds: ['J1'] },
    }
    let socket: WebSocket | null = null
    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      socket = await openWebSocket(port)
      const leaseMessage = nextWebSocketMessage(socket)
      socket.send(JSON.stringify({ type: 'browser-publisher-lease-acquire-v1', protocolVersion: 1, projectId: project.projectId, configRevision: revision, publisherId: 'browser-a' }))
      const lease = JSON.parse(await leaseMessage) as { generation: number }
      const commandId = `terminal-${_label}`
      const expiresAt = Date.now() + 5_000
      const batchMessage = nextWebSocketMessage(socket)
      const write = onProductCommandWrite!
      write({ sessionId: `opcua:${commandId}`, target, field: 'RequestId', value: commandId })
      write({ sessionId: `opcua:${commandId}`, target, field: 'ExpiresAt', value: expiresAt })
      write({ sessionId: `opcua:${commandId}`, target, field: 'J1', value: 12 })
      write({ sessionId: `opcua:${commandId}`, target, field: 'Execute', value: true })
      expect(JSON.parse(await batchMessage)).toMatchObject({ type: 'command-batch-v1', commands: [{ commandId }] })
      socket.send(JSON.stringify(response({
        type: 'command-result-v1', protocolVersion: 1, projectId: project.projectId, configRevision: revision,
        leaseGeneration: lease.generation, targetId: target.targetId, commandId, acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'BROWSER_COMMAND_FAILED', message: 'Browser terminal.', attachedObjectId: null, completedAt: Date.now(),
      })))
      await vi.waitFor(() => expect(productResults).toHaveBeenLastCalledWith(expect.objectContaining({
        commandId, targetId: target.targetId, acknowledgement: 'ACCEPTED', executionState: expectedFailureCode === null ? 'SUCCEEDED' : 'FAILED', failureCode: expectedFailureCode,
      })))
    } finally {
      socket?.close()
      await service.stop()
    }
  })

  it('settles admitted product commands on Browser socket close, lease replacement, and revision replacement', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const fake = fakeServerAdapter()
    const productResults = vi.fn(async () => undefined)
    let onProductCommandWrite: OpcUaServerAdapterOptionsV1['onProductCommandWrite']
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createOpcUaServerAdapter: (_project, options) => {
        onProductCommandWrite = options.onProductCommandWrite
        return { ...fake.adapter, publishProductResult: productResults }
      },
    })
    const project = sampleProject('server')
    const revision = await configRevisionForProjectV5(project)
    const target: ProductCommandTargetV1 = {
      targetId: 'robot-1', projectId: project.projectId, revisionId: project.revisionId, configRevision: revision,
      payload: { kind: 'robot-joint-target', robotId: 'robot-1', jointIds: ['J1'] },
    }
    const acquire = async (socket: WebSocket, publisherId: string): Promise<{ readonly generation: number }> => {
      const message = nextWebSocketMessage(socket)
      socket.send(JSON.stringify({
        type: 'browser-publisher-lease-acquire-v1', protocolVersion: 1, projectId: project.projectId,
        configRevision: revision, publisherId,
      }))
      return JSON.parse(await message) as { generation: number }
    }
    const stage = async (socket: WebSocket, commandId: string, generation: number): Promise<void> => {
      const message = nextWebSocketMessage(socket)
      const write = onProductCommandWrite!
      write({ sessionId: `opcua:${commandId}`, target, field: 'RequestId', value: commandId })
      write({ sessionId: `opcua:${commandId}`, target, field: 'ExpiresAt', value: Date.now() + 5_000 })
      write({ sessionId: `opcua:${commandId}`, target, field: 'J1', value: 12 })
      write({ sessionId: `opcua:${commandId}`, target, field: 'Execute', value: true })
      expect(JSON.parse(await message)).toMatchObject({ type: 'command-batch-v1', leaseGeneration: generation })
    }
    let socketA: WebSocket | null = null
    let socketB: WebSocket | null = null
    let socketC: WebSocket | null = null
    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      socketA = await openWebSocket(port)
      const leaseA = await acquire(socketA, 'browser-a')
      await stage(socketA, 'socket-close', leaseA.generation)
      const closed = new Promise<void>((resolve) => socketA!.once('close', () => resolve()))
      socketA.close()
      await closed
      await vi.waitFor(() => expect(productResults).toHaveBeenLastCalledWith(expect.objectContaining({
        commandId: 'socket-close', acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE',
      })))

      socketB = await openWebSocket(port)
      const leaseB = await acquire(socketB, 'browser-b')
      await stage(socketB, 'lease-replacement', leaseB.generation)
      socketC = await openWebSocket(port)
      await acquire(socketC, 'browser-c')
      await vi.waitFor(() => expect(productResults).toHaveBeenLastCalledWith(expect.objectContaining({
        commandId: 'lease-replacement', acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE',
      })))

      const leaseC = await acquire(socketC, 'browser-c')
      await stage(socketC, 'revision-replacement', leaseC.generation)
      const next = sampleProject('server', 'revision-main-server-next')
      expect((await requestJson(port, 'PUT', '/runtime/project', next)).status).toBe(200)
      await vi.waitFor(() => expect(productResults).toHaveBeenLastCalledWith(expect.objectContaining({
        commandId: 'revision-replacement', acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE',
      })))
    } finally {
      socketA?.close()
      socketB?.close()
      socketC?.close()
      await service.stop()
    }
  })

  it('serves a closed non-mutating integration diagnostics snapshot', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port))
    await service.start()
    try {
      const response = await fetch(`http://127.0.0.1:${port}/runtime/integration-diagnostics`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(expect.objectContaining({
        type: 'runtime-integration-diagnostics-v1', projectId: null,
        serverModel: expect.objectContaining({ standardNodeSets: 'disabled', activeSessionCount: 0, maximumSessionCount: 16 }),
      }))
    } finally {
      await service.stop()
    }
  })
  it('preserves the Client stop error when Hub reset fails and retries a fresh Hub on usable restart', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const client = fakeClientAdapter()
    const clientFailure = new Error('client-stop-before-hub-reset')
    const resetFailure = new Error('hub-reset-failure')
    client.stop.mockRejectedValueOnce(clientFailure)
    let clientOptions: OpcUaClientAdapterOptionsV1 | null = null
    let hubFactoryCall = 0
    const createStateBatchHub = vi.fn(() => {
      hubFactoryCall += 1
      if (hubFactoryCall === 2) throw resetFailure
      return createStateBatchHubV1()
    })
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createStateBatchHub,
      createOpcUaClientAdapter: (_project, options) => {
        clientOptions = options
        return client.adapter
      },
    })
    await service.start()
    let restartedSocket: WebSocket | null = null
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', sampleProject('client', 'revision-hub-reset-prior'))).status)
        .toBe(200)
      let caught: unknown
      try {
        await service.stop()
      } catch (error) {
        caught = error
      }
      expect(caught).toBe(clientFailure)
      expect(createStateBatchHub).toHaveBeenCalledTimes(2)

      await expect(service.stop()).resolves.toBeUndefined()
      expect(gatewayStatus(service.status()).project).toMatchObject({ phase: 'not-applied' })
      await service.start()
      expect(createStateBatchHub).toHaveBeenCalledTimes(3)
      const project = sampleProject('client', 'revision-hub-reset-restarted')
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      restartedSocket = await openWebSocket(port)
      const publications = clientPublicationHarness(
        project,
        clientOptions!.configRevision,
        clientOptions!.publisherGeneration,
      )
      const connected = nextWebSocketMessage(restartedSocket)
      clientOptions!.publish(publications.connected())
      expect(JSON.parse(await connected)).toMatchObject({ type: 'endpoint-lifecycle-v1', phase: 'connected' })
      const nextMessage = nextWebSocketMessage(restartedSocket)
      for (const publication of publications.booleanState(true)) clientOptions!.publish(publication)
      await expect(nextMessage).resolves.toContain('"mappingId":"mapping-1"')
      expect(restartedSocket.readyState).toBe(WebSocket.OPEN)
    } finally {
      restartedSocket?.close()
      await service.stop().catch(() => undefined)
    }
  })

  it('rethrows a reset-only Hub factory failure by exact identity', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const resetFailure = new Error('reset-only-hub-failure')
    let hubFactoryCall = 0
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createStateBatchHub: () => {
        hubFactoryCall += 1
        if (hubFactoryCall === 2) throw resetFailure
        return createStateBatchHubV1()
      },
    })
    await service.start()
    let caught: unknown
    try {
      await service.stop()
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(resetFailure)
  })

  it('runs every shutdown cleanup and rethrows the exact first Client stop failure', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const client = fakeClientAdapter()
    const server = fakeServerAdapter()
    const stopFailure = new Error('client-stop-failure')
    client.stop.mockRejectedValueOnce(stopFailure)
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createOpcUaClientAdapter: () => client.adapter,
      createOpcUaServerAdapter: () => server.adapter,
    })
    await service.start()
    const socket = await openWebSocket(port)
    const socketClosed = new Promise<void>((resolve) => socket.once('close', resolve))
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', sampleProject('bridge'))).status).toBe(200)
      let caught: unknown
      try {
        await service.stop()
      } catch (error) {
        caught = error
      }
      expect(caught).toBe(stopFailure)
      expect(server.stop).toHaveBeenCalledOnce()
      await socketClosed
      await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow()
      await service.start()
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200)
    } finally {
      socket.close()
      await service.stop().catch(() => undefined)
    }
  })

  it('destroys an incomplete command body so stop is not held by the Node request timeout', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port))
    await service.start()
    const sender = await openIncompleteHttpRequest(port, [
      'POST /runtime/command HTTP/1.1',
      'Host: 127.0.0.1',
      'Content-Type: application/json',
      'Content-Length: 100',
      'Connection: keep-alive',
    ], '{"type":"command-request-v1",')
    const stopping = service.stop()
    try {
      expect(await settlesWithin(stopping)).toBe(true)
    } finally {
      sender.socket.destroy()
      await stopping.catch(() => undefined)
    }
  })

  it.each([
    ['unsupported media', ['Content-Type: text/plain', 'Content-Length: 100'], '415'],
    ['declared oversized', ['Content-Type: application/json', `Content-Length: ${MAX_RUNTIME_BATCH_BYTES_V1 + 1}`], '413'],
  ])('destroys an unfinished early-%s sender during bounded stop', async (_name, requestHeaders, status) => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port))
    await service.start()
    const sender = await openIncompleteHttpRequest(port, [
      'POST /runtime/command HTTP/1.1',
      'Host: 127.0.0.1',
      ...requestHeaders,
      'Connection: keep-alive',
    ], '{')
    expect(await sender.response).toContain(`HTTP/1.1 ${status}`)
    const stopping = service.stop()
    try {
      expect(await settlesWithin(stopping)).toBe(true)
    } finally {
      sender.socket.destroy()
      await stopping.catch(() => undefined)
    }
  })

  it('publishes a Client write lease and transports an exact terminal command envelope', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const client = connectedClientAdapter()
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createOpcUaClientAdapter: () => client.adapter,
      nowMs: () => 1_000,
    })
    const project = writableClientProject()
    const revision = await configRevisionForProjectV5(project)
    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      await expect((await requestLease(port)).json()).resolves.toEqual({
        projectId: project.projectId, configRevision: revision,
        publisherId: 'test-gateway:client-write', generation: 1, expiresAt: 6_000,
      })
      const response = await requestCommand(port, commandRequest(revision))
      expect(response.status).toBe(200)
      const body = await response.json() as Record<string, unknown>
      expect(Object.keys(body)).toHaveLength(13)
      expect(body).toMatchObject({ acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED', failureCode: null })
      expect(body).not.toHaveProperty('statusCode')
      expect(client.write).toHaveBeenCalledOnce()
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      await expect((await requestLease(port)).json()).resolves.toMatchObject({ generation: 2 })
    } finally {
      await service.stop()
    }
  })

  it('rejects every active-Client command transport/protocol failure before adapter execution', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const client = connectedClientAdapter()
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createOpcUaClientAdapter: () => client.adapter,
      nowMs: () => 1_000,
    })
    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', writableClientProject())).status).toBe(200)
      const malformed = await fetch(`http://127.0.0.1:${port}/runtime/command`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
      })
      expect({ status: malformed.status, body: await malformed.json() }).toEqual({
        status: 400,
        body: { code: 'JSON_BODY_INVALID', message: 'Request body must contain valid JSON.' },
      })
      const invalid = await requestCommand(port, { type: 'wrong' })
      expect(invalid.status).toBe(400)
      expect(await invalid.json()).toEqual({
        code: 'COMMAND_REQUEST_INVALID',
        message: 'Command Request validation failed: RUNTIME_PROTOCOL_INVALID at $.protocolVersion: Required field is missing.',
      })
      const unsupported = await fetch(`http://127.0.0.1:${port}/runtime/command`, {
        method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
      })
      expect({ status: unsupported.status, body: await unsupported.json() }).toEqual({
        status: 415,
        body: { code: 'CONTENT_TYPE_UNSUPPORTED', message: 'Content-Type must be application/json.' },
      })

      const exactBody = jsonBodyAtByteLength(MAX_RUNTIME_BATCH_BYTES_V1)
      const exactDeclared = await fetch(`http://127.0.0.1:${port}/runtime/command`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: exactBody,
      })
      expect(exactDeclared.status).toBe(400)
      expect(await exactDeclared.json()).toMatchObject({ code: 'COMMAND_REQUEST_INVALID' })
      const oversizedBody = jsonBodyAtByteLength(MAX_RUNTIME_BATCH_BYTES_V1 + 1)
      const oversizedDeclared = await fetch(`http://127.0.0.1:${port}/runtime/command`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: oversizedBody,
      })
      expect({ status: oversizedDeclared.status, body: await oversizedDeclared.json() }).toEqual({
        status: 413,
        body: {
          code: 'REQUEST_BODY_TOO_LARGE',
          message: `Request body must not exceed ${MAX_RUNTIME_BATCH_BYTES_V1} bytes.`,
        },
      })
      const exactChunked = await rawChunkedJsonRequest(port, '/runtime/command', exactBody)
      expect(exactChunked.status).toBe(400)
      expect(JSON.parse(exactChunked.body)).toMatchObject({ code: 'COMMAND_REQUEST_INVALID' })
      const oversizedChunked = await rawChunkedJsonRequest(port, '/runtime/command', oversizedBody)
      expect({ status: oversizedChunked.status, body: JSON.parse(oversizedChunked.body) }).toEqual({
        status: 413,
        body: {
          code: 'REQUEST_BODY_TOO_LARGE',
          message: `Request body must not exceed ${MAX_RUNTIME_BATCH_BYTES_V1} bytes.`,
        },
      })
      for (const [method, path] of [['GET', '/runtime/command'], ['POST', '/runtime/command-lease'], ['POST', '/runtime/missing']] as const) {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, { method })
        expect({ status: response.status, body: await response.text() }).toEqual({ status: 404, body: '' })
      }
      expect(client.write).not.toHaveBeenCalled()
    } finally {
      await service.stop()
    }
  })

  it('exposes an offline Client lease and leaves its connectivity rejection unretained for retry', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    let phase: 'reconnecting' | 'connected' = 'reconnecting'
    const client = connectedClientAdapter()
    client.adapter.status = () => [{
      endpointId: 'endpoint-1', endpointUrl: 'opc.tcp://localhost:4840', phase,
      sessionActive: phase === 'connected', subscriptionActive: phase === 'connected',
      monitoredItemCount: 0, mappingCount: 1, lastValueQuality: null,
      lastNotificationAtMs: null, lastGoodValueAtMs: null, reconnectAttempt: 0,
      nextRetryAtMs: phase === 'connected' ? null : 2_000, lastError: null,
    }]
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createOpcUaClientAdapter: () => client.adapter,
      nowMs: () => 1_000,
    })
    const project = writableClientProject('revision-offline-command-client')
    const revision = await configRevisionForProjectV5(project)
    const command = commandRequest(revision)
    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      expect((await requestLease(port)).status).toBe(200)
      const offline = await requestCommand(port, command)
      expect(offline.status).toBe(200)
      expect(await offline.json()).toEqual({
        type: 'command-result-v1', protocolVersion: 1, projectId: command.projectId,
        configRevision: command.configRevision, leaseGeneration: command.leaseGeneration,
        targetId: command.targetId, commandId: command.commandId,
        acknowledgement: 'REJECTED', executionState: 'FAILED',
        failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED',
        message: 'Target OPC UA Endpoint is not connected.', attachedObjectId: null, completedAt: 1_000,
      })
      phase = 'connected'
      const retried = await requestCommand(port, command)
      expect(retried.status).toBe(200)
      expect(await retried.json()).toEqual({
        type: 'command-result-v1', protocolVersion: 1, projectId: command.projectId,
        configRevision: command.configRevision, leaseGeneration: command.leaseGeneration,
        targetId: command.targetId, commandId: command.commandId,
        acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED', failureCode: null,
        message: 'OPC UA write succeeded.', attachedObjectId: null, completedAt: 1_000,
      })
      expect(client.write).toHaveBeenCalledOnce()
    } finally {
      await service.stop()
    }
  })

  it('returns semantic and adapter failures as HTTP 200 exact terminal envelopes', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const client = connectedClientAdapter(vi.fn(async () => ({
      ok: false as const,
      statusCode: 'BadUserAccessDenied',
      failureCode: 'OPC_UA_WRITE_REJECTED' as const,
      message: 'Adapter rejected the write.',
    })))
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createOpcUaClientAdapter: () => client.adapter,
      nowMs: () => 1_000,
    })
    const project = writableClientProject('revision-command-http-failures')
    const revision = await configRevisionForProjectV5(project)
    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      const semanticRequest = commandRequest(revision, { commandId: 'semantic-failure', projectId: 'other-project' })
      const semantic = await requestCommand(port, semanticRequest)
      expect(semantic.status).toBe(200)
      expect(await semantic.json()).toEqual({
        type: 'command-result-v1', protocolVersion: 1, projectId: 'other-project', configRevision: revision,
        leaseGeneration: 1, targetId: 'mapping-1', commandId: 'semantic-failure',
        acknowledgement: 'REJECTED', executionState: 'FAILED', failureCode: 'PROJECT_MISMATCH',
        message: 'Command Project does not match the active Project.', attachedObjectId: null, completedAt: 1_000,
      })
      const adapterRequest = commandRequest(revision, { commandId: 'adapter-failure' })
      const adapter = await requestCommand(port, adapterRequest)
      expect(adapter.status).toBe(200)
      expect(await adapter.json()).toEqual({
        type: 'command-result-v1', protocolVersion: 1, projectId: project.projectId, configRevision: revision,
        leaseGeneration: 1, targetId: 'mapping-1', commandId: 'adapter-failure',
        acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'OPC_UA_WRITE_REJECTED',
        message: 'Adapter rejected the write.', attachedObjectId: null, completedAt: 1_000,
      })
      expect(client.write).toHaveBeenCalledOnce()
    } finally {
      await service.stop()
    }
  })

  it('retains generation and completed dedupe through recovery, then advances once with a fresh registry', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const prior = connectedClientAdapter()
    const failing = fakeClientAdapter()
    failing.start.mockRejectedValueOnce(new Error('candidate-command-activation-failure'))
    const next = connectedClientAdapter()
    const priorProject = writableClientProject('revision-command-prior')
    const failingProject = writableClientProject('revision-command-failing')
    const nextProject = writableClientProject('revision-command-next')
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createOpcUaClientAdapter: (project) => {
        if (project.revisionId === failingProject.revisionId) return failing.adapter
        if (project.revisionId === nextProject.revisionId) return next.adapter
        return prior.adapter
      },
      nowMs: () => 1_000,
    })
    const priorRevision = await configRevisionForProjectV5(priorProject)
    const priorCommand = commandRequest(priorRevision, { commandId: 'retained-command' })
    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', priorProject)).status).toBe(200)
      const beforeLease = await (await requestLease(port)).json() as { generation: number }
      const retainedResult = await (await requestCommand(port, priorCommand)).json()
      expect(prior.write).toHaveBeenCalledOnce()

      const failed = await requestJson(port, 'PUT', '/runtime/project', failingProject)
      expect(failed.status).toBe(503)
      expect((await (await requestLease(port)).json() as { generation: number }).generation)
        .toBe(beforeLease.generation)
      expect(await (await requestCommand(port, priorCommand)).json()).toEqual(retainedResult)
      expect(prior.write).toHaveBeenCalledOnce()

      expect((await requestJson(port, 'PUT', '/runtime/project', nextProject)).status).toBe(200)
      expect((await (await requestLease(port)).json() as { generation: number }).generation)
        .toBe(beforeLease.generation + 1)
      const staleRetry = await requestCommand(port, priorCommand)
      expect(staleRetry.status).toBe(200)
      expect(await staleRetry.json()).toEqual({
        type: 'command-result-v1', protocolVersion: 1, projectId: priorCommand.projectId,
        configRevision: priorCommand.configRevision, leaseGeneration: priorCommand.leaseGeneration,
        targetId: priorCommand.targetId, commandId: priorCommand.commandId,
        acknowledgement: 'REJECTED', executionState: 'FAILED', failureCode: 'REVISION_MISMATCH',
        message: 'Command Revision does not match the active Revision.', attachedObjectId: null, completedAt: 1_000,
      })
      expect(next.write).not.toHaveBeenCalled()
    } finally {
      await service.stop()
    }
  })

  it('returns exact Client-not-active and invalid-request HTTP errors without executing an adapter', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const client = connectedClientAdapter()
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createOpcUaClientAdapter: () => client.adapter,
    })
    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', sampleProject('off'))).status).toBe(200)
      const lease = await requestLease(port)
      expect(lease.status).toBe(409)
      expect(await lease.json()).toMatchObject({ code: 'OPC_UA_CLIENT_NOT_ACTIVE' })
      const revision = await configRevisionForProjectV5(sampleProject('off'))
      const noClient = await requestCommand(port, commandRequest(revision))
      expect(noClient.status).toBe(200)
      expect(await noClient.json()).toMatchObject({
        acknowledgement: 'REJECTED', executionState: 'FAILED', failureCode: 'OPC_UA_CLIENT_NOT_ACTIVE',
      })
      const invalid = await requestCommand(port, { type: 'wrong' })
      expect(invalid.status).toBe(400)
      expect(await invalid.json()).toMatchObject({ code: 'COMMAND_REQUEST_INVALID' })
      const unsupported = await fetch(`http://127.0.0.1:${port}/runtime/command`, {
        method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
      })
      expect(unsupported.status).toBe(415)
      expect(await unsupported.json()).toMatchObject({ code: 'CONTENT_TYPE_UNSUPPORTED' })
      expect(client.write).not.toHaveBeenCalled()
    } finally {
      await service.stop()
    }
  })

  it('advances the command generation for a same-Revision activation and refuses overflow before stopping the active Client', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const client = connectedClientAdapter()
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createOpcUaClientAdapter: () => client.adapter,
      initialCommittedCommandGeneration: Number.MAX_SAFE_INTEGER - 1,
    })
    const project = writableClientProject()
    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      expect((await (await requestLease(port)).json() as { generation: number }).generation)
        .toBe(Number.MAX_SAFE_INTEGER)
      const replacement = await requestJson(port, 'PUT', '/runtime/project', project)
      expect(replacement.status).toBe(503)
      expect(client.stop).toHaveBeenCalledTimes(0)
      expect((await (await requestLease(port)).json() as { generation: number }).generation)
        .toBe(Number.MAX_SAFE_INTEGER)
    } finally {
      await service.stop()
    }
  })

  it('preserves a completed-body admitted command response while stop closes its never-ending write', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const write = vi.fn(() => new Promise<never>(() => undefined))
    const client = connectedClientAdapter(write)
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createOpcUaClientAdapter: () => client.adapter,
      nowMs: () => 1_000,
    })
    const project = writableClientProject()
    const revision = await configRevisionForProjectV5(project)
    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      const pending = requestCommand(port, commandRequest(revision))
      await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
      await service.stop()
      const response = await pending
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        type: 'command-result-v1', protocolVersion: 1, projectId: project.projectId,
        configRevision: revision, leaseGeneration: 1, targetId: 'mapping-1', commandId: 'command-http-1',
        acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_SERVICE_CLOSED',
        message: 'Command service closed before write completion.', attachedObjectId: null, completedAt: 1_000,
      })
    } finally {
      await service.stop()
    }
  })

  it('admits a command before a replacement transition without waiting for its write completion', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const write = vi.fn(() => new Promise<never>(() => undefined))
    const client = connectedClientAdapter(write)
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createOpcUaClientAdapter: () => client.adapter,
      nowMs: () => 1_000,
    })
    const project = writableClientProject()
    const revision = await configRevisionForProjectV5(project)
    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      const pending = requestCommand(port, commandRequest(revision))
      await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
      await expect(requestJson(port, 'PUT', '/runtime/project', sampleProject('off'))).resolves.toMatchObject({ status: 200 })
      await expect((await pending).json()).resolves.toMatchObject({
        acknowledgement: 'ACCEPTED', failureCode: 'COMMAND_SERVICE_CLOSED',
      })
    } finally {
      await service.stop()
    }
  })

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
    const currentAdapterModule = await import('./opcua-client-adapter.js')
    createPublicationHarnessV1 = currentAdapterModule.createOpcUaClientAdapterPublicationHarnessV1

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
      _project: WorkcellProjectV5,
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
      expect(suppliedConfigRevision).toBe(await configRevisionForProjectV5(project))
      expect(fake.start).toHaveBeenCalledTimes(1)
    } finally {
      await service.stop()
    }
    expect(fake.stop).toHaveBeenCalledTimes(1)
  })

  it('disconnects and reconnects a Client Endpoint without replacing the active Project', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const fake = fakeClientAdapter()
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      { createOpcUaClientAdapter: () => fake.adapter },
    )
    const project = sampleProject('client', 'revision-client-endpoint-control')

    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      const disconnect = await requestJson(port, 'POST', '/runtime/client-endpoints/endpoint-sample-server/disconnect', {})
      expect(disconnect.status).toBe(200)
      expect(fake.disconnectEndpoint).toHaveBeenCalledWith('endpoint-sample-server')
      expect(gatewayStatus(await disconnect.json())).toMatchObject({
        project: { projectId: project.projectId, revisionId: project.revisionId },
        opcUa: { mode: 'client', clientEndpoints: [{ endpointId: 'endpoint-sample-server', phase: 'disabled' }] },
      })

      const reconnect = await requestJson(port, 'POST', '/runtime/client-endpoints/endpoint-sample-server/reconnect', {})
      expect(reconnect.status).toBe(200)
      expect(fake.reconnectEndpoint).toHaveBeenCalledWith('endpoint-sample-server')
      expect(gatewayStatus(await reconnect.json())).toMatchObject({
        project: { projectId: project.projectId, revisionId: project.revisionId },
        opcUa: { mode: 'client', clientEndpoints: [{ endpointId: 'endpoint-sample-server', phase: 'reconnecting' }] },
      })
    } finally {
      await service.stop()
    }
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
    let publish: OpcUaClientAdapterOptionsV1['publish'] | null = null
    let clientOptions: OpcUaClientAdapterOptionsV1 | null = null
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      {
        createOpcUaClientAdapter: (_project, options) => {
          publish = options.publish
          clientOptions = options
          return client.adapter
        },
      },
    )
    const project = sampleProject('client', 'a'.repeat(64))
    const configRevision = await configRevisionForProjectV5(project)

    await service.start()
    let socket: WebSocket | null = null
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      socket = new WebSocket(`ws://127.0.0.1:${port}/runtime/ws`)
      const received: StateBatchV1[] = []
      socket.on('message', (data) => received.push(JSON.parse(data.toString()) as StateBatchV1))
      await new Promise<void>((resolve, reject) => {
        socket!.once('open', resolve)
        socket!.once('error', reject)
      })
      const adapterPublications = clientPublicationHarness(
        project,
        configRevision,
        clientOptions!.publisherGeneration,
      )
      publish!(adapterPublications.connected())
      for (const publication of adapterPublications.booleanState(true)) publish!(publication)
      await expect.poll(() => received.map(({ type }) => type)).toEqual([
        'endpoint-lifecycle-v1',
        'endpoint-catchup-boundary-v1',
        'state-batch-v1',
        'endpoint-catchup-boundary-v1',
      ])
      expect(received[2]).toMatchObject({
        projectId: project.projectId, configRevision, values: [{ mappingId: 'mapping-1', value: true }],
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
    const createOpcUaClientAdapter = vi.fn((_project: WorkcellProjectV5, options) => {
      const value = ++adapterIndex
      const publications = clientPublicationHarness(_project, options.configRevision, options.publisherGeneration)
      const adapter: OpcUaClientAdapterV1 = {
        start: async () => {
          options.publish(publications.connected())
          for (const publication of publications.booleanState(value % 2 === 0, value)) options.publish(publication)
        },
        stop: async () => undefined,
        write: async () => ({ ok: false, statusCode: 'BadNoCommunication', failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED', message: 'Endpoint is not connected.' }),
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
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      socket = new WebSocket(`ws://127.0.0.1:${port}/runtime/ws`)
      const received: StateBatchV1[] = []
      socket.on('message', (data) => received.push(JSON.parse(data.toString()) as StateBatchV1))
      await new Promise<void>((resolve, reject) => {
        socket!.once('open', resolve)
        socket!.once('error', reject)
      })
      await expect.poll(() => received.map(({ type }) => type)).toEqual([
        'endpoint-replay-boundary-v1',
        'endpoint-lifecycle-v1',
        'state-batch-v1',
        'endpoint-replay-boundary-v1',
      ])
      expect(received[2]).toMatchObject({ values: [{ mappingId: 'mapping-1', value: false }] })

      replaySocket = new WebSocket(`ws://127.0.0.1:${port}/runtime/ws`)
      const replayed: StateBatchV1[] = []
      replaySocket.on('message', (data) => replayed.push(JSON.parse(data.toString()) as StateBatchV1))
      await new Promise<void>((resolve, reject) => {
        replaySocket!.once('open', resolve)
        replaySocket!.once('error', reject)
      })
      await expect.poll(() => replayed.map(({ type }) => type)).toEqual([
        'endpoint-replay-boundary-v1',
        'endpoint-lifecycle-v1',
        'state-batch-v1',
        'endpoint-replay-boundary-v1',
      ])
      expect(replayed[2]).toMatchObject({ values: [{ mappingId: 'mapping-1', value: false }] })

      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      await expect.poll(() => received.filter(({ type }) => type === 'state-batch-v1')
        .map(({ values }) => values[0]?.value)).toEqual([false, true])
      expect(createOpcUaClientAdapter).toHaveBeenCalledTimes(2)
    } finally {
      replaySocket?.close()
      socket?.close()
      await service.stop()
    }
  })

  it('includes a synchronous pre-seal injected candidate publication in the sealed activation cut', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    let inject: (() => void) | null = null
    const beforeCandidateTimelineSealForTest = vi.fn(() => { inject?.() })
    const createOpcUaClientAdapter = vi.fn((project: WorkcellProjectV5, options: OpcUaClientAdapterOptionsV1) => {
      const publications = clientPublicationHarness(project, options.configRevision, options.publisherGeneration)
      inject = () => {
        for (const publication of publications.booleanState(true, 2)) options.publish(publication)
      }
      return {
        start: async () => { options.publish(publications.connected()) },
        stop: async () => undefined,
        write: async () => ({ ok: false as const, statusCode: 'BadNoCommunication', failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED', message: 'Endpoint is not connected.' }),
        status: () => [],
      }
    })
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createOpcUaClientAdapter,
      beforeCandidateTimelineSealForTest,
    } as never)
    const project = sampleProject('client', 'revision-pre-seal-injection')
    await service.start()
    let socket: WebSocket | null = null
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      expect(beforeCandidateTimelineSealForTest).toHaveBeenCalledOnce()
      socket = new WebSocket(`ws://127.0.0.1:${port}/runtime/ws`)
      const received: Array<Record<string, unknown>> = []
      socket.on('message', (data) => received.push(JSON.parse(data.toString()) as Record<string, unknown>))
      await new Promise<void>((resolve, reject) => {
        socket!.once('open', resolve)
        socket!.once('error', reject)
      })
      await expect.poll(() => received.map(({ type }) => type)).toEqual([
        'endpoint-replay-boundary-v1',
        'endpoint-lifecycle-v1',
        'state-batch-v1',
        'endpoint-replay-boundary-v1',
      ])
      expect((received[2] as unknown as StateBatchV1).values[0]).toMatchObject({ value: true })
    } finally {
      socket?.close()
      await service.stop()
    }
  })

  it('keeps every channel from one synchronous Client source batch through activation', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const createOpcUaClientAdapter = vi.fn((_project: WorkcellProjectV5, options) => {
      const publications = clientPublicationHarness(_project, options.configRevision, options.publisherGeneration)
      const adapter: OpcUaClientAdapterV1 = {
        start: async () => {
          options.publish(publications.connected())
          for (const publication of publications.state('mapping-object-box-x', 1.5, 1)) options.publish(publication)
          for (const publication of publications.state('mapping-object-box-status', 92, 2)) options.publish(publication)
        },
        stop: async () => undefined,
        write: async () => ({ ok: false, statusCode: 'BadNoCommunication', failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED', message: 'Endpoint is not connected.' }),
        status: () => [],
      }
      return adapter
    })
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      { createOpcUaClientAdapter },
    )
    const project = clientProjectWithReadMappings('revision-synchronous-multi-channel', [
      { mappingId: 'mapping-object-box-x', signalId: 'box-x', dataType: 'Double', projectDataType: 'number', initialValue: 0, unit: 'meter' },
      { mappingId: 'mapping-object-box-status', signalId: 'box-status', dataType: 'Double', projectDataType: 'number', initialValue: 0, unit: 'status-code' },
    ])

    await service.start()
    let socket: WebSocket | null = null
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      socket = new WebSocket(`ws://127.0.0.1:${port}/runtime/ws`)
      const received: StateBatchV1[] = []
      socket.on('message', (data) => {
        received.push(JSON.parse(data.toString()) as StateBatchV1)
      })
      await new Promise<void>((resolve, reject) => {
        socket!.once('open', resolve)
        socket!.once('error', reject)
      })
      await expect.poll(
        () => received.filter(({ type }) => type === 'state-batch-v1').flatMap(({ values }) => values.map(({ mappingId, value }) => ({ mappingId, value })))
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
    const createOpcUaClientAdapter = vi.fn((_project: WorkcellProjectV5, options) => {
      const publications = clientPublicationHarness(_project, options.configRevision, options.publisherGeneration)
      const adapter: OpcUaClientAdapterV1 = {
        start: async () => {
          options.publish(publications.connected())
          for (const publication of publications.state('mapping-object-box-status', 91, 1)) options.publish(publication)
          for (let sequence = 2; sequence <= 130; sequence += 1) {
            for (const publication of publications.state('mapping-object-box-x', sequence, sequence)) options.publish(publication)
          }
        },
        stop: async () => undefined,
        write: async () => ({ ok: false, statusCode: 'BadNoCommunication', failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED', message: 'Endpoint is not connected.' }),
        status: () => [],
      }
      return adapter
    })
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      { createOpcUaClientAdapter },
    )
    const project = clientProjectWithReadMappings('revision-synchronous-channel-retention', [
      { mappingId: 'mapping-object-box-x', signalId: 'box-x', dataType: 'Double', projectDataType: 'number', initialValue: 0, unit: 'meter' },
      { mappingId: 'mapping-object-box-status', signalId: 'box-status', dataType: 'Double', projectDataType: 'number', initialValue: 0, unit: 'status-code' },
    ])

    await service.start()
    let socket: WebSocket | null = null
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      socket = new WebSocket(`ws://127.0.0.1:${port}/runtime/ws`)
      const received: StateBatchV1[] = []
      socket.on('message', (data) => {
        received.push(JSON.parse(data.toString()) as StateBatchV1)
      })
      await new Promise<void>((resolve, reject) => {
        socket!.once('open', resolve)
        socket!.once('error', reject)
      })
      await expect.poll(
        () => received.filter(({ type }) => type === 'state-batch-v1').flatMap(({ values }) => values.map(({ mappingId, value }) => ({ mappingId, value })))
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

  it('keeps the last staged Client channel and accepts a later real live publication', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    let publishLive: OpcUaClientAdapterOptionsV1['publish'] | null = null
    let livePublications: ReturnType<typeof clientPublicationHarness> | null = null
    const createOpcUaClientAdapter = vi.fn((_project: WorkcellProjectV5, options) => {
      const publications = clientPublicationHarness(_project, options.configRevision, options.publisherGeneration)
      livePublications = publications
      publishLive = options.publish
      const adapter: OpcUaClientAdapterV1 = {
        start: async () => {
          options.publish(publications.connected())
          for (const publication of publications.booleanState(true, 1)) options.publish(publication)
        },
        stop: async () => undefined,
        write: async () => ({ ok: false, statusCode: 'BadNoCommunication', failureCode: 'OPC_UA_ENDPOINT_DISCONNECTED', message: 'Endpoint is not connected.' }),
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
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      socket = new WebSocket(`ws://127.0.0.1:${port}/runtime/ws`)
      const received: StateBatchV1[] = []
      socket.on('message', (data) => {
        received.push(JSON.parse(data.toString()) as StateBatchV1)
      })
      await new Promise<void>((resolve, reject) => {
        socket!.once('open', resolve)
        socket!.once('error', reject)
      })
      await expect.poll(
        () => received.filter(({ type }) => type === 'state-batch-v1').flatMap(({ values }) => values.map(({ value }) => value)),
      ).toEqual([true])

      for (const publication of livePublications!.booleanState(false, 3)) publishLive!(publication)
      await expect.poll(
        () => received.filter(({ type }) => type === 'state-batch-v1').flatMap(({ values }) => values.map(({ value }) => value)),
      ).toEqual([true, false])
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

  it('replays the prior stop disconnect and never exposes failed-candidate data when recovery does not reconnect', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const firstProject = sampleProject('client', 'revision-client-disconnected-rollback')
    const replacement = sampleProject('client', 'revision-client-failed-candidate-data')
    const prior = fakeClientAdapter()
    const candidate = fakeClientAdapter()
    let priorOptions: OpcUaClientAdapterOptionsV1 | null = null
    let candidateOptions: OpcUaClientAdapterOptionsV1 | null = null
    let priorPublications: ReturnType<typeof clientPublicationHarness> | null = null

    prior.start
      .mockImplementationOnce(async () => {
        priorPublications = clientPublicationHarness(
          firstProject,
          priorOptions!.configRevision,
          priorOptions!.publisherGeneration,
        )
        priorOptions!.publish(priorPublications.connected())
        for (const publication of priorPublications.booleanState(true, 1)) priorOptions!.publish(publication)
      })
      .mockResolvedValueOnce(undefined)
    prior.stop.mockImplementationOnce(async () => {
      priorOptions!.publish(priorPublications!.disconnected())
    })
    candidate.start.mockImplementationOnce(async () => {
      const publications = clientPublicationHarness(
        replacement,
        candidateOptions!.configRevision,
        candidateOptions!.publisherGeneration,
      )
      candidateOptions!.publish(publications.connected())
      for (const publication of publications.booleanState(false, 2)) candidateOptions!.publish(publication)
      throw new Error('candidate-start-after-staged-data')
    })

    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createOpcUaClientAdapter: (project, options) => {
        if (project.revisionId === replacement.revisionId) {
          candidateOptions = options
          return candidate.adapter
        }
        priorOptions = options
        return prior.adapter
      },
    })
    await service.start()
    let socket: WebSocket | null = null
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', firstProject)).status).toBe(200)
      const failed = await requestJson(port, 'PUT', '/runtime/project', replacement)
      expect(failed.status).toBe(503)
      expect(await failed.json()).toMatchObject({
        code: 'PROJECT_ACTIVATION_FAILED',
        recoveredRevisionId: firstProject.revisionId,
      })
      expect(prior.start).toHaveBeenCalledTimes(2)

      const received: Array<Record<string, unknown>> = []
      socket = new WebSocket(`ws://127.0.0.1:${port}/runtime/ws`)
      socket.on('message', (data) => received.push(JSON.parse(data.toString()) as Record<string, unknown>))
      await new Promise<void>((resolve, reject) => {
        socket!.once('open', resolve)
        socket!.once('error', reject)
      })
      await expect.poll(() => received.some(({ type, phase }) =>
        type === 'endpoint-replay-boundary-v1' && phase === 'end',
      )).toBe(true)

      expect(received.map(({ type, phase }) => `${type}:${phase ?? ''}`)).toEqual([
        'endpoint-replay-boundary-v1:start',
        'endpoint-lifecycle-v1:connected',
        'state-batch-v1:',
        'endpoint-lifecycle-v1:disconnected',
        'endpoint-replay-boundary-v1:end',
      ])
      expect(received.filter(({ type }) => type === 'state-batch-v1').flatMap(({ values }) =>
        (values as Array<{ value: unknown }>).map(({ value }) => value),
      )).toEqual([true])
    } finally {
      socket?.close()
      await service.stop()
    }
  })

  it('retains the exact prior authority as recovery-required when replacement recovery cannot prove cleanup', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const prior = fakeClientAdapter()
    prior.start.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('prior-restart-failure'))
    const candidate = fakeClientAdapter()
    candidate.start.mockRejectedValueOnce(new Error('candidate-start-failure'))
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      {
        createOpcUaClientAdapter: (project) => (
          project.revisionId === 'revision-client-double-failure' ? candidate.adapter : prior.adapter
        ),
        nowMs: () => 1_000,
      },
    )
    const firstProject = sampleProject('client', 'revision-client-double-prior')
    const replacement = sampleProject('client', 'revision-client-double-failure')

    await service.start()
    let socket: WebSocket | null = null
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', firstProject)).status).toBe(200)
      const failed = await requestJson(port, 'PUT', '/runtime/project', replacement)

      expect(failed.status).toBe(503)
      expect(await failed.json()).toMatchObject({
        code: 'PROJECT_ACTIVATION_FAILED',
        recoveredRevisionId: null,
        recoveryError: 'prior-restart-failure',
      })
      expect(gatewayStatus(service.status())).toMatchObject({
        project: {
          phase: 'recovery-required', authorityPhase: 'recovery-required',
          revisionId: firstProject.revisionId, readinessCode: 'RECOVERY_REQUIRED',
        },
        opcUa: { mode: 'client' },
      })
      expect((await fetch(`http://127.0.0.1:${port}/readyz`)).status).toBe(503)
      expect(prior.stop).toHaveBeenCalledTimes(2)
      expect(candidate.stop).toHaveBeenCalledOnce()
      const oldRevision = await configRevisionForProjectV5(firstProject)
      const afterDoubleFailure = await requestCommand(port, commandRequest(oldRevision))
      expect(afterDoubleFailure.status).toBe(503)
      expect(await afterDoubleFailure.json()).toMatchObject({ code: 'PROJECT_RECOVERY_REQUIRED' })
      expect((await requestLease(port)).status).toBe(503)
      expect((await requestJson(port, 'POST', '/runtime/state', {})).status).toBe(503)
      expect((await requestJson(port, 'POST', `/runtime/client-endpoints/${encodeURIComponent(firstProject.opcUa.endpoints[0]!.endpointId)}/disconnect`, {})).status).toBe(503)
      socket = await openWebSocket(port)
      socket.send(JSON.stringify({
        type: 'browser-publisher-lease-acquire-v1', protocolVersion: 1,
        projectId: firstProject.projectId, configRevision: oldRevision, publisherId: 'recovery-test',
      }))
      await expectNoWebSocketMessage(socket)
    } finally {
      socket?.close()
      await service.stop()
    }
  })

  it('cleans a partially restarted prior Bridge and clears its cached runtime replay after double failure', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const firstProject = sampleProject('bridge', 'revision-bridge-prior')
    const replacement = sampleProject('bridge', 'revision-bridge-candidate-fails')
    const priorServer = fakeServerAdapter('opc.tcp://127.0.0.1:14840')
    const candidateServer = fakeServerAdapter('opc.tcp://127.0.0.1:14841')
    const priorClient = fakeClientAdapter()
    const candidateClient = fakeClientAdapter()
    let priorOptions: OpcUaClientAdapterOptionsV1 | null = null
    priorClient.start.mockImplementationOnce(async () => {
      const publications = clientPublicationHarness(
        firstProject,
        priorOptions!.configRevision,
        priorOptions!.publisherGeneration,
      )
      priorOptions!.publish(publications.connected())
      for (const publication of publications.booleanState(true)) priorOptions!.publish(publication)
    }).mockRejectedValueOnce(new Error('prior-bridge-client-restart-failure'))
    candidateClient.start.mockRejectedValueOnce(new Error('candidate-bridge-client-start-failure'))
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      {
        createOpcUaServerAdapter: (project) => (
          project.revisionId === replacement.revisionId ? candidateServer.adapter : priorServer.adapter
        ),
        createOpcUaClientAdapter: (project, options) => {
          if (project.revisionId === replacement.revisionId) return candidateClient.adapter
          priorOptions = options
          return priorClient.adapter
        },
      },
    )

    await service.start()
    let socket: WebSocket | null = null
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', firstProject)).status).toBe(200)
      const failed = await requestJson(port, 'PUT', '/runtime/project', replacement)

      expect(failed.status).toBe(503)
      expect(await failed.json()).toMatchObject({
        code: 'PROJECT_ACTIVATION_FAILED',
        recoveryError: 'prior-bridge-client-restart-failure',
      })
      expect(priorServer.stop).toHaveBeenCalledTimes(2)
      expect(priorClient.stop).toHaveBeenCalledTimes(2)
      expect(gatewayStatus(service.status())).toMatchObject({
        project: { phase: 'recovery-required', readinessCode: 'RECOVERY_REQUIRED', revisionId: firstProject.revisionId },
      })
      expect((await fetch(`http://127.0.0.1:${port}/readyz`)).status).toBe(503)

      socket = await openWebSocket(port)
      await expectNoWebSocketMessage(socket)
      const serverStopCount = priorServer.stop.mock.calls.length
      const clientStopCount = priorClient.stop.mock.calls.length
      await service.stop()
      expect(priorServer.stop).toHaveBeenCalledTimes(serverStopCount + 1)
      expect(priorClient.stop).toHaveBeenCalledTimes(clientStopCount + 1)
    } finally {
      socket?.close()
      await service.stop()
    }
  })

  it('keeps the prior Project publication visible while a replacement Client start is pending', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const prior = fakeClientAdapter()
    const candidate = fakeClientAdapter()
    let releaseCandidateStart: () => void = () => undefined
    candidate.start.mockImplementationOnce(async () => new Promise<void>((resolve) => {
      releaseCandidateStart = resolve
    }))
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      {
        createOpcUaClientAdapter: (project) => (
          project.revisionId === 'revision-client-pending' ? candidate.adapter : prior.adapter
        ),
      },
    )
    const firstProject = sampleProject('client', 'revision-client-visible')
    const replacement = sampleProject('client', 'revision-client-pending')

    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', firstProject)).status).toBe(200)
      const pendingReplacement = requestJson(port, 'PUT', '/runtime/project', replacement)
      await expect.poll(() => candidate.start.mock.calls.length).toBe(1)

      expect(gatewayStatus(service.status())).toMatchObject({
        project: {
          phase: 'ready',
          projectId: firstProject.projectId,
          revisionId: firstProject.revisionId,
        },
        opcUa: { mode: 'client' },
      })

      releaseCandidateStart()
      expect((await pendingReplacement).status).toBe(200)
      expect(gatewayStatus(service.status())).toMatchObject({
        project: { phase: 'ready', revisionId: replacement.revisionId },
      })
    } finally {
      releaseCandidateStart()
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

  it('activates a Server Project, publishes validated Project V5 Robot state, and stops its adapter', async () => {
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
    const configRevision = await configRevisionForProjectV5(project)

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
        expect.objectContaining({
          advertisedHost: '127.0.0.1',
          advertisedPort: 24840,
          host: '127.0.0.1',
          port: 14840,
          pkiRootDir: 'C:\\runtime-gateway-test-pki',
          configRevision,
          onProductCommandWrite: expect.any(Function),
        }),
      )
      const adapterOptions = (createOpcUaServerAdapter as unknown as {
        readonly mock: { readonly calls: ReadonlyArray<readonly [unknown, { readonly configRevision: string }]> }
      }).mock.calls[0]![1]
      expect(adapterOptions.configRevision).not.toBe(project.revisionId)
      expect(fake.start).toHaveBeenCalledTimes(1)

      const publish = await requestJson(port, 'POST', '/runtime/state', {
        projectId: project.projectId,
        revisionId: project.revisionId,
        robots: [{ robotId: 'robot-1', jointValues: { J1: 15 } }],
      })
      expect(publish.status).toBe(200)
      expect(gatewayStatus(await publish.json())).toMatchObject({
        project: { phase: 'ready', projectId: project.projectId, revisionId: project.revisionId },
        opcUa: { mode: 'server', server: { phase: 'listening', endpointUrl: 'opc.tcp://127.0.0.1:14840' } },
      })
      expect(fake.publishRobotJointState.mock.calls).toEqual([
        ['robot-1', { J1: 15 }],
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
    const createOpcUaServerAdapter = vi.fn((project: WorkcellProjectV5) => (
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

  it('rejects a V4 Project before adapter preparation and retains the active V5 runtime', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const createOpcUaClientAdapter = vi.fn(() => fakeClientAdapter().adapter)
    const createOpcUaServerAdapter = vi.fn(() => fakeServerAdapter().adapter)
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createOpcUaClientAdapter,
      createOpcUaServerAdapter,
      pkiRootDir: 'C:\\runtime-gateway-test-pki',
    })
    await service.start()
    try {
      const activeProject = sampleProject('off')
      expect((await requestJson(port, 'PUT', '/runtime/project', activeProject)).status).toBe(200)
      const before = gatewayStatus(service.status())
      const clientCalls = createOpcUaClientAdapter.mock.calls.length
      const serverCalls = createOpcUaServerAdapter.mock.calls.length

      const rejected = await requestJson(port, 'PUT', '/runtime/project', { schemaVersion: 4 })

      expect(rejected.status).toBe(400)
      expect(createOpcUaClientAdapter).toHaveBeenCalledTimes(clientCalls)
      expect(createOpcUaServerAdapter).toHaveBeenCalledTimes(serverCalls)
      expect(gatewayStatus(service.status())).toMatchObject({ project: before.project, opcUa: before.opcUa })
    } finally {
      await service.stop()
    }
  })

  it('has no production Gateway dependency on project-v4', async () => {
    const sources = await Promise.all([
      'src/core/runtime-protocol/v1.ts',
      'middleware/runtime-gateway/opcua-client-adapter.ts',
      'middleware/runtime-gateway/opcua-server-adapter.ts',
      'middleware/runtime-gateway/runtime-command-dedupe-registry.ts',
      'middleware/runtime-gateway/runtime-command-service.ts',
      'middleware/runtime-gateway/main.ts',
    ].map(async (path) => readFile(path, 'utf8')))
    for (const source of sources) {
      expect(source).not.toContain('project-v4')
      expect(source).not.toContain('WorkcellProjectV4')
    }
  })

  it('retains a partially started first candidate as recovery-required when its stop cleanup fails', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain(); const port = await findAvailablePort()
    const candidate = fakeClientAdapter(); candidate.start.mockRejectedValueOnce(new Error('candidate-start-failure')); candidate.stop.mockRejectedValueOnce(new Error('candidate-stop-failure')).mockRejectedValueOnce(new Error('candidate-stop-retry-failure'))
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), { createOpcUaClientAdapter: () => candidate.adapter })
    const project = sampleProject('client', 'revision-first-candidate-cleanup-fails')
    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(503)
      expect(gatewayStatus(service.status())).toMatchObject({ project: { phase: 'recovery-required', revisionId: project.revisionId, readinessCode: 'RECOVERY_REQUIRED' } })
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(503)
      await expect(service.stop()).rejects.toThrow('candidate-stop-retry-failure')
      expect(gatewayStatus(service.status()).project).toMatchObject({ phase: 'recovery-required', revisionId: project.revisionId })
      await expect(service.stop()).resolves.toBeUndefined()
      expect(gatewayStatus(service.status()).project).toMatchObject({ phase: 'not-applied', revisionId: null })
    } finally { await service.stop() }
  })

  it.each(['exact', 'unconditional'] as const)('keeps recovered authority until %s DELETE cleans its active and residual runtimes', async (form) => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const prior = fakeClientAdapter()
    const candidate = fakeClientAdapter()
    candidate.start.mockRejectedValueOnce(new Error('candidate-start-failure'))
    candidate.stop
      .mockRejectedValueOnce(new Error('candidate-activation-cleanup-failure'))
      .mockRejectedValueOnce(new Error('candidate-delete-cleanup-failure'))
      .mockResolvedValue(undefined)
    const priorProject = sampleProject('client', `revision-delete-residual-prior-${form}`)
    const replacement = sampleProject('client', `revision-delete-residual-candidate-${form}`)
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createOpcUaClientAdapter: (project) => (
        project.revisionId === replacement.revisionId ? candidate.adapter : prior.adapter
      ),
    })

    await service.start()
    try {
      expect((await requestJson(port, 'PUT', '/runtime/project', priorProject)).status).toBe(200)
      expect((await requestJson(port, 'PUT', '/runtime/project', replacement)).status).toBe(503)
      expect(gatewayStatus(service.status()).project).toMatchObject({
        phase: 'recovery-required',
        revisionId: priorProject.revisionId,
        readinessCode: 'RECOVERY_REQUIRED',
      })

      const configRevision = await configRevisionForProjectV5(priorProject)
      const body = form === 'unconditional'
        ? { type: 'runtime-project-deactivate-v1', protocolVersion: 1, unconditional: true }
        : {
            type: 'runtime-project-deactivate-v1',
            protocolVersion: 1,
            projectId: priorProject.projectId,
            revisionId: priorProject.revisionId,
            configRevision,
            activationAttemptId: `attempt-${priorProject.revisionId}`,
          }
      const request = () => fetch(`http://127.0.0.1:${port}/runtime/project`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

      const failed = await request()
      expect(failed.status).toBe(503)
      expect(await failed.json()).toMatchObject({ code: 'PROJECT_DEACTIVATION_RECOVERY_REQUIRED' })
      expect(gatewayStatus(service.status()).project).toMatchObject({
        phase: 'recovery-required',
        revisionId: priorProject.revisionId,
        readinessCode: 'RECOVERY_REQUIRED',
      })

      const succeeded = await request()
      expect(succeeded.status).toBe(200)
      expect(await succeeded.json()).toMatchObject({
        project: {
          phase: 'not-applied',
          projectId: null,
          revisionId: null,
          readinessCode: 'NO_ACTIVE_REVISION',
        },
      })
      expect(prior.stop).toHaveBeenCalledTimes(3)
      expect(candidate.stop).toHaveBeenCalledTimes(3)
    } finally {
      await service.stop()
    }
  })

  it('isolates the bounded OPC UA test-connection diagnostic and rejects arbitrary control paths', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort(); const client = fakeClientAdapter(); const server = fakeServerAdapter()
    const diagnostic = vi.fn(async () => ({ type: 'opcua-test-connection-result-v1' as const, protocolVersion: 1 as const, outcome: 'succeeded' as const, namespaces: ['urn:test'] }))
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), { createOpcUaClientAdapter: () => client.adapter, createOpcUaServerAdapter: () => server.adapter, testOpcUaConnection: diagnostic })
    await service.start()
    try {
      const project = sampleProject('client'); expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      const before = gatewayStatus(service.status()); const request = { type: 'opcua-test-connection-request-v1', protocolVersion: 1, endpoint: project.opcUa.endpoints[0] }
      const response = await requestJson(port, 'POST', '/runtime/opcua/test-connection', request)
      expect(response.status).toBe(200); expect(await response.json()).toEqual(await diagnostic.mock.results[0]!.value); expect(diagnostic).toHaveBeenCalledOnce()
      expect(gatewayStatus(service.status())).toMatchObject({ project: before.project, opcUa: before.opcUa })
      expect((await requestJson(port, 'POST', '/runtime/opcua/test-connection', { ...request, extra: true })).status).toBe(400)
      for (const path of ['/runtime/opcua/browse', '/runtime/opcua/read', '/runtime/opcua/write', '/runtime/opcua/security', '/runtime/container']) expect((await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST' })).status).toBe(404)
      expect(diagnostic).toHaveBeenCalledOnce()
    } finally { await service.stop() }
  })

  it('rejects injected diagnostic fields and unsupported diagnostic codes without echoing them', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain(); const port = await findAvailablePort()
    const diagnostic = vi.fn(async () => ({ type: 'opcua-test-connection-result-v1', protocolVersion: 1, outcome: 'failed', code: 'INJECTED_CODE', message: 'secret', injected: true }) as never)
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), { testOpcUaConnection: diagnostic }); await service.start()
    try {
      const endpoint = { endpointId: 'x', name: 'x', endpointUrl: 'opc.tcp://localhost:4840', enabled: true, publishingIntervalMs: 50, reconnectDelayMs: 0 }
      const response = await requestJson(port, 'POST', '/runtime/opcua/test-connection', { type: 'opcua-test-connection-request-v1', protocolVersion: 1, endpoint })
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ code: 'CONNECTIVITY_RESPONSE_INVALID', message: 'Connectivity diagnostic returned an invalid result.' })
    } finally { await service.stop() }
  })

  it.each([
    { endpointUrl: 'invalid' }, { publishingIntervalMs: 49 }, { publishingIntervalMs: 1.5 }, { reconnectDelayMs: -1 }, { reconnectDelayMs: 1.5 }, { endpointId: 'x'.repeat(129) }, { name: 'x'.repeat(129) }, { endpointUrl: `opc.tcp://${'x'.repeat(2048)}` },
  ])('rejects invalid diagnostic endpoint contract before delegation', async (override) => {
    const { createRuntimeGatewayEntrypointService } = await importMain(); const port = await findAvailablePort(); const diagnostic = vi.fn()
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), { testOpcUaConnection: diagnostic }); await service.start()
    try {
      const endpoint = { endpointId: 'x', name: 'x', endpointUrl: 'opc.tcp://localhost:4840', enabled: true, publishingIntervalMs: 50, reconnectDelayMs: 0, ...override }
      expect((await requestJson(port, 'POST', '/runtime/opcua/test-connection', { type: 'opcua-test-connection-request-v1', protocolVersion: 1, endpoint })).status).toBe(400); expect(diagnostic).not.toHaveBeenCalled()
    } finally { await service.stop() }
  })

  it('fences Project deactivation and returns canonical inactive state only after exact success', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const client = connectedClientAdapter()
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), {
      createOpcUaClientAdapter: () => client.adapter,
    })
    await service.start()
    try {
      const project = sampleProject('client')
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      const request = async (body: unknown) => fetch(`http://127.0.0.1:${port}/runtime/project`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const revision = await import('../../src/core/project-v5/index.js').then(({ configRevisionForProjectV5 }) => configRevisionForProjectV5(project))
      expect((await request({ type: 'runtime-project-deactivate-v1', protocolVersion: 1, projectId: 'other', revisionId: project.revisionId, configRevision: revision, activationAttemptId: `attempt-${project.revisionId}` })).status).toBe(409)
      const success = await request({ type: 'runtime-project-deactivate-v1', protocolVersion: 1, projectId: project.projectId, revisionId: project.revisionId, configRevision: revision, activationAttemptId: `attempt-${project.revisionId}` })
      expect(success.status).toBe(200)
      expect(await success.json()).toMatchObject({ project: { phase: 'not-applied', projectId: null, revisionId: null, configRevision: null, readinessCode: 'NO_ACTIVE_REVISION' } })
      expect(client.stop).toHaveBeenCalledOnce()
      expect((await request({ type: 'runtime-project-deactivate-v1', protocolVersion: 1, projectId: project.projectId, revisionId: project.revisionId, configRevision: revision, activationAttemptId: `attempt-${project.revisionId}` })).status).toBe(409)
      expect((await request({ type: 'runtime-project-deactivate-v1', protocolVersion: 1, unconditional: true })).status).toBe(200)
    } finally { await service.stop() }
  })

  it('resolves one configured live namespace through the closed diagnostic route', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const client = connectedClientAdapter()
    const resolve = vi.fn(async () => 2)
    ;(client.adapter as unknown as { resolveNamespaceIndex: typeof resolve }).resolveNamespaceIndex = resolve
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), { createOpcUaClientAdapter: () => client.adapter })
    await service.start()
    try {
      const project = sampleProject('client')
      expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      const before = gatewayStatus(service.status())
      const body = { type: 'opcua-namespace-index-request-v1', protocolVersion: 1, endpointId: project.opcUa.endpoints[0]!.endpointId, namespaceUri: 'urn:controller' }
      const response = await requestJson(port, 'POST', '/runtime/opcua/namespace-index', body)
      expect(await response.json()).toEqual({ type: 'opcua-namespace-index-response-v1', protocolVersion: 1, endpointId: body.endpointId, namespaceUri: body.namespaceUri, namespaceIndex: 2 })
      expect(resolve).toHaveBeenCalledWith(body.endpointId, body.namespaceUri)
      expect(gatewayStatus(service.status())).toMatchObject({ project: before.project, opcUa: before.opcUa })
      expect((await requestJson(port, 'POST', '/runtime/opcua/namespace-index', { ...body, extra: true })).status).toBe(400)
      expect(resolve).toHaveBeenCalledOnce()
    } finally { await service.stop() }
  })

  it('rejects namespace resolution when the exact Endpoint Session proof changes during the read', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain(); const port = await findAvailablePort()
    const client = connectedClientAdapter(); const first = {}; const replacement = {}; let proof: object = first
    ;(client.adapter as unknown as { resolveNamespaceIndex: () => Promise<number>; readNamespaceSessionProof: () => { endpointId: string; generation: number; session: object } }).resolveNamespaceIndex = async () => { proof = replacement; return 2 }
    ;(client.adapter as unknown as { readNamespaceSessionProof: () => { endpointId: string; generation: number; session: object } }).readNamespaceSessionProof = () => ({ endpointId: 'endpoint-main', generation: proof === first ? 1 : 2, session: proof })
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), { createOpcUaClientAdapter: () => client.adapter }); await service.start()
    try {
      const project = sampleProject('client'); await requestJson(port, 'PUT', '/runtime/project', project)
      const response = await requestJson(port, 'POST', '/runtime/opcua/namespace-index', { type: 'opcua-namespace-index-request-v1', protocolVersion: 1, endpointId: project.opcUa.endpoints[0]!.endpointId, namespaceUri: 'urn:controller' })
      expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'OPC_UA_NAMESPACE_SESSION_STALE' })
    } finally { await service.stop() }
  })

  it('bounds a namespace read outside the transition queue and returns a stable timeout', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain(); const port = await findAvailablePort()
    const client = connectedClientAdapter()
    ;(client.adapter as unknown as { resolveNamespaceIndex: () => Promise<number> }).resolveNamespaceIndex = () => new Promise<number>(() => undefined)
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), { createOpcUaClientAdapter: () => client.adapter, namespaceResolutionTimeoutMs: 1 })
    await service.start()
    try {
      const project = sampleProject('client'); await requestJson(port, 'PUT', '/runtime/project', project)
      const response = await requestJson(port, 'POST', '/runtime/opcua/namespace-index', { type: 'opcua-namespace-index-request-v1', protocolVersion: 1, endpointId: project.opcUa.endpoints[0]!.endpointId, namespaceUri: 'urn:controller' })
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ code: 'OPC_UA_NAMESPACE_READ_TIMEOUT' })
      expect(gatewayStatus(service.status()).project).toMatchObject({ phase: 'ready', revisionId: project.revisionId })
    } finally { await service.stop() }
  })

  it('maps unconfigured and disconnected namespace routes without mutating the Project', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const client = connectedClientAdapter()
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), { createOpcUaClientAdapter: () => client.adapter })
    await service.start()
    try {
      const project = sampleProject('client')
      await requestJson(port, 'PUT', '/runtime/project', project)
      const before = gatewayStatus(service.status())
      const body = { type: 'opcua-namespace-index-request-v1', protocolVersion: 1, endpointId: project.opcUa.endpoints[0]!.endpointId, namespaceUri: 'urn:controller' }
      const wrong = await requestJson(port, 'POST', '/runtime/opcua/namespace-index', { ...body, endpointId: 'other' })
      expect({ status: wrong.status, body: await wrong.json() }).toMatchObject({ status: 409, body: { code: 'OPC_UA_NAMESPACE_ENDPOINT_MISMATCH' } })
      const disconnected = await requestJson(port, 'POST', '/runtime/opcua/namespace-index', body)
      expect({ status: disconnected.status, body: await disconnected.json() }).toMatchObject({ status: 409, body: { code: 'OPC_UA_NAMESPACE_ENDPOINT_DISCONNECTED' } })
      expect(gatewayStatus(service.status())).toMatchObject({ project: before.project, opcUa: before.opcUa })
    } finally { await service.stop() }
  })

  it.each(['OPC_UA_NAMESPACE_URI_MISSING', 'OPC_UA_NAMESPACE_URI_DUPLICATE', 'OPC_UA_NAMESPACE_READ_FAILED', 'OPC_UA_NAMESPACE_SESSION_STALE', 'OPC_UA_NAMESPACE_ARRAY_INVALID'])('preserves namespace resolver code %s', async (code) => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort(); const client = connectedClientAdapter()
    ;(client.adapter as unknown as { resolveNamespaceIndex: () => Promise<number> }).resolveNamespaceIndex = async () => { throw new Error(code) }
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), { createOpcUaClientAdapter: () => client.adapter }); await service.start()
    try {
      const project = sampleProject('client'); await requestJson(port, 'PUT', '/runtime/project', project); const before = gatewayStatus(service.status())
      const response = await requestJson(port, 'POST', '/runtime/opcua/namespace-index', { type: 'opcua-namespace-index-request-v1', protocolVersion: 1, endpointId: project.opcUa.endpoints[0]!.endpointId, namespaceUri: 'urn:controller' })
      expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 409, body: { code } }); expect(gatewayStatus(service.status())).toMatchObject({ project: before.project })
    } finally { await service.stop() }
  })

  it('caps both connectivity diagnostic request bodies before delegates run', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain(); const port = await findAvailablePort(); const client = connectedClientAdapter(); const diagnostic = vi.fn()
    ;(client.adapter as unknown as { resolveNamespaceIndex: () => Promise<number> }).resolveNamespaceIndex = vi.fn(async () => 2)
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), { createOpcUaClientAdapter: () => client.adapter, testOpcUaConnection: diagnostic }); await service.start()
    try {
      const project = sampleProject('client'); await requestJson(port, 'PUT', '/runtime/project', project); const before = gatewayStatus(service.status()); const body = jsonBodyAtByteLength(64 * 1024 + 1)
      for (const path of ['/runtime/opcua/test-connection', '/runtime/opcua/namespace-index']) { const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }); const text = await response.text(); expect(response.status).toBe(413); expect(response.headers.get('content-type')).toContain('application/json'); expect(Buffer.byteLength(text)).toBeLessThanOrEqual(64 * 1024) }
      expect(diagnostic).not.toHaveBeenCalled(); expect(gatewayStatus(service.status())).toMatchObject({ project: before.project })
    } finally { await service.stop() }
  })

  it.each(['synchronous', 'asynchronous'] as const)('attempts Server stop when Client stop %sly fails', async (kind) => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const client = fakeClientAdapter(); const server = fakeServerAdapter()
    const clientStop = vi.fn(kind === 'synchronous' ? () => { throw new Error('client stop') } : async () => { throw new Error('client stop') })
    ;(client.adapter as unknown as { stop: () => Promise<void> }).stop = clientStop
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), { createOpcUaClientAdapter: () => client.adapter, createOpcUaServerAdapter: () => server.adapter })
    await service.start()
    try {
      const project = sampleProject('bridge'); expect((await requestJson(port, 'PUT', '/runtime/project', project)).status).toBe(200)
      const revision = await import('../../src/core/project-v5/index.js').then(({ configRevisionForProjectV5 }) => configRevisionForProjectV5(project))
      const response = await fetch(`http://127.0.0.1:${port}/runtime/project`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'runtime-project-deactivate-v1', protocolVersion: 1, projectId: project.projectId, revisionId: project.revisionId, configRevision: revision, activationAttemptId: `attempt-${project.revisionId}` }) })
      expect(response.status).toBe(503); expect(server.stop).toHaveBeenCalledOnce()
      expect((await service.status()).project).toMatchObject({
        phase: 'recovery-required',
        revisionId: project.revisionId,
        readinessCode: 'RECOVERY_REQUIRED',
      })
    } finally { ;(client.adapter as unknown as { stop: () => Promise<void> }).stop = async () => undefined; await service.stop() }
  })

  it('retains the exact prior authority when Server stop fails after Client stop', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain(); const port = await findAvailablePort()
    const client = fakeClientAdapter(); const server = fakeServerAdapter(); const originalStop = server.adapter.stop
    ;(server.adapter as unknown as { stop: () => Promise<void> }).stop = vi.fn(async () => { throw new Error('server stop') })
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), { createOpcUaClientAdapter: () => client.adapter, createOpcUaServerAdapter: () => server.adapter }); await service.start()
    try {
      const project = sampleProject('bridge'); await requestJson(port, 'PUT', '/runtime/project', project); const revision = await import('../../src/core/project-v5/index.js').then(({ configRevisionForProjectV5 }) => configRevisionForProjectV5(project))
      const response = await fetch(`http://127.0.0.1:${port}/runtime/project`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'runtime-project-deactivate-v1', protocolVersion: 1, projectId: project.projectId, revisionId: project.revisionId, configRevision: revision, activationAttemptId: `attempt-${project.revisionId}` }) })
      expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: 'PROJECT_DEACTIVATION_RECOVERY_REQUIRED' }); expect(service.status().project).toMatchObject({ phase: 'recovery-required', revisionId: project.revisionId, readinessCode: 'RECOVERY_REQUIRED' })
    } finally { ;(server.adapter as unknown as { stop: () => Promise<void> }).stop = originalStop; await service.stop() }
  })

  it('does not claim canonical empty authority when partial recovery fails', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain(); const port = await findAvailablePort()
    const client = fakeClientAdapter(); const server = fakeServerAdapter(); const originalClientStart = client.adapter.start; const originalServerStop = server.adapter.stop
    const service = createRuntimeGatewayEntrypointService(createTestConfig(port), { createOpcUaClientAdapter: () => client.adapter, createOpcUaServerAdapter: () => server.adapter }); await service.start()
    try {
      const project = sampleProject('bridge'); await requestJson(port, 'PUT', '/runtime/project', project)
      ;(server.adapter as unknown as { stop: () => Promise<void> }).stop = vi.fn(async () => { throw new Error('server stop') })
      ;(client.adapter as unknown as { start: () => Promise<void> }).start = vi.fn(async () => { throw new Error('client restart') })
      const revision = await import('../../src/core/project-v5/index.js').then(({ configRevisionForProjectV5 }) => configRevisionForProjectV5(project))
      const response = await fetch(`http://127.0.0.1:${port}/runtime/project`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'runtime-project-deactivate-v1', protocolVersion: 1, projectId: project.projectId, revisionId: project.revisionId, configRevision: revision, activationAttemptId: `attempt-${project.revisionId}` }) })
      expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: 'PROJECT_DEACTIVATION_RECOVERY_REQUIRED' }); expect(service.status().project).toMatchObject({ phase: 'recovery-required', authorityPhase: 'recovery-required', readinessCode: 'RECOVERY_REQUIRED', revisionId: project.revisionId })
    } finally { ;(client.adapter as unknown as { start: () => Promise<void> }).start = originalClientStart; ;(server.adapter as unknown as { stop: () => Promise<void> }).stop = originalServerStop; await service.stop() }
  })

  it('rejects a stale activation authority without stopping or replacing the durable winner', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain(); const port = await findAvailablePort()
    const client = fakeClientAdapter(); const service = createRuntimeGatewayEntrypointService(createTestConfig(port), { createOpcUaClientAdapter: () => client.adapter })
    await service.start()
    try {
      const winner = sampleProject('client', 'revision-cas-winner')
      expect((await requestJson(port, 'PUT', '/runtime/project', winner)).status).toBe(200)
      const candidate = sampleProject('client', 'revision-cas-loser')
      const configRevision = await import('../../src/core/project-v5/index.js').then(({ configRevisionForProjectV5 }) => configRevisionForProjectV5(candidate))
      const stale = await fetch(`http://127.0.0.1:${port}/runtime/project`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          type: 'runtime-project-activation-v1', protocolVersion: 1, project: candidate,
          configRevision, activationAttemptId: 'attempt-cas-loser', expectedAuthority: null,
        }),
      })
      expect(stale.status).toBe(409)
      expect(await stale.json()).toMatchObject({ code: 'PROJECT_ACTIVATION_CONFLICT' })
      expect(gatewayStatus(service.status()).project).toMatchObject({ phase: 'ready', revisionId: winner.revisionId, activationAttemptId: `attempt-${winner.revisionId}` })
      expect(client.stop).not.toHaveBeenCalled()
    } finally { await service.stop() }
  })

  it('keeps the first of two coordinators prepared from the same inactive authority as Gateway winner', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain(); const { createRuntimeGatewayConnectivityClientV1 } = await import('../../src/features/runtime-gateway/v5/runtime-gateway-connectivity-client.js'); const { configRevisionForProjectV5 } = await import('../../src/core/project-v5/index.js')
    const port = await findAvailablePort(); const service = createRuntimeGatewayEntrypointService(createTestConfig(port)); await service.start()
    try {
      const first = sampleProject('off', 'revision-race-first'); const second = sampleProject('off', 'revision-race-second')
      const gatewayFetch = (input: string, init: RequestInit) => fetch(`http://127.0.0.1:${port}${input}`, init)
      const firstCoordinator = createRuntimeGatewayConnectivityClientV1({ fetch: gatewayFetch, createActivationAttemptId: () => 'attempt-race-first' })
      const secondCoordinator = createRuntimeGatewayConnectivityClientV1({ fetch: gatewayFetch, createActivationAttemptId: () => 'attempt-race-second' })
      const [firstPrepared, secondPrepared] = await Promise.all([
        firstCoordinator.prepare(first, await configRevisionForProjectV5(first), null),
        secondCoordinator.prepare(second, await configRevisionForProjectV5(second), null),
      ])
      await expect(firstCoordinator.activate(firstPrepared)).resolves.toMatchObject({ project: { revisionId: first.revisionId, activationAttemptId: 'attempt-race-first' } })
      await expect(secondCoordinator.activate(secondPrepared)).rejects.toMatchObject({ code: 'PROJECT_ACTIVATION_CONFLICT', statusCode: 409 })
      expect(gatewayStatus(service.status()).project).toMatchObject({ phase: 'ready', revisionId: first.revisionId, activationAttemptId: 'attempt-race-first' })
    } finally { await service.stop() }
  })
})
