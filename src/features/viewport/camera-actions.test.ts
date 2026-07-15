import { Box3, PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  captureViewportCameraState,
  createViewportCameraActions,
  HOME_CAMERA,
  restoreViewportCameraState,
} from './camera-actions'

function harness() {
  const camera = new PerspectiveCamera(42, 1.5, 0.1, 100)
  camera.position.set(9, 8, 7)
  const controls = { target: new Vector3(5, 5, 5), update: vi.fn() }
  return { camera, controls, actions: createViewportCameraActions(camera, controls) }
}

describe('viewport camera actions', () => {
  it('Home View changes only camera and Orbit target state', () => {
    const projectSentinel = Object.freeze({ robotPose: [1, 2, 3], entityX: 42 })
    const before = JSON.stringify(projectSentinel)
    const { camera, controls, actions } = harness()

    actions.home()

    expect(camera.position.toArray()).toEqual(HOME_CAMERA.position)
    expect(controls.target.toArray()).toEqual(HOME_CAMERA.target)
    expect(camera.zoom).toBe(HOME_CAMERA.zoom)
    expect(camera.up.toArray()).toEqual(HOME_CAMERA.up)
    expect(camera.quaternion.toArray()).toEqual(HOME_CAMERA.quaternion)
    expect(camera.fov).toBe(HOME_CAMERA.fov)
    expect(camera.near).toBe(HOME_CAMERA.near)
    expect(camera.far).toBe(HOME_CAMERA.far)
    expect(JSON.stringify(projectSentinel)).toBe(before)
  })

  it('round-trips a saved Top orientation including quaternion, up, and projection', () => {
    const first = harness()
    first.actions.setStandardView('top')
    first.camera.fov = 55
    first.camera.near = 0.02
    first.camera.far = 250
    const saved = captureViewportCameraState(first.camera, first.controls)
    const second = harness()

    restoreViewportCameraState(second.camera, second.controls, saved)

    expect(second.camera.position.toArray()).toEqual(saved.position)
    expect(second.camera.quaternion.toArray()).toEqual(saved.quaternion)
    expect(second.camera.up.toArray()).toEqual([0, 1, 0])
    expect(second.camera.fov).toBe(55)
    expect(second.camera.near).toBe(0.02)
    expect(second.camera.far).toBe(250)
  })

  it('frames bounds and preserves the framed center as Orbit pivot', () => {
    const { camera, controls, actions } = harness()
    const bounds = new Box3(new Vector3(-1, -2, 0), new Vector3(3, 2, 4))

    actions.fitAll(bounds)

    expect(controls.target.toArray()).toEqual([1, 0, 2])
    expect(camera.position.distanceTo(controls.target)).toBeGreaterThan(4)
  })

  it('leaves camera and target unchanged when Focus receives empty bounds', () => {
    const { camera, controls, actions } = harness()
    const position = camera.position.toArray()
    const target = controls.target.toArray()

    actions.focusSelection(new Box3())

    expect(camera.position.toArray()).toEqual(position)
    expect(controls.target.toArray()).toEqual(target)
    expect(controls.update).not.toHaveBeenCalled()
  })

  it('selects fixed World directions for faces and isometric corners', () => {
    const { camera, controls, actions } = harness()
    controls.target.set(1, 2, 3)

    actions.setStandardView('top')
    expect(camera.position.clone().sub(controls.target).normalize().z).toBeCloseTo(1)
    expect(camera.up.toArray()).toEqual([0, 1, 0])

    actions.setStandardView('front')
    expect(camera.position.clone().sub(controls.target).normalize().y).toBeCloseTo(-1)

    actions.setStandardView('isometric')
    const direction = camera.position.clone().sub(controls.target).normalize()
    expect(direction.x).toBeGreaterThan(0)
    expect(direction.y).toBeLessThan(0)
    expect(direction.z).toBeGreaterThan(0)
  })
})
