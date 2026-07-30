import {
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'

import type { RuntimeGatewayStatusV1 } from '../../../core/runtime-protocol/gateway-status-v1.js'
import { ModalDialogV6 } from '../../ui/v6/ModalDialogV6.js'
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
  const closeRef = useRef<HTMLButtonElement>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied'>('idle')
  const [error, setError] = useState<string | null>(null)

  const close = (): void => {
    onClose()
  }

  return <ModalDialogV6
    className="opcua-settings-dialog docker-run-guide-dialog"
    footer={<footer className="opcua-settings-footer">
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
    </footer>}
    header={<header className="opcua-settings-header">
        <div>
          <p>Connectivity / Deployment</p>
          <h2 id="docker-run-guide-title">Docker Run Guide</h2>
        </div>
        <button onClick={close} ref={closeRef} type="button">Close</button>
      </header>}
    initialFocusRef={closeRef}
    onClose={close}
    overlayClassName="opcua-settings-overlay"
    titleId="docker-run-guide-title"
    {...(triggerRef === undefined ? {} : { triggerRef })}
  >
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
  </ModalDialogV6>
}
