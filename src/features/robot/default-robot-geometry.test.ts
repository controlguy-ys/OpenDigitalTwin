import { afterEach, describe, expect, it, vi } from 'vitest'
import { LINK_WORLD_ORIGINS } from '../../domain/robot/crb15000'
import { loadDefaultRobotGeometry } from './default-robot-geometry'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('default Robot Geometry', () => {
  it('publishes bundled Geometry and collision Boxes in link-local coordinates', async () => {
    const sourceBytes = new Uint8Array([1, 2, 3]).buffer
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          links: [{
            id: 'LINK01',
            sourceFile: 'LINK01.step',
            source: {
              vertexCount: 24,
              triangleCount: 12,
              bounds: { min: [1, 2, 3], max: [3, 6, 9] },
            },
            generated: { meshCount: 1, primitiveCount: 1, materialColors: [] },
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => sourceBytes,
      }))

    const [record] = await loadDefaultRobotGeometry()
    const origin = LINK_WORLD_ORIGINS.LINK01

    expect(record?.localTransform.position).toEqual([0, 0, 0])
    record?.collisionCenter.forEach((value, index) => {
      expect(value).toBeCloseTo([2, 4, 6][index]! - origin[index]!)
    })
    record?.collisionHalfExtents.forEach((value, index) => {
      expect(value).toBeCloseTo([1, 2, 3][index]!)
    })
    expect(record?.collisionBoxes[0]?.center).toEqual(record?.collisionCenter)
  })
})
