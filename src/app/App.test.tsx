import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore } from 'zustand/vanilla'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { deriveCollisionPolicyV4 } from '../domain/collision/collision-policy-v4.js'
import { createCoordinateDisplayStoreV4 } from '../features/frames/v4/coordinate-display-store.js'
import { createInteractionStoreV4 } from '../features/interaction/v4/interaction-store.js'
import type { SceneSelectionTargetV4 } from '../features/interaction/v4/scene-selection.js'
import { createJobRuntimeStoreV4 } from '../features/jobs/v4/job-runtime-store.js'
import type { RobotJobPlaybackControllerV4 } from '../features/jobs/v4/simulation-clock.js'
import type {
  BrowserProjectResourcesV4,
} from '../features/project/project-store-browser.js'
import { createBrowserRuntimeBundleStoreV4 } from '../features/project/v4/browser-runtime-bundle-store-v4.js'
import { createDefaultProjectV4 } from '../features/project/v4/default-project-v4.js'
import type { ProjectMutationServiceV4 } from '../features/project/v4/project-v4-mutation-service.js'
import type { ProjectStoreStateV4 } from '../features/project/v4/project-store-v4.js'
import { createRobotDefinitionGeometryRepositoryV4 } from '../features/robot/v4/robot-definition-geometry-repository.js'
import { createRobotRuntimeRegistryV4 } from '../features/robot/v4/robot-runtime-registry.js'
import type { SceneCommandServiceV4 } from '../features/scene/v4/scene-command-service.js'
import { selectSceneRuntimeV4 } from '../features/scene/v4/scene-runtime-selector.js'
import { createSceneRuntimeStoreV4 } from '../features/scene/v4/scene-runtime-store.js'
import { createViewportPreferenceStoreV4 } from '../features/viewport/v4/viewport-preference-store.js'
import { App } from './App.js'

const observed = vi.hoisted(() => ({
  canvas: null as null | Record<string, unknown>,
  collision: null as null | Record<string, unknown>,
  inspector: null as null | Record<string, unknown>,
  jobList: null as null | Record<string, unknown>,
  timeline: null as null | Record<string, unknown>,
  contextMenuProjectRevisions: [] as string[],
  shellControlsDisabled: [] as boolean[],
}))

vi.mock('./AppShell.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./AppShell.js')>()
  return {
    ...actual,
    AppShellV4: (props: Parameters<typeof actual.AppShellV4>[0]) => {
      observed.shellControlsDisabled.push(props.controlsDisabled ?? false)
      return <actual.AppShellV4 {...props} />
    },
  }
})

vi.mock('../features/scene/v4/SceneCanvas.js', () => ({
  SceneCanvasV4: (props: Record<string, unknown>) => {
    observed.canvas = props
    return (
      <div data-testid="scene-canvas-v4">
        <button
          onClick={() => (
            props.onStatusChange as ((status: 'ready') => void) | undefined
          )?.('ready')}
          type="button"
        >
          Scene ready
        </button>
        <button
          onClick={() => (
            props.onContextRequest as ((request: unknown) => void)
          )({
            selection: null,
            position: { x: 10, y: 20 },
          })}
          type="button"
        >
          Empty context
        </button>
        <button
          onClick={() => (
            props.onRegistration as ((registration: unknown) => void)
          )({
            robots: new Map(),
            spatialEntities: new Map(),
            collisionProxies: [{ marker: 'proxy-v4' }],
          })}
          type="button"
        >
          Register collision proxies
        </button>
      </div>
    )
  },
}))

vi.mock('../features/scene/v4/SceneExplorer.js', () => ({
  SceneExplorerV4: (props: {
    onFocus: (selection: SceneSelectionTargetV4) => void
  }) => (
    <section data-testid="scene-explorer-v4">
      Scene Explorer V4
      <button
        onClick={() => props.onFocus({
          kind: 'robot',
          robotId: 'robot-default',
        })}
        type="button"
      >
        Focus Robot
      </button>
    </section>
  ),
}))

vi.mock('../features/scene/v4/SceneEntityInspector.js', () => ({
  SceneEntityInspectorV4: (props: Record<string, unknown>) => {
    observed.inspector = props
    return <section data-testid="scene-inspector-v4">Inspector V4</section>
  },
}))

vi.mock('../features/jobs/v4/RobotJobList.js', () => ({
  RobotJobListV4: (props: Record<string, unknown>) => {
    observed.jobList = props
    return <section data-testid="robot-jobs-v4">Robot Jobs V4</section>
  },
}))

