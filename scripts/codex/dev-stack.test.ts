import { describe, expect, it, vi } from 'vitest'
import { createDevStack, createProcessSpawner, createWindowsTreeKiller } from './dev-stack.mjs'

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
    let resolveGatewayExit: (code: number) => void
    const gatewayExited = new Promise<number>((resolve) => {
      resolveGatewayExit = resolve
    })
    const spawn = vi.fn()
      .mockReturnValueOnce({ kill: vi.fn(), exited: Promise.resolve(0) })
      .mockReturnValueOnce({
        kill: vi.fn(() => {
          killed.push('gateway')
          resolveGatewayExit(0)
        }),
        exited: gatewayExited,
      })
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

  it('waits for every child to exit after stopping them in reverse order', async () => {
    const killed: string[] = []
    let resolveGatewayExit: (code: number) => void
    let resolveViteExit: (code: number) => void
    const gatewayExited = new Promise<number>((resolve) => {
      resolveGatewayExit = resolve
    })
    const viteExited = new Promise<number>((resolve) => {
      resolveViteExit = resolve
    })
    const spawn = vi.fn()
      .mockReturnValueOnce({ kill: vi.fn(), exited: Promise.resolve(0) })
      .mockReturnValueOnce({ kill: vi.fn(() => killed.push('gateway')), exited: gatewayExited })
      .mockReturnValueOnce({ kill: vi.fn(() => killed.push('vite')), exited: viteExited })
    const stack = createDevStack({ spawn, probe: vi.fn(async () => true), onSignal: vi.fn() })

    await stack.start()
    let stopped = false
    const stopping = stack.stop().then(() => { stopped = true })

    expect(killed).toEqual(['vite', 'gateway'])
    await Promise.resolve()
    expect(stopped).toBe(false)
    resolveViteExit(0)
    await Promise.resolve()
    expect(stopped).toBe(false)
    resolveGatewayExit(0)
    await stopping
    expect(stopped).toBe(true)
  })

  it('uses cmd.exe without shell mode for npm commands on Windows', () => {
    const child = { once: vi.fn() }
    const spawnChild = vi.fn(() => child)
    const spawn = createProcessSpawner({
      spawnChild,
      platform: 'win32',
      commandShell: 'cmd.exe',
    })

    spawn('npm', ['run', 'build:gateway'])

    expect(spawnChild).toHaveBeenCalledWith(
      'cmd.exe',
      ['/d', '/s', '/c', 'npm.cmd', 'run', 'build:gateway'],
      { shell: false, stdio: 'inherit' },
    )
  })

  it('uses taskkill to terminate only an owned Windows process tree', async () => {
    const taskkill = { once: vi.fn((event, handler) => {
      if (event === 'exit') handler(0)
    }) }
    const spawnChild = vi.fn(() => taskkill)
    const killTree = createWindowsTreeKiller({ spawnChild })

    await killTree(4242)

    expect(spawnChild).toHaveBeenCalledWith(
      'taskkill.exe',
      ['/PID', '4242', '/T', '/F'],
      { shell: false, stdio: 'ignore' },
    )
  })

  it('waits for each owned Windows tree kill before exit settlement', async () => {
    const killed: number[] = []
    let resolveViteKill: () => void
    let resolveGatewayKill: () => void
    const viteKill = new Promise<void>((resolve) => { resolveViteKill = resolve })
    const gatewayKill = new Promise<void>((resolve) => { resolveGatewayKill = resolve })
    const killTree = vi.fn((pid: number) => {
      killed.push(pid)
      return pid === 102 ? viteKill : gatewayKill
    })
    const spawn = vi.fn()
      .mockReturnValueOnce({ kill: vi.fn(), exited: Promise.resolve(0) })
      .mockReturnValueOnce({ pid: 101, kill: vi.fn(), exited: Promise.resolve(0) })
      .mockReturnValueOnce({ pid: 102, kill: vi.fn(), exited: Promise.resolve(0) })
    const stack = createDevStack({
      spawn,
      probe: vi.fn(async () => true),
      onSignal: vi.fn(),
      platform: 'win32',
      killTree,
    })

    await stack.start()
    let stopped = false
    const stopping = stack.stop().then(() => { stopped = true })

    expect(killed).toEqual([102])
    await Promise.resolve()
    expect(stopped).toBe(false)
    resolveViteKill()
    await Promise.resolve()
    expect(killed).toEqual([102, 101])
    expect(stopped).toBe(false)
    resolveGatewayKill()
    await stopping
    expect(stopped).toBe(true)
  })
})
