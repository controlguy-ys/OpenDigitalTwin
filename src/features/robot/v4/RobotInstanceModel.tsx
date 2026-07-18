import { Html } from '@react-three/drei/web/Html.js'
import { createPortal, type ThreeEvent } from '@react-three/fiber'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
} from 'three'
import type {
  FrameIdV4,
  RobotDefinitionIdV4,
  RobotDefinitionV4,
  RobotIdV4,
  RobotInstanceV4,
  RobotLinkIdV4,
} from '../../../core/project-v4/types'
import type { RigidTransformV4 } from '../../../core/project-v4/rigid-transform'
import { encodeRuntimeIdentitySegmentV4 } from '../../../core/robot-runtime/collision-identity'
import {
  robotLinkCollisionProxiesV4,
  type CollisionGeometryProxyV4,
} from '../../collision/v4/scene-entity-adapter-v4.js'
import type { SceneRuntimeRobotEntityV4 } from '../../scene/v4/scene-runtime-selector'
import type { WorkcellInteractionHandlersV4 } from '../../scene/v4/scene-context-request.js'
import type {
  AcquiredRobotDefinitionGeometryV4,
  RobotDefinitionGeometryPublicationHandleV4,
  RobotDefinitionGeometryPublicationSnapshotV4,
  RobotDefinitionGeometryRepositoryV4,
} from './robot-definition-geometry-repository'

export interface RobotInstanceRegistrationV4 {
  readonly robotId: RobotIdV4
  readonly definitionId: RobotDefinitionIdV4
  readonly publicationHandle:
    RobotDefinitionGeometryPublicationHandleV4 | null
  readonly geometryState: 'RESOLVED' | 'UNRESOLVED'
  readonly root: Group
  readonly linkObjects: ReadonlyMap<RobotLinkIdV4, Object3D>
  readonly frameObjects: ReadonlyMap<FrameIdV4, Object3D>
  readonly collisionProxies: readonly CollisionGeometryProxyV4[]
}

export interface RobotInstanceModelPropsV4 {
  readonly robot: RobotInstanceV4
  readonly definition: RobotDefinitionV4
  readonly runtime: SceneRuntimeRobotEntityV4
  readonly geometryRepository: RobotDefinitionGeometryRepositoryV4
  readonly geometryPublication:
    RobotDefinitionGeometryPublicationSnapshotV4 | null
  readonly onRegister: (
    registration: RobotInstanceRegistrationV4 | null,
  ) => void
  readonly interaction?: WorkcellInteractionHandlersV4
  readonly viewVisible?: boolean
}

function applyPoseV4(object: Object3D, pose: RigidTransformV4): void {
  object.position.set(...pose.positionM)
  object.quaternion.set(...pose.quaternion)
}

function createEmptyLinkHierarchyV4(
  definition: RobotDefinitionV4,
  root: Group,
  encodedRobotId: string,
): Map<RobotLinkIdV4, Group> {
  const linkRoots = new Map(definition.links.map(({ id }) => {
    const linkRoot = new Group()
    linkRoot.name = `robot-link:${encodedRobotId}:${encodeRuntimeIdentitySegmentV4(id)}`
    return [id, linkRoot] as const
  }))
  const childIds = new Set(definition.joints.map(({ childLinkId }) => childLinkId))
  const rootLink = definition.links.find(({ id }) => !childIds.has(id))
  if (rootLink === undefined) throw new Error('Robot Definition has no root Link.')
  root.add(linkRoots.get(rootLink.id)!)
  for (const joint of definition.joints) {
    linkRoots.get(joint.parentLinkId)!.add(linkRoots.get(joint.childLinkId)!)
  }
  return linkRoots
}

function createFrameObjectsV4(
  definition: RobotDefinitionV4,
  linkObjects: ReadonlyMap<RobotLinkIdV4, Object3D>,
): Map<FrameIdV4, Object3D> {
  const frameObjects = new Map(definition.frames.map(({ id }) => {
    const frame = new Group()
    frame.name = `robot-frame:${encodeRuntimeIdentitySegmentV4(id)}`
    return [id, frame] as const
  }))
  for (const frame of definition.frames) {
    const parent = frame.parentFrameId === null
      ? undefined
      : linkObjects.get(frame.parentFrameId) ?? frameObjects.get(frame.parentFrameId)
    if (parent === undefined) {
      throw new Error(`Robot Frame ${frame.id} has no render parent.`)
    }
    const object = frameObjects.get(frame.id)!
    applyPoseV4(object, frame.localPose)
    parent.add(object)
  }
  return frameObjects
}

