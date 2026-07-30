import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'

import type { OpcUaNodeAddressV1 } from '../../../core/project-v5/index.js'
import type {
  OpcUaAddressSpaceBrowseNodeV1,
  OpcUaAddressSpaceBrowseResponseV1,
} from '../../../core/runtime-protocol/opcua-connectivity-v1.js'
import { ModalDialogV6 } from '../../ui/v6/ModalDialogV6.js'

const OBJECTS_NODE_ID_V1 = 'ns=0;i=85'
const BROWSE_PAGE_SIZE_V1 = 25

export interface OpcUaAddressSpaceBrowsePortV1 {
  browseAddressSpace(request: Readonly<{
    readonly endpointId: string
    readonly parentNodeId: string | null
    readonly limit: number
    readonly continuationToken: string | null
  }>, signal?: AbortSignal): Promise<OpcUaAddressSpaceBrowseResponseV1>
  releaseAddressSpaceBrowse(continuationToken: string, signal?: AbortSignal): Promise<void>
}

export interface OpcUaAddressSpaceBrowserDialogPropsV1 {
  readonly endpointId: string
  readonly browsePort: OpcUaAddressSpaceBrowsePortV1
  readonly onClose: () => void
  readonly onSelect: (nodeAddress: OpcUaNodeAddressV1) => void
  readonly triggerRef?: RefObject<HTMLElement | null>
}

interface AddressTreeRowV1 {
  readonly rowId: string
  readonly parentRowId: string | null
  readonly node: OpcUaAddressSpaceBrowseNodeV1
  readonly children: readonly AddressTreeRowV1[] | null
  readonly expanded: boolean
  readonly loading: boolean
  readonly continuationToken: string | null
}

