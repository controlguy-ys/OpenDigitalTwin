import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import type { AppCommandBindingsV4 } from '../../commands/v4/app-command-runtime.js'
import { AppCommandMenuItemV4 } from './AppCommandMenuItemV4.js'
import type { AppMenuNavigationPropsV4, AppMenuNodeV4, AppMenuSectionModelV4 } from './app-menu-model.js'

export interface AppMenuBarPropsV4 extends AppMenuNavigationPropsV4 {
  readonly commandBindings: AppCommandBindingsV4
  readonly model: readonly AppMenuSectionModelV4[]
}

function logicalItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[data-menu-direct="true"]'))
    .filter((item) => item.closest('[role="menu"]') === menu)
}

function focusLogical(menu: HTMLElement, intent: 'first' | 'last' | 1 | -1): void {
  const items = logicalItems(menu)
  if (items.length === 0) return
  if (intent === 'first') return void items[0]?.focus()
  if (intent === 'last') return void items.at(-1)?.focus()
  const at = items.indexOf(document.activeElement as HTMLElement)
  items[(at + intent + items.length) % items.length]?.focus()
}

interface FlyoutGeometryV4 {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly maxWidth: number
  readonly maxHeight: number
}

const flyoutViewportPaddingV4 = 8
const flyoutGapV4 = 3
const flyoutMinimumWidthV4 = 210

