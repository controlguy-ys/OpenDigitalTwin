import { ChevronDown, PanelLeft, PanelRight } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useStore } from 'zustand'
import {
  applyThemePreference,
  DARK_THEME_QUERY,
  type ThemePreference,
} from '../features/ui/theme-preference'
import type {
  ShellDockV4,
  ShellLayoutModeV4,
  ShellLayoutStoreV4,
} from '../features/ui/v4/shell-layout-store.js'

const COMPACT_TOP_BAR_QUERY = '(max-width: 1199px)'
const DESKTOP_WORKSPACE_QUERY = '(min-width: 960px)'

function compactTopBarPreference(): boolean {
  return globalThis.matchMedia?.(COMPACT_TOP_BAR_QUERY).matches ?? false
}

function desktopInspectorPreference(): boolean {
  return globalThis.matchMedia?.(DESKTOP_WORKSPACE_QUERY).matches ?? false
}

function clampSplit(value: number): number {
  return Math.min(75, Math.max(35, Math.round(value)))
}

function compatibilityLayoutModeV4(
  compact: boolean,
  desktop: boolean,
): ShellLayoutModeV4 {
  if (!compact) return 'wide'
  return desktop ? 'compact' : 'narrow'
}

export interface AppShellPropsV4 {
  readonly shellLayoutStore: ShellLayoutStoreV4
  viewport: ReactNode
  projectMenu?: ReactNode
  assetTree?: ReactNode
  jobTree?: ReactNode
  inspector?: ReactNode
  bottomRail?: ReactNode
  bottomRailOpenRequest?: number
  inspectorOpenRequest?: number
  controlsDisabled?: boolean
  viewportBusy?: boolean
  robotSourceLabel?: string | null
  onCreateBox?: () => void
  onCreateCylinder?: () => void
  onCreateGroup?: () => void
}

