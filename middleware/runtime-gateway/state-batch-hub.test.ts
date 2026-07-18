import { describe, expect, it, vi } from 'vitest'

import {
  MAX_RUNTIME_BATCH_BYTES_V1,
  type StateBatchV1,
} from '../../src/core/runtime-protocol/v1.js'
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

function batchAtExactEncodedSize(sequence: number, byteLength: number): StateBatchV1 {
  const source = batch(sequence, {
    values: [{ ...mappedValue(1), value: '' }, mappedValue(2)],
  })
  const padding = byteLength - new TextEncoder().encode(JSON.stringify(source)).byteLength
  if (padding < 0) throw new Error('Requested batch size is below its fixed envelope.')
  return {
    ...source,
    values: [{ ...source.values[0]!, value: 'x'.repeat(padding) }, source.values[1]!],
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

  sentBatches(): StateBatchV1[] {
    return this.sent.map((payload) => JSON.parse(payload) as StateBatchV1)
  }
}

describe('StateBatchHubV1', () => {
  it('keeps one in-flight Batch and replaces its single pending Batch with the newest', () => {
    const hub = createStateBatchHubV1()
    const socket = new ControlledSocket()
    hub.activateRevision('project-test', 'a'.repeat(64))
    hub.attach(socket)

    const latest = (sequence: number) => batch(sequence, {
      values: [{ ...mappedValue(sequence), mappingId: 'mapping-live' }],
    })
    hub.publish(latest(1))
    hub.publish(latest(2))
    hub.publish(latest(3))

    expect(socket.sentSequences()).toEqual([1])
    expect(hub.queueDepth(socket)).toBe(2)
    socket.complete()
    expect(socket.sentSequences()).toEqual([1, 2])
    expect(socket.sentBatches()[1]?.values[0]?.value).toBe(3)
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

  it.each([
    [128, [128]],
    [129, [128, 1]],
  ])('splits exactly %i source values into %j bounded chunks', (count, expectedChunkSizes) => {
    const values = Array.from({ length: count }, (_, index) => mappedValue(index))

    expect(splitStateBatchesV1(batch(1, { values })).map(({ values: chunk }) => chunk.length))
      .toEqual(expectedChunkSizes)
  })

  it('rejects duplicate mapping IDs across source chunks before splitting', () => {
    const values = Array.from({ length: 129 }, (_, index) => mappedValue(index))
    values[128] = { ...values[128]!, mappingId: values[0]!.mappingId }

    expect(() => splitStateBatchesV1(batch(1, { values })))
      .toThrow(/RUNTIME_STATE_MAPPING_DUPLICATE/)
  })

  it('sends every split chunk as one logical transmission with unique hub-owned wire sequences', () => {
    const hub = createStateBatchHubV1()
    const socket = new ControlledSocket()
    hub.activateRevision('project-test', 'a'.repeat(64))
    hub.attach(socket)

    hub.publish(batch(41, { values: Array.from({ length: 129 }, (_, index) => mappedValue(index)) }))

    expect(socket.sentSequences()).toEqual([1])
    // queueDepth is measured in logical transmissions, not individual wire chunks.
    expect(hub.queueDepth(socket)).toBe(1)
    hub.publish(batch(42))
    expect(hub.queueDepth(socket)).toBe(2)
    socket.complete()
    expect(socket.sentSequences()).toEqual([1, 2])
    expect(hub.queueDepth(socket)).toBe(2)
    socket.complete()
    expect(socket.sentSequences()).toEqual([1, 2, 3])
    expect(new Set(socket.sentSequences()).size).toBe(3)
    expect(hub.queueDepth(socket)).toBe(1)
    socket.complete()
    expect(hub.queueDepth(socket)).toBe(0)
  })

  it('resplits an exact-size source batch when its assigned wire sequence expands the envelope', () => {
    const hub = createStateBatchHubV1()
    const socket = new ControlledSocket()
    hub.activateRevision('project-test', 'a'.repeat(64))
    hub.attach(socket)

    // One source update uses ten 128-value chunks, leaving the endpoint at wire sequence 10.
    hub.publish(batch(1, { values: Array.from({ length: 1_280 }, (_, index) => mappedValue(index)) }))
    hub.publish(batchAtExactEncodedSize(2, MAX_RUNTIME_BATCH_BYTES_V1))

    for (let index = 0; index < 10; index += 1) socket.complete()
    socket.complete()

    const finalPayloads = socket.sent.slice(10)
    expect(finalPayloads).toHaveLength(2)
    expect(finalPayloads.every((payload) => (
      new TextEncoder().encode(payload).byteLength <= MAX_RUNTIME_BATCH_BYTES_V1
    ))).toBe(true)
    expect(new Set(socket.sentSequences()).size).toBe(socket.sent.length)
  })

  it('bounds split serialization work to one value encoding per source mapping', () => {
    const stringify = vi.spyOn(JSON, 'stringify')
    try {
      splitStateBatchesV1(batch(1, {
        values: Array.from({ length: 128 }, (_, index) => mappedValue(index)),
      }))
      // 128 mapped values, one empty-envelope measurement, and one validated final chunk.
      expect(stringify.mock.calls.length).toBeLessThanOrEqual(130)
    } finally {
      stringify.mockRestore()
    }
  })

  it('rejects delayed source sequence 2 after accepted sequence 3 so it cannot replace pending state', () => {
    const hub = createStateBatchHubV1()
    const socket = new ControlledSocket()
    hub.activateRevision('project-test', 'a'.repeat(64))
    hub.attach(socket)

    hub.publish(batch(1))
    hub.publish(batch(3))
    hub.publish(batch(2))
    socket.complete()

    expect(socket.sentBatches()).toHaveLength(2)
    expect(socket.sentBatches()[1]?.values[0]?.mappingId).toBe('mapping-3')
  })

  it('resets source ordering and endpoint wire sequences while clearing pending work on revision activation', () => {
    const hub = createStateBatchHubV1()
    const socket = new ControlledSocket()
    hub.activateRevision('project-test', 'a'.repeat(64))
    hub.attach(socket)
    hub.publish(batch(5))
    hub.publish(batch(6))

    hub.activateRevision('project-next', 'b'.repeat(64))
    hub.publish(batch(1, {
      projectId: 'project-next',
      configRevision: 'b'.repeat(64),
      values: [mappedValue(99)],
    }))
    socket.complete()

    expect(socket.sentSequences()).toEqual([1, 1])
    expect(socket.sentBatches()[1]?.values[0]?.mappingId).toBe('mapping-99')
    expect(hub.queueDepth(socket)).toBe(1)
    socket.complete()
    expect(hub.queueDepth(socket)).toBe(0)
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
      hub.publish(batch(sequence, {
        values: [{ ...mappedValue(sequence), mappingId: 'mapping-sustained' }],
      }))
    }

    expect(socket.sentSequences()).toEqual([1])
    expect(hub.queueDepth(socket)).toBe(2)
    socket.complete()
    expect(socket.sentSequences()).toEqual([1, 2])
    expect(socket.sentBatches()[1]?.values[0]?.value).toBe(10_000)
  })

  it('replays the newest active-endpoint State snapshot when a browser attaches after subscription publication', () => {
    const hub = createStateBatchHubV1()
    const socket = new ControlledSocket()
    hub.activateRevision('project-test', 'a'.repeat(64))
    hub.publish(batch(1, { values: [{ ...mappedValue(1), mappingId: 'mapping-current' }] }))
    hub.publish(batch(2, { values: [{ ...mappedValue(2), mappingId: 'mapping-current' }] }))

    hub.attach(socket)

    expect(socket.sentBatches()).toEqual([
      expect.objectContaining({
        endpointId: 'endpoint-test',
        values: [expect.objectContaining({ mappingId: 'mapping-current', value: 2 })],
      }),
    ])
    expect(socket.sentSequences()).toEqual([1])
  })

  it('replays a reconnect snapshot with a fresh monotonic wire sequence', () => {
    const hub = createStateBatchHubV1()
    const first = new ControlledSocket()
    const reconnected = new ControlledSocket()
    hub.activateRevision('project-test', 'a'.repeat(64))
    hub.publish(batch(1, { values: [{ ...mappedValue(1), mappingId: 'mapping-current' }] }))
    hub.attach(first)
    first.complete()
    first.emit('close')
    hub.publish(batch(2, { values: [{ ...mappedValue(2), mappingId: 'mapping-current' }] }))

    hub.attach(reconnected)

    expect(reconnected.sentBatches()[0]).toMatchObject({
      sequence: 2,
      values: [expect.objectContaining({ mappingId: 'mapping-current', value: 2 })],
    })
  })

  it('replays independent latest Pose and Status channels after status-only traffic', () => {
    const hub = createStateBatchHubV1()
    const socket = new ControlledSocket()
    hub.activateRevision('project-test', 'a'.repeat(64))
    hub.publish(batch(1, {
      values: [{ ...mappedValue(1, 'box-pose'), mappingId: 'box-pose', value: 'pose-1' }],
    }))
    hub.publish(batch(2, {
      values: [{ ...mappedValue(2), mappingId: 'box-status', value: 'status-2' }],
    }))

    hub.attach(socket)
    socket.complete()

    expect(socket.sentBatches().flatMap(({ values }) => values.map(({ mappingId, value }) => ({ mappingId, value }))))
      .toEqual(expect.arrayContaining([
        { mappingId: 'box-pose', value: 'pose-1' },
        { mappingId: 'box-status', value: 'status-2' },
      ]))
  })

  it('keeps independent latest Pose and Status channels under socket backpressure', () => {
    const hub = createStateBatchHubV1()
    const socket = new ControlledSocket()
    hub.activateRevision('project-test', 'a'.repeat(64))
    hub.attach(socket)
    hub.publish(batch(1, {
      values: [{ ...mappedValue(1, 'box-pose'), mappingId: 'box-pose', value: 'pose-1' }],
    }))
    hub.publish(batch(2, {
      values: [{ ...mappedValue(2), mappingId: 'box-status', value: 'status-2' }],
    }))
    hub.publish(batch(3, {
      values: [{ ...mappedValue(3, 'box-pose'), mappingId: 'box-pose', value: 'pose-3' }],
    }))

    socket.complete()
    socket.complete()
    socket.complete()

    expect(socket.sentBatches().flatMap(({ values }) => values.map(({ mappingId, value }) => ({ mappingId, value }))))
      .toEqual(expect.arrayContaining([
        { mappingId: 'box-pose', value: 'pose-1' },
        { mappingId: 'box-pose', value: 'pose-3' },
        { mappingId: 'box-status', value: 'status-2' },
      ]))
  })

  it('fences cached snapshots at revision activation so an attaching browser never receives a stale revision', () => {
    const hub = createStateBatchHubV1()
    const socket = new ControlledSocket()
    hub.activateRevision('project-test', 'a'.repeat(64))
    hub.publish(batch(1))
    hub.activateRevision('project-next', 'b'.repeat(64))

    hub.attach(socket)
    expect(socket.sent).toEqual([])

    hub.publish(batch(1, {
      projectId: 'project-next',
      configRevision: 'b'.repeat(64),
      endpointId: 'endpoint-next',
    }))
    expect(socket.sentBatches()[0]).toMatchObject({
      projectId: 'project-next',
      configRevision: 'b'.repeat(64),
      endpointId: 'endpoint-next',
    })
  })

  it('accepts a fresh adapter source sequence while keeping browser wire sequences monotonic across same-revision recovery', () => {
    const hub = createStateBatchHubV1()
    const socket = new ControlledSocket()
    hub.activateRevision('project-test', 'a'.repeat(64))
    hub.attach(socket)
    hub.publish(batch(1))
    socket.complete()

    hub.activateRevision('project-test', 'a'.repeat(64))
    hub.publish(batch(1, { values: [mappedValue(20)] }))

    expect(socket.sentSequences()).toEqual([1, 2])
    expect(socket.sentBatches()[1]).toMatchObject({
      sequence: 2,
      values: [expect.objectContaining({ mappingId: 'mapping-20' })],
    })
  })

  it('replays each endpoint latest snapshot in deterministic order under bounded socket backpressure', () => {
    const hub = createStateBatchHubV1()
    const socket = new ControlledSocket()
    hub.activateRevision('project-test', 'a'.repeat(64))
    hub.publish(batch(1, { endpointId: 'endpoint-z', values: [mappedValue(10)] }))
    hub.publish(batch(2, { endpointId: 'endpoint-a', values: [mappedValue(20)] }))

    hub.attach(socket)
    expect(socket.sentBatches()).toHaveLength(1)
    expect(socket.sentBatches()[0]).toMatchObject({ endpointId: 'endpoint-a' })
    expect(hub.queueDepth(socket)).toBe(2)
    socket.complete()
    expect(socket.sentBatches()).toHaveLength(2)
    expect(socket.sentBatches()[1]).toMatchObject({ endpointId: 'endpoint-z' })
    expect(socket.sent.every((payload) => (
      new TextEncoder().encode(payload).byteLength <= MAX_RUNTIME_BATCH_BYTES_V1
    ))).toBe(true)
  })
})
