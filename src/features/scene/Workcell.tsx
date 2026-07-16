import { OrbitControls } from '@react-three/drei/core/OrbitControls.js'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentRef,
  type ReactNode,
} from 'react'
import { createPortal, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import {
  Box3,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Vector3,
  type Group,
  type Object3D,
} from 'three'
import { useStore } from 'zustand'
import { CurrentPoseCollisionSystem } from '../collision/CurrentPoseCollisionSystem'
import { EquipmentScene } from '../equipment/EquipmentScene'
import { getExternalEntityOutlineState } from '../interaction/outline-state'
import {
  GraspController,
  type InteractionRuntimeController,
} from '../interaction/GraspController'
import type { RobotRigRegistration } from '../robot/RobotModel'
import { RobotModel } from '../robot/RobotModel'
import {
  WORKBENCH_TOP_THICKNESS,
  WORKBENCH_TOP_Z,
} from './workcell-constants'
import { useCoordinateFrameStore } from '../frames/coordinate-frame-store'
import { registerGeometryEntity } from '../collision/geometry-entity-registry'
import { workbenchToGeometryEntity } from '../collision/scene-entity-adapter'
import {
  useInteractionStore,
  type ExternalCollisionEntityId,
} from '../interaction/interaction-store'
import {
  createCollisionEntityOutlineSelector,
  useCollisionStore,
} from '../collision/collision-store'
import {
  usePublishedSceneRuntime,
  type SceneRuntimeEntityV1,
  type SceneRuntimeProjectionV1,
} from './scene-runtime-selector'
import type { SceneEntityContextHandler } from './scene-context-request'
import {
  applySceneRuntimeWorldMatrix,
  LinearAxisRuntime,
} from './LinearAxisRuntime'
import type {
  CommittedLinearAxisSourceV1,
  LinearAxisCommittedStateV1,
} from './linear-axis-source'
import type { SceneEntityIdV1 } from '../../domain/project/scene-state-v1'
import {
  createViewportCameraActions,
  captureViewportCameraState,
  restoreViewportCameraState,
  type ViewportCameraActions,
  type StandardWorldView,
} from '../viewport/camera-actions'
import { TcpFrameMarker } from '../viewport/TcpFrameMarker'
import {
  useViewportPreferenceStore,
  viewportPreferenceStore,
} from '../viewport/viewport-preference-store'
import { sceneEditorStore } from '../project/project-store-browser'
import type { CoordinateFrameMatrices } from '../viewport/coordinate-pose-readout'
import type { ViewportCameraState } from '../viewport/viewport-preference-store'
import { failProjectV4 } from '../../core/project-v4/errors'
import {
  BOX_PRIMITIVE_TRIANGLES_V4,
  CYLINDER_PRIMITIVE_TRIANGLES_V4,
  MAX_VISIBLE_SCENE_TRIANGLES_V4,
} from '../../core/project-v4/limits'
import type {
  RobotDefinitionIdV4,
  RobotDefinitionV4,
  RobotIdV4,
  SpatialEntityIdV4,
  WorkcellProjectV4,
} from '../../core/project-v4/types'
import type { CollisionGeometryProxyV4 } from '../collision/scene-entity-adapter'
import {
  RobotFleetV4,
  type RobotFleetRegistrationV4,
} from '../robot/v4/RobotFleet'
import type { RobotInstanceRegistrationV4 } from '../robot/v4/RobotInstanceModel'
import type {
  RobotDefinitionGeometryPublicationSnapshotV4,
  RobotDefinitionGeometryRepositoryV4,
} from '../robot/v4/robot-definition-geometry-repository'
import {
  SpatialEntitySceneV4,
  type SpatialEntitySceneRegistrationV4,
} from './v4/SpatialEntityScene'
import type { SceneRuntimeProjectionV4 } from './v4/scene-runtime-selector'

export { WORKBENCH_TOP_Z } from './workcell-constants'

interface WorkcellProps {
  registerRig: (registration: RobotRigRegistration | null) => void
  onEntityContextMenu?: SceneEntityContextHandler
  registerInteractionController?:
    | ((controller: InteractionRuntimeController | null) => void)
    | undefined
  linearAxisSource?: CommittedLinearAxisSourceV1 | null
  linearAxisCommittedState?: LinearAxisCommittedStateV1 | null
  registerViewportController?: (controller: ViewportRuntimeController | null) => void
  registerCoordinateFrameMatrices?: (matrices: CoordinateFrameMatrices | null) => void
}

export interface ViewportRuntimeController {
  readonly actions: {
    home(): void
    fitAll(): void
    focusSelection(): void
    setStandardView(view: StandardWorldView): void
  }
  readonly canFocusSelection: boolean
  readonly robotRevision: number
  readCameraState(): ViewportCameraState
}

const WORKBENCH_LEGS = [
  [-0.78, -0.48],
  [-0.78, 0.48],
  [0.78, -0.48],
  [0.78, 0.48],
] as const

const selectWorkbenchCollisionOutline =
  createCollisionEntityOutlineSelector('workcell:workbench')

export function workcellRenderEntities(runtime: SceneRuntimeProjectionV1) {
  return runtime.entities.filter(({ effectiveVisible }) => effectiveVisible)
}

export function workcellLinearAxisBindings(
  runtime: SceneRuntimeProjectionV1,
  objectRoots: ReadonlyMap<string, Object3D>,
  robotRoot: Object3D | null,
  source: CommittedLinearAxisSourceV1 | null,
  committedState: LinearAxisCommittedStateV1 | null,
) {
  return { runtime, objectRoots, robotRoot, source, committedState }
}

function addObjectBounds(bounds: Box3, object: Object3D | null | undefined): void {
  if (object === null || object === undefined || !object.visible) return
  object.updateWorldMatrix(true, true)
  const candidate = new Box3().setFromObject(object)
  if (!candidate.isEmpty()) bounds.union(candidate)
}

function runtimeDescendsFrom(
  runtime: SceneRuntimeProjectionV1,
  entityId: string,
  ancestorId: string,
): boolean {
  let parentId = runtime.byId.get(entityId as SceneEntityIdV1)?.parentId ?? null
  while (parentId !== null) {
    if (parentId === ancestorId) return true
    parentId = runtime.byId.get(parentId)?.parentId ?? null
  }
  return false
}

function fitAllBounds(
  runtime: SceneRuntimeProjectionV1,
  objectRoots: ReadonlyMap<string, Object3D>,
  robotRoot: Object3D | null,
  scene: Object3D,
): Box3 {
  const bounds = new Box3()
  if (runtime.robot?.effectiveVisible) addObjectBounds(bounds, robotRoot)
  for (const entity of runtime.objects) {
    if (entity.effectiveVisible) addObjectBounds(bounds, objectRoots.get(entity.entityId))
  }
  if (runtime.linearAxis?.effectiveVisible) {
    addObjectBounds(bounds, scene.getObjectByName('linear-axis:active'))
  }
  if (runtime.workbench?.effectiveVisible) {
    addObjectBounds(bounds, scene.getObjectByName('workcell:workbench'))
  }
  return bounds
}

function selectedBounds(
  runtime: SceneRuntimeProjectionV1,
  selectedEntityId: string | null,
  objectRoots: ReadonlyMap<string, Object3D>,
  robotRoot: Object3D | null,
  scene: Object3D,
): Box3 {
  const bounds = new Box3()
  if (selectedEntityId === null) return bounds
  const selected = runtime.byId.get(selectedEntityId as SceneEntityIdV1)
  if (selected === undefined || !selected.effectiveVisible) return bounds
  if (selected.kind === 'robot') addObjectBounds(bounds, robotRoot)
  else if (selected.kind === 'environment') {
    addObjectBounds(bounds, scene.getObjectByName('workcell:workbench'))
  }
  else if (selected.kind === 'linear-axis') {
    addObjectBounds(bounds, scene.getObjectByName('linear-axis:active'))
  } else if (selected.kind === 'object') {
    addObjectBounds(bounds, objectRoots.get(selected.entityId))
  } else if (selected.kind === 'group') {
    for (const entity of runtime.objects) {
      if (entity.effectiveVisible && runtimeDescendsFrom(runtime, entity.entityId, selected.entityId)) {
        addObjectBounds(bounds, objectRoots.get(entity.entityId))
      }
    }
  }
  return bounds
}

function hasVisibleRenderableGeometry(root: Object3D | null | undefined): boolean {
  if (root === null || root === undefined) return false
  let found = false
  const visit = (object: Object3D, ancestorsVisible: boolean): void => {
    if (found || !ancestorsVisible || !object.visible) return
    const geometry = (object as Object3D & {
      geometry?: { getAttribute?(name: string): { count: number } | undefined }
    }).geometry
    if ((geometry?.getAttribute?.('position')?.count ?? 0) > 0) {
      found = true
      return
    }
    for (const child of object.children) visit(child, true)
  }
  visit(root, true)
  return found
}

function hasFocusCandidate(
  runtime: SceneRuntimeProjectionV1,
  selectedEntityId: string | null,
  objectRoots: ReadonlyMap<string, Object3D>,
  robotRoot: Object3D | null,
  scene: Object3D,
): boolean {
  if (selectedEntityId === null) return false
  const selected = runtime.byId.get(selectedEntityId as SceneEntityIdV1)
  if (selected === undefined || !selected.effectiveVisible) return false
  if (selected.kind === 'robot') return hasVisibleRenderableGeometry(robotRoot)
  if (selected.kind === 'environment') {
    return hasVisibleRenderableGeometry(scene.getObjectByName('workcell:workbench'))
  }
  if (selected.kind === 'linear-axis') {
    return hasVisibleRenderableGeometry(scene.getObjectByName('linear-axis:active'))
  }
  if (selected.kind === 'object') {
    return hasVisibleRenderableGeometry(objectRoots.get(selected.entityId))
  }
  return runtime.objects.some((entity) => entity.effectiveVisible &&
    runtimeDescendsFrom(runtime, entity.entityId, selected.entityId) &&
    hasVisibleRenderableGeometry(objectRoots.get(entity.entityId)))
}

export interface ViewportBoundResolvers {
  readonly canFocusSelection: boolean
  fitAllBounds(): Box3
  focusSelectionBounds(): Box3
}

export function createViewportBoundResolvers(
  runtime: SceneRuntimeProjectionV1,
  selectedEntityId: string | null,
  objectRoots: ReadonlyMap<string, Object3D>,
  robotRoot: Object3D | null,
  scene: Object3D,
): ViewportBoundResolvers {
  return {
    get canFocusSelection() {
      return hasFocusCandidate(
        runtime, selectedEntityId, objectRoots, robotRoot, scene,
      )
    },
    fitAllBounds: () => fitAllBounds(runtime, objectRoots, robotRoot, scene),
    focusSelectionBounds: () => selectedBounds(
      runtime, selectedEntityId, objectRoots, robotRoot, scene,
    ),
  }
}

interface ViewportRuntimeProps {
  readonly enabled: boolean
  readonly runtime: SceneRuntimeProjectionV1
  readonly objectRoots: ReadonlyMap<string, Object3D>
  readonly robotRoot: Object3D | null
  readonly mcpRoot: Object3D | null
  readonly tcpFrame: Object3D | null
  readonly registerController?: (controller: ViewportRuntimeController | null) => void
  readonly registerCoordinateFrameMatrices?: (matrices: CoordinateFrameMatrices | null) => void
}

function ViewportRuntime({
  enabled,
  runtime,
  objectRoots,
  robotRoot,
  mcpRoot,
  tcpFrame,
  registerController,
  registerCoordinateFrameMatrices,
}: ViewportRuntimeProps) {
  const camera = useThree((state) => state.camera)
  const scene = useThree((state) => state.scene)
  const [controls, setControls] = useState<ComponentRef<typeof OrbitControls> | null>(null)
  const registerOrbitControls = useCallback(
    (instance: ComponentRef<typeof OrbitControls> | null) => setControls(instance),
    [],
  )
  const selectedEntityId = useStore(sceneEditorStore, (state) => state.selectedEntityId)
  const storedTarget = viewportPreferenceStore.getState().cameraState.target
  const cameraActions = useMemo<ViewportCameraActions | null>(() => {
    if (!(camera instanceof PerspectiveCamera) || controls === null) return null
    return createViewportCameraActions(camera, controls)
  }, [camera, controls])
  const boundResolvers = useMemo(
    () => createViewportBoundResolvers(
      runtime, selectedEntityId, objectRoots, robotRoot, scene,
    ),
    [objectRoots, robotRoot, runtime, scene, selectedEntityId],
  )
  const focusReadinessRef = useRef({ entityId: null as string | null, ready: false })
  const focusProbeFrameRef = useRef(0)
  const [focusReadiness, setFocusReadiness] = useState(focusReadinessRef.current)
  const measureFocusReadiness = useCallback(() => {
    const eligible = boundResolvers.canFocusSelection
    const current = focusReadinessRef.current
    if (current.entityId === selectedEntityId && current.ready && eligible) return
    const next = {
      entityId: selectedEntityId,
      ready: eligible && !boundResolvers.focusSelectionBounds().isEmpty(),
    }
    if (current.entityId === next.entityId && current.ready === next.ready) return
    focusReadinessRef.current = next
    setFocusReadiness(next)
  }, [boundResolvers, selectedEntityId])
  const canFocusSelection = focusReadiness.entityId === selectedEntityId && focusReadiness.ready
  const restoredCameraRef = useRef(false)
  const coordinateRevisionRef = useRef('')

  useLayoutEffect(measureFocusReadiness, [measureFocusReadiness])

  useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || controls === null || restoredCameraRef.current) return
    restoreViewportCameraState(camera, controls, viewportPreferenceStore.getState().cameraState)
    restoredCameraRef.current = true
  }, [camera, controls])

  useFrame(() => {
    if (selectedEntityId !== null) {
      focusProbeFrameRef.current = (focusProbeFrameRef.current + 1) % 10
      if (focusProbeFrameRef.current === 0) measureFocusReadiness()
    }
    if (mcpRoot === null || robotRoot === null || tcpFrame === null) return
    mcpRoot.updateWorldMatrix(true, false)
    robotRoot.updateWorldMatrix(true, false)
    tcpFrame.updateWorldMatrix(true, false)
    const matrices: CoordinateFrameMatrices = {
      world: new Matrix4().identity().elements,
      mcp: [...mcpRoot.matrixWorld.elements],
      base: [...robotRoot.matrixWorld.elements],
      tcp: [...tcpFrame.matrixWorld.elements],
    }
    const revision = [...matrices.mcp, ...matrices.base, ...matrices.tcp].join('|')
    if (revision === coordinateRevisionRef.current) return
    coordinateRevisionRef.current = revision
    registerCoordinateFrameMatrices?.(matrices)
  })

  useEffect(
    () => () => registerCoordinateFrameMatrices?.(null),
    [registerCoordinateFrameMatrices],
  )

  useEffect(() => {
    if (cameraActions === null || controls === null || !(camera instanceof PerspectiveCamera)) return
    const perspectiveCamera = camera
    const controller: ViewportRuntimeController = {
      actions: {
        home: cameraActions.home,
        fitAll: () => cameraActions.fitAll(boundResolvers.fitAllBounds()),
        focusSelection: () => {
          const bounds = boundResolvers.focusSelectionBounds()
          if (!bounds.isEmpty()) cameraActions.focusSelection(bounds)
        },
        setStandardView: cameraActions.setStandardView,
      },
      canFocusSelection,
      robotRevision: 0,
      readCameraState: () => captureViewportCameraState(perspectiveCamera, controls),
    }
    registerController?.(controller)
    return () => registerController?.(null)
  }, [
    cameraActions,
    camera,
    canFocusSelection,
    controls,
    boundResolvers,
    objectRoots,
    registerController,
    robotRoot,
    runtime,
    scene,
    selectedEntityId,
  ])

  return (
    <OrbitControls
      enableDamping
      enabled={enabled}
      makeDefault
      maxDistance={5}
      minDistance={0.8}
      onChange={() => {
        if (!(camera instanceof PerspectiveCamera) || controls === null) return
        viewportPreferenceStore.getState().setCameraState(
          captureViewportCameraState(camera, controls),
        )
      }}
      ref={registerOrbitControls}
      target={storedTarget}
    />
  )
}

