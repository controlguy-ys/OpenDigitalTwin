import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const validateStreamMessageSpy = vi.hoisted(() => vi.fn())

vi.mock('../../../core/runtime-protocol/v1.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/runtime-protocol/v1.js')>()
  validateStreamMessageSpy.mockImplementation(actual.validateRuntimeStreamMessageV1)
  return { ...actual, validateRuntimeStreamMessageV1: validateStreamMessageSpy }
})

import {
  MAX_RUNTIME_BATCH_BYTES_V1,
  type EndpointCatchupBoundaryV1,
  type EndpointLifecycleV1,
  type EndpointReplayBoundaryV1,
  type StateBatchV1,
} from '../../../core/runtime-protocol/v1.js'
import {
  createRuntimeGatewayStateStreamV5,
  runtimeGatewayWebSocketUrlV5,
  type BrowserWebSocketV5,
  type EndpointCatchupGuardV5,
  type RuntimeGatewayStateConsumerV5,
  type RuntimeGatewayStateStreamOptionsV5,
  type RuntimeGatewayStreamTargetV5,
} from './runtime-gateway-state-stream.js'

const REVISION_A = 'a'.repeat(64)
const REVISION_B = 'b'.repeat(64)
const BASE = { gatewayId: 'gateway', projectId: 'project', configRevision: REVISION_A }
const utf8 = (text: string): number => new TextEncoder().encode(text).byteLength
const json = (value: unknown): string => JSON.stringify(value)

class FakeSocket implements BrowserWebSocketV5 {
  readyState = 0
  closeHook: (() => void) | null = null
  readonly close = vi.fn(() => { this.readyState = 3; this.closeHook?.() })
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>()

  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void): void {
    const bucket = this.listeners.get(type) ?? new Set()
    bucket.add(listener)
    this.listeners.set(type, bucket)
  }

  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  listenerCount(type: 'open' | 'message' | 'close' | 'error'): number { return this.listeners.get(type)?.size ?? 0 }

  emit(type: 'open' | 'message' | 'close' | 'error', event: unknown = {}): void {
    if (type === 'open') this.readyState = 1
    if (type === 'close') this.readyState = 3
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  raw(text: unknown): void { this.emit('message', { data: text }) }
  frame(value: unknown): void { this.raw(json(value)) }
}

function state(sequence: number, endpointId = 'endpoint', value: boolean | string = true, context = BASE): StateBatchV1 {
  return {
    ...context, type: 'state-batch-v1', protocolVersion: 1, endpointId, sequence,
    sourceTimestampMs: 100, publishedTimestampMs: 110, originId: 'publisher',
    values: [{ mappingId: 'mapping', coherenceGroupId: null, value, unit: '', quality: 'GOOD', statusCode: 'Good' }],
  }
}

function lifecycle(
  sequence: number,
  phase: 'connected' | 'disconnected',
  endpointId = 'endpoint',
  publisherGeneration = 1,
  sessionGeneration = 1,
  overrides: Partial<EndpointLifecycleV1> = {},
): EndpointLifecycleV1 {
  return {
    ...BASE, type: 'endpoint-lifecycle-v1', protocolVersion: 1, endpointId, sequence,
    originId: 'publisher', publisherGeneration, sessionGeneration, phase,
    eventId: `lifecycle:${publisherGeneration}:${sessionGeneration}:${phase}`,
    statusCode: phase === 'connected' ? 'Good' : 'BadNoCommunication', occurredAtMs: 90,
    ...overrides,
  }
}

function replay(sequence: number, phase: 'start' | 'end', count: number, bytes: number, overrides: Partial<EndpointReplayBoundaryV1> = {}): EndpointReplayBoundaryV1 {
  return { ...BASE, type: 'endpoint-replay-boundary-v1', protocolVersion: 1, endpointId: 'endpoint', sequence, replayId: 'replay:1', messageCount: count, encodedBytes: bytes, phase, ...overrides }
}

function catchup(sequence: number, phase: 'start' | 'end', count: number, bytes: number, overrides: Partial<EndpointCatchupBoundaryV1> = {}): EndpointCatchupBoundaryV1 {
  return { ...BASE, type: 'endpoint-catchup-boundary-v1', protocolVersion: 1, endpointId: 'endpoint', sequence, catchupId: 'catchup:1', messageCount: count, encodedBytes: bytes, phase, ...overrides }
}

interface TestGuard extends EndpointCatchupGuardV5 {
  readonly commit: ReturnType<typeof vi.fn<() => void>>
  readonly abort: ReturnType<typeof vi.fn<() => void>>
}

function guard(overrides: Partial<TestGuard> = {}): TestGuard {
  return { commit: vi.fn<() => void>(), abort: vi.fn<() => void>(), ...overrides }
}

interface TestConsumer extends RuntimeGatewayStateConsumerV5 {
  readonly ingest: ReturnType<typeof vi.fn<(batch: StateBatchV1, receivedTimestampMs: number) => boolean>>
  readonly restoreReplayPrefix: ReturnType<typeof vi.fn<(batch: StateBatchV1, receivedTimestampMs: number) => boolean>>
}

function consumer(overrides: Partial<TestConsumer> = {}): TestConsumer {
  return {
    ingest: vi.fn<(batch: StateBatchV1, receivedTimestampMs: number) => boolean>(() => true),
    restoreReplayPrefix: vi.fn<(batch: StateBatchV1, receivedTimestampMs: number) => boolean>(() => true),
    ...overrides,
  }
}

function target(overrides: Partial<RuntimeGatewayStreamTargetV5> = {}): RuntimeGatewayStreamTargetV5 {
  return {
    ...BASE, stateConsumers: [consumer()], lifecycleConsumers: [vi.fn(() => true)],
    onEndpointCatchupStart: vi.fn(() => guard()), ...overrides,
  }
}

