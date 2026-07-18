import type { ReactNode } from 'react'
import { useStore } from 'zustand'
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
import type { ViewportRuntimeControllerV4 } from './viewport-runtime.js'

export interface ViewportOverlayPropsV4 {
  readonly actions: ViewportRuntimeControllerV4['actions']
  readonly canFocusSelection: boolean
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
  actions,
  canFocusSelection,
  project,
  runtime,
  selection,
  display,
  preferences,
}: ViewportOverlayPropsV4): ReactNode {
  const layers = useStore(preferences, (state) => state.layers)

  return (
    <div className="viewport-overlay viewport-overlay-v4">
      <div aria-label="Camera controls" className="viewport-camera-controls">
        <div className="viewport-camera-actions">
          <button
            aria-label="Home View"
            onClick={actions.home}
            title="Restore application Home View"
            type="button"
          >Home</button>
          <button
            aria-label="Fit All"
            onClick={actions.fitAll}
            title="Frame visible Project entities"
            type="button"
          >Fit</button>
          <button
            aria-label="Focus Selection"
            disabled={!canFocusSelection}
            onClick={actions.focusSelection}
            title="Frame selected visible Project entity"
            type="button"
          >Focus</button>
          <ViewOrientationControlV4 onSelect={actions.setStandardView} />
        </div>
      </div>
      <div aria-label="Coordinate layers" className="viewport-layer-controls">
        {LAYER_CONTROLS_V4.map(([layer, label, shortLabel]) => (
          <button
            aria-label={label}
            aria-pressed={layers[layer]}
            className={layers[layer] ? 'is-active' : undefined}
            key={layer}
            onClick={() => preferences.getState().setLayer(layer, !layers[layer])}
            title={`Toggle ${label}`}
            type="button"
          >{shortLabel}</button>
        ))}
      </div>
      <CoordinateStatusBarV4
        display={display}
        preferences={preferences}
        project={project}
        runtime={runtime}
        selection={selection}
      />
    </div>
  )
}
