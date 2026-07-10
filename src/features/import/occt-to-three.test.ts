import { BufferGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { OcctResult, OcctSuccessResult } from '../../lib/cad/occt-types'
import {
  createThreeGroupFromOcct,
  MAX_IMPORTED_TRIANGLES,
  type OcctGeometryBudget,
} from './occt-to-three'

function resultWithMesh(
  overrides: Partial<OcctSuccessResult['meshes'][number]> = {},
): OcctSuccessResult {
  return {
    success: true,
    root: { name: 'root', meshes: [0], children: [] },
    meshes: [
      {
        name: 'fixture',
        color: [0.5, 0.5, 0.5],
        brep_faces: [],
        attributes: {
          position: {
            array: [
              0, 0, 0,
              2, 0, 0,
              0, 2, 0,
              2, 2, 1,
            ],
          },
        },
        index: { array: [0, 1, 2, 1, 3, 2] },
        ...overrides,
      },
    ],
  }
}

describe('createThreeGroupFromOcct', () => {
  it.each([
    [
      'vertices',
      { maxVertices: 7, maxTriangles: 4 },
      /aggregate vertex budget/i,
    ],
    [
      'triangles',
      { maxVertices: 8, maxTriangles: 3 },
      /aggregate triangle budget/i,
    ],
  ] satisfies readonly (readonly [string, OcctGeometryBudget, RegExp])[])(
    'rejects two meshes that exceed the aggregate %s limit before allocation',
    (_label, budget, message) => {
      const first = resultWithMesh().meshes[0]!
      const second = structuredClone(first)
      second.name = 'fixture-two'
      const result: OcctSuccessResult = {
        success: true,
        root: { name: 'root', meshes: [0, 1], children: [] },
        meshes: [first, second],
      }

      expect(() => createThreeGroupFromOcct(result, {}, budget)).toThrow(
        message,
      )
    },
  )

  it('builds indexed Three geometry and computes missing normals', () => {
    const asset = createThreeGroupFromOcct(resultWithMesh())
    const mesh = asset.group.children[0]

    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh)) {
      throw new Error('Expected converted child to be a Three mesh')
    }
    expect(mesh.geometry.getAttribute('position').count).toBe(4)
    expect(mesh.geometry.getAttribute('normal').count).toBe(4)
    expect(mesh.geometry.index?.count).toBe(6)
    expect(mesh.material).toBeInstanceOf(MeshStandardMaterial)
  })

  it('reorders non-contiguous face colors into contiguous material groups', () => {
    const result = resultWithMesh({
      attributes: {
        position: {
          array: [
            0, 0, 0,
            1, 0, 0,
            0, 1, 0,
            1, 1, 0,
            2, 0, 0,
          ],
        },
        normal: {
          array: [
            0, 0, 1,
            0, 0, 1,
            0, 0, 1,
            0, 0, 1,
            0, 0, 1,
          ],
        },
      },
      index: { array: [0, 1, 2, 1, 3, 2, 1, 4, 3] },
      brep_faces: [
        { first: 0, last: 0, color: [1, 0, 0] },
        { first: 1, last: 1, color: [0, 1, 0] },
        { first: 2, last: 2, color: [1, 0, 0] },
      ],
    })

    const asset = createThreeGroupFromOcct(result)
    const mesh = asset.group.children[0] as Mesh<
      BufferGeometry,
      MeshStandardMaterial[]
    >

    expect(mesh.geometry.groups).toEqual([
      { start: 0, count: 6, materialIndex: 0 },
      { start: 6, count: 3, materialIndex: 1 },
    ])
    expect(Array.from(mesh.geometry.index!.array)).toEqual([
      0, 1, 2,
      1, 4, 3,
      1, 3, 2,
    ])
    expect(mesh.material).toHaveLength(2)
    expect(mesh.material[0]!.color.getRGB({ r: 0, g: 0, b: 0 })).toMatchObject({
      r: 1,
      g: 0,
      b: 0,
    })
  })

  it('applies one post-import scale and centers only in center-origin mode', () => {
    const source = createThreeGroupFromOcct(resultWithMesh(), {
      postImportScale: 0.001,
      originMode: 'source',
    })
    const centered = createThreeGroupFromOcct(resultWithMesh(), {
      postImportScale: 0.001,
      originMode: 'center',
    })

    expect(source.bounds).toEqual({
      min: [0, 0, 0],
      max: [0.002, 0.002, 0.001],
      size: [0.002, 0.002, 0.001],
      center: [0.001, 0.001, 0.0005],
    })
    expect(source.colliderCenter).toEqual([0.001, 0.001, 0.0005])
    expect(centered.bounds).toEqual({
      min: [-0.001, -0.001, -0.0005],
      max: [0.001, 0.001, 0.0005],
      size: [0.002, 0.002, 0.001],
      center: [0, 0, 0],
    })
    expect(centered.colliderCenter).toEqual([0, 0, 0])
  })

  it('disposes every generated geometry and material exactly once', () => {
    const asset = createThreeGroupFromOcct(resultWithMesh())
    const mesh = asset.group.children[0] as Mesh<
      BufferGeometry,
      MeshStandardMaterial
    >
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose')
    const materialDispose = vi.spyOn(mesh.material, 'dispose')

    asset.dispose()
    asset.dispose()

    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
  })

  it('disposes all earlier resources and clears the group when a later mesh step throws', () => {
    const first = resultWithMesh().meshes[0]!
    const second = structuredClone(first)
    let nameReads = 0
    Object.defineProperty(second, 'name', {
      configurable: true,
      get: () => {
        nameReads += 1
        if (nameReads === 2) {
          throw new Error('later mesh construction failed')
        }
        return 'fixture-two'
      },
    })
    const result: OcctSuccessResult = {
      success: true,
      root: { name: 'root', meshes: [0, 1], children: [] },
      meshes: [first, second],
    }
    const geometryDispose = vi.spyOn(BufferGeometry.prototype, 'dispose')
    const materialDispose = vi.spyOn(
      MeshStandardMaterial.prototype,
      'dispose',
    )
    const groupClear = vi.spyOn(Group.prototype, 'clear')

    expect(() => createThreeGroupFromOcct(result)).toThrow(
      'later mesh construction failed',
    )
    expect(geometryDispose).toHaveBeenCalledTimes(2)
    expect(materialDispose).toHaveBeenCalledTimes(2)
    expect(groupClear).toHaveBeenCalledTimes(1)

    geometryDispose.mockRestore()
    materialDispose.mockRestore()
    groupClear.mockRestore()
  })

  it.each([
    [
      'failed result',
      { success: false } as OcctResult,
      /could not parse/i,
    ],
    [
      'non-finite position',
      resultWithMesh({
        attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, NaN, 0] } },
        index: { array: [0, 1, 2] },
      }),
      /non-finite position/i,
    ],
    [
      'invalid triangle array',
      resultWithMesh({ index: { array: [0, 1] } }),
      /triangle index array/i,
    ],
    [
      'out-of-range index',
      resultWithMesh({ index: { array: [0, 1, 99] } }),
      /out-of-range/i,
    ],
    [
      'invalid face range',
      resultWithMesh({
        brep_faces: [{ first: 0, last: 20, color: [1, 0, 0] }],
      }),
      /face range/i,
    ],
  ])('rejects %s before returning a partial scene', (_label, result, message) => {
    expect(() => createThreeGroupFromOcct(result, {})).toThrow(message)
  })

  it('rejects an excessive tessellation before allocating Three buffers', () => {
    const excessiveIndices: number[] = []
    excessiveIndices.length = (MAX_IMPORTED_TRIANGLES + 1) * 3
    const result = resultWithMesh({ index: { array: excessiveIndices } })

    expect(() => createThreeGroupFromOcct(result)).toThrow(/too many triangles/i)
  })

  it('rejects invalid post-import scales', () => {
    expect(() =>
      createThreeGroupFromOcct(resultWithMesh(), { postImportScale: 0 }),
    ).toThrow(/scale/i)
  })
})
