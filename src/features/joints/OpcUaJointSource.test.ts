import { describe, expect, it, vi } from 'vitest'
import { OpcUaJointSource, type BrowserWebSocket } from './OpcUaJointSource'

class FakeSocket implements BrowserWebSocket {
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  close = vi.fn()
}

describe('OpcUaJointSource', () => {
  it('publishes validated middleware joint frames', async () => {
    const socket = new FakeSocket()
    const source = new OpcUaJointSource('ws://localhost:4841', () => socket)
    const listener = vi.fn()
    const equipmentListener = vi.fn()
    source.subscribe(listener)
    source.subscribeEquipment(equipmentListener)

    const connected = source.connect()
    socket.onopen?.()
    await connected
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'joint-frame',
        anglesDeg: [1, 2, 3, 4, 5, 6],
        timestampMs: 123,
        quality: 'GOOD',
      }),
    } as MessageEvent<string>)

    expect(source.mode).toBe('opcua')
    expect(listener).toHaveBeenCalledWith({
      anglesDeg: [1, 2, 3, 4, 5, 6],
      timestampMs: 123,
      quality: 'GOOD',
    })
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'equipment-status',
        values: { 'machine-01': 42, ignored: null },
        timestampMs: 124,
      }),
    } as MessageEvent<string>)
    expect(equipmentListener).toHaveBeenCalledWith({ 'machine-01': 42 }, 124)
  })

  it('reports BAD quality for malformed gateway data without changing angles', async () => {
    const socket = new FakeSocket()
    const source = new OpcUaJointSource('ws://localhost:4841', () => socket)
    const listener = vi.fn()
    source.subscribe(listener)
    const connected = source.connect()
    socket.onopen?.()
    await connected

    socket.onmessage?.({ data: '{"type":"joint-frame","anglesDeg":[1]}' } as MessageEvent<string>)

    expect(listener).toHaveBeenLastCalledWith({
      anglesDeg: [0, 0, 0, 0, 0, 0],
      timestampMs: expect.any(Number),
      quality: 'BAD',
    })
    await source.disconnect()
    expect(socket.close).toHaveBeenCalled()
  })
})
