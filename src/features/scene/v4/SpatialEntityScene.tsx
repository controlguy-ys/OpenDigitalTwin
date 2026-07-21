import { Html } from '@react-three/drei/web/Html.js'
import { createPortal, useFrame, type ThreeEvent } from '@react-three/fiber'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
} from 'three'
import {
  composeRigidTransformV4,
  quaternionToMatrix3V4,
  relativeRigidTransformV4,
  type RigidTransformV4,
  type Vector3V4,
} from '../../../core/project-v4/rigid-transform'
import type {
  SceneGroupIdV4,
  FrameIdV4,
  SpatialEntityIdV4,
  SpatialEntityV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/types'
import { encodeRuntimeIdentitySegmentV4 } from '../../../core/robot-runtime/collision-identity'
import {
  spatialEntityCollisionProxyV4,
  type CollisionGeometryProxyV4,
} from '../../collision/v4/scene-entity-adapter-v4.js'
import type {
  SceneIsolationTargetV4,
  SceneSelectionV4,
} from '../../interaction/v4/scene-selection.js'
import type { GizmoFramePreferenceV4 } from '../../viewport/v4/viewport-preference-store.js'
import type { ObjectRuntimeStateV4 } from '../../runtime-gateway/v4/object-runtime-state-v4.js'
import type { HandoverPoseOverrideV4 } from '../../handover/v4/handover-demo-runtime-store.js'
import { SpatialEntityTransformControlsV4 } from './SpatialEntityTransformControls.js'
import type { WorkcellInteractionHandlersV4 } from './scene-context-request.js'
import type {
  SceneRuntimeProjectionV4,
  SceneRuntimeSpatialEntityV4,
} from './scene-runtime-selector'

export interface SpatialEntitySceneRegistrationV4 {
  readonly roots: ReadonlyMap<SpatialEntityIdV4, Object3D>
  readonly collisionProxies: readonly CollisionGeometryProxyV4[]
}

export interface SpatialEntityScenePropsV4 {
  readonly project: WorkcellProjectV4
  readonly sceneRuntime: SceneRuntimeProjectionV4
  readonly onRegister: (
    registration: SpatialEntitySceneRegistrationV4 | null,
  ) => void
  readonly interaction?: WorkcellInteractionHandlersV4
  readonly viewIsolation?: SceneIsolationTargetV4 | null
  readonly selection?: SceneSelectionV4
  readonly gizmoFrame?: GizmoFramePreferenceV4
  readonly onCommitLocalPose?: (
    entityId: SpatialEntityIdV4,
    localPose: RigidTransformV4,
  ) => Promise<void>
  readonly onDraggingChange?: (dragging: boolean) => void
  readonly objectRuntime?: ObjectRuntimeStateV4 | null
  readonly poseOverride?: HandoverPoseOverrideV4 | null
}

interface LocalBoundsV4 {
  readonly center: Vector3V4
  readonly halfExtents: Vector3V4
}

interface SpatialOverlayV4 {
  readonly anchor: Object3D
  readonly entityId: SpatialEntityIdV4
  readonly name: string
  readonly value: number
}

interface SpatialEntityRenderRecordV4 {
  readonly root: Group
  readonly bounds: LocalBoundsV4
  readonly overlayAnchor: Group
}

interface SpatialSceneResourcesV4 {
  readonly signature: string
  readonly records: ReadonlyMap<SpatialEntityIdV4, SpatialEntityRenderRecordV4>
  readonly roots: ReadonlyMap<SpatialEntityIdV4, Group>
  readonly geometryResources: ReadonlySet<BufferGeometry>
  readonly materialResources: ReadonlySet<Material>
  disposed: boolean
}

interface SpatialRenderStateV4 {
  readonly resources: SpatialSceneResourcesV4
  readonly registration: SpatialEntitySceneRegistrationV4
  readonly overlays: readonly SpatialOverlayV4[]
}

interface ActivePublicationV4 {
  readonly resources: SpatialSceneResourcesV4
  readonly registration: SpatialEntitySceneRegistrationV4
  readonly onRegister: SpatialEntityScenePropsV4['onRegister']
}

interface AttemptFailureV4 {
  readonly present: boolean
  readonly value: unknown
}

const NO_ATTEMPT_FAILURE_V4: AttemptFailureV4 = Object.freeze({
  present: false,
  value: undefined,
})

const LIVE_RUNTIME_PUBLICATION_INTERVAL_MS_V4 = 100
const IDENTITY_POSE_V4: RigidTransformV4 = Object.freeze({
  positionM: Object.freeze([0, 0, 0] as const),
  quaternion: Object.freeze([0, 0, 0, 1] as const),
})

function attemptV4(
  failure: AttemptFailureV4,
  action: () => void,
): AttemptFailureV4 {
  try {
    action()
    return failure
  } catch (error) {
    return failure.present ? failure : { present: true, value: error }
  }
}

function applyPoseV4(object: Object3D, pose: RigidTransformV4): void {
  object.position.set(...pose.positionM)
  object.quaternion.set(...pose.quaternion)
}

function readonlyMapSnapshotV4<K, V>(
  entries: Iterable<readonly [K, V]>,
): ReadonlyMap<K, V> {
  const backing = new Map<K, V>(entries)
  let facade: ReadonlyMap<K, V>
  facade = Object.freeze({
    get size(): number {
      return backing.size
    },
    has: (key: K): boolean => backing.has(key),
    get: (key: K): V | undefined => backing.get(key),
    entries: (): MapIterator<[K, V]> => backing.entries(),
    keys: (): MapIterator<K> => backing.keys(),
    values: (): MapIterator<V> => backing.values(),
    forEach: (
      callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
      thisArg?: unknown,
    ): void => {
      backing.forEach((value, key) => callbackfn.call(thisArg, value, key, facade))
    },
    [Symbol.iterator]: (): MapIterator<[K, V]> => backing[Symbol.iterator](),
  })
  return facade
}

function rotatedHalfExtentsV4(
  halfExtents: Vector3V4,
  quaternion: readonly [number, number, number, number],
): Vector3V4 {
  const matrix = quaternionToMatrix3V4(quaternion)
  return [
    Math.abs(matrix[0]) * halfExtents[0]
      + Math.abs(matrix[1]) * halfExtents[1]
      + Math.abs(matrix[2]) * halfExtents[2],
    Math.abs(matrix[3]) * halfExtents[0]
      + Math.abs(matrix[4]) * halfExtents[1]
      + Math.abs(matrix[5]) * halfExtents[2],
    Math.abs(matrix[6]) * halfExtents[0]
      + Math.abs(matrix[7]) * halfExtents[1]
      + Math.abs(matrix[8]) * halfExtents[2],
  ]
}

function geometryBoundsV4(entity: SpatialEntityV4): LocalBoundsV4 {
  const geometry = entity.geometry
  if (geometry.kind === 'box') {
    return {
      center: [0, 0, 0],
      halfExtents: [
        geometry.dimensionsM[0] / 2,
        geometry.dimensionsM[1] / 2,
        geometry.dimensionsM[2] / 2,
      ],
    }
  }
  if (geometry.kind === 'cylinder') {
    return {
      center: [0, 0, 0],
      halfExtents: [geometry.radiusM, geometry.radiusM, geometry.heightM / 2],
    }
  }
  if (geometry.collisionBoxes.length === 0) {
    const edge = Math.max(
      0.1,
      Math.min(1, Math.cbrt(Math.max(geometry.statistics.vertices, 1)) * 0.01),
    )
    return { center: [0, 0, 0], halfExtents: [edge / 2, edge / 2, edge / 2] }
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const box of geometry.collisionBoxes) {
    const aabbHalfExtents = rotatedHalfExtentsV4(
      box.halfExtentsM,
      box.quaternion,
    )
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(
        min[axis]!,
        box.centerM[axis]! - aabbHalfExtents[axis]!,
      )
      max[axis] = Math.max(
        max[axis]!,
        box.centerM[axis]! + aabbHalfExtents[axis]!,
      )
    }
  }
  return {
    center: [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ],
    halfExtents: [
      (max[0] - min[0]) / 2,
      (max[1] - min[1]) / 2,
      (max[2] - min[2]) / 2,
    ],
  }
}