interface VisibleAddressTreeRowV1 {
  readonly row: AddressTreeRowV1
  readonly level: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function rowId(parentRowId: string | null, sessionNodeId: string): string {
  return `${parentRowId ?? 'Objects'}>${sessionNodeId}`
}

function createRows(
  parentRowId: string | null,
  nodes: readonly OpcUaAddressSpaceBrowseNodeV1[],
): readonly AddressTreeRowV1[] {
  return nodes.map((node) => Object.freeze({
    rowId: rowId(parentRowId, node.sessionNodeId),
    parentRowId,
    node,
    children: null,
    expanded: false,
    loading: false,
    continuationToken: null,
  }))
}

function replaceRow(
  rows: readonly AddressTreeRowV1[],
  targetRowId: string,
  update: (row: AddressTreeRowV1) => AddressTreeRowV1,
): readonly AddressTreeRowV1[] {
  return rows.map((row) => {
    if (row.rowId === targetRowId) return update(row)
    if (row.children === null) return row
    const children = replaceRow(row.children, targetRowId, update)
    return children === row.children ? row : Object.freeze({ ...row, children })
  })
}

function findRow(rows: readonly AddressTreeRowV1[], targetRowId: string | null): AddressTreeRowV1 | null {
  if (targetRowId === null) return null
  for (const row of rows) {
    if (row.rowId === targetRowId) return row
    const descendant = row.children === null ? null : findRow(row.children, targetRowId)
    if (descendant !== null) return descendant
  }
  return null
}

function rowMatchesFilter(row: AddressTreeRowV1, normalizedFilter: string): boolean {
  if (normalizedFilter.length === 0) return true
  return [row.node.browseName, row.node.displayName, row.node.sessionNodeId, row.node.nodeClass]
    .some((value) => value.toLocaleLowerCase().includes(normalizedFilter))
}

function visibleRows(
  rows: readonly AddressTreeRowV1[],
  normalizedFilter: string,
  level = 1,
): readonly VisibleAddressTreeRowV1[] {
  const result: VisibleAddressTreeRowV1[] = []
  for (const row of rows) {
    const descendants = row.children === null ? [] : visibleRows(row.children, normalizedFilter, level + 1)
    const visible = rowMatchesFilter(row, normalizedFilter) || descendants.length > 0
    if (!visible) continue
    result.push(Object.freeze({ row, level }))
    if (row.expanded || normalizedFilter.length > 0) result.push(...descendants)
  }
  return result
}

function responseMatches(
  response: OpcUaAddressSpaceBrowseResponseV1,
  endpointId: string,
  parentNodeId: string | null,
): boolean {
  return response.endpointId === endpointId
    && response.parentNodeId === (parentNodeId ?? OBJECTS_NODE_ID_V1)
}

export function OpcUaAddressSpaceBrowserDialogV1({
  endpointId,
  browsePort,
  onClose,
  onSelect,
  triggerRef,
}: OpcUaAddressSpaceBrowserDialogPropsV1): ReactNode {
  const [rows, setRows] = useState<readonly AddressTreeRowV1[]>([])
  const [rootLoading, setRootLoading] = useState(true)
  const [rootContinuationToken, setRootContinuationToken] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [activeRowId, setActiveRowId] = useState<string | null>(null)
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const controllersRef = useRef(new Set<AbortController>())
  const continuationTokensRef = useRef(new Set<string>())
  const mountedRef = useRef(true)
  const operationGenerationRef = useRef(0)
  const normalizedFilter = filter.trim().toLocaleLowerCase()
  const flattenedRows = useMemo(() => visibleRows(rows, normalizedFilter), [rows, normalizedFilter])
  const selectedRow = findRow(rows, selectedRowId)

  const focusRow = (targetRowId: string | null): void => {
    if (targetRowId === null) return
    setActiveRowId(targetRowId)
    window.requestAnimationFrame(() => rowRefs.current.get(targetRowId)?.focus())
  }

  const releaseContinuations = (): void => {
    const tokens = [...continuationTokensRef.current]
    continuationTokensRef.current.clear()
    for (const token of tokens) void browsePort.releaseAddressSpaceBrowse(token).catch(() => undefined)
  }

  const requestRows = (
    parentRowId: string | null,
    parentNodeId: string | null,
    continuationToken: string | null,
  ): void => {
    const controller = new AbortController()
    const generation = operationGenerationRef.current
    controllersRef.current.add(controller)
    setError(null)
    if (parentRowId === null) setRootLoading(true)
    else setRows((current) => replaceRow(current, parentRowId, (row) => Object.freeze({ ...row, loading: true })))
    void browsePort.browseAddressSpace({
      endpointId,
      parentNodeId,
      limit: BROWSE_PAGE_SIZE_V1,
      continuationToken,
    }, controller.signal).then((response) => {
      if (!mountedRef.current || operationGenerationRef.current !== generation) return
      if (!responseMatches(response, endpointId, parentNodeId)) throw new Error('OPC_UA_BROWSE_RESPONSE_INVALID')
      if (continuationToken !== null) continuationTokensRef.current.delete(continuationToken)
      if (response.continuationToken !== null) continuationTokensRef.current.add(response.continuationToken)
      const additions = createRows(parentRowId, response.nodes)
      if (parentRowId === null) {
        setRows((current) => [...current, ...additions])
        setRootContinuationToken(response.continuationToken)
      } else {
        setRows((current) => replaceRow(current, parentRowId, (row) => Object.freeze({
          ...row,
          children: [...(row.children ?? []), ...additions],
          continuationToken: response.continuationToken,
          loading: false,
          expanded: true,
        })))
      }
      if (additions[0] !== undefined) setActiveRowId((current) => current ?? additions[0]!.rowId)
    }).catch((browseError: unknown) => {
      if (!mountedRef.current || operationGenerationRef.current !== generation || (browseError instanceof Error && browseError.name === 'AbortError')) return
      setError(errorMessage(browseError))
      if (parentRowId !== null) setRows((current) => replaceRow(current, parentRowId, (row) => Object.freeze({ ...row, loading: false })))
    }).finally(() => {
      controllersRef.current.delete(controller)
      if (mountedRef.current && operationGenerationRef.current === generation && parentRowId === null) setRootLoading(false)
    })
  }

  useEffect(() => {
    requestRows(null, null, null)
    return () => {
      mountedRef.current = false
      operationGenerationRef.current += 1
      for (const controller of controllersRef.current) controller.abort()
      controllersRef.current.clear()
      releaseContinuations()
    }
  }, [])

  useEffect(() => {
    if (activeRowId !== null && flattenedRows.some(({ row }) => row.rowId === activeRowId)) return
    setActiveRowId(flattenedRows[0]?.row.rowId ?? null)
  }, [activeRowId, flattenedRows])

  const expand = (row: AddressTreeRowV1): void => {
    if (!row.node.hasChildren || row.loading) return
    if (row.children === null) {
      requestRows(row.rowId, row.node.sessionNodeId, null)
      return
    }
    setRows((current) => replaceRow(current, row.rowId, (currentRow) => Object.freeze({ ...currentRow, expanded: true })))
  }

  const collapse = (row: AddressTreeRowV1): void => {
    if (!row.node.hasChildren || !row.expanded) return
    setRows((current) => replaceRow(current, row.rowId, (currentRow) => Object.freeze({ ...currentRow, expanded: false })))
  }

  const selectRow = (row: AddressTreeRowV1): void => {
    setSelectedRowId(row.rowId)
    setActiveRowId(row.rowId)
  }

  const applySelectedNode = (): void => {
    if (selectedRow?.node.nodeAddress === null || selectedRow === null) return
    onSelect(selectedRow.node.nodeAddress)
  }

  const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: AddressTreeRowV1): void => {
    const index = flattenedRows.findIndex(({ row: visibleRow }) => visibleRow.rowId === row.rowId)
    const next = flattenedRows[index + 1]?.row
    const previous = flattenedRows[index - 1]?.row
    if (event.key === 'ArrowDown') { event.preventDefault(); focusRow(next?.rowId ?? row.rowId); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); focusRow(previous?.rowId ?? row.rowId); return }
    if (event.key === 'Home') { event.preventDefault(); focusRow(flattenedRows[0]?.row.rowId ?? row.rowId); return }
    if (event.key === 'End') { event.preventDefault(); focusRow(flattenedRows.at(-1)?.row.rowId ?? row.rowId); return }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      if (!row.expanded) expand(row)
      else focusRow(row.children?.[0]?.rowId ?? row.rowId)
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (row.expanded) collapse(row)
      else focusRow(row.parentRowId)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (row.node.hasChildren) {
        if (row.expanded) collapse(row)
        else expand(row)
      } else {
        selectRow(row)
        if (row.node.nodeAddress !== null) onSelect(row.node.nodeAddress)
      }
    }
  }

  const copySelectedNodeId = (): void => {
    if (selectedRow === null) return
    if (navigator.clipboard === undefined) {
      setError('Clipboard access is unavailable.')
      return
    }
    setError(null)
    void navigator.clipboard.writeText(selectedRow.node.sessionNodeId).catch((copyError: unknown) => setError(errorMessage(copyError)))
  }

  return <ModalDialogV6
    className="opcua-address-browser-dialog"
    footer={<footer className="opcua-settings-footer">
      <button onClick={onClose} type="button">Close</button>
      <button disabled={selectedRow === null} onClick={copySelectedNodeId} type="button">Copy NodeId</button>
      <button disabled={selectedRow?.node.nodeAddress === null || selectedRow === null} onClick={applySelectedNode} type="button">Select Node</button>
    </footer>}
    header={<header className="opcua-settings-header">
      <div><p>Connectivity / Mapping</p><h2 id="opcua-address-space-browser-title">OPC UA Address Space</h2></div>
      <p>Read-only browse session</p>
    </header>}
    nestedDialog={{ parentDialogId: 'binding-editor-v1-title' }}
    onClose={onClose}
    size="wide"
    testId="opcua-address-space-browser-overlay"
    titleId="opcua-address-space-browser-title"
    {...(triggerRef === undefined ? {} : { triggerRef })}
  >
    <div className="opcua-settings-body opcua-address-browser-body">
      <label className="opcua-address-browser-filter"><span>Filter loaded nodes</span><input aria-label="Filter loaded nodes" onChange={(event) => setFilter(event.currentTarget.value)} value={filter} /></label>
      <section className="opcua-address-browser-tree-panel" aria-label="Address Space">
        <div aria-label="OPC UA Address Space" className="opcua-address-browser-tree" role="tree">
          {rootLoading ? <p role="status">Loading Objects…</p> : null}
          {flattenedRows.map(({ row, level }) => <div
            aria-expanded={row.node.hasChildren ? row.expanded : undefined}
            aria-level={level}
            aria-selected={selectedRowId === row.rowId}
            className="opcua-address-browser-row"
            key={row.rowId}
            onClick={() => selectRow(row)}
            onDoubleClick={() => { if (row.node.hasChildren) expand(row); else if (row.node.nodeAddress !== null) onSelect(row.node.nodeAddress) }}
            onKeyDown={(event) => onTreeKeyDown(event, row)}
            ref={(element) => { if (element === null) rowRefs.current.delete(row.rowId); else rowRefs.current.set(row.rowId, element) }}
            role="treeitem"
            style={{ paddingInlineStart: `${(level - 1) * 18 + 8}px` }}
            tabIndex={activeRowId === row.rowId ? 0 : -1}
          >
            <span aria-hidden="true" className="opcua-address-browser-expander">{row.node.hasChildren ? (row.expanded ? '▾' : '▸') : '•'}</span>
            <span>{row.node.displayName}</span><span className="opcua-address-browser-node-class">{row.node.nodeClass}</span>
            {row.loading ? <span role="status">Loading…</span> : null}
            {row.expanded && row.continuationToken !== null ? <button disabled={row.loading} onClick={(event) => { event.stopPropagation(); requestRows(row.rowId, row.node.sessionNodeId, row.continuationToken) }} type="button">Load more {row.node.displayName}</button> : null}
          </div>)}
          {rootContinuationToken !== null ? <button disabled={rootLoading} onClick={() => requestRows(null, null, rootContinuationToken)} type="button">Load more Objects</button> : null}
          {!rootLoading && flattenedRows.length === 0 ? <p role="status">No loaded nodes match this filter.</p> : null}
        </div>
      </section>
      <section aria-labelledby="opcua-address-browser-details-title" className="opcua-address-browser-details">
        <h3 id="opcua-address-browser-details-title">Node details</h3>
        {selectedRow === null ? <p>Select a loaded node to inspect it.</p> : <dl>
          <div><dt>Browse name</dt><dd>{selectedRow.node.browseName}</dd></div>
          <div><dt>Session NodeId</dt><dd>{selectedRow.node.sessionNodeId}</dd></div>
          <div><dt>Node class</dt><dd>{selectedRow.node.nodeClass}</dd></div>
          <div><dt>Stable node address</dt><dd>{selectedRow.node.nodeAddress === null ? 'Unavailable for this node.' : `${selectedRow.node.nodeAddress.namespaceUri} / ${selectedRow.node.nodeAddress.identifierType} / ${selectedRow.node.nodeAddress.identifier}`}</dd></div>
        </dl>}
      </section>
      {error === null ? null : <p role="alert">{error}</p>}
    </div>
  </ModalDialogV6>
}
