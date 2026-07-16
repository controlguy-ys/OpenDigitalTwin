import type { ViewportPreferenceStore } from './viewport-preference-store'
import { useViewportPreferenceStore, viewportPreferenceStore } from './viewport-preference-store'
import {
  computeActualTcpPoseReadout,
  type CoordinateFrameMatrices,
} from './coordinate-pose-readout'

export interface CoordinateStatusBarProps {
  readonly activeTcpName: string
  readonly frameMatrices?: CoordinateFrameMatrices | null
  readonly store?: ViewportPreferenceStore
}

export function CoordinateStatusBar({
  activeTcpName,
  frameMatrices = null,
  store = viewportPreferenceStore,
}: CoordinateStatusBarProps) {
  const poseFrame = useViewportPreferenceStore((state) => state.poseFrame, store)
  const gizmoFrame = useViewportPreferenceStore((state) => state.gizmoFrame, store)
  const pose = frameMatrices === null
    ? null
    : computeActualTcpPoseReadout(frameMatrices, poseFrame)
  const value = (candidate: number | undefined) =>
    candidate === undefined ? '—' : candidate.toFixed(1)
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
      <output aria-label="Actual TCP pose" className="coordinate-pose-readout">
        <span>X {value(pose?.xyzMm[0])}</span>
        <span>Y {value(pose?.xyzMm[1])}</span>
        <span>Z {value(pose?.xyzMm[2])}</span>
        <span>Rx {value(pose?.rpyDeg[0])}</span>
        <span>Ry {value(pose?.rpyDeg[1])}</span>
        <span>Rz {value(pose?.rpyDeg[2])}</span>
      </output>
      <span className="coordinate-status-value">mm/deg</span>
      <span className="coordinate-status-value">ZYX RPY</span>
    </div>
  )
}
