import {
  Box,
  Boxes,
  Cylinder,
  Eye,
  Home,
  ListVideo,
  Play,
  Save,
  Server,
  ShieldAlert,
  Square,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'

import type { AppCommandOutcomeV4 } from '../../commands/v4/app-command.js'
import type { AppCommandBindingsV4 } from '../../commands/v4/app-command-runtime.js'
import { useAppCommandV4 } from '../../commands/v4/use-app-command.js'
import { sceneSelectionKeyV4 } from '../../interaction/v4/scene-selection.js'
import type { ShellLayoutControllerV4 } from './shell-layout-controller.js'
import { resolveRibbonOverflowV4 } from './ribbon-overflow-v4.js'
import {
  resolveRibbonContextV4,
  type AppIconKeyV4,
  type RibbonContextV4,
  type RibbonItemSpecV4,
} from './ribbon-model-v4.js'

export interface RibbonLitePropsV4 {
  readonly commandBindings: AppCommandBindingsV4
  readonly context: RibbonContextV4
  readonly shellLayoutController: ShellLayoutControllerV4
  readonly availableWidthPx?: number
  readonly measuredWidthPxByCommandId?: Readonly<Record<string, number>>
  readonly moreWidthPx?: number
}

interface IntrinsicRibbonMeasurementV4 {
  readonly availableWidthPx: number
  readonly measuredWidthPxByCommandId: Readonly<Record<string, number>>
  readonly moreWidthPx: number
}

const ICONS_V4: Readonly<Record<AppIconKeyV4, LucideIcon>> = Object.freeze({
  save: Save,
  play: Play,
  cancel: Square,
  home: Home,
  box: Box,
  cylinder: Cylinder,
  group: Boxes,
  timeline: ListVideo,
  collision: ShieldAlert,
  server: Server,
  view: Eye,
})

function idPartV4(id: string): string { return id.replace(/[^a-zA-Z0-9_-]/g, '-') }

function sameMeasurementV4(
  current: IntrinsicRibbonMeasurementV4 | null,
  next: IntrinsicRibbonMeasurementV4,
): boolean {
  if (current === null
    || current.availableWidthPx !== next.availableWidthPx
    || current.moreWidthPx !== next.moreWidthPx) return false
  const currentIds = Object.keys(current.measuredWidthPxByCommandId)
  const nextIds = Object.keys(next.measuredWidthPxByCommandId)
  return currentIds.length === nextIds.length && currentIds.every((id) => (
    current.measuredWidthPxByCommandId[id] === next.measuredWidthPxByCommandId[id]
  ))
}

function cssPixelsV4(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function useShellSnapshotV4(controller: ShellLayoutControllerV4) {
  return useSyncExternalStore(
    useCallback((listener) => controller.subscribe(listener), [controller]),
    useCallback(() => controller.getState(), [controller]),
    useCallback(() => controller.getState(), [controller]),
  )
}

function useCommandRuntimeSyncV4(bindings: AppCommandBindingsV4): void {
  const runtime = bindings.runtime
  void useSyncExternalStore(
    useCallback((listener) => runtime.subscribe(listener), [runtime]),
    useCallback(() => runtime.getState(), [runtime]),
    useCallback(() => runtime.getState(), [runtime]),
  )
}

function logicalMenuItemsV4(menu: HTMLElement): HTMLButtonElement[] {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).filter((item) => (
    item.disabled !== true && item.getAttribute('aria-disabled') !== 'true'
  ))
}

function focusMenuItemV4(menu: HTMLElement | null, intent: 'first' | 'last' | 1 | -1): void {
  if (menu === null) return
  const items = logicalMenuItemsV4(menu)
  if (items.length === 0) return
  if (intent === 'first') return void items[0]?.focus()
  if (intent === 'last') return void items.at(-1)?.focus()
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  if (current === -1) return void (intent === 1 ? items[0] : items.at(-1))?.focus()
  items[(current + intent + items.length) % items.length]?.focus()
}

function RibbonCommandButtonV4({
  bindings,
  item,
  role,
  onOutcome,
}: {
  readonly bindings: AppCommandBindingsV4
  readonly item: RibbonItemSpecV4
  readonly role?: 'button' | 'menuitem'
  readonly onOutcome?: (outcome: AppCommandOutcomeV4) => void
}): ReactNode {
  const { command, pending, error, invoke } = useAppCommandV4(bindings, item.commandId)
  if (command === null || command.visible !== true) return null
  const Icon = ICONS_V4[item.iconKey]
  const disabled = command.enabled !== true || pending
  const errorId = `ribbon-command-error-${idPartV4(item.commandId)}`
  return <>
    <button
      aria-busy={pending || undefined}
      aria-describedby={error === null ? undefined : errorId}
      aria-disabled={disabled || undefined}
      aria-label={command.label}
      className="ribbon-command-v4"
      data-pending={pending || undefined}
      disabled={disabled}
      onClick={() => { if (!disabled) void invoke().then((outcome) => onOutcome?.(outcome)) }}
      role={role}
      title={pending ? 'Command in progress.' : command.disabledReason ?? command.label}
      type="button"
    >
      <Icon aria-hidden="true" size={16} strokeWidth={1.75} />
      <span>{command.label}</span>
    </button>
    {error === null ? null : <span id={errorId} className="ribbon-command-error-v4" role="alert">{error}</span>}
  </>
}

function IntrinsicRibbonMeasurementsV4({
  commandBindings,
  items,
  measurementRef,
  moreRef,
}: {
  readonly commandBindings: AppCommandBindingsV4
  readonly items: readonly RibbonItemSpecV4[]
  readonly measurementRef: (node: HTMLDivElement | null) => void
  readonly moreRef: (node: HTMLButtonElement | null) => void
}): ReactNode {
  return <div aria-hidden="true" className="ribbon-intrinsic-measurements-v4" ref={measurementRef}>
    {items.map((item) => {
      const command = commandBindings.getRegistry().get(item.commandId)
      if (command?.visible !== true) return null
      const Icon = ICONS_V4[item.iconKey]
      return <button
        className="ribbon-command-v4"
        data-ribbon-measure-command={item.commandId}
        key={item.commandId}
        tabIndex={-1}
        type="button"
      >
        <Icon aria-hidden="true" size={16} strokeWidth={1.75} />
        <span>{command.label}</span>
      </button>
    })}
    <div className="ribbon-more-v4"><button ref={moreRef} tabIndex={-1} type="button">More</button></div>
  </div>
}

export function RibbonLiteV4({
  commandBindings,
  context,
  shellLayoutController,
  availableWidthPx,
  measuredWidthPxByCommandId = {},
  moreWidthPx,
}: RibbonLitePropsV4): ReactNode {
  const snapshot = useShellSnapshotV4(shellLayoutController)
  useCommandRuntimeSyncV4(commandBindings)
  const resolved = resolveRibbonContextV4({ context, registry: commandBindings.getRegistry() })
  const [moreOpen, setMoreOpen] = useState(false)
  const [intrinsicMeasurement, setIntrinsicMeasurement] = useState<IntrinsicRibbonMeasurementV4 | null>(null)
  const ribbonRef = useRef<HTMLElement>(null)
  const measurementRef = useRef<HTMLDivElement>(null)
  const measurementMoreRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const moreTriggerRef = useRef<HTMLButtonElement>(null)
  const moreFocusOwnedRef = useRef(false)
  const ribbonExpanded = snapshot.isRibbonExpanded()
  const selectionKey = context.selection === null ? 'none' : sceneSelectionKeyV4(context.selection)
  const itemsKey = resolved.items.map((item) => item.commandId).join('|')
  const contextKey = `${selectionKey}:${context.activeRobotId ?? ''}:${context.activeJobId ?? ''}:${context.previewSection ?? ''}`
  const hasExplicitCommandWidths = Object.keys(measuredWidthPxByCommandId).length > 0
  const measureIntrinsicWidths = useCallback(() => {
    const ribbon = ribbonRef.current
    const measurementRoot = measurementRef.current
    const more = measurementMoreRef.current
    if (ribbon === null || measurementRoot === null || more === null) return
    const ribbonStyle = window.getComputedStyle(ribbon)
    const horizontalInsets = cssPixelsV4(ribbonStyle.paddingLeft)
      + cssPixelsV4(ribbonStyle.paddingRight)
      + cssPixelsV4(ribbonStyle.borderLeftWidth)
      + cssPixelsV4(ribbonStyle.borderRightWidth)
    const availableWidthPx = Math.max(0, Math.floor(ribbon.getBoundingClientRect().width - horizontalInsets))
    const measuredWidthPxByCommandId = Object.fromEntries(
      Array.from(measurementRoot.querySelectorAll<HTMLButtonElement>('[data-ribbon-measure-command]'))
        .map((button) => [
          button.dataset.ribbonMeasureCommand ?? '',
          Math.max(0, Math.ceil(button.getBoundingClientRect().width) + 4),
        ]),
    )
    const moreWidthPx = Math.max(
      0,
      Math.ceil(more.getBoundingClientRect().width)
        + cssPixelsV4(ribbonStyle.columnGap || ribbonStyle.gap),
    )
    if (
      availableWidthPx === 0
      || moreWidthPx === 0
      || Object.values(measuredWidthPxByCommandId).some((width) => width === 0)
    ) return
    const next: IntrinsicRibbonMeasurementV4 = Object.freeze({
      availableWidthPx,
      measuredWidthPxByCommandId: Object.freeze(measuredWidthPxByCommandId),
      moreWidthPx,
    })
    setIntrinsicMeasurement((current) => sameMeasurementV4(current, next) ? current : next)
  }, [])
  useLayoutEffect(() => {
    if (availableWidthPx !== undefined && hasExplicitCommandWidths) return
    measureIntrinsicWidths()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measureIntrinsicWidths())
    if (ribbonRef.current !== null) observer.observe(ribbonRef.current)
    if (measurementRef.current !== null) observer.observe(measurementRef.current)
    return () => observer.disconnect()
  }, [availableWidthPx, hasExplicitCommandWidths, itemsKey, measureIntrinsicWidths, ribbonExpanded])
  const layout = resolveRibbonOverflowV4({
    items: resolved.items,
    availableWidthPx: availableWidthPx ?? intrinsicMeasurement?.availableWidthPx ?? Number.POSITIVE_INFINITY,
    measuredWidthPxByCommandId: hasExplicitCommandWidths
      ? measuredWidthPxByCommandId
      : intrinsicMeasurement?.measuredWidthPxByCommandId ?? {},
    ...(moreWidthPx === undefined
      ? intrinsicMeasurement === null ? {} : { moreWidthPx: intrinsicMeasurement.moreWidthPx }
      : { moreWidthPx }),
  })
  const overflowKey = layout.overflowItems.map((item) => item.commandId).join('|')
  const closeMore = useCallback(() => {
    const focusWasInsideMenu = moreFocusOwnedRef.current || moreMenuRef.current?.contains(document.activeElement) === true
    moreFocusOwnedRef.current = false
    setMoreOpen(false)
    if (!focusWasInsideMenu) return
    const trigger = moreTriggerRef.current
    if (layout.hasOverflow && ribbonExpanded && trigger?.isConnected === true) {
      trigger.focus()
      return
    }
    if (ribbonExpanded && ribbonRef.current?.isConnected === true) ribbonRef.current.focus()
  }, [layout.hasOverflow, ribbonExpanded])

  useLayoutEffect(() => {
    closeMore()
  }, [closeMore, contextKey, itemsKey, overflowKey, ribbonExpanded])

  useEffect(() => {
    if (!moreOpen) return
    focusMenuItemV4(moreMenuRef.current, 'first')
    moreFocusOwnedRef.current = moreMenuRef.current?.contains(document.activeElement) === true
    const dismiss = (event: PointerEvent): void => {
      if (moreRef.current?.contains(event.target as Node) !== true) closeMore()
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      event.preventDefault()
      closeMore()
    }
    const trackFocus = (event: FocusEvent): void => {
      moreFocusOwnedRef.current = moreMenuRef.current?.contains(event.target as Node) === true
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('focusin', trackFocus)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('focusin', trackFocus)
    }
  }, [closeMore, moreOpen])

  return <section
    aria-label="Context commands"
    className="ribbon-lite-v4"
    data-context-kind={resolved.kind}
    data-section={resolved.section ?? undefined}
    hidden={!ribbonExpanded}
    id="ribbon-lite-v4"
    ref={ribbonRef}
    role="toolbar"
    tabIndex={-1}
  >
    <IntrinsicRibbonMeasurementsV4
      commandBindings={commandBindings}
      items={resolved.items}
      measurementRef={(node) => { measurementRef.current = node }}
      moreRef={(node) => { measurementMoreRef.current = node }}
    />
    <div className="ribbon-command-list-v4">
      {layout.visibleItems.map((item) => <RibbonCommandButtonV4 bindings={commandBindings} item={item} key={item.commandId} />)}
    </div>
    {layout.hasOverflow || moreOpen ? <div className="ribbon-more-v4" ref={moreRef}>
      <button
        aria-controls="ribbon-more-menu-v4"
        aria-expanded={moreOpen}
        aria-haspopup="menu"
        aria-label="More commands"
        onClick={() => { if (moreOpen) closeMore(); else setMoreOpen(true) }}
        ref={moreTriggerRef}
        title="More commands"
        type="button"
      >More</button>
      {moreOpen ? <div
        aria-label="More commands"
        className="ribbon-more-menu-v4"
        id="ribbon-more-menu-v4"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            closeMore()
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            focusMenuItemV4(event.currentTarget, 1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            focusMenuItemV4(event.currentTarget, -1)
          } else if (event.key === 'Home') {
            event.preventDefault()
            focusMenuItemV4(event.currentTarget, 'first')
          } else if (event.key === 'End') {
            event.preventDefault()
            focusMenuItemV4(event.currentTarget, 'last')
          }
        }}
        ref={moreMenuRef}
        role="menu"
      >
        {layout.overflowItems.map((item) => <RibbonCommandButtonV4 bindings={commandBindings} item={item} key={item.commandId} role="menuitem" onOutcome={(outcome) => { if (outcome === 'completed') closeMore() }} />)}
      </div> : null}
    </div> : null}
  </section>
}