export function workbenchDropSurfaceZ(
  runtime: SceneRuntimeProjectionV1,
  mcp: Readonly<{
    position: readonly [number, number, number]
    quaternion: readonly [number, number, number, number]
    scale: readonly [number, number, number]
  }> = {
    position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1],
  },
): number {
  const workbench = runtime.workbench
  if (workbench === null || !workbench.effectiveVisible) return 0
  const mcpMatrix = new Matrix4().compose(
    new Vector3(...mcp.position),
    new Quaternion(...mcp.quaternion),
    new Vector3(...mcp.scale),
  )
  const workbenchMatrix = new Matrix4().fromArray(workbench.worldMatrix as number[])
  return new Vector3(0, 0, WORKBENCH_TOP_Z)
    .applyMatrix4(mcpMatrix.multiply(workbenchMatrix)).z
}

function Workbench({
  entity,
  onEntityContextMenu,
}: Readonly<{
  entity: SceneRuntimeEntityV1
  onEntityContextMenu?: SceneEntityContextHandler
}>) {
  const objectRef = useRef<Group>(null)
  const collisionOutline = useCollisionStore(selectWorkbenchCollisionOutline)
  const outlineState =
    collisionOutline ??
    getExternalEntityOutlineState('workcell:workbench', false, [])
  const collision = outlineState === 'collision'
  const nearMiss = outlineState === 'near-miss'

  useLayoutEffect(() => {
    const object = objectRef.current
    if (object === null) return
    applySceneRuntimeWorldMatrix(object, entity)
    if (!entity.effectiveVisible) return
    return registerGeometryEntity(workbenchToGeometryEntity(object, 0, entity.name))
  }, [entity])

  const selectWorkbench = () => {
    sceneEditorStore.getState().select(entity.entityId)
    useInteractionStore.getState().clearSelection()
  }

  return (
    <group
      name="workcell:workbench"
      onContextMenu={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation()
        event.nativeEvent.preventDefault()
        selectWorkbench()
        onEntityContextMenu?.(entity.entityId, {
          x: event.nativeEvent.clientX,
          y: event.nativeEvent.clientY,
        })
      }}
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation()
        selectWorkbench()
      }}
      ref={objectRef}
      userData={{ collisionEntityId: entity.entityId }}
      visible={entity.effectiveVisible}
    >
      <mesh
        castShadow
        name="workbench-top"
        position={[0, 0, WORKBENCH_TOP_Z - WORKBENCH_TOP_THICKNESS / 2]}
        receiveShadow
      >
        <boxGeometry args={[1.8, 1.2, WORKBENCH_TOP_THICKNESS]} />
        <meshStandardMaterial color="#6f767c" metalness={0.8} roughness={0.34} />
      </mesh>
      {collision || nearMiss ? (
        <mesh
          name={`workbench-${outlineState}-outline`}
          position={[0, 0, WORKBENCH_TOP_Z - WORKBENCH_TOP_THICKNESS / 2]}
          renderOrder={1000}
          userData={{ outline: outlineState, workcellId: 'workbench' }}
        >
          <boxGeometry
            args={[
              1.8 * 1.01,
              1.2 * 1.01,
              WORKBENCH_TOP_THICKNESS * 1.04,
            ]}
          />
          <meshBasicMaterial
            color={collision ? '#ff3b30' : '#f5c542'}
            depthTest={false}
            opacity={0.86}
            transparent
            wireframe
          />
        </mesh>
      ) : null}
      {WORKBENCH_LEGS.map(([x, y]) => (
        <mesh
          castShadow
          key={`${x}-${y}`}
          position={[x, y, 0.49]}
          receiveShadow
        >
          <boxGeometry args={[0.09, 0.09, 0.98]} />
          <meshStandardMaterial color="#252b30" metalness={0.72} roughness={0.38} />
        </mesh>
      ))}
    </group>
  )
}