function createGeometryVisualV4(
  entity: SpatialEntityV4,
  root: Group,
  geometryResources: Set<BufferGeometry>,
  materialResources: Set<Material>,
): LocalBoundsV4 {
  const bounds = geometryBoundsV4(entity)
  let geometry: BufferGeometry
  if (entity.geometry.kind === 'box') {
    geometry = new BoxGeometry(...entity.geometry.dimensionsM)
  } else if (entity.geometry.kind === 'cylinder') {
    geometry = new CylinderGeometry(
      entity.geometry.radiusM,
      entity.geometry.radiusM,
      entity.geometry.heightM,
      entity.geometry.radialSegments,
    )
    geometry.rotateX(Math.PI / 2)
  } else {
    geometry = new BoxGeometry(
      bounds.halfExtents[0] * 2,
      bounds.halfExtents[1] * 2,
      bounds.halfExtents[2] * 2,
    )
  }
  geometryResources.add(geometry)

  const material = entity.geometry.kind === 'asset'
    ? new MeshBasicMaterial({
        color: '#f5c542',
        opacity: 0.45,
        transparent: true,
        wireframe: true,
      })
    : new MeshStandardMaterial({ color: entity.geometry.color })
  materialResources.add(material)

  const mesh = new Mesh(geometry, material)
  mesh.position.set(...bounds.center)
  if (entity.geometry.kind === 'asset') {
    mesh.name = 'spatial-geometry-unresolved'
    mesh.userData = { geometryState: 'UNRESOLVED', badge: 'UNRESOLVED' }
    root.userData = { ...root.userData, geometryState: 'UNRESOLVED' }
  } else {
    root.userData = { ...root.userData, geometryState: 'RESOLVED' }
  }
  root.add(mesh)
  return bounds
}

