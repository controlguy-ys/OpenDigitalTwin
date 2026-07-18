import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import type { AppCommandBindingsV4 } from '../../commands/v4/app-command-runtime.js'
import { AppCommandMenuItemV4 } from './AppCommandMenuItemV4.js'
import type { AppMenuNavigationPropsV4, AppMenuNodeV4, AppMenuSectionModelV4 } from './app-menu-model.js'

export interface CompactAppMenuPropsV4 extends AppMenuNavigationPropsV4 {
  readonly commandBindings: AppCommandBindingsV4
  readonly model: readonly AppMenuSectionModelV4[]
}
function direct(menu: HTMLElement): HTMLElement[] { return Array.from(menu.querySelectorAll<HTMLElement>('[data-menu-direct="true"]')).filter((item) => item.closest('[role="menu"]') === menu) }
function focus(menu: HTMLElement, direction: 'first' | 'last' | 1 | -1): void { const items = direct(menu); if (!items.length) return; if (direction === 'first') return void items[0]?.focus(); if (direction === 'last') return void items.at(-1)?.focus(); const index = items.indexOf(document.activeElement as HTMLElement); items[(index + direction + items.length) % items.length]?.focus() }

export function CompactAppMenuV4({ commandBindings, model, openSection, onOpenSectionChange, onPreviewSection }: CompactAppMenuPropsV4): ReactNode {
  const root = useRef<HTMLDivElement>(null); const disclosure = useRef<HTMLButtonElement>(null); const callback = useRef(onPreviewSection); const lastPreview = useRef<undefined | AppMenuNavigationPropsV4['openSection']>(undefined); const categoryRefs = useRef(new Map<string, HTMLButtonElement>()); const returnCategoryId = useRef<string | null>(null)
  const [expanded, setExpanded] = useState(false); const [submenu, setSubmenu] = useState<string | null>(null); const id = useId().replace(/:/g, '')
  const section = openSection === null ? null : model.find((candidate) => candidate.id === openSection) ?? null
  useEffect(() => { callback.current = onPreviewSection }, [onPreviewSection])
  useEffect(() => { if (lastPreview.current !== openSection) { lastPreview.current = openSection; callback.current(openSection) } }, [openSection])
  useEffect(() => { if (openSection !== null && section === null) onOpenSectionChange(null); if (section !== null) setExpanded(true); setSubmenu(null) }, [onOpenSectionChange, openSection, section])
  useEffect(() => { if (!expanded) return; const dismiss = (event: PointerEvent): void => { if (root.current?.contains(event.target as Node) !== true) { setExpanded(false); setSubmenu(null); onOpenSectionChange(null) } }; document.addEventListener('pointerdown', dismiss, true); return () => document.removeEventListener('pointerdown', dismiss, true) }, [expanded, onOpenSectionChange])
  useEffect(() => { if (section === null && returnCategoryId.current !== null) { const target = categoryRefs.current.get(returnCategoryId.current); returnCategoryId.current = null; target?.focus() } }, [section])
  const close = (restore: boolean): void => { if (restore) disclosure.current?.focus(); setExpanded(false); setSubmenu(null); onOpenSectionChange(null) }
  const rootId = `${id}-application-menu`
  const backToCategories = (restore = true): void => { setSubmenu(null); if (restore && openSection !== null) returnCategoryId.current = openSection; onOpenSectionChange(null) }
  const outcome = (_id: string, result: 'completed' | 'cancelled' | 'ignored' | 'failed'): void => { if (result === 'completed') close(true) }
  const navigate = (event: KeyboardEvent<HTMLDivElement>, onLeft: () => void): void => {
    const nested = (event.target as HTMLElement).closest('[role="menu"]') !== event.currentTarget
    if (nested) return
    if (event.key === 'Escape') { event.preventDefault(); close(true) }
    else if (event.key === 'Tab') close(false)
    else if (event.key === 'ArrowDown') { event.preventDefault(); focus(event.currentTarget, 1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); focus(event.currentTarget, -1) }
    else if (event.key === 'Home') { event.preventDefault(); focus(event.currentTarget, 'first') }
    else if (event.key === 'End') { event.preventDefault(); focus(event.currentTarget, 'last') }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); onLeft() }
  }
  const renderNodes = (items: readonly AppMenuNodeV4[]): ReactNode => items.map((node) => {
    if (node.kind === 'separator') return <div key={node.id} role="separator" className="app-menu-separator-v4" />
    if (node.kind === 'command') return <AppCommandMenuItemV4 key={node.commandId} commandBindings={commandBindings} commandId={node.commandId} onOutcome={outcome} />
    const submenuId = `${id}-${node.id}`; const triggerId = `${submenuId}-trigger`; const open = submenu === node.id
    return <div key={node.id} className="app-menu-submenu-v4"><button id={triggerId} type="button" role="menuitem" data-menu-direct="true" aria-haspopup="menu" aria-expanded={open} aria-controls={submenuId} onClick={() => setSubmenu(open ? null : node.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); setSubmenu(node.id); queueMicrotask(() => { const popup = document.getElementById(submenuId); if (popup) focus(popup, 'first') }) } }}><span>{node.label}</span><span className="app-menu-submenu-indicator-v4" aria-hidden="true" /></button>{open ? <div id={submenuId} role="menu" aria-labelledby={triggerId} onKeyDown={(event) => { if (event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); setSubmenu(null); document.getElementById(triggerId)?.focus() } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) } else if (event.key === 'Tab') { event.stopPropagation(); close(false) } else if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); focus(event.currentTarget, 1) } else if (event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); focus(event.currentTarget, -1) } else if (event.key === 'Home') { event.preventDefault(); event.stopPropagation(); focus(event.currentTarget, 'first') } else if (event.key === 'End') { event.preventDefault(); event.stopPropagation(); focus(event.currentTarget, 'last') } }}>{renderNodes(node.children)}</div> : null}</div>
  })
  return <div ref={root} className="compact-app-menu-v4"><button ref={disclosure} type="button" aria-haspopup="menu" aria-expanded={expanded} aria-controls={rootId} onClick={() => { const next = !expanded; setExpanded(next); if (!next) onOpenSectionChange(null); else queueMicrotask(() => { const popup = document.getElementById(rootId); if (popup) focus(popup, 'first') }) }}>Menu</button>{expanded ? <div id={rootId} role="menu" aria-label="Application menu" className="app-menu-popup-v4" onKeyDown={(event) => navigate(event, () => undefined)}>{section === null ? model.map((item) => { const categoryId = `${id}-${item.id}-category`; return <button key={item.id} ref={(node) => { if (node) categoryRefs.current.set(item.id, node); else categoryRefs.current.delete(item.id) }} id={categoryId} type="button" role="menuitem" data-menu-direct="true" aria-haspopup="menu" aria-expanded="false" aria-controls={`${id}-${item.id}-section`} onClick={() => { returnCategoryId.current = item.id; onOpenSectionChange(item.id); queueMicrotask(() => { const popup = document.getElementById(`${id}-${item.id}-section`); if (popup) focus(popup, 'first') }) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') { event.preventDefault(); returnCategoryId.current = item.id; onOpenSectionChange(item.id); queueMicrotask(() => { const popup = document.getElementById(`${id}-${item.id}-section`); if (popup) focus(popup, 'first') }) } }}><span>{item.label}</span><span className="app-menu-submenu-indicator-v4" aria-hidden="true" /></button> }) : <div id={`${id}-${section.id}-section`} role="menu" aria-label={section.label} onKeyDown={(event) => navigate(event, () => backToCategories(true))}>{renderNodes(section.children)}</div>}</div> : null}</div>
}
