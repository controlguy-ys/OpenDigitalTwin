import { ChevronDown, PanelLeft, PanelRight } from 'lucide-react'
import {
  applyThemePreference,
  DARK_THEME_QUERY,
} from '../features/ui/theme-preference'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

import type { AppCommandBindingsV4 } from '../features/commands/v4/app-command-runtime.js'
import { useAppCommandV4 } from '../features/commands/v4/use-app-command.js'
import { DockResizeHandleV4 } from '../features/ui/v4/DockResizeHandleV4.js'
import type { ShellLayoutControllerV4 } from '../features/ui/v4/shell-layout-controller.js'
import { isSceneJobResizeAvailableV4 } from '../features/ui/v4/shell-layout-geometry.js'
import { useShellLayoutObserverV4 } from '../features/ui/v4/use-shell-layout-observer.js'
import type { ViewportSafeAreaInsetsV4 } from '../features/viewport/v4/viewport-safe-area.js'

export interface AppShellPropsV4 {
  readonly shellLayoutController: ShellLayoutControllerV4
  readonly commandBindings: AppCommandBindingsV4
  readonly header: ReactNode
  readonly renderViewport: (safeAreaInsets: ViewportSafeAreaInsetsV4) => ReactNode
  readonly assetTree?: ReactNode
  readonly jobTree?: ReactNode
  readonly inspector?: ReactNode
  readonly bottomRail?: ReactNode
  readonly viewportBusy?: boolean
}

function DrawerToggleV4({ bindings, commandId, controls, label, icon: Icon }: { readonly bindings: AppCommandBindingsV4; readonly commandId: 'view.sidebar' | 'view.inspector' | 'view.bottom'; readonly controls: string; readonly label: string; readonly icon: typeof PanelLeft }) {
  const { command, pending, error, invoke } = useAppCommandV4(bindings, commandId)
  if (command === null || command.visible !== true) return null
  const placementClass = commandId === 'view.sidebar'
    ? 'drawer-control-left'
    : commandId === 'view.inspector'
      ? 'drawer-control-right'
      : 'sheet-control'
  return <>
    <button aria-busy={pending || undefined} aria-controls={controls} aria-describedby={error === null ? undefined : `${commandId}-error`} aria-expanded={command.checked === true} aria-label={label} className={`drawer-control ${placementClass} ${command.checked === true ? 'is-open' : ''}`} disabled={command.enabled !== true || pending} onClick={() => { void invoke() }} type="button"><Icon aria-hidden="true" size={16} strokeWidth={1.75} /></button>
    {error === null ? null : <span aria-live="polite" className="visually-hidden" id={`${commandId}-error`}>{error}</span>}
  </>
}