export function Workcell({
  registerRig,
  registerInteractionController,
  onEntityContextMenu,
  linearAxisSource = null,
  linearAxisCommittedState = null,
  registerViewportController,
  registerCoordinateFrameMatrices,
}: WorkcellProps) {
  const sceneRuntime = usePublishedSceneRuntime()
  const renderEntities = workcellRenderEntities(sceneRuntime)
  const [rig, setRig] = useState<RobotRigRegistration | null>(null)
  const [orbitEnabled, setOrbitEnabled] = useState(true)
  const mcp = useCoordinateFrameStore((state) => state.frames.mcp)
  const mcpObjectRef = useRef<Group>(null)
  const showGrid = useViewportPreferenceStore((state) => state.layers.grid)
  const showWorldFrame = useViewportPreferenceStore((state) => state.layers.worldFrame)
  const showBaseFrame = useViewportPreferenceStore((state) => state.layers.baseFrame)
  const showTcpFrame = useViewportPreferenceStore((state) => state.layers.tcpFrame)
  const equipmentObjectsRef = useRef(
    new Map<ExternalCollisionEntityId, Object3D>(),
  )
  const handleRigRegistration = useCallback(
    (registration: RobotRigRegistration | null) => {
      setRig(registration)
      registerRig(registration)
    },
    [registerRig],
  )
  const handleEquipmentDraggingChange = useCallback((dragging: boolean) => {
    setOrbitEnabled(!dragging)
  }, [])

  return (
    <>
      <ambientLight intensity={0.68} />
      <directionalLight
        castShadow
        intensity={1.8}
        position={[3.2, -2.4, 5]}
        shadow-mapSize-height={2048}
        shadow-mapSize-width={2048}
      />
      <mesh name="workcell-floor" position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[6, 6]} />
        <meshStandardMaterial color="#121a21" metalness={0.18} roughness={0.9} />
      </mesh>
      <gridHelper
        args={[6, 60, '#344754', '#1d2a33']}
        name="workcell-grid"
        position={[0, 0, 0.002]}
        rotation={[Math.PI / 2, 0, 0]}
        visible={showGrid}
      />
      <TcpFrameMarker frameName="World" name="world" visible={showWorldFrame} />
      <group
        name="mcp-frame"
        position={mcp.position}
        quaternion={mcp.quaternion}
        ref={mcpObjectRef}
      >
        {sceneRuntime.workbench === null ? null : (
          <Workbench
            entity={sceneRuntime.workbench}
            {...(onEntityContextMenu === undefined
              ? {}
              : { onEntityContextMenu })}
          />
        )}
        <EquipmentScene
          equipmentObjectsRef={equipmentObjectsRef}
          onDraggingChange={handleEquipmentDraggingChange}
          {...(onEntityContextMenu === undefined
            ? {}
            : { onEntityContextMenu })}
          sceneRuntime={{ ...sceneRuntime, entities: renderEntities }}
        />
        <RobotModel
          {...(onEntityContextMenu === undefined
            ? {}
            : {
                onEntityContextMenu: (_entityId, position) =>
                  onEntityContextMenu('robot:active', position),
              })}
          registerRig={handleRigRegistration}
          sceneEntity={sceneRuntime.robot}
        />
        <LinearAxisRuntime {...workcellLinearAxisBindings(
          sceneRuntime,
          equipmentObjectsRef.current,
          rig?.rig.root ?? null,
          linearAxisSource,
          linearAxisCommittedState,
        )} />
      </group>
      <CurrentPoseCollisionSystem />
      {rig === null ? null : (
        <>
          {createPortal(
            <TcpFrameMarker frameName="Robot Base" name="robot-base" visible={showBaseFrame} />,
            rig.rig.root,
          )}
          {createPortal(
            <TcpFrameMarker frameName="Actual TCP" name="actual-tcp" visible={showTcpFrame} />,
            rig.tcpFrame,
          )}
          <GraspController
            equipmentObjectsRef={equipmentObjectsRef}
            {...(onEntityContextMenu === undefined
              ? {}
              : { onEntityContextMenu })}
            registerController={registerInteractionController}
            rig={rig}
            workbenchTopZ={workbenchDropSurfaceZ(sceneRuntime, mcp)}
          />
        </>
      )}
      <ViewportRuntime
        enabled={orbitEnabled}
        objectRoots={equipmentObjectsRef.current}
        mcpRoot={mcpObjectRef.current}
        {...(registerViewportController === undefined
          ? {}
          : { registerController: registerViewportController })}
        robotRoot={rig?.rig.root ?? null}
        runtime={sceneRuntime}
        tcpFrame={rig?.tcpFrame ?? null}
        {...(registerCoordinateFrameMatrices === undefined
          ? {}
          : { registerCoordinateFrameMatrices })}
      />
    </>
  )
}

