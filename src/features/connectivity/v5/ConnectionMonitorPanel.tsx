import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from 'react'

import type { ConnectivityPresentationStoreV1 } from './connectivity-presentation-store.js'
import {
  connectionMonitorRowsV1,
  type ConnectionMonitorDetailV1,
  type ConnectionMonitorRowV1,
} from './connection-monitor-model.js'

export interface ConnectionMonitorPanelControlV1 {
  open(opener?: HTMLElement | null): void
  close(): void
}

export interface ConnectionMonitorPanelPropsV1 {
  readonly store: ConnectivityPresentationStoreV1
  readonly formatTimestamp?: (timestampMs: number | null) => string
  readonly compact?: boolean
  readonly controlRef?: Ref<ConnectionMonitorPanelControlV1>
  readonly showTrigger?: boolean
}

function defaultTimestamp(timestampMs: number | null): string {
  return timestampMs === null ? '—' : new Date(timestampMs).toLocaleString()
}

function formattedDetail(detail: ConnectionMonitorDetailV1, formatTimestamp: (timestampMs: number | null) => string): string {
  return detail.kind === 'timestamp' ? formatTimestamp(detail.timestampMs) : detail.value
}

function formattedError(row: ConnectionMonitorRowV1, formatTimestamp: (timestampMs: number | null) => string): string {
  return row.error === null
    ? '—'
    : row.id === 'web-proxy'
      ? row.error.message
    : `${row.error.code}: ${row.error.message} @ ${formatTimestamp(row.error.occurredAtMs)}`
}

function freshnessLabel(freshness: ConnectionMonitorRowV1['freshness']): string {
  return freshness === 'last-known' ? 'Last known' : freshness === 'current' ? 'Current' : 'Unavailable'
}

function ConnectionMonitorDetails({ details, formatTimestamp, rowLabel, surface }: {
  readonly details: ConnectionMonitorRowV1['details']
  readonly formatTimestamp: (timestampMs: number | null) => string
  readonly rowLabel: string
  readonly surface: 'table row' | 'compact card'
}): ReactNode {
  return <details className="connection-monitor-details">
    <summary aria-label={`Details for ${rowLabel} ${surface}`}>Details</summary>
    <dl>{details.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{formattedDetail(item, formatTimestamp)}</dd></div>)}</dl>
  </details>
}

function accessibleRowLabel(row: ConnectionMonitorRowV1): string {
  return row.id.startsWith('opcua-client:')
    ? `${row.component} ${row.id.slice('opcua-client:'.length)}`
    : row.component
}

function ConnectionMonitorTable({ rows, formatTimestamp }: { readonly rows: readonly ConnectionMonitorRowV1[]; readonly formatTimestamp: (timestampMs: number | null) => string }): ReactNode {
  return <div className="connection-monitor-table-wrap"><table className="connection-monitor-table"><thead><tr><th>Component</th><th>State</th><th>Endpoint</th><th>Last update</th><th>Quality</th><th>Error</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><th scope="row"><span>{row.component}</span><ConnectionMonitorDetails details={row.details} formatTimestamp={formatTimestamp} rowLabel={accessibleRowLabel(row)} surface="table row" /></th><td><span className={`connection-monitor-freshness is-${row.freshness}`}>{freshnessLabel(row.freshness)}</span> {row.state}</td><td>{row.endpoint ?? '—'}</td><td>{formatTimestamp(row.lastUpdateAtMs)}</td><td>{row.quality ?? '—'}</td><td>{formattedError(row, formatTimestamp)}</td></tr>)}</tbody></table></div>
}

function ConnectionMonitorCards({ rows, formatTimestamp }: { readonly rows: readonly ConnectionMonitorRowV1[]; readonly formatTimestamp: (timestampMs: number | null) => string }): ReactNode {
  return <div className="connection-monitor-cards">{rows.map((row) => <article className="connection-monitor-card" key={row.id}><dl><div><dt>Component</dt><dd>{row.component}</dd></div><div><dt>State</dt><dd><span className={`connection-monitor-freshness is-${row.freshness}`}>{freshnessLabel(row.freshness)}</span> {row.state}</dd></div><div><dt>Endpoint</dt><dd>{row.endpoint ?? '—'}</dd></div><div><dt>Last update</dt><dd>{formatTimestamp(row.lastUpdateAtMs)}</dd></div><div><dt>Quality</dt><dd>{row.quality ?? '—'}</dd></div><div><dt>Error</dt><dd>{formattedError(row, formatTimestamp)}</dd></div></dl><ConnectionMonitorDetails details={row.details} formatTimestamp={formatTimestamp} rowLabel={accessibleRowLabel(row)} surface="compact card" /></article>)}</div>
}

export function ConnectionMonitorPanel({
  store,
  formatTimestamp = defaultTimestamp,
  compact = false,
  controlRef,
  showTrigger = true,
}: ConnectionMonitorPanelPropsV1): ReactNode {
  const presentation = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const [open, setOpen] = useState(false)
  const openerRef = useRef<HTMLElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const monitorDemandActiveRef = useRef(false)
  const rows = connectionMonitorRowsV1(presentation)
  const freshness = presentation.statusFreshness
    ?? (presentation.transportError !== null ? presentation.status === null ? 'unavailable' : 'last-known' : presentation.status === null ? 'unavailable' : 'current')

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
  const openMonitor = useCallback((opener: HTMLElement | null): void => {
    openerRef.current = opener
    enableMonitorDemand()
    setOpen(true)
  }, [enableMonitorDemand])

  useImperativeHandle(controlRef, () => Object.freeze({
    open: (opener: HTMLElement | null = null) => openMonitor(opener),
    close,
  }), [close, openMonitor])

  useEffect(() => {
    if (!open) return undefined
    enableMonitorDemand()
    headingRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      disableMonitorDemand()
    }
  }, [close, disableMonitorDemand, enableMonitorDemand, open])

  return <>
    {showTrigger && <button aria-controls="connection-monitor-v1" aria-expanded={open} className="connection-monitor-trigger" onClick={(event) => openMonitor(event.currentTarget)} type="button">Connection Monitor</button>}
    {!open ? null : <aside aria-label="Connection Monitor" className={`connection-monitor-panel${compact ? ' is-compact' : ''}`} id="connection-monitor-v1" role="complementary">
      <header><div><p>Connectivity</p><h2 ref={headingRef} tabIndex={-1}>Connection Monitor</h2></div><div className="connection-monitor-header-actions"><button onClick={() => store.refresh()} type="button">Retry now</button><button aria-label="Close Connection Monitor" onClick={close} type="button">Close</button></div></header>
      {presentation.transportError === null ? null : <p className="connection-monitor-transport-error" role="alert">{presentation.transportError}</p>}
      <p aria-atomic="true" aria-live="polite" className="connection-monitor-live-region" role="status">{freshness === 'last-known' ? `Offline. Last known status observed at ${formatTimestamp(presentation.lastObservedAtMs)}.` : freshness === 'current' ? 'Current Runtime Gateway status.' : `Runtime Gateway status unavailable.${presentation.transportError === null ? '' : ` ${presentation.transportError}`}`}</p>
      <ConnectionMonitorTable formatTimestamp={formatTimestamp} rows={rows} />
      <ConnectionMonitorCards formatTimestamp={formatTimestamp} rows={rows} />
    </aside>}
  </>
}
