// @vitest-environment node

import {
  createServer as createNetServer,
  connect,
  type Server as NetServer,
} from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  validateWorkcellProjectV4,
  type WorkcellProjectV4,
} from '../../src/core/project-v4/index.js'
import { createDualRobotSampleV4 } from '../../src/features/project/v4/dual-robot-sample-v4.js'
import type { RuntimeGatewayDeploymentConfigV1 } from './deployment-config.js'
import {
  ROBOT_SIM_OPC_UA_NAMESPACE_URI_V1,
  type OpcUaServerAdapterV1,
} from './opcua-server-adapter.js'

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
    host: '127.0.0.1',
    httpPort,
    opcUaAdvertisedHost: '127.0.0.1',
    opcUaAdvertisedPort: 24840,
    opcUaPort: 14840,
  })
}

function sampleProject(
  mode: 'off' | 'server',
  revisionId = `revision-main-${mode}`,
): WorkcellProjectV4 {
  return createDualRobotSampleV4({
    projectId: 'project-main-http',
    revisionId,
    nowIso: '2026-07-17T00:00:00.000Z',
    opcUaMode: mode,
  })
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

    const status = service.status()

    expect(status).toEqual({
      mode: 'off',
      activeProjectId: null,
      activeConfigRevision: null,
      ready: false,
      readinessCode: 'NO_ACTIVE_REVISION',
      opcUaStarted: false,
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

  it('rejects WebSocket Upgrade without constructing an OPC UA object', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const createOpcUaServerAdapter = vi.fn(() => fakeServerAdapter().adapter)
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      { createOpcUaServerAdapter },
    )

    await service.start()
    try {
      const response = await requestUpgrade(port, '/runtime/ws')
      expect(response).not.toContain('101 Switching Protocols')
      expect(response).toMatch(/^HTTP\/1\.1 426 Upgrade Required\r\n/)
      expect(createOpcUaServerAdapter).not.toHaveBeenCalled()
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
      expect(await apply.json()).toEqual({
        projectId: project.projectId,
        revisionId: project.revisionId,
        mode: 'off',
        ready: true,
        endpointUrl: null,
        opcUaStarted: false,
      })
      expect(createOpcUaServerAdapter).not.toHaveBeenCalled()

      const readiness = await fetch(`http://127.0.0.1:${port}/readyz`)
      expect(readiness.status).toBe(200)
      expect(await readiness.json()).toEqual({
        projectId: project.projectId,
        revisionId: project.revisionId,
        mode: 'off',
        ready: true,
        endpointUrl: null,
        opcUaStarted: false,
      })

      const status = await fetch(`http://127.0.0.1:${port}/runtime/status`)
      expect(status.status).toBe(200)
      expect(await status.json()).toEqual({
        projectId: project.projectId,
        revisionId: project.revisionId,
        mode: 'off',
        ready: true,
        opcUaStarted: false,
        endpointUrl: null,
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
      expect(await apply.json()).toEqual({
        projectId: project.projectId,
        revisionId: project.revisionId,
        mode: 'server',
        ready: true,
        endpointUrl: 'opc.tcp://127.0.0.1:14840',
        opcUaStarted: true,
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
      expect(await publish.json()).toEqual({
        projectId: project.projectId,
        revisionId: project.revisionId,
        mode: 'server',
        ready: true,
        opcUaStarted: true,
        endpointUrl: 'opc.tcp://127.0.0.1:14840',
      })
      expect(fake.publishRobotJointState.mock.calls).toEqual([
        ['robot-sample-crb', { J1: 15, J2: -5 }],
        ['robot-sample-linear-slide', { SLIDE_X: 0.75 }],
      ])

      const readiness = await fetch(`http://127.0.0.1:${port}/readyz`)
      expect(readiness.status).toBe(200)
      expect(await readiness.json()).toMatchObject({
        mode: 'server',
        ready: true,
        endpointUrl: 'opc.tcp://127.0.0.1:14840',
        opcUaStarted: true,
      })
    } finally {
      await service.stop()
    }

    expect(fake.stop).toHaveBeenCalledTimes(1)
    expect(service.status()).toEqual({
      mode: 'off',
      activeProjectId: null,
      activeConfigRevision: null,
      ready: false,
      readinessCode: 'NO_ACTIVE_REVISION',
      opcUaStarted: false,
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

      expect(service.status()).toMatchObject({
        activeProjectId: project.projectId,
        activeConfigRevision: project.revisionId,
        ready: true,
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
      expect(service.status()).toMatchObject({
        mode: 'server',
        activeProjectId: firstProject.projectId,
        activeConfigRevision: firstProject.revisionId,
        ready: true,
        opcUaStarted: true,
        endpointUrl: 'opc.tcp://127.0.0.1:14840',
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
      expect(service.status()).toMatchObject({
        activeConfigRevision: firstProject.revisionId,
        ready: true,
        opcUaStarted: true,
      })
    } finally {
      await service.stop()
    }
  })
})
