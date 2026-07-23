import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'

import type { RuntimeGatewayStatusV1 } from '../../../core/runtime-protocol/gateway-status-v1.js'
import { dockerRunGuideV1 } from './docker-run-guide.js'

interface ClipboardPortV1 {
  writeText(value: string): Promise<void>
}

export interface DockerRunGuideDialogPropsV1 {
  readonly status: RuntimeGatewayStatusV1 | null
  readonly onClose: () => void
  readonly clipboard?: ClipboardPortV1 | null
  readonly triggerRef?: RefObject<HTMLElement | null>
}

function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button, [tabindex]'))
    .filter((element) => element.tabIndex >= 0 && !('disabled' in element && element.disabled === true))
}

export function DockerRunGuideDialogV1({
  status,
  onClose,
  clipboard,
  triggerRef,
}: DockerRunGuideDialogPropsV1): ReactNode {
  const guide = useMemo(() => dockerRunGuideV1(status), [status])
  const clipboardPort = clipboard === undefined
    ? (typeof navigator === 'undefined' ? null : navigator.clipboard ?? null)
    : clipboard
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(timer)
      triggerRef?.current?.focus()
    }
  }, [triggerRef])

  const close = (): void => {
    onClose()
  }

  return <div
    aria-labelledby="docker-run-guide-title"
    aria-modal="true"
    className="opcua-settings-overlay"
    onKeyDown={(event) => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'Tab') return
      const elements = dialogRef.current === null ? [] : tabbables(dialogRef.current)
      const first = elements[0]
      const last = elements.at(-1)
      const index = elements.indexOf(document.activeElement as HTMLElement)
      if (
        (!event.shiftKey && (index < 0 || index === elements.length - 1))
        || (event.shiftKey && index <= 0)
      ) {
        event.preventDefault()
        ;(event.shiftKey ? last : first)?.focus()
      }
    }}
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) close()
    }}
    ref={dialogRef}
    role="dialog"
    tabIndex={-1}
  >
    <section className="opcua-settings-dialog docker-run-guide-dialog">
      <header className="opcua-settings-header">
        <div>
          <p>Connectivity / Deployment</p>
          <h2 id="docker-run-guide-title">Docker Run Guide</h2>
        </div>
        <button onClick={close} ref={closeRef} type="button">Close</button>
      </header>
      <div className="opcua-settings-body">
        <section>
          <h3>Port topology</h3>
          <dl className="opcua-settings-summary">
            <div><dt>Native external PLC</dt><dd>{guide.externalPlc.native}</dd></div>
            <div><dt>Docker external PLC</dt><dd>{guide.externalPlc.docker}</dd></div>
            <div><dt>Gateway Server</dt><dd>{guide.gatewayServer}</dd></div>
            <div><dt>Effective listener</dt><dd>{guide.effective.listener}</dd></div>
            <div><dt>Effective advertised</dt><dd>{guide.effective.advertised}</dd></div>
          </dl>
          <p>The external PLC Client endpoint and the Gateway Server listener are independent ports.</p>
        </section>
        <section>
          <h3>PowerShell</h3>
          <pre><code>{guide.text}</code></pre>
          <p>{guide.restartWarning}</p>
        </section>
        {copyState === 'copied' ? <p role="status">Copied PowerShell commands.</p> : null}
        {error === null ? null : <p role="alert">{error}</p>}
      </div>
      <footer className="opcua-settings-footer">
        <button
          disabled={copyState === 'copying'}
          onClick={() => {
            if (clipboardPort === null) {
              setError('Clipboard API is unavailable. Select and copy the command block manually.')
              return
            }
            setCopyState('copying')
            setError(null)
            void clipboardPort.writeText(guide.text)
              .then(() => setCopyState('copied'))
              .catch((copyError: unknown) => {
                setCopyState('idle')
                setError(copyError instanceof Error ? copyError.message : String(copyError))
              })
          }}
          type="button"
        >Copy PowerShell commands</button>
      </footer>
    </section>
  </div>
}
