import { useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronRight, Eye, EyeOff } from 'lucide-react'

import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import type { V6WorkcellSelection } from '../../interaction/v6/workcell-selection-v6.js'
import { resolveSceneContextTargetV6, type SceneContextTargetV6 } from './SceneContextMenuV6.js'
import { buildSceneTreeRowsV6, filterSceneTreeRowsV6, hasSceneTreeChildrenV6, type SceneTreeRowV6 } from './scene-tree-model-v6.js'

export interface SceneExplorerV6Props {
  readonly project: WorkcellProjectV5
  readonly selection: V6WorkcellSelection | null
  readonly onSelectionChange: (selection: V6WorkcellSelection) => void
  readonly onToggleVisibility?: (selection: Extract<V6WorkcellSelection, { readonly kind: 'robot' | 'entity' | 'group' }>, visible: boolean) => void
  readonly onContextMenu?: (target: SceneContextTargetV6) => void
}

function selectionForRow(row: SceneTreeRowV6): V6WorkcellSelection | null {
  if (row.kind === 'robot') return { kind: 'robot', id: row.id }
  if (row.kind === 'object') return { kind: 'entity', id: row.id }
  if (row.kind === 'group') return { kind: 'group', id: row.id }
  if (row.kind === 'frame') return { kind: 'frame', id: row.id }
  return null
}

function selectionMatches(row: SceneTreeRowV6, selection: V6WorkcellSelection | null): boolean {
  const candidate = selectionForRow(row)
  return candidate !== null && candidate.kind === selection?.kind && candidate.id === selection.id
}

