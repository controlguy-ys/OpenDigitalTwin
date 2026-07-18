import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import type { AppCommandBindingsV4 } from '../../commands/v4/app-command-runtime.js'
import { AppCommandMenuItemV4 } from './AppCommandMenuItemV4.js'
import type { AppMenuNavigationPropsV4, AppMenuNodeV4, AppMenuSectionModelV4 } from './app-menu-model.js'

export interface CompactAppMenuPropsV4 extends AppMenuNavigationPropsV4 {
  readonly commandBindings: AppCommandBindingsV4
  readonly model: readonly AppMenuSectionModelV4[]
}

function direct(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[data-menu-direct="true"]'))
    .filter((item) => item.closest('[role="menu"]') === menu)
}

function focus(menu: HTMLElement, direction: 'first' | 'last' | 1 | -1): void {
  const items = direct(menu)
  if (items.length === 0) return
  if (direction === 'first') return void items[0]?.focus()
  if (direction === 'last') return void items.at(-1)?.focus()
  const index = items.indexOf(document.activeElement as HTMLElement)
  items[(index + direction + items.length) % items.length]?.focus()
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

export function CompactAppMenuV4({
  commandBindings,
  model,
  openSection,
  onOpenSectionChange,
  onPreviewSection,
}: CompactAppMenuPropsV4): ReactNode {
  const root = useRef<HTMLDivElement>(null)
  const disclosure = useRef<HTMLButtonElement>(null)
  const callback = useRef(onPreviewSection)
  const lastPreview = useRef<undefined | AppMenuNavigationPropsV4['openSection']>(undefined)
  const categoryRefs = useRef(new Map<string, HTMLButtonElement>())
  const submenuTriggerRefs = useRef(new Map<string, HTMLButtonElement>())
  const returnCategoryId = useRef<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [submenu, setSubmenu] = useState<string | null>(null)
  const [flyoutGeometry, setFlyoutGeometry] = useState<FlyoutGeometryV4 | null>(null)
  const id = useId().replace(/:/g, '')
  const section = openSection === null ? null : model.find((candidate) => candidate.id === openSection) ?? null
  const sectionId = section?.id ?? null
  const surfaceOpen = expanded || openSection !== null
  const rootId = `${id}-application-menu`
  const sectionMenuId = section === null ? null : `${id}-${section.id}-section`

  useEffect(() => { callback.current = onPreviewSection }, [onPreviewSection])
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled || lastPreview.current === openSection) return
      lastPreview.current = openSection
      callback.current(openSection)
    })
    return () => { cancelled = true }
  }, [openSection])
  useEffect(() => {
    if (openSection === null) return
    setExpanded(true)
    setSubmenu(null)
    setFlyoutGeometry(null)
  }, [openSection])
  useEffect(() => {
    if (openSection === null || sectionId !== null) return
    setExpanded(true)
    setSubmenu(null)
    setFlyoutGeometry(null)
    onOpenSectionChange(null)
  }, [onOpenSectionChange, openSection, sectionId])
  useEffect(() => {
    if (!surfaceOpen) return
    const dismiss = (event: PointerEvent): void => {
      if (root.current?.contains(event.target as Node) === true) return
      setExpanded(false)
      setSubmenu(null)
      setFlyoutGeometry(null)
      onOpenSectionChange(null)
    }
    document.addEventListener('pointerdown', dismiss, true)
    return () => document.removeEventListener('pointerdown', dismiss, true)
  }, [onOpenSectionChange, surfaceOpen])
  useLayoutEffect(() => {
    if (section === null || submenu === null) return
    const update = (): void => {
      const owner = document.getElementById(`${id}-${section.id}-section`)
      const trigger = submenuTriggerRefs.current.get(submenu)
      const flyout = document.getElementById(`${id}-${submenu}`)
      if (owner !== null && trigger !== undefined && flyout !== null) {
        setFlyoutGeometry(getFlyoutGeometryV4(trigger.getBoundingClientRect(), owner.getBoundingClientRect(), flyout.getBoundingClientRect()))
      }
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [id, section, submenu])
  useEffect(() => {
    if (sectionId !== null || returnCategoryId.current === null) return
    const categoryId = returnCategoryId.current
    returnCategoryId.current = null
    categoryRefs.current.get(categoryId)?.focus()
  }, [sectionId])

  const close = (restore: boolean): void => {
    if (restore) disclosure.current?.focus()
    setExpanded(false)
    setSubmenu(null)
    setFlyoutGeometry(null)
    onOpenSectionChange(null)
  }

  const backToCategories = (restore = true): void => {
    setSubmenu(null)
    setFlyoutGeometry(null)
    if (restore && openSection !== null) returnCategoryId.current = openSection
    onOpenSectionChange(null)
  }

  const outcome = (_id: string, result: 'completed' | 'cancelled' | 'ignored' | 'failed'): void => {
    if (result === 'completed') close(true)
  }

  const navigate = (event: KeyboardEvent<HTMLDivElement>, onLeft: () => void): void => {
    const nested = (event.target as HTMLElement).closest('[role="menu"]') !== event.currentTarget
    if (nested) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') {
      close(false)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      focus(event.currentTarget, 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focus(event.currentTarget, -1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focus(event.currentTarget, 'first')
    } else if (event.key === 'End') {
      event.preventDefault()
      focus(event.currentTarget, 'last')
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onLeft()
    }
  }

  const openCategory = (categoryId: string): void => {
    returnCategoryId.current = categoryId
    onOpenSectionChange(categoryId as AppMenuNavigationPropsV4['openSection'])
    queueMicrotask(() => {
      const popup = document.getElementById(`${id}-${categoryId}-section`)
      if (popup !== null) focus(popup, 'first')
    })
  }

  const openNested = (submenuId: string, menuId: string): void => {
    setFlyoutGeometry(null)
    setSubmenu(submenuId)
    queueMicrotask(() => {
      const popup = document.getElementById(menuId)
      if (popup !== null) focus(popup, 'first')
    })
  }

  const closeNested = (submenuId: string): void => {
    setSubmenu(null)
    setFlyoutGeometry(null)
    submenuTriggerRefs.current.get(submenuId)?.focus()
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
    const submenuId = `${id}-${node.id}`
    const triggerId = `${submenuId}-trigger`
    const open = submenu === node.id
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
        aria-expanded={open}
        aria-controls={submenuId}
        onClick={() => {
          if (open) {
            setSubmenu(null)
            setFlyoutGeometry(null)
          } else openNested(node.id, submenuId)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') {
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

  const activeSubmenu = section?.children.find((node) => node.kind === 'submenu' && node.id === submenu)

  const category = (item: AppMenuSectionModelV4, active: boolean): ReactNode => {
    const categoryId = `${id}-${item.id}-category`
    const controls = active ? `${id}-${item.id}-section` : undefined
    return <button
      key={item.id}
      ref={(element) => {
        if (element === null) categoryRefs.current.delete(item.id)
        else categoryRefs.current.set(item.id, element)
      }}
      id={categoryId}
      type="button"
      role="menuitem"
      className="app-menu-category-trigger-v4"
      data-menu-direct="true"
      aria-haspopup="menu"
      aria-expanded={active}
      aria-controls={controls}
      onClick={() => {
        if (active) backToCategories(true)
        else openCategory(item.id)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' && active) {
          event.preventDefault()
          event.stopPropagation()
          backToCategories(true)
        } else if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') {
          event.preventDefault()
          event.stopPropagation()
          if (active) backToCategories(true)
          else openCategory(item.id)
        }
      }}
    >
      <span>{item.label}</span>
      <span className="app-menu-submenu-indicator-v4" aria-hidden="true" />
    </button>
  }

  return <div ref={root} className="compact-app-menu-v4">
    <button
      ref={disclosure}
      type="button"
      aria-haspopup="menu"
      aria-expanded={surfaceOpen}
      aria-controls={rootId}
      onClick={() => {
        if (surfaceOpen) close(false)
        else {
          setExpanded(true)
          queueMicrotask(() => {
            const popup = document.getElementById(rootId)
            if (popup !== null) focus(popup, 'first')
          })
        }
      }}
    >Menu</button>
    {surfaceOpen ? <div
      id={rootId}
      role="menu"
      aria-label="Application menu"
      className="app-menu-popup-v4"
      onKeyDown={(event) => navigate(event, () => undefined)}
    >
      {section === null ? <div className="app-menu-list-v4">{model.map((item) => category(item, false))}</div> : <>
        {category(section, true)}
        {sectionMenuId !== null ? <div
          id={sectionMenuId}
          role="menu"
          aria-labelledby={`${id}-${section.id}-category`}
          className="app-menu-section-root-v4"
          onKeyDown={(event) => navigate(event, () => backToCategories(true))}
        >
          <div className="app-menu-list-v4">{renderRootNodes(section.children)}</div>
          {activeSubmenu?.kind === 'submenu' ? <div className="app-menu-flyout-layer-v4">
            <div
              id={`${id}-${activeSubmenu.id}`}
              role="menu"
              aria-labelledby={`${id}-${activeSubmenu.id}-trigger`}
              className="app-menu-submenu-popup-v4"
              style={flyoutGeometry ?? undefined}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') {
                  event.preventDefault()
                  event.stopPropagation()
                  closeNested(activeSubmenu.id)
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
                  focus(event.currentTarget, 1)
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  event.stopPropagation()
                  focus(event.currentTarget, -1)
                } else if (event.key === 'Home') {
                  event.preventDefault()
                  event.stopPropagation()
                  focus(event.currentTarget, 'first')
                } else if (event.key === 'End') {
                  event.preventDefault()
                  event.stopPropagation()
                  focus(event.currentTarget, 'last')
                }
              }}
            >
              <div className="app-menu-list-v4">{renderCommandNodes(activeSubmenu.children)}</div>
            </div>
          </div> : null}
        </div> : null}
      </>}
    </div> : null}
  </div>
}
