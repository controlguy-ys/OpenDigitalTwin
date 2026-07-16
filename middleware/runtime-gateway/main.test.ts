// @vitest-environment node

import {
  createServer as createNetServer,
  connect,
  type Server as NetServer,
} from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeGatewayDeploymentConfigV1 } from './deployment-config.js'

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
    websocketPath: '/runtime/ws',
    opcUaPort: 14840,
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
    const createOpcUaObject = vi.fn(() => ({ started: true }))
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      { createOpcUaObject },
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
      expect(createOpcUaObject).not.toHaveBeenCalled()
    } finally {
      await service.stop()
    }
  })

  it('rejects WebSocket Upgrade without constructing an OPC UA object', async () => {
    const { createRuntimeGatewayEntrypointService } = await importMain()
    const port = await findAvailablePort()
    const createOpcUaObject = vi.fn(() => ({ started: true }))
    const service = createRuntimeGatewayEntrypointService(
      createTestConfig(port),
      { createOpcUaObject },
    )

    await service.start()
    try {
      const response = await requestUpgrade(port, '/runtime/ws')
      expect(response).not.toContain('101 Switching Protocols')
      expect(response).toMatch(/^HTTP\/1\.1 426 Upgrade Required\r\n/)
      expect(createOpcUaObject).not.toHaveBeenCalled()
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
})
