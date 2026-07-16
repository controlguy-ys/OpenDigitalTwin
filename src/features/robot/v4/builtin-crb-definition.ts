import {
  BufferGeometry,
  Material,
  Mesh,
  Object3D,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { failProjectV4 } from '../../../core/project-v4/errors'
import type {
  AssetReferenceV4,
  CollisionBoxV4,
  FrameDefinitionV4,
  GeometryStatisticsV4,
  RobotDefinitionV4,
  RobotJointDefinitionV4,
  RobotLinkDefinitionV4,
  SourceConventionV4,
} from '../../../core/project-v4/types'
import type {
  QuaternionV4,
  RigidTransformV4,
  Vector3V4,
} from '../../../core/project-v4/rigid-transform'
import {
  createPreparedRobotDefinitionGeometryV4,
  type PreparedRobotDefinitionGeometryV4,
} from './robot-definition-geometry-repository'

export const BUILTIN_CRB_DEFINITION_ID_V4 =
  'builtin-abb-crb15000-12kg-127-rev00' as const

interface BuiltinCrbLinkFactV4 {
  readonly id: `LINK0${number}`
  readonly sourceFileName: string
  readonly byteLength: number
  readonly sha256: string
  readonly statistics: GeometryStatisticsV4
  readonly boundsMin: Vector3V4
  readonly boundsMax: Vector3V4
}

const CRB_LINK_FACTS_V4: readonly BuiltinCrbLinkFactV4[] = Object.freeze([
  {
    id: 'LINK00',
    sourceFileName: 'CRB15000_12kg-127_Omnicore_rev00_LINK00_CAD.step',
    byteLength: 449_944,
    sha256: 'cc16b2240874d432b46e4c77bcf24f56121ad26e604a81b612650af050c1b801',
    statistics: { vertices: 4_527, triangles: 5_228, meshes: 1, materials: 1 },
    boundsMin: [-0.14180000126361847, -0.10000000149011612, -2.7755575615628914e-16],
    boundsMax: [0.10000000149011612, 0.10000000149011612, 0.21400000154972076],
  },
  {
    id: 'LINK01',
    sourceFileName: 'CRB15000_12kg-127_Omnicore_rev00_LINK01_CAD.step',
    byteLength: 1_163_252,
    sha256: 'f65e5210c2f7dcc3d9c79b378b0e5435feeb757fda004d9f879df5ed51da2db1',
    statistics: { vertices: 3_798, triangles: 5_544, meshes: 1, materials: 1 },
    boundsMin: [-0.0800001472234726, -0.09515000134706497, -0.12309999763965607],
    boundsMax: [0.0800001472234726, 0.11159999668598175, 0.08010978996753693],
  },
  {
    id: 'LINK02',
    sourceFileName: 'CRB15000_12kg-127_Omnicore_rev00_LINK02_CAD.step',
    byteLength: 3_881_971,
    sha256: '9618cccd139b30bfeb56deaed045bb1b0af10bd2c2fef18a8973c218b03e1343',
    statistics: { vertices: 8_351, triangles: 9_970, meshes: 1, materials: 2 },
    boundsMin: [-0.08076024800539017, -0.2036534696817398, -0.0807277262210846],
    boundsMax: [0.08076024800539017, -0.08630000054836273, 0.775532603263855],
  },
  {
    id: 'LINK03',
    sourceFileName: 'CRB15000_12kg-127_Omnicore_rev00_LINK03_CAD.step',
    byteLength: 1_486_284,
    sha256: 'fafb59b202bc72628f8cbaeb68a8fb1ae062faa254e18034f6cd8a2be4d43671',
    statistics: { vertices: 6_681, triangles: 9_883, meshes: 1, materials: 1 },
    boundsMin: [-0.06499999761581421, -0.08500000089406967, -0.06497151404619217],
    boundsMax: [0.09600000083446503, 0.10999999940395355, 0.16257204115390778],
  },
  {
    id: 'LINK04',
    sourceFileName: 'CRB15000_12kg-127_Omnicore_rev00_LINK04_CAD.step',
    byteLength: 3_624_189,
    sha256: '97654624273168c0a7369a8ffbad5b4651a74cae55210c08df5ef1b42bada7c1',
    statistics: { vertices: 10_330, triangles: 11_162, meshes: 1, materials: 3 },
    boundsMin: [0.09700000286102295, -0.052799999713897705, -0.052819326519966125],
    boundsMax: [0.5847763419151306, 0.13300000131130219, 0.052819326519966125],
  },
  {
    id: 'LINK05',
    sourceFileName: 'CRB15000_12kg-127_Omnicore_rev00_LINK05_CAD.STEP',
    byteLength: 1_327_555,
    sha256: 'aa9908bef33bb89ccc7b27e19ab6a421f7deeac5fc908ec5414807e30e57e9bf',
    statistics: { vertices: 9_056, triangles: 12_092, meshes: 1, materials: 3 },
    boundsMin: [-0.1274278312921524, -0.09350000321865082, -0.05400000140070915],
    boundsMax: [0.06800000369548798, 0.07450000196695328, 0.132750004529953],
  },
  {
    id: 'LINK06',
    sourceFileName: 'CRB15000_12kg-127_Omnicore_rev00_LINK06_CAD.step',
    byteLength: 746_156,
    sha256: '8a18f30a2ccf4ff0aad024d9f4cc8d257e5459148a013026c8ef1f03a90221c0',
    statistics: { vertices: 9_182, triangles: 11_476, meshes: 1, materials: 2 },
    boundsMin: [-0.032600000500679016, -0.052497901022434235, -0.05254051089286804],
    boundsMax: [-2.220446049250313e-16, 0.05252917855978012, 0.05254051089286804],
  },
])

const IDENTITY_POSE_V4: RigidTransformV4 = Object.freeze({
  positionM: Object.freeze([0, 0, 0]) as Vector3V4,
  quaternion: Object.freeze([0, 0, 0, 1]) as readonly [number, number, number, number],
})

const SOURCE_CONVENTION_V4: SourceConventionV4 = Object.freeze({
  linearUnit: 'millimeter',
  sourceToMeters: 0.001,
  orientation: Object.freeze({ mode: 'up-axis', upAxis: 'z' }),
})

function assetIdForLinkV4(linkId: string): string {
  return `builtin-abb-crb15000-12kg-127-link${linkId.slice(-2)}-rev00`
}

function cloneIdentityPoseV4(): RigidTransformV4 {
  return Object.freeze({
    positionM: Object.freeze([...IDENTITY_POSE_V4.positionM]) as Vector3V4,
    quaternion: Object.freeze([...IDENTITY_POSE_V4.quaternion]) as readonly [number, number, number, number],
  })
}

export function createBuiltinCrbAssetReferencesV4(): readonly AssetReferenceV4[] {
  return Object.freeze(CRB_LINK_FACTS_V4.map((fact): AssetReferenceV4 => Object.freeze({
    id: assetIdForLinkV4(fact.id),
    uri: `builtin://abb/crb15000-12kg-127-link${fact.id.slice(-2)}@rev00` as AssetReferenceV4['uri'],
    sha256: fact.sha256,
    byteLength: fact.byteLength,
    sourceFileName: fact.sourceFileName,
    mediaType: 'model/step',
  })))
}

function collisionBoxFromBoundsV4(
  min: Vector3V4,
  max: Vector3V4,
): CollisionBoxV4 {
  return Object.freeze({
    id: 'generated-local-bounds',
    centerM: Object.freeze(min.map((value, index) => (
      (value + max[index]!) / 2
    ))) as Vector3V4,
    halfExtentsM: Object.freeze(min.map((value, index) => (
      (max[index]! - value) / 2
    ))) as Vector3V4,
    quaternion: Object.freeze([0, 0, 0, 1]) as QuaternionV4,
  })
}

function jointV4(
  id: string,
  parentLinkId: string,
  childLinkId: string,
  positionM: Vector3V4,
  axis: Vector3V4,
  min: number,
  max: number,
  maximumVelocity: number,
): RobotJointDefinitionV4 {
  return Object.freeze({
    id,
    type: 'revolute',
    parentLinkId,
    childLinkId,
    origin: Object.freeze({
      positionM: Object.freeze([...positionM]) as Vector3V4,
      quaternion: Object.freeze([0, 0, 0, 1]) as QuaternionV4,
    }),
    axis: Object.freeze([...axis]) as Vector3V4,
    min,
    max,
    home: 0,
    zeroOffset: 0,
    direction: 1,
    maximumVelocity,
  })
}

function frameV4(
  id: string,
  parentFrameId: string,
  role: FrameDefinitionV4['role'],
  pose: RigidTransformV4 = cloneIdentityPoseV4(),
): FrameDefinitionV4 {
  return Object.freeze({ id, name: id, parentFrameId, localPose: pose, role })
}

export function createBuiltinCrbDefinitionV4(): RobotDefinitionV4 {
  const assetReferenceIds = Object.freeze(CRB_LINK_FACTS_V4.map(({ id }) => assetIdForLinkV4(id)))
  const sourceConventions = Object.freeze(Object.fromEntries(
    assetReferenceIds.map((assetId) => [assetId, Object.freeze({
      ...SOURCE_CONVENTION_V4,
      orientation: Object.freeze({ ...SOURCE_CONVENTION_V4.orientation }),
    })]),
  ))
  const links: readonly RobotLinkDefinitionV4[] = Object.freeze(
    CRB_LINK_FACTS_V4.map((fact): RobotLinkDefinitionV4 => Object.freeze({
      id: fact.id,
      name: fact.id,
      geometryOccurrences: Object.freeze([Object.freeze({
        occurrenceKey: `whole-source:${fact.id}`,
        assetReferenceId: assetIdForLinkV4(fact.id),
        linkLocalPose: cloneIdentityPoseV4(),
        statistics: Object.freeze({ ...fact.statistics }),
        collisionBoxes: Object.freeze([
          collisionBoxFromBoundsV4(fact.boundsMin, fact.boundsMax),
        ]),
      })]),
    })),
  )
  const joints = Object.freeze([
    jointV4('J1', 'LINK00', 'LINK01', [0, 0, 0.338], [0, 0, 1], -270, 270, 180),
    jointV4('J2', 'LINK01', 'LINK02', [0, 0, 0], [0, 1, 0], -180, 180, 180),
    jointV4('J3', 'LINK02', 'LINK03', [0, 0, 0.707], [0, 1, 0], -225, 85, 180),
    jointV4('J4', 'LINK03', 'LINK04', [0, 0, 0.11], [1, 0, 0], -180, 180, 320),
    jointV4('J5', 'LINK04', 'LINK05', [0.534, 0, 0], [0, 1, 0], -180, 180, 320),
    jointV4('J6', 'LINK05', 'LINK06', [0.101, 0, 0.08], [1, 0, 0], -270, 270, 420),
  ])
  const frames = Object.freeze([
    frameV4('Base', 'LINK00', 'base'),
    frameV4('Flange', 'LINK06', 'flange'),
    frameV4('Tool0', 'Flange', 'tool0'),
    frameV4('Tool', 'Tool0', 'tool', Object.freeze({
      positionM: Object.freeze([0, 0, 0]) as Vector3V4,
      quaternion: Object.freeze([0, Math.SQRT1_2, 0, Math.SQRT1_2]) as QuaternionV4,
    })),
    frameV4('TCP', 'Tool', 'tcp'),
  ])

  return Object.freeze({
    id: BUILTIN_CRB_DEFINITION_ID_V4,
    name: 'ABB CRB15000 12kg 1.27m',
    manufacturer: 'ABB',
    model: 'CRB15000-12/1.27',
    assetReferenceIds,
    sourceConventions,
    links,
    joints,
    frames,
    excludedGeometryOccurrenceKeys: Object.freeze([]),
  })
}

export interface BuiltinCrbGeometryLoaderV4 {
  load(url: string): Promise<Object3D>
}

class DefaultBuiltinCrbGeometryLoaderV4 implements BuiltinCrbGeometryLoaderV4 {
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
  const { geometry, materials } = collectUniqueResourcesV4(roots)
  let triangleCount = 0
  for (const root of roots) {
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const elementCount = object.geometry.index?.count
        ?? object.geometry.getAttribute('position')?.count
      if (
        elementCount === undefined
        || !Number.isSafeInteger(elementCount)
        || elementCount < 0
        || elementCount % 3 !== 0
      ) {
        failProjectV4(
          'BUILTIN_CRB_GEOMETRY_TRIANGLES_INVALID',
          '$.geometry',
          'Built-in CRB render Geometry must contain complete triangles.',
        )
      }
      triangleCount += elementCount / 3
      if (!Number.isSafeInteger(triangleCount)) {
        failProjectV4(
          'BUILTIN_CRB_GEOMETRY_TRIANGLES_INVALID',
          '$.geometry',
          'Built-in CRB rendered triangle count is not a safe integer.',
        )
      }
    })
  }
  return { geometry, materials, triangleCount }
}