function disposeResourcesV4(
  resources: SpatialSceneResourcesV4,
  initialFailure: AttemptFailureV4 = NO_ATTEMPT_FAILURE_V4,
): AttemptFailureV4 {
  if (resources.disposed) return initialFailure
  resources.disposed = true
  let failure = initialFailure
  resources.roots.forEach((root) => {
    failure = attemptV4(failure, () => root.removeFromParent())
  })
  resources.geometryResources.forEach((geometry) => {
    failure = attemptV4(failure, () => geometry.dispose())
  })
  resources.materialResources.forEach((material) => {
    failure = attemptV4(failure, () => material.dispose())
  })
  return failure
}

function createSceneResourcesV4(
  project: WorkcellProjectV4,
  signature: string,
): SpatialSceneResourcesV4 {
  const records = new Map<SpatialEntityIdV4, SpatialEntityRenderRecordV4>()
  const roots = new Map<SpatialEntityIdV4, Group>()
  const geometryResources = new Set<BufferGeometry>()
  const materialResources = new Set<Material>()
  const resources: SpatialSceneResourcesV4 = {
    signature,
    records,
    roots,
    geometryResources,
    materialResources,
    disposed: false,
  }
  try {
    for (const entity of project.spatialEntities) {
      const root = new Group()
      root.name = `spatial-entity:${encodeRuntimeIdentitySegmentV4(entity.id)}`
      roots.set(entity.id, root)
      const bounds = createGeometryVisualV4(
        entity,
        root,
        geometryResources,
        materialResources,
      )
      const overlayAnchor = new Group()
      overlayAnchor.name = `spatial-status:${encodeRuntimeIdentitySegmentV4(entity.id)}`
      root.add(overlayAnchor)
      records.set(entity.id, { root, bounds, overlayAnchor })
    }
    return resources
  } catch (error) {
    const failure = disposeResourcesV4(resources, { present: true, value: error })
    throw failure.value
  }
}

export interface SpatialEntityEffectiveTransformRuntimeV4 {
  update(nowMs: number): void
  readEntityWorldPose(entityId: SpatialEntityIdV4): RigidTransformV4
  readFrameWorldPose(frameId: FrameIdV4): RigidTransformV4
  isEntityDynamicallyDriven(entityId: SpatialEntityIdV4): boolean
}

/**
 * The render loop and collision resolver share this one pose cache. The
 * Project graph is already validated, but the bounded guards preserve a
 * deterministic persisted fallback if an invalid graph somehow reaches a
 * live renderer.
 */
