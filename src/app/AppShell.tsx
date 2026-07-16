import { ChevronDown, PanelLeft, PanelRight } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { JointQuality } from '../domain/robot/joint-frame'
import {
  applyThemePreference,
  DARK_THEME_QUERY,
  readThemePreference,
  writeThemePreference,
  type ThemePreference,
} from '../features/ui/theme-preference'

type JointSourceMode = 'simulation' | 'opcua'

const SIDEBAR_SPLIT_KEY = 'robotsim.sidebarSplitPercent'
const ASSET_DRAWER_KEY = 'robotsim.assetDrawerOpen'
const INSPECTOR_DRAWER_KEY = 'robotsim.inspectorDrawerOpen'
const BOTTOM_DRAWER_KEY = 'robotsim.bottomDrawerOpen'
const COMPACT_TOP_BAR_QUERY = '(max-width: 1199px)'

function compactTopBarPreference(): boolean {
  return globalThis.matchMedia?.(COMPACT_TOP_BAR_QUERY).matches ?? false
}

function browserNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function browserBoolean(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function persistPreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Browser preferences are optional and never affect Project content.
  }
}

function clampSplit(value: number): number {
  return Math.min(75, Math.max(35, Math.round(value)))
}

interface AppShellProps {
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
  sourceQuality?: JointQuality
  onOpenStepImport?: () => void
  onOpenRobotImport?: () => void
  onCreateBox?: () => void
  onCreateCylinder?: () => void
  onCreateGroup?: () => void
  onCreateLinearAxis?: () => void
  linearAxisAvailable?: boolean
  sourceMode?: JointSourceMode
  onSourceModeChange?: (mode: JointSourceMode) => void
}

