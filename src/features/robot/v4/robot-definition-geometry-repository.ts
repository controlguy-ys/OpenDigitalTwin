import {
  BufferGeometry,
  Group,
  Material,
  Object3D,
} from 'three'
import { failProjectV4 } from '../../../core/project-v4/errors'
import type {
  RobotDefinitionIdV4,
  RobotDefinitionV4,
  RobotIdV4,
  RobotLinkIdV4,
} from '../../../core/project-v4/types'
import {
  encodeRuntimeIdentitySegmentV4,
  rootRobotLinkIdV4,
} from '../../../core/robot-runtime/collision-identity'

export interface PreparedRobotDefinitionGeometryV4 {
  readonly definitionId: RobotDefinitionIdV4
  readonly linkTemplates: ReadonlyMap<RobotLinkIdV4, Object3D>
  readonly sharedGeometry: ReadonlySet<BufferGeometry>
  readonly triangleCount: number
  readonly lifecycleState: 'READY' | 'DISPOSED'
  dispose(): void
}

export interface PrepareRobotDefinitionGeometryInputV4 {
  readonly definitionId: RobotDefinitionIdV4
  readonly linkTemplates: ReadonlyMap<RobotLinkIdV4, Object3D>
  readonly sharedGeometry: ReadonlySet<BufferGeometry>
  readonly triangleCount: number
  readonly disposeResources: () => void
}

interface PreparedGeometryAuthorityV4 {
  lifecycleState: 'READY' | 'DISPOSED'
  repositoryOwned: boolean
  readonly disposeResources: () => void
}

const preparedGeometryAuthorityV4 = new WeakMap<object, PreparedGeometryAuthorityV4>()

function disposePreparedAuthorityV4(authority: PreparedGeometryAuthorityV4): void {
  if (authority.lifecycleState === 'DISPOSED') return
  authority.lifecycleState = 'DISPOSED'
  authority.disposeResources()
}

function readonlyMapSnapshotV4<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  const snapshot = new Map(source)
  let view: ReadonlyMap<K, V>
  view = Object.freeze({
    get size() {
      return snapshot.size
    },
    has: (key: K) => snapshot.has(key),
    get: (key: K) => snapshot.get(key),
    entries: () => snapshot.entries(),
    keys: () => snapshot.keys(),
    values: () => snapshot.values(),
    forEach: (callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown) => {
      snapshot.forEach((value, key) => callback.call(thisArg, value, key, view))
    },
    [Symbol.iterator]: () => snapshot[Symbol.iterator](),
    [Symbol.toStringTag]: 'ReadonlyMap',
  })
  return view
}

function readonlySetSnapshotV4<T>(source: ReadonlySet<T>): ReadonlySet<T> {
  const snapshot = new Set(source)
  let view: ReadonlySet<T>
  view = Object.freeze({
    get size() {
      return snapshot.size
    },
    has: (value: T) => snapshot.has(value),
    entries: () => snapshot.entries(),
    keys: () => snapshot.keys(),
    values: () => snapshot.values(),
    forEach: (callback: (value: T, valueAgain: T, set: ReadonlySet<T>) => void, thisArg?: unknown) => {
      snapshot.forEach((value) => callback.call(thisArg, value, value, view))
    },
    [Symbol.iterator]: () => snapshot[Symbol.iterator](),
    [Symbol.toStringTag]: 'ReadonlySet',
  })
  return view
}

export function createPreparedRobotDefinitionGeometryV4(
  input: PrepareRobotDefinitionGeometryInputV4,
): PreparedRobotDefinitionGeometryV4 {
  const authority: PreparedGeometryAuthorityV4 = {
    lifecycleState: 'READY',
    repositoryOwned: false,
    disposeResources: input.disposeResources,
  }
  const linkTemplates = readonlyMapSnapshotV4(input.linkTemplates)
  const sharedGeometry = readonlySetSnapshotV4(input.sharedGeometry)
  const prepared = Object.freeze({
    definitionId: input.definitionId,
    linkTemplates,
    sharedGeometry,
    triangleCount: input.triangleCount,
    get lifecycleState() {
      return authority.lifecycleState
    },
    dispose: () => {
      if (authority.repositoryOwned) return
      disposePreparedAuthorityV4(authority)
    },
  }) satisfies PreparedRobotDefinitionGeometryV4
  preparedGeometryAuthorityV4.set(prepared, authority)
  return prepared
}

export interface RobotDefinitionGeometryPublicationHandleV4 {
  readonly kind: 'robot-definition-geometry-publication-v4'
}

