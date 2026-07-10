import { Canvas, useLoader } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { Suspense, useCallback, useState } from 'react'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  ROBOT_LINK_URLS,
  describeRobotLoadError,
  isCompleteRobotRigRegistration,
  type RobotRigRegistration,
} from '../robot/RobotModel'
import { RobotStatusOverlay } from '../robot/RobotStatusOverlay'
import { SceneErrorBoundary } from './SceneErrorBoundary'
import { Workcell } from './Workcell'

export type SceneRenderStatus = 'loading' | 'ready' | 'error'

export interface SceneCanvasProps {
  onStatusChange?: (status: SceneRenderStatus) => void
  registerRig?: (registration: RobotRigRegistration | null) => void
}

export function SceneCanvas({
  onStatusChange,
  registerRig,
}: SceneCanvasProps) {
  const [sceneKey, setSceneKey] = useState(0)
  const [status, setStatus] = useState<SceneRenderStatus>('loading')

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

  return (
    <div className="scene-canvas" data-scene-status={status}>
      <SceneErrorBoundary
        formatError={describeRobotLoadError}
        key={sceneKey}
        onError={handleSceneError}
        onRetry={handleRetry}
      >
        <Canvas
          camera={{ position: [2.2, 1.8, 1.7], fov: 42 }}
          dpr={[1, 2]}
          onCreated={({ camera }) => {
            camera.up.set(0, 0, 1)
            camera.lookAt(0.15, 0, 1.55)
          }}
          shadows
        >
          <Suspense fallback={null}>
            <Physics gravity={[0, 0, 0]}>
              <Workcell registerRig={handleRigRegistration} />
            </Physics>
          </Suspense>
        </Canvas>
      </SceneErrorBoundary>
      <RobotStatusOverlay visible={status === 'loading'} />
    </div>
  )
}
