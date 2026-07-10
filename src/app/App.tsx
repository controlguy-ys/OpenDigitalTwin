import { useState } from 'react'
import {
  SceneCanvas,
  type SceneRenderStatus,
} from '../features/scene/SceneCanvas'
import { AppShell } from './AppShell'

export function App() {
  const [sceneStatus, setSceneStatus] =
    useState<SceneRenderStatus>('loading')

  return (
    <AppShell
      controlsDisabled={sceneStatus !== 'ready'}
      viewport={<SceneCanvas onStatusChange={setSceneStatus} />}
      viewportBusy={sceneStatus === 'loading'}
    />
  )
}