export interface WorkcellRegistrationV4 {
  readonly robots: ReadonlyMap<RobotIdV4, RobotInstanceRegistrationV4>
  readonly spatialEntities: ReadonlyMap<SpatialEntityIdV4, Object3D>
  readonly collisionProxies: readonly CollisionGeometryProxyV4[]
}

export interface WorkcellPropsV4 {
  readonly project: WorkcellProjectV4
  readonly sceneRuntime: SceneRuntimeProjectionV4
  readonly geometryRepository: RobotDefinitionGeometryRepositoryV4
  readonly onRegister: (registration: WorkcellRegistrationV4 | null) => void
}

interface WorkcellChildRegistrationV4<T> {
  readonly projectRevisionId: string
  readonly value: T
}

function readonlyMapSnapshotWorkcellV4<K, V>(
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

function declaredDefinitionTriangleCountV4(
  definition: RobotDefinitionV4,
): number {
  const excluded = new Set(definition.excludedGeometryOccurrenceKeys)
  return definition.links.reduce((definitionTotal, link) => (
    definitionTotal + link.geometryOccurrences.reduce((linkTotal, occurrence) => (
      linkTotal + (excluded.has(occurrence.occurrenceKey)
        ? 0
        : occurrence.statistics.triangles)
    ), 0)
  ), 0)
}

export function assertPreparedVisibleSceneTriangleBudgetV4(
  project: WorkcellProjectV4,
  sceneRuntime: SceneRuntimeProjectionV4,
  geometryPublications: ReadonlyMap<
    RobotDefinitionIdV4,
    RobotDefinitionGeometryPublicationSnapshotV4
  >,
): number {
  const definitionsById = new Map(
    project.robotDefinitions.map((definition) => [definition.id, definition]),
  )
  const visibleRobotIds = new Set(sceneRuntime.visibleRobotIds)
  const visibleSpatialEntityIds = new Set(sceneRuntime.visibleSpatialEntityIds)
  let triangles = 0

  for (const robot of project.robots) {
    if (!visibleRobotIds.has(robot.id)) continue
    const definition = definitionsById.get(robot.definitionId)
    if (definition === undefined) {
      throw new Error(`Robot ${robot.id} has no V4 Definition.`)
    }
    triangles += geometryPublications.get(definition.id)?.triangleCount
      ?? declaredDefinitionTriangleCountV4(definition)
  }
  for (const entity of project.spatialEntities) {
    if (!visibleSpatialEntityIds.has(entity.id)) continue
    triangles += entity.geometry.kind === 'asset'
      ? entity.geometry.statistics.triangles
      : entity.geometry.kind === 'box'
        ? BOX_PRIMITIVE_TRIANGLES_V4
        : CYLINDER_PRIMITIVE_TRIANGLES_V4
  }
  if (triangles > MAX_VISIBLE_SCENE_TRIANGLES_V4) {
    failProjectV4(
      'VISIBLE_SCENE_TRIANGLE_LIMIT_EXCEEDED',
      '$.scene',
      'Visible prepared Scene triangle budget is exceeded.',
    )
  }
  return triangles
}

export function WorkcellV4({
  project,
  sceneRuntime,
  geometryRepository,
  onRegister,
}: WorkcellPropsV4): ReactNode {
  const repositoryVersion = useSyncExternalStore(
    geometryRepository.subscribe,
    geometryRepository.getSnapshot,
    geometryRepository.getSnapshot,
  )
  const geometryPublications = useMemo(() => readonlyMapSnapshotWorkcellV4(
    project.robotDefinitions.flatMap((definition) => {
      const publication = geometryRepository.readCurrent(definition.id)
      return publication === null
        ? []
        : [[definition.id, publication] as const]
    }),
  ), [geometryRepository, project.robotDefinitions, repositoryVersion])
  assertPreparedVisibleSceneTriangleBudgetV4(
    project,
    sceneRuntime,
    geometryPublications,
  )

  const [fleetRegistration, setFleetRegistration] = useState<
    WorkcellChildRegistrationV4<RobotFleetRegistrationV4> | null
  >(null)
  const [spatialRegistration, setSpatialRegistration] = useState<
    WorkcellChildRegistrationV4<SpatialEntitySceneRegistrationV4> | null
  >(null)
  const activeRegistration = useRef<WorkcellRegistrationV4 | null>(null)
  const onRegisterRef = useRef(onRegister)
  onRegisterRef.current = onRegister
  const projectRevisionRef = useRef(sceneRuntime.projectRevisionId)
  projectRevisionRef.current = sceneRuntime.projectRevisionId
  const visibleRobotIdSignature = JSON.stringify(sceneRuntime.visibleRobotIds)
  const visibleSpatialIdSignature = JSON.stringify(sceneRuntime.visibleSpatialEntityIds)
  const handleFleetRegistration = useCallback((value: RobotFleetRegistrationV4 | null) => {
    setFleetRegistration(value === null ? null : {
      projectRevisionId: projectRevisionRef.current,
      value,
    })
  }, [])
  const handleSpatialRegistration = useCallback((
    value: SpatialEntitySceneRegistrationV4 | null,
  ) => {
    setSpatialRegistration(value === null ? null : {
      projectRevisionId: projectRevisionRef.current,
      value,
    })
  }, [])

  useEffect(() => {
    const ready = (
      fleetRegistration === null
      || spatialRegistration === null
      || fleetRegistration.projectRevisionId !== sceneRuntime.projectRevisionId
      || spatialRegistration.projectRevisionId !== sceneRuntime.projectRevisionId
      || [...fleetRegistration.value.robots.keys()].some((id, index) => (
        sceneRuntime.visibleRobotIds[index] !== id
      ))
      || fleetRegistration.value.robots.size !== sceneRuntime.visibleRobotIds.length
      || [...spatialRegistration.value.roots.keys()].some((id, index) => (
        sceneRuntime.visibleSpatialEntityIds[index] !== id
      ))
      || spatialRegistration.value.roots.size !== sceneRuntime.visibleSpatialEntityIds.length
    ) === false
    if (!ready) {
      if (activeRegistration.current !== null) {
        activeRegistration.current = null
        onRegisterRef.current(null)
      }
      return
    }
    const robots = readonlyMapSnapshotWorkcellV4(fleetRegistration.value.robots)
    const spatialEntities = readonlyMapSnapshotWorkcellV4(spatialRegistration.value.roots)
    const collisionProxies = Object.freeze([
      ...[...robots.values()].flatMap((registration) => registration.collisionProxies),
      ...spatialRegistration.value.collisionProxies,
    ])
    const registration = Object.freeze({ robots, spatialEntities, collisionProxies })
    activeRegistration.current = registration
    try {
      onRegisterRef.current(registration)
    } catch (error) {
      activeRegistration.current = null
      try {
        onRegisterRef.current(null)
      } catch {
        // Preserve the primary publication failure.
      }
      throw error
    }
  }, [
    fleetRegistration,
    sceneRuntime.projectRevisionId,
    spatialRegistration,
    visibleRobotIdSignature,
    visibleSpatialIdSignature,
  ])

  useEffect(() => () => {
    if (activeRegistration.current === null) return
    activeRegistration.current = null
    onRegisterRef.current(null)
  }, [])

  return (
    <>
      <RobotFleetV4
        geometryPublications={geometryPublications}
        geometryRepository={geometryRepository}
        onRegister={handleFleetRegistration}
        project={project}
        sceneRuntime={sceneRuntime}
      />
      <SpatialEntitySceneV4
        onRegister={handleSpatialRegistration}
        project={project}
        sceneRuntime={sceneRuntime}
      />
    </>
  )
}
