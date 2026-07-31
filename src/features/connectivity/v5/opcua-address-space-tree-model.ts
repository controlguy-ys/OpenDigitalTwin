import type { OpcUaAddressSpaceBrowseNodeV1 } from '../../../core/runtime-protocol/opcua-connectivity-v1.js'

export interface AddressTreeRowV1 {
  readonly rowId: string
  readonly parentRowId: string | null
  readonly node: OpcUaAddressSpaceBrowseNodeV1
  readonly children: readonly AddressTreeRowV1[] | null
  readonly expanded: boolean
  readonly loading: boolean
  readonly continuationToken: string | null
}

export interface VisibleAddressTreeRowV1 { readonly row: AddressTreeRowV1; readonly level: number }
export type AddressTreeNavigationV1 = Readonly<{ readonly type: 'focus'; readonly rowId: string }> | Readonly<{ readonly type: 'expand' | 'collapse' | 'select'; readonly row: AddressTreeRowV1 }> | null

function rowId(parentRowId: string | null, sessionNodeId: string): string { return `${parentRowId ?? 'Objects'}>${sessionNodeId}` }

export function createAddressTreeRowsV1(parentRowId: string | null, nodes: readonly OpcUaAddressSpaceBrowseNodeV1[]): readonly AddressTreeRowV1[] {
  return nodes.map((node) => Object.freeze({ rowId: rowId(parentRowId, node.sessionNodeId), parentRowId, node, children: null, expanded: false, loading: false, continuationToken: null }))
}

export function replaceAddressTreeRowV1(rows: readonly AddressTreeRowV1[], targetRowId: string, update: (row: AddressTreeRowV1) => AddressTreeRowV1): readonly AddressTreeRowV1[] {
  return rows.map((row) => {
    if (row.rowId === targetRowId) return update(row)
    if (row.children === null) return row
    const children = replaceAddressTreeRowV1(row.children, targetRowId, update)
    return children === row.children ? row : Object.freeze({ ...row, children })
  })
}

export function findAddressTreeRowV1(rows: readonly AddressTreeRowV1[], targetRowId: string | null): AddressTreeRowV1 | null {
  if (targetRowId === null) return null
  for (const row of rows) {
    if (row.rowId === targetRowId) return row
    const descendant = row.children === null ? null : findAddressTreeRowV1(row.children, targetRowId)
    if (descendant !== null) return descendant
  }
  return null
}

function matchesFilter(row: AddressTreeRowV1, filter: string): boolean { return filter.length === 0 || [row.node.browseName, row.node.displayName, row.node.sessionNodeId, row.node.nodeClass].some((value) => value.toLocaleLowerCase().includes(filter)) }

export function visibleAddressTreeRowsV1(rows: readonly AddressTreeRowV1[], filter: string, level = 1): readonly VisibleAddressTreeRowV1[] {
  const result: VisibleAddressTreeRowV1[] = []
  for (const row of rows) {
    const descendants = row.children === null ? [] : visibleAddressTreeRowsV1(row.children, filter, level + 1)
    if (!matchesFilter(row, filter) && descendants.length === 0) continue
    result.push(Object.freeze({ row, level }))
    if (row.expanded || filter.length > 0) result.push(...descendants)
  }
  return result
}

export function addressTreeNavigationV1(key: string, rows: readonly VisibleAddressTreeRowV1[], row: AddressTreeRowV1): AddressTreeNavigationV1 {
  const index = rows.findIndex(({ row: visibleRow }) => visibleRow.rowId === row.rowId)
  if (key === 'ArrowDown') return Object.freeze({ type: 'focus', rowId: rows[index + 1]?.row.rowId ?? row.rowId })
  if (key === 'ArrowUp') return Object.freeze({ type: 'focus', rowId: rows[index - 1]?.row.rowId ?? row.rowId })
  if (key === 'Home') return Object.freeze({ type: 'focus', rowId: rows[0]?.row.rowId ?? row.rowId })
  if (key === 'End') return Object.freeze({ type: 'focus', rowId: rows.at(-1)?.row.rowId ?? row.rowId })
  if (key === 'ArrowRight') return row.expanded ? Object.freeze({ type: 'focus', rowId: row.children?.[0]?.rowId ?? row.rowId }) : Object.freeze({ type: 'expand', row })
  if (key === 'ArrowLeft') return row.expanded ? Object.freeze({ type: 'collapse', row }) : row.parentRowId === null ? null : Object.freeze({ type: 'focus', rowId: row.parentRowId })
  if (key === 'Enter') return row.node.hasChildren ? Object.freeze({ type: row.expanded ? 'collapse' : 'expand', row }) : Object.freeze({ type: 'select', row })
  return null
}
