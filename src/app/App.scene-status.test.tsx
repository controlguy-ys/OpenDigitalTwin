import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createStore } from 'zustand/vanilla'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { deriveCollisionPolicyV4 } from '../domain/collision/collision-policy-v4.js'
import { createCoordinateDisplayStoreV4 } from '../features/frames/v4/coordinate-display-store.js'
import { createInteractionStoreV4 } from '../features/interaction/v4/interaction-store.js'
import type { RobotJobExecutorV4 } from '../features/jobs/v4/job-executor.js'
import { createJobRuntimeStoreV4 } from '../features/jobs/v4/job-runtime-store.js'
import type { BrowserProjectResourcesV4 } from '../features/project/project-store-browser.js'
import { createBrowserRuntimeBundleStoreV4 } from '../features/project/v4/browser-runtime-bundle-store-v4.js'
import { createDefaultProjectV4 } from '../features/project/v4/default-project-v4.js'
import type { ProjectStoreStateV4 } from '../features/project/v4/project-store-v4.js'
import { createRobotDefinitionGeometryRepositoryV4 } from '../features/robot/v4/robot-definition-geometry-repository.js'
import { createRobotRuntimeRegistryV4 } from '../features/robot/v4/robot-runtime-registry.js'
import { selectSceneRuntimeV4 } from '../features/scene/v4/scene-runtime-selector.js'
import { createSceneRuntimeStoreV4 } from '../features/scene/v4/scene-runtime-store.js'
import { createViewportPreferenceStoreV4 } from '../features/viewport/v4/viewport-preference-store.js'
import { App } from './App.js'

const capture = vi.hoisted(() => ({ shellRenders: 0 }))

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { readonly children?: ReactNode }) => (
    <div data-testid="real-scene-canvas-host">{children}</div>
  ),
}))

vi.mock('./AppShell.js', () => ({
  AppShellV4: ({ viewport }: { readonly viewport: ReactNode }) => {
    capture.shellRenders += 1
    if (capture.shellRenders > 5) {
      throw new Error('Scene status callback caused a render loop.')
    }
    return <main>{viewport}</main>
  },
}))

vi.mock('../features/scene/v4/Workcell.js', () => ({ WorkcellV4: () => null }))
vi.mock('../features/viewport/v4/CoordinateFrameLayers.js', () => ({
  CoordinateFrameLayersV4: () => null,
}))
vi.mock('../features/viewport/v4/SelectedTcpFrameMarker.js', () => ({
  SelectedTcpFrameMarkerV4: () => null,
}))
vi.mock('../features/viewport/v4/viewport-runtime.js', () => ({
  ViewportRuntimeV4: () => null,
}))
vi.mock('../features/viewport/v4/ViewportOverlay.js', () => ({
  ViewportOverlayV4: () => null,
}))

function resourcesForSceneStatusTest(): BrowserProjectResourcesV4 {
  const project = createDefaultProjectV4({
    projectId: 'project-scene-status-v4',
    revisionId: 'revision-scene-status-v4',
    nowIso: '2026-07-17T00:00:00.000Z',
  })
  const robots = createRobotRuntimeRegistryV4()
  robots.getState().replaceProject(project)
  const jobs = createJobRuntimeStoreV4()
  jobs.getState().replaceProject(project)
  const projection = selectSceneRuntimeV4(project, robots.getState())
  const scene = createSceneRuntimeStoreV4()
  scene.getState().replaceProjection(projection)
  const interaction = createInteractionStoreV4()
  interaction.getState().replaceProject(project)
  const coordinateDisplay = createCoordinateDisplayStoreV4()
  coordinateDisplay.getState().replaceProject(project)
  const runtimeBundle = createBrowserRuntimeBundleStoreV4()
  runtimeBundle.getState().replaceActive({
    project,
    sceneRuntime: projection,
    collisionPolicy: deriveCollisionPolicyV4(
      project.robots,
      project.robotDefinitions,
      { enabled: true, nearMissMarginM: 0.05 },
    ),
    jobs: {
      executor: {} as RobotJobExecutorV4,
      playback: {
        startJob: vi.fn(() => ({ runId: 'unused' })),
        cancelRobotJob: vi.fn(),
        ensureRunning: vi.fn(),
        quiesce: vi.fn(async () => undefined),
        resume: vi.fn(),
        dispose: vi.fn(),
      },
      dispose: vi.fn(),
    },
  })
  const projectStore = createStore<ProjectStoreStateV4>()(() => ({
    activeProject: project,
    status: 'ready',
    error: null,
    hydrate: vi.fn(async () => undefined),
    newProject: vi.fn(async () => undefined),
    saveActiveProject: vi.fn(async () => project),
    exportActiveProject: vi.fn(async () => new Blob(['{}'])),
    importProject: vi.fn(async () => undefined),
  }))

  return {
    projectStore,
    mutations: {} as BrowserProjectResourcesV4['mutations'],
    robots,
    jobs,
    scene,
    interaction,
    coordinateDisplay,
    viewportPreferences: createViewportPreferenceStoreV4(null),
    geometry: createRobotDefinitionGeometryRepositoryV4(),
    runtimeBundle,
    sceneCommands: {} as BrowserProjectResourcesV4['sceneCommands'],
    jobCommands: {} as BrowserProjectResourcesV4['jobCommands'],
  }
}

describe('App SceneCanvasV4 status integration', () => {
  beforeEach(() => {
    capture.shellRenders = 0
  })

  it('stabilizes the real SceneCanvas loading effect without a render loop', () => {
    expect(() => render(
      <App gatewayPublisher={null} resources={resourcesForSceneStatusTest()} />,
    )).not.toThrow()

    expect(screen.getByTestId('real-scene-canvas-host')).toBeInTheDocument()
    expect(capture.shellRenders).toBeLessThanOrEqual(3)
  })
})