vi.mock('../features/ui/v4/Timeline.js', () => ({
  TimelineV4: (props: Record<string, unknown>) => {
    observed.timeline = props
    return <section data-testid="timeline-v4">Timeline V4</section>
  },
}))

vi.mock('../features/scene/v4/SceneContextMenu.js', () => ({
  SceneContextMenuV4: (props: {
    onFitAll: () => void
    onOpenCollision: (selection: SceneSelectionTargetV4) => void
    project: { readonly revisionId: string }
  }) => (
    (() => {
      observed.contextMenuProjectRevisions.push(props.project.revisionId)
      return (
        <div data-testid="scene-context-menu-v4">
          <button onClick={props.onFitAll} type="button">Fit All</button>
          <button
            onClick={() => props.onOpenCollision({
              kind: 'robot',
              robotId: 'robot-default',
            })}
            type="button"
          >
            Open Collision
          </button>
        </div>
      )
    })()
  ),
}))

vi.mock('../features/collision/v4/CollisionPanel.js', () => ({
  CollisionPanelV4: (props: Record<string, unknown>) => {
    observed.collision = props
    return <section data-testid="collision-v4">Collision V4</section>
  },
}))

function resourcesForTest(): BrowserProjectResourcesV4 & {
  readonly sceneCommands: SceneCommandServiceV4
} {
  const project = createDefaultProjectV4({
    projectId: 'project-app-v4',
    revisionId: 'revision-app-v4',
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
  const playback: RobotJobPlaybackControllerV4 = {
    startJob: vi.fn(() => ({ runId: 'run-app-v4' })),
    cancelRobotJob: vi.fn(),
    ensureRunning: vi.fn(),
    quiesce: vi.fn(async () => undefined),
    resume: vi.fn(),
    dispose: vi.fn(),
  }
  const executor = {
    startJob: vi.fn(() => ({ runId: 'run-app-v4' })),
    advanceAll: vi.fn(async () => undefined),
    cancelRobotJob: vi.fn(),
    readState: vi.fn(() => jobs.getState().byRobotId['robot-default']!),
    waitForTerminal: vi.fn(),
    reset: vi.fn(),
    shutdown: vi.fn(),
  }
  runtimeBundle.getState().replaceActive({
    project,
    sceneRuntime: projection,
    collisionPolicy: deriveCollisionPolicyV4(
      project.robots,
      project.robotDefinitions,
      { enabled: true, nearMissMarginM: 0.05 },
    ),
    jobs: {
      executor,
      playback,
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
  const mutations = {
    hydrate: vi.fn(async () => undefined),
    readPublished: vi.fn(() => null),
    subscribe: vi.fn(() => () => undefined),
    replace: vi.fn(),
    replacePrepared: vi.fn(),
    replaceFromActive: vi.fn(),
    isRecoveryRequired: vi.fn(() => false),
  } as unknown as ProjectMutationServiceV4
  const sceneCommands = {
    createBox: vi.fn(async () => 'box-v4'),
    createCylinder: vi.fn(async () => 'cylinder-v4'),
    createGroup: vi.fn(async () => 'group-v4'),
  } as unknown as SceneCommandServiceV4

  return {
    projectStore,
    mutations,
    robots,
    jobs,
    scene,
    interaction,
    coordinateDisplay,
    viewportPreferences: createViewportPreferenceStoreV4(null),
    geometry: createRobotDefinitionGeometryRepositoryV4(),
    runtimeBundle,
    sceneCommands,
    jobCommands: {} as BrowserProjectResourcesV4['jobCommands'],
  }
}

describe('App Project V4 production composition', () => {
  beforeEach(() => {
    observed.canvas = null
    observed.collision = null
    observed.inspector = null
    observed.jobList = null
    observed.timeline = null
    observed.contextMenuProjectRevisions.length = 0
    observed.shellControlsDisabled.length = 0
    localStorage.clear()
  })

  it('renders only after every public resource reports the active revision', () => {
    const resources = resourcesForTest()
    resources.scene.setState((state) => ({
      ...state,
      projectRevisionId: 'revision-stale',
    }), true)

    render(<App gatewayPublisher={null} resources={resources} />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Synchronizing Project V4',
    )
    expect(screen.queryByTestId('scene-canvas-v4')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
    expect(resources.sceneCommands.createBox).not.toHaveBeenCalled()
  })

  it('exposes no mutation controls while Project recovery is required', () => {
    const resources = resourcesForTest()
    resources.projectStore.setState((state) => ({
      ...state,
      status: 'recovery-required',
      error: 'Recovery is required.',
    }), true)

    render(<App gatewayPublisher={null} resources={resources} />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Project V4 recovery requires a reload.',
    )
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
    expect(resources.sceneCommands.createBox).not.toHaveBeenCalled()
  })

  it('keeps the last durable Project usable after an ordinary command error', () => {
    const resources = resourcesForTest()
    resources.projectStore.setState((state) => ({
      ...state,
      status: 'error',
      error: 'Imported Project is invalid.',
    }), true)

    render(<App gatewayPublisher={null} resources={resources} />)

    expect(screen.getByTestId('scene-canvas-v4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Imported Project is invalid.',
    )
  })

  it('composes the V4 Scene, Inspector, Jobs, Timeline, and Collision surfaces', async () => {
    const resources = resourcesForTest()
    const user = userEvent.setup()

    render(<App gatewayPublisher={null} resources={resources} />)

    expect(screen.getByTestId('scene-explorer-v4')).toBeInTheDocument()
    expect(screen.getByTestId('scene-canvas-v4')).toBeInTheDocument()
    expect(screen.getByTestId('scene-inspector-v4')).toBeInTheDocument()
    expect(screen.getByTestId('robot-jobs-v4')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-v4')).toBeInTheDocument()
    expect(screen.queryByTestId('collision-v4')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', {
      name: 'Timeline and Events sheet',
    }))
    await user.click(screen.getByRole('tab', { name: /^Collision/ }))
    expect(screen.getByTestId('collision-v4')).toBeInTheDocument()
    expect(screen.queryByTestId('timeline-v4')).not.toBeInTheDocument()
    expect(screen.getByText('Joint source: Simulation')).toBeVisible()
    expect(screen.queryByText('Import STEP')).not.toBeInTheDocument()
    expect(screen.queryByText('Import Robot')).not.toBeInTheDocument()
    expect(screen.queryByText('Linear Axis')).not.toBeInTheDocument()
  })

  it('keeps Job surfaces on the Active Robot when Scene selection is non-Robot', async () => {
    const resources = resourcesForTest()
    render(<App gatewayPublisher={null} resources={resources} />)

    act(() => {
      resources.interaction.getState().select({ kind: 'scene-frame', frameId: 'world' })
    })

    await waitFor(() => {
      expect(observed.jobList?.selectedRobotId).toBe('robot-default')
      expect(observed.timeline?.robotId).toBe('robot-default')
      expect(observed.inspector?.selectedJobId).toBe(
        resources.interaction.getState().selectedJobIdsByRobotId.get('robot-default') ?? null,
      )
    })
  })

  it('projects live Joint writes into the Scene Canvas runtime', async () => {
    const resources = resourcesForTest()
    render(<App gatewayPublisher={null} resources={resources} />)

    const jointValue = () => {
      const runtime = observed.canvas?.sceneRuntime as {
        readonly entities: ReadonlyMap<string, {
          readonly kind: string
          readonly serialPose?: { readonly jointValues: Readonly<Record<string, number>> }
        }>
      } | undefined
      return runtime?.entities.get('robot-default')?.serialPose?.jointValues.J1
    }
    expect(jointValue()).toBe(0)

    act(() => {
      resources.robots.getState().writeJointValues(
        'robot-default',
        { J1: 35 },
        'simulation',
      )
    })

    await waitFor(() => expect(jointValue()).toBe(35))
  })

  it('routes primitive creation and revision-qualified Focus and Fit requests', async () => {
    const resources = resourcesForTest()
    const user = userEvent.setup()
    render(<App gatewayPublisher={null} resources={resources} />)

    await user.click(screen.getByRole('button', { name: 'Scene ready' }))
    await waitFor(() => expect(
      screen.getByRole('button', { name: 'Add' }),
    ).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('menuitem', { name: 'Box' }))
    expect(resources.sceneCommands.createBox).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Box',
        parentFrameId: 'mcp',
        groupId: null,
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Focus Robot' }))
    await waitFor(() => expect(observed.canvas?.cameraRequest).toMatchObject({
      projectRevisionId: 'revision-app-v4',
      command: 'focus-selection',
    }))

    await user.click(screen.getByRole('button', { name: 'Empty context' }))
    await user.click(screen.getByRole('button', { name: 'Fit All' }))
    await waitFor(() => expect(observed.canvas?.cameraRequest).toMatchObject({
      projectRevisionId: 'revision-app-v4',
      command: 'fit-all',
    }))
  })

  it('retains registered collision proxies and opens Collision from context', async () => {
    const resources = resourcesForTest()
    const user = userEvent.setup()
    render(<App gatewayPublisher={null} resources={resources} />)

    await user.click(screen.getByRole('button', {
      name: 'Register collision proxies',
    }))
    await user.click(screen.getByRole('button', {
      name: 'Timeline and Events sheet',
    }))
    await user.click(screen.getByRole('tab', { name: /^Collision/ }))
    await waitFor(() => expect(observed.collision?.proxies).toEqual([
      { marker: 'proxy-v4' },
    ]))

    await user.click(screen.getByRole('button', { name: 'Empty context' }))
    await user.click(screen.getByRole('button', { name: 'Open Collision' }))

    expect(screen.getByRole('tabpanel', { name: 'Collision' })).toBeVisible()
  })

  it('drops a camera request from the previous Project revision', async () => {
    const resources = resourcesForTest()
    const user = userEvent.setup()
    render(<App gatewayPublisher={null} resources={resources} />)
    await user.click(screen.getByRole('button', { name: 'Focus Robot' }))
    await waitFor(() => expect(observed.canvas?.cameraRequest).toMatchObject({
      projectRevisionId: 'revision-app-v4',
    }))

    const nextProject = createDefaultProjectV4({
      projectId: 'project-app-v4',
      revisionId: 'revision-app-v4-next',
      nowIso: '2026-07-17T01:00:00.000Z',
    })
    act(() => {
      resources.robots.getState().replaceProject(nextProject)
      resources.jobs.getState().replaceProject(nextProject)
      const projection = selectSceneRuntimeV4(
        nextProject,
        resources.robots.getState(),
      )
      resources.scene.getState().replaceProjection(projection)
      resources.interaction.getState().replaceProject(nextProject)
      resources.coordinateDisplay.getState().replaceProject(nextProject)
      const priorJobs = resources.runtimeBundle.getState().active!.jobs
      resources.runtimeBundle.getState().replaceActive({
        project: nextProject,
        sceneRuntime: projection,
        collisionPolicy: deriveCollisionPolicyV4(
          nextProject.robots,
          nextProject.robotDefinitions,
          { enabled: true, nearMissMarginM: 0.05 },
        ),
        jobs: priorJobs,
      })
      resources.projectStore.setState((state) => ({
        ...state,
        activeProject: nextProject,
      }), true)
    })

    await waitFor(() => {
      const request = observed.canvas?.cameraRequest as
        | { readonly projectRevisionId?: string }
        | undefined
      expect(request?.projectRevisionId).not.toBe('revision-app-v4')
    })
  })

  it('never exposes prior Scene readiness or context during Project replacement', async () => {
    const resources = resourcesForTest()
    const user = userEvent.setup()
    render(<App gatewayPublisher={null} resources={resources} />)

    await user.click(screen.getByRole('button', { name: 'Scene ready' }))
    await user.click(screen.getByRole('button', { name: 'Empty context' }))
    expect(screen.getByTestId('scene-context-menu-v4')).toBeInTheDocument()

    const shellRenderCount = observed.shellControlsDisabled.length
    const nextProject = createDefaultProjectV4({
      projectId: 'project-app-v4',
      revisionId: 'revision-app-v4-replacement',
      nowIso: '2026-07-17T02:00:00.000Z',
    })
    act(() => {
      resources.robots.getState().replaceProject(nextProject)
      resources.jobs.getState().replaceProject(nextProject)
      const projection = selectSceneRuntimeV4(
        nextProject,
        resources.robots.getState(),
      )
      resources.scene.getState().replaceProjection(projection)
      resources.interaction.getState().replaceProject(nextProject)
      resources.coordinateDisplay.getState().replaceProject(nextProject)
      const priorJobs = resources.runtimeBundle.getState().active!.jobs
      resources.runtimeBundle.getState().replaceActive({
        project: nextProject,
        sceneRuntime: projection,
        collisionPolicy: deriveCollisionPolicyV4(
          nextProject.robots,
          nextProject.robotDefinitions,
          { enabled: true, nearMissMarginM: 0.05 },
        ),
        jobs: priorJobs,
      })
      resources.projectStore.setState((state) => ({
        ...state,
        activeProject: nextProject,
      }), true)
    })

    expect(
      observed.contextMenuProjectRevisions,
    ).not.toContain('revision-app-v4-replacement')
    expect(
      observed.shellControlsDisabled.slice(shellRenderCount),
    ).not.toContain(false)
  })
})
