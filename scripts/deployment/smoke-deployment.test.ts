import { describe, expect, it, vi } from 'vitest'
import {
  createSmokeProjectName,
  smokeDeployment,
} from './smoke-deployment.mjs'

describe('deployment smoke orchestration', () => {
  it('creates deterministic Compose-safe project names', () => {
    expect(createSmokeProjectName(1720000000000, 42)).toBe(
      'robotsim-smoke-42-1720000000000',
    )
  })

  it('builds, probes, and cleans up the standard Web plus Runtime Gateway deployment', async () => {
    const commands: string[] = []
    const fetch = vi.fn(async (url: string) => url.endsWith('/runtime/readyz')
      ? new Response(JSON.stringify({ code: 'NO_ACTIVE_REVISION' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        })
      : new Response('ok'))

    await smokeDeployment({
      fetch,
      port: 18080,
      projectName: 'robotsim-smoke-test',
      run: async (command) => { commands.push(command.join(' ')) },
      sleep: async () => undefined,
    })

    expect(commands).toEqual([
      expect.stringMatching(/compose .* build$/),
      'docker run --rm robotsim-web:local nginx -t',
      expect.stringMatching(/compose .* up -d --wait --wait-timeout 90$/),
      expect.stringMatching(/compose .* down --volumes --remove-orphans$/),
    ])
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:18080/healthz')
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:18080/')
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:18080/runtime/healthz')
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:18080/runtime/readyz')
  })

  it('can run a supplied two-Robot OPC UA Server probe after the Gateway is live', async () => {
    const commands: string[] = []
    const probeOpcUaServer = vi.fn().mockResolvedValue(undefined)

    await smokeDeployment({
      fetch: async (url: string) => url.endsWith('/runtime/readyz')
        ? new Response(JSON.stringify({ code: 'NO_ACTIVE_REVISION' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          })
        : new Response('ok'),
      probeOpcUaServer,
      projectName: 'robotsim-smoke-opcua',
      run: async (command) => { commands.push(command.join(' ')) },
      sleep: async () => undefined,
    })

    expect(commands.some((command) => /up -d --wait --wait-timeout 90/.test(command))).toBe(true)
    expect(commands.some((command) => /--profile opcua/.test(command))).toBe(false)
    expect(commands.some((command) => /opcua-connector/.test(command))).toBe(false)
    expect(probeOpcUaServer).toHaveBeenCalledWith({
      endpointUrl: 'opc.tcp://127.0.0.1:4840',
      gatewayBaseUrl: 'http://127.0.0.1:18080/runtime',
      webBaseUrl: 'http://127.0.0.1:18080',
    })
  })

  it('always tears the Compose project down after a failed probe', async () => {
    const commands: string[] = []

    await expect(smokeDeployment({
      fetch: async () => { throw new Error('unreachable') },
      maxAttempts: 1,
      projectName: 'robotsim-smoke-failure',
      run: async (command) => { commands.push(command.join(' ')) },
      sleep: async () => undefined,
    })).rejects.toThrow('unreachable')

    expect(commands.at(-1)).toMatch(/down --volumes --remove-orphans$/)
  })
})
