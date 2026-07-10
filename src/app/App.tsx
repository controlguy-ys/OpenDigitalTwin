import { useEffect, useState } from 'react'
import { JointInspector } from '../features/joints/JointInspector'
import { simulationJointSource } from '../features/joints/SimulationJointSource'
import { useRobotStore } from '../features/joints/robot-store'
import {
  SceneCanvas,
  type SceneRenderStatus,
} from '../features/scene/SceneCanvas'
import { Timeline } from '../features/ui/Timeline'
import { AppShell } from './AppShell'

export function App() {
  const [sceneStatus, setSceneStatus] =
    useState<SceneRenderStatus>('loading')
  const sourceQuality = useRobotStore((state) => state.sourceQuality)
  const controlsDisabled = sceneStatus !== 'ready'

  useEffect(() => {
    const unsubscribe = simulationJointSource.subscribe((frame) => {
      useRobotStore.getState().applyFrame(frame)
    })
    void simulationJointSource.connect()

    return () => {
      unsubscribe()
      void simulationJointSource.disconnect()
    }
  }, [])

  return (
    <AppShell
      bottomRail={
        <Timeline
          disabled={controlsDisabled}
          source={simulationJointSource}
        />
      }
      controlsDisabled={controlsDisabled}
      inspector={
        <JointInspector
          disabled={controlsDisabled}
          source={simulationJointSource}
        />
      }
      sourceQuality={sourceQuality}
      viewport={<SceneCanvas onStatusChange={setSceneStatus} />}
      viewportBusy={sceneStatus === 'loading'}
    />
  )
}
