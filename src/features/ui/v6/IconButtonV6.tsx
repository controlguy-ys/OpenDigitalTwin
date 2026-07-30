import { useId, useState } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import { TooltipV6 } from './TooltipV6.js'

export interface IconButtonV6Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly icon: LucideIcon
  readonly label: string
}

export function IconButtonV6({ icon: Icon, label, onBlur, onFocus, onMouseEnter, onMouseLeave, ...buttonProps }: IconButtonV6Props) {
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const tooltipId = useId()

  return (
    <span>
      <button
        {...buttonProps}
        aria-describedby={tooltipVisible ? tooltipId : undefined}
        aria-label={label}
        className="v6-icon-button"
        onBlur={(event) => {
          setTooltipVisible(false)
          onBlur?.(event)
        }}
        onFocus={(event) => {
          setTooltipVisible(true)
          onFocus?.(event)
        }}
        onMouseEnter={(event) => {
          setTooltipVisible(true)
          onMouseEnter?.(event)
        }}
        onMouseLeave={(event) => {
          setTooltipVisible(false)
          onMouseLeave?.(event)
        }}
        type={buttonProps.type ?? 'button'}
      >
        <Icon aria-hidden="true" size={18} />
      </button>
      <TooltipV6 id={tooltipId} visible={tooltipVisible}>{label}</TooltipV6>
    </span>
  )
}
