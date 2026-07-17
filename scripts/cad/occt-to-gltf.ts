import {
  Accessor,
  Document,
  NodeIO,
  Primitive,
  type Material,
} from '@gltf-transform/core'

import {
  LINK_WORLD_ORIGINS,
  type RobotLinkId,
  type Vector3Tuple,
} from './crb15000-asset-contract'
import type {
  OcctColor,
  OcctMesh,
  OcctSuccessResult,
} from '../../src/lib/cad/occt-types'

const DEFAULT_COLOR = [0.68, 0.72, 0.74] as const

interface IndexGroup {
  color: OcctColor
  indices: number[]
}

export interface LinkGlbWriteResult {
  localBounds: {
    min: Vector3Tuple
    max: Vector3Tuple
  }
  meshCount: number
  primitiveCount: number
  materialColors: OcctColor[]
}

function colorKey(color: OcctColor): string {
  return color.map((component) => component.toPrecision(12)).join(',')
}

function getIndexGroups(mesh: OcctMesh): IndexGroup[] {
  const sourceIndices = mesh.index.array
  if (sourceIndices.length === 0 || sourceIndices.length % 3 !== 0) {
    throw new Error(`OCCT mesh ${mesh.name} has an invalid triangle index array`)
  }

  const triangleCount = sourceIndices.length / 3
  const fallbackColor = mesh.color ?? DEFAULT_COLOR
  const triangleColors: OcctColor[] = Array.from(
    { length: triangleCount },
    () => fallbackColor,
  )

  for (const face of mesh.brep_faces) {
    if (!Number.isInteger(face.first) || !Number.isInteger(face.last)) {
      throw new Error(
        `OCCT mesh ${mesh.name} has a non-integer face range ${face.first}-${face.last}`,
      )
    }
    if (face.last < face.first) {
      continue
    }
    if (
      face.first < 0 ||
      face.last >= triangleCount
    ) {
      throw new Error(
        `OCCT mesh ${mesh.name} has an invalid face range ${face.first}-${face.last}`,
      )
    }

    const faceColor = face.color ?? fallbackColor
    for (let triangle = face.first; triangle <= face.last; triangle += 1) {
      triangleColors[triangle] = faceColor
    }
  }

  const groups = new Map<string, IndexGroup>()
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const color = triangleColors[triangle]!
    const key = colorKey(color)
    const group = groups.get(key) ?? { color, indices: [] }
    const indexOffset = triangle * 3
    group.indices.push(
      sourceIndices[indexOffset]!,
      sourceIndices[indexOffset + 1]!,
      sourceIndices[indexOffset + 2]!,
    )
    groups.set(key, group)
  }

  return [...groups.values()]
}

function localizePositions(
  mesh: OcctMesh,
  worldOrigin: Vector3Tuple,
): Float32Array {
  const source = mesh.attributes.position.array
  if (source.length === 0 || source.length % 3 !== 0) {
    throw new Error(`OCCT mesh ${mesh.name} has an invalid position array`)
  }

  const localized = new Float32Array(source.length)
  for (let index = 0; index < source.length; index += 3) {
    localized[index] = source[index]! - worldOrigin[0]
    localized[index + 1] = source[index + 1]! - worldOrigin[1]
    localized[index + 2] = source[index + 2]! - worldOrigin[2]
  }
  return localized
}

function getNormals(mesh: OcctMesh, vertexCount: number): Float32Array {
  const source = mesh.attributes.normal?.array
  if (source === undefined || source.length !== vertexCount * 3) {
    throw new Error(`OCCT mesh ${mesh.name} is missing per-vertex normals`)
  }
  if (source.some((value) => !Number.isFinite(value))) {
    throw new Error(`OCCT mesh ${mesh.name} has a non-finite normal`)
  }
  return Float32Array.from(source)
}

