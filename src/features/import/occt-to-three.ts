import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Uint16BufferAttribute,
  Uint32BufferAttribute,
} from 'three'
import type {
  OcctColor,
  OcctMesh,
  OcctResult,
} from '../../lib/cad/occt-types'

export type ImportOriginMode = 'center' | 'source'
export type Vector3Tuple = [number, number, number]

export interface ImportedBounds {
  min: Vector3Tuple
  max: Vector3Tuple
  size: Vector3Tuple
  center: Vector3Tuple
}

export interface ThreeImportOptions {
  postImportScale?: number
  originMode?: ImportOriginMode
}

export interface ImportedThreeAsset {
  group: Group
  bounds: ImportedBounds
  colliderCenter: Vector3Tuple
  dispose(): void
}

interface MaterialIndexGroup {
  color: OcctColor
  indices: number[]
}

export const MAX_IMPORTED_VERTICES = 5_000_000
export const MAX_IMPORTED_TRIANGLES = 10_000_000
const MAX_ABSOLUTE_COORDINATE_METERS = 1_000_000
const DEFAULT_COLOR = [0.68, 0.72, 0.74] as const

function colorKey(color: OcctColor): string {
  return color.map((component) => component.toPrecision(12)).join(',')
}

function validateColor(color: OcctColor, meshName: string): void {
  if (
    color.length !== 3 ||
    color.some(
      (component) =>
        !Number.isFinite(component) || component < 0 || component > 1,
    )
  ) {
    throw new Error(`OCCT mesh ${meshName} has an invalid color.`)
  }
}

function materialGroups(mesh: OcctMesh, triangleCount: number): MaterialIndexGroup[] {
  const fallbackColor = mesh.color ?? DEFAULT_COLOR
  validateColor(fallbackColor, mesh.name)
  const triangleColors: OcctColor[] = Array.from(
    { length: triangleCount },
    () => fallbackColor,
  )

  for (const face of mesh.brep_faces) {
    if (
      !Number.isInteger(face.first) ||
      !Number.isInteger(face.last) ||
      face.first < 0 ||
      face.last < face.first ||
      face.last >= triangleCount
    ) {
      throw new Error(
        `OCCT mesh ${mesh.name} has an invalid face range ${face.first}-${face.last}.`,
      )
    }

    const faceColor = face.color ?? fallbackColor
    validateColor(faceColor, mesh.name)
    for (let triangle = face.first; triangle <= face.last; triangle += 1) {
      triangleColors[triangle] = faceColor
    }
  }

  const groups = new Map<string, MaterialIndexGroup>()
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const color = triangleColors[triangle]!
    const key = colorKey(color)
    const group = groups.get(key) ?? { color, indices: [] }
    const offset = triangle * 3
    group.indices.push(
      mesh.index.array[offset]!,
      mesh.index.array[offset + 1]!,
      mesh.index.array[offset + 2]!,
    )
    groups.set(key, group)
  }

  return [...groups.values()]
}

function validateMesh(
  mesh: OcctMesh,
  postImportScale: number,
  min: number[],
  max: number[],
): Float32Array {
  const sourcePositions = mesh.attributes.position.array
  if (sourcePositions.length === 0 || sourcePositions.length % 3 !== 0) {
    throw new Error(`OCCT mesh ${mesh.name} has an invalid position array.`)
  }

  const vertexCount = sourcePositions.length / 3
  if (vertexCount > MAX_IMPORTED_VERTICES) {
    throw new Error(`OCCT mesh ${mesh.name} has too many vertices.`)
  }

  const sourceIndices = mesh.index.array
  if (sourceIndices.length === 0 || sourceIndices.length % 3 !== 0) {
    throw new Error(
      `OCCT mesh ${mesh.name} has an invalid triangle index array.`,
    )
  }
  const triangleCount = sourceIndices.length / 3
  if (triangleCount > MAX_IMPORTED_TRIANGLES) {
    throw new Error(`OCCT mesh ${mesh.name} has too many triangles.`)
  }

  for (const index of sourceIndices) {
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
      throw new Error(`OCCT mesh ${mesh.name} has out-of-range vertex index ${index}.`)
    }
  }

  const positions = new Float32Array(sourcePositions.length)
  for (let offset = 0; offset < sourcePositions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const source = sourcePositions[offset + axis]
      if (source === undefined || !Number.isFinite(source)) {
        throw new Error(`OCCT mesh ${mesh.name} has a non-finite position.`)
      }
      const value = source * postImportScale
      if (Math.abs(value) > MAX_ABSOLUTE_COORDINATE_METERS) {
        throw new Error(`OCCT mesh ${mesh.name} has an unreasonable coordinate.`)
      }

      positions[offset + axis] = value
      min[axis] = Math.min(min[axis]!, value)
      max[axis] = Math.max(max[axis]!, value)
    }
  }

  const normals = mesh.attributes.normal?.array
  if (
    normals !== undefined &&
    (normals.length !== sourcePositions.length ||
      normals.some((value) => !Number.isFinite(value)))
  ) {
    throw new Error(`OCCT mesh ${mesh.name} has invalid per-vertex normals.`)
  }

  return positions
}

