import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import type { AppCommandBindingsV4 } from '../../commands/v4/app-command-runtime.js'
import { AppCommandMenuItemV4 } from './AppCommandMenuItemV4.js'
import type { AppMenuNavigationPropsV4, AppMenuNodeV4, AppMenuSectionModelV4 } from './app-menu-model.js'

export interface AppMenuBarPropsV4 extends AppMenuNavigationPropsV4 {
  readonly commandBindings: AppCommandBindingsV4
  readonly model: readonly AppMenuSectionModelV4[]
}

function directItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll(':scope > [role="menuitem"], :scope > [role="menuitemcheckbox"], :scope > [role="menuitemradio"]')) as HTMLElement[]
}
function focusAt(menu: HTMLElement, direction: number | 'first' | 'last'): void {
  const items = directItems(menu); if (items.length === 0) return
  if (direction === 'first') return void items[0]?.focus()
  if (direction === 'last') return void items.at(-1)?.focus()
  const current = items.indexOf(document.activeElement as HTMLElement)
  items[(current + direction + items.length) % items.length]?.focus()
}

export function AppMenuBarV4({ commandBindings, model, openSection, onOpenSectionChange, onPreviewSection }: AppMenuBarPropsV4): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null); const triggerRefs = useRef(new Map<string, HTMLButtonElement>())
  const [focusIndex, setFocusIndex] = useState(0); const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)
  const ids = useId().replace(/:/g, '')
  const activeIndex = openSection === null ? -1 : model.findIndex((section) => section.id === openSection)
  const active = activeIndex < 0 ? null : model[activeIndex]!
  const close = (restore = false): void => { const id = openSection; if (restore && id !== null) triggerRefs.current.get(id)?.focus(); setOpenSubmenu(null); onOpenSectionChange(null) }
  useEffect(() => { onPreviewSection(openSection) }, [onPreviewSection, openSection])
  useEffect(() => { if (openSection !== null && !model.some((section) => section.id === openSection)) onOpenSectionChange(null) }, [model, onOpenSectionChange, openSection])
  useEffect(() => { setOpenSubmenu(null) }, [openSection])
  useEffect(() => {
    if (openSection === null) return
    const outside = (event: PointerEvent): void => { if (rootRef.current?.contains(event.target as Node) !== true) close(false) }
    document.addEventListener('pointerdown', outside, true); return () => document.removeEventListener('pointerdown', outside, true)
  }, [openSection])
  const moveTop = (delta: number, open: boolean): void => {
    if (model.length === 0) return; const next = (Math.max(activeIndex, focusIndex) + delta + model.length) % model.length
    setFocusIndex(next); const section = model[next]!; triggerRefs.current.get(section.id)?.focus(); if (open) onOpenSectionChange(section.id)
  }
  const outcome = (_id: string, result: 'completed' | 'cancelled' | 'ignored' | 'failed'): void => { if (result === 'completed') close(true) }
  const renderNodes = (nodes: readonly AppMenuNodeV4[]): ReactNode => nodes.map((node) => {
    if (node.kind === 'separator') return <div key={node.id} role="separator" className="app-menu-separator-v4" />
    if (node.kind === 'command') return <AppCommandMenuItemV4 key={node.commandId} commandBindings={commandBindings} commandId={node.commandId} onOutcome={outcome} />
    const open = openSubmenu === node.id; const submenuId = `${ids}-${node.id}`
    const submenuTriggerId = `${submenuId}-trigger`
    return <div key={node.id} className="app-menu-submenu-v4">
      <button id={submenuTriggerId} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open} aria-controls={submenuId} onClick={() => setOpenSubmenu(open ? null : node.id)} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpenSubmenu(node.id); queueMicrotask(() => document.getElementById(submenuId)?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()) } }}>{node.label}</button>
      {open ? <div id={submenuId} role="menu" aria-labelledby={submenuTriggerId} onKeyDown={(event) => { if (event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); setOpenSubmenu(null); (event.currentTarget.parentElement?.querySelector('button') as HTMLButtonElement | null)?.focus() } else if (event.key === 'Escape') close(true); else if (event.key === 'ArrowDown') { event.preventDefault(); focusAt(event.currentTarget, 1) } else if (event.key === 'ArrowUp') { event.preventDefault(); focusAt(event.currentTarget, -1) } }}>{renderNodes(node.children)}</div> : null}
    </div>
  })
  return <div ref={rootRef} className="app-menu-bar-v4" role="menubar" aria-label="Application menu">
    {model.map((section, index) => {
      const isOpen = section.id === openSection; const triggerId = `${ids}-${section.id}-trigger`; const sectionPopupId = `${ids}-${section.id}-menu`
      return <div className="app-menu-section-v4" key={section.id}>
        <button ref={(node) => { if (node === null) triggerRefs.current.delete(section.id); else triggerRefs.current.set(section.id, node) }} id={triggerId} type="button" role="menuitem" tabIndex={focusIndex === index ? 0 : -1} aria-haspopup="menu" aria-expanded={isOpen} aria-controls={sectionPopupId} onFocus={() => setFocusIndex(index)} onClick={() => isOpen ? close(false) : onOpenSectionChange(section.id)} onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') { event.preventDefault(); moveTop(-1, isOpen) }
          else if (event.key === 'ArrowRight') { event.preventDefault(); moveTop(1, isOpen) }
          else if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenSectionChange(section.id); queueMicrotask(() => document.getElementById(sectionPopupId)?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()) }
          else if (event.key === 'ArrowUp') { event.preventDefault(); onOpenSectionChange(section.id); queueMicrotask(() => { const menu = document.getElementById(sectionPopupId); if (menu) focusAt(menu, 'last') }) }
        }}>{section.label}</button>
        {isOpen ? <div id={sectionPopupId} role="menu" aria-labelledby={triggerId} className="app-menu-popup-v4" onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Escape') { event.preventDefault(); close(true) }
          else if (event.key === 'Tab') close(false)
          else if (event.key === 'ArrowDown') { event.preventDefault(); focusAt(event.currentTarget, 1) }
          else if (event.key === 'ArrowUp') { event.preventDefault(); focusAt(event.currentTarget, -1) }
          else if (event.key === 'Home') { event.preventDefault(); focusAt(event.currentTarget, 'first') }
          else if (event.key === 'End') { event.preventDefault(); focusAt(event.currentTarget, 'last') }
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { const target = event.target as HTMLElement; if (target.closest('.app-menu-submenu-v4') === null) { event.preventDefault(); moveTop(event.key === 'ArrowLeft' ? -1 : 1, true) } }
        }}>{renderNodes(active!.children)}</div> : null}
      </div>
    })}
  </div>
}
