import {
  BufferGeometry,
  Material,
  Mesh,
  Object3D,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import manifest from '../../../../public/models/robot/ned2/manifest.json' with { type: 'json' }
import { failProjectV4 } from '../../../core/project-v4/errors.js'
import { normalizeRigidTransformV4 } from '../../../core/project-v4/rigid-transform.js'
import type {
  AssetReferenceV4,
  RobotDefinitionV4,
} from '../../../core/project-v4/types.js'
import {
  createPreparedRobotDefinitionGeometryV4,
  type PreparedRobotDefinitionGeometryV4,
} from './robot-definition-geometry-repository.js'

export const BUILTIN_NED2_DEFINITION_ID_V4 = 'builtin-niryo-ned2-v1' as const

const NED2_LINK_IDS_V4 = Object.freeze([
  'LINK00',
  'LINK01',
  'LINK02',
  'LINK03',
  'LINK04',
  'LINK05',
  'LINK06',
] as const)

function deepFreezeV4<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeV4(child)
    Object.freeze(value)
  }
  return value
}

function canonicalJsonV4(value: unknown, propertyName = ''): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (
    propertyName === 'quaternion'
    && Array.isArray(value)
    && value.length === 4
    && value.every((component) => typeof component === 'number')
  ) {
    const normalized = normalizeRigidTransformV4({
      positionM: [0, 0, 0],
      quaternion: value as [number, number, number, number],
    }, '$.definition.quaternion').quaternion
    return `[${normalized.map((component) => JSON.stringify(component)).join(',')}]`
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJsonV4(entry)).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJsonV4((value as Record<string, unknown>)[key], key)}`
  )).join(',')}}`
}

export function createBuiltinNed2AssetReferencesV4(): readonly AssetReferenceV4[] {
  return deepFreezeV4([
    structuredClone(manifest.assetReference) as unknown as AssetReferenceV4,
  ])
}

export function createBuiltinNed2DefinitionV4(): RobotDefinitionV4 {
  const definition = structuredClone(manifest.definition) as unknown as RobotDefinitionV4
  if (definition.id !== BUILTIN_NED2_DEFINITION_ID_V4) {
    throw new Error('The checked-in NED2 manifest has an unexpected Definition identity.')
  }
  return deepFreezeV4(definition)
}

export interface BuiltinNed2GeometryLoaderV4 {
  load(url: string): Promise<Object3D>
}

class DefaultBuiltinNed2GeometryLoaderV4 implements BuiltinNed2GeometryLoaderV4 {
  private readonly loader = new GLTFLoader()

  async load(url: string): Promise<Object3D> {
    return (await this.loader.loadAsync(url)).scene
  }
}

function materialsForMeshV4(mesh: Mesh): readonly Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

function collectResourcesV4(roots: readonly Object3D[]): {
  readonly geometry: Set<BufferGeometry>
  readonly materials: Set<Material>
  readonly triangleCount: number
} {
  const geometry = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  let triangleCount = 0
  for (const root of roots) {
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return
      geometry.add(object.geometry)
      materialsForMeshV4(object).forEach((material) => materials.add(material))
      const elementCount = object.geometry.index?.count
        ?? object.geometry.getAttribute('position')?.count
      if (elementCount === undefined || elementCount % 3 !== 0) {
        failProjectV4(
          'BUILTIN_NED2_GEOMETRY_TRIANGLES_INVALID',
          '$.geometry',
          'Built-in NED2 render Geometry must contain complete triangles.',
        )
      }
      triangleCount += elementCount / 3
    })
  }
  return { geometry, materials, triangleCount }
}

function disposeResourcesV4(resources: {
  readonly geometry: ReadonlySet<BufferGeometry>
  readonly materials: ReadonlySet<Material>
}): void {
  let firstError: unknown = null
  for (const geometry of resources.geometry) {
    try { geometry.dispose() } catch (error) { firstError ??= error }
  }
  for (const material of resources.materials) {
    try { material.dispose() } catch (error) { firstError ??= error }
  }
  if (firstError !== null) throw firstError
}

export async function prepareBuiltinNed2GeometryV4(
  definition: RobotDefinitionV4,
  loader: BuiltinNed2GeometryLoaderV4 = new DefaultBuiltinNed2GeometryLoaderV4(),
): Promise<PreparedRobotDefinitionGeometryV4> {
  if (canonicalJsonV4(definition) !== canonicalJsonV4(createBuiltinNed2DefinitionV4())) {
    failProjectV4(
      'BUILTIN_NED2_DEFINITION_INVALID',
      '$.definition',
      'Built-in NED2 Geometry requires the checked-in NED2 Definition topology.',
    )
  }
  const settled = await Promise.allSettled(NED2_LINK_IDS_V4.map((linkId) => (
    Promise.resolve().then(() => loader.load(`/models/robot/ned2/${linkId}.glb`))
  )))
  const roots = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (rejected !== undefined) {
    try { disposeResourcesV4(collectResourcesV4(roots)) } catch { /* loader error remains primary */ }
    throw rejected.reason
  }

  try {
    const resources = collectResourcesV4(roots)
    return createPreparedRobotDefinitionGeometryV4({
      definitionId: definition.id,
      linkTemplates: new Map(NED2_LINK_IDS_V4.map((linkId, index) => [linkId, roots[index]!])),
      sharedGeometry: resources.geometry,
      triangleCount: resources.triangleCount,
      disposeResources: () => disposeResourcesV4(resources),
    })
  } catch (error) {
    try { disposeResourcesV4(collectResourcesV4(roots)) } catch { /* preparation error remains primary */ }
    throw error
  }
}
