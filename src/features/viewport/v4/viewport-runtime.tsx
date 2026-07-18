import { OrbitControls } from '@react-three/drei/core/OrbitControls.js'
import { useThree } from '@react-three/fiber'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from 'react'
import {
  Box3,
  PerspectiveCamera,
  Vector3,
  type Object3D,
} from 'three'
import type {
  RobotIdV4,
  SceneGroupIdV4,
  SpatialEntityIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { SceneSelectionV4 } from '../../interaction/v4/scene-selection.js'
import type { WorkcellRegistrationV4 } from '../../scene/v4/Workcell.js'
import type { SceneRuntimeProjectionV4 } from '../../scene/v4/scene-runtime-selector.js'
import {
  captureViewportCameraState,
  createViewportCameraActions,
  restoreViewportCameraState,
  type StandardWorldView,
  type WorldViewDirectionV4,
} from '../camera-actions.js'
import { WorldViewCubeV4 } from './WorldViewCube.js'
import type { AppCommandBindingsV4 } from '../../commands/v4/app-command-runtime.js'
import type {
  ViewportCameraStateV4,
  ViewportPreferenceStoreV4,
} from './viewport-preference-store.js'
import {
  ZERO_VIEWPORT_SAFE_AREA_INSETS_V4,
  type ViewportSafeAreaInsetsV4,
} from './viewport-safe-area.js'

export interface ViewportRuntimeControllerV4 {
  readonly actions: {
    home(): void
    fitAll(): void
    focusSelection(): void
    setStandardView(view: StandardWorldView): void
  }
  readonly canFocusSelection: boolean
  readCameraState(): ViewportCameraStateV4
}

export interface ViewportBoundResolversV4 {
  readonly canFocusSelection: boolean
  fitAllBounds(): Box3
  focusSelectionBounds(): Box3
}

const FRAME_FOCUS_SIZE_M_V4 = 0.02

function addPointBoundsV4(bounds: Box3, point: Vector3): void {
  const half = FRAME_FOCUS_SIZE_M_V4 / 2
  bounds.union(new Box3(
    new Vector3(point.x - half, point.y - half, point.z - half),
    new Vector3(point.x + half, point.y + half, point.z + half),
  ))
}

function addObjectBoundsV4(bounds: Box3, object: Object3D | undefined): void {
  if (object === undefined) return
  object.updateWorldMatrix(true, true)
  const candidate = new Box3().setFromObject(object)
  if (candidate.isEmpty()) {
    addPointBoundsV4(bounds, object.getWorldPosition(new Vector3()))
  } else {
    bounds.union(candidate)
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

function visibleRobotV4(
  project: WorkcellProjectV4,
  runtime: SceneRuntimeProjectionV4,
  robotId: RobotIdV4,
): boolean {
  if (!project.robots.some(({ id }) => id === robotId)) return false
  const entity = runtime.entities.get(robotId)
  return entity?.kind === 'robot' && entity.effectiveVisible
}

function visibleSpatialEntityV4(
  project: WorkcellProjectV4,
  runtime: SceneRuntimeProjectionV4,
  entityId: SpatialEntityIdV4,
): boolean {
  if (!project.spatialEntities.some(({ id }) => id === entityId)) return false
  const entity = runtime.entities.get(entityId)
  return entity?.kind === 'spatial-entity' && entity.effectiveVisible
}

function fitAllBoundsV4(
  project: WorkcellProjectV4,
  runtime: SceneRuntimeProjectionV4,
  registration: WorkcellRegistrationV4 | null,
): Box3 {
  const bounds = new Box3()
  if (registration === null) return bounds
  for (const robot of project.robots) {
    if (visibleRobotV4(project, runtime, robot.id)) {
      addObjectBoundsV4(bounds, registration.robots.get(robot.id)?.root)
    }
  }
  for (const entity of project.spatialEntities) {
    if (visibleSpatialEntityV4(project, runtime, entity.id)) {
      addObjectBoundsV4(bounds, registration.spatialEntities.get(entity.id))
    }
  }
  return bounds
}

function focusSelectionBoundsV4(
  project: WorkcellProjectV4,
  runtime: SceneRuntimeProjectionV4,
  registration: WorkcellRegistrationV4 | null,
  selection: SceneSelectionV4,
): Box3 {
  const bounds = new Box3()
  if (selection === null || registration === null) return bounds

  switch (selection.kind) {
    case 'robot': {
      const registeredRobot = registration.robots.get(selection.robotId)
      if (
        registeredRobot?.geometryState !== 'RESOLVED'
        || !visibleRobotV4(project, runtime, selection.robotId)
      ) return bounds
      addObjectBoundsV4(bounds, registeredRobot.root)
      return bounds
    }
    case 'robot-link': {
      const registeredRobot = registration.robots.get(selection.robotId)
      if (
        registeredRobot?.geometryState !== 'RESOLVED'
        || !visibleRobotV4(project, runtime, selection.robotId)
      ) return bounds
      const robot = project.robots.find(({ id }) => id === selection.robotId)
      const definition = robot === undefined
        ? undefined
        : project.robotDefinitions.find(({ id }) => id === robot.definitionId)
      if (!definition?.links.some(({ id }) => id === selection.linkId)) return bounds
      addObjectBoundsV4(
        bounds,
        registeredRobot.linkObjects.get(selection.linkId),
      )
      return bounds
    }
    case 'spatial-entity': {
      if (
        !visibleSpatialEntityV4(project, runtime, selection.entityId)
      ) return bounds
      addObjectBoundsV4(bounds, registration.spatialEntities.get(selection.entityId))
      return bounds
    }
    case 'scene-group': {
      const group = project.sceneGroups.find(({ id }) => id === selection.groupId)
      const projectedGroup = runtime.groups.get(selection.groupId)
      if (group === undefined || projectedGroup?.effectiveVisible !== true) return bounds
      for (const entity of project.spatialEntities) {
        if (
          groupContainsV4(project, entity.groupId, group.id)
          && visibleSpatialEntityV4(project, runtime, entity.id)
        ) {
          addObjectBoundsV4(bounds, registration.spatialEntities.get(entity.id))
        }
      }
      return bounds
    }
    case 'robot-frame': {
      const registeredRobot = registration.robots.get(selection.robotId)
      if (
        registeredRobot?.geometryState !== 'RESOLVED'
        || !visibleRobotV4(project, runtime, selection.robotId)
      ) return bounds
      const robot = project.robots.find(({ id }) => id === selection.robotId)
      const definition = robot === undefined
        ? undefined
        : project.robotDefinitions.find(({ id }) => id === robot.definitionId)
      if (!definition?.frames.some(({ id }) => id === selection.frameId)) return bounds
      if (runtime.robotFramesByRobotId.get(selection.robotId)?.get(selection.frameId) === undefined) {
        return bounds
      }
      addObjectBoundsV4(
        bounds,
        registeredRobot.frameObjects.get(selection.frameId),
      )
      return bounds
    }
    case 'scene-frame': {
      if (!project.scene.frames.some(({ id }) => id === selection.frameId)) return bounds
      const frame = runtime.globalFrames.get(selection.frameId)
      if (frame?.frameKind !== 'scene' || frame.ownerEntityId !== null) return bounds
      addPointBoundsV4(bounds, new Vector3(...frame.worldPose.positionM))
      return bounds
    }
    case 'entity-frame': {
      const entity = project.spatialEntities.find(({ id }) => id === selection.entityId)
      const owned = entity?.graspFrames.some(({ frameId }) => frameId === selection.frameId)
        || entity?.movingFrames.some(({ frameId }) => frameId === selection.frameId)
      const frame = runtime.globalFrames.get(selection.frameId)
      if (
        !owned
        || frame?.ownerEntityId !== selection.entityId
        || !frame.effectiveVisible
      ) return bounds
      addPointBoundsV4(bounds, new Vector3(...frame.worldPose.positionM))
      return bounds
    }
  }
}

export function createViewportBoundResolversV4(
  project: WorkcellProjectV4,
  runtime: SceneRuntimeProjectionV4,
  registration: WorkcellRegistrationV4 | null,
  selection: SceneSelectionV4,
): ViewportBoundResolversV4 {
  if (runtime.projectRevisionId !== project.revisionId) {
    return {
      canFocusSelection: false,
      fitAllBounds: () => new Box3(),
      focusSelectionBounds: () => new Box3(),
    }
  }
  const focusBounds = () => focusSelectionBoundsV4(
    project,
    runtime,
    registration,
    selection,
  )
  return {
    canFocusSelection: !focusBounds().isEmpty(),
    fitAllBounds: () => fitAllBoundsV4(project, runtime, registration),
    focusSelectionBounds: focusBounds,
  }
}

export interface ViewportRuntimePropsV4 {
  readonly project: WorkcellProjectV4
  readonly runtime: SceneRuntimeProjectionV4
  readonly registration: WorkcellRegistrationV4 | null
  readonly selection: SceneSelectionV4
  readonly preferences: ViewportPreferenceStoreV4
  readonly onRegister: (controller: ViewportRuntimeControllerV4 | null) => void
  readonly safeAreaInsets?: ViewportSafeAreaInsetsV4
  readonly commandBindings: AppCommandBindingsV4
}

export function ViewportRuntimeV4({
  project,
  runtime,
  registration,
  selection,
  preferences,
  onRegister,
  safeAreaInsets = ZERO_VIEWPORT_SAFE_AREA_INSETS_V4,
  commandBindings,
}: ViewportRuntimePropsV4): ReactNode {
  const camera = useThree((state) => state.camera)
  const [controls, setControls] = useState<ComponentRef<typeof OrbitControls> | null>(null)
  const restoredCamera = useRef(false)
  const storedTarget = preferences.getState().cameraState.target
  const registerControls = useCallback(
    (instance: ComponentRef<typeof OrbitControls> | null) => setControls(instance),
    [],
  )
  const resolvers = useMemo(
    () => createViewportBoundResolversV4(project, runtime, registration, selection),
    [project, registration, runtime, selection],
  )
  const cameraActions = useMemo(() => (
    camera instanceof PerspectiveCamera && controls !== null
      ? createViewportCameraActions(camera, controls)
      : null
  ), [camera, controls])

  useLayoutEffect(() => {
    if (
      restoredCamera.current
      || !(camera instanceof PerspectiveCamera)
      || controls === null
    ) return
    restoreViewportCameraState(camera, controls, preferences.getState().cameraState)
    restoredCamera.current = true
  }, [camera, controls, preferences])

  useEffect(() => {
    if (
      cameraActions === null
      || controls === null
      || !(camera instanceof PerspectiveCamera)
    ) return
    const perspectiveCamera = camera
    const controller: ViewportRuntimeControllerV4 = {
      actions: {
        home: cameraActions.home,
        fitAll: () => cameraActions.fitAll(resolvers.fitAllBounds()),
        focusSelection: () => {
          const bounds = resolvers.focusSelectionBounds()
          if (!bounds.isEmpty()) cameraActions.focusSelection(bounds)
        },
        setStandardView: cameraActions.setStandardView,
      },
      canFocusSelection: resolvers.canFocusSelection,
      readCameraState: () => captureViewportCameraState(
        perspectiveCamera,
        controls,
      ) as ViewportCameraStateV4,
    }
    onRegister(controller)
    return () => onRegister(null)
  }, [camera, cameraActions, controls, onRegister, resolvers])

  const handleControlsChange = useCallback((): void => {
    if (!(camera instanceof PerspectiveCamera) || controls === null) return
    preferences.getState().setCameraState(
      captureViewportCameraState(camera, controls) as ViewportCameraStateV4,
    )
  }, [camera, controls, preferences])

  const handleCubeDirection = useCallback((direction: WorldViewDirectionV4): void => {
    cameraActions?.setWorldDirection(direction)
  }, [cameraActions])

  return (
    <>
      <OrbitControls
        enableDamping
        makeDefault
        minDistance={0.8}
        onChange={handleControlsChange}
        ref={registerControls}
        target={storedTarget}
      />
      <WorldViewCubeV4
        commandBindings={commandBindings}
        onDirection={handleCubeDirection}
        safeAreaInsets={safeAreaInsets}
      />
    </>
  )
}