function createUnresolvedPlaceholderV4(root: Group): () => void {
  const geometry = new BoxGeometry(0.18, 0.18, 0.18)
  const material = new MeshBasicMaterial({
    color: '#f5c542',
    opacity: 0.45,
    transparent: true,
    wireframe: true,
  })
  const placeholder = new Mesh(geometry, material)
  placeholder.name = 'robot-geometry-unresolved'
  placeholder.userData = { geometryState: 'UNRESOLVED', badge: 'UNRESOLVED' }
  root.add(placeholder)
  return () => {
    root.remove(placeholder)
    geometry.dispose()
    material.dispose()
  }
}

function readonlyMapSnapshotRobotV4<K, V>(
  entries: Iterable<readonly [K, V]>,
): ReadonlyMap<K, V> {
  const backing = new Map(entries)
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
      callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
      thisArg?: unknown,
    ): void => {
      backing.forEach((value, key) => callback.call(thisArg, value, key, facade))
    },
    [Symbol.iterator]: (): MapIterator<[K, V]> => backing[Symbol.iterator](),
    [Symbol.toStringTag]: 'ReadonlyMap',
  })
  return facade
}

interface RobotInstanceBuildStateV4 {
  readonly root: Group
  readonly linkObjects: ReadonlyMap<RobotLinkIdV4, Object3D>
  readonly frameObjects: ReadonlyMap<FrameIdV4, Object3D>
  readonly publicationHandle: RobotDefinitionGeometryPublicationHandleV4 | null
  readonly geometryState: RobotInstanceRegistrationV4['geometryState']
  dispose(primaryFailure?: { readonly error: unknown }): void
}

