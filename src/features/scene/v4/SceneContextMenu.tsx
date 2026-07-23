import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { WorkcellProjectV4 } from '../../../core/project-v4/index.js'
import type { AppCommandBindingsV4, AppCommandRuntimeStateV4 } from '../../commands/v4/app-command-runtime.js'
import { useAppCommandV4 } from '../../commands/v4/use-app-command.js'
import type { InteractionStoreStateV4 } from '../../interaction/v4/interaction-store.js'
import type { StoreApi } from 'zustand/vanilla'
import type { ViewportSafeAreaInsetsV4 } from '../../viewport/v4/viewport-safe-area.js'
import { sceneContextCommandIdsV4 } from './scene-context-commands.js'
import type { SceneContextRequestV4 } from './scene-context-request.js'
import type { SceneSelectionTargetV4 } from '../../interaction/v4/scene-selection.js'

export interface SceneContextMenuPropsV4 {
  readonly request: SceneContextRequestV4
  readonly project: WorkcellProjectV4
  readonly interaction: StoreApi<InteractionStoreStateV4>
  readonly commandBindings: AppCommandBindingsV4
  readonly safeAreaInsets: ViewportSafeAreaInsetsV4
  readonly onClose: () => void
  readonly onOpenBinding?: (selection: SceneSelectionTargetV4) => void
}

interface PositionV4 { readonly x: number; readonly y: number }
interface SizeV4 { readonly width: number; readonly height: number }
const EMPTY_RUNTIME_STATE_V4: AppCommandRuntimeStateV4 = Object.freeze({
  pendingCommandIds: new Set<string>(), errorByCommandId: new Map<string, string>(),
})