function collectUniqueResourcesV4(roots: readonly Object3D[]): {
  readonly geometry: Set<BufferGeometry>
  readonly materials: Set<Material>
} {
  const geometry = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  for (const root of roots) {
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return
      geometry.add(object.geometry)
      materialsForMeshV4(object).forEach((material) => materials.add(material))
    })
  }
  return { geometry, materials }
}

function disposeRootsV4(roots: readonly Object3D[]): void {
  const resources = collectUniqueResourcesV4(roots)
  const cleanupError = disposeResourceSetsV4(resources)
  if (cleanupError !== null) throw cleanupError
}

function disposeResourceSetsV4(resources: {
  readonly geometry: ReadonlySet<BufferGeometry>
  readonly materials: ReadonlySet<Material>
}): unknown {
  let firstError: unknown = null
  for (const geometry of resources.geometry) {
    try {
      geometry.dispose()
    } catch (error) {
      firstError ??= error
    }
  }
  for (const material of resources.materials) {
    try {
      material.dispose()
    } catch (error) {
      firstError ??= error
    }
  }
  return firstError
}

function canonicalPlainJsonV4(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map(canonicalPlainJsonV4).join(',')}]`
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalPlainJsonV4(
      (value as Record<string, unknown>)[key],
    )}`)
    .join(',')}}`
}

export async function prepareBuiltinCrbGeometryV4(
  definition: RobotDefinitionV4,
  loader: BuiltinCrbGeometryLoaderV4 = new DefaultBuiltinCrbGeometryLoaderV4(),
): Promise<PreparedRobotDefinitionGeometryV4> {
  const expectedLinkIds = CRB_LINK_FACTS_V4.map(({ id }) => id)
  if (
    canonicalPlainJsonV4(definition)
      !== canonicalPlainJsonV4(createBuiltinCrbDefinitionV4())
  ) {
    failProjectV4(
      'BUILTIN_CRB_DEFINITION_INVALID',
      '$.definition',
      'Built-in CRB Geometry requires the checked-in CRB Definition topology.',
    )
  }

  const settled = await Promise.allSettled(expectedLinkIds.map((linkId) => (
    Promise.resolve().then(() => loader.load(`/models/robot/${linkId}.glb`))
  )))
  const fulfilledRoots = settled.flatMap((result) => (
    result.status === 'fulfilled' ? [result.value] : []
  ))
  const rejected = settled.find((result): result is PromiseRejectedResult => (
    result.status === 'rejected'
  ))
  if (rejected !== undefined) {
    try {
      disposeRootsV4(fulfilledRoots)
    } catch {
      // The loader failure remains the primary preparation error.
    }
    throw rejected.reason
  }

  try {
    const resources = collectResourcesV4(fulfilledRoots)
    const linkTemplates = new Map(expectedLinkIds.map((linkId, index) => (
      [linkId, fulfilledRoots[index]!] as const
    )))
    return createPreparedRobotDefinitionGeometryV4({
      definitionId: definition.id,
      linkTemplates,
      sharedGeometry: resources.geometry,
      triangleCount: resources.triangleCount,
      disposeResources: () => {
        const cleanupError = disposeResourceSetsV4(resources)
        if (cleanupError !== null) throw cleanupError
      },
    })
  } catch (error) {
    try {
      disposeRootsV4(fulfilledRoots)
    } catch {
      // Validation/conversion remains the primary preparation error.
    }
    throw error
  }
}
