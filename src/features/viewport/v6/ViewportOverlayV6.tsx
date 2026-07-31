import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  Compass,
  Crosshair,
  Home,
  Maximize,
  Move,
  Rotate3D,
} from 'lucide-react'

import type { CameraControllerV6, CameraOrientationV6 } from './camera-controller-v6.js'

export interface SelectedTcpMarkerInputV6 {
  readonly projectRevisionId: string
  readonly runtimeRevisionId: string
  readonly selection: { readonly kind: string; readonly id: string } | null
  readonly robot: { readonly id: string; readonly selectedTcpFrameId: string } | null
  readonly tcp: { readonly robotId: string; readonly frameId: string; readonly role: string } | null
}

export function selectedTcpMarkerV6(input: SelectedTcpMarkerInputV6): { readonly robotId: string; readonly frameId: string } | null {
  if (input.projectRevisionId !== input.runtimeRevisionId || input.selection?.kind !== 'robot' || input.robot === null || input.tcp === null) return null
  if (input.selection.id !== input.robot.id || input.tcp.robotId !== input.robot.id || input.tcp.frameId !== input.robot.selectedTcpFrameId || input.tcp.role !== 'tcp') return null
  return Object.freeze({ robotId: input.robot.id, frameId: input.tcp.frameId })
}

export interface ViewportTransformControlV6 {
  readonly enabled: boolean
  readonly explanation: string
  translate(): void
}

export interface ViewportOverlayV6Props {
  readonly camera: CameraControllerV6
  readonly tcpMarker?: SelectedTcpMarkerInputV6
  readonly transformControl?: ViewportTransformControlV6
}

interface OrientationControlV6 {
  readonly value: Exclude<CameraOrientationV6, 'isometric'>
  readonly Icon: typeof ArrowUp
}

const ORIENTATION_CONTROLS: readonly OrientationControlV6[] = Object.freeze([
  { value: 'top', Icon: ArrowUp },
  { value: 'front', Icon: Compass },
  { value: 'right', Icon: ArrowRight },
  { value: 'back', Icon: Box },
  { value: 'left', Icon: ArrowLeft },
  { value: 'bottom', Icon: ArrowDown },
])

export function ViewportOverlayV6({ camera, tcpMarker, transformControl }: ViewportOverlayV6Props) {
  const marker = tcpMarker === undefined ? null : selectedTcpMarkerV6(tcpMarker)
  const translateAvailable = transformControl?.enabled === true
  const translateExplanation = transformControl?.explanation
    ?? 'Translation is unavailable until a manual transform controller is connected.'
  return <div aria-label="Viewport controls" className="v6-viewport-overlay">
    <button
      aria-label="Set isometric view"
      className="v6-view-cube"
      data-testid="v6-view-cube"
      onClick={() => camera.setOrientation('isometric')}
      title="Set isometric view"
      type="button"
    ><Rotate3D aria-hidden="true" size={20} /></button>
    <div aria-label="Standard camera orientations" className="v6-camera-orientations">
      {ORIENTATION_CONTROLS.map(({ Icon, value }) => <button
        aria-label={`Set ${value} view`}
        key={value}
        onClick={() => camera.setOrientation(value)}
        title={`Set ${value} view`}
        type="button"
      ><Icon aria-hidden="true" size={16} /></button>)}
    </div>
    <div className="v6-camera-controls" data-safe-placement="below-cube" data-testid="v6-camera-controls">
      <button aria-label="Home view" onClick={() => camera.home()} title="Home view" type="button"><Home aria-hidden="true" size={18} /></button>
      <button aria-label="Fit all visible geometry" onClick={() => camera.fitAll()} title="Fit all visible geometry" type="button"><Maximize aria-hidden="true" size={18} /></button>
      <button aria-label="Focus selection" onClick={() => camera.focusSelection()} title="Focus selection" type="button"><Crosshair aria-hidden="true" size={18} /></button>
      <button
        aria-describedby="v6-translate-explanation"
        aria-label="Translate selection"
        disabled={!translateAvailable}
        onClick={() => transformControl?.translate()}
        title="Translate selection"
        type="button"
      ><Move aria-hidden="true" size={18} /></button>
      {!translateAvailable && <span className="v6-transform-explanation" id="v6-translate-explanation">{translateExplanation}</span>}
    </div>
    {marker !== null && <output aria-label={`Selected TCP ${marker.robotId} ${marker.frameId}`} className="v6-tcp-marker" data-testid="v6-tcp-marker">{marker.robotId} / {marker.frameId}</output>}
  </div>
}
