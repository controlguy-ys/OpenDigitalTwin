import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Accessor, NodeIO, Primitive, type Mesh } from '@gltf-transform/core'

import { LINK_WORLD_ORIGINS } from '../../src/domain/robot/crb15000'
import {
  BOUNDS_TOLERANCE_METERS,
  EXPECTED_LINK_PROBES,
  LINK_IDS,
  TRIANGLE_COUNT_TOLERANCE_RATIO,
  type Bounds3,
  type LinkId,
  type Vector3,
} from './convert-robot'

const COLOR_RICH_LINKS = ['LINK02', 'LINK04', 'LINK05', 'LINK06'] as const

interface MutableBounds {
  min: [number, number, number]
  max: [number, number, number]
}

interface ValidatedLink {
  bounds: Bounds3
  materialColorCount: number
  triangleCount: number
  vertexCount: number
}

function emptyBounds(): MutableBounds {
  return {
    min: [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ],
    max: [
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ],
  }
}

function updateBounds(
  bounds: MutableBounds,
  values: ArrayLike<number>,
  label: string,
): void {
  if (values.length === 0 || values.length % 3 !== 0) {
    throw new Error(`${label} has an invalid VEC3 array`)
  }

  for (let index = 0; index < values.length; index += 3) {
    for (const axis of [0, 1, 2] as const) {
      const value = values[index + axis]
      if (!Number.isFinite(value)) {
        throw new Error(`${label} contains a non-finite value`)
      }
      bounds.min[axis] = Math.min(bounds.min[axis], value!)
      bounds.max[axis] = Math.max(bounds.max[axis], value!)
    }
  }
}

function requireFiniteBounds(bounds: MutableBounds, label: string): Bounds3 {
  const values = [...bounds.min, ...bounds.max]
  if (!values.every(Number.isFinite)) {
    throw new Error(`${label} has non-finite bounds`)
  }
  return {
    min: [...bounds.min] as Vector3,
    max: [...bounds.max] as Vector3,
  }
}

function colorKey(color: readonly number[]): string {
  return color.slice(0, 3).map((value) => value.toPrecision(12)).join(',')
}

function assertSharedAttributes(mesh: Mesh, linkId: LinkId): void {
  const primitives = mesh.listPrimitives()
  const firstPrimitive = primitives[0]
  if (firstPrimitive === undefined) {
    throw new Error(`${linkId} mesh ${mesh.getName()} has no primitives`)
  }
  const sharedPosition = firstPrimitive.getAttribute('POSITION')
  const sharedNormal = firstPrimitive.getAttribute('NORMAL')

  for (const primitive of primitives.slice(1)) {
    if (primitive.getAttribute('POSITION') !== sharedPosition) {
      throw new Error(`${linkId} mesh ${mesh.getName()} does not share POSITION`)
    }
    if (primitive.getAttribute('NORMAL') !== sharedNormal) {
      throw new Error(`${linkId} mesh ${mesh.getName()} does not share NORMAL`)
    }
  }
}

async function validateLink(
  linkId: LinkId,
  assetDirectory: string,
): Promise<ValidatedLink> {
  const document = await new NodeIO().read(resolve(assetDirectory, `${linkId}.glb`))
  const root = document.getRoot()
  const scene = root.getDefaultScene()
  if (scene === null) {
    throw new Error(`${linkId} has no default scene`)
  }
  if (root.listBuffers().length !== 1) {
    throw new Error(`${linkId} must contain exactly one GLB buffer`)
  }

  const meshes = root.listMeshes()
  if (meshes.length === 0) {
    throw new Error(`${linkId} has no meshes`)
  }
  const sceneMeshes = new Set<Mesh>()
  scene.traverse((node) => {
    const mesh = node.getMesh()
    if (mesh !== null) {
      sceneMeshes.add(mesh)
    }
  })
  if (meshes.some((mesh) => !sceneMeshes.has(mesh))) {
    throw new Error(`${linkId} contains a mesh outside its default scene`)
  }

  const localBounds = emptyBounds()
  const seenPositions = new Set<Accessor>()
  let vertexCount = 0
  let triangleCount = 0

  for (const mesh of meshes) {
    assertSharedAttributes(mesh, linkId)
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== Primitive.Mode.TRIANGLES!) {
        throw new Error(`${linkId} contains a non-triangle primitive`)
      }

      const position = primitive.getAttribute('POSITION')
      const normal = primitive.getAttribute('NORMAL')
      const indices = primitive.getIndices()
      const material = primitive.getMaterial()
      if (position === null || position.getCount() === 0) {
        throw new Error(`${linkId} contains an empty POSITION accessor`)
      }
      if (position.getType() !== Accessor.Type.VEC3!) {
        throw new Error(`${linkId} POSITION accessor is not VEC3`)
      }
      if (normal === null || normal.getCount() !== position.getCount()) {
        throw new Error(`${linkId} contains invalid shared normals`)
      }
      if (normal.getType() !== Accessor.Type.VEC3!) {
        throw new Error(`${linkId} NORMAL accessor is not VEC3`)
      }
      if (indices === null || indices.getCount() === 0) {
        throw new Error(`${linkId} contains an empty index accessor`)
      }
      if (
        indices.getType() !== Accessor.Type.SCALAR! ||
        indices.getCount() % 3 !== 0
      ) {
        throw new Error(`${linkId} contains a non-triangle index accessor`)
      }
      if (material === null) {
        throw new Error(`${linkId} primitive has no material`)
      }

      const positionArray = position.getArray()
      const normalArray = normal.getArray()
      const indexArray = indices.getArray()
      if (positionArray === null || normalArray === null || indexArray === null) {
        throw new Error(`${linkId} contains an accessor without binary data`)
      }
      if ([...normalArray].some((value) => !Number.isFinite(value))) {
        throw new Error(`${linkId} contains a non-finite normal`)
      }
      for (const index of indexArray) {
        if (!Number.isInteger(index) || index < 0 || index >= position.getCount()) {
          throw new Error(`${linkId} contains out-of-range index ${index}`)
        }
      }

      if (!seenPositions.has(position)) {
        seenPositions.add(position)
        vertexCount += position.getCount()
        updateBounds(localBounds, positionArray, `${linkId} POSITION`)
      }
      triangleCount += indices.getCount() / 3
    }
  }

  const materialColors = new Set<string>()
  for (const material of root.listMaterials()) {
    const color = material.getBaseColorFactor()
    if (color.some((value) => !Number.isFinite(value))) {
      throw new Error(`${linkId} contains a non-finite material color`)
    }
    if (Math.abs(material.getMetallicFactor() - 0.05) > 1e-6) {
      throw new Error(`${linkId} material metallic factor is not 0.05`)
    }
    if (Math.abs(material.getRoughnessFactor() - 0.72) > 1e-6) {
      throw new Error(`${linkId} material roughness factor is not 0.72`)
    }
    materialColors.add(colorKey(color))
  }

  const local = requireFiniteBounds(localBounds, linkId)
  const origin = LINK_WORLD_ORIGINS[linkId]
  const worldBounds: Bounds3 = {
    min: [
      local.min[0] + origin[0],
      local.min[1] + origin[1],
      local.min[2] + origin[2],
    ],
    max: [
      local.max[0] + origin[0],
      local.max[1] + origin[1],
      local.max[2] + origin[2],
    ],
  }

  return {
    bounds: worldBounds,
    materialColorCount: materialColors.size,
    triangleCount,
    vertexCount,
  }
}

