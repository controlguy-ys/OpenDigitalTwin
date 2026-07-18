import { describe, expect, it, vi } from 'vitest'

import type { StateBatchV1 } from '../../src/core/runtime-protocol/v1.js'
import {
  createStateBatchHubV1,
  splitStateBatchesV1,
  type GatewayWebSocketV1,
} from './state-batch-hub.js'

function mappedValue(index: number, coherenceGroupId: string | null = null) {
  return {
    mappingId: `mapping-${index}`,
    coherenceGroupId,
    value: index,
    unit: 'metre',
    quality: 'GOOD' as const,
    statusCode: 'Good',
  }
}

function batch(
  sequence: number,
  overrides: Partial<StateBatchV1> = {},
): StateBatchV1 {
  return {
    type: 'state-batch-v1',
    protocolVersion: 1,
    gatewayId: 'gateway-test',
    projectId: 'project-test',
    configRevision: 'a'.repeat(64),
    endpointId: 'endpoint-test',
    sequence,
    sourceTimestampMs: sequence,
    publishedTimestampMs: sequence,
    originId: 'gateway-test',
    values: [mappedValue(sequence)],
    ...overrides,
  }
}

class ControlledSocket implements GatewayWebSocketV1 {
  readonly sent: string[] = []
  readonly close = vi.fn()
  private readonly listeners = new Map<'close' | 'error', Set<() => void>>()
  private callbacks: Array<(error?: Error) => void> = []

  send(data: string, callback: (error?: Error) => void): void {
    this.sent.push(data)
    this.callbacks.push(callback)
  }

  on(event: 'close' | 'error', listener: () => void): void {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  off(event: 'close' | 'error', listener: () => void): void {
    this.listeners.get(event)?.delete(listener)
  }

  complete(error?: Error): void {
    const callback = this.callbacks.shift()
    if (callback === undefined) throw new Error('No send is pending.')
    callback(error)
  }

  emit(event: 'close' | 'error'): void {
    for (const listener of this.listeners.get(event) ?? []) listener()
  }

  sentSequences(): number[] {
    return this.sent.map((payload) => JSON.parse(payload).sequence as number)
  }
}

describe('StateBatchHubV1', () => {
  it('keeps one in-flight Batch and replaces its single pending Batch with the newest', () => {
    const hub = createStateBatchHubV1()
    const socket = new ControlledSocket()
    hub.activateRevision('project-test', 'a'.repeat(64))
    hub.attach(socket)

    hub.publish(batch(1))
    hub.publish(batch(2))
    hub.publish(batch(3))

    expect(socket.sentSequences()).toEqual([1])
    expect(hub.queueDepth(socket)).toBe(2)
    socket.complete()
    expect(socket.sentSequences()).toEqual([1, 3])
    expect(hub.queueDepth(socket)).toBe(1)
    socket.complete()
    expect(hub.queueDepth(socket)).toBe(0)
  })

  it('drops inactive revisions and clears pending state on revision activation', () => {
    const hub = createStateBatchHubV1()
    const socket = new ControlledSocket()
    hub.activateRevision('project-test', 'a'.repeat(64))
    hub.attach(socket)
    hub.publish(batch(1))
    hub.publish(batch(2))

    hub.activateRevision('project-next', 'b'.repeat(64))
    hub.publish(batch(3))
    socket.complete()

    expect(socket.sentSequences()).toEqual([1])
    expect(hub.queueDepth(socket)).toBe(0)
  })

  it('detaches a failed or closed socket without retaining pending payloads', () => {
    const hub = createStateBatchHubV1()
    const failed = new ControlledSocket()
    const closed = new ControlledSocket()
    hub.activateRevision('project-test', 'a'.repeat(64))
    hub.attach(failed)
    const detach = hub.attach(closed)
    hub.publish(batch(1))
    hub.publish(batch(2))

    failed.complete(new Error('slow client disappeared'))
    closed.emit('close')
    detach()

    expect(hub.queueDepth(failed)).toBe(0)
    expect(hub.queueDepth(closed)).toBe(0)
  })

  it('keeps a coherence group intact while splitting at 128 values', () => {
    const values = Array.from({ length: 129 }, (_, index) => (
      mappedValue(index, index >= 127 ? 'last-group' : null)
    ))

    const split = splitStateBatchesV1(batch(1, { values }))

    expect(split.map(({ values: chunk }) => chunk.length)).toEqual([127, 2])
    expect(split.flatMap(({ values: chunk }) => chunk.map(({ mappingId }) => mappingId)))
      .toEqual(values.map(({ mappingId }) => mappingId))
  })

  it('rejects one coherence group whose encoded envelope exceeds 256 KiB', () => {
    const huge = 'x'.repeat(256 * 1024)
    expect(() => splitStateBatchesV1(batch(1, {
      values: [{
        ...mappedValue(0, 'oversized'),
        value: huge,
      }],
    }))).toThrow(/RUNTIME_STATE_BATCH_SIZE_EXCEEDED/)
  })

  it('stays bounded across a sustained blocked publication burst', () => {
    const hub = createStateBatchHubV1()
    const socket = new ControlledSocket()
    hub.activateRevision('project-test', 'a'.repeat(64))
    hub.attach(socket)

    for (let sequence = 1; sequence <= 10_000; sequence += 1) {
      hub.publish(batch(sequence))
    }

    expect(socket.sentSequences()).toEqual([1])
    expect(hub.queueDepth(socket)).toBe(2)
    socket.complete()
    expect(socket.sentSequences()).toEqual([1, 10_000])
  })
})