function updateBounds(
  positions: Float32Array,
  min: number[],
  max: number[],
  meshName: string,
): void {
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[index + axis]
      if (!Number.isFinite(value)) {
        throw new Error(`OCCT mesh ${meshName} has a non-finite position`)
      }
      min[axis] = Math.min(min[axis]!, value!)
      max[axis] = Math.max(max[axis]!, value!)
    }
  }
}

function createIndexArray(indices: number[], vertexCount: number): Uint16Array | Uint32Array {
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
      throw new Error(`OCCT returned out-of-range vertex index ${index}`)
    }
  }
  return vertexCount <= 0xffff
    ? Uint16Array.from(indices)
    : Uint32Array.from(indices)
}

export async function writeLinkGlb(
  linkId: RobotLinkId,
  result: OcctSuccessResult,
  outputPath: string,
): Promise<LinkGlbWriteResult> {
  if (result.meshes.length === 0) {
    throw new Error(`Cannot write ${linkId}: OCCT returned no meshes`)
  }

  const document = new Document()
  const buffer = document.createBuffer(`${linkId}-buffer`)
  const scene = document.createScene(linkId)
  document.getRoot().setDefaultScene(scene)

  const materials = new Map<string, Material>()
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  let primitiveCount = 0

  const getMaterial = (color: OcctColor): Material => {
    const key = colorKey(color)
    let material = materials.get(key)
    if (material === undefined) {
      material = document
        .createMaterial(`color-${key}`)
        .setBaseColorFactor([color[0], color[1], color[2], 1])
        .setMetallicFactor(0.05)
        .setRoughnessFactor(0.72)
      materials.set(key, material)
    }
    return material
  }

  for (const [meshIndex, sourceMesh] of result.meshes.entries()) {
    if (sourceMesh.color !== undefined) {
      getMaterial(sourceMesh.color)
    }
    for (const face of sourceMesh.brep_faces) {
      if (face.color !== null) {
        getMaterial(face.color)
      }
    }

    const positions = localizePositions(sourceMesh, LINK_WORLD_ORIGINS[linkId])
    const vertexCount = positions.length / 3
    const normals = getNormals(sourceMesh, vertexCount)
    updateBounds(positions, min, max, sourceMesh.name)

    const positionAccessor = document
      .createAccessor(`${linkId}-${meshIndex}-POSITION`, buffer)
      .setType(Accessor.Type.VEC3!)
      .setArray(positions)
    const normalAccessor = document
      .createAccessor(`${linkId}-${meshIndex}-NORMAL`, buffer)
      .setType(Accessor.Type.VEC3!)
      .setArray(normals)
    const targetMesh = document.createMesh(
      sourceMesh.name || `${linkId}-mesh-${meshIndex}`,
    )

    for (const group of getIndexGroups(sourceMesh)) {
      const key = colorKey(group.color)
      const material = getMaterial(group.color)

      const indexAccessor = document
        .createAccessor(`${linkId}-${meshIndex}-${key}-indices`, buffer)
        .setType(Accessor.Type.SCALAR!)
        .setArray(createIndexArray(group.indices, vertexCount))

      targetMesh.addPrimitive(
        document
          .createPrimitive()
          .setMode(Primitive.Mode.TRIANGLES!)
          .setAttribute('POSITION', positionAccessor)
          .setAttribute('NORMAL', normalAccessor)
          .setIndices(indexAccessor)
          .setMaterial(material),
      )
      primitiveCount += 1
    }

    scene.addChild(
      document.createNode(`${linkId}-node-${meshIndex}`).setMesh(targetMesh),
    )
  }

  await new NodeIO().write(outputPath, document)

  return {
    localBounds: {
      min: [min[0]!, min[1]!, min[2]!],
      max: [max[0]!, max[1]!, max[2]!],
    },
    meshCount: result.meshes.length,
    primitiveCount,
    materialColors: [...materials.values()].map((material) => {
      const [red, green, blue] = material.getBaseColorFactor()
      return [red, green, blue]
    }),
  }
}
