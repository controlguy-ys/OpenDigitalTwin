import { MeshBasicMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { createLabelledFrameMarker, frameMarkerScale } from './TcpFrameMarker'

describe('Actual TCP frame marker', () => {
  it('keeps an approximately stable screen size through normal camera zoom', () => {
    expect(frameMarkerScale(2, 42, 800)).toBeCloseTo(0.752, 2)
    expect(frameMarkerScale(4, 42, 800)).toBeCloseTo(1.503, 2)
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