function robotDefinitionRenderSignatureV4(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    return `[${value.map(robotDefinitionRenderSignatureV4).join(',')}]`
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${robotDefinitionRenderSignatureV4(record[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value)
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

export function RobotInstanceModelV4({
  robot,
  definition,
  runtime,
  geometryRepository,
  geometryPublication,
  onRegister,
  interaction,
  viewVisible = true,
}: RobotInstanceModelPropsV4): ReactNode {
  const [buildState, setBuildState] = useState<RobotInstanceBuildStateV4 | null>(null)
  const [registration, setRegistration] = useState<RobotInstanceRegistrationV4 | null>(null)
  const activeRegistration = useRef<RobotInstanceRegistrationV4 | null>(null)
  const onRegisterRef = useRef(onRegister)
  onRegisterRef.current = onRegister
  const definitionRef = useRef(definition)
  definitionRef.current = definition
  const definitionSignature = useMemo(
    () => robotDefinitionRenderSignatureV4(definition),
    [definition],
  )
  const publicationHandle = geometryPublication?.handle ?? null

  if (
    robot.definitionId !== definition.id
    || runtime.definitionId !== definition.id
    || runtime.entityId !== robot.id
    || (geometryPublication !== null && geometryPublication.definitionId !== definition.id)
  ) {
    throw new Error('Robot Instance, runtime, Definition, and Geometry identity must match.')
  }

  useEffect(() => {
    let lease: AcquiredRobotDefinitionGeometryV4 | null = null
    let root: Group | null = null
    let disposePlaceholder: () => void = () => undefined
    let nextBuild: RobotInstanceBuildStateV4 | null = null
    let disposed = false

    const dispose = (primaryFailure?: { readonly error: unknown }): void => {
      if (disposed) {
        if (primaryFailure !== undefined) throw primaryFailure.error
        return
      }
      disposed = true
      let failure = primaryFailure
      const attempt = (action: () => void): void => {
        try {
          action()
        } catch (error) {
          failure ??= { error }
        }
      }
      const active = activeRegistration.current
      if (root !== null && active?.root === root) {
        activeRegistration.current = null
        attempt(() => onRegisterRef.current(null))
      }
      attempt(disposePlaceholder)
      attempt(() => lease?.release())
      if (nextBuild !== null) {
        setBuildState((current) => current === nextBuild ? null : current)
      }
      if (root !== null) {
        setRegistration((current) => current?.root === root ? null : current)
      }
      if (failure !== undefined) throw failure.error
    }

    try {
      const buildDefinition = definitionRef.current
      const encodedRobotId = encodeRuntimeIdentitySegmentV4(robot.id)
      lease = publicationHandle === null
        ? null
        : geometryRepository.acquire(
            buildDefinition.id,
            robot.id,
            publicationHandle,
          )
      root = lease?.instanceRoot ?? new Group()
      if (lease === null) root.name = `robot:${encodedRobotId}`
      const linkRoots = lease === null
        ? createEmptyLinkHierarchyV4(buildDefinition, root, encodedRobotId)
        : new Map(lease.linkRoots)
      const frameObjects = createFrameObjectsV4(buildDefinition, linkRoots)
      disposePlaceholder = lease === null
        ? createUnresolvedPlaceholderV4(root)
        : () => undefined
      nextBuild = {
        root,
        linkObjects: readonlyMapSnapshotRobotV4(linkRoots),
        frameObjects: readonlyMapSnapshotRobotV4(frameObjects),
        publicationHandle: lease?.publicationHandle ?? null,
        geometryState: lease === null ? 'UNRESOLVED' : 'RESOLVED',
        dispose,
      }
      setBuildState(nextBuild)
    } catch (error) {
      dispose({ error })
    }

    return dispose
  }, [
    definitionSignature,
    geometryRepository,
    publicationHandle,
    robot.definitionId,
    robot.id,
  ])

  useEffect(() => {
    if (buildState === null) return
    try {
      applyPoseV4(buildState.root, runtime.worldBasePose)
      buildState.root.visible = runtime.effectiveVisible && viewVisible
      for (const link of definition.links) {
        const pose = runtime.serialPose.linkLocalPoses[link.id]
        const linkObject = buildState.linkObjects.get(link.id)
        if (pose === undefined || linkObject === undefined) {
          throw new Error(`Robot Link ${link.id} has no runtime render pose.`)
        }
        applyPoseV4(linkObject, pose)
      }
      const collisionProxies = robotLinkCollisionProxiesV4({
        robotId: robot.id,
        definition,
        linkWorldPoses: runtime.serialPose.linkWorldPoses,
        effectiveVisible: runtime.effectiveVisible,
      })
      const nextRegistration = Object.freeze({
        robotId: robot.id,
        definitionId: definition.id,
        publicationHandle: buildState.publicationHandle,
        geometryState: buildState.geometryState,
        root: buildState.root,
        linkObjects: buildState.linkObjects,
        frameObjects: buildState.frameObjects,
        collisionProxies,
      })
      activeRegistration.current = nextRegistration
      setRegistration(nextRegistration)
      try {
        onRegisterRef.current(nextRegistration)
      } catch (error) {
        buildState.dispose({ error })
      }
    } catch (error) {
      buildState.dispose({ error })
    }
  }, [buildState, definition, robot.id, runtime, viewVisible])

  if (registration === null) return null
  const overlayFrameId = robot.numericStatus.overlay.frameId
    ?? runtime.selectedTcpFrameId
  const overlayAnchor = registration.frameObjects.get(overlayFrameId)

  const selectionForHit = (hit: Object3D | undefined) => {
    let current = hit
    while (current !== undefined && current !== null) {
      for (const [linkId, linkObject] of registration.linkObjects) {
        if (linkObject === current) {
          return { kind: 'robot-link' as const, robotId: robot.id, linkId }
        }
      }
      if (current === registration.root) break
      current = current.parent ?? undefined
    }
    return { kind: 'robot' as const, robotId: robot.id }
  }
  const hitFromEvent = (
    event: ThreeEvent<PointerEvent | MouseEvent>,
  ): Object3D | undefined => event.object ?? (
    event.nativeEvent as Event & { readonly object?: Object3D }
  ).object
  const interactionProps = interaction === undefined ? {} : {
    onPointerDown: (event: ThreeEvent<PointerEvent>) => {
      const selection = selectionForHit(hitFromEvent(event))
      if (event.button === 0) {
        event.stopPropagation()
        interaction.onSelect(selection)
      } else if (event.button === 2) {
        event.stopPropagation()
        interaction.onContextCandidate(selection, event.pointerId)
      }
    },
  }

  return (
    <>
      <primitive object={registration.root} {...interactionProps} />
      {viewVisible && robot.numericStatus.overlay.visible && overlayAnchor !== undefined
        ? createPortal(
            <NumericStatusOverlayV4
              name={robot.name}
              value={runtime.numericStatus}
            />,
            overlayAnchor,
          )
        : null}
    </>
  )
}
