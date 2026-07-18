import { describe, expect, it, vi } from 'vitest'

import {
  createRuntimeGatewayStreamV4,
  runtimeGatewayWebSocketUrlV4,
  type BrowserWebSocketV4,
} from './runtime-gateway-stream-v4.js'

class FakeSocketV4 implements BrowserWebSocketV4 {
  readyState = 0
  readonly close = vi.fn(() => { this.readyState = 3 })
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>()

  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  emit(type: 'open' | 'message' | 'close' | 'error', event: unknown = {}): void {
    if (type === 'open') this.readyState = 1
    if (type === 'close') this.readyState = 3
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

describe('Runtime Gateway browser stream V4', () => {
  it('resolves same-origin ws and wss URLs deterministically', () => {
    expect(runtimeGatewayWebSocketUrlV4({ protocol: 'http:', host: '127.0.0.1:5173' }))
      .toBe('ws://127.0.0.1:5173/runtime/ws')
    expect(runtimeGatewayWebSocketUrlV4({ protocol: 'https:', host: 'cell.local' }))
      .toBe('wss://cell.local/runtime/ws')
  })

  it('ingests parsed messages with the browser receipt clock and ignores malformed payloads', () => {
    const socket = new FakeSocketV4()
    const ingest = vi.fn(() => true)
    const stream = createRuntimeGatewayStreamV4({
      createWebSocket: vi.fn(() => socket),
      ingest,
      nowMs: () => 5_000,
      url: 'ws://test/runtime/ws',
    })
    stream.start()
    socket.emit('open')
    socket.emit('message', { data: JSON.stringify({ type: 'state-batch-v1' }) })
    socket.emit('message', { data: '{broken' })
    socket.emit('message', { data: new Uint8Array([1, 2, 3]) })

    expect(ingest).toHaveBeenCalledTimes(1)
    expect(ingest).toHaveBeenCalledWith({ type: 'state-batch-v1' }, 5_000)
    expect(stream.status()).toEqual({ phase: 'open', reconnectScheduled: false })
  })

  it('keeps one reconnect timer and cancels it on stop', () => {
    vi.useFakeTimers()
    try {
      const sockets: FakeSocketV4[] = []
      const createWebSocket = vi.fn(() => {
        const socket = new FakeSocketV4()
        sockets.push(socket)
        return socket
      })
      const stream = createRuntimeGatewayStreamV4({
        createWebSocket,
        ingest: vi.fn(() => true),
        reconnectDelayMs: 250,
        url: 'ws://test/runtime/ws',
      })

      stream.start()
      sockets[0]!.emit('close')
      sockets[0]!.emit('error')
      expect(stream.status()).toEqual({ phase: 'reconnecting', reconnectScheduled: true })
      vi.advanceTimersByTime(249)
      expect(createWebSocket).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(1)
      expect(createWebSocket).toHaveBeenCalledTimes(2)

      sockets[1]!.emit('close')
      stream.stop()
      vi.advanceTimersByTime(1_000)
      expect(createWebSocket).toHaveBeenCalledTimes(2)
      expect(sockets[1]!.close).not.toHaveBeenCalled()
      expect(stream.status()).toEqual({ phase: 'stopped', reconnectScheduled: false })
    } finally {
      vi.useRealTimers()
    }
  })

  it('notifies the state controller once for each newly opened gateway session', () => {
    vi.useFakeTimers()
    try {
      const sockets: FakeSocketV4[] = []
      const onSessionStart = vi.fn()
      const stream = createRuntimeGatewayStreamV4({
        createWebSocket: () => {
          const socket = new FakeSocketV4()
          sockets.push(socket)
          return socket
        },
        ingest: vi.fn(() => true),
        onSessionStart,
        reconnectDelayMs: 250,
        url: 'ws://test/runtime/ws',
      })
      stream.start()
      sockets[0]!.emit('open')
      sockets[0]!.emit('open')
      sockets[0]!.emit('close')
      vi.advanceTimersByTime(250)
      sockets[1]!.emit('open')

      // The callback must run only once per actual socket session, not once
      // per duplicate browser open event.
      expect(onSessionStart).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('is idempotent across repeated start and stop calls', () => {
    const socket = new FakeSocketV4()
    const createWebSocket = vi.fn(() => socket)
    const stream = createRuntimeGatewayStreamV4({
      createWebSocket,
      ingest: vi.fn(() => true),
      url: 'ws://test/runtime/ws',
    })

    stream.start()
    stream.start()
    expect(createWebSocket).toHaveBeenCalledTimes(1)
    stream.stop()
    stream.stop()
    expect(socket.close).toHaveBeenCalledTimes(1)
  })
})
