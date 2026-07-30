import { Crosshair, Home, Maximize, Move, Rotate3D } from 'lucide-react'

import type { CameraControllerV6 } from './camera-controller-v6.js'

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

export interface ViewportOverlayV6Props { readonly camera: CameraControllerV6 }

export function ViewportOverlayV6({ camera }: ViewportOverlayV6Props) {
  return <div aria-label="Viewport controls" className="v6-viewport-overlay">
    <div aria-label="View Cube" className="v6-view-cube" data-testid="v6-view-cube"><Rotate3D aria-hidden="true" size={20} /></div>
    <div className="v6-camera-controls" data-safe-placement="below-cube" data-testid="v6-camera-controls">
      <button aria-label="Home view" onClick={() => camera.home()} type="button"><Home aria-hidden="true" size={18} /></button>
      <button aria-label="Fit all visible geometry" onClick={() => camera.fitAll()} type="button"><Maximize aria-hidden="true" size={18} /></button>
      <button aria-label="Focus selection" onClick={() => camera.focusSelection()} type="button"><Crosshair aria-hidden="true" size={18} /></button>
      <button aria-label="Translate selection" type="button"><Move aria-hidden="true" size={18} /></button>
    </div>
  </div>
}
