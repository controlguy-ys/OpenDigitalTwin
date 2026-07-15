import { Box3, MathUtils, PerspectiveCamera, Sphere, Vector3 } from 'three'

export const HOME_CAMERA = Object.freeze({
  position: [2.2, 1.8, 1.7] as const,
  target: [0.15, 0, 1.55] as const,
  zoom: 1,
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
      camera.zoom = HOME_CAMERA.zoom
      applyView(camera, controls)
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