function streamWith(options: Partial<RuntimeGatewayStateStreamOptionsV5> = {}): {
  readonly stream: ReturnType<typeof createRuntimeGatewayStateStreamV5>
  readonly sockets: FakeSocket[]
  readonly active: RuntimeGatewayStreamTargetV5
} {
  const sockets: FakeSocket[] = []
  const active = target()
  const stream = createRuntimeGatewayStateStreamV5({
    url: 'ws://test/runtime/ws', reconnectDelayMs: 50, nowMs: () => 1_000,
    createWebSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket },
    readActiveTarget: () => active, ...options,
  })
  return { stream, sockets, active }
}

function startOpen(rig: ReturnType<typeof streamWith>): FakeSocket {
  rig.stream.start()
  const socket = rig.sockets[0]!
  socket.emit('open')
  return socket
}

function boundaryBytes(messages: readonly unknown[]): number {
  return messages.reduce<number>((sum, value) => sum + utf8(json(value)), 0)
}

beforeEach(() => { validateStreamMessageSpy.mockClear() })
afterEach(() => { vi.useRealTimers() })

describe('V5 Runtime Gateway transport lifecycle', () => {
  it('selects same-origin ws and wss URLs and rejects unsupported locations', () => {
    expect(runtimeGatewayWebSocketUrlV5({ protocol: 'http:', host: '127.0.0.1:5173' })).toBe('ws://127.0.0.1:5173/runtime/ws')
    expect(runtimeGatewayWebSocketUrlV5({ protocol: 'https:', host: 'cell.local' })).toBe('wss://cell.local/runtime/ws')
    expect(() => runtimeGatewayWebSocketUrlV5({ protocol: 'file:', host: 'cell.local' })).toThrow()
  })

  it('opens once, clamps the socket receipt clock, reconnects once after close plus error, and resets on the next socket', () => {
    vi.useFakeTimers()
    const clock = [1_000, 900, 800, 700, 600, 500]
    const starts: number[] = []; const disconnects: number[] = []
    const active = target({ onSessionStart: (at) => starts.push(at), onSessionDisconnect: (at) => disconnects.push(at) })
    const rig = streamWith({ readActiveTarget: () => active, nowMs: () => clock.shift() ?? 500 })
    const first = startOpen(rig); first.emit('open'); first.frame(lifecycle(1, 'connected')); first.emit('close'); first.emit('error')
    expect(starts).toEqual([1_000]); expect(disconnects).toEqual([1_000])
    vi.advanceTimersByTime(50); expect(rig.sockets).toHaveLength(2)
    rig.sockets[1]!.emit('open'); expect(starts).toEqual([1_000, 700])
  })

  it('is idempotent for duplicate start, stop, and repeated refresh while replacement is connecting', () => {
    const rig = streamWith(); rig.stream.start(); rig.stream.start(); expect(rig.sockets).toHaveLength(1)
    rig.stream.refreshActiveTarget(); rig.stream.refreshActiveTarget(); expect(rig.sockets).toHaveLength(2)
    rig.stream.stop(); rig.stream.stop(); expect(rig.sockets[1]!.close).toHaveBeenCalledTimes(1)
  })

  it('detaches and reconnects a connecting socket when active-target capture throws without reporting disconnect', () => {
    vi.useFakeTimers()
    const disconnected = vi.fn(); const rig = streamWith({ readActiveTarget: () => { throw new Error('target') } })
    const socket = startOpen(rig)
    expect(socket.close).toHaveBeenCalledTimes(1); expect(socket.listenerCount('close')).toBe(0); expect(disconnected).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50); expect(rig.sockets).toHaveLength(2)
  })

  it('uses the rejection path for session-start failure and connecting close, and stop cancels either reconnect', () => {
    vi.useFakeTimers()
    const disconnect = vi.fn(); const active = target({ onSessionStart: () => { throw new Error('start') }, onSessionDisconnect: disconnect })
    const opened = streamWith({ readActiveTarget: () => active }); const openedSocket = startOpen(opened)
    expect(openedSocket.close).toHaveBeenCalledTimes(1); expect(disconnect).toHaveBeenCalledTimes(1); opened.stream.stop()
    vi.advanceTimersByTime(100); expect(opened.sockets).toHaveLength(1)

    const connecting = streamWith(); connecting.stream.start(); connecting.sockets[0]!.emit('close'); connecting.stream.stop()
    vi.advanceTimersByTime(100); expect(connecting.sockets).toHaveLength(1)
  })

  it('routes an invalid clock on open, message, close, and error through deterministic candidate failure', () => {
    vi.useFakeTimers()
    for (const failingEvent of ['open', 'message', 'close', 'error'] as const) {
      let calls = 0; const disconnect = vi.fn()
      const active = target({ onSessionDisconnect: disconnect })
      const rig = streamWith({ readActiveTarget: () => active, nowMs: () => (++calls === (failingEvent === 'open' ? 1 : 2) ? Number.NaN : 1_000) })
      rig.stream.start(); const socket = rig.sockets[0]!
      if (failingEvent !== 'open') socket.emit('open')
      expect(() => failingEvent === 'message' ? socket.frame(lifecycle(1, 'connected')) : socket.emit(failingEvent)).not.toThrow()
      expect(socket.close).toHaveBeenCalledTimes(failingEvent === 'close' ? 0 : 1)
      expect(disconnect).toHaveBeenCalledTimes(failingEvent === 'open' ? 0 : 1)
      rig.stream.stop()
    }
  })

  it('fails malformed, binary, and over-limit physical frames while accepting an exact-limit string', () => {
    const make = () => { const disconnect = vi.fn(); const active = target({ onSessionDisconnect: disconnect }); const rig = streamWith({ readActiveTarget: () => active }); return { ...rig, active, disconnect, socket: startOpen(rig) } }
    const malformed = make(); malformed.socket.raw('{broken'); expect(malformed.disconnect).toHaveBeenCalledTimes(1)
    const binary = make(); binary.socket.raw(new Uint8Array([1])); expect(binary.disconnect).toHaveBeenCalledTimes(1)
    const exact = make(); exact.socket.frame(lifecycle(1, 'connected'))
    const base = json(state(2)); exact.socket.raw(base + ' '.repeat(MAX_RUNTIME_BATCH_BYTES_V1 - utf8(base)))
    expect(exact.active.stateConsumers[0]!.ingest).toHaveBeenCalledTimes(1)
    const over = make(); over.socket.raw(' '.repeat(MAX_RUNTIME_BATCH_BYTES_V1 + 1)); expect(over.disconnect).toHaveBeenCalledTimes(1)
  })

  it('validates each physical frame once and shares one frozen object/timestamp across consumers', () => {
    const seen: Array<{ value: StateBatchV1; at: number }> = []
    const consumers = [consumer({ ingest: vi.fn((value, at) => { seen.push({ value, at }); return true }) }), consumer({ ingest: vi.fn((value, at) => { seen.push({ value, at }); return true }) })]
    const active = target({ stateConsumers: consumers }); const socket = startOpen(streamWith({ readActiveTarget: () => active }))
    socket.frame(lifecycle(1, 'connected')); validateStreamMessageSpy.mockClear(); socket.frame(state(2))
    expect(validateStreamMessageSpy).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(2); expect(seen[0]!.value).toBe(seen[1]!.value); expect(Object.isFrozen(seen[0]!.value)).toBe(true); expect(seen.map((entry) => entry.at)).toEqual([1_000, 1_000])
  })

  it('isolates throwing state, lifecycle, and session-disconnect consumers', () => {
    const laterState = consumer(); const laterLife = vi.fn(() => true); const disconnect = vi.fn()
    const active = target({ stateConsumers: [consumer({ ingest: vi.fn(() => { throw new Error('state') }) }), laterState], lifecycleConsumers: [vi.fn(() => { throw new Error('life') }), laterLife], onSessionDisconnect: () => { disconnect(); throw new Error('disconnect') } })
    const socket = startOpen(streamWith({ readActiveTarget: () => active })); socket.frame(lifecycle(1, 'connected')); socket.frame(state(2)); socket.emit('close')
    expect(laterLife).toHaveBeenCalledTimes(1); expect(laterState.ingest).toHaveBeenCalledTimes(1); expect(disconnect).toHaveBeenCalledTimes(1)
  })
})