export function AppShell({
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
  sourceQuality = 'GOOD',
  onOpenStepImport,
  onOpenRobotImport,
  onCreateBox,
  onCreateCylinder,
  onCreateGroup,
  onCreateLinearAxis,
  linearAxisAvailable = true,
  sourceMode = 'simulation',
  onSourceModeChange,
}: AppShellProps) {
  const [isAssetRailOpen, setIsAssetRailOpen] = useState(() => browserBoolean(ASSET_DRAWER_KEY))
  const [isInspectorOpen, setIsInspectorOpen] = useState(() => browserBoolean(INSPECTOR_DRAWER_KEY))
  const [isBottomRailOpen, setIsBottomRailOpen] = useState(() => browserBoolean(BOTTOM_DRAWER_KEY))
  const [splitPercent, setSplitPercent] = useState(() => clampSplit(browserNumber(SIDEBAR_SPLIT_KEY, 60)))
  const [draggingSplit, setDraggingSplit] = useState(false)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isCompactControlsOpen, setIsCompactControlsOpen] = useState(false)
  const [isCompactTopBar, setIsCompactTopBar] = useState(compactTopBarPreference)
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference)
  const assetRailRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (globalThis.matchMedia === undefined) return
    const media = globalThis.matchMedia(COMPACT_TOP_BAR_QUERY)
    const updateMode = () => {
      setIsCompactTopBar(media.matches)
      if (!media.matches) setIsCompactControlsOpen(false)
    }
    media.addEventListener?.('change', updateMode)
    return () => media.removeEventListener?.('change', updateMode)
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
    setIsBottomRailOpen(true)
    persistPreference(BOTTOM_DRAWER_KEY, 'true')
  }, [bottomRailOpenRequest])

  useEffect(() => {
    if (inspectorOpenRequest <= 0) return
    setIsInspectorOpen(true)
    persistPreference(INSPECTOR_DRAWER_KEY, 'true')
  }, [inspectorOpenRequest])

  useEffect(() => {
    applyThemePreference(theme)
    if (theme !== 'system' || globalThis.matchMedia === undefined) return
    const media = globalThis.matchMedia(DARK_THEME_QUERY)
    const handleChange = () => applyThemePreference('system')
    media.addEventListener?.('change', handleChange)
    return () => media.removeEventListener?.('change', handleChange)
  }, [theme])

  useEffect(() => {
    if (!draggingSplit) return
    const handlePointerMove = (event: PointerEvent) => {
      const bounds = assetRailRef.current?.getBoundingClientRect()
      if (bounds === undefined || bounds.height <= 0) return
      const next = clampSplit((event.clientY - bounds.top) / bounds.height * 100)
      setSplitPercent(next)
      persistPreference(SIDEBAR_SPLIT_KEY, String(next))
    }
    const finish = () => setDraggingSplit(false)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finish)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finish)
    }
  }, [draggingSplit])

  const setDrawer = (
    setter: (open: boolean) => void,
    key: string,
    open: boolean,
  ) => {
    setter(open)
    persistPreference(key, String(open))
  }

  const runAddCommand = (command?: () => void) => {
    setIsAddOpen(false)
    command?.()
  }

  return (
    <div
      className={`app-shell${isCompactTopBar ? ' is-compact-topbar' : ''}${isBottomRailOpen ? ' is-bottom-rail-open' : ''}`}
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
          <span
            aria-label={`Joint source quality ${sourceQuality}`}
            aria-live="polite"
            className="source-quality"
            data-quality={sourceQuality}
            role="status"
          >
            JOINT {sourceQuality}
          </span>
          <label className="joint-source-select">
            <span>Joint source</span>
            <select
              aria-label="Joint source"
              onChange={(event) =>
                onSourceModeChange?.(event.currentTarget.value as JointSourceMode)
              }
              value={sourceMode}
            >
              <option value="simulation">Simulation</option>
              <option value="opcua">OPC UA</option>
            </select>
          </label>
          <div className="add-menu">
            <button
              aria-expanded={isAddOpen}
              aria-haspopup="menu"
              onClick={() => setIsAddOpen((open) => !open)}
              type="button"
            >
              Add
            </button>
            {isAddOpen ? (
              <div aria-label="Add" role="menu">
                <button onClick={() => runAddCommand(onOpenStepImport)} role="menuitem" type="button">Import STEP</button>
                <button onClick={() => runAddCommand(onOpenRobotImport)} role="menuitem" type="button">Import Robot</button>
                <button onClick={() => runAddCommand(onCreateBox)} role="menuitem" type="button">Box</button>
                <button onClick={() => runAddCommand(onCreateCylinder)} role="menuitem" type="button">Cylinder</button>
                <button onClick={() => runAddCommand(onCreateGroup)} role="menuitem" type="button">Group</button>
                <button
                  disabled={!linearAxisAvailable}
                  onClick={() => runAddCommand(onCreateLinearAxis)}
                  role="menuitem"
                  type="button"
                >Linear Axis</button>
              </div>
            ) : null}
          </div>
          <label className="theme-select">
            <span>Theme</span>
            <select
              aria-label="Theme"
              onChange={(event) => {
                const preference = event.currentTarget.value as ThemePreference
                setTheme(preference)
                writeThemePreference(preference)
              }}
              value={theme}
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
        onClick={() => setDrawer(setIsAssetRailOpen, ASSET_DRAWER_KEY, !isAssetRailOpen)}
        type="button"
      >
        <PanelLeft aria-hidden="true" size={16} strokeWidth={1.75} />
      </button>
      <button
        aria-controls="inspector-panel"
        aria-expanded={isInspectorOpen}
        aria-label="Inspector drawer"
        className={`drawer-control drawer-control-right${isInspectorOpen ? ' is-open' : ''}`}
        onClick={() => setDrawer(setIsInspectorOpen, INSPECTOR_DRAWER_KEY, !isInspectorOpen)}
        type="button"
      >
        <PanelRight aria-hidden="true" size={16} strokeWidth={1.75} />
      </button>
      <button
        aria-controls="timeline-events-panel"
        aria-expanded={isBottomRailOpen}
        aria-label="Timeline and Events sheet"
        className={`drawer-control sheet-control${isBottomRailOpen ? ' is-open' : ''}`}
        onClick={() => setDrawer(setIsBottomRailOpen, BOTTOM_DRAWER_KEY, !isBottomRailOpen)}
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
            setSplitPercent(next)
            persistPreference(SIDEBAR_SPLIT_KEY, String(next))
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
