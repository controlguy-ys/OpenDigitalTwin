import { Box3, PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createViewportCameraActions, HOME_CAMERA } from './camera-actions'

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
    expect(JSON.stringify(projectSentinel)).toBe(before)
  })

  it('frames bounds and preserves the framed center as Orbit pivot', () => {
    const { camera, controls, actions } = harness()
    const bounds = new Box3(new Vector3(-1, -2, 0), new Vector3(3, 2, 4))

    actions.fitAll(bounds)

    expect(controls.target.toArray()).toEqual([1, 0, 2])
    expect(camera.position.distanceTo(controls.target)).toBeGreaterThan(4)
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
