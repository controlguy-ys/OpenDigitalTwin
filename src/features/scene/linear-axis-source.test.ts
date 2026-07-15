import { describe, expect, it, vi } from 'vitest'
import { ManualLinearAxisSource } from './linear-axis-source'

describe('ManualLinearAxisSource', () => {
  it('replays the coherent committed frame to a new renderer subscriber', () => {
    const source = new ManualLinearAxisSource({
      initialPositionM: 0.5,
      homePositionM: 0.25,
      commitPositionM: vi.fn(async () => undefined),
      now: () => 1000,
    })
    const listener = vi.fn()

    source.subscribe(listener)

    expect(listener).toHaveBeenCalledWith({
      positionM: 0.5,
      timestampMs: 1000,
      quality: 'GOOD',
    })
  })

  it('publishes a GOOD frame only after the durable Manual position command succeeds', async () => {
    const commitPositionM = vi.fn(async () => undefined)
    const source = new ManualLinearAxisSource({
      initialPositionM: 0.5,
      homePositionM: 0.25,
      commitPositionM,
      now: () => 1234,
    })
    const listener = vi.fn()
    source.subscribe(listener)

    await source.setPositionM(0.75)

    expect(commitPositionM).toHaveBeenCalledWith(0.75)
    expect(listener).toHaveBeenLastCalledWith({
      positionM: 0.75,
      timestampMs: 1234,
      quality: 'GOOD',
    })
  })

  it('moves Home through the same durable command and retains the last frame on rejection', async () => {
    const commitPositionM = vi.fn(async (positionM: number) => {
      if (positionM === 0.9) throw new Error('LINEAR_AXIS_OUT_OF_RANGE')
    })
    const source = new ManualLinearAxisSource({
      initialPositionM: 0.5,
      homePositionM: 0.25,
      commitPositionM,
      now: () => 4567,
    })
    const listener = vi.fn()
    source.subscribe(listener)
    listener.mockClear()

    await expect(source.setPositionM(0.9)).rejects.toThrow('LINEAR_AXIS_OUT_OF_RANGE')
    expect(listener).not.toHaveBeenCalled()

    await source.home()
    expect(commitPositionM).toHaveBeenLastCalledWith(0.25)
    expect(listener).toHaveBeenCalledWith({
      positionM: 0.25,
      timestampMs: 4567,
      quality: 'GOOD',
    })
  })

  it('isolates subscriber failures after a committed command and continues ordered delivery', async () => {
    const subscriberError = new Error('subscriber failed')
    const onSubscriberError = vi.fn()
    const source = new ManualLinearAxisSource({
      initialPositionM: 0.5,
      homePositionM: 0.25,
      commitPositionM: vi.fn(async () => undefined),
      now: () => 9000,
      onSubscriberError,
    })
    const first = vi.fn(() => {
      throw subscriberError
    })
    const second = vi.fn()
    source.subscribe(first)
    source.subscribe(second)
    first.mockClear()
    second.mockClear()
    onSubscriberError.mockClear()

    await expect(source.setPositionM(0.75)).resolves.toBeUndefined()

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledWith({
      positionM: 0.75,
      timestampMs: 9000,
      quality: 'GOOD',
    })
    expect(onSubscriberError).toHaveBeenCalledWith(subscriberError)
  })
})
