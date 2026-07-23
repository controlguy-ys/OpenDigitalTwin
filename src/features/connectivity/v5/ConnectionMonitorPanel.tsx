import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'

import type { ConnectivityPresentationStoreV1 } from './connectivity-presentation-store.js'
import { connectionMonitorRowsV1, type ConnectionMonitorRowV1 } from './connection-monitor-model.js'

export interface ConnectionMonitorPanelPropsV1 {
  readonly store: ConnectivityPresentationStoreV1
  readonly formatTimestamp?: (timestampMs: number | null) => string
  readonly compact?: boolean
}

function defaultTimestamp(timestampMs: number | null): string {
  return timestampMs === null ? '—' : new Date(timestampMs).toLocaleString()
}

function ConnectionMonitorDetails({ details }: { readonly details: ConnectionMonitorRowV1['details'] }): ReactNode {
  return <details className="connection-monitor-details">
    <summary>Details</summary>
    <dl>{details.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
  </details>
}

function ConnectionMonitorTable({ rows, formatTimestamp }: { readonly rows: readonly ConnectionMonitorRowV1[]; readonly formatTimestamp: (timestampMs: number | null) => string }): ReactNode {
  return <div className="connection-monitor-table-wrap"><table className="connection-monitor-table"><thead><tr><th>Component</th><th>State</th><th>Endpoint</th><th>Last update</th><th>Quality</th><th>Error</th><th>Details</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.component}</td><td>{row.state}</td><td>{row.endpoint ?? '—'}</td><td>{formatTimestamp(row.lastUpdateAtMs)}</td><td>{row.quality ?? '—'}</td><td>{row.error === null ? '—' : `${row.error.code}: ${row.error.message}`}</td><td><ConnectionMonitorDetails details={row.details} /></td></tr>)}</tbody></table></div>
}

function ConnectionMonitorCards({ rows, formatTimestamp }: { readonly rows: readonly ConnectionMonitorRowV1[]; readonly formatTimestamp: (timestampMs: number | null) => string }): ReactNode {
  return <div className="connection-monitor-cards">{rows.map((row) => <article className="connection-monitor-card" key={row.id}><dl><div><dt>Component</dt><dd>{row.component}</dd></div><div><dt>State</dt><dd>{row.state}</dd></div><div><dt>Endpoint</dt><dd>{row.endpoint ?? '—'}</dd></div><div><dt>Last update</dt><dd>{formatTimestamp(row.lastUpdateAtMs)}</dd></div><div><dt>Quality</dt><dd>{row.quality ?? '—'}</dd></div><div><dt>Error</dt><dd>{row.error === null ? '—' : `${row.error.code}: ${row.error.message}`}</dd></div></dl><ConnectionMonitorDetails details={row.details} /></article>)}</div>
}

export function ConnectionMonitorPanel({ store, formatTimestamp = defaultTimestamp, compact = false }: ConnectionMonitorPanelPropsV1): ReactNode {
  const presentation = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const [open, setOpen] = useState(false)
  const openerRef = useRef<HTMLButtonElement | null>(null)
  const monitorDemandActiveRef = useRef(false)
  const rows = connectionMonitorRowsV1(presentation)

  const enableMonitorDemand = useCallback((): void => {
    if (monitorDemandActiveRef.current) return
    monitorDemandActiveRef.current = true
    store.setMonitorOpen(true)
  }, [store])
  const disableMonitorDemand = useCallback((): void => {
    if (!monitorDemandActiveRef.current) return
    monitorDemandActiveRef.current = false
    store.setMonitorOpen(false)
  }, [store])
  const close = useCallback((): void => {
    disableMonitorDemand()
    setOpen(false)
    const opener = openerRef.current
    if (opener?.isConnected) opener.focus()
  }, [disableMonitorDemand])
  const openMonitor = useCallback((event: React.MouseEvent<HTMLButtonElement>): void => {
    openerRef.current = event.currentTarget
    enableMonitorDemand()
    setOpen(true)
  }, [enableMonitorDemand])

  useEffect(() => {
    if (!open) return undefined
    enableMonitorDemand()
    return () => disableMonitorDemand()
  }, [disableMonitorDemand, enableMonitorDemand, open])

  return <>
    <button aria-controls="connection-monitor-v1" aria-expanded={open} className="connection-monitor-trigger" onClick={openMonitor} type="button">Connection Monitor</button>
    {!open ? null : <aside aria-label="Connection Monitor" className={`connection-monitor-panel${compact ? ' is-compact' : ''}`} id="connection-monitor-v1" role="complementary">
      <header><div><p>Connectivity</p><h2>Connection Monitor</h2></div><button aria-label="Close Connection Monitor" onClick={close} type="button">Close</button></header>
      {presentation.transportError === null ? null : <p className="connection-monitor-transport-error" role="status">{presentation.transportError}</p>}
      <ConnectionMonitorTable formatTimestamp={formatTimestamp} rows={rows} />
      <ConnectionMonitorCards formatTimestamp={formatTimestamp} rows={rows} />
    </aside>}
  </>
}