describe('V5 Runtime Gateway context, wire, and lifecycle fences', () => {
  it('uses one common strictly increasing sequence fence across all four wire kinds and resets it on reopen', () => {
    vi.useFakeTimers(); const disconnect = vi.fn(); const active = target({ onSessionDisconnect: disconnect }); const rig = streamWith({ readActiveTarget: () => active })
    let socket = startOpen(rig); socket.frame(replay(1, 'start', 1, utf8(json(lifecycle(2, 'connected'))))); socket.frame(lifecycle(2, 'connected')); socket.frame(replay(3, 'end', 1, utf8(json(lifecycle(2, 'connected')))))
    socket.frame(catchup(4, 'start', 1, utf8(json(state(5))))); socket.frame(state(5)); socket.frame(catchup(6, 'end', 1, utf8(json(state(5))))); socket.frame(state(6))
    expect(disconnect).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(50); socket = rig.sockets[1]!; socket.emit('open'); socket.frame(lifecycle(1, 'connected')); expect(active.lifecycleConsumers[0]).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed deterministic event IDs, stale tuples, equal conflicts, invalid transitions, and State while unknown or disconnected', () => {
    const cases: unknown[][] = [
      [lifecycle(1, 'connected', 'endpoint', 1, 1, { eventId: 'wrong' })],
      [lifecycle(1, 'connected', 'endpoint', 2), lifecycle(2, 'connected', 'endpoint', 1)],
      [lifecycle(1, 'connected'), lifecycle(2, 'connected', 'endpoint', 1, 1, { originId: 'other' })],
      [lifecycle(1, 'disconnected')],
      [state(1)],
      [lifecycle(1, 'connected'), lifecycle(2, 'disconnected'), state(3)],
    ]
    for (const messages of cases) {
      const disconnect = vi.fn(); const active = target({ onSessionDisconnect: disconnect }); const socket = startOpen(streamWith({ readActiveTarget: () => active }))
      messages.forEach((message) => socket.frame(message)); expect(disconnect).toHaveBeenCalledTimes(1)
    }
  })

  it('accepts exact lifecycle duplicates as counted no-ops but rejects same-tuple semantic conflicts', () => {
    const disconnect = vi.fn(); const active = target({ onSessionDisconnect: disconnect }); const socket = startOpen(streamWith({ readActiveTarget: () => active }))
    socket.frame(lifecycle(1, 'connected')); socket.frame(lifecycle(2, 'connected'))
    expect(active.lifecycleConsumers[0]).toHaveBeenCalledTimes(1); expect(disconnect).not.toHaveBeenCalled()
    socket.frame(lifecycle(3, 'connected', 'endpoint', 1, 1, { occurredAtMs: 91 }))
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('rejects a ninth Endpoint and clears the eight-Endpoint capacity on socket reopen', () => {
    vi.useFakeTimers(); const disconnect = vi.fn(); const active = target({ onSessionDisconnect: disconnect }); const rig = streamWith({ readActiveTarget: () => active }); let socket = startOpen(rig)
    for (let index = 1; index <= 8; index += 1) socket.frame(lifecycle(index, 'connected', `e${index}`))
    socket.frame(lifecycle(9, 'connected', 'e9')); expect(disconnect).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(50); socket = rig.sockets[1]!; socket.emit('open'); socket.frame(lifecycle(1, 'connected', 'e9')); expect(active.lifecycleConsumers[0]).toHaveBeenCalledTimes(9)
  })

  it('reads the active target once before ordinary frames and twice for a boundary end drain', () => {
    const active = target(); const read = vi.fn(() => active); const rig = streamWith({ readActiveTarget: read }); const socket = startOpen(rig)
    expect(read).toHaveBeenCalledTimes(1); socket.frame(lifecycle(1, 'connected')); expect(read).toHaveBeenCalledTimes(2)
    const body = state(3); const bytes = utf8(json(body)); socket.frame(catchup(2, 'start', 1, bytes)); expect(read).toHaveBeenCalledTimes(3)
    socket.frame(body); expect(read).toHaveBeenCalledTimes(4); socket.frame(catchup(4, 'end', 1, bytes)); expect(read).toHaveBeenCalledTimes(6)
  })

  it('makes context and target mismatch non-consumable synchronously without advancing old or new consumers', () => {
    const oldDisconnect = vi.fn(); const oldTarget = target({ onSessionDisconnect: oldDisconnect }); const newTarget = target({ configRevision: REVISION_B }); let active = oldTarget
    const socket = startOpen(streamWith({ readActiveTarget: () => active })); socket.frame(lifecycle(1, 'connected')); active = newTarget
    socket.frame(state(2, 'endpoint', true, { ...BASE, configRevision: REVISION_B }))
    expect(oldDisconnect).toHaveBeenCalledTimes(1); expect(oldTarget.stateConsumers[0]!.ingest).not.toHaveBeenCalled(); expect(newTarget.stateConsumers[0]!.ingest).not.toHaveBeenCalled()
  })
})

describe('V5 Runtime Gateway replay boundaries', () => {
  it('accepts exact physical byte totals, prefix State, one connected, current State, optional disconnect, and exact duplicates', () => {
    const active = target(); const socket = startOpen(streamWith({ readActiveTarget: () => active }))
    const messages = [state(2), lifecycle(3, 'connected'), lifecycle(4, 'connected'), state(5), lifecycle(6, 'disconnected')]
    const texts = messages.map((message, index) => json(message) + (index === 0 ? '  ' : ''))
    const bytes = texts.reduce((sum, text) => sum + utf8(text), 0)
    socket.frame(replay(1, 'start', messages.length, bytes)); texts.forEach((text) => socket.raw(text)); socket.frame(replay(7, 'end', messages.length, bytes))
    expect(active.stateConsumers[0]!.restoreReplayPrefix).toHaveBeenCalledTimes(1); expect(active.stateConsumers[0]!.ingest).toHaveBeenCalledTimes(1)
    expect(active.lifecycleConsumers[0]).toHaveBeenCalledTimes(2)
  })

  it('rejects wrong count, bytes, end identity, missing connected, nesting, cross-kind, cross-endpoint, and over-budget declarations', () => {
    const invalidRuns: Array<(socket: FakeSocket) => void> = [
      (socket) => { const body = lifecycle(2, 'connected'); socket.frame(replay(1, 'start', 2, utf8(json(body)))); socket.frame(body); socket.frame(replay(3, 'end', 2, utf8(json(body)))) },
      (socket) => { const body = lifecycle(2, 'connected'); socket.frame(replay(1, 'start', 1, utf8(json(body)) + 1)); socket.frame(body); socket.frame(replay(3, 'end', 1, utf8(json(body)) + 1)) },
      (socket) => { const body = lifecycle(2, 'connected'); const bytes = utf8(json(body)); socket.frame(replay(1, 'start', 1, bytes)); socket.frame(body); socket.frame(replay(3, 'end', 1, bytes, { replayId: 'replay:2' })) },
      (socket) => { const body = state(2); const bytes = utf8(json(body)); socket.frame(replay(1, 'start', 1, bytes)); socket.frame(body); socket.frame(replay(3, 'end', 1, bytes)) },
      (socket) => { socket.frame(replay(1, 'start', 1, 1)); socket.frame(replay(2, 'start', 1, 1)) },
      (socket) => { socket.frame(replay(1, 'start', 1, 1)); socket.frame(catchup(2, 'end', 1, 1)) },
      (socket) => { socket.frame(replay(1, 'start', 1, 1)); socket.frame(state(2, 'other')) },
      (socket) => { socket.frame(replay(1, 'start', 1, (8 * MAX_RUNTIME_BATCH_BYTES_V1) + 1)) },
    ]
    for (const run of invalidRuns) { const disconnect = vi.fn(); const active = target({ onSessionDisconnect: disconnect }); const socket = startOpen(streamWith({ readActiveTarget: () => active })); run(socket); expect(disconnect).toHaveBeenCalledTimes(1) }
  })

  it('explicitly rejects zero count, zero bytes, end without start, a second nonduplicate connected, and State after disconnect', () => {
    const invalidRuns: Array<(socket: FakeSocket) => void> = [
      (socket) => socket.frame(replay(1, 'start', 0, 1)),
      (socket) => socket.frame(replay(1, 'start', 1, 0)),
      (socket) => socket.frame(replay(1, 'end', 1, 1)),
      (socket) => {
        const body = [lifecycle(2, 'connected'), lifecycle(3, 'connected', 'endpoint', 2)]
        socket.frame(replay(1, 'start', body.length, boundaryBytes(body))); body.forEach((message) => socket.frame(message))
      },
      (socket) => {
        const body = [lifecycle(2, 'connected'), lifecycle(3, 'disconnected'), state(4)]
        socket.frame(replay(1, 'start', body.length, boundaryBytes(body))); body.forEach((message) => socket.frame(message))
      },
    ]
    for (const run of invalidRuns) {
      const disconnect = vi.fn(); const active = target({ onSessionDisconnect: disconnect }); const socket = startOpen(streamWith({ readActiveTarget: () => active }))
      run(socket); expect(disconnect).toHaveBeenCalledTimes(1)
    }
  })

  it('discards partial replay on close, error, stop, and refresh without delivering it', () => {
    for (const action of ['close', 'error', 'stop', 'refresh'] as const) {
      const active = target(); const rig = streamWith({ readActiveTarget: () => active }); const socket = startOpen(rig)
      const body = lifecycle(2, 'connected'); socket.frame(replay(1, 'start', 1, utf8(json(body)))); socket.frame(body)
      if (action === 'stop') rig.stream.stop(); else if (action === 'refresh') rig.stream.refreshActiveTarget(); else socket.emit(action)
      expect(active.lifecycleConsumers[0]).not.toHaveBeenCalled()
    }
  })

  it('allows replay only as an unseen Endpoint first frame and resets eligibility on socket reopen', () => {
    vi.useFakeTimers(); const disconnect = vi.fn(); const active = target({ onSessionDisconnect: disconnect }); const rig = streamWith({ readActiveTarget: () => active }); let socket = startOpen(rig)
    socket.frame(lifecycle(1, 'connected')); socket.frame(replay(2, 'start', 1, 1)); expect(disconnect).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(50); socket = rig.sockets[1]!; socket.emit('open'); const body = lifecycle(2, 'connected'); const bytes = utf8(json(body)); socket.frame(replay(1, 'start', 1, bytes)); socket.frame(body); socket.frame(replay(3, 'end', 1, bytes)); expect(active.lifecycleConsumers[0]).toHaveBeenCalledTimes(2)
    socket.frame(replay(4, 'start', 1, bytes)); expect(disconnect).toHaveBeenCalledTimes(2)
  })

  it('permanently consumes replay eligibility when catch-up is the Endpoint first frame', () => {
    const disconnect = vi.fn(); const active = target({ onSessionDisconnect: disconnect }); const socket = startOpen(streamWith({ readActiveTarget: () => active }))
    const body = lifecycle(2, 'connected'); const bytes = utf8(json(body)); socket.frame(catchup(1, 'start', 1, bytes)); socket.frame(body); socket.frame(catchup(3, 'end', 1, bytes))
    socket.frame(replay(4, 'start', 1, bytes)); expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('clamps replay prefix/current timestamps exactly like live and catch-up delivery', () => {
    const times = [1_000, 900, 800, 700, 600, 500]; const active = target(); const socket = startOpen(streamWith({ readActiveTarget: () => active, nowMs: () => times.shift() ?? 500 }))
    const body = [state(2), lifecycle(3, 'connected'), state(4)]; const bytes = boundaryBytes(body)
    socket.frame(replay(1, 'start', body.length, bytes)); body.forEach((message) => socket.frame(message)); socket.frame(replay(5, 'end', body.length, bytes))
    expect(active.stateConsumers[0]!.restoreReplayPrefix).toHaveBeenCalledWith(expect.anything(), 1_000); expect(active.stateConsumers[0]!.ingest).toHaveBeenCalledWith(expect.anything(), 1_000)
  })
})

describe('V5 Runtime Gateway catch-up boundaries and atomic drains', () => {
  it('owns a provisional catch-up boundary while the guard-start callback emits its body', () => {
    const retained = guard(); let socket!: FakeSocket; let deliveredDuringStart = -1
    const lifecycleConsumer = vi.fn(() => true)
    const active = target({ lifecycleConsumers: [lifecycleConsumer], onEndpointCatchupStart: () => {
      socket.frame(lifecycle(2, 'connected'))
      deliveredDuringStart = lifecycleConsumer.mock.calls.length
      return retained
    } })
    const rig = streamWith({ readActiveTarget: () => active }); socket = startOpen(rig)
    const body = lifecycle(2, 'connected'); const bytes = utf8(json(body)); socket.frame(catchup(1, 'start', 1, bytes)); expect(deliveredDuringStart).toBe(0)
    socket.frame(catchup(3, 'end', 1, bytes)); expect(lifecycleConsumer).toHaveBeenCalledTimes(1); expect(retained.commit).toHaveBeenCalledTimes(1); expect(retained.abort).not.toHaveBeenCalled()
  })

  it('aborts exactly the returned guard when its start callback stops the stream', () => {
    const retained = guard(); let stream!: ReturnType<typeof createRuntimeGatewayStateStreamV5>
    const active = target({ onEndpointCatchupStart: () => { stream.stop(); return retained } }); const rig = streamWith({ readActiveTarget: () => active }); stream = rig.stream; const socket = startOpen(rig)
    socket.frame(catchup(1, 'start', 1, 1)); expect(retained.abort).toHaveBeenCalledTimes(1); expect(retained.commit).not.toHaveBeenCalled(); expect(socket.close).toHaveBeenCalledTimes(1)
  })

  it('aborts exactly the returned guard when its start callback refreshes and leaves no stale boundary', () => {
    const retained = guard(); const disconnect = vi.fn(); let stream!: ReturnType<typeof createRuntimeGatewayStateStreamV5>; let refresh = true
    const active = target({ onSessionDisconnect: disconnect, onEndpointCatchupStart: () => { if (refresh) { refresh = false; stream.refreshActiveTarget() }; return retained } })
    const rig = streamWith({ readActiveTarget: () => active }); stream = rig.stream; const first = startOpen(rig); first.frame(catchup(1, 'start', 1, 1))
    expect(retained.abort).toHaveBeenCalledTimes(1); expect(retained.commit).not.toHaveBeenCalled(); expect(disconnect).not.toHaveBeenCalled(); expect(rig.sockets).toHaveLength(2)
    const replacement = rig.sockets[1]!; replacement.emit('open'); replacement.frame(lifecycle(1, 'connected')); expect(active.lifecycleConsumers[0]).toHaveBeenCalledTimes(1)
  })

  it('accepts State-only, duplicate-only, sparse, lifecycle-complete, and two sorted Endpoint catch-ups', () => {
    const begin = vi.fn<(endpointId: string, atMs: number) => EndpointCatchupGuardV5>(() => guard()); const active = target({ onEndpointCatchupStart: begin }); const socket = startOpen(streamWith({ readActiveTarget: () => active }))
    socket.frame(lifecycle(1, 'connected', 'a'))
    const a = state(3, 'a'); socket.frame(catchup(2, 'start', 1, utf8(json(a)), { endpointId: 'a', catchupId: 'catchup:1' })); socket.frame(a); socket.frame(catchup(4, 'end', 1, utf8(json(a)), { endpointId: 'a', catchupId: 'catchup:1' }))
    socket.frame(lifecycle(1, 'connected', 'b')); const duplicate = lifecycle(3, 'connected', 'b'); socket.frame(catchup(2, 'start', 1, utf8(json(duplicate)), { endpointId: 'b', catchupId: 'catchup:2' })); socket.frame(duplicate); socket.frame(catchup(4, 'end', 1, utf8(json(duplicate)), { endpointId: 'b', catchupId: 'catchup:2' }))
    expect(begin.mock.calls.map((call) => call[0])).toEqual(['a', 'b']); expect(active.stateConsumers[0]!.ingest).toHaveBeenCalledTimes(1); expect(active.lifecycleConsumers[0]).toHaveBeenCalledTimes(2)
  })

  it('enforces disconnected -> no State -> strictly newer connected inside catch-up', () => {
    const disconnect = vi.fn(); const active = target({ onSessionDisconnect: disconnect }); const socket = startOpen(streamWith({ readActiveTarget: () => active }))
    socket.frame(lifecycle(1, 'connected')); socket.frame(lifecycle(2, 'disconnected'))
    let body = state(4); socket.frame(catchup(3, 'start', 1, utf8(json(body)))); socket.frame(body); expect(disconnect).toHaveBeenCalledTimes(1)

    const accepted = target(); const acceptedSocket = startOpen(streamWith({ readActiveTarget: () => accepted })); acceptedSocket.frame(lifecycle(1, 'connected')); acceptedSocket.frame(lifecycle(2, 'disconnected'))
    const acceptedBody = [lifecycle(4, 'connected', 'endpoint', 2), state(5)]; const acceptedBytes = boundaryBytes(acceptedBody)
    acceptedSocket.frame(catchup(3, 'start', acceptedBody.length, acceptedBytes)); acceptedBody.forEach((message) => acceptedSocket.frame(message)); acceptedSocket.frame(catchup(6, 'end', acceptedBody.length, acceptedBytes))
    expect(accepted.stateConsumers[0]!.ingest).toHaveBeenCalledTimes(1)
  })

  it('keeps the guard and boundary active through drain so reentrant live input runs only after commit', () => {
    const order: string[] = []; const retained = guard({ commit: vi.fn(() => { order.push('commit') }) }); let socket!: FakeSocket
    const first = consumer({ ingest: vi.fn((batch) => { order.push(`body:${batch.sequence}`); if (batch.sequence === 3) socket.frame(state(6)); return true }) })
    const active = target({ stateConsumers: [first], onEndpointCatchupStart: () => retained }); const rig = streamWith({ readActiveTarget: () => active }); socket = startOpen(rig)
    socket.frame(lifecycle(1, 'connected')); const body = [state(3), state(4)]; const bytes = boundaryBytes(body)
    socket.frame(catchup(2, 'start', 2, bytes)); body.forEach((message) => socket.frame(message)); socket.frame(catchup(5, 'end', 2, bytes))
    expect(order).toEqual(['body:3', 'body:4', 'commit', 'body:6'])
  })

  it('validates and captures the target for a reentrant physical frame before its emit returns', () => {
    const order: string[] = []; const retained = guard({ commit: vi.fn(() => { order.push('commit') }) }); let socket!: FakeSocket; let active!: RuntimeGatewayStreamTargetV5; let validationDeltaAtReturn = -1
    const next = target(); const read = vi.fn(() => active)
    const first = consumer({ ingest: vi.fn((batch) => {
      order.push(`body:${batch.sequence}`)
      if (batch.sequence === 3) {
        const callsBefore = validateStreamMessageSpy.mock.calls.length
        socket.frame(state(6))
        validationDeltaAtReturn = validateStreamMessageSpy.mock.calls.length - callsBefore
        active = next
      }
      return true
    }) })
    const old = target({ stateConsumers: [first], onEndpointCatchupStart: () => retained }); active = old
    const rig = streamWith({ readActiveTarget: read }); socket = startOpen(rig); socket.frame(lifecycle(1, 'connected'))
    const body = [state(3), state(4)]; const bytes = boundaryBytes(body); socket.frame(catchup(2, 'start', body.length, bytes)); body.forEach((message) => socket.frame(message)); socket.frame(catchup(5, 'end', body.length, bytes))
    expect(validationDeltaAtReturn).toBe(1); expect(order).toEqual(['body:3', 'body:4', 'commit', 'body:6']); expect(next.stateConsumers[0]!.ingest).not.toHaveBeenCalled()
  })

  it('uses ordinary lifecycle semantics during drain without precommitting final disconnected state', () => {
    const order: string[] = []; let socket!: FakeSocket
    const life = vi.fn((event: EndpointLifecycleV1) => { order.push(event.phase); if (event.phase === 'connected') socket.frame(state(6)); return true })
    const active = target({ lifecycleConsumers: [life], stateConsumers: [consumer({ ingest: vi.fn((batch) => { order.push(`state:${batch.sequence}`); return true }) })], onSessionDisconnect: () => { order.push('disconnect') } })
    const rig = streamWith({ readActiveTarget: () => active }); socket = startOpen(rig)
    const body = [lifecycle(2, 'connected'), state(3), lifecycle(4, 'disconnected')]; const bytes = boundaryBytes(body)
    socket.frame(catchup(1, 'start', body.length, bytes)); body.forEach((message) => socket.frame(message)); socket.frame(catchup(5, 'end', body.length, bytes))
    expect(order).toEqual(['connected', 'state:3', 'disconnected', 'disconnect'])
  })

  it('reports the offending queued frame timestamp when its post-disconnect State fails', () => {
    const disconnectTimes: number[] = []; let socket!: FakeSocket
    const times = [100, 200, 300, 400, 500, 600, 700]
    const active = target({ lifecycleConsumers: [vi.fn((event: EndpointLifecycleV1) => { if (event.phase === 'disconnected') socket.frame(state(6)); return true })], onSessionDisconnect: (at) => { disconnectTimes.push(at) } })
    const rig = streamWith({ readActiveTarget: () => active, nowMs: () => times.shift() ?? 700 }); socket = startOpen(rig)
    socket.frame(lifecycle(1, 'connected')); const body = [state(3), lifecycle(4, 'disconnected')]; const bytes = boundaryBytes(body)
    socket.frame(catchup(2, 'start', body.length, bytes)); body.forEach((message) => socket.frame(message)); socket.frame(catchup(5, 'end', body.length, bytes))
    expect(disconnectTimes).toEqual([700])
  })

  it('aborts once and never commits when refresh or stop occurs during synchronous drain', () => {
    for (const action of ['refresh', 'stop'] as const) {
      const retained = guard(); let stream!: ReturnType<typeof createRuntimeGatewayStateStreamV5>
      const first = consumer({ ingest: vi.fn(() => { if (action === 'refresh') stream.refreshActiveTarget(); else stream.stop(); return true }) })
      const active = target({ stateConsumers: [first], onEndpointCatchupStart: () => retained }); const rig = streamWith({ readActiveTarget: () => active }); stream = rig.stream; const socket = startOpen(rig)
      socket.frame(lifecycle(1, 'connected')); const body = state(3); const bytes = utf8(json(body)); socket.frame(catchup(2, 'start', 1, bytes)); socket.frame(body); socket.frame(catchup(4, 'end', 1, bytes))
      expect(retained.abort).toHaveBeenCalledTimes(1); expect(retained.commit).not.toHaveBeenCalled()
    }
  })

  it('aborts a guard exactly once when commit throws', () => {
    const retained = guard({ commit: vi.fn(() => { throw new Error('commit') }) }); const disconnect = vi.fn(); const active = target({ onEndpointCatchupStart: () => retained, onSessionDisconnect: disconnect }); const socket = startOpen(streamWith({ readActiveTarget: () => active }))
    socket.frame(lifecycle(1, 'connected')); const body = state(3); const bytes = utf8(json(body)); socket.frame(catchup(2, 'start', 1, bytes)); socket.frame(body); socket.frame(catchup(4, 'end', 1, bytes))
    expect(retained.abort).toHaveBeenCalledTimes(1); expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('aborts once for callback failure, invalid body, missing end close/error, refresh, and stop', () => {
    const actions = ['invalid', 'close', 'error', 'refresh', 'stop'] as const
    for (const action of actions) {
      const retained = guard(); const disconnect = vi.fn(); const active = target({ onEndpointCatchupStart: () => retained, onSessionDisconnect: disconnect }); const rig = streamWith({ readActiveTarget: () => active }); const socket = startOpen(rig)
      socket.frame(lifecycle(1, 'connected')); const body = state(3); socket.frame(catchup(2, 'start', 1, utf8(json(body))))
      if (action === 'invalid') socket.frame(state(3, 'other')); else if (action === 'refresh') rig.stream.refreshActiveTarget(); else if (action === 'stop') rig.stream.stop(); else socket.emit(action)
      expect(retained.abort).toHaveBeenCalledTimes(1); expect(retained.commit).not.toHaveBeenCalled()
    }
    const active = target({ onEndpointCatchupStart: () => { throw new Error('begin') }, onSessionDisconnect: vi.fn() }); const socket = startOpen(streamWith({ readActiveTarget: () => active })); socket.frame(catchup(1, 'start', 1, 1)); expect(active.onSessionDisconnect).toHaveBeenCalledTimes(1)
  })

  it('rejects catch-up nesting, cross-kind end, mismatched totals, physical-byte mismatch, and over-budget declaration', () => {
    const invalidRuns: Array<(socket: FakeSocket) => void> = [
      (socket) => { socket.frame(catchup(1, 'start', 1, 1)); socket.frame(catchup(2, 'start', 1, 1)) },
      (socket) => { socket.frame(catchup(1, 'start', 1, 1)); socket.frame(replay(2, 'end', 1, 1)) },
      (socket) => { const body = lifecycle(2, 'connected'); const bytes = utf8(json(body)); socket.frame(catchup(1, 'start', 1, bytes)); socket.frame(body); socket.frame(catchup(3, 'end', 2, bytes)) },
      (socket) => { const body = lifecycle(2, 'connected'); const text = `${json(body)} `; socket.frame(catchup(1, 'start', 1, utf8(json(body)))); socket.raw(text) },
      (socket) => { socket.frame(catchup(1, 'start', 1, (8 * MAX_RUNTIME_BATCH_BYTES_V1) + 1)) },
    ]
    for (const run of invalidRuns) { const disconnect = vi.fn(); const active = target({ onSessionDisconnect: disconnect }); const socket = startOpen(streamWith({ readActiveTarget: () => active })); run(socket); expect(disconnect).toHaveBeenCalledTimes(1) }
  })

  it('aborts before drain when the active target changes at the end-frame identity recheck', () => {
    const retained = guard(); const oldDisconnect = vi.fn(); const old = target({ onEndpointCatchupStart: () => retained, onSessionDisconnect: oldDisconnect }); const next = target(); let swapOnSecondEndRead = false; let endReads = 0
    const read = () => swapOnSecondEndRead && ++endReads === 2 ? next : old
    const socket = startOpen(streamWith({ readActiveTarget: read })); socket.frame(lifecycle(1, 'connected')); const body = state(3); const bytes = utf8(json(body)); socket.frame(catchup(2, 'start', 1, bytes)); socket.frame(body); swapOnSecondEndRead = true; socket.frame(catchup(4, 'end', 1, bytes))
    expect(retained.abort).toHaveBeenCalledTimes(1); expect(retained.commit).not.toHaveBeenCalled(); expect(oldDisconnect).toHaveBeenCalledTimes(1); expect(next.stateConsumers[0]!.ingest).not.toHaveBeenCalled()
  })

  it('keeps every Job tick non-GOOD until connected -> GOOD -> disconnected catch-up commits', () => {
    let quarantined = false; let visible = 'STALE'; const ticks: string[] = []
    const retained = guard({ commit: vi.fn(() => { quarantined = false }), abort: vi.fn(() => { quarantined = false }) })
    const active = target({ onEndpointCatchupStart: () => { quarantined = true; return retained }, stateConsumers: [consumer({ ingest: vi.fn(() => { visible = 'GOOD'; return true }) })], lifecycleConsumers: [vi.fn((event: EndpointLifecycleV1) => { visible = event.phase === 'connected' ? 'BAD' : 'STALE'; return true })] })
    const socket = startOpen(streamWith({ readActiveTarget: () => active })); const physical = (value: unknown) => { socket.frame(value); ticks.push(quarantined ? 'QUARANTINED' : visible) }
    const body = [lifecycle(2, 'connected'), state(3), lifecycle(4, 'disconnected')]; const bytes = boundaryBytes(body)
    physical(catchup(1, 'start', body.length, bytes)); body.forEach(physical); expect(ticks).toEqual(['QUARANTINED', 'QUARANTINED', 'QUARANTINED', 'QUARANTINED'])
    physical(catchup(5, 'end', body.length, bytes)); expect(ticks.at(-1)).toBe('STALE')
  })

  it('uses the same clamped receipt timestamp for live, catch-up, and fresh replay parity', () => {
    const stamps: number[] = []; const values = consumer({ ingest: vi.fn((_batch, at) => { stamps.push(at); return true }), restoreReplayPrefix: vi.fn((_batch, at) => { stamps.push(at); return true }) }); const times = [1_000, 900, 800, 700, 600, 500, 400, 300, 200]
    const active = target({ stateConsumers: [values] }); const socket = startOpen(streamWith({ readActiveTarget: () => active, nowMs: () => times.shift() ?? 100 }))
    socket.frame(lifecycle(1, 'connected')); socket.frame(state(2)); const body = state(4); const bytes = utf8(json(body)); socket.frame(catchup(3, 'start', 1, bytes)); socket.frame(body); socket.frame(catchup(5, 'end', 1, bytes))
    expect(stamps).toEqual([1_000, 1_000])
  })
})

describe('V5 Runtime Gateway handoff and static isolation', () => {
  it('refresh detaches before close, aborts once, emits no disconnect, ignores delayed events, and captures only the new target', () => {
    const retained = guard(); const oldDisconnect = vi.fn(); const oldStart = vi.fn(); const nextStart = vi.fn(); const old = target({ onEndpointCatchupStart: () => retained, onSessionStart: oldStart, onSessionDisconnect: oldDisconnect }); const next = target({ onSessionStart: nextStart }); let active = old
    const rig = streamWith({ readActiveTarget: () => active }); const first = startOpen(rig); first.frame(lifecycle(1, 'connected')); const body = state(3); first.frame(catchup(2, 'start', 1, utf8(json(body))))
    first.closeHook = () => { expect(first.listenerCount('close')).toBe(0); first.frame(body) }; active = next; rig.stream.refreshActiveTarget()
    expect(retained.abort).toHaveBeenCalledTimes(1); expect(oldDisconnect).not.toHaveBeenCalled(); expect(rig.sockets).toHaveLength(2)
    first.emit('close'); first.emit('error'); rig.sockets[1]!.emit('open'); expect(oldStart).toHaveBeenCalledTimes(1); expect(nextStart).toHaveBeenCalledTimes(1)
  })

  it('rejects early different-Revision replay without consumption and accepts the first higher-sequence replay after atomic commit', () => {
    vi.useFakeTimers(); const oldDisconnect = vi.fn(); const old = target({ onSessionDisconnect: oldDisconnect }); const next = target({ configRevision: REVISION_B }); let active = old
    const rig = streamWith({ readActiveTarget: () => active }); let socket = startOpen(rig); const early = lifecycle(102, 'connected', 'endpoint', 1, 1, { configRevision: REVISION_B }); const bytes = utf8(json(early))
    socket.frame(replay(101, 'start', 1, bytes, { configRevision: REVISION_B })); expect(oldDisconnect).toHaveBeenCalledTimes(1); expect(old.lifecycleConsumers[0]).not.toHaveBeenCalled()
    active = next; vi.advanceTimersByTime(50); socket = rig.sockets[1]!; socket.emit('open'); socket.frame(replay(101, 'start', 1, bytes, { configRevision: REVISION_B })); socket.frame(early); socket.frame(replay(103, 'end', 1, bytes, { configRevision: REVISION_B })); expect(next.lifecycleConsumers[0]).toHaveBeenCalledTimes(1)
  })

  it('has no forbidden V4, project-v4, middleware, node-opcua, Node builtin, process, or Buffer dependency', async () => {
    const source = (await import('./runtime-gateway-state-stream.ts?raw')).default
    const specifiers = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire(?:\.resolve)?\s*\(\s*)['"]([^'"]+)['"]/gu)].map((match) => match[1]!)
    const nodeBuiltins = new Set(['assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'sqlite', 'stream', 'string_decoder', 'sys', 'test', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib'])
    expect(specifiers.filter((specifier) => /(?:project(?:-v4|\/v4)|runtime[^'"]*(?:\/v4|stream-v4)|(?:^|\/)v4(?:\/|$)|middleware|node-opcua)/ui.test(specifier))).toEqual([])
    expect(specifiers.filter((specifier) => { const bare = specifier.replace(/^node:/u, '').split('/')[0]!; return specifier.startsWith('node:') || nodeBuiltins.has(bare) })).toEqual([])
    expect(source).not.toMatch(/\b(?:process|Buffer)\b/u)
  })
})
