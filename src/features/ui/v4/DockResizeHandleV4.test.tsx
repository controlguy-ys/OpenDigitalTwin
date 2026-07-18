import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DockResizeHandleV4 } from './DockResizeHandleV4.js'
import { createShellLayoutStoreV4 } from './shell-layout-store.js'
import { initialShellLayoutBoundsV4, isSceneJobResizeAvailableV4 } from './shell-layout-geometry.js'
import { createShellLayoutControllerV4 } from './shell-layout-controller.js'

function renderHandle(overrides: Partial<React.ComponentProps<typeof DockResizeHandleV4>> = {}) {
  const onChange = vi.fn()
  const onReset = vi.fn()
  render(<DockResizeHandleV4
    direction={1}
    keyboardStep={10}
    label="Resize sidebar"
    max={420}
    min={220}
    onChange={onChange}
    onReset={onReset}
    orientation="vertical"
    value={248}
    valueFromPointerDelta={(start, delta) => start + delta}
    {...overrides}
  />)
  return { onChange, onReset, handle: screen.getByRole('separator', { name: overrides.label ?? 'Resize sidebar' }) }
}

class MemoryStorage {
  writes = 0
  getItem() { return null }
  setItem() { this.writes += 1 }
  removeItem() {}
}

function SceneJobResizeHarness({
  controller,
  contentHeightPx,
}: {
  controller: ReturnType<typeof createShellLayoutControllerV4>
  contentHeightPx: number
}) {
  const [, refresh] = useState(0)
  if (!isSceneJobResizeAvailableV4(controller.getState().mode, contentHeightPx)) {
    return <div data-testid="scene-job-handle-hidden" />
  }
  const percent = controller.getState().preferences.sidebar.sceneJobSplitPercent
  return <DockResizeHandleV4
    direction={1}
    keyboardStep={5}
    label="Resize scene and jobs"
    max={75}
    min={35}
    onChange={(next) => {
      controller.setSceneJobSplit(next)
      refresh((value) => value + 1)
    }}
    onReset={() => {
      controller.setSceneJobSplit(60)
      refresh((value) => value + 1)
    }}
    orientation="horizontal"
    value={percent}
    valueFromPointerDelta={(start, delta) => start + delta / contentHeightPx * 100}
  />
}

describe('DockResizeHandleV4', () => {
  it('renders an accessible focusable separator and applies signed primary pointer resizing with capture', () => {
    const { handle, onChange } = renderHandle()
    const capture = vi.fn()
    const release = vi.fn()
    Object.assign(handle, { setPointerCapture: capture, releasePointerCapture: release, hasPointerCapture: () => true })
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-valuemin', '220')
    expect(handle).toHaveAttribute('aria-valuemax', '420')
    expect(handle).toHaveAttribute('aria-valuenow', '248')
    expect(handle.tabIndex).toBe(0)
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 5 })
    fireEvent.pointerMove(handle, { clientX: 136, pointerId: 5 })
    fireEvent.pointerMove(handle, { clientX: 400, pointerId: 6 })
    fireEvent.pointerUp(handle, { pointerId: 5 })
    expect(capture).toHaveBeenCalledWith(5)
    expect(onChange).toHaveBeenCalledWith(284)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledWith(5)
  })

  it('uses clientY for horizontal resizing, supports arrow keys and direction reversal, and resets only on double click', () => {
    const { handle, onChange, onReset } = renderHandle({ direction: -1, orientation: 'horizontal' })
    fireEvent.pointerDown(handle, { button: 0, clientY: 100, pointerId: 3 })
    fireEvent.pointerMove(handle, { clientY: 130, pointerId: 3 })
    fireEvent.pointerCancel(handle, { pointerId: 3 })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    fireEvent.doubleClick(handle)
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([220, 258, 238, 258, 238])
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('clamps pointer proposals and leaves Escape/cancel without a synthetic extra change', () => {
    const { handle, onChange } = renderHandle({ valueFromPointerDelta: (start, delta) => start + delta * 10 })
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, pointerId: 7 })
    fireEvent.pointerMove(handle, { clientX: 100, pointerId: 7 })
    fireEvent.keyDown(handle, { key: 'Escape' })
    fireEvent.pointerMove(handle, { clientX: 10, pointerId: 7 })
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([420])
  })

  it('supports the exact Scene-to-Job percentage conversion through its generic pointer callback', () => {
    const { handle, onChange } = renderHandle({
      label: 'Resize scene and jobs', max: 75, min: 35, value: 60,
      valueFromPointerDelta: (start, delta) => start + delta / 360 * 100,
    })
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, pointerId: 9 })
    fireEvent.pointerMove(handle, { clientX: 36, pointerId: 9 })
    expect(onChange).toHaveBeenCalledWith(70)
  })

  it('integrates a horizontal Scene-to-Job handle with the real controller, 35/75 clamping, and a 60-only reset', () => {
    const storage = new MemoryStorage()
    const store = createShellLayoutStoreV4({ storage })
    const controller = createShellLayoutControllerV4({
      preferencesStore: store,
      initialBounds: initialShellLayoutBoundsV4(1440, 900),
    })
    controller.setDockSize('sidebar', 300)
    controller.setBounds(959, 900)
    const view = render(<SceneJobResizeHarness contentHeightPx={360} controller={controller} />)
    const handle = screen.getByRole('separator', { name: 'Resize scene and jobs' })
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal')
    fireEvent.pointerDown(handle, { button: 0, clientY: 0, pointerId: 13 })
    fireEvent.pointerMove(handle, { clientY: 360, pointerId: 13 })
    expect(store.getState().preferences.sidebar.sceneJobSplitPercent).toBe(75)
    expect(store.getState().preferences.sidebar.widthPx).toBe(300)
    fireEvent.pointerMove(handle, { clientY: -360, pointerId: 13 })
    expect(store.getState().preferences.sidebar.sceneJobSplitPercent).toBe(35)
    fireEvent.doubleClick(handle)
    expect(store.getState().preferences.sidebar.sceneJobSplitPercent).toBe(60)
    expect(store.getState().preferences.sidebar.widthPx).toBe(300)

    const writesBeforeHidden = storage.writes
    view.rerender(<SceneJobResizeHarness contentHeightPx={359} controller={controller} />)
    expect(screen.getByTestId('scene-job-handle-hidden')).toBeInTheDocument()
    expect(screen.queryByRole('separator', { name: 'Resize scene and jobs' })).toBeNull()
    expect(storage.writes).toBe(writesBeforeHidden)
  })
})
