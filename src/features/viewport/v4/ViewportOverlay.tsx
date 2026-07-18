import type { CSSProperties, ReactNode } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import type { WorkcellProjectV4 } from '../../../core/project-v4/index.js'
import type { CoordinateDisplayStoreStateV4 } from '../../frames/v4/coordinate-display-store.js'
import type { SceneSelectionV4 } from '../../interaction/v4/scene-selection.js'
import type { SceneRuntimeProjectionV4 } from '../../scene/v4/scene-runtime-selector.js'
import { CoordinateStatusBarV4 } from './CoordinateStatusBar.js'
import { ViewOrientationControlV4 } from './ViewOrientationControl.js'
import type {
  ViewportLayerV4,
  ViewportPreferenceStoreV4,
} from './viewport-preference-store.js'
import type { AppCommandBindingsV4 } from '../../commands/v4/app-command-runtime.js'
import { useAppCommandV4 } from '../../commands/v4/use-app-command.js'
import type { ViewportSafeAreaInsetsV4 } from './viewport-safe-area.js'

export interface ViewportOverlayPropsV4 {
  readonly commandBindings: AppCommandBindingsV4
  readonly safeAreaInsets: ViewportSafeAreaInsetsV4
  readonly project: WorkcellProjectV4
  readonly runtime: SceneRuntimeProjectionV4
  readonly selection: SceneSelectionV4
  readonly display: StoreApi<CoordinateDisplayStoreStateV4>
  readonly preferences: ViewportPreferenceStoreV4
}

const LAYER_CONTROLS_V4 = [
  ['grid', 'Grid', 'Grid'],
  ['worldFrame', 'World Frame', 'World'],
  ['mcpFrame', 'Machine Centric Point Frames', 'MCP'],
  ['baseFrame', 'Selected Robot Base Frame', 'Base'],
  ['tcpFrame', 'Selected Robot Actual TCP Frame', 'TCP'],
] as const satisfies readonly (
  readonly [ViewportLayerV4, string, string]
)[]

export function ViewportOverlayV4({
  commandBindings,
  safeAreaInsets,
  project,
  runtime,
  selection,
  display,
  preferences,
}: ViewportOverlayPropsV4): ReactNode {
  const home = useAppCommandV4(commandBindings, 'view.home')
  const fitAll = useAppCommandV4(commandBindings, 'view.fitAll')
  const focus = useAppCommandV4(commandBindings, 'view.focusSelection')
  const grid = useAppCommandV4(commandBindings, 'view.layer.grid')
  const world = useAppCommandV4(commandBindings, 'view.layer.world')
  const mcp = useAppCommandV4(commandBindings, 'view.layer.mcp')
  const base = useAppCommandV4(commandBindings, 'view.layer.base')
  const tcp = useAppCommandV4(commandBindings, 'view.layer.tcp')
  const layerCommands = [grid, world, mcp, base, tcp]
  const normalized = (value: number): number => Number.isFinite(value) && value >= 0 ? value : 0
  const style = {
    '--viewport-safe-top': `${normalized(safeAreaInsets.top)}px`,
    '--viewport-safe-right': `${normalized(safeAreaInsets.right)}px`,
    '--viewport-safe-bottom': `${normalized(safeAreaInsets.bottom)}px`,
    '--viewport-safe-left': `${normalized(safeAreaInsets.left)}px`,
  } as CSSProperties

  return (
    <div className="viewport-overlay viewport-overlay-v4" style={style}>
      <div aria-label="Camera controls" className="viewport-camera-controls">
        <div className="viewport-camera-actions">
          <button
            aria-label="Home View"
            disabled={home.command === null || !home.command.visible || !home.command.enabled || home.pending}
            onClick={() => void home.invoke()}
            title="Restore application Home View"
            type="button"
          >Home</button>
          <button
            aria-label="Fit All"
            disabled={fitAll.command === null || !fitAll.command.visible || !fitAll.command.enabled || fitAll.pending}
            onClick={() => void fitAll.invoke()}
            title="Frame visible Project entities"
            type="button"
          >Fit</button>
          <button
            aria-label="Focus Selection"
            disabled={focus.command === null || !focus.command.visible || !focus.command.enabled || focus.pending}
            onClick={() => void focus.invoke()}
            title="Frame selected visible Project entity"
            type="button"
          >Focus</button>
          <ViewOrientationControlV4 commandBindings={commandBindings} />
        </div>
      </div>
      <div aria-label="Coordinate layers" className="viewport-layer-controls">
        {LAYER_CONTROLS_V4.map(([layer, label, shortLabel], index) => {
          const bound = layerCommands[index]!
          return (
          <button
            aria-label={label}
            aria-pressed={bound.command?.checked === true}
            className={bound.command?.checked === true ? 'is-active' : undefined}
            disabled={bound.command === null || !bound.command.visible || !bound.command.enabled || bound.pending}
            key={layer}
            onClick={() => void bound.invoke()}
            title={`Toggle ${label}`}
            type="button"
          >{shortLabel}</button>
          )
        })}
      </div>
      <CoordinateStatusBarV4
        display={display}
        preferences={preferences}
        project={project}
        runtime={runtime}
        selection={selection}
      />
      {[home.error, fitAll.error, focus.error, ...layerCommands.map(({ error }) => error)].find((error) => error !== null) === null ? null : (
        <p role="alert">{[home.error, fitAll.error, focus.error, ...layerCommands.map(({ error }) => error)].find((error) => error !== null)}</p>
      )}
    </div>
  )
}
