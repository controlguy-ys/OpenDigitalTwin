import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'

import type { LocalHelpControllerV4, LocalHelpTopicV4 } from './local-help-controller.js'

export interface LocalHelpPanelPropsV4 {
  readonly controller: LocalHelpControllerV4
}

const HELP_CONTENT_V4: Readonly<Record<LocalHelpTopicV4, { readonly title: string; readonly body: string }>> = Object.freeze({
  controls: Object.freeze({ title: 'Keyboard and Mouse Controls', body: 'Use the camera controls to orbit, pan, and focus the 3D workspace.' }),
  stepImport: Object.freeze({ title: 'STEP Import Guide', body: 'Import STEP assets within the configured Robot and Object limits, then review geometry and placement.' }),
  opcUaMapping: Object.freeze({ title: 'OPC UA Mapping Guide', body: 'Map supported Robot Joint and Object XYZRPY values through the configured OPC UA workflow.' }),
  about: Object.freeze({ title: 'About', body: 'RobotSim is a lightweight Web Digital Twin for Project V4 workcells.' }),
})

export function LocalHelpPanelV4({ controller }: LocalHelpPanelPropsV4): ReactNode {
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const topic = state.openTopic

  useEffect(() => {
    if (topic === null) {
      const target = returnFocusRef.current
      returnFocusRef.current = null
      if (target !== null && target.isConnected) target.focus()
      return
    }
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
  }, [topic])

  if (topic === null || !controller.hasTopic(topic)) return null
  const content = HELP_CONTENT_V4[topic]
  return <section
    aria-label={content.title}
    className="local-help-panel-v4"
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); controller.close() } }}
    ref={panelRef}
    role="dialog"
    tabIndex={-1}
  >
    <header>
      <h2>{content.title}</h2>
      <button aria-label={`Close ${content.title}`} onClick={() => controller.close()} type="button">Close</button>
    </header>
    <p>{content.body}</p>
  </section>
}