export function AppShellV4({
  shellLayoutController,
  commandBindings,
  header,
  renderViewport,
  assetTree,
  jobTree,
  inspector,
  bottomRail,
  viewportBusy = false,
}: AppShellPropsV4) {
  const { snapshot, workspaceRef } = useShellLayoutObserverV4(shellLayoutController)
  const [assetRail, setAssetRail] = useState<HTMLElement | null>(null)
  const [sidebarContentHeightPx, setSidebarContentHeightPx] = useState(0)
  const setAssetRailRef = useCallback((element: HTMLElement | null) => setAssetRail(element), [])
  const isAssetRailOpen = snapshot.isDockVisible('sidebar')
  const isInspectorOpen = snapshot.isDockVisible('inspector')
  const isBottomRailOpen = snapshot.isDockVisible('bottom')
  const splitPercent = snapshot.preferences.sidebar.sceneJobSplitPercent
  const showSidebarDockHandle = (snapshot.mode === 'wide' || snapshot.mode === 'compact')
    && isAssetRailOpen
  const showInspectorDockHandle = snapshot.mode === 'wide' && isInspectorOpen
  const showBottomDockHandle = (snapshot.mode === 'wide' || snapshot.mode === 'compact')
    && isBottomRailOpen
  const showSceneJobHandle = isAssetRailOpen && isSceneJobResizeAvailableV4(
    snapshot.mode,
    sidebarContentHeightPx,
  )
  const splitReferenceHeightPx = sidebarContentHeightPx > 0
    ? sidebarContentHeightPx
    : Math.max(1, snapshot.bounds.workspaceHeightPx)
  const shellClassName = `app-shell${isAssetRailOpen ? ' is-asset-rail-open' : ''}${isInspectorOpen ? ' is-inspector-open' : ''}${isBottomRailOpen ? ' is-bottom-rail-open' : ''}`
  const shellVariables = {
    '--sidebar-width': `${snapshot.mode === 'narrow'
      ? snapshot.preferences.sidebar.widthPx
      : snapshot.resolved.sidebarWidthPx}px`,
    '--inspector-width': `${snapshot.mode === 'wide'
      ? snapshot.resolved.inspectorWidthPx
      : snapshot.preferences.inspector.widthPx}px`,
    '--bottom-height': `${snapshot.resolved.bottomHeightPx}px`,
    '--sidebar-split-percent': splitPercent,
    '--ribbon-height': snapshot.isRibbonExpanded() ? '38px' : '0px',
    height: '100dvh',
    overflow: 'hidden',
  } as CSSProperties

  useEffect(() => {
    const previousRootOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = previousRootOverflow
      document.body.style.overflow = previousBodyOverflow
    }
  }, [])

  useEffect(() => {
    applyThemePreference(snapshot.preferences.theme)
    if (snapshot.preferences.theme !== 'system' || globalThis.matchMedia === undefined) return
    const media = globalThis.matchMedia(DARK_THEME_QUERY)
    const handleChange = () => applyThemePreference('system')
    media.addEventListener?.('change', handleChange)
    return () => media.removeEventListener?.('change', handleChange)
  }, [snapshot.preferences.theme])

  useEffect(() => {
    if (assetRail === null || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === assetRail) ?? entries[0]
      if (entry !== undefined && entry.contentRect.height > 0) {
        setSidebarContentHeightPx(entry.contentRect.height)
      }
    })
    observer.observe(assetRail)
    return () => observer.disconnect()
  }, [assetRail])

  // Ref callbacks used by dock layout can rerender the shell without changing
  // the controller-owned safe-area snapshot. Keep one viewport tree for that
  // exact snapshot so Canvas ownership is not churned by layout bookkeeping.
  const viewport = useMemo(
    () => renderViewport(snapshot.safeAreaInsets),
    [renderViewport, snapshot.safeAreaInsets],
  )

  return (
    <div
      className={shellClassName}
      data-layout-mode={snapshot.mode}
      style={shellVariables}
    >
      {header}
      <DrawerToggleV4 bindings={commandBindings} commandId="view.sidebar" controls="scene-assets-panel" label="Scene Assets drawer" icon={PanelLeft} />
      <DrawerToggleV4 bindings={commandBindings} commandId="view.inspector" controls="inspector-panel" label="Inspector drawer" icon={PanelRight} />
      <DrawerToggleV4 bindings={commandBindings} commandId="view.bottom" controls="timeline-collision-panel" label="Bottom Workspace sheet" icon={ChevronDown} />
      <div className="studio-workspace" ref={workspaceRef}>
        <aside
          aria-label="Scene Assets"
          className={`asset-rail${isAssetRailOpen ? ' is-open' : ''}`}
          data-scene-job-handle={showSceneJobHandle ? 'visible' : 'hidden'}
          hidden={!isAssetRailOpen}
          id="scene-assets-panel"
          ref={setAssetRailRef}
        >
          <section aria-label="Scene Objects" className="sidebar-pane scene-objects-pane" style={{ gridRow: 1 }}>{assetTree}</section>
          {showSceneJobHandle ? (
            <DockResizeHandleV4
              direction={1}
              keyboardStep={1}
              label="Resize Scene Objects and Robot Jobs"
              max={75}
              min={35}
              onChange={(value) => shellLayoutController.setSceneJobSplit(value)}
              onReset={() => shellLayoutController.setSceneJobSplit(60)}
              orientation="horizontal"
              value={splitPercent}
              valueFromPointerDelta={(start, deltaPx) => start + deltaPx / splitReferenceHeightPx * 100}
            />
          ) : null}
          <section
            aria-label="Robot Jobs"
            className="sidebar-pane robot-jobs-pane"
            style={{ gridRow: showSceneJobHandle ? 3 : 2 }}
          >
            {jobTree}
          </section>
        </aside>
        {showSidebarDockHandle ? (
          <DockResizeHandleV4
            direction={1}
            keyboardStep={8}
            label="Resize Scene Assets"
            max={420}
            min={220}
            onChange={(value) => shellLayoutController.setDockSize('sidebar', value)}
            onReset={() => shellLayoutController.setDockSize('sidebar', 248)}
            orientation="vertical"
            value={snapshot.preferences.sidebar.widthPx}
            valueFromPointerDelta={(start, deltaPx) => start + deltaPx}
          />
        ) : null}
        <div className="studio-center-column">
          <main aria-busy={viewportBusy} aria-label="3D viewport" className="viewport">{viewport}</main>
          {showBottomDockHandle ? (
            <DockResizeHandleV4
              direction={-1}
              keyboardStep={8}
              label="Resize Bottom Workspace"
              max={Math.max(120, snapshot.bounds.workspaceHeightPx * 0.45)}
              min={120}
              onChange={(value) => shellLayoutController.setDockSize('bottom', value)}
              onReset={() => shellLayoutController.setDockSize('bottom', 160)}
              orientation="horizontal"
              value={snapshot.preferences.bottom.heightPx}
              valueFromPointerDelta={(start, deltaPx) => start + deltaPx}
            />
          ) : null}
          <section
            aria-hidden={!isBottomRailOpen}
            aria-label="Bottom Workspace"
            className={`bottom-rail${isBottomRailOpen ? ' is-open' : ''}`}
            hidden={!isBottomRailOpen}
            id="timeline-collision-panel"
          >
            <div className="bottom-rail-content">{bottomRail}</div>
          </section>
        </div>
        {showInspectorDockHandle ? (
          <DockResizeHandleV4
            direction={-1}
            keyboardStep={8}
            label="Resize Inspector"
            max={480}
            min={280}
            onChange={(value) => shellLayoutController.setDockSize('inspector', value)}
            onReset={() => shellLayoutController.setDockSize('inspector', 320)}
            orientation="vertical"
            value={snapshot.preferences.inspector.widthPx}
            valueFromPointerDelta={(start, deltaPx) => start + deltaPx}
          />
        ) : null}
        <aside
          aria-label="Inspector"
          className={`inspector${isInspectorOpen ? ' is-open' : ''}`}
          hidden={!isInspectorOpen}
          id="inspector-panel"
        >
          {inspector}
        </aside>
      </div>
    </div>
  )
}