function createGeometry(
  mesh: OcctMesh,
  positions: Float32Array,
): { geometry: BufferGeometry; materials: MeshStandardMaterial[] } {
  const vertexCount = positions.length / 3
  const groups = materialGroups(mesh, mesh.index.array.length / 3)
  const reorderedIndices = groups.flatMap((group) => group.indices)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(
    vertexCount <= 0xffff
      ? new Uint16BufferAttribute(reorderedIndices, 1)
      : new Uint32BufferAttribute(reorderedIndices, 1),
  )

  const sourceNormals = mesh.attributes.normal?.array
  if (sourceNormals === undefined) {
    geometry.computeVertexNormals()
  } else {
    geometry.setAttribute(
      'normal',
      new Float32BufferAttribute(Float32Array.from(sourceNormals), 3),
    )
  }

  const materials: MeshStandardMaterial[] = []
  let indexOffset = 0
  for (const [materialIndex, group] of groups.entries()) {
    geometry.addGroup(indexOffset, group.indices.length, materialIndex)
    indexOffset += group.indices.length
    materials.push(
      new MeshStandardMaterial({
        color: new Color(group.color[0], group.color[1], group.color[2]),
        metalness: 0.05,
        roughness: 0.72,
      }),
    )
  }

  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return { geometry, materials }
}

function tuple(values: readonly number[]): Vector3Tuple {
  return [values[0]!, values[1]!, values[2]!]
}

export function createThreeGroupFromOcct(
  result: OcctResult,
  options: ThreeImportOptions = {},
): ImportedThreeAsset {
  if (result.success !== true) {
    throw new Error('OCCT could not parse this STEP file.')
  }
  if (result.meshes.length === 0) {
    throw new Error('OCCT returned no meshes for this STEP file.')
  }

  const postImportScale = options.postImportScale ?? 1
  const originMode = options.originMode ?? 'source'
  if (!Number.isFinite(postImportScale) || postImportScale <= 0) {
    throw new Error('Post-import scale must be a positive finite number.')
  }
  if (originMode !== 'center' && originMode !== 'source') {
    throw new Error('Unsupported imported geometry origin mode.')
  }

  const min = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ]
  const max = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]
  const validatedMeshes = result.meshes.map((mesh) => ({
    mesh,
    positions: validateMesh(mesh, postImportScale, min, max),
  }))

  const sourceCenter = min.map((minimum, axis) => (minimum + max[axis]!) / 2)
  const size = min.map((minimum, axis) => max[axis]! - minimum)
  const offset = originMode === 'center' ? sourceCenter.map((value) => -value) : [0, 0, 0]
  const outputMin = min.map((value, axis) => value + offset[axis]!)
  const outputMax = max.map((value, axis) => value + offset[axis]!)
  const outputCenter = sourceCenter.map((value, axis) => value + offset[axis]!)

  const group = new Group()
  group.name = 'imported-step'
  const geometries: BufferGeometry[] = []
  const materials: MeshStandardMaterial[] = []
  for (const { mesh, positions } of validatedMeshes) {
    const converted = createGeometry(mesh, positions)
    if (originMode === 'center') {
      converted.geometry.translate(offset[0]!, offset[1]!, offset[2]!)
      converted.geometry.computeBoundingBox()
      converted.geometry.computeBoundingSphere()
    }

    geometries.push(converted.geometry)
    materials.push(...converted.materials)
    const material =
      converted.materials.length === 1
        ? converted.materials[0]!
        : converted.materials
    const threeMesh = new Mesh(converted.geometry, material)
    threeMesh.name = mesh.name || `imported-mesh-${group.children.length}`
    threeMesh.castShadow = true
    threeMesh.receiveShadow = true
    group.add(threeMesh)
  }

  let disposed = false
  return {
    group,
    bounds: {
      min: tuple(outputMin),
      max: tuple(outputMax),
      size: tuple(size),
      center: tuple(outputCenter),
    },
    colliderCenter: tuple(outputCenter),
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      for (const geometry of geometries) {
        geometry.dispose()
      }
      for (const material of materials) {
        material.dispose()
      }
      group.clear()
    },
  }
}
