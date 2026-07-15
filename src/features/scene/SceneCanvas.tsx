import { Canvas, useLoader } from '@react-three/fiber'
import { Suspense, useCallback, useMemo, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  ROBOT_LINK_URLS,
  describeRobotLoadError,
  isCompleteRobotRigRegistration,
  type RobotRigRegistration,
} from '../robot/RobotModel'
import type { InteractionRuntimeController } from '../interaction/GraspController'
import { useInteractionStore } from '../interaction/interaction-store'
import { sceneEditorStore } from '../project/project-store-browser'
import { RobotStatusOverlay } from '../robot/RobotStatusOverlay'
import { SceneErrorBoundary } from './SceneErrorBoundary'
import { Workcell } from './Workcell'
import type { ViewportRuntimeController } from './Workcell'
import type { SceneEntityIdV1 } from '../../domain/project/scene-state-v1'
import type {
  SceneContextPosition,
  SceneEntityContextHandler,
} from './scene-context-request'
import type {
  CommittedLinearAxisSourceV1,
  LinearAxisCommittedStateV1,
} from './linear-axis-source'
import { ViewportOverlay, type ViewportOverlayCameraCommands } from '../viewport/ViewportOverlay'
import {
  viewportPreferenceStore,
  type ViewportCameraState,
} from '../viewport/viewport-preference-store'
import type { CoordinateFrameMatrices } from '../viewport/coordinate-pose-readout'

const NOOP_VIEWPORT_ACTIONS: ViewportOverlayCameraCommands = {
  home: () => undefined,
  fitAll: () => undefined,
  focusSelection: () => undefined,
  setStandardView: () => undefined,
}

export type SceneRenderStatus = 'loading' | 'ready' | 'error'

export interface SceneCanvasProps {
  onStatusChange?: (status: SceneRenderStatus) => void
  registerRig?: (registration: RobotRigRegistration | null) => void
  registerInteractionController?: (
    controller: InteractionRuntimeController | null,
  ) => void
  onContextMenu?: (
    entityId: SceneEntityIdV1 | null,
    position: SceneContextPosition,
  ) => void
  linearAxisSource?: CommittedLinearAxisSourceV1 | null
  linearAxisCommittedState?: LinearAxisCommittedStateV1 | null
}

