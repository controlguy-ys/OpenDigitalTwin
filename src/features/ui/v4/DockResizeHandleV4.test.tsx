import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DockResizeHandleV4 } from './DockResizeHandleV4.js'

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
})