export function SceneExplorerV6({
  project,
  selection,
  onSelectionChange,
  onToggleVisibility,
  onContextMenu,
}: SceneExplorerV6Props): ReactNode {
  const rows = useMemo(() => buildSceneTreeRowsV6(project), [project])
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(rows.filter((row) => hasSceneTreeChildrenV6(rows, row.key)).map((row) => row.key)))
  const filteredRows = useMemo(() => filterSceneTreeRowsV6(rows, query), [query, rows])
  const searching = query.trim().length > 0
  const visibleRows = useMemo(() => searching ? filteredRows : filteredRows.filter((row) => {
    let parentKey = row.parentKey
    while (parentKey !== null) {
      if (!expanded.has(parentKey)) return false
      parentKey = rows.find((candidate) => candidate.key === parentKey)?.parentKey ?? null
    }
    return true
  }), [expanded, filteredRows, rows, searching])
  const [activeKey, setActiveKey] = useState(rows[0]?.key ?? '')
  const toggle = (key: string) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  const activate = (row: SceneTreeRowV6): void => {
    setActiveKey(row.key)
    const item = selectionForRow(row)
    if (item !== null) onSelectionChange(item)
  }
  const requestContext = (row: SceneTreeRowV6): void => {
    const item = selectionForRow(row)
    if (item !== null) onContextMenu?.(resolveSceneContextTargetV6(project, item))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const focusedRowKey = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>('[data-row-key]')?.dataset.rowKey
      : undefined
    const focusedRow = focusedRowKey === undefined
      ? undefined
      : visibleRows.find((row) => row.key === focusedRowKey)
    const nestedControl = event.target instanceof HTMLElement
      && event.target.closest('[data-row-key]') !== event.target
      && event.target.matches('button, input, select, textarea, [contenteditable="true"]')
    const focusRow = (key: string): void => {
      event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]')
        .forEach((element) => { if (element.dataset.rowKey === key) element.focus() })
    }
    const currentIndex = Math.max(0, visibleRows.findIndex((row) => row.key === (focusedRow?.key ?? activeKey)))
    const current = visibleRows[currentIndex]
    if (current === undefined) return
    if (nestedControl) {
      if (event.key === 'F10' && event.shiftKey) { event.preventDefault(); requestContext(current) }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      const nextKey = visibleRows[(currentIndex + step + visibleRows.length) % visibleRows.length]!.key
      setActiveKey(nextKey); focusRow(nextKey)
      return
    }
    if (event.key === 'ArrowRight' && hasSceneTreeChildrenV6(rows, current.key)) {
      event.preventDefault(); setExpanded((value) => new Set(value).add(current.key)); return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (expanded.has(current.key)) { setExpanded((value) => { const next = new Set(value); next.delete(current.key); return next }) }
      else if (current.parentKey !== null) { setActiveKey(current.parentKey); focusRow(current.parentKey) }
      return
    }
    if (event.key === 'Enter') { event.preventDefault(); activate(current); return }
    if (event.key === ' ' && current.visible !== null) {
      const item = selectionForRow(current)
      if (item?.kind === 'robot' || item?.kind === 'entity' || item?.kind === 'group') {
        event.preventDefault(); onToggleVisibility?.(item, !current.visible)
      }
      return
    }
    if (event.key === 'F10' && event.shiftKey) { event.preventDefault(); requestContext(current) }
  }
  return <section aria-label="Scene Explorer" className="v6-scene-explorer">
    <label className="v6-scene-search-label">Search scene
      <input aria-label="Search scene" onChange={(event) => setQuery(event.currentTarget.value)} role="searchbox" type="search" value={query} />
    </label>
    <div aria-label="Scene Explorer" className="v6-scene-tree" onKeyDown={onKeyDown} role="tree" tabIndex={0}>
      {visibleRows.map((row) => {
        const hasChildren = hasSceneTreeChildrenV6(rows, row.key)
        const isExpanded = expanded.has(row.key)
        const effectiveExpanded = searching || isExpanded
        return <div
          aria-expanded={hasChildren ? effectiveExpanded : undefined}
          aria-level={row.depth + 1}
          aria-selected={selectionMatches(row, selection)}
          className="v6-scene-tree-row"
          data-active={activeKey === row.key || undefined}
          data-row-key={row.key}
          key={row.key}
          onClick={() => activate(row)}
          onContextMenu={(event) => { event.preventDefault(); setActiveKey(row.key); requestContext(row) }}
          onFocus={() => setActiveKey(row.key)}
          role="treeitem"
          style={{ '--v6-tree-depth': row.depth } as CSSProperties}
          tabIndex={activeKey === row.key ? 0 : -1}
          title={row.name}
        >
          {hasChildren ? <button
            aria-expanded={effectiveExpanded}
            aria-label={`${effectiveExpanded ? 'Collapse' : 'Expand'} ${row.name}`}
            className="v6-scene-tree-disclosure"
            disabled={searching}
            onClick={(event) => { event.stopPropagation(); if (!searching) toggle(row.key) }}
            title={searching ? 'Expansion is fixed while filtering' : undefined}
            type="button"
          >
            <ChevronRight aria-hidden="true" className={effectiveExpanded ? 'is-expanded' : undefined} size={16} strokeWidth={1.75} />
          </button> : <span aria-hidden="true" className="v6-scene-tree-disclosure-placeholder" />}
          <span className="v6-scene-tree-name">{row.name}</span>
          {row.ownerLabel === null ? null : <span className="v6-scene-tree-owner">{row.ownerLabel}</span>}
          {row.visible === null ? null : <button
            aria-label={`${row.visible ? 'Hide' : 'Show'} ${row.name}`}
            className="v6-scene-tree-visibility"
            onClick={(event) => {
              event.stopPropagation()
              const item = selectionForRow(row)
              if (item?.kind === 'robot' || item?.kind === 'entity' || item?.kind === 'group') onToggleVisibility?.(item, !row.visible)
            }}
            type="button"
          >
            {row.visible ? <Eye aria-hidden="true" size={16} strokeWidth={1.75} /> : <EyeOff aria-hidden="true" size={16} strokeWidth={1.75} />}
          </button>}
        </div>
      })}
    </div>
  </section>
}