export function createSpatialEntityEffectiveTransformRuntimeV4(
  project: WorkcellProjectV4,
  sceneRuntime: SceneRuntimeProjectionV4,
  objectRuntime: ObjectRuntimeStateV4 | null,
  poseOverride: HandoverPoseOverrideV4 | null = null,
): SpatialEntityEffectiveTransformRuntimeV4 {
  if (sceneRuntime.projectRevisionId !== project.revisionId) {
    throw new Error('Spatial Entity Scene runtime and Project revisions must match.')
  }
  const entitiesById = new Map(project.spatialEntities.map((entity) => [entity.id, entity]))
  const maximumDepth = project.spatialEntities.length + sceneRuntime.globalFrames.size + 1
  interface ResolvedPoseV4 {
    readonly pose: RigidTransformV4
    readonly dynamic: boolean
  }
  const entityWorldPoses = new Map<SpatialEntityIdV4, ResolvedPoseV4>()
  const frameWorldPoses = new Map<FrameIdV4, ResolvedPoseV4>()

  const persistedEntityPose = (entityId: SpatialEntityIdV4): RigidTransformV4 => {
    const persisted = sceneRuntime.entities.get(entityId)
    if (persisted?.kind !== 'spatial-entity') {
      throw new Error(`Spatial Entity ${entityId} has no V4 runtime projection.`)
    }
    return persisted.worldPose
  }

  const update = (nowMs: number): void => {
    const resolvingEntities = new Set<SpatialEntityIdV4>()
    const resolvingFrames = new Set<FrameIdV4>()
    entityWorldPoses.clear()
    frameWorldPoses.clear()

    const resolveEntity = (entityId: SpatialEntityIdV4, depth: number): ResolvedPoseV4 => {
      const cached = entityWorldPoses.get(entityId)
      if (cached !== undefined) return cached
      const override = poseOverride?.readWorldPose(entityId) ?? null
      if (override !== null) {
        const resolved = { pose: override, dynamic: true } as const
        entityWorldPoses.set(entityId, resolved)
        return resolved
      }
      if (depth > maximumDepth || resolvingEntities.has(entityId)) {
        return { pose: persistedEntityPose(entityId), dynamic: false }
      }
      const entity = entitiesById.get(entityId)
      if (entity === undefined) return { pose: persistedEntityPose(entityId), dynamic: false }
      resolvingEntities.add(entityId)
      const parent = resolveFrame(entity.parentFrameId, depth + 1)
      const resolved: ResolvedPoseV4 = parent.dynamic
        ? { pose: composeRigidTransformV4(parent.pose, entity.localPose), dynamic: true }
        : { pose: persistedEntityPose(entityId), dynamic: false }
      resolvingEntities.delete(entityId)
      entityWorldPoses.set(entityId, resolved)
      return resolved
    }

    const resolveFrame = (frameId: FrameIdV4, depth: number): ResolvedPoseV4 => {
      const cached = frameWorldPoses.get(frameId)
      if (cached !== undefined) return cached
      const frame = sceneRuntime.globalFrames.get(frameId)
      if (frame === undefined || depth > maximumDepth || resolvingFrames.has(frameId)) {
        return { pose: frame?.worldPose ?? IDENTITY_POSE_V4, dynamic: false }
      }
      resolvingFrames.add(frameId)
      const parent = frame.parent === null
        ? { pose: IDENTITY_POSE_V4, dynamic: false }
        : frame.parent.kind === 'global-frame'
          ? resolveFrame(frame.parent.frameId, depth + 1)
          : resolveEntity(frame.parent.entityId, depth + 1)
      const live = objectRuntime !== null && frame.frameKind === 'moving' && frame.ownerEntityId !== null
        ? objectRuntime.sampleEntityFrame(frame.ownerEntityId, frame.frameId, nowMs)
        : null
      const resolved: ResolvedPoseV4 = (live !== null || parent.dynamic)
        ? {
            pose: composeRigidTransformV4(parent.pose, live?.pose ?? frame.localPose),
            dynamic: true,
          }
        : { pose: frame.worldPose, dynamic: false }
      resolvingFrames.delete(frameId)
      frameWorldPoses.set(frameId, resolved)
      return resolved
    }

    for (const entity of project.spatialEntities) resolveEntity(entity.id, 0)
  }

  return Object.freeze({
    update,
    readEntityWorldPose(entityId: SpatialEntityIdV4) {
      return entityWorldPoses.get(entityId)?.pose ?? persistedEntityPose(entityId)
    },
    readFrameWorldPose(frameId: FrameIdV4) {
      return frameWorldPoses.get(frameId)?.pose
        ?? sceneRuntime.globalFrames.get(frameId)?.worldPose
        ?? IDENTITY_POSE_V4
    },
    isEntityDynamicallyDriven(entityId: SpatialEntityIdV4) {
      return entityWorldPoses.get(entityId)?.dynamic ?? false
    },
  })
}

