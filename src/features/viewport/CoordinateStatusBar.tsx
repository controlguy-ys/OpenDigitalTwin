import type { ViewportPreferenceStore } from './viewport-preference-store'
import { useViewportPreferenceStore, viewportPreferenceStore } from './viewport-preference-store'

export interface CoordinateStatusBarProps {
  readonly activeTcpName: string
  readonly store?: ViewportPreferenceStore
}

export function CoordinateStatusBar({
  activeTcpName,
  store = viewportPreferenceStore,
}: CoordinateStatusBarProps) {
  const poseFrame = useViewportPreferenceStore((state) => state.poseFrame, store)
  const gizmoFrame = useViewportPreferenceStore((state) => state.gizmoFrame, store)
  return (
    <div aria-label="Coordinate status" className="coordinate-status-bar">
      <label>Pose Frame
        <select
          aria-label="Pose Frame"
          onChange={(event) => store.getState().setPoseFrame(
            event.currentTarget.value as 'world' | 'mcp' | 'base',
          )}
          value={poseFrame}
        >
          <option value="world">World</option>
          <option value="mcp">MCP</option>
          <option value="base">Base</option>
        </select>
      </label>
      <label>Gizmo Frame
        <select
          aria-label="Gizmo Frame"
          onChange={(event) => store.getState().setGizmoFrame(
            event.currentTarget.value as 'world' | 'parent',
          )}
          value={gizmoFrame}
        >
          <option value="world">World</option>
          <option value="parent">Parent</option>
        </select>
      </label>
      <span className="coordinate-status-value">{activeTcpName}</span>
      <span className="coordinate-status-value">mm/deg</span>
      <span className="coordinate-status-value">ZYX RPY</span>
    </div>
  )
}
