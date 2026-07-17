import type { WorkcellProjectV4 } from '../../../core/project-v4/index.js'
import type {
  CoordinateDisplayStoreStateV4,
} from '../../frames/v4/coordinate-display-store.js'
import {
  sameSceneSelectionV4,
  type SceneSelectionV4,
} from '../../interaction/v4/scene-selection.js'
import type { SceneRuntimeProjectionV4 } from '../../scene/v4/scene-runtime-selector.js'
import type { ReactNode } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import {
  computeActualTcpPoseReadoutV4,
  coordinateFrameOptionsV4,
} from './coordinate-pose-readout.js'
import type { ViewportPreferenceStoreV4 } from './viewport-preference-store.js'

export interface CoordinateStatusBarPropsV4 {
  readonly project: WorkcellProjectV4
  readonly runtime: SceneRuntimeProjectionV4
  readonly selection: SceneSelectionV4
  readonly display: StoreApi<CoordinateDisplayStoreStateV4>
  readonly preferences: ViewportPreferenceStoreV4
}

function displayValueV4(value: number | undefined): string {
  return value === undefined ? '—' : (value === 0 ? 0 : value).toFixed(1)
}

export function CoordinateStatusBarV4({
  project,
  runtime,
  selection,
  display,
  preferences,
}: CoordinateStatusBarPropsV4): ReactNode {
  const poseFrame = useStore(display, (state) => state.poseFrame)
  const gizmoFrame = useStore(preferences, (state) => state.gizmoFrame)
  const options = coordinateFrameOptionsV4(project, runtime, selection)
  const activeOption = poseFrame === null
    ? undefined
    : options.find((option) => sameSceneSelectionV4(option.selection, poseFrame))
  const worldFrameId = project.scene.frames.find(({ role }) => role === 'world')?.id
  const effectiveOption = activeOption ?? options.find(({ selection: optionSelection }) => (
    optionSelection.kind === 'scene-frame' && optionSelection.frameId === worldFrameId
  )) ?? options[0]
  const actualTcp = effectiveOption === undefined
    ? null
    : computeActualTcpPoseReadoutV4(
        project,
        runtime,
        selection,
        effectiveOption.selection,
      )

  return (
    <div aria-label="Coordinate status" className="coordinate-status-bar">
      <label>
        Pose Frame
        <select
          aria-label="Pose Frame"
          onChange={(event) => {
            const selected = options.find(({ key }) => key === event.currentTarget.value)
            if (selected !== undefined) display.getState().selectPoseFrame(selected.selection)
          }}
          value={effectiveOption?.key ?? ''}
        >
          {options.map((option) => (
            <option key={option.key} value={option.key}>{option.label}</option>
          ))}
        </select>
      </label>
      <label>
        Gizmo Frame
        <select
          aria-label="Gizmo Frame"
          onChange={(event) => preferences.getState().setGizmoFrame(
            event.currentTarget.value === 'parent' ? 'parent' : 'world',
          )}
          value={gizmoFrame}
        >
          <option value="world">World</option>
          <option value="parent">Parent</option>
        </select>
      </label>
      <output aria-label="Actual TCP pose" className="coordinate-pose-readout">
        {actualTcp === null ? (
          <span>Actual TCP: None</span>
        ) : (
          <>
            <span>{actualTcp.robotId} / {actualTcp.tcpFrameId}</span>
            <span>X {displayValueV4(actualTcp.xyzMm[0])}</span>
            <span>Y {displayValueV4(actualTcp.xyzMm[1])}</span>
            <span>Z {displayValueV4(actualTcp.xyzMm[2])}</span>
            <span>Rx {displayValueV4(actualTcp.rpyDeg[0])}</span>
            <span>Ry {displayValueV4(actualTcp.rpyDeg[1])}</span>
            <span>Rz {displayValueV4(actualTcp.rpyDeg[2])}</span>
          </>
        )}
      </output>
      <span className="coordinate-status-value">mm/deg</span>
      <span className="coordinate-status-value">Intrinsic Z-Y-X RPY</span>
    </div>
  )
}
