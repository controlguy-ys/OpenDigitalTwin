import { ChevronDown, PanelLeft, PanelRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { JointQuality } from '../domain/robot/joint-frame'

type JointSourceMode = 'simulation' | 'opcua'

interface AppShellProps {
  viewport: ReactNode
  assetTree?: ReactNode
  inspector?: ReactNode
  bottomRail?: ReactNode
  controlsDisabled?: boolean
  viewportBusy?: boolean
  sourceQuality?: JointQuality
  onOpenStepImport?: () => void
  onOpenRobotImport?: () => void
  onOpenRobotConfiguration?: () => void
  onOpenRobotGeometry?: () => void
  sourceMode?: JointSourceMode
  onSourceModeChange?: (mode: JointSourceMode) => void
}

export function AppShell({
  viewport,
  assetTree,
  inspector,
  bottomRail,
  controlsDisabled = false,
  viewportBusy = controlsDisabled,
  sourceQuality = 'GOOD',
  onOpenStepImport,
  onOpenRobotImport,
  onOpenRobotConfiguration,
  onOpenRobotGeometry,
  sourceMode = 'simulation',
  onSourceModeChange,
}: AppShellProps) {
  const [isAssetRailOpen, setIsAssetRailOpen] = useState(false)
  const [isInspectorOpen, setIsInspectorOpen] = useState(false)
  const [isBottomRailOpen, setIsBottomRailOpen] = useState(false)

  return (
    <div
      className="app-shell"
      data-controls-disabled={String(controlsDisabled)}
    >
      <header className="top-bar">
        <strong>RobotSim</strong>
        <span>SIMULATION</span>
        <span className="source-quality" data-quality={sourceQuality}>
          {sourceQuality}
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
        <button onClick={onOpenStepImport} type="button">
          Import STEP
        </button>
        <button onClick={onOpenRobotImport} type="button">
          Import Robot STEP
        </button>
        <button onClick={onOpenRobotConfiguration} type="button">
          Robot Config
        </button>
        <button onClick={onOpenRobotGeometry} type="button">
          Robot Geometry
        </button>
      </header>
      <button
        aria-controls="scene-assets-panel"
        aria-expanded={isAssetRailOpen}
        aria-label="Scene Assets drawer"
        className={`drawer-control drawer-control-left${isAssetRailOpen ? ' is-open' : ''}`}
        onClick={() => setIsAssetRailOpen((isOpen) => !isOpen)}
        type="button"
      >
        <PanelLeft aria-hidden="true" size={16} strokeWidth={1.75} />
      </button>
      <button
        aria-controls="inspector-panel"
        aria-expanded={isInspectorOpen}
        aria-label="Inspector drawer"
        className={`drawer-control drawer-control-right${isInspectorOpen ? ' is-open' : ''}`}
        onClick={() => setIsInspectorOpen((isOpen) => !isOpen)}
        type="button"
      >
        <PanelRight aria-hidden="true" size={16} strokeWidth={1.75} />
      </button>
      <button
        aria-controls="timeline-events-panel"
        aria-expanded={isBottomRailOpen}
        aria-label="Timeline and Events sheet"
        className={`drawer-control sheet-control${isBottomRailOpen ? ' is-open' : ''}`}
        onClick={() => setIsBottomRailOpen((isOpen) => !isOpen)}
        type="button"
      >
        <ChevronDown aria-hidden="true" size={16} strokeWidth={1.75} />
      </button>
      <aside
        aria-label="Scene Assets"
        className={`asset-rail${isAssetRailOpen ? ' is-open' : ''}`}
        id="scene-assets-panel"
      >
        {assetTree}
      </aside>
      <main
        aria-busy={viewportBusy}
        aria-label="3D viewport"
        className="viewport"
      >
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
        aria-label="Timeline and Events"
        className={`bottom-rail${isBottomRailOpen ? ' is-open' : ''}`}
        id="timeline-events-panel"
      >
        <div className="bottom-rail-content">{bottomRail}</div>
      </section>
    </div>
  )
}
