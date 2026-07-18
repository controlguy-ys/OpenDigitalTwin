import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'

import type { LocalHelpControllerV4, LocalHelpTopicV4 } from './local-help-controller.js'

export interface LocalHelpPanelPropsV4 {
  readonly controller: LocalHelpControllerV4
}

interface ReturnFocusTargetV4 {
  readonly element: HTMLElement | null
  readonly fallback: HTMLElement | null
}

const HELP_CONTENT_V4: Readonly<Record<LocalHelpTopicV4, { readonly title: string; readonly body: string }>> = Object.freeze({
  controls: Object.freeze({ title: 'Keyboard and Mouse Controls', body: 'Use the camera controls to orbit, pan, and focus the 3D workspace.' }),
  stepImport: Object.freeze({ title: 'STEP Import Guide', body: 'Import STEP assets within the configured Robot and Object limits, then review geometry and placement.' }),
  opcUaMapping: Object.freeze({ title: 'OPC UA Mapping Guide', body: 'Map supported Robot Joint and Object XYZRPY values through the configured OPC UA workflow.' }),
  about: Object.freeze({ title: 'About', body: 'RobotSim is a lightweight Web Digital Twin for Project V4 workcells.' }),
})

function focusableActiveElementV4(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement
    : null
}

function menuOwnerV4(menu: HTMLElement): HTMLElement | null {
  const ids = menu.getAttribute('aria-labelledby')?.split(/\s+/).filter(Boolean) ?? []
  for (const id of ids) {
    const owner = document.getElementById(id)
    if (owner instanceof HTMLElement) return owner
  }
  return null
}

function disclosureForMenuV4(menu: HTMLElement): HTMLElement | null {
  if (menu.id.length === 0) return null
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-controls]')).find((element) => (
    element.getAttribute('aria-controls')?.split(/\s+/).includes(menu.id) === true
  )) ?? null
}

function resolveReturnFocusTargetV4(): ReturnFocusTargetV4 {
  const element = focusableActiveElementV4()
  let menu = element?.closest<HTMLElement>('[role="menu"]') ?? null
  let fallback: HTMLElement | null = null
  while (menu !== null) {
    const owner = menuOwnerV4(menu)
    if (owner !== null) fallback = owner
    const disclosure = disclosureForMenuV4(menu)
    if (disclosure !== null) fallback = disclosure
    menu = menu.parentElement?.closest<HTMLElement>('[role="menu"]') ?? null
  }
  return Object.freeze({ element, fallback })
}

function restoreFocusV4(target: ReturnFocusTargetV4 | null): void {
  if (target?.element?.isConnected === true) {
    target.element.focus()
    return
  }
  if (target?.fallback?.isConnected === true) target.fallback.focus()
}

export function LocalHelpPanelV4({ controller }: LocalHelpPanelPropsV4): ReactNode {
  const initialTopicRef = useRef(controller.getState().openTopic)
  const previousTopicRef = useRef(initialTopicRef.current)
  const sessionOpenRef = useRef(initialTopicRef.current !== null)
  const returnFocusRef = useRef<ReturnFocusTargetV4 | null>(null)
  const renderedTopicRef = useRef(initialTopicRef.current)
  const panelRef = useRef<HTMLElement | null>(null)
  const subscribe = useCallback((listener: () => void) => controller.subscribe(() => {
    const nextTopic = controller.getState().openTopic
    if (!sessionOpenRef.current && previousTopicRef.current === null && nextTopic !== null) {
      returnFocusRef.current = resolveReturnFocusTargetV4()
      sessionOpenRef.current = true
    }
    if (previousTopicRef.current !== null && nextTopic === null) sessionOpenRef.current = false
    previousTopicRef.current = nextTopic
    listener()
  }), [controller])
  const getSnapshot = useCallback(() => controller.getState(), [controller])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const topic = state.openTopic

  useLayoutEffect(() => {
    if (topic !== null) {
      if (returnFocusRef.current === null) returnFocusRef.current = resolveReturnFocusTargetV4()
      sessionOpenRef.current = true
      panelRef.current?.focus()
    } else if (renderedTopicRef.current !== null) {
      const target = returnFocusRef.current
      returnFocusRef.current = null
      restoreFocusV4(target)
      sessionOpenRef.current = false
    }
    renderedTopicRef.current = topic
  }, [topic])

  useEffect(() => {
    if (topic === null) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      event.preventDefault()
      controller.close()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [controller, topic])

  if (topic === null || !controller.hasTopic(topic)) return null
  const content = HELP_CONTENT_V4[topic]
  return <section
    aria-label={content.title}
    className="local-help-panel-v4"
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
