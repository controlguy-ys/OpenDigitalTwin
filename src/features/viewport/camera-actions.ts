import { Box3, MathUtils, PerspectiveCamera, Sphere, Vector3 } from 'three'
import type { ViewportCameraState } from './viewport-preference-store'

export const HOME_CAMERA = Object.freeze({
  position: [2.2, 1.8, 1.7] as const,
  target: [0.15, 0, 1.55] as const,
  quaternion: [
    0.28351443473132715,
    0.6262342308848727,
    0.6616126318893704,
    0.29953126496482535,
  ] as const,
  up: [0, 0, 1] as const,
  zoom: 1,
  fov: 42,
  near: 0.1,
  far: 100,
})

export type StandardWorldView =
  | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric'

export interface OrbitTargetController {
  readonly target: Vector3
  update(): void
}

export interface ViewportCameraActions {
  home(): void
  fitAll(bounds: Box3): void
  focusSelection(bounds: Box3): void
  setStandardView(view: StandardWorldView): void
}

export function captureViewportCameraState(
  camera: PerspectiveCamera,
  controls: OrbitTargetController,
): ViewportCameraState {
  return {
    position: camera.position.toArray(),
    target: controls.target.toArray(),
    quaternion: camera.quaternion.toArray(),
    up: camera.up.toArray(),
    zoom: camera.zoom,
    fov: camera.fov,
    near: camera.near,
    far: camera.far,
  }
}

export function restoreViewportCameraState(
  camera: PerspectiveCamera,
  controls: OrbitTargetController,
  state: ViewportCameraState,
): void {
  camera.position.set(...state.position)
  camera.quaternion.set(...state.quaternion).normalize()
  camera.up.set(...state.up)
  camera.zoom = state.zoom
  camera.fov = state.fov
  camera.near = state.near
  camera.far = state.far
  controls.target.set(...state.target)
  camera.updateProjectionMatrix()
  controls.update()
}

const WORLD_VIEW_DIRECTIONS: Record<StandardWorldView, readonly [number, number, number]> = {
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  isometric: [1, -1, 1],
}

function applyView(
  camera: PerspectiveCamera,
  controls: OrbitTargetController,
  up: readonly [number, number, number] = [0, 0, 1],
): void {
  camera.up.set(...up)
  camera.lookAt(controls.target)
  camera.updateProjectionMatrix()
  controls.update()
}

function frameBounds(
  camera: PerspectiveCamera,
  controls: OrbitTargetController,
  bounds: Box3,
): void {
  if (bounds.isEmpty()) return
  const sphere = bounds.getBoundingSphere(new Sphere())
  const halfFov = MathUtils.degToRad(camera.fov / 2)
  const distance = Math.max(sphere.radius / Math.tan(halfFov) * 1.2, 0.25)
  const direction = camera.position.clone().sub(controls.target)
  if (direction.lengthSq() < 1e-8) direction.set(1, -1, 1)
  direction.normalize()
  controls.target.copy(sphere.center)
  camera.position.copy(sphere.center).addScaledVector(direction, distance)
  camera.near = Math.max(distance / 1000, 0.01)
  camera.far = Math.max(distance * 100, 100)
  applyView(camera, controls)
}

export function createViewportCameraActions(
  camera: PerspectiveCamera,
  controls: OrbitTargetController,
): ViewportCameraActions {
  return {
    home: () => {
      camera.position.set(...HOME_CAMERA.position)
      controls.target.set(...HOME_CAMERA.target)
      camera.up.set(...HOME_CAMERA.up)
      camera.zoom = HOME_CAMERA.zoom
      camera.fov = HOME_CAMERA.fov
      camera.near = HOME_CAMERA.near
      camera.far = HOME_CAMERA.far
      camera.quaternion.set(...HOME_CAMERA.quaternion)
      camera.updateProjectionMatrix()
      controls.update()
    },
    fitAll: (bounds) => frameBounds(camera, controls, bounds),
    focusSelection: (bounds) => frameBounds(camera, controls, bounds),
    setStandardView: (view) => {
      const distance = Math.max(camera.position.distanceTo(controls.target), 0.8)
      const direction = new Vector3(...WORLD_VIEW_DIRECTIONS[view]).normalize()
      camera.position.copy(controls.target).addScaledVector(direction, distance)
      applyView(camera, controls, view === 'top' || view === 'bottom' ? [0, 1, 0] : [0, 0, 1])
    },
  }
}
