import type { ReactNode } from 'react'

export interface TooltipV6Props {
  readonly children: ReactNode
  readonly id: string
  readonly visible: boolean
}

export function TooltipV6({ children, id, visible }: TooltipV6Props) {
  if (!visible) return null

  return <span className="v6-tooltip" id={id} role="tooltip">{children}</span>
}
