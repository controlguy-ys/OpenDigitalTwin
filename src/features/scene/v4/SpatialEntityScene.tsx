import { Html } from '@react-three/drei/web/Html.js'
import { createPortal, type ThreeEvent } from '@react-three/fiber'
import {
  useEffect,
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
  quaternionToMatrix3V4,
  relativeRigidTransformV4,
  type RigidTransformV4,
  type Vector3V4,
} from '../../../core/project-v4/rigid-transform'
import type {
  SceneGroupIdV4,
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
}

interface LocalBoundsV4 {
  readonly center: Vector3V4
  readonly halfExtents: Vector3V4
}

interface SpatialOverlayV4 {
  readonly anchor: Object3D
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

function projectRuntimeStateV4(
  resources: SpatialSceneResourcesV4,
  project: WorkcellProjectV4,
  sceneRuntime: SceneRuntimeProjectionV4,
  viewIsolation: SceneIsolationTargetV4 | null,
): Omit<SpatialRenderStateV4, 'resources'> {
  if (sceneRuntime.projectRevisionId !== project.revisionId) {
    throw new Error('Spatial Entity Scene runtime and Project revisions must match.')
  }
  const visibleRoots = new Map<SpatialEntityIdV4, Object3D>()
  const proxies: CollisionGeometryProxyV4[] = []
  const overlays: SpatialOverlayV4[] = []
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
    applyPoseV4(record.root, spatialRuntime.worldPose)
    const viewVisible = spatialRuntime.effectiveVisible
      && spatialEntityVisibleInIsolationV4(project, entity, viewIsolation)
    record.root.visible = viewVisible
    if (!spatialRuntime.effectiveVisible) continue

    visibleRoots.set(entity.id, record.root)
    const proxy = spatialEntityCollisionProxyV4({
      entity,
      worldPose: spatialRuntime.worldPose,
      effectiveVisible: true,
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
          spatialRuntime.worldPose,
          frame.worldPose,
        ))
      }
      overlays.push(Object.freeze({
        anchor: record.overlayAnchor,
        name: entity.name,
        value: spatialRuntime.numericStatus,
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
}: SpatialEntityScenePropsV4): ReactNode {
  const [resources, setResources] = useState<SpatialSceneResourcesV4 | null>(null)
  const [renderState, setRenderState] = useState<SpatialRenderStateV4 | null>(null)
  const activePublication = useRef<ActivePublicationV4 | null>(null)
  const resourceSignature = JSON.stringify(project.spatialEntities.map(
    ({ id, geometry }) => [id, geometry],
  ))

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
  }, [onRegister, project, resourceSignature, resources, sceneRuntime, viewIsolation])

  if (renderState === null || renderState.resources.disposed) return null
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
      {renderState.overlays.map(({ anchor, name, value }) => (
        <FragmentOverlayV4
          anchor={anchor}
          key={anchor.uuid}
          name={name}
          value={value}
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
              : sceneRuntime.globalFrames.get(entity.parentFrameId)?.worldPose
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
                    persistedWorldPose={runtime.worldPose}
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
}: SpatialOverlayV4): ReactNode {
  return createPortal(
    <NumericStatusOverlayV4 name={name} value={value} />,
    anchor,
  )
}
