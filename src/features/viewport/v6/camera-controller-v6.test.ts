import { describe, expect, it, vi } from 'vitest'

import { createCameraControllerV6, V6_CAMERA_MOUSE_MAPPING } from './camera-controller-v6.js'

describe('CameraControllerV6', () => {
  it('uses the approved mouse mapping and never maps right drag to pan', () => {
    expect(V6_CAMERA_MOUSE_MAPPING).toEqual({
      left: 'select', middle: 'orbit', shiftMiddle: 'pan', wheel: 'zoom', right: 'context-menu',
    })
  })

  it('homes, frames visible bounds, focuses a selection, and supports every standard orientation without domain mutation', () => {
    const camera = { position: [9, 9, 9] as [number, number, number], target: [0, 0, 0] as [number, number, number] }
    const update = vi.fn()
    const subject = createCameraControllerV6({
      camera,
      home: { position: [2, 3, 4], target: [1, 1, 1] },
      visibleBounds: () => ({ center: [6, 7, 8], radius: 2 }),
      selectionBounds: () => ({ center: [3, 4, 5], radius: 1 }),
      update,
    })

    subject.home()
    expect(camera).toEqual({ position: [2, 3, 4], target: [1, 1, 1] })
    subject.fitAll()
    expect(camera.target).toEqual([6, 7, 8])
    subject.focusSelection()
    expect(camera.target).toEqual([3, 4, 5])
    for (const orientation of ['isometric', 'top', 'front', 'right', 'back', 'left', 'bottom'] as const) subject.setOrientation(orientation)
    expect(update).toHaveBeenCalledTimes(10)
  })

  it('returns immutable camera snapshots and leaves the pose unchanged when bounds are unavailable', () => {
    const camera = { position: [9, 9, 9] as [number, number, number], target: [0, 0, 0] as [number, number, number] }
    const update = vi.fn()
    const subject = createCameraControllerV6({
      camera,
      home: { position: [2, 3, 4], target: [1, 1, 1] },
      visibleBounds: () => null,
      selectionBounds: () => null,
      update,
    })
    const before = subject.snapshot()
    expect(Object.isFrozen(before)).toBe(true)
    expect(Object.isFrozen(before.position)).toBe(true)
    expect(Object.isFrozen(before.target)).toBe(true)
    subject.fitAll()
    subject.focusSelection()
    expect(subject.snapshot()).toEqual(before)
    expect(update).not.toHaveBeenCalled()
  })

  it('frames bounds at a normalized isometric distance so the model fills the viewport', () => {
    const camera = { position: [0, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number] }
    const subject = createCameraControllerV6({
      camera,
      home: { position: [0, 0, 0], target: [0, 0, 0] },
      visibleBounds: () => ({ center: [1, 2, 3], radius: 2 }),
      selectionBounds: () => null,
      update: vi.fn(),
    })

    subject.fitAll()

    expect(camera.target).toEqual([1, 2, 3])
    const [px, py, pz] = camera.position
    const [tx, ty, tz] = camera.target
    const offset = [px - tx, py - ty, pz - tz] as const
    expect(Math.hypot(...offset)).toBeCloseTo(5.6)
    expect(offset[0]).toBeCloseTo(-offset[1])
    expect(offset[0]).toBeCloseTo(offset[2])
  })
})
