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

  it('rejects non-finite and zero directions without mutation', () => {
    const { camera, controls, actions } = harness()
    const position = camera.position.clone()

    expect(actions.setWorldDirection([0, 0, 0])).toBe(false)
    expect(actions.setWorldDirection([Number.NaN, 0, 1])).toBe(false)
    expect(actions.setWorldDirection([Number.POSITIVE_INFINITY, 0, 1])).toBe(false)
    expect(camera.position).toEqual(position)
    expect(controls.update).not.toHaveBeenCalled()
  })

  it('normalizes a diagonal and preserves target and distance', () => {
    const { camera, controls, actions } = harness()
    const target = controls.target.clone()
    const distance = camera.position.distanceTo(target)

    expect(actions.setWorldDirection([2, -2, 2])).toBe(true)
    expect(controls.target).toEqual(target)
    expect(camera.position.distanceTo(target)).toBeCloseTo(distance)
    expect(camera.position.clone().sub(target).normalize().distanceTo(
      new Vector3(2, -2, 2).normalize(),
    )).toBeCloseTo(0)
    expect(camera.up.toArray()).toEqual([0, 0, 1])
  })

  it('uses the pole-aware up vector for Top, Bottom, and near-pole directions', () => {
    const { camera, actions } = harness()

    actions.setStandardView('top')
    expect(camera.up.toArray()).toEqual([0, 1, 0])
    actions.setStandardView('bottom')
    expect(camera.up.toArray()).toEqual([0, 1, 0])
    expect(actions.setWorldDirection([0.01, 0, 1])).toBe(true)
    expect(camera.up.toArray()).toEqual([0, 1, 0])
    expect(actions.setWorldDirection([0.1, 0, 1])).toBe(true)
    expect(camera.up.toArray()).toEqual([0, 0, 1])
  })

  it('uses the OrbitControls minimum distance for a close camera', () => {
    const { camera, controls, actions } = harness()
    camera.position.copy(controls.target).add(new Vector3(0.1, 0, 0))

    expect(actions.setWorldDirection([1, 0, 0])).toBe(true)
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(0.8)
  })

  it('delegates every standard preset to its raw World direction', () => {
    const { camera, controls, actions } = harness()
    controls.target.set(1, 2, 3)
    const directions = {
      front: [0, -1, 0],
      back: [0, 1, 0],
      left: [-1, 0, 0],
      right: [1, 0, 0],
      top: [0, 0, 1],
      bottom: [0, 0, -1],
      isometric: [1, -1, 1],
    } as const

    for (const [view, rawDirection] of Object.entries(directions)) {
      actions.setStandardView(view as keyof typeof directions)
      expect(camera.position.clone().sub(controls.target).normalize().distanceTo(
        new Vector3(...rawDirection).normalize(),
      )).toBeCloseTo(0)
    }
  })
})
