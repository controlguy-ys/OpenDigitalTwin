import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'

export interface ModalDialogV6NestedDialogOptions {
  readonly parentDialogId: string
}

export interface ModalDialogV6Props {
  readonly titleId: string
  readonly busy?: boolean
  readonly triggerRef?: RefObject<HTMLElement | null>
  readonly initialFocusRef?: RefObject<HTMLElement | null>
  readonly dialogRef?: RefObject<HTMLDivElement | null>
  readonly onClose: () => void
  readonly header: ReactNode
  readonly children: ReactNode
  readonly footer: ReactNode
  readonly className?: string
  readonly overlayClassName?: string
  readonly testId?: string
  readonly size?: 'default' | 'wide' | 'editor'
  readonly busyEscapeBehavior?: 'consume' | 'ignore'
  readonly nestedDialog?: ModalDialogV6NestedDialogOptions
}

const openDialogs = new Set<symbol>()

function tabbableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]'))
    .filter((element) => (
      element.tabIndex >= 0
      && element.closest('[hidden]') === null
      && (!('disabled' in element) || element.disabled !== true)
    ))
}

function classNames(...values: readonly (string | undefined)[]): string {
  return values.filter((value): value is string => value !== undefined && value.length > 0).join(' ')
}

export function ModalDialogV6({
  titleId,
  busy = false,
  triggerRef,
  initialFocusRef,
  dialogRef,
  onClose,
  header,
  children,
  footer,
  className,
  overlayClassName,
  testId,
  size = 'default',
  busyEscapeBehavior = 'consume',
  nestedDialog,
}: ModalDialogV6Props): ReactNode {
  const ownDialogRef = useRef<HTMLDivElement>(null)
  const tokenRef = useRef(Symbol(titleId))
  const dialog = dialogRef ?? ownDialogRef
  const isTopmost = (): boolean => {
    let latest: symbol | null = null
    for (const token of openDialogs) latest = token
    return latest === tokenRef.current
  }
  const restoreFocus = (): void => {
    const trigger = triggerRef?.current
    if (trigger?.isConnected) trigger.focus()
  }

  useEffect(() => {
    openDialogs.add(tokenRef.current)
    const timer = window.setTimeout(() => {
      if (!isTopmost()) return
      const target = initialFocusRef?.current ?? tabbableElements(dialog.current ?? document.body)[0] ?? dialog.current
      target?.focus()
    }, 0)
    return () => {
      window.clearTimeout(timer)
      openDialogs.delete(tokenRef.current)
      restoreFocus()
    }
  }, [])

  const close = (): void => {
    if (!busy && isTopmost()) onClose()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!isTopmost()) return
    if (event.key === 'Escape') {
      if (event.nativeEvent.isComposing) return
      if (busy && busyEscapeBehavior === 'ignore') return
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const root = dialog.current
    if (root === null) return
    const elements = tabbableElements(root)
    const first = elements[0]
    const last = elements.at(-1)
    const activeIndex = elements.indexOf(document.activeElement as HTMLElement)
    if (
      (!event.shiftKey && (activeIndex < 0 || activeIndex === elements.length - 1))
      || (event.shiftKey && activeIndex <= 0)
    ) {
      event.preventDefault()
      ;(event.shiftKey ? last : first)?.focus()
    }
  }

  const onBackdropMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) close()
  }

  return <div
    className={classNames('v6-modal-backdrop', overlayClassName)}
    data-nested-dialog-parent={nestedDialog?.parentDialogId}
    data-testid={testId ?? 'v6-modal-backdrop'}
    onMouseDown={onBackdropMouseDown}
  >
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className={classNames('v6-modal-dialog', `v6-modal-dialog--${size}`, className)}
      onKeyDown={onKeyDown}
      ref={dialog}
      role="dialog"
      tabIndex={-1}
    >
      {header}
      {children}
      {footer}
    </div>
  </div>
}
