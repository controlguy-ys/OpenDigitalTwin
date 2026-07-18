import { Canvas } from '@react-three/fiber'
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import type {
  RevisionIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { RigidTransformV4 } from '../../../core/project-v4/rigid-transform.js'
import type { SpatialEntityIdV4 } from '../../../core/project-v4/types.js'
import type { CoordinateDisplayStoreStateV4 } from '../../frames/v4/coordinate-display-store.js'
import type { InteractionStoreStateV4 } from '../../interaction/v4/interaction-store.js'
import type { SceneSelectionTargetV4 } from '../../interaction/v4/scene-selection.js'
import type { RobotDefinitionGeometryRepositoryV4 } from '../../robot/v4/robot-definition-geometry-repository.js'
import { CoordinateFrameLayersV4 } from '../../viewport/v4/CoordinateFrameLayers.js'
import { SelectedTcpFrameMarkerV4 } from '../../viewport/v4/SelectedTcpFrameMarker.js'
import type { ViewportPreferenceStoreV4 } from '../../viewport/v4/viewport-preference-store.js'
import type { AppCommandBindingsV4 } from '../../commands/v4/app-command-runtime.js'
import type { StandardWorldView } from '../../viewport/camera-actions.js'
import { ViewportOverlayV4 } from '../../viewport/v4/ViewportOverlay.js'
import {
  ViewportRuntimeV4,
  type ViewportRuntimeControllerV4,
} from '../../viewport/v4/viewport-runtime.js'
import {
  ZERO_VIEWPORT_SAFE_AREA_INSETS_V4,
  type ViewportSafeAreaInsetsV4,
} from '../../viewport/v4/viewport-safe-area.js'
import { SceneErrorBoundary } from '../SceneErrorBoundary.js'
import {
  WorkcellV4,
  type WorkcellRegistrationV4,
} from './Workcell.js'
import type { SceneContextRequestV4 } from './scene-context-request.js'
import { createRightButtonGestureControllerV4 } from './right-button-gesture.js'
import type { SceneRuntimeProjectionV4 } from './scene-runtime-selector.js'

const NOOP_VIEWPORT_ACTIONS_V4: ViewportRuntimeControllerV4['actions'] = {
  home: () => undefined,
  fitAll: () => undefined,
  focusSelection: () => undefined,
  setStandardView: () => undefined,
}

export type SceneRenderStatusV4 = 'loading' | 'ready' | 'error'

export type SceneCameraCommandV4 =
  | { readonly command: 'home' | 'fit-all' | 'focus-selection' }
  | { readonly command: 'standard-view'; readonly view: StandardWorldView }

export type SceneCameraRequestV4 = SceneCameraCommandV4 & {
  readonly id: number
  readonly projectRevisionId: RevisionIdV4
}

export interface SceneCanvasPropsV4 {
  readonly project: WorkcellProjectV4
  readonly sceneRuntime: SceneRuntimeProjectionV4
  readonly geometryRepository: RobotDefinitionGeometryRepositoryV4
  readonly interaction: StoreApi<InteractionStoreStateV4>
  readonly coordinateDisplay: StoreApi<CoordinateDisplayStoreStateV4>
  readonly viewportPreferences: ViewportPreferenceStoreV4
  readonly commandBindings: AppCommandBindingsV4
  readonly safeAreaInsets?: ViewportSafeAreaInsetsV4
  readonly cameraRequest?: SceneCameraRequestV4
  readonly onContextRequest: (request: SceneContextRequestV4) => void
  /** Keeps App's explicit scene context in lockstep with Canvas selection. */
  readonly onExplicitContextTarget: (selection: SceneSelectionTargetV4 | null) => void
  readonly onStatusChange?: (status: SceneRenderStatusV4) => void
  readonly onRegistration?: (
    registration: WorkcellRegistrationV4 | null,
  ) => void
  readonly onCommitSpatialEntityLocalPose?: (
    entityId: SpatialEntityIdV4,
    localPose: RigidTransformV4,
  ) => Promise<void>
}

interface RevisionRegistrationV4 {
  readonly projectRevisionId: string
  readonly value: WorkcellRegistrationV4
}

export function SceneCanvasV4({
  project,
  sceneRuntime,
  geometryRepository,
  interaction,
  coordinateDisplay,
  viewportPreferences,
  commandBindings,
  safeAreaInsets = ZERO_VIEWPORT_SAFE_AREA_INSETS_V4,
  cameraRequest,
  onContextRequest,
  onExplicitContextTarget,
  onStatusChange,
  onRegistration,
  onCommitSpatialEntityLocalPose,
}: SceneCanvasPropsV4): ReactNode {
  const selection = useStore(interaction, (state) => state.selection)
  const viewIsolation = useStore(interaction, (state) => state.isolation)
  const layers = useStore(viewportPreferences, (state) => state.layers)
  const gizmoFrame = useStore(viewportPreferences, (state) => state.gizmoFrame)
  const initialCameraState = useRef(viewportPreferences.getState().cameraState)
  const gestureRef = useRef(createRightButtonGestureControllerV4())
  const currentRevisionId = useRef(project.revisionId)
  currentRevisionId.current = project.revisionId
  const handledCameraRequests = useRef(new Set<string>())
  const handledCameraWatermark = useRef<{ readonly revisionId: RevisionIdV4; readonly id: number } | null>(null)
  const onRegistrationRef = useRef(onRegistration)
  onRegistrationRef.current = onRegistration
  const [registrationState, setRegistrationState] = useState<RevisionRegistrationV4 | null>(null)
  const [viewportController, setViewportController] = useState<ViewportRuntimeControllerV4 | null>(null)
  const [sceneAttempt, setSceneAttempt] = useState(0)
  const [failedAttempt, setFailedAttempt] = useState<string | null>(null)
  const [transformDragging, setTransformDragging] = useState(false)
  const sceneAttemptKey = `${project.revisionId}:${sceneAttempt}`
  const registration = registrationState?.projectRevisionId === project.revisionId
    ? registrationState.value
    : null
  const status: SceneRenderStatusV4 = failedAttempt === sceneAttemptKey
    ? 'error'
    : registration === null
      ? 'loading'
      : 'ready'

  useEffect(() => {
    onStatusChange?.(status)
  }, [onStatusChange, status])

  useEffect(() => {
    setRegistrationState(null)
    setViewportController(null)
    setFailedAttempt(null)
    onRegistrationRef.current?.(null)
  }, [project.revisionId])

  const handleRegistration = useCallback((value: WorkcellRegistrationV4 | null) => {
    const expectedRevisionId = project.revisionId
    if (currentRevisionId.current !== expectedRevisionId) return
    setRegistrationState(value === null ? null : {
      projectRevisionId: expectedRevisionId,
      value,
    })
    onRegistrationRef.current?.(value)
  }, [project.revisionId])

  const handleSelect = useCallback((nextSelection: NonNullable<typeof selection>) => {
    interaction.getState().select(nextSelection)
    onExplicitContextTarget(nextSelection)
  }, [interaction, onExplicitContextTarget])

  const onScenePointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    gestureRef.current.begin({
      button: event.button,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      clientX: event.clientX,
      clientY: event.clientY,
    })
  }, [])

  const finishGesture = useCallback((event: PointerEvent): void => {
    const gesture = gestureRef.current
    const finished = gesture.finish(event)
    if (finished === null) return
    if (finished.request !== null) {
      if (finished.request.selection === null) interaction.getState().clearSelection()
      else interaction.getState().select(finished.request.selection)
      onContextRequest(finished.request)
    }
    const completionId = finished.completionId
    requestAnimationFrame(() => gesture.clearCompletion(completionId))
  }, [interaction, onContextRequest])

  useEffect(() => {
    const gesture = gestureRef.current
    const onMove = (event: PointerEvent) => gesture.move(event)
    const onUp = (event: PointerEvent) => finishGesture(event)
    const onCancel = (event: PointerEvent) => gesture.cancel(event.pointerId)
    const onNativeMenu = (event: MouseEvent) => {
      const pointer = event as MouseEvent & Partial<PointerEvent>
      const matched = gesture.consumeNativeContextMenu({
        button: event.button,
        clientX: event.clientX,
        clientY: event.clientY,
        ...(typeof pointer.pointerId === 'number'
          ? { pointerId: pointer.pointerId, pointerType: pointer.pointerType }
          : {}),
      })
      if (matched) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const onBlur = () => gesture.cancel()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') gesture.cancel()
    }
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('pointercancel', onCancel, true)
    document.addEventListener('contextmenu', onNativeMenu, true)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('pointercancel', onCancel, true)
      document.removeEventListener('contextmenu', onNativeMenu, true)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      gesture.cancel()
    }
  }, [finishGesture])

  const overlayActions = useMemo<ViewportRuntimeControllerV4['actions']>(() => {
    if (viewportController === null) return NOOP_VIEWPORT_ACTIONS_V4
    const invoke = (action: () => void) => {
      action()
      viewportPreferences.getState().setCameraState(viewportController.readCameraState())
    }
    return {
      home: () => invoke(viewportController.actions.home),
      fitAll: () => invoke(viewportController.actions.fitAll),
      focusSelection: () => invoke(viewportController.actions.focusSelection),
      setStandardView: (view) => invoke(() => viewportController.actions.setStandardView(view)),
    }
  }, [viewportController, viewportPreferences])

  useEffect(() => {
    if (
      cameraRequest === undefined
      || viewportController === null
      || cameraRequest.projectRevisionId !== project.revisionId
    ) return
    const requestKey = `${cameraRequest.projectRevisionId}:${cameraRequest.id}`
    const watermark = handledCameraWatermark.current
    if (handledCameraRequests.current.has(requestKey) || (
      watermark?.revisionId === cameraRequest.projectRevisionId
      && cameraRequest.id <= watermark.id
    )) return
    handledCameraRequests.current.add(requestKey)
    if (handledCameraRequests.current.size > 64) {
      const oldest = handledCameraRequests.current.values().next().value
      if (oldest !== undefined) handledCameraRequests.current.delete(oldest)
    }
    handledCameraWatermark.current = { revisionId: cameraRequest.projectRevisionId, id: cameraRequest.id }
    switch (cameraRequest.command) {
      case 'home':
        overlayActions.home()
        break
      case 'fit-all':
        overlayActions.fitAll()
        break
      case 'focus-selection':
        overlayActions.focusSelection()
        break
      case 'standard-view':
        overlayActions.setStandardView(cameraRequest.view)
        break
    }
  }, [cameraRequest, overlayActions, project.revisionId, viewportController])

  const handleError = useCallback(() => {
    setRegistrationState(null)
    setViewportController(null)
    onRegistrationRef.current?.(null)
    setFailedAttempt(sceneAttemptKey)
  }, [sceneAttemptKey])

  const retry = useCallback(() => {
    setRegistrationState(null)
    setViewportController(null)
    onRegistrationRef.current?.(null)
    setFailedAttempt(null)
    setSceneAttempt((attempt) => attempt + 1)
  }, [])

  return (
    <div
      className="scene-canvas scene-canvas-v4"
      data-scene-status={status}
    >
      <div
        className="scene-canvas-surface-v4"
        data-testid="scene-canvas-surface"
        onPointerDownCapture={onScenePointerDownCapture}
      >
        <SceneErrorBoundary
          key={sceneAttemptKey}
          onError={handleError}
          onRetry={retry}
        >
          <Canvas
            camera={{
              position: [...initialCameraState.current.position],
              zoom: initialCameraState.current.zoom,
              fov: initialCameraState.current.fov,
              near: initialCameraState.current.near,
              far: initialCameraState.current.far,
            }}
            dpr={[1, 2]}
            onCreated={({ camera }) => {
              camera.up.set(...initialCameraState.current.up)
              camera.quaternion.set(...initialCameraState.current.quaternion).normalize()
              camera.updateProjectionMatrix()
            }}
            onPointerMissed={(event) => {
              if (event.button === 0) {
                interaction.getState().clearSelection()
                onExplicitContextTarget(null)
              }
            }}
            shadows="percentage"
          >
            <ambientLight intensity={0.68} />
            <directionalLight
              castShadow
              intensity={1.8}
              position={[3.2, -2.4, 5]}
              shadow-mapSize-height={2048}
              shadow-mapSize-width={2048}
            />
            <Suspense fallback={null}>
              <WorkcellV4
                geometryRepository={geometryRepository}
                gizmoFrame={gizmoFrame}
                interaction={{
                  onSelect: handleSelect,
                  onContextCandidate: (selection, pointerId) => {
                    gestureRef.current.setCandidate(pointerId, selection)
                  },
                }}
                onDraggingChange={setTransformDragging}
                onRegister={handleRegistration}
                project={project}
                sceneRuntime={sceneRuntime}
                selection={selection}
                viewIsolation={viewIsolation}
                {...(onCommitSpatialEntityLocalPose === undefined
                  ? {}
                  : { onCommitLocalPose: onCommitSpatialEntityLocalPose })}
              />
              <CoordinateFrameLayersV4
                layers={layers}
                project={project}
                runtime={sceneRuntime}
                selection={selection}
              />
              <SelectedTcpFrameMarkerV4
                project={project}
                runtime={sceneRuntime}
                selection={selection}
                visible={layers.tcpFrame}
              />
              <ViewportRuntimeV4
                commandBindings={commandBindings}
                onRegister={setViewportController}
                preferences={viewportPreferences}
                project={project}
                registration={registration}
                runtime={sceneRuntime}
                safeAreaInsets={safeAreaInsets}
                selection={selection}
                transformDragging={transformDragging}
              />
            </Suspense>
          </Canvas>
        </SceneErrorBoundary>
      </div>
      <ViewportOverlayV4
        commandBindings={commandBindings}
        display={coordinateDisplay}
        preferences={viewportPreferences}
        project={project}
        runtime={sceneRuntime}
        selection={selection}
        safeAreaInsets={safeAreaInsets}
      />
    </div>
  )
}
