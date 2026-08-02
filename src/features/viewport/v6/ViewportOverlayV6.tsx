import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  Compass,
  Crosshair,
  ChevronDown,
  Home,
  Maximize,
  Move,
  Rotate3D,
} from 'lucide-react'
import { useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

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
  readonly value: CameraOrientationV6
  readonly Icon: typeof ArrowUp
}

const ORIENTATION_CONTROLS: readonly OrientationControlV6[] = Object.freeze([
  { value: 'isometric', Icon: Rotate3D },
  { value: 'top', Icon: ArrowUp },
  { value: 'front', Icon: Compass },
  { value: 'right', Icon: ArrowRight },
  { value: 'back', Icon: Box },
  { value: 'left', Icon: ArrowLeft },
  { value: 'bottom', Icon: ArrowDown },
])

export function ViewportOverlayV6({ camera, tcpMarker, transformControl }: ViewportOverlayV6Props) {
  const [cameraViewsOpen, setCameraViewsOpen] = useState(false)
  const cameraViewsTriggerRef = useRef<HTMLButtonElement>(null)
  const cameraViewsMenuId = useId()
  const marker = tcpMarker === undefined ? null : selectedTcpMarkerV6(tcpMarker)
  const translateAvailable = transformControl?.enabled === true
  const translateExplanation = transformControl?.explanation
    ?? 'Translation is unavailable until a manual transform controller is connected.'
  const focusFirstCameraView = () => {
    requestAnimationFrame(() => {
      document.getElementById(cameraViewsMenuId)?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    })
  }
  const closeCameraViews = (restoreFocus: boolean) => {
    setCameraViewsOpen(false)
    if (restoreFocus) requestAnimationFrame(() => cameraViewsTriggerRef.current?.focus())
  }
  const openCameraViews = () => {
    setCameraViewsOpen(true)
    focusFirstCameraView()
  }
  const onCameraViewsTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      openCameraViews()
    } else if (event.key === 'Escape' && cameraViewsOpen) {
      event.preventDefault()
      closeCameraViews(true)
    }
  }
  const onCameraViewKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeCameraViews(true)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const menu = event.currentTarget.closest<HTMLElement>('[role="menu"]')
    const items = menu === null ? [] : Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    if (items.length === 0) return
    const currentIndex = items.indexOf(event.currentTarget)
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[nextIndex]?.focus()
  }
  return <div aria-label="Viewport controls" className="v6-viewport-overlay">
    <div aria-label="Camera controls" className="v6-camera-toolbar" data-testid="v6-camera-toolbar" role="toolbar">
      <div className="v6-camera-views" data-safe-placement="top-toolbar" data-testid="v6-camera-views">
        <button
          aria-controls={cameraViewsMenuId}
          aria-expanded={cameraViewsOpen}
          aria-haspopup="menu"
          aria-label="Camera views"
          className="v6-camera-views-trigger"
          onClick={() => cameraViewsOpen ? closeCameraViews(false) : openCameraViews()}
          onKeyDown={onCameraViewsTriggerKeyDown}
          ref={cameraViewsTriggerRef}
          title="Camera views"
          type="button"
        ><Rotate3D aria-hidden="true" size={18} /><ChevronDown aria-hidden="true" size={12} /></button>
        {cameraViewsOpen && <div aria-label="Camera views" className="v6-camera-views-menu" id={cameraViewsMenuId} role="menu">
          {ORIENTATION_CONTROLS.map(({ Icon, value }) => <button
            key={value}
            onClick={() => {
              camera.setOrientation(value)
              closeCameraViews(true)
            }}
            onKeyDown={onCameraViewKeyDown}
            role="menuitem"
            title={`Set ${value} view`}
            type="button"
          ><Icon aria-hidden="true" size={16} /><span>{`Set ${value} view`}</span></button>)}
        </div>}
      </div>
      <div className="v6-camera-controls" data-safe-placement="top-toolbar" data-testid="v6-camera-controls">
        <button aria-label="Home view" onClick={() => camera.home()} title="Home view" type="button"><Home aria-hidden="true" size={18} /></button>
        <button aria-label="Fit all visible geometry" onClick={() => camera.fitAll()} title="Fit all visible geometry" type="button"><Maximize aria-hidden="true" size={18} /></button>
        <button aria-label="Focus selection" onClick={() => camera.focusSelection()} title="Focus selection" type="button"><Crosshair aria-hidden="true" size={18} /></button>
        <button
          aria-describedby={translateAvailable ? undefined : 'v6-translate-explanation'}
          aria-label="Translate selection"
          disabled={!translateAvailable}
          onClick={() => transformControl?.translate()}
          title={translateAvailable ? 'Translate selection' : translateExplanation}
          type="button"
        ><Move aria-hidden="true" size={18} /></button>
        {!translateAvailable && <span className="visually-hidden" id="v6-translate-explanation">{translateExplanation}</span>}
      </div>
    </div>
    {marker !== null && <output aria-label={`Selected TCP ${marker.robotId} ${marker.frameId}`} className="v6-tcp-marker" data-testid="v6-tcp-marker">{marker.robotId} / {marker.frameId}</output>}
  </div>
}