export function AppShellV4({
  shellLayoutStore,
  viewport,
  projectMenu,
  assetTree,
  jobTree,
  inspector,
  bottomRail,
  bottomRailOpenRequest = 0,
  inspectorOpenRequest = 0,
  controlsDisabled = false,
  viewportBusy = controlsDisabled,
  robotSourceLabel = null,
  onCreateBox,
  onCreateCylinder,
  onCreateGroup,
}: AppShellPropsV4) {
  const preferences = useStore(shellLayoutStore, (state) => state.preferences)
  const [isTransientAssetRailOpen, setIsTransientAssetRailOpen] = useState(false)
  const [isTransientInspectorOpen, setIsTransientInspectorOpen] = useState(false)
  const [isTransientBottomRailOpen, setIsTransientBottomRailOpen] = useState(false)
  const [draggingSplit, setDraggingSplit] = useState(false)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isCompactControlsOpen, setIsCompactControlsOpen] = useState(false)
  const [isCompactTopBar, setIsCompactTopBar] = useState(compactTopBarPreference)
  const [isDesktopWorkspace, setIsDesktopWorkspace] = useState(desktopInspectorPreference)
  const assetRailRef = useRef<HTMLElement>(null)
  const layoutMode = compatibilityLayoutModeV4(
    isCompactTopBar,
    isDesktopWorkspace,
  )
  const isAssetRailOpen = layoutMode === 'narrow'
    ? isTransientAssetRailOpen
    : preferences.modes[layoutMode].dockVisible.sidebar
  const isInspectorOpen = layoutMode === 'wide'
    ? preferences.modes.wide.dockVisible.inspector
    : isTransientInspectorOpen
  const isBottomRailOpen = layoutMode === 'narrow'
    ? isTransientBottomRailOpen
    : preferences.modes[layoutMode].dockVisible.bottom
  const splitPercent = preferences.sidebar.sceneJobSplitPercent

  useEffect(() => {
    if (globalThis.matchMedia === undefined) return
    const compactMedia = globalThis.matchMedia(COMPACT_TOP_BAR_QUERY)
    const desktopMedia = globalThis.matchMedia(DESKTOP_WORKSPACE_QUERY)
    const updateMode = () => {
      setIsCompactTopBar(compactMedia.matches)
      setIsDesktopWorkspace(desktopMedia.matches)
      if (!compactMedia.matches) setIsCompactControlsOpen(false)
    }
    compactMedia.addEventListener?.('change', updateMode)
    desktopMedia.addEventListener?.('change', updateMode)
    return () => {
      compactMedia.removeEventListener?.('change', updateMode)
      desktopMedia.removeEventListener?.('change', updateMode)
    }
  }, [])

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
    if (bottomRailOpenRequest <= 0) return
    if (layoutMode === 'narrow') setIsTransientBottomRailOpen(true)
    else shellLayoutStore.getState().setDockedVisible(layoutMode, 'bottom', true)
  }, [bottomRailOpenRequest, layoutMode, shellLayoutStore])

  useEffect(() => {
    if (inspectorOpenRequest <= 0) return
    if (layoutMode === 'wide') {
      shellLayoutStore.getState().setDockedVisible('wide', 'inspector', true)
    } else {
      setIsTransientInspectorOpen(true)
    }
  }, [inspectorOpenRequest, layoutMode, shellLayoutStore])

  useEffect(() => {
    applyThemePreference(preferences.theme)
    if (preferences.theme !== 'system' || globalThis.matchMedia === undefined) return
    const media = globalThis.matchMedia(DARK_THEME_QUERY)
    const handleChange = () => applyThemePreference('system')
    media.addEventListener?.('change', handleChange)
    return () => media.removeEventListener?.('change', handleChange)
  }, [preferences.theme])

  useEffect(() => {
    if (!draggingSplit) return
    const handlePointerMove = (event: PointerEvent) => {
      const bounds = assetRailRef.current?.getBoundingClientRect()
      if (bounds === undefined || bounds.height <= 0) return
      const next = clampSplit((event.clientY - bounds.top) / bounds.height * 100)
      shellLayoutStore.getState().setSceneJobSplit(next)
    }
    const finish = () => setDraggingSplit(false)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finish)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finish)
    }
  }, [draggingSplit, shellLayoutStore])

  const setDrawer = (dock: ShellDockV4, open: boolean) => {
    if (layoutMode === 'wide' || (
      layoutMode === 'compact' && (dock === 'sidebar' || dock === 'bottom')
    )) {
      shellLayoutStore.getState().setDockedVisible(layoutMode, dock, open)
      return
    }
    if (dock === 'sidebar') setIsTransientAssetRailOpen(open)
    else if (dock === 'inspector') setIsTransientInspectorOpen(open)
    else setIsTransientBottomRailOpen(open)
  }

  const runAddCommand = (command?: () => void) => {
    setIsAddOpen(false)
    if (controlsDisabled) return
    command?.()
  }

  return (
    <div
      className={`app-shell${isCompactTopBar ? ' is-compact-topbar' : ''}${isInspectorOpen ? ' is-inspector-open' : ''}${isBottomRailOpen ? ' is-bottom-rail-open' : ''}`}
      data-controls-disabled={String(controlsDisabled)}
      style={{
        '--sidebar-split-percent': splitPercent,
        height: '100dvh',
        overflow: 'hidden',
      } as CSSProperties}
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
            <span className="joint-source-label">
              Joint source: {robotSourceLabel}
            </span>
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
              onChange={(event) => {
                shellLayoutStore.getState().setTheme(
                  event.currentTarget.value as ThemePreference,
                )
              }}
              value={preferences.theme}
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
        aria-controls="timeline-events-panel"
        aria-expanded={isBottomRailOpen}
        aria-label="Timeline and Events sheet"
        className={`drawer-control sheet-control${isBottomRailOpen ? ' is-open' : ''}`}
        onClick={() => setDrawer('bottom', !isBottomRailOpen)}
        type="button"
      >
        <ChevronDown aria-hidden="true" size={16} strokeWidth={1.75} />
      </button>
      <aside
        aria-label="Scene Assets"
        className={`asset-rail${isAssetRailOpen ? ' is-open' : ''}`}
        id="scene-assets-panel"
        ref={assetRailRef}
      >
        <section aria-label="Scene Objects" className="sidebar-pane scene-objects-pane">
          {assetTree}
        </section>
        <div
          aria-label="Resize Scene Objects and Robot Jobs"
          aria-orientation="horizontal"
          aria-valuemax={75}
          aria-valuemin={35}
          aria-valuenow={splitPercent}
          className="sidebar-divider"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            event.preventDefault()
            const next = clampSplit(splitPercent + (event.key === 'ArrowDown' ? 1 : -1))
            shellLayoutStore.getState().setSceneJobSplit(next)
          }}
          onPointerDown={() => setDraggingSplit(true)}
          role="separator"
          tabIndex={0}
        />
        <section aria-label="Robot Jobs" className="sidebar-pane robot-jobs-pane">
          {jobTree}
        </section>
      </aside>
      <main aria-busy={viewportBusy} aria-label="3D viewport" className="viewport">
        {viewport}
      </main>
      <aside
        aria-label="Inspector"
        className={`inspector${isInspectorOpen ? ' is-open' : ''}`}
        hidden={!isInspectorOpen}
        id="inspector-panel"
      >
        {inspector}
      </aside>
      <section
        aria-hidden={!isBottomRailOpen}
        aria-label="Timeline and Events"
        className={`bottom-rail${isBottomRailOpen ? ' is-open' : ''}`}
        id="timeline-events-panel"
      >
        <div className="bottom-rail-content" hidden={!isBottomRailOpen}>{bottomRail}</div>
      </section>
    </div>
  )
}
