import { useRef } from 'react'

export interface DockResizeHandlePropsV4 {
  readonly label: string
  readonly orientation: 'horizontal' | 'vertical'
  readonly value: number
  readonly min: number
  readonly max: number
  readonly keyboardStep: number
  readonly valueFromPointerDelta: (startValue: number, signedDeltaPx: number) => number
  readonly onChange: (value: number) => void
  readonly onReset: () => void
  readonly direction: 1 | -1
}

interface ActiveDragV4 {
  readonly pointerId: number
  readonly startAxisPx: number
  readonly startValue: number
}

function clampFinite(value: number, min: number, max: number): number | null {
  if (!Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, value))
}

export function DockResizeHandleV4({
  label,
  orientation,
  value,
  min,
  max,
  keyboardStep,
  valueFromPointerDelta,
  onChange,
  onReset,
  direction,
}: DockResizeHandlePropsV4) {
  const activeDrag = useRef<ActiveDragV4 | null>(null)
  const axis = (event: { clientX: number; clientY: number }) => orientation === 'vertical' ? event.clientX : event.clientY
  const emit = (proposal: number) => {
    const next = clampFinite(proposal, min, max)
    if (next !== null) onChange(next)
  }
  const endDrag = (element: HTMLElement, pointerId?: number) => {
    const active = activeDrag.current
    if (active === null || (pointerId !== undefined && active.pointerId !== pointerId)) return
    activeDrag.current = null
    try {
      if (element.hasPointerCapture?.(active.pointerId)) element.releasePointerCapture?.(active.pointerId)
    } catch {
      // Capture release is advisory; a detached target is already safe.
    }
  }

  return (
    <div
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          endDrag(event.currentTarget)
          return
        }
        const isLower = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        const isHigher = event.key === 'ArrowRight' || event.key === 'ArrowDown'
        if (!isLower && !isHigher) return
        event.preventDefault()
        emit(value + (isHigher ? 1 : -1) * keyboardStep * direction)
      }}
      onPointerCancel={(event) => endDrag(event.currentTarget, event.pointerId)}
      onPointerDown={(event) => {
        if (event.button !== 0 || activeDrag.current !== null) return
        activeDrag.current = { pointerId: event.pointerId, startAxisPx: axis(event), startValue: value }
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }}
      onPointerMove={(event) => {
        const active = activeDrag.current
        if (active === null || active.pointerId !== event.pointerId) return
        emit(valueFromPointerDelta(active.startValue, (axis(event) - active.startAxisPx) * direction))
      }}
      onPointerUp={(event) => endDrag(event.currentTarget, event.pointerId)}
      role="separator"
      tabIndex={0}
    />
  )
}
