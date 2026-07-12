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

  it('builds, probes, and cleans up the web deployment', async () => {
    const commands: string[] = []
    const fetch = vi.fn().mockResolvedValue({ ok: true })

    await smokeDeployment({
      fetch,
      port: 18080,
      projectName: 'robotsim-smoke-test',
      run: async (command) => { commands.push(command.join(' ')) },
      sleep: async () => undefined,
    })

    expect(commands).toEqual([
      expect.stringMatching(/compose .* build web$/),
      'docker run --rm robotsim-web:local nginx -t',
      expect.stringMatching(/compose .* up -d --wait --wait-timeout 90 web$/),
      expect.stringMatching(/compose .* down --volumes --remove-orphans$/),
    ])
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:18080/healthz')
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:18080/')
  })

  it('starts and checks the optional connector profile', async () => {
    const commands: string[] = []
    const probeWebSocket = vi.fn().mockResolvedValue(undefined)

    await smokeDeployment({
      includeOpcUa: true,
      fetch: async () => ({ ok: true }),
      probeWebSocket,
      projectName: 'robotsim-smoke-opcua',
      run: async (command) => { commands.push(command.join(' ')) },
      sleep: async () => undefined,
    })

    expect(commands.some((command) => /--profile opcua .*build/.test(command))).toBe(true)
    expect(commands.some((command) => /--profile opcua .*up -d/.test(command))).toBe(true)
    expect(commands.some((command) => /up -d --wait --wait-timeout 90/.test(command))).toBe(true)
    expect(commands.some((command) => /exec -T opcua-connector/.test(command))).toBe(true)
    expect(probeWebSocket).toHaveBeenCalledWith('ws://127.0.0.1:18080/opcua')
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
