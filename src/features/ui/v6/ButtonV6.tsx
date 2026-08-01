import { forwardRef, type ButtonHTMLAttributes } from 'react'

export interface ButtonV6Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant: 'primary' | 'secondary' | 'ghost' | 'danger'
  readonly size: 'compact' | 'default'
}

export const ButtonV6 = forwardRef<HTMLButtonElement, ButtonV6Props>(function ButtonV6({
  children,
  className,
  size,
  variant,
  type = 'button',
  ...buttonProps
}, ref) {
  const classes = ['v6-button', `v6-button--${variant}`, `v6-button--${size}`, className]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(' ')

  return <button
    {...buttonProps}
    className={classes}
    data-size={size}
    data-variant={variant}
    ref={ref}
    type={type}
  >{children}</button>
})