function clampFlyoutCoordinateV4(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function getFlyoutGeometryV4(trigger: DOMRect, owner: DOMRect, flyout: DOMRect): FlyoutGeometryV4 {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const availableWidth = Math.max(0, viewportWidth - flyoutViewportPaddingV4 * 2)
  const width = Math.min(Math.max(flyoutMinimumWidthV4, trigger.width, flyout.width), availableWidth)
  const right = trigger.right + flyoutGapV4
  const preferredLeft = right + width <= viewportWidth - flyoutViewportPaddingV4
    ? right
    : trigger.left - flyoutGapV4 - width
  const left = clampFlyoutCoordinateV4(
    preferredLeft,
    flyoutViewportPaddingV4,
    Math.max(flyoutViewportPaddingV4, viewportWidth - flyoutViewportPaddingV4 - width),
  )
  const top = clampFlyoutCoordinateV4(
    trigger.top - 4,
    flyoutViewportPaddingV4,
    Math.max(flyoutViewportPaddingV4, viewportHeight - flyoutViewportPaddingV4),
  )

  return {
    left: left - owner.left,
    top: top - owner.top,
    width,
    maxWidth: width,
    maxHeight: Math.max(0, viewportHeight - flyoutViewportPaddingV4 - top),
  }
}

export function AppMenuBarV4({
  commandBindings,
  model,
  openSection,
  onOpenSectionChange,
  onPreviewSection,
}: AppMenuBarPropsV4): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null)
  const callbackRef = useRef(onPreviewSection)
  const lastPreviewRef = useRef<undefined | AppMenuNavigationPropsV4['openSection']>(undefined)
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>())
  const submenuTriggerRefs = useRef(new Map<string, HTMLButtonElement>())
  const focusIntent = useRef<'first' | 'last' | null>(null)
  const [focusSectionId, setFocusSectionId] = useState<string | null>(model[0]?.id ?? null)
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)
  const [flyoutGeometry, setFlyoutGeometry] = useState<FlyoutGeometryV4 | null>(null)
  const ids = useId().replace(/:/g, '')
  const active = openSection === null ? null : model.find((section) => section.id === openSection) ?? null

  useEffect(() => { callbackRef.current = onPreviewSection }, [onPreviewSection])
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled || lastPreviewRef.current === openSection) return
      lastPreviewRef.current = openSection
      callbackRef.current(openSection)
    })
    return () => { cancelled = true }
  }, [openSection])
  useEffect(() => {
    if (!model.some((section) => section.id === focusSectionId)) setFocusSectionId(model[0]?.id ?? null)
  }, [focusSectionId, model])
  useEffect(() => {
    if (openSection !== null && active === null) onOpenSectionChange(null)
  }, [active, onOpenSectionChange, openSection])
  useEffect(() => {
    setOpenSubmenu(null)
    setFlyoutGeometry(null)
  }, [openSection])
  useEffect(() => {
    if (active === null || focusIntent.current === null) return
    const popup = document.getElementById(`${ids}-${active.id}-menu`)
    if (popup !== null) focusLogical(popup, focusIntent.current)
    focusIntent.current = null
  }, [active, ids, openSection])
  useEffect(() => {
    if (openSection === null) return
    const dismiss = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node) === true) return
      setOpenSubmenu(null)
      onOpenSectionChange(null)
    }
    document.addEventListener('pointerdown', dismiss, true)
    return () => document.removeEventListener('pointerdown', dismiss, true)
  }, [onOpenSectionChange, openSection])
  useLayoutEffect(() => {
    if (active === null || openSubmenu === null) return
    const update = (): void => {
      const owner = document.getElementById(`${ids}-${active.id}-menu`)
      const trigger = submenuTriggerRefs.current.get(openSubmenu)
      const flyout = document.getElementById(`${ids}-${openSubmenu}`)
      if (owner !== null && trigger !== undefined && flyout !== null) {
        setFlyoutGeometry(getFlyoutGeometryV4(trigger.getBoundingClientRect(), owner.getBoundingClientRect(), flyout.getBoundingClientRect()))
      }
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [active, ids, openSubmenu])

  const close = (restore: boolean): void => {
    const section = openSection
    if (restore && section !== null) triggerRefs.current.get(section)?.focus()
    setOpenSubmenu(null)
    setFlyoutGeometry(null)
    onOpenSectionChange(null)
  }

  const switchSection = (
    delta: number,
    keepOpen: boolean,
    fromSectionId: string | null = active?.id ?? null,
  ): void => {
    if (model.length === 0) return
    const current = Math.max(0, model.findIndex((section) => section.id === (fromSectionId ?? focusSectionId)))
    const next = model[(current + delta + model.length) % model.length]!
    setFocusSectionId(next.id)
    triggerRefs.current.get(next.id)?.focus()
    if (!keepOpen) return
    focusIntent.current = 'first'
    onOpenSectionChange(next.id)
  }

  const openNested = (submenuId: string, menuId: string): void => {
    setFlyoutGeometry(null)
    setOpenSubmenu(submenuId)
    queueMicrotask(() => {
      const popup = document.getElementById(menuId)
      if (popup !== null) focusLogical(popup, 'first')
    })
  }

  const closeNested = (submenuId: string): void => {
    setOpenSubmenu(null)
    setFlyoutGeometry(null)
    submenuTriggerRefs.current.get(submenuId)?.focus()
  }

  const outcome = (_id: string, result: 'completed' | 'cancelled' | 'ignored' | 'failed'): void => {
    if (result === 'completed') close(true)
  }

  const renderCommandNodes = (items: readonly AppMenuNodeV4[]): ReactNode => items.map((node) => {
    if (node.kind === 'separator') return <div key={node.id} role="separator" className="app-menu-separator-v4" />
    if (node.kind === 'command') {
      return <AppCommandMenuItemV4 key={node.commandId} commandBindings={commandBindings} commandId={node.commandId} onOutcome={outcome} />
    }
    return null
  })

  const renderRootNodes = (items: readonly AppMenuNodeV4[]): ReactNode => items.map((node) => {
    if (node.kind !== 'submenu') {
      if (node.kind === 'separator') return <div key={node.id} role="separator" className="app-menu-separator-v4" />
      return <AppCommandMenuItemV4 key={node.commandId} commandBindings={commandBindings} commandId={node.commandId} onOutcome={outcome} />
    }
    const submenuId = `${ids}-${node.id}`
    const triggerId = `${submenuId}-trigger`
    const expanded = openSubmenu === node.id
    return <div key={node.id} className="app-menu-submenu-v4">
      <button
        ref={(element) => {
          if (element === null) submenuTriggerRefs.current.delete(node.id)
          else submenuTriggerRefs.current.set(node.id, element)
        }}
        id={triggerId}
        type="button"
        role="menuitem"
        data-menu-direct="true"
        aria-haspopup="menu"
        aria-expanded={expanded}
        aria-controls={submenuId}
        onClick={() => {
          if (expanded) {
            setOpenSubmenu(null)
            setFlyoutGeometry(null)
          } else openNested(node.id, submenuId)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            event.stopPropagation()
            switchSection(-1, true)
          } else if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') {
            event.preventDefault()
            event.stopPropagation()
            openNested(node.id, submenuId)
          }
        }}
      >
        <span>{node.label}</span>
        <span className="app-menu-submenu-indicator-v4" aria-hidden="true" />
      </button>
    </div>
  })

  const nestedPopup = active?.children.find((node) => node.kind === 'submenu' && node.id === openSubmenu)

  return <div ref={rootRef} className="app-menu-bar-v4" role="menubar" aria-label="Application menu">
    {model.map((section) => {
      const open = section.id === openSection
      const triggerId = `${ids}-${section.id}-trigger`
      const popupId = `${ids}-${section.id}-menu`
      const nestedId = nestedPopup?.kind === 'submenu' ? `${ids}-${nestedPopup.id}` : null
      const nestedTriggerId = nestedId === null ? null : `${nestedId}-trigger`
      return <div key={section.id} className="app-menu-section-v4">
        <button
          ref={(element) => {
            if (element === null) triggerRefs.current.delete(section.id)
            else triggerRefs.current.set(section.id, element)
          }}
          id={triggerId}
          type="button"
          role="menuitem"
          tabIndex={focusSectionId === section.id ? 0 : -1}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={popupId}
          onFocus={() => setFocusSectionId(section.id)}
          onClick={() => {
            if (open) close(false)
            else {
              focusIntent.current = 'first'
              onOpenSectionChange(section.id)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              switchSection(-1, open, section.id)
            } else if (event.key === 'ArrowRight') {
              event.preventDefault()
              switchSection(1, open, section.id)
            } else if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
              event.preventDefault()
              focusIntent.current = 'first'
              onOpenSectionChange(section.id)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              focusIntent.current = 'last'
              onOpenSectionChange(section.id)
            }
          }}
        >{section.label}</button>
        {open ? <div
          id={popupId}
          role="menu"
          aria-labelledby={triggerId}
          className="app-menu-popup-v4"
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            const nested = (event.target as HTMLElement).closest('[role="menu"]') !== event.currentTarget
            if (nested) return
            if (event.key === 'Escape') {
              event.preventDefault()
              close(true)
            } else if (event.key === 'Tab') {
              close(false)
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              focusLogical(event.currentTarget, 1)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              focusLogical(event.currentTarget, -1)
            } else if (event.key === 'Home') {
              event.preventDefault()
              focusLogical(event.currentTarget, 'first')
            } else if (event.key === 'End') {
              event.preventDefault()
              focusLogical(event.currentTarget, 'last')
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault()
              switchSection(event.key === 'ArrowLeft' ? -1 : 1, true)
            }
          }}
        >
          <div className="app-menu-list-v4">{renderRootNodes(section.children)}</div>
          {nestedPopup?.kind === 'submenu' && nestedId !== null && nestedTriggerId !== null ? <div className="app-menu-flyout-layer-v4">
            <div
              id={nestedId}
              role="menu"
              aria-labelledby={nestedTriggerId}
              className="app-menu-submenu-popup-v4"
              style={flyoutGeometry ?? undefined}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') {
                  event.preventDefault()
                  event.stopPropagation()
                  closeNested(nestedPopup.id)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  close(true)
                } else if (event.key === 'Tab') {
                  event.stopPropagation()
                  close(false)
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  event.stopPropagation()
                  focusLogical(event.currentTarget, 1)
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  event.stopPropagation()
                  focusLogical(event.currentTarget, -1)
                } else if (event.key === 'Home') {
                  event.preventDefault()
                  event.stopPropagation()
                  focusLogical(event.currentTarget, 'first')
                } else if (event.key === 'End') {
                  event.preventDefault()
                  event.stopPropagation()
                  focusLogical(event.currentTarget, 'last')
                }
              }}
            >
              <div className="app-menu-list-v4">{renderCommandNodes(nestedPopup.children)}</div>
            </div>
          </div> : null}
        </div> : null}
      </div>
    })}
  </div>
}
