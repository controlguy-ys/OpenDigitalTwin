import { Canvas } from '@react-three/fiber'
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import type {
  RevisionIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { CoordinateDisplayStoreStateV4 } from '../../frames/v4/coordinate-display-store.js'
import type { InteractionStoreStateV4 } from '../../interaction/v4/interaction-store.js'
import type { RobotDefinitionGeometryRepositoryV4 } from '../../robot/v4/robot-definition-geometry-repository.js'
import { CoordinateFrameLayersV4 } from '../../viewport/v4/CoordinateFrameLayers.js'
import { SelectedTcpFrameMarkerV4 } from '../../viewport/v4/SelectedTcpFrameMarker.js'
import type { ViewportPreferenceStoreV4 } from '../../viewport/v4/viewport-preference-store.js'
import { ViewportOverlayV4 } from '../../viewport/v4/ViewportOverlay.js'
import {
  ViewportRuntimeV4,
  type ViewportRuntimeControllerV4,
} from '../../viewport/v4/viewport-runtime.js'
import { SceneErrorBoundary } from '../SceneErrorBoundary.js'
import {
  WorkcellV4,
  type WorkcellRegistrationV4,
} from './Workcell.js'
import type { SceneContextRequestV4 } from './scene-context-request.js'
import type { SceneRuntimeProjectionV4 } from './scene-runtime-selector.js'

const NOOP_VIEWPORT_ACTIONS_V4: ViewportRuntimeControllerV4['actions'] = {
  home: () => undefined,
  fitAll: () => undefined,
  focusSelection: () => undefined,
  setStandardView: () => undefined,
}

export type SceneRenderStatusV4 = 'loading' | 'ready' | 'error'

export interface SceneCameraRequestV4 {
  readonly id: number
  readonly projectRevisionId: RevisionIdV4
  readonly command: 'home' | 'fit-all' | 'focus-selection'
}

export interface SceneCanvasPropsV4 {
  readonly project: WorkcellProjectV4
  readonly sceneRuntime: SceneRuntimeProjectionV4
  readonly geometryRepository: RobotDefinitionGeometryRepositoryV4
  readonly interaction: StoreApi<InteractionStoreStateV4>
  readonly coordinateDisplay: StoreApi<CoordinateDisplayStoreStateV4>
  readonly viewportPreferences: ViewportPreferenceStoreV4
  readonly cameraRequest?: SceneCameraRequestV4
  readonly onContextRequest: (request: SceneContextRequestV4) => void
  readonly onStatusChange?: (status: SceneRenderStatusV4) => void
  readonly onRegistration?: (
    registration: WorkcellRegistrationV4 | null,
  ) => void
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
  cameraRequest,
  onContextRequest,
  onStatusChange,
  onRegistration,
}: SceneCanvasPropsV4): ReactNode {
  const selection = useStore(interaction, (state) => state.selection)
  const viewIsolation = useStore(interaction, (state) => state.isolation)
  const layers = useStore(viewportPreferences, (state) => state.layers)
  const initialCameraState = useRef(viewportPreferences.getState().cameraState)
  const entityContextHandled = useRef(false)
  const currentRevisionId = useRef(project.revisionId)
  currentRevisionId.current = project.revisionId
  const handledCameraRequestKey = useRef<string | null>(null)
  const onRegistrationRef = useRef(onRegistration)
  onRegistrationRef.current = onRegistration
  const [registrationState, setRegistrationState] = useState<RevisionRegistrationV4 | null>(null)
  const [viewportController, setViewportController] = useState<ViewportRuntimeControllerV4 | null>(null)
  const [sceneAttempt, setSceneAttempt] = useState(0)
  const [failedAttempt, setFailedAttempt] = useState<string | null>(null)
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
  }, [interaction])

  const handleEntityContext = useCallback((
    nextSelection: NonNullable<typeof selection>,
    position: SceneContextRequestV4['position'],
  ) => {
    interaction.getState().select(nextSelection)
    entityContextHandled.current = true
    onContextRequest({ selection: nextSelection, position })
    queueMicrotask(() => {
      entityContextHandled.current = false
    })
  }, [interaction, onContextRequest])

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
    if (handledCameraRequestKey.current === requestKey) return
    handledCameraRequestKey.current = requestKey
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
        onContextMenu={(event) => {
          event.preventDefault()
          if (entityContextHandled.current) {
            entityContextHandled.current = false
            return
          }
          interaction.getState().clearSelection()
          onContextRequest({
            selection: null,
            position: { x: event.clientX, y: event.clientY },
          })
        }}
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
            onPointerMissed={() => interaction.getState().clearSelection()}
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
                interaction={{
                  onSelect: handleSelect,
                  onContextMenu: handleEntityContext,
                }}
                onRegister={handleRegistration}
                project={project}
                sceneRuntime={sceneRuntime}
                viewIsolation={viewIsolation}
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
                onRegister={setViewportController}
                preferences={viewportPreferences}
                project={project}
                registration={registration}
                runtime={sceneRuntime}
                selection={selection}
              />
            </Suspense>
          </Canvas>
        </SceneErrorBoundary>
      </div>
      <ViewportOverlayV4
        actions={overlayActions}
        canFocusSelection={viewportController?.canFocusSelection ?? false}
        display={coordinateDisplay}
        preferences={viewportPreferences}
        project={project}
        runtime={sceneRuntime}
        selection={selection}
      />
    </div>
  )
}