export interface RobotDefinitionGeometryPublicationSnapshotV4 {
  readonly definitionId: RobotDefinitionIdV4
  readonly handle: RobotDefinitionGeometryPublicationHandleV4
  readonly resolution: 'RESOLVED' | 'UNRESOLVED'
  readonly triangleCount: number
}

export interface AcquiredRobotDefinitionGeometryV4 {
  readonly definitionId: RobotDefinitionIdV4
  readonly robotId: RobotIdV4
  readonly publicationHandle: RobotDefinitionGeometryPublicationHandleV4
  readonly instanceRoot: Group
  readonly linkRoots: ReadonlyMap<RobotLinkIdV4, Group>
  readonly sharedGeometry: ReadonlySet<BufferGeometry>
  release(): void
}

export interface RobotDefinitionGeometryRepositoryV4 {
  stage(
    definition: RobotDefinitionV4,
    geometry: PreparedRobotDefinitionGeometryV4,
  ): RobotDefinitionGeometryPublicationHandleV4
  stageUnresolved(
    definition: RobotDefinitionV4,
    declaredTriangleCount: number,
  ): RobotDefinitionGeometryPublicationHandleV4
  commitBatch(
    handles: readonly RobotDefinitionGeometryPublicationHandleV4[],
  ): void
  rollback(handle: RobotDefinitionGeometryPublicationHandleV4): void
  readCurrent(
    definitionId: RobotDefinitionIdV4,
  ): RobotDefinitionGeometryPublicationSnapshotV4 | null
  acquire(
    definitionId: RobotDefinitionIdV4,
    robotId: RobotIdV4,
    publicationHandle?: RobotDefinitionGeometryPublicationHandleV4,
  ): AcquiredRobotDefinitionGeometryV4 | null
  revoke(handle: RobotDefinitionGeometryPublicationHandleV4): void
  subscribe(listener: () => void): () => void
  getSnapshot(): number
}

type PublicationStateV4 = 'STAGED' | 'COMMITTED' | 'ROLLED_BACK' | 'REVOKED'

interface PublicationGenerationV4 {
  readonly generation: number
  readonly definition: GeometryDefinitionSnapshotV4
  readonly geometry: PreparedRobotDefinitionGeometryV4 | null
  readonly resolution: 'RESOLVED' | 'UNRESOLVED'
  readonly triangleCount: number
  readonly handle: RobotDefinitionGeometryPublicationHandleV4
  state: PublicationStateV4
  leaseCount: number
}

interface GeometryDefinitionSnapshotV4 {
  readonly id: RobotDefinitionIdV4
  readonly links: readonly {
    readonly id: RobotLinkIdV4
    readonly encodedId: string
  }[]
  readonly joints: readonly {
    readonly parentLinkId: RobotLinkIdV4
    readonly childLinkId: RobotLinkIdV4
  }[]
}

function repositoryFailureV4(
  code: string,
  path: string,
  message: string,
): never {
  failProjectV4(code, path, message, 'Prepare and publish a valid Robot Definition Geometry generation.')
}

function requirePreparedAuthorityV4(
  geometry: PreparedRobotDefinitionGeometryV4,
): PreparedGeometryAuthorityV4 {
  if (geometry === null || typeof geometry !== 'object') {
    repositoryFailureV4(
      'ROBOT_GEOMETRY_PREPARED_RESOURCE_INVALID',
      '$.geometry',
      'Prepared Robot Geometry must be created by the V4 factory.',
    )
  }
  const authority = preparedGeometryAuthorityV4.get(geometry)
  if (
    authority === undefined
    || authority.lifecycleState !== 'READY'
    || authority.repositoryOwned
  ) {
    repositoryFailureV4(
      'ROBOT_GEOMETRY_PREPARED_RESOURCE_INVALID',
      '$.geometry',
      'Prepared Robot Geometry is forged, disposed, or already owned.',
    )
  }
  return authority
}

