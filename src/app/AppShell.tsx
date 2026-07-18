import { ChevronDown, PanelLeft, PanelRight } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

import {
  applyThemePreference,
  DARK_THEME_QUERY,
  type ThemePreference,
} from '../features/ui/theme-preference'
import { DockResizeHandleV4 } from '../features/ui/v4/DockResizeHandleV4.js'
import type { ShellLayoutControllerV4 } from '../features/ui/v4/shell-layout-controller.js'
import { isSceneJobResizeAvailableV4 } from '../features/ui/v4/shell-layout-geometry.js'
import { useShellLayoutObserverV4 } from '../features/ui/v4/use-shell-layout-observer.js'

export interface AppShellPropsV4 {
  readonly shellLayoutController: ShellLayoutControllerV4
  readonly viewport: ReactNode
  readonly projectMenu?: ReactNode
  readonly assetTree?: ReactNode
  readonly jobTree?: ReactNode
  readonly inspector?: ReactNode
  readonly bottomRail?: ReactNode
  readonly controlsDisabled?: boolean
  readonly viewportBusy?: boolean
  readonly robotSourceLabel?: string | null
  readonly onCreateBox?: () => void
  readonly onCreateCylinder?: () => void
  readonly onCreateGroup?: () => void
}

export function AppShellV4({
  shellLayoutController,
  viewport,
  projectMenu,
  assetTree,
  jobTree,
  inspector,
  bottomRail,
  controlsDisabled = false,
  viewportBusy = controlsDisabled,
  robotSourceLabel = null,
  onCreateBox,
  onCreateCylinder,
  onCreateGroup,
}: AppShellPropsV4) {
  const { snapshot, workspaceRef } = useShellLayoutObserverV4(shellLayoutController)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isCompactControlsOpen, setIsCompactControlsOpen] = useState(false)
  const [assetRail, setAssetRail] = useState<HTMLElement | null>(null)
  const [sidebarContentHeightPx, setSidebarContentHeightPx] = useState(0)
  const setAssetRailRef = useCallback((element: HTMLElement | null) => setAssetRail(element), [])
  const isCompactTopBar = snapshot.mode !== 'wide'
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
  const shellClassName = `app-shell${isCompactTopBar ? ' is-compact-topbar' : ''}${isAssetRailOpen ? ' is-asset-rail-open' : ''}${isInspectorOpen ? ' is-inspector-open' : ''}${isBottomRailOpen ? ' is-bottom-rail-open' : ''}`
  const shellVariables = {
    '--sidebar-width': `${snapshot.mode === 'narrow'
      ? snapshot.preferences.sidebar.widthPx
      : snapshot.resolved.sidebarWidthPx}px`,
    '--inspector-width': `${snapshot.mode === 'wide'
      ? snapshot.resolved.inspectorWidthPx
      : snapshot.preferences.inspector.widthPx}px`,
    '--bottom-height': `${snapshot.resolved.bottomHeightPx}px`,
    '--sidebar-split-percent': splitPercent,
    '--ribbon-height': '0px',
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
    if (!isCompactTopBar) setIsCompactControlsOpen(false)
  }, [isCompactTopBar])

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

  const setDrawer = (dock: 'sidebar' | 'inspector' | 'bottom', open: boolean) => {
    shellLayoutController.setDockVisible(dock, open)
  }
  const runAddCommand = (command?: () => void) => {
    setIsAddOpen(false)
    if (controlsDisabled) return
    command?.()
  }

  return (
    <div
      className={shellClassName}
      data-controls-disabled={String(controlsDisabled)}
      data-layout-mode={snapshot.mode}
      style={shellVariables}
    >
      <header className="top-bar">
        <strong>RobotSim</strong>
        {isCompactTopBar ? (
          <button
            aria-controls="top-bar-controls"
            aria-expanded={isCompactControlsOpen}
            aria-label="Top bar controls"
            className="top-bar-disclosure"
            onClick={() => setIsCompactControlsOpen((open) => !open)}
            type="button"
          >
            Controls
          </button>
        ) : null}
        <div
          aria-label="Top bar controls"
          className={`top-bar-controls${isCompactControlsOpen ? ' is-open' : ''}`}
          hidden={isCompactTopBar && !isCompactControlsOpen}
          id="top-bar-controls"
          role="toolbar"
        >
          {projectMenu}
          <span>SIMULATION</span>
          {robotSourceLabel === null ? null : (
            <span className="joint-source-label">Joint source: {robotSourceLabel}</span>
          )}
          <div className="add-menu">
            <button
              aria-expanded={isAddOpen}
              aria-haspopup="menu"
              disabled={controlsDisabled}
              onClick={() => setIsAddOpen((open) => !open)}
              type="button"
            >
              Add
            </button>
            {isAddOpen && !controlsDisabled ? (
              <div aria-label="Add" role="menu">
                <button onClick={() => runAddCommand(onCreateBox)} role="menuitem" type="button">Box</button>
                <button onClick={() => runAddCommand(onCreateCylinder)} role="menuitem" type="button">Cylinder</button>
                <button onClick={() => runAddCommand(onCreateGroup)} role="menuitem" type="button">Group</button>
              </div>
            ) : null}
          </div>
          <label className="theme-select">
            <span>Theme</span>
            <select
              aria-label="Theme"
              onChange={(event) => shellLayoutController.setTheme(
                event.currentTarget.value as ThemePreference,
              )}
              value={snapshot.preferences.theme}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </header>
      <button
        aria-controls="scene-assets-panel"
        aria-expanded={isAssetRailOpen}
        aria-label="Scene Assets drawer"
        className={`drawer-control drawer-control-left${isAssetRailOpen ? ' is-open' : ''}`}
        onClick={() => setDrawer('sidebar', !isAssetRailOpen)}
        type="button"
      >
        <PanelLeft aria-hidden="true" size={16} strokeWidth={1.75} />
      </button>
      <button
        aria-controls="inspector-panel"
        aria-expanded={isInspectorOpen}
        aria-label="Inspector drawer"
        className={`drawer-control drawer-control-right${isInspectorOpen ? ' is-open' : ''}`}
        onClick={() => setDrawer('inspector', !isInspectorOpen)}
        type="button"
      >
        <PanelRight aria-hidden="true" size={16} strokeWidth={1.75} />
      </button>
      <button
        aria-controls="timeline-collision-panel"
        aria-expanded={isBottomRailOpen}
        aria-label="Bottom Workspace sheet"
        className={`drawer-control sheet-control${isBottomRailOpen ? ' is-open' : ''}`}
        onClick={() => setDrawer('bottom', !isBottomRailOpen)}
        type="button"
      >
        <ChevronDown aria-hidden="true" size={16} strokeWidth={1.75} />
      </button>
      <div className="studio-workspace" ref={workspaceRef}>
        <aside
          aria-label="Scene Assets"
          className={`asset-rail${isAssetRailOpen ? ' is-open' : ''}`}
          hidden={!isAssetRailOpen}
          id="scene-assets-panel"
          ref={setAssetRailRef}
        >
          <section aria-label="Scene Objects" className="sidebar-pane scene-objects-pane">{assetTree}</section>
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
          <section aria-label="Robot Jobs" className="sidebar-pane robot-jobs-pane">{jobTree}</section>
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
