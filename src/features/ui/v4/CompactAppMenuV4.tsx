import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { AppCommandBindingsV4 } from '../../commands/v4/app-command-runtime.js'
import { AppCommandMenuItemV4 } from './AppCommandMenuItemV4.js'
import type { AppMenuNavigationPropsV4, AppMenuNodeV4, AppMenuSectionModelV4 } from './app-menu-model.js'

export interface CompactAppMenuPropsV4 extends AppMenuNavigationPropsV4 {
  readonly commandBindings: AppCommandBindingsV4
  readonly model: readonly AppMenuSectionModelV4[]
}
function focusItems(menu: HTMLElement, direction: number | 'first' | 'last'): void {
  const nodes = Array.from(menu.querySelectorAll(':scope > [role="menuitem"], :scope > [role="menuitemcheckbox"], :scope > [role="menuitemradio"]')) as HTMLElement[]
  if (!nodes.length) return
  if (direction === 'first') return void nodes[0]?.focus()
  if (direction === 'last') return void nodes.at(-1)?.focus()
  const at = nodes.indexOf(document.activeElement as HTMLElement)
  nodes[(at + direction + nodes.length) % nodes.length]?.focus()
}
export function CompactAppMenuV4({ commandBindings, model, openSection, onOpenSectionChange, onPreviewSection }: CompactAppMenuPropsV4): ReactNode {
  const root = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null); const [expanded, setExpanded] = useState(false); const [submenu, setSubmenu] = useState<string | null>(null); const id = useId().replace(/:/g, '')
  const section = openSection === null ? null : model.find((item) => item.id === openSection) ?? null
  const close = (restore = false): void => { if (restore) trigger.current?.focus(); setExpanded(false); setSubmenu(null); onOpenSectionChange(null) }
  useEffect(() => { onPreviewSection(openSection) }, [onPreviewSection, openSection])
  useEffect(() => { if (openSection !== null && section === null) onOpenSectionChange(null); if (openSection !== null) setExpanded(true) }, [onOpenSectionChange, openSection, section])
  useEffect(() => { if (!expanded) return; const outside = (event: PointerEvent): void => { if (root.current?.contains(event.target as Node) !== true) close(false) }; document.addEventListener('pointerdown', outside, true); return () => document.removeEventListener('pointerdown', outside, true) }, [expanded])
  const onOutcome = (_commandId: string, result: 'completed' | 'cancelled' | 'ignored' | 'failed'): void => { if (result === 'completed') close(true) }
  const openCategory = (sectionId: AppMenuSectionModelV4['id']): void => {
    onOpenSectionChange(sectionId)
    queueMicrotask(() => document.getElementById(`${id}-menu`)?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-haspopup])')?.focus())
  }
  const renderNodes = (nodes: readonly AppMenuNodeV4[]): ReactNode => nodes.map((node) => {
    if (node.kind === 'separator') return <div key={node.id} role="separator" className="app-menu-separator-v4" />
    if (node.kind === 'command') return <AppCommandMenuItemV4 key={node.commandId} commandBindings={commandBindings} commandId={node.commandId} onOutcome={onOutcome} />
    const open = submenu === node.id; const menuId = `${id}-${node.id}`
    return <div key={node.id} className="app-menu-submenu-v4">
      <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => setSubmenu(open ? null : node.id)} onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); setSubmenu(node.id)
          queueMicrotask(() => document.getElementById(menuId)?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus())
        }
      }}>{node.label}</button>
      {open ? <div id={menuId} role="menu" aria-label={node.label} onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault(); event.stopPropagation(); setSubmenu(null)
          ;(event.currentTarget.parentElement?.querySelector('button') as HTMLButtonElement | null)?.focus()
        }
      }}>{renderNodes(node.children)}</div> : null}
    </div>
  })
  const keyNavigation = (event: KeyboardEvent<HTMLDivElement>, back: () => void): void => {
    if (event.key === 'Escape') { event.preventDefault(); close(true); return }
    if (event.key === 'Tab') { close(false); return }
    if (event.key === 'ArrowDown') { event.preventDefault(); focusItems(event.currentTarget, 1); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); focusItems(event.currentTarget, -1); return }
    if (event.key === 'Home') { event.preventDefault(); focusItems(event.currentTarget, 'first'); return }
    if (event.key === 'End') { event.preventDefault(); focusItems(event.currentTarget, 'last'); return }
    if (event.key === 'ArrowLeft') { event.preventDefault(); back() }
  }
  return <div ref={root} className="compact-app-menu-v4">
    <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={expanded} aria-controls={`${id}-menu`} onClick={() => {
      const next = !expanded; setExpanded(next)
      if (!next) onOpenSectionChange(null)
      else queueMicrotask(() => document.getElementById(`${id}-menu`)?.querySelector<HTMLElement>('[role="menuitem"]')?.focus())
    }}>Menu</button>
    {expanded ? <div id={`${id}-menu`} role="menu" aria-label="Application menu" className="app-menu-popup-v4" onKeyDown={(event) => keyNavigation(event, () => {
      onOpenSectionChange(null)
      queueMicrotask(() => document.getElementById(`${id}-menu`)?.querySelector<HTMLElement>('[role="menuitem"]')?.focus())
    })}>
      {section === null ? model.map((item) => <button key={item.id} type="button" role="menuitem" onClick={() => openCategory(item.id)} onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') {
          event.preventDefault(); openCategory(item.id)
        }
      }}>{item.label}</button>) : <div role="menu" aria-label={section.label} onKeyDown={(event) => keyNavigation(event, () => {
        onOpenSectionChange(null)
        queueMicrotask(() => document.getElementById(`${id}-menu`)?.querySelector<HTMLElement>('[role="menuitem"]')?.focus())
      })}>{renderNodes(section.children)}</div>}
    </div> : null}
  </div>
}