function validateStageCandidateV4(
  definition: RobotDefinitionV4,
  geometry: PreparedRobotDefinitionGeometryV4,
): PreparedGeometryAuthorityV4 {
  const authority = requirePreparedAuthorityV4(geometry)
  rootRobotLinkIdV4(definition)
  if (geometry.definitionId !== definition.id) {
    repositoryFailureV4(
      'ROBOT_GEOMETRY_DEFINITION_MISMATCH',
      '$.geometry.definitionId',
      'Prepared Geometry Definition ID must match the staged Definition.',
    )
  }
  if (
    !Number.isSafeInteger(geometry.triangleCount)
    || geometry.triangleCount < 0
  ) {
    repositoryFailureV4(
      'ROBOT_GEOMETRY_TRIANGLE_COUNT_INVALID',
      '$.geometry.triangleCount',
      'Prepared Geometry triangle count must be a non-negative safe integer.',
    )
  }
  const definitionLinkIds = new Set(definition.links.map(({ id }) => id))
  const templateLinkIds = [...geometry.linkTemplates.keys()]
  if (
    templateLinkIds.length !== definitionLinkIds.size
    || templateLinkIds.some((linkId) => !definitionLinkIds.has(linkId))
  ) {
    repositoryFailureV4(
      'ROBOT_GEOMETRY_LINK_TEMPLATE_SET_MISMATCH',
      '$.geometry.linkTemplates',
      'Prepared Geometry Link templates must exactly match the Definition Links.',
    )
  }
  return authority
}

function snapshotGeometryDefinitionV4(
  definition: RobotDefinitionV4,
): GeometryDefinitionSnapshotV4 {
  return Object.freeze({
    id: definition.id,
    links: Object.freeze(definition.links.map(({ id }) => Object.freeze({
      id,
      encodedId: encodeRuntimeIdentitySegmentV4(id),
    }))),
    joints: Object.freeze(definition.joints.map(({ parentLinkId, childLinkId }) => Object.freeze({
      parentLinkId,
      childLinkId,
    }))),
  })
}

function cloneOneMaterialV4(
  material: Material,
  clones: Map<Material, Material>,
): Material {
  const existing = clones.get(material)
  if (existing !== undefined) return existing
  const clone = material.clone()
  clones.set(material, clone)
  return clone
}

function cloneMaterialV4(
  material: Material | Material[],
  clones: Map<Material, Material>,
): Material | Material[] {
  return Array.isArray(material)
    ? material.map((entry) => cloneOneMaterialV4(entry, clones))
    : cloneOneMaterialV4(material, clones)
}

function cloneTemplateForLeaseV4(
  template: Object3D,
  materialClones: Map<Material, Material>,
): Object3D {
  const clone = template.clone(true)
  clone.traverse((object) => {
    const material = (object as Object3D & {
      material?: Material | Material[]
    }).material
    if (
      material === undefined
      || (!Array.isArray(material) && !(material instanceof Material))
      || (Array.isArray(material) && material.some((entry) => !(entry instanceof Material)))
    ) {
      return
    }
    ;(object as Object3D & { material: Material | Material[] }).material =
      cloneMaterialV4(material, materialClones)
  })
  return clone
}

function captureCleanupErrorV4(
  current: unknown,
  operation: () => void,
): unknown {
  try {
    operation()
    return current
  } catch (error) {
    return current ?? error
  }
}

function createLeaseV4(
  generation: PublicationGenerationV4,
  robotId: RobotIdV4,
): AcquiredRobotDefinitionGeometryV4 {
  const geometry = generation.geometry
  if (geometry === null) {
    repositoryFailureV4(
      'ROBOT_GEOMETRY_UNRESOLVED',
      '$.geometry',
      'An unresolved Geometry generation cannot be acquired.',
    )
  }
  const encodedRobotId = encodeRuntimeIdentitySegmentV4(robotId)
  const instanceRoot = new Group()
  instanceRoot.name = `robot:${encodedRobotId}`
  const mutableMaterials = new Map<Material, Material>()
  const linkRoots = new Map<RobotLinkIdV4, Group>()
  try {
    for (const link of generation.definition.links) {
      const linkRoot = new Group()
      linkRoot.name = `robot-link:${encodedRobotId}:${link.encodedId}`
      const template = geometry.linkTemplates.get(link.id)!
      linkRoot.add(cloneTemplateForLeaseV4(template, mutableMaterials))
      linkRoots.set(link.id, linkRoot)
    }
    const childIds = new Set(generation.definition.joints.map(({ childLinkId }) => childLinkId))
    const rootLinkId = generation.definition.links.find(({ id }) => !childIds.has(id))!.id
    instanceRoot.add(linkRoots.get(rootLinkId)!)
    for (const joint of generation.definition.joints) {
      linkRoots.get(joint.parentLinkId)!.add(linkRoots.get(joint.childLinkId)!)
    }
  } catch (error) {
    instanceRoot.removeFromParent()
    let cleanupError: unknown = null
    mutableMaterials.forEach((material) => {
      cleanupError = captureCleanupErrorV4(cleanupError, () => material.dispose())
    })
    throw error ?? cleanupError
  }

  generation.leaseCount += 1
  let released = false
  const linkRootsView = readonlyMapSnapshotV4(linkRoots)
  return Object.freeze({
    definitionId: generation.definition.id,
    robotId,
    publicationHandle: generation.handle,
    instanceRoot,
    linkRoots: linkRootsView,
    sharedGeometry: geometry.sharedGeometry,
    release: () => {
      if (released) return
      released = true
      let cleanupError: unknown = null
      cleanupError = captureCleanupErrorV4(cleanupError, () => instanceRoot.removeFromParent())
      mutableMaterials.forEach((material) => {
        cleanupError = captureCleanupErrorV4(cleanupError, () => material.dispose())
      })
      generation.leaseCount -= 1
      cleanupError = captureCleanupErrorV4(
        cleanupError,
        () => disposeRetiredGenerationV4(generation),
      )
      if (cleanupError !== null) throw cleanupError
    },
  })
}