function normalizedInsetV4(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function enabledMenuItemsV4(menu: HTMLElement | null): readonly HTMLButtonElement[] {
  return menu === null ? [] : [...menu.querySelectorAll<HTMLButtonElement>(
    'button[role="menuitem"]:not(:disabled)',
  )]
}

function BoundSceneContextItemV4({
  commandBindings,
  commandId,
  onCompleted,
}: {
  readonly commandBindings: AppCommandBindingsV4
  readonly commandId: string
  readonly onCompleted: () => void
}): ReactNode {
  const bound = useAppCommandV4(commandBindings, commandId)
  if (bound.command === null || !bound.command.visible) return null
  return (
    <button
      disabled={!bound.command.enabled || bound.pending}
      onClick={() => { void bound.invoke().then((outcome) => { if (outcome === 'completed') onCompleted() }) }}
      role="menuitem"
      tabIndex={-1}
      type="button"
    >
      {bound.command.label}
    </button>
  )
}

export function SceneContextMenuV4({
  request,
  project,
  interaction,
  commandBindings,
  safeAreaInsets,
  onClose,
  onOpenBinding,
}: SceneContextMenuPropsV4): ReactNode {
  const runtimeState = useSyncExternalStore(
    commandBindings.runtime.subscribe,
    commandBindings.runtime.getState,
    () => EMPTY_RUNTIME_STATE_V4,
  )
  const ids = sceneContextCommandIdsV4(
    project,
    interaction.getState().projectRevisionId,
    request.selection,
  )
  const staleError = request.selection !== null
    && (
      interaction.getState().projectRevisionId !== project.revisionId
      || ids.length === 0
    )
    ? 'The requested Scene target is no longer available in this Project revision.'
    : null
  const directRobotBinding = onOpenBinding !== undefined
    && staleError === null
    && (request.selection?.kind === 'robot' || request.selection?.kind === 'robot-frame')
  const menuRef = useRef<HTMLDivElement>(null)
  const presentationRef = useRef<HTMLDivElement>(null)
  const activeRequestRef = useRef(request)
  const focusOwnerRef = useRef<HTMLElement | null>(null)
  const restoreFocusOnCloseRef = useRef(false)
  const [position, setPosition] = useState<PositionV4>(request.position)
  const [size, setSize] = useState<SizeV4 | null>(null)

  const errors = ids.map((id) => runtimeState.errorByCommandId.get(id)).filter((value): value is string => value !== undefined)
  const signature = `${ids.join('|')}|robot-binding:${directRobotBinding}|${errors.join('|')}|${[...runtimeState.pendingCommandIds].join('|')}|${safeAreaInsets.top}:${safeAreaInsets.right}:${safeAreaInsets.bottom}:${safeAreaInsets.left}`

  useLayoutEffect(() => {
    if (document.activeElement instanceof HTMLElement) focusOwnerRef.current = document.activeElement
  }, [])
  useLayoutEffect(() => { activeRequestRef.current = request }, [request])
  useEffect(() => () => {
    if (restoreFocusOnCloseRef.current && focusOwnerRef.current?.isConnected) focusOwnerRef.current.focus()
  }, [])

  const measurePosition = useCallback(() => {
    const presentation = presentationRef.current
    if (presentation !== null) {
      presentation.style.maxWidth = ''
      presentation.style.maxHeight = ''
    }
    const bounds = presentation?.getBoundingClientRect()
    if (bounds === undefined) return
    const left = Math.min(normalizedInsetV4(safeAreaInsets.left), window.innerWidth)
    const top = Math.min(normalizedInsetV4(safeAreaInsets.top), window.innerHeight)
    const right = Math.max(left, window.innerWidth - normalizedInsetV4(safeAreaInsets.right))
    const bottom = Math.max(top, window.innerHeight - normalizedInsetV4(safeAreaInsets.bottom))
    const availableWidth = Math.max(0, right - left)
    const availableHeight = Math.max(0, bottom - top)
    const x = bounds.width > availableWidth ? left : Math.max(left, Math.min(request.position.x, right - bounds.width))
    const y = bounds.height > availableHeight ? top : Math.max(top, Math.min(request.position.y, bottom - bounds.height))
    const needsConstraint = bounds.width > availableWidth || bounds.height > availableHeight
    // The natural measurement temporarily clears the inline cap above. Always
    // publish a new constrained object so React reapplies that cap even when
    // the available dimensions did not change.
    setSize(needsConstraint ? { width: availableWidth, height: availableHeight } : null)
    setPosition((current) => current.x === x && current.y === y ? current : { x, y })
  }, [request.position.x, request.position.y, safeAreaInsets])

  useLayoutEffect(() => { measurePosition() }, [measurePosition, signature])
  useEffect(() => { window.addEventListener('resize', measurePosition); return () => window.removeEventListener('resize', measurePosition) }, [measurePosition])
  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus()
  }, [request, signature])
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && presentationRef.current?.contains(event.target)) return
      restoreFocusOnCloseRef.current = false
      onClose()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [onClose])

  const closeCompleted = useCallback(() => {
    if (activeRequestRef.current !== request) return
    restoreFocusOnCloseRef.current = true
    onClose()
  }, [onClose, request])
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation(); restoreFocusOnCloseRef.current = true; onClose(); return
    }
    const items = enabledMenuItemsV4(menuRef.current)
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? (current + 1 + items.length) % items.length
      : event.key === 'ArrowUp' ? (current - 1 + items.length) % items.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null
    if (next === null) return
    event.preventDefault(); event.stopPropagation(); items[next]?.focus()
  }
  return createPortal(
    <div
      className="scene-context-menu-presentation-v4"
      ref={presentationRef}
      style={{
        left: position.x,
        top: position.y,
        maxWidth: size === null ? undefined : `${size.width}px`,
        maxHeight: size === null ? undefined : `${size.height}px`,
      }}
    >
      <div
        aria-label="Scene actions"
        className="scene-context-menu scene-context-menu-v4"
        onKeyDown={onKeyDown}
        ref={menuRef}
        role="menu"
        tabIndex={-1}
      >
        {ids.map((id) => (
          id === 'scene.binding.open' && onOpenBinding !== undefined && request.selection !== null
            ? (
                <button
                  key={id}
                  onClick={() => {
                    onOpenBinding(request.selection!)
                    closeCompleted()
                  }}
                  role="menuitem"
                  tabIndex={-1}
                  type="button"
                >
                  Open Binding
                </button>
              )
            : <BoundSceneContextItemV4 commandBindings={commandBindings} commandId={id} key={id} onCompleted={closeCompleted} />
        ))}
        {directRobotBinding ? (
          <button
            onClick={() => {
              onOpenBinding(request.selection!)
              closeCompleted()
            }}
            role="menuitem"
            tabIndex={-1}
            type="button"
          >
            Open Binding
          </button>
        ) : null}
      </div>
      {errors[0] === undefined && staleError === null ? null : <p className="scene-context-menu-error-v4" role="alert">{errors[0] ?? staleError}</p>}
    </div>,
    document.body,
  )
}
