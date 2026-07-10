import { describe, expect, it } from 'vitest'
import { createEventStore } from '../../state/event-store'
import { createInteractionStore } from './interaction-store'
import {
  handleCollisionEnter,
  handleCollisionExit,
} from './collision-events'

describe('collision event transitions', () => {
  it('activates one pair, appends one event, and pauses playback once', () => {
    const interactionStore = createInteractionStore()
    const eventStore = createEventStore()
    let playing = true
    let pauseCount = 0
    const dependencies = {
      interactionStore,
      eventStore,
      pausePlayback: () => {
        playing = false
        pauseCount += 1
      },
      now: () => 1234,
    }

    expect(
      handleCollisionEnter(
        'robot-link:LINK04',
        'equipment:cup-01',
        dependencies,
      ),
    ).toBe(true)
    expect(
      handleCollisionEnter(
        'equipment:cup-01',
        'robot-link:LINK04',
        dependencies,
      ),
    ).toBe(false)

    expect(playing).toBe(false)
    expect(pauseCount).toBe(1)
    expect(interactionStore.getState().activeCollisionPairs).toHaveLength(1)
    expect(eventStore.getState().events).toEqual([
      expect.objectContaining({
        type: 'collision',
        timestampMs: 1234,
        pairKey: 'equipment:cup-01|robot-link:LINK04',
      }),
    ])
  })

  it('removes the active outline on exit while retaining event history', () => {
    const interactionStore = createInteractionStore()
    const eventStore = createEventStore()
    const dependencies = {
      interactionStore,
      eventStore,
      pausePlayback: () => undefined,
      now: () => 10,
    }
    handleCollisionEnter(
      'robot-link:LINK04',
      'equipment:cup-01',
      dependencies,
    )

    expect(
      handleCollisionExit(
        'equipment:cup-01',
        'robot-link:LINK04',
        dependencies,
      ),
    ).toBe(true)
    expect(interactionStore.getState().activeCollisionPairs).toEqual([])
    expect(eventStore.getState().events).toHaveLength(1)
  })

  it('ignores excluded pairs without pausing or creating an event', () => {
    const interactionStore = createInteractionStore()
    const eventStore = createEventStore()
    let playing = true
    const dependencies = {
      interactionStore,
      eventStore,
      pausePlayback: () => {
        playing = false
      },
      now: () => 10,
    }

    expect(
      handleCollisionEnter(
        'robot-link:LINK02',
        'robot-link:LINK03',
        dependencies,
      ),
    ).toBe(false)
    expect(playing).toBe(true)
    expect(eventStore.getState().events).toEqual([])
  })
})
