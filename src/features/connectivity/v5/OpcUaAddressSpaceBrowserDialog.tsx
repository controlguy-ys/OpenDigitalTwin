import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

import type { OpcUaNodeAddressV1 } from '../../../core/project-v5/index.js'
import type { OpcUaAddressSpaceBrowseResponseV1 } from '../../../core/runtime-protocol/opcua-connectivity-v1.js'
import { ModalDialogV6 } from '../../ui/v6/ModalDialogV6.js'
import { addressTreeNavigationV1, createAddressTreeRowsV1, findAddressTreeRowV1, replaceAddressTreeRowV1, visibleAddressTreeRowsV1, type AddressTreeRowV1 } from './opcua-address-space-tree-model.js'

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

export interface OpcUaAddressSpaceBrowserDialogPropsV1 { readonly endpointId: string; readonly browsePort: OpcUaAddressSpaceBrowsePortV1; readonly onClose: () => void; readonly onSelect: (nodeAddress: OpcUaNodeAddressV1) => void; readonly triggerRef?: RefObject<HTMLElement | null> }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
  const [closing, setClosing] = useState(false)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const controllersRef = useRef(new Set<AbortController>())
  const continuationTokensRef = useRef(new Set<string>())
  const mountedRef = useRef(true)
  const operationGenerationRef = useRef(0)
  const normalizedFilter = filter.trim().toLocaleLowerCase()
  const flattenedRows = useMemo(() => visibleAddressTreeRowsV1(rows, normalizedFilter), [rows, normalizedFilter])
  const selectedRow = findAddressTreeRowV1(rows, selectedRowId)

  const focusRow = (targetRowId: string | null): void => {
    if (targetRowId === null) return
    setActiveRowId(targetRowId)
    window.requestAnimationFrame(() => rowRefs.current.get(targetRowId)?.focus())
  }

  const releaseContinuations = async (showError: boolean): Promise<boolean> => {
    const tokens = [...continuationTokensRef.current]
    const results = await Promise.allSettled(tokens.map(async (token) => {
      await browsePort.releaseAddressSpaceBrowse(token)
      return token
    }))
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    for (const result of results) if (result.status === 'fulfilled') continuationTokensRef.current.delete(result.value)
    if (failures.length === 0) return true
    if (showError && mountedRef.current) setError(`OPC_UA_BROWSE_RELEASE_FAILED: ${errorMessage(failures[0]!.reason)}`)
    return false
  }

  const close = (): void => {
    if (closing) return
    operationGenerationRef.current += 1
    for (const controller of controllersRef.current) controller.abort()
    controllersRef.current.clear()
    setClosing(true)
    void releaseContinuations(true).then((released) => {
      if (released) onClose()
      else if (mountedRef.current) setClosing(false)
    })
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
    else setRows((current) => replaceAddressTreeRowV1(current, parentRowId, (row) => Object.freeze({ ...row, loading: true })))
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
      const additions = createAddressTreeRowsV1(parentRowId, response.nodes)
      if (parentRowId === null) {
        setRows((current) => [...current, ...additions])
        setRootContinuationToken(response.continuationToken)
      } else {
        setRows((current) => replaceAddressTreeRowV1(current, parentRowId, (row) => Object.freeze({
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
      if (parentRowId !== null) setRows((current) => replaceAddressTreeRowV1(current, parentRowId, (row) => Object.freeze({ ...row, loading: false })))
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
      void releaseContinuations(false)
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
    setRows((current) => replaceAddressTreeRowV1(current, row.rowId, (currentRow) => Object.freeze({ ...currentRow, expanded: true })))
  }

  const collapse = (row: AddressTreeRowV1): void => {
    if (!row.node.hasChildren || !row.expanded) return
    setRows((current) => replaceAddressTreeRowV1(current, row.rowId, (currentRow) => Object.freeze({ ...currentRow, expanded: false })))
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
    const action = addressTreeNavigationV1(event.key, flattenedRows, row)
    if (action === null) return
    event.preventDefault()
    if (action.type === 'focus') focusRow(action.rowId)
    else if (action.type === 'expand') expand(action.row)
    else if (action.type === 'collapse') collapse(action.row)
    else { selectRow(action.row); if (action.row.node.nodeAddress !== null) onSelect(action.row.node.nodeAddress) }
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
    busy={closing}
    className="opcua-address-browser-dialog"
    footer={<footer className="opcua-settings-footer">
      <button disabled={closing} onClick={close} type="button">Close</button>
      <button disabled={closing || selectedRow === null} onClick={copySelectedNodeId} type="button">Copy NodeId</button>
      <button disabled={closing || selectedRow?.node.nodeAddress === null || selectedRow === null} onClick={applySelectedNode} type="button">Select Node</button>
    </footer>}
    header={<header className="opcua-settings-header">
      <div><p>Connectivity / Mapping</p><h2 id="opcua-address-space-browser-title">OPC UA Address Space</h2></div>
      <p>Read-only browse session</p>
    </header>}
    nestedDialog={{ parentDialogId: 'binding-editor-v1-title' }}
    onClose={close}
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
