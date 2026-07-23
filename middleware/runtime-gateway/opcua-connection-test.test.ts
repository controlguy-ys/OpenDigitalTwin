import { describe, expect, it, vi } from 'vitest'

import { testOpcUaConnectionV1 } from './opcua-connection-test.js'

const endpoint = Object.freeze({
  endpointId: 'controller', name: 'Controller', endpointUrl: 'opc.tcp://localhost:4840',
  enabled: true, publishingIntervalMs: 100, reconnectDelayMs: 1_000,
})

describe('testOpcUaConnectionV1', () => {
  it('uses one temporary anonymous connection and always closes Session then Client', async () => {
    const close = vi.fn(async () => undefined)
    const disconnect = vi.fn(async () => undefined)
    const createSession = vi.fn(async () => ({ close, readNamespaceArray: vi.fn(async () => ['http://opcfoundation.org/UA/', 'urn:controller']) }))
    const connect = vi.fn(async () => undefined)
    const createClient = vi.fn(() => ({ connect, createSession, disconnect }))

    await expect(testOpcUaConnectionV1(endpoint, { createClient })).resolves.toEqual({
      type: 'opcua-test-connection-result-v1', protocolVersion: 1, outcome: 'succeeded',
      namespaces: ['http://opcfoundation.org/UA/', 'urn:controller'],
    })
    expect(createClient).toHaveBeenCalledOnce()
    expect(connect).toHaveBeenCalledWith(endpoint.endpointUrl)
    expect(createSession).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('does not report success when temporary Session cleanup fails', async () => {
    const createClient = vi.fn(() => ({
      connect: vi.fn(async () => undefined),
      createSession: vi.fn(async () => ({
        readNamespaceArray: vi.fn(async () => ['urn:controller']),
        close: vi.fn(async () => { throw new Error('close failed') }),
      })),
      disconnect: vi.fn(async () => undefined),
    }))

    await expect(testOpcUaConnectionV1(endpoint, { createClient })).resolves.toMatchObject({
      outcome: 'failed', code: 'OPC_UA_CONNECTION_CLEANUP_FAILED',
    })
  })

  it.each([
    ['connect', { connect: async () => { throw new Error('connect') } }, 'OPC_UA_CONNECT_FAILED'],
    ['session', { createSession: async () => { throw new Error('session') } }, 'OPC_UA_SESSION_FAILED'],
    ['read', { createSession: async () => ({ close: async () => undefined, readNamespaceArray: async () => { throw new Error('read') } }) }, 'OPC_UA_NAMESPACE_READ_FAILED'],
  ])('returns a stable %s failure code', async (_phase, override, code) => {
    const client = { connect: async () => undefined, createSession: async () => ({ close: async () => undefined, readNamespaceArray: async () => ['urn:a'] }), disconnect: async () => undefined, ...override }
    await expect(testOpcUaConnectionV1(endpoint, { createClient: () => client })).resolves.toMatchObject({ outcome: 'failed', code })
  })

  it('waits for the Session-close cleanup budget before disconnecting the Client', async () => {
    vi.useFakeTimers()
    const close = vi.fn(() => new Promise<void>(() => undefined))
    const disconnect = vi.fn(async () => undefined)
    const pending = testOpcUaConnectionV1(endpoint, { timeoutMs: 10, cleanupTimeoutMs: 20, createClient: () => ({ connect: async () => undefined, createSession: async () => ({ close, readNamespaceArray: async () => ['urn:a'] }), disconnect }) })
    await vi.advanceTimersByTimeAsync(10)
    expect(close).toHaveBeenCalledOnce(); expect(disconnect).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(20)
    await expect(pending).resolves.toMatchObject({ outcome: 'failed', code: 'OPC_UA_CONNECTION_CLEANUP_FAILED' })
    expect(disconnect).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('attempts disconnect when close throws synchronously', async () => {
    const disconnect = vi.fn(async () => undefined)
    await expect(testOpcUaConnectionV1(endpoint, { createClient: () => ({ connect: async () => undefined, createSession: async () => ({ close: () => { throw new Error('close') }, readNamespaceArray: async () => ['urn:a'] }), disconnect }) })).resolves.toMatchObject({ code: 'OPC_UA_CONNECTION_CLEANUP_FAILED' })
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('owns namespace-read timeout cleanup exactly once', async () => {
    vi.useFakeTimers()
    const close = vi.fn(async () => undefined); const disconnect = vi.fn(async () => undefined)
    const pending = testOpcUaConnectionV1(endpoint, { timeoutMs: 10, createClient: () => ({
      connect: async () => undefined,
      createSession: async () => ({ close, readNamespaceArray: () => new Promise<readonly string[]>(() => undefined) }),
      disconnect,
    }) })
    await vi.advanceTimersByTimeAsync(10)
    await expect(pending).resolves.toMatchObject({ outcome: 'failed', code: 'OPC_UA_CONNECTION_TIMEOUT' })
    await vi.runAllTimersAsync()
    expect(close).toHaveBeenCalledOnce(); expect(disconnect).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('cleans a Client that connects after the operation timeout', async () => {
    vi.useFakeTimers(); let resolveConnect!: () => void; const disconnect = vi.fn(async () => undefined)
    const pending = testOpcUaConnectionV1(endpoint, { timeoutMs: 10, createClient: () => ({ connect: () => new Promise<void>((resolve) => { resolveConnect = resolve }), createSession: vi.fn(), disconnect }) })
    await vi.advanceTimersByTimeAsync(10); await pending; expect(disconnect).toHaveBeenCalledOnce()
    resolveConnect(); await vi.runAllTimersAsync(); expect(disconnect).toHaveBeenCalledTimes(2); vi.useRealTimers()
  })

  it('closes a Session that arrives after timeout before disconnecting again', async () => {
    vi.useFakeTimers(); let resolveSession!: (session: { close: () => Promise<void>; readNamespaceArray: () => Promise<readonly string[]> }) => void
    const order: string[] = []; const close = vi.fn(async () => { order.push('close') }); const disconnect = vi.fn(async () => { order.push('disconnect') })
    const pending = testOpcUaConnectionV1(endpoint, { timeoutMs: 10, createClient: () => ({ connect: async () => undefined, createSession: () => new Promise((resolve) => { resolveSession = resolve }), disconnect }) })
    await vi.advanceTimersByTimeAsync(10); await pending; order.length = 0
    resolveSession({ close, readNamespaceArray: async () => ['urn:a'] }); await vi.runAllTimersAsync()
    expect(order).toEqual(['close', 'disconnect']); vi.useRealTimers()
  })
})
