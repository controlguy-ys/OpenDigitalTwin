import { afterEach, describe, expect, it } from 'vitest'
import type { Pose3D } from '../../domain/frames/pose3d'
import { createCoordinateFrameStore } from './coordinate-frame-store'

afterEach(() => {
  localStorage.clear()
})

describe('fixed coordinate frame store', () => {
  it('persists MCP and TCP independently and owns caller tuples', () => {
    const store = createCoordinateFrameStore(localStorage)
    const mcp: Pose3D = {
      position: [0.1, -0.05, 0.02],
      quaternion: [0, 0, 0, 1],
    }
    store.getState().setFramePose('mcp', mcp)
    store.getState().setFramePose('tcp', {
      position: [0, 0, 0.15],
      quaternion: [0, 0, 0, 1],
    })

    const reopened = createCoordinateFrameStore(localStorage)
    expect(reopened.getState().frames.mcp.position).toEqual([0.1, -0.05, 0.02])
    expect(reopened.getState().frames.tcp.position).toEqual([0, 0, 0.15])
    expect(reopened.getState().frames.mcp.position).not.toBe(mcp.position)
  })

  it('rejects scale-bearing project frames before changing state or storage', () => {
    const store = createCoordinateFrameStore(localStorage)
    const before = store.getState().frames
    const persistedBefore = localStorage.getItem(
      'robot-sim.coordinate-frames.v1',
    )

    expect(() =>
      store.getState().replaceFrames({
        mcp: {
          position: [0, 0, 0],
          quaternion: [0, 0, 0, 1],
          scale: [2, 1, 1],
        },
        tcp: {
          position: [0, 0, 0],
          quaternion: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
      }),
    ).toThrow(/scale/i)

    expect(store.getState().frames).toEqual(before)
    expect(localStorage.getItem('robot-sim.coordinate-frames.v1')).toBe(
      persistedBefore,
    )
  })
})