function assertExpectedLink(linkId: LinkId, actual: ValidatedLink): void {
  const expected = EXPECTED_LINK_PROBES[linkId]
  if (actual.vertexCount !== expected.vertexCount) {
    throw new Error(
      `${linkId} GLB has ${actual.vertexCount} vertices; expected ${expected.vertexCount}`,
    )
  }
  if (
    Math.abs(actual.triangleCount - expected.triangleCount) >
    expected.triangleCount * TRIANGLE_COUNT_TOLERANCE_RATIO
  ) {
    throw new Error(
      `${linkId} GLB has ${actual.triangleCount} triangles; expected ${expected.triangleCount} within 2%`,
    )
  }

  for (const bound of ['min', 'max'] as const) {
    for (const axis of [0, 1, 2] as const) {
      const delta = Math.abs(
        actual.bounds[bound][axis] - expected.bounds[bound][axis],
      )
      if (delta > BOUNDS_TOLERANCE_METERS) {
        throw new Error(
          `${linkId} reconstructed ${bound}[${axis}] differs by ${delta} m`,
        )
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function validateAssetReport(assetDirectory: string): Promise<void> {
  const source = await readFile(resolve(assetDirectory, 'asset-report.json'), 'utf8')
  const report: unknown = JSON.parse(source) as unknown
  if (
    !isRecord(report) ||
    report.schemaVersion !== 1 ||
    report.robotId !== 'CRB15000-12/1.27' ||
    report.outputLinearUnit !== 'meter' ||
    !Array.isArray(report.links)
  ) {
    throw new Error('asset-report.json has an invalid header')
  }

  const reportLinkIds = report.links.map((link) =>
    isRecord(link) ? link.id : undefined,
  )
  if (JSON.stringify(reportLinkIds) !== JSON.stringify(LINK_IDS)) {
    throw new Error('asset-report.json does not list LINK00 through LINK06 in order')
  }
}

export async function validateRobotAssets(
  assetDirectory = resolve(process.cwd(), 'public', 'models', 'robot'),
): Promise<void> {
  await validateAssetReport(assetDirectory)
  const unionBounds = emptyBounds()

  for (const linkId of LINK_IDS) {
    const actual = await validateLink(linkId, assetDirectory)
    assertExpectedLink(linkId, actual)
    if (
      COLOR_RICH_LINKS.includes(linkId as (typeof COLOR_RICH_LINKS)[number]) &&
      actual.materialColorCount < 2
    ) {
      throw new Error(`${linkId} did not retain at least two source colors`)
    }
    updateBounds(
      unionBounds,
      [...actual.bounds.min, ...actual.bounds.max],
      `${linkId} world bounds`,
    )
  }

  const union = requireFiniteBounds(unionBounds, 'robot asset union')
  const longestAxis = Math.max(
    union.max[0] - union.min[0],
    union.max[1] - union.min[1],
    union.max[2] - union.min[2],
  )
  if (longestAxis < 1.2 || longestAxis > 1.5) {
    throw new Error(`robot asset union longest axis is ${longestAxis} m`)
  }

  console.log(`${LINK_IDS.length} link assets valid; 0 errors; 0 warnings`)
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  validateRobotAssets().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
