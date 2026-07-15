import { OrbitControls } from '@react-three/drei/core/OrbitControls.js'
import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from 'react'
import { createPortal, useThree } from '@react-three/fiber'
import { Box3, PerspectiveCamera, type Group, type Object3D } from 'three'
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
import type { ExternalCollisionEntityId } from '../interaction/interaction-store'
import {
  createCollisionEntityOutlineSelector,
  useCollisionStore,
} from '../collision/collision-store'
import {
  usePublishedSceneRuntime,
  type SceneRuntimeProjectionV1,
} from './scene-runtime-selector'
import type { SceneEntityContextHandler } from './scene-context-request'
import { LinearAxisRuntime } from './LinearAxisRuntime'
import type {
  CommittedLinearAxisSourceV1,
  LinearAxisCommittedStateV1,
} from './linear-axis-source'
import type { SceneEntityIdV1 } from '../../domain/project/scene-state-v1'
import {
  createViewportCameraActions,
  type ViewportCameraActions,
  type StandardWorldView,
} from '../viewport/camera-actions'
import { TcpFrameMarker } from '../viewport/TcpFrameMarker'
import {
  useViewportPreferenceStore,
  viewportPreferenceStore,
} from '../viewport/viewport-preference-store'
import { sceneEditorStore } from '../project/project-store-browser'

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

interface ViewportRuntimeProps {
  readonly enabled: boolean
  readonly runtime: SceneRuntimeProjectionV1
  readonly objectRoots: ReadonlyMap<string, Object3D>
  readonly robotRoot: Object3D | null
  readonly registerController?: (controller: ViewportRuntimeController | null) => void
}

function ViewportRuntime({
  enabled,
  runtime,
  objectRoots,
  robotRoot,
  registerController,
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
  const currentSelectionBounds = selectedBounds(
    runtime, selectedEntityId, objectRoots, robotRoot, scene,
  )
  const canFocusSelection = !currentSelectionBounds.isEmpty()

  useEffect(() => {
    if (cameraActions === null) return
    const controller: ViewportRuntimeController = {
      actions: {
        home: cameraActions.home,
        fitAll: () => cameraActions.fitAll(fitAllBounds(runtime, objectRoots, robotRoot, scene)),
        focusSelection: () => cameraActions.focusSelection(selectedBounds(
          runtime, selectedEntityId, objectRoots, robotRoot, scene,
        )),
        setStandardView: cameraActions.setStandardView,
      },
      canFocusSelection,
      robotRevision: 0,
    }
    registerController?.(controller)
    return () => registerController?.(null)
  }, [
    cameraActions,
    canFocusSelection,
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
        viewportPreferenceStore.getState().setCameraState({
          position: camera.position.toArray(),
          target: controls.target.toArray(),
          quaternion: camera.quaternion.toArray(),
          zoom: camera.zoom,
        })
      }}
      ref={registerOrbitControls}
      target={storedTarget}
    />
  )
}

const Workbench = forwardRef<Group>(function Workbench(_props, ref) {
  const collisionOutline = useCollisionStore(selectWorkbenchCollisionOutline)
  const outlineState =
    collisionOutline ??
    getExternalEntityOutlineState('workcell:workbench', false, [])
  const collision = outlineState === 'collision'
  const nearMiss = outlineState === 'near-miss'
  return (
    <group name="workbench" ref={ref}>
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
})

export function Workcell({
  registerRig,
  registerInteractionController,
  onEntityContextMenu,
  linearAxisSource = null,
  linearAxisCommittedState = null,
  registerViewportController,
}: WorkcellProps) {
  const sceneRuntime = usePublishedSceneRuntime()
  const renderEntities = workcellRenderEntities(sceneRuntime)
  const [rig, setRig] = useState<RobotRigRegistration | null>(null)
  const [orbitEnabled, setOrbitEnabled] = useState(true)
  const mcp = useCoordinateFrameStore((state) => state.frames.mcp)
  const showGrid = useViewportPreferenceStore((state) => state.layers.grid)
  const showWorldFrame = useViewportPreferenceStore((state) => state.layers.worldFrame)
  const showBaseFrame = useViewportPreferenceStore((state) => state.layers.baseFrame)
  const showTcpFrame = useViewportPreferenceStore((state) => state.layers.tcpFrame)
  const equipmentObjectsRef = useRef(
    new Map<ExternalCollisionEntityId, Object3D>(),
  )
  const workbenchObjectRef = useRef<Group>(null)
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

  useLayoutEffect(
    () =>
      registerGeometryEntity(
        workbenchToGeometryEntity(workbenchObjectRef.current),
      ),
    [],
  )

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
      <Workbench ref={workbenchObjectRef} />
      <group
        name="mcp-frame"
        position={mcp.position}
        quaternion={mcp.quaternion}
      >
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
            workbenchTopZ={WORKBENCH_TOP_Z}
          />
        </>
      )}
      <ViewportRuntime
        enabled={orbitEnabled}
        objectRoots={equipmentObjectsRef.current}
        {...(registerViewportController === undefined
          ? {}
          : { registerController: registerViewportController })}
        robotRoot={rig?.rig.root ?? null}
        runtime={sceneRuntime}
      />
    </>
  )
}