export function resolveSpatialEntityWorldPoseV4(
  project: WorkcellProjectV4,
  sceneRuntime: SceneRuntimeProjectionV4,
  entity: SpatialEntityV4,
  objectRuntime: ObjectRuntimeStateV4 | null,
  nowMs: number,
): RigidTransformV4 {
  const effective = createSpatialEntityEffectiveTransformRuntimeV4(
    project,
    sceneRuntime,
    objectRuntime,
  )
  effective.update(nowMs)
  return effective.readEntityWorldPose(entity.id)
}

function projectRuntimeStateV4(
  resources: SpatialSceneResourcesV4,
  project: WorkcellProjectV4,
  sceneRuntime: SceneRuntimeProjectionV4,
  viewIsolation: SceneIsolationTargetV4 | null,
  objectRuntime: ObjectRuntimeStateV4 | null,
  effectiveTransforms: SpatialEntityEffectiveTransformRuntimeV4,
  nowMs: number,
): Omit<SpatialRenderStateV4, 'resources'> {
  if (sceneRuntime.projectRevisionId !== project.revisionId) {
    throw new Error('Spatial Entity Scene runtime and Project revisions must match.')
  }
  const visibleRoots = new Map<SpatialEntityIdV4, Object3D>()
  const proxies: CollisionGeometryProxyV4[] = []
  const overlays: SpatialOverlayV4[] = []
  effectiveTransforms.update(nowMs)
  for (const entity of project.spatialEntities) {
    const record = resources.records.get(entity.id)
    if (record === undefined) {
      throw new Error(`Spatial Entity ${entity.id} has no render resources.`)
    }
    const runtime = sceneRuntime.entities.get(entity.id)
    if (runtime?.kind !== 'spatial-entity') {
      throw new Error(`Spatial Entity ${entity.id} has no V4 runtime projection.`)
    }
    const spatialRuntime = runtime as SceneRuntimeSpatialEntityV4
    const worldPose = effectiveTransforms.readEntityWorldPose(entity.id)
    applyPoseV4(record.root, worldPose)
    const viewVisible = spatialRuntime.effectiveVisible
      && spatialEntityVisibleInIsolationV4(project, entity, viewIsolation)
    record.root.visible = viewVisible
    if (!spatialRuntime.effectiveVisible) continue

    visibleRoots.set(entity.id, record.root)
    const proxy = spatialEntityCollisionProxyV4({
      entity,
      worldPose,
      effectiveVisible: true,
      resolveWorldPose: () => effectiveTransforms.readEntityWorldPose(entity.id),
    })
    if (proxy !== null) proxies.push(proxy)
    if (viewVisible && entity.numericStatus.overlay.visible) {
      if (entity.numericStatus.overlay.frameId === null) {
        record.overlayAnchor.position.set(
          record.bounds.center[0],
          record.bounds.center[1],
          record.bounds.center[2] + record.bounds.halfExtents[2] + 0.06,
        )
        record.overlayAnchor.quaternion.identity()
      } else {
        const frame = sceneRuntime.globalFrames.get(entity.numericStatus.overlay.frameId)
        if (frame === undefined) {
          throw new Error(`Status Frame ${entity.numericStatus.overlay.frameId} is unresolved.`)
        }
        applyPoseV4(record.overlayAnchor, relativeRigidTransformV4(
          worldPose,
          frame.worldPose,
        ))
      }
      overlays.push(Object.freeze({
        anchor: record.overlayAnchor,
        entityId: entity.id,
        name: entity.name,
        value: objectRuntime?.readEntityStatus(entity.id, nowMs)?.value
          ?? spatialRuntime.numericStatus,
      }))
    }
  }
  return {
    registration: Object.freeze({
      roots: readonlyMapSnapshotV4(visibleRoots),
      collisionProxies: Object.freeze(proxies),
    }),
    overlays: Object.freeze(overlays),
  }
}

function groupContainsV4(
  project: WorkcellProjectV4,
  descendantId: SceneGroupIdV4 | null,
  ancestorId: SceneGroupIdV4,
): boolean {
  let currentId = descendantId
  while (currentId !== null) {
    if (currentId === ancestorId) return true
    currentId = project.sceneGroups.find(({ id }) => id === currentId)?.parentGroupId ?? null
  }
  return false
}

