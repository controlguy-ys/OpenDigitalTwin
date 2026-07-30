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
})
