export type CameraOrientationV6 = 'isometric' | 'top' | 'front' | 'right' | 'back' | 'left' | 'bottom'

export interface CameraPointV6 {
  readonly position: [number, number, number]
  readonly target: [number, number, number]
}

export interface CameraBoundsV6 {
  readonly center: readonly [number, number, number]
  readonly radius: number
}

export interface CameraControllerV6 {
  home(): void
  fitAll(): void
  focusSelection(): void
  setOrientation(value: CameraOrientationV6): void
}

export const V6_CAMERA_MOUSE_MAPPING = Object.freeze({
  left: 'select',
  middle: 'orbit',
  shiftMiddle: 'pan',
  wheel: 'zoom',
  right: 'context-menu',
} as const)

export interface CameraControllerV6Options {
  readonly camera: CameraPointV6
  readonly home: CameraPointV6
  readonly visibleBounds: () => CameraBoundsV6 | null
  readonly selectionBounds: () => CameraBoundsV6 | null
  readonly update: () => void
}

const orientationDirection: Readonly<Record<CameraOrientationV6, readonly [number, number, number]>> = Object.freeze({
  isometric: [1, -1, 1], top: [0, 0, 1], front: [0, -1, 0], right: [1, 0, 0], back: [0, 1, 0], left: [-1, 0, 0], bottom: [0, 0, -1],
})

function copyPoint(target: [number, number, number], source: readonly [number, number, number]): void {
  target.splice(0, 3, source[0], source[1], source[2])
}

function frameBounds(options: CameraControllerV6Options, bounds: CameraBoundsV6 | null): void {
  if (bounds === null) return
  const [x, y, z] = bounds.center
  const distance = Math.max(bounds.radius * 2.4, 0.25)
  copyPoint(options.camera.target, bounds.center)
  copyPoint(options.camera.position, [x + distance, y - distance, z + distance])
  options.update()
}

export function createCameraControllerV6(options: CameraControllerV6Options): CameraControllerV6 {
  return Object.freeze({
    home() {
      copyPoint(options.camera.position, options.home.position)
      copyPoint(options.camera.target, options.home.target)
      options.update()
    },
    fitAll() { frameBounds(options, options.visibleBounds()) },
    focusSelection() { frameBounds(options, options.selectionBounds()) },
    setOrientation(value: CameraOrientationV6) {
      const [dx, dy, dz] = orientationDirection[value]
      const [x, y, z] = options.camera.target
      const distance = Math.max(Math.hypot(
        options.camera.position[0] - x,
        options.camera.position[1] - y,
        options.camera.position[2] - z,
      ), 0.8)
      const scale = distance / Math.hypot(dx, dy, dz)
      copyPoint(options.camera.position, [x + dx * scale, y + dy * scale, z + dz * scale])
      options.update()
    },
  })
}
