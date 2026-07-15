import type { ViewportPreferenceStore, ViewportLayer } from './viewport-preference-store'
import { useViewportPreferenceStore, viewportPreferenceStore } from './viewport-preference-store'
import type { StandardWorldView } from './camera-actions'
import { CoordinateStatusBar } from './CoordinateStatusBar'
import { ViewCube } from './ViewCube'
import type { CoordinateFrameMatrices } from './coordinate-pose-readout'

export interface ViewportOverlayCameraCommands {
  home(): void
  fitAll(): void
  focusSelection(): void
  setStandardView(view: StandardWorldView): void
}

export interface ViewportOverlayProps {
  readonly actions: ViewportOverlayCameraCommands
  readonly canFocusSelection: boolean
  readonly robotRevision?: number
  readonly activeTcpName?: string
  readonly frameMatrices?: CoordinateFrameMatrices | null
  readonly store?: ViewportPreferenceStore
}

const LAYERS = [
  ['grid', 'Grid'],
  ['worldFrame', 'World Frame'],
  ['baseFrame', 'Robot Base Frame'],
  ['tcpFrame', 'Actual TCP Frame'],
] as const satisfies readonly (readonly [ViewportLayer, string])[]

export function ViewportOverlay({
  actions,
  canFocusSelection,
  robotRevision,
  activeTcpName = 'Actual TCP',
  frameMatrices = null,
  store = viewportPreferenceStore,
}: ViewportOverlayProps) {
  const layers = useViewportPreferenceStore((state) => state.layers, store)
  return (
    <div className="viewport-overlay">
      <div aria-label="Camera controls" className="viewport-camera-controls">
        <ViewCube
          {...(robotRevision === undefined ? {} : { robotRevision })}
          setStandardView={actions.setStandardView}
        />
        <div className="viewport-camera-actions">
          <button aria-label="Home View" onClick={actions.home} title="Restore application Home View" type="button">Home</button>
          <button aria-label="Fit All" onClick={actions.fitAll} title="Frame visible scene entities" type="button">Fit</button>
          <button aria-label="Focus Selection" disabled={!canFocusSelection} onClick={actions.focusSelection} title="Frame selected visible entity" type="button">Focus</button>
        </div>
      </div>
      <div aria-label="Coordinate layers" className="viewport-layer-controls">
        {LAYERS.map(([layer, label]) => (
          <button
            aria-label={label}
            aria-pressed={layers[layer]}
            className={layers[layer] ? 'is-active' : undefined}
            key={layer}
            onClick={() => store.getState().setLayer(layer, !layers[layer])}
            title={`Toggle ${label}`}
            type="button"
          >{label.replace(' Frame', '')}</button>
        ))}
      </div>
      <CoordinateStatusBar
        activeTcpName={activeTcpName}
        frameMatrices={frameMatrices}
        store={store}
      />
    </div>
  )
}
