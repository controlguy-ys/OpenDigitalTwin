import { describe, expect, it } from 'vitest'
import {
  createRightButtonGestureControllerV4,
  SCENE_CONTEXT_DRAG_THRESHOLD_PX_V4,
} from './right-button-gesture.js'

describe('right-button Scene gesture V4', () => {
  it('treats below five pixels as context and exactly five as Pan', () => {
    const click = createRightButtonGestureControllerV4()
    click.begin({ button: 2, pointerId: 7, pointerType: 'mouse', clientX: 10, clientY: 20 })
    click.move({ pointerId: 7, clientX: 13, clientY: 23 })
    expect(click.finish({ pointerId: 7, clientX: 13, clientY: 23 })?.request).toEqual({
      selection: null,
      position: { x: 13, y: 23 },
    })

    const pan = createRightButtonGestureControllerV4()
    pan.begin({ button: 2, pointerId: 8, pointerType: 'pen', clientX: 0, clientY: 0 })
    pan.move({ pointerId: 8, clientX: 3, clientY: 4 })
    expect(pan.finish({ pointerId: 8, clientX: 3, clientY: 4 })?.request).toBeNull()
    expect(SCENE_CONTEXT_DRAG_THRESHOLD_PX_V4).toBe(5)
  })

  it('retains the exact candidate and consumes only its matching native event', () => {
    const controller = createRightButtonGestureControllerV4()
    controller.begin({ button: 2, pointerId: 9, pointerType: 'mouse', clientX: 4, clientY: 6 })
    controller.setCandidate(9, { kind: 'robot-link', robotId: 'robot-1', linkId: 'L2' })
    const finished = controller.finish({ pointerId: 9, clientX: 4, clientY: 6 })
    expect(finished?.request).toEqual({
      selection: { kind: 'robot-link', robotId: 'robot-1', linkId: 'L2' },
      position: { x: 4, y: 6 },
    })
    expect(controller.consumeNativeContextMenu({
      button: 2, pointerId: 9, pointerType: 'mouse', clientX: 4, clientY: 6,
    })).toBe(true)
    expect(controller.consumeNativeContextMenu({
      button: 2, pointerId: 10, pointerType: 'mouse', clientX: 4, clientY: 6,
    })).toBe(false)
  })

  it('abandons active and completion state on cancel', () => {
    const controller = createRightButtonGestureControllerV4()
    controller.begin({ button: 2, pointerId: 3, pointerType: 'mouse', clientX: 1, clientY: 2 })
    controller.cancel(3)
    expect(controller.finish({ pointerId: 3, clientX: 1, clientY: 2 })).toBeNull()
  })

  it('matches legacy native events only by final coordinates and preserves keyboard menus', () => {
    const controller = createRightButtonGestureControllerV4()
    controller.begin({ button: 2, pointerId: 11, pointerType: 'mouse', clientX: 7, clientY: 8 })
    controller.finish({ pointerId: 11, clientX: 9, clientY: 10 })
    expect(controller.consumeNativeContextMenu({
      button: 2, clientX: 9, clientY: 10,
    })).toBe(true)

    controller.begin({ button: 2, pointerId: 12, pointerType: 'mouse', clientX: 0, clientY: 0 })
    controller.finish({ pointerId: 12, clientX: 0, clientY: 0 })
    expect(controller.consumeNativeContextMenu({
      button: 0, clientX: 0, clientY: 0,
    })).toBe(false)
  })

  it('does not let unrelated input or an older frame clear a newer completion', () => {
    const controller = createRightButtonGestureControllerV4()
    controller.begin({ button: 2, pointerId: 13, pointerType: 'mouse', clientX: 1, clientY: 1 })
    const first = controller.finish({ pointerId: 13, clientX: 1, clientY: 1 })
    controller.begin({ button: 0, pointerId: 14, pointerType: 'mouse', clientX: 2, clientY: 2 })
    controller.cancel(99)
    controller.begin({ button: 2, pointerId: 13, pointerType: 'mouse', clientX: 3, clientY: 3 })
    const second = controller.finish({ pointerId: 13, clientX: 3, clientY: 3 })
    controller.clearCompletion(first!.completionId)
    expect(controller.consumeNativeContextMenu({
      button: 2, pointerId: 13, pointerType: 'mouse', clientX: 3, clientY: 3,
    })).toBe(true)
    expect(second!.completionId).not.toBe(first!.completionId)
  })
})
