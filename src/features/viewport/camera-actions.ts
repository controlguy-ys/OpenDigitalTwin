import { Box3, MathUtils, PerspectiveCamera, Sphere, Vector3 } from 'three'

export interface ViewportCameraStateLike {
  readonly position: readonly [number, number, number]
  readonly target: readonly [number, number, number]
  readonly quaternion: readonly [number, number, number, number]
  readonly up: readonly [number, number, number]
  readonly zoom: number
  readonly fov: number
  readonly near: number
  readonly far: number
}

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

export type WorldViewDirectionV4 = readonly [number, number, number]

export interface OrbitTargetController {
  readonly target: Vector3
  update(): void
}

export interface ViewportCameraActions {
  home(): void
  fitAll(bounds: Box3): void
  focusSelection(bounds: Box3): void
  setWorldDirection(direction: WorldViewDirectionV4): boolean
  setStandardView(view: StandardWorldView): void
}

export function captureViewportCameraState(
  camera: PerspectiveCamera,
  controls: OrbitTargetController,
): ViewportCameraStateLike {
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
  state: ViewportCameraStateLike,
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

const WORLD_VIEW_DIRECTIONS: Record<StandardWorldView, WorldViewDirectionV4> = {
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  isometric: [1, -1, 1],
}

function finiteWorldDirectionV4(direction: WorldViewDirectionV4): Vector3 | null {
  if (!direction.every(Number.isFinite)) return null
  const normalized = new Vector3(...direction)
  if (normalized.lengthSq() < 1e-8) return null
  return normalized.normalize()
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
  const setWorldDirection = (direction: WorldViewDirectionV4): boolean => {
    const normalized = finiteWorldDirectionV4(direction)
    if (normalized === null) return false
    const target = controls.target.clone()
    const currentDistance = camera.position.distanceTo(target)
    const distance = Math.max(
      Number.isFinite(currentDistance) ? currentDistance : 0,
      0.8,
    )
    camera.position.copy(target).addScaledVector(normalized, distance)
    const up: WorldViewDirectionV4 =
      Math.abs(normalized.z) >= 0.999 ? [0, 1, 0] : [0, 0, 1]
    applyView(camera, controls, up)
    return true
  }

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
    setWorldDirection,
    setStandardView: (view) => { setWorldDirection(WORLD_VIEW_DIRECTIONS[view]) },
  }
}