export function SceneCanvas({
  onStatusChange,
  registerRig,
  registerInteractionController,
  onContextMenu,
  linearAxisSource,
  linearAxisCommittedState,
}: SceneCanvasProps) {
  const [sceneKey, setSceneKey] = useState(0)
  const [status, setStatus] = useState<SceneRenderStatus>('loading')
  const entityContextHandledRef = useRef(false)
  const [viewportController, setViewportController] = useState<ViewportRuntimeController | null>(null)
  const [coordinateFrameMatrices, setCoordinateFrameMatrices] = useState<CoordinateFrameMatrices | null>(null)
  const [cameraDiagnostic, setCameraDiagnostic] = useState<ViewportCameraState>(
    viewportPreferenceStore.getState().cameraState,
  )
  const overlayActions = useMemo<ViewportOverlayCameraCommands>(() => {
    if (viewportController === null) return NOOP_VIEWPORT_ACTIONS
    const record = () => {
      const cameraState = viewportController.readCameraState()
      viewportPreferenceStore.getState().setCameraState(cameraState)
      setCameraDiagnostic(cameraState)
    }
    return {
      home: () => { viewportController.actions.home(); record() },
      fitAll: () => { viewportController.actions.fitAll(); record() },
      focusSelection: () => { viewportController.actions.focusSelection(); record() },
      setStandardView: (view) => { viewportController.actions.setStandardView(view); record() },
    }
  }, [viewportController])

  const updateStatus = useCallback(
    (nextStatus: SceneRenderStatus) => {
      setStatus(nextStatus)
      onStatusChange?.(nextStatus)
    },
    [onStatusChange],
  )

  const handleRigRegistration = useCallback(
    (registration: RobotRigRegistration | null) => {
      if (
        registration !== null &&
        isCompleteRobotRigRegistration(registration)
      ) {
        registerRig?.(registration)
        updateStatus('ready')
        return
      }

      registerRig?.(null)
      updateStatus('loading')
    },
    [registerRig, updateStatus],
  )

  const handleSceneError = useCallback(
    (_error: Error) => {
      registerRig?.(null)
      updateStatus('error')
    },
    [registerRig, updateStatus],
  )

  const handleRetry = useCallback(() => {
    updateStatus('loading')
    registerRig?.(null)
    useLoader.clear(GLTFLoader, ROBOT_LINK_URLS)
    setSceneKey((key) => key + 1)
  }, [registerRig, updateStatus])

  const handleEntityContextMenu = useCallback<SceneEntityContextHandler>(
    (entityId, position) => {
      entityContextHandledRef.current = true
      onContextMenu?.(entityId, position)
      queueMicrotask(() => {
        entityContextHandledRef.current = false
      })
    },
    [onContextMenu],
  )

  return (
    <div
      className="scene-canvas"
      data-scene-status={status}
      onContextMenu={(event) => {
        event.preventDefault()
        if (entityContextHandledRef.current) {
          entityContextHandledRef.current = false
          return
        }
        onContextMenu?.(null, { x: event.clientX, y: event.clientY })
      }}
    >
      <SceneErrorBoundary
        formatError={describeRobotLoadError}
        key={sceneKey}
        onError={handleSceneError}
        onRetry={handleRetry}
      >
        <Canvas
          camera={{
            position: [...viewportPreferenceStore.getState().cameraState.position],
            fov: viewportPreferenceStore.getState().cameraState.fov,
            near: viewportPreferenceStore.getState().cameraState.near,
            far: viewportPreferenceStore.getState().cameraState.far,
            zoom: viewportPreferenceStore.getState().cameraState.zoom,
          }}
          dpr={[1, 2]}
          onCreated={({ camera }) => {
            const saved = viewportPreferenceStore.getState().cameraState
            camera.up.set(...saved.up)
            camera.quaternion.set(...saved.quaternion).normalize()
            camera.updateProjectionMatrix()
          }}
          onPointerMissed={() => {
            useInteractionStore.getState().clearSelection()
            sceneEditorStore.getState().select(null)
          }}
          shadows
        >
          <Suspense fallback={null}>
            <Workcell
              linearAxisCommittedState={linearAxisCommittedState ?? null}
              linearAxisSource={linearAxisSource ?? null}
              onEntityContextMenu={handleEntityContextMenu}
              registerInteractionController={registerInteractionController}
              registerRig={handleRigRegistration}
              registerViewportController={setViewportController}
              registerCoordinateFrameMatrices={setCoordinateFrameMatrices}
            />
          </Suspense>
        </Canvas>
      </SceneErrorBoundary>
      <ViewportOverlay
        actions={overlayActions}
        canFocusSelection={viewportController?.canFocusSelection ?? false}
        frameMatrices={coordinateFrameMatrices}
        {...(viewportController === null
          ? {}
          : { robotRevision: viewportController.robotRevision })}
      />
      {import.meta.env.MODE === 'test' ? (
        <>
          <output data-testid="viewport-camera-diagnostic" hidden>
            {JSON.stringify({
              ready: viewportController !== null && coordinateFrameMatrices !== null,
              state: cameraDiagnostic,
              viewFromDirection: new Vector3(...cameraDiagnostic.position)
                .sub(new Vector3(...cameraDiagnostic.target)).normalize().toArray(),
            })}
          </output>
          <output data-testid="frame-marker-diagnostic" hidden>
            {coordinateFrameMatrices === null
              ? 'pending'
              : 'World:X,Y,Z|Robot Base:X,Y,Z|Actual TCP:X,Y,Z'}
          </output>
        </>
      ) : null}
      <RobotStatusOverlay visible={status === 'loading'} />
    </div>
  )
}