function disposeRetiredGenerationV4(generation: PublicationGenerationV4): void {
  if (
    generation.leaseCount === 0
    && (generation.state === 'ROLLED_BACK' || generation.state === 'REVOKED')
  ) {
    if (generation.geometry === null) return
    const authority = preparedGeometryAuthorityV4.get(generation.geometry)
    if (authority === undefined) {
      repositoryFailureV4(
        'ROBOT_GEOMETRY_PREPARED_RESOURCE_INVALID',
        '$.geometry',
        'Owned Robot Geometry lost its preparation authority.',
      )
    }
    disposePreparedAuthorityV4(authority)
  }
}

export function createRobotDefinitionGeometryRepositoryV4(
  options: { readonly initialGenerationForTesting?: number } = {},
): RobotDefinitionGeometryRepositoryV4 {
  let generationCounter = options.initialGenerationForTesting ?? 0
  if (!Number.isSafeInteger(generationCounter) || generationCounter < 0) {
    repositoryFailureV4(
      'ROBOT_GEOMETRY_PUBLICATION_GENERATION_INVALID',
      '$.initialGenerationForTesting',
      'Initial Geometry publication generation must be a non-negative safe integer.',
    )
  }
  let snapshot = 0
  const listeners = new Set<() => void>()
  const authorityByHandle = new WeakMap<object, PublicationGenerationV4>()
  const committedByDefinition = new Map<RobotDefinitionIdV4, PublicationGenerationV4[]>()
  const currentByDefinition = new Map<RobotDefinitionIdV4, PublicationGenerationV4>()

  const requireHandle = (
    handle: RobotDefinitionGeometryPublicationHandleV4,
  ): PublicationGenerationV4 => {
    if (handle === null || typeof handle !== 'object') {
      repositoryFailureV4(
        'ROBOT_GEOMETRY_PUBLICATION_HANDLE_INVALID',
        '$.publicationHandle',
        'Geometry publication handle is not owned by this repository.',
      )
    }
    const generation = authorityByHandle.get(handle)
    if (generation === undefined) {
      repositoryFailureV4(
        'ROBOT_GEOMETRY_PUBLICATION_HANDLE_INVALID',
        '$.publicationHandle',
        'Geometry publication handle is not owned by this repository.',
      )
    }
    return generation
  }

  const emit = (): void => {
    snapshot += 1
    for (const listener of listeners) listener()
  }

  const selectFallbackCurrent = (definitionId: RobotDefinitionIdV4): void => {
    const history = committedByDefinition.get(definitionId) ?? []
    const fallback = [...history]
      .reverse()
      .find((candidate) => candidate.state === 'COMMITTED')
    if (fallback === undefined) currentByDefinition.delete(definitionId)
    else currentByDefinition.set(definitionId, fallback)
  }

  const createPublication = (
    definition: RobotDefinitionV4,
    geometry: PreparedRobotDefinitionGeometryV4 | null,
    resolution: 'RESOLVED' | 'UNRESOLVED',
    triangleCount: number,
  ): RobotDefinitionGeometryPublicationHandleV4 => {
    const definitionSnapshot = snapshotGeometryDefinitionV4(definition)
    if (generationCounter >= Number.MAX_SAFE_INTEGER) {
      repositoryFailureV4(
        'ROBOT_GEOMETRY_PUBLICATION_GENERATION_EXHAUSTED',
        '$.generation',
        'Robot Geometry publication generation cannot be safely incremented.',
      )
    }
    const generation = generationCounter + 1
    const handle = Object.freeze({
      kind: 'robot-definition-geometry-publication-v4' as const,
    })
    const publication: PublicationGenerationV4 = {
      generation,
      definition: definitionSnapshot,
      geometry,
      resolution,
      triangleCount,
      handle,
      state: 'STAGED',
      leaseCount: 0,
    }
    generationCounter = generation
    authorityByHandle.set(handle, publication)
    return handle
  }

  return {
    stage: (definition, geometry) => {
      const preparedAuthority = validateStageCandidateV4(definition, geometry)
      const handle = createPublication(
        definition,
        geometry,
        'RESOLVED',
        geometry.triangleCount,
      )
      preparedAuthority.repositoryOwned = true
      return handle
    },
    stageUnresolved: (definition, declaredTriangleCount) => {
      if (
        !Number.isSafeInteger(declaredTriangleCount)
        || declaredTriangleCount < 0
      ) {
        repositoryFailureV4(
          'ROBOT_GEOMETRY_TRIANGLE_COUNT_INVALID',
          '$.declaredTriangleCount',
          'Declared unresolved Geometry triangle count must be a non-negative safe integer.',
        )
      }
      return createPublication(
        definition,
        null,
        'UNRESOLVED',
        declaredTriangleCount,
      )
    },
    commitBatch: (handles) => {
      if (handles.length === 0 || new Set(handles).size !== handles.length) {
        repositoryFailureV4(
          'ROBOT_GEOMETRY_PUBLICATION_BATCH_INVALID',
          '$.publicationHandles',
          'Geometry publication batch must be non-empty and duplicate-free.',
        )
      }
      const candidates = handles.map(requireHandle)
      const definitions = new Set<RobotDefinitionIdV4>()
      for (const candidate of candidates) {
        if (candidate.state !== 'STAGED' || definitions.has(candidate.definition.id)) {
          repositoryFailureV4(
            'ROBOT_GEOMETRY_PUBLICATION_BATCH_INVALID',
            '$.publicationHandles',
            'A batch must contain one staged generation per Definition.',
          )
        }
        definitions.add(candidate.definition.id)
      }
      for (const candidate of candidates) {
        candidate.state = 'COMMITTED'
        const history = committedByDefinition.get(candidate.definition.id) ?? []
        history.push(candidate)
        committedByDefinition.set(candidate.definition.id, history)
        currentByDefinition.set(candidate.definition.id, candidate)
      }
      emit()
    },
    rollback: (handle) => {
      const generation = requireHandle(handle)
      if (generation.state === 'ROLLED_BACK') return
      if (generation.state !== 'STAGED') {
        repositoryFailureV4(
          'ROBOT_GEOMETRY_PUBLICATION_STATE_INVALID',
          '$.publicationHandle',
          'Only a staged Geometry generation can be rolled back.',
        )
      }
      generation.state = 'ROLLED_BACK'
      disposeRetiredGenerationV4(generation)
    },
    readCurrent: (definitionId) => {
      const generation = currentByDefinition.get(definitionId)
      return generation === undefined
        ? null
        : Object.freeze({
            definitionId,
            handle: generation.handle,
            resolution: generation.resolution,
            triangleCount: generation.triangleCount,
          })
    },
    acquire: (definitionId, robotId, publicationHandle) => {
      const generation = publicationHandle === undefined
        ? currentByDefinition.get(definitionId)
        : requireHandle(publicationHandle)
      if (
        generation === undefined
        || generation.definition.id !== definitionId
        || generation.resolution === 'UNRESOLVED'
        || (generation.state !== 'STAGED' && generation.state !== 'COMMITTED')
      ) {
        return null
      }
      return createLeaseV4(generation, robotId)
    },
    revoke: (handle) => {
      const generation = requireHandle(handle)
      if (generation.state === 'REVOKED') return
      if (generation.state === 'STAGED') {
        repositoryFailureV4(
          'ROBOT_GEOMETRY_PUBLICATION_STATE_INVALID',
          '$.publicationHandle',
          'A staged Geometry generation must be rolled back, not revoked.',
        )
      }
      if (generation.state === 'ROLLED_BACK') return
      const wasCurrent = currentByDefinition.get(generation.definition.id) === generation
      generation.state = 'REVOKED'
      if (wasCurrent) selectFallbackCurrent(generation.definition.id)
      let disposalError: unknown = null
      try {
        disposeRetiredGenerationV4(generation)
      } catch (error) {
        disposalError = error
      } finally {
        if (wasCurrent) emit()
      }
      if (disposalError !== null) throw disposalError
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
  }
}
