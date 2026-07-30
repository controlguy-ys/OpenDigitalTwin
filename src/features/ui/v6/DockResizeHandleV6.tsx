import { useRef } from 'react'

export interface DockResizeHandleV6Props {
  readonly label: string
  readonly orientation: 'horizontal' | 'vertical'
  readonly value: number
  readonly min: number
  readonly max: number
  readonly direction: 1 | -1
  readonly className?: string
  readonly valueFromPointerDelta: (startValue: number, signedDeltaPx: number) => number
  readonly onChange: (value: number) => void
  readonly onReset: () => void
}

interface ActiveDrag {
  readonly pointerId: number
  readonly startAxisPx: number
  readonly startValue: number
}

function clamp(value: number, minimum: number, maximum: number): number | null {
  if (!Number.isFinite(value)) return null
  return Math.min(maximum, Math.max(minimum, value))
}

export function DockResizeHandleV6({
  label, orientation, value, min, max, direction, className, valueFromPointerDelta, onChange, onReset,
}: DockResizeHandleV6Props) {
  const activeDrag = useRef<ActiveDrag | null>(null)
  const axis = (event: { clientX: number; clientY: number }) => orientation === 'vertical' ? event.clientX : event.clientY
  const emit = (proposal: number) => {
    const next = clamp(proposal, min, max)
    if (next !== null) onChange(next)
  }
  const release = (element: HTMLElement, pointerId?: number) => {
    const active = activeDrag.current
    if (active === null || (pointerId !== undefined && active.pointerId !== pointerId)) return
    activeDrag.current = null
    try {
      if (element.hasPointerCapture?.(active.pointerId)) element.releasePointerCapture?.(active.pointerId)
    } catch {}
  }
  return (
    <div
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value}
      className={`v6-dock-resize-handle v6-dock-resize-handle--${orientation} ${className ?? ''}`.trim()}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { release(event.currentTarget); return }
        const lower = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        const higher = event.key === 'ArrowRight' || event.key === 'ArrowDown'
        if (!lower && !higher) return
        event.preventDefault()
        emit(value + (higher ? 1 : -1) * (event.shiftKey ? 24 : 8) * direction)
      }}
      onPointerCancel={(event) => release(event.currentTarget, event.pointerId)}
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
      onPointerUp={(event) => release(event.currentTarget, event.pointerId)}
      role="separator"
      tabIndex={0}
    />
  )
}