function spatialEntityVisibleInIsolationV4(
  project: WorkcellProjectV4,
  entity: SpatialEntityV4,
  isolation: SceneIsolationTargetV4 | null,
): boolean {
  if (isolation === null) return true
  if (isolation.kind === 'spatial-entity') return isolation.entityId === entity.id
  if (isolation.kind === 'scene-group') {
    return groupContainsV4(project, entity.groupId, isolation.groupId)
  }
  return false
}

function NumericStatusOverlayV4({
  name,
  value,
}: Readonly<{ name: string; value: number }>) {
  return (
    <Html center zIndexRange={[40, 0]}>
      <output aria-label={`${name} numeric status`} role="status">
        {value}
      </output>
    </Html>
  )
}

export function SpatialEntitySceneV4({
  project,
  sceneRuntime,
  onRegister,
  interaction,
  viewIsolation = null,
  selection = null,
  gizmoFrame = 'world',
  onCommitLocalPose,
  onDraggingChange,
  objectRuntime = null,
  poseOverride = null,
}: SpatialEntityScenePropsV4): ReactNode {
  const [resources, setResources] = useState<SpatialSceneResourcesV4 | null>(null)
  const [renderState, setRenderState] = useState<SpatialRenderStateV4 | null>(null)
  const [livePresentationNowMs, setLivePresentationNowMs] = useState(0)
  const activePublication = useRef<ActivePublicationV4 | null>(null)
  const lastRuntimeProjection = useRef({ atMs: 0, signature: '' })
  const resourceSignature = JSON.stringify(project.spatialEntities.map(
    ({ id, geometry }) => [id, geometry],
  ))
  const effectiveTransforms = useMemo(() => createSpatialEntityEffectiveTransformRuntimeV4(
    project,
    sceneRuntime,
    objectRuntime,
    poseOverride,
  ), [objectRuntime, poseOverride, project, sceneRuntime])

  useFrame(() => {
    if (
      (objectRuntime === null && poseOverride === null)
      || renderState === null
      || renderState.resources.disposed
    ) return
    const nowMs = Date.now()
    effectiveTransforms.update(nowMs)
    const signature: string[] = []
    for (const entity of project.spatialEntities) {
      const record = renderState.resources.records.get(entity.id)
      if (record === undefined) continue
      const status = objectRuntime?.readEntityStatus(entity.id, nowMs) ?? null
      if (effectiveTransforms.isEntityDynamicallyDriven(entity.id)) {
        applyPoseV4(record.root, effectiveTransforms.readEntityWorldPose(entity.id))
      }
      if (objectRuntime !== null && entity.transformOwner.startsWith('opcua:')) {
        const pose = objectRuntime.sampleEntityFrame(entity.id, entity.parentFrameId, nowMs)
        signature.push(
          entity.id,
          String(pose?.sourceTimestampMs ?? -1),
          pose?.quality ?? 'NONE',
          pose?.statusCode ?? 'NONE',
        )
      }
      if (status !== null) {
        signature.push(
          entity.id,
          String(status.sourceTimestampMs),
          status.quality,
          String(status.value),
        )
      }
    }
    if (nowMs - lastRuntimeProjection.current.atMs < LIVE_RUNTIME_PUBLICATION_INTERVAL_MS_V4) return
    const nextSignature = signature.join('|')
    lastRuntimeProjection.current.atMs = nowMs
    if (nextSignature === lastRuntimeProjection.current.signature) return
    lastRuntimeProjection.current.signature = nextSignature
    setLivePresentationNowMs(nowMs)
  })

  useEffect(() => {
    const nextResources = createSceneResourcesV4(
      project,
      resourceSignature,
    )
    setResources(nextResources)

    return () => {
      let failure = NO_ATTEMPT_FAILURE_V4
      const active = activePublication.current
      if (active?.resources === nextResources) {
        activePublication.current = null
        failure = attemptV4(failure, () => active.onRegister(null))
      }
      failure = disposeResourcesV4(nextResources, failure)
      if (failure.present) throw failure.value
    }
    // Geometry lifetime follows this complete deterministic signature. The
    // effect closure supplies the Project from the render that committed it.
  }, [resourceSignature])

  useEffect(() => {
    if (
      resources === null
      || resources.disposed
      || resources.signature !== resourceSignature
    ) return
    const previousActive = activePublication.current?.resources === resources
      ? activePublication.current
      : null
    let projected: Omit<SpatialRenderStateV4, 'resources'>
    try {
      projected = projectRuntimeStateV4(
        resources,
        project,
        sceneRuntime,
        viewIsolation,
        objectRuntime,
        effectiveTransforms,
        Date.now(),
      )
    } catch (error) {
      let failure: AttemptFailureV4 = { present: true, value: error }
      if (previousActive !== null) {
        activePublication.current = null
        failure = attemptV4(failure, () => previousActive.onRegister(null))
      }
      failure = disposeResourcesV4(resources, failure)
      throw failure.value
    }

    let failure = NO_ATTEMPT_FAILURE_V4
    if (
      previousActive !== null
      && previousActive.onRegister !== onRegister
    ) {
      activePublication.current = null
      failure = attemptV4(failure, () => previousActive.onRegister(null))
    }
    failure = attemptV4(failure, () => onRegister(projected.registration))
    if (!failure.present) {
      try {
        activePublication.current = {
          resources,
          registration: projected.registration,
          onRegister,
        }
        setRenderState({ resources, ...projected })
      } catch (error) {
        failure = { present: true, value: error }
      }
    }
    if (failure.present) {
      if (activePublication.current?.resources === resources) {
        activePublication.current = null
      }
      failure = attemptV4(failure, () => onRegister(null))
      failure = disposeResourcesV4(resources, failure)
      throw failure.value
    }
  }, [
    objectRuntime,
    onRegister,
    project,
    resourceSignature,
    resources,
    effectiveTransforms,
    sceneRuntime,
    viewIsolation,
  ])

  if (renderState === null || renderState.resources.disposed) return null
  const overlayNowMs = livePresentationNowMs === 0 ? Date.now() : livePresentationNowMs
  return (
    <>
      {[...renderState.registration.roots].map(([entityId, root]) => {
        const selection = { kind: 'spatial-entity' as const, entityId }
        const interactionProps = interaction === undefined ? {} : {
          onPointerDown: (event: ThreeEvent<PointerEvent>) => {
            if (event.button === 0) {
              event.stopPropagation()
              interaction.onSelect(selection)
            } else if (event.button === 2) {
              event.stopPropagation()
              interaction.onContextCandidate(selection, event.pointerId)
            }
          },
        }
        return <primitive key={entityId} object={root} {...interactionProps} />
      })}
      {renderState.overlays.map(({ anchor, entityId, name, value }) => (
        <FragmentOverlayV4
          anchor={anchor}
          key={anchor.uuid}
          name={name}
          value={objectRuntime?.readEntityStatus(entityId, overlayNowMs)?.value ?? value}
        />
      ))}
      {selection?.kind === 'spatial-entity'
        ? (() => {
            const entity = project.spatialEntities.find(
              ({ id }) => id === selection.entityId,
            )
            const root = renderState.registration.roots.get(selection.entityId)
            const runtime = sceneRuntime.entities.get(selection.entityId)
            const parentWorldPose = entity === undefined
              ? undefined
              : effectiveTransforms.readFrameWorldPose(entity.parentFrameId)
            return entity?.transformOwner === 'manual'
              && root !== undefined
              && runtime?.kind === 'spatial-entity'
              && parentWorldPose !== undefined
              && onCommitLocalPose !== undefined
              ? (
                  <SpatialEntityTransformControlsV4
                    entityId={entity.id}
                    gizmoFrame={gizmoFrame}
                    key={entity.id}
                    object={root}
                    onCommitLocalPose={onCommitLocalPose}
                    onDraggingChange={onDraggingChange ?? (() => undefined)}
                    parentWorldPose={parentWorldPose}
                    persistedWorldPose={effectiveTransforms.readEntityWorldPose(entity.id)}
                  />
                )
              : null
          })()
        : null}
    </>
  )
}

function FragmentOverlayV4({
  anchor,
  name,
  value,
}: Pick<SpatialOverlayV4, 'anchor' | 'name' | 'value'>): ReactNode {
  return createPortal(
    <NumericStatusOverlayV4 name={name} value={value} />,
    anchor,
  )
}
