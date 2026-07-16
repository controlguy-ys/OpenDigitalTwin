import { MeshBasicMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import {
  createLabelledFrameMarker,
  displayedFrameMarkerScale,
} from './TcpFrameMarker'

describe('Actual TCP frame marker', () => {
  it('keeps a compact 28 pixel screen size through normal camera zoom', () => {
    const projectedAxisPixels = (distance: number) => {
      const visibleHeight = 2 * distance * Math.tan((42 / 2) * Math.PI / 180)
      return 0.12 * displayedFrameMarkerScale(distance, 42, 800) / visibleHeight * 800
    }

    expect(projectedAxisPixels(2)).toBeCloseTo(28, 1)
    expect(projectedAxisPixels(4)).toBeCloseTo(28, 1)
    expect(projectedAxisPixels(0.25)).toBeCloseTo(28, 1)
  })

  it('creates labelled X/Y/Z axes with normal depth testing', () => {
    const marker = createLabelledFrameMarker('actual-tcp', 'Actual TCP')

    for (const axis of ['x', 'y', 'z'] as const) {
      const object = marker.getObjectByName(`actual-tcp-${axis}`)
      expect(object?.userData).toMatchObject({ label: axis.toUpperCase(), frame: 'Actual TCP' })
      const materials: MeshBasicMaterial[] = []
      object?.traverse((child) => {
        if ('material' in child && child.material instanceof MeshBasicMaterial) materials.push(child.material)
      })
      expect(materials.length).toBeGreaterThan(0)
      expect(materials.every(({ depthTest }) => depthTest)).toBe(true)
    }
    expect(marker.userData).toMatchObject({ frame: 'Actual TCP', depthAware: true })
  })
})
