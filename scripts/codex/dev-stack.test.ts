import { describe, expect, it, vi } from 'vitest'
import { createDevStack } from './dev-stack.mjs'

describe('dev:stack', () => {
  it('builds Gateway, starts Gateway and Vite, then waits for both probes', async () => {
    const spawn = vi.fn(() => ({ kill: vi.fn(), exited: Promise.resolve(0) }))
    const probe = vi.fn(async (url: string) => (
      url.endsWith('/healthz') || url === 'http://127.0.0.1:5173/'
    ))
    const onSignal = vi.fn()
    const stack = createDevStack({ spawn, probe, onSignal })

    await expect(stack.start()).resolves.toEqual({
      webUrl: 'http://127.0.0.1:5173',
      gatewayUrl: 'http://127.0.0.1:8081',
    })

    expect(spawn.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ['npm', ['run', 'build:gateway']],
      ['node', ['dist-gateway/middleware/runtime-gateway/main.js']],
      ['npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173']],
    ])
    expect(probe).toHaveBeenCalledWith('http://127.0.0.1:8081/healthz')
    expect(probe).toHaveBeenCalledWith('http://127.0.0.1:5173/')
    expect(onSignal).toHaveBeenCalledWith('SIGINT', expect.any(Function))
    expect(onSignal).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
  })

  it('stops an already-started child when the second process fails', async () => {
    const killed: string[] = []
    const spawn = vi.fn()
      .mockReturnValueOnce({ kill: vi.fn(), exited: Promise.resolve(0) })
      .mockReturnValueOnce({ kill: vi.fn(() => killed.push('gateway')), exited: new Promise(() => undefined) })
      .mockImplementationOnce(() => { throw new Error('VITE_START_FAILED') })
    const stack = createDevStack({ spawn, probe: vi.fn(), onSignal: vi.fn() })

    await expect(stack.start()).rejects.toThrow('VITE_START_FAILED')
    expect(killed).toEqual(['gateway'])
  })

  it('stops active children in reverse order only once', async () => {
    const killed: string[] = []
    const spawn = vi.fn()
      .mockReturnValueOnce({ kill: vi.fn(), exited: Promise.resolve(0) })
      .mockReturnValueOnce({ kill: vi.fn(() => killed.push('gateway')), exited: Promise.resolve(0) })
      .mockReturnValueOnce({ kill: vi.fn(() => killed.push('vite')), exited: Promise.resolve(0) })
    const stack = createDevStack({ spawn, probe: vi.fn(async () => true), onSignal: vi.fn() })

    await stack.start()
    await Promise.all([stack.stop(), stack.stop()])

    expect(killed).toEqual(['vite', 'gateway'])
  })
})
